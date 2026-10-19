"""Request validation and the safety limits of the render service (no rendering involved)."""
import importlib, json, os, sys, threading, time, urllib.request
from http.server import ThreadingHTTPServer

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHA = 'a' * 64


@pytest.fixture()
def server(tmp_path, monkeypatch):
    monkeypatch.setenv('HQ_STATE_DIR', str(tmp_path / 'state'))
    monkeypatch.setenv('HQ_STORAGE_DIR', str(tmp_path / 'files'))
    monkeypatch.setenv('HQ_DISABLED_FILE', str(tmp_path / 'DISABLED'))
    monkeypatch.setenv('HQ_QUEUE_MAX', '2')
    monkeypatch.setenv('HQ_REQ_PER_MIN', '100')
    import hqrender.service as service
    service = importlib.reload(service)
    httpd = ThreadingHTTPServer(('127.0.0.1', 0), service.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield service, f'http://127.0.0.1:{httpd.server_port}', tmp_path
    httpd.shutdown()


def call(url, body=None):
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), method='GET' if body is None else 'POST')
    try:
        with urllib.request.urlopen(req) as r: return r.status, r.headers, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()


def test_queues_catalogue_tabs_once(server):
    _, base, _ = server
    assert json.loads(call(f'{base}/v1/render', {'tabId': 'songsterr:1', 'sha256': SHA})[2])['status'] == 'queued'
    assert json.loads(call(f'{base}/v1/render', {'tabId': 'songsterr:1', 'sha256': SHA})[2])['status'] == 'queued'
    assert json.loads(call(f'{base}/v1/health')[2])['queued'] == 1


@pytest.mark.parametrize('body', [{'tabId': 'upload-1', 'sha256': SHA}, {'tabId': 'a/b', 'sha256': SHA},
                                  {'tabId': 'songsterr:1', 'sha256': 'x'}, {'nope': 1}])
def test_refuses_anything_but_catalogue_tabs(server, body):
    _, base, _ = server
    assert call(f'{base}/v1/render', body)[0] == 400


def test_queue_cap(server):
    _, base, _ = server
    for i in range(2): call(f'{base}/v1/render', {'tabId': f'songsterr:{i}', 'sha256': f'{i}' * 64})
    status, _, body = call(f'{base}/v1/render', {'tabId': 'songsterr:9', 'sha256': '9' * 64})
    assert status == 503 and json.loads(body)['reason'] == 'queue full'


def test_kill_switch_stops_everything(server):
    _, base, tmp = server
    (tmp / 'DISABLED').touch()
    assert call(f'{base}/v1/health')[0] == 503
    assert call(f'{base}/v1/render', {'tabId': 'songsterr:1', 'sha256': SHA})[0] == 503


def test_serves_published_files_with_ranges(server):
    service, base, tmp = server
    src = tmp / 'render'; src.mkdir()
    (src / 'manifest.json').write_text('{}'); (src / 'mix-v3.m4a').write_bytes(bytes(range(100)))
    service.store.publish(SHA, str(src))
    assert call(f'{base}/v1/scores/{SHA}/manifest.json')[0] == 200
    req = urllib.request.Request(f'{base}/v1/scores/{SHA}/mix-v3.m4a', headers={'Range': 'bytes=10-19'})
    with urllib.request.urlopen(req) as r:
        assert r.status == 206 and r.read() == bytes(range(10, 20)) and r.headers['Content-Range'] == 'bytes 10-19/100'
    assert call(f'{base}/v1/scores/{SHA}/../../etc')[0] == 404
    assert json.loads(call(f'{base}/v1/render', {'tabId': 'songsterr:1', 'sha256': SHA})[2])['status'] == 'done'


def test_cors_allows_matching_origins_only(tmp_path, monkeypatch):
    monkeypatch.setenv('HQ_STATE_DIR', str(tmp_path / 'state')); monkeypatch.setenv('HQ_STORAGE_DIR', str(tmp_path / 'files'))
    monkeypatch.setenv('HQ_ALLOWED_ORIGINS', 'https://tablatures-git-*-tablatures.vercel.app')
    import hqrender.service as service
    service = importlib.reload(service)
    httpd = ThreadingHTTPServer(('127.0.0.1', 0), service.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        for origin, allowed in [('https://tablatures-git-hq-audio-poc-tablatures.vercel.app', True), ('https://evil.example', False)]:
            req = urllib.request.Request(f'http://127.0.0.1:{httpd.server_port}/v1/health', headers={'Origin': origin})
            with urllib.request.urlopen(req) as r:
                assert (r.headers.get('Access-Control-Allow-Origin') == origin) is allowed
    finally:
        httpd.shutdown()


def helper_server(tmp_path, monkeypatch, token='secret'):
    monkeypatch.setenv('HQ_STATE_DIR', str(tmp_path / 'state')); monkeypatch.setenv('HQ_STORAGE_DIR', str(tmp_path / 'files'))
    monkeypatch.setenv('HQ_DISABLED_FILE', str(tmp_path / 'DISABLED')); monkeypatch.setenv('HQ_WORKER_TOKEN', token)
    import hqrender.service as service
    service = importlib.reload(service)
    httpd = ThreadingHTTPServer(('127.0.0.1', 0), service.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return service, httpd, f'http://127.0.0.1:{httpd.server_port}'


def authed(url, method, data=b'{}', token='secret'):
    req = urllib.request.Request(url, data=data, method=method, headers={'Authorization': f'Bearer {token}'})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')


def test_helper_claims_uploads_and_publishes(tmp_path, monkeypatch):
    service, httpd, base = helper_server(tmp_path, monkeypatch)
    try:
        call(f'{base}/v1/render', {'tabId': 'songsterr:1', 'sha256': SHA})
        assert authed(f'{base}/v1/jobs/claim', 'POST', token='wrong')[0] == 404
        status, job = authed(f'{base}/v1/jobs/claim', 'POST')
        assert job == {'sha256': SHA, 'tabId': 'songsterr:1'}
        assert authed(f'{base}/v1/jobs/claim', 'POST')[1] == {'idle': True}
        manifest = {'format': 1, 'score_sha256': SHA, 'mix': 'mix-v3.m4a', 'tracks': [{'minus': 'minus-0-v3.m4a'}]}
        # incomplete upload is rejected and the job fails
        assert authed(f'{base}/v1/jobs/{SHA}/files/manifest.json', 'PUT', json.dumps(manifest).encode())[0] == 200
        assert authed(f'{base}/v1/jobs/{SHA}/done', 'POST')[0] == 422
        assert not service.store.has(SHA)
        # a later request may retry after RETRY_AFTER; force it now
        service.q("update jobs set status = 'queued' where sha = ?", SHA)
        authed(f'{base}/v1/jobs/claim', 'POST')
        for name, body in [('mix-v3.m4a', b'm'), ('minus-0-v3.m4a', b'x'), ('manifest.json', json.dumps(manifest).encode())]:
            assert authed(f'{base}/v1/jobs/{SHA}/files/{name}', 'PUT', body)[0] == 200
        assert authed(f'{base}/v1/jobs/{SHA}/done', 'POST')[0] == 200
        assert service.store.has(SHA)
        assert json.loads(call(f'{base}/v1/render', {'tabId': 'songsterr:1', 'sha256': SHA})[2])['status'] == 'done'
    finally:
        httpd.shutdown()


def test_helper_endpoints_off_without_token(tmp_path, monkeypatch):
    service, httpd, base = helper_server(tmp_path, monkeypatch, token='')
    try:
        assert authed(f'{base}/v1/jobs/claim', 'POST', token='')[0] == 404
    finally:
        httpd.shutdown()


def test_local_worker_yields_while_a_helper_polls(tmp_path, monkeypatch):
    service, httpd, base = helper_server(tmp_path, monkeypatch)
    try:
        authed(f'{base}/v1/jobs/claim', 'POST')
        assert time.time() - service.last_helper_poll < service.HELPER_FRESH
    finally:
        httpd.shutdown()


def test_status_reports_queue_position_and_helper_progress(tmp_path, monkeypatch):
    service, httpd, base = helper_server(tmp_path, monkeypatch)
    try:
        other = 'b' * 64
        status = lambda sha: json.loads(call(f'{base}/v1/scores/{sha}/status')[2])
        assert status(SHA) == {'status': 'none'}
        call(f'{base}/v1/render', {'tabId': 'songsterr:1', 'sha256': SHA})
        call(f'{base}/v1/render', {'tabId': 'songsterr:2', 'sha256': other})
        assert status(other) == {'status': 'queued', 'position': 2, 'progress': 0}
        authed(f'{base}/v1/jobs/claim', 'POST')
        assert authed(f'{base}/v1/jobs/{SHA}/progress', 'POST', json.dumps({'phase': 'amps', 'progress': 0.4}).encode())[0] == 200
        assert status(SHA) == {'status': 'rendering', 'phase': 'amps', 'progress': 0.4}
        assert status(other)['position'] == 2
    finally:
        httpd.shutdown()
