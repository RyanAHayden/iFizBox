#!/usr/bin/env bash
# pc.sh: type the throwaway test passcode 159357 on the keypad (points: x 95/196/297, y 421/517/613/709, taps in pixels).
cd "$(dirname "$0")/../.."
for d in 1 5 9 3 5 7; do
  case $d in 1) x=95; y=421;; 2) x=196; y=421;; 3) x=297; y=421;; 4) x=95; y=517;; 5) x=196; y=517;; 6) x=297; y=517;; 7) x=95; y=613;; 8) x=196; y=613;; 9) x=297; y=613;; 0) x=196; y=709;; esac
  tools/ui-15.sh R89 tap $((x*3)) $((y*3)) >/dev/null
done
