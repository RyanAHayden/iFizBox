"""Install Apps With survives a reinstall or a re-sign: KeptRoute.swift keeps it in the Keychain (route.keep / route.kept),
under the service name earlier builds used, so a route kept before is still found."""
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def read(name):
    with open(os.path.join(HERE, name)) as f:
        return f.read()


class KeptRoute(unittest.TestCase):
    src = read("KeptRoute.swift")

    def test_same_keychain_item_as_before(self):
        self.assertIn('service = "com.ryha.ifizbox.tailscale"', self.src)
        self.assertIn('account = "route"', self.src)

    def test_only_iphone_or_server(self):
        self.assertEqual(self.src.count('["iphone", "server"].contains('), 2)

    def test_this_device_only(self):
        self.assertIn("kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly", self.src)

    def test_bridge_names(self):
        self.assertIn('b.on("route.keep")', self.src)
        self.assertIn('b.on("route.kept")', self.src)

    def test_registered(self):
        with open(os.path.join(HERE, "..", "..", "Sources", "SignBridge.swift")) as f:
            self.assertIn("KeptRoute.register(b)", f.read())


if __name__ == "__main__":
    unittest.main()
