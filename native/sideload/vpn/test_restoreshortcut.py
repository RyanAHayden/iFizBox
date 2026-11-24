"""F418: the Restore My VPN Shortcut's source, its own actions, and the run state they report into, on Linux."""
import os
import plistlib
import re
import shutil
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
NATIVE = os.path.normpath(os.path.join(HERE, "..", ".."))

sys.path.insert(0, NATIVE)

import disktmp  # noqa: E402
from test_sign import toolchain  # noqa: E402

SWIFTC = toolchain()


def read(*p, base=HERE):
    with open(os.path.join(base, *p)) as f:
        return f.read()


class Source(unittest.TestCase):
    def setUp(self):
        self.swift = read("App", "RestoreShortcut.swift")
        self.intents = read("intents", "App", "RestoreVPN.swift", base=NATIVE)
        with open(os.path.join(os.path.dirname(NATIVE), "tools", "shortcuts", "restore-vpn.plist"), "rb") as f:
            self.wf = plistlib.load(f)

    def steps(self):
        """Every action in order, an If as "if <its input's name>" and "end"."""
        names = {}  # output UUID -> what it is
        out = []
        for a in self.wf["WFWorkflowActions"]:
            i, p = a["WFWorkflowActionIdentifier"], a["WFWorkflowActionParameters"]
            short = i.replace("is.workflow.actions.", "").replace("com.ryha.ifizbox.", "")
            if short == "conditional":
                if p["WFControlFlowMode"] == 0:
                    self.assertEqual(p["WFCondition"], 100)  # has any value: "contains" loses its text on import
                    short = "if " + names[p["WFInput"]["Variable"]["Value"]["OutputUUID"]]
                else:
                    self.assertEqual(p["WFControlFlowMode"], 2)  # no Otherwise
                    short = "end"
            elif short == "getvalueforkey":
                names[p["UUID"]] = p["WFDictionaryKey"]
                short = "key " + p["WFDictionaryKey"]
            elif "UUID" in p:
                names[p["UUID"]] = short
            if short == "vpn.set":
                self.assertEqual(p["WFVPNOperation"], "Connect")
                self.assertEqual(names[p["WFVPN"]["Value"]["OutputUUID"]], "getstoredcontent")
            if short == "setstoredcontent":
                used = list(p["WFInput"]["Value"]["attachmentsByRange"].values())
                self.assertEqual([names[u["OutputUUID"]] for u in used], ["vpn.get"])
            out.append(short)
        return out

    def test_steps(self):
        self.assertEqual(self.steps(), [
            "detect.dictionary", "key store", "key back", "key check",
            # F418b: "nothing" before each of our own, or the VPN left over is shared with the app and iOS asks again
            "if store", "vpn.get", "if vpn.get", "setstoredcontent", "nothing", "RememberedVPNIntent", "end",
            "nothing", "FinishRestoreIntent", "end",
            "if back", "getstoredcontent", "if getstoredcontent", "nothing", "RestoringVPNIntent", "vpn.set", "end",
            "nothing", "FinishRestoreIntent", "end",
            "if check", "nothing", "FinishRestoreIntent", "end",
            "nothing",  # R100b: no output, or iOS asks over the app
        ])
        keys = [s[4:] for s in self.steps() if s.startswith("key ")]
        self.assertEqual(keys, re.search(r"enum Kind: String { case (.+) }", self.swift).group(1).split(", "))

    def test_one_stored_key(self):
        keys = {a["WFWorkflowActionParameters"]["WFStoredContentKey"] for a in self.wf["WFWorkflowActions"]
                if "WFStoredContentKey" in a["WFWorkflowActionParameters"]}
        self.assertEqual(len(keys), 1)

    def test_names_our_actions(self):
        env = read("brand.env", base=NATIVE)
        own = [a for a in self.wf["WFWorkflowActions"] if not a["WFWorkflowActionIdentifier"].startswith("is.workflow.")]
        self.assertEqual(len(own), 5)
        for a in own:
            d = a["WFWorkflowActionParameters"]["AppIntentDescriptor"]
            self.assertIn("struct %s: AppIntent" % d["AppIntentIdentifier"], self.intents)
            self.assertEqual(a["WFWorkflowActionIdentifier"], "%s.%s" % (d["BundleIdentifier"], d["AppIntentIdentifier"]))
            self.assertIn(d["BundleIdentifier"], env)
        self.assertNotIn("openAppWhenRun", self.intents)  # Shortcuts' callback brings the app back

    @unittest.skipUnless(SWIFTC, "no Swift toolchain (SWIFT_TOOLCHAIN or swiftc on PATH): RestoreShortcut.swift not tested")
    def test_state(self):
        tmp = disktmp.build_dir("ifizbox-restoretest-")
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        env = disktmp.swift_env(dict(os.environ), tmp)
        if os.path.exists("/usr/lib/libncursesw.so.6") and not os.path.exists("/usr/lib/libncurses.so.6"):
            os.makedirs(os.path.join(tmp, "libshim"))
            os.symlink("/usr/lib/libncursesw.so.6", os.path.join(tmp, "libshim", "libncurses.so.6"))
            env["LD_LIBRARY_PATH"] = os.path.join(tmp, "libshim") + (":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")
        binary = os.path.join(tmp, "restoretest")
        r = subprocess.run([SWIFTC, "-module-cache-path", os.path.join(tmp, "modules"), os.path.join(HERE, "App", "RestoreShortcut.swift"),
                            os.path.join(HERE, "tests", "restore", "main.swift"), "-o", binary], capture_output=True, text=True, env=env, timeout=600)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-4000:])
        r = subprocess.run([binary], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
