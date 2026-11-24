#!/usr/bin/env bash
# hidcode.sh: when WebDriverAgent died and iOS shows "Enter iPhone Passcode for XCTest", type the throwaway passcode with HID taps
# (no WDA needed; the keypad of that sheet is where Settings' passcode keypad is). Then ui-15.sh up brings WDA back.
rig=$HOME/.local/share/ifizbox-rig
cd "$(dirname "$0")/../.."
if curl -s -m 4 http://127.0.0.1:8100/status >/dev/null; then exit 0; fi
echo "WDA not answering: typing the passcode by HID"
(XDG_RUNTIME_DIR=/run/user/1000 tools/ui-15.sh R89 up >/dev/null 2>&1 &) ; sleep 25
cd $rig
for d in 1 5 9 3 5 7; do case $d in 1) x=95; y=421;; 3) x=297; y=421;; 5) x=196; y=517;; 7) x=95; y=613;; 9) x=297; y=613;; esac
  pymobiledevice3 developer core-device universal-hid-service tap -- $((x*65535/393)) $((y*65535/852)) >/dev/null 2>&1; sleep 0.4; done
sleep 15; curl -s -m 4 http://127.0.0.1:8100/status | head -c 60; echo
