# Integration Tests Design Spec

## Overview

End-to-end integration tests for the tablatures app using Playwright with route mocking. Tests cover the core user flows: searching, loading, playing tabs, timeline interaction, loop creation/management, and settings — with particular attention to timing/desync edge cases.

## Decisions

- **Test runner:** Playwright (already configured in the project)
- **API strategy:** Mock all backend calls via `page.route()` — no live API dependency
- **Fixture:** A small, public-domain Guitar Pro file (8+ bars, known tempo)
- **State inspection:** A `window.__testApi` bridge exposed from TabViewer in dev mode (new — the existing `loop-sync.spec.ts` references `__tabTest` which was never committed to the source; we use `__testApi` as the canonical name)
- **Waiting strategy:** Polling via `page.waitForFunction` — no fixed `waitForTimeout`
- **CI:** Local-only for now (`pnpm test:e2e`)

## File Structure

```
tests/
  fixtures/
    test-tab.gp5              # Small public-domain GP file (8+ bars)
  helpers/
    mock-api.ts               # Route interception for all API calls
    wait.ts                   # Polling helpers
    setup.ts                  # Common beforeEach: mock API + navigate + wait for load
  core-playback.spec.ts       # Tier 1: search, load, play/pause, seek, bar nav
  loop.spec.ts                # Tier 2: loop creation, enforcement, edge cases
  settings.spec.ts            # Tier 3: speed, volume, metronome, tracks, persistence
```

## Test Bridge (`__testApi`)

This bridge does not exist yet — it must be added to `TabViewer.svelte` inside `onMount`, gated by `import.meta.env.DEV`. The existing `tests/loop-sync.spec.ts` references `window.__tabTest` but that was never committed to the source. We adopt `__testApi` as the canonical name; the existing test should be migrated to use it.

Note: `speed`, `volume`, etc. are reactive locals destructured from the `playerSettings` prop (`let { volume, speed, ... } = playerSettings`). In Svelte 4 they remain as closured reactive variables, so the bridge getters will correctly capture their current values.

```typescript
if (import.meta.env.DEV) {
  (window as any).__testApi = {
    getProgress: () => progress,
    getDuration: () => duration,
    getLoopBounds: () =>
      loopStart !== null && loopEnd !== null
        ? { start: loopStart, end: loopEnd, enabled: loopEnabled }
        : null,
    isPlaying: () => playing,
    getCurrentBar: () => currentBar,
    getTotalBars: () => totalBars,
    getSpeed: () => speed,
    getVolume: () => volume,
    getBarPositions: () => {
      // For score drag tests — returns pixel coords of bars
      try {
        const lookup = api?.renderer?.boundsLookup;
        if (!lookup?.staffSystems) return [];
        const bars: Array<{ index: number; x: number; y: number; w: number; h: number }> = [];
        for (const sg of lookup.staffSystems) {
          if (!sg.bars) continue;
          for (const mbb of sg.bars) {
            const b = mbb.realBounds;
            if (b && b.w > 0) bars.push({ index: mbb.index, x: b.x, y: b.y, w: b.w, h: b.h });
          }
        }
        return bars;
      } catch { return []; }
    },
  };
}
```

This avoids brittle CSS scraping and makes assertions robust against style changes.

## Wait Helpers (`tests/helpers/wait.ts`)

```typescript
async function waitForScoreLoaded(page: Page, timeout = 30000): Promise<void>
// Polls window.__testApi.getDuration() > 0

async function waitForPlaying(page: Page, expected: boolean, timeout = 5000): Promise<void>
// Polls window.__testApi.isPlaying() === expected

async function waitForProgress(page: Page, predicate: (p: number) => boolean, timeout = 10000): Promise<void>
// Polls window.__testApi.getProgress() until predicate is satisfied
// predicate examples: p => p > 5, p => p > 20 && p < 50
```

All use `page.waitForFunction` with polling interval — zero `waitForTimeout` in the test suite.

## Mock API (`tests/helpers/mock-api.ts`)

Intercepts all backend routes:

| Route | Response |
|-------|----------|
| `GET /api/search?q=*` | Canned search results JSON with one result matching the fixture |
| `GET /api/search/live?q=*` | Same canned results (simulates live search) |
| `GET /api/download/:id` | Serves `tests/fixtures/test-tab.gp5` as `application/octet-stream` |
| `GET /api/health` | `200 { "status": "ok" }` |
| `GET /api/metadata/artist/*` | Minimal artist stub |
| `GET /api/metadata/artwork*` | Minimal artwork stub |
| `POST /api/metadata/artwork/batch` | Empty batch response `{ "results": {} }` |
| `GET /api/youtube/search*` | Empty results `{ "results": [] }` |

## Common Setup (`tests/helpers/setup.ts`)

A `setupTest` function used in `beforeEach`:

1. Call `setupMockApi(page)` to intercept all routes
2. Navigate to the appropriate page (`/search?q=test` or `/play?tab=test-tab`)
3. Call `waitForScoreLoaded(page)` when loading the player

For search-to-play flow tests, the setup only navigates to `/search?q=test` and the test drives the rest.

## Playwright Config Updates

```typescript
export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  retries: 1,
  expect: { timeout: 10000 },
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
```

**Required changes to `package.json`:** Add `"test:e2e": "playwright test"` to the `scripts` block. Also add `@playwright/test` to `devDependencies` if not already installed.

**Changes from existing `playwright.config.ts`:** The existing config has no `retries` or `expect` block. These are additions.

## Test Cases

### Tier 1 — Core Playback (`core-playback.spec.ts`)

#### 1. Search, select, and load a tab
- Navigate to `/search?q=test`
- Assert search results appear (mocked response)
- Click a result card
- Assert redirect to `/play`, score renders, `getDuration() > 0`
- Assert time display shows `00:00 / XX:XX`

#### 2. Play / Pause via Space key
- Press Space -> assert `isPlaying() === true`
- Wait until `getProgress() > 2%`
- Press Space -> assert `isPlaying() === false`
- Sample progress over 500ms -> assert it hasn't changed (within 0.5% tolerance)

#### 3. Play / Pause via button click
- Click the play/pause button (title contains "Play [Space]")
- Assert `isPlaying() === true`, progress advances
- Click again -> assert paused, progress stable

#### 4. Timeline seek (click)
- Click at ~50% on the progress bar element
- Assert `getProgress()` is near 50% (+-3%)
- Assert time display updated accordingly
- Assert `getCurrentBar()` is near the middle of the song

#### 5. Seek then resume
- Play, pause, seek to 30%, play again
- Assert progress advances from ~30%, not from the old position
- Sample progress 3 times over 1.5s, assert monotonically increasing from ~30%

#### 6. Bar navigation (Arrow keys)
- Record `getCurrentBar()` (call it `initialBar`)
- Press ArrowRight -> assert `getCurrentBar() === initialBar + 1`
- Press ArrowLeft -> assert `getCurrentBar() === initialBar`
- Seek to 0% to reach bar 0, then press ArrowLeft -> assert `getCurrentBar() === 0` (clamped)
- Seek to 100% to reach last bar, then press ArrowRight -> assert `getCurrentBar() === getTotalBars() - 1` (clamped)

#### 7. Progress bar / time display consistency
- Play for a few seconds, sample 5 data points
- For each: parse displayed time string, compute expected progress
- Assert `|displayedProgress - actualProgress| < 2%`

#### 8. Seek doesn't flicker (no snap-back)
- Seek to 50%
- Sample `getProgress()` 5 times over 200ms (using `waitForFunction` rapid polling)
- Assert no sample deviates more than 3% from 50% (catches `bindDuration` race)

### Tier 2 — Loop Interactions (`loop.spec.ts`)

#### 9. Create loop by dragging on progress bar
- Get progress bar bounding box
- `mouse.move` to 20% position, `mouse.down`, drag to 40%, `mouse.up`
- Assert `getLoopBounds()` returns `{ start, end }` where:
  - `start` is approximately `0.20 * duration` (+-5%)
  - `end` is approximately `0.40 * duration` (+-5%)
- Assert loop overlay element is visible in DOM

#### 10. Loop playback enforces boundaries
- Create loop at 60%-80% of duration
- Start playing, wait for progress to enter loop region
- Sample progress over 3 seconds
- Assert all samples fall within loop bounds (+-2%)
- Assert at least one "wrap" occurred (progress went from near end back to near start of loop)

#### 11. Create loop via A/B keyboard shortcuts
- Press `A` key -> sets loop start at current position
- Seek to a later position
- Press `B` key -> sets loop end
- Assert `getLoopBounds()` returns bounds with start < end
- Play and verify loop enforcement

#### 12. Create loop by dragging on sheet (score selection) — OPTIONAL
This test depends on alphaTab's internal `boundsLookup` API which is not type-stable. It may need adjustment if alphaTab is upgraded.
- Use `__testApi.getBarPositions()` to get pixel coordinates of bars
- If no positions available, skip test
- Mousedown on bar N, drag to bar N+3, mouseup
- Assert `getLoopBounds()` is set
- Assert loop overlay appears on both score and progress bar

#### 13. Clear loop (Escape key)
- Create a loop
- Press Escape
- Assert `getLoopBounds()` returns null
- Assert no loop overlay in DOM

#### 14. Loop toggle enable/disable (L key)
- Create a loop, verify `getLoopBounds().enabled === true`
- Press `L` -> assert `getLoopBounds().enabled === false` (bounds still present, just disabled)
- Press `L` -> assert `getLoopBounds().enabled === true`

#### 15. Seek outside loop fully removes it
- Create loop at 20%-40%
- Click progress bar at 60% (outside the loop)
- Assert `getLoopBounds()` returns null (this is a full clear via `clearLoopPoints()`, not a disable — distinct from `L` key toggle which only sets `enabled=false` while keeping bounds)

#### 16. Loop overlay matches actual playback position
- Create loop, play for several seconds
- Sample progress values (20+ samples)
- Get loop overlay position from DOM (left%, width%)
- Assert min/max of progress samples fall within overlay bounds (+-2%)

#### 17. Drag to create too-small loop auto-clears
- Mousedown, drag a distance that results in `|loopEnd - loopStart| < 500` (in ms — the threshold is time-based at 500ms, not pixel-based), mouseup
- Assert `getLoopBounds()` returns null

#### 18. Loop at song boundaries
- Create loop from ~0% to ~10% of duration, play -> assert it loops correctly
- Create loop from ~90% to ~100%, play -> assert no crash at end boundary

#### 19. Resize loop via edge drag
- Create loop at 30%-60%
- Mousedown on left edge (start), drag to 20%, mouseup
- Assert loop start moved to ~20%, end stayed at ~60%
- Mousedown on right edge (end), drag to 70%, mouseup
- Assert loop start stayed at ~20%, end moved to ~70%

#### 20. Move entire loop via drag
- Create loop at 20%-40%
- Mousedown inside the loop region, drag right by ~20% of bar width
- Assert loop shifted to ~40%-60%, maintaining same width

#### 21. Create loop, change speed, verify loop still works
- Create loop, set speed to 2x, play
- Assert progress stays within loop bounds (speed change shouldn't break loop enforcement)

### Tier 3 — Settings & Controls (`settings.spec.ts`)

#### 22. Change playback speed
- Open settings, set speed to 0.5x
- Play for 2 seconds, measure progress delta (d1)
- Pause, set speed to 2x
- Play for 2 seconds, measure progress delta (d2)
- Assert `d2 / d1` is roughly 4 (+-50% tolerance to account for alphaTab timing)

#### 23. Speed persists after seek
- Set speed to 0.5x, seek to 50%, play
- Assert `getSpeed() === 0.5`
- Assert progress advances at reduced rate

#### 24. Volume control
- Assert `getVolume() === 1` (default)
- Click volume icon to mute (toggle)
- Assert `getVolume() === 0`
- Click again to restore
- Assert `getVolume() === 1`

#### 25. Metronome toggle
- Open settings, verify metronome slider at 0
- Drag slider to non-zero value
- Play, pause -> verify metronome value persisted

#### 26. Track switching
- If fixture has multiple tracks: select a different track from dropdown
- Assert score re-renders (content changes)
- If single track: skip test

#### 27. Settings persist across reload
- Change speed to 0.75x
- Reload page (navigate to `/play?tab=test-tab` again)
- Wait for score loaded
- Assert `getSpeed() === 0.75`
- Note: TabViewer reads from localStorage key `tabviewer-settings` in `loadSettings()`, which overrides the initial `playerSettings` prop defaults. This test validates that the localStorage -> `loadSettings()` path works correctly.

### Edge Cases & Timing Robustness (spread across spec files)

#### 28. Rapid seek doesn't cause flicker
- Click-seek 5 times rapidly to different positions (10%, 30%, 50%, 70%, 90%)
- After last seek, sample progress over 300ms
- Assert all samples near 90%, no snap-back to intermediate positions

#### 29. Seek while playing maintains sync
- Play, wait for progress > 10%
- Seek to 50% while still playing
- Sample progress over 1 second
- Assert it advances from ~50%, never jumps back to ~10%

#### 30. Play/pause rapid toggling
- Toggle play/pause 10 times rapidly (50ms intervals)
- Assert final state is consistent (playing+advancing or paused+stable)
- Assert no console errors

#### 31. Duration doesn't change during playback
- Record `getDuration()` at score load
- Play for 5 seconds, record again
- Assert equal

#### 32. Time display matches progress throughout playback
- Play from start, sample every second for 5 seconds
- For each: `displayedCurrentTime / displayedTotalTime ≈ progress / 100` (+-2%)

#### 33. No console errors during full workflow
- Listen for `console.error` via `page.on('console')`
- Run through: load -> play -> seek -> create loop -> change speed -> pause
- Assert no error messages related to player/alphaTab/undefined

## Fixture Requirements

The test Guitar Pro file (`test-tab.gp5`) must have:
- At minimum 8 bars (enough for meaningful loop testing)
- Known, steady tempo (simplifies time calculations)
- At least 1 track (ideally 2 for track-switching test)
- Small file size for fast loading
- Public domain / freely distributable

Options: Create a simple C major scale exercise using a GP editor, or find an open-source one (e.g., from alphaTab's own test fixtures).

## Existing Test Migration

`tests/loop-sync.spec.ts` uses `window.__tabTest` (which was never in the source) and 14 instances of `waitForTimeout`. As part of this work:
- Migrate it to use `window.__testApi`
- Replace `waitForTimeout` calls with polling helpers from `wait.ts`
- Or delete it if test case 16 (loop overlay matches playback position) supersedes it

## Score Drag Testing Strategy

Test case 12 (loop by sheet drag) is marked OPTIONAL due to reliance on alphaTab internals. Approach:

1. `__testApi.getBarPositions()` reads `api.renderer.boundsLookup.staffSystems` and returns pixel coordinates (included in the bridge definition above)
2. Use those coordinates with `page.mouse.move/down/up` to simulate dragging across bars
3. If `getBarPositions()` returns empty (boundsLookup not ready or API changed), the test skips gracefully
4. The `#player-host` element's bounding rect is used to convert bar-local coords to page coords

## Tolerance Strategy

All numeric assertions use tolerances appropriate to the domain:
- Progress bar position: +-3% (CSS rendering + alphaTab timing)
- Time display vs progress: +-2% (rounding + update interval differences)
- Loop boundaries: +-5% of duration (snap-to-bar behavior)
- Speed ratio comparisons: +-50% (alphaTab's speed control is approximate)
- Seek snap-back detection: +-3% from target (anything larger is a bug)
