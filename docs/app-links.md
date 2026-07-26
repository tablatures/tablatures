# Android App Links (deep links into the installed app)

Shared links use the canonical origin `https://tablatures.org` (see
`src/library/utils/shareUrl.ts`). When the Android app is installed, those
links should open **in the app** instead of the browser. This is wired up via
Android App Links.

## What the app already does

- `android/app/src/main/AndroidManifest.xml` declares a VIEW/BROWSABLE
  intent-filter with `android:autoVerify="true"` for `https://tablatures.org`
  (host only, all paths).
- On launch/resume the app listens for the Capacitor App plugin's
  `appUrlOpen` event (`onAppUrlOpen` in `src/library/utils/native.ts`, wired in
  `src/routes/+layout.svelte`) and routes the opened URL's path + query + hash
  through the SvelteKit router (`goto`). So a shared `/play?tab=…` (or
  `/artist/…`, `/repertoire?playlist=…`) link opens the exact same view in-app.

## Deploy-side task (REQUIRED for autoVerify)

`autoVerify` only succeeds if the domain serves a Digital Asset Links file that
names this app's signing certificate. Deploy the following at:

    https://tablatures.org/.well-known/assetlinks.json

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "org.tablatures.app",
      "sha256_cert_fingerprints": [
        "REPLACE_WITH_APP_SIGNING_SHA256_FINGERPRINT"
      ]
    }
  }
]
```

- `package_name` is `org.tablatures.app` (see `capacitor.config.ts`).
- The SHA-256 fingerprint is the **app signing** certificate's fingerprint.
  - If distributing via Google Play, use the fingerprint from
    Play Console → Setup → App integrity → App signing key certificate.
  - For a locally signed build, run:
    `keytool -list -v -keystore <your.keystore> -alias <alias>` and copy the
    SHA-256 line.
- The file must be served as `application/json` over HTTPS with no redirects.

Until this file is deployed, links still work (they open in the browser / the
in-app router handles them once opened), but Android will not auto-open them in
the app without the user manually enabling the link association in system
settings.
