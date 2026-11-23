"""B340: My IPAs' sign (MyIPAs.signIfNeeded, behind library.sign and library.install) keeps the installed app's App ID
as SignAhead.sign (B280) and Sideload.signAndOpen (B138) do: an IPA whose installed copy has another App ID (a
com.you.* profile's) is signed for that one, or stopped before signing, instead of iOS refusing it (installd error 15).
The signer's side (installedAppID -> AppIDMatch) is tested in native/sign/tests/main.swift; the shell can't run off
the phone, so read the source."""
import os
import unittest

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Sources")


def read(name):
    with open(os.path.join(SRC, name)) as f:
        return f.read()


def body(src, start):
    i = src.index(start)
    return src[i:src.index("\n    }\n", i)]


class MyIPAsAppID(unittest.TestCase):
    def test_sign_asks_for_the_installed_app_id(self):
        sign = body(read("MyIPAs.swift"), "static func signIfNeeded(")
        ask = sign.index("signer.installedAppID = { Sideload.installedAppID($0, log: log) }")
        self.assertGreater(ask, sign.index("let signer = IPASigner("))
        self.assertLess(ask, sign.index("try library.sign(file, signer: signer"))

    def test_sign_and_install_forward_the_sign_log(self):
        # Both logged runs (core/signing.js SIDELOAD_RUNS) get the sign's lines: Keychain:/Group fix: and the App ID asked
        src = read("MyIPAs.swift")
        sign = src[src.index('b.on("library.sign")'):src.index('b.on("library.install")')]
        install = body(src, "static func install(")
        for call in (sign, install):
            self.assertIn("log: { c.emitOnMain([[\"log\": $0]]) }", call)


if __name__ == "__main__":
    unittest.main()
