#!/bin/bash
# Copy what the renderer needs to a host:
#   deploy/sync-assets.sh <ssh host> <assets dir with nam/ and sfz/>
# Layout on the host (~/tabrender):
#   service/   this directory (code and chain config)
#   app/       the parts of the app checkout render_score.mjs reads (alphaTab, soundfonts)
#   assets/    nam/ amp captures and sfz/ drum kit (licences: NAM captures GPL-3, Big Rusty Drums CC0)
set -euo pipefail
host=$1; assets=$2
here=$(cd "$(dirname "$0")/.." && pwd); repo=$(cd "$here/../.." && pwd)
config=$here/assets/chain-v3.json
captures=$(python3 -c "import json,sys; c=json.load(open('$config'))['guitar']; print('\n'.join(sorted({c['heavy']['capture'], *[v['capture'] for v in c['light'].values()]})))")
kit=$(python3 -c "import json; print(json.load(open('$config'))['drums']['kit'].split('/')[0])")

ssh "$host" 'mkdir -p ~/tabrender/service ~/tabrender/app/node_modules/@coderline ~/tabrender/app/static ~/tabrender/assets/nam ~/tabrender/assets/sfz'
rsync -a --delete --exclude __pycache__ "$here/" "$host:tabrender/service/"
rsync -a --delete "$repo/node_modules/@coderline/alphatab/" "$host:tabrender/app/node_modules/@coderline/alphatab/"
rsync -a --delete "$repo/static/soundfont" "$repo/static/instruments" "$host:tabrender/app/static/"
while IFS= read -r c; do rsync -a "$assets/nam/$c" "$host:tabrender/assets/nam/"; done <<< "$captures"
rsync -a --delete "$assets/sfz/$kit" "$host:tabrender/assets/sfz/"
echo synced to "$host"
