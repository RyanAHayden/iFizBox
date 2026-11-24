# step.sh IPA: kill, install, unlocked launch
O=$(dirname $0); U="tools/ui-15.sh B415"; (cd ~/.local/share/ifizbox-rig; ios --udid=00008130-0018450C3661001C kill $(cat $O/id) >/dev/null 2>&1)
$U install $O/$1.ipa --as-is; n=$(wc -l < $O/sys.log); $U launch $(cat $O/id); sleep 14
tail -n +$n $O/sys.log | grep -a 'Lock.*\(ryprobe\|group fix:\)' | sed 's/application-identifier.*isolate/.. isolate/' | cut -c1-900
