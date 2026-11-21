"""B179: the app icon at every size in both builds. iOS 26 drew a blank placeholder for the sideload app's
notifications: Info.plist named an asset catalog icon (CFBundleIconName AppIcon) and the bundle had no Assets.car,
only 60pt loose PNGs. icon/assets.sh compiles icon/Assets.car (jailbreak) and icon/AssetsLite.car (sideload) on a
Mac; build.sh copies the right one and every loose size; mkdeb.py/mkipa.py check run carfile.icon_problems."""
import hashlib
import os
import plistlib
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import carfile  # noqa: E402
from test_native import plist  # noqa: E402
sys.path.insert(0, os.path.join(HERE, "icon"))
import alternates  # noqa: E402
import glass  # noqa: E402

ICON = os.path.join(HERE, "icon")
APP = "Payload/iFizBox.app/"


def read(name):
    with open(os.path.join(ICON, name), "rb") as f:
        return f.read()


def bundle(lite):
    """The icon files build.sh puts in the app, as path -> bytes."""
    src = "AppIconLite" if lite else "AppIcon"
    files = {APP + "AppIcon%dx%d@%dx.png" % (pt, pt, s): read("%s%dx%d@%dx.png" % (src, pt, pt, s))
             for pt, scales in carfile.ICON_SIZES.items() for s in scales}
    files[APP + "Assets.car"] = read("AssetsLite.car" if lite else "Assets.car")
    for slot in "AB":  # F329: your own icon's sets, the primary icon until the helper writes one
        for pt in (20, 29, 40, 60):
            for s in (2, 3):
                files[APP + "IconOwn%s%dx%d@%dx.png" % (slot, pt, pt, s)] = read("%s%dx%d@%dx.png" % (src, pt, pt, s))
    return files


class Catalogs(unittest.TestCase):
    def test_every_size_in_each_car(self):
        for car, prefix in (("Assets.car", "AppIcon"), ("AssetsLite.car", "AppIconLite")):
            data = read(car)
            self.assertIn("AppIcon", carfile.facets(data), car)
            have = {(r["file"], r["width"], r["height"]) for r in carfile.renditions(data)}
            for pt, scales in carfile.ICON_SIZES.items():
                for s in scales:
                    name = "%s%dx%d@%dx.png" % (prefix, pt, pt, s)
                    self.assertIn((name, pt * s, pt * s), have, car)
            self.assertIn((prefix + "1024.png", 1024, 1024), have, car)

    def test_cars_compiled_from_the_current_pngs(self):
        """icon/assets.sources is written with the .car files (every PNG either catalog takes, F323: the themes'
        and Clear's too): a changed PNG, or a set added, means rerunning icon/assets.sh."""
        with open(os.path.join(ICON, "assets.sources")) as f:
            recorded = dict(reversed(line.split()) for line in f if line.strip())
        now = alternates.sources()
        now.update(glass.sources())  # F324: the .icon documents too
        self.assertEqual(sorted(recorded), sorted(now), "rerun native/icon/assets.sh <mac host>")
        for name, digest in now.items():
            self.assertEqual(recorded[name], digest,
                             "%s changed since Assets.car was compiled: rerun native/icon/assets.sh" % name)
        self.assertIn("AppIcon60x60@3x.png", recorded)
        self.assertEqual(recorded["AppIcon60x60@3x.png"], hashlib.sha256(read("AppIcon60x60@3x.png")).hexdigest())

    def test_loose_pngs_at_every_size(self):
        for src in ("AppIcon", "AppIconLite"):
            for pt, scales in carfile.ICON_SIZES.items():
                for s in scales:
                    name = "%s%dx%d@%dx.png" % (src, pt, pt, s)
                    self.assertEqual(carfile.png_size(read(name)), (pt * s, pt * s), name)


class Bundle(unittest.TestCase):
    def setUp(self):
        self.info = plistlib.loads(plist())

    def test_good_bundles(self):
        self.assertEqual(carfile.icon_problems(self.info, bundle(False), APP, lite=False), [])
        self.assertEqual(carfile.icon_problems(self.info, bundle(True), APP, lite=True), [])

    def test_icon_name_without_catalog(self):
        """The bug: CFBundleIconName set, no Assets.car."""
        files = bundle(True)
        del files[APP + "Assets.car"]
        self.assertTrue(any("no Assets.car" in p for p in carfile.icon_problems(self.info, files, APP, lite=True)))

    def test_only_60pt_listed(self):
        self.info["CFBundleIcons"]["CFBundlePrimaryIcon"]["CFBundleIconFiles"] = ["AppIcon60x60"]
        problems = carfile.icon_problems(self.info, bundle(False), APP, lite=False)
        self.assertIn("Info.plist CFBundleIconFiles has no AppIcon20x20", problems)

    def test_missing_notification_size(self):
        files = bundle(False)
        del files[APP + "AppIcon20x20@3x.png"]
        self.assertIn("icon AppIcon20x20@3x.png missing or not 60 px",
                      carfile.icon_problems(self.info, files, APP, lite=False))

    def test_wrong_builds_catalog(self):
        files = bundle(False)
        files[APP + "Assets.car"] = read("AssetsLite.car")
        self.assertTrue(any("sideload build's icon" in p for p in carfile.icon_problems(self.info, files, APP, lite=False)))
        files = bundle(True)
        files[APP + "Assets.car"] = read("Assets.car")
        self.assertTrue(any("jailbreak build's icon" in p for p in carfile.icon_problems(self.info, files, APP, lite=True)))

    def test_no_icon_name(self):
        del self.info["CFBundleIcons"]["CFBundlePrimaryIcon"]["CFBundleIconName"]
        self.assertTrue(carfile.icon_problems(self.info, bundle(False), APP, lite=False))

    def test_unreadable_car(self):
        files = bundle(False)
        files[APP + "Assets.car"] = b"BOMStore" + b"\0" * 40
        self.assertTrue(any("unreadable" in p for p in carfile.icon_problems(self.info, files, APP, lite=False)))


def theme_names():
    """theme-boot.js's dark and light theme names, the themes tools/icons.sh renders an icon for (F322)."""
    import re
    with open(os.path.join(HERE, "..", "web", "app", "theme-boot.js")) as f:
        js = f.read()
    names = []
    for var in ("darks", "lights"):
        m = re.search(var + r"\s*=\s*\[([^\]]*)\]", js)
        names += re.findall(r'"([a-z0-9-]+)"', m.group(1))
    return names


class ThemeIcons(unittest.TestCase):
    """F322: icon/themes/<theme>/ holds that theme's icon, plain and LITE, at every size icon/ has."""

    def test_every_theme_plain_and_lite_at_every_size(self):
        names = theme_names()
        self.assertGreaterEqual(len(names), 9)
        for t in names:
            d = os.path.join(ICON, "themes", t)
            for src in ("AppIcon", "AppIconLite"):
                sizes = {"%s%dx%d@%dx.png" % (src, pt, pt, s): pt * s
                         for pt, scales in carfile.ICON_SIZES.items() for s in scales}
                sizes[src + "60x60.png"] = 60
                sizes[src + "1024.png"] = 1024
                for name, px in sizes.items():
                    with self.subTest(theme=t, file=name):
                        with open(os.path.join(d, name), "rb") as f:
                            self.assertEqual(carfile.png_size(f.read()), (px, px))

    def test_no_stray_theme(self):
        have = sorted(n for n in os.listdir(os.path.join(ICON, "themes"))
                      if os.path.isdir(os.path.join(ICON, "themes", n)))
        self.assertEqual(have, sorted(theme_names()))

    def test_classic_is_the_real_icon(self):
        for name in ("AppIcon60x60@2x.png", "AppIconLite60x60@3x.png", "AppIcon1024.png", "AppIconLite20x20@2x.png"):
            self.assertEqual(read(os.path.join("themes", "classic", name)), read(name), name)


class Alternates(unittest.TestCase):
    """F323: the icon follows the theme. Every alternate set icon/alternates.py lists is in both .car files with its
    icons (the Lite build's sashed, Clear plain in both) and, for a pair, the dark theme's icon as its dark
    appearance; Info.plist's CFBundleAlternateIcons lists the same sets."""

    def test_sets_cover_every_theme_pair_and_clear(self):
        lights, darks = alternates.themes()
        have = alternates.sets()
        self.assertEqual(sorted(i for i, d in have.values() if d is None), sorted(lights + darks + ["clear"]))
        for l in lights + ["clear"]:
            for d in darks + ["clear"]:
                if (l, d) == alternates.PRIMARY:
                    self.assertNotIn(alternates.set_name(l, d), have)  # AppIcon itself
                elif l != d:
                    self.assertEqual(have[alternates.set_name(l, d)], (l, d))

    def test_every_set_in_both_cars(self):
        for car, lite in (("Assets.car", False), ("AssetsLite.car", True)):
            got = carfile.icon_sets(read(car))
            for name, (light, dark) in alternates.sets().items():
                with self.subTest(car=car, set=name):
                    self.assertIn(name, got)
                    have = {(r["file"], r["width"], r["appearance"]) for r in got[name]}
                    for pt, s in alternates.ALT_SIZES:
                        self.assertIn((alternates.alt_name(light, pt, s, lite), pt * s, "UIAppearanceAny"), have)
                        if dark:
                            self.assertIn((alternates.alt_name(dark, pt, s, lite), pt * s, "UIAppearanceDark"), have)
                    if not dark:
                        self.assertNotIn("UIAppearanceDark", {r["appearance"] for r in got[name]})

    def test_primary_dark_is_gunmetal(self):
        for car, stem in (("Assets.car", "AppIcon"), ("AssetsLite.car", "AppIconLite")):
            got = carfile.icon_sets(read(car))["AppIcon"]
            dark = {(r["file"], r["width"]) for r in got if r["appearance"] == "UIAppearanceDark"}
            for pt, scales in carfile.ICON_SIZES.items():
                for s in scales:
                    self.assertIn(("%sDark%dx%d@%dx.png" % (stem, pt, pt, s), pt * s), dark, car)

    def test_lite_files_only_in_the_lite_car(self):
        plain = {r["file"] for rs in carfile.icon_sets(read("Assets.car")).values() for r in rs}
        lite = {r["file"] for rs in carfile.icon_sets(read("AssetsLite.car")).values() for r in rs}
        self.assertFalse([f for f in plain if "-lite-" in f or f.startswith("AppIconLite")])
        self.assertTrue(any(f.startswith("clear-") for f in lite), "Clear has no sash in the Lite build")
        # F324: the Glass icon's .icon renders are one picture for both builds (no sash)
        self.assertFalse([f for f in lite if "-" in f and not f.startswith(("clear-", "AppIcon", alternates.GLASS_SET))
                          and "-lite-" not in f])

    def test_info_plist_lists_every_set(self):
        info = plistlib.loads(plist())
        alts = info["CFBundleIcons"]["CFBundleAlternateIcons"]
        own = [alternates.own_set(s) for s in alternates.OWN_SLOTS]  # F329: your own icon's loose sets
        self.assertEqual(list(alts), list(alternates.sets()) + [alternates.GLASS_SET] + own)  # F324: the Glass icon
        for name, d in alts.items():
            if name in own:
                self.assertEqual(d, {"CFBundleIconFiles": [alternates.own_stem(name[-1], pt) for pt in alternates.OWN_SIZES]})
            else:
                self.assertEqual(d, {"CFBundleIconName": name})
        with open(os.path.join(HERE, "Info.plist")) as f:
            text = f.read()
        self.assertEqual(alternates.plist_text(text), text, "rerun native/icon/alternates.py plist")

    def test_missing_alternate_is_a_problem(self):
        info = plistlib.loads(plist())
        info["CFBundleIcons"]["CFBundleAlternateIcons"]["Icon-nope"] = {"CFBundleIconName": "Icon-nope"}
        self.assertIn("Assets.car lacks alternate icons Info.plist lists: Icon-nope",
                      carfile.icon_problems(info, bundle(False), APP, lite=False))

    def test_clear_at_every_size_and_no_sash(self):
        for pt, scales in list(carfile.ICON_SIZES.items()) + [(1024, (1,))]:
            for s in scales:
                plain = alternates.src("clear", pt, s, False)
                with open(plain, "rb") as f:
                    data = f.read()
                px = 1024 if pt == 1024 else pt * s
                self.assertEqual(carfile.png_size(data), (px, px), plain)
                with open(plain.replace("AppIcon", "AppIconLite"), "rb") as f:
                    self.assertEqual(f.read(), data, "Clear's Lite file is the plain one")

    def test_swift_names_sets_as_alternates_does(self):
        """Sources/AppIcon.swift builds the names it passes to setAlternateIconName; they must be alternates.py's."""
        with open(os.path.join(HERE, "Sources", "AppIcon.swift")) as f:
            swift = f.read()
        self.assertIn('primary = (light: "%s", dark: "%s")' % alternates.PRIMARY, swift)
        self.assertIn('"Icon-\\(light)-\\(dark)"', swift)
        self.assertIn('"Icon-\\(onScreen)"', swift)
        self.assertEqual(alternates.set_name("sepia", "nord"), "Icon-sepia-nord")
        self.assertEqual(alternates.set_name("clear"), "Icon-clear")

    def test_set_on_screen_read_through_on_screen(self):
        """iOS 27 reads alternateIconName as nil after a switch: every reading goes through AppIcon.onScreen, which
        falls back to the set the shell last switched to, and apply keeps that set once iOS switched."""
        sources = os.path.join(HERE, "Sources")
        for name in sorted(os.listdir(sources)):
            if not name.endswith(".swift"):
                continue
            with open(os.path.join(sources, name)) as f:
                for n, line in enumerate(f, 1):
                    if "UIApplication.shared.alternateIconName" in line or "app.alternateIconName" in line:
                        self.assertIn("shown(ios: UIApplication.shared.alternateIconName", line,
                                      "%s:%d reads alternateIconName; use AppIcon.onScreen" % (name, n))
        with open(os.path.join(sources, "AppIcon.swift")) as f:
            swift = f.read()
        self.assertIn("if onScreen == name { return done(false, false, nil) }", swift)
        self.assertIn("if e == nil { keepShown(name) }", swift)

    def test_thumbs(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            alternates.thumbs(d, lite=True)
            self.assertEqual(sorted(os.listdir(d)), sorted(i + ".png" for i in alternates.icons() + [alternates.GLASS]))
            with open(os.path.join(d, "sepia.png"), "rb") as f:
                self.assertEqual(f.read(), read(os.path.join("themes", "sepia", "AppIconLite60x60@3x.png")))


class Glass(unittest.TestCase):
    """F324: every icon set also has an Icon Composer document (icon/glass.py), which iOS 26+ draws in Liquid Glass;
    the PNG sets above stay for iOS 15-25."""

    @classmethod
    def setUpClass(cls):
        import tempfile
        cls.tmp = tempfile.TemporaryDirectory()
        glass.write(cls.tmp.name)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def doc(self, name):
        import json
        with open(os.path.join(self.tmp.name, name + ".icon", "icon.json")) as f:
            return json.load(f)

    def test_one_document_per_set(self):
        want = ["AppIcon"] + list(alternates.sets()) + [alternates.GLASS_SET]
        self.assertEqual(list(glass.all_sets()), want)
        self.assertEqual(sorted(n[:-5] for n in os.listdir(self.tmp.name)), sorted(want))

    def test_every_layer_image_is_in_the_bundle(self):
        for name in glass.all_sets():
            with self.subTest(set=name):
                doc = self.doc(name)
                assets = set(os.listdir(os.path.join(self.tmp.name, name + ".icon", "Assets")))
                used = set()
                for group in doc["groups"]:
                    for layer in group["layers"]:
                        used.update(s["value"] for s in layer["image-name-specializations"])
                self.assertEqual(used, assets)
                self.assertEqual(doc["supported-platforms"], {"squares": ["iOS"]})

    def test_dark_appearance_is_the_dark_icon(self):
        for name, (light, dark) in glass.all_sets().items():
            with self.subTest(set=name):
                doc = self.doc(name)
                fills = {s.get("appearance", "any"): s["value"]["linear-gradient"] for s in doc["fill-specializations"]}
                self.assertEqual(fills["any"], [glass.srgb(c) for c in glass.colours(light)["fill"]])
                self.assertEqual(fills["dark"], [glass.srgb(c) for c in glass.colours(dark)["fill"]])
                grid = doc["groups"][0]["layers"][0]["image-name-specializations"]
                self.assertEqual(grid, [{"value": light + "-grid.svg"}, {"appearance": "dark", "value": dark + "-grid.svg"}])
        self.assertEqual(glass.all_sets()["AppIcon"], alternates.PRIMARY)
        self.assertEqual(glass.all_sets()["Icon-sepia"], ("sepia", "sepia"))

    def test_glass_layers_and_order(self):
        doc = self.doc("AppIcon")
        self.assertEqual([[l["name"] for l in g["layers"]] for g in doc["groups"]], [["grid"], ["sphere", "rim"]])
        self.assertTrue(all(l["glass"] for g in doc["groups"] for l in g["layers"]))
        self.assertTrue(all(g["specular"] for g in doc["groups"]))

    def test_colours_follow_the_theme_table(self):
        """Every theme's layers take that theme's colours (tools/icon_themes.py), all different from Classic's."""
        names = theme_names()
        seen = {}
        for t in names + ["clear"]:
            c = glass.colours(t)
            for key in ("rim", "sphere", "grid"):
                self.assertRegex(c[key][0], r"^[0-9a-f]{6}$")
            self.assertEqual(len(c["fill"]), 2)
            seen[t] = (tuple(c["fill"]), c["sphere"], c["grid"])
        self.assertEqual(len(set(seen.values())), len(seen), "two icons came out the same")
        self.assertEqual(glass.colours("classic")["grid"][0], "5a6473")  # tools/icon.svg.in's ink

    def test_car_sets_are_sets(self):
        """The .icon documents assets.sh compiles are named sets (each costs ~3 MB of Assets.car, journal F324)."""
        self.assertFalse(set(glass.CAR_SETS) - set(glass.all_sets()))
        self.assertLessEqual(len(glass.CAR_SETS), 4, "each .icon adds ~3 MB to both .car files")

    def test_glass_icon_is_its_own_set(self):
        """User 2026-11-21: every theme keeps its PNG set (an .icon would replace it, LITE sash and all); the glass
        one is an extra set, Classic in Light and Gunmetal in Dark, with no PNG set, that only the .icon fills."""
        self.assertEqual(glass.CAR_SETS, (alternates.GLASS_SET,))
        self.assertNotIn(alternates.GLASS_SET, alternates.sets())
        self.assertEqual(glass.all_sets()[alternates.GLASS_SET], alternates.PRIMARY)
        # Sources/AppIcon.swift's one-icon name for the page's "glass" pick, and the page offers it
        self.assertEqual("Icon-%s" % alternates.GLASS, alternates.GLASS_SET)
        with open(os.path.join(os.path.dirname(HERE), "web", "app", "core", "settings.js")) as f:
            self.assertIn('{ value: "%s", label: "Glass", tone: null }' % alternates.GLASS, f.read())
        self.assertEqual(carfile.png_size(read(os.path.join("glass", "AppIcon60x60@3x.png"))), (180, 180))

    def test_glass_icon_in_both_cars(self):
        """actool compiled the .icon: the set is in each .car (iOS 26+ draws its layers, older iOS its flat render)."""
        for car in ("Assets.car", "AssetsLite.car"):
            with self.subTest(car=car):
                self.assertIn(alternates.GLASS_SET, carfile.icon_sets(read(car)))

    def test_svg_layers_are_well_formed(self):
        import xml.etree.ElementTree as ET
        for layer, text in glass.layer_svgs("nord").items():
            root = ET.fromstring(text)
            self.assertEqual(root.get("viewBox"), "0 0 1024 1024", layer)


if __name__ == "__main__":
    unittest.main()
