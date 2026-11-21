"""B218: the app's Tailscale node and This iPhone's choices survive a reinstall or a re-sign: Tailscale.swift keeps the
node's state file, {name, keyExpiry}, Connect With and Install Apps With in the Keychain, puts them back before use,
and only Sign Out deletes the node's part (so each setup doesn't register a new device on the tailnet)."""
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def read(*p):
    with open(os.path.join(HERE, *p)) as f:
        return f.read()


def body(src, head):
    """The braces-balanced body after the first line containing `head`."""
    i = src.index(head)
    j = src.index("{", i)
    depth = 0
    for k in range(j, len(src)):
        depth += {"{": 1, "}": -1}.get(src[k], 0)
        if depth == 0:
            return src[j:k + 1]
    raise AssertionError(head)


class Keep(unittest.TestCase):
    src = read("Tailscale.swift")

    def test_state_file_is_tsnets(self):
        # tsnet's FileStore is Server.Dir/tailscaled.state (tailscale.com tsnet.go)
        self.assertIn('stateFile = "tailscaled.state"', self.src)

    def test_restored_before_the_node_starts(self):
        start = body(self.src, "static func start()")
        self.assertLess(start.index("TailscaleKeep.restoreState()"), start.index("TSStart("))

    def test_kept_once_signed_in(self):
        remember = body(self.src, "static func remember(")
        self.assertIn("TailscaleKeep.keepState()", remember)
        self.assertIn("TailscaleKeep.keepNode(n)", remember)

    def test_defaults_restored_at_launch(self):
        self.assertIn("TailscaleKeep.restoreDefaults()", body(self.src, "static func register(_ b: Bridge)"))
        self.assertIn("TailscaleKeep.write(TailscaleKeep.connectAccount", body(self.src, 'b.on("tailscale.setConnect")'))

    def test_only_sign_out_deletes_it(self):
        self.assertIn("TailscaleKeep.forgetNode(", body(self.src, "static func forget()"))
        callers = re.findall(r"Tailscale\.forget\(\)", self.src)
        self.assertEqual(len(callers), 1)
        self.assertIn("Tailscale.forget()", body(self.src, 'b.on("tailscale.signOut")'))
        # the state dir is removed nowhere else
        self.assertEqual(self.src.count("removeItem(at: stateDir)"), 1)

    def test_sign_out_keeps_the_machine_key(self):
        # B301: tsnet's Logout leaves ipn.MachineKeyStateKey ("_machinekey") in the store and deletes the login's
        # profile; Sign Out keeps that one entry (container and Keychain) so the next Sign In is the same machine.
        self.assertIn('machineKeyEntry = "_machinekey"', self.src)
        forget = body(self.src, "static func forget()")
        keep = forget.index("TailscaleKeep.keepMachineKeyOnly()")
        # read before anything is deleted, and the state dir goes only when there is no machine key
        self.assertLess(keep, forget.index("removeItem(at: stateDir)"))
        self.assertLess(keep, forget.index("TailscaleKeep.forgetNode("))
        self.assertIn("if !kept { try? FileManager.default.removeItem(at: stateDir) }", forget)
        self.assertIn("forgetNode(keepState: kept)", forget)
        only = body(self.src, "static func keepMachineKeyOnly()")
        self.assertIn("[machineKeyEntry: key]", only)
        # the file's key first, then the Keychain copy's
        self.assertIn("machineKey(try? Data(contentsOf: url)) ?? machineKey(read(stateAccount))", only)
        self.assertIn("write(stateAccount, kept)", only)
        self.assertIn("if !keepState { write(stateAccount, nil) }", body(self.src, "static func forgetNode("))
        # the node is logged out first and stopped before the state is cut down
        out = body(self.src, 'b.on("tailscale.signOut")')
        self.assertLess(out.index("TSLogout()"), out.index("Tailscale.stop()"))
        self.assertLess(out.index("Tailscale.stop()"), out.index("Tailscale.forget()"))

    def test_this_device_only_never_backed_up(self):
        keep = body(self.src, "enum TailscaleKeep")
        self.assertIn("kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly", keep)
        self.assertNotIn("kSecAttrSynchronizable", keep)

    def test_route_calls_registered(self):
        for name in ("tailscale.keepRoute", "tailscale.keptRoute"):
            self.assertIn(f'b.on("{name}")', self.src)
        with open(os.path.join(HERE, "..", "..", "..", "web", "app", "core", "installroute.js")) as f:
            js = f.read()
        self.assertIn('"tailscale.keepRoute"', js)
        self.assertIn('"tailscale.keptRoute"', js)


if __name__ == "__main__":
    unittest.main()
