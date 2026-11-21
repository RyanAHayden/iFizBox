"""F214: the shell's launch grounds (native/Sources/App.swift Launch) match web/app/palettes.css, and the shell
knows every palette Settings offers (web/app/core/settings.js), so no theme falls back to another one's ground.

B203: the launch screen per theme. native/launch/make.py's THEMES draws each theme's bars and ground as the CSS does,
launch/themes/ is what make.py writes, every Settings palette has a set, and the lists of files the bundle checks,
the helper copies (native/helper/launch.h) and the shell compares (native/Sources/Launch.swift) are the same."""
import os
import re
import struct
import sys
import tempfile
import shutil
import unittest
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "launch"))
import launch_check  # noqa: E402
import make  # noqa: E402


def read(*p):
    with open(os.path.join(ROOT, *p)) as f:
        return f.read()


def css_pins(css, tone, name):
    block = re.search(r'html\[data-theme="%s"\]\[data-palette="%s"\] \{(.*?)\n\}' % (tone, name), css, re.S)
    assert block, name
    pins = dict(re.findall(r"--pin-(dark|light): #([0-9a-f]{6});", block.group(1)))
    return pins["dark"], pins["light"], block.group(1)


def settings_palettes():
    settings = read("web", "app", "core", "settings.js")
    out = []
    for key in ["lightTheme", "darkTheme"]:
        block = re.search(r'key: "%s".*?options: \[(.*?)\}\],' % key, settings, re.S).group(1)
        out += re.findall(r'value: "([a-z]+)"', block)
    # B231: the eras' own themes (STYLE_PALETTES), e.g. iOS 7's White, which no theme list offers
    table = re.search(r"export const STYLE_PALETTES = \{(.*?)\};", settings, re.S).group(1)
    out += [v for v in re.findall(r'(?:light|dark): "([a-z]+)"', table) if v not in out]
    # B235: the launch sets an era's theme opens on instead of the iOS 6 one of its name (STYLE_LAUNCH)
    table = re.search(r"export const STYLE_LAUNCH = \{(.*?)\};", settings, re.S).group(1)
    out += re.findall(r'[a-z]+: "([a-z0-9]+)"', table)
    return sorted(set(out))


class LaunchGrounds(unittest.TestCase):
    def setUp(self):
        self.swift = read("native", "Sources", "App.swift")
        self.css = read("web", "app", "palettes.css")

    def striped(self, name):
        m = re.search(r"static let %s = striped\(0x([0-9a-f]{6}), 0x([0-9a-f]{6})(?:, plain: 0x([0-9a-f]{6}))?\)"
                      % name, self.swift)
        self.assertIsNotNone(m, name)
        return m.groups()

    def test_f200_palettes_match_the_css(self):
        for tone, name in [("dark", "midnight"), ("dark", "linen"), ("dark", "nord"), ("dark", "dracula"),
                           ("light", "sepia"), ("light", "solarized"),
                           # F325
                           ("dark", "leather"), ("dark", "felt"), ("dark", "wood"),
                           ("light", "legalpad"), ("light", "metal")]:
            dark, light, block = css_pins(self.css, tone, name)
            sd, sl, plain = self.striped(name)
            self.assertEqual((sd, sl), (dark, light), name)
            if name == "linen":  # the overscroll is the weave's base colour
                self.assertIn("#%s;" % plain, block)
            else:
                self.assertIsNone(plain, name)

    def test_every_settings_palette_has_a_ground(self):
        settings = read("web", "app", "core", "settings.js")
        for key in ["lightTheme", "darkTheme"]:
            block = re.search(r'key: "%s".*?options: \[(.*?)\}\],' % key, settings, re.S).group(1)
            values = re.findall(r'value: "([a-z]+)"', block)
            self.assertGreater(len(values), 1)
            for v in values[1:]:  # the first is the default the switch falls back to
                self.assertIn('case "%s": return %s' % (v, v), self.swift, v)


# B203: each theme's CSS, as make.THEMES must draw it.
def hex6(s):
    s = s.strip().lstrip("#")
    return "".join(c * 2 for c in s) if len(s) == 3 else s


def colour(s):
    """'#abc' / '#aabbcc' / 'rgba(255,255,255,.16)' -> ('rrggbb', alpha)."""
    s = s.strip()
    m = re.fullmatch(r"rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)", s)
    if m:
        return "%02x%02x%02x" % tuple(int(m.group(i)) for i in (1, 2, 3)), float(m.group(4))
    return hex6(s), 1


def gradient(args):
    """'#333336, #151517 50%, #070708 51%, #000' -> make.stops(...)."""
    parts = [p.strip() for p in re.split(r",(?![^(]*\))", args)]
    out = []
    for i, p in enumerate(parts):
        m = re.fullmatch(r"(.*?)(?:\s+([\d.]+)%)?", p)
        pos = float(m.group(2)) / 100 if m.group(2) else (0 if i == 0 else 1)
        out.append((pos, hex6(m.group(1))))
    if out[-1][0] < 1:  # CSS holds the last colour to the end
        out.append((1, out[-1][1]))
    return make.stops(*out)


def layers(value):
    """A background's layers, split on the top-level commas."""
    value = re.sub(r"/\*.*?\*/", "", value)
    out, depth, cur = [], 0, ""
    for ch in value:
        depth += ch == "("
        depth -= ch == ")"
        if ch == "," and depth == 0:
            out.append(cur.strip())
            cur = ""
        else:
            cur += ch
    return out + [cur.strip()]


def inner(layer):
    return re.match(r"linear-gradient\((.*)\)", layer.split(") ")[0] + ")").group(1)


TEXTURED = ("leather", "felt", "wood", "legalpad", "metal")


def textured_nav(n):
    """A textured bar's (line, highlight, gloss): the 44 pt gloss flattened over the colour under it (the base
    layer's first colour), its bottom line the gloss's last 1 pt or a 1 pt layer of its own."""
    hi = next(x for x in n if "safe-area-inset-top" in x)
    hi = re.match(r"linear-gradient\((rgba\([^)]*\)|#[0-9a-f]+)", hi).group(1)
    glo = next(x for x in n if x.startswith("linear-gradient") and "100% 44px" in x)
    args = re.match(r"linear-gradient\((.*)\) bottom /", glo).group(1)
    if "calc(100% - 1px)" in args:
        line = re.findall(r"(#[0-9a-f]+) calc\(100% - 1px\)", args)[-1]
        args = args.split(" calc(")[0]
    else:
        line = inner(next(x for x in n if "bottom / 100% 1px" in x)).split(",")[0]
    under = make.hexrgb(hex6(re.search(r"#[0-9a-f]{3,6}", n[-1]).group(0)))
    flat = []
    for p in re.split(r",(?![^(]*\))", args):
        m = re.fullmatch(r"(.*?)(\s+[\d.]+%)?", p.strip())
        c, a = colour(m.group(1))
        flat.append("#%02x%02x%02x%s" % (make.mix(under, make.hexrgb(c), a) + (m.group(2) or "",)))
    return line, hi, gradient(", ".join(flat))


class LaunchThemes(unittest.TestCase):
    def setUp(self):
        self.ios6 = read("web", "app", "ios6.css")
        self.pal = read("web", "app", "palettes.css")

    def block(self, css, selector):
        m = re.search(r"(?m)^" + re.escape(selector) + r" \{(.*?)\n\}", css, re.S)
        self.assertIsNotNone(m, selector)
        return m.group(1)

    def var(self, block, name):
        m = re.search(r"--%s:(.*?);" % name, block, re.S)
        self.assertIsNotNone(m, name)
        return " ".join(m.group(1).split())

    def token(self, value):
        """C44's era tokens: a bar's background is var(--x), its layers in ios6.css's :root."""
        m = re.fullmatch(r"\s*var\((--[\w-]+)\)\s*", value)
        return self.var(self.ios6, m.group(1)[2:]) if m else value

    def css_theme(self, key):
        """What the CSS says the theme's frame is, in make.THEMES's terms."""
        light_nav = self.block(self.ios6, ".navbar")
        light_nav = self.token(re.search(r"background:(.*?);", light_nav, re.S).group(1))
        light_tab = self.token(re.search(r"background:(.*?);", self.block(self.ios6, ".tabbar"), re.S).group(1))
        # B231: iOS 7's White; B235: iOS 7's and iOS 13's OLED Black. Flat bars, the hairline flattened over the bar
        eras = {"white": ("ios7", "light", "i7", ""), "oled7": ("ios7", "dark", "i7", "dk-"),
                "oled13": ("ios13", "dark", "i13", "dk-"), "white13": ("ios13", "light", "i13", "")}  # B237
        if key in eras:
            era, tone, p, dk = eras[key]
            b = self.block(read("web", "app", era + ".css"), 'html[data-style="%s"][data-theme="%s"]' % (era, tone))
            ground = hex6(self.var(b, "pin-dark"))
            bar = hex6(self.var(b, p + "-bar"))
            hc, ha = colour(self.var(b, p + "-hairline"))
            line = "%02x%02x%02x" % make.mix(make.hexrgb(bar), make.hexrgb(hc), ha)
            for name, layer in (("nav-bar", "bottom"), ("tabbar", "top")):
                self.assertEqual(self.var(b, dk + name), "linear-gradient(var(--%s-hairline), var(--%s-hairline)) %s / "
                                 "100%% .5px no-repeat, %s" % (p, p, layer, self.var(b, p + "-bar")), name)
            self.assertEqual(self.var(b, dk + "nav-shadow"), "none")
            self.assertEqual(self.var(b, "tabbar-shadow"), "none")
            flat = make.stops((0, bar), (1, bar))
            # F358: the era runs its flat bar up through the status-bar strip, so the strip is the bar's colour
            return dict(strip=bar, pins=(ground, hex6(self.var(b, "pin-light"))), nav_line=line, nav_hi=(bar, 1), nav_gloss=flat,
                        nav_shadow=0, tab_line=(line, 1), tab_gloss=flat, tab_base=bar, tab_shadow=0)
        if key == "classic":
            root = self.block(self.ios6, ":root")
            pins = (hex6(self.var(root, "pin-dark")), hex6(self.var(root, "pin-light")))
            nav, tab, shadow = light_nav, light_tab, 0.18
        elif key in ("sepia", "solarized", "legalpad", "metal"):
            b = self.block(self.pal, 'html[data-theme="light"][data-palette="%s"]' % key)
            pins = (hex6(self.var(b, "pin-dark")), hex6(self.var(b, "pin-light")))
            nav, tab, shadow = self.var(b, "lt-nav-bar"), light_tab, 0.18
        else:
            sel = 'html[data-theme="dark"]' + ('' if key == "oled" else '[data-palette="%s"]' % key)
            b = self.block(self.ios6 if key in ("oled", "gunmetal") else self.pal, sel)
            pins = (hex6(self.var(b, "pin-dark")), hex6(self.var(b, "pin-light")))
            if key == "linen":  # the weave (its ground): its base colour, a stripe can't draw the weave
                pins = (hex6(self.var(b, "dk-ground")),) * 2
            nav, tab = self.var(b, "dk-nav-bar"), self.var(b, "dk-tabbar")
            sh = self.var(b, "dk-nav-shadow")
            shadow = 0 if sh == "none" else float(re.search(r"rgba\(0,\s*0,\s*0,\s*([\d.]+)\)", sh).group(1))
        n = layers(nav)
        if key in TEXTURED:  # F325's textured bars: the storyboard draws no texture or stitching
            line, hi, glo = textured_nav(n)
        else:
            line = inner(n[0]).split(",")[0]
            hi = re.match(r"linear-gradient\((rgba\([^)]*\)|#[0-9a-f]+)", n[1]).group(1)
            glo = gradient(inner(n[2]))
        out = dict(pins=pins, nav_line=hex6(line), nav_hi=colour(hi), nav_gloss=glo, nav_shadow=shadow)
        t = layers(tab)
        if "rgba(0,0,0,.7)" in t[0].replace(" ", ""):  # the light theme's tab bar, as the storyboard draws it
            out.update(tab_line=colour(re.match(r"linear-gradient\((rgba\([^)]*\))", t[1]).group(1)),
                       tab_gloss=gradient(inner(t[2])), tab_base=hex6(t[3]))
        else:
            base = hex6(t[-1])
            out.update(tab_line=(hex6(inner(t[0]).split(",")[0]), 1), tab_base=base,
                       tab_gloss=gradient(inner(t[1])) if len(t) == 3 else make.stops((0, base), (1, base)))
        return out

    def test_themes_match_the_css(self):
        for key in make.THEMES:
            want = self.css_theme(key)
            have = {k: (tuple(v) if isinstance(v, list) else v) for k, v in make.THEMES[key].items()}
            have["nav_hi"] = (have["nav_hi"][0], float(have["nav_hi"][1]))
            have["tab_line"] = (have["tab_line"][0], float(have["tab_line"][1]))
            want["nav_hi"] = (want["nav_hi"][0], float(want["nav_hi"][1]))
            want["tab_line"] = (want["tab_line"][0], float(want["tab_line"][1]))
            self.assertEqual(have, want, key)

    def test_f358_status_strip_is_black_in_ios6_sets(self):
        """The page's iOS 6 era draws a plain black strip the top inset tall (.navbar::before, --site-strip) with the
        44 pt bar under it; only the iOS 7 and iOS 13 eras run the bar up through it. The launch sets do the same:
        LaunchStatusStrip from the screen top to the safe area top, the gloss from there."""
        self.assertIn(".navbar::before { background: var(--site-strip); }", self.ios6)
        self.assertEqual(hex6(re.search(r"--site-strip: (#[0-9a-f]+);", self.ios6).group(1)), make.STATUS_STRIP)
        self.assertIn('html[data-shell="app"]:is([data-style="ios7"], [data-style="ios13"]) .navbar::before {', self.ios6)
        eras = ("white", "white13", "oled7", "oled13")
        for key, th in make.THEMES.items():
            want = th["nav_gloss"][0][1] if key in eras else make.hexrgb(make.STATUS_STRIP)
            if key in eras:
                self.assertEqual(th["nav_gloss"][0][1], th["nav_gloss"][-1][1], key)  # a flat bar
            else:
                self.assertNotIn("strip", th, key)
            for s in (2, 3):
                png = make.images(key)["LaunchStatusStrip@%dx.png" % s]
                w, h = struct.unpack(">II", png[16:24])
                raw = zlib.decompress(png[png.index(b"IDAT") + 4:png.index(b"IEND") - 8])
                self.assertEqual((w, h), (1, s), key)  # 1 pt
                self.assertEqual(raw, (b"\x00" + bytes(want)) * h, key)
        sb = read("native", "launch", "LaunchScreen.storyboard")
        for pin in ('firstItem="Lss-00-000" firstAttribute="top" secondItem="Lrt-00-000" secondAttribute="top"',
                    'firstItem="Lss-00-000" firstAttribute="bottom" secondItem="Lsa-00-000" secondAttribute="top" id=',
                    'firstItem="Lnt-00-000" firstAttribute="top" secondItem="Lsa-00-000" secondAttribute="top" id=',
                    'firstItem="Lnt-00-000" firstAttribute="bottom" secondItem="Lsa-00-000" secondAttribute="top" '
                    'constant="22"',
                    'firstItem="Lnh-00-000" firstAttribute="top" secondItem="Lsa-00-000" secondAttribute="top" id='):
            self.assertIn(pin, sb)
        # drawn under the nav bar's views: the strip comes right after the pinstripes
        self.assertLess(sb.index('id="Lst-00-000"'), sb.index('id="Lss-00-000"'))
        self.assertLess(sb.index('id="Lss-00-000"'), sb.index('id="Lnt-00-000"'))

    def test_every_settings_palette_has_a_launch_theme(self):
        self.assertEqual(sorted(settings_palettes()), sorted(make.THEMES))
        self.assertEqual(sorted(launch_check.THEME_KEYS), sorted(make.THEMES))
        swift = read("native", "Sources", "Launch.swift")
        # a palette with no set gets nothing, not another theme's frame
        self.assertIn('fileExists(atPath: dir(k) + "/" + viewNib) ? k : nil', swift)

    def test_tab_shadow_is_every_theme_own(self):
        """make.py draws LaunchTabShadow at 18 % for every theme: no theme's CSS redraws .tabbar::before."""
        css = self.ios6 + self.pal
        rules = re.findall(r"(?m)^([^{}\n]*\.tabbar::before[^{]*)\{([^}]*)\}", css)
        self.assertEqual(len(rules), 1, rules)
        bg = re.search(r"background:(.*?);", rules[0][1], re.S).group(1)
        self.assertIn("rgba(0,0,0,.18)", self.token(bg).replace(" ", ""))

    def test_themes_dir_is_what_make_writes(self):
        """native/launch/themes/ is make.py's output (rerun native/launch/make.py)."""
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp)
        make.main(tmp)
        have, want = {}, {}
        for top, d in ((os.path.join(HERE, "launch", "themes"), have), (os.path.join(tmp, "themes"), want)):
            for root, _, names in os.walk(top):
                for name in names:
                    with open(os.path.join(root, name), "rb") as f:
                        d[os.path.relpath(os.path.join(root, name), top)] = f.read()
        self.assertEqual(sorted(have), sorted(want))
        for k in want:
            self.assertEqual(have[k], want[k], k)

    def test_classic_is_the_bundle_own(self):
        """Classic's set is the top-level launch files byte for byte, so storyboard.sources stays true."""
        for rel, data in make.theme_files("classic").items():
            with open(os.path.join(HERE, "launch", rel), "rb") as f:
                self.assertEqual(f.read(), data, rel)

    def test_theme_nibs_carry_the_theme_colours(self):
        for key, th in make.THEMES.items():
            nib = make.theme_files(key)["LaunchScreen.storyboardc/" + launch_check.VIEW_NIB]
            got = [c for c, _ in make.nib_colors(nib)]
            for _, want in make.nib_slots(key):
                self.assertTrue(any(all(abs(a - b) < 1e-3 for a, b in zip(c, want)) for c in got), (key, want))

    def test_under_splashboard_cap(self):
        """SplashBoard refuses a launch screen over 25,000,000 bytes (w x h x 4, summed): every theme stays far under."""
        for key in make.THEMES:
            total = 0
            for name, data in make.images(key).items():
                w, h = struct.unpack(">II", data[16:24])
                total += w * h * 4
            self.assertLess(total, 1_000_000, key)

    def test_file_lists_agree(self):
        want = ["%s%s.png" % (i, s) for i in launch_check.IMAGES for s in ("@2x", "@3x")]
        want.append("LaunchScreen.storyboardc/" + launch_check.VIEW_NIB)
        swift = read("native", "Sources", "Launch.swift")
        names = re.search(r"static let files: \[String\] = \[(.*?)\]", swift, re.S).group(1)
        self.assertEqual(sorted(re.findall(r'"(\w+)"', names)), sorted(launch_check.IMAGES))
        self.assertIn('"LaunchScreen.storyboardc/%s"' % launch_check.VIEW_NIB, swift)
        self.assertEqual(make.VIEW_NIB, launch_check.VIEW_NIB)
        self.assertEqual(sorted(make.images()), sorted(w for w in want if w.endswith(".png")))


if __name__ == "__main__":
    unittest.main()
