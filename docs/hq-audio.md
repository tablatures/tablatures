# HQ audio (experimental)

Server-rendered audio for catalogue tabs, played in place of the in-browser synth. Off by default;
enable it in Settings → HQ Audio. Once a service is configured, the HQ button in the player bar
switches between HQ audio and the built-in sound mid-song (filled: HQ audio is playing; `HQ…`:
the tab is being rendered). The synth stays the fallback for everything HQ audio does not
cover: imported files, transposed or merged tracks, the metronome and count-in, YouTube sync, and
mute/solo combinations without a matching render.

## Pieces

Three parts that only meet at an HTTP contract, so each can move to other infrastructure alone:

| Part                                               | Where                                         | Replaceable by                                                   |
| -------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------- |
| Renderer (`services/hq-render/hqrender/render.py`) | a command: score file in, folder of audio out | any Linux/macOS machine or container                             |
| Storage (`hqrender/storage.py`)                    | local folder, or any S3-compatible bucket     | Cloudflare R2, S3, B2, MinIO via `HQ_STORAGE=s3`                 |
| Queue + API (`hqrender/service.py`)                | one Python process (proof of concept)         | e.g. a Cloudflare Worker with D1, implementing the same contract |

The app (`src/library/utils/hqAudio.ts`, `hqSession.ts`) knows one base URL
(`VITE_HQ_AUDIO_BASE_URL`, or the URL field in Settings) and this contract:

```
GET  <base>/v1/scores/<sha256 of the tab file>/manifest.json   404 until rendered
GET  <base>/v1/scores/<sha256>/<file>                           Range requests supported
POST <base>/v1/render  {"tabId": "...", "sha256": "..."}       202 queued | 200 done | 4xx/503 refused
```

Renders are keyed by the hash of the tab file, so a changed tab is a new render. Audio file names
carry the chain version (`mix-v3.m4a`) and are cached as immutable; a new chain writes new names.

## What a render contains

- `mix-<chain>.m4a`: every track that plays.
- `minus-<track>-<chain>.m4a`: everything except one track (practising along with your part).
- `manifest.json`: tracks, roles, file names, the score hash and the chain version.

The audio element follows the engine exactly like a YouTube video does (`videoSession.ts`): the
synth keeps the timeline and is silenced, loops and seeks move the audio, speed uses the browser's
pitch-preserving `playbackRate`.

The renderer uses the same alphaTab MIDI the app plays (`render_score.mjs`), so the cursor lines
up. Chain v3 (chosen against Songsterr's stems, see the research notes):

- Electric guitars: two humanised clean takes, hard left and right, each program section through a
  Neural Amp Modeler capture (heavy for programs 29/30, clean Magnatone with a treble shelf
  otherwise), 4x12 cab, fitted EQ, light reverb.
- Bass: alphaTab's bass with a fitted EQ. Drums: Big Rusty Drums (CC0) through sfizz, stereo
  narrowed to half, fitted EQ. Other instruments: alphaTab with light chorus and reverb.
- Bus levels relative to the drums, gentle glue compression, -14 LUFS.

Light or heavy guitar is decided from the program alone; it matches what Songsterr does on 78% of
sections (overdrive, program 29, is the coin flip).

## Safety limits

Cost cannot run away: storage is capped (`HQ_STORAGE_CAP_GB`), renders per day are capped
(`HQ_DAILY_RENDERS`), the queue is capped (`HQ_QUEUE_MAX`), render requests are rate limited per
address, and only catalogue tabs whose file matches the requested hash are rendered (the worker
downloads the file itself; nothing is uploaded). On a Raspberry Pi the service pauses above 70 °C
and resumes below 60 °C (`HQ_HOT_C`/`HQ_COOL_C`), also in the middle of a track, pauses while the Pi
reports under-voltage, and systemd caps it at two cores and 2 GB.
`touch ~/tabrender/DISABLED` stops all rendering and serving; the app falls back to the synth.

## Running it

```
services/hq-render/deploy/sync-assets.sh <ssh host> <dir with nam/ and sfz/>
ssh <host> tabrender/service/deploy/install.sh
```

A Raspberry Pi renders a song in tens of minutes. To fill the cache faster, render on another
machine and copy the result into the host's files directory; queued requests for it are then
answered without rendering:

```
python -m hqrender.render <tab file> out/<sha256>
rsync -a out/ <host>:tabrender/files/v1/scores/
```

Settings live in `~/tabrender/hq.env` on the host (`deploy/hq.env.example`). Local render without
the service: `python -m hqrender.render <tab file> <out dir>` with `HQ_ASSETS` and `HQ_SFIZZ` set.

An `https://` app cannot fetch from an `http://` service, so the published site needs the files
behind HTTPS (for example R2 with `HQ_STORAGE=s3`). On a LAN, use a local dev build of the app.

Asset licences: Neural Amp Modeler captures from the community collection are GPL-3 and stay on
the render host (only rendered audio is published); Big Rusty Drums is CC0; the soundfonts are the
app's own.
