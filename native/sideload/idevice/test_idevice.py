"""F15: the "no server" install route's build and bridge, on Linux. The route itself (pairing, LocalDevVPN, AFC,
installation_proxy) needs a phone; this checks what can be checked here: idevice is pinned to one commit and built
from source with only the features the route uses, the bridge registers every call its header lists and refuses the
jailbreak build, and (where native/build.sh has built the app) the executable carries idevice statically."""
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
NATIVE = os.path.normpath(os.path.join(HERE, "..", ".."))


def read(*p):
    with open(os.path.join(HERE, *p)) as f:
        return f.read()


def pin():
    out = {}
    for line in read("pin.env").splitlines():
        line = line.split(" #", 1)[0].strip()
        if line and not line.startswith("#"):
            k, v = line.split("=", 1)
            out[k] = v
    return out


class Pin(unittest.TestCase):
    def test_one_commit_from_upstream(self):
        p = pin()
        self.assertEqual(p["IDEVICE_REPO"], "https://github.com/jkcoxson/idevice.git")
        self.assertRegex(p["IDEVICE_COMMIT"], r"^[0-9a-f]{40}$")

    def test_only_the_route_features(self):
        feats = set(pin()["IDEVICE_FEATURES"].split(","))
        need = {"tcp", "afc", "installation_proxy", "heartbeat", "rsd", "remote_pairing", "core_device_proxy"}
        self.assertLessEqual(need, feats)
        self.assertIn("ring", feats)  # aws-lc and openssl don't cross-build from Linux without a Mac toolchain
        self.assertFalse(feats & {"aws-lc", "openssl", "full", "usbmuxd", "debug_proxy", "dvt", "restore"}, feats)

    def test_build_is_locked_and_static(self):
        b = read("build.sh")
        self.assertIn("--locked", b)  # upstream's Cargo.lock at the pinned commit, nothing newer
        self.assertIn("--no-default-features", b)
        self.assertIn("libidevice_ffi.a", b)

    def test_app_build_uses_it(self):
        with open(os.path.join(NATIVE, "build.sh")) as f:
            b = f.read()
        self.assertIn("sideload/idevice/build.sh --probe", b)
        self.assertIn("sideload/idevice/*.swift", b)
        self.assertIn("-lidevice_ffi", b)


class Bridge(unittest.TestCase):
    def test_every_listed_call_is_registered(self):
        src = read("IDeviceBridge.swift")
        listed = set(re.findall(r"^//\s+(idevice\.\w+)", src, re.M))
        registered = set(re.findall(r'b\.on\("(idevice\.\w+)"\)', src))
        self.assertTrue(listed)
        self.assertEqual(listed, registered)

    def test_registered_with_the_signing_calls(self):
        with open(os.path.join(NATIVE, "Sources", "SignBridge.swift")) as f:
            self.assertIn("IDeviceBridge.register(b)", f.read())

    def test_jailbreak_build_refused(self):
        self.assertIn("AppMode.current != .jailbreak", read("IDeviceBridge.swift"))

    def test_pairing_stays_on_this_device(self):
        src = read("IDevice.swift")
        self.assertIn("kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly", src)
        self.assertNotIn("UserDefaults", src)


class PairOnPhone(unittest.TestCase):
    # idevice's all-in-one pairable_host_accept (IPv4-only listener, its own mDNS responder) was resolved by the
    # iPhone 15 Pro but never reached: the app listens and publishes with Apple's APIs, idevice only pairs.
    def test_apple_networking_idevice_pairing(self):
        src = read("IDevice.swift")
        self.assertIn("pairable_host_prepare(", src)
        self.assertIn("pairable_host_accept_fd(", src)
        self.assertNotIn("pairable_host_accept(", src)
        self.assertIn("DNSServiceRegister(", src)
        self.assertIn("IPV6_V6ONLY", src)

    def test_bonjour_declared(self):
        import plistlib
        with open(os.path.join(NATIVE, "Info-sideload.plist"), "rb") as f:
            info = plistlib.load(f)
        self.assertIn("_remotepairing-pairable-host._tcp", info["NSBonjourServices"])
        self.assertTrue(info["NSLocalNetworkUsageDescription"])
        self.assertIn('"_remotepairing-pairable-host._tcp"', read("IDevice.swift"))


class InstallNeverHangs(unittest.TestCase):
    # f15pair4 (iPhone 15 Pro, iOS 27.0.1): the tunnel came up, 14.4 MB went over it, then nothing moved and the page
    # waited for ever with no log line from the app (NSLog doesn't reach the syslog relay on iOS 27).
    def test_os_log_public_not_nslog(self):
        src = read("IDevice.swift")
        self.assertNotIn("NSLog(", src)
        self.assertIn('OSLog(subsystem: "ifizbox.idevice", category: "install")', src)
        self.assertIn('"%{public}@", log: installLog', src)
        side = open(os.path.join(NATIVE, "Sources", "Sideload.swift")).read()
        body = side[side.index("static func installHere("):side.index("static func serveAndOpen(")]
        self.assertNotIn("NSLog(", body)
        self.assertIn("IDevice.ilog(", body)

    def test_every_step_has_a_limit(self):
        src = read("IDevice.swift")
        # the whole install and verify run under the watchdog, which closes the tunnel when a step goes quiet
        # B246: each try after a dropped connection runs under its own watch ("install, connection 2", ...)
        self.assertIn('try watched(attempt == 0 ? "install" : "install, connection', src)
        self.assertIn('watched("verify")', src)
        self.assertIn("adapter_clone(adapter)", src)
        self.assertIn("adapter_close(c)", src)
        self.assertIn('Failure(code: "timeout"', src)
        install = src[src.index("static func install("):]
        for step in ["Limit.install", "Limit.afcStep", "Limit.upload"]:
            self.assertIn(step, install)
        session = src[src.index("final class Session"):src.index("static func verify()")]
        for step in ["Limit.tunnel", "Limit.service"]:
            self.assertIn(step, session)
        self.assertGreaterEqual(install.count("w.alive("), 2)  # an uploaded chunk, an installd percentage

    def test_page_tells_installing_here_from_downloading(self):
        side = open(os.path.join(NATIVE, "Sources", "Sideload.swift")).read()
        body = side[side.index("static func installHere("):side.index("static func serveAndOpen(")]
        self.assertIn('emit?("here"', body)
        self.assertNotIn('emit?("installing"', body)
        sign = open(os.path.join(NATIVE, "Sources", "SignBridge.swift")).read()
        self.assertIn('"offline: No internet connection', sign)
        self.assertIn(".notConnectedToInternet", sign)


class RemotePairingPort(unittest.TestCase):
    # B220: remotepairingd's port isn't fixed at 49152; a connect finds it (last good, 49152, then mDNS) over the
    # route in use, and a refused or turned-down pairing comes back as a code the page answers with Pair Again.
    def test_session_finds_the_port_over_its_route(self):
        src = read("IDevice.swift")
        session = src[src.index("final class Session"):src.index("static func verify()")]
        self.assertIn("IDevice.findRemotePairingPort", session)
        self.assertIn("tailnet ? Tailscale.probe(p) : VPNCheck.probe(p)", session)
        self.assertIn('w.alive("probing port', session)  # the watchdog's clock restarts per probe
        self.assertIn("Tailscale.mapPort(rpPort)", session)
        self.assertIn("IDevice.connectFailure(e)", session)

    def test_port_search_order_and_codes(self):
        src = read("IDevice.swift")
        find = src[src.index("static func findRemotePairingPort"):src.index("private final class BrowseBox")]
        self.assertLess(find.index("knownRemotePairingPorts()"), find.index("advertisedRemotePairingPorts()"))
        self.assertIn('Failure(code: "refused"', find)
        self.assertIn('static let remotePairingService = "_remotepairing._tcp"', src)
        self.assertIn("DNSServiceBrowse(&browse, 0, 0, remotePairingService", src)
        fail = src[src.index("static func connectFailure"):]
        self.assertIn('"pairing_rejected"', fail)
        self.assertIn('"refused"', fail)

    def test_browse_type_is_allowed(self):
        with open(os.path.join(NATIVE, "Info-sideload.plist")) as f:
            plist = f.read()
        bonjour = plist[plist.index("<key>NSBonjourServices</key>"):]
        bonjour = bonjour[:bonjour.index("</array>")]
        self.assertIn("<string>_remotepairing._tcp</string>", bonjour)  # iOS refuses to browse an unlisted type
        self.assertIn("<string>_remotepairing-pairable-host._tcp</string>", bonjour)


class OnePairingAtATime(unittest.TestCase):
    # B320 (iPhone 15 Pro): the code on the page didn't work in Settings, and Developer Mode listed a "Pair with" row
    # per try. A pairing runs on its own queue (never behind a connect), a second idevice.pair joins the one that runs
    # (same code), and every advertisement carries the same kept altIRK.
    def test_pairing_has_its_own_queue(self):
        src = read("IDeviceBridge.swift")
        body = src[src.index('b.on("idevice.pair")'):src.index('b.on("idevice.pairCancel")')]
        self.assertIn("pairQueue.async", body)
        self.assertEqual(body.count("run(c)"), 1)  # only the jailbreak build's refusal goes through IDevice.queue
        self.assertIn('DispatchQueue(label: "ifizbox.idevice.pair"', src)

    def test_a_second_call_joins_the_running_pairing(self):
        src = read("IDeviceBridge.swift")
        body = src[src.index('b.on("idevice.pair")'):src.index('b.on("idevice.pairCancel")')]
        join = body[:body.index("IDevice.newPairingCode()")]
        self.assertIn("!running.cancel.isCanceled", join)
        self.assertIn('c.emit([["pin": code]])', join)  # the running pairing's code, not a new one
        self.assertIn("running.call = c", join)

    def test_leaving_keeps_the_advertisement_a_while(self):
        src = read("IDeviceBridge.swift")
        cancel = src[src.index('b.on("idevice.pairCancel")'):src.index('b.on("idevice.verify")')]
        self.assertIn("asyncAfter(deadline: .now() + leaveGrace)", cancel)
        self.assertIn("s.leaving == gen", cancel)  # a join (or another leave) after it keeps it going
        self.assertIn('"canceled: pairing stopped"', cancel)  # the left page's call still ends at once

    def test_advertisement_keeps_its_key(self):
        src = read("IDevice.swift")
        self.assertIn("pairable_host_set_alt_irk(", src)
        self.assertIn('advertService = "ifizbox.idevice.advert"', src)
        self.assertIn("kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly", src[src.index("keptAdvertKey"):])
        self.assertTrue(os.path.exists(os.path.join(HERE, "patches", "0003-pairable-host-kept-alt-irk.patch")))


class Built(unittest.TestCase):
    # The built IPA is checked by mkipa.py check right after native/build.sh builds it (the gate's last step). A
    # check here would read whatever native/build/ipa a checkout last built, from before a merge brought idevice in.
    def test_ipa_check_looks_for_idevice(self):
        with open(os.path.join(NATIVE, "mkipa.py")) as f:
            src = f.read()
        self.assertIn('b"ifizbox.idevice.pairing"', src)  # the Keychain service: IDevice.swift is in
        self.assertIn('b"_remotepairing-pairable-host._tcp"', src)  # idevice's pairable host made it past dead_strip


if __name__ == "__main__":
    unittest.main()
