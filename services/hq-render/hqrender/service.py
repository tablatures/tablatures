"""Render queue, worker and HTTP API in one process (the proof-of-concept deployment).

    python -m hqrender.service

HTTP contract (the app depends on this and nothing else, so another host can replace it):
    GET  /v1/scores/<sha256>/manifest.json      rendered files for a score (404 until rendered)
    GET  /v1/scores/<sha256>/<file>             audio, with Range support
    POST /v1/render  {"tabId": "...", "sha256": "..."}
         -> 202 {"status": "queued" | "rendering"} | 200 {"status": "done"} | 4xx/503 {"status": "refused", "reason": ...}
    GET  /v1/health

Only catalogue tabs are rendered: the worker downloads the score itself from the catalogue and
renders it only if its hash matches the request. Nobody can upload files.

Safety limits (environment, defaults in brackets):
    HQ_DISABLED_FILE   if this file exists, every endpoint answers 503 and nothing renders  [~/tabrender/DISABLED]
    HQ_DAILY_RENDERS   renders started per UTC day                                         [40]
    HQ_QUEUE_MAX       queued jobs                                                          [50]
    HQ_STORAGE_CAP_GB  stop rendering once stored files reach this size                     [8]
    HQ_HOT_C/HQ_COOL_C pause work above HQ_HOT_C, resume below HQ_COOL_C (CPU temperature) [70/60]
    HQ_REQ_PER_MIN     render requests per client address per minute                        [10]
    HQ_ALLOWED_ORIGINS CORS origins, comma separated, * wildcards allowed                    [*]
                       e.g. https://tablatures-git-*-tablatures.vercel.app,http://localhost:*
Other: HQ_HOST [0.0.0.0], HQ_PORT [8790], HQ_STATE_DIR [~/tabrender/state],
    HQ_CATALOGUE_URL [https://api.tablatures.org/api/download/{id}], plus storage.py and render.py settings.
"""
import collections, fnmatch, json, os, re, shutil, sqlite3, sys, threading, time, traceback, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import storage as storage_mod, thermal

E = os.environ.get
STATE = os.path.expanduser(E('HQ_STATE_DIR', '~/tabrender/state'))
DISABLED = os.path.expanduser(E('HQ_DISABLED_FILE', '~/tabrender/DISABLED'))
DAILY = int(E('HQ_DAILY_RENDERS', '40')); QUEUE_MAX = int(E('HQ_QUEUE_MAX', '50'))
CAP = float(E('HQ_STORAGE_CAP_GB', '8')) * 1e9
REQ_PER_MIN = int(E('HQ_REQ_PER_MIN', '10'))
ORIGINS = [o.strip() for o in E('HQ_ALLOWED_ORIGINS', '*').split(',')]
CATALOGUE = E('HQ_CATALOGUE_URL', 'https://api.tablatures.org/api/download/{id}')
TAB_ID = re.compile(r'^[A-Za-z0-9:_.\-]{1,160}$'); SHA = re.compile(r'^[0-9a-f]{64}$')
FILE = re.compile(r'^[A-Za-z0-9_.\-]{1,80}$')
MAX_SCORE = 20 * 2 ** 20
USER_AGENT = 'tablatures-hq-render/1 (+https://tablatures.github.io/tablatures)'
RETRY_AFTER = 3600  # a failed render may be requested again after this many seconds

os.makedirs(STATE, exist_ok=True)
store = storage_mod.from_env()
_db_lock = threading.Lock()
db = sqlite3.connect(os.path.join(STATE, 'jobs.sqlite'), check_same_thread=False)
db.execute('create table if not exists jobs (sha text primary key, tab_id text, status text, error text, created real, started real, finished real)')
db.execute("update jobs set status = 'queued' where status = 'rendering'")  # interrupted by a restart
db.commit()


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def disabled():
    return os.path.exists(DISABLED)


def wait_cool():
    thermal.wait_cool(log, stop=disabled)


def q(sql, *args):
    with _db_lock:
        cur = db.execute(sql, args); db.commit(); return cur.fetchall()


def renders_today():
    day = time.time() - time.time() % 86400
    return q('select count(*) from jobs where started >= ?', day)[0][0]


def request_render(tab_id, sha):
    """-> (http status, body). Every refusal is cheap: nothing is downloaded or rendered."""
    if store.has(sha): return 200, {'status': 'done'}
    row = q('select status, error, finished from jobs where sha = ?', sha)
    if row and row[0][0] in ('queued', 'rendering'): return 202, {'status': row[0][0]}
    if row and row[0][0] == 'failed' and time.time() - (row[0][2] or 0) < RETRY_AFTER:
        return 422, {'status': 'refused', 'reason': 'render failed, retry later', 'error': row[0][1]}
    if q("select count(*) from jobs where status = 'queued'")[0][0] >= QUEUE_MAX: return 503, {'status': 'refused', 'reason': 'queue full'}
    q('insert or replace into jobs (sha, tab_id, status, created) values (?, ?, ?, ?)', sha, tab_id, 'queued', time.time())
    return 202, {'status': 'queued'}


def fetch_score(tab_id, sha, path):
    import hashlib
    req = urllib.request.Request(CATALOGUE.format(id=urllib.request.quote(tab_id, safe=':')), headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read(MAX_SCORE + 1)
    if len(data) > MAX_SCORE: raise ValueError('score too large')
    if hashlib.sha256(data).hexdigest() != sha: raise ValueError('catalogue file does not match the requested hash')
    open(path, 'wb').write(data)


def worker():
    from . import render
    while True:
        time.sleep(2)
        if disabled(): continue
        job = q("select sha, tab_id from jobs where status = 'queued' order by created limit 1")
        if not job: continue
        if renders_today() >= DAILY or store.used_bytes() >= CAP: continue  # leave it queued for tomorrow / more space
        wait_cool()
        sha, tab_id = job[0]
        if store.has(sha):  # published meanwhile, e.g. rendered on a faster machine
            q("update jobs set status = 'done', finished = ? where sha = ?", time.time(), sha); continue
        q("update jobs set status = 'rendering', started = ? where sha = ?", time.time(), sha)
        work = os.path.join(STATE, 'work', sha); out = os.path.join(STATE, 'out', sha)
        try:
            os.makedirs(work, exist_ok=True); score = os.path.join(work, 'score')
            fetch_score(tab_id, sha, score)
            log('render', tab_id, sha[:12])
            render.render(score, out, os.path.join(work, 'tmp'), log=lambda *a: log(' ', *a), between=wait_cool)
            store.publish(sha, out)
            q("update jobs set status = 'done', finished = ? where sha = ?", time.time(), sha)
        except Exception as e:  # one bad score must not stop the queue
            log('failed', tab_id, repr(e)); traceback.print_exc()
            q("update jobs set status = 'failed', error = ?, finished = ? where sha = ?", str(e)[:500], time.time(), sha)
        finally:
            shutil.rmtree(work, ignore_errors=True); shutil.rmtree(out, ignore_errors=True)


_hits = collections.defaultdict(collections.deque); _hits_lock = threading.Lock()


def rate_ok(addr):
    now = time.time()
    with _hits_lock:
        d = _hits[addr]
        while d and d[0] < now - 60: d.popleft()
        if len(d) >= REQ_PER_MIN: return False
        d.append(now); return True


class Handler(BaseHTTPRequestHandler):
    server_version = 'hqrender/1'

    def cors(self):
        origin = self.headers.get('Origin') or ''
        if '*' in ORIGINS: self.send_header('Access-Control-Allow-Origin', '*')
        elif any(fnmatch.fnmatchcase(origin, o) for o in ORIGINS):
            self.send_header('Access-Control-Allow-Origin', origin); self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Range')
        self.send_header('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges')

    def reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code); self.cors()
        self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(data))); self.send_header('Cache-Control', 'no-store')
        self.end_headers(); self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204); self.cors(); self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); self.end_headers()

    def do_POST(self):
        if disabled(): return self.reply(503, {'status': 'refused', 'reason': 'disabled'})
        if self.path != '/v1/render': return self.reply(404, {'error': 'not found'})
        if not rate_ok(self.client_address[0]): return self.reply(429, {'status': 'refused', 'reason': 'too many requests'})
        try:
            n = int(self.headers.get('Content-Length', '0'))
            if n > 4096: raise ValueError
            body = json.loads(self.rfile.read(n))
            tab_id, sha = str(body['tabId']), str(body['sha256'])
        except Exception:
            return self.reply(400, {'status': 'refused', 'reason': 'expected {"tabId", "sha256"}'})
        if not TAB_ID.match(tab_id) or not SHA.match(sha) or tab_id.startswith(('local', 'upload')):
            return self.reply(400, {'status': 'refused', 'reason': 'only catalogue tabs can be rendered'})
        self.reply(*request_render(tab_id, sha))

    def do_HEAD(self):
        self.do_GET(head=True)

    def do_GET(self, head=False):
        if disabled(): return self.reply(503, {'status': 'disabled'})
        if self.path == '/v1/health':
            return self.reply(200, {'ok': True, 'queued': q("select count(*) from jobs where status = 'queued'")[0][0],
                                    'today': renders_today(), 'daily_cap': DAILY, 'cpu_c': thermal.temperature()})
        m = re.match(r'^/v1/scores/([0-9a-f]{64})/([^/?#]+)$', self.path.split('?')[0])
        if not m or not FILE.match(m.group(2)) or not isinstance(store, storage_mod.LocalStorage):
            return self.reply(404, {'error': 'not found'})
        path = store.path(m.group(1), m.group(2))
        if not os.path.isfile(path): return self.reply(404, {'error': 'not rendered'})
        size = os.path.getsize(path); start, end = 0, size - 1
        rng = re.match(r'bytes=(\d*)-(\d*)$', self.headers.get('Range', ''))
        if rng and (rng.group(1) or rng.group(2)):
            if rng.group(1): start = int(rng.group(1)); end = int(rng.group(2)) if rng.group(2) else end
            else: start = max(0, size - int(rng.group(2)))
            end = min(end, size - 1)
            if start > end: self.send_response(416); self.send_header('Content-Range', f'bytes */{size}'); self.cors(); self.end_headers(); return
            self.send_response(206); self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        else: self.send_response(200)
        name = m.group(2)
        self.cors(); self.send_header('Accept-Ranges', 'bytes'); self.send_header('Content-Length', str(end - start + 1))
        self.send_header('Content-Type', storage_mod.TYPES.get(os.path.splitext(name)[1], 'application/octet-stream'))
        self.send_header('Cache-Control', 'no-cache' if name == 'manifest.json' else 'public, max-age=31536000, immutable')
        self.end_headers()
        if head: return
        with open(path, 'rb') as f:
            f.seek(start); left = end - start + 1
            while left > 0:
                chunk = f.read(min(1 << 16, left))
                if not chunk: break
                try: self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError): return
                left -= len(chunk)

    def log_message(self, fmt, *args):
        if len(args) > 1 and str(args[1])[:1] in '23': return  # keep the journal small: errors only
        log(self.address_string(), fmt % args)


def main():
    threading.Thread(target=worker, daemon=True).start()
    host, port = E('HQ_HOST', '0.0.0.0'), int(E('HQ_PORT', '8790'))
    log(f'hqrender on {host}:{port}, storage {type(store).__name__}, daily cap {DAILY}, storage cap {CAP / 1e9:.0f} GB')
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == '__main__':
    main()
