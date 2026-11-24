#!/usr/bin/env bash
# prefs.sh LABEL [BUNDLE]: pull the app's preferences plist over USB and print only counts (no values): key count, how many of
# the keys are RyukGram's own (hide_*, no_*, and other lower-case names with an underscore), whether r89 marker keys are there.
S=$R89_SCRATCH; id=${2:-com.burbn.instagram}; f=$S/pull/$1.plist; rm -f $f
cd ~/.local/share/ifizbox-rig && timeout 120 pymobiledevice3 apps pull $id "Library/Preferences/$id.plist" $f >/dev/null 2>&1
python3 -I - $f "$1" <<'P'
import plistlib, sys, re, os
f, label = sys.argv[1:3]
if not os.path.exists(f): print(label, "pull failed"); sys.exit(0)
d = plistlib.load(open(f, "rb"))
ryuk = [k for k in d if re.fullmatch(r"[a-z][a-z0-9]*(_[a-z0-9]+)+", k)]
print(f"{label}: {len(d)} keys, {len(ryuk)} snake_case (RyukGram-style) keys, r89 keys: {sorted(k for k in d if k.startswith('r89'))}, seed keys {sum(1 for k in d if k.startswith('seed'))}")
open(f + ".keys", "w").write("\n".join(sorted(d)))
P
