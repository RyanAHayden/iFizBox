for d in $(fold -w1 ~/.local/share/ifizbox-rig/B415-passcode); do python3 $(dirname $0)/q.py tap $d >/dev/null; done
