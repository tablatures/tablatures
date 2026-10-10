# Note-level practice loops

Feature branch: `codex/note-level-loops`.

![Partial-bar note loop](note-level-loops.png)

Choose **Notes** under **Loop snap** beside the desktop repeat button, or under
**Loop snapping** in player settings on a phone. Bars remains the default.

- Drag across notes on the score to include the first onset through the end of
  the last selected note or rest. Reverse selection works too.
- Double-click a note or rest to loop that position. Chords are one event.
  A normal click seeks and clears the previous loop.
- Score selections play the highlighted notes in **printed order**. Repeat signs,
  alternate-ending skips, and score jumps do not pull unselected passages into
  a practice loop. Selecting the first ending into the second plays those two
  selected passages directly, then returns to the start marker.
- Resize either edge on the score or timeline. Move the region with its grip
  or the timeline selection. Moves snap the start and retain the musical
  duration; the ending can fall inside a longer note at the new location.
- Switch back to Bars to expand the selection to full printed bars.
- Disable or clear a score loop to restore the song's normal repeat order.
  Editing a disabled practice marker keeps it disabled until explicitly enabled.
- Hold on the timeline, then drag, to select note/rest positions. The timeline
  follows the active playback order: normal song repeat visits outside practice,
  printed order while a score practice loop is enabled.

![First-to-second-ending practice loop: only the selected printed notes are highlighted](note-level-loops-repeat.png)

## Edge-case score

Import `tests/fixtures/player/note-loop-edge-cases.gp`. Its editable source is
`note-loop-edge-cases.tex` beside it. Regenerate the GP file with
`node tests/fixtures/player/generate-note-loop-score.mjs`. The second track,
Rhythm, uses longer chords to exercise track changes with different note grids.

1. Bar 1: eighth notes, an eighth rest, a chord, and a quarter note.
2. Bar 2: opening of the repeated section; mixed notes and a quarter rest.
3. Bar 3: tempo 90, eighth-note triplets, and a sustained half note.
4. Bar 4: first ending; a half note tied into a quarter, then a rest.
5. Bar 5: second ending and tempo 150.
6. Bar 6: switch to 3/4, including a quarter rest.
7. Bar 7: return to 4/4 and a whole note at the end of the score.

Normal playback visits (one-based bars): **1, 2, 3, 4, 2, 3, 5, 6, 7**.
Practice visits: **1, 2, 3, 4, 5, 6, 7**, with native playback restricted to
selected notes. Selecting bar 4's first note through bar 5's first eighth note
creates `[11520, 15840)` on the practice clock, without repeating bars 2–3.

## Storage and playback

New score selections use `?loop=w.<startTick>.<endTick>[.off]`, whose ticks refer
to printed order. Existing `?loop=1.2[.off]` bar links and
`?loop=n.<startTick>.<endTick>[.off]` performance links retain their behavior.
Tick ranges are validated once score timing loads.

A persistent practice controller regenerates native MIDI once when entering or
leaving printed-order practice. Repeat and direction metadata are suppressed
only during synchronous generation and restored immediately, including on
errors. The notation and exported score keep their original repeat signs.
Native synthesizer looping handles every subsequent wrap and note transition;
there are no timer-driven audio seeks between selected bars. Editing loop bounds
does not regenerate MIDI. Playing transport resumes after an order change.

The score, timeline, native range, shared state, and saved link use the same
active clock. Practice continues in the mini player and through track changes.
The timeline's duration changes with the active playback order. Video positions
map back to the original performance clock, seeking across omitted repeat
passages and applying playback speed and media offset. Timed lyrics and the
video tap-to-sync controls also use the original recording clock.

Boundaries clip sustained notes at the end of the loop. Seeking into a tied
continuation relies on alphaTab's MIDI seek behavior; practice does not insert
note attacks. Video transitions and very short loops remain subject to the
video provider's seek latency.

## Verification

- `pnpm exec vitest run`
- `pnpm exec playwright test tests/note-loop.spec.ts tests/loop.spec.ts tests/loop-editing.spec.ts tests/loop-repeat.spec.ts tests/player-correctness.spec.ts tests/lyrics.spec.ts --workers=1`
- `pnpm check`
- `pnpm build:app`

Browser tests import the generated GP file through the catalog loading path and
exercise real score and timeline gestures, marker placement, native playback
visits and wraps, disabled markers, reloads, legacy links, track changes, phone
controls, and mini playback. Unit tests use native MIDI generation to verify
practice order, restoration of repeats and score jumps, tempo timing, disposal,
and video position mapping at 0.5×, 1×, 1.5×, and 2×.

Validation: 328 unit tests and 87 browser scenarios passed across grouped runs.
Three geometry-settling timeouts in the parallel run passed when run serially.
The application check reports zero errors and 16 existing warnings. The
production application build succeeds.
