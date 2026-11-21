#!/usr/bin/env python3
"""The launch screen's images (docs/native.md, "Launch screen"): the pieces LaunchScreen.storyboard lays out against
the safe area, so the splash is the page's first frame on every screen (index.html #boot under the app's bars,
web/app/ios6.css with data-shell="app"):

- LaunchStripes: the pinstripes (--pin-dark 2.5 pt, --pin-light 5.5 pt, an 8 pt period), 600 pt wide (wider than
  any iPhone) and 1 pt tall: the storyboard stretches it down the screen at its own width, from the left edge as .boot
  draws them, so the stripes line up with the page's. (A full-screen image is too big: SplashBoard refuses a launch
  screen whose estimated size is over 25,000,000 bytes, and 1800x3600 px of RGBA was 25,924,736.)
- LaunchStatusStrip: the status-bar strip, from the screen top to the safe area top: plain black in every iOS 6 set,
  as the page's iOS 6 era draws it (ios6.css --site-strip under .navbar::before), and the bar's own flat colour in
  the iOS 7 and iOS 13 sets, whose page runs the bar up through the strip. 1 pt of one colour, stretched.
- LaunchNavTop / LaunchNavBottom: the nav bar's gloss (#bdcbdc to #597498) cut at its half: the top half fills the
  bar's first 22 pt (from the safe area top), the bottom half its last 22 pt.
- LaunchTabGloss: the tab bar's 48 pt gloss (#2f2f2f, #151515 at 49.5 %, then #000), pixel for pixel.
- LaunchNavShadow / LaunchTabShadow: the bars' 2.5 pt shadows, black at 18 % fading out.

The bar lines (highlight, bottom edge) are plain colour views in the storyboard. Stdlib only. Rerun after changing
the colours in ios6.css, then rerun native/launch/storyboard.sh (it compiles the storyboard on a Mac).

B203: every theme's frame too. THEMES holds each theme's bars and ground (from web/app/ios6.css and palettes.css;
native/test_launch_grounds.py checks them against the CSS), and themes/<key>/ gets that theme's images plus a copy
of LaunchScreen.storyboardc whose colour views are the theme's (the compiled view nib with its UIColor values
rewritten in place: no Mac needed). build.sh copies themes/ into both bundles as LaunchThemes/. The jailbreak build's
root helper copies the current theme's files over the bundle's own (ifizbox-helper launch-theme, Launch.swift), and
both builds' in-app cover loads LaunchThemes/<key>/ as a bundle of its own. Classic's images are the top-level ones,
byte for byte, so storyboard.sources stays valid.

    native/launch/make.py [OUT_DIR]   (default: native/launch/; themes/ is written beside the images)
"""
import pathlib
import shutil
import struct
import sys
import zlib

HERE = pathlib.Path(__file__).resolve().parent
PIN_DARK, PIN_LIGHT = (0xCB, 0xD0, 0xDA), (0xCE, 0xD3, 0xDC)
STRIPES_PT = (600, 1)  # wider than any iPhone; stretched down the screen
NAV_GLOSS = ((0xBD, 0xCB, 0xDC), (0x59, 0x74, 0x98))
TAB_GLOSS = ((0x2F, 0x2F, 0x2F), (0x15, 0x15, 0x15), 0.495, (0, 0, 0))
STATUS_STRIP = "000000"  # the iOS 6 era's status-bar strip in every theme (ios6.css --site-strip)
GLOSS_PX = 512  # rows in a stretched gloss image
STORYBOARD = "LaunchScreen.storyboardc"
VIEW_NIB = "Lvc-00-000-view-Lrt-00-000.nib"  # the root view's nib: every colour view is in it


def hexrgb(s):
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def stops(*pairs):
    """Gradient stops: (position 0..1, "rrggbb") pairs, as the CSS lists them."""
    return tuple((p, hexrgb(c)) for p, c in pairs)


# Each theme's empty frame (B203). Keys are Settings' palette values (web/app/core/settings.js): the light palettes
# (classic, sepia, solarized, legalpad, metal) and the dark ones (oled, gunmetal, midnight, linen, nord, dracula,
# leather, felt, wood).
#   strip:      the status-bar strip's colour, when not STATUS_STRIP's black (the iOS 7 and iOS 13 sets: their bar's)
#   pins:       the ground's --pin-dark, --pin-light (Linen: its weave's base twice, a stripe can't draw the weave)
#   nav_line:   the nav bar's bottom edge; nav_hi: its 1 pt top highlight (rrggbb, alpha)
#   nav_gloss:  the bar's 44 pt gloss; nav_shadow: the alpha its 2.5 pt shadow starts at (OLED Black has none)
#   tab_line:   the tab bar's 1 pt top line as the storyboard can draw it: a colour view on the bar's second point
#               (rrggbb, alpha), so a theme whose line is opaque has it 1 pt lower than the page (see the journal)
#   tab_gloss:  the bar's 48 pt from 1 pt down; tab_base: the bar's colour under it and on its first point
#   tab_shadow: the alpha the tab bar's 2.5 pt shadow starts at, when not 0.18 (White has none)
# Besides Settings' palettes, the eras' own (core/settings.js STYLE_PALETTES): white, and their OLED Black's launch
# sets (STYLE_LAUNCH): oled7, oled13, and iOS 13's White: white13.
CLASSIC_TAB = dict(tab_line=("ffffff", 0.1), tab_gloss=stops((0, "2f2f2f"), (0.495, "151515"), (0.495, "000000"),
                                                            (1, "000000")), tab_base="000000")
THEMES = {
    "classic": dict(pins=("cbd0da", "ced3dc"), nav_line="2d3642", nav_hi=("eff2f7", 1),
                    nav_gloss=stops((0, "bdcbdc"), (1, "597498")), nav_shadow=0.18, **CLASSIC_TAB),
    "sepia": dict(pins=("e6d9bd", "ebdfc5"), nav_line="3e2e1a", nav_hi=("f5ecdc", 1),
                  nav_gloss=stops((0, "d2bf9c"), (1, "8c6c43")), nav_shadow=0.18, **CLASSIC_TAB),
    "solarized": dict(pins=("e9e2cd", "eee8d5"), nav_line="0f3d5c", nav_hi=("e6f2fa", 1),
                      nav_gloss=stops((0, "9fcbea"), (1, "2f7fb8")), nav_shadow=0.18, **CLASSIC_TAB),
    "oled": dict(pins=("000000", "000000"), nav_line="1a1a1c", nav_hi=("ffffff", 0.16),
                 nav_gloss=stops((0, "333336"), (0.5, "151517"), (0.51, "070708"), (1, "000000")), nav_shadow=0,
                 tab_line=("1c1c1e", 1), tab_gloss=stops((0, "000000"), (1, "000000")), tab_base="000000"),
    "gunmetal": dict(pins=("2b2e33", "303338"), nav_line="0b0c0e", nav_hi=("7a808a", 1),
                     nav_gloss=stops((0, "5f656f"), (0.5, "3b4048"), (0.51, "30343b"), (1, "23262b")),
                     nav_shadow=0.5, **CLASSIC_TAB),
    "midnight": dict(pins=("0a1424", "0c172a"), nav_line="050a14", nav_hi=("ffffff", 0.18),
                     nav_gloss=stops((0, "2c3d5f"), (0.5, "18253e"), (0.51, "0f1a2f"), (1, "0a1424")),
                     nav_shadow=0.5, tab_line=("1a2740", 1), tab_gloss=stops((0, "070e1b"), (1, "070e1b")),
                     tab_base="070e1b"),
    "linen": dict(pins=("36383d", "36383d"), nav_line="000000", nav_hi=("ffffff", 0.18),
                  nav_gloss=stops((0, "4c4c4c"), (0.5, "262626"), (0.51, "141414"), (1, "000000")),
                  nav_shadow=0.5, **CLASSIC_TAB),
    "nord": dict(pins=("2e3440", "313744"), nav_line="1f232c", nav_hi=("ffffff", 0.15),
                 nav_gloss=stops((0, "4c566a"), (0.5, "3b4252"), (0.51, "343a48"), (1, "2b303b")), nav_shadow=0.35,
                 tab_line=("1f232c", 1), tab_gloss=stops((0, "3b4252"), (1, "2b303b")), tab_base="2b303b"),
    "dracula": dict(pins=("282a36", "2b2d3a"), nav_line="15161c", nav_hi=("ffffff", 0.15),
                    nav_gloss=stops((0, "4f5268"), (0.5, "383b4c"), (0.51, "2c2e3b"), (1, "21222c")),
                    nav_shadow=0.4, tab_line=("15161c", 1), tab_gloss=stops((0, "383b4c"), (1, "21222c")),
                    tab_base="21222c"),
    # F325's textured themes: the bar's gloss flattened over its texture's colour, no texture or stitching drawn
    "leather": dict(pins=("382617", "3b2819"), nav_line="1c1007", nav_hi=("ffebc8", 0.3),
                    nav_gloss=stops((0, "8f633f"), (0.5, "5e3d24"), (0.51, "553620"), (1, "4a2e1a")),
                    nav_shadow=0.5, **CLASSIC_TAB),
    "felt": dict(pins=("2a6432", "2c6834"), nav_line="1e0f04", nav_hi=("ffebc8", 0.3),
                 nav_gloss=stops((0, "926e4f"), (0.5, "7f5531"), (0.51, "704825"), (1, "58381d")),
                 nav_shadow=0.45, **CLASSIC_TAB),
    "wood": dict(pins=("633e21", "66401f"), nav_line="1a0c03", nav_hi=("ffe6be", 0.25),
                 nav_gloss=stops((0, "634831"), (0.5, "52331a"), (0.51, "462a13"), (1, "331f0e")),
                 nav_shadow=0.5, **CLASSIC_TAB),
    "legalpad": dict(pins=("f3e397", "f9eba0"), nav_line="2a1608", nav_hi=("b07a4c", 1),
                     nav_gloss=stops((0, "8a5530"), (1, "5a3218")), nav_shadow=0.18, **CLASSIC_TAB),
    "metal": dict(pins=("c6cbd2", "cbd0d6"), nav_line="6d737c", nav_hi=("ffffff", 1),
                  nav_gloss=stops((0, "eef0f3"), (1, "b9bec6")), nav_shadow=0.18, **CLASSIC_TAB),
    # B231: iOS 7's White (web/app/ios7.css), the light theme of the iOS 7 and iOS 13 styles: a flat #efeff4 ground,
    # flat #f7f7f7 bars with no highlight, gloss or shadows. Their .5 pt hairline (black at 30 %) is drawn as the
    # storyboard's 1 pt line views, flattened over the bar: #adadad.
    "white": dict(strip="f7f7f7", pins=("efeff4", "efeff4"), nav_line="adadad", nav_hi=("f7f7f7", 1),
                  nav_gloss=stops((0, "f7f7f7"), (1, "f7f7f7")), nav_shadow=0, tab_line=("adadad", 1),
                  tab_gloss=stops((0, "f7f7f7"), (1, "f7f7f7")), tab_base="f7f7f7", tab_shadow=0),
    # B237: iOS 13's White (ios13.css; core/settings.js STYLE_LAUNCH): a #f2f2f7 ground, flat #f9f9f9 bars, and their
    # rgba(0,0,0,.3) hairline over the bar (#aeaeae) as the 1 pt line.
    "white13": dict(strip="f9f9f9", pins=("f2f2f7", "f2f2f7"), nav_line="aeaeae", nav_hi=("f9f9f9", 1),
                    nav_gloss=stops((0, "f9f9f9"), (1, "f9f9f9")), nav_shadow=0, tab_line=("aeaeae", 1),
                    tab_gloss=stops((0, "f9f9f9"), (1, "f9f9f9")), tab_base="f9f9f9", tab_shadow=0),
    # B235: iOS 7's and iOS 13's OLED Black (ios7.css, ios13.css; core/settings.js STYLE_LAUNCH): a flat #000 ground and
    # bars, no highlight, gloss or shadows, and the bars' hairline (#262626, #38383a) as the 1 pt line views.
    "oled7": dict(strip="000000", pins=("000000", "000000"), nav_line="262626", nav_hi=("000000", 1),
                  nav_gloss=stops((0, "000000"), (1, "000000")), nav_shadow=0, tab_line=("262626", 1),
                  tab_gloss=stops((0, "000000"), (1, "000000")), tab_base="000000", tab_shadow=0),
    "oled13": dict(strip="000000", pins=("000000", "000000"), nav_line="38383a", nav_hi=("000000", 1),
                   nav_gloss=stops((0, "000000"), (1, "000000")), nav_shadow=0, tab_line=("38383a", 1),
                   tab_gloss=stops((0, "000000"), (1, "000000")), tab_base="000000", tab_shadow=0),
}


def png(w, h, rows, alpha=False):
    """rows: one bytes row per line (or a single row repeated h times)."""
    if isinstance(rows, (bytes, bytearray)):
        rows = [rows] * h
    raw = b"".join(b"\x00" + bytes(r) for r in rows)
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)  # noqa: E731
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6 if alpha else 2, 0, 0, 0))
            + chunk(b"sRGB", b"\x00")  # the CSS colours are sRGB: say so, not leave it to the renderer
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def mix(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def sample(grad, t):
    """The colour of a stops() gradient at t (0..1), as CSS draws it: a hard stop where two positions are equal."""
    for (p0, c0), (p1, c1) in zip(grad, grad[1:]):
        if t < p1:
            return mix(c0, c1, (t - p0) / (p1 - p0)) if p1 > p0 else c1
    return grad[-1][1]


def stripes(scale, pins=(PIN_DARK, PIN_LIGHT)):
    """One row of the pinstripes at this scale: each pixel the share of it the dark stripe covers."""
    dark_c, light_c = pins
    w, h = STRIPES_PT[0] * scale, STRIPES_PT[1] * scale
    row = bytearray()
    for x in range(w):
        a = x / scale % 8  # the pixel's span in pt, within the period (8 pt is a whole number of pixels)
        dark = max(0.0, min(a + 1 / scale, 2.5) - a) * scale
        row += bytes(mix(light_c, dark_c, dark))
    return png(w, h, bytes(row))


def column(colours, h, alpha=False):
    """A 1 px wide image, h rows, colours[i] for row i."""
    return png(1, h, [bytes(c) for c in colours], alpha)


def nav_half(top, grad=None):
    lo, hi = (0.0, 0.5) if top else (0.5, 1.0)
    grad = grad or ((0, NAV_GLOSS[0]), (1, NAV_GLOSS[1]))
    return column([sample(grad, lo + (hi - lo) * (i + 0.5) / GLOSS_PX) for i in range(GLOSS_PX)], GLOSS_PX)


def tab_gloss(scale, grad=None):
    c0, c1, stop, c2 = TAB_GLOSS
    grad = grad or ((0, c0), (stop, c1), (stop, c2), (1, c2))
    h = 48 * scale
    return column([sample(grad, (i + 0.5) / h) for i in range(h)], h)


def shadow(scale, down, alpha=0.18):
    """2.5 pt of black, alpha at the bar's edge to 0; down: the nav bar's (edge at the top)."""
    h = max(1, round(2.5 * scale))
    out = []
    for i in range(h):
        t = (i + 0.5) / h
        a = round(255 * alpha * ((1 - t) if down else t))
        out.append((0, 0, 0, a))
    return column(out, h, alpha=True)


def images(theme="classic"):
    """{file name: PNG bytes} for every launch image of a theme."""
    th = THEMES[theme]
    pins = tuple(hexrgb(c) for c in th["pins"])
    out = {}
    for s in (2, 3):
        x = "@%dx" % s
        out["LaunchStripes" + x] = stripes(s, pins)
        out["LaunchStatusStrip" + x] = column([hexrgb(th.get("strip", STATUS_STRIP))] * s, s)
        out["LaunchNavTop" + x] = nav_half(True, th["nav_gloss"])
        out["LaunchNavBottom" + x] = nav_half(False, th["nav_gloss"])
        out["LaunchTabGloss" + x] = tab_gloss(s, th["tab_gloss"])
        out["LaunchNavShadow" + x] = shadow(s, True, th["nav_shadow"])
        out["LaunchTabShadow" + x] = shadow(s, False, th.get("tab_shadow", 0.18))
    return {k + ".png": v for k, v in out.items()}


# The compiled view nib (a NIBArchive) and its colours. UIKit reads a UIColor's UIRed-Double (and so on) when it is
# there, else UIRed (a float); both are rewritten, in place (same types, same sizes), so nothing else moves.
def nib_colors(data):
    """[(rgba as floats, {component key: (offset, type)})] for every UIColor object in a NIBArchive."""
    if data[:10] != b"NIBArchive":
        raise ValueError("not a NIBArchive")
    no, oo, nk, ko, nv, vo, nc, co = struct.unpack_from("<8I", data, 18)

    def varint(p):
        r = s = 0
        while True:
            b = data[p]
            p += 1
            r |= (b & 0x7F) << s
            s += 7
            if b & 0x80:
                return r, p

    keys, p = [], ko
    for _ in range(nk):
        n, p = varint(p)
        keys.append(data[p:p + n].decode())
        p += n
    classes, p = [], co
    for _ in range(nc):
        n, p = varint(p)
        extra, p = varint(p)
        p += 4 * extra
        classes.append(data[p:p + n].rstrip(b"\0").decode())
        p += n
    sizes = {0: 1, 1: 2, 2: 4, 3: 8, 4: 0, 5: 0, 6: 4, 7: 8, 9: 0, 10: 4}
    values, p = [], vo
    for _ in range(nv):
        k, p = varint(p)
        t = data[p]
        p += 1
        if t == 8:
            n, p = varint(p)
            values.append((keys[k], t, p))
            p += n
        else:
            values.append((keys[k], t, p))
            p += sizes[t]
    out, p = [], oo
    for _ in range(no):
        c, p = varint(p)
        first, p = varint(p)
        n, p = varint(p)
        if classes[c] != "UIColor":
            continue
        comp = {k: (off, t) for k, t, off in values[first:first + n] if t in (6, 7)}
        rgba = tuple(struct.unpack_from("<f", data, comp[k][0])[0] for k in ("UIRed", "UIGreen", "UIBlue", "UIAlpha"))
        out.append((rgba, comp))
    return out


def rgba(hexcolour, alpha=1.0):
    return tuple(v / 255 for v in hexrgb(hexcolour)) + (alpha,)


# The storyboard's colour views (LaunchScreen.storyboard), found by Classic's colours in the compiled nib.
def nib_slots(theme):
    th = THEMES[theme]
    return [
        (rgba("eff2f7"), rgba(*th["nav_hi"])),         # Lnh: the nav bar's highlight
        (rgba("2d3642"), rgba(th["nav_line"])),        # Lnl: its bottom edge
        (rgba("ffffff", 0.1), rgba(*th["tab_line"])),  # Lth: the tab bar's line
        (rgba("000000"), rgba(th["tab_base"])),        # Ltb: the tab bar
        (rgba("ced3dc"), rgba(th["pins"][1])),         # the root view (under the stripes)
    ]


def theme_nib(data, theme):
    """The view nib with a theme's colours."""
    out = bytearray(data)
    found = nib_colors(data)
    for old, new in nib_slots(theme):
        hits = [comp for have, comp in found if all(abs(a - b) < 1e-3 for a, b in zip(have, old))]
        if len(hits) != 1:
            raise ValueError("launch nib: %d colour views are %r, want 1 (storyboard changed? see make.py)" % (len(hits), old))
        comp = hits[0]
        if all(abs(a - b) < 1e-3 for a, b in zip(old, new)):
            continue  # the same colour (Classic's own): keep the nib's bytes
        for key, v in zip(("UIRed", "UIGreen", "UIBlue", "UIAlpha"), new):
            for k in (key, key + "-Double"):
                if k in comp:
                    off, t = comp[k]
                    struct.pack_into("<f" if t == 6 else "<d", out, off, v)
    return bytes(out)


def theme_files(theme, storyboard=HERE / STORYBOARD):
    """{relative path: bytes} of themes/<theme>/: its images and its storyboard."""
    out = dict(images(theme))
    storyboard = pathlib.Path(storyboard)
    for f in sorted(storyboard.iterdir()):
        data = f.read_bytes()
        out[STORYBOARD + "/" + f.name] = theme_nib(data, theme) if f.name == VIEW_NIB else data
    return out


def main(out=HERE):
    out = pathlib.Path(out)
    for name, data in images().items():
        (out / name).write_bytes(data)
    themes = out / "themes"
    if themes.exists():
        shutil.rmtree(themes)
    for theme in THEMES:
        for rel, data in theme_files(theme).items():
            path = themes / theme / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
    print("launch:", out)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else HERE)
