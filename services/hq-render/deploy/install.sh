#!/bin/bash
# Install or update the render service on a Debian/Raspberry Pi OS host:
#   deploy/sync-assets.sh <host> <assets dir>   # code, alphaTab, soundfonts, amp captures, drum kit
#   ssh <host> tabrender/service/deploy/install.sh
# Needs sudo for ffmpeg and the systemd unit. Builds sfizz_render from source once.
set -euo pipefail
T=$HOME/tabrender
mkdir -p "$T/state" "$T/files" "$T/opt/bin" "$T/src"
command -v ffmpeg >/dev/null || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q ffmpeg
command -v node >/dev/null || { echo 'node is required (v20+)'; exit 1; }
if [ ! -x "$T/opt/bin/sfizz_render" ]; then
  [ -d "$T/src/sfizz" ] || git clone -q --depth 1 --branch 1.2.3 --recursive --shallow-submodules https://github.com/sfztools/sfizz.git "$T/src/sfizz"
  cmake -S "$T/src/sfizz" -B "$T/src/sfizz/build" -DCMAKE_BUILD_TYPE=Release -DSFIZZ_JACK=OFF -DENABLE_LTO=OFF -DSFIZZ_SHARED=OFF
  nice -n 19 make -C "$T/src/sfizz/build" -j2 sfizz_render
  cp "$T/src/sfizz/build/library/bin/sfizz_render" "$T/opt/bin/"
fi
[ -d "$T/venv" ] || python3 -m venv "$T/venv"
"$T/venv/bin/pip" install -q numpy scipy numba pyloudnorm mido
"$T/venv/bin/python" -c 'import torch' 2>/dev/null || "$T/venv/bin/pip" install -q torch --index-url https://download.pytorch.org/whl/cpu
[ -f "$T/hq.env" ] || sed "s|@HOME@|$HOME|g" "$T/service/deploy/hq.env.example" > "$T/hq.env"
sed -e "s|@HOME@|$HOME|g" -e "s|@USER@|$USER|g" "$T/service/deploy/hqrender.service" | sudo tee /etc/systemd/system/hqrender.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now hqrender
sudo systemctl restart hqrender
sleep 3; systemctl --no-pager status hqrender | head -5
echo "kill switch: touch $T/DISABLED (remove to resume); logs: journalctl -u hqrender -f"
