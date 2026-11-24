# locked.sh NAME: launch with the probe's 18 s start delay, press the lock button, wait, print what it logged
O=$(dirname $0); ID=$(cat $O/id); U="tools/ui-15.sh B415"
(cd ~/.local/share/ifizbox-rig; ios --udid=00008130-0018450C3661001C kill $ID >/dev/null 2>&1; echo x > $O/ryprobe.sleep
 ios --udid=00008130-0018450C3661001C fsync --app=$ID push --srcPath=$O/ryprobe.sleep --dstPath=/Documents/ryprobe.sleep >/dev/null 2>&1
 ios --udid=00008130-0018450C3661001C fsync --app=$ID tree --path=/Documents 2>&1 | grep -c ryprobe.sleep)
n=$(wc -l < $O/sys.log)
(cd ~/.local/share/ifizbox-rig; ios --udid=00008130-0018450C3661001C launch $ID >/dev/null 2>&1 &)
sleep 2.5; $U lock-button; sleep ${2:-40}
echo "== $1"; tail -n +$n $O/sys.log | grep -a -i 'ryprobe\|group fix:\|SIGBUS\|pagein\|Lock\[[0-9]*\].*exited\|probe.lock.*\(exited\|crash\|killed\)' | grep -v -a runningboardd | cut -c1-1300
