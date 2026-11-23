"""I2: the sideload IPA's writer/checker (mkipa.py) and its plists. The real build (build.sh ipa) needs the Swift
toolchain and the iOS SDK; tools/check.sh runs it when they are set up, and mkipa.py checks what it made."""
import os
import plistlib
import shutil
import struct
import sys
import tempfile
import unittest
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mkipa  # noqa: E402
from test_native import copy_icons, copy_launch, fake_macho, plist  # noqa: E402


def signed_macho(entitlements):
    """A fake arm64 executable whose LC_CODE_SIGNATURE points at a SuperBlob holding an entitlements blob."""
    xml = plistlib.dumps(entitlements)
    ent = struct.pack(">II", 0xFADE7171, 8 + len(xml)) + xml
    sb = struct.pack(">III", 0xFADE0CC0, 20 + len(ent), 1) + struct.pack(">II", 5, 20) + ent
    head = bytearray(fake_macho())
    # fake_macho's LC_CODE_SIGNATURE is its last 16 bytes: set dataoff/datasize to the blob appended after it.
    struct.pack_into("<II", head, len(head) - 8, len(head), len(sb))
    # strings the real executable carries once idevice is linked in (mkipa.py check looks for them)
    return bytes(head) + sb + IDEVICE_MARKS


IDEVICE_MARKS = b"ifizbox.idevice.pairing\0_remotepairing-pairable-host._tcp\0"
# F372: the app and its built-in VPN's packet tunnel carry Network Extensions (packet-tunnel-provider)
APP_ENTS = {"get-task-allow": True, mkipa.NE: ["packet-tunnel-provider"]}


class Ipa(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        self.app = os.path.join(self.tmp, "iFizBox.app")
        os.makedirs(os.path.join(self.app, "web/nav"))
        self.write("iFizBox", signed_macho(APP_ENTS), 0o755)
        base = os.path.join(self.tmp, "base.plist")
        with open(base, "wb") as f:
            f.write(plist())
        mkipa.merge_plist(base, os.path.join(HERE, "Info-sideload.plist"), os.path.join(self.app, "Info.plist"))
        copy_icons(self.app, lite=True)
        copy_launch(self.app)
        for name in ("index.html", "app.js", "style.css", "router.js", "nav/stack.js"):
            self.write("web/" + name, b"x")
        self.write("bridge.js", b"x")
        # N8: the both-modes App Intents and a widget extension without controls.
        self.intents(sorted(mkipa.SIDELOAD_INTENTS))
        self.write("PlugIns/iFizBoxWidget.appex/iFizBoxWidget", signed_macho({"get-task-allow": True}), 0o755)
        self.write("PlugIns/iFizBoxWidget.appex/Info.plist", plist())
        self.vpn()
        self.ipa = os.path.join(self.tmp, "iFizBox.ipa")

    def vpn(self, ents=APP_ENTS, point="com.apple.networkextension.packet-tunnel"):
        self.write("PlugIns/iFizBoxVPN.appex/iFizBoxVPN", signed_macho(ents), 0o755)
        self.write("PlugIns/iFizBoxVPN.appex/Info.plist", plistlib.dumps({"NSExtension": {"NSExtensionPointIdentifier": point}}))

    def test_vpn_extension_checked(self):
        # F372: the built-in VPN's packet tunnel, with Network Extensions on it and on the app
        self.vpn(ents={"get-task-allow": True})
        self.assertTrue(any("VPN extension lacks" in p for p in self.problems()))
        self.vpn(point="com.apple.share-services")
        self.assertTrue(any("not a packet tunnel" in p for p in self.problems()))
        self.vpn()
        self.write("iFizBox", signed_macho({"get-task-allow": True}), 0o755)
        self.assertTrue(any("the app lacks" in p for p in self.problems()))
        self.write("iFizBox", signed_macho(APP_ENTS), 0o755)
        shutil.rmtree(os.path.join(self.app, "PlugIns/iFizBoxVPN.appex"))
        self.assertTrue(any("no built-in VPN extension" in p for p in self.problems()))

    def intents(self, names, where="Metadata.appintents"):
        import json
        self.write(where + "/extract.actionsdata", json.dumps({"version": 1, "actions": {n: {} for n in names}}).encode())

    def write(self, rel, data, mode=0o644):
        p = os.path.join(self.app, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as f:
            f.write(data)
        os.chmod(p, mode)

    def problems(self):
        mkipa.build(self.app, self.ipa, mtime=0)
        return mkipa.check(self.ipa)[0]

    def test_good_ipa(self):
        self.assertEqual(self.problems(), [])
        names = zipfile.ZipFile(self.ipa).namelist()
        self.assertEqual(names[0], "Payload/")
        self.assertIn("Payload/iFizBox.app/iFizBox", names)
        self.assertRegex(mkipa.check(self.ipa)[1], r"entitlements .*get-task-allow")

    def test_executable_bit_survives(self):
        mkipa.build(self.app, self.ipa, mtime=0)
        i = zipfile.ZipFile(self.ipa).getinfo("Payload/iFizBox.app/iFizBox")
        self.assertEqual((i.external_attr >> 16) & 0o777, 0o755)

    def test_build_is_reproducible(self):
        mkipa.build(self.app, self.ipa, mtime=0)
        first = open(self.ipa, "rb").read()
        os.utime(os.path.join(self.app, "Info.plist"), (12345678, 12345678))
        mkipa.build(self.app, self.ipa, mtime=0)
        self.assertEqual(first, open(self.ipa, "rb").read())

    def test_launch_screen_checked(self):
        """B203: the IPA's splash is the neutral UILaunchScreen (no storyboard: its bars would show Classic whatever
        the theme), and it carries every theme's set for the in-app cover."""
        self.assertEqual([p for p in self.problems() if "aunch" in p], [])
        with open(os.path.join(self.app, "Info.plist"), "rb") as f:
            info = plistlib.load(f)
        self.assertEqual(info.get("UILaunchScreen"), {})
        self.assertNotIn("UILaunchStoryboardName", info)
        self.assertNotIn("IFIZBOX_REMOVE_KEYS", info)
        os.remove(os.path.join(self.app, "LaunchThemes", "gunmetal", "LaunchStripes@2x.png"))
        self.assertIn("launch theme gunmetal: image LaunchStripes@2x.png missing", self.problems())
        info["UILaunchStoryboardName"] = "LaunchScreen"
        with open(os.path.join(self.app, "Info.plist"), "wb") as f:
            plistlib.dump(info, f)
        self.assertTrue(any("UILaunchStoryboardName" in p for p in self.problems()))

    def test_helper_flagged(self):
        self.write("ifizbox-helper", b"x", 0o755)
        self.assertTrue(any("jailbreak files" in p for p in self.problems()))

    def test_daemon_flagged(self):
        """T5: N5's upgrade daemon and its launchd job belong to the .deb only."""
        self.write("ifizbox-upgrades", b"x", 0o755)
        self.write("Library/LaunchDaemons/com.ryha.ifizbox.upgrades.plist", b"x")
        p = " | ".join(self.problems())
        self.assertIn("Payload/iFizBox.app/ifizbox-upgrades", p)
        self.assertIn("com.ryha.ifizbox.upgrades.plist", p)

    def test_notification_entitlement_flagged(self):
        self.write("iFizBox", signed_macho({"get-task-allow": True,
                                           "com.apple.private.usernotifications.bundle-identifiers": ["x"]}), 0o755)
        self.assertTrue(any("usernotifications" in p for p in self.problems()))

    def test_intents_checked(self):
        # N8: only the both-modes intents; the widget's controls and its jailbreak entitlements are the .deb's.
        self.intents(sorted(mkipa.SIDELOAD_INTENTS) + ["RespringIntent"])
        self.assertTrue(any("App Intents" in p and "RespringIntent" in p for p in self.problems()))
        self.intents(sorted(mkipa.SIDELOAD_INTENTS))
        self.intents(["RespringIntent"], "PlugIns/iFizBoxWidget.appex/Metadata.appintents")
        self.assertTrue(any("widget extension carries intents" in p for p in self.problems()))
        os.remove(os.path.join(self.app, "PlugIns/iFizBoxWidget.appex/Metadata.appintents/extract.actionsdata"))
        self.write("PlugIns/iFizBoxWidget.appex/iFizBoxWidget", signed_macho({"com.apple.private.persona-mgmt": True}), 0o755)
        self.assertTrue(any("entitlements in the widget" in p for p in self.problems()))
        shutil.rmtree(os.path.join(self.app, "PlugIns"))
        os.remove(os.path.join(self.app, "Metadata.appintents/extract.actionsdata"))
        p = " | ".join(self.problems())
        self.assertIn("no Metadata.appintents", p)

    def test_jailbreak_entitlements_flagged(self):
        self.write("iFizBox", signed_macho({"platform-application": True, "com.apple.private.security.no-sandbox": True}),
                   0o755)
        p = " | ".join(self.problems())
        self.assertIn("platform-application", p)
        self.assertIn("no-sandbox", p)

    def test_idevice_missing_flagged(self):
        self.write("iFizBox", signed_macho({"get-task-allow": True})[:-len(IDEVICE_MARKS)], 0o755)
        self.assertTrue(any("idevice not linked in" in p for p in self.problems()))

    def test_unsigned_and_wrong_binary_flagged(self):
        self.write("iFizBox", fake_macho(cpu=0x01000007, minos=(14, 0), signed=False), 0o755)
        p = " | ".join(self.problems())
        self.assertIn("not arm64", p)
        self.assertIn("no code signature", p)

    def test_jailbreak_plist_flagged(self):
        # Without the sideload overlay. N9 put the ifizbox:// scheme and the .ipa/.deb types in the base Info.plist (the
        # jailbreak build takes shared files and the share extension's links too), so drop them to see they're checked.
        info = plistlib.loads(plist())
        info.pop("CFBundleURLTypes", None)
        info.pop("CFBundleDocumentTypes", None)
        with open(os.path.join(self.app, "Info.plist"), "wb") as f:
            f.write(plistlib.dumps(info))
        p = " | ".join(self.problems())
        self.assertIn("UIBackgroundModes", p)
        self.assertIn("URL scheme", p)
        self.assertIn(".ipa", p)

    def test_tests_and_missing_router_flagged(self):
        self.write("web/router.test.js", b"x")
        os.remove(os.path.join(self.app, "web/router.js"))
        p = " | ".join(self.problems())
        self.assertIn("tests shipped", p)
        self.assertIn("web/router.js missing", p)

    def test_fixtures_flagged(self):
        self.write("web/core/fixtures/signing/test.p12", b"x")
        self.assertTrue(any("test fixtures shipped" in x for x in self.problems()))

    def test_missing_bridge_flagged(self):
        os.remove(os.path.join(self.app, "bridge.js"))
        self.assertTrue(any("bridge.js missing" in x for x in self.problems()))


class SideloadPlists(unittest.TestCase):
    def test_entitlements_get_task_allow_only(self):
        with open(os.path.join(HERE, "entitlements-sideload.plist"), "rb") as f:
            # N8: plus the App Group the widget reads the count from (signers such as AltStore register it).
            # F372: and Network Extensions' packet tunnel, for the built-in VPN.
            self.assertEqual(plistlib.load(f), {"get-task-allow": True,
                                                "com.apple.security.application-groups": ["group.com.ryha.ifizbox"],
                                                mkipa.NE: ["packet-tunnel-provider"]})

    def test_overlay_keeps_base_keys(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp)
        base, out = os.path.join(tmp, "base.plist"), os.path.join(tmp, "out.plist")
        with open(base, "wb") as f:
            f.write(plist())
        mkipa.merge_plist(base, os.path.join(HERE, "Info-sideload.plist"), out)
        with open(out, "rb") as f:
            info = plistlib.load(f)
        self.assertTrue(info["CADisableMinimumFrameDurationOnPhone"])
        self.assertIn("UIApplicationSceneManifest", info)
        self.assertEqual(info["LSApplicationQueriesSchemes"], ["apple-magnifier"])
        self.assertNotIn("UIBackgroundModes", plistlib.loads(plist()))  # the jailbreak build stays as it was

    def test_splash_status_bar_reads_on_white_and_black(self):
        # The neutral splash is white in light mode: LightContent would put a white status bar on it.
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp)
        base, out = os.path.join(tmp, "base.plist"), os.path.join(tmp, "out.plist")
        with open(base, "wb") as f:
            f.write(plist())
        mkipa.merge_plist(base, os.path.join(HERE, "Info-sideload.plist"), out)
        with open(out, "rb") as f:
            info = plistlib.load(f)
        self.assertEqual(info["UILaunchScreen"], {})
        self.assertEqual(info["UIStatusBarStyle"], "UIStatusBarStyleDefault")
        # view-controller-based appearance stays on, so App.swift's per-controller style applies after launch
        self.assertTrue(info.get("UIViewControllerBasedStatusBarAppearance", True))
        jailbreak = plistlib.loads(plist())
        self.assertEqual(jailbreak["UIStatusBarStyle"], "UIStatusBarStyleLightContent")  # its splash has the blue bar


if __name__ == "__main__":
    unittest.main()
