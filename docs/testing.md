# Reliable regression testing

The goal is strong coverage of player behavior with fast, diagnosable failures.
A passing retry is evidence of an intermittent failure, not proof that the application is correct.

## Development loop

| Change                                 | Start here                                              | Browser follow-up                                                                                  |
| -------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Transport commands, countdown, seeks   | `pnpm test:player`                                      | `tests/core-playback.spec.ts`, `tests/player-correctness.spec.ts`, `tests/loop.spec.ts`            |
| Musical position, tempo, repeat ranges | `pnpm test:unit src/library/utils/playerTiming.test.ts` | `tests/loop-repeat.spec.ts`, `tests/player-correctness.spec.ts`                                    |
| Cursor and scrolling                   | `pnpm test:unit src/library/utils/playerCursor.test.ts` | `tests/cursor-follow.spec.ts`, relevant mobile/scroll specs                                        |
| Player settings and lifecycle          | Relevant store/subscription unit specs                  | `tests/settings-desync.spec.ts`, `tests/score-switching.spec.ts`, `tests/catalogue-player.spec.ts` |
| Test readiness or shared setup         | `tests/harness.spec.ts`                                 | All callers of the changed helper; full E2E before integration                                     |
| Layout/hydration                       | `pnpm test:layout`                                      | Keep production-build coverage; dev-mode tests cannot replace it                                   |

```sh
pnpm test:unit
pnpm test:player # Browser-free application player regressions
pnpm test:e2e tests/loop-repeat.spec.ts tests/settings-desync.spec.ts
# Only when investigating or validating reliability:
pnpm test:stability tests/harness.spec.ts tests/settings-desync.spec.ts
# Once at integration (also run by CI):
pnpm check
pnpm test:unit
pnpm test:layout
pnpm test:e2e
```

The E2E launcher chooses an available port, starts its own dev server and prints
its report path. `PLAYWRIGHT_PORT=5297 pnpm test:e2e ...` selects a specific port.
An occupied explicit port fails rather than attaching to an unknown server.
Direct `pnpm exec playwright test` uses port 5177. Browser runs default to two
workers to leave headroom for real audio and rendering. Use `--workers=1` to
investigate contention, not to conceal a reproducible concurrency bug.

Reusing an explicit port replaces that port’s earlier report, so copy any needed
artifacts first. Ports and reports are separate for concurrent runs; source files, `.svelte-kit`, vendor output and production builds in one
checkout are still shared. Separate
worktrees are needed for independent edits/builds. Run builds and `pnpm check` (which runs `svelte-kit sync`) sequentially with
browser runs in one checkout; all rewrite or consume shared generated output. The production layout suite still uses port 5188.

## Failure triage

1. Read the failed assertion and its trace, screenshot and error context under
   the printed `test-results/e2e-<port>/` directory. Open the HTML report with
   `pnpm exec playwright show-report playwright-report/e2e-<port>`.
2. Run the exact failing spec/test with zero retries. Check whether setup reached
   the correct score, playback readiness and rendered layout before the action.
3. Classify using evidence: setup/environment failure, stale test contract, race
   in the test, or application defect. Preserve the first failure evidence;
   automatically selected ports give subsequent invocations separate directories.
4. Repair the cause. Repeat the affected spec five times without retries after
   a race fix. A clean sample is useful evidence, not a guarantee of zero flakes.

Do not repeatedly run the entire suite to chase one failure. Do not change
unrelated product behavior just to make a stale selector pass. Report unresolved
failures with the command and artifact path rather than describing them as flakes
without evidence. CI retains failure artifacts for seven days.

## Coverage that earns its cost

Use real alphaTab parsing and MIDI generation in unit tests for musical
invariants. `playerTiming.test.ts` covers exact tick ranges across no repeats,
simple repeats, alternate endings and multiple repeats, including boundary and
invalid ranges and four playback speeds. Expected constants must come from the
fixture's musical structure, not from recomputing the production algorithm.

Give each expensive regression a clear owner. `core-playback.spec.ts` owns the
playback time display; `loop.spec.ts` owns gesture-to-engine wiring and
`player-correctness.spec.ts` owns repeated audio wraps. The PiP hide/restore
contract lives in `release-polish.spec.ts`; `share-mini-player.spec.ts` retains
sharing, preview geometry and quitting. Add assertions to the owning scenario
when they share setup and behavior. Preserve separate scenarios for different
engines, viewports and lifecycle transitions.

Browser tests verify the integration: native audio receives the loop range,
playback advances/wraps, controls work, navigation preserves state, and gestures
and rendered positions agree. Keep real audio for those tests. A fake clock is
appropriate for isolated application timers, but it cannot drive an AudioContext.

Use awaited UI assertions or observable lifecycle events rather than sleeping
for readiness. The alphaTeX helper subscribes before loading and waits for the
new score, player readiness and layout, including identical-duration reloads.
The initial score helper also checks native playback readiness. `seekToPercent`
subscribes to native position events before clicking; `waitForSeekSettled` waits
for a matching worker acknowledgement as well as displayed progress. alphaTab's
time getter is also optimistic, so checking it alone cannot prove completion.
Keep post-acknowledgement stability assertions in the affected regression. Playwright
`waitForFunction` options are the **third** argument (`undefined` if no argument
is passed to the browser predicate).

Fixed observation windows may be necessary to prove that a paused position stays
still or to generate a real long-press gesture. Explain the time requirement;
do not use such windows to guess when asynchronous setup has finished.

Missing controls and missing score bounds should fail with a useful assertion,
not silently skip a regression. Use skips only for explicitly unsupported
platform capabilities with a documented reason. No automatic retries are enabled.

This policy does not claim complete player coverage or a measured coverage
percentage. Expand deterministic cases with each fixed defect; preserve browser
checks for boundaries that pure logic tests cannot exercise.

## Browser-free application player

`pnpm test:player` exercises our transport, practice playback, video session and
musical policies in Node. `createPlayerTransport` is the production controller
used by `TabViewer`, not a second implementation for tests. Its engine and media
ports let tests record commands, deliver synchronous stale callbacks, replace a
score, and advance application timers deterministically. No browser, audio device
or wall-clock sleeps are needed.

The transport suite owns delayed play cancellation/pause/resume, idempotent play,
seek acknowledgements and video forwarding, next/previous navigation through repeated
bar visits and tempo changes, and region versus whole-song repeat policy. Real
parsing/MIDI generation supplies fixture clocks; alphaTab synthesis is not under
test. Musical expectations are explicit constants from the fixture.

Seeks stay pending until a native position event marks a seek and matches the
latest requested position; elapsed time and optimistic engine getters cannot
settle them. The application rejects earlier seek acknowledgements and scopes
position receivers to an engine, score and load generation. MIDI loads fence
old positions until all submitted loads report completion; seeks during loading
coalesce to the latest target. Session changes cancel pending countdowns and
seeks. Rejected position events cannot update the displayed bar or speed trainer.

The integration uses the host's `alphaTab.midiFileLoaded` event: subscribing to
`midiLoaded.on()` reads a recursive getter in alphaTab 1.8.1's worker proxy.
Readiness can be repeated and the first load has no prior playback to stop, so
neither is a one-per-load completion signal. This narrow adapter leaves alphaTab
unchanged. Worker messages are ordered; the application does not invent request
identifiers absent from that protocol or promise correctness for arbitrary
reordering of the engine's raw event stream.

Keep the existing browser regressions for native acknowledgements, actual
playback, gestures, rendering and navigation. No browser scenarios were removed
for this change. When adding a control policy, put it in the shared controller
and exercise its commands here before adding browser coverage for a new
integration boundary.
