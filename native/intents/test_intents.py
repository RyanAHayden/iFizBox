"""N8: iFizBox's App Intents, widget and controls.

- SwiftIntents: native/intents/tests/main.swift, built on Linux with Core.swift and native/sign/Updates.swift, runs
  each intent against the fake helper (native/fake/ifizbox-helper) over native/fake/fixture/prefix. The sideload
  restore's ifizbox://import link is decoded here as web/app/core/transfer.js decodeLink would.
- Metadata: metadata.py writes what Xcode 27's appintentsmetadataprocessor wrote for sweetpad's capture (fixtures/),
  covers iFizBox's own intent shapes, and refuses what it doesn't handle.
- Built: when native/build.sh has built the .deb and the IPA (tools/check.sh does, where the toolchain is), the
  jailbreak app lists every intent and its widget the controls; the IPA only the both-modes intents, and a widget
  with no controls and no jailbreak entitlements.
- Wiring: the text that ties it together (build.sh, the shell's ifizbox://add, the helper verb).
Without a Swift toolchain (SWIFT_TOOLCHAIN, or swiftc on PATH) the Swift part skips and says so."""
import base64
import gzip
import json
import os
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
NATIVE = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, NATIVE)

import metadata as M  # noqa: E402
from test_sign import toolchain  # noqa: E402
import disktmp  # noqa: E402
from mkipa import macho_entitlements  # noqa: E402

SWIFTC = toolchain()
JAILBREAK = {"CheckForUpdatesIntent", "AddSourceIntent", "RestorePackagesIntent", "InstallAllUpdatesIntent",
             "RespringIntent", "UserspaceRebootIntent", "ExportPackagesIntent"}
SWITCH = ["ConnectVPNIntent", "OpenForInstallIntent", "WaitForInstallIntent"]  # F394: the Install Switch's
SIDELOAD = {"CheckForUpdatesIntent", "AddSourceIntent", "RestorePackagesIntent", *SWITCH}


def read(*p):
    with open(os.path.join(NATIVE, *p)) as f:
        return f.read()


@unittest.skipUnless(SWIFTC, "no Swift toolchain (SWIFT_TOOLCHAIN or swiftc on PATH): native/intents/Core.swift not tested")
class SwiftIntents(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = disktmp.build_dir("ifizbox-intentstest-")  # off the shared /tmp tmpfs: see native/disktmp.py
        binary = os.path.join(cls.tmp, "intentstest")
        env = disktmp.swift_env(dict(os.environ), cls.tmp)
        shim = os.path.join(cls.tmp, "libshim")
        if os.path.exists("/usr/lib/libncursesw.so.6") and not os.path.exists("/usr/lib/libncurses.so.6"):
            os.makedirs(shim)
            os.symlink("/usr/lib/libncursesw.so.6", os.path.join(shim, "libncurses.so.6"))
            env["LD_LIBRARY_PATH"] = shim + (":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")
        r = subprocess.run([SWIFTC, "-module-cache-path", os.path.join(cls.tmp, "modules"),
                            os.path.join(HERE, "Core.swift"), os.path.join(NATIVE, "sign", "Updates.swift"), os.path.join(NATIVE, "sign", "Brand.swift"),
                            os.path.join(HERE, "tests", "main.swift"), "-o", binary],
                           capture_output=True, text=True, env=env, timeout=600)
        cls.build_error = None if r.returncode == 0 else (r.stdout + r.stderr)[-4000:]
        cls.out = None
        if not cls.build_error:
            fake = os.path.join(NATIVE, "fake")
            run_env = dict(os.environ, TMPDIR=cls.tmp)
            cls.out = subprocess.run([binary, os.path.join(fake, "ifizbox-helper"), os.path.join(fake, "fixture", "prefix"),
                                      os.path.join(fake, "fixture", "remote")],
                                     capture_output=True, text=True, timeout=300, env=run_env)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_swift(self):
        self.assertIsNone(self.build_error, self.build_error)
        self.assertEqual(self.out.returncode, 0, self.out.stdout + self.out.stderr)
        for name in ("check for updates: apt update", "install all updates: apply", "respring and userspace reboot",
                     "add source", "export my packages", "restore my packages: new sources", "restore my packages: sideload"):
            self.assertIn("ok   " + name, self.out.stdout)
        self.assertIn("all passed", self.out.stdout)

    def test_sideload_restore_link_decodes_like_transfer_js(self):
        self.assertIsNone(self.build_error, self.build_error)
        line = next(l for l in self.out.stdout.splitlines() if l.startswith("LINK "))
        url = line[5:]
        self.assertRegex(url, r"^ifizbox://import\?d=[A-Za-z0-9_-]+$")  # decodeLink's pattern
        d = url.split("d=", 1)[1]
        payload = json.loads(gzip.decompress(base64.urlsafe_b64decode(d + "=" * (-len(d) % 4))))
        self.assertEqual(payload, {"v": 1, "sources": ["deb https://apt.procurs.us/ 1800 main", "https://havoc.app/"],
                                   "settings": {}, "holds": []})


class Metadata(unittest.TestCase):
    def fixture(self, name):
        with open(os.path.join(HERE, "fixtures", name)) as f:
            return json.load(f)

    @staticmethod
    def norm(d):
        d = json.loads(json.dumps(d))
        d.pop("generator", None)
        for a in d["actions"].values():
            for p in a["parameters"]:
                p["resolvableInputTypes"] = sorted(json.dumps(x, sort_keys=True) for x in p["resolvableInputTypes"])
        return d

    def test_matches_xcode(self):
        got = M.extract(self.fixture("sweetpad-dataapp.swiftconstvalues"))
        self.assertEqual(self.norm(got), self.norm(self.fixture("sweetpad-dataapp.actionsdata")))

    def intent(self, props, result=None, name="X"):
        t = {"typeName": "iFizBox." + name, "mangledTypeName": "7iFizBox1XV", "conformances": ["AppIntents.AppIntent"],
             "properties": props, "associatedTypeAliases": []}
        if result:
            t["associatedTypeAliases"].append(result)
        return t

    def lit(self, label, v, static=True):
        return {"label": label, "isStatic": "true" if static else "false", "valueKind": "RawLiteral", "value": v}

    def param(self, label, typ, title="T", desc=None):
        args = [{"label": "title", "valueKind": "RawLiteral", "value": title},
                {"label": "description", "valueKind": "NilLiteral"} if desc is None else
                {"label": "description", "valueKind": "RawLiteral", "value": desc},
                {"label": "default", "valueKind": "NilLiteral"}]
        return {"label": label, "type": typ, "isStatic": "false", "isComputed": "true", "valueKind": "InitCall",
                "value": {"type": "AppIntents.IntentParameter<%s>" % typ, "arguments": args}}

    def test_ifizbox_shapes(self):
        result = {"typeAliasName": "PerformResult", "opaqueTypeProtocolRequirements": ["AppIntents.ProvidesDialog", "AppIntents.ReturnsValue"],
                  "opaqueTypeSameTypeRequirements": [{"typeAliasName": "AppIntents.IntentResult.Value",
                                                     "substitutedTypeName": "Swift.Array<Swift.String>"}]}
        t = self.intent([self.lit("title", "Restore"), self.lit("description", "D"), self.lit("openAppWhenRun", "true"),
                         self.param("file", "AppIntents.IntentFile", "File", "F"), self.param("url", "Swift.Optional<Foundation.URL>"),
                         {"label": "_file", "isStatic": "false", "valueKind": "InitCall",
                          "value": {"type": "AppIntents.IntentParameter<AppIntents.IntentFile>", "arguments": []}},
                         {"label": "$file", "isStatic": "false", "valueKind": "Runtime"}], result)
        a = M.extract([t])["actions"]["X"]
        self.assertEqual((a["openAppWhenRun"], a["supportedModes"], a["outputFlags"]), (True, 2, 4))
        self.assertEqual(a["outputType"], M.array_of(M.primitive(0)))
        self.assertEqual(a["descriptionMetadata"]["descriptionText"]["key"], "D")
        self.assertEqual([p["name"] for p in a["parameters"]], ["file", "url"])
        f, u = a["parameters"]
        self.assertEqual(f["valueType"], {"intents": {"wrapper": {"typeIdentifier": 12}}})
        self.assertEqual((f["isOptional"], f["parameterDescription"]["key"], f["resolvableInputTypes"]), (False, "F", []))
        self.assertEqual((u["isOptional"], u["valueType"]), (True, M.primitive(11)))
        file_result = {"typeAliasName": "PerformResult", "opaqueTypeProtocolRequirements": ["AppIntents.ReturnsValue"],
                       "opaqueTypeSameTypeRequirements": [{"typeAliasName": "AppIntents.IntentResult.Value",
                                                          "substitutedTypeName": "AppIntents.IntentFile"}]}
        e = M.extract([self.intent([self.lit("title", "Export")], file_result)])["actions"]["X"]
        self.assertEqual((e["outputFlags"], e["supportedModes"], e["outputType"]), (0, 1, {"intents": {"wrapper": {"typeIdentifier": 12}}}))

    def test_only_and_shortcuts(self):
        def shortcut(intent):
            return {"valueKind": "InitCall", "value": {"type": "AppIntents.AppShortcut", "arguments": [
                {"label": "intent", "type": "iFizBox." + intent, "valueKind": "InitCall", "value": {"type": "iFizBox." + intent, "arguments": []}},
                {"label": "phrases", "valueKind": "Array", "value": [{"valueKind": "InterpolatedStringLiteral", "value": {"segments": [
                    {"valueKind": "RawLiteral", "value": "Go "}, {"valueKind": "Enum", "value": {"name": "applicationName"}}]}}]},
                {"label": "shortTitle", "valueKind": "RawLiteral", "value": intent},
                {"label": "systemImageName", "valueKind": "RawLiteral", "value": "power"}]}}
        provider = {"typeName": "iFizBox.S", "mangledTypeName": "7iFizBox1SV", "conformances": ["AppIntents.AppShortcutsProvider"],
                    "properties": [{"label": "appShortcuts", "isStatic": "true", "valueKind": "Builder",
                                    "value": {"members": [{"element": shortcut("A")}, {"element": shortcut("B")}]}}]}
        types = [self.intent([self.lit("title", "A")], name="A"), self.intent([self.lit("title", "B")], name="B"), provider]
        all_ = M.extract(types)
        self.assertEqual(sorted(all_["actions"]), ["A", "B"])
        self.assertEqual([s["phraseTemplates"][0]["key"] for s in all_["autoShortcuts"]], ["Go ${applicationName}"] * 2)
        some = M.extract(types, only=["A"])
        self.assertEqual((sorted(some["actions"]), [s["actionIdentifier"] for s in some["autoShortcuts"]]), (["A"], ["A"]))
        with self.assertRaises(M.Unsupported):
            M.extract(types, only=["Nope"])

    def test_refuses_what_it_does_not_write(self):
        bad = [
            self.intent([]),  # no title
            self.intent([self.lit("title", "x"), self.param("e", "iFizBox.Thing")]),  # an entity/enum parameter
            self.intent([self.lit("title", "x"), self.lit("supportedModes", "background")]),
            {"typeName": "iFizBox.E", "mangledTypeName": "x", "conformances": ["AppIntents.AppEntity"], "properties": []},
        ]
        for t in bad:
            with self.subTest(t=t["typeName"]), self.assertRaises(M.Unsupported):
                M.extract([t])

    def test_check(self):
        d = tempfile.mkdtemp()
        try:
            self.assertTrue(M.check(d))
            with open(os.path.join(d, "x.json"), "w") as f:
                json.dump(self.fixture("sweetpad-dataapp.swiftconstvalues"), f)
            M.build(os.path.join(d, "x.json"), os.path.join(d, "Metadata.appintents"))
            self.assertEqual(M.check(os.path.join(d, "Metadata.appintents"), ["Greet"]), [])
            self.assertTrue(M.check(os.path.join(d, "Metadata.appintents"), ["Other"]))
        finally:
            shutil.rmtree(d)


BUILD = os.path.join(NATIVE, "build")
DEB_APP = os.path.join(BUILD, "root", "var", "jb", "Applications", "iFizBox.app")
IPA = os.path.join(BUILD, "iFizBox.ipa")


def built():
    """The build's outputs, when they're newer than every source of N8's (else a stale build would be tested)."""
    if not (os.path.isdir(DEB_APP) and os.path.exists(IPA)):
        return False
    newest = max(os.path.getmtime(os.path.join(dp, f)) for d in ("intents", "widget")
                 for dp, _, fs in os.walk(os.path.join(NATIVE, d)) for f in fs if not f.endswith(".pyc"))
    return os.path.getmtime(IPA) >= newest and os.path.getmtime(os.path.join(DEB_APP, "Info.plist")) >= newest


@unittest.skipUnless(built(), "native/build has no fresh .deb and IPA (tools/check.sh builds them where the toolchain is)")
class Built(unittest.TestCase):
    def test_jailbreak_app(self):
        self.assertEqual(M.check(os.path.join(DEB_APP, "Metadata.appintents"), sorted(JAILBREAK)), [])
        appex = os.path.join(DEB_APP, "PlugIns", "iFizBoxWidget.appex")
        with open(os.path.join(appex, "Info.plist"), "rb") as f:
            info = plistlib.load(f)
        self.assertEqual(info["NSExtension"]["NSExtensionPointIdentifier"], "com.apple.widgetkit-extension")
        self.assertEqual((info["CFBundleIdentifier"], info["MinimumOSVersion"]), ("com.ryha.ifizbox.widget", "17.0"))
        self.assertEqual(M.check(os.path.join(appex, "Metadata.appintents"), ["RespringIntent", "UserspaceRebootIntent"]), [])
        with open(os.path.join(appex, "iFizBoxWidget"), "rb") as f:
            ents = macho_entitlements(f.read()) or {}
        self.assertIn("com.apple.private.persona-mgmt", ents)
        self.assertEqual(ents.get("com.apple.security.application-groups"), ["group.com.ryha.ifizbox"])

    def test_ipa_carries_the_both_modes_intents(self):
        with zipfile.ZipFile(IPA) as z:
            names = set(z.namelist())
            meta = json.loads(z.read("Payload/iFizBox.app/Metadata.appintents/extract.actionsdata"))
            exe = z.read("Payload/iFizBox.app/PlugIns/iFizBoxWidget.appex/iFizBoxWidget")
        self.assertEqual(set(meta["actions"]), SIDELOAD)
        self.assertEqual({s["actionIdentifier"] for s in meta["autoShortcuts"]}, {"CheckForUpdatesIntent"})
        self.assertNotIn("Payload/iFizBox.app/PlugIns/iFizBoxWidget.appex/Metadata.appintents/extract.actionsdata", names)
        ents = macho_entitlements(exe) or {}
        self.assertFalse([k for k in ents if k.startswith("com.apple.private") or k == "platform-application"], ents)


class Wiring(unittest.TestCase):
    def test_build(self):
        b = read("build.sh")
        self.assertIn("intents/*.swift intents/App/*.swift", b)
        self.assertIn("-emit-const-values-path", b)
        self.assertIn("-weak_framework,AppIntents", b)
        self.assertIn("widget/build.sh", b)
        self.assertIn("SIDELOAD_INTENTS=" + ",".join(["CheckForUpdatesIntent", "AddSourceIntent", "RestorePackagesIntent", *SWITCH]), b)
        self.assertIn("JAILBREAK_INTENTS", b)
        for name in SWITCH:
            self.assertNotIn(name, re.search(r"^JAILBREAK_INTENTS=.*", b, re.M).group(0))

    def test_intents_match_the_lists(self):
        src = read("intents", "App", "Intents.swift")
        for name in JAILBREAK:
            self.assertIn("struct %s: AppIntent" % name, src)
        self.assertNotIn("import UIKit", src)
        switch = read("intents", "App", "InstallSwitch.swift")
        for name in SWITCH:
            self.assertIn("struct %s: AppIntent" % name, switch)
        self.assertNotIn("ReturnsValue", switch)  # output as the last action makes iOS ask over the app
        self.assertNotIn("import UIKit", switch)
        self.assertNotIn("import WidgetKit", src)

    def test_shell_takes_ifizbox_add(self):
        self.assertIn('"add"', read("sign", "Handoff.swift"))
        self.assertIn("WidgetStore.save", read("Sources", "Notifications.swift"))
        with open(os.path.join(os.path.dirname(NATIVE), "web", "app", "incoming.js")) as f:
            self.assertIn("ifizbox:\\/\\/add", f.read())

    def test_helper_verb(self):
        self.assertIn('"userspace-reboot"', read("helper", "policy.c"))
        self.assertIn("userspace-reboot)", read("fake", "ifizbox-helper"))

    def test_entitlements_have_the_group(self):
        for p in ("entitlements.plist", "entitlements-sideload.plist", "widget/entitlements.plist", "widget/entitlements-sideload.plist"):
            with open(os.path.join(NATIVE, p), "rb") as f:
                self.assertEqual(plistlib.load(f)["com.apple.security.application-groups"], ["group.com.ryha.ifizbox"], p)
        with open(os.path.join(NATIVE, "widget", "entitlements-sideload.plist"), "rb") as f:
            self.assertFalse([k for k in plistlib.load(f) if "private" in k or k == "platform-application"])


if __name__ == "__main__":
    unittest.main()
