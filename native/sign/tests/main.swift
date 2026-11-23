// Swift unit tests for the on-device signer (I6), run on Linux by native/test_sign.py: signs a fixture IPA with a
// throwaway certificate (key held by openssl here, by the Keychain on the phone) and checks the signature verifies,
// plus the pieces under it (hashes, DER entitlements, zip, profile rules, the local install CA).
//   signtest <fixtures dir> <work dir>
// Fixtures come from native/test_sign.py (native/testkit.py's throwaway CA, certificate and profiles).
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

let args = CommandLine.arguments
guard args.count == 3 else { print("usage: signtest <fixtures> <work>"); exit(2) }
let fixtures = URL(fileURLWithPath: args[1])
let work = URL(fileURLWithPath: args[2])
try? FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)

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
func hex(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined() }
func fixture(_ name: String) throws -> Data { try Data(contentsOf: fixtures.appendingPathComponent(name)) }

@discardableResult
func run(_ argv: [String], input: Data? = nil) throws -> (Int32, Data, String) {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    p.arguments = argv
    let out = Pipe(), err = Pipe(), inp = Pipe()
    p.standardOutput = out; p.standardError = err; p.standardInput = inp
    try p.run()
    if let input = input { inp.fileHandleForWriting.write(input) }
    inp.fileHandleForWriting.closeFile()
    let o = out.fileHandleForReading.readDataToEndOfFile()
    let e = err.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    return (p.terminationStatus, o, String(decoding: e, as: UTF8.self))
}

// The phone's Keychain identity, played by openssl: the private key stays in its PEM file.
struct OpenSSLIdentity: SigningIdentity {
    let keyPath: String
    let certificate: Data
    let chain: [Data]
    var signatureAlgorithm: String { "1.2.840.113549.1.1.1" }
    func sign(_ message: Data) throws -> Data {
        let (rc, sig, err) = try run(["openssl", "dgst", "-sha256", "-sign", keyPath], input: message)
        guard rc == 0 else { throw SignError("openssl", err) }
        return sig
    }
}

// ---- reading a signature back (independently of how CodeSign.swift wrote it, as far as the format allows)

struct ReadSignature {
    var cd = Data(), cms = Data(), ents = Data(), entsDER = Data(), reqs = Data()
    var identifier = "", team = "", codeLimit = 0, nSpecial = 0, nCode = 0, hashOff = 0, execFlags: UInt64 = 0
    func special(_ slot: Int) -> Data { cd.subdata(in: hashOff - slot * 32..<hashOff - slot * 32 + 32) }
}

func readSignature(_ bin: Data) -> ReadSignature? {
    guard bin.le32(at: 0) == MachO.magic64 else { return nil }
    var off = 32
    var sig: (Int, Int)? = nil
    for _ in 0..<Int(bin.le32(at: 16)) {
        if bin.le32(at: off) == 0x1D { sig = (Int(bin.le32(at: off + 8)), Int(bin.le32(at: off + 12))) }
        off += Int(bin.le32(at: off + 4))
    }
    guard let (so, ss) = sig, so + ss <= bin.count else { return nil }
    let sb = bin.subdata(in: so..<so + ss)
    guard sb.be32(at: 0) == 0xFADE0CC0 else { return nil }
    var r = ReadSignature()
    for i in 0..<Int(sb.be32(at: 8)) {
        let t = sb.be32(at: 12 + 8 * i), o = Int(sb.be32(at: 16 + 8 * i))
        let len = Int(sb.be32(at: o + 4))
        let b = sb.subdata(in: o..<o + len)
        switch t {
        case 0: r.cd = b
        case 2: r.reqs = b
        case 5: r.ents = b
        case 7: r.entsDER = b
        case 0x10000: r.cms = b.subdata(in: 8..<b.count)
        default: break
        }
    }
    let cd = r.cd
    r.hashOff = Int(cd.be32(at: 16))
    let identOff = Int(cd.be32(at: 20))
    r.nSpecial = Int(cd.be32(at: 24)); r.nCode = Int(cd.be32(at: 28)); r.codeLimit = Int(cd.be32(at: 32))
    r.identifier = String(decoding: cd[identOff...].prefix { $0 != 0 }, as: UTF8.self)
    let teamOff = Int(cd.be32(at: 48))
    if teamOff > 0 { r.team = String(decoding: cd[teamOff...].prefix { $0 != 0 }, as: UTF8.self) }
    r.execFlags = UInt64(cd.be32(at: 80)) << 32 | UInt64(cd.be32(at: 84))
    return r
}

func verifySigned(_ bin: Data, name: String, expectIdent: String, team: String, info: Data?, resources: Data?, ents: Bool) throws {
    guard let s = readSignature(bin) else { check(false, "\(name): no signature"); return }
    check(s.identifier == expectIdent, "\(name): identifier \(s.identifier) != \(expectIdent)")
    check(s.team == team, "\(name): team \(s.team)")
    var pagesOK = true
    for i in 0..<s.nCode {
        let page = bin.subdata(in: i * 4096..<min((i + 1) * 4096, s.codeLimit))
        if sha256(page) != s.cd.subdata(in: s.hashOff + i * 32..<s.hashOff + i * 32 + 32) { pagesOK = false }
    }
    check(pagesOK && s.nCode > 0, "\(name): code page hashes")
    if let info = info { check(s.special(1) == sha256(info), "\(name): Info.plist slot") }
    if let res = resources { check(s.special(3) == sha256(res), "\(name): CodeResources slot") }
    check(s.special(2) == sha256(s.reqs), "\(name): requirements slot")
    if ents {
        check(s.nSpecial == 7, "\(name): 7 special slots, got \(s.nSpecial)")
        check(s.special(5) == sha256(s.ents), "\(name): entitlements slot")
        check(s.special(7) == sha256(s.entsDER), "\(name): DER entitlements slot")
    }
    // The CMS signature over the CodeDirectory, checked by openssl (not by our own code).
    let d = work.appendingPathComponent("verify-\(name.replacingOccurrences(of: "/", with: "_"))")
    try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
    try s.cms.write(to: d.appendingPathComponent("cms.der"))
    try s.cd.write(to: d.appendingPathComponent("cd.bin"))
    let (rc, _, err) = try run(["openssl", "cms", "-verify", "-noverify", "-binary", "-inform", "DER", "-in", d.path + "/cms.der",
                                "-content", d.path + "/cd.bin", "-out", "/dev/null"])
    check(rc == 0, "\(name): openssl cms -verify: \(err)")
    let (rc2, _, err2) = try run(["openssl", "cms", "-verify", "-binary", "-inform", "DER", "-in", d.path + "/cms.der",
                                  "-content", d.path + "/cd.bin", "-CAfile", fixtures.path + "/ca.pem", "-purpose", "any",
                                  "-out", "/dev/null"])
    check(rc2 == 0, "\(name): chain to the test CA: \(err2)")
}

func entries(_ url: URL) throws -> [String: Data] {
    let z = try ZipReader(url: url)
    var out = [String: Data]()
    for e in z.entries where !e.isDirectory { out[e.name] = try z.data(e) }
    return out
}

let identity = OpenSSLIdentity(keyPath: fixtures.path + "/key.pem", certificate: try fixture("cert.der"),
                               chain: [try fixture("ca.der")])
let team = "TESTTEAM42"

test("sha1 and sha256 vectors") {
    check(hex(sha1(Data("abc".utf8))) == "a9993e364706816aba3e25717850c26c9cd0d89d", "sha1 abc")
    check(hex(sha256(Data("abc".utf8))) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "sha256 abc")
    var h = Hasher2()
    var left = 1_000_000
    var size = 1
    while left > 0 { let n = min(size, left); h.update(Data(repeating: 0x61, count: n)); left -= n; size = size * 3 + 7 }
    let (a, b) = h.final()
    check(hex(a) == "34aa973cd4c4daa4f61eeb2bdbad27316534016f", "sha1 million a")
    check(hex(b) == "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0", "sha256 million a")
}

test("DER entitlements") {
    let d = try EntitlementsDER.encode(["c": 5, "a": true, "b": ["x"]])
    check(hex(d) == "701f020101b01a30060c01610101ff30080c016230030c017830060c0163020105", "got \(hex(d))")
}

test("zip round trip") {
    let url = work.appendingPathComponent("rt.zip")
    let w = try ZipWriter(url: url)
    let big = Data((0..<300_000).map { UInt8($0 % 7) })
    try w.add("d/", Data(), mode: 0o40755)
    try w.add("d/big.bin", big)
    try w.add("d/empty", Data())
    try w.add("d/run", Data("#!/bin/sh\n".utf8), mode: 0o100755)
    w.close()
    let r = try ZipReader(url: url)
    check(r.entries.map(\.name) == ["d/", "d/big.bin", "d/empty", "d/run"], "names \(r.entries.map(\.name))")
    check(try r.data(r.entries[1]) == big, "big file")
    check(r.entries[1].compressedSize < 10_000, "deflated")
    check(r.entries[3].unixMode == 0o100755, "mode")
    let (rc, out, err) = try run(["python3", "-c", "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip())", url.path])
    check(rc == 0 && String(decoding: out, as: UTF8.self).hasPrefix("None"), "python reads it: \(err)")
}

test("profile rules") {
    let p = try Profile(try fixture("profile.mobileprovision"))
    check(p.team == team && p.appID == "*" && p.isWildcard && p.devices == 3, "fields \(p.team) \(p.appID) \(p.devices)")
    check(try p.bundleID(for: "dev.ifizbox.fixture") == "dev.ifizbox.fixture", "wildcard keeps the ID")
    check(p.problem(with: identity.certificate) == nil, "certificate is in the profile")
    check(p.problem(with: try fixture("other.der"))?.code == "cert_not_in_profile", "other certificate refused")
    let e = p.entitlements(for: "dev.ifizbox.fixture")
    check(e["application-identifier"] as? String == "\(team).dev.ifizbox.fixture", "application-identifier")
    check(e["keychain-access-groups"] as? [String] == ["\(team).dev.ifizbox.fixture"], "keychain group narrowed")
    check(e["get-task-allow"].flatMap(plistBool) == false, "never debuggable")
    let x = try Profile(try fixture("profile-explicit.mobileprovision"))
    let xid = try x.bundleID(for: "dev.ifizbox.fixture")
    check(!x.isWildcard && xid == "com.me.fixture", "explicit renames")
    let pre = try Profile(try fixture("profile-prefix.mobileprovision"))
    check(try pre.bundleID(for: "com.me.tool") == "com.me.tool", "prefix keeps a fitting ID")
    check(try pre.bundleID(for: "io.other.openmx") == "com.me.openmx", "prefix moves the last part")
    let old = try Profile(try fixture("profile-expired.mobileprovision"))
    check(old.problem(with: identity.certificate)?.code == "profile_expired", "expired profile")
    check((try? Profile(Data("not a profile".utf8))) == nil, "garbage refused")
}

test("sign a fixture IPA, wildcard profile") {
    let profile = try Profile(try fixture("profile.mobileprovision"))
    let signer = IPASigner(profile: profile, identity: identity)
    let out = work.appendingPathComponent("signed.ipa")
    var phases = Set<String>()
    let app = try signer.sign(fixtures.appendingPathComponent("rich.ipa"), to: out) { phase, _ in phases.insert(phase) }
    check(app.bundleID == "dev.ifizbox.fixture" && app.name == "Fixture" && app.version == "1.0", "\(app)")
    check(app.removed.isEmpty, "nothing removed: \(app.removed)")
    check(phases == ["reading", "signing"], "progress phases \(phases)")
    let f = try entries(out)
    let a = "Payload/Fixture.app/"
    check(f[a + "embedded.mobileprovision"] == profile.data, "embedded profile")
    check(f[a + "PlugIns/Share.appex/embedded.mobileprovision"] == profile.data, "extension's profile")
    check(f[a + "Frameworks/Kit.framework/embedded.mobileprovision"] == nil, "no profile in a framework")
    check(f[a + "_CodeSignature/CodeResources"] != nil && f[a + "OldStuff/_CodeSignature/CodeResources"] == nil, "old seal gone")
    check(f[a + "hello.txt"] == (try entries(fixtures.appendingPathComponent("rich.ipa")))[a + "hello.txt"], "resources untouched")
    // inner bundles first: the framework, the extension, then the app
    try verifySigned(f[a + "Frameworks/Kit.framework/Kit"]!, name: "Kit", expectIdent: "dev.ifizbox.kit", team: team,
                     info: f[a + "Frameworks/Kit.framework/Info.plist"], resources: f[a + "Frameworks/Kit.framework/_CodeSignature/CodeResources"], ents: false)
    try verifySigned(f[a + "Frameworks/libloose.dylib"]!, name: "libloose", expectIdent: "libloose", team: team, info: nil, resources: nil, ents: false)
    try verifySigned(f[a + "PlugIns/Share.appex/Share"]!, name: "Share", expectIdent: "dev.ifizbox.fixture.share", team: team,
                     info: f[a + "PlugIns/Share.appex/Info.plist"], resources: f[a + "PlugIns/Share.appex/_CodeSignature/CodeResources"], ents: true)
    try verifySigned(f[a + "Fixture"]!, name: "Fixture", expectIdent: "dev.ifizbox.fixture", team: team,
                     info: f[a + "Info.plist"], resources: f[a + "_CodeSignature/CodeResources"], ents: true)
    let main = readSignature(f[a + "Fixture"]!)!
    check(main.execFlags & 1 == 1, "main binary flag")
    let ents = try PropertyListSerialization.propertyList(from: main.ents.subdata(in: 8..<main.ents.count), format: nil) as? [String: Any]
    check(ents?["application-identifier"] as? String == "\(team).dev.ifizbox.fixture", "app entitlements")
    // CodeResources seals every file with its final hash, nested bundles' signed files included
    let cr = try PropertyListSerialization.propertyList(from: f[a + "_CodeSignature/CodeResources"]!, format: nil) as! [String: Any]
    let files2 = cr["files2"] as! [String: Any]
    let kit = files2["Frameworks/Kit.framework/Kit"] as? [String: Any]
    check(kit?["hash2"] as? Data == sha256(f[a + "Frameworks/Kit.framework/Kit"]!), "nested binary sealed after signing")
    check(files2["Info.plist"] == nil && files2["Fixture"] == nil, "Info.plist and the executable aren't in files2")
    check((files2["en.lproj/Localizable.strings"] as? [String: Any])?["optional"].flatMap(plistBool) == true, "lproj optional")
    check((files2["link.txt"] as? [String: Any])?["symlink"] as? String == "hello.txt", "symlink sealed as a link")
    let r = try ZipReader(url: out)
    check(r.entries.first { $0.name == a + "link.txt" }?.isSymlink == true, "symlink kept")
    check(r.entries.first { $0.name == a + "Fixture" }?.unixMode == 0o100755, "executable stays executable")
}

test("re-sign a signed IPA (the old LC_CODE_SIGNATURE is replaced)") {
    let profile = try Profile(try fixture("profile.mobileprovision"))
    let out = work.appendingPathComponent("resigned.ipa")
    _ = try IPASigner(profile: profile, identity: identity).sign(work.appendingPathComponent("signed.ipa"), to: out)
    let f = try entries(out)
    let a = "Payload/Fixture.app/"
    let before = try entries(work.appendingPathComponent("signed.ipa"))[a + "Fixture"]!
    check(f[a + "Fixture"]!.count == before.count, "same size: the signature is replaced, not added")
    try verifySigned(f[a + "Fixture"]!, name: "Fixture-resigned", expectIdent: "dev.ifizbox.fixture", team: team,
                     info: f[a + "Info.plist"], resources: f[a + "_CodeSignature/CodeResources"], ents: true)
}

test("sign with an explicit profile: renamed, extensions removed") {
    let profile = try Profile(try fixture("profile-explicit.mobileprovision"))
    let out = work.appendingPathComponent("signed-explicit.ipa")
    let old = IPASigner(profile: profile, identity: identity)
    old.options.keepBundleID = false // F237: the old way (Keep Bundle IDs off)
    let app = try old.sign(fixtures.appendingPathComponent("rich.ipa"), to: out)
    check(app.bundleID == "com.me.fixture" && app.originalBundleID == "dev.ifizbox.fixture", "\(app.bundleID)")
    check(app.removed == ["PlugIns/Share.appex"], "removed \(app.removed)")
    let f = try entries(out)
    let a = "Payload/Fixture.app/"
    check(!f.keys.contains { $0.contains("PlugIns/") }, "no PlugIns left")
    let info = try PropertyListSerialization.propertyList(from: f[a + "Info.plist"]!, format: nil) as? [String: Any]
    check(info?["CFBundleIdentifier"] as? String == "com.me.fixture", "Info.plist renamed")
    try verifySigned(f[a + "Fixture"]!, name: "Fixture-explicit", expectIdent: "com.me.fixture", team: team,
                     info: f[a + "Info.plist"], resources: f[a + "_CodeSignature/CodeResources"], ents: true)
}

// F237 (R25): Keep Bundle IDs, the default. Info.plist and every code signature's identifier keep the app's own IDs;
// the app and its extension carry the profile's App ID as application-identifier and keychain group.
test("sign with an explicit profile, bundle ID kept") {
    let profile = try Profile(try fixture("profile-explicit.mobileprovision"))
    let out = work.appendingPathComponent("signed-kept.ipa")
    let app = try IPASigner(profile: profile, identity: identity).sign(fixtures.appendingPathComponent("rich.ipa"), to: out)
    check(app.bundleID == "dev.ifizbox.fixture" && app.originalBundleID == "dev.ifizbox.fixture", "\(app.bundleID)")
    check(app.removed.isEmpty, "extensions kept: \(app.removed)")
    let f = try entries(out)
    let a = "Payload/Fixture.app/"
    let info = try PropertyListSerialization.propertyList(from: f[a + "Info.plist"]!, format: nil) as? [String: Any]
    check(info?["CFBundleIdentifier"] as? String == "dev.ifizbox.fixture", "Info.plist keeps its ID")
    let share = try PropertyListSerialization.propertyList(from: f[a + "PlugIns/Share.appex/Info.plist"]!, format: nil) as? [String: Any]
    check(share?["CFBundleIdentifier"] as? String == "dev.ifizbox.fixture.share", "the extension keeps its ID")
    try verifySigned(f[a + "Fixture"]!, name: "Fixture-kept", expectIdent: "dev.ifizbox.fixture", team: team,
                     info: f[a + "Info.plist"], resources: f[a + "_CodeSignature/CodeResources"], ents: true)
    try verifySigned(f[a + "PlugIns/Share.appex/Share"]!, name: "Share-kept", expectIdent: "dev.ifizbox.fixture.share", team: team,
                     info: f[a + "PlugIns/Share.appex/Info.plist"], resources: f[a + "PlugIns/Share.appex/_CodeSignature/CodeResources"], ents: true)
    for (bin, what) in [(a + "Fixture", "app"), (a + "PlugIns/Share.appex/Share", "extension")] {
        let s = readSignature(f[bin]!)!
        let e = try PropertyListSerialization.propertyList(from: s.ents.subdata(in: 8..<s.ents.count), format: nil) as? [String: Any]
        check(e?["application-identifier"] as? String == "\(team).com.me.fixture", "\(what): application-identifier \(String(describing: e?["application-identifier"]))")
        // B227: the app's own keychain group first (one App ID signs every app), the App ID's after
        check(e?["keychain-access-groups"] as? [String] == ["\(team).dev.ifizbox.fixture", "\(team).com.me.fixture"],
              "\(what): keychain group \(String(describing: e?["keychain-access-groups"]))")
        check(e?["get-task-allow"].flatMap(plistBool) == false, "\(what): not debuggable")
    }
    // a prefix wildcard narrows the App ID in the entitlements, Info.plist still keeps the app's
    let pre = try Profile(try fixture("profile-prefix.mobileprovision"))
    let ids = try pre.signingIDs(for: "io.other.openmx", keep: true)
    check(ids.bundleID == "io.other.openmx" && ids.entitlementsID == "com.me.openmx", "prefix kept \(ids)")
    check(try pre.signingIDs(for: "io.other.openmx", keep: false).bundleID == "com.me.openmx", "prefix old way")
}

// B138: an update keeps the application-identifier the app was installed with (installd's error 15 otherwise).
test("B138: the profile is picked from the installed App ID (wildcard vs explicit)") {
    let wild = try Profile(try fixture("profile.mobileprovision"))          // TEAM.*
    let explicit = try Profile(try fixture("profile-explicit.mobileprovision")) // TEAM.com.me.fixture
    let pre = try Profile(try fixture("profile-prefix.mobileprovision"))    // TEAM.com.me.*
    // what each profile can give
    check(AppIDMatch.entitlementsID(explicit, installed: "\(team).com.me.fixture") == "com.me.fixture", "explicit, its own ID")
    check(AppIDMatch.entitlementsID(explicit, installed: "\(team).com.me.*") == nil, "explicit can't give a wildcard")
    check(AppIDMatch.entitlementsID(pre, installed: "\(team).com.me.*") == "com.me.*", "prefix wildcard as written")
    check(AppIDMatch.entitlementsID(pre, installed: "\(team).com.me.youtube") == "com.me.youtube", "prefix covers it")
    check(AppIDMatch.entitlementsID(pre, installed: "\(team).io.other.app") == nil, "prefix doesn't cover it")
    check(AppIDMatch.entitlementsID(wild, installed: "\(team).io.other.app") == "io.other.app", "* covers any")
    check(AppIDMatch.entitlementsID(wild, installed: "OTHERTEAM.io.other.app") == nil, "another team")
    // the order is the preference; the first that fits signs
    check(AppIDMatch.pick([explicit, pre], installed: "\(team).com.me.*")?.profile.appID == "com.me.*", "wildcard picked")
    check(AppIDMatch.pick([explicit, pre], installed: "\(team).com.me.fixture")?.profile.appID == "com.me.fixture", "explicit picked")
    check(AppIDMatch.pick([explicit], installed: "\(team).com.me.*") == nil, "none fits")

    // the user's case: installed under the wildcard as written, the profile now explicit: stops before signing
    let out = work.appendingPathComponent("b138-stop.ipa")
    try? FileManager.default.removeItem(at: out)
    let s = IPASigner(profile: explicit, identity: identity)
    var asked = [String]()
    s.installedAppID = { asked.append($0); return "\(team).com.me.*" }
    do {
        _ = try s.sign(fixtures.appendingPathComponent("rich.ipa"), to: out)
        check(false, "signed although no profile gives the installed App ID")
    } catch let e as SignError {
        check(e.code == "appid_mismatch", "code \(e.code)")
        check(e.message.contains("\(team).com.me.*") && e.message.contains("\(team).com.me.fixture"), "names both: \(e.message)")
        check(e.message.contains("delete") && e.message.contains("data is lost"), "offers delete and reinstall: \(e.message)")
        check(!e.message.contains("UnknownErrorType"), "plain words")
    }
    check(asked == ["dev.ifizbox.fixture"], "asked by the bundle ID it installs as: \(asked)")
    check(!FileManager.default.fileExists(atPath: out.path), "nothing written")

    // the same App ID as installed: signs as before
    let same = IPASigner(profile: explicit, identity: identity)
    same.installedAppID = { _ in "\(team).com.me.fixture" }
    let a1 = try same.sign(fixtures.appendingPathComponent("rich.ipa"), to: out)
    check(a1.appID == "\(team).com.me.fixture", "appID \(String(describing: a1.appID))")

    // an own profile (autoProfile, explicit) would change it, the imported wildcard keeps it: the imported one signs,
    // with the wildcard App ID the app was installed with
    IPASigner.autoProfile = { _, _, _, _ in explicit }
    defer { IPASigner.autoProfile = nil }
    let back = IPASigner(profile: pre, identity: identity)
    back.installedAppID = { _ in "\(team).com.me.*" }
    let a2 = try back.sign(fixtures.appendingPathComponent("rich.ipa"), to: out)
    check(a2.appID == "\(team).com.me.*" && a2.bundleID == "dev.ifizbox.fixture", "\(String(describing: a2.appID)) \(a2.bundleID)")
    let f = try entries(out)
    check(f["Payload/Fixture.app/embedded.mobileprovision"] == pre.data, "the imported profile is embedded")
    let sig = readSignature(f["Payload/Fixture.app/Fixture"]!)!
    let e = try PropertyListSerialization.propertyList(from: sig.ents.subdata(in: 8..<sig.ents.count), format: nil) as? [String: Any]
    check(e?["application-identifier"] as? String == "\(team).com.me.*", "entitlements \(String(describing: e?["application-identifier"]))")

    // installd's raw refusal is recognised; other installd errors aren't taken for it
    check(AppIDMatch.isMismatch("install_failed: unknown error `MismatchedApplicationIdentifierEntitlement (x)` returned from device (15)"), "error 15")
    check(!AppIDMatch.isMismatch("install_failed: unknown error `ApplicationVerificationFailed` returned from device (15)"), "another 15")
}

test("an unsigned binary gets LC_CODE_SIGNATURE") {
    let bin = try fixture("unsigned.macho")
    let signed = try MachO.sign(bin, CodeSignParams(identifier: "x.y", team: team), identity)
    try verifySigned(signed, name: "unsigned", expectIdent: "x.y", team: team, info: nil, resources: nil, ents: false)
    let fat = try fixture("fat.macho")
    let sf = try MachO.sign(fat, CodeSignParams(identifier: "fat", team: team), identity)
    check(sf.be32(at: 0) == MachO.fatMagic && sf.be32(at: 4) == 1, "fat keeps only the arm64 slice")
    let off = Int(sf.be32(at: 16)), size = Int(sf.be32(at: 20))
    try verifySigned(sf.subdata(in: off..<off + size), name: "fat", expectIdent: "fat", team: team, info: nil, resources: nil, ents: false)
}

if let real = ProcessInfo.processInfo.environment["IFIZBOX_REAL_IPA"], FileManager.default.fileExists(atPath: real) {
    test("sign a real IPA (native/build/iFizBox.ipa)") {
        let profile = try Profile(try fixture("profile.mobileprovision"))
        let out = work.appendingPathComponent("real-signed.ipa")
        let app = try IPASigner(profile: profile, identity: identity).sign(URL(fileURLWithPath: real), to: out)
        check(app.bundleID == "com.ryha.ifizbox", "bundle id \(app.bundleID)")
        let f = try entries(out)
        let a = "Payload/iFizBox.app/"
        try verifySigned(f[a + "iFizBox"]!, name: "iFizBox", expectIdent: "com.ryha.ifizbox", team: team,
                         info: f[a + "Info.plist"], resources: f[a + "_CodeSignature/CodeResources"], ents: true)
    }
}

// R41: big binaries (over a megabyte) are signed on several threads, kept in files until the IPA is written and
// stored (level 0) or deflated in blocks; whatever the level or thread count, the IPA holds the same files.
test("R41: big binaries, every level and thread count give the same signed files") {
    let profile = try Profile(try fixture("profile.mobileprovision"))
    let a = "Payload/Fixture.app/"
    var first: [String: Data]? = nil
    for (level, readers) in [(Int32(1), 4), (0, 1), (6, 2), (0, 4)] {
        let signer = IPASigner(profile: profile, identity: identity)
        signer.time = Date(timeIntervalSince1970: 1_795_000_000) // the same CMS bytes every run
        signer.level = level
        signer.readers = readers
        let out = work.appendingPathComponent("big-\(level)-\(readers).ipa")
        var last = [String: Double]()
        var backwards = false
        _ = try signer.sign(fixtures.appendingPathComponent("rich-big.ipa"), to: out) { phase, f in
            if f < last[phase, default: 0] { backwards = true }
            last[phase] = f
        }
        check(!backwards, "level \(level), \(readers) readers: a phase's progress went backwards")
        check(last["reading"] == 1 && last["signing"] == 1, "level \(level): phases end at 1: \(last)")
        let parts = work.appendingPathComponent(".big-\(level)-\(readers).ipa.parts")
        check(!FileManager.default.fileExists(atPath: parts.path), "level \(level): the signed binaries' files are gone")
        let r = try ZipReader(url: out)
        for name in [a + "Fixture", a + "Frameworks/Kit.framework/Kit", a + "Frameworks/libloose.dylib"] {
            let e = r.entries.first { $0.name == name }
            check(e?.method == (level == 0 ? 0 : 8), "level \(level): \(name) method \(String(describing: e?.method))")
            check(e.map { $0.size > 1 << 20 } == true, "\(name) is a big one")
        }
        let f = try entries(out) // every entry read back with its CRC checked
        try verifySigned(f[a + "Fixture"]!, name: "big-\(level)", expectIdent: "dev.ifizbox.fixture", team: team,
                         info: f[a + "Info.plist"], resources: f[a + "_CodeSignature/CodeResources"], ents: true)
        try verifySigned(f[a + "Frameworks/libloose.dylib"]!, name: "big-loose-\(level)", expectIdent: "libloose", team: team,
                         info: nil, resources: nil, ents: false)
        let cr = try PropertyListSerialization.propertyList(from: f[a + "_CodeSignature/CodeResources"]!, format: nil) as! [String: Any]
        let files2 = cr["files2"] as! [String: Any]
        for rel in ["Frameworks/Kit.framework/Kit", "Frameworks/libloose.dylib"] {
            let sealed = files2[rel] as? [String: Any]
            check(sealed?["hash2"] as? Data == sha256(f[a + rel]!) && sealed?["hash"] as? Data == sha1(f[a + rel]!),
                  "level \(level): \(rel) sealed with its signed hashes")
        }
        if let first = first {
            // The rewritten Info.plist's key order isn't the same each time it's serialized (a Dictionary's), so it's
            // compared as a plist, and the app's binary and seal (which hold its hash) were verified above.
            let plist = { (d: Data?) in d.flatMap { try? PropertyListSerialization.propertyList(from: $0, format: nil) as? NSDictionary } }
            check(plist(f[a + "Info.plist"]) == plist(first[a + "Info.plist"]), "level \(level): Info.plist")
            let skip: Set<String> = [a + "Info.plist", a + "Fixture", a + "_CodeSignature/CodeResources"]
            let differ = Set(f.keys).union(first.keys).subtracting(skip).filter { f[$0] != first[$0] }.sorted()
            check(differ.isEmpty, "level \(level), \(readers) readers: not as the first run: \(differ)")
        }
        else { first = f }
    }
}

test("R41: deflateBlocks joins into one stream; Deflater pieces; ZipWriter adds files stored or packed") {
    var d = Data(count: 9 << 20 + 12345)
    d.withUnsafeMutableBytes { p in for i in 0..<p.count { p[i] = UInt8(truncatingIfNeeded: (i * 7) ^ (i >> 9)) } }
    for block in [1 << 20, 4 << 20, 16 << 20] {
        let z = try deflateBlocks(d, level: 1, block: block)
        let inf = try Inflater()
        var back = Data()
        try inf.feed(z) { back.append($0) }
        check(inf.done && back == d, "block \(block): inflates to the input")
    }
    let z = try Deflater(level: 6)
    var stream = Data()
    for k in stride(from: 0, to: d.count, by: 3 << 20) {
        try z.feed(d[k..<min(k + (3 << 20), d.count)], finish: false) { stream.append($0) }
    }
    try z.feed(Data(), finish: true) { stream.append($0) }
    let inf = try Inflater()
    var back = Data()
    try inf.feed(stream) { back.append($0) }
    check(back == d, "Deflater fed in pieces")
    let emptyStream = try deflateData(Data(), level: 1)
    check(emptyStream.count > 0, "an empty input still makes a stream")

    let raw = work.appendingPathComponent("r41-raw.bin"), packed = work.appendingPathComponent("r41-packed.bin")
    try d.write(to: raw)
    try deflateBlocks(d, level: 1).write(to: packed)
    let packedSize = UInt64(try Data(contentsOf: packed).count)
    let zipURL = work.appendingPathComponent("r41-files.zip")
    let w = try ZipWriter(url: zipURL)
    try w.add("stored.bin", file: raw, size: UInt64(d.count), crc: crc32Of(d))
    try w.add("packed.bin", file: packed, size: UInt64(d.count), crc: crc32Of(d), packed: packedSize)
    let empty = work.appendingPathComponent("r41-empty.bin")
    try Data().write(to: empty)
    try w.add("empty.bin", file: empty, size: 0, crc: 0)
    try w.add("small.txt", Data("hi".utf8), level: 0)
    w.close()
    let r = try ZipReader(url: zipURL)
    for e in r.entries {
        let got = try r.data(e)
        check(got == (e.name == "small.txt" ? Data("hi".utf8) : e.name == "empty.bin" ? Data() : d), e.name)
    }
    check(r.entries.map(\.method) == [0, 8, 0, 0], "methods \(r.entries.map(\.method))")
    let c = try r.clone()
    let cloned = try c.data(c.entries[1])
    check(cloned == d, "a clone reads on its own handle")
    let (rc, _, err) = try run(["unzip", "-tq", zipURL.path])
    check(rc == 0, "unzip -t: \(err)")
}

test("refusals") {
    let profile = try Profile(try fixture("profile.mobileprovision"))
    let signer = IPASigner(profile: profile, identity: identity)
    for (name, code) in [("notanipa.ipa", "bad_ipa"), ("escape.ipa", "bad_ipa"), ("encrypted.ipa", "encrypted")] {
        do {
            _ = try signer.sign(fixtures.appendingPathComponent(name), to: work.appendingPathComponent("x.ipa"))
            check(false, "\(name) signed")
        } catch let e as SignError { check(e.code == code, "\(name): \(e)") }
    }
}

test("B21: a nested bundle or framework without its executable is sealed as resources, not an error") {
    let profile = try Profile(try fixture("profile.mobileprovision"))
    let signer = IPASigner(profile: profile, identity: identity)
    var logged = [String]()
    signer.log = { logged.append($0) }
    let out = work.appendingPathComponent("missing-exe-signed.ipa")
    let app = try signer.sign(fixtures.appendingPathComponent("missing-exe.ipa"), to: out)
    check(app.skipped == ["Frameworks/Kit.framework", "YTUHD.bundle"], "skipped \(app.skipped)")
    check(logged.contains("Skipped YTUHD.bundle: its executable YTUHD is missing, sealed as resources"), "log \(logged)")
    check(logged.contains { $0.hasPrefix("Signed Tiny.app (") } && logged.contains { $0.hasPrefix("Read ") }, "console log \(logged)")
    let f = try entries(out)
    let a = "Payload/Tiny.app/"
    check(f[a + "YTUHD.bundle/_CodeSignature/CodeResources"] == nil && f[a + "YTUHD.bundle/YTUHD"] == nil, "nothing made in the bundle")
    check(f[a + "Frameworks/Kit.framework/_CodeSignature/CodeResources"] == nil, "no seal of its own in the framework")
    try verifySigned(f[a + "Tiny"]!, name: "Tiny-missing-exe", expectIdent: "com.ryha.ifizbox", team: team,
                     info: f[a + "Info.plist"], resources: f[a + "_CodeSignature/CodeResources"], ents: true)
    let cr = try PropertyListSerialization.propertyList(from: f[a + "_CodeSignature/CodeResources"]!, format: nil) as! [String: Any]
    let files2 = cr["files2"] as! [String: Any]
    for rel in ["YTUHD.bundle/Info.plist", "Frameworks/Kit.framework/Info.plist", "Frameworks/Kit.framework/kit.txt",
                "DontEatMyContent.bundle/Info.plist"] { // an empty CFBundleExecutable: a resource bundle (YouMod)
        check((files2[rel] as? [String: Any])?["hash2"] as? Data == sha256(f[a + rel]!), "\(rel) sealed by the app")
    }
    check((files2["YTUHD.bundle/en.lproj/Localizable.strings"] as? [String: Any])?["optional"].flatMap(plistBool) == true, "lproj in the bundle")
    // The app's own executable missing is still an error.
    do {
        _ = try signer.sign(fixtures.appendingPathComponent("noexe.ipa"), to: work.appendingPathComponent("x.ipa"))
        check(false, "an app without its executable signed")
    } catch let e as SignError { check(e.code == "bad_ipa" && "\(e)".contains("X is missing"), "\(e)") }
}

test("B162: a loose 32-bit-only Mach-O is sealed as a resource, not an error") {
    let profile = try Profile(try fixture("profile.mobileprovision"))
    let signer = IPASigner(profile: profile, identity: identity)
    var logged = [String]()
    signer.log = { logged.append($0) }
    let input = fixtures.appendingPathComponent("thin32.ipa")
    let out = work.appendingPathComponent("thin32-signed.ipa")
    let app = try signer.sign(input, to: out)
    check(app.skipped == ["modules/fat32_libretro_ios.dylib", "modules/old_libretro_ios.dylib"], "skipped \(app.skipped)")
    check(logged.contains("Skipped modules/old_libretro_ios.dylib: 32-bit only, iOS 15+ can't load it, sealed as a resource"), "log \(logged)")
    let f = try entries(out), orig = try entries(input)
    let a = "Payload/Fixture.app/"
    for rel in ["modules/old_libretro_ios.dylib", "modules/fat32_libretro_ios.dylib"] {
        check(f[a + rel] != nil && f[a + rel] == orig[a + rel], "\(rel) kept as it was")
    }
    try verifySigned(f[a + "modules/new_libretro_ios.dylib"]!, name: "new-core", expectIdent: "new_libretro_ios", team: team,
                     info: nil, resources: nil, ents: false)
    try verifySigned(f[a + "Fixture"]!, name: "Fixture-thin32", expectIdent: "dev.ifizbox.fixture", team: team,
                     info: f[a + "Info.plist"], resources: f[a + "_CodeSignature/CodeResources"], ents: true)
    let cr = try PropertyListSerialization.propertyList(from: f[a + "_CodeSignature/CodeResources"]!, format: nil) as! [String: Any]
    let files2 = cr["files2"] as! [String: Any]
    for rel in ["modules/old_libretro_ios.dylib", "modules/fat32_libretro_ios.dylib", "modules/new_libretro_ios.dylib"] {
        check((files2[rel] as? [String: Any])?["hash2"] as? Data == sha256(f[a + rel]!), "\(rel) sealed by the app")
    }
    let fat = try fixture("fat.macho"), thin = try fixture("unsigned.macho")
    check(MachO.has64BitCode(fat) && MachO.has64BitCode(thin), "64-bit code found")
    check(!MachO.has64BitCode(Data([0xCE, 0xFA, 0xED, 0xFE, 12, 0, 0, 0])), "thin armv7 has none")
}

test("HTTP requests and ranges") {
    check(try HTTPRequest.parse(Data("GET /a HTTP/1.1\r\nHost: x".utf8)) == nil, "incomplete header waits")
    let r = try HTTPRequest.parse(Data("GET /t/app.ipa?x=1 HTTP/1.1\r\nHost: 127.0.0.1\r\nRange: bytes=10-19\r\n\r\n".utf8))!
    check(r.method == "GET" && r.path == "/t/app.ipa", "\(r.method) \(r.path)")
    check(r.range(size: 100) == .some(10...19), "range a-b")
    let h = { (v: String) in HTTPRequest(method: "GET", path: "/", headers: ["range": v]) }
    check(h("bytes=90-").range(size: 100) == .some(90...99), "range a-")
    check(h("bytes=-5").range(size: 100) == .some(95...99), "suffix range")
    check(h("bytes=50-500").range(size: 100) == .some(50...99), "clamped")
    check(h("bytes=100-").range(size: 100) == nil, "past the end is unsatisfiable")
    check(HTTPRequest(method: "GET", path: "/", headers: [:]).range(size: 100) == .some(nil), "no range: everything")
    check((try? HTTPRequest.parse(Data("NONSENSE\r\n\r\n".utf8))) == nil, "bad request line refused")
    let head = String(decoding: HTTPResponse.head(206, [("Content-Length", "10")]), as: UTF8.self)
    check(head.hasPrefix("HTTP/1.1 206 Partial Content\r\n") && head.hasSuffix("\r\n\r\n"), head)
}

test("B29: the IPA counts as served only once every byte went out, over all requests") {
    // A 42.7 MB IPA as iOS's installer may fetch it: the zip's end first, then the whole file cut short and resumed.
    let size: UInt64 = 43_709_494
    var c = ByteCoverage()
    check(!c.covers(size: size) && c.count == 0, "nothing sent")
    c.add(size - 65_536...size - 1)
    check(!c.covers(size: size), "the end alone (it reaches the last byte) isn't the whole IPA")
    c.add(0...20_000_000)
    check(!c.covers(size: size) && c.ranges.count == 2, "a gap left: \(c.ranges)")
    c.add(20_000_001...size - 65_537)
    check(c.covers(size: size) && c.ranges == [0...size - 1], "touching ranges joined: \(c.ranges)")
    check(c.count == size, "each byte counted once: \(c.count)")
    var d = ByteCoverage()
    d.add(0...size - 1); d.add(100...200)
    check(d.covers(size: size) && d.count == size, "a repeat adds nothing")
    var e = ByteCoverage()
    e.add(10...19); e.add(0...4); e.add(5...9)
    check(e.ranges == [0...19] && e.covers(size: 20) && !e.covers(size: 21), "\(e.ranges)")
    check(ByteCoverage().covers(size: 0), "an empty file")
}

test("install server listener reuse (B128)") {
    let g: TimeInterval = 5
    // The user's iOS 27 log: the first app served, iFizBox suspended for minutes, the next queued app reused a
    // listener that still said ready while iOS had shut its socket: ECONNREFUSED. Idle means a fresh listener.
    check(ListenerStart.decide(has: true, ready: true, serving: false, sinceBeat: 0, gap: g) == .fresh, "idle ready listener")
    check(ListenerStart.decide(has: true, ready: false, serving: false, sinceBeat: 0, gap: g) == .fresh, "idle broken listener")
    check(ListenerStart.decide(has: false, ready: false, serving: true, sinceBeat: 0, gap: g) == .fresh, "no listener")
    check(ListenerStart.decide(has: true, ready: true, serving: true, sinceBeat: 1, gap: g) == .reuse, "serving, beating")
    check(ListenerStart.decide(has: true, ready: true, serving: true, sinceBeat: 300, gap: g) == .revive, "serving, frozen since")
    check(ListenerStart.decide(has: true, ready: false, serving: true, sinceBeat: 1, gap: g) == .revive, "serving, not ready")
}

test("manifest and itms link") {
    let m = try InstallManifest.manifest(ipaURL: "http://127.0.0.1:4242/t/app.ipa", bundleID: "dev.ifizbox.fixture", version: "1.0", title: "Fixture")
    let pl = try PropertyListSerialization.propertyList(from: m, format: nil) as? [String: Any]
    let item = (pl?["items"] as? [[String: Any]])?.first
    check(((item?["assets"] as? [[String: Any]])?.first?["url"] as? String) == "http://127.0.0.1:4242/t/app.ipa", "asset url")
    check((item?["metadata"] as? [String: Any])?["bundle-identifier"] as? String == "dev.ifizbox.fixture", "bundle id")
    check(InstallManifest.itmsURL(manifest: "https://ifizbox.com/sign/manifest?bundleid=a.b&port=4242")
          == "itms-services://?action=download-manifest&url=https%3A%2F%2Fifizbox.com%2Fsign%2Fmanifest%3Fbundleid%3Da.b%26port%3D4242", "itms link")
}

test("F77: My IPAs signs a local IPA file") {
    let A = "Payload/Fixture.app/"
    let lib = IPALibrary(root: work.appendingPathComponent("lib/Documents"), store: work.appendingPathComponent("lib/Store"))
    check(IPALibrary.safeName("https://x.test/dl/My%20App.IPA") == "My App.ipa", "safe name \(IPALibrary.safeName("https://x.test/dl/My%20App.IPA"))")
    check(IPALibrary.safeName("../../.hidden") == "hidden.ipa", "no folders, no dots: \(IPALibrary.safeName("../../.hidden"))")
    check(IPALibrary.safeName("") == "App.ipa", "empty")
    check(!IPALibrary.validName("../x.ipa") && !IPALibrary.validName(".x.ipa") && !IPALibrary.validName("x.zip") && IPALibrary.validName("A b.ipa"), "valid names")
    let a = try lib.add(fixtures.appendingPathComponent("rich.ipa"), name: "Rich.ipa", move: false)
    let b = try lib.add(fixtures.appendingPathComponent("notanipa.ipa"), name: "Rich.ipa", move: false)
    check(a == "Rich.ipa" && b == "Rich 2.ipa", "unique names \(a) \(b)")
    check(lib.files() == ["Rich.ipa", "Rich 2.ipa"], "files \(lib.files())")
    let d = try lib.details(a)
    check(d.name == "Fixture" && d.bundleID == "dev.ifizbox.fixture" && d.error == nil, "details \(d.name) \(d.bundleID) \(d.error ?? "")")
    check(!d.extensions.isEmpty, "extensions read")
    check(try lib.details(b).error != nil, "a zip that isn't an IPA is listed with an error")
    let cert = identity.certificate
    check(lib.signed(a, certificate: cert) == nil, "not signed yet")
    check(lib.json(a, certificate: cert)["signed"] is NSNull, "json: not signed")
    let profile = try Profile(try fixture("profile.mobileprovision"))
    let s = try lib.sign(a, signer: IPASigner(profile: profile, identity: identity), certificate: cert, expires: nil, work: work)
    check(s.bundleID == "dev.ifizbox.fixture", "signed as \(s.bundleID)")
    check(lib.signed(a, certificate: cert) != nil, "signed, ready to install")
    check(lib.signed(a, certificate: try fixture("other.der")) == nil, "another certificate: not signed")
    check(lib.signed(a, certificate: nil) == nil, "no certificate: not signed")
    let f = try entries(lib.signedURL(a))
    try verifySigned(f[A + "Fixture"]!, name: "Fixture", expectIdent: "dev.ifizbox.fixture", team: team,
                     info: f[A + "Info.plist"], resources: f[A + "_CodeSignature/CodeResources"], ents: true)
    check(try entries(lib.root.appendingPathComponent(a))[A + "_CodeSignature/CodeResources"] == Data("old seal".utf8), "the IPA itself stays as added")
    // New Sign Options: the signed copy no longer fits and goes.
    var o = SignOptions()
    o.name = "Renamed"
    try lib.setOptions(a, o)
    check(lib.signed(a, certificate: cert) == nil && !FileManager.default.fileExists(atPath: lib.signedURL(a).path), "options changed: re-sign")
    let s2 = try lib.sign(a, signer: IPASigner(profile: profile, identity: identity), certificate: cert,
                          expires: Date(timeIntervalSinceNow: 3600), work: work)
    check(s2.name == "Renamed" && lib.options(a).name == "Renamed", "signed with the options")
    check(lib.signed(a, certificate: cert, now: Date(timeIntervalSinceNow: 7200)) == nil, "expired: not signed")
    // The IPA replaced in Files: the copy doesn't fit.
    try FileManager.default.removeItem(at: lib.root.appendingPathComponent(a))
    try FileManager.default.copyItem(at: fixtures.appendingPathComponent("rich.ipa"), to: lib.root.appendingPathComponent(a))
    try FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSinceNow: 60)], ofItemAtPath: lib.root.appendingPathComponent(a).path)
    check(lib.signed(a, certificate: cert) == nil, "replaced IPA: not signed")
    try lib.delete(a)
    check(lib.files() == ["Rich 2.ipa"] && !FileManager.default.fileExists(atPath: lib.signedURL(a).path), "deleted with its copy")
    try FileManager.default.removeItem(at: lib.root.appendingPathComponent(b))
    lib.sweep()
    check(((try? FileManager.default.contentsOfDirectory(atPath: lib.store.path)) ?? ["x"]).isEmpty, "sweep clears leftovers")
}

// F243: an IPA without Sign Options follows the global Keep Bundle IDs (`keep`); one with them, its own switch.
test("F243: My IPAs' Sign follows Keep Bundle IDs") {
    let lib = IPALibrary(root: work.appendingPathComponent("lib243/Documents"), store: work.appendingPathComponent("lib243/Store"))
    let a = try lib.add(fixtures.appendingPathComponent("rich.ipa"), name: "Rich.ipa", move: false)
    let cert = identity.certificate
    check(!lib.hasOptions(a) && (lib.json(a, certificate: cert)["options"] as? [String: Any])?["keepBundleId"] is NSNull,
          "no Sign Options: keepBundleId null")
    check(lib.options(a, keep: nil).keepBundleID && !lib.options(a, keep: false).keepBundleID && lib.options(a, keep: true).keepBundleID,
          "no Sign Options: the global setting (absent: on)")
    let profile = try Profile(try fixture("profile.mobileprovision"))
    let s = try lib.sign(a, signer: IPASigner(profile: profile, identity: identity), certificate: cert, expires: nil, work: work, keep: false)
    check(s.options.keepBundleID == false, "signed the old way with the setting off")
    check(lib.signed(a, certificate: cert, keep: false) != nil, "counts while the setting stays off")
    check(lib.signed(a, certificate: cert) == nil && lib.signed(a, certificate: cert, keep: true) == nil, "setting on: not signed")
    check(lib.json(a, certificate: cert, keep: false)["signed"] is [String: Any], "json: signed with the setting off")
    // Saved Sign Options with the switch on: the setting no longer decides.
    var o = SignOptions()
    o.keepBundleID = true
    try lib.setOptions(a, o)
    check(lib.hasOptions(a) && lib.options(a, keep: false).keepBundleID, "Sign Options win over the setting")
    check(lib.signed(a, certificate: cert, keep: false) == nil, "the old-way copy no longer fits")
    check((lib.json(a, certificate: cert)["options"] as? [String: Any])?["keepBundleId"] as? Bool == true, "json: the saved switch")
    o.keepBundleID = false
    try lib.setOptions(a, o)
    check(!lib.options(a, keep: true).keepBundleID, "saved off stays off with the setting on")
    try lib.delete(a)
}

// B229: the IPA queue signs a My IPAs file into a copy of its own (SignAhead.swift); keepSigned makes it the file's
// signed copy when it was signed the way a sign here would, so the row reads Signed after that install.
test("B229: My IPAs keeps the queue's signed copy") {
    let lib = IPALibrary(root: work.appendingPathComponent("lib229/Documents"), store: work.appendingPathComponent("lib229/Store"))
    let a = try lib.add(fixtures.appendingPathComponent("rich.ipa"), name: "Rich.ipa", move: false)
    let cert = identity.certificate
    let profile = try Profile(try fixture("profile.mobileprovision"))
    let out = work.appendingPathComponent("b229-ahead.ipa")
    let signer = IPASigner(profile: profile, identity: identity)
    signer.options = lib.options(a, keep: nil)
    let app = try signer.sign(lib.root.appendingPathComponent(a), to: out)
    var other = SignOptions()
    other.name = "Elsewhere"
    check(try !lib.keepSigned(a, from: out, app: app, options: other, certificate: cert, signed: Date(), expires: nil),
          "other options: not kept")
    check(lib.signed(a, certificate: cert) == nil, "still not signed")
    check(try lib.keepSigned(a, from: out, app: app, options: signer.options, certificate: cert, signed: Date(), expires: nil),
          "its own options: kept")
    check(FileManager.default.fileExists(atPath: out.path), "the queue's copy stays where it is")
    let s = lib.signed(a, certificate: cert)
    check(s?.bundleID == app.bundleID, "signed as \(s?.bundleID ?? "nil")")
    check(lib.json(a, certificate: cert)["signed"] is [String: Any], "json: signed")
    check(try entries(lib.signedURL(a)) == entries(out), "the same IPA")
    check(lib.signed(a, certificate: cert, keep: false) == nil, "Keep Bundle IDs off: that copy doesn't count")
    check(try !lib.keepSigned(a, from: out, app: app, options: signer.options, certificate: cert, signed: Date(), expires: nil, keep: false),
          "signed with the setting on, kept with it off: not kept")
    try FileManager.default.removeItem(at: out)
    try lib.delete(a)
    lib.sweep()
    check(((try? FileManager.default.contentsOfDirectory(atPath: lib.store.path)) ?? ["x"]).isEmpty, "nothing left behind")
}

// F236: this iPhone in the profile (DeviceCheck.swift; core/signing.js deviceCheck is the same check).
test("device check") {
    func prof(_ extra: String) -> Data {
        Data(("junk<?xml version=\"1.0\" encoding=\"UTF-8\"?><plist version=\"1.0\"><dict><key>Name</key><string>T</string>"
            + extra + "</dict></plist>junk").utf8)
    }
    func devs(_ u: String...) -> String { "<key>ProvisionedDevices</key><array>" + u.map { "<string>\($0)</string>" }.joined() + "</array>" }
    let seven = "cb21a7f0caffd4807d41e713456f134cc958b076", other = "00008030-0011223344556677", new = "00008110-000A1B2C3D4E5F60"
    let two = prof(devs(seven, new))
    check(DeviceCheck.devices(profile: two).udids == [seven.uppercased(), new], "two devices read")
    check(DeviceCheck.check(profile: two, phone: .udid(seven)).state == .inProfile, "UDID in the profile")
    let out = DeviceCheck.check(profile: two, phone: .udid(other))
    check(out.state == .out && out.udid == other && out.count == 2, "UDID not in the profile")
    check(DeviceCheck.problem(out)?.code == "device_not_in_profile", "out is a problem")
    check(DeviceCheck.problem(out)?.message == DeviceCheck.notInText(other), "with the sentence")
    check(DeviceCheck.check(profile: two, phone: .candidates([seven, new])).state == .inProfile, "every candidate listed")
    check(DeviceCheck.check(profile: two, phone: .candidates([other])).state == .out, "no candidate listed")
    check(DeviceCheck.check(profile: two, phone: .candidates([seven, other])).state == .unknown, "some candidates listed")
    check(DeviceCheck.check(profile: two, phone: nil).state == .unknown, "no UDID")
    check(DeviceCheck.problem(DeviceCheck.check(profile: two, phone: nil)) == nil, "unknown isn't a problem")
    check(DeviceCheck.check(profile: prof("<key>ProvisionsAllDevices</key><true/>"), phone: .udid(other)).state == .skip, "all devices")
    check(DeviceCheck.check(profile: prof(""), phone: .udid(other)).state == .skip, "no device list")
    check(DeviceCheck.phone(fromEmbedded: prof(devs(seven))) == .udid(seven.uppercased()), "embedded: one device")
    check(DeviceCheck.phone(fromEmbedded: prof(devs(seven, new))) == .candidates([seven.uppercased(), new]), "embedded: a set")
    check(DeviceCheck.phone(fromEmbedded: prof("")) == nil, "embedded: no list")
}

// F288: tweaks prepared by the page (core/tweaks.js) go into the app and its executable loads them weakly. The signed
// IPA stays in work/tweaked.ipa for native/test_sign.py's own otool-style reading.
test("F288: tweak injection") {
    var dylib = try fixture("unsigned.macho")
    dylib.putLE32(6, at: 12) // MH_DYLIB
    let plist = try PropertyListSerialization.data(fromPropertyList: ["CFBundleExecutable": "TweakKit", "CFBundleIdentifier": "dev.tweak.kit",
                                                                      "CFBundlePackageType": "FMWK"], format: .xml, options: 0)
    let json: [String: Any] = [
        "files": [["path": "Frameworks/Fixture.dylib", "data": dylib.base64EncodedString()],
                  ["path": "Frameworks/TweakKit.framework/TweakKit", "data": dylib.base64EncodedString()],
                  ["path": "Frameworks/TweakKit.framework/Info.plist", "data": plist.base64EncodedString()],
                  ["path": "Fixture.bundle/Info.plist", "data": plist.base64EncodedString()]],
        "inject": ["@rpath/Fixture.dylib", "@rpath/TweakKit.framework/TweakKit"],
        "names": ["fixture.deb", "TweakKit.framework.zip"],
    ]
    let opts = try SignOptions(json: ["tweaks": json])
    check(opts.tweaks?.files.count == 4 && opts.tweaks?.names == ["fixture.deb", "TweakKit.framework.zip"], "parsed")
    check((try SignOptions(json: [:])).tweaks == nil, "none")
    for bad: [String: Any] in [["files": [["path": "../evil.dylib", "data": "AA=="]], "inject": []],
                               ["files": [["path": "Payload.dylib", "data": "AA=="]], "inject": []],
                               ["files": [["path": "Frameworks/A.dylib", "data": "AA=="]], "inject": ["@rpath/B.dylib"]],
                               ["files": [["path": "Frameworks/A.dylib", "data": "AA=="]], "inject": ["/usr/lib/A.dylib"]]] {
        do { _ = try SignOptions(json: ["tweaks": bad]); check(false, "accepted \(bad)") } catch let e as SignError { check(e.code == "bad_options", "\(e)") }
    }
    // the stored options (Re-sign, My IPAs) keep them
    let stored = try JSONDecoder().decode(SignedRecord.StoredOptions.self, from: try JSONEncoder().encode(opts.stored))
    check(SignOptions(stored).tweaks == opts.tweaks, "stored and read back")
    check(SignOptions().stored != opts.stored, "tweaks count in equality")

    // MachOEdit on its own: once, then not twice; the rpath once
    let exe = try fixture("unsigned.macho")
    let (once, added) = try MachOEdit.inject(exe, ["@rpath/A.dylib"])
    check(added == ["@rpath/A.dylib"] && once.count == exe.count, "added in place")
    check(MachOEdit.dylibs(once).last == "@rpath/A.dylib" && MachOEdit.rpaths(once) == [TweakSet.rpath], "\(MachOEdit.dylibs(once))")
    let (twice, again) = try MachOEdit.inject(once, ["@rpath/A.dylib"])
    check(again.isEmpty && twice == once, "nothing twice")
    let fat = try fixture("fat.macho")
    let (fatOut, _) = try MachOEdit.inject(fat, ["@rpath/A.dylib"])
    for (off, _) in MachOEdit.slices(fatOut) where fatOut.le32(at: off) == MachO.magic64 {
        check(try MachOEdit.commands(fatOut, at: off).contains { $0.cmd == MachOEdit.loadWeakDylib && $0.name == "@rpath/A.dylib" }, "every slice")
    }

    let profile = try Profile(try fixture("profile.mobileprovision"))
    let signer = IPASigner(profile: profile, identity: identity)
    signer.options = opts
    var logged = [String]()
    signer.log = { logged.append($0) }
    let out = work.appendingPathComponent("tweaked.ipa")
    let app = try signer.sign(fixtures.appendingPathComponent("rich.ipa"), to: out)
    check(app.injected == ["@rpath/Fixture.dylib", "@rpath/TweakKit.framework/TweakKit"], "\(app.injected)")
    check(logged.contains("Injected @rpath/Fixture.dylib") && logged.contains { $0.hasPrefix("Tweaks: fixture.deb, TweakKit.framework.zip") }, "\(logged)")
    let f = try entries(out)
    let a = "Payload/Fixture.app/"
    let main = f[a + "Fixture"]!
    check(MachOEdit.dylibs(main).suffix(2) == ["@rpath/Fixture.dylib", "@rpath/TweakKit.framework/TweakKit"], "\(MachOEdit.dylibs(main))")
    check(MachOEdit.rpaths(main).contains(TweakSet.rpath), "rpath")
    try verifySigned(main, name: "Fixture-tweaked", expectIdent: "dev.ifizbox.fixture", team: team,
                     info: f[a + "Info.plist"], resources: f[a + "_CodeSignature/CodeResources"], ents: true)
    try verifySigned(f[a + "Frameworks/Fixture.dylib"]!, name: "tweak", expectIdent: "Fixture", team: team, info: nil, resources: nil, ents: false)
    try verifySigned(f[a + "Frameworks/TweakKit.framework/TweakKit"]!, name: "TweakKit", expectIdent: "dev.tweak.kit", team: team,
                     info: f[a + "Frameworks/TweakKit.framework/Info.plist"],
                     resources: f[a + "Frameworks/TweakKit.framework/_CodeSignature/CodeResources"], ents: false)
    let cr = try PropertyListSerialization.propertyList(from: f[a + "_CodeSignature/CodeResources"]!, format: nil) as! [String: Any]
    let files2 = cr["files2"] as! [String: Any]
    for rel in ["Frameworks/Fixture.dylib", "Frameworks/TweakKit.framework/TweakKit", "Fixture.bundle/Info.plist"] {
        check((files2[rel] as? [String: Any])?["hash2"] as? Data == sha256(f[a + rel]!), "\(rel) sealed by the app")
    }
    let r = try ZipReader(url: out)
    check(r.entries.first { $0.name == a + "Frameworks/Fixture.dylib" }?.unixMode == 0o100755, "a tweak binary is executable")
}

// B211: an app whose original signature asks for app groups and keychain groups the profile can't give gets the group
// fix (the committed web/app/vendor/groupfix dylib) and its config; iFizBox's own IPA never.
test("B211: group fix") {
    let insta: [String: Any] = ["application-identifier": "OLDTEAM.com.burbn.instagram",
                                "com.apple.security.application-groups": ["group.com.burbn.instagram"],
                                "keychain-access-groups": ["OLDTEAM.com.burbn.instagram"]]
    let mine = ["com.apple.security.application-groups": ["group.com.me.box"]]
    // B227: to the app's own folder whatever the profile has; the older rule's group (the profile's first) as legacy
    check(GroupFix.plan(original: insta, profile: mine) == GroupFix.Plan(groups: ["group.com.burbn.instagram"], target: "", keychain: true,
                                                                         legacy: "group.com.me.box"), "to the app's own folder, legacy copied")
    let was = try PropertyListSerialization.data(fromPropertyList: ["groups": ["group.com.burbn.instagram"], "target": "group.com.me.box", "keychain": true],
                                                 format: .xml, options: 0)
    check(GroupFix.plan(original: insta, profile: mine, previous: was)?.target == "group.com.me.box", "an earlier sign's profile group stays")
    check(GroupFix.plan(original: insta, profile: ["com.apple.security.application-groups": ["group.other"]], previous: was)?.lost == "group.com.me.box",
          "a profile without it: reported lost")
    check(Profile.keychainGroups(["T.*", "com.apple.token"], team: "T", bundleID: "com.me.sideload", keptID: "com.burbn.instagram")
          == ["T.com.burbn.instagram", "T.com.me.sideload"], "keychain group named after the kept ID")
    check(Profile.keychainGroups(["T.com.me.*"], team: "T", bundleID: "com.me.sideload", keptID: "com.burbn.instagram") == ["T.com.me.sideload"],
          "a kept ID the profile's groups don't allow: as before")
    check(GroupFix.plan(original: insta, profile: [:]) == GroupFix.Plan(groups: ["group.com.burbn.instagram"], target: "", keychain: true), "to the app's own folder")
    check(GroupFix.plan(original: insta, profile: ["com.apple.security.application-groups": ["group.com.burbn.instagram"]])?.groups == [], "a group the profile has stays")
    check(GroupFix.plan(original: ["application-identifier": "OLD.x"], profile: mine) == nil, "nothing to fix")
    check(GroupFix.plan(original: nil, profile: mine) == nil, "unsigned")
    // B327: the sign log names the whole config, or why there is none
    check(GroupFix.logLine(GroupFix.plan(original: insta, profile: mine))
          == "Group fix: group.com.burbn.instagram -> the app's own folder; keychain groups stripped; group.com.me.box copied in once if the app ran before",
          "\(GroupFix.logLine(GroupFix.plan(original: insta, profile: mine)))")
    check(GroupFix.logLine(nil) == "Group fix: none (the original signature names no app groups or keychain groups)", "no fix")
    check(Profile.keychainLine(["application-identifier": "T.com.me.sideload", "keychain-access-groups": ["T.com.burbn.instagram", "T.com.me.sideload"]])
          == "Keychain: T.com.burbn.instagram, T.com.me.sideload (application-identifier T.com.me.sideload)", "keychain line")
    check(Profile.keychainLine([:]) == "Keychain: no keychain groups (application-identifier none)", "empty keychain line")
    let prev = try GroupFix.adding(GroupFix.plan(original: insta, profile: [:])!, dylib: Data(), to: nil).files[1].data
    check(GroupFix.plan(original: ["keychain-access-groups": ["T.x"]], profile: mine, previous: prev)?.groups == ["group.com.burbn.instagram"],
          "signed again: the earlier config's groups still count")
    let p = try Profile(try fixture("profile.mobileprovision"))
    let narrowed = p.entitlements(for: "com.burbn.instagram")
    check(p.entitlements.keys.allSatisfy { narrowed[$0] != nil }, "every profile entitlement (its app groups too) stays")

    let dylib = try Data(contentsOf: URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("../../../web/app/vendor/groupfix/ifizbox-groupfix.dylib"))
    GroupFix.dylib = { dylib }
    defer { GroupFix.dylib = { nil } }
    // rich.ipa with its executable signed by "the App Store" with Instagram's groups (and, for the second, iFizBox's ID)
    func ipa(_ name: String, id: String?) throws -> URL {
        let src = try ZipReader(url: fixtures.appendingPathComponent("rich.ipa"))
        let url = work.appendingPathComponent(name)
        let w = try ZipWriter(url: url)
        for e in src.entries {
            var d = try src.data(e)
            if e.name == "Payload/Fixture.app/Fixture" {
                d = try MachO.sign(d, CodeSignParams(identifier: "com.burbn.instagram", team: "OLDTEAM", entitlements: insta), identity)
            } else if e.name == "Payload/Fixture.app/Info.plist", let id = id {
                var pl = try PropertyListSerialization.propertyList(from: d, format: nil) as! [String: Any]
                pl["CFBundleIdentifier"] = id
                d = try PropertyListSerialization.data(fromPropertyList: pl, format: .xml, options: 0)
            }
            try w.add(e.name, d, mode: e.unixMode)
        }
        w.close()
        return url
    }
    let signer = IPASigner(profile: p, identity: identity)
    var logged = [String]()
    signer.log = { logged.append($0) }
    let out = work.appendingPathComponent("groupfix.ipa")
    let app = try signer.sign(try ipa("insta.ipa", id: nil), to: out)
    check(app.injected == [GroupFix.inject], "\(app.injected)")
    check(logged.contains("Group fix: group.com.burbn.instagram -> the app's own folder; keychain groups stripped"), "\(logged)")
    // B327: every sign logs the keychain groups (in order) and the application-identifier it signed with
    check(logged.contains("Keychain: \(team).\(app.bundleID) (application-identifier \(app.appID ?? ""))"), "\(logged)")
    let f = try entries(out)
    let a = "Payload/Fixture.app/"
    check(MachOEdit.dylibs(f[a + "Fixture"]!).last == GroupFix.inject, "\(MachOEdit.dylibs(f[a + "Fixture"]!))")
    try verifySigned(f[a + GroupFix.dylibPath]!, name: "groupfix", expectIdent: "ifizbox-groupfix", team: team, info: nil, resources: nil, ents: false)
    let config = try PropertyListSerialization.propertyList(from: f[a + GroupFix.configPath]!, format: nil) as? [String: Any]
    check(config?["groups"] as? [String] == ["group.com.burbn.instagram"] && config?["target"] as? String == "" && config?["keychain"] as? Bool == true, "\(String(describing: config))")
    check(signer.options.tweaks == nil, "the user's options stay without it")

    let ownSigner = IPASigner(profile: p, identity: identity)
    var ownLogged = [String]()
    ownSigner.log = { ownLogged.append($0) }
    let own = try ownSigner.sign(try ipa("own.ipa", id: SignOptions.selfBundleID), to: work.appendingPathComponent("own-signed.ipa"))
    check(own.injected.isEmpty, "iFizBox's own IPA: \(own.injected)")
    check(ownLogged.contains("Group fix: none (\(Brand.name)'s own IPA)"), "B327: why no fix: \(ownLogged)")
    // B259: the stamp names the dylib the app got; another dylib build makes only such apps stale
    check(app.groupFix == SignerStamp.hash(dylib) && app.stamp == SignerStamp.now && !app.stamp.isStale(), "stamp \(app.stamp)")
    check(own.groupFix == nil && own.stamp.groupFix == nil, "no fix, no hash")
    let other = SignerStamp(version: SignerStamp.version, groupFix: SignerStamp.hash(Data([1])))
    check(app.stamp.isStale(against: other) && !own.stamp.isStale(against: other), "a new dylib: only apps with the fix")
}

// B259: Needs Re-sign's signer stamp on records and My IPAs' signed copies
test("B259: signer stamp") {
    let cur = SignerStamp.now
    check(cur.version == SignerStamp.version && cur.groupFix == nil, "no bundled dylib here: \(cur)")
    check(SignerStamp(version: SignerStamp.version - 1, groupFix: nil).isStale(), "an earlier version")
    check(!SignerStamp(version: SignerStamp.version, groupFix: "abc").isStale(against: cur), "no current dylib: the hash can't tell")
    check(SignerStamp.hash(Data("x".utf8)).count == 16, "16 hex digits")
    var o = SignOptions()
    o.name = "D"
    var r = SignedRecord(bundleID: "a", originalBundleID: "a", name: "A", version: "1", url: "https://x/a.ipa",
                         signed: Date(timeIntervalSince1970: 0), expires: nil, options: o.stored, signer: cur)
    let back = SignedRecords.decode(try SignedRecords.encode([r]))
    check(back.first?.signer == cur, "kept in the record")
    let j = r.json["signer"] as? [String: Any]
    check(j?["version"] as? Int == SignerStamp.version && j?["groupFix"] is NSNull && JSONSerialization.isValidJSONObject(r.json), "json \(String(describing: j))")
    r.signer = nil
    check(r.json["signer"] == nil, "no stamp: left out (needsResign lists it)")
    // 0.18.0's record shape decodes with no stamp
    let old = SignedRecords.decode(Data(#"[{"bundleID":"a","originalBundleID":"a","name":"A","version":"1","url":"u","signed":"2026-11-17T00:00:00Z","options":{"removeExtensions":[],"fixArm64e":true}}]"#.utf8))
    check(old.count == 1 && old[0].signer == nil, "old record: no stamp")

    // My IPAs: a signed copy from before stamps (or an older stamp) is signed again, not installed as it is
    let lib = IPALibrary(root: work.appendingPathComponent("lib259/Documents"), store: work.appendingPathComponent("lib259/Store"))
    let a = try lib.add(fixtures.appendingPathComponent("rich.ipa"), name: "Rich.ipa", move: false)
    let profile = try Profile(try fixture("profile.mobileprovision"))
    let s = try lib.sign(a, signer: IPASigner(profile: profile, identity: identity), certificate: identity.certificate, expires: nil, work: work)
    check(s.signer == cur && lib.signed(a, certificate: identity.certificate)?.signer == cur, "the copy keeps its stamp")
    let sidePath = lib.store.appendingPathComponent(a + ".signed.json")
    if var dict = (try? JSONSerialization.jsonObject(with: Data(contentsOf: sidePath))) as? [String: Any] {
        dict["signer"] = nil
        try JSONSerialization.data(withJSONObject: dict).write(to: sidePath)
        check(lib.signed(a, certificate: identity.certificate) == nil, "a copy with no stamp: sign it again")
    } else { check(false, "signed side file not found at \(sidePath.path)") }
    try lib.delete(a)
}

// F329a: the Lite app re-signs itself with your own icon: an IPA made from the installed bundle (SelfIPA), the own-icon
// sets' files replaced (SignOptions.ownIconFiles), Info.plist and its CFBundleAlternateIcons as they were.
test("F329a: an IPA of the running bundle, own-icon files replaced, alternate icons kept") {
    let app = work.appendingPathComponent("selfapp/Fixture.app")
    try? FileManager.default.removeItem(at: app.deletingLastPathComponent())
    let z = try ZipReader(url: fixtures.appendingPathComponent("rich.ipa"))
    let a = "Payload/Fixture.app/"
    for e in z.entries where e.name.hasPrefix(a) && !e.isDirectory {
        let u = app.appendingPathComponent(String(e.name.dropFirst(a.count)))
        try FileManager.default.createDirectory(at: u.deletingLastPathComponent(), withIntermediateDirectories: true)
        try z.data(e).write(to: u)
        try FileManager.default.setAttributes([.posixPermissions: NSNumber(value: Int(e.unixMode & 0o777))], ofItemAtPath: u.path)
    }
    // Info.plist's own-icon set, as icon/alternates.py writes it, and its placeholder PNG
    let infoURL = app.appendingPathComponent("Info.plist")
    var info = try PropertyListSerialization.propertyList(from: try Data(contentsOf: infoURL), format: nil) as! [String: Any]
    let alternates: [String: Any] = ["Icon-owna": ["CFBundleIconFiles": ["IconOwnA60x60"]],
                                     "Icon-classic": ["CFBundleIconName": "Icon-classic"]]
    info["CFBundleIcons"] = ["CFBundlePrimaryIcon": ["CFBundleIconName": "AppIcon"], "CFBundleAlternateIcons": alternates]
    try PropertyListSerialization.data(fromPropertyList: info, format: .binary, options: 0).write(to: infoURL)
    let png = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    try (png + Data("placeholder".utf8)).write(to: app.appendingPathComponent("IconOwnA60x60@2x.png"))
    try FileManager.default.createSymbolicLink(atPath: app.appendingPathComponent("Link.png").path, withDestinationPath: "IconOwnA60x60@2x.png")

    let src = work.appendingPathComponent("self-src.ipa")
    try SelfIPA.make(app: app, to: src)
    let made = try ZipReader(url: src)
    check(made.entries.contains { $0.name == a + "Info.plist" }, "Info.plist in Payload/Fixture.app/")
    check(made.entries.first { $0.name == a + "Fixture" }.map { $0.unixMode & 0o111 != 0 } == true, "the executable keeps its x bit")
    check(made.entries.first { $0.name == a + "Link.png" }?.isSymlink == true, "a symlink stays one")
    do { try SelfIPA.make(app: app.deletingLastPathComponent(), to: work.appendingPathComponent("x.ipa")); check(false, "a folder that isn't an app") }
    catch let e as SignError { check(e.code == "bad_app", "\(e)") }

    let picture = png + Data("your own icon".utf8)
    let signer = IPASigner(profile: try Profile(try fixture("profile.mobileprovision")), identity: identity)
    signer.options.ownIconFiles = ["IconOwnA60x60@2x.png": picture, "IconOwnA60x60@3x.png": picture,
                                   "Info.plist": picture, "IconOwnB20x20@2x.png": Data("not a png".utf8)]
    check(signer.options.ownIconFiles.keys.sorted() == ["IconOwnA60x60@2x.png", "IconOwnA60x60@3x.png"],
          "only own-set PNGs: \(signer.options.ownIconFiles.keys.sorted())")
    let out = work.appendingPathComponent("self-signed.ipa")
    _ = try signer.sign(src, to: out)
    let f = try entries(out)
    check(f[a + "IconOwnA60x60@2x.png"] == picture && f[a + "IconOwnA60x60@3x.png"] == picture, "the picture replaced the placeholder")
    let signedInfo = try PropertyListSerialization.propertyList(from: f[a + "Info.plist"]!, format: nil) as? [String: Any]
    let icons = signedInfo?["CFBundleIcons"] as? [String: Any]
    check((icons?["CFBundleAlternateIcons"] as? NSDictionary)?.isEqual(to: alternates) == true, "alternate icons kept: \(String(describing: icons))")
    let res = try PropertyListSerialization.propertyList(from: f[a + "_CodeSignature/CodeResources"]!, format: nil) as? [String: Any]
    let sealed = (res?["files2"] as? [String: Any])?["IconOwnA60x60@3x.png"] as? [String: Any]
    check(sealed?["hash2"] as? Data == sha256(picture), "CodeResources seals the new picture")
    try verifySigned(f[a + "Fixture"]!, name: "Fixture-self", expectIdent: "dev.ifizbox.fixture", team: team,
                     info: f[a + "Info.plist"], resources: f[a + "_CodeSignature/CodeResources"], ents: true)
    check(SignOptions(SignOptions().stored).ownIconFiles.isEmpty, "not stored")
}

print(failures == 0 ? "all passed" : "\(failures) failure(s)")
exit(failures == 0 ? 0 : 1)
