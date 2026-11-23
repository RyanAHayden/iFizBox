#!/bin/sh
# rec.sh NAME: home -> Settings back tap, back swipe, cancelled swipe, edge to Sources tab -> a source -> back tap/swipe
W=/home/ryha/runs/iFizBox/s1; U="$W/tools/ui-15.sh B382"
cd $W
sid() { curl -s 127.0.0.1:8100/status | python3 -c 'import json,sys; print(json.load(sys.stdin).get("sessionId") or "")'; }
$U launch; sleep 2
S=$(sid)
id=$(curl -s -X POST 127.0.0.1:8100/session/$S/wda/video/start -H 'Content-Type: application/json' -d '{"fps":60,"codec":0}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["value"]["uuid"])')
$U tap 150 2400; sleep 1
$U tap 300 1367; sleep 1.5          # Settings
$U tap 120 243; sleep 1.5           # back tap
$U tap 300 1367; sleep 1.5
$U swipe 5 1500 900 1500 0.6; sleep 1.5   # back swipe
$U tap 300 1367; sleep 1.5
$U swipe 5 1500 300 1500 1; sleep 1.5     # maybe cancelled
$U tap 120 243; sleep 1.5
$U tap 393 2400; sleep 1.5          # Sources tab
$U tap 600 ${SRC_Y:-900}; sleep 2
$U tap 120 243; sleep 1.5
$U tap 600 ${SRC_Y:-900}; sleep 2
$U swipe 5 1500 900 1500 0.6; sleep 1.5
$U tap 150 2400; sleep 1
curl -s -X POST 127.0.0.1:8100/session/$S/wda/video/stop >/dev/null
sleep 1
cd ~/.local/share/ifizbox-rig
ios file pull --udid=00008130-0018450C3661001C --app=com.apple.testmanagerd --remote=/Attachments/$id --local=/home/ryha/.cache/claude-tmp/b382/$1.mp4 2>/dev/null
