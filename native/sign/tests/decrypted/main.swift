// Swift tests for F374's DecryptedIPA (native/sign/DecryptedIPA.swift), run on Linux by native/test_decrypted_ipa.py:
// the helper's lines, what stays out of a decrypted IPA, packing a fake .app with decrypted files in place, and
// Build IPA with Tweaks' copy (load commands added, tweak files in, an encrypted executable refused).
//   decryptedtest <scratch dir> [a real decrypted executable to inject into]
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

var failures = 0
var current = ""
func check(_ ok: Bool, _ what: @autoclosure () -> String, line: Int = #line) {
    if !ok { failures += 1; print("FAIL \(current) (line \(line)): \(what())") }
}
func test(_ name: String, _ body: () throws -> Void) {
    current = name
    let before = failures
    do { try body() } catch { failures += 1; print("FAIL \(name): threw \(error)") }
    print(failures == before ? "ok   \(name)" : "FAIL \(name)")
}

let scratch = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : NSTemporaryDirectory())
let fm = FileManager.default

func le32(_ v: UInt32) -> Data { var x = v.littleEndian; return Data(bytes: &x, count: 4) }

// A 64-bit arm64 Mach-O: the header, one LC_ENCRYPTION_INFO_64 (cryptid as given), then zeros up to `size` (room for
// more load commands: no segment says where its data starts).
func macho(cryptid: UInt32, size: Int = 0x4000) -> Data {
    var d = Data()
    for v: UInt32 in [0xFEEDFACF, 0x0100000C, 0, 2, 1, 24, 0, 0] { d.append(le32(v)) }
    for v: UInt32 in [0x2C, 24, 0x4000, 0x100, cryptid, 0] { d.append(le32(v)) }
    d.append(Data(count: size - d.count))
    return d
}

func plist(_ exe: String) -> Data {
    try! PropertyListSerialization.data(fromPropertyList: ["CFBundleIdentifier": "com.x.tube", "CFBundleExecutable": exe],
                                        format: .xml, options: 0)
}

func write(_ url: URL, _ d: Data) throws {
    try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try d.write(to: url)
}

func entries(_ url: URL) throws -> [String: (ZipEntry, Data)] {
    let z = try ZipReader(url: url)
    var out = [String: (ZipEntry, Data)]()
    for e in z.entries { out[e.name] = (e, e.isDirectory ? Data() : try z.data(e)) }
    return out
}

test("parse: the helper's App and Still encrypted lines") {
    let d = try DecryptedIPA.parse("App: /var/c/A1/Tube.app\nDecrypted Tube (12 KB)\nStill encrypted PlugIns/A.appex/A: Operation not permitted\n" +
                                   "Still encrypted Extensions/C R.appex/C R: Invalid argument\nDecrypted 1 of 3 Mach-O files, 2 still encrypted\n")
    check(d.app.path == "/var/c/A1/Tube.app", d.app.path)
    check(d.left == ["PlugIns/A.appex/A", "Extensions/C R.appex/C R"], "\(d.left)")
    var threw = false
    do { _ = try DecryptedIPA.parse("Decrypted Tube\n") } catch { threw = true }
    check(threw, "no App line: an error")
}

test("left out: SC_Info anywhere, every file of an extension still encrypted") {
    let left = ["PlugIns/A.appex/A", "Frameworks/K.framework/K"]
    check(DecryptedIPA.leftOut("SC_Info", left: []), "SC_Info")
    check(DecryptedIPA.leftOut("SC_Info/Tube.sinf", left: []), "SC_Info/Tube.sinf")
    check(DecryptedIPA.leftOut("PlugIns/B.appex/SC_Info/B.sinf", left: []), "an extension's SC_Info")
    check(DecryptedIPA.leftOut("PlugIns/A.appex", left: left), "the extension folder")
    check(DecryptedIPA.leftOut("PlugIns/A.appex/Info.plist", left: left), "its files")
    check(!DecryptedIPA.leftOut("PlugIns/AB.appex/Info.plist", left: left), "another extension")
    check(!DecryptedIPA.leftOut("PlugIns", left: left), "PlugIns itself")
    check(!DecryptedIPA.leftOut("Frameworks/K.framework/K", left: left), "a framework stays (it is said, not left out)")
    check(DecryptedIPA.leftOutExtensions(left + ["PlugIns/A.appex/Other"]) == ["PlugIns/A.appex"], "\(DecryptedIPA.leftOutExtensions(left))")
    check(DecryptedIPA.tweakedName("Tube 2.1 (decrypted).ipa") == "Tube 2.1 (tweaks)", DecryptedIPA.tweakedName("Tube 2.1 (decrypted).ipa"))
    check(DecryptedIPA.tweakedName("Tube 2.1 (decrypted) 2.ipa") == "Tube 2.1 (tweaks)", "a second copy's name")
    check(DecryptedIPA.tweakedName("Mine.ipa") == "Mine (tweaks)", "an IPA of the user's own")
}

let app = scratch.appendingPathComponent("box/Tube.app")
let drop = scratch.appendingPathComponent("drop")
let packed = scratch.appendingPathComponent("Tube (decrypted).ipa")

test("pack: Payload/<App>.app with the decrypted files in place, SC_Info and the encrypted extension left out") {
    try? fm.removeItem(at: scratch.appendingPathComponent("box"))
    try write(app.appendingPathComponent("Info.plist"), plist("TubeBin"))
    try write(app.appendingPathComponent("TubeBin"), macho(cryptid: 1))
    try write(app.appendingPathComponent("SC_Info/TubeBin.sinf"), Data("licence".utf8))
    try write(app.appendingPathComponent("PlugIns/A.appex/A"), macho(cryptid: 1))
    try write(app.appendingPathComponent("PlugIns/B.appex/B"), macho(cryptid: 1))
    try write(app.appendingPathComponent("Assets.car"), Data(repeating: 7, count: 5000))
    try fm.createSymbolicLink(atPath: app.appendingPathComponent("Current").path, withDestinationPath: "PlugIns")
    try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: app.appendingPathComponent("TubeBin").path)
    try write(drop.appendingPathComponent("TubeBin"), macho(cryptid: 0))
    try write(drop.appendingPathComponent("PlugIns/B.appex/B"), macho(cryptid: 0))
    var said = [String](), last = 0.0
    try DecryptedIPA.pack(app: app, decrypted: drop, left: ["PlugIns/A.appex/A"], to: packed, say: { said.append($0) },
                          progress: { last = $0 })
    check(said == ["Left out PlugIns/A.appex: still encrypted"], "\(said)")
    check(last == 1, "progress ends at 1: \(last)")
    let e = try entries(packed)
    let names = Set(e.keys)
    check(names.contains("Payload/Tube.app/Info.plist"), "Info.plist")
    check(e["Payload/Tube.app/TubeBin"]?.1 == macho(cryptid: 0), "the decrypted main executable")
    check(e["Payload/Tube.app/TubeBin"]?.0.unixMode == 0o100755, "its mode kept")
    check(e["Payload/Tube.app/PlugIns/B.appex/B"]?.1 == macho(cryptid: 0), "the decrypted extension")
    check(e["Payload/Tube.app/Assets.car"]?.1 == Data(repeating: 7, count: 5000), "the rest as it was")
    check(!names.contains { $0.contains("SC_Info") }, "no SC_Info")
    check(!names.contains { $0.contains("A.appex") }, "no A.appex: \(names.sorted())")
    check(e["Payload/Tube.app/Current"]?.0.isSymlink == true && e["Payload/Tube.app/Current"]?.1 == Data("PlugIns".utf8), "the link kept as a link")
}

test("withTweaks: the main executable gets the load commands, the tweak files go in, the rest is copied") {
    let t = TweakSet(files: [TweakFile(path: "Frameworks/Hook.dylib", data: macho(cryptid: 0, size: 64)),
                             TweakFile(path: "Hook.bundle/Info.plist", data: Data("<plist/>".utf8))],
                     inject: ["@rpath/Hook.dylib"], names: ["Hook.deb"])
    let out = scratch.appendingPathComponent("Tube (tweaks).ipa")
    let injected = try DecryptedIPA.withTweaks(packed, t, to: out)
    check(injected == ["@rpath/Hook.dylib"], "\(injected)")
    let e = try entries(out)
    let exe = e["Payload/Tube.app/TubeBin"]?.1 ?? Data()
    check(MachOEdit.dylibs(exe).contains("@rpath/Hook.dylib"), "\(MachOEdit.dylibs(exe))")
    check(MachOEdit.rpaths(exe).contains("@executable_path/Frameworks"), "\(MachOEdit.rpaths(exe))")
    check(e["Payload/Tube.app/Frameworks/Hook.dylib"]?.0.unixMode == 0o100755, "the dylib, executable")
    check(e["Payload/Tube.app/Hook.bundle/Info.plist"]?.0.unixMode == 0o100644, "a resource")
    check(e["Payload/Tube.app/Assets.car"]?.1 == Data(repeating: 7, count: 5000), "the rest as it was")
    check(e.count == (try entries(packed)).count + 2, "two entries more")
}

test("withTweaks refuses an IPA still encrypted, and one without its executable") {
    let enc = scratch.appendingPathComponent("enc.ipa")
    let w = try ZipWriter(url: enc)
    try w.add("Payload/Tube.app/Info.plist", plist("TubeBin"))
    try w.add("Payload/Tube.app/TubeBin", macho(cryptid: 1))
    w.close()
    let t = TweakSet(files: [TweakFile(path: "Frameworks/Hook.dylib", data: Data([1]))], inject: ["@rpath/Hook.dylib"], names: [])
    var code = ""
    do { _ = try DecryptedIPA.withTweaks(enc, t, to: scratch.appendingPathComponent("x.ipa")) } catch let e as SignError { code = e.code }
    check(code == "encrypted", code)
    let none = scratch.appendingPathComponent("none.ipa")
    let w2 = try ZipWriter(url: none)
    try w2.add("Payload/Tube.app/Info.plist", plist("Gone"))
    w2.close()
    code = ""
    do { _ = try DecryptedIPA.withTweaks(none, t, to: scratch.appendingPathComponent("y.ipa")) } catch let e as SignError { code = e.code }
    check(code == "bad_ipa", code)
}

// By hand (the F374 journal): a real decrypted executable pulled off the phone takes the load commands too.
if CommandLine.arguments.count > 2 {
    test("a real decrypted executable takes the load commands") {
        let real = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2]))
        check(!(try DecryptedIPA.encrypted(real)), "cryptid 0")
        let (out, added) = try MachOEdit.inject(real, ["@rpath/CydiaSubstrate.framework/CydiaSubstrate", "@rpath/Hook.dylib"])
        check(added.count == 2 && MachOEdit.dylibs(out).contains("@rpath/Hook.dylib"), "\(added)")
    }
}

print(failures == 0 ? "all passed" : "\(failures) failed")
exit(failures == 0 ? 0 : 1)
