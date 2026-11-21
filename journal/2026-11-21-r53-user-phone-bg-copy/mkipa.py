#!/usr/bin/env python3
# R53 test IPAs: the Tiny fixture's binary as com.ryha.r53test ("R53 Test", never launched), padded with random bytes.
#   mkipa.py <tiny-fixture.ipa> <out dir> <pad MB> <version> [<version> ...]
import os, sys, zipfile

fixture, out, pad_mb, versions = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4:]
os.makedirs(out, exist_ok=True)
with zipfile.ZipFile(fixture) as z:
    tiny = z.read("Payload/Tiny.app/Tiny")

PLIST = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.ryha.r53test</string>
<key>CFBundleName</key><string>R53 Test</string>
<key>CFBundleDisplayName</key><string>R53 Test</string>
<key>CFBundleExecutable</key><string>Tiny</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>{ver}</string>
<key>CFBundleVersion</key><string>{ver}</string>
<key>MinimumOSVersion</key><string>15.0</string>
<key>CFBundleSupportedPlatforms</key><array><string>iPhoneOS</string></array>
<key>UIDeviceFamily</key><array><integer>1</integer></array>
</dict></plist>
"""

for ver in versions:
    path = os.path.join(out, f"r53test-{ver}.ipa")
    with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as z:
        z.writestr("Payload/R53Test.app/Info.plist", PLIST.format(ver=ver))
        zi = zipfile.ZipInfo("Payload/R53Test.app/Tiny")
        zi.external_attr = 0o755 << 16
        z.writestr(zi, tiny)
        with z.open("Payload/R53Test.app/padding.bin", "w", force_zip64=True) as f:
            for _ in range(pad_mb):
                f.write(os.urandom(1 << 20))
    print(path, os.path.getsize(path))
