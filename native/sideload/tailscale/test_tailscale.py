"""The Tailscale connection's build and bridge, on Linux (README.md beside this file): Go is pinned by version and
sha256 and tailscale.com by go.mod/go.sum, the c-archive goes into the sideload executable only, every listed bridge
call is registered, and nothing is logged to Tailscale's servers."""
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
NATIVE = os.path.normpath(os.path.join(HERE, "..", ".."))


def read(*p):
    with open(os.path.join(HERE, *p)) as f:
        return f.read()


class Pin(unittest.TestCase):
    def test_go_and_tailscale_pinned(self):
        pin = read("pin.env")
        self.assertRegex(pin, r"GO_VERSION=go1\.\d+\.\d+")
        self.assertRegex(pin, r"GO_SHA256=[0-9a-f]{64}")
        self.assertRegex(read("go.mod"), r"tailscale\.com v\d+\.\d+\.\d+")
        self.assertIn("tailscale.com v", read("go.sum"))
        b = read("build.sh")
        self.assertIn("sha256sum -c", b)
        self.assertIn("-mod=readonly", b)
        self.assertIn("GOTOOLCHAIN=local", b)
        self.assertIn("-buildmode=c-archive", b)

    def test_licence_next_to_it(self):
        self.assertTrue(read("LICENSE").startswith("BSD 3-Clause License"))


class Build(unittest.TestCase):
    def test_sideload_only(self):
        with open(os.path.join(NATIVE, "build.sh")) as f:
            b = f.read()
        self.assertIn("sideload/tailscale/build.sh --probe", b)
        self.assertIn("sideload/tailscale/*.swift", b)
        self.assertIn('link "$out/tsnet-stub.o" -o "$out/$BRAND_NAME"', b)
        self.assertRegex(b, r'link "\$out/tailscale/libtsnet\.a".*\n.*-o "\$out/\$BRAND_NAME-sideload"')
        self.assertIn("exe=$out/$BRAND_NAME-sideload", b)

    def test_stub_matches_header(self):
        h = set(re.findall(r"\b(TS\w+)\(", read("tsnet_ffi.h")))
        self.assertEqual(h, set(re.findall(r"\b(TS\w+)\(", read("stub.c"))) & h)
        exported = set(re.findall(r"^//export (TS\w+)", read("tsnet.go"), re.M))
        self.assertEqual(h, exported)

    def test_idevice_port_map_patch(self):
        p = read("..", "idevice", "patches", "0002-tunnel-port-map.patch")
        self.assertIn("tunnel_set_port_map", p)
        self.assertIn("map_tunnel_port(tunnel_port)", p)


class Bridge(unittest.TestCase):
    def test_every_listed_call_is_registered(self):
        src = read("Tailscale.swift")
        listed = set(re.findall(r"^//\s+(tailscale\.\w+)", src, re.M))
        registered = set(re.findall(r'b\.on\("(tailscale\.\w+)"\)', src))
        self.assertTrue(listed)
        self.assertEqual(listed, registered)
        with open(os.path.join(NATIVE, "Sources", "SignBridge.swift")) as f:
            self.assertIn("TailscaleBridge.register(b)", f.read())

    def test_no_logs_to_tailscale_and_not_ephemeral(self):
        go = read("tsnet.go")
        self.assertIn('os.Setenv("TS_NO_LOGS_NO_SUPPORT", "true")', go)
        self.assertNotIn("Ephemeral: true", go)

    def test_install_session_uses_it(self):
        with open(os.path.join(NATIVE, "sideload", "idevice", "IDevice.swift")) as f:
            s = f.read()
        self.assertIn("Tailscale.useForInstall()", s)
        self.assertIn("Tailscale.beginInstall(port:", s)
        self.assertIn("Tailscale.endInstall()", s)


def model_names():
    """Tailscale.modelNames, read out of the Swift source: [(identifier, name)] in the order written."""
    s = read("Tailscale.swift")
    body = re.search(r"static let modelNames: \[String: String\] = \[(.*?)\n    \]", s, re.S).group(1)
    return re.findall(r'"([^"]+)": "([^"]+)"', body)


def machine_name(device_name, model, machine, table):
    """Tailscale.machineName, the same rules: the user's own name, else the model's, else the identifier."""
    if device_name and device_name != model:
        return device_name
    return table.get(machine) or machine


def tailscale_label(hostname):
    """Roughly what Tailscale makes of a hostname for the machine name: lower case, runs of other characters to '-'."""
    return re.sub(r"[^a-z0-9]+", "-", hostname.lower()).strip("-")


class MachineName(unittest.TestCase):
    """The node's machine name comes from the phone's model, since iOS 16 says only 'iPhone' for the device name."""

    def test_table_identifiers_and_names(self):
        pairs = model_names()
        ids = [k for k, _ in pairs]
        self.assertEqual(len(ids), len(set(ids)), "an identifier listed twice")
        for k, v in pairs:
            self.assertRegex(k, r"^iPhone\d+,\d+$")
            self.assertRegex(v, r"^iPhone [0-9A-Za-z ]+$")
        t = dict(pairs)
        self.assertEqual(t["iPhone16,1"], "iPhone 15 Pro")
        self.assertEqual(t["iPhone16,2"], "iPhone 15 Pro Max")
        self.assertEqual(t["iPhone9,1"], "iPhone 7")
        self.assertEqual(t["iPhone9,3"], "iPhone 7")
        self.assertEqual(t["iPhone10,6"], "iPhone X")
        self.assertEqual(t["iPhone17,1"], "iPhone 16 Pro")
        self.assertEqual(t["iPhone14,6"], "iPhone SE 3")
        # every iPhone that runs iOS 15 or later, so none falls back to its identifier
        for k in ["iPhone8,1", "iPhone8,4", "iPhone11,8", "iPhone12,8", "iPhone13,1", "iPhone15,4", "iPhone17,5",
                  "iPhone18,1"]:
            self.assertIn(k, t)

    def test_rules(self):
        t = dict(model_names())
        self.assertEqual(machine_name("iPhone", "iPhone", "iPhone16,1", t), "iPhone 15 Pro")
        self.assertEqual(machine_name("Sam's iPhone", "iPhone", "iPhone16,1", t), "Sam's iPhone")
        self.assertEqual(machine_name("iPhone", "iPhone", "iPhone99,1", t), "iPhone99,1")
        self.assertEqual(machine_name("iPad", "iPad", "iPad13,1", t), "iPad13,1")
        self.assertTrue(tailscale_label("X on " + machine_name("iPhone", "iPhone", "iPhone16,1", t))
                        .endswith("-on-iphone-15-pro"))

    def test_swift_uses_it(self):
        s = read("Tailscale.swift")
        self.assertIn("if !deviceName.isEmpty && deviceName != model { return deviceName }", s)
        self.assertIn("if let name = modelNames[machine] { return name }", s)
        self.assertIn("Tailscale.deviceName = Tailscale.machineName(deviceName: UIDevice.current.name, "
                      "model: UIDevice.current.model,", s)
        self.assertIn("machine: Tailscale.machineIdentifier)", s)
        self.assertIn('static var hostname: String { "\\(Brand.name) on \\(deviceName)" }', s)


if __name__ == "__main__":
    unittest.main()
