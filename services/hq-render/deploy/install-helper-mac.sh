#!/bin/bash
# Set up this Mac as a render helper for a render service:
#   deploy/install-helper-mac.sh <assets dir with nam/ and sfz/> <sfizz macOS build dir (usr/local)>
# then start/stop it with deploy/helper-mac.sh start|stop|status. Layout: ~/tabrender-helper.
set -euo pipefail
assets=$1; sfizz=$2
here=$(cd "$(dirname "$0")/.." && pwd); repo=$(cd "$here/../.." && pwd); H=$HOME/tabrender-helper
config=$here/assets/chain-v3.json
mkdir -p "$H/assets/nam" "$H/assets/sfz" "$H/opt" "$H/app/node_modules/@coderline" "$H/app/static"
rsync -a --delete --exclude __pycache__ "$here/" "$H/service/"
rsync -a --delete "$repo/node_modules/@coderline/alphatab/" "$H/app/node_modules/@coderline/alphatab/"
rsync -a --delete "$repo/static/soundfont" "$repo/static/instruments" "$H/app/static/"
python3 -c "import json; c=json.load(open('$config'))['guitar']; print('\n'.join(sorted({c['heavy']['capture'], *[v['capture'] for v in c['light'].values()]})))" |
  while IFS= read -r c; do rsync -a "$assets/nam/$c" "$H/assets/nam/"; done
kit=$(python3 -c "import json; print(json.load(open('$config'))['drums']['kit'].split('/')[0])")
rsync -a "$assets/sfz/$kit" "$H/assets/sfz/"
rsync -a "$sfizz/" "$H/opt/sfizz/"
[ -d "$H/venv" ] || python3 -m venv "$H/venv"
"$H/venv/bin/pip" install -q numpy scipy numba pyloudnorm mido
if [ ! -f "$H/helper.env" ]; then
  umask 077
  cat > "$H/helper.env" <<ENV
HQ_SERVICE_URL=
HQ_WORKER_TOKEN=
HQ_REPO=$H/app
HQ_ASSETS=$H/assets
HQ_SFIZZ=$H/opt/sfizz/bin/sfizz_render
HQ_SFIZZ_LIB=$H/opt/sfizz/lib
HQ_AMP_WORKERS=6
HQ_MIN_FREE_GB=8
ENV
fi
echo "set HQ_SERVICE_URL and HQ_WORKER_TOKEN in $H/helper.env, then: deploy/helper-mac.sh start"
