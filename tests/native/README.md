# Native mobile smoke test

`emulator-smoke.sh` is the automated guard for the one bug class our web e2e
suite can't reach: the **native SQLite database failing to open durably**. When
that happens the app silently falls back to a NON-PERSISTENT in-memory DB, so
offline tabs, history and favorites quietly disappear on the next launch. The
script boots the project AVD, installs an APK, and asserts from `logcat` that
the data layer reported a durable open on **both** a cold launch and a warm
restart (`am force-stop` → relaunch — the exact regression we hit on-device).

## Requirements

- Android SDK with `emulator` + `platform-tools` (`adb`) — on `PATH` or under
  `$ANDROID_SDK_ROOT` / `$ANDROID_HOME` (default `~/Android/Sdk`).
- A configured AVD (`emulator -list-avds`). Default name: `tabtest`.
- KVM for acceptable speed (`ls -l /dev/kvm`).
- A debug or release APK built from this branch (see the repo build steps).

## Run

```bash
# Build the APK first (from the repo root):
pnpm build:app && npx cap sync android && (cd android && ./gradlew assembleDebug)

# Then smoke-test it:
tests/native/emulator-smoke.sh android/app/build/outputs/apk/debug/app-debug.apk
```

Environment overrides:

| Var | Default | Meaning |
|---|---|---|
| `AVD_NAME` | `tabtest` | AVD to boot |
| `APP_ID` | `org.tablatures.app` | Android application id |
| `BOOT_TIMEOUT` | `180` | seconds to wait for boot |
| `LOG_TIMEOUT` | `60` | seconds to wait for the durable-open log |
| `HEADLESS` | `1` | `-no-window` emulator (`0` shows the UI) |

The script reuses an already-running emulator if one is attached; otherwise it
boots (and later shuts down) its own. It exits non-zero on any failure and
prints the relevant `[data]` log lines. Emulator output is tee'd to
`/tmp/emulator-smoke.log`.

## What it asserts

- Cold launch logs `native SQLite OPEN ok` / `ready (engine: native)`.
- Neither `NATIVE SQLITE FAILED` nor `NON-PERSISTENT in-memory` appears.
- After a force-stop + relaunch, the durable open is reported again.

## CI (optional)

The web gate lives in `.github/workflows/test.yml`. This native smoke can be run
on tags/releases via `reactivecircus/android-emulator-runner`, invoking this
script against the freshly built APK. It is intentionally kept out of the
per-PR gate because emulator jobs are slow and flakier than headless Chromium.
