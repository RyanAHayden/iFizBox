W=/home/ryha/runs/iFizBox/s1; U="$W/tools/ui-15.sh B382"; cd $W
S=$(curl -s 127.0.0.1:8100/status | python3 -c 'import json,sys; print(json.load(sys.stdin).get("sessionId") or "")')
id=$(curl -s -X POST 127.0.0.1:8100/session/$S/wda/video/start -H 'Content-Type: application/json' -d '{"fps":60,"codec":0}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["value"]["uuid"])')
sleep 1; $U tap 120 243; sleep 2; $U tap 600 700; sleep 3; $U swipe 5 1500 900 1500 0.6; sleep 2; $U tap 600 700; sleep 2; $U tap 120 243; sleep 2; $U tap 120 243; sleep 2
$U tap 785 2400; sleep 2; $U shot b382-i; 
curl -s -X POST 127.0.0.1:8100/session/$S/wda/video/stop >/dev/null; sleep 1
cd ~/.local/share/ifizbox-rig; ios file pull --udid=00008130-0018450C3661001C --app=com.apple.testmanagerd --remote=/Attachments/$id --local=/home/ryha/.cache/claude-tmp/b382/$1.mp4 2>/dev/null
