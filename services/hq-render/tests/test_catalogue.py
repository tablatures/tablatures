"""Artist lookup used to pick the guitar style (no network: urlopen is replaced)."""
import io, json, os, sys, urllib.error

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from hqrender import catalogue


def fake(responses, seen):
    def urlopen(req, timeout=None):
        seen.append(req.full_url); r = responses.pop(0)
        if isinstance(r, Exception): raise r
        return io.BytesIO(json.dumps(r).encode())
    return urlopen


def test_names_with_a_slash_stay_one_path_segment(monkeypatch):
    seen = []; monkeypatch.setattr(catalogue, '_artists', {})
    monkeypatch.setattr(catalogue.urllib.request, 'urlopen', fake([{'genre': 'rock', 'tags': ['hard rock']}], seen))
    assert catalogue.artist_info('AC/DC') == {'genre': 'rock', 'tags': ['hard rock']}
    assert seen[0].endswith('/artist/AC%2FDC')


def test_a_failed_lookup_is_retried_and_not_remembered(monkeypatch):
    seen = []; monkeypatch.setattr(catalogue, '_artists', {}); monkeypatch.setattr(catalogue.time, 'sleep', lambda s: None)
    monkeypatch.setattr(catalogue.urllib.request, 'urlopen', fake([OSError('reset'), OSError('reset'), OSError('reset'), {'tags': ['southern rock']}], seen))
    assert catalogue.artist_info('Lynyrd Skynyrd') == {}
    assert catalogue.artist_info('Lynyrd Skynyrd') == {'genre': None, 'tags': ['southern rock']}
    assert len(seen) == 4


def test_an_unknown_artist_is_remembered(monkeypatch):
    seen = []; monkeypatch.setattr(catalogue, '_artists', {})
    monkeypatch.setattr(catalogue.urllib.request, 'urlopen', fake([urllib.error.HTTPError('u', 404, 'nf', {}, None)], seen))
    assert catalogue.artist_info('Nobody') == {} and catalogue.artist_info('Nobody') == {}
    assert len(seen) == 1
