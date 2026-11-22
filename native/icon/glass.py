"""The app icon as Icon Composer documents (.icon), so iOS 26+ draws it in its own Liquid Glass: specular edges,
refraction, and the Home Screen's Default, Dark, Clear and Tinted looks.

An .icon is a folder: icon.json (the background fill and the layer groups, front first) and Assets/ (one SVG per
layer). Xcode 26's actool compiles it into Assets.car beside the asset catalog's PNG set of the same name
(icon/assets.sh). An .icon replaces a same-named .appiconset's PNGs whole, and costs ~3 MB of renders per set, so
only CAR_SETS go into the .car: the Glass icon (alternates.GLASS_SET, Classic in Light and Gunmetal in Dark), an
extra choice in Theme > App Icon with no PNG set (iOS 15-25 show actool's flat render of it). Every theme's set stays
the PNGs (iOS 26 makes their Clear and Tinted looks itself). `write` still makes a document for every set, for the
tests and for trying one.

Each icon's layers are the globe of tools/icon.svg.in, flat, as Icon Composer wants them (the system adds the depth):

  grid     the globe's meridian and three parallels, in the theme's ink, clipped to the sphere   (front group)
  sphere   the globe's face, in the theme's sphere colour                                          (globe group)
  rim      the wider disc behind it, in the theme's rim colour                                     (globe group)
  fill     the background, a two-stop vertical gradient from the theme's own ramp (icon.json, not a layer)

Colours come from tools/icon_themes.py's THEMES (the PNG icons' own table), so a theme's glass icon matches its
picture icon. A set's dark appearance (a light x dark pair, or AppIcon's Gunmetal) is the dark icon's layers and fill
through icon.json's *-specializations; a one-icon set names the same icon for both, as its PNG set does. Clear is
icon/clear/clear.svg's: bold white lines on a smoked slate sphere in a frosted rim, on frosted glass. The LITE sash is a picture, not glass: the .icon is the
same in both builds, so iOS 26+ shows no sash on the Lite build's Home Screen icon (the PNG sizes iOS 26 uses for
Settings and notifications come from the .icon too).

    python3 native/icon/glass.py write DIR      DIR/<set>.icon for every set
    python3 native/icon/glass.py car DIR        only the CAR_SETS ones (icon/assets.sh hands them to actool)
    python3 native/icon/glass.py show <icon>    the colours one icon's layers take, as JSON
    python3 native/icon/glass.py thumb          icon/glass/AppIcon60x60@3x.png, the page's thumbnail (rsvg-convert)
    python3 native/icon/glass.py tinted         icon/glass/AppIconTinted1024.png, AppIcon's tinted look (rsvg-convert)
    python3 native/icon/glass.py sources        one digest of everything `write` makes (icon/assets.sources)

Stdlib only: the gate (native/test_icons.py) writes them too.
"""
import json
import os
import re
import sys

ICON = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(ICON))
sys.path.insert(0, ICON)
import alternates  # noqa: E402
sys.path.insert(0, os.path.join(ROOT, "tools"))
import icon_themes  # noqa: E402  (its top level is stdlib; numpy only when it renders)

CX, CY = 512, 512  # the globe's centre on Icon Composer's 1024 pt canvas (the PNG master's sits 8 pt lower)
R_RIM, R_SPHERE = 287, 230
STROKE = 22
TILT = -16


def classic_ramp():
    """tools/icon_bg.py's STOPS (the Classic starburst's ramp), read as text: icon_bg itself imports numpy."""
    with open(os.path.join(ROOT, "tools", "icon_bg.py")) as f:
        m = re.search(r"^STOPS = (\[.*\])$", f.read(), re.M)
    return [(float(p), c) for p, c in re.findall(r"\(([\d.]+), \"([0-9a-f]{6})\"\)", m.group(1))]


def at(stops, y):
    """A ramp's colour at y (0 top .. 1 bottom), no '#'."""
    for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
        if p0 <= y <= p1:
            return icon_themes.mix(c0, c1, 0 if p1 == p0 else (y - p0) / (p1 - p0))
    return stops[-1][1]


def fill_of(stops):
    """The background: the ramp's lit upper part down to its deep middle (a two-stop gradient can't hold the whole
    ramp's light-dark-light; the system's own light does the rest)."""
    return [at(stops, .12), at(stops, .5)]


# icon/clear/clear.svg's: the frosted glass's ramp, the frosted ring's middle, the smoked slate sphere's middle, white
# lines. All opaque: the old white-on-white (a faint sphere, white lines) read as iOS's blank placeholder at 20 pt.
CLEAR = {"fill": ["f6f7f9", "c8cdd5"], "rim": ("e7eaee", 1), "sphere": ("5f6c7e", 1), "grid": ("ffffff", 1)}
CLEAR_STROKE = 34  # clear.svg's bold lines, so the globe still reads at 20 pt


def colours(icon):
    """{"fill": [top, bottom], "rim": (hex, opacity), "sphere": (...), "grid": (...)} for an icon, no '#'."""
    if icon == alternates.CLEAR:
        return CLEAR
    kind, *p = icon_themes.THEMES[icon]
    h = lambda c: c.lstrip("#")  # noqa: E731
    if kind == "classic":
        # tools/icon.svg.in's own: the sphere gradient's middle, the rim's lit side, the ink's top
        return {"fill": fill_of(classic_ramp()), "rim": ("ffffff", 1), "sphere": ("e3e7ec", 1), "grid": ("5a6473", 1)}
    if kind == "tone":
        dark, light, sph, rim, ink = p
        if not icon_themes._ORIG:
            icon_themes._ORIG.extend(classic_ramp())
        return {"fill": fill_of(icon_themes.tone(dark, light)), "rim": (h(rim[0]), 1), "sphere": (h(sph[1]), 1),
                "grid": (h(ink[0]), 1)}
    stops, _glow, acc = p
    sph, rim, ink = icon_themes.glass(acc)
    return {"fill": fill_of(stops), "rim": (h(rim[0]), 1), "sphere": (h(sph[1]), 1), "grid": (h(ink[0]), 1)}


def svg(body):
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">\n%s\n</svg>\n'
            % body)


def layer_svgs(icon):
    """{layer name: SVG text} for an icon."""
    c = colours(icon)
    stroke = CLEAR_STROKE if icon == alternates.CLEAR else STROKE
    disc = lambda r, col: svg('  <circle cx="%d" cy="%d" r="%d" fill="#%s"/>' % (CX, CY, r, col))  # noqa: E731
    # tools/icon.svg.in's grid, moved up to the canvas centre (its globe sits at 512,520)
    d = -8
    lines = ('    <ellipse cx="%d" cy="%d" rx="126.5" ry="234.6"/>\n' % (CX, CY)
             + "".join('    <path d="M%.1f %.1f Q512 %.1f %.1f %.1f"/>\n' % (x0, y + d, q + d, x1, y + d)
                       for x0, y, q, x1 in ((305.7, 393.0, 459.3, 718.3), (270.7, 521.8, 588.1, 753.3),
                                            (311.9, 641.4, 707.7, 712.1))))
    grid = svg('  <defs><clipPath id="g"><circle cx="%d" cy="%d" r="%d"/></clipPath></defs>\n'
               '  <g clip-path="url(#g)"><g transform="rotate(%d %d %d)" fill="none" stroke="#%s" stroke-width="%d" '
               'stroke-linecap="round">\n%s  </g></g>\n'
               '  <circle cx="%d" cy="%d" r="%d" fill="none" stroke="#%s" stroke-width="%d"/>'
               % (CX, CY, R_SPHERE, TILT, CX, CY, c["grid"][0], stroke, lines, CX, CY, R_SPHERE, c["grid"][0], stroke))
    return {"grid": grid, "sphere": disc(R_SPHERE, c["sphere"][0]), "rim": disc(R_RIM, c["rim"][0])}


def srgb(hexc, alpha=1.0):
    r, g, b = icon_themes.hx(hexc)
    return "srgb:%.5f,%.5f,%.5f,%.5f" % (r / 255, g / 255, b / 255, alpha)


def specialized(key, light, dark):
    """A layer's or the document's `key` with a dark appearance: icon.json's <key>-specializations list."""
    return {key + "-specializations": [{"value": light}, {"appearance": "dark", "value": dark}]}


def document(light, dark):
    """icon.json for a set whose light appearance is icon `light` and dark is icon `dark`."""
    cl, cd = colours(light), colours(dark)
    doc = specialized("fill", {"linear-gradient": [srgb(x) for x in cl["fill"]]},
                      {"linear-gradient": [srgb(x) for x in cd["fill"]]})

    def layer(name):
        out = {"glass": True, "name": name, "position": {"scale": 1, "translation-in-points": [0, 0]}}
        out.update(specialized("image-name", "%s-%s.svg" % (light, name), "%s-%s.svg" % (dark, name)))
        if cl[name][1] != 1 or cd[name][1] != 1:
            out.update(specialized("opacity", cl[name][1], cd[name][1]))
        return out

    group = lambda name, layers, translucency: {  # noqa: E731
        "name": name, "layers": layers, "shadow": {"kind": "neutral", "opacity": 0.5}, "specular": True,
        "translucency": {"enabled": translucency, "value": 0.5}}
    doc["groups"] = [group("grid", [layer("grid")], False), group("globe", [layer("sphere"), layer("rim")], True)]
    doc["supported-platforms"] = {"squares": ["iOS"]}
    return doc


def write_icon(dest, name, light, dark):
    """dest/<name>.icon for one set."""
    folder = os.path.join(dest, name + ".icon")
    os.makedirs(os.path.join(folder, "Assets"), exist_ok=True)
    for icon in sorted({light, dark}):
        for layer, text in layer_svgs(icon).items():
            with open(os.path.join(folder, "Assets", "%s-%s.svg" % (icon, layer)), "w") as f:
                f.write(text)
    with open(os.path.join(folder, "icon.json"), "w") as f:
        json.dump(document(light, dark), f, indent=2, sort_keys=True)
        f.write("\n")
    return folder


def all_sets():
    """Every set's (light, dark) icons, AppIcon first: alternates.py's sets, a one-icon set dark as itself, then the
    Glass icon's own set."""
    out = {"AppIcon": alternates.PRIMARY}
    for name, (light, dark) in alternates.sets().items():
        if light in alternates.ERA_ICONS:
            continue  # F371: the eras' icons are flat pictures with no layers here (icon/era/make.py)
        out[name] = (light, dark or light)
    out[alternates.GLASS_SET] = alternates.PRIMARY
    return out


# The sets whose .icon goes into Assets.car (icon/assets.sh). Only the Glass icon's (user 2026-11-21): actool drops a
# same-named .appiconset's PNGs for the .icon (iOS 15-25 would get actool's flattened render, no LITE sash) and
# stores ~3 MB of 1024 px renders per set, so every theme's set stays a PNG set and the glass one is an extra choice,
# a set of its own with no PNG set (alternates.GLASS_SET): Classic in Light, Gunmetal in Dark. iOS 15-25 show
# actool's flat render of it.
CAR_SETS = (alternates.GLASS_SET,)


def flat_svg(icon):
    """One icon's layers on its fill as a single flat picture (no system glass): the 180 px thumbnail the page shows
    for the Glass icon (icon/glass/AppIcon60x60@3x.png, `glass.py thumb`)."""
    c = colours(icon)
    inner = lambda s: s.split("\n", 1)[1].rsplit("\n</svg>", 1)[0]  # noqa: E731
    layers = layer_svgs(icon)
    grad = ('  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#%s"/>'
            '<stop offset="1" stop-color="#%s"/></linearGradient></defs>\n'
            '  <rect width="1024" height="1024" fill="url(#bg)"/>' % tuple(c["fill"]))
    return svg("\n".join([grad, inner(layers["rim"]), inner(layers["sphere"]), inner(layers["grid"])]))


THUMB = os.path.join(ICON, "glass", "AppIcon60x60@3x.png")


def thumb():
    """icon/glass/AppIcon60x60@3x.png from flat_svg (needs rsvg-convert): the Glass icon's light look, the same in
    both builds (no LITE sash: the .icon is one picture for both). F371: and AppIconDark60x60@3x.png
    (alternates.GLASS_DARK_THUMB), its dark (Gunmetal) look, for Dark's grid and Home's header in dark mode."""
    import subprocess
    import tempfile
    os.makedirs(os.path.dirname(THUMB), exist_ok=True)
    for icon, out in ((alternates.PRIMARY[0], THUMB), (alternates.PRIMARY[1], alternates.GLASS_DARK_THUMB)):
        with tempfile.NamedTemporaryFile("w", suffix=".svg", delete=False) as f:
            f.write(flat_svg(icon))
        try:
            subprocess.run(["rsvg-convert", "-w", "180", "-h", "180", f.name, "-o", out], check=True)
        finally:
            os.unlink(f.name)
    return THUMB


# The primary icon set's tinted appearance (alternates.primary_files): iOS 18+ draws it for the Home Screen's Tinted
# look, and iOS 26+ for Clear and Tinted too, as glass on the Home Screen's own tile (an icon without one gets iOS's
# own one-colour copy of the whole picture: the light starburst became an opaque white tile in Clear). So it is the
# globe only, on nothing: Clear's bold white lines and a faint face, which the system turns into its glass and tints.
# The same picture in both builds (no LITE sash, like Clear). The PNG set stays, so iOS 15-25 keep the pictures.
TINTED = alternates.TINTED
TINTED_FACE = 0.18  # the sphere's opacity: enough to show the globe's face, little enough to stay see-through


def tinted_svg():
    """The globe only, white on transparent, at 1024 px: the tinted appearance's picture."""
    inner = lambda s: s.split("\n", 1)[1].rsplit("\n</svg>", 1)[0]  # noqa: E731
    face = '  <circle cx="%d" cy="%d" r="%d" fill="#ffffff" fill-opacity="%s"/>' % (CX, CY, R_SPHERE, TINTED_FACE)
    return svg(face + "\n" + inner(layer_svgs(alternates.CLEAR)["grid"]))


def tinted():
    """icon/glass/AppIconTinted1024.png from tinted_svg (needs rsvg-convert), and the same picture at the alternate
    sets' sizes (alternates.tinted_src, F360: every theme icon set's tinted appearance)."""
    import subprocess
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".svg", delete=False) as f:
        f.write(tinted_svg())
    outs = [(1024, TINTED)] + [(pt * s, alternates.tinted_src(pt, s)) for pt, s in alternates.ALT_SIZES]
    try:
        for px, out in outs:
            subprocess.run(["rsvg-convert", "-w", str(px), "-h", str(px), f.name, "-o", out], check=True)
    finally:
        os.unlink(f.name)
    return TINTED


def write(dest, names=None):
    """dest/<set>.icon for the sets named (default: every set)."""
    os.makedirs(dest, exist_ok=True)
    return [write_icon(dest, name, l, d) for name, (l, d) in all_sets().items() if names is None or name in names]


def sources():
    """{"glass": sha256 of the CAR_SETS documents} ({} with none), for icon/assets.sources: a changed theme colour, layer or set
    list means the .car files are stale."""
    import hashlib
    import tempfile
    if not CAR_SETS:
        return {}
    h = hashlib.sha256()
    with tempfile.TemporaryDirectory() as d:
        write(d, CAR_SETS)
        for base, dirs, files in sorted(os.walk(d)):
            dirs.sort()
            for name in sorted(files):
                p = os.path.join(base, name)
                h.update(os.path.relpath(p, d).encode() + b"\0")
                with open(p, "rb") as f:
                    h.update(f.read())
    return {"glass": h.hexdigest()}


def main(argv):
    if len(argv) == 2 and argv[0] == "write":
        for p in write(argv[1]):
            print(p)
    elif len(argv) == 2 and argv[0] == "car":
        for p in write(argv[1], CAR_SETS):
            print(p)
    elif argv == ["thumb"]:
        print(thumb())
    elif argv == ["tinted"]:
        print(tinted())
    elif argv == ["sources"]:
        for path, digest in sources().items():
            print("%s  %s" % (digest, path))
    elif len(argv) == 2 and argv[0] == "show":
        print(json.dumps(colours(argv[1]), indent=1))
    else:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
