"""Render helper: a faster machine that takes jobs from a render service's queue.

    HQ_WORKER_TOKEN=... python -m hqrender.worker https://<service>

Polls the service, downloads each claimed tab from the catalogue (checking its hash), renders
it locally and uploads the files; the service publishes them. While a helper polls, the
service's own worker leaves the queue to it, so a Raspberry Pi keeps serving and only renders
when the helper is away. Stop it any time: an unfinished job returns to the queue after 30 min.
Uses the same environment as render.py (HQ_ASSETS, HQ_SFIZZ, HQ_AMP_WORKERS, ...).
"""
import json, os, shutil, sys, tempfile, time, traceback, urllib.request

from . import render, thermal
from .catalogue import fetch_score

POLL = float(os.environ.get('HQ_WORKER_POLL_S', '5'))


def call(base, token, method, path, data=None, content_type='application/json'):
    req = urllib.request.Request(f'{base.rstrip("/")}{path}', data=data, method=method,
                                 headers={'Authorization': f'Bearer {token}', 'Content-Type': content_type,
                                          'User-Agent': 'tablatures-hq-helper/1'})
    with urllib.request.urlopen(req, timeout=300) as r:
        body = r.read()
    return json.loads(body) if body else {}


def run(base, token):
    log = lambda *a: print(time.strftime('%H:%M:%S'), *a, flush=True)
    log(f'helping {base}')
    while True:
        try: job = call(base, token, 'POST', '/v1/jobs/claim', b'{}')
        except Exception as e:
            log('service unreachable:', e); time.sleep(30); continue
        if not job.get('sha256'):
            time.sleep(POLL); continue
        sha, tab_id = job['sha256'], job['tabId']
        work = tempfile.mkdtemp(prefix='hq-helper-'); out = os.path.join(work, 'out')
        try:
            log('render', tab_id, sha[:12])
            score = os.path.join(work, 'score'); fetch_score(tab_id, sha, score)
            t0 = time.time()
            report = lambda phase, f: call(base, token, 'POST', f'/v1/jobs/{sha}/progress', json.dumps({'phase': phase, 'progress': f}).encode())
            render.render(score, out, os.path.join(work, 'tmp'), log=lambda *a: log(' ', *a), between=thermal.wait_cool, progress=report)
            report('uploading', 0.97)
            names = sorted(os.listdir(out), key=lambda n: n == 'manifest.json')  # manifest last
            for n in names:
                with open(os.path.join(out, n), 'rb') as f:
                    call(base, token, 'PUT', f'/v1/jobs/{sha}/files/{n}', f.read(), 'application/octet-stream')
            call(base, token, 'POST', f'/v1/jobs/{sha}/done', b'{}')
            log(f'uploaded {tab_id} ({time.time() - t0:.0f}s render)')
        except Exception as e:
            log('failed', tab_id, repr(e)); traceback.print_exc()
            try: call(base, token, 'POST', f'/v1/jobs/{sha}/failed', repr(e)[:500].encode(), 'text/plain')
            except Exception: pass
        finally:
            shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    token = os.environ.get('HQ_WORKER_TOKEN')
    if len(sys.argv) != 2 or not token: sys.exit('usage: HQ_WORKER_TOKEN=... python -m hqrender.worker <service url>')
    run(sys.argv[1], token)
