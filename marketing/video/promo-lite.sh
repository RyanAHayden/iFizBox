#!/bin/sh
# The sideloaders' clip, in one command (about 15 s of the Lite build: a tweak from a repo goes into an app, signed on the
# phone, then Signed Apps and Re-sign All):
#
#   marketing/video/promo.sh [OUT_DIR]        (default: marketing/video/out, gitignored)
#
# make_state.py's made-up world, capture.mjs's recording of shots-promo.json (OUT_DIR/rec/promo.mp4), then promo.html cut
# into OUT_DIR/promo-4x5.mp4 (1080x1350) and OUT_DIR/promo-9x16.mp4 (1080x1920): 60 fps H.264, no sound.
#
# Needs: node 22+, python3, chromium, ffmpeg. No network, no phone. Run it on its own, not beside make.sh (same ports).
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
APP_VERSION=$version timeout 2400 node "$here/capture.mjs" "http://127.0.0.1:$port/" rec "$here/shots-promo.json" --state state --mode sideload
for cut in 4x5:1350 9x16:1920; do
  timeout 2400 node "$here/render.mjs" . "promo-${cut%:*}.mp4" --h "${cut#*:}" --page promo.html --rec promo
done
echo "done: $out/promo-4x5.mp4 $out/promo-9x16.mp4"
