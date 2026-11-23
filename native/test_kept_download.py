"""F380: a custom install keeps its own download in My IPAs (keepInLibrary). The library side (IPALibrary.hold / keep,
native/sign/KeptDownload.swift) is tested in native/sign/tests/main.swift; the shell can't run off the phone, so its
wiring (SignAhead.swift's signing.prepare / signing.open, Apt.swift's ipa.install) is read from the source."""
import os
import unittest

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Sources")


def read(name):
    with open(os.path.join(SRC, name)) as f:
        return f.read()


def body(src, start):
    i = src.index(start)
    return src[i:src.index("\n    }\n", i)]


class SignAheadKeeps(unittest.TestCase):
    def test_prepare_holds_the_url_download_before_signing(self):
        prep = body(read("SignAhead.swift"), "static func prepare(")
        self.assertIn("let keepIt = record == nil && MyIPAs.wantsKeep(c)", prep)  # not a Re-sign's download
        dl = prep[prep.index("let d = Sideload.download("):]
        self.assertIn("signHeld(file, keepIt ? IPALibrary.hold(file, in: SignBridge.work", dl)
        # the held name rides with the kept IPA, and goes when signing fails
        self.assertIn("kept[tok] = Kept(output: output, app: app, record: record, mine: mine)", prep)
        self.assertIn("} catch { return unsigned(error) }", prep)
        self.assertIn("if let m = mine { try? FileManager.default.removeItem(at: m) }", prep)
        # the other sources (iFizBox itself, a My IPAs file, a kept original) hold nothing
        self.assertIn("let signThat = { (file: URL) in signHeld(file, nil) }", prep)

    def test_open_moves_it_into_my_ipas_and_replies_its_name(self):
        src = read("SignAhead.swift")
        op = body(src, "static func open(")
        ok = op[op.index("case .success(let (app, rec)):"):]
        self.assertIn("MyIPAs.keepDownload(m, url: u, log: log)", ok)
        self.assertIn('out["libraryFile"] = f', ok)
        fail = op[op.index("case .failure(let e):"):op.index("case .success(let (app, rec)):")]
        self.assertIn("if let m = k.mine { try? FileManager.default.removeItem(at: m) }", fail)
        self.assertIn("mine: k.mine) // F380", op)  # B337's spare keeps it for the Fallback
        self.assertIn("if let m = k.mine { try? FileManager.default.removeItem(at: m) }", body(src, "private static func forget("))


class IPAInstallKeeps(unittest.TestCase):
    def test_ipa_install_moves_the_download_after_the_helper(self):
        apt = read("Apt.swift")
        self.assertIn("keep: MyIPAs.wantsKeep(c)", apt)
        run = body(apt, "static func run(_ url: URL")
        ok = run[run.index("if code == 0 {"):]
        self.assertIn("if keep, let f = SignBridge.queue.sync(execute: { MyIPAs.keepDownload(URL(fileURLWithPath: path), url: url) })", ok)
        self.assertIn('ok["libraryFile"] = f', ok)
        # never a hard link here: the helper refuses an IPA with more than one link
        self.assertNotIn("IPALibrary.hold", apt)


if __name__ == "__main__":
    unittest.main()
