# Release and version cycle

Releases are driven by the app version in `package.json`. A release happens only
when that version changes on `main`; ordinary pushes never publish anything.

## The flow

1. Make changes on a feature branch and open a PR into `main`.
2. When the changes are worth a release, bump `version` in `package.json`
   (semver: `MAJOR.MINOR.PATCH`) in that PR.
3. Merge to `main`.
4. `release-on-version-bump.yml` sees `package.json` change, reads the version,
   and if the tag `v<version>` does not already exist it:
   - creates and pushes the annotated tag `v<version>`, and
   - dispatches `android-release.yml` for that tag.
5. `android-release.yml` builds the signed APK and publishes a GitHub Release
   for the tag with:
   - auto-generated notes (the commits and PRs merged since the previous
     release, i.e. the recap of what changed), and
   - two assets: `tablatures-v<version>.apk` and a stable `tablatures.apk`.

Because the release is gated on the version string, you decide exactly when to
release by choosing when to bump it. Merging ten PRs without a version bump
produces no releases; one version bump produces one.

## Versioning

`android/app/build.gradle` derives both Android version fields from the tag, so
CI and F-Droid (which builds the tag from source) agree:

- `versionName` = the tag without the leading `v` (e.g. `v0.4.2` gives `0.4.2`).
- `versionCode` = the semver packed as `MAJOR*10000 + MINOR*100 + PATCH`
  (`0.4.2` gives `402`, `1.0.0` gives `10000`). Monotonic across releases.

Keep `package.json` `version` and the git tag in step; the workflow does this
automatically by tagging `v<package.json version>`.

## Install channels fed by a release

- GitHub Releases: the `tablatures.apk` asset is reachable at a fixed URL,
  `https://github.com/tablatures/tablatures/releases/latest/download/tablatures.apk`,
  which is what the README Download APK button uses.
- Obtainium: tracks the GitHub releases and auto-updates from the versioned
  `tablatures-v<version>.apk` asset.
- F-Droid: builds the tagged source itself. Its per-version changelog lives in
  `fastlane/metadata/android/en-US/changelogs/<versionCode>.txt`, so add a file
  named after the new `versionCode` when you cut a release you intend to ship to
  F-Droid (see docs/fdroid.md).

## Secrets required (repository settings)

The signed build needs these Actions secrets (see the README Android section for
keystore generation):

- `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
  `ANDROID_KEY_PASSWORD`.

No personal access token is needed: the version-bump workflow dispatches the
release build with the built-in `GITHUB_TOKEN`.

## Manual release (fallback)

You can still release without touching `package.json` by pushing a tag yourself:

```bash
git tag v0.4.2 && git push origin v0.4.2
```

`android-release.yml` also has a `workflow_dispatch` trigger, so a release can be
re-run from the Actions tab against an existing tag.
