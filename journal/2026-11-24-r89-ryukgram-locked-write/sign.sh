#!/usr/bin/env bash
# sign.sh IN.ipa OUT.ipa GROUPFIX.dylib: this tree's signer (B413: default data protection only when the original signature asks
# for Complete) with SideDrop's certificate and ad hoc profile, and the given group fix dylib.
set -euo pipefail
in=$1 out=$2 dy=$3
K=$HOME/sync/default/signing/rsideload; p12=$K/cert.p12; pw=$(cat $K/password.txt); prof=$K/sidedrop-adhoc.mobileprovision
sec=$XDG_RUNTIME_DIR/ifizbox-r89; mkdir -p $sec; chmod 700 $sec; trap 'rm -f $sec/*' EXIT
r=$(cd "$(dirname "$0")/../.." && pwd)
openssl pkcs12 -legacy -in "$p12" -passin "pass:$pw" -nocerts -nodes -out $sec/key.pem 2>/dev/null
openssl pkcs12 -legacy -in "$p12" -passin "pass:$pw" -clcerts -nokeys 2>/dev/null | openssl x509 -outform der -out $sec/cert.der
case $(openssl x509 -inform der -in $sec/cert.der -noout -issuer) in *G6*) w=AppleWWDRCAG6;; *G5*) w=AppleWWDRCAG5;; *G4*) w=AppleWWDRCAG4;; *) w=AppleWWDRCAG3;; esac
rm -f "$out"
SIGNBENCH_KEY_PEM=$sec/key.pem SIGNBENCH_CHAIN=$r/native/sign/certs/$w.cer:$r/native/sign/certs/AppleIncRootCertificate.cer SIGNBENCH_GROUPFIX=$dy \
  $r/native/sign/bench/build/signbench-linux "$in" "$out" $sec/cert.der $sec/cert.der $prof | grep -v -E '^(STAGE|TOTAL|PEAK)|%$' || true
echo "$out: $(unzip -p "$out" Payload/Instagram.app/Instagram | strings | grep -c default-data-protection || true) default-data-protection strings"
