#!/usr/bin/env python3
"""The made-up world of the showcase recordings (capture.mjs's fake bridge reads it). Nothing in it is real: the
sources, apps, tweaks, icons and names are all invented here, on .example hosts, so no one's brand shows as ours.

    python3 marketing/video/make_state.py OUT_DIR [--promo]

Writes
    OUT_DIR/www/<host>/<path>          what each source answers (AltStore sources, APT repos, icons as SVG)
    OUT_DIR/www-update/<host>/<path>   laid over www once a script's {"world": "update"} step ran: the demo app's update
    OUT_DIR/etc/apt/sources.list.d/    the jailbreak build's own sources
    OUT_DIR/var/lib/dpkg/status        its installed packages
Stdlib only.
"""
import gzip
import io
import json
import sys
import tarfile
from datetime import date, timedelta
from pathlib import Path

APPS = "harbor.example"     # the AltStore source the Lite recording adds
TWEAKS = "lamplight.example"      # the APT repo the jailbreak recording adds
REPO_ICON = "Cydia" + "Icon.png"  # the file name every APT repo's icon has
SHORE = "driftwood.example"      # the APT repo the promo clip adds in the Lite build: a tweak made for Tidewell
BASE = "fernhill.example"       # the one it already has


def day(n):
    return (date.today() - timedelta(days=n)).isoformat()


def icon(top, bottom, art):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><defs>'
            f'<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{top}"/>'
            f'<stop offset="1" stop-color="{bottom}"/></linearGradient></defs>'
            f'<rect width="256" height="256" fill="url(#g)"/>{art}</svg>')


W = 'fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"'
ICONS = {
    "tidewell": icon("#37b3d8", "#1566a8",
                     f'<circle cx="176" cy="78" r="28" fill="#ffe08a"/><path {W} d="M28 150q33-34 66 0t66 0 68 0"/>'
                     f'<path {W} opacity=".7" d="M28 198q33-34 66 0t66 0 68 0"/>'),
    "kiteline": icon("#f28a5b", "#cf4a3c", f'<path {W} d="M128 40l62 70-62 62-62-62zM128 172q-24 22 0 44"/>'),
    "stovetop": icon("#8a86d8", "#4f46a3", f'<circle cx="128" cy="134" r="66" {W}/><path {W} d="M128 134V92M104 40h48"/>'),
    "loftcast": icon("#e46c9c", "#a53273", f'<path {W} d="M128 56v88M92 92v34a36 36 0 0 0 72 0V92M128 176v34"/>'),
    "harbor": icon("#3d6d9c", "#1e3d63", f'<circle cx="128" cy="62" r="20" {W}/><path {W} d="M128 82v122M58 142a70 62 0 0 0 140 0M92 112h72"/>'),
    "lamplight": icon("#f0b64a", "#c67a1e", f'<path {W} d="M88 84h80v104H88zM108 84V60h40v24M128 112v48"/>'),
    "fernhill": icon("#7c8894", "#47525e", f'<path {W} d="M40 196l88-132 88 132zM128 196l-30-44M128 196l30-44"/>'),
}


def shot(bg, sun, bars, title):
    """A screen of the made-up Tidewell app, as the source's screenshot."""
    waves = "".join(f'<rect x="{30 + i * 44}" y="{520 - h}" width="28" height="{h}" rx="8" fill="#fff" opacity="{.45 + i * .06:.2f}"/>'
                    for i, h in enumerate(bars))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844" viewBox="0 0 390 844"><rect width="390" height="844" fill="{bg}"/>'
            f'<circle cx="300" cy="170" r="52" fill="{sun}"/><g font-family="Helvetica Neue,Helvetica,Arial" fill="#fff">'
            f'<text x="30" y="130" font-size="40" font-weight="700">{title}</text><text x="30" y="172" font-size="22" opacity=".85">Cedar Bay</text></g>'
            f'{waves}<path d="M0 580q98-60 195 0t195 0v264H0z" fill="#fff" opacity=".22"/><path d="M0 650q98-60 195 0t195 0v194H0z" fill="#fff" opacity=".25"/></svg>')


def app(slug, name, subtitle, text, versions, shots=0, category="utilities"):
    u = f"https://{APPS}"
    return {"name": name, "bundleIdentifier": f"example.demo.{slug}", "developerName": "Cedar Bay Software", "subtitle": subtitle,
            "localizedDescription": text, "iconURL": f"{u}/icons/{slug}.svg", "tintColor": "#1f78b4", "category": category,
            "screenshotURLs": [f"{u}/shots/{slug}-{i + 1}.svg" for i in range(shots)],
            "versions": [{"version": v, "date": day(d), "size": size, "downloadURL": f"{u}/{slug}-{v}.ipa",
                          "localizedDescription": note, "minOSVersion": "15.0"} for v, d, size, note in versions]}


def tidewell(update):
    v = [("2.3.0", 9, 18_400_000, "Faster charts.")]
    if update:
        v.insert(0, ("2.4.0", 0, 18_900_000, "A week of tides at a glance, and sunset times."))
    return app("tidewell", "Tidewell", "Tide times for your beach",
               "High and low water, sunrise and sunset for the beaches you like. No account, no ads.", v, shots=3, category="lifestyle")


def apps_source(update):
    return {"name": "Harbor Apps", "identifier": "example.harborapps", "subtitle": "Small, tidy apps", "iconURL": f"https://{APPS}/icons/harbor.svg",
            "tintColor": "#2b5a86", "apps": [
                tidewell(update),
                app("kiteline", "Kiteline", "One-thumb kite flying", "Keep the kite up.", [("1.8", 20, 31_000_000, "New beaches.")], category="games"),
                app("stovetop", "Stovetop", "Kitchen timers that stack", "Several timers at once.", [("3.1", 33, 9_200_000, "Bigger buttons.")]),
                app("loftcast", "Loftcast", "A quiet podcast player", "Plays podcasts.", [("1.4.2", 41, 22_600_000, "Sleep timer.")], category="entertainment"),
            ], "news": []}



def stanza(host, pid, name, version, section, desc, art=None, size=48_000, **more):
    f = {"Package": pid, "Name": name, "Version": version, "Architecture": "iphoneos-arm64", "Section": section, "Maintainer": "Cedar Bay <hello@cedarbay.example>",
         "Author": "Cedar Bay", "Description": desc, "Installed-Size": "320", "Depends": "firmware (>= 15.0)"}
    if art:
        f["Icon"] = f"https://{host}/icons/{art}.svg"
    f.update(more)
    f.update({"Filename": f"./debs/{pid}_{version}.deb", "Size": str(size), "SHA256": "0" * 64})
    return f


TWEAK_LIST = [
    stanza(TWEAKS, "example.lamplight.softdock", "Softdock", "1.2", "Tweaks", "Rounds the dock and lets it float a little.", "softdock"),
    stanza(TWEAKS, "example.lamplight.dockshade", "Dockshade", "0.9.1", "Tweaks", "A softer shade behind the dock.", "dockshade"),
    stanza(TWEAKS, "example.lamplight.quietbar", "Quietbar", "2.0", "Tweaks", "Hides what you don't need in the status bar.", "quietbar"),
    stanza(TWEAKS, "example.lamplight.longnight", "Long Night", "1.1", "Themes", "Darker icons for the evening.", "longnight"),
]
SHORE_LIST = [stanza(SHORE, "example.driftwood.nightcharts", "Night Charts", "1.0", "Tweaks", "A dark look for the charts in Tidewell.", "nightcharts")]
ICONS.update({
    "driftwood": icon("#9a8468", "#5a4a36", f'<path {W} d="M48 176c40-8 72-40 96-92M96 176c32-4 56-28 72-64"/>'),
    "nightcharts": icon("#2a3a66", "#101a38", f'<path {W} d="M52 180V120M100 180V80M148 180V140M196 180V100"/>'),
    "softdock": icon("#6aa7e8", "#2d62b5", f'<rect x="36" y="150" width="184" height="60" rx="24" {W}/><path {W} d="M84 110h88"/>'),
    "dockshade": icon("#8b93a7", "#4a5166", f'<rect x="36" y="140" width="184" height="70" rx="18" fill="#fff" opacity=".55"/>'),
    "quietbar": icon("#58c2a3", "#23806a", f'<path {W} d="M40 80h176M40 128h104M40 176h52"/>'),
    "longnight": icon("#4c4f8f", "#22244f", f'<path {W} d="M170 176a72 72 0 1 1-34-128 58 58 0 0 0 34 128z"/>'),
})
# what the jailbroken phone already has: (id, name, version, section, description)
BASE_LIST = [
    ("apt", "APT", "2.7.10", "Packaging", "The package manager's engine."),
    ("dpkg", "dpkg", "1.22.6", "Packaging", "Unpacks packages."),
    ("bash", "Bash", "5.2.21", "Terminal Support", "A shell."),
    ("coreutils", "Coreutils", "9.4", "Utilities", "The basic commands."),
    ("firmware-sbin", "Firmware Tools", "0-2", "System", "Small system tools."),
    ("nano", "nano", "7.2", "Text Editors", "A text editor."),
    ("preferenceloader", "PreferenceLoader", "2.2.6", "System", "Shows tweak settings in Settings."),
]


def deb_bytes(dylib, ctl, bundle):
    """A .deb the app can read (ar of debian-binary, control.tar.gz, data.tar.gz): one tweak dylib and its filter plist,
    for the app `bundle`. The dylib's bytes are placeholders: the recordings sign nothing for real."""
    def tgz(files):
        raw = io.BytesIO()
        with tarfile.open(fileobj=raw, mode="w") as t:
            for path, data in files:
                i = tarfile.TarInfo(path)
                i.size = len(data)
                t.addfile(i, io.BytesIO(data))
        return gzip.compress(raw.getvalue(), mtime=0)
    plist = ('<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Filter</key><dict><key>Bundles</key><array>'
             f'<string>{bundle}</string></array></dict></dict></plist>').encode()
    base = f"Library/MobileSubstrate/DynamicLibraries/{dylib}"
    members = [("debian-binary", b"2.0\n"), ("control.tar.gz", tgz([("control", ctl.encode())])),
               ("data.tar.gz", tgz([(base + ".dylib", b"\xcf\xfa\xed\xfe" + bytes(60)), (base + ".plist", plist)]))]
    out = b"!<arch>\n"
    for name, data in members:
        out += f"{name + '/':<16}{0:<12}{0:<6}{0:<6}{100644:<8}{len(data):<10}`\n".encode() + data + (b"\n" if len(data) % 2 else b"")
    return out


def control(f, **extra):
    return "\n".join(f"{k}: {v}" for k, v in {**f, **extra}.items())


def release(name):
    return (f"Origin: {name}\nLabel: {name}\nSuite: stable\nVersion: 1.0\nCodename: ios\nArchitectures: iphoneos-arm64\n"
            f"Components: main\nDescription: {name}\n")


# --promo: the promo clip's world. Lamplight is already a source, and four of its tweaks are installed one release
# behind, so Changes opens with a badge and four upgrades
BEHIND = {"example.lamplight.softdock": "1.1", "example.lamplight.dockshade": "0.9", "example.lamplight.quietbar": "1.9",
          "example.lamplight.longnight": "1.0"}


def main(out, promo=False):
    out = Path(out)

    def put(path, text):
        p = out / path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text if isinstance(text, str) else json.dumps(text, indent=1), encoding="utf-8")

    for update, top in ((False, "www"), (True, "www-update")):
        put(f"{top}/{APPS}/apps.json", apps_source(update))
    for host in (APPS, TWEAKS, BASE, SHORE):
        for slug, svg in ICONS.items():
            put(f"www/{host}/icons/{slug}.svg", svg)
    for i, (bg, sun, bars, title) in enumerate([("#1d74ad", "#ffe08a", (70, 130, 210, 260, 220, 140, 80, 60), "Today"),
                                                ("#155a75", "#ffc27a", (200, 150, 90, 70, 120, 190, 240, 250), "This Week"),
                                                ("#243b63", "#e8ecf7", (90, 60, 80, 150, 220, 250, 190, 120), "Tonight")]):
        put(f"www/{APPS}/shots/tidewell-{i + 1}.svg", shot(bg, sun, bars, title))
    base = [stanza(BASE, p, n, v, s, d) for p, n, v, s, d in BASE_LIST]
    for host, name, art, rows in ((TWEAKS, "Lamplight", "lamplight", TWEAK_LIST), (BASE, "Fernhill", "fernhill", base), (SHORE, "Driftwood", "driftwood", SHORE_LIST)):
        put(f"www/{host}/Packages", "\n\n".join(control(r) for r in rows) + "\n")
        put(f"www/{host}/Release", release(name))
        put(f"www/{host}/%s.svg" % REPO_ICON, ICONS[art])
    for r in SHORE_LIST:  # the Lite promo clip adds this tweak to Tidewell
        d = out / "www" / SHORE / r["Filename"][2:]
        d.parent.mkdir(parents=True, exist_ok=True)
        d.write_bytes(deb_bytes(r["Name"], control({k: v for k, v in r.items() if k not in ("Filename", "Size", "SHA256")}), "example.demo.tidewell"))
    put("etc/apt/sources.list.d/fernhill.sources", f"Types: deb\nURIs: https://{BASE}/\nSuites: ./\n")
    skip = ("Filename", "Size", "SHA256")
    have = list(base)
    if promo:
        put("etc/apt/sources.list.d/lamplight.sources", f"Types: deb\nURIs: https://{TWEAKS}/\nSuites: ./\n")
        have += [{**r, "Version": BEHIND[r["Package"]]} for r in TWEAK_LIST]
    put("var/lib/dpkg/status", "\n\n".join(control({k: v for k, v in r.items() if k not in skip}, Status="install ok installed") for r in have) + "\n")
    print(f"{len(TWEAK_LIST)} tweaks, {len(have)} installed packages, 1 AltStore source in {out}")


if __name__ == "__main__":
    main(sys.argv[1], "--promo" in sys.argv[2:])
