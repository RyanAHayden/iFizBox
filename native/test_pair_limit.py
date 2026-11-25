"""B436: a This iPhone pairing left open stops after 10 minutes. The real sideload/idevice/IDeviceBridge.swift is built
on Linux with tests/pairlimit/main.swift's stand-ins and a fake clock. Without a Swift toolchain it skips and says so."""
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
SRC = os.path.join(HERE, "sideload", "idevice", "IDeviceBridge.swift")


def on_linux(src):
    """IDeviceBridge.swift with no iOS imports and its timers on the stand-in clock."""
    src = re.sub(r"^import (UIKit|UserNotifications)\n", "", src, flags=re.M)
    src, n = re.subn(r"DispatchQueue\.global\(qos: \.utility\)\.asyncAfter\((?:deadline|wallDeadline): \.now\(\) \+ (\w+)\)",
                     r"Clock.after(\1)", src)
    if n != 2:
        raise AssertionError(f"expected leaveGrace's and pairLimit's timers, found {n}")
    return src


@unittest.skipUnless(SWIFTC, "no Swift toolchain (SWIFT_TOOLCHAIN or swiftc on PATH): idevice.pair's limit not tested")
class PairLimit(unittest.TestCase):
    def test_limit(self):
        tmp = disktmp.build_dir("ifizbox-pairlimit-")
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        env = disktmp.swift_env(dict(os.environ), tmp)
        shim = os.path.join(tmp, "libshim")
        if os.path.exists("/usr/lib/libncursesw.so.6") and not os.path.exists("/usr/lib/libncurses.so.6"):
            os.makedirs(shim)
            os.symlink("/usr/lib/libncursesw.so.6", os.path.join(shim, "libncurses.so.6"))
            env["LD_LIBRARY_PATH"] = shim + (":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")
        bridge = os.path.join(tmp, "IDeviceBridge.swift")
        with open(SRC) as f, open(bridge, "w") as out:
            out.write(on_linux(f.read()))
        binary = os.path.join(tmp, "pairlimit")
        r = subprocess.run([SWIFTC, "-swift-version", "5", "-module-cache-path", os.path.join(tmp, "modules"), bridge,
                            os.path.join(HERE, "tests", "pairlimit", "main.swift"), "-o", binary],
                           capture_output=True, text=True, env=env, timeout=600)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-4000:])
        out = subprocess.run([binary], capture_output=True, text=True, timeout=300)
        self.assertEqual(out.returncode, 0, out.stdout + out.stderr)
        self.assertIn("all passed", out.stdout)


if __name__ == "__main__":
    unittest.main()
