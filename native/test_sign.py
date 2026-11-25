"""I6: the on-device signer (native/sign/), built for Linux with the Swift toolchain and run against throwaway signing
material from native/testkit.py. The Swift tests (native/sign/tests/main.swift) sign a fixture IPA and check
the signatures with openssl; this file makes the fixtures, runs them, and then checks the signed IPA once more with
its own Python reading (DER entitlements, CodeResources against the files). Without a Swift toolchain
(SWIFT_TOOLCHAIN, or swiftc on PATH) the tests skip and say so."""
import hashlib
import io
import os
import plistlib
import random
import re
import shutil
import struct
import subprocess
import sys
import unicodedata
import unittest
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import disktmp  # noqa: E402  (scratch dirs off the shared /tmp tmpfs: see native/disktmp.py)


def toolchain():
    tc = os.environ.get("SWIFT_TOOLCHAIN")
    if not tc and shutil.which("swiftc"):
        tc = os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(shutil.which("swiftc")))))
    swiftc = os.path.join(tc, "usr/bin/swiftc") if tc else None
    return swiftc if swiftc and os.access(swiftc, os.X_OK) else None


SWIFTC = toolchain()
OPENSSL = shutil.which("openssl")
MISSING = ""
try:
    import testkit as T  # noqa: E402  (native/testkit.py; needs `cryptography`)
    from cryptography.hazmat.primitives import serialization
except ImportError as e:  # pragma: no cover
    T = None
    MISSING = f"{e} (pip install cryptography for {sys.executable})"

A = "Payload/Fixture.app/"


def macho(filetype=2, encrypted=False):
    b = bytearray(T.macho())
    struct.pack_into("<I", b, 12, filetype)
    if encrypted:  # LC_ENCRYPTION_INFO_64 with cryptid 1, in the room after the load commands
        ncmds, size = struct.unpack_from("<II", b, 16)
        struct.pack_into("<IIIIII", b, 32 + size, 0x2C, 24, 0x4000 - 64, 4, 1, 0)
        struct.pack_into("<II", b, 16, ncmds + 1, size + 24)
    return bytes(b)


def big_macho(filetype=2, pages=160, seed=1):
    """R41: a Mach-O over a megabyte (160 16 KB pages of __TEXT, half random, half a pattern), so signing writes it
    to a file of its own and deflates it in blocks."""
    page = 0x4000
    b = bytearray(T.macho())
    struct.pack_into("<I", b, 12, filetype)
    ncmds, size = struct.unpack_from("<II", b, 16)
    off = 32
    for _ in range(ncmds):  # grow __TEXT to `pages` pages and move __LINKEDIT after it
        cmd, cmdsize = struct.unpack_from("<II", b, off)
        if cmd == 0x19:
            name = bytes(b[off + 8:off + 24]).rstrip(b"\0")
            if name == b"__TEXT":  # vmsize, fileoff, filesize
                struct.pack_into("<QQQ", b, off + 32, pages * page, 0, pages * page)
            elif name == b"__LINKEDIT":  # vmaddr, vmsize, fileoff
                struct.pack_into("<QQQ", b, off + 24, 0x100000000 + pages * page, page, pages * page)
        off += cmdsize
    rnd = random.Random(seed)
    filler = bytes(rnd.getrandbits(8) for _ in range(pages * page // 2)) + b"\x1f\x20\x03\xd5" * (pages * page // 8)
    out = bytearray(b[:page]) + bytearray(filler[page:pages * page])
    return bytes(out + b[page:])


def fat():
    thin = macho()
    arm7 = struct.pack("<IiiIIIII", 0xFEEDFACE, 12, 9, 2, 0, 0, 0, 0)
    head = struct.pack(">II", 0xCAFEBABE, 2)
    head += struct.pack(">IIIII", 12, 9, 0x4000, len(arm7), 14)
    head += struct.pack(">IIIII", 0x0100000C, 0, 0x8000, len(thin), 14)
    body = bytearray(0x8000 + len(thin))
    body[:len(head)] = head
    body[0x4000:0x4000 + len(arm7)] = arm7
    body[0x8000:] = thin
    return bytes(body)


def info(bundle_id, exe, name="Fixture", **extra):
    d = {"CFBundleExecutable": exe, "CFBundleIdentifier": bundle_id, "CFBundleName": name,
         "CFBundleShortVersionString": "1.0", "CFBundleVersion": "1", "CFBundlePackageType": "APPL"}
    d.update(extra)
    return plistlib.dumps(d, fmt=plistlib.FMT_BINARY)


def armv7(filetype=6):
    """B162: a thin 32-bit (armv7) Mach-O header, all signing needs to see to leave it alone."""
    return struct.pack("<IiiIIIII", 0xFEEDFACE, 12, 9, filetype, 0, 0, 0, 0) + b"\0" * 64


def fat32():
    """B162: a fat Mach-O with armv7 and armv7s slices and no 64-bit one."""
    a, s = armv7(), armv7()
    head = struct.pack(">II", 0xCAFEBABE, 2)
    head += struct.pack(">IIIII", 12, 9, 0x1000, len(a), 12)
    head += struct.pack(">IIIII", 12, 11, 0x2000, len(s), 12)
    body = bytearray(0x2000 + len(s))
    body[:len(head)] = head
    body[0x1000:0x1000 + len(a)] = a
    body[0x2000:] = s
    return bytes(body)


def rich_ipa(main_binary=None, kit=None, loose=None, extra=None):
    """An app with a framework, a loose dylib, a share extension, localisations, a symlink and leftovers of an old
    signature. `extra`: more files under the app, {relative path: data}, put executable."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        def put(name, data, mode=0o100644):
            zi = zipfile.ZipInfo(name, date_time=(2026, 11, 17, 0, 0, 0))
            zi.create_system = 3
            zi.external_attr = mode << 16
            zi.compress_type = zipfile.ZIP_STORED if name.endswith("/") else zipfile.ZIP_DEFLATED
            z.writestr(zi, data)
        put("Payload/", b"", 0o40755)
        put(A, b"", 0o40755)
        put(A + "Info.plist", info("dev.ifizbox.fixture", "Fixture", CFBundleDisplayName="Fixture",
                                   UISupportedDevices=["iPhone14,2"]))
        put(A + "Fixture", main_binary or macho(), 0o100755)
        put(A + "hello.txt", b"Hello from iFizBox's on-device signer test.\n")
        put(A + "link.txt", b"hello.txt", 0o120777)
        put(A + "en.lproj/Localizable.strings", b'"hi" = "hi";\n')
        put(A + "Base.lproj/Main.storyboardc", b"storyboard")
        put(A + "OldStuff/_CodeSignature/CodeResources", b"old seal")
        put(A + "_CodeSignature/CodeResources", b"old seal")
        put(A + "embedded.mobileprovision", b"old profile")
        put(A + "Frameworks/Kit.framework/Info.plist", info("dev.ifizbox.kit", "Kit", "Kit", CFBundlePackageType="FMWK"))
        put(A + "Frameworks/Kit.framework/Kit", kit or macho(6), 0o100755)
        put(A + "Frameworks/libloose.dylib", loose or macho(6), 0o100755)
        put(A + "PlugIns/Share.appex/Info.plist", info("dev.ifizbox.fixture.share", "Share", "Share",
                                                       CFBundlePackageType="XPC!"))
        put(A + "PlugIns/Share.appex/Share", macho(), 0o100755)
        for rel, data in (extra or {}).items():
            put(A + rel, data, 0o100755)
        put("iTunesMetadata.plist", plistlib.dumps({"itemName": "Fixture"}))
    return buf.getvalue()


class RawName(zipfile.ZipInfo):
    """A zip entry whose name is written as given (./, //, any bytes)."""
    raw = b""

    def _encodeFilenameFlags(self):
        return self.raw, self.flag_bits | 0x800


def odd_names_ipa():
    """B432: names iOS's scan of a signed bundle treats its own way, each refused by installd (0xe8008017) before."""
    buf = io.BytesIO()
    kit = "Frameworks/Kit.framework/"
    files = [("Info.plist", info("dev.ifizbox.odd", "Proc\u00e9")), ("Proc\u00e9", macho()),
             (kit + "Info.plist", info("dev.ifizbox.kit", "Kit", CFBundlePackageType="FMWK")), (kit + "Kit", macho(6))]
    for d in ("", kit):  # what an earlier signer left at a bundle's root
        files += [(d + n, b"left over") for n in (
            "_CodeSignature/CodeDirectory", "_CodeSignature/sub/x", "CodeResources", "_MASReceipt/receipt",
            "foo.DS_Store", "SC_Info/a.sinf", "CodeResources2")]
    files += [("./dot.txt", b"x"), ("/slash.txt", b"x"), ("sub//deep/./z.txt", b"x"),       # paths not in their short form
              ("\u0301first.txt", b"x"), ("\u200dzwj.txt", b"x"), ("sub/\ufe0fvs.txt", b"x"),  # joins the "/" before it
              ("caf\u00e9.txt", b"one"), ("cafe\u0301.txt", b"two"),                        # one file on the phone
              ("d\u00e9/a.txt", b"x"), ("de\u0301/b.txt", b"x"),                            # one folder
              ("twice.txt", b"one"), ("twice.txt", b"two")]
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for i, (name, data) in enumerate(files):
            zi = RawName("entry%d" % i, date_time=(2026, 11, 24, 0, 0, 0))
            zi.raw = ("Payload/Odd.app/" + name).encode()
            zi.create_system = 3
            zi.external_attr = 0o100755 << 16
            zi.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(zi, data)
    return buf.getvalue()


def phone_files(ipa):
    """{path: data} as installd leaves an IPA on disk: APFS takes NFC and NFD as one name and keeps the first spelling."""
    out, spelled = {}, {}
    with zipfile.ZipFile(ipa) as z:
        for zi in z.infolist():
            path = key = ""
            for part in zi.filename.split("/"):
                if part in ("", "."):
                    continue
                key += "/" + unicodedata.normalize("NFD", part)
                path = spelled.setdefault(key, (path + "/" + part).lstrip("/"))
            if not zi.filename.endswith("/"):
                out[path] = z.read(zi)
    return out


def seal_problems(files, bundle):
    """iOS's check of one bundle against its CodeResources, as installd on the iPhone 15 Pro did it (B432's journal):
    what's on disk and not sealed, sealed and not on disk, or different."""
    here = {p[len(bundle):]: d for p, d in files.items() if p.startswith(bundle)}
    exe = unicodedata.normalize("NFD", plistlib.loads(here["Info.plist"])["CFBundleExecutable"])
    seal = plistlib.loads(here["_CodeSignature/CodeResources"])["files2"]
    disk = {p: d for p, d in here.items() if p not in (exe, "Info.plist", "PkgInfo") and p.split("/")[-1] != ".DS_Store"
            and p.split("/")[0] not in ("_CodeSignature", "CodeResources", "_MASReceipt")}
    return (sorted("added " + p for p in disk.keys() - seal.keys())
            + sorted("deleted " + p for p in seal.keys() - disk.keys() if not seal[p].get("optional"))
            + sorted("modified " + p for p in disk.keys() & seal.keys()
                     if seal[p]["hash2"] != hashlib.sha256(disk[p]).digest()))


def small_zip(files):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for k, v in files.items():
            z.writestr(k, v)
    return buf.getvalue()


def der_read(b, i=0):
    """(tag, body, next index) of one DER TLV."""
    tag, n = b[i], b[i + 1]
    i += 2
    if n & 0x80:
        k = n & 0x7F
        n = int.from_bytes(b[i:i + k], "big")
        i += k
    return tag, b[i:i + n], i + n


def der_entitlements(b):
    """Apple's DER entitlements back to Python values."""
    def value(tag, body):
        if tag == 0x01:
            return body != b"\0"
        if tag == 0x02:
            return int.from_bytes(body, "big", signed=True)
        if tag == 0x0C:
            return body.decode()
        if tag == 0x30:
            out, i = [], 0
            while i < len(body):
                t, v, i = der_read(body, i)
                out.append(value(t, v))
            return out
        if tag == 0xB0:
            out, i = {}, 0
            while i < len(body):
                _, pair, i = der_read(body, i)
                _, k, j = der_read(pair)
                t, v, _ = der_read(pair, j)
                out[k.decode()] = value(t, v)
            return out
        raise ValueError(hex(tag))
    tag, body, _ = der_read(b)
    assert tag == 0x70
    t, v, j = der_read(body)
    assert (t, v) == (0x02, b"\x01")
    t, v, _ = der_read(body, j)
    return value(t, v)


def slots(binary):
    magic, _, _, _, ncmds, _, _, _ = struct.unpack_from("<IiiIIIII", binary)
    assert magic == 0xFEEDFACF
    off = 32
    for _ in range(ncmds):
        cmd, size = struct.unpack_from("<II", binary, off)
        if cmd == 0x1D:
            so, ss = struct.unpack_from("<II", binary, off + 8)
        off += size
    blob = binary[so:so + ss]
    assert struct.unpack_from(">I", blob)[0] == 0xFADE0CC0
    out = {}
    for i in range(struct.unpack_from(">I", blob, 8)[0]):
        typ, o = struct.unpack_from(">II", blob, 12 + 8 * i)
        out[typ] = blob[o:o + struct.unpack_from(">I", blob, o + 4)[0]]
    return out


@unittest.skipUnless(T, f"the signer's fixtures can't be made: {MISSING}")
@unittest.skipUnless(SWIFTC, "no Swift toolchain (SWIFT_TOOLCHAIN or swiftc on PATH): native/sign/ not tested")
@unittest.skipUnless(OPENSSL, "openssl not on PATH: signatures can't be checked")
class OnDeviceSigner(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = disktmp.build_dir("ifizbox-signtest-")
        cls.fx = os.path.join(cls.tmp, "fixtures")
        cls.work = os.path.join(cls.tmp, "work")
        os.makedirs(cls.fx)
        key, cert, ca = T.identity()
        other_key, other, _ = T.identity(name="Apple Development: Someone Else (ZZZZZ99999)")
        der = serialization.Encoding.DER

        def w(name, data):
            with open(os.path.join(cls.fx, name), "wb") as f:
                f.write(data)
        w("key.pem", key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                        serialization.NoEncryption()))
        w("cert.der", cert.public_bytes(der))
        w("ca.der", ca.public_bytes(der))
        w("ca.pem", ca.public_bytes(serialization.Encoding.PEM))
        w("other.der", other.public_bytes(der))
        cls.profile = T.profile(key, cert)
        w("profile.mobileprovision", cls.profile)
        # B413: what an all-capabilities profile has (the fixture's CMS isn't checked, so its plist is replaced)
        w("profile-dataprotection.mobileprovision", re.sub(
            rb"<key>Entitlements</key>\s*<dict>", rb"\g<0><key>com.apple.developer.default-data-protection</key>"
            rb"<string>NSFileProtectionComplete</string>", cls.profile, count=1))
        w("profile-explicit.mobileprovision", T.profile(key, cert, app_id="com.me.fixture"))
        w("profile-prefix.mobileprovision", T.profile(key, cert, app_id="com.me.*"))
        w("profile-expired.mobileprovision", T.profile(key, cert, days=-1))
        w("rich.ipa", rich_ipa())
        w("rich-big.ipa", rich_ipa(big_macho(2), big_macho(6, seed=2), big_macho(6, pages=80, seed=3)))
        # B162: RetroArch 1.12.0 ships armv7-only cores in modules/ beside arm64 ones
        w("thin32.ipa", rich_ipa(extra={"modules/old_libretro_ios.dylib": armv7(),
                                        "modules/fat32_libretro_ios.dylib": fat32(),
                                        "modules/new_libretro_ios.dylib": macho(6)}))
        w("odd-names.ipa", odd_names_ipa())
        w("unsigned.macho", macho())
        w("fat.macho", fat())
        w("notanipa.ipa", small_zip({"hello.txt": "hi"}))
        w("escape.ipa", small_zip({"Payload/X.app/Info.plist": info("a.b", "X"), "Payload/../evil": "x"}))
        # B21: nested bundles naming a missing executable (YouMod's YTUHD.bundle) are sealed, not signed; the app's
        # own missing executable is still refused.
        shutil.copy(os.path.join(ROOT, "web", "fixtures", "missing-exe.ipa"), os.path.join(cls.fx, "missing-exe.ipa"))
        w("noexe.ipa", small_zip({"Payload/X.app/Info.plist": info("a.b", "X"), "Payload/X.app/hello.txt": "hi"}))
        enc = io.BytesIO(rich_ipa(macho(encrypted=True)))
        w("encrypted.ipa", enc.getvalue())
        cls.binary = os.path.join(cls.tmp, "signtest")
        env = disktmp.swift_env(dict(os.environ), cls.tmp)
        # The ubuntu toolchain wants libncurses.so.6; Arch has only the wide one (as native/build.sh does).
        shim = os.path.join(cls.tmp, "libshim")
        if os.path.exists("/usr/lib/libncursesw.so.6") and not os.path.exists("/usr/lib/libncurses.so.6"):
            os.makedirs(shim)
            os.symlink("/usr/lib/libncursesw.so.6", os.path.join(shim, "libncurses.so.6"))
            env["LD_LIBRARY_PATH"] = shim + (":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")
        sign = os.path.join(HERE, "sign")
        sources = sorted(os.path.join(sign, f) for f in os.listdir(sign) if f.endswith(".swift"))
        r = subprocess.run([SWIFTC, "-O", "-module-cache-path", os.path.join(cls.tmp, "modules"),
                            "-import-objc-header", os.path.join(sign, "zlib-shim.h"), *sources,
                            os.path.join(sign, "tests", "main.swift"), "-lz", "-o", cls.binary],
                           capture_output=True, text=True, env=env, timeout=600)
        cls.build_error = None if r.returncode == 0 else (r.stdout + r.stderr)[-4000:]

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_swift(self):
        self.assertIsNone(self.build_error, self.build_error)
        env = disktmp.swift_env(dict(os.environ), self.tmp)  # the signer's own scratch files (openssl, unzip) stay off /tmp too
        real = os.path.join(HERE, "build", "iFizBox.ipa")  # the sideload build, where tools/check.sh made one
        if os.path.exists(real):
            env["IFIZBOX_REAL_IPA"] = real
        r = subprocess.run([self.binary, self.fx, self.work], capture_output=True, text=True, timeout=600, env=env)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("all passed", r.stdout)
        # Then Python reads what Swift signed.
        with zipfile.ZipFile(os.path.join(self.work, "signed.ipa")) as z:
            self.assertIsNone(z.testzip())
            files = {n: z.read(n) for n in z.namelist() if not n.endswith("/")}
        self.assertEqual(files["iTunesMetadata.plist"], plistlib.dumps({"itemName": "Fixture"}))
        info_plist = plistlib.loads(files[A + "Info.plist"])
        self.assertNotIn("UISupportedDevices", info_plist)
        s = slots(files[A + "Fixture"])
        xml = plistlib.loads(s[5][8:])
        self.assertEqual(der_entitlements(s[7][8:]), xml)  # the DER slot says what the XML one says
        self.assertEqual(xml["com.apple.developer.team-identifier"], T.TEAM)
        self.assertIs(xml["get-task-allow"], False)
        cr = plistlib.loads(files[A + "_CodeSignature/CodeResources"])
        sealed = set(cr["files2"])
        expected = {n[len(A):] for n in files if n.startswith(A)} - {
            "_CodeSignature/CodeResources", "Fixture", "Info.plist"}
        self.assertEqual(sealed, expected)
        for rel, entry in cr["files2"].items():
            if "symlink" in entry:
                continue
            self.assertEqual(entry["hash2"], hashlib.sha256(files[A + rel]).digest(), rel)
            self.assertEqual(entry["hash"], hashlib.sha1(files[A + rel]).digest(), rel)
        self.assertEqual(files[A + "embedded.mobileprovision"], self.profile)

    def test_tweaked_ipa(self):
        """F288: the IPA test_swift signed with tweaks (work/tweaked.ipa; test_swift runs first, by name): the main
        executable lists the injected dylibs as weak loads with the Frameworks rpath, read here as otool -l would,
        and the tweaks are in the app, signed and sealed."""
        path = os.path.join(self.work, "tweaked.ipa")
        self.assertTrue(os.path.exists(path), "test_swift didn't write tweaked.ipa")
        with zipfile.ZipFile(path) as z:
            files = {n: z.read(n) for n in z.namelist() if not n.endswith("/")}
        cmds = load_commands(files[A + "Fixture"])
        self.assertIn((0x80000018, "@rpath/Fixture.dylib"), cmds)  # LC_LOAD_WEAK_DYLIB
        self.assertIn((0x80000018, "@rpath/TweakKit.framework/TweakKit"), cmds)
        self.assertIn((0x8000001C, "@executable_path/Frameworks"), cmds)  # LC_RPATH
        self.assertEqual(cmds[-1][0], 0x1D, "LC_CODE_SIGNATURE stays where the signer put it")
        for rel in ("Frameworks/Fixture.dylib", "Frameworks/TweakKit.framework/TweakKit"):
            self.assertIn(0, slots(files[A + rel]), rel)  # a CodeDirectory: signed
        cr = plistlib.loads(files[A + "_CodeSignature/CodeResources"])
        for rel in ("Frameworks/Fixture.dylib", "Fixture.bundle/Info.plist", "Frameworks/TweakKit.framework/Info.plist"):
            self.assertEqual(cr["files2"][rel]["hash2"], hashlib.sha256(files[A + rel]).digest(), rel)

    def test_odd_names_sealed(self):
        """B432: iOS finds nothing added, modified or deleted in a bundle with odd names or signature leftovers."""
        path = os.path.join(self.work, "odd-names.ipa")
        self.assertIsNone(self.build_error, self.build_error)
        if not os.path.exists(path):  # test_swift signs it, and runs after this one, by name
            env = disktmp.swift_env(dict(os.environ), self.tmp)
            subprocess.run([self.binary, self.fx, self.work], capture_output=True, timeout=600, env=env)
        files = phone_files(path)
        app = "Payload/Odd.app/"
        for bundle in (app, app + "Frameworks/Kit.framework/"):
            self.assertEqual(seal_problems(files, bundle), [], bundle)
        self.assertEqual(files[app + "caf\u00e9.txt"], b"two")
        for rel in ("dot.txt", "slash.txt", "sub/deep/z.txt", "\u0301first.txt", "d\u00e9/a.txt", "d\u00e9/b.txt"):
            self.assertIn(app + rel, files)
        with zipfile.ZipFile(path) as z:  # written once, in the short form
            names = z.namelist()
        self.assertEqual(len(names), len(set(names)))
        self.assertFalse([n for n in names if "//" in n or "/./" in n])


def load_commands(binary):
    """otool -l, the part this needs: [(cmd, path)] of a thin 64-bit Mach-O's load commands (path for dylib and rpath
    commands, else None)."""
    magic, _, _, _, ncmds, _ = struct.unpack_from("<IiiIII", binary, 0)
    assert magic == 0xFEEDFACF, hex(magic)
    out, off = [], 32
    for _ in range(ncmds):
        cmd, size = struct.unpack_from("<II", binary, off)
        name = None
        if cmd in (0xC, 0xD, 0x80000018, 0x8000001F, 0x8000001C):
            (at,) = struct.unpack_from("<I", binary, off + 8)
            name = binary[off + at:off + size].split(b"\0")[0].decode()
        out.append((cmd, name))
        off += size
    return out


class BridgeSourceTest(unittest.TestCase):
    """F73: the phone half can't run here, so read the sources: signing.export is registered, answers the three
    fields from the kept Keychain item, and the item is written on import and deleted on remove."""

    @classmethod
    def setUpClass(cls):
        src = os.path.join(HERE, "Sources")
        with open(os.path.join(src, "SignBridge.swift")) as f:
            cls.bridge = f.read()
        with open(os.path.join(src, "SignStore.swift")) as f:
            cls.store = f.read()

    def test_export_handler(self):
        self.assertIn('b.on("signing.export")', self.bridge)
        start = self.bridge.index("static func export()")
        body = self.bridge[start:self.bridge.index("\n    }\n", start)]
        for key in ('"p12"', '"profile"', '"password"', "SignStore.exportP12()", "NSNull()"):
            self.assertIn(key, body)

    def test_kept_p12(self):
        self.assertIn("kSecClassGenericPassword", self.store)
        keep = self.store[self.store.index("static func keepP12"):]
        keep = keep[:keep.index("\n    }\n")]
        self.assertIn("kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly", keep)
        imp = self.store[self.store.index("static func importIdentity"):self.store.index("static func identity()")]
        self.assertIn("try keepP12(", imp)
        rm = self.store[self.store.index("static func removeIdentity"):]
        rm = rm[:rm.index("\n    }\n")]
        self.assertIn("deleteP12()", rm)


if __name__ == "__main__":
    unittest.main()
