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
        self.env.pop("AGENT_SLOT", None)  # the gate itself runs in a runner slot

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

    def test_frees_its_slots_after_the_branch_moved(self):
        # the runner may have switched the worktree off task/<ID> before on_exit runs: the slot file still matches
        mine = self.hold("15", "T1")
        (mine / "slot").write_text("3\n")
        other = self.hold("7", "T2")
        (other / "slot").write_text("4\n")
        self.env.pop("AGENT_SLOT", None)
        r = subprocess.run(["sh", str(SCRIPT)], env={**self.env, "AGENT_SLOT": "3"}, capture_output=True,
                           text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertFalse(mine.exists())
        self.assertTrue(other.exists())

    def test_ui15_lock_records_the_slot(self):
        ui15 = ROOT / "tools" / "ui-15.sh"
        r = subprocess.run(["sh", str(ui15), "lock", "T1"], env={**self.env, "AGENT_SLOT": "5"},
                           capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual((self.run_dir / "ifizbox-15-ui.lock" / "slot").read_text().strip(), "5")

    def test_main_is_left_alone(self):
        d = self.hold("15", "main")
        self.assertEqual(self.release("main").returncode, 0)
        self.assertTrue(d.exists())


if __name__ == "__main__":
    unittest.main()
