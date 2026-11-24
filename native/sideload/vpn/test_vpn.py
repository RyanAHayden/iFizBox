"""F372: the built-in VPN for This iPhone installs, on Linux. The tunnel itself needs a phone; this checks what can be
checked here: the extension is the loopback tunnel (10.7.0.0 on the phone, a route for 10.7.0.1 only, packets written
back with the addresses swapped), the sideload IPA alone builds it in, the app's side registers every vpn.* call it
lists, IDevice turns it on for a connect and off after, and nothing of Shortcuts is left in it (C72). mkipa.py check
looks at the built IPA (the extension, its packet tunnel point, Network Extensions on both executables)."""
import os
import plistlib
import re
import shutil
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
NATIVE = os.path.normpath(os.path.join(HERE, "..", ".."))

sys.path.insert(0, NATIVE)

import disktmp  # noqa: E402
from test_sign import toolchain  # noqa: E402

SWIFTC = toolchain()


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
        self.assertEqual(listed, {"vpn.test", "vpn.setRestore"})
        self.assertEqual(listed, registered)
        self.assertIn("LocalVPNBridge.register(b)", read("Sources", "SignBridge.swift", base=NATIVE))

    def test_only_with_the_capability(self):
        src = read("App", "LocalVPN.swift")
        self.assertIn('p.entitlements["com.apple.developer.networking.networkextension"]', src)
        self.assertIn("AppMode.current != .jailbreak && providerID != nil && entitled", src)

    def test_on_for_the_connect_off_after(self):
        idev = read("idevice", "IDevice.swift", base=os.path.dirname(HERE))
        self.assertIn("try LocalVPN.begin(finishing: finishing) {", idev)
        self.assertIn("if builtIn { LocalVPN.end() }", idev)
        src = read("App", "LocalVPN.swift")
        self.assertIn("m.isOnDemandEnabled = false", src)  # never on by itself
        self.assertIn("static let linger: TimeInterval = 3", src)
        self.assertIn("stopNow(gen: gen)", src)  # ours is off after the last connection
        self.assertIn('s["vpn"] = LocalVPN.status()', read("idevice", "IDeviceBridge.swift", base=os.path.dirname(HERE)))
        up = src[src.index("static func up("):src.index("/// Before a connect to iOS")]
        self.assertLess(up.index("if !Path.online() {"), up.index("var m = try manager()"))  # no network: say so, not after startLimit

    def test_no_network_waits_a_few_seconds(self):
        """B428b: a start with no network waits for one, cancellable and without startLock; status() waits for nothing."""
        src = read("App", "LocalVPN.swift")
        limit = int(re.search(r"networkWait: TimeInterval = (\d+)", src).group(1))
        self.assertTrue(3 <= limit <= 10, limit)
        body = src[src.index("private static func waitForNetwork("):src.index("private static func noNetwork()")]
        self.assertLess(body.index("if Path.online() || connectedNow() { return true }"), body.index("while waited < networkWait"))
        self.assertNotIn("startLock.", body)
        loop = body[body.index("while waited < networkWait"):]
        self.assertLess(loop.index("try step("), loop.index("Thread.sleep(forTimeInterval: 0.25)"))  # Cancel
        up = src[src.index("static func up("):src.index("private static func start(")]
        self.assertLess(up.index("try waitForNetwork(step)"), up.index("startLock.lock(before:"))
        start = src[src.index("private static func start("):src.index("/// Before a connect to iOS")]
        self.assertNotIn("waitForNetwork", start)  # under startLock
        wait = src[src.index("static func waitOffCellular("):src.index("// ---- The app out of sight")]
        # an install: cancellable, then the path is read (cellular that came back asks for Airplane Mode)
        self.assertLess(wait.index("waitForNetwork({ _ in\n                if cancelled() { throw"), wait.index("guard Path.now().cellular"))
        status = src[src.index("static func status()"):src.index("/// The keys of")]
        self.assertNotIn("waitForNetwork", status)
        self.assertNotIn("connectedNow", status)

    def test_one_start_at_a_time(self):
        """B418: several installs at once: one start, the others find it connected; no save unless needed."""
        src = read("App", "LocalVPN.swift")
        up = src[src.index("static func up("):src.index("private static func start(")]
        self.assertLess(up.index("startLock.lock(before:"), up.index("try start(step)"))
        self.assertIn("defer { startLock.unlock() }", up)
        start = src[src.index("private static func start("):src.index("/// Before a connect to iOS")]
        self.assertLess(start.index("if on { return }"), start.index("try manager()"))
        manager = src[src.index("static func manager()"):src.index("private static func isOurs")]
        self.assertLess(manager.index("loadAllFromPreferences"), manager.index("if found == nil || !isOurs(m) {"))
        self.assertLess(manager.index("if found == nil || !isOurs(m) {"), manager.index("saveToPreferences"))
        self.assertIn("guard stale, !retried else { throw error }", manager)  # once, on a new load
        self.assertIn("NEVPNError.configurationStale.rawValue", src)
        # the only two callers hold startLock, and nothing else saves
        self.assertEqual(src.count("try manager()"), start.count("try manager()"))
        self.assertEqual(src.count("saveToPreferences"), 1)
        # status() never waits behind a start
        self.assertNotIn("startLock", src[src.index("static func status()"):src.index("/// The keys of")])

    def test_one_failed_start_fails_one_install(self):
        """B418: only iOS's refusal of the configuration is kept for the rest of a queue, not any failed start."""
        src = read("App", "LocalVPN.swift")
        self.assertNotIn("lastFailure", src)
        failed = src[src.index("static func failedNow()"):src.index("static func manager()")]
        self.assertIn("refusal.map", failed)
        self.assertEqual(re.findall(r"if (.*?) \{ refused\(f\) \}", src), ["refusable", "refusable && denied"])
        self.assertEqual(src.count("refusable: found == nil"), 1)  # the first save alone: the one iOS asks about

    def test_wifi_joined_never_waits(self):
        """B419: an IPv4 address on en0 is Wi-Fi, whatever the path says; a short drop is read again before asking."""
        src = read("App", "LocalVPN.swift")
        now = src[src.index("static func now()"):src.index("static func wifiAddress()")]
        self.assertIn("let wifi = p.usesInterfaceType(.wifi) || wifiAddress()", now)
        self.assertIn("return (p.usesInterfaceType(.cellular) && !wifi, wifi)", now)
        addr = src[src.index("static func wifiAddress()"):src.index("static func described()")]
        self.assertIn('== "en0"', addr)
        self.assertIn("== AF_INET {", addr)
        self.assertIn("static let airplaneReread: TimeInterval = 3", src)
        wait = src[src.index("static func waitOffCellular("):src.index("// ---- The app out of sight")]
        self.assertIn("guard Path.now().cellular else { return false }", wait)
        self.assertLess(wait.index("try hold(finishing)"), wait.index("var t0 = Date()"))
        self.assertLess(wait.index("if now.wifi && !asked {"), wait.index("waiting()\n"))
        self.assertIn("if now.cellular && !asked && Date().timeIntervalSince(t0) >= airplaneReread {", wait)
        self.assertEqual(wait.count(" waiting()\n"), 1)
        # the path's interfaces are in the log where the wait begins
        self.assertLess(wait.index("waiting for Wi-Fi or Airplane Mode; path:"), wait.index("waiting()\n"))

    def test_background(self):
        """B423: no VPN start in the background but to finish a connected install; the wait pauses; the stop runs."""
        src = read("App", "LocalVPN.swift")
        idev = read("idevice", "IDevice.swift", base=os.path.dirname(HERE))
        up = src[src.index("static func up("):src.index("private static func start(")]
        self.assertLess(up.index("while !finishing && mustWait()"), up.index("startLock.lock(before:"))  # not under the lock
        self.assertIn("if finishing || !mustWait() { break }", up)
        wait = src[src.index("static func waitOffCellular("):src.index("// ---- The app out of sight")]
        self.assertIn("static let awayGrace: TimeInterval = 30", src)
        # on cellular alone: never once Airplane Mode is on
        pause = wait[wait.index("if now.cellular, !running, IDevice.AppFront.away >= awayGrace {"):wait.index("if now.cellular { left = nil }")]
        self.assertLess(pause.index("end()"), pause.index("try pause("))
        self.assertLess(pause.index("try pause("), pause.index("try hold(false)"))
        body = src[src.index("private static func pause("):src.index("static func takeDownLeftOver()")]
        self.assertLess(body.index("installEnded()"), body.index("while !IDevice.AppFront.now || !Path.online()"))
        back = body[body.index("defer {"):body.index("var offline")]
        self.assertLess(back.index("installBegan()"), back.index("paused(.over)"))
        self.assertIn("if !run.connected { try LocalVPN.waitForApp(", idev)
        self.assertIn("Session(watch: w, finishing: run.connected)", idev)
        self.assertEqual(idev.count("finishing: run.connected"), 2)
        stop = src[src.index("private static func stopLater()"):src.index("private static func stopNow(")]
        self.assertLess(stop.index("BackgroundHold("), stop.index("asyncAfter"))
        # every stop: idle, checked again under startLock
        self.assertEqual(src.count("stopVPNTunnel()"), 1)  # downIfIdle's
        down = src[src.index("private static func downIfIdle("):src.index("static let beatEvery")]
        self.assertLess(down.index("startLock.lock()"), down.index("guard idle(), !["))
        self.assertIn("LocalVPN.takeDownLeftOver()", src[src.index("static func register("):])
        self.assertIn("LocalVPN.takeDownLeftOver()", idev[idev.index("willEnterForegroundNotification"):])
        sideload = read("Sources", "Sideload.swift", base=NATIVE)
        self.assertIn('else if held { held = false; KeepAlive.shared.end() }', sideload)

    def test_restore_my_vpn(self):
        """F419: the configuration is never removed, Restore My VPN on or off; the stop, the launch and the return look
        whether the back run is due (test_restoredue.py), and what ours takes the place of is noted before its save."""
        src = read("App", "LocalVPN.swift")
        for gone in ["removeFromPreferences", "giveBack", "downWaitRestore", "noteOther", "comeBack"]:
            self.assertNotIn(gone, src)
        self.assertNotIn("register(defaults", src)  # off by default
        start = src[src.index("private static func start("):src.index("/// Before a connect to iOS")]
        self.assertEqual(len(re.findall(r"RestoreBack.note\(\)\n\s*(?:var )?m = try manager\(\)", start)), start.count("try manager()"))
        stop = src[src.index("private static func stopNow("):src.index("/// One background task")]
        self.assertLess(stop.index("downIfIdle("), stop.index("RestoreBack.look()"))
        left = src[src.index("static func takeDownLeftOver()"):src.index("private static func downIfIdle(")]
        self.assertIn("else { return RestoreBack.look() }", left)
        self.assertLess(left.index("downIfIdle("), left.rindex("RestoreBack.look()"))
        waiting = src[src.index("static func waiting()"):src.index("static func withNoStart")]
        self.assertIn("pauses", waiting)
        self.assertIn("SignJob.anyGoing", waiting)
        pause = src[src.index("private static func pause("):src.index("static func takeDownLeftOver()")]
        self.assertLess(pause.index("pauses += 1"), pause.index("installEnded()"))
        self.assertLess(pause.index("installBegan()"), pause.index("pauses -= 1"))
        setr = src[src.index("static func setRestore("):src.index("private static var pauses")]
        self.assertIn("if !on { RestoreBack.forget() }", setr)
        self.assertNotIn("isMainThread", src)  # a background task's end runs off the main thread
        hold = src[src.index("final class BackgroundHold"):src.index("// ---- Other VPNs")]
        self.assertLess(hold.index("DispatchQueue.global"), hold.index("f(); self.end()"))

    def test_tunnel_stops_itself(self):
        """B423: a killed app's tunnel: 60 s awake with no packet; the app's beat is well inside it."""
        ext = read("Extension", "PacketTunnelProvider.swift")
        self.assertIn("static let quietLimit = 60", ext)
        self.assertIn("self.cancelTunnelWithError(nil)", ext)
        self.assertIn("self.heard()", ext[ext.index("private func loop()"):ext.index("static func reflect(")])
        src = read("App", "LocalVPN.swift")
        every = int(re.search(r"beatEvery: TimeInterval = (\d+)", src).group(1))
        self.assertLessEqual(every * 3, 60)
        self.assertIn("sendto(fd, ", src[src.index("func beatPacket()"):])
        self.assertIn("let go = holds > 0 || installs > 0", src)

    def test_status_is_plain(self):
        src = read("App", "LocalVPN.swift")
        status = src[src.index("static func status()"):src.index("/// The keys of")]
        for key in ["available", "bundled", "entitled", "tested", "on", "cellular", "wifi", "otherVPN", "restore", "remembered"]:
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


class CellularInstalls(unittest.TestCase):
    """F417a: the Cellular Installs Shortcut and the state its actions report into."""

    def setUp(self):
        self.swift = read("App", "CellularShortcut.swift")
        with open(os.path.join(os.path.dirname(NATIVE), "tools", "shortcuts", "cellular-installs.plist"), "rb") as f:
            self.wf = plistlib.load(f)

    def branches(self):
        """{the input key: the actions inside its If}, and the actions outside every If."""
        short = {"is.workflow.actions.cellulardata.set": "data", "is.workflow.actions.repeat.count": "repeat"}
        names = {}  # output UUID -> dictionary key
        inside, outside, key = {}, [], None
        for a in self.wf["WFWorkflowActions"]:
            i, p = a["WFWorkflowActionIdentifier"], a["WFWorkflowActionParameters"]
            if i.endswith("getvalueforkey"):
                names[p["UUID"]] = p["WFDictionaryKey"]
            elif i.endswith("conditional") and p["WFControlFlowMode"] == 0:
                self.assertEqual(p["WFCondition"], 100)  # has any value: "contains" loses its text on import
                key = names[p["WFInput"]["Variable"]["Value"]["OutputUUID"]]
                inside[key] = []
            elif i.endswith("conditional"):
                self.assertEqual(p["WFControlFlowMode"], 2)  # no Otherwise
                key = None
            else:
                v = short.get(i, i.rsplit(".", 1)[1])
                if v == "data":
                    v += " on" if p["OnValue"] else " off"
                elif v == "repeat":
                    v += " %d" % p["WFRepeatCount"] if p["WFControlFlowMode"] == 0 else " end"
                (outside if key is None else inside[key]).append(v)
        return inside, outside

    def test_plist(self):
        inside, outside = self.branches()
        turns = int(re.search(r"waitTurns = (\d+)", self.swift).group(1))
        self.assertEqual(inside, {
            "run": ["data off", "OpenForInstallIntent", "repeat %d" % turns, "WaitForInstallIntent", "repeat end", "data on", "FinishInstallsIntent"],
            "on": ["data on", "OpenForInstallIntent", "FinishInstallsIntent"],
            "check": ["OpenForInstallIntent", "WaitForInstallIntent", "FinishInstallsIntent"],
        })
        self.assertEqual(outside, ["dictionary", "nothing"])  # no input: no action of ours, no data touched; no output
        self.assertEqual(set(inside), set(re.search(r"case (run, on, check)", self.swift).group(1).split(", ")))
        self.assertLess(float(re.search(r"waitStep: TimeInterval = (\d+)", self.swift).group(1)), 30)

    def test_plist_names_our_actions(self):
        intents = read("intents", "App", "CellularInstalls.swift", base=NATIVE)
        env = read("brand.env", base=NATIVE)
        own = [a for a in self.wf["WFWorkflowActions"] if not a["WFWorkflowActionIdentifier"].startswith("is.workflow.")]
        self.assertEqual(len(own), 8)
        for a in own:
            d = a["WFWorkflowActionParameters"]["AppIntentDescriptor"]
            self.assertIn("struct %s: AppIntent" % d["AppIntentIdentifier"], intents)
            self.assertEqual(a["WFWorkflowActionIdentifier"], "%s.%s" % (d["BundleIdentifier"], d["AppIntentIdentifier"]))
            self.assertIn(d["BundleIdentifier"], env)

    def test_one_name(self):
        name = re.search(r'shortcutName = "(.+)"', self.swift).group(1)
        self.assertIn('name="%s"' % name, read("tools", "shortcuts", "sign.sh", base=os.path.dirname(NATIVE)))

    def test_signed(self):
        name = re.search(r'shortcutName = "(.+)"', self.swift).group(1)
        with open(os.path.join(os.path.dirname(NATIVE), "web", "app", "shortcuts", name + ".shortcut"), "rb") as f:
            self.assertEqual(f.read(4), b"AEA1")  # signed: iOS refuses the plain one
        self.assertIn('subdirectory: "web/shortcuts"', read("App", "CellularShortcutBridge.swift"))

    def test_bridge(self):
        src = read("App", "CellularShortcutBridge.swift")
        self.assertEqual(sorted(re.findall(r'b\.on\("([^"]+)"', src)), ["cellular.add", "cellular.check", "cellular.status"])
        for name in ["cellular.add", "cellular.check"]:  # never in the jailbreak app, nor under another bundle ID
            self.assertIn("if let e = refusal", src[src.index('b.on("%s")' % name):][:120])
        self.assertIn("AppMode.current != .jailbreak", src)
        self.assertIn("CellularShortcutBridge.register(b)", read("App", "LocalVPN.swift"))
        self.assertIn("if CellularShortcutBridge.receive(url) { return }", read("Sources", "App.swift", base=NATIVE))
        self.assertNotIn("drive(.run", src)  # nothing here turns cellular data off

    def test_run(self):
        """F417a2: only in the wait with the VPN up; what is owed is kept before Shortcuts opens, cleared once data is on."""
        src = read("App", "CellularRun.swift")
        self.assertEqual(sorted(re.findall(r'b\.on\("([^"]+)"', src)), ["cellular.putBack", "cellular.run"])
        self.assertIn("if let e = CellularShortcutBridge.refusal", src)
        run = src[src.index("private static func run()"):src.index("// ---- Putting")]
        order = ["guard LocalVPN.waitsOnCellular()", "guard LocalVPN.connectedNow()", "CellularShortcut.begin(.run", "owed = true", "drive(.run)", "owed = false"]
        self.assertEqual(sorted(order, key=run.index), order)
        self.assertLess(run.index("giveUp()"), run.index("= putBack()"))
        back = src[src.index("private static func putBack()"):]
        self.assertNotIn("owed = false", back)  # its callers: a run keeps it after a failed put-back, for one more at launch
        self.assertIn('if back != "failed" { owed = false }', run)
        self.assertLess(run.index("begin(.run"), run.index("releaseIfNone()"))
        self.assertIn("guard owed, CellularShortcutBridge.available", src)
        vpn = read("App", "LocalVPN.swift")
        self.assertIn("CellularRun.register(b)", vpn)
        wait = vpn[vpn.index("static func waitOffCellular("):vpn.index("// ---- The app out of sight")]
        self.assertLess(wait.index("try hold(finishing)"), wait.index("count(true)"))
        self.assertIn("if now.cellular, !running, IDevice.AppFront.away", wait)
        idev = read("idevice", "IDevice.swift", base=os.path.dirname(HERE))
        self.assertLess(idev.index("CellularShortcut.connects(wait)"), idev.index("try LocalVPN.waitOffCellular("))
        self.assertIn("defer { CellularShortcut.connected(wait) }", idev)  # failed or cancelled
        self.assertLess(idev.index("try Session(watch: w, finishing: run.connected)"), idev.index("        CellularShortcut.connected(wait)\n        run.onConnect"))

    @unittest.skipUnless(SWIFTC, "no Swift toolchain (SWIFT_TOOLCHAIN or swiftc on PATH): CellularShortcut.swift not tested")
    def test_state(self):
        tmp = disktmp.build_dir("ifizbox-cellulartest-")
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        env = disktmp.swift_env(dict(os.environ), tmp)
        if os.path.exists("/usr/lib/libncursesw.so.6") and not os.path.exists("/usr/lib/libncurses.so.6"):
            os.makedirs(os.path.join(tmp, "libshim"))
            os.symlink("/usr/lib/libncursesw.so.6", os.path.join(tmp, "libshim", "libncurses.so.6"))
            env["LD_LIBRARY_PATH"] = os.path.join(tmp, "libshim") + (":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")
        binary = os.path.join(tmp, "cellulartest")
        r = subprocess.run([SWIFTC, "-module-cache-path", os.path.join(tmp, "modules"), os.path.join(HERE, "App", "CellularShortcut.swift"),
                            os.path.join(HERE, "tests", "main.swift"), "-o", binary], capture_output=True, text=True, env=env, timeout=600)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-4000:])
        r = subprocess.run([binary], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
