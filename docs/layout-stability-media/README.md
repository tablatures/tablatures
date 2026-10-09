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

## Score reopening, refresh and medium-width header follow-up

These captures compare the previous PR #176 revision at
`20c0e6cc36c997c03121bad9135e651c72f4be13` with the fixes at
`094f164631d8d27c0494f946000a2791b20b8728`. Both are production builds with
the same two catalog entries and committed GP5 fixture. The second entry appends
one trailing zero byte, giving it a distinct score identity while retaining a
valid score. Its download stays pending during the screenshots.

- [Phone: back, then open another score](score-reopen-phone.png). At 390 × 844,
  open the first score, scroll it 300px, go back, then open the second. Apply the
  same wheel gesture over the pending score. Before, the old notes show below
  the scrolled-away skeleton; after, the score viewport stays covered. The
  inherited scroll offset changes from 143px to 0px, and remains 0px after the
  gesture. Touch viewport emulation is enabled; the wheel explicitly exercises
  the loading scroller's input guard.
- [Medium-width header](header-medium.png). Unscaled crops from a 1024 × 844
  viewport. Before, the search field extends 321px into the tuner button; after,
  it ends 12px before that button. Automated checks cover eight widths from
  768px to 1536px, before and after delayed fonts and data arrive.

Refresh was also checked on the production build with 4× CPU throttling. Native
layout entries remain zero, and frame samples verify that the header stays at
y=0 and the newly visible score stays at scrollTop=0. Recommendations are held
until after the score appears to catch late “Up next” changes. These checks run
at all six layout viewports, including phone portrait and landscape.
