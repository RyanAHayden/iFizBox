#!/usr/bin/env bash
# sign.sh VARIANT(pre|new) IN.ipa OUT.ipa SCRATCH
# pre = iFizBox's signer from the commit before B413 (the one that put NSFileProtectionComplete in);
# new = this tree's signer (B413). Both sign with SideDrop's certificate and ad hoc profile and the group fix dylib.
set -euo pipefail
v=$1 in=$2 out=$3 S=$4
K=$HOME/sync/default/signing/rsideload; p12=$K/cert.p12; pw=$(cat $K/password.txt); prof=$K/sidedrop-adhoc.mobileprovision
sec=$XDG_RUNTIME_DIR/ifizbox-r87; mkdir -p $sec; chmod 700 $sec; trap 'rm -f $sec/*' EXIT
r=$(cd "$(dirname "$0")/../.." && pwd); [ $v = pre ] && r=$S/pre
openssl pkcs12 -legacy -in "$p12" -passin "pass:$pw" -nocerts -nodes -out $sec/key.pem 2>/dev/null
openssl pkcs12 -legacy -in "$p12" -passin "pass:$pw" -clcerts -nokeys 2>/dev/null | openssl x509 -outform der -out $sec/cert.der
issuer=$(openssl x509 -inform der -in $sec/cert.der -noout -issuer)
case $issuer in *G6*) w=AppleWWDRCAG6;; *G5*) w=AppleWWDRCAG5;; *G4*) w=AppleWWDRCAG4;; *) w=AppleWWDRCAG3;; esac
rm -f "$out"
SIGNBENCH_KEY_PEM=$sec/key.pem SIGNBENCH_CHAIN=$r/native/sign/certs/$w.cer:$r/native/sign/certs/AppleIncRootCertificate.cer \
  SIGNBENCH_GROUPFIX=$r/web/app/vendor/groupfix/ifizbox-groupfix.dylib \
  $r/native/sign/bench/build/signbench-linux "$in" "$out" $sec/cert.der $sec/cert.der $prof | grep -v -E '^(STAGE|TOTAL|PEAK)|%$' || true
