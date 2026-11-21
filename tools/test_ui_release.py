"""tools/ui-release.sh gives back the phone UI locks the named task holds, and only those (a dropped task must not
hold a phone, and must not free another task's)."""
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "tools" / "ui-release.sh"


class UiRelease(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.run_dir = Path(self.tmp.name)
        self.env = {**os.environ, "XDG_RUNTIME_DIR": self.tmp.name}

    def tearDown(self):
        self.tmp.cleanup()

    def hold(self, phone, owner):
        d = self.run_dir / f"ifizbox-{phone}-ui.lock"
        d.mkdir()
        (d / "owner").write_text(owner + "\n")
        return d

    def release(self, *args):
        return subprocess.run(["sh", str(SCRIPT), *args], env=self.env, capture_output=True, text=True, timeout=30)

    def test_frees_only_its_own(self):
        mine15, mine7 = self.hold("15", "T1"), self.hold("7", "T1")
        theirs = self.hold("4s", "T2")
        r = self.release("T1")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertFalse(mine15.exists())
        self.assertFalse(mine7.exists())
        self.assertTrue(theirs.exists())

    def test_task_prefix_and_nothing_held(self):
        mine = self.hold("15", "T1")
        self.assertEqual(self.release("task/T1").returncode, 0)
        self.assertFalse(mine.exists())
        self.assertEqual(self.release("T1").returncode, 0)  # nothing held: still fine

    def test_main_is_left_alone(self):
        d = self.hold("15", "main")
        self.assertEqual(self.release("main").returncode, 0)
        self.assertTrue(d.exists())


if __name__ == "__main__":
    unittest.main()
