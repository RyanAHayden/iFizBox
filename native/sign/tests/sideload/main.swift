// Swift tests for F14's parts of the on-device signer, run on Linux by native/test_sideload.py: profile kinds, the
// user's edits while signing (name, bundle ID across extensions, icon, extensions left out), the arm64e fix-up,
// the IPA inspector, OCSP, the re-sign reminder and the record of signed apps.
//   sideloadtest <fixtures dir> <work dir>
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

let args = CommandLine.arguments
guard args.count == 3 else { print("usage: sideloadtest <fixtures> <work>"); exit(2) }
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
func fixture(_ name: String) throws -> Data { try Data(contentsOf: fixtures.appendingPathComponent(name)) }
func throwsCode(_ code: String, _ f: () throws -> Void) -> Bool {
    do { try f(); return false } catch let e as SignError { return e.code == code } catch { return false }
}

// openssl holds the key, as in native/sign/tests/main.swift.
struct OpenSSLIdentity: SigningIdentity {
    let keyPath: String
    let certificate: Data
    let chain: [Data]
    var signatureAlgorithm: String { "1.2.840.113549.1.1.1" }
    func sign(_ message: Data) throws -> Data {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        p.arguments = ["openssl", "dgst", "-sha256", "-sign", keyPath]
        let out = Pipe(), inp = Pipe()
        p.standardOutput = out; p.standardInput = inp
        try p.run()
        inp.fileHandleForWriting.write(message)
        inp.fileHandleForWriting.closeFile()
        let sig = out.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        guard p.terminationStatus == 0 else { throw SignError("openssl", "dgst failed") }
        return sig
    }
}

let cert = try fixture("cert.der")
let identity = OpenSSLIdentity(keyPath: fixtures.path + "/key.pem", certificate: cert, chain: [try fixture("ca.der")])
let utc: Calendar = { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "UTC")!; return c }()
func day(_ s: String) -> Date { ISO8601DateFormatter().date(from: s)! }

test("profile kinds") {
    check(try Profile(fixture("profile.mobileprovision")).kind == .development, "get-task-allow: Development")
    check(try Profile(fixture("kind-adhoc.mobileprovision")).kind == .adHoc, "devices: Ad Hoc")
    check(try Profile(fixture("kind-enterprise.mobileprovision")).kind == .enterprise, "all devices: Enterprise")
    check(try Profile(fixture("kind-distribution.mobileprovision")).kind == .distribution, "none: Distribution")
}

test("signature expiry is the earlier of profile and certificate") {
    let p = try Profile(fixture("profile.mobileprovision")) // 7 days; the certificate a year
    check(p.signatureExpiry(certificate: cert) == p.expires, "profile first")
    let far = try Profile(fixture("kind-adhoc.mobileprovision")) // 2030
    check(far.signatureExpiry(certificate: cert) == (try Certificate(der: cert)).notAfter, "certificate first")
}

test("options from the bridge") {
    let png = try fixture("icon.png")
    let o = try SignOptions(json: ["name": "  New  ", "bundleId": "com.me.x-1", "icon": png.base64EncodedString(),
                                   "removeExtensions": ["PlugIns/W.appex/"], "fixArm64e": false])
    check(o.name == "New" && o.bundleID == "com.me.x-1" && o.icon == png, "fields")
    check(o.removeExtensions == ["PlugIns/W.appex"] && !o.fixArm64e, "extensions, fix-up")
    check(try SignOptions(json: ["name": "", "bundleId": ""]).name == nil, "empty is none")
    for bad in ["com..x", ".com.x", "com.x.", "com x", "com.é"] {
        check(throwsCode("bad_options") { _ = try SignOptions(json: ["bundleId": bad]) }, "refuses \(bad)")
    }
    check(throwsCode("bad_options") { _ = try SignOptions(json: ["icon": Data("GIF89a".utf8).base64EncodedString()]) }, "icon not PNG")
}

test("F237: Keep Bundle IDs option, stored and the profile's IDs") {
    check(try SignOptions(json: [:]).keepBundleID, "absent: kept (the default)")
    check(!(try SignOptions(json: ["keepBundleId": false])).keepBundleID, "false: the old way")
    // a record written before F237 has no key: it signed the old way, so Re-sign does too
    let old = try JSONDecoder().decode(SignedRecord.StoredOptions.self, from: Data(#"{"removeExtensions":[],"fixArm64e":true}"#.utf8))
    check(old.keepBundleID == nil && !SignOptions(old).keepBundleID, "old record: old way")
    check(old == SignOptions(old).stored, "an old record equals its options written again")
    var o = SignOptions()
    check(SignOptions(o.stored).keepBundleID, "round trip keeps it")
    // F280: iFizBox's own IPA keeps its ID whatever the running copy's (push goes by the Info.plist ID)
    check(o.keeps("com.ryha.ifizbox", running: "com.ryha.ifizbox") && o.keeps("com.ryha.ifizbox", running: "com.you.ifizbox"), "self")
    check(o.keeps("com.ryha.ifizbox", running: nil) && o.keeps("com.google.ios.youtube", running: "com.you.ifizbox"), "others")
    o.keepBundleID = false
    check(!o.keeps("com.google.ios.youtube", running: nil), "off")
    let x = try Profile(fixture("profile-explicit.mobileprovision"))
    let kept = try x.signingIDs(for: "com.google.ios.youtube", keep: true)
    check(kept.bundleID == "com.google.ios.youtube" && kept.entitlementsID == "com.me.only", "explicit kept \(kept)")
    let moved = try x.signingIDs(for: "com.google.ios.youtube", keep: false)
    check(moved.bundleID == "com.me.only" && moved.entitlementsID == "com.me.only", "explicit old way \(moved)")
    check(x.pushEnvironment == nil, "the test profiles have no Push")
}

test("strings files") {
    let d = SignOptions.parseStrings("/* c */ \"a\" = \"x \\\"y\\\"\\n\";\n// line\nb = c;\n\"u\" = \"\\U00e9\";")
    check(d?["a"] as? String == "x \"y\"\n" && d?["b"] as? String == "c" && d?["u"] as? String == "é", "\(String(describing: d))")
    check(SignOptions.parseStrings("\"a\" = \"b\"") == nil, "missing ; is not a strings file")
    var o = SignOptions()
    o.name = "N"
    let utf16 = "\"CFBundleName\" = \"Alt\";".data(using: .utf16)!
    let r = o.renamedStrings(utf16).flatMap { try? PropertyListSerialization.propertyList(from: $0, format: nil) as? [String: String] }
    check(r == ["CFBundleName": "N"], "utf-16 renamed: \(String(describing: r))")
    check(o.renamedStrings(Data("\"Other\" = \"x\";".utf8)) == nil, "untouched without a name key")
}

test("arm64e fix-up") {
    let old = try fixture("arm64e-old.macho")
    let (fixed, changed) = Arm64e.fixup(old)
    check(changed, "old ABI fixed")
    let off = Int(fixed.be32(at: 8 + 20 + 8))
    check(fixed.be32(at: 8 + 20 + 4) == 0x8000_0002 && fixed.le32(at: off + 8) == 0x8000_0002, "both headers")
    check(fixed.be32(at: 8 + 4) == 0, "arm64 slice untouched")
    check(fixed.count == old.count, "same size")
    check(!Arm64e.fixup(try fixture("arm64e-new.macho")).1, "versioned slice left alone")
    let thin = old.subdata(in: 0x4000..<0x4000 + 64)
    check(!Arm64e.fixup(thin).1, "thin left alone")
}

test("inspect an IPA") {
    let d = try Inspect.ipa(fixtures.appendingPathComponent("edit.ipa"))
    check(d.name == "Fixture" && d.bundleID == "dev.ifizbox.fixture" && d.version == "1.0" && d.minimumOS == "15.0", "basics")
    check(d.permissions.map(\.label) == ["Camera", "Local Network"], "permissions \(d.permissions.map(\.label))")
    check(d.permissions.first?.text == "To scan codes.", "the app's reason")
    check(d.extensions.map(\.path) == ["PlugIns/Share.appex", "PlugIns/Widget.appex"], "extensions \(d.extensions.map(\.path))")
    check(d.extensions.first?.point == "com.apple.share-services" && d.extensions.first?.bundleID == "dev.ifizbox.fixture.share", "share")
    check(d.iconPath == "Payload/Fixture.app/AppIcon60x60@2x.png", "icon \(String(describing: d.iconPath))")
    check(d.entitlements.isEmpty, "unsigned: no entitlements")
    check(JSONSerialization.isValidJSONObject(d.json), "json")
    check((try? Inspect.ipa(fixtures.appendingPathComponent("icon.png"))) == nil, "not a zip")
}

test("sign with the user's edits") {
    let profile = try Profile(fixture("profile.mobileprovision"))
    let s = IPASigner(profile: profile, identity: identity)
    s.options = try SignOptions(json: ["name": "Renamed", "bundleId": "com.me.renamed", "icon": try fixture("icon.png").base64EncodedString(),
                                       "removeExtensions": ["PlugIns/Widget.appex"]])
    let out = work.appendingPathComponent("edited.ipa")
    let app = try s.sign(fixtures.appendingPathComponent("edit.ipa"), to: out)
    check(app.bundleID == "com.me.renamed" && app.originalBundleID == "dev.ifizbox.fixture", "ids \(app.bundleID)")
    check(app.name == "Renamed", "name \(app.name)")
    check(app.removed == ["PlugIns/Widget.appex"], "removed \(app.removed)")
    check(app.fixedArm64e == ["Frameworks/Sub.framework/Sub"], "fixed \(app.fixedArm64e)")
    // read back: the signed app's own entitlements, now the profile's narrowed to the new ID
    let d = try Inspect.ipa(out)
    check(d.entitlements["application-identifier"] as? String == "TESTTEAM42.com.me.renamed", "entitlements \(d.entitlements)")
    check(d.extensions.map(\.bundleID) == ["com.me.renamed.share"], "extension moved")
    check(d.iconPath == "Payload/Fixture.app/iFizBoxIcon60x60@3x.png", "icon \(String(describing: d.iconPath))")
    check(d.missing(from: profile).isEmpty, "the profile covers what it signed")
    let wants = AppDetails(name: "", bundleID: "", version: "", minimumOS: "", executable: "",
                           entitlements: ["com.apple.developer.healthkit": true, "get-task-allow": true,
                                          "keychain-access-groups": ["x"]],
                           permissions: [], extensions: [], iconPath: nil, size: 0)
    check(wants.missing(from: profile) == ["com.apple.developer.healthkit"], "missing \(wants.missing(from: profile))")
    // an unknown extension is refused; an explicit profile overrides the asked-for ID
    s.options = try SignOptions(json: ["removeExtensions": ["PlugIns/Nope.appex"]])
    check(throwsCode("bad_options") { _ = try s.sign(fixtures.appendingPathComponent("edit.ipa"), to: work.appendingPathComponent("x.ipa")) },
          "unknown extension")
    let explicit = IPASigner(profile: try Profile(fixture("profile-explicit.mobileprovision")), identity: identity)
    explicit.options = try SignOptions(json: ["bundleId": "com.me.asked", "keepBundleId": false])
    let e = try explicit.sign(fixtures.appendingPathComponent("edit.ipa"), to: work.appendingPathComponent("explicit.ipa"))
    check(e.bundleID == "com.me.only" && e.removed.sorted() == ["PlugIns/Share.appex", "PlugIns/Widget.appex"], "explicit \(e.bundleID) \(e.removed)")
    // F237: kept (the default), the typed ID stays in Info.plist, the profile's App ID goes in the entitlements,
    // and the extensions stay, signed under the app's application-identifier
    explicit.options = try SignOptions(json: ["bundleId": "com.me.asked"])
    let k = try explicit.sign(fixtures.appendingPathComponent("edit.ipa"), to: work.appendingPathComponent("explicit-kept.ipa"))
    check(k.bundleID == "com.me.asked" && k.removed.isEmpty, "kept \(k.bundleID) \(k.removed)")
    let kd = try Inspect.ipa(work.appendingPathComponent("explicit-kept.ipa"))
    check(kd.bundleID == "com.me.asked" && kd.entitlements["application-identifier"] as? String == "TESTTEAM42.com.me.only",
          "kept entitlements \(kd.bundleID) \(kd.entitlements)")
    check(kd.extensions.map(\.bundleID).sorted() == ["com.me.asked.share", "com.me.asked.widget"], "kept extensions \(kd.extensions.map(\.bundleID))")
    // no options: the plain I6 behaviour, no fix-up when turned off
    let plain = IPASigner(profile: profile, identity: identity)
    plain.options.fixArm64e = false
    let p = try plain.sign(fixtures.appendingPathComponent("edit.ipa"), to: work.appendingPathComponent("plain.ipa"))
    check(p.bundleID == "dev.ifizbox.fixture" && p.name == "Fixture" && p.fixedArm64e.isEmpty && p.removed.isEmpty, "plain")
}

test("F196: Cancel stops the signing job") {
    let j = SignJob.begin()
    check(SignJob.current === j, "the running job")
    var ran = 0
    j.onCancel { ran += 1 }
    check(!j.cancelled && (try? j.check()) != nil, "not cancelled yet")
    check(SignJob.cancelCurrent(), "cancelled")
    check(ran == 1 && j.cancelled && SignJob.current == nil, "stops ran once, no current job")
    check(throwsCode("cancelled") { try j.check() }, "check throws cancelled")
    j.onCancel { ran += 1 }
    check(ran == 2, "a stop added after Cancel runs at once")
    check(!SignJob.cancelCurrent() && !j.cancel(), "nothing more to cancel")
    let a = SignJob.begin(), b = SignJob.begin()
    a.end()
    check(SignJob.current === b, "an older job ending leaves the newer one")
    b.end()
    check(SignJob.current == nil && !SignJob.cancelCurrent(), "ended")
    // the signer stops at its next step with code "cancelled" and writes nothing
    let s = IPASigner(profile: try Profile(fixture("profile.mobileprovision")), identity: identity)
    var steps = 0
    s.stop = { steps += 1; return steps > 1 }
    let out = work.appendingPathComponent("cancelled.ipa")
    check(throwsCode("cancelled") { _ = try s.sign(fixtures.appendingPathComponent("edit.ipa"), to: out) }, "signer cancelled")
    check(!FileManager.default.fileExists(atPath: out.path), "no output")
}

test("F235: a tagged job stops alone") {
    let plain = SignJob.begin()
    let a = SignJob.begin(tag: "a"), b = SignJob.begin(tag: "b")
    check(SignJob.current === plain, "a tagged job isn't the untagged Cancel's")
    var stopped = [String]()
    a.onCancel { stopped.append("a") }
    b.onCancel { stopped.append("b") }
    check(SignJob.cancel(tag: "a"), "a cancelled")
    check(a.cancelled && !b.cancelled && !plain.cancelled && stopped == ["a"], "only a: \(stopped)")
    check(SignJob.wasCancelled(tag: "a") && !SignJob.wasCancelled(tag: "b"), "a's tag remembered")
    let again = SignJob.begin(tag: "a")
    check(again.cancelled, "a job begun under a cancelled tag starts cancelled")
    check(!SignJob.cancel(tag: "early") && SignJob.begin(tag: "early").cancelled, "Stop before the job began")
    b.end()
    check(!SignJob.cancel(tag: "b") && !b.cancelled, "an ended job isn't cancelled")
    check(SignJob.cancelCurrent() && plain.cancelled, "the untagged job still stops")
}

test("OCSP") {
    let ca = try fixture("ca.der")
    let req = try OCSP.request(certificate: cert, issuer: ca)
    try req.write(to: work.appendingPathComponent("ocsp-request.der")) // Python reads it with cryptography
    check(OCSP.responder(try fixture("aia.der"))?.absoluteString == "http://ocsp.apple.com/ocsp03-wwdrg305", "AIA")
    check(OCSP.responder(cert) == nil, "no AIA")
    check(try OCSP.status(fixture("ocsp-good.der"), certificate: cert) == .good, "good")
    check(try OCSP.status(fixture("ocsp-revoked.der"), certificate: cert) == .revoked(day("2026-11-01T12:00:00Z")), "revoked with its time")
    check(try OCSP.status(fixture("ocsp-unknown.der"), certificate: cert) == .unknown, "unknown")
    check(try OCSP.status(fixture("ocsp-good.der"), certificate: fixture("other.der")) == .unknown, "another certificate's answer")
    check(throwsCode("ocsp") { _ = try OCSP.status(fixture("ocsp-trylater.der"), certificate: cert) }, "tryLater")
    check(throwsCode("ocsp") { _ = try OCSP.status(Data([0x30, 0x03, 0x02, 0x01, 0x00]), certificate: cert) }, "garbage")
}

test("re-sign reminder") {
    let expiry = day("2026-11-24T08:00:00Z")
    let now = day("2026-11-17T12:00:00Z")
    check(Reminder.date(expiry: expiry, daysBefore: 2, now: now, calendar: utc) == day("2026-11-22T10:00:00Z"), "two days before, 10:00")
    check(Reminder.date(expiry: expiry, daysBefore: 0, now: now, calendar: utc) == nil, "off")
    check(Reminder.date(expiry: expiry, daysBefore: 7, now: now, calendar: utc) == nil, "already past")
    check(Reminder.text(apps: ["Delta"], expiry: expiry, now: now, calendar: utc).body
          == "Delta stops opening in 7 days. Open \(Brand.name) and tap Re-sign All.", "one app")
    check(Reminder.text(apps: ["A", "B", "C"], expiry: day("2026-11-18T08:00:00Z"), now: now, calendar: utc).body
          == "A and 2 other apps stop opening tomorrow. Open \(Brand.name) and tap Re-sign All.", "three apps")
    check(Reminder.text(apps: [], expiry: now, now: now, calendar: utc).body.hasPrefix("Your signing certificate stops opening today"), "none")
}

test("signed records") {
    var o = SignOptions()
    o.name = "D"; o.icon = Data([1, 2]); o.removeExtensions = ["PlugIns/X.appex"]
    let a = SignedRecord(bundleID: "a", originalBundleID: "a0", name: "A", version: "1", url: "https://x/a.ipa",
                         signed: day("2026-11-17T00:00:00Z"), expires: day("2026-11-24T00:00:00Z"), options: o.stored)
    var b = a
    b.bundleID = "b"; b.name = "B"; b.expires = day("2026-11-24T05:00:00Z")
    var c = a
    c.bundleID = "c"; c.name = "C"; c.expires = day("2027-01-01T00:00:00Z")
    var list = SignedRecords.adding(a, to: [])
    list = SignedRecords.adding(b, to: list)
    list = SignedRecords.adding(c, to: list)
    var a2 = a
    a2.version = "2"
    list = SignedRecords.adding(a2, to: list)
    check(list.map(\.bundleID) == ["b", "c", "a"] && list.last?.version == "2", "replaced \(list.map(\.bundleID))")
    let back = SignedRecords.decode(try SignedRecords.encode(list))
    check(back == list, "round trip")
    check(SignOptions(back[2].options).removeExtensions == ["PlugIns/X.appex"] && SignOptions(back[2].options).icon == Data([1, 2]), "options back")
    let next = SignedRecords.nextExpiry(list)
    check(next?.0 == day("2026-11-24T00:00:00Z") && next?.1.sorted() == ["A", "B"], "next \(String(describing: next))")
    check(SignedRecords.decode(Data("nope".utf8)).isEmpty, "bad file: empty")
    check(JSONSerialization.isValidJSONObject(a.json), "json")
    // F91: signing.resign {bundleId} signs only that app's record: by its installed ID, else its original one
    check(SignedRecords.only(list, bundleID: "b").map(\.bundleID) == ["b"], "one by id")
    check(SignedRecords.only(list, bundleID: "a0").map(\.bundleID) == ["b"], "first by original id")
    check(SignedRecords.only(list, bundleID: "a").first?.version == "2", "the newest record of a")
    check(SignedRecords.only(list, bundleID: "nope").isEmpty && SignedRecords.only(list, bundleID: "").isEmpty, "none")
}

// B247: the source's app an IPA was signed from goes on the record (Re-sign keeps it) and names it in iFizBox
test("B247: source credit on the signed record") {
    let o = try SignOptions(json: ["credit": ["name": " RyukGram ", "source": "https://ryuk.example/apps.json",
                                              "sourceName": "RyukGram Repo", "key": "ryuk|com.burbn.instagram", "extra": 1]])
    check(o.credit?.name == "RyukGram" && o.credit?.sourceName == "RyukGram Repo" && o.credit?.key == "ryuk|com.burbn.instagram", "parsed")
    check(o.shownName("Instagram") == "RyukGram", "the log names the source's app")
    check(try SignOptions(json: ["credit": ["source": "https://x"]]).credit == nil, "no name: no credit")
    check(try SignOptions(json: ["credit": "RyukGram"]).credit == nil && (try SignOptions(json: [:])).credit == nil, "not an object")
    var renamed = o
    renamed.name = "Mine"
    check(renamed.shownName("Mine") == "Mine", "the user's rename wins")
    let r = SignedRecord(bundleID: "com.burbn.instagram", originalBundleID: "com.burbn.instagram", name: "Instagram", version: "454.0.0",
                         url: "https://ryuk.example/r.ipa", signed: day("2026-11-20T00:00:00Z"), expires: nil, options: o.stored)
    let back = SignedRecords.decode(try SignedRecords.encode([r]))
    check(back.first?.options.credit == o.credit && SignOptions(back[0].options).credit == o.credit, "kept for Re-sign")
    check((r.json["credit"] as? [String: Any])?["name"] as? String == "RyukGram" && r.shownName == "RyukGram", "json and shown name")
    check(JSONSerialization.isValidJSONObject(r.json), "valid json")
    check(r.options == SignOptions().stored, "left out of the options' ==")
    var mine = r
    mine.options.name = "Mine"; mine.name = "Mine"
    check((mine.json["credit"] as? [String: Any])?["name"] as? String == "Mine", "the rename is the credit's name on signing.installed")
    let old = SignedRecords.decode(Data(#"[{"bundleID":"a","originalBundleID":"a","name":"A","version":"1","url":"u","signed":"2026-11-17T00:00:00Z","options":{"removeExtensions":[],"fixArm64e":true}}]"#.utf8))
    check(old.first?.options.credit == nil && old.first?.json["credit"] == nil && old.first?.shownName == "A", "older record: no credit")
}

// F75: iFizBox's own IPA with the user's certificate inside (BundledIdentity), the ifizbox:// links the shell takes,
// and gunzip for ifizbox://import on an iOS without DecompressionStream.
test("bundled identity: first launch imports, once") {
    let plist = try PropertyListSerialization.data(fromPropertyList: ["p12": Data([0x30, 1, 2]), "password": "pw",
                                                                      "profile": Data([0x30, 9])], format: .xml, options: 0)
    let c = BundledIdentity.parse(plist)
    check(c?.p12 == Data([0x30, 1, 2]) && c?.password == "pw" && c?.profile == Data([0x30, 9]), "parsed")
    check(BundledIdentity.parse(Data("nope".utf8)) == nil, "not a plist")
    let noProfile = try PropertyListSerialization.data(fromPropertyList: ["p12": Data([1])], format: .xml, options: 0)
    check(BundledIdentity.parse(noProfile) == nil, "no profile")
    let d = BundledIdentity.digest(plist)
    check(d.count == 64, "sha-256 hex")
    check(BundledIdentity.shouldImport(digest: d, seen: nil, hasIdentity: false), "first launch, empty Keychain: import")
    check(!BundledIdentity.shouldImport(digest: d, seen: nil, hasIdentity: true), "Keychain holds one: keep it")
    check(!BundledIdentity.shouldImport(digest: d, seen: d, hasIdentity: false), "same file again (removed since): ignored")
    check(BundledIdentity.shouldImport(digest: "other", seen: d, hasIdentity: false), "an update's new file, empty Keychain: import")
}

test("incoming ifizbox:// links") {
    check(IncomingLink.accepts(URL(string: "ifizbox://import?d=H4sI")!), "import")
    check(IncomingLink.accepts(URL(string: "ifizbox://install?url=https%3A%2F%2Fe.example%2Fa.ipa")!), "install (F89)")
    check(!IncomingLink.accepts(URL(string: "ifizbox://signing-import#abc")!), "signing-import is gone (F89)")
    check(!IncomingLink.accepts(URL(string: "ifizbox://other")!), "other host")
    check(IncomingLink.accepts(URL(string: "ifizbox://myipas?file=A.ipa")!), "myipas (F77)")
    check(IncomingLink.accepts(URL(string: "ifizbox://package?id=com.example.app")!), "package (F96)")
    check(IncomingLink.accepts(URL(string: "ifizbox://account?k=0123456789ABCDEFGHJKMNPQRS")!), "account (F97)")
    check(IncomingLink.accepts(URL(string: "ifizbox://sources")!), "a tab (B14)")
    check(IncomingLink.accepts(URL(string: "ifizbox://Changes")!), "a tab, any case (B14)")
    check(!IncomingLink.accepts(URL(string: "https://import/x")!), "other scheme")
    check(!IncomingLink.accepts(URL(string: "ifizbox://import?d=" + String(repeating: "A", count: 600_000))!), "too long")
}

test("gunzip") {
    let a = try gunzip(Data(base64Encoded: "H4sIAAAAAAAC/6tWKlOyMtRRKs4vLUpOLVayilbKKCkpKLbS1y9KLcjXS61IzC3ISdVXiq0FAGw/tQcrAAAA")!)
    check(String(decoding: a, as: UTF8.self) == #"{"v":1,"sources":["https://repo.example/"]}"#, "plain member")
    let b = try gunzip(Data(base64Encoded: "H4sICAAAAAAC/2EuanNvbgDLS8xNTQEAh8zgcQUAAAA=")!)
    check(String(decoding: b, as: UTF8.self) == "named", "with a file name")
    var bad = [UInt8](Data(base64Encoded: "H4sICAAAAAAC/2EuanNvbgDLS8xNTQEAh8zgcQUAAAA=")!)
    bad[bad.count - 6] ^= 1
    check((try? gunzip(Data(bad))) == nil, "crc checked")
    check((try? gunzip(Data("not gzip at all, long enough".utf8))) == nil, "not gzip")
}

test("manifest check before iOS gets the link (B30)") {
    let good = try InstallManifest.manifest(ipaURL: "http://127.0.0.1:8080/t/app.ipa", bundleID: "com.me.app", version: "1", title: "App")
    check(ManifestCheck.problem(status: 200, body: good, error: nil) == nil, "a manifest passes")
    // What sign.ifizbox.com/sign/manifest answered the iPhone 7 (worker/src/index.js manifest()), 2026-11-18.
    let worker = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0"><dict><key>items</key><array><dict>
        <key>assets</key><array><dict><key>kind</key><string>software-package</string><key>url</key><string>http://127.0.0.1:8080/abc/app.ipa</string></dict></array>
        <key>metadata</key><dict><key>bundle-identifier</key><string>com.ryha.test</string><key>bundle-version</key><string>1</string><key>kind</key><string>software</string><key>title</key><string>T</string></dict>
        </dict></array></dict></plist>
        """
    check(ManifestCheck.problem(status: 200, body: Data(worker.utf8), error: nil) == nil, "the Worker's manifest passes")
    check(ManifestCheck.problem(status: 404, body: Data("Not found".utf8), error: nil) == "it answered HTTP 404", "404")
    let workerError = Data(#"{"code":"bad_url","error":"Only an IPA on this iPhone (127.0.0.1) can be installed this way."}"#.utf8)
    check(ManifestCheck.problem(status: 400, body: workerError, error: nil)
          == "it answered HTTP 400 (Only an IPA on this iPhone (127.0.0.1) can be installed this way.)", "the Worker's words")
    check(ManifestCheck.problem(status: 200, body: Data("<html>captive portal</html>".utf8), error: nil)
          == "its answer isn't an install manifest", "200 with HTML")
    let empty = try PropertyListSerialization.data(fromPropertyList: ["items": [Any]()], format: .xml, options: 0)
    check(ManifestCheck.problem(status: 200, body: empty, error: nil) != nil, "a plist with no items")
    check(ManifestCheck.problem(status: nil, body: nil, error: nil) == "no answer", "nothing at all")
    let offline = NSError(domain: NSURLErrorDomain, code: -1003,
                          userInfo: [NSLocalizedDescriptionKey: "A server with the specified hostname could not be found."])
    let why = ManifestCheck.problem(status: nil, body: nil, error: offline)
    check(why == "A server with the specified hostname could not be found", "transport error, no full stop: \(why ?? "nil")")
    check(ManifestCheck.errorText(host: "sign.ifizbox.com", reason: why!, reached: false)
          == "no_manifest: Couldn't reach sign.ifizbox.com: A server with the specified hostname could not be found. iOS can't show Install without it.",
          "unreachable text")
    check(ManifestCheck.errorText(host: "old.example", reason: "it answered HTTP 404", reached: true)
          == "no_manifest: old.example didn't give the install manifest: it answered HTTP 404. iOS can't show Install without it.",
          "wrong answer text")
    check(ManifestCheck.host(of: URL(string: "https://sign.ifizbox.com/sign/manifest?x=1")!) == "sign.ifizbox.com", "host")
}

test("This iPhone self-update: close once installd accepted the install (B159, B173)") {
    let t0 = Date(timeIntervalSince1970: 1_000_000)
    var c = SelfCloseClock()
    check(c.closeAt == nil && !c.due(t0.addingTimeInterval(3600)), "never due while the IPA is still being copied")
    c.copied(at: t0)
    check(c.closeAt == t0.addingTimeInterval(SelfCloseClock.firstQuiet), "copied: firstQuiet later")
    check(!c.due(t0.addingTimeInterval(SelfCloseClock.firstQuiet - 1)), "not before firstQuiet")
    check(c.due(t0.addingTimeInterval(SelfCloseClock.firstQuiet)), "installd said nothing: due (stuck on 'iOS is installing it')")
    check(c.reason.contains("no status"), "the reason says installd was silent")
    c.copied(at: t0.addingTimeInterval(5))
    check(c.copiedAt == t0, "a second copied() doesn't restart the clock")
    check(c.installd(5, at: t0.addingTimeInterval(1)), "the first status is installd accepting the install")
    check(c.closeAt == t0.addingTimeInterval(1 + SelfCloseClock.accepted), "close `accepted` after it")
    check(SelfCloseClock.accepted <= 2, "within a couple of seconds")
    check(!c.installd(40, at: t0.addingTimeInterval(1.5)), "later statuses change nothing")
    check(!c.installd(40, at: t0.addingTimeInterval(1.8)), "nor repeats")
    check(c.closeAt == t0.addingTimeInterval(1 + SelfCloseClock.accepted), "moving percentages never push the close back (B173)")
    check(!c.due(t0.addingTimeInterval(1.9)) && c.due(t0.addingTimeInterval(2)), "due `accepted` after the first status")
    check(c.reason == "installd accepted the install (5%)", "the reason names the first status")
    var d = SelfCloseClock()
    d.installd(0, at: t0)
    check(d.copiedAt == t0 && d.closeAt == t0.addingTimeInterval(SelfCloseClock.accepted), "a 0% status without copied() counts too")
}

test("This iPhone: a dropped connection is not a failed install (B246)") {
    // the user's error: idevice's Socket(Kind(UnexpectedEof)) is code 1
    check(HereRecheck.isDropped(code: "install_failed", lib: 1), "UnexpectedEof (Socket, 1) is a drop")
    check(HereRecheck.isDropped(code: "timeout", lib: nil), "the watchdog's timeout is a drop")
    for c: Int32 in [17, 19, 101, 103, 109] { check(HereRecheck.isDropped(code: "upload_failed", lib: c), "code \(c) is a drop") }
    for c: Int32 in [13, 15, 107, 203] { check(!HereRecheck.isDropped(code: "install_failed", lib: c), "installd's code \(c) is a real failure") }
    check(!HereRecheck.isDropped(code: "install_failed", lib: nil), "a failure of our own isn't a drop")
    // seen on the 15 Pro: Tailscale's VPN off for 12 s mid-copy; the drop was Socket TimedOut, then the first
    // reconnect's connect failed with InternalError("connect: Operation Timeout") (16)
    check(HereRecheck.shouldReconnect(code: "upload_failed", lib: 1, reconnecting: false), "the drop itself reconnects")
    check(!HereRecheck.shouldReconnect(code: "connect_failed", lib: 16, reconnecting: false), "a first connect that fails is the route being off")
    check(HereRecheck.shouldReconnect(code: "connect_failed", lib: 16, reconnecting: true), "a reconnect's failed connect tries again")
    check(HereRecheck.shouldReconnect(code: "connect_failed", lib: nil, reconnecting: true), "so does 'Tailscale isn't back on yet'")
    check(!HereRecheck.shouldReconnect(code: "refused", lib: nil, reconnecting: true), "a refused pairing never")
    check(!HereRecheck.shouldReconnect(code: "install_failed", lib: 203, reconnecting: true), "installd's refusal never")

    let old = HereRecheck.AppState(path: "/private/var/containers/Bundle/Application/A/X.app", version: "383", shortVersion: "383.0")
    let new = HereRecheck.AppState(path: "/private/var/containers/Bundle/Application/B/X.app", version: "384", shortVersion: "384.0")
    check(HereRecheck.verdict(version: "384.0", before: .absent, now: nil) == .notYet, "not listed: not yet")
    check(HereRecheck.verdict(version: "384.0", before: .absent, now: new) == .installed, "new app listed with its version: installed")
    check(HereRecheck.verdict(version: "384", before: .absent, now: new) == .notYet, "the build number isn't the version")
    var noShort = new; noShort.shortVersion = nil
    check(HereRecheck.verdict(version: "384", before: .absent, now: noShort) == .installed, "no short version: CFBundleVersion is the version")
    // the old copy's build number equal to the new short version must not read as the update
    let oldBuild = HereRecheck.AppState(path: old.path, version: "384.0", shortVersion: "383.0")
    check(HereRecheck.verdict(version: "384.0", before: .present(oldBuild), now: oldBuild) == .notYet, "an old build number never matches the new version")
    check(HereRecheck.verdict(version: "384.0", before: .present(old), now: old) == .notYet, "still the old version: not yet")
    check(HereRecheck.verdict(version: "384.0", before: .present(old), now: new) == .installed, "an update listed: installed")
    var same = old; same.path = old.path
    check(HereRecheck.verdict(version: "383.0", before: .present(old), now: same) == .sameAsBefore, "same version, same folder: the old copy")
    var moved = old; moved.path = new.path
    check(HereRecheck.verdict(version: "383.0", before: .present(old), now: moved) == .installed, "same version, new folder: a reinstall landed")
    var noPath = old; noPath.path = nil
    check(HereRecheck.verdict(version: "383.0", before: .present(noPath), now: noPath) == .cannotTell, "no folder to compare: can't tell")
    check(HereRecheck.verdict(version: "384.0", before: .unknown, now: new) == .cannotTell, "before unknown: can't tell")
    check(HereRecheck.verdict(version: "384.0", before: .unknown, now: old) == .notYet, "before unknown, other version: not yet")

    let mb = 1 << 20
    check(HereRecheck.resumeAt(remoteSize: 150 * mb + 1234, sent: 151 * mb, chunk: mb) == 150 * mb, "a cut-off chunk is sent again")
    check(HereRecheck.resumeAt(remoteSize: 200 * mb, sent: 120 * mb, chunk: mb) == 120 * mb, "never past what was sent")
    check(HereRecheck.resumeAt(remoteSize: 0, sent: 50 * mb, chunk: mb) == 0, "an empty file starts over")
    check(HereRecheck.pause(1) < HereRecheck.pause(HereRecheck.reconnects), "the pause grows")

    var sp = HereRecheck.CopySpeed()
    sp.add(100 * mb, 10, front: true)
    sp.add(10 * mb, 20, front: false)
    check(sp.summary == "10.0 MB/s in front, 0.5 MB/s in the background", "speed summary: \(sp.summary)")
    var fr = HereRecheck.CopySpeed()
    fr.add(10 * mb, 2, front: true)
    check(fr.summary == "5.0 MB/s in front", "front only: \(fr.summary)")
}

test("Download progress once a second (B262)") {
    let mb = Int64(1 << 20)
    let t0 = Date(timeIntervalSince1970: 1_000_000)
    var m = DownloadMeter()
    check(m.add(0, of: 300 * mb, at: t0) == nil, "the first call only starts the clock")
    check(m.add(10 * mb, of: 300 * mb, at: t0.addingTimeInterval(0.5)) == nil, "nothing before a second")
    let a = m.add(30 * mb, of: 300 * mb, at: t0.addingTimeInterval(1))
    check(a?.line == "Downloaded 30.0 of 300.0 MB (10%), 30.0 MB/s", "line: \(a?.line ?? "nil")")
    check(a?.event["bytes"] as? Int64 == 30 * mb && a?.event["total"] as? Int64 == 300 * mb, "event's bytes and total")
    check(a?.event["phase"] as? String == "downloading", "event's phase")
    let b = m.add(40 * mb, of: 300 * mb, at: t0.addingTimeInterval(3))
    check(b?.line == "Downloaded 40.0 of 300.0 MB (13%), 5.0 MB/s", "the last interval's rate: \(b?.line ?? "nil")")
    check(m.add(1 * mb, of: 300 * mb, at: t0.addingTimeInterval(5)) == nil, "started again: the count starts again")
    var u = DownloadMeter()
    _ = u.add(0, of: -1, at: t0)
    let c = u.add(5 * mb, of: -1, at: t0.addingTimeInterval(2))
    check(c?.line == "Downloaded 5.0 MB, 2.5 MB/s", "no length: \(c?.line ?? "nil")")
    check(c?.total == 0 && c?.fraction == 0, "no length: total 0")
}

test("This iPhone: a second look while installd is quiet (B251)") {
    let after = HereRecheck.lookAfter, every = HereRecheck.lookEvery
    check(after < 180 && every < 180, "looks come well before installd's 180 s limit")
    var l = HereRecheck.SecondLook()
    check(!l.due(quiet: after - 1), "not before \(after) s of quiet")
    check(l.due(quiet: after), "a look at \(after) s of quiet")
    check(!l.due(quiet: after + 1), "one look at a time")
    check(!l.due(quiet: after + every - 1), "not again before \(every) s more")
    check(l.due(quiet: after + every), "again \(every) s later")
    // installd's next percentage starts the clock again: the looks start over
    check(!l.due(quiet: 2), "the step moved: no look")
    check(l.lastAt == nil, "and the looks start over")
    check(l.due(quiet: after), "the first look comes again after \(after) s")

    check(!HereRecheck.SecondLook.ends(nil), "couldn't ask iOS: nothing changes, keep waiting on installd")
    check(!HereRecheck.SecondLook.ends(.notYet), "not listed yet: keep waiting")
    check(!HereRecheck.SecondLook.ends(.sameAsBefore), "still the earlier copy: keep waiting")
    // a reinstall of the same version reads cannotTell from the first look while installd may still be verifying
    check(!HereRecheck.SecondLook.ends(.cannotTell), "can't tell: the long limit decides, never a look")
    check(HereRecheck.SecondLook.ends(.installed), "the new copy listed: installed")
}

test("This iPhone: the copy's quiet limit follows how fast chunks land (B292)") {
    typealias Q = HereRecheck.CopyQuiet
    var q = Q()
    check(q.limit == Q.ceiling, "nothing landed yet: the full \(Q.ceiling) s")
    for _ in 1..<Q.warmup { q.add(0.5) }
    check(q.limit == Q.ceiling, "still warming up: the full limit")
    q.add(0.5)
    check(q.limit == Q.floor, "chunks every 0.5 s: a stall is a drop after \(Q.floor) s, got \(q.limit)")
    // a slow route keeps a limit that fits its pace
    var slow = Q()
    for _ in 0..<Q.warmup { slow.add(4) }
    check(slow.limit == 16, "chunks every 4 s: 16 s, got \(slow.limit)")
    for _ in 0..<Q.warmup { slow.add(12) }
    check(slow.limit == Q.ceiling, "never over \(Q.ceiling) s, got \(slow.limit)")
    // one slow chunk in the window holds the limit up until it leaves the window
    var dip = Q()
    for _ in 0..<Q.warmup { dip.add(0.1) }
    dip.add(3)
    check(dip.limit == 12, "a 3 s chunk: 12 s, got \(dip.limit)")
    for _ in 0..<Q.window - 1 { dip.add(0.1) }
    check(dip.limit == 12, "still in the window")
    dip.add(0.1)
    check(dip.limit == Q.floor, "out of the window: back to \(Q.floor) s, got \(dip.limit)")
    // a gap that spans the app being suspended would hold the limit up: the copy starts a new pace instead
    var sus = Q()
    for _ in 0..<Q.warmup { sus.add(0.5) }
    sus.add(60)
    check(sus.limit == Q.ceiling, "a 60 s gap in the pace: the full limit, got \(sus.limit)")
    sus = Q()
    for _ in 0..<Q.warmup { sus.add(0.5) }
    check(sus.limit == Q.floor, "the new pace is short again after \(Q.warmup) chunks, got \(sus.limit)")
    // a negative gap (the clock moved back) is counted but isn't a pace
    var back = Q()
    for _ in 0..<Q.warmup { back.add(-1) }
    check(back.limit == Q.ceiling, "no gaps to go on: the full limit, got \(back.limit)")
    check(HereRecheck.CopyQuiet.ceiling < 180, "installd's long limit (180 s) is not the copy's")
}

test("the IPA kept for Re-sign (F343)") {
    let dir = work.appendingPathComponent("kept-ipas", isDirectory: true)
    try? FileManager.default.removeItem(at: dir)
    // which apps keep one
    check(OriginalIPA.keeps(source: "https://x.example/a.ipa", bundleID: "com.a", originalBundleID: "com.a", own: "com.me"), "a download keeps it")
    check(OriginalIPA.keeps(source: "HTTP://x.example/a.ipa", bundleID: "com.a", originalBundleID: "com.a", own: nil), "plain http too")
    check(!OriginalIPA.keeps(source: "library:a.ipa", bundleID: "com.a", originalBundleID: "com.a", own: "com.me"), "My IPAs has its own copy")
    check(!OriginalIPA.keeps(source: SelfIPA.url, bundleID: "com.me", originalBundleID: "com.me", own: "com.me"), "iFizBox from its bundle")
    check(!OriginalIPA.keeps(source: "https://x.example/me.ipa", bundleID: "com.me", originalBundleID: "com.me", own: "com.me"), "iFizBox itself")
    check(!OriginalIPA.keeps(source: "https://x.example/me.ipa", bundleID: "T.com.me", originalBundleID: "com.me", own: "com.me"), "iFizBox under another ID")
    check(OriginalIPA.url("../etc", in: dir) == nil && OriginalIPA.url("a/b", in: dir) == nil && OriginalIPA.url("", in: dir) == nil, "no path tricks")
    check(OriginalIPA.url("com.a", in: dir)?.lastPathComponent == "com.a.ipa", "Caches/<bundle ID>.ipa")

    // kept, taken back only when it matches the record
    let hashOf = { (u: URL) -> String? in (try? Data(contentsOf: u)).map { IPALibrary.hex(sha256($0)) } }
    let input = work.appendingPathComponent("kept-in.ipa")
    try Data("original".utf8).write(to: input)
    let sha = hashOf(input)!
    check(OriginalIPA.stage(input, bundleID: "com.a", sha256: sha, in: dir), "staged")
    check(!FileManager.default.fileExists(atPath: input.path), "moved, not copied")
    check(!OriginalIPA.stage(input, bundleID: "com.a", sha256: "nothex", in: dir), "a hash that isn't one")
    check(OriginalIPA.take("com.a", sha256: sha, to: work.appendingPathComponent("x.ipa"), in: dir, hash: hashOf) == .missing,
          "not kept until the install is recorded")
    OriginalIPA.commit("com.a", sha256: sha, in: dir)
    let out = work.appendingPathComponent("kept-out.ipa")
    check(OriginalIPA.take("com.a", sha256: sha.uppercased(), to: out, in: dir, hash: hashOf) == .file(out), "matching: taken")
    check((try? Data(contentsOf: out)) == Data("original".utf8), "the same bytes")
    try FileManager.default.removeItem(at: out)
    check(FileManager.default.fileExists(atPath: OriginalIPA.url("com.a", in: dir)!.path), "the kept one stays after the signer deletes its copy")
    check(OriginalIPA.take("com.a", sha256: nil, to: out, in: dir, hash: hashOf) == .unknown, "a record from before: no hash to check")
    check(OriginalIPA.take("com.b", sha256: sha, to: out, in: dir, hash: hashOf) == .missing, "never kept (or purged)")
    check(OriginalIPA.take("com.a", sha256: String(repeating: "0", count: 64), to: out, in: dir, hash: hashOf) == .mismatch, "another IPA")
    check(!FileManager.default.fileExists(atPath: OriginalIPA.url("com.a", in: dir)!.path), "a mismatch goes")

    // replaced on upgrade, once it is recorded; a failed upgrade leaves the one kept before
    let kept = OriginalIPA.url("com.a", in: dir)!
    try Data("v1".utf8).write(to: input)
    let v1 = hashOf(input)!
    OriginalIPA.stage(input, bundleID: "com.a", sha256: v1, in: dir)
    OriginalIPA.commit("com.a", sha256: v1, in: dir)
    try Data("v2".utf8).write(to: input)
    let v2 = hashOf(input)!
    OriginalIPA.stage(input, bundleID: "com.a", sha256: v2, in: dir)
    check((try? Data(contentsOf: kept)) == Data("v1".utf8), "staged: the installed version's stays")
    OriginalIPA.discard("com.a", sha256: v2, in: dir)
    check((try? Data(contentsOf: kept)) == Data("v1".utf8), "the upgrade failed: still v1")
    check(!FileManager.default.fileExists(atPath: OriginalIPA.pending("com.a", sha256: v2, in: dir)!.path), "and the staged one is gone")
    try Data("v2".utf8).write(to: input)
    OriginalIPA.stage(input, bundleID: "com.a", sha256: v2, in: dir)
    OriginalIPA.commit("com.a", sha256: v2, in: dir)
    check((try? Data(contentsOf: kept)) == Data("v2".utf8), "the upgrade recorded: v2 replaces it")
    OriginalIPA.commit("com.a", sha256: v1, in: dir)
    check((try? Data(contentsOf: kept)) == Data("v2".utf8), "nothing staged: commit changes nothing")

    // removed with the record
    func rec(_ bid: String, _ sha: String?) -> SignedRecord {
        SignedRecord(bundleID: bid, originalBundleID: bid, name: bid, version: "1", url: "https://x.example/\(bid).ipa", signed: Date(),
                     expires: nil, options: .init(name: nil, bundleID: nil, icon: nil, removeExtensions: [], fixArm64e: false), sha256: sha)
    }
    let old = [rec("com.a", "aa"), rec("com.b", "bb"), rec("com.c", "cc"), rec("com.d", nil)]
    let new = [rec("com.b", "b2"), rec("com.c", nil)]
    check(OriginalIPA.dropped(old: old, new: new) == ["com.a", "com.c"], "forgotten, or now from My IPAs: \(OriginalIPA.dropped(old: old, new: new))")
    check(OriginalIPA.dropped(old: old, new: old).isEmpty, "nothing changed")
    // the hash survives the record file
    let back = SignedRecords.decode(try SignedRecords.encode([rec("com.a", "aa")]))
    check(back.first?.sha256 == "aa", "sha256 stored")
    check(SignedRecords.decode(Data(#"[{"bundleID":"x","originalBundleID":"x","name":"x","version":"1","url":"u","signed":"2026-01-01T00:00:00Z","options":{"removeExtensions":[],"fixArm64e":false}}]"#.utf8)).first?.sha256 == nil, "an older record reads with none")
}

if failures == 0 { print("all passed") } else { print("\(failures) failed"); exit(1) }
