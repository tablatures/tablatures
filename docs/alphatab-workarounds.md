# alphaTab workarounds

We keep as few workarounds for alphaTab's own behaviour as we can, and each
one is fenced so that an upgrade cannot break it silently:

- `src/library/utils/alphaTabWorkarounds.ts` lists every workaround with the
  alphaTab versions it targets. Outside those versions it is not applied.
- `src/library/utils/alphaTabWorkarounds.test.ts` is a canary per workaround.
  It inspects the installed alphaTab and fails when a targeted version and the
  presence of its bug disagree. The failure message says what to do: remove the
  workaround when alphaTab fixed the bug, or extend its versions when an
  upgrade still has it.
- `tests/player-performance.spec.ts` holds the measured effect (layouts and
  MIDI generations per open, playback positions per second), so dropping a
  workaround shows up as a budget failure rather than as a slow app.

Prefer the public API. A change that only uses documented methods and events
is not a workaround and does not belong here.

## Upgrading alphaTab

1. Bump `@coderline/alphatab` and run `pnpm test:unit`.
2. For each failing canary, follow its message. Re-measure with
   `pnpm test:e2e tests/player-performance.spec.ts` before deleting code.
3. Check the upstream status below; close the entry once a release fixes it.

## Duplicate MIDI generation on load

- **Targets:** alphaTab 1.8.x (`duplicateScoreMidi`).
- **Symptom:** every newly loaded score generates its MIDI twice in a row. On a
  dense score each pass blocks the main thread for ~100 ms (more on a slow
  phone).
- **Cause:** `AlphaTabApiBase._onScoreLoaded` calls `loadMidiForScore()` when a
  player exists, then `_internalRenderTracks` calls it again unconditionally,
  with nothing changed in between.
- **Workaround:** `generateScoreMidiOnce` (`src/library/utils/scoreMidi.ts`)
  drops a second generation for the same score during the synchronous load
  only, and only if no `updateSettings()` happened in between. Regenerations
  after the load (transposition, edits, practice order) always run.
- **Risk if alphaTab changes the order:** a stale MIDI could play. The canary
  checks the two calls are still back to back in the installed version.
- **Upstream issue draft:**

  > **Score MIDI is generated twice on every load**
  >
  > In 1.8.1, `renderScore`/`load` with a new score generates the MIDI twice:
  > `_onScoreLoaded` calls `loadMidiForScore()` (when `_setupOrDestroyPlayer()`
  > returns false), then `_internalRenderTracks` calls `loadMidiForScore()`
  > again right after. Nothing changes between the two calls, so the first
  > result is discarded. On a 9-track, 217-bar score each generation takes
  > ~85 ms in Firefox and ~230 ms on a 4x throttled CPU. Suggested fix: drop the
  > call in `_internalRenderTracks` when `_onScoreLoaded` already generated it.

## Per-quantum audio worklet reports

- **Targets:** alphaTab 1.8.x (`perQuantumWorkletReports`).
- **Symptom:** during playback, over a thousand main-thread messages a second
  whatever the page does. In Firefox this was ~27% of the content main thread
  on a fast Mac for a dense tab, enough to stutter on low-end devices.
- **Cause:** the worklet processor posts `samplesPlayed` from every
  `process()` call (128 frames, ~375/s at 48 kHz). The main thread relays it to
  the synth worker, which answers with a position event. Samples also flow
  worker → main → worklet.
- **Workaround:** the vendor plugin (`vite.config.ts`) copies alphaTab into
  `static/vendor` through `batchWorkletReports` (`scripts/vendor-alphatab.mjs`):
  the worklet reports every 512 frames (~11 ms), and the remainder as soon as
  its buffer runs dry. The synth advances by the reported count, so the clock
  stays exact. If the code no longer matches in a targeted version, the build
  fails instead of shipping the unbatched worklet.
- **Effect:** Firefox content main thread 27% → 18.6%, parent 8.1% → 4.2%,
  positions 374/s → 93/s (the benchmark fails above 100).
- **Upstream issue draft:**

  > **Audio worklet output relays every render quantum through the main thread**
  >
  > With `PlayerOutputMode.WebAudioAudioWorklets`, `AlphaSynthWebWorklet.process()`
  > posts `CmdOutputSamplesPlayed` for every 128-frame quantum. The main thread
  > forwards each to the synth worker, which posts a position back, and sample
  > buffers travel worker → main → worklet. That is >1000 main-thread messages a
  > second during playback; in a Firefox profile it was ~half of the main
  > thread's playback work and caused stutter on slower devices. Batching the
  > reports (e.g. every 512 frames, flushing when the buffer empties) cuts this
  > by 4x with an exact clock. Longer term, a `MessagePort` between the synth
  > worker and the worklet would keep audio off the main thread entirely.

## Behaviour we rely on without working around it

`tests/alphatab-contract.spec.ts` records these from the real engine and
replays each trace through the load machine (`scoreLoadMachine.ts`). Its title
names the installed version; re-run it on every upgrade.

- **A load reports `scoreLoaded`, then one layout (`renderStarted`,
  `renderFinished`, `postRenderFinished`), all for the new score.** A relayout
  requested just before a load completes before the new parse, so a previous
  score's `postRenderFinished` never follows it. A relayout never reports a
  parse; unreadable bytes report `error` and no parse.
- **`loadSoundFont` pauses playback before it is acknowledged, once.** The
  layout resumes playback that a soundfont switch paused.
- **SoundFont loads are acknowledged in order, without saying which.** A base
  loaded by URL downloads on the main thread before it reaches the synth, so a
  pack appended meanwhile is acknowledged first. The layout posts a base only
  once appended packs are acknowledged (`instrumentPacks.whenSettled`), holds
  pack posts until the base is acknowledged (`holdForBase`), and the soundfont
  state counts the bases posted.

- **`scoreLoaded` replays the current score to a new subscriber**
  (`EventEmitterOfT` with `fireOnRegister`). `TabViewer` and `LyricsBar` tell a
  replay from a real load; `LyricsBar` seeds itself when no replay happens, and
  `TabViewer`'s adoption already syncs from the player store.
- **A score laid out while its container is about to narrow is not always
  relaid out.** alphaTab's resize check can read the new width without a new
  layout, and its optimized resize can leave partials at the old width. We
  avoid the narrowing instead: `#page` keeps its scrollbar while loading.
- **The `html5` render engine cannot run in a worker**, so `useWorkers` only
  moves the synth off the main thread. Switching to the worker-capable `svg`
  engine is a separate trade-off (DOM size) that has not been measured.
