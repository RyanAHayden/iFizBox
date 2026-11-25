#!/bin/sh
# The showcase video's recordings, in one command:
#
#   marketing/video/make.sh [OUT_DIR]        (default: marketing/video/out, gitignored)
#
# 1. make_state.py: the made-up world (sources, apps, tweaks, icons); native/icon/alternates.py: the app's own icons
# 2. node worker/node.mjs on 127.0.0.1 serves web/app
# 3. capture.mjs: one continuous session of each build, 60 fps under a virtual clock, with a fake native bridge:
#    OUT_DIR/rec/lite.mp4 (shots-lite.json) and OUT_DIR/rec/jailbreak.mp4 (shots-jailbreak.json), each with a .json
#    (marks, looks, touches) and a .txt (the words on screen at each mark)
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
echo "done: $out/rec/lite.mp4 $out/rec/jailbreak.mp4"
