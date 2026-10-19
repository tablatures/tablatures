#!/bin/bash
# Start, stop or check the render helper on this Mac (installed by install-helper-mac.sh).
set -euo pipefail
H=$HOME/tabrender-helper; pidf=$H/helper.pid
case "${1:-status}" in
  start)
    [ -f "$pidf" ] && kill -0 "$(cat "$pidf")" 2>/dev/null && { echo "already running"; exit 0; }
    set -a; . "$H/helper.env"; set +a
    cd "$H/service"
    nohup nice -n 10 "$H/venv/bin/python" -m hqrender.worker "$HQ_SERVICE_URL" >> "$H/helper.log" 2>&1 < /dev/null &
    echo $! > "$pidf"; echo "started, log: $H/helper.log" ;;
  stop)
    [ -f "$pidf" ] && kill "$(cat "$pidf")" 2>/dev/null || true
    pkill -f -- "-m hqrender.worker" 2>/dev/null || true  # any stray copy
    rm -f "$pidf"; echo stopped ;;
  status) pgrep -fl -- "-m hqrender.worker" || echo "not running"; tail -5 "$H/helper.log" 2>/dev/null || true ;;
esac
