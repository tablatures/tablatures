"""Download a catalogue tab and check it is the file a render was requested for."""
import hashlib, os, urllib.parse, urllib.request

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
