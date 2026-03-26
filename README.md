# Tablatures

<a href="https://tablatures.github.io/tablatures" >
    <img src="https://img.shields.io/github/actions/workflow/status/tablatures/tablatures/deploy.yml?style=flat-square" alt="Build" />
</a>

<a href="https://github.com/tablatures/tablatures/blob/main/package.json" >
    <img src="https://img.shields.io/github/package-json/v/tablatures/tablatures?style=flat-square&color=informational" alt="Version" />
</a>

<a href="https://github.com/tablatures/tablatures/search?l=svelte" >
    <img src="https://img.shields.io/github/languages/top/tablatures/tablatures?style=flat-square&color=orange" alt="Language" />
</a>

<a href="https://github.com/tablatures/tablatures/blob/main/LICENSE/" >
    <img src="https://img.shields.io/github/license/tablatures/tablatures?style=flat-square&color=yellow" alt="License" />
</a>

&nbsp;&nbsp;

<p align="center">
  <a href="https://tablatures.github.io/tablatures/"><img src="./static/logos/icon.svg" width="100px" /></a>
</p>

&nbsp;&nbsp;

**The YouTube of guitar tablatures**: search, play, and practice guitar tabs with a modern web player.

## Features

### Player
- **alphaTab-powered rendering** of Guitar Pro files (`.gp3`, `.gp4`, `.gp5`, `.gpx`, `.gp`, `.xml`)
- **Persistent mini-player**: audio continues playing across page navigation with a floating tab preview
- **YouTube video sync**: play along with YouTube videos, with bidirectional playback sync and adjustable time offset
- **Drag-to-loop**: drag on the progress bar or the tablature sheet to create A-B loop regions with floating controls
- **Smart cursor follow**: auto-scrolls with the cursor, pauses when you scroll away, resumes when you scroll back
- **Dark theme support**: proper alphaTab color theming with dark mode
- **Track mixer**: solo, mute, and adjust volume per track
- **Keyboard shortcuts**: Space, arrows, +/-, and more

### Search & Discovery
- **Multi-source search**: searches local database, Songsterr, and Ultimate Guitar in parallel
- **Dedicated search page** (`/search?q=...`) with shareable URLs
- **Artist hero banner**: fuzzy-matched artist detection with image, bio, country, and genre tags
- **Album artwork**: fetched from iTunes for search results, favorites, and the player
- **Artist tooltips**: hover any artist name to see their photo, bio, and a link to search their tabs
- **Autocomplete** with section headers (songs first, then albums, then artists)

### Collection
- **Favorite songs** with album artwork, grouped by artist
- **Favorite artists** with follow/unfollow from tooltips and hero banners
- **History** grouped by day with individual item removal
- **Preferences**: soundfont selection, default speed/metronome, data export/import
- **Local-only data**: everything stored in browser localStorage, nothing sent to servers

### Player Controls
- **YouTube-style volume**: icon + hover slider with violet fill
- **Speed selector**: shows custom values when adjusted with +/- keys
- **Unified settings panel**: single button for tracks and settings
- **Video picker**: choose from YouTube results, plays inline with sync
- **Share**: URLs include tab ID, video ID, and playback time for easy sharing

## Routes

| Route | Description |
|-------|-------------|
| `/` | Home: discovery feed with recommendations, recent tabs, import |
| `/search?q=...` | Search results with artist hero section |
| `/play?tab=...&video=...&t=...` | Full player with shareable state |
| `/collection` | Favorites, history, settings |

## Getting Started

```bash
# Clone and install
git clone https://github.com/tablatures/tablatures.git
cd tablatures && pnpm install

# Development
pnpm run start

# Build
pnpm run build
pnpm run preview
```

## Environment Variables

The Tablatures frontend uses environment variables to configure API endpoints, deployment behavior, and runtime options. These must be defined in your environment (e.g., `.env` files, CI/CD, or hosting platform settings).

| Variable | Description | Example |
|----------|------------|--------|
| `VITE_SEARCH_API_BASE_URL` | Base URL for the Search API used by the frontend | `https://example.com` |
| `VITE_SEARCH_API_TIMEOUT` | Timeout for Search API requests (milliseconds) | `10000` |
| `VITE_DEPLOY_TARGET` | Deployment target: `'static'` for static hosting, `'server'` for SSR | `static` |
| `VITE_BASE_PATH` | Base path for frontend URLs (for GitHub Pages or repo subpaths) | `/tablatures` |

> **Note:** All frontend environment variables must start with `VITE_` to be accessible in the browser.

## Tech Stack

- **SvelteKit** + TypeScript
- **Tailwind CSS** for styling
- **alphaTab 1.5.0** for tablature rendering and playback
- **YouTube iFrame API** for video sync
- **Vite** for building
