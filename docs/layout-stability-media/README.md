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
