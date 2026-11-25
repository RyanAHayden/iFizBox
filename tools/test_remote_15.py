#!/usr/bin/env python3
"""tools/remote-15.py for all three phones, with a fake ui script, a fake ssh and a lock folder: no phone needed."""
import importlib.util, io, json, os, signal, socket, stat, subprocess, sys, tempfile, time, unittest, urllib.error, urllib.request

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


FAKE_VNC = """#!/usr/bin/env python3
# fake ssh: the 4S's Veency, 2x2 pixels. Says nothing until the fake ui script logged a tap (Accept), unless it has VNC_OPEN.
import os, struct, sys, time, zlib
if "-W" not in sys.argv: sys.exit()
o, i = sys.stdout.buffer, sys.stdin.buffer
def out(b): o.write(b); o.flush()
out(b"RFB 003.008\\n"); i.read(12)
while "VNC_OPEN" not in os.environ and " tap 92 363" not in open(os.environ["FAKE_LOG"]).read(): time.sleep(.05)
out(bytes([1, int(os.environ.get("VNC_TYPE", "1"))])); i.read(1); out(struct.pack(">I", 0)); i.read(1)
out(struct.pack(">HH16sI", 2, 2, b"", 2) + b"4s"); i.read(20 + 12 + 6 + 10)
z = zlib.compressobj()
def rect(x, y, w, h, px):
    d = z.compress(px) + z.flush(zlib.Z_SYNC_FLUSH)
    return struct.pack(">HHHHiI", x, y, w, h, 6, len(d)) + d
out(b"\\2" + struct.pack(">BxH", 0, 2) + struct.pack(">HHHHi", 0, 0, 3, 2, -239) + bytes(12 + 2) + rect(0, 0, 2, 2, b"abcdefgh")); i.read(10)
out(struct.pack(">BxH", 0, 1) + rect(1, 1, 1, 1, b"ZZ")); i.read(10)
time.sleep(30)
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

    def serve(self, phone, **env):
        """The real script for one phone on a free port; its base URL, killed at the end of the test."""
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        p = subprocess.Popen([sys.executable, SRC, phone, str(port)], env=dict(self.env, **env), stdout=subprocess.PIPE,
                             stderr=subprocess.DEVNULL, text=True)
        self.addCleanup(p.stdout.close)
        self.addCleanup(p.wait)
        self.addCleanup(p.kill)
        self.assertIn(str(port), p.stdout.readline())
        return f"http://127.0.0.1:{port}/"

    def act(self, base, **cmd):
        try:
            return urllib.request.urlopen(base + "act", json.dumps(cmd).encode(), timeout=30).read().decode()
        except urllib.error.HTTPError as e:
            with e:
                return f"{e.code} {e.read().decode()}"

    def fake_ssh(self, text):
        path = os.path.join(self.tmp.name, "ssh")
        with open(path, "w") as f:
            f.write(text)
        os.chmod(path, 0o755)
        old = os.environ["PATH"]
        os.environ["PATH"] = self.env["PATH"] = self.tmp.name + os.pathsep + old
        self.addCleanup(os.environ.__setitem__, "PATH", old)

    def test_each_phone_has_its_own_lock_script_port_and_size(self):
        for k in ("IFIZBOX_UI_SCRIPT", "IFIZBOX_UI_LOCK"):
            os.environ.pop(k)
        ports = set()
        for phone, size in (("15", (1179, 2556)), ("7", (750, 1334)), ("4s", (320, 480))):
            self.m.use(phone)
            self.assertTrue(os.access(self.m.UI, os.X_OK), self.m.UI)
            self.assertTrue(self.m.UI.endswith(f"/ui-{phone}.sh"))
            self.assertTrue(self.m.LOCK.endswith(f"/ifizbox-{phone}-ui.lock"))
            self.assertEqual(self.m.PHONES[phone]["size"], size)
            src = open(self.m.UI).read()
            for c in self.m.PHONES[phone]["cmds"]:  # only what the script does ("screen" is ours)
                self.assertTrue(c == "screen" or f"ME {c}" in src, f"{phone} {c}")
            ports.add(self.m.PHONES[phone]["port"])
        self.assertEqual(ports, {8098, 8099, 8101})

    def test_page_and_actions_per_phone(self):
        for phone, refused in (("15", ("screen",)), ("7", ("type", "wake", "screen")), ("4s", ("type", "wake"))):
            self.fake_ssh("#!/bin/sh\nexit 1\n")
            base = self.serve(phone)
            page = urllib.request.urlopen(base, timeout=5).read().decode()
            w, h = self.m.PHONES[phone]["size"]
            self.assertIn(f"W={w},H={h},CMDS={json.dumps(self.m.PHONES[phone]['cmds'])};", page)
            self.assertIn(self.m.PHONES[phone]["name"], page)
            for c in refused:
                self.assertTrue(self.act(base, cmd=c, text="x").startswith("400"), (phone, c))
            self.assertEqual(self.calls(), [])
            for cmd, line in ((dict(cmd="tap", x=3, y=4), "tap 3 4"), (dict(cmd="home"), "home"),
                              (dict(cmd="swipe", x1=1, y1=2, x2=3, y2=4, secs=.5), "swipe 1 2 3 4 0.5")):
                self.assertTrue(self.act(base, **cmd).startswith("ok (as USER)"), phone)
                self.assertEqual(self.calls()[-1], "USER " + line)
            self.hold("T9")
            self.assertIn("refused: T9", self.act(base, cmd="home"))
            self.act(base, cmd="allow")
            self.assertTrue(self.act(base, cmd="home").startswith("ok (as T9)"))
            self.assertEqual(json.load(urllib.request.urlopen(base + "who", timeout=5)),
                             {"phone": phone, "holder": "T9", "allowed": True})
            if phone == "7":  # another phone's page on the port isn't "already serving"
                q = subprocess.run([sys.executable, SRC, "4s", base.split(":")[2].strip("/")], env=self.env, capture_output=True, text=True, timeout=20)
                self.assertNotEqual(q.returncode, 0)
            os.remove(os.path.join(self.lock, "owner"))
            os.rmdir(self.lock)
            open(self.log, "w").close()

    def test_7_stream_splits_into_pngs(self):
        a, b = (b"\x89PNG" + bytes([n]) * 99 + self.m.PNG_END for n in (1, 2))
        self.assertEqual(list(self.m.pngs(io.BufferedReader(io.BytesIO(a + b + a[:20])))), [a, b])

    def jpeg(self, base):
        end = time.time() + 20
        while time.time() < end:
            try:
                with urllib.request.urlopen(base + "frame?after=-1", timeout=20) as r:
                    return r.read()
            except urllib.error.HTTPError as e:
                e.close()
                time.sleep(.2)
        self.fail("no frame")

    @unittest.skipUnless(importlib.util.find_spec("PIL"), "the live screen needs Pillow")
    def test_live_screen_of_the_7_and_4s(self):
        from PIL import Image
        png = os.path.join(self.tmp.name, "red.png")
        Image.new("RGB", (75, 133), (255, 0, 0)).save(png)
        self.fake_ssh(f"#!/bin/sh\ncat {png}\nexec sleep 30\n")
        im = Image.open(io.BytesIO(self.jpeg(self.serve("7"))))
        self.assertEqual(im.size, (75, 133))
        r, g, b = im.getpixel((30, 60))
        self.assertTrue(r > 240 and g < 15 and b < 15, (r, g, b))
        self.assertEqual(self.calls(), [])  # watching takes no lock
        self.fake_ssh(FAKE_VNC.replace('b"abcdefgh"', r'b"\x00\xf8" * 4').replace('b"ZZ"', r'b"\x00\xf8"'))  # RGB565 red
        base = self.serve("4s")
        self.assertIn("the screen is on", self.act(base, cmd="screen"))
        r, g, b = Image.open(io.BytesIO(self.jpeg(base))).getpixel((0, 0))
        self.assertTrue(r > 240 and g < 15 and b < 15, (r, g, b))

    def test_4s_frames_after_accept(self):
        self.fake_ssh(FAKE_VNC)
        v = self.m.Veency("4s")
        self.addCleanup(v.p.stdout.close)
        self.addCleanup(v.p.stdin.close)
        self.addCleanup(v.close)
        taps = []

        def accept():
            taps.append(1)
            with open(self.log, "a") as f:
                f.write("T tap 92 363\n")
        v.open(accept)
        self.assertEqual(taps, [1])
        g = v.frames()
        self.assertEqual(next(g), b"abcdefgh")
        self.assertEqual(next(g), b"abcdefZZ")

    def test_4s_no_accept_when_not_asked_and_never_past_a_password(self):
        self.fake_ssh(FAKE_VNC)
        for env in ({"VNC_OPEN": "1"}, {"VNC_OPEN": "1", "VNC_TYPE": "2"}):
            os.environ.update(env)
            v = self.m.Veency("4s")
            for k in env:
                del os.environ[k]
            try:
                if "VNC_TYPE" in env:
                    self.assertRaises(self.m.VeencyError, v.open, self.fail)
                else:
                    v.open(self.fail)
            finally:
                v.close()
                v.p.stdin.close()
                v.p.stdout.close()

    def test_4s_screen_keeps_the_lock_rules(self):
        self.fake_ssh(FAKE_VNC)
        base = self.serve("4s")
        with self.assertRaises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(base + "frame?after=-1", timeout=5)
        self.assertIn(b"Show screen", e.exception.read())
        e.exception.close()
        self.hold("T5")
        self.assertIn("refused: T5", self.act(base, cmd="screen"))
        self.assertEqual(self.calls(), [])
        self.act(base, cmd="allow")
        self.assertIn("ok (as T5) the screen is on", self.act(base, cmd="screen"))
        self.assertEqual(self.calls(), ["T5 tap 92 363"])
        self.assertIn("the screen is on", self.act(base, cmd="screen"))
        self.assertEqual(self.calls(), ["T5 tap 92 363"])
        self.hold("T6")  # the next holder isn't watched
        end = time.time() + 20
        while time.time() < end and "refused" not in self.act(base, cmd="screen"):
            time.sleep(.2)
        while time.time() < end:
            try:
                urllib.request.urlopen(base + "frame?after=-1", timeout=20).read()
            except urllib.error.HTTPError as e:
                with e:
                    self.assertEqual(e.code, 503)
                break
            time.sleep(.2)
        else:
            self.fail("still showing the screen to the next holder")

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
        for phone, who, freed in (((), "USER", True), ((), "T7", False), (("7",), "USER", True), (("7",), "T7", False),
                                  (("4s",), "USER", True), (("4s",), "T7", False)):
            self.hold(who)
            p = subprocess.Popen([sys.executable, SRC, *phone, str(port)], env=self.env, stdout=subprocess.PIPE, text=True)
            try:
                self.assertIn(str(port), p.stdout.readline())
                if who == "USER":  # a second start says so and exits 0
                    q = subprocess.run([sys.executable, SRC, *phone, str(port)], env=self.env, capture_output=True, text=True, timeout=20)
                    self.assertEqual(q.returncode, 0)
                    self.assertIn("already serving", q.stdout)
                info = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/who", timeout=5))
                self.assertEqual(info["holder"], who)
                p.send_signal(signal.SIGTERM)
                self.assertEqual(p.wait(timeout=20), 0)
            finally:
                if p.poll() is None:
                    p.kill()
                p.stdout.close()
            self.assertEqual(not os.path.exists(self.lock), freed, (phone, who))


if __name__ == "__main__":
    unittest.main()
