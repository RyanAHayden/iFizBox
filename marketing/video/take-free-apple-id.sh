#!/bin/sh
# The Free Apple ID sign-in of the sideload-only clip, filmed on a real iPhone (iOS 27, iPhone 15 Pro, the app's
# Certificate page > Use a Free Apple ID > Apple's two-factor code > Ready), cut into takes/free-apple-id.webm for
# promo-sideload.html:
#
#   marketing/video/take-free-apple-id.sh RAW.mp4
#
# RAW.mp4 is the phone's own screen recording (1178x2556, WebDriverAgent's video, the times below are its seconds).
# It is not kept: it shows the Apple ID. This script keeps only the parts listed in PARTS and, before anything
# leaves it:
# - covers the Apple ID with a box: in the sign-in form's Apple ID field (13 s to 35.1 s) and in the certificate's
#   name row at the end (from 104 s);
# - blacks out the status bar (the top 172 px), which the clip draws itself;
# - leaves out Apple's "Apple Account Sign In Requested" alert (35.8 s to 58 s): it shows the Apple ID and a map.
# The phone is 393 points wide and the clip's screen 402: it is scaled to 804 px wide (2x, like the recordings) and
# padded to 1748 px tall, 3 px on top so the bar lines up with the recordings' 62 px strip. 30 fps and a high CRF
# keep the file under the repo's 1 MB size guard (tools/test_sizeguard.py); the screens are mostly still.
# It also writes takes/free-apple-id.json: each part's name, its seconds in RAW.mp4 and where it starts in the take.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
raw=${1:?usage: take-free-apple-id.sh RAW.mp4}
out=$here/takes/free-apple-id.webm
mkdir -p "$here/takes"
# name from to: the form opening, both fields typed, Sign In and Apple's answer, the code typed, Verify and the
# setup up to Apple's certificate limit, the revoke and the rest of the setup, the certificate in use
PARTS="open 0.6 3.2
typed 13.6 16.6
signin 29.6 35.7
code 58.4 62.0
setup 70.4 75.6
revoke 85.8 89.4
ready 107.6 110.0"
filter="[0:v]drawbox=x=0:y=0:w=iw:h=172:color=black:t=fill"
filter="$filter,drawbox=x=50:y=445:w=570:h=85:color=0xc9ccd2:t=fill:enable='between(t,13,35.1)'"
filter="$filter,drawbox=x=405:y=495:w=705:h=60:color=0xc9ccd2:t=fill:enable='gte(t,104)'"
n=$(printf '%s\n' "$PARTS" | wc -l)
filter="$filter,split=$n"
i=0; outs=""; json="{\"raw\": \"$(basename "$raw")\", \"parts\": ["; at=0
for k in $(seq 1 "$n"); do filter="$filter[s$k]"; done
printf '%s\n' "$PARTS" > "$here/takes/.parts"
while read -r name from to; do
  i=$((i + 1))
  filter="$filter;[s$i]trim=start=$from:end=$to,setpts=PTS-STARTPTS[p$i]"
  outs="$outs[p$i]"
  [ "$i" -gt 1 ] && json="$json, "
  json="$json{\"name\": \"$name\", \"from\": $from, \"to\": $to, \"at\": $at}"
  at=$(python3 -c "print(round($at + $to - $from, 3))")
done < "$here/takes/.parts"
rm "$here/takes/.parts"
filter="$filter;${outs}concat=n=$n:v=1:a=0,fps=30,scale=804:-2:flags=lanczos,pad=804:1748:0:3:black,format=yuv420p[v]"
ffmpeg -v error -y -i "$raw" -filter_complex "$filter" -map "[v]" -an -c:v libvpx-vp9 -crf 52 -b:v 0 -g 240 -row-mt 1 "$out"
printf '%s], "length": %s}\n' "$json" "$at" > "$here/takes/free-apple-id.json"
ls -l "$out" "$here/takes/free-apple-id.json"
