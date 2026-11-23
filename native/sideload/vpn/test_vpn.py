"""F372: the built-in VPN for This iPhone installs, on Linux. The tunnel itself needs a phone; this checks what can be
checked here: the extension is the loopback tunnel (10.7.0.0 on the phone, a route for 10.7.0.1 only, packets written
back with the addresses swapped), the sideload IPA alone builds it in, the app's side registers every vpn.* call it
lists, IDevice turns it on for a connect and off after, and Shortcuts' callback reaches it. mkipa.py check looks at the
built IPA (the extension, its packet tunnel point, Network Extensions on both executables)."""
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
        self.assertTrue(listed)
        self.assertEqual(listed, registered)
        self.assertIn("LocalVPNBridge.register(b)", read("Sources", "SignBridge.swift", base=NATIVE))

    def test_only_with_the_capability(self):
        src = read("App", "LocalVPN.swift")
        self.assertIn('p.entitlements["com.apple.developer.networking.networkextension"]', src)
        self.assertIn("AppMode.current != .jailbreak && providerID != nil && entitled", src)

    def test_on_for_the_connect_off_after(self):
        idev = read("idevice", "IDevice.swift", base=os.path.dirname(HERE))
        self.assertIn("dataOff = try LocalVPN.begin", idev)
        self.assertIn("if builtIn { LocalVPN.connected(dataOff: dataOff); LocalVPN.end() }", idev)
        self.assertIn("if dataOff { LocalVPN.connected(dataOff: true); dataOff = false }", idev)
        src = read("App", "LocalVPN.swift")
        self.assertIn("m.isOnDemandEnabled = false", src)  # never on by itself
        self.assertIn("static let linger: TimeInterval = 3", src)
        self.assertIn('s["vpn"] = LocalVPN.status()', read("idevice", "IDeviceBridge.swift", base=os.path.dirname(HERE)))

    def test_cellular_shortcuts(self):
        src = read("App", "LocalVPN.swift")
        self.assertIn('["off": "Cellular Data Off", "on": "Cellular Data On", "switch": "Install Switch"]', src)
        self.assertIn('c.scheme = "shortcuts"; c.host = "x-callback-url"; c.path = "/run-shortcut"', src)
        self.assertIn('url.host == "vpn-shortcut"', src)
        self.assertIn("if LocalVPN.receive(url) { return }", read("Sources", "App.swift", base=NATIVE))
        # the web's names are the same
        web = read("web", "app", "core", "installroute.js", base=os.path.dirname(NATIVE))
        self.assertIn('SHORTCUT_NAMES = { off: "Cellular Data Off", on: "Cellular Data On", switch: "Install Switch" }', web)

    def test_install_switch(self):
        """F386: one Shortcut around a queue of installs: its start before the first connect, its end once the VPN
        is off after the last; the plist reads JSON flags with "has any value" only (B359: "contains" loses its text)."""
        import plistlib
        src = read("App", "LocalVPN.swift")
        self.assertIn('runShortcut("switch", input: switchInput("start"))', src)
        self.assertIn("if stop { down(); endSwitch() }", src)
        self.assertIn("UIApplication.didBecomeActiveNotification", src)  # an end found in the background runs later
        self.assertIn('b.on("vpn.testSwitch")', src)
        repo = os.path.dirname(NATIVE)
        with open(os.path.join(repo, "tools", "shortcuts", "install-switch.plist"), "rb") as f:
            wf = plistlib.load(f)
        acts = wf["WFWorkflowActions"]
        ids = [a["WFWorkflowActionIdentifier"].removeprefix("is.workflow.actions.") for a in acts]
        for want in ["detect.dictionary", "vpn.get", "setstoredcontent", "getstoredcontent", "filter.vpns", "vpn.set", "cellulardata.set"]:
            self.assertIn(want, ids)
        self.assertEqual(ids[-1], "nothing")
        keys = [a["WFWorkflowActionParameters"].get("WFDictionaryKey") for a in acts if ids[acts.index(a)] == "getvalueforkey"]
        self.assertEqual(keys, ["start", "end", "cellular", "dataOff"])
        groups = {}
        for a in acts:
            p = a["WFWorkflowActionParameters"]
            if a["WFWorkflowActionIdentifier"].endswith("conditional"):
                if p["WFControlFlowMode"] == 0:
                    self.assertEqual(p["WFCondition"], 100, "has any value only")
                groups.setdefault(p["GroupingIdentifier"], []).append(p["WFControlFlowMode"])
        for g, modes in groups.items():
            self.assertEqual(modes[0], 0, g)
            self.assertEqual(modes[-1], 2, g)
        sets = [a["WFWorkflowActionParameters"] for a in acts if a["WFWorkflowActionIdentifier"].endswith("vpn.set")]
        self.assertEqual([s["WFVPNOperation"] for s in sets], ["Connect", "Connect"])
        last_set = len(ids) - 1 - ids[::-1].index("vpn.set")  # the end forgets before Set VPN's error 2 ends the run
        self.assertEqual(ids[last_set - 1], "deletestoredcontent")
        flt = next(a for a in acts if ids[acts.index(a)] == "filter.vpns")["WFWorkflowActionParameters"]
        tpl = flt["WFContentItemFilter"]["Value"]["WFActionParameterFilterTemplates"][0]
        self.assertEqual((tpl["Property"], tpl["Values"]["String"]), ("Server Address", "10.7.0.1"))
        self.assertIn('static let peer = "10.7.0.1"', src)  # the address Find VPNs looks for

    def test_install_switch_vpn_before_data_off(self):
        """B375: iOS starts no VPN without a network ("No network available"), so Cellular Data goes off only after
        the built-in VPN is up: the start's Set VPN comes before its Cellular Data Off, and the app turns data off
        with a separate {"dataOff":1} run once up() has the VPN connected (never "cellular" with the start)."""
        import plistlib
        src = read("App", "LocalVPN.swift")
        begin = src[src.index("static func begin("):src.index("static func waitOffCellular(")]
        self.assertNotIn('switchInput("start", cellular', src)
        self.assertLess(begin.index("try up(step)"), begin.index('switchInput("dataOff")'))
        self.assertIn("if !Path.online() { throw", src)  # no network: say so at once, not after startLimit
        repo = os.path.dirname(NATIVE)
        with open(os.path.join(repo, "tools", "shortcuts", "install-switch.plist"), "rb") as f:
            acts = plistlib.load(f)["WFWorkflowActions"]
        ids = [a["WFWorkflowActionIdentifier"].removeprefix("is.workflow.actions.") for a in acts]
        offs = [i for i, a in enumerate(acts) if ids[i] == "cellulardata.set" and a["WFWorkflowActionParameters"]["OnValue"] is False]
        first_set = ids.index("vpn.set")
        self.assertEqual(len(offs), 2, "the start's (old app builds) and dataOff's")
        self.assertTrue(all(i > first_set for i in offs), "no Cellular Data Off before the start's Set VPN")
        cond = acts[offs[1] - 1]["WFWorkflowActionParameters"]
        self.assertEqual(cond["WFInput"]["Variable"]["Value"]["OutputName"], "Data Off")

    def test_install_switch_only_when_needed(self):
        """F388: a queue's start runs the Install Switch only on cellular or with another VPN up (which only its Set
        VPN brings back); on Wi-Fi with no other VPN the app's own up() does it all and Shortcuts never opens. Our own
        tunnel's 10.7.0.x address never counts as another VPN."""
        src = read("App", "LocalVPN.swift")
        begin = src[src.index("static func begin("):src.index("static func waitOffCellular(")]
        self.assertIn("switchNeeded(cellular: onCellular, otherVPN: other)", begin)
        self.assertIn("static func switchNeeded(cellular: Bool, otherVPN: Bool) -> Bool { cellular || otherVPN }", src)
        other = src[src.index("static func otherVPNUp()"):]
        other = other[:other.index("\n    }\n")]
        self.assertIn('hasPrefix("10.7.0.")', other)
        self.assertIn("AF_INET", other)
        web = read("web", "app", "screens", "installroute.js", base=os.path.dirname(NATIVE))
        self.assertIn("It opens Shortcuts only when needed: on cellular", web)


if __name__ == "__main__":
    unittest.main()
