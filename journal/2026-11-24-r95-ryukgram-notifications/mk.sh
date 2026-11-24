#!/usr/bin/env bash
# mk.sh NAME [GROUPFIX.dylib|none]: RyukGram 456 IPA ($RY_IPA) + the probe (spy.m built to $S/ryspy.dylib) -> $S/NAME.ipa,
# signed with SideDrop's identity and ad hoc profile (R89's sign.sh) and the given group fix dylib (none: upstream, no fix).
set -euo pipefail
cd "$(dirname "$0")/../.."; J=journal/2026-11-24-r95-ryukgram-notifications; S=$R95_SCRATCH
rm -rf $S/ry; mkdir $S/ry; (cd $S/ry && unzip -q $RY_IPA)
python3 -I journal/2026-11-23-b390-ryukgram/prep.py $S/ry/Payload/Instagram.app $S/ryspy.dylib >/dev/null; rm -f $S/ry/Payload/Instagram.app/ryspy-set.plist
(cd $S/ry && rm -f ../spy-in.ipa && zip -qr ../spy-in.ipa Payload)
if [ "${2:-}" = none ]; then
  journal/2026-11-24-r89-ryukgram-locked-write/sign.sh $S/spy-in.ipa $S/$1.ipa "" | tail -1
else journal/2026-11-24-r89-ryukgram-locked-write/sign.sh $S/spy-in.ipa $S/$1.ipa $2 | tail -1; fi
