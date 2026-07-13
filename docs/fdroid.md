# F-Droid and IzzyOnDroid

Tablatures is a bundled-assets Capacitor app: the web assets, alphaTab and the
soundfont are packaged into the APK and it works fully offline. F-Droid accepts
this class of app (precedents: Voyager `app.vger.voyager`, MapComplete
`org.mapcomplete`, Trailence, Drinkable). Remote-URL wrappers/TWAs are what get
rejected; this is not one.

The only anti-feature is the **optional** tab search, which calls a proprietary
hosted API. The app boots and works without it (local import, playback, tuner,
favorites, history, playlists), so this is declared as `NonFreeNet`, which is
normal and expected.

## Signing

Recommended: **let F-Droid sign** the app. It is the simplest path. Consequence:
the F-Droid build and the GitHub Releases APK are signed with different keys, so
a user cannot switch between the two channels without uninstalling first. That is
fine, they are separate distribution channels. (The reproducible-builds path that
would let both share a signature exists, but Node reproducible builds are hard;
not worth it here.)

## Version scheme

`android/app/build.gradle` derives the version from the release tag, so both the
GitHub workflow and F-Droid's from-source build agree with no CI environment:

- `versionName` = the tag without the leading `v` (e.g. `v0.4.2` -> `0.4.2`).
- `versionCode` = the semver packed as `major*10000 + minor*100 + patch`
  (e.g. `0.4.2` -> `402`, `1.0.0` -> `10000`). Monotonic across releases.

So each release is just a `git tag vX.Y.Z` and push. F-Droid changelogs live in
`fastlane/metadata/android/en-US/changelogs/<versionCode>.txt` (the first tag
`v0.0.1` maps to `1.txt`).

## APK size

The release APK is about 10 MB, comfortably under IzzyOnDroid's ~30 MB limit. If
it ever grows past that, trim the largest bundled assets: drop the unused
`static/font/` copy of Bravura and `static/soundfont/sonivox.sf2` (the app uses
`sonivox.sf3`), and keep only `Bravura.woff2` from the vendored alphaTab font
directory.

## IzzyOnDroid (fast path, ~1 day)

IzzyOnDroid distributes the dev-signed GitHub Releases APK and shows up in every
F-Droid client that adds its repo. Requirements: FOSS license (MPL-2.0, met),
a dev-signed release APK under ~30 MB (met).

1. Cut a release: `git tag v0.0.1 && git push origin v0.0.1`. The
   `android-release.yml` workflow attaches `tablatures-v0.0.1.apk` to the release.
2. Submit the app at https://gitlab.com/IzzyOnDroid/repo (see the "Request app"
   issue template) with the repo URL `https://github.com/tablatures/tablatures`.
3. IzzyOnDroid auto-tracks new GitHub releases via the APK naming pattern.

## F-Droid main repo (slower, weeks of review)

Add a metadata recipe to fdroiddata and open a merge request.

1. Fork https://gitlab.com/fdroid/fdroiddata.
2. Create `metadata/org.tablatures.app.yml` (draft below).
3. Test locally if possible: `fdroid build org.tablatures.app` (needs the
   fdroidserver toolchain), then `fdroid lint org.tablatures.app`.
4. Open a merge request. Review typically takes weeks; a maintainer may tweak the
   build recipe.

### Draft `metadata/org.tablatures.app.yml`

Modeled on `app.vger.voyager.yml` (also a SvelteKit + Capacitor app). Bump
`versionName`/`versionCode`/`commit` per release; `AutoUpdateMode: Version` then
picks up new tags automatically.

```yaml
Categories:
  - Multimedia
License: MPL-2.0
AuthorName: mlhoutel
SourceCode: https://github.com/tablatures/tablatures
IssueTracker: https://github.com/tablatures/tablatures/issues
Changelog: https://github.com/tablatures/tablatures/releases

AntiFeatures:
  NonFreeNet:
    en-US: |-
      The optional online tab search uses a proprietary hosted API. The app
      works fully offline without it (local file import, playback, tuner,
      favorites, history and playlists).

AutoName: Tablatures

RepoType: git
Repo: https://github.com/tablatures/tablatures.git

Builds:
  - versionName: 0.0.1
    versionCode: 1
    commit: v0.0.1
    sudo:
      - apt-get update
      - apt-get install -y nodejs npm
      - npm install -g corepack
      - corepack enable
    init:
      - corepack prepare pnpm@10.17.0 --activate
    subdir: android/app
    gradle:
      - yes
    scandelete:
      - node_modules
    prebuild:
      - pushd ../..
      - pnpm install --frozen-lockfile
      - pnpm run build:app
      - pnpm exec cap sync android --deployment
      - popd

MaintainerNotes: |-
  Bundled-assets Capacitor app. alphaTab and its Bravura font are vendored from
  the npm package at build time by a vite plugin (see vite.config.ts) and are not
  committed; scandelete removes node_modules after the build. The default
  soundfont (static/soundfont/sonivox.sf3, Apache-2.0) ships in the APK for
  offline playback. NonFreeNet is for the optional hosted search API only.

AutoUpdateMode: Version v%v
UpdateCheckMode: Tags
CurrentVersion: 0.0.1
CurrentVersionCode: 1
```

> The `prebuild` runs from the repo root (`pushd ../..`) because the gradle
> `subdir` is `android/app`. Verify the exact working-directory behavior with
> `fdroid build` before submitting; F-Droid maintainers often refine this.
