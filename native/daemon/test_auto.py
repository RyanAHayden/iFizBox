"""N7: automatic updates in ifizbox-upgrades (auto.c), built with the host's C compiler and run through auto_driver.c:
the F13 settings as the daemon reads them, when a check runs, what installs and when, what a respring needs, which
.debs are kept for rollback, and whole hourly runs (auto_step) against a fake phone, clock and apt in a folder.
main.m's side (the real apt, IOKit power, the lock state, reachability, sbreload) only runs on a jailbroken phone:
see the N7 journal."""
import os
import shutil
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
CC = shutil.which(os.environ.get("CC", "cc")) or shutil.which("clang") or shutil.which("gcc")
NOW = 1_800_000_000
H = 3600

# AddressSanitizer and UBSan on the daemon's host build, as native/helper/test_helper.py does for the root helper:
# UB aborts, leak checking is off (the driver exits without freeing), an ASan report is a signal death.
SAN = ["-fsanitize=address,undefined", "-fno-sanitize-recover=all", "-fno-omit-frame-pointer", "-g"]
SAN_ENV = {"ASAN_OPTIONS": "detect_leaks=0:abort_on_error=1", "UBSAN_OPTIONS": "print_stacktrace=1"}


def probe_sanitizers(cc):
    """(flags, None) when cc builds and runs a sanitized program here, else ([], reason)."""
    if not cc:
        return [], "no C compiler on this machine"
    tmp = tempfile.mkdtemp()
    try:
        src, exe = os.path.join(tmp, "p.c"), os.path.join(tmp, "p")
        with open(src, "w") as f:
            f.write("int main(void) { return 0; }\n")
        env = dict(os.environ, TMPDIR=tmp, **SAN_ENV)
        r = subprocess.run([cc, "-pipe", *SAN, "-o", exe, src], capture_output=True, text=True, env=env)
        if r.returncode:
            return [], f"{cc} can't build with {SAN[0]}: {r.stderr.strip()[:200]}"
        r = subprocess.run([exe], capture_output=True, text=True, env=env, timeout=30)
        if r.returncode:
            return [], f"a sanitized program doesn't run here: {r.stderr.strip()[:200]}"
        return SAN, None
    finally:
        shutil.rmtree(tmp, True)


SAN_FLAGS, SAN_SKIP = probe_sanitizers(CC)
if SAN_FLAGS:
    os.environ.update(SAN_ENV)  # the driver inherits it

INJECTED = r"""
#include <stdlib.h>
int main(void) {
    char *p = malloc(8);
    volatile size_t n = 8;
    p[n] = 1;                   /* one byte past the buffer */
    free(p);
    return 0;
}
"""

PLAN = """\
Inst com.ex.tweak [1.0] (1.2 Example:1.0/stable [iphoneos-arm64])
Inst libfoo [2:3.1-1] (2:3.2-1 Procursus:1.0/1900 [iphoneos-arm64])
Inst com.ex.held [1.0] (2.0 Example [iphoneos-arm64])
Conf com.ex.tweak (1.2 Example:1.0/stable [iphoneos-arm64])
"""
STATUS = "Package: com.ex.tweak\nStatus: install ok installed\nName: Example Tweak\nVersion: 1.0\n"


@unittest.skipUnless(CC, "no C compiler on this machine")
class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.addClassCleanup(shutil.rmtree, cls.tmp, True)  # also when the build below fails
        cls.driver = os.path.join(cls.tmp, "auto_driver")
        # -pipe and TMPDIR: cc's scratch files stay out of the shared /tmp, which other gates can fill (EDQUOT).
        subprocess.run([CC, "-pipe", "-std=c11", "-Wall", "-Wextra", "-Werror", "-O1", *SAN_FLAGS, "-o", cls.driver,
                        os.path.join(HERE, "auto_driver.c"), os.path.join(HERE, "auto.c"),
                        os.path.join(HERE, "upgrades.c")], check=True, capture_output=True,
                       env=dict(os.environ, TMPDIR=cls.tmp))

    def file(self, text, name="f"):
        if text is None:
            return "-"
        p = os.path.join(self.tmp, name)
        with open(p, "w") as f:
            f.write(text)
        return p

    def run_driver(self, *args):
        r = subprocess.run([self.driver, *map(str, args)], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout


@unittest.skipUnless(SAN_FLAGS, SAN_SKIP or "")
class Sanitizers(unittest.TestCase):
    def test_injected_overflow_caught(self):
        # Built with the same flags as the driver: the overflow is reported and the run fails.
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, True)
        src, exe = os.path.join(tmp, "inject.c"), os.path.join(tmp, "inject")
        with open(src, "w") as f:
            f.write(INJECTED)
        subprocess.run([CC, "-pipe", "-std=c11", "-Wall", "-Wextra", "-Werror", "-O1", *SAN_FLAGS, "-o", exe, src],
                       check=True, capture_output=True, env=dict(os.environ, TMPDIR=tmp))
        r = subprocess.run([exe], capture_output=True, text=True, timeout=30)
        self.assertNotEqual(r.returncode, 0)
        # ASan's report, or UBSan's object-size check where GCC runs that first.
        self.assertTrue(any(w in r.stderr for w in ("heap-buffer-overflow", "insufficient space")), r.stderr)


class Decisions(Base):
    def settings(self, text):
        out = self.run_driver("settings", self.file(text))
        return dict((k, int(v)) for k, v in (kv.split("=") for kv in out.split()))

    def test_settings_defaults_and_values(self):
        d = {"check": 3, "cellular": 1, "install": 0, "idle": 1, "respring": 0, "keep": 1}
        self.assertEqual(self.settings(None), d)
        self.assertEqual(self.settings(""), d)
        self.assertEqual(self.settings(
            "checkUpdates=6h\ncellular=false\nautoInstall=marked\nautoInstallIdle=false\nrespring=locked\nkeepVersions=2\n"),
            {"check": 2, "cellular": 0, "install": 1, "idle": 0, "respring": 1, "keep": 2})
        # Not one of the options: the default. The last line wins. CRLF is fine. Keys are whole.
        self.assertEqual(self.settings("keepVersions=9\nautoInstall=yes\n")["keep"], 1)
        self.assertEqual(self.settings("autoInstall=all\nautoInstall=off\r\ncheckUpdates=launch\r\n")["install"], 0)
        self.assertEqual(self.settings("checkUpdates=off\r\n")["check"], 0)
        self.assertEqual(self.settings("xcheckUpdates=off\ncheckUpdates =off\n")["check"], 3)

    def check(self, settings, last, net="wifi", force=0, now=NOW):
        return self.run_driver("check", self.file(settings), now, last, net, force).strip()

    def test_check_schedule(self):
        # Daily (also with no settings: N5's rule), every 6 hours, never for Off and On Launch.
        for daily in (None, "checkUpdates=daily\n"):
            self.assertEqual(self.check(daily, NOW - 22 * H), "no")
            self.assertEqual(self.check(daily, NOW - 23 * H), "go")
        self.assertEqual(self.check("checkUpdates=6h\n", NOW - 5 * H + 1), "no")
        self.assertEqual(self.check("checkUpdates=6h\n", NOW - 5 * H), "go")
        for off in ("off", "launch"):
            self.assertEqual(self.check("checkUpdates=%s\n" % off, 0), "no")
            self.assertEqual(self.check("checkUpdates=%s\n" % off, 0, force=1), "go")  # --force by hand
        self.assertEqual(self.check(None, 0), "go")  # never checked
        self.assertEqual(self.check(None, NOW + 60), "go")  # the clock went back
        self.assertEqual(self.check(None, NOW - H, force=1), "go")

    def test_check_cellular(self):
        self.assertEqual(self.check("cellular=false\n", 0, "cell"), "wait-wifi")
        self.assertEqual(self.check("cellular=false\n", 0, "cell", force=1), "wait-wifi")
        self.assertEqual(self.check("cellular=false\n", 0, "wifi"), "go")
        self.assertEqual(self.check("cellular=false\n", 0, "none"), "go")  # counts from the lists there are
        self.assertEqual(self.check(None, 0, "cell"), "go")
        self.assertEqual(self.check("cellular=false\n", NOW - H, "cell"), "no")

    def test_may_install(self):
        may = lambda s, c, l, n="wifi": self.run_driver("may", self.file(s), c, l, n).strip()
        self.assertEqual(may(None, 1, 1), "now")
        for c, l in ((0, 0), (1, 0), (0, 1)):
            self.assertEqual(may(None, c, l), "wait-idle")
            self.assertEqual(may("autoInstallIdle=false\n", c, l), "now")
        self.assertEqual(may(None, 1, 1, "none"), "wait-net")
        self.assertEqual(may("cellular=false\n", 1, 1, "cell"), "wait-net")
        self.assertEqual(may(None, 1, 1, "cell"), "now")

    def pick(self, settings, held=None, state=None, plan=PLAN):
        return self.run_driver("pick", self.file(plan, "plan"), self.file(settings, "s"), self.file(held, "h"),
                               self.file(state, "st")).split()

    def test_pick(self):
        self.assertEqual(self.pick(None), [])
        self.assertEqual(self.pick("autoInstall=off\nmarked=libfoo\n"), [])
        self.assertEqual(self.pick("autoInstall=all\n"), ["com.ex.tweak", "libfoo", "com.ex.held"])
        self.assertEqual(self.pick("autoInstall=marked\n"), [])
        self.assertEqual(self.pick("autoInstall=marked\nmarked=libfoo\nmarked=com.ex.held\nmarked=other\n"),
                         ["libfoo", "com.ex.held"])
        self.assertEqual(self.pick("autoInstall=marked\nmarked=libf\nmarked=libfoo2\n"), [])  # whole ids only
        # Ignored Upgrades: dpkg's holds (apt-mark showhold) and the settings' list.
        self.assertEqual(self.pick("autoInstall=all\n", held="com.ex.held\n"), ["com.ex.tweak", "libfoo"])
        self.assertEqual(self.pick("autoInstall=all\nhold=libfoo\n"), ["com.ex.tweak", "com.ex.held"])
        self.assertEqual(self.pick("autoInstall=marked\nmarked=libfoo\nhold=libfoo\n"), [])
        # F282: Ignore This Version: only that version; another one installs.
        self.assertEqual(self.pick("autoInstall=all\nignore=libfoo=2:3.2-1\nignore=com.ex.held=1.9\n"),
                         ["com.ex.tweak", "com.ex.held"])
        # A version that failed isn't tried again; a newer one is.
        self.assertEqual(self.pick("autoInstall=all\n", state="last 1\nfailed libfoo=2:3.2-1\nfailed com.ex.tweak=1.1\n"),
                         ["com.ex.tweak", "com.ex.held"])

    def test_same_version(self):
        same = lambda a, b: self.run_driver("samever", a, b).strip() == "1"
        for a, b in (("1.0", "1.0"), ("0:1.0", "1.0"), ("01.0", "1.0"), ("1.0", "1.0-0"), ("2:3.2-1", "2:3.2-01")):
            self.assertTrue(same(a, b), (a, b))
            self.assertTrue(same(b, a), (b, a))
        for a, b in (("1.0", "1.0.0"), ("1.0", "1:1.0"), ("1.0~b1", "1.0"), ("1.0-1", "1.0-2"), ("1.0a", "1.0"),
                     ("1.0", "1.1")):
            self.assertFalse(same(a, b), (a, b))
            self.assertFalse(same(b, a), (b, a))

    def drop(self, settings, plan=PLAN):
        return self.run_driver("drop", self.file(plan, "plan"), self.file(settings, "s")).split()

    def test_drop_ignored(self):
        self.assertEqual(self.drop(None), ["3", "com.ex.tweak", "libfoo", "com.ex.held"])
        # Only the ignored version goes; whole ids; an equal spelling counts; one for another id leaves it alone.
        self.assertEqual(self.drop("ignore=libfoo=2:3.2-1\n"), ["2", "com.ex.tweak", "com.ex.held"])
        self.assertEqual(self.drop("ignore=com.ex.tweak=1.2.0\nignore=libfo=2:3.2-1\nignore=com.ex.held=2.0-0\r\n"),
                         ["2", "com.ex.tweak", "libfoo"])
        self.assertEqual(self.drop("ignore=com.ex.tweak=1.1\nignore=com.ex.tweak\nignore==1.2\n"),
                         ["3", "com.ex.tweak", "libfoo", "com.ex.held"])
        self.assertEqual(self.drop("ignore=com.ex.tweak=1.2\nignore=libfoo=2:3.2-1\nignore=com.ex.held=2.0\n"), ["0"])

    def test_plan_removes(self):
        removes = lambda t: self.run_driver("removes", self.file(t)).strip()
        self.assertEqual(removes(PLAN), "0")
        self.assertEqual(removes(PLAN + "Remv old.thing [0.9]\n"), "1")
        self.assertEqual(removes(" Remv x\nRemvx y\n"), "0")

    def test_finish(self):
        finish = lambda t: self.run_driver("finish", self.file(t)).strip()
        self.assertEqual(finish("Setting up x (1.0) ...\n"), "0")
        self.assertEqual(finish("Setting up x ...\nfinish:restart\n"), "1")
        self.assertEqual(finish("finish:reload\r\n"), "1")
        self.assertEqual(finish("finish:reboot\nfinish:restart\n"), "2")
        self.assertEqual(finish("finish:return\nfinish:reopen\n  finish:reboot\nfinish:rebooting\n"), "0")

    def test_list_needs_respring(self):
        needs = lambda t: self.run_driver("list", self.file(t)).strip()
        self.assertEqual(needs("/.\n/var/jb/usr/bin/tool\n/var/jb/Library/MobileSubstrate/DynamicLibraries\n"), "0")
        self.assertEqual(needs("/var/jb/Library/MobileSubstrate/DynamicLibraries/Tweak.dylib\n"), "1")
        self.assertEqual(needs("/var/jb/usr/lib/TweakInject/Tweak.plist\n"), "1")
        self.assertEqual(needs("/Library/PreferenceBundles/X.bundle/X\n"), "1")
        self.assertEqual(needs("/var/jb/Library/Themes/Dark.theme/Info.plist\n"), "1")
        self.assertEqual(needs(""), "0")

    def test_respring_action(self):
        act = lambda s, need, locked: self.run_driver("action", self.file(s), need, locked).strip()
        self.assertEqual(act(None, 0, 1), "nothing")
        self.assertEqual(act(None, 1, 1), "notify")
        self.assertEqual(act("respring=locked\n", 1, 1), "respring")
        self.assertEqual(act("respring=locked\n", 1, 0), "wait")
        self.assertEqual(act("respring=locked\n", 2, 1), "notify")  # never reboots for the user

    def test_respring_pending(self):
        pend = lambda since, sb, now=NOW: self.run_driver("pending", since, sb, now).strip()
        self.assertEqual(pend(0, 0), "0")
        self.assertEqual(pend(NOW - H, NOW - 2 * H), "1")
        self.assertEqual(pend(NOW - H, NOW - 60), "0")  # SpringBoard started since: done
        self.assertEqual(pend(NOW - H, 0), "1")
        self.assertEqual(pend(NOW - 25 * H, 0), "0")  # unknown and stale

    def test_deb_version(self):
        ver = lambda f, i: self.run_driver("debver", f, i).strip()
        self.assertEqual(ver("libfoo_2%3a3.2-1_iphoneos-arm64.deb", "libfoo"), "2:3.2-1")
        self.assertEqual(ver("com.ex.tweak_1.2_iphoneos-arm64.deb", "com.ex.tweak"), "1.2")
        for f in ("com.a%5fb_1.2_arm.deb", "com.a_b_1.2_arm.deb"):  # apt writes the id's "_" as %5f
            self.assertEqual(ver(f, "com.a_b"), "1.2", f)
        for bad in ("libfoo2_1.0_arm.deb", "libfoo_1.0.deb", "libfoo__arm.deb", "libfoo_1.0_arm.deb.partial",
                    "libfoo_1.0_.deb", "libfoo_1_0_arm.deb"):
            self.assertEqual(ver(bad, "libfoo"), "no", bad)

    def test_prune(self):
        listing = ("x_1.0_arm.deb 100\nx_1.1_arm.deb 200\nx_1.2_arm.deb 300\nx_1.3_arm.deb 400\n"
                   "notes.txt 50\ny_1.0_arm.deb 10\n")
        prune = lambda inst, keep: sorted(self.run_driver("prune", self.file(listing), "x", inst, keep).split())
        # The installed one stays, and the newest `keep` others.
        self.assertEqual(prune("1.3", 1), ["x_1.0_arm.deb", "x_1.1_arm.deb"])
        self.assertEqual(prune("1.3", 2), ["x_1.0_arm.deb"])
        self.assertEqual(prune("1.1", 1), ["x_1.0_arm.deb", "x_1.2_arm.deb"])
        self.assertEqual(prune("1.3", 0), ["x_1.0_arm.deb", "x_1.1_arm.deb", "x_1.2_arm.deb", "x_1.3_arm.deb"])
        self.assertEqual(prune("9.9", 2), ["x_1.0_arm.deb", "x_1.1_arm.deb"])
        # Stashed in one run, so the same mtime: the higher version is the newer, whatever the listing's order.
        for tied in ("x_2%3a3.2-1_arm.deb 500\nx_2%3a3.10-1_arm.deb 500\nx_2%3a3.3-1_arm.deb 600\n",
                     "x_2%3a3.10-1_arm.deb 500\nx_2%3a3.2-1_arm.deb 500\nx_2%3a3.3-1_arm.deb 600\n"):
            out = sorted(self.run_driver("prune", self.file(tied), "x", "2:3.3-1", 1).split())
            self.assertEqual(out, ["x_2%3a3.2-1_arm.deb"], tied)

    def test_words(self):
        plan = "".join("Inst p%d [1.0] (1.1 R)\n" % i for i in range(5))
        words = lambda ids, need=0, status=None: dict(
            l.split("=", 1) for l in self.run_driver("words", self.file(plan, "p"), self.file(status, "s"), ids, need).splitlines())
        w = words("p0", status="Package: p0\nStatus: install ok installed\nName: Zero\n")
        self.assertEqual(w, {"title": "1 Package Updated", "body": "Zero 1.1 was installed.",
                             "failed": "Zero couldn't be updated automatically."})
        self.assertEqual(words("p0,p1")["body"], "p0 and p1 were installed.")
        self.assertEqual(words("p0,p2,p4")["body"], "p0, p2 and p4 were installed.")
        w = words("p0,p1,p2,p3,p4", 1)
        self.assertEqual((w["title"], w["body"], w["failed"]), (
            "5 Packages Updated", "p0, p1, p2 and 2 more were installed. Respring to finish.",
            "5 packages couldn't be updated automatically."))
        self.assertEqual(words("p3", 2)["body"], "p3 1.1 was installed. Reboot to finish.")

    def test_state_lines(self):
        state = lambda ids, failed, old, since: self.run_driver("state", self.file(PLAN, "p"), ids, failed,
                                                                self.file(old, "o"), since).splitlines()
        self.assertEqual(state("-", 0, None, 0), [])
        self.assertEqual(state("libfoo", 1, None, 0), ["failed libfoo=2:3.2-1"])
        self.assertEqual(state("libfoo", 0, None, 5), ["respring 5"])
        # An old failure stays while that version is still the upgrade; a newer version clears it.
        old = "last 1\nfailed com.ex.tweak=1.2\nfailed libfoo=2:3.0\n"
        self.assertEqual(state("-", 0, old, 0), ["failed com.ex.tweak=1.2"])


# B16: ios.jjolano.me lists its .debs by full GitHub links; apt joins them to the repo URL and 404s.
LINKED = """\
Package: com.ex.tweak
Version: 1.1
Filename: https://github.com/ex/tweak/releases/download/1.1/tweak.deb

Package: com.ex.tweak
Version: 1.2
Architecture: iphoneos-arm64
Filename:  HTTPS://github.com/ex/tweak/releases/download/1.2/com.ex.tweak_1.2_iphoneos-arm64-with-a-long-name.deb\r
Size: 10

Package: libfoo
Version: 2:3.2-1
Filename: ./debs/libfoo_3.2-1_iphoneos-arm64.deb
"""
PROCURSUS = """\
Package: com.ex.held
Version: 2.0
Filename: pool/main/c/com.ex.held_2.0.deb

Package: hookkit
Version: 1.0
Filename: https://github.com/ex/hookkit/hookkit.deb
"""


class Linked(Base):
    """B16: upgrades whose Filename is a full URL are left to the app's queue (F131)."""

    def lists(self):
        d = tempfile.mkdtemp(dir=self.tmp)
        for name, text in (("ios.jjolano.me_._Packages", LINKED), ("repo_dists_main_binary-iphoneos-arm64_Packages", PROCURSUS),
                           ("ios.jjolano.me_._Release", "Filename: https://x/y\\nPackage: libfoo\\n")):
            with open(os.path.join(d, name), "w") as f:
                f.write(text)
        return d

    def test_url_filename(self):
        for f, want in (("https://github.com/a.deb", "1"), ("http://x/y.deb", "1"), ("HTTPS://x", "1"),
                        ("git+ssh://x", "1"), ("./debs/a.deb", "0"), ("debs/https://x", "0"), ("https:/x", "0"),
                        ("1http://x", "0"), ("", "0")):
            self.assertEqual(self.run_driver("url", f).strip(), want, f)

    def test_linked(self):
        d = self.lists()
        out = self.run_driver("linked", d, "com.ex.tweak=1.2", "libfoo=2:3.2-1", "com.ex.held=2.0", "hookkit=1.0",
                              "hookkit=0.9", "other=1").split()
        self.assertEqual(out, ["com.ex.tweak=1.2", "hookkit=1.0"])
        self.assertEqual(self.run_driver("linked", d, "com.ex.tweak=1.1").split(), ["com.ex.tweak=1.1"])
        self.assertEqual(self.run_driver("linked", os.path.join(d, "missing"), "hookkit=1.0"), "")

    def test_plan_installs(self):
        plan = PLAN + "Inst hookkit:iphoneos-arm64 (1.0 jjolano [iphoneos-arm64])\nRemv x [1]\nInst bad\n"
        self.assertEqual(self.run_driver("installs", self.file(plan)).split(),
                         ["com.ex.tweak=1.2", "libfoo=2:3.2-1", "com.ex.held=2.0", "hookkit=1.0"])


# B192: apt's sources, one-line and deb822 styles. repo.ex.com is http, secure.ex.com https; both offer libfoo.
SOURCES_LIST = """\
# a comment line
deb [trusted=yes arch=iphoneos-arm64] http://repo.ex.com/ ./   # trailing comment
deb-src https://src.ex.com/ ./
"""
DEB822 = """\
Types: deb
URIs: https://secure.ex.com/
Suites: ./
Components:

Types: deb
URIs: https://repo.ex.com/sub/
 HTTPS://other.ex.com/a_b/
Suites: ./

Types: deb
URIs: http://disabled.ex.com/
Enabled: no
Suites: ./
"""
HTTP_LIST = """\
Package: com.ex.tweak
Version: 1.2
Filename: ./debs/com.ex.tweak_1.2.deb

Package: hookkit
Version: 1.0
Filename: ./debs/hookkit.deb
"""
HTTPS_LIST = """\
Package: libfoo
Version: 2:3.2-1
Filename: ./debs/libfoo.deb

Package: com.ex.held
Version: 2.0
Filename: ./debs/held.deb
"""
SUB_LIST = """\
Package: com.ex.sub
Version: 1.0
Filename: ./debs/sub.deb
"""


def put_apt(root, sources_list=SOURCES_LIST, deb822=DEB822):
    """apt/ (sources.list.d with both styles) and lists/ under root, as the phone's /var/jb has them."""
    os.makedirs(os.path.join(root, "apt", "sources.list.d"), exist_ok=True)
    os.makedirs(os.path.join(root, "lists"), exist_ok=True)
    for name, text in (("apt/sources.list.d/other.list", sources_list), ("apt/sources.list.d/ifizbox.sources", deb822),
                       ("lists/repo.ex.com_._Packages", HTTP_LIST), ("lists/secure.ex.com_._Packages", HTTPS_LIST),
                       ("lists/repo.ex.com_sub_._Packages", SUB_LIST), ("lists/disabled.ex.com_._Packages", SUB_LIST),
                       ("lists/repo.ex.com_._Release", "Package: libfoo\nVersion: 2:3.2-1\n")):
        with open(os.path.join(root, name), "w") as f:
            f.write(text)


class Insecure(Base):
    """B192: automatic installs take packages from https sources only."""

    def test_prefix(self):
        for uri, want in (("http://repo.ex.com/", "repo.ex.com_ 1"), ("https://repo.ex.com", "repo.ex.com_ 0"),
                          ("HTTP://a.b/c/d/", "a.b_c_d_ 1"), ("tor+http://x.onion/", "x.onion_ 1"),
                          ("https://user:pw@h.ex:8080/a_b~/", "h.ex:8080_a%5fb%7e_ 0"), ("file:/var/repo", "_var_repo_ 0"),
                          ("httpx://h/", "h_ 0"), ("ahttp://h/", "h_ 0")):
            self.assertEqual(self.run_driver("prefix", uri).strip(), want, uri)

    def test_insecure(self):
        d = tempfile.mkdtemp(dir=self.tmp)
        put_apt(d)
        run = lambda *pairs: self.run_driver("insecure", os.path.join(d, "apt"), os.path.join(d, "lists"), *pairs).split()
        # http's list, not https's; repo.ex.com/sub/ (https) beats repo.ex.com/ (http) as the longer prefix; a
        # disabled http source and a deb-src line count for nothing.
        self.assertEqual(run("com.ex.tweak=1.2", "libfoo=2:3.2-1", "com.ex.held=2.0", "hookkit=1.0", "hookkit=0.9",
                             "com.ex.sub=1.0", "other=1"), ["com.ex.tweak=1.2", "hookkit=1.0"])
        self.assertEqual(self.run_driver("insecure", os.path.join(d, "missing"), os.path.join(d, "lists"), "hookkit=1.0"), "")

    def test_same_list_from_http_and_https_counts_as_http(self):
        d = tempfile.mkdtemp(dir=self.tmp)
        put_apt(d, sources_list="deb http://secure.ex.com/ ./\n")
        out = self.run_driver("insecure", os.path.join(d, "apt"), os.path.join(d, "lists"), "libfoo=2:3.2-1").split()
        self.assertEqual(out, ["libfoo=2:3.2-1"])

    def test_sources_list_itself_is_read(self):
        d = tempfile.mkdtemp(dir=self.tmp)
        put_apt(d, sources_list="", deb822="")
        with open(os.path.join(d, "apt", "sources.list"), "w") as f:
            f.write("deb http://secure.ex.com/ ./\n")
        out = self.run_driver("insecure", os.path.join(d, "apt"), os.path.join(d, "lists"), "libfoo=2:3.2-1").split()
        self.assertEqual(out, ["libfoo=2:3.2-1"])


class Runs(Base):
    """Whole hourly runs: the fake phone's facts, settings and apt in a folder, the calls printed."""

    def setUp(self):
        self.d = tempfile.mkdtemp(dir=self.tmp)
        for sub in ("info", "cache", "download"):
            os.makedirs(os.path.join(self.d, sub))
        self.put("plan", PLAN)
        self.put("status", STATUS)
        self.facts(now=NOW)

    def put(self, name, text):
        p = os.path.join(self.d, name)
        with open(p, "w") as f:
            f.write(text)
        return p

    def get(self, name):
        try:
            with open(os.path.join(self.d, name)) as f:
                return f.read()
        except FileNotFoundError:
            return None

    def facts(self, now=NOW, net="wifi", charging=0, locked=0, sb=0, busy=0):
        self.put("facts", "now %d\nnet %s\ncharging %d\nlocked %d\nsb %d\nbusy %d\n" % (now, net, charging, locked, sb, busy))

    def step(self, *flags):
        return self.run_driver("step", self.d, *flags).splitlines()

    def calls(self, log):
        return [l for l in log if not l.startswith("say ")]

    def test_default_daily_check_notifies(self):
        log = self.calls(self.step())
        self.assertEqual(log, ["update", "simulate",
                               "notify upgrades 3 3 Upgrades | 3 upgrades: Example Tweak, libfoo and com.ex.held."])
        self.assertEqual(self.get("state"), "last %d\ncom.ex.tweak=1.2\nlibfoo=2:3.2-1\ncom.ex.held=2.0\n" % NOW)
        # An hour later: not due, nothing installs by default, so nothing runs at all.
        self.facts(now=NOW + H, charging=1, locked=1)
        self.assertEqual(self.calls(self.step()), [])
        # A day later: checked again; nothing new, so only the badge.
        self.facts(now=NOW + 23 * H)
        self.assertEqual(self.calls(self.step()), ["update", "simulate", "badge 3"])

    def test_checks_off_or_on_launch(self):
        for v in ("off", "launch"):
            self.put("settings", "checkUpdates=%s\nautoInstall=all\nautoInstallIdle=false\n" % v)
            self.assertEqual(self.calls(self.step()), [], v)
            self.assertIsNone(self.get("state"))

    def test_cellular_waits_for_wifi(self):
        self.put("settings", "cellular=false\n")
        self.facts(net="cell")
        log = self.step()
        self.assertEqual(self.calls(log), [])
        self.assertTrue(any("cellular" in l for l in log))
        self.assertIsNone(self.get("state"))
        self.facts(now=NOW + H, net="wifi")
        self.assertEqual(self.calls(self.step())[:2], ["update", "simulate"])

    def test_waits_for_charging_and_locked_then_installs(self):
        self.put("settings", "autoInstall=all\n")
        self.put("held", "com.ex.held\n")
        log = self.step()
        self.assertEqual(self.calls(log)[:3], ["update", "simulate", "showhold"])
        self.assertNotIn("install", " ".join(self.calls(log)))
        self.assertTrue(any("waiting for charging and locked" in l for l in log))
        # Charging, but unlocked: still nothing, and no apt at all.
        self.facts(now=NOW + H, charging=1, locked=0)
        self.assertEqual(self.calls(self.step()), [])
        # Charging and locked: the waiting upgrades install without a new apt-get update.
        self.facts(now=NOW + 2 * H, charging=1, locked=1)
        self.put("plan.after", "Inst com.ex.held [1.0] (2.0 Example [iphoneos-arm64])\n")
        self.assertEqual(self.calls(self.step()), [
            "simulate", "showhold", "simulate com.ex.tweak libfoo", "install com.ex.tweak libfoo", "simulate",
            "notify updated 1 2 Packages Updated | Example Tweak and libfoo were installed.", "badge 1"])
        self.assertEqual(self.get("state"), "last %d\ncom.ex.held=2.0\n" % NOW)  # the check's time stays
        # Only a held upgrade left: the next hours plan (apt -s, no network) and install nothing.
        self.put("plan", self.get("plan.after"))
        self.facts(now=NOW + 3 * H, charging=1, locked=1)
        self.assertEqual(self.calls(self.step()), ["simulate", "showhold", "badge 1"])

    def test_ignored_version_neither_counts_nor_installs(self):
        # F282: libfoo 2:3.2-1 is ignored: two upgrades, and libfoo isn't installed with Everything.
        self.put("settings", "autoInstall=all\nautoInstallIdle=false\nhold=com.ex.held\nignore=libfoo=2:3.2-1\n")
        self.put("plan.after", "Inst com.ex.held [1.0] (2.0 Example [iphoneos-arm64])\n"
                               "Inst libfoo [2:3.1-1] (2:3.2-1 Procursus:1.0/1900 [iphoneos-arm64])\n")
        log = self.step()
        self.assertTrue(any("1 upgrade at an ignored version left out" in l for l in log))
        calls = self.calls(log)
        self.assertIn("install com.ex.tweak", calls)
        self.assertNotIn("libfoo", " ".join(c for c in calls if c.startswith(("install", "simulate "))))
        # What's left: the held one; libfoo still left out.
        self.assertEqual(calls[-1], "notify upgrades 1 1 Upgrade | com.ex.held 2.0 is available.")
        self.assertNotIn("libfoo", self.get("state"))
        # Without installs: the check's notification counts two.
        self.setUp()
        self.put("settings", "ignore=libfoo=2:3.2-1\n")
        self.assertEqual(self.calls(self.step()), ["update", "simulate",
                         "notify upgrades 2 2 Upgrades | 2 upgrades: Example Tweak and com.ex.held."])
        # A newer libfoo than the ignored one counts again (new since the last notification).
        self.put("plan", PLAN.replace("2:3.2-1", "2:3.3-1"))
        self.facts(now=NOW + 23 * H)
        log = self.calls(self.step())
        self.assertEqual(log[-1], "notify upgrades 3 3 Upgrades | 3 upgrades: Example Tweak, libfoo and com.ex.held.")

    def test_marked_only(self):
        self.put("settings", "autoInstall=marked\nautoInstallIdle=false\nmarked=libfoo\n")
        log = self.calls(self.step())
        self.assertIn("install libfoo", log)
        self.assertIn("notify updated 3 1 Package Updated | libfoo 2:3.2-1 was installed.", log)

    def test_failure_is_not_retried_until_a_new_version(self):
        self.put("settings", "autoInstall=all\nautoInstallIdle=false\nhold=com.ex.held\n")
        self.put("codes", "install 100\n")
        log = self.calls(self.step())
        self.assertIn("install com.ex.tweak libfoo", log)
        self.assertIn("notify failed 3 Update Failed | 2 packages couldn't be updated automatically.", log)
        self.assertIn("failed com.ex.tweak=1.2\nfailed libfoo=2:3.2-1\n", self.get("state"))
        self.facts(now=NOW + H)
        log = self.calls(self.step())
        self.assertFalse([l for l in log if l.startswith("install")], log)
        # A new version of libfoo: that one is tried (and the old failure line goes).
        self.put("codes", "")
        self.put("plan", PLAN.replace("(2:3.2-1 ", "(2:3.3-1 "))
        self.facts(now=NOW + 2 * H)
        log = self.calls(self.step())
        self.assertIn("install libfoo", log)
        self.assertNotIn("libfoo=2:3.2-1", self.get("state"))

    def test_dpkg_busy_waits_without_failing(self):
        self.put("settings", "autoInstall=all\nautoInstallIdle=false\n")
        self.facts(busy=1)
        log = self.step()
        self.assertFalse([l for l in self.calls(log) if l.startswith(("install", "notify failed"))], log)
        self.assertTrue(any("dpkg is busy" in l for l in log))
        self.assertNotIn("failed", self.get("state"))
        self.facts(now=NOW + H, busy=0)
        self.assertIn("install com.ex.tweak libfoo com.ex.held", self.calls(self.step()))

    def test_a_plan_that_removes_waits_for_a_person(self):
        self.put("settings", "autoInstall=all\nautoInstallIdle=false\n")
        self.put("plan.install", "Inst libfoo [1] (2 R)\nRemv old.thing [0.9]\n")
        log = self.calls(self.step())
        self.assertFalse([l for l in log if l.startswith("install")], log)
        self.assertIn("notify failed 3 Update Failed | 3 packages couldn't be updated automatically.", log)

    def test_respring_notify(self):
        self.put("settings", "autoInstall=all\nautoInstallIdle=false\n")
        self.put("install.out", "Setting up com.ex.tweak (1.2) ...\nfinish:restart\n")
        log = self.calls(self.step())
        self.assertIn("notify updated 3 3 Packages Updated | Example Tweak, libfoo and com.ex.held were installed. "
                      "Respring to finish.", log)
        self.assertNotIn("respring", log)

    def test_tweak_files_need_a_respring(self):
        self.put("settings", "autoInstall=marked\nautoInstallIdle=false\nmarked=libfoo\n")
        self.put("info/libfoo:iphoneos-arm64.list", "/var/jb/usr/lib/TweakInject/Foo.dylib\n")
        log = self.calls(self.step())
        self.assertIn("notify updated 3 1 Package Updated | libfoo 2:3.2-1 was installed. Respring to finish.", log)

    def test_respring_when_locked(self):
        self.put("settings", "autoInstall=all\nautoInstallIdle=false\nrespring=locked\n")
        self.put("install.out", "finish:reload\n")
        # Locked now: respring after the state is written; the notification says nothing about a respring.
        self.facts(locked=1)
        log = self.calls(self.step())
        self.assertEqual(log[-1], "respring")
        self.assertIn("notify updated 3 3 Packages Updated | Example Tweak, libfoo and com.ex.held were installed.", log)
        self.assertNotIn("respring ", self.get("state"))

    def test_respring_waits_for_the_lock(self):
        self.put("settings", "autoInstall=all\nautoInstallIdle=false\nrespring=locked\n")
        self.put("install.out", "finish:restart\n")
        self.assertNotIn("respring", self.calls(self.step()))
        self.assertIn("respring %d\n" % NOW, self.get("state"))
        # Still unlocked an hour later: still waiting.
        self.put("plan", "")
        self.facts(now=NOW + H, locked=0, sb=NOW - DAY_S)
        self.assertNotIn("respring", self.calls(self.step()))
        self.assertIn("respring %d\n" % NOW, self.get("state"))
        # Locked: respring, once.
        self.facts(now=NOW + 2 * H, locked=1, sb=NOW - DAY_S)
        self.assertEqual(self.calls(self.step()), ["respring"])
        self.assertNotIn("respring", self.get("state"))
        self.facts(now=NOW + 3 * H, locked=1, sb=NOW + 2 * H)
        self.assertEqual(self.calls(self.step()), [])

    def test_pending_respring_dropped_after_the_user_resprung(self):
        self.put("state", "last %d\nrespring %d\n" % (NOW, NOW))
        self.put("settings", "respring=locked\n")
        self.facts(now=NOW + H, locked=1, sb=NOW + 60)
        self.assertEqual(self.calls(self.step()), [])
        self.assertEqual(self.get("state"), "last %d\n" % NOW)
        # Just Notify Me chosen since: dropped too.
        self.put("state", "last %d\nrespring %d\n" % (NOW, NOW))
        self.put("settings", "respring=notify\n")
        self.facts(now=NOW + H, locked=1)
        self.assertEqual(self.calls(self.step()), [])
        self.assertEqual(self.get("state"), "last %d\n" % NOW)

    def debs(self, pkg):
        try:
            return sorted(os.listdir(os.path.join(self.d, "rollback", pkg)))
        except FileNotFoundError:
            return []

    def test_rollback_keeps_previous_versions(self):
        self.put("settings", "autoInstall=marked\nautoInstallIdle=false\nmarked=libfoo\nkeepVersions=1\n")
        self.put("cache/libfoo_2%3a3.1-1_iphoneos-arm64.deb", "old")  # the installed version, from an earlier install
        self.put("download/libfoo_2%3a3.2-1_iphoneos-arm64.deb", "new")
        self.step()
        self.assertEqual(self.debs("libfoo"), ["libfoo_2%3a3.1-1_iphoneos-arm64.deb", "libfoo_2%3a3.2-1_iphoneos-arm64.deb"])
        with open(os.path.join(self.d, "rollback/libfoo/libfoo_2%3a3.1-1_iphoneos-arm64.deb")) as f:
            self.assertEqual(f.read(), "old")
        # The next upgrade: 3.2 becomes the one previous version kept, 3.1 goes.
        self.put("plan", "Inst libfoo [2:3.2-1] (2:3.3-1 R [iphoneos-arm64])\n")
        self.put("download/libfoo_2%3a3.3-1_iphoneos-arm64.deb", "newer")
        self.facts(now=NOW + 23 * H)
        self.step()
        self.assertEqual(self.debs("libfoo"), ["libfoo_2%3a3.2-1_iphoneos-arm64.deb", "libfoo_2%3a3.3-1_iphoneos-arm64.deb"])
        # Two kept: the next one leaves three.
        self.put("settings", "autoInstall=marked\nautoInstallIdle=false\nmarked=libfoo\nkeepVersions=2\n")
        self.put("plan", "Inst libfoo [2:3.3-1] (2:3.4-1 R [iphoneos-arm64])\n")
        self.put("download/libfoo_2%3a3.4-1_iphoneos-arm64.deb", "newest")
        self.facts(now=NOW + 46 * H)
        self.step()
        self.assertEqual(len(self.debs("libfoo")), 3)
        self.assertNotIn("libfoo_2%3a3.1-1_iphoneos-arm64.deb", self.debs("libfoo"))

    def test_rollback_prune_ignores_dir_order(self):
        # Two kept .debs with the same mtime (stashed in one run): the higher version stays, whichever order the
        # folder lists them in. Creating them in both orders flips readdir's order on tmpfs and btrfs alike.
        for first, second in (("3.1", "3.2"), ("3.2", "3.1")):
            with self.subTest(created=(first, second)):
                self.setUp()
                self.put("settings", "autoInstall=marked\nautoInstallIdle=false\nmarked=libfoo\nkeepVersions=1\n")
                os.makedirs(os.path.join(self.d, "rollback", "libfoo"))
                for v in (first, second):
                    p = self.put("rollback/libfoo/libfoo_2%%3a%s-1_iphoneos-arm64.deb" % v, v)
                    os.utime(p, (NOW, NOW))
                self.put("plan", "Inst libfoo [2:3.2-1] (2:3.3-1 R [iphoneos-arm64])\n")
                self.put("download/libfoo_2%3a3.3-1_iphoneos-arm64.deb", "3.3")
                self.facts(now=NOW + 23 * H)
                self.step()
                self.assertEqual(self.debs("libfoo"),
                                 ["libfoo_2%3a3.2-1_iphoneos-arm64.deb", "libfoo_2%3a3.3-1_iphoneos-arm64.deb"])

    def test_rollback_none(self):
        self.put("settings", "autoInstall=all\nautoInstallIdle=false\nkeepVersions=0\n")
        self.put("cache/libfoo_2%3a3.1-1_iphoneos-arm64.deb", "old")
        self.put("download/libfoo_2%3a3.2-1_iphoneos-arm64.deb", "new")
        os.makedirs(os.path.join(self.d, "rollback", "libfoo"))
        self.put("rollback/libfoo/libfoo_2%3a3.0-1_iphoneos-arm64.deb", "older")
        self.step()
        self.assertEqual(self.debs("libfoo"), [])
        self.assertFalse(os.path.exists(os.path.join(self.d, "rollback", "libfoo")))

    def test_dry_run_installs_and_writes_nothing(self):
        self.put("settings", "autoInstall=all\nautoInstallIdle=false\n")
        log = self.step("--dry-run")
        self.assertFalse([l for l in log if l.startswith(("install", "notify", "badge", "respring"))], log)
        self.assertTrue(any("would install 3" in l for l in log))
        self.assertIsNone(self.get("state"))

    def test_force_and_no_update(self):
        self.put("state", "last %d\n" % (NOW - 60))
        self.assertEqual(self.calls(self.step()), [])
        self.assertEqual(self.calls(self.step("--force", "--no-update"))[0], "simulate")

    def test_update_failure_still_counts(self):
        self.put("codes", "update 100\n")
        log = self.step()
        self.assertTrue(any("apt-get update failed" in l for l in log))
        self.assertIn("simulate", log)
        self.assertIn("last %d\n" % NOW, self.get("state"))

    def test_simulate_failure_writes_nothing(self):
        self.put("codes", "simulate 100\n")
        self.assertEqual(self.calls(self.step()), ["update", "simulate"])
        self.assertIsNone(self.get("state"))

    def put_lists(self):
        os.makedirs(os.path.join(self.d, "lists"), exist_ok=True)
        self.put("lists/ios.jjolano.me_._Packages", LINKED)
        self.put("lists/repo_Packages", PROCURSUS)

    def test_linked_upgrade_is_left_for_the_app(self):
        # B16: com.ex.tweak 1.2 is a GitHub link: the others install, it stays an upgrade and isn't a failure.
        self.put("settings", "autoInstall=all\nautoInstallIdle=false\n")
        self.put_lists()
        self.put("plan.after", "Inst com.ex.tweak [1.0] (1.2 Example:1.0/stable [iphoneos-arm64])\n")
        log = self.step()
        self.assertTrue(any("com.ex.tweak 1.2 downloads from a link" in l for l in log), log)
        log = self.calls(log)
        self.assertIn("simulate libfoo com.ex.held", log)
        self.assertIn("install libfoo com.ex.held", log)
        self.assertIn("notify updated 1 2 Packages Updated | libfoo and com.ex.held were installed.", log)
        self.assertNotIn("failed", self.get("state"))
        self.assertIn("com.ex.tweak=1.2", self.get("state"))

    def test_only_linked_upgrades_install_nothing(self):
        self.put("settings", "autoInstall=marked\nautoInstallIdle=false\nmarked=com.ex.tweak\n")
        self.put_lists()
        log = self.calls(self.step())
        self.assertFalse([l for l in log if l.startswith(("install", "notify failed", "notify updated"))], log)
        self.assertFalse([l for l in log if l.startswith("simulate ")], log)
        self.assertNotIn("failed", self.get("state"))

    def test_linked_dependency_waits_for_a_person(self):
        # libfoo 3.2 would pull in hookkit, a link: apt would 404, so it's an Update Failed, not an install.
        self.put("settings", "autoInstall=marked\nautoInstallIdle=false\nmarked=libfoo\n")
        self.put_lists()
        self.put("plan.install", "Inst hookkit (1.0 jjolano [iphoneos-arm64])\nInst libfoo [2:3.1-1] (2:3.2-1 R)\n")
        log = self.step()
        self.assertTrue(any("need hookkit 1.0, a link" in l for l in log), log)
        log = self.calls(log)
        self.assertFalse([l for l in log if l.startswith("install")], log)
        self.assertIn("notify failed 3 Update Failed | libfoo couldn't be updated automatically.", log)
        self.assertIn("failed libfoo=2:3.2-1", self.get("state"))

    def test_http_source_is_skipped_https_installs(self):
        # B192: com.ex.tweak 1.2 comes from repo.ex.com over http: skipped, no failure; https's two install.
        self.put("settings", "autoInstall=all\nautoInstallIdle=false\n")
        put_apt(self.d)
        self.put("plan.after", "Inst com.ex.tweak [1.0] (1.2 Example:1.0/stable [iphoneos-arm64])\n")
        log = self.step()
        self.assertTrue(any("com.ex.tweak 1.2 comes from an http source" in l for l in log), log)
        log = self.calls(log)
        self.assertIn("simulate libfoo com.ex.held", log)
        self.assertIn("install libfoo com.ex.held", log)
        self.assertNotIn("failed", self.get("state"))
        self.assertIn("com.ex.tweak=1.2", self.get("state"))

    def test_only_http_upgrades_install_nothing(self):
        self.put("settings", "autoInstall=marked\nautoInstallIdle=false\nmarked=com.ex.tweak\n")
        put_apt(self.d)
        log = self.calls(self.step())
        self.assertFalse([l for l in log if l.startswith(("install", "simulate ", "notify failed", "notify updated"))], log)
        self.assertNotIn("failed", self.get("state"))

    def test_http_dependency_waits_for_a_person(self):
        self.put("settings", "autoInstall=marked\nautoInstallIdle=false\nmarked=libfoo\n")
        put_apt(self.d)
        self.put("plan.install", "Inst hookkit (1.0 R [iphoneos-arm64])\nInst libfoo [2:3.1-1] (2:3.2-1 R)\n")
        log = self.step()
        self.assertTrue(any("need hookkit 1.0, from an http source" in l for l in log), log)
        log = self.calls(log)
        self.assertFalse([l for l in log if l.startswith("install")], log)
        self.assertIn("failed libfoo=2:3.2-1", self.get("state"))

    def test_all_https_installs_everything(self):
        self.put("settings", "autoInstall=all\nautoInstallIdle=false\n")
        put_apt(self.d, sources_list="deb https://repo.ex.com/ ./\n")
        self.assertIn("install com.ex.tweak libfoo com.ex.held", self.calls(self.step()))

    def test_no_lists_installs_as_before(self):
        self.put("settings", "autoInstall=all\nautoInstallIdle=false\n")
        self.assertIn("install com.ex.tweak libfoo com.ex.held", self.calls(self.step()))


DAY_S = 86400

if __name__ == "__main__":
    unittest.main()
