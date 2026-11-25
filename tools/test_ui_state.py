"""`state` of tools/ui-15.sh, ui-7.sh and ui-4s.sh: exit 0 free, 75 busy (line 1 = holder), 69 missing (line 1 = why).
Fake lock folder and fake phone commands (ssh, ios) on PATH: never the real phones."""
import os
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PHONES = {"ui-7.sh": "ifizbox-7-ui.lock", "ui-4s.sh": "ifizbox-4s-ui.lock", "ui-15.sh": "ifizbox-15-ui.lock"}


class UiState(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.bin = self.dir / "bin"
        self.bin.mkdir()
        self.rig = self.dir / "rig"
        self.rig.mkdir()
        self.env = {**os.environ, "XDG_RUNTIME_DIR": str(self.dir), "PATH": f"{self.bin}:{os.environ['PATH']}",
                    "IFIZBOX_15_RIG": str(self.rig), "IFIZBOX_15_UDID": "FAKEUDID"}
        self.env.pop("AGENT_SLOT", None)

    def tearDown(self):
        self.tmp.cleanup()

    def phone(self, up):
        fake = f"#!/bin/sh\n{'echo FAKEUDID; exit 0' if up else 'exit 1'}\n"
        for name in ("ssh", "ios"):
            p = self.bin / name
            p.write_text(fake)
            p.chmod(0o755)

    def state(self, script):
        return subprocess.run(["sh", str(ROOT / "tools" / script), "state"], env=self.env, capture_output=True,
                              text=True, timeout=30)

    def lock(self, script, owner, age_min=0):
        d = self.dir / PHONES[script]
        d.mkdir()
        (d / "owner").write_text(owner + "\n")
        t = time.time() - age_min * 60
        os.utime(d / "owner", (t, t))

    def test_hung_phone_answers_within_timeout(self):
        for script in PHONES:
            for name in ("ssh", "ios"):
                p = self.bin / name
                p.write_text("#!/bin/sh\nsleep 60\n")
                p.chmod(0o755)
            t = time.time()
            r = self.state(script)
            self.assertEqual(r.returncode, 69, script)
            self.assertLess(time.time() - t, 12, script)

    def test_ownerless_lock_is_busy(self):
        self.phone(True)
        for script, lockname in PHONES.items():
            (self.dir / lockname).mkdir()
            r = self.state(script)
            self.assertEqual((r.returncode, r.stdout.splitlines()[0]), (75, "?"), script)

    def test_each(self):
        for script, lockname in PHONES.items():
            with self.subTest(script=script, case="free"):
                self.phone(True)
                r = self.state(script)
                self.assertEqual(r.returncode, 0, r.stderr)
                self.assertFalse((self.dir / lockname).exists())  # takes no lock
            with self.subTest(script=script, case="missing"):
                self.phone(False)
                r = self.state(script)
                self.assertEqual(r.returncode, 69)
                self.assertTrue(r.stdout.splitlines()[0])
            with self.subTest(script=script, case="busy"):
                self.phone(True)
                self.lock(script, "T99")
                r = self.state(script)
                self.assertEqual(r.returncode, 75)
                self.assertEqual(r.stdout.splitlines()[0], "T99")
                self.assertEqual((self.dir / lockname / "owner").read_text(), "T99\n")  # unchanged
            with self.subTest(script=script, case="stale"):
                (self.dir / lockname / "owner").unlink()
                (self.dir / lockname).rmdir()
                self.lock(script, "T98", age_min=31)
                r = self.state(script)
                self.assertEqual(r.returncode, 0, r.stdout)
                self.assertEqual((self.dir / lockname / "owner").read_text(), "T98\n")
                (self.dir / lockname / "owner").unlink()
                (self.dir / lockname).rmdir()


if __name__ == "__main__":
    unittest.main()
