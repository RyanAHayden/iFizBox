"""F374: Installed Apps' IPA work in the shell (native/sign/DecryptedIPA.swift), built for Linux with the Swift
toolchain as native/test_sign.py builds the signer, and run by native/sign/tests/decrypted/main.swift: the helper's
lines, packing a decrypted .app (SC_Info and extensions still encrypted left out), and Build IPA with Tweaks' copy.
The bridge around it (native/Sources/InstalledApps.swift: UIKit, the helper) builds only with the iOS SDK
(tools/check.sh's native build) and runs only on a phone (the F374 journal). Without a Swift toolchain the Swift
part skips and says so."""
import os
import re
import shutil
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from test_sign import toolchain  # noqa: E402
import disktmp  # noqa: E402

SWIFTC = toolchain()


def read(*p):
    with open(os.path.join(HERE, *p)) as f:
        return f.read()


@unittest.skipUnless(SWIFTC, "no Swift toolchain (SWIFT_TOOLCHAIN or swiftc on PATH): native/sign/DecryptedIPA.swift not tested")
class SwiftDecryptedIPA(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = disktmp.build_dir("ifizbox-decryptedtest-")  # off the shared /tmp tmpfs: see native/disktmp.py
        binary = os.path.join(cls.tmp, "decryptedtest")
        env = disktmp.swift_env(dict(os.environ), cls.tmp)
        shim = os.path.join(cls.tmp, "libshim")
        if os.path.exists("/usr/lib/libncursesw.so.6") and not os.path.exists("/usr/lib/libncurses.so.6"):
            os.makedirs(shim)
            os.symlink("/usr/lib/libncursesw.so.6", os.path.join(shim, "libncurses.so.6"))
            env["LD_LIBRARY_PATH"] = shim + (":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")
        sign = os.path.join(HERE, "sign")
        sources = sorted(os.path.join(sign, f) for f in os.listdir(sign) if f.endswith(".swift"))
        r = subprocess.run([SWIFTC, "-module-cache-path", os.path.join(cls.tmp, "modules"),
                            "-import-objc-header", os.path.join(sign, "zlib-shim.h"), *sources,
                            os.path.join(sign, "tests", "decrypted", "main.swift"), "-lz", "-o", binary],
                           capture_output=True, text=True, env=env, timeout=900)
        cls.build_error = None if r.returncode == 0 else (r.stdout + r.stderr)[-4000:]
        scratch = os.path.join(cls.tmp, "scratch")
        os.makedirs(scratch)
        cls.out = None if cls.build_error else subprocess.run([binary, scratch], capture_output=True, text=True,
                                                               timeout=300, env=env)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_swift(self):
        self.assertIsNone(self.build_error, self.build_error)
        self.assertEqual(self.out.returncode, 0, self.out.stdout + self.out.stderr)
        for name in ("parse", "left out", "pack", "withTweaks: the main executable", "withTweaks refuses"):
            self.assertIn(f"ok   {name}", self.out.stdout)
        self.assertIn("all passed", self.out.stdout)


class Wiring(unittest.TestCase):
    def test_registered_and_jailbreak_only(self):
        src = read("Sources", "InstalledApps.swift")
        self.assertIn("InstalledApps.register(b)", read("Sources", "SignBridge.swift"))
        for call in ("apps.icon", "library.decrypt", "library.addTweaks", "library.share"):
            self.assertIn(f'b.on("{call}")', src)
        for f in ("decrypt", "addTweaks", "share"):
            body = src[src.index(f"static func {f}(_ c: Bridge.Call)"):]
            self.assertIn("guard jailbreakOnly(c) else { return }", body[:300], f)

    def test_drop_dir_matches_the_helper(self):
        h = read("helper", "decrypt.h")
        swift = read("Sources", "InstalledApps.swift")
        path = re.search(r'#define HELPER_DECRYPT_DIR "([^"]+)"', h).group(1)
        self.assertTrue(path.startswith("/var/mobile/"), path)
        self.assertIn(f'dropDir = "{path}"', swift)

    def test_helper_entitlements_for_the_suspended_read(self):
        ents = read("helper", "entitlements.plist")
        self.assertIn("<key>task_for_pid-allow</key><true/>", ents)


if __name__ == "__main__":
    unittest.main()
