# Layout stability contract

Async work fills allocated space. It must not move content that has already
painted. Our budget is **zero Layout Instability API entries**, including entries
below the usual “good CLS” threshold and entries marked `hadRecentInput`.

Run `pnpm test:layout`. This builds and serves the production app, including its
prerendered HTML, and runs Chromium with retries disabled. The regular dev-server
suite remains `pnpm test:e2e`; `PLAYWRIGHT_PORT` can isolate that server from another
checkout. CI runs both suites on every PR, including stacked PRs.

## What the gate exercises

The suite holds resources behind explicit release gates, paints the waiting UI,
and then releases them independently. It covers empty and populated history,
prerender-to-hydration handoff, the home cold-start hint, catalog-to-live result
merges (including new versions), late artist profiles, artwork and font loading,
score loading, scrolling offscreen feed cells into view, empty/offline/error states,
and repertoire/settings/playlist startup. Six viewports include a 320px phone, phone portrait, phone landscape, tablet,
desktop and a wide desktop. Player checks also reject horizontal toolbar overflow.

The browser observer starts **before application scripts**. Failures attach the
score, source regions, old/new rectangles and a Playwright trace. Another test
injects a small real shift and verifies both the observer and the application's
region telemetry see it. An unsupported Layout Instability API is a failure,
never a silent pass.

To compare the exact search regression with a parent production build already
running on another port:

```sh
LAYOUT_BASELINE_URL=http://localhost:5191 pnpm test:layout \
  --grep 'late hero metadata never moves' --repeat-each=20
```

Against PR #175 at `ffbf5b3`, this test failed 20/20 times. Keep the zero budget;
fix the underlying geometry instead of increasing a threshold or adding retries.

## Geometry rules

- CSS determines the home Import/Continue arrangement before hydration. Continue
  has a bounded horizontal row; history hydration fills it without moving the feed.
- Real tab cards and skeletons reserve the same square artwork, two title lines
  and artist line. Feed slots retain their identity and exact height; batches fill
  slots instead of pushing existing placeholders down or hiding partial rows.
- Search's artist rail has the same height while loading, populated, or showing
  the query summary. Counts keep their line, and source/version badges keep their
  width when live results merge. Result skeletons match responsive result rows.
- History waits for its repository hydration before painting the ordered recent
  list; database readiness alone is too early.
- Loading messages, percentage rows and animated dots reserve their final space.
- Player controls, metadata artwork, tuning and enrichment rows have space before
  score/network data arrives. Lyrics wait for the first toolbar measurement.
- The score uses a static staff/tab skeleton inside its viewport, with a fixed
  status box through download, audio preparation and rendering. The persistent
  renderer stays mounted; its `postRenderFinished` event ends the placeholder,
  rather than the earlier file-parsed event. The overlay is capped to the visible
  score height, including short landscape screens, and leaves the header and
  controls visible. Its small activity indicator respects reduced motion.
- Scrolling surfaces reserve their scrollbar gutter. Text fonts are preloaded with
  `font-display: optional`: a slow font can leave the first view in the system
  fallback, but cannot swap under readable content. Icon boxes reserve one glyph;
  each face paints only once it has loaded, so its fallback ligature never flashes.

## Local diagnostics

The root layout observes buffered `layout-shift` entries and keeps the latest 50
in memory (`getLayoutMovements()` in `layoutStability.ts`). It dispatches
`tablatures:layout-shift` on `window` with a score, hydration phase, recent-input
flag and named source rectangles. No text, user content or URLs are captured, and
nothing is sent to a server. A diagnostic consumer can subscribe to that event:

```js
window.addEventListener('tablatures:layout-shift', (event) => console.table(event.detail.sources));
```

These are startup/loading guardrails, not a claim about every possible browser,
score, viewport or intentional user layout change. Add a delayed-resource journey
whenever a new async surface is introduced. Resize/fullscreen, opening a panel,
reordering a playlist, and navigating to different content are intentional changes;
their subsequent async enrichment should still preserve the resulting geometry.
