# hq-render

Renders catalogue tabs to studio-quality audio for the app's HQ audio mode. Design, HTTP contract,
safety limits and deployment: [docs/hq-audio.md](../../docs/hq-audio.md).

- `render_score.mjs`: alphaTab renders of each track from the app's own MIDI.
- `hqrender/render.py`: the sound chain and mix; `python -m hqrender.render <tab file> <out dir>`.
- `hqrender/service.py`: queue, worker and HTTP API; `python -m hqrender.service`.
- `hqrender/storage.py`: local folder or S3-compatible storage.
- `assets/chain-v3.json`: the chain's settings. Amp captures and the drum kit are not in the
  repository (licences and size); `deploy/sync-assets.sh` copies them to a host.
- `tests/`: `python -m pytest services/hq-render/tests` (needs `requirements.txt`).
