"""Download a catalogue tab and check it is the file a render was requested for."""
import hashlib, json, os, time, urllib.error, urllib.parse, urllib.request

CATALOGUE = os.environ.get('HQ_CATALOGUE_URL', 'https://api.tablatures.org/api/download/{id}')
USER_AGENT = 'tablatures-hq-render/1 (+https://tablatures.github.io/tablatures)'
MAX_SCORE = 20 * 2 ** 20


def fetch_score(tab_id, sha, path):
    req = urllib.request.Request(CATALOGUE.format(id=urllib.parse.quote(tab_id, safe=':')), headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read(MAX_SCORE + 1)
    if len(data) > MAX_SCORE: raise ValueError('score too large')
    if hashlib.sha256(data).hexdigest() != sha: raise ValueError('catalogue file does not match the requested hash')
    with open(path, 'wb') as f: f.write(data)


ARTIST_INFO = os.environ.get('HQ_ARTIST_INFO_URL', 'https://api.tablatures.org/api/metadata/artist/{name}')
_artists = {}


def artist_info(name, tries=3):
    """{'genre', 'tags'} for an artist from the catalogue; {} when unknown or unreachable. Only answers
    are cached: a failed request is retried (1 s, then 3 s) and asked again on the next render."""
    if not name: return {}
    if name not in _artists:
        url = ARTIST_INFO.format(name=urllib.parse.quote(name, safe=''))  # 'AC/DC' must stay one path segment
        for k in range(tries):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': USER_AGENT}), timeout=20) as r: d = json.load(r)
                _artists[name] = {'genre': d.get('genre'), 'tags': d.get('tags') or []}; break
            except urllib.error.HTTPError as e:
                if e.code == 404: _artists[name] = {}; break
            except Exception:
                pass
            if k + 1 < tries: time.sleep((1, 3)[min(k, 1)])
    return _artists.get(name, {})
