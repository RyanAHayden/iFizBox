"""F14: what the sideload build does around signing, on Linux. native/sign/tests/sideload/main.swift (built with
native/sign/ by the Swift toolchain, as native/test_sign.py builds it) checks the profile kinds, the user's edits
(name, bundle ID across extensions, icon, extensions left out), the arm64e fix-up, the IPA inspector (entitlements,
permissions, extensions, icon), the OCSP request and answers, the re-sign reminder and the record of signed apps.
This file makes the fixtures (native/testkit.py's throwaway CA, cryptography's OCSP builder), runs it, and reads
what Swift wrote: the signed IPA, and the OCSP request. Without a Swift toolchain it skips and says so."""
import datetime as dt
import io
import os
import plistlib
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from test_sign import MISSING, SWIFTC, OPENSSL, T, macho, info, slots  # noqa: E402
import disktmp  # noqa: E402

try:
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.x509 import ocsp
except ImportError as e:  # pragma: no cover
    x509 = None
    MISSING = f"{e} (pip install cryptography for {sys.executable})"

A = "Payload/Fixture.app/"
PNG = b"\x89PNG\r\n\x1a\n" + b"\0\0\0\rIHDR" + b"\0" * 17 + b"fake icon"


def fat_arm64e(versioned=False):
    """A fat dylib with an arm64 slice and an arm64e one, the latter of the old ABI (subtype 2) unless versioned."""
    thin = bytearray(macho(6))
    e = bytearray(thin)
    sub = 2 | (0x80000000 if versioned else 0)
    struct.pack_into("<i", e, 8, struct.unpack("<i", struct.pack("<I", sub))[0])
    head = struct.pack(">II", 0xCAFEBABE, 2)
    head += struct.pack(">IIIII", 0x0100000C, 0, 0x4000, len(thin), 14)
    head += struct.pack(">IIIII", 0x0100000C, sub, 0x4000 + 0x4000 * ((len(thin) + 0x3FFF) // 0x4000), len(e), 14)
    off2 = struct.unpack_from(">I", head, 8 + 20 + 8)[0]
    body = bytearray(off2 + len(e))
    body[:len(head)] = head
    body[0x4000:0x4000 + len(thin)] = thin
    body[off2:] = e
    return bytes(body)


def edit_ipa():
    """An app with two extensions, a framework with an old-ABI arm64e slice, localised names and permissions."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        def put(name, data, mode=0o100644):
            zi = zipfile.ZipInfo(name, date_time=(2026, 11, 17, 0, 0, 0))
            zi.create_system = 3
            zi.external_attr = mode << 16
            z.writestr(zi, data)
        put("Payload/", b"", 0o40755)
        put(A, b"", 0o40755)
        put(A + "Info.plist", info(
            "dev.ifizbox.fixture", "Fixture", CFBundleDisplayName="Fixture", MinimumOSVersion="15.0",
            NSCameraUsageDescription="To scan codes.", NSLocalNetworkUsageDescription="To find your Mac.",
            CFBundleIcons={"CFBundlePrimaryIcon": {"CFBundleIconFiles": ["AppIcon60x60"], "CFBundleIconName": "AppIcon"}}))
        put(A + "Fixture", macho(), 0o100755)
        put(A + "AppIcon60x60@2x.png", PNG)
        put(A + "en.lproj/InfoPlist.strings",
            '/* names */\n"CFBundleDisplayName" = "Fixture \\"EN\\"";\n// other\n"NSCameraUsageDescription" = "Scan";\n'.encode())
        put(A + "de.lproj/InfoPlist.strings", '"CFBundleName" = "Fixtur";'.encode("utf-16"))
        put(A + "fr.lproj/InfoPlist.strings", b'"Other" = "x";')
        put(A + "Frameworks/Sub.framework/Info.plist", info("dev.ifizbox.sub", "Sub", "Sub", CFBundlePackageType="FMWK"))
        put(A + "Frameworks/Sub.framework/Sub", fat_arm64e(), 0o100755)
        put(A + "PlugIns/Share.appex/Info.plist", info(
            "dev.ifizbox.fixture.share", "Share", "Share", CFBundlePackageType="XPC!",
            NSExtension={"NSExtensionPointIdentifier": "com.apple.share-services"}))
        put(A + "PlugIns/Share.appex/Share", macho(), 0o100755)
        put(A + "PlugIns/Widget.appex/Info.plist", info(
            "dev.ifizbox.fixture.widget", "Widget", "Widget", CFBundlePackageType="XPC!",
            NSExtension={"NSExtensionPointIdentifier": "com.apple.widgetkit-extension"}))
        put(A + "PlugIns/Widget.appex/Widget", macho(), 0o100755)
    return buf.getvalue()


def raw_profile(**plist):
    """A profile's plist inside some bytes, as Profile reads it (the CMS isn't checked)."""
    base = {"Name": "P", "UUID": "U", "TeamIdentifier": [T.TEAM],
            "Entitlements": {"application-identifier": f"{T.TEAM}.*", "get-task-allow": False},
            "ExpirationDate": dt.datetime(2030, 1, 1)}
    base.update(plist)
    return b"\x30\x80junk" + plistlib.dumps(base) + b"\0\0"


def cd_identifier(blob):
    off = struct.unpack_from(">I", blob, 20)[0]
    return blob[off:blob.index(b"\0", off)].decode()


@unittest.skipUnless(T and x509, f"the fixtures can't be made: {MISSING}")
@unittest.skipUnless(SWIFTC, "no Swift toolchain (SWIFT_TOOLCHAIN or swiftc on PATH): native/sign/ F14 parts not tested")
@unittest.skipUnless(OPENSSL, "openssl not on PATH")
class Sideload(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = disktmp.build_dir("ifizbox-sideloadtest-")  # off the shared /tmp tmpfs: see native/disktmp.py
        cls.fx = os.path.join(cls.tmp, "fixtures")
        cls.work = os.path.join(cls.tmp, "work")
        os.makedirs(cls.fx)
        key, cert, ca = T.identity()
        ca_key = T._CA[0]
        der = serialization.Encoding.DER
        cls.cert, cls.ca = cert, ca

        def w(name, data):
            with open(os.path.join(cls.fx, name), "wb") as f:
                f.write(data)
        w("key.pem", key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                        serialization.NoEncryption()))
        w("cert.der", cert.public_bytes(der))
        w("ca.der", ca.public_bytes(der))
        w("ca.pem", ca.public_bytes(serialization.Encoding.PEM))
        w("profile.mobileprovision", T.profile(key, cert))
        w("profile-explicit.mobileprovision", T.profile(key, cert, app_id="com.me.only"))
        w("kind-adhoc.mobileprovision", raw_profile(ProvisionedDevices=["a", "b"]))
        w("kind-enterprise.mobileprovision", raw_profile(ProvisionsAllDevices=True))
        w("kind-distribution.mobileprovision", raw_profile())
        w("edit.ipa", edit_ipa())
        w("icon.png", PNG)
        w("arm64e-old.macho", fat_arm64e())
        w("arm64e-new.macho", fat_arm64e(versioned=True))
        # A certificate with an OCSP responder in its AIA, as Apple's carry.
        now = dt.datetime.now(dt.timezone.utc)
        aia = (x509.CertificateBuilder().subject_name(cert.subject).issuer_name(ca.subject).public_key(key.public_key())
               .serial_number(4242).not_valid_before(now - dt.timedelta(days=1)).not_valid_after(now + dt.timedelta(days=9))
               .add_extension(x509.AuthorityInformationAccess([
                   x509.AccessDescription(x509.oid.AuthorityInformationAccessOID.CA_ISSUERS,
                                          x509.UniformResourceIdentifier("http://certs.apple.com/wwdrg3.der")),
                   x509.AccessDescription(x509.oid.AuthorityInformationAccessOID.OCSP,
                                          x509.UniformResourceIdentifier("http://ocsp.apple.com/ocsp03-wwdrg305"))]),
                   critical=False)
               .sign(ca_key, hashes.SHA256()))
        w("aia.der", aia.public_bytes(der))

        def answer(status, **kw):
            b = (ocsp.OCSPResponseBuilder()
                 .add_response(cert=cert, issuer=ca, algorithm=hashes.SHA1(), cert_status=status,
                               this_update=now - dt.timedelta(hours=1), next_update=now + dt.timedelta(hours=1), **kw)
                 .responder_id(ocsp.OCSPResponderEncoding.HASH, ca))
            return b.sign(ca_key, hashes.SHA256()).public_bytes(der)
        w("ocsp-good.der", answer(ocsp.OCSPCertStatus.GOOD, revocation_time=None, revocation_reason=None))
        w("ocsp-revoked.der", answer(ocsp.OCSPCertStatus.REVOKED,
                                     revocation_time=dt.datetime(2026, 11, 1, 12, 0, 0), revocation_reason=None))
        w("ocsp-unknown.der", answer(ocsp.OCSPCertStatus.UNKNOWN, revocation_time=None, revocation_reason=None))
        w("ocsp-trylater.der", ocsp.OCSPResponseBuilder.build_unsuccessful(
            ocsp.OCSPResponseStatus.TRY_LATER).public_bytes(der))
        _, other, _ = T.identity(name="Apple Development: Someone Else (ZZZZZ99999)")
        w("other.der", other.public_bytes(der))

        cls.binary = os.path.join(cls.tmp, "sideloadtest")
        env = disktmp.swift_env(dict(os.environ), cls.tmp)
        shim = os.path.join(cls.tmp, "libshim")
        if os.path.exists("/usr/lib/libncursesw.so.6") and not os.path.exists("/usr/lib/libncurses.so.6"):
            os.makedirs(shim)
            os.symlink("/usr/lib/libncursesw.so.6", os.path.join(shim, "libncurses.so.6"))
            env["LD_LIBRARY_PATH"] = shim + (":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")
        sign = os.path.join(HERE, "sign")
        sources = sorted(os.path.join(sign, f) for f in os.listdir(sign) if f.endswith(".swift"))
        r = subprocess.run([SWIFTC, "-O", "-module-cache-path", os.path.join(cls.tmp, "modules"),
                            "-import-objc-header", os.path.join(sign, "zlib-shim.h"), *sources,
                            os.path.join(sign, "tests", "sideload", "main.swift"), "-lz", "-o", cls.binary],
                           capture_output=True, text=True, env=env, timeout=600)
        cls.build_error = None if r.returncode == 0 else (r.stdout + r.stderr)[-4000:]
        cls.out = None
        if cls.build_error is None:
            cls.out = subprocess.run([cls.binary, cls.fx, cls.work], capture_output=True, text=True, timeout=600,
                                     env=disktmp.swift_env(dict(os.environ), cls.tmp))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_swift(self):
        self.assertIsNone(self.build_error, self.build_error)
        self.assertEqual(self.out.returncode, 0, self.out.stdout + self.out.stderr)
        self.assertIn("all passed", self.out.stdout)

    def test_signed_with_edits(self):
        """The IPA Swift signed with a new name, bundle ID and icon, and Widget.appex left out."""
        self.assertIsNone(self.build_error, self.build_error)
        with zipfile.ZipFile(os.path.join(self.work, "edited.ipa")) as z:
            files = {n: z.read(n) for n in z.namelist() if not n.endswith("/")}
        self.assertFalse([n for n in files if "Widget.appex" in n])
        app = plistlib.loads(files[A + "Info.plist"])
        self.assertEqual(app["CFBundleIdentifier"], "com.me.renamed")
        self.assertEqual(app["CFBundleDisplayName"], "Renamed")
        self.assertEqual(app["CFBundleIcons"]["CFBundlePrimaryIcon"], {"CFBundleIconFiles": ["iFizBoxIcon60x60"]})
        self.assertNotIn("CFBundleIconName", app)
        share = plistlib.loads(files[A + "PlugIns/Share.appex/Info.plist"])
        self.assertEqual(share["CFBundleIdentifier"], "com.me.renamed.share")
        self.assertEqual(cd_identifier(slots(files[A + "PlugIns/Share.appex/Share"])[0]), "com.me.renamed.share")
        self.assertEqual(cd_identifier(slots(files[A + "Fixture"])[0]), "com.me.renamed")
        self.assertEqual(files[A + "iFizBoxIcon60x60@2x.png"], PNG)
        self.assertEqual(files[A + "iFizBoxIcon60x60@3x.png"], PNG)
        self.assertEqual(plistlib.loads(files[A + "en.lproj/InfoPlist.strings"]),
                         {"CFBundleDisplayName": "Renamed", "NSCameraUsageDescription": "Scan"})
        self.assertEqual(plistlib.loads(files[A + "de.lproj/InfoPlist.strings"]), {"CFBundleName": "Renamed"})
        self.assertEqual(files[A + "fr.lproj/InfoPlist.strings"], b'"Other" = "x";')
        cr = plistlib.loads(files[A + "_CodeSignature/CodeResources"])["files2"]
        for f in ("iFizBoxIcon60x60@2x.png", "en.lproj/InfoPlist.strings"):
            self.assertIn(f, cr)
        # the framework's arm64e slice: subtype 0x80000002 in the fat header and the slice header
        sub = files[A + "Frameworks/Sub.framework/Sub"]
        n = struct.unpack_from(">I", sub, 4)[0]
        archs = [struct.unpack_from(">IIIII", sub, 8 + 20 * i) for i in range(n)]
        e = [a for a in archs if a[1] & 0xFF == 2]
        self.assertEqual(len(e), 1)
        self.assertEqual(e[0][1], 0x80000002)
        self.assertEqual(struct.unpack_from("<I", sub, e[0][2] + 8)[0], 0x80000002)
        # each Mach-O verifies with openssl: the CMS over its CodeDirectory, against the test CA
        for path in ("Fixture", "PlugIns/Share.appex/Share"):
            s = slots(files[A + path])
            cms, cd = os.path.join(self.tmp, "x.cms"), os.path.join(self.tmp, "x.cd")
            with open(cms, "wb") as f:
                f.write(s[0x10000][8:])
            with open(cd, "wb") as f:
                f.write(s[0])
            r = subprocess.run([OPENSSL, "cms", "-verify", "-binary", "-inform", "DER", "-in", cms, "-content", cd,
                                "-CAfile", os.path.join(self.fx, "ca.pem"), "-purpose", "any", "-out", os.devnull],
                               capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, path + ": " + r.stderr)

    def test_ocsp_request(self):
        """The OCSP request Swift built names the certificate as cryptography would."""
        self.assertIsNone(self.build_error, self.build_error)
        with open(os.path.join(self.work, "ocsp-request.der"), "rb") as f:
            req = ocsp.load_der_ocsp_request(f.read())
        want = ocsp.OCSPRequestBuilder().add_certificate(self.cert, self.ca, hashes.SHA1()).build()
        self.assertEqual(req.serial_number, self.cert.serial_number)
        self.assertEqual(req.issuer_name_hash, want.issuer_name_hash)
        self.assertEqual(req.issuer_key_hash, want.issuer_key_hash)
        self.assertIsInstance(req.hash_algorithm, hashes.SHA1)


if __name__ == "__main__":
    unittest.main()


class HandoffSourceTest(unittest.TestCase):
    """F75: the phone half can't run here, so read the sources: ifizbox:// links reach the page (scene URL contexts,
    app.takeURL), the certificate inside iFizBox's own IPA is imported at launch, and nothing of the old local HTTPS
    install mode (its CA, TLS server, trust calls) is left."""

    @classmethod
    def setUpClass(cls):
        src = os.path.join(HERE, "Sources")
        cls.files = {}
        for d in (src, os.path.join(HERE, "sign")):
            for f in os.listdir(d):
                if f.endswith(".swift"):
                    with open(os.path.join(d, f)) as fh:
                        cls.files[f] = fh.read()

    def test_links_reach_the_page(self):
        app = self.files["App.swift"]
        self.assertIn("openURLContexts", app)
        self.assertIn("options.urlContexts", app)
        self.assertIn('b.on("app.takeURL")', app)
        self.assertIn('b.on("app.gunzip")', app)
        self.assertIn("IncomingLink.accepts(url)", app)
        self.assertIn("Incoming.register(self)", self.files["Bridge.swift"])
        with open(os.path.join(HERE, "Info-sideload.plist"), "rb") as f:
            info = plistlib.load(f)
        self.assertIn("ifizbox", [s for t in info["CFBundleURLTypes"] for s in t["CFBundleURLSchemes"]])

    def test_bundled_identity_at_launch(self):
        self.assertIn("SignBridge.importBundled()", self.files["App.swift"])
        bridge = self.files["SignBridge.swift"]
        start = bridge.index("static func importBundled()")
        body = bridge[start:bridge.index("\n    }\n", start)]
        for part in ('"ifizbox-identity"', "BundledIdentity.shouldImport", "SignStore.identity() != nil",
                     "UserDefaults.standard.set(digest", "SignStore.importIdentity", "confirmImport", "refreshBundledProfile"):
            self.assertIn(part, body)
        # B420: with an identity held, the profile only, never the certificate
        start = bridge.index("static func refreshBundledProfile(")
        body = bridge[start:bridge.index("\n    }\n", start)]
        for part in ("BundledIdentity.shouldCompareProfile", "BundledIdentity.replacesProfile", "SignStore.replaceProfile",
                     "forKey: BundledIdentity.seenKey", "forKey: BundledIdentity.profileSeenKey"):
            self.assertIn(part, body)
        self.assertNotIn("importIdentity", body)

    def test_no_local_trust_left(self):
        for name, text in self.files.items():
            for gone in ("LocalTrust", "LocalCA", "ProfileSign", "InstallServer.secure", '"signing.trust"',
                         '"signing.resetTrust"', '"signing.testServer"', "mobileconfig", "NWProtocolTLS"):
                self.assertFalse(gone in text, f"{name} still has {gone}")
        self.assertIn("guard let servers = servers(c) else { return Apt.reply(c, nil, noServer) }", self.files["Sideload.swift"])

    def test_host_chosen_per_call(self):
        """B64: whether a signed IPA goes up to the server's /sign/host is the call's own choice, carried with it
        (Sideload.Servers), never a shared static a later call can change while an earlier one still signs."""
        import re
        side, lib = self.files["Sideload.swift"], self.files["MyIPAs.swift"]
        for name, text in self.files.items():
            self.assertIsNone(re.search(r"static var (hostServer|manifestServer)\b", text), name)
            self.assertNotIn("Sideload.hostServer", text, name)
        sig = side[side.index("static func signAndOpen("):]
        self.assertIn("servers: Servers,", sig[:sig.index("{")])
        self.assertIn("if let host = servers.host {", sig)
        self.assertIn("serveAndOpen(output, server: servers.manifest,", sig)
        # Re-sign All and My IPAs never host; only signing.install / signing.resign with host: true.
        self.assertIn("resign(c, allowHost: false) { $0 }", side)
        self.assertIn("Sideload.servers(c, allowHost: false)", lib)
        self.assertIn("serveAndOpen(out, server: servers.manifest,", lib)

    def body(self, text, start):
        i = text.index(start)
        return text[i:text.index("\n    }\n", i)]

    def test_handoff_not_refusal(self):
        """B76: signing.progress's false after a handoff (iOS fetched the whole IPA, or iFizBox went to the
        background during the watch) is lost sight, not a refusal: it answers installed null + handedOff true."""
        side = self.files["Sideload.swift"]
        handoff = side[side.index("enum Handoff {"):]
        handoff = handoff[:handoff.index("\n}\n")]
        self.assertIn("away || (served && !seen)", handoff)
        # each serve starts clean, and onServed marks it
        self.assertIn("Handoff.reset(app.bundleID)", side)
        self.assertIn('onServed: { serverLog("The whole IPA is sent to iOS"); Handoff.served(bid); end(true) }', side)
        watch = self.body(side, "    static func watch(")
        self.assertIn("UIApplication.didEnterBackgroundNotification", watch)
        self.assertIn("{ _ in away = true }", watch)
        self.assertIn("nc.removeObserver(bg)", watch)
        self.assertIn("if installed == false, lost(seen, away) { return finish(nil, true) }", watch)
        self.assertIn("Handoff.servedQuiet { return done(false) }", watch)
        # every end of the watch goes through done(), so the observer is always removed and lost() always asked
        self.assertNotIn("return finish(", watch.replace("return finish(nil, false) }", "").replace("return finish(nil, true) }", ""))
        progress = self.body(side, "    static func progress(")
        self.assertIn("Handoff.lostSight(served: Handoff.wasServed(bid), away: away, seen: seen)", progress)
        self.assertIn('"handedOff": handedOff', progress)

    def test_install_prompt_one_at_a_time(self):
        """B85: the itms-services link opens through InstallPrompt (once iFizBox is in front, again when iOS drops it),
        a dismissed prompt answers dismissed (not handed off; B91: still served), and signing.reprompt opens
        the link again; what the watch saw goes to the page's console."""
        side = self.files["Sideload.swift"]
        prompt = self.files["InstallPrompt.swift"]
        self.assertNotIn("UIApplication.shared.open(URL(string: link)!)", side)
        self.assertIn("InstallPrompt.open(iosLink, bundleID: bid, name: app.name)", side)
        self.assertIn("InstallPrompt.heard(bid); InstallLog.say(bid, s)", side)
        self.assertEqual(side.count("InstallPrompt.end(bid, link: iosLink)"), 2)  # served/expired, and cancelled
        self.assertIn('b.on("signing.reprompt")', side)
        self.assertIn("InstallPrompt.reprompt(bid)", side)
        watch = self.body(side, "    static func watch(")
        self.assertIn("} else if InstallPrompt.dismissed(bid) {", watch)
        progress = self.body(side, "    static func progress(")
        self.assertIn("!InstallPrompt.dismissed(bid) && Handoff.lostSight(", progress)
        # B91: a dismissed prompt keeps its IPA served, for the row's Try Again (signing.reprompt)
        self.assertNotIn("SignJob.cancel(tag: t)", progress)
        self.assertIn('"dismissed": dismissed', progress)
        self.assertIn("InstallPrompt.summary(bid)", progress)
        # it waits for iFizBox in front, retries a refused open, and opens once more when no prompt showed
        self.assertIn("UIApplication.shared.applicationState == .active", prompt)
        self.assertIn("UIApplication.willResignActiveNotification", prompt)
        self.assertIn("UIApplication.didBecomeActiveNotification", prompt)
        self.assertIn("} else if n < tries {", prompt)
        self.assertIn("e.reopened = true", prompt)
