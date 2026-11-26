#!/bin/sh
# The showcase video, in one command:
#
#   marketing/video/make.sh [OUT_DIR]        (default: marketing/video/out, gitignored)
#
# 1. make_state.py: the made-up world (sources, apps, tweaks, icons); native/icon/alternates.py: the app's own icons
# 2. node worker/node.mjs on 127.0.0.1 serves web/app
# 3. capture.mjs: one continuous session of each build, 60 fps under a virtual clock, with a fake native bridge:
#    OUT_DIR/rec/lite.mp4 (shots-lite.json) and OUT_DIR/rec/jailbreak.mp4 (shots-jailbreak.json), each with a .json
#    (marks, looks, touches) and a .txt (the words on screen at each mark)
# 4. render.mjs cuts them (video.html) into OUT_DIR/showcase-4x5.mp4 (1080x1350) and OUT_DIR/showcase-9x16.mp4
#    (1080x1920), 60 fps H.264
#
# Needs: node 22+, python3, chromium, ffmpeg. No network, no phone.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
out=${1:-$here/out}
mkdir -p "$out/rec"
out=$(cd "$out" && pwd)
version=$(cat "$repo/native/VERSION")

python3 "$here/make_state.py" "$out/state"
python3 "$repo/native/icon/alternates.py" thumbs "$out/state/appicon"

port=$((8900 + $$ % 500))
PORT=$port HOST=127.0.0.1 REVIEWS_DB=off node "$repo/worker/node.mjs" >"$out/server.log" 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT INT TERM
deadline=$(($(date +%s) + 30))
until curl -sf -o /dev/null "http://127.0.0.1:$port/"; do
  [ "$(date +%s)" -lt "$deadline" ] || { echo "the server didn't start (see $out/server.log)" >&2; exit 1; }
  sleep 0.5
done

cd "$out" # capture.mjs keeps its Chromium profile in the current directory
APP_VERSION=$version timeout 2400 node "$here/capture.mjs" "http://127.0.0.1:$port/" rec "$here/shots-lite.json" --state state --mode sideload
APP_VERSION=$version timeout 2400 node "$here/capture.mjs" "http://127.0.0.1:$port/" rec "$here/shots-jailbreak.json" --state state --mode jailbreak
for cut in 4x5:1350 9x16:1920; do
  timeout 2400 node "$here/render.mjs" . "showcase-${cut%:*}.mp4" --h "${cut#*:}"
done
# the promo clip for jailbreakers (promo.html): its own world (Lamplight installed, four tweaks a release behind), one
# jailbreak recording, two cuts: OUT_DIR/promo-4x5.mp4 and OUT_DIR/promo-9x16.mp4
python3 "$here/make_state.py" "$out/state-promo" --promo
python3 "$repo/native/icon/alternates.py" thumbs "$out/state-promo/appicon"
APP_VERSION=$version timeout 2400 node "$here/capture.mjs" "http://127.0.0.1:$port/" rec "$here/shots-promo.json" --state state-promo --mode jailbreak
for cut in 4x5:1350 9x16:1920; do
  timeout 2400 node "$here/render.mjs" . "promo-${cut%:*}.mp4" --h "${cut#*:}" --page promo
done
echo "done: $out/showcase-4x5.mp4 $out/showcase-9x16.mp4 $out/promo-4x5.mp4 $out/promo-9x16.mp4"
