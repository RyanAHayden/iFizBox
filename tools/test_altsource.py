"""I7: iFizBox's own AltStore source (web/app/source.json, tools/altsource.py) is well formed, names its own release's
IPA, is never ahead of native/VERSION, and is first among the site's default AltStore sources."""
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import altsource  # noqa: E402


def ver(s):
    return tuple(int(x) for x in re.findall(r"\d+", s)[:3])


class SourceTest(unittest.TestCase):
    def setUp(self):
        with open(altsource.SOURCE) as f:
            self.data = json.load(f)

    def test_well_formed(self):
        self.assertEqual(altsource.check(self.data), [])
        self.assertEqual(subprocess.run([sys.executable, os.path.join(HERE, "altsource.py"), "check"]).returncode, 0)

    def test_not_ahead_of_version(self):
        with open(os.path.join(ROOT, "native", "VERSION")) as f:
            current = f.read().strip()
        listed = self.data["apps"][0]["versions"][0]["version"]
        self.assertLessEqual(ver(listed), ver(current), "source.json names a version native/VERSION hasn't reached")

    def test_default_source(self):
        # web/app/app-sources.json: the app's own source first, relative to the site (core/sources.js appSourcesFrom
        # reads it against https://<DOMAIN>/), so the data file never spells the domain.
        with open(os.path.join(ROOT, "web", "app", "app-sources.json")) as f:
            first = json.load(f)[0]
        with open(os.path.join(ROOT, "native", "brand.env")) as f:
            domain = re.search(r"^BRAND_DOMAIN=(\S+)", f.read(), re.M).group(1)
        # F178: the site's /repo/source.json, not raw.githubusercontent.com
        self.assertEqual(urllib.parse.urljoin(f"https://{domain}/", first), f"https://{domain}/repo/source.json")
        self.assertEqual(altsource.SOURCE_URL, f"https://{domain}/repo/source.json")
        self.assertEqual(self.data.get("sourceURL"), altsource.SOURCE_URL)


class ScreenshotsTest(unittest.TestCase):
    """iFizBox's app page shows the phone-framed shots (docs/img/web-*.png, jb-*.png), never the crop-* pictures."""

    def test_source_lists_exactly_phone_shots(self):
        with open(altsource.SOURCE) as f:
            shots = json.load(f)["apps"][0]["screenshots"]
        urls = [s["imageURL"] for s in shots]
        self.assertTrue(all(u.startswith("https://raw.githubusercontent.com/") for u in urls), urls)
        names = [u.rsplit("/", 1)[1] for u in urls]
        on_disk = sorted(n for n in os.listdir(os.path.join(ROOT, "docs", "img"))
                         if re.match(r"(web|jb)-.*\.png$", n))
        self.assertEqual(sorted(names), on_disk)
        self.assertEqual(len(names), len(set(names)))
        self.assertFalse([n for n in names if n.startswith("crop-")])
        self.assertTrue(all(s["width"] > 0 and s["height"] > s["width"] for s in shots))

    def test_build_carries_screenshots(self):
        data = altsource.build("1.0.0", 10, "2026-11-21T00:00:00Z")
        self.assertEqual(data["apps"][0]["screenshots"], altsource.screenshots())


class UpdateTest(unittest.TestCase):
    def test_update_points_at_release(self):
        with tempfile.TemporaryDirectory() as d:
            ipa = os.path.join(d, "iFizBox.ipa")
            with open(ipa, "wb") as f:
                f.write(b"PK" + b"\0" * 1000)
            out = os.path.join(d, "source.json")
            altsource.write(altsource.build("9.8.7", os.path.getsize(ipa), "2026-11-17T00:00:00Z"), out)
            with open(out) as f:
                data = json.load(f)
        v = data["apps"][0]["versions"][0]
        self.assertEqual(v["downloadURL"], "https://github.com/RyanAHayden/iFizBox/releases/download/v9.8.7/iFizBox.ipa")
        self.assertEqual(v["size"], 1002)
        self.assertEqual(altsource.check(data), [])

    def test_update_drops_old_asset_names(self):
        """F180: versions[] keeps only releases whose IPA is <NAME>.ipa; the ones under the old name go."""
        old = {"version": "0.9.3", "downloadURL": altsource.REPO + "/releases/download/v0.9.3/" + "Cy" + "dian.ipa"}
        own = {"version": "0.9.4", "downloadURL": altsource.ipa_url("0.9.4")}
        data = altsource.build("0.9.5", 10, "2026-11-18T00:00:00Z", previous=[own, old])
        self.assertEqual([v["version"] for v in data["apps"][0]["versions"]], ["0.9.5", "0.9.4"])
        self.assertTrue(all(v["downloadURL"].endswith("/" + altsource.NAME + ".ipa") for v in data["apps"][0]["versions"]))

    def test_check_refuses(self):
        data = altsource.build("1.0.0", 10, "2026-11-17T00:00:00Z")
        data["apps"][0]["versions"][0]["downloadURL"] = altsource.ipa_url("0.9.0")
        data["apps"][0]["bundleIdentifier"] = "com.example.other"
        self.assertEqual(len(altsource.check(data)), 2)

    def test_check_wants_exactly_own_ipa(self):
        """F180a: versions[0] is its release's <NAME>.ipa, not any other IPA of that release."""
        for name in ("Cy" + "dian.ipa", "Other.ipa", altsource.NAME + "-1.0.0.ipa"):
            data = altsource.build("1.0.0", 10, "2026-11-18T00:00:00Z")
            data["apps"][0]["versions"][0]["downloadURL"] = altsource.REPO + "/releases/download/v1.0.0/" + name
            self.assertEqual(len(altsource.check(data)), 1, name)

    def test_published_source_lists_only_own_ipas(self):
        """F180a: web/app/source.json lists only <NAME>.ipa entries (update dropped the old-named ones)."""
        with open(altsource.SOURCE) as f:
            versions = json.load(f)["apps"][0]["versions"]
        self.assertEqual([v["version"] for v in versions if not altsource.is_own_ipa(v)], [])


if __name__ == "__main__":
    unittest.main()
