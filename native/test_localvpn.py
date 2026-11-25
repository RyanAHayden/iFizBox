"""B443: a start of the built-in VPN that stalls is done once more: the rule (VPNStart.swift) run on Linux, LocalVPN's
use of it read as text."""
import os
import shutil
import subprocess
import unittest

import disktmp
from test_sign import toolchain

HERE = os.path.dirname(os.path.abspath(__file__))
VPN = os.path.join(HERE, "sideload", "vpn")
SWIFTC = toolchain()


class Start(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(VPN, "App", "LocalVPN.swift")) as f:
            src = f.read()
        self.start = src[src.index("private static func start("):src.index("/// Before a connect to iOS")]

    def assertOrder(self, text, steps):
        self.assertEqual(sorted(steps, key=text.index), steps)

    def test_again_after_a_stall(self):
        again = self.start[self.start.index("again: {"):]
        # the status is logged; no second start in the background, cancelled or without a network; the old one is off first
        self.assertOrder(again, ["log(", "guard finishing || !mustWait() else { return false }", "try step(",
                                 "if !Path.online() { throw noNetwork() }", "takeDown("])
        attempt = self.start[self.start.index("VPNStart.twice("):self.start.index("again: {")]
        self.assertOrder(attempt, ["RestoreBack.note()", "try manager()", "VPNStart.watch("])  # read again at each start

    @unittest.skipUnless(SWIFTC, "no Swift toolchain (SWIFT_TOOLCHAIN or swiftc on PATH): VPNStart.swift not tested")
    def test_rules(self):
        tmp = disktmp.build_dir("ifizbox-vpnstarttest-")
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        env = disktmp.swift_env(dict(os.environ), tmp)
        if os.path.exists("/usr/lib/libncursesw.so.6") and not os.path.exists("/usr/lib/libncurses.so.6"):
            os.makedirs(os.path.join(tmp, "libshim"))
            os.symlink("/usr/lib/libncursesw.so.6", os.path.join(tmp, "libshim", "libncurses.so.6"))
            env["LD_LIBRARY_PATH"] = os.path.join(tmp, "libshim") + (":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")
        binary = os.path.join(tmp, "vpnstarttest")
        r = subprocess.run([SWIFTC, "-module-cache-path", os.path.join(tmp, "modules"), os.path.join(VPN, "App", "VPNStart.swift"),
                            os.path.join(VPN, "tests", "vpnstart", "main.swift"), "-o", binary], capture_output=True, text=True, env=env, timeout=600)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-4000:])
        r = subprocess.run([binary], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
