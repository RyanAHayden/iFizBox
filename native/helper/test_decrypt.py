"""F374: ifizbox-helper user-apps and decrypt-app (decrypt.c): the Mach-O encryption info read off fixture headers
(thin, fat, broken), the Installed Apps lines from a fake app-container tree, and decrypt-app's walk over a fake .app
(only encrypted Mach-O files written, cryptid 0, the encrypted range replaced, links never followed). Off iOS the
decryption is a stand-in that inverts the bytes (decrypt.h); the real one ran on the iPhone 7 (F374 journal)."""
import os
import shutil
import struct
import subprocess
import tempfile
import unittest

from test_helper import CC, build
from test_appversions import app, plist

ARM64 = 0x0100000C
OFF, SIZE, TOTAL = 0x1000, 0x200, 0x2000


def macho(cryptid=None, *, off=OFF, size=SIZE, total=TOTAL, is64=True, extra_cmd=None):
    """A Mach-O with one LC_ENCRYPTION_INFO(_64) (none when cryptid is None), bytes i % 251 after the header."""
    cmds = b""
    n = 0
    if cryptid is not None:
        if is64:
            cmds += struct.pack("<IIIIII", 0x2C, 24, off, size, cryptid, 0)
        else:
            cmds += struct.pack("<IIIII", 0x21, 20, off, size, cryptid)
        n += 1
    if extra_cmd:
        cmds += extra_cmd
        n += 1
    if is64:
        head = struct.pack("<IiiIIIII", 0xFEEDFACF, ARM64, 0, 2, n, len(cmds), 0, 0)
    else:
        head = struct.pack("<IiiIIII", 0xFEEDFACE, 12, 9, 2, n, len(cmds), 0)
    body = bytes(i % 251 for i in range(total))
    return head + cmds + body[len(head) + len(cmds):]


def fat(*slices, align=0x4000):
    out = bytearray(struct.pack(">II", 0xCAFEBABE, len(slices)))
    at = align
    table = []
    for s in slices:
        table.append(struct.pack(">iiIII", ARM64, 0, at, len(s), 14))
        at += (len(s) + align - 1) // align * align
    out += b"".join(table)
    for s, t in zip(slices, table):
        o = struct.unpack(">iiIII", t)[2]
        out += b"\0" * (o - len(out)) + s
    return bytes(out)


def write(path, data, mode=0o755):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
    os.chmod(path, mode)


@unittest.skipUnless(CC, "no C compiler on this machine")
class Decrypt(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.driver = os.path.join(cls.tmp, "decrypt_driver")
        build(cls.driver, ["decrypt_driver.c", "decrypt.c", "ipa.c"])

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp)

    def run_driver(self, *args):
        r = subprocess.run([self.driver, *args], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout.splitlines()

    def file(self, data):
        fd, p = tempfile.mkstemp(dir=self.tmp)
        os.write(fd, data)
        os.close(fd)
        return p

    # ---- the encryption info

    def test_thin_64(self):
        out = self.run_driver("crypt", self.file(macho(1)))
        self.assertEqual(out, [f"slice 0 cpu {ARM64}/0 off {OFF} size {SIZE} id 1 at {32 + 16}", "count: 1", "encrypted: 1"])
        self.assertEqual(self.run_driver("crypt", self.file(macho(0)))[-2:], ["count: 1", "encrypted: 0"])

    def test_thin_32(self):
        out = self.run_driver("crypt", self.file(macho(3, is64=False)))
        self.assertEqual(out, [f"slice 0 cpu 12/9 off {OFF} size {SIZE} id 3 at {28 + 16}", "count: 1", "encrypted: 1"])

    def test_no_encryption_command(self):
        uuid = struct.pack("<II", 0x1B, 24) + b"u" * 16  # LC_UUID
        self.assertEqual(self.run_driver("crypt", self.file(macho(None, extra_cmd=uuid))), ["count: 0"])

    def test_fat(self):
        out = self.run_driver("crypt", self.file(fat(macho(0), macho(1))))
        self.assertEqual(out[-2:], ["count: 2", "encrypted: 1"])
        self.assertTrue(out[0].startswith("slice 16384 ") and out[0].endswith(f"id 0 at {16384 + 48}"), out)
        self.assertTrue(out[1].startswith("slice 32768 ") and out[1].endswith(f"id 1 at {32768 + 48}"), out)

    def test_not_macho_or_broken(self):
        self.assertEqual(self.run_driver("crypt", self.file(b"PNG not a binary at all")), ["count: -1"])
        self.assertEqual(self.run_driver("crypt", self.file(b"")), ["count: -1"])
        # the encrypted range runs past the file
        self.assertEqual(self.run_driver("crypt", self.file(macho(1, off=0x1F00, size=0x200))), ["count: -1"])
        # a command claims more bytes than the commands have
        bad = bytearray(macho(1))
        struct.pack_into("<I", bad, 32 + 4, 0x7000)
        self.assertEqual(self.run_driver("crypt", self.file(bytes(bad))), ["count: -1"])
        # a fat header with a slice past the end
        f = bytearray(fat(macho(1)))
        struct.pack_into(">I", f, 8 + 12, 0x100000)
        self.assertEqual(self.run_driver("crypt", self.file(bytes(f))), ["count: -1"])

    # ---- user-apps

    def tree(self):
        root = tempfile.mkdtemp(dir=self.tmp)
        box = app(root, "A1", "Tube.app", plist(CFBundleIdentifier="com.x.tube", CFBundleDisplayName="Tube",
                                               CFBundleShortVersionString="2.1", CFBundleVersion="210",
                                               CFBundleExecutable="TubeBin"),
                  meta=plist(bundleShortVersionString="2.1"))
        write(os.path.join(box, "Tube.app", "TubeBin"), macho(1))
        box = app(root, "B2", "Delta.app", plist(CFBundleIdentifier="com.rileytestut.Delta", CFBundleName="Delta",
                                                CFBundleShortVersionString="1.6", CFBundleExecutable="Delta"))
        write(os.path.join(box, "Delta.app", "Delta"), macho(0))
        # no name keys: the folder's name; an executable that isn't there: encrypted unknown
        app(root, "C3", "Plain.app", plist(CFBundleIdentifier="com.example.plain", CFBundleExecutable="Gone"))
        return root

    def test_user_apps(self):
        root = self.tree()
        out = self.run_driver("userapps", root)
        self.assertEqual(out[-1], "count: 3", out)
        self.assertEqual(sorted(out[:-1]), sorted([
            f"com.x.tube\tTube\t2.1\t210\t{root}/A1/Tube.app\t1\t1",
            f"com.rileytestut.Delta\tDelta\t1.6\t\t{root}/B2/Delta.app\t0\t0",
            f"com.example.plain\tPlain\t\t\t{root}/C3/Plain.app\t\t0",
        ]))

    def test_user_apps_odd_entries(self):
        root = self.tree()
        app(root, "D4", "NoPlist.app")
        app(root, "E5", "Bad.app", plist(CFBundleIdentifier="bad id!"))
        os.symlink(os.path.join(root, "A1"), os.path.join(root, "F6"))  # a linked container: not followed
        box = app(root, "G7", "Linked.app", plist(CFBundleIdentifier="com.example.linked", CFBundleExecutable="Bin"))
        os.symlink(os.path.join(root, "A1", "Tube.app", "TubeBin"), os.path.join(box, "Linked.app", "Bin"))
        out = self.run_driver("userapps", root)
        self.assertEqual(out[-1], "count: 4", out)
        self.assertIn(f"com.example.linked\tLinked\t\t\t{root}/G7/Linked.app\t\t0", out)  # the linked binary isn't read
        self.assertEqual(self.run_driver("userapps", os.path.join(self.tmp, "nope")), ["count: 0"])

    # ---- decrypt-app

    def bundle(self):
        root = tempfile.mkdtemp(dir=self.tmp)
        box = app(root, "A1", "Tube.app", plist(CFBundleIdentifier="com.x.tube", CFBundleExecutable="TubeBin"))
        a = os.path.join(box, "Tube.app")
        write(os.path.join(a, "TubeBin"), macho(1))
        write(os.path.join(a, "Frameworks", "Kit.framework", "Kit"), fat(macho(0), macho(2)))
        write(os.path.join(a, "PlugIns", "Share.appex", "Share"), macho(1, is64=False))
        write(os.path.join(a, "Frameworks", "Open.dylib"), macho(0))  # not encrypted: left to the original
        write(os.path.join(a, "Assets.car"), b"not a binary", 0o644)
        os.symlink(os.path.join(a, "TubeBin"), os.path.join(a, "Frameworks", "Linked"))  # never followed
        drop = tempfile.mkdtemp(dir=self.tmp)
        return root, a, drop

    def test_decrypt_app(self):
        root, a, drop = self.bundle()
        out = self.run_driver("decrypt", root, drop, "com.x.tube")
        self.assertEqual(out[0], f"App: {a}")
        self.assertEqual(out[-1], "exit: 0", out)
        self.assertEqual(out[-2], "Decrypted 3 of 4 Mach-O files")
        self.assertEqual(sorted(l.split(" (")[0] for l in out[1:-2]), [
            "Decrypted Frameworks/Kit.framework/Kit", "Decrypted PlugIns/Share.appex/Share", "Decrypted TubeBin"])
        top = os.path.join(drop, "com.x.tube")
        written = sorted(os.path.relpath(os.path.join(d, f), top) for d, _, fs in os.walk(top) for f in fs)
        self.assertEqual(written, ["Frameworks/Kit.framework/Kit", "PlugIns/Share.appex/Share", "TubeBin"])
        # the main executable: cryptid 0, the range "decrypted" (the stand-in inverts), the rest as it was
        orig = macho(1)
        with open(os.path.join(top, "TubeBin"), "rb") as f:
            got = f.read()
        self.assertEqual(len(got), len(orig))
        self.assertEqual(struct.unpack_from("<I", got, 48)[0], 0)
        self.assertEqual(got[OFF:OFF + SIZE], bytes(~b & 0xFF for b in orig[OFF:OFF + SIZE]))
        self.assertEqual(got[OFF + SIZE:], orig[OFF + SIZE:])
        self.assertEqual(got[:48], orig[:48])
        self.assertEqual(self.run_driver("crypt", os.path.join(top, "TubeBin"))[-1], "encrypted: 0")
        # the fat framework: only its encrypted slice changed
        orig = fat(macho(0), macho(2))
        with open(os.path.join(top, "Frameworks/Kit.framework/Kit"), "rb") as f:
            got = f.read()
        self.assertEqual(got[:32768 + OFF], orig[:32768 + 48] + b"\0" * 4 + orig[32768 + 52:32768 + OFF])
        self.assertEqual(self.run_driver("crypt", os.path.join(top, "Frameworks/Kit.framework/Kit"))[-1], "encrypted: 0")
        # a second run finds the first one's folder and stops
        out = self.run_driver("decrypt", root, drop, "com.x.tube")
        self.assertEqual(out[-2:], ["error: an earlier decrypt of this app is still in the decrypt folder", "exit: 74"])

    def test_decrypt_refusals(self):
        root, a, drop = self.bundle()
        self.assertEqual(self.run_driver("decrypt", root, drop, "com.x.other")[-2:],
                         ["error: no installed app has that bundle ID", "exit: 64"])
        self.assertEqual(self.run_driver("decrypt", root, drop, "../x")[-2:], ["error: not a bundle identifier", "exit: 64"])
        link = os.path.join(self.tmp, "droplink")
        os.symlink(drop, link)
        self.assertEqual(self.run_driver("decrypt", root, link, "com.x.tube")[-2:],
                         ["error: the decrypt folder is missing, a link or root's", "exit: 74"])

    def test_decrypt_failure_names_the_file(self):
        root, a, drop = self.bundle()
        write(os.path.join(a, "TubeBin"), macho(99))  # the stand-in's refusal
        out = self.run_driver("decrypt", root, drop, "com.x.tube")
        self.assertEqual(out[-1], "exit: 1", out)
        self.assertIn("error: can't decrypt TubeBin: ", out[-2])
        self.assertFalse(os.path.exists(os.path.join(drop, "com.x.tube", "TubeBin")))

    def test_other_file_refused_goes_on(self):
        """FairPlay refusing an extension (seen on the phone) leaves it encrypted, says so, and the run goes on."""
        root, a, drop = self.bundle()
        write(os.path.join(a, "PlugIns", "Share.appex", "Share"), macho(99))
        out = self.run_driver("decrypt", root, drop, "com.x.tube")
        self.assertEqual(out[-1], "exit: 0", out)
        self.assertIn("Still encrypted PlugIns/Share.appex/Share: Operation not permitted", out)
        self.assertEqual(out[-2], "Decrypted 2 of 4 Mach-O files, 1 still encrypted")
        self.assertFalse(os.path.exists(os.path.join(drop, "com.x.tube", "PlugIns", "Share.appex", "Share")))
        self.assertTrue(os.path.isfile(os.path.join(drop, "com.x.tube", "TubeBin")))

    def test_chain(self):
        """The app -> helper chain: user-apps lists the tree, decrypt-app writes into the decrypt folder."""
        p = tempfile.mkdtemp(dir=self.tmp)
        os.makedirs(os.path.join(p, "Applications/iFizBox.app"))
        driver = os.path.join(self.tmp, "test_driver")
        if not os.path.exists(driver):
            build(driver, ["test_driver.c", "policy.c", "spawn.c"])
        ifizbox = os.path.join(p, "Applications/iFizBox.app/iFizBox")
        shutil.copy(driver, ifizbox)
        root, a, drop = self.bundle()
        helper = os.path.join(p, "ifizbox-helper")
        build(helper, ["main.c", "policy.c"], [f'-DIFIZBOX_PREFIX="{p}"', f"-DIFIZBOX_ROOT_UID={os.getuid()}",
                                               f'-DHELPER_APPS_DIR="{root}"', f'-DHELPER_DECRYPT_DIR="{drop}"'])

        def spawn(*words):
            r = subprocess.run([ifizbox, "spawn", helper, *words], capture_output=True, text=True, timeout=60)
            self.assertEqual(r.returncode, 0, r.stderr)
            return r.stdout.splitlines()

        out = spawn("user-apps")
        self.assertEqual(out[-1], "exit: 0", out)
        self.assertIn(f"1: com.x.tube\tTube\t\t\t{a}\t1\t0", out)
        self.assertEqual(spawn("user-apps", "x")[-1], "exit: 64")
        if os.getuid() == 0:
            return  # the decrypt folder must not be root's: as root the tree is, so the run below is refused
        out = spawn("decrypt-app", "com.x.tube")
        self.assertEqual(out[-1], "exit: 0", out)
        self.assertIn(f"1: App: {a}", out)
        self.assertTrue(os.path.isfile(os.path.join(drop, "com.x.tube", "TubeBin")))
        self.assertEqual(spawn("decrypt-app")[-1], "exit: 64")


if __name__ == "__main__":
    unittest.main()
