#!/usr/bin/env bash
# unlock.sh: wake the locked phone, swipe up, type the test passcode through WDA's labelled keypad buttons.
cd "$(dirname "$0")/../.."; J=journal/2026-11-24-r89-ryukgram-locked-write
tools/ui-15.sh R89 lock-button; sleep 1; tools/ui-15.sh R89 swipe 589 2530 589 900 0.2; sleep 2
for d in 1 5 9 3 5 7; do python3 -I $J/q.py tap $d >/dev/null; done
sleep 1; curl -s http://127.0.0.1:8100/wda/locked | tr -d '\n'; echo
