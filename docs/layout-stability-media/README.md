# Before/after captures for PR #176

Real Chromium screenshots of production builds, with matching mocked catalog data,
artwork, resource gates and viewport sizes on both sides. No application pixels
were redrawn; the surrounding labels identify the revision and measured movement.

- **Before:** PR #175 at `54d21489e32414c4d54d92d6c555e71b98daaea0`.
- **After:** PR #176 application code at `8275426c9ad77c1b6da4250627412354a5d28cc2`.
- Search uses a 390 × 844 viewport. Home and artist use 1280 × 800.
- The GIFs alternate two captured states every two seconds. They are animated
  screenshot comparisons, rather than continuous recordings; the delay is for
  readability. Desktop GIFs are scaled to 60%; PNG stills retain full resolution.

| Comparison                   | Resource transition                                                               | Tracked position before                      | Tracked position after |
| ---------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------- |
| [Search](search-loading.gif) | Catalog results are usable; live search and artist metadata then finish           | First result: y=123 → 286.75 (163.75px down) | y=307 → 307 (0px)      |
| [Home](home-loading.gif)     | Prerendered HTML hydrates and restores three recent tabs; feed data stays pending | Feed heading: y=969 → 581 (388px up)         | y=393 → 393 (0px)      |
| [Artist](artist-loading.gif) | The artist response and artwork replace the loading placeholders                  | Avatar: y=265 → 281 (16px down)              | y=281 → 281 (0px)      |

The coordinates refer to the original viewport, before any GIF scaling. They are
also stored in [positions.json](positions.json). These tracked displacements are
not CLS scores.

Full-resolution still comparisons: [search](search-loaded.png),
[home with history restored](home-loaded.png), [artist](artist-loaded.png).

## Score loading follow-up

The score comparisons use the same PR #175 baseline (`54d2148`) and the score
skeleton implementation in PR #176 at `65cbf141e6c269980adf966a6fc5bd9796da86f0`.
Both sides load the committed `tests/fixtures/test-tab.gp5`, with identical gates
for the tab download, bundled audio soundfont and Bravura music font.

- [Phone loading comparison](score-phone.gif): 390 × 844 touch viewport.
- [Desktop loading comparison](score-desktop.gif): 1280 × 800, shown at 60% size.
- Still comparisons during the parsed-but-not-rendered gap:
  [phone](score-phone.png), [desktop](score-desktop.png).
- [Dark-mode phone skeleton](score-dark.png), also checked with reduced motion:
  the activity indicator has no animation under that preference.

The loops show four real screenshots per side: download pending, audio pending,
file parsed but first render pending, then score ready. Each stage lasts two
seconds for readability; these durations do not represent load-time benchmarks.
The new skeleton and status box remain inside the visible score viewport while
the renderer works, and the toolbar keeps the same rectangle in all six tested
viewport sizes. The native layout observer records zero shifts through the
independently delayed download/audio/render stages.
