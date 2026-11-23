#!/usr/bin/env bash
# step.sh LABEL SIGNER(pre|new|oldsd|sd|none) IPA
set -euo pipefail
S=/home/ryha/.cache/claude-tmp/claude-1000/-home-ryha-runs-iFizBox-s2/f0504cd8-8a36-4c35-8224-47cc1855b367/scratchpad; R=/home/ryha/runs/iFizBox/s2
label=$1 signer=$2 in=$3; rig=$HOME/.local/share/ifizbox-rig; udid=00008130-0018450C3661001C; id=com.burbn.instagram
K=$HOME/sync/default/signing/rsideload; p12=$K/cert.p12; pw=$(cat $K/password.txt); prof=$K/sidedrop-adhoc.mobileprovision
sec=$XDG_RUNTIME_DIR/ifizbox-b390; mkdir -p $sec; chmod 700 $sec; trap 'rm -f $sec/*' EXIT
out=$S/ipa/signed.ipa; rm -f $out
gi() { (cd "$rig" && timeout 120 ios --udid="$udid" "$@"); }
native() { r=$1
  openssl pkcs12 -legacy -in "$p12" -passin "pass:$pw" -nocerts -nodes -out $sec/key.pem 2>/dev/null
  openssl pkcs12 -legacy -in "$p12" -passin "pass:$pw" -clcerts -nokeys 2>/dev/null | openssl x509 -outform der -out $sec/cert.der
  issuer=$(openssl x509 -inform der -in $sec/cert.der -noout -issuer)
  case $issuer in *G6*) w=AppleWWDRCAG6;; *G5*) w=AppleWWDRCAG5;; *G4*) w=AppleWWDRCAG4;; *) w=AppleWWDRCAG3;; esac
  SIGNBENCH_KEY_PEM=$sec/key.pem SIGNBENCH_CHAIN=$R/native/sign/certs/$w.cer:$R/native/sign/certs/AppleIncRootCertificate.cer SIGNBENCH_GROUPFIX=$r/web/app/vendor/groupfix/ifizbox-groupfix.dylib \
   $r/native/sign/bench/build/signbench-linux "$in" $out $sec/cert.der $sec/cert.der $prof | grep -v -E '^(STAGE|TOTAL|PEAK)|%$' || true; }
ents() { python3 -I - "$prof" $1 $id $sec/e.plist <<'PY'
import plistlib,sys
d=open(sys.argv[1],"rb").read(); e=plistlib.loads(d[d.index(b"<?xml"):d.index(b"</plist>")+8])["Entitlements"]
a=e["application-identifier"]; t=e["com.apple.developer.team-identifier"]
e["keychain-access-groups"]=[a] if sys.argv[2]=="old" else [t+"."+sys.argv[3],a]
e["get-task-allow"]=False; plistlib.dump(e,open(sys.argv[4],"wb"))
PY
}
case $signer in
 pre) native $S/pre;; new) native $R;;
 oldsd) ents old; (cd $S/ipa && $rig/zsign -q -z 1 -k $p12 -p "$pw" -m $prof -e $sec/e.plist -o $out $in);;
 sd) ents new; cp $HOME/repos/sidedrop/native/groupfix/sidedrop-groupfix.dylib $sec/
   python3 -I - $in $S/ipa/sdin.ipa <<'PY'
import sys,zipfile,plistlib,shutil
shutil.copy(sys.argv[1],sys.argv[2]); z=zipfile.ZipFile(sys.argv[2],"a")
z.writestr("Payload/Instagram.app/sidedrop-groupfix.plist",plistlib.dumps({"groups":["group.com.burbn.instagram","group.com.facebook.family","group.com.burbn.family"],"target":"","keychain":True,"isolate":"S8NFX3A2LT.com.burbn.instagram"})); z.close()
PY
   (cd $S/ipa && $rig/zsign -q -z 1 -k $p12 -p "$pw" -m $prof -e $sec/e.plist -l $sec/sidedrop-groupfix.dylib -o $out $S/ipa/sdin.ipa);;
 none) ;;
esac
if [ $signer != none ]; then $R/tools/ui-15.sh B390 install $out --as-is || { tail -3 $XDG_RUNTIME_DIR/ifizbox-15/ios.log; exit 3; }; fi
$R/tools/ui-15.sh B390 wake || true
gi kill $id >/dev/null 2>&1 || true; sleep 1
$R/tools/ui-15.sh B390 launch $id; sleep 45
$R/tools/ui-15.sh B390 shot b390-$label
rm -rf $S/pull-$label; mkdir $S/pull-$label
gi fsync --app=$id pull --srcPath=/Documents/ryspy --dstPath=$S/pull-$label | tail -1
ls -R $S/pull-$label | tail -30
grep -h "MARK" $(find $S/pull-$label -name log.txt) | tail -12
