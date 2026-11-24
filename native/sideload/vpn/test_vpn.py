"""F372: the built-in VPN for This iPhone installs, on Linux. The tunnel itself needs a phone; this checks what can be
checked here: the extension is the loopback tunnel (10.7.0.0 on the phone, a route for 10.7.0.1 only, packets written
back with the addresses swapped), the sideload IPA alone builds it in, the app's side registers every vpn.* call it
lists, IDevice turns it on for a connect and off after, and nothing of Shortcuts is left in it (C72). mkipa.py check
looks at the built IPA (the extension, its packet tunnel point, Network Extensions on both executables)."""
import os
import plistlib
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
NATIVE = os.path.normpath(os.path.join(HERE, "..", ".."))


def read(*p, base=HERE):
    with open(os.path.join(base, *p)) as f:
        return f.read()


def reflect(packet):
    """PacketTunnelProvider.reflect, the same rule in Python: IPv4 only, source and destination swapped."""
    if len(packet) < 20 or packet[0] >> 4 != 4:
        return None
    b = bytearray(packet)
    b[12:16], b[16:20] = packet[16:20], packet[12:16]
    return bytes(b)


def checksum(header):
    s = sum(int.from_bytes(header[i:i + 2], "big") for i in range(0, len(header), 2))
    while s >> 16:
        s = (s & 0xFFFF) + (s >> 16)
    return s


class Tunnel(unittest.TestCase):
    def test_loopback_addresses_and_route(self):
        src = read("Extension", "PacketTunnelProvider.swift")
        self.assertIn('deviceAddress = "10.7.0.0"', src)
        self.assertIn('peerAddress = "10.7.0.1"', src)
        self.assertIn('NEIPv4Route(destinationAddress: Self.peerAddress, subnetMask: "255.255.255.255")', src)
        self.assertIn("excludedRoutes = [NEIPv4Route.default()]", src)  # nothing else goes through it
        self.assertIn("for i in 12..<16 { raw.swapAt(i, i + 4) }", src)

    def test_swap_keeps_the_checksum(self):
        # an IPv4 header 10.7.0.0 -> 10.7.0.1 with a valid checksum stays valid after the swap
        h = bytearray(b"\x45\x00\x00\x28\x00\x01\x40\x00\x40\x06\x00\x00" + bytes([10, 7, 0, 0]) + bytes([10, 7, 0, 1]))
        c = 0xFFFF - checksum(bytes(h))
        h[10:12] = c.to_bytes(2, "big")
        back = reflect(bytes(h) + b"payload")
        self.assertEqual(back[12:16], bytes([10, 7, 0, 1]))
        self.assertEqual(back[16:20], bytes([10, 7, 0, 0]))
        self.assertEqual(checksum(back[:20]), 0xFFFF)
        self.assertEqual(back[20:], b"payload")
        self.assertIsNone(reflect(b"\x60" + bytes(39)))  # IPv6 isn't routed in

    def test_extension_plist(self):
        with open(os.path.join(HERE, "Info.plist"), "rb") as f:
            p = plistlib.load(f)
        self.assertEqual(p["NSExtension"]["NSExtensionPointIdentifier"], "com.apple.networkextension.packet-tunnel")
        self.assertEqual(p["NSExtension"]["NSExtensionPrincipalClass"], "$(BRAND_NAME)VPN.PacketTunnelProvider")
        self.assertEqual(p["CFBundleIdentifier"], "com.ryha.ifizbox.vpn")
        with open(os.path.join(HERE, "entitlements.plist"), "rb") as f:
            self.assertEqual(plistlib.load(f)["com.apple.developer.networking.networkextension"], ["packet-tunnel-provider"])


class Build(unittest.TestCase):
    def test_sideload_ipa_only(self):
        b = read("build.sh", base=NATIVE)
        self.assertIn("sideload/vpn/App/*.swift", b)
        self.assertRegex(b, r'\[ -z "\$overlay" \] \|\| SWIFTC=.*\n.*sideload/vpn/build\.sh "\$app"')
        self.assertIn("-framework NetworkExtension", b)
        self.assertIn("_NSExtensionMain", read("build.sh"))


class App(unittest.TestCase):
    def test_every_listed_call_is_registered(self):
        src = read("App", "LocalVPN.swift")
        listed = set(re.findall(r"^//\s+(vpn\.\w+)", src, re.M))
        registered = set(re.findall(r'b\.on\("(vpn\.\w+)"\)', src))
        self.assertEqual(listed, {"vpn.test"})
        self.assertEqual(listed, registered)
        self.assertIn("LocalVPNBridge.register(b)", read("Sources", "SignBridge.swift", base=NATIVE))

    def test_only_with_the_capability(self):
        src = read("App", "LocalVPN.swift")
        self.assertIn('p.entitlements["com.apple.developer.networking.networkextension"]', src)
        self.assertIn("AppMode.current != .jailbreak && providerID != nil && entitled", src)

    def test_on_for_the_connect_off_after(self):
        idev = read("idevice", "IDevice.swift", base=os.path.dirname(HERE))
        self.assertIn("try LocalVPN.begin {", idev)
        self.assertIn("if builtIn { LocalVPN.end() }", idev)
        src = read("App", "LocalVPN.swift")
        self.assertIn("m.isOnDemandEnabled = false", src)  # never on by itself
        self.assertIn("static let linger: TimeInterval = 3", src)
        self.assertIn("if stop { down() }", src)  # ours is off after the last connection
        self.assertIn('s["vpn"] = LocalVPN.status()', read("idevice", "IDeviceBridge.swift", base=os.path.dirname(HERE)))
        up = src[src.index("static func up("):src.index("static func down(")]
        self.assertLess(up.index("if !Path.online() {"), up.index("try manager()"))  # no network: say so at once, not after startLimit

    def test_status_is_plain(self):
        src = read("App", "LocalVPN.swift")
        status = src[src.index("static func status()"):src.index("/// The keys of")]
        for key in ["available", "bundled", "entitled", "tested", "on", "cellular", "wifi", "otherVPN"]:
            self.assertIn('"%s"' % key, status)
        self.assertNotIn("shortcuts", status)
        self.assertNotIn("trips", status)

    def test_no_shortcuts_left(self):
        """C72: no Install Switch, no Cellular Shortcuts, no trips: the VPN comes on and goes off by itself."""
        src = read("App", "LocalVPN.swift")
        for gone in ["runShortcut", "openShortcut", "x-callback-url", "vpn-shortcut", "switchNeeded", "switchedOn", "tripConnect",
                     'b.on("vpn.openShortcuts")', 'b.on("vpn.checkShortcut")', 'b.on("vpn.testSwitch")', 'b.on("vpn.leftOff")', "shortcuts://", "pendingKey"]:
            self.assertNotIn(gone, src)
        for path in [("sign", "SwitchOpens.swift"), ("intents", "App", "InstallSwitch.swift")]:
            self.assertFalse(os.path.exists(os.path.join(NATIVE, *path)), path)
        self.assertNotIn("LocalVPN.receive", read("Sources", "App.swift", base=NATIVE))
        self.assertNotIn("switchWouldRun", read("idevice", "IDeviceBridge.swift", base=os.path.dirname(HERE)))

    def test_old_keys_cleared_once(self):
        src = read("App", "LocalVPN.swift")
        for key in ["shortcut.off", "shortcut.on", "shortcut.switch", "shortcut.trip", "shortcut.idle", "switch.pending", "vpn.lost", "vpn.leftOff"]:
            self.assertIn("ifizbox.vpn." + key.removeprefix("vpn."), src)
        self.assertIn("guard !d.bool(forKey: clearedKey) else { return }", src)
        self.assertIn("LocalVPN.clearOldKeys()", src[src.index("static func register("):])

    def test_other_vpn_is_kept(self):
        src = read("App", "LocalVPN.swift")
        other = src[src.index("static func otherVPNUp()"):src.index("/// One address entry")]
        self.assertIn('hasPrefix("10.7.0.")', other)  # our own tunnel's address never counts as another VPN
        self.assertIn("AF_INET", other)


if __name__ == "__main__":
    unittest.main()
