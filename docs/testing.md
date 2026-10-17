# Reliable regression testing

The goal is strong coverage of player behavior with fast, diagnosable failures.
A passing retry is evidence of an intermittent failure, not proof that the application is correct.

## Development loop

| Change                                 | Start here                                                                                    | Browser follow-up                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Transport commands, countdown, seeks   | `pnpm test:player`                                                                            | `tests/core-playback.spec.ts`, `tests/player-correctness.spec.ts`, `tests/loop.spec.ts`            |
| Musical position, tempo, repeat ranges | `pnpm test:unit src/library/utils/playerTiming.test.ts`                                       | `tests/loop-repeat.spec.ts`, `tests/player-correctness.spec.ts`                                    |
| Cursor and scrolling                   | `pnpm test:unit src/library/utils/playerCursor.test.ts src/library/utils/scoreScroll.test.ts` | `tests/cursor-follow.spec.ts`, relevant mobile/scroll specs                                        |
| Player settings and lifecycle          | Relevant store/subscription unit specs                                                        | `tests/settings-desync.spec.ts`, `tests/score-switching.spec.ts`, `tests/catalogue-player.spec.ts` |
| Test readiness or shared setup         | `tests/harness.spec.ts`                                                                       | All callers of the changed helper; full E2E before integration                                     |
| Layout/hydration                       | `pnpm test:layout`                                                                            | Keep production-build coverage; dev-mode tests cannot replace it                                   |

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
The initial score helper also waits for our controller to accept a position from
the current load generation and checks native playback readiness. An old positive
duration and the engine's optimistic ready flag cannot establish that the new
score reached the UI. `seekToPercent`
subscribes to native position events before clicking; `waitForSeekSettled` waits
for a matching worker acknowledgement as well as displayed progress. alphaTab's
time getter is also optimistic, so checking it alone cannot prove completion.
Keep post-acknowledgement stability assertions in the affected regression. Playwright
`waitForFunction` options are the **third** argument (`undefined` if no argument
is passed to the browser predicate).

Fixed observation windows may be necessary to prove that a paused position stays
still or to generate a real long-press gesture. Explain the time requirement;
do not use such windows to guess when asynchronous setup has finished. A sampler
that must observe an event (a score appearing, a scroll target) runs until it has
seen it plus its required window, with a generous cap, rather than for a fixed
duration that slow CI can outlast.

Click elements that animate in (the mini bar after navigation) with a locator so
Playwright waits for a stable hit target; coordinates sampled from a bounding box
mid-transition can land on nothing.

`window.__testApi` belongs to the mounted full player. After navigating away it
reports frozen view state, so assert session behavior through the mini bar or
return to `/play` first.

Missing controls and missing score bounds should fail with a useful assertion,
not silently skip a regression. Use skips only for explicitly unsupported
platform capabilities with a documented reason. No automatic retries are enabled.

This policy does not claim complete player coverage or a measured coverage
percentage. Expand deterministic cases with each fixed defect; preserve browser
checks for boundaries that pure logic tests cannot exercise.

## Browser-free application player

`pnpm test:player` exercises our transport, practice playback, video session and
musical policies in Node. `createPlayerTransport` is the production controller,
not a second implementation for tests. One instance (`sessionTransport()`) serves
the persistent engine for the whole session: the layout drives its load
lifecycle from the moment the engine is created, and the full player,
mini-player, resume button, lyrics, shared-link restore and video session all
command the engine through it. Views attach with `observe()` and detach when
unmounted; the session's fencing does not depend on `/play` being mounted. Its engine and media
ports let tests record commands, deliver synchronous stale callbacks, replace a
score, and advance application timers deterministically. No browser, audio device
or wall-clock sleeps are needed.

The transport's policy is a pure state machine (`transportMachine.ts`):
`transition(model, event, current)` returns the next model and the effects to
run, and `createPlayerTransport` commits the model before running them, because
engine callbacks may re-enter synchronously. The model is a discriminated union,
so a pending seek, a fenced load and a delayed start each carry the engine and
score they belong to, and combinations such as "ready while loading" or "a
countdown with no time left" cannot be represented. `transportMachine.test.ts`
explores every four-step sequence of commands, callbacks, score and engine
replacements, and checks the invariants after each step: disposal is inert, only
the current session's callbacks are accepted, the engine is never written while
loading or for another owner, and a replaced score's countdown never starts
playback. Add an invariant there when a fix concerns which events may apply in
which state; keep scenario tests in `playerTransport.test.ts`.

The player's loop selection is a `LoopSelection` union (`loopSelection.ts`):
no loop, one A/B marker, printed bars, or a precise range valid on its clock.
Every variant carries every field read-only, so TabViewer reads `loop.startBar`
directly but must build a whole selection to change one; bar edits in written
order resolve to written ticks in the same step, rather than in a later reactive
repair. `loopSelection.test.ts` owns these rules and explores every four-step
sequence of selection edits. Browser specs keep gesture-to-selection wiring.

A gesture on the progress bar is a `ProgressGesture` state machine
(`progressGesture.ts`): idle, pressing (the hold timer is armed only here),
scrubbing, sizing a loop from a hold, or handed off to a loop edge/body drag or
the bottom sheet, after which the bar ignores the rest of the touch.
`progressGesture.test.ts` owns these transitions and the timeline loop
hit-test; its exploration checks that the timer runs exactly while pressing and
the loop drag lasts exactly as long as loop sizing. `note-loop.spec.ts` keeps
the touch wiring, including an edge wobble that must not move the playhead.

`stateMachines.property.test.ts` adds random sequences of up to 40 events
(fast-check) to those four-step explorations. It covers the transport, the loop
selection, both bar gestures, the score load (including its timeout, under fake
timers) and the soundfont, and checks each machine's invariants after every
event. A failure prints a seed and a shrunk counterexample. Reproduce it with
that seed and path before changing anything. Once it is fixed, keep the
counterexample as an example test next to the machine. Treat a failure as a
defect, never as a flake.

The transport suite owns delayed play cancellation/pause/resume, idempotent play,
seek acknowledgements and video forwarding, next/previous navigation through repeated
bar visits and tempo changes, and region versus whole-song repeat policy. Real
parsing/MIDI generation supplies fixture clocks; alphaTab synthesis is not under
test. Musical expectations are explicit constants from the fixture.

Seeks stay pending until a native position event marks a seek and matches the
latest requested position; elapsed time and optimistic engine getters cannot
settle them. Percentage seeks are resolved by `seekPercent()` against the current musical
clock and playback speed, rather than the last displayed duration. Speed changes
can be acknowledged before a new position report reaches the views. Both views
also use that clock for optimistic seek progress. The settings integration test
holds native position delivery across the speed change and seek, then releases
the real worker events in order; no sleeps or relaxed target assertions are used.

The application rejects earlier seek acknowledgements and scopes
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

`playerSession.test.ts` owns the layout wiring: a mini-player seek keeps earlier
positions out of the shared store, and positions from a replaced score or MIDI
never reach it. `share-mini-player.spec.ts` checks only that the mini bar gesture
reaches the session and the full player reopens at the acknowledged position.
The persistent video session uses the same transport. When the video is the
clock source, its drift correction calls `followMedia()`: acknowledged and fenced
like any seek, but not sent back to the video. It reacts only to accepted
positions, and video play/pause go through `playNow()`/`pause()`.
`videoSession.test.ts` owns these rules; `video-sync.spec.ts` proves in the browser
that the engine jumps to the video's clock faster than playback alone could.

Keep the existing browser regressions for native acknowledgements, actual
playback, gestures, rendering and navigation. No browser scenarios were removed
for this change. When adding a control policy, put it in the shared controller
and exercise its commands here before adding browser coverage for a new
integration boundary.
