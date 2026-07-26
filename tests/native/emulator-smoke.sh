#!/usr/bin/env bash
#
# Native mobile smoke test — the automated guard for the class of bug that only
# shows up on-device: the native SQLite database failing to open durably (which
# silently drops the app onto a NON-PERSISTENT in-memory DB, so offline tabs /
# history / favorites vanish on restart).
#
# It boots the project AVD, installs the given APK, launches the app, and asserts
# from logcat that the data layer reported a durable open on BOTH a cold launch
# and a warm restart (am force-stop → relaunch — the exact regression that bit
# us). Exits non-zero on any failure.
#
# Usage:
#   tests/native/emulator-smoke.sh <path-to.apk>
#
# Env:
#   AVD_NAME        AVD to boot (default: tabtest; see `emulator -list-avds`)
#   ANDROID_SDK_ROOT / ANDROID_HOME  SDK location (default: ~/Android/Sdk)
#   APP_ID          Android application id (default: org.tablatures.app)
#   BOOT_TIMEOUT    seconds to wait for boot (default: 180)
#   LOG_TIMEOUT     seconds to wait for the durable-open log (default: 60)
#   HEADLESS        1 → run the emulator with -no-window (default: 1)
#
set -uo pipefail

APK_PATH="${1:-}"
AVD_NAME="${AVD_NAME:-tabtest}"
APP_ID="${APP_ID:-org.tablatures.app}"
BOOT_TIMEOUT="${BOOT_TIMEOUT:-180}"
LOG_TIMEOUT="${LOG_TIMEOUT:-60}"
HEADLESS="${HEADLESS:-1}"

SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Android/Sdk}}"
ADB="$(command -v adb || echo "$SDK/platform-tools/adb")"
EMULATOR="$(command -v emulator || echo "$SDK/emulator/emulator")"

# The data layer's own log lines (src/library/data/db.ts + init.ts).
OK_PATTERN='native SQLite OPEN ok'
READY_PATTERN='ready (engine: native)'
FAIL_PATTERN='NATIVE SQLITE FAILED'
MEM_PATTERN='NON-PERSISTENT in-memory'

EMULATOR_PID=""
STARTED_EMULATOR=0

log()  { printf '\033[1;36m[smoke]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[smoke ✓]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[smoke ✗]\033[0m %s\n' "$*" >&2; }

die() { fail "$*"; exit 1; }

cleanup() {
  if [ "$STARTED_EMULATOR" = "1" ] && [ -n "$EMULATOR_PID" ]; then
    log "Shutting down the emulator we started (pid $EMULATOR_PID)…"
    "$ADB" -s "$SERIAL" emu kill >/dev/null 2>&1 || kill "$EMULATOR_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# --- Preconditions -----------------------------------------------------------
[ -n "$APK_PATH" ] || die "usage: $0 <path-to.apk>"
[ -f "$APK_PATH" ] || die "APK not found: $APK_PATH"
[ -x "$ADB" ] || die "adb not found (looked in PATH and $SDK/platform-tools)"
[ -x "$EMULATOR" ] || die "emulator not found (looked in PATH and $SDK/emulator)"

if ! "$EMULATOR" -list-avds 2>/dev/null | grep -qx "$AVD_NAME"; then
  die "AVD '$AVD_NAME' not found. Available: $("$EMULATOR" -list-avds 2>/dev/null | tr '\n' ' ')"
fi

"$ADB" start-server >/dev/null 2>&1

# --- Boot (or reuse) an emulator --------------------------------------------
SERIAL="$("$ADB" devices | awk '/emulator-.*device$/{print $1; exit}')"
if [ -n "$SERIAL" ]; then
  log "Reusing already-running emulator: $SERIAL"
else
  log "Booting AVD '$AVD_NAME' (headless=$HEADLESS)…"
  EMU_ARGS=(-avd "$AVD_NAME" -no-snapshot -no-boot-anim -gpu swiftshader_indirect)
  [ "$HEADLESS" = "1" ] && EMU_ARGS+=(-no-window -no-audio)
  "$EMULATOR" "${EMU_ARGS[@]}" >/tmp/emulator-smoke.log 2>&1 &
  EMULATOR_PID=$!
  STARTED_EMULATOR=1

  log "Waiting for device to attach…"
  "$ADB" wait-for-device
  SERIAL="$("$ADB" devices | awk '/emulator-.*device$/{print $1; exit}')"
  [ -n "$SERIAL" ] || die "no emulator serial after wait-for-device"
fi

log "Waiting for boot to complete (timeout ${BOOT_TIMEOUT}s)…"
booted=0
for _ in $(seq 1 "$BOOT_TIMEOUT"); do
  if [ "$("$ADB" -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; then
    booted=1
    break
  fi
  sleep 1
done
[ "$booted" = "1" ] || die "emulator did not finish booting within ${BOOT_TIMEOUT}s"
"$ADB" -s "$SERIAL" shell input keyevent 82 >/dev/null 2>&1 || true # dismiss lockscreen
ok "Emulator booted ($SERIAL)"

# --- Install -----------------------------------------------------------------
log "Installing APK: $APK_PATH"
"$ADB" -s "$SERIAL" install -r -d "$APK_PATH" >/tmp/emulator-smoke-install.log 2>&1 \
  || die "adb install failed (see /tmp/emulator-smoke-install.log)"
ok "Installed $APP_ID"

# Wait for a durable-open log line, failing fast if the in-memory fallback is hit.
# $1 = human label for the phase.
await_durable_open() {
  local label="$1" deadline=$((SECONDS + LOG_TIMEOUT))
  while [ "$SECONDS" -lt "$deadline" ]; do
    local dump
    dump="$("$ADB" -s "$SERIAL" logcat -d 2>/dev/null)"
    if grep -qF "$FAIL_PATTERN" <<<"$dump" || grep -qF "$MEM_PATTERN" <<<"$dump"; then
      fail "$label: data layer fell back to a NON-PERSISTENT in-memory DB!"
      grep -F -e "$FAIL_PATTERN" -e "$MEM_PATTERN" <<<"$dump" | tail -3 >&2
      return 1
    fi
    if grep -qF "$OK_PATTERN" <<<"$dump" || grep -qF "$READY_PATTERN" <<<"$dump"; then
      ok "$label: native SQLite opened durably"
      return 0
    fi
    sleep 2
  done
  fail "$label: no durable-open log within ${LOG_TIMEOUT}s"
  "$ADB" -s "$SERIAL" logcat -d 2>/dev/null | grep -F '[data]' | tail -10 >&2 || true
  return 1
}

launch_app() {
  # Launcher intent is the most robust way to start a Capacitor app.
  "$ADB" -s "$SERIAL" shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 \
    >/dev/null 2>&1 || "$ADB" -s "$SERIAL" shell am start -n "$APP_ID/.MainActivity" >/dev/null 2>&1
}

# --- Cold launch -------------------------------------------------------------
log "Cold launch…"
"$ADB" -s "$SERIAL" logcat -c >/dev/null 2>&1 || true
launch_app
await_durable_open "cold launch" || exit 1

# --- Warm restart (force-stop → relaunch) ------------------------------------
log "Warm restart (force-stop → relaunch)…"
"$ADB" -s "$SERIAL" shell am force-stop "$APP_ID" >/dev/null 2>&1 || true
sleep 2
"$ADB" -s "$SERIAL" logcat -c >/dev/null 2>&1 || true
launch_app
await_durable_open "warm restart" || exit 1

ok "Native SQLite smoke passed (cold + warm) — durable/persistent on both."
