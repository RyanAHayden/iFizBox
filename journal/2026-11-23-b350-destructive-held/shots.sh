#!/bin/sh
# B350: shoot harness.html at 3x in every era and tone, resting and held. Needs a server on the worktree root:
#   python3 -m http.server 8350 --bind 127.0.0.1
# Usage: shots.sh OUTDIR
out=${1:?outdir}
mkdir -p "$out"
for style in ios6 ios7 ios13 ios26; do
  for theme in light dark; do
    for pressed in 0 1; do
      p=""; [ "$pressed" = 1 ] && p="&pressed=1"
      timeout 60 chromium --headless=new --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=3 \
        --window-size=390,480 --screenshot="$out/$style-$theme-$pressed.png" \
        "http://127.0.0.1:8350/journal/2026-11-23-b350-destructive-held/harness.html?style=$style&theme=$theme$p" 2>/dev/null
    done
  done
done
