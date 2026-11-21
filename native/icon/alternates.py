"""The app's alternate icons: which icon sets Assets.car holds, and the files made from that one list.

Every theme has its own icon (icon/themes/<theme>/, tools/icons.sh), and Clear is one more (icon/clear/). iOS 18+
draws an icon set's dark appearance when the Home Screen is dark, so a set is a (light icon, dark icon) pair; iOS
15-17 only ever draw the light one. Sets (names as setAlternateIconName takes them, Sources/AppIcon.swift):

  AppIcon               the primary: Classic, with Gunmetal as its dark appearance (the default themes)
  Icon-<light>-<dark>   a pair: every light theme or Clear, with every dark theme or Clear
  Icon-<icon>           one icon in both appearances, for every icon: iOS 15-17, and pairs not listed above

Every light x dark pair of all 15 icons would be 225 sets. Measured on the MBA (actool, Xcode 26.3): a pair set at
60pt @2x and @3x costs about 244 KB of Assets.car and a one-icon set half that, so all 225 would make each build's
car about 55 MB. The pairs the themes and Clear give (58) and the 15 one-icon sets come to about 16 MB. A Light or
Dark override that picks another mode's theme icon (a dark theme's icon in Light) has no pair: the app shows the
icon of the theme on screen (Icon-<icon>), as on iOS 15-17.

    python3 native/icon/alternates.py sets             one set name per line
    python3 native/icon/alternates.py catalog DIR [--lite]   write DIR/Assets.xcassets for icon/assets.sh's actool
    python3 native/icon/alternates.py plist            rewrite Info.plist's CFBundleAlternateIcons block
    python3 native/icon/alternates.py thumbs DIR [--lite]    the 180 px icons the page shows (native/build.sh)
    python3 native/icon/alternates.py sources          sha256 of every PNG the catalogs are built from
    python3 native/icon/alternates.py render           icon/clear/*.png from clear.svg (needs rsvg-convert)
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys

ICON = os.path.dirname(os.path.abspath(__file__))
NATIVE = os.path.dirname(ICON)
ROOT = os.path.dirname(NATIVE)
PRIMARY = ("classic", "gunmetal")  # the defaults (core/settings.js lightTheme, darkTheme): AppIcon's two appearances
CLEAR = "clear"
SIZES = {20: (2, 3), 29: (2, 3), 40: (2, 3), 60: (2, 3)}  # carfile.ICON_SIZES; the primary has them all
ALT_SIZES = ((60, 2), (60, 3))  # alternates: the Home Screen's; iOS scales those down for Settings and notifications
# F324: the Glass icon, an Icon Composer document (icon/glass.py) and no PNG set: iOS 26+ draws it in Liquid Glass,
# older iOS actool's flat render of it. Not in sets() (those are PNG sets); Info.plist lists it after them.
GLASS = "glass"
GLASS_SET = "Icon-glass"


def themes():
    """(lights, darks): theme-boot.js's theme names, in its order."""
    with open(os.path.join(ROOT, "web", "app", "theme-boot.js")) as f:
        js = f.read()
    out = {}
    for var in ("darks", "lights"):
        m = re.search(var + r"\s*=\s*\[([^\]]*)\]", js)
        out[var] = re.findall(r'"([a-z0-9-]+)"', m.group(1))
    return out["lights"], out["darks"]


def icons():
    lights, darks = themes()
    return lights + darks + [CLEAR]


def pairs():
    """The (light, dark) pairs with a set of their own."""
    lights, darks = themes()
    return [(l, d) for l in lights + [CLEAR] for d in darks + [CLEAR] if l != d and (l, d) != PRIMARY]


def set_name(light, dark=None):
    return "Icon-%s" % light if dark is None or dark == light else "Icon-%s-%s" % (light, dark)


def sets():
    """Every alternate set: name -> (light icon, dark icon or None)."""
    out = {set_name(i): (i, None) for i in icons()}
    out.update({set_name(l, d): (l, d) for l, d in pairs()})
    return out


def src(icon, pt, scale, lite):
    """An icon's PNG at a size: Clear has no LITE sash (user 2026-11-20), the themes' Lite build has."""
    stem = "AppIconLite" if lite and icon != CLEAR else "AppIcon"
    folder = os.path.join(ICON, "clear") if icon == CLEAR else os.path.join(ICON, "themes", icon)
    name = "%s1024.png" % stem if pt == 1024 else "%s%dx%d@%dx.png" % (stem, pt, pt, scale)
    return os.path.join(folder, name)


def primary_files(lite):
    """The primary set: (catalog file name, source path, appearance) for every size, light then dark."""
    stem = "AppIconLite" if lite else "AppIcon"
    out = []
    for dark in (False, True):
        tag = stem + ("Dark" if dark else "")
        for pt, scales in SIZES.items():
            for s in scales:
                name = "%s%dx%d@%dx.png" % (stem, pt, pt, s)
                path = src(PRIMARY[1], pt, s, lite) if dark else os.path.join(ICON, name)
                out.append(("%s%dx%d@%dx.png" % (tag, pt, pt, s), path, "dark" if dark else None, "%dx%d" % (pt, pt), s))
        path = src(PRIMARY[1], 1024, 1, lite) if dark else os.path.join(ICON, stem + "1024.png")
        out.append((tag + "1024.png", path, "dark" if dark else None, "1024x1024", 1))
    return out


def alt_name(icon, pt, scale, lite):
    """A rendition's file name in the catalog (carfile.renditions reads it back): <icon>[-lite]-60x60@2x.png."""
    return "%s%s-%dx%d@%dx.png" % (icon, "-lite" if lite and icon != CLEAR else "", pt, pt, scale)


def set_files(name, lite):
    """(catalog file name, source path, appearance, size, scale) for an alternate set."""
    light, dark = sets()[name]
    out = []
    for icon, look in ((light, None), (dark, "dark")):
        if icon is None:
            continue
        for pt, s in ALT_SIZES:
            out.append((alt_name(icon, pt, s, lite), src(icon, pt, s, lite), look, "%dx%d" % (pt, pt), s))
    return out


def entry(f):
    fname, _, look, size, scale = f
    e = {"idiom": "universal", "platform": "ios", "size": size, "filename": fname}
    if size != "1024x1024":
        e["scale"] = "%dx" % scale
    if look:
        e["appearances"] = [{"appearance": "luminosity", "value": look}]
    return e


def write_set(folder, files):
    os.makedirs(folder, exist_ok=True)
    for f in files:
        shutil.copyfile(f[1], os.path.join(folder, f[0]))
    with open(os.path.join(folder, "Contents.json"), "w") as out:
        json.dump({"images": [entry(f) for f in files], "info": {"author": "xcode", "version": 1}}, out, indent=1)


def catalog(dest, lite):
    """dest/Assets.xcassets: AppIcon and every alternate set, in the universal (Xcode 14+) form, the only one whose
    dark appearance actool keeps (the old iphone-idiom sets drop it as "unassigned children")."""
    cat = os.path.join(dest, "Assets.xcassets")
    if os.path.isdir(cat):
        shutil.rmtree(cat)
    os.makedirs(cat)
    with open(os.path.join(cat, "Contents.json"), "w") as out:
        json.dump({"info": {"author": "xcode", "version": 1}}, out)
    write_set(os.path.join(cat, "AppIcon.appiconset"), primary_files(lite))
    for name in sets():
        write_set(os.path.join(cat, name + ".appiconset"), set_files(name, lite))
    return cat


BEGIN = "<!-- F323: the alternate icons, written by icon/alternates.py plist (do not edit): Sources/AppIcon.swift switches -->"
END = "<!-- end of icon/alternates.py's block -->"


# F329: your own icon. Two sets of loose PNGs (CFBundleIconFiles, not the catalog), placeholders in the build
# (native/build.sh copies the primary icon), that the jailbreak build's root helper overwrites with your picture
# (helper/ownicon.h). Listed from the start, so applying one changes no Info.plist and needs no uicache (which closes
# the running app); two, so a new picture goes into the set not on screen and the switch is a real change of name.
OWN_SLOTS = ("a", "b")
OWN_SIZES = (20, 29, 40, 60)  # every iPhone size the primary has: notifications, Settings, Spotlight, Home Screen


def own_set(slot):
    return "Icon-own%s" % slot


def own_stem(slot, pt=60):
    """A size's file stem: <stem>@2x.png and @3x.png in the app."""
    return "IconOwn%s%dx%d" % (slot.upper(), pt, pt)


def plist_block(indent="\t\t"):
    lines = [indent + BEGIN, indent + "<key>CFBundleAlternateIcons</key><dict>"]
    for name in list(sets()) + [GLASS_SET]:
        lines.append(indent + "\t<key>%s</key><dict><key>CFBundleIconName</key><string>%s</string></dict>" % (name, name))
    for slot in OWN_SLOTS:
        stems = "".join("<string>%s</string>" % own_stem(slot, pt) for pt in OWN_SIZES)
        lines.append(indent + "\t<key>%s</key><dict><key>CFBundleIconFiles</key><array>%s</array></dict>"
                     % (own_set(slot), stems))
    lines += [indent + "</dict>", indent + END]
    return "\n".join(lines)


def plist_text(text):
    """Info.plist with the block in CFBundleIcons (after CFBundlePrimaryIcon), replaced if there."""
    if BEGIN in text:
        start = text.index(BEGIN)
        start = text.rindex("\n", 0, start) + 1
        end = text.index(END) + len(END)
        return text[:start] + plist_block() + text[end:]
    anchor = re.search(r"(<key>CFBundlePrimaryIcon</key><dict>.*?\n\t\t</dict>)", text, re.S)
    return text[:anchor.end()] + "\n" + plist_block() + text[anchor.end():]


def thumbs(dest, lite):
    """dest/<icon>.png: each icon at 180 px (60pt @3x) as the Home Screen shows it in this build, for the page
    (Bridge.swift AppScheme serves them as ifizbox://app/appicon/<icon>.png)."""
    os.makedirs(dest, exist_ok=True)
    for i in icons():
        shutil.copyfile(src(i, 60, 3, lite), os.path.join(dest, i + ".png"))
    # F324: the Glass icon's flat picture (icon/glass.py thumb), no sash in either build
    shutil.copyfile(os.path.join(ICON, "glass", "AppIcon60x60@3x.png"), os.path.join(dest, GLASS + ".png"))


def sources():
    """path -> sha256 of every PNG either catalog is built from (icon/assets.sources records it)."""
    paths = set()
    for lite in (False, True):
        paths.update(f[1] for f in primary_files(lite))
        for name in sets():
            paths.update(f[1] for f in set_files(name, lite))
    out = {}
    for p in sorted(paths):
        with open(p, "rb") as f:
            out[os.path.relpath(p, ICON)] = hashlib.sha256(f.read()).hexdigest()
    return out


def render():
    """icon/clear/: Clear at every size the themes have, plain and (the same picture) Lite."""
    svg = os.path.join(ICON, "clear", "clear.svg")
    sizes = [(pt * s, "%dx%d@%dx" % (pt, pt, s)) for pt, scales in SIZES.items() for s in scales]
    sizes += [(60, "60x60"), (1024, "1024")]
    for px, tag in sizes:
        for stem in ("AppIcon", "AppIconLite"):
            out = os.path.join(ICON, "clear", "%s%s.png" % (stem, tag))
            if stem == "AppIconLite":
                shutil.copyfile(os.path.join(ICON, "clear", "AppIcon%s.png" % tag), out)
            else:
                subprocess.run(["rsvg-convert", "-w", str(px), "-h", str(px), svg, "-o", out], check=True)


def main(argv):
    cmd = argv[0] if argv else ""
    lite = "--lite" in argv
    if cmd == "sets":
        print("\n".join(sets()))
    elif cmd == "catalog":
        print(catalog(argv[1], lite))
    elif cmd == "plist":
        p = os.path.join(NATIVE, "Info.plist")
        with open(p) as f:
            text = f.read()
        new = plist_text(text)
        if new != text:
            with open(p, "w") as f:
                f.write(new)
    elif cmd == "thumbs":
        thumbs(argv[1], lite)
    elif cmd == "sources":
        for path, digest in sources().items():
            print("%s  %s" % (digest, path))
    elif cmd == "render":
        render()
    else:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
