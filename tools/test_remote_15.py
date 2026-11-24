#!/usr/bin/env python3
"""tools/remote-15.py with a fake ui-15.sh and a lock folder: no phone needed."""
import importlib.util, json, os, signal, socket, stat, subprocess, sys, tempfile, time, unittest, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "remote-15.py")

FAKE = """#!/bin/sh
# fake ui-15.sh: lock/unlock on $IFIZBOX_UI_LOCK, every call logged to $FAKE_LOG
echo "$*" >> "$FAKE_LOG"
case $1 in
  lock) mkdir -p "$IFIZBOX_UI_LOCK"; echo "$2" > "$IFIZBOX_UI_LOCK/owner" ;;
  unlock) [ "$(cat "$IFIZBOX_UI_LOCK/owner" 2>/dev/null)" = "$2" ] && rm -rf "$IFIZBOX_UI_LOCK" ;;
  *) [ "$(cat "$IFIZBOX_UI_LOCK/owner" 2>/dev/null)" = "$1" ] || exit 1 ;;
esac
exit 0
"""


class Rig(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = self.tmp.name
        self.fake = os.path.join(d, "ui-15.sh")
        open(self.fake, "w").write(FAKE)
        os.chmod(self.fake, 0o755)
        self.lock = os.path.join(d, "lock")
        self.log = os.path.join(d, "log")
        open(self.log, "w").close()
        self.env = dict(os.environ, IFIZBOX_UI_SCRIPT=self.fake, IFIZBOX_UI_LOCK=self.lock, FAKE_LOG=self.log,
                        IFIZBOX_REMOTE_IP="127.0.0.1")
        os.environ.update({k: self.env[k] for k in ("IFIZBOX_UI_SCRIPT", "IFIZBOX_UI_LOCK", "FAKE_LOG")})
        spec = importlib.util.spec_from_file_location("remote15", SRC)
        self.m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.m)

    def tearDown(self):
        self.tmp.cleanup()

    def hold(self, who):
        os.makedirs(self.lock, exist_ok=True)
        open(os.path.join(self.lock, "owner"), "w").write(who)

    def calls(self):
        return open(self.log).read().splitlines()

    def test_free_lock_is_taken_as_user(self):
        out = self.m.ui("tap", 1, 2)
        self.assertTrue(out.startswith("ok (as USER)"), out)
        self.assertEqual(self.calls(), ["lock USER", "USER tap 1 2"])

    def test_task_lock_refused_then_allowed(self):
        self.hold("T5")
        self.assertIn("refused", self.m.ui("tap", 1, 2))
        self.assertEqual(self.calls(), [])
        self.m.allow()
        self.assertTrue(self.m.ui("tap", 1, 2).startswith("ok (as T5)"))
        self.assertTrue(self.m.ui("home").startswith("ok (as T5)"))

    def test_new_holder_asks_again(self):
        self.hold("T5")
        self.m.allow()
        self.assertTrue(self.m.ui("home").startswith("ok (as T5)"))
        self.hold("T6")
        self.assertIn("refused", self.m.ui("home"))
        self.assertFalse(self.m.is_allowed("T6"))

    def test_sigterm_frees_user_lock_only(self):
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        for who, freed in (("USER", True), ("T7", False)):
            self.hold(who)
            p = subprocess.Popen([sys.executable, SRC, str(port)], env=self.env, stdout=subprocess.PIPE, text=True)
            try:
                self.assertIn(str(port), p.stdout.readline())
                if who == "USER":  # a second start says so and exits 0
                    q = subprocess.run([sys.executable, SRC, str(port)], env=self.env, capture_output=True, text=True, timeout=20)
                    self.assertEqual(q.returncode, 0)
                    self.assertIn("already serving", q.stdout)
                info = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/who", timeout=5))
                self.assertEqual(info["holder"], who)
                p.send_signal(signal.SIGTERM)
                self.assertEqual(p.wait(timeout=20), 0)
            finally:
                if p.poll() is None:
                    p.kill()
            self.assertEqual(not os.path.exists(self.lock), freed, who)


if __name__ == "__main__":
    unittest.main()
