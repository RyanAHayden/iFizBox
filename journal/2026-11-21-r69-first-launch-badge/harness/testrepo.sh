#!/bin/sh
# R69, run on the iPhone 7 as mobile: two throwaway packages (com.ryha.r69a, com.ryha.r69b) at 1.0 installed, 1.1 of
# each in a flat file: repo, so the upgrade daemon counts 2 upgrades the page can't see (the page fetches its own
# sources over http). `testrepo.sh clean` takes it all away again.
set -eu
W=/var/mobile/r69
L=/var/jb/etc/apt/sources.list.d/r69test.list
if [ "${1:-}" = clean ]; then
  sudo -n dpkg -r com.ryha.r69a com.ryha.r69b || true
  sudo -n rm -f "$L"
  sudo -n rm -f /var/jb/var/lib/apt/lists/_var_mobile_r69_repo_*
  rm -r "$W"
  exit 0
fi
mkdir -p "$W/repo"
for p in r69a r69b; do
  for v in 1.0 1.1; do
    d="$W/build/$p-$v"
    mkdir -p "$d/DEBIAN"
    printf 'Package: com.ryha.%s\nName: R69 Test %s\nVersion: %s\nArchitecture: iphoneos-arm64\nMaintainer: R69\nDescription: R69 throwaway test package\nSection: Utilities\n' "$p" "$p" "$v" > "$d/DEBIAN/control"
    dpkg-deb -Zxz -b "$d" "$W/$p-$v.deb" >/dev/null
  done
  sudo -n dpkg -i "$W/$p-1.0.deb" >/dev/null
  cp "$W/$p-1.1.deb" "$W/repo/"
done
: > "$W/repo/Packages"
for f in "$W"/repo/*.deb; do
  b=$(basename "$f")
  { dpkg-deb -f "$f"; echo "Filename: ./$b"; echo "Size: $(wc -c < "$f" | tr -d ' ')"
    echo "MD5sum: $(md5sum "$f" | cut -d' ' -f1)"; echo "SHA256: $(sha256sum "$f" | cut -d' ' -f1)"; echo; } >> "$W/repo/Packages"
done
echo "deb [trusted=yes] file:$W/repo ./" | sudo -n tee "$L" >/dev/null
sudo -n apt-get update -o Dir::Etc::sourcelist="$L" -o Dir::Etc::sourceparts=- -o APT::Get::List-Cleanup=0 2>&1 | tail -2
apt-get -s dist-upgrade 2>/dev/null | grep '^Inst' || true
