// Signs a whole IPA on the phone (I6): every bundle inside out (frameworks and extensions before the app), each with
// its _CodeSignature/CodeResources, embedded.mobileprovision and Mach-O signatures. It works zip to zip: entries
// that signing doesn't change are copied compressed as they are, so a big game is read once and never unpacked to
// disk. What it does follows zsign (MIT) and Feather's SigningHandler (GPL-3.0) as docs/sideload.md (R5) read them.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

struct SignedApp {
    let bundleID: String
    let originalBundleID: String
    let name: String
    let version: String
    let removed: [String]     // what was left out (extensions an explicit profile can't cover, leftovers)
    var fixedArm64e: [String] = [] // binaries whose old-ABI arm64e slice was fixed up (F14, SignOptions.swift)
    var skipped: [String] = []     // B21: nested bundles whose executable is missing, sealed as resources;
                                   // B162: loose 32-bit-only Mach-Os, also sealed as resources
    var appID: String? = nil       // B138: the application-identifier it was signed with (TEAM.id)
    var injected: [String] = []    // F288: load paths added to the app's executable (Tweaks.swift)
    var groupFix: String? = nil    // B259: the group fix dylib's hash (SignerStamp.hash) when the app got it
}

final class IPASigner {
    private(set) var profile: Profile
    // Own provisioning profiles (native/Sources/ASC.swift): with an App Store Connect key set, the profile made for
    // this app (its bundle ID, the imported profile, the certificate DER, the log), or nil to keep the imported one.
    // Asked only when the app keeps its bundle ID (Keep Bundle IDs).
    static var autoProfile: ((String, Profile, Data, (String) -> Void) throws -> Profile?)?
    let identity: SigningIdentity
    var time = Date()
    var maxMachO: UInt64 = 1 << 31   // a single binary held in memory while it's signed
    var options = SignOptions()      // the user's edits (F14): name, bundle ID, icon, extensions left out
    // What signing skipped and why (B21), a line each; on the phone the device log, as the shell's other notes.
    var log: (String) -> Void = { NSLog("\(Brand.name): " + $0.replacingOccurrences(of: "%", with: "%%")) }
    // F196: true once the progress page's Cancel was tapped (SignJob): signing stops at the next file or bundle with
    // code "cancelled", and nothing is written.
    var stop: () -> Bool = { false }
    // R41: how the files signing changed go into the new IPA: 0 stores them (an IPA iOS fetches from this phone's
    // own install server), 1 (the default) deflates fast, 6 small (an IPA uploaded to a server). Level 6 ran at
    // 12 MB/s on the iPhone 7 and was most of the time a big app took to sign.
    var level: Int32 = 1
    // R41: read the IPA on this many threads at once (inflating and hashing every file); 1 for one at a time.
    var readers = max(1, min(ProcessInfo.processInfo.activeProcessorCount, 4))
    // B138: the application-identifier the app with this bundle ID was installed with (TEAM.id), or nil when it isn't
    // installed or that can't be told. An update must keep it (installd's error 15 otherwise): signing uses a
    // profile that gives it (AppIDMatch), or stops before signing anything with code "appid_mismatch".
    var installedAppID: ((String) -> String?)?

    init(profile: Profile, identity: SigningIdentity) {
        self.profile = profile
        self.identity = identity
    }

    private enum File {
        case entry(ZipEntry, sha1: Data, sha256: Data)
        case data(Data, mode: UInt32)
        case symlink(String, ZipEntry)
        // R41: a signed binary, kept in a file until the IPA is written (all of them in memory at once got a big
        // app killed by iOS), with its CRC and, when a CodeResources seals it, its hashes.
        // `packed`: the file holds it deflated (its size), nil: as it is.
        case spilled(URL, size: UInt64, crc: UInt32, packed: UInt64?, sha1: Data?, sha256: Data?, mode: UInt32)
    }

    private struct BundleInfo {
        let dir: String           // "Payload/X.app/PlugIns/Y.appex/"
        var plist: [String: Any]
        var format: PropertyListSerialization.PropertyListFormat
        var kind: String { (dir.dropLast() as Substring).split(separator: ".").last.map(String.init) ?? "" }
    }

    func sign(_ input: URL, to output: URL, progress: ((String, Double) -> Void)? = nil) throws -> SignedApp {
        let zip = try ZipReader(url: input)
        let parts = output.deletingLastPathComponent().appendingPathComponent(".\(output.lastPathComponent).parts")
        try? FileManager.default.removeItem(at: parts)
        defer { try? FileManager.default.removeItem(at: parts) }
        var spills = 0
        let mutex = NSLock() // spills and fixedArm64e: binaries are signed on several threads (signLoose)
        // A signed binary: in memory when small, else in its own file under `parts`. `sealed`: a CodeResources lists
        // it (every binary but the app's own executable), so its hashes are taken now, while it's in memory.
        func hold(_ d: Data, mode: UInt32, sealed: Bool) throws -> File {
            if d.count < 1 << 20 { return .data(d, mode: mode) }
            mutex.lock()
            if spills == 0 { try? FileManager.default.createDirectory(at: parts, withIntermediateDirectories: true) }
            spills += 1
            let u = parts.appendingPathComponent("\(spills)")
            mutex.unlock()
            var packed: UInt64?
            if level > 0 {
                let z = try deflateBlocks(d, level: level)
                try z.write(to: u)
                packed = UInt64(z.count)
            } else {
                try d.write(to: u)
            }
            var h1: Data?, h2: Data?
            if sealed { var h = Hasher2(); h.update(d); (h1, h2) = h.final() }
            return .spilled(u, size: UInt64(d.count), crc: crc32Of(d), packed: packed, sha1: h1, sha256: h2, mode: mode)
        }
        for e in zip.entries where e.name.hasPrefix("/") || e.name.split(separator: "/").contains("..") || e.name.contains("\\") {
            throw SignError("bad_ipa", "The IPA has a file outside its folder (\(e.name)).")
        }
        let infos = zip.entries.filter {
            let parts = $0.name.split(separator: "/", omittingEmptySubsequences: false)
            return parts.count == 3 && parts[0] == "Payload" && parts[1].hasSuffix(".app") && parts[2] == "Info.plist"
        }
        guard infos.count == 1 else {
            throw SignError("bad_ipa", infos.isEmpty ? "That isn't an IPA (no Payload/<App>.app/Info.plist)." : "The IPA holds more than one app.")
        }
        let appDir = String(infos[0].name.dropLast("Info.plist".count))

        // What goes: old signatures and profiles (made again below), Watch placeholders, macOS litter.
        var removed = [String]()
        func dropped(_ name: String) -> Bool {
            if name.hasPrefix("__MACOSX/") || name.hasSuffix("/.DS_Store") || name == ".DS_Store" { return true }
            guard name.hasPrefix(appDir) else { return false }
            let rel = name.dropFirst(appDir.count)
            if rel.contains("com.apple.WatchPlaceholder/") || rel.hasSuffix("SignedByEsign") { return true }
            if rel.hasSuffix("_CodeSignature/CodeResources") || rel.hasSuffix("_CodeSignature/") { return true }
            if rel.hasSuffix("embedded.mobileprovision") { return true }
            return false
        }

        // Bundles: any folder under the app with its own Info.plist and an executable.
        var bundles = [String: BundleInfo]()
        var skipped = [String]()
        let names = Set(zip.entries.map(\.name))
        for e in zip.entries where e.name.hasPrefix(appDir) && e.name.hasSuffix("/Info.plist") && !dropped(e.name) {
            let dir = String(e.name.dropLast("Info.plist".count))
            let ext = dir.dropLast().split(separator: ".").last ?? ""
            guard dir == appDir || ["app", "appex", "framework", "xctest", "bundle"].contains(String(ext)) else { continue }
            if dir.dropFirst(appDir.count).contains("Resources/") && ext != "app" && ext != "appex" && ext != "framework" { continue }
            var format = PropertyListSerialization.PropertyListFormat.binary
            guard let pl = try? PropertyListSerialization.propertyList(from: try zip.data(e, limit: 16 << 20), format: &format) as? [String: Any]
            else { if dir == appDir { throw SignError("bad_ipa", "The app's Info.plist can't be read.") }; continue }
            // A resource bundle: sealed as files. An empty CFBundleExecutable counts (YouMod's DontEatMyContent.bundle):
            // dir + "" is the folder itself, which used to pass the check below and fail with "X.bundle/ is missing".
            if dir != appDir && (pl["CFBundleExecutable"] as? String ?? "").isEmpty { continue }
            // B21: a nested bundle naming an executable that isn't there (a tweak's .bundle in a modded IPA, YouMod's
            // YTUHD.bundle) has nothing to sign: sealed as files like a resource bundle, as zsign and Feather do.
            // The app's own executable missing stays an error (below).
            if dir != appDir, let exe = pl["CFBundleExecutable"] as? String, !names.contains(dir + exe) {
                let rel = String(dir.dropFirst(appDir.count).dropLast())
                skipped.append(rel)
                log("Skipped \(rel): its executable \(exe) is missing, sealed as resources")
                continue
            }
            bundles[dir] = BundleInfo(dir: dir, plist: pl, format: format)
        }
        guard var main = bundles[appDir], let oldID = main.plist["CFBundleIdentifier"] as? String else {
            throw SignError("bad_ipa", "The app has no bundle ID.")
        }
        // F237: kept, Info.plist keeps the ID and only the entitlements carry the profile's App ID (entID).
        let keep = options.keeps(options.bundleID ?? oldID)
        let imported = profile
        if keep, let auto = IPASigner.autoProfile, let made = try auto(options.bundleID ?? oldID, profile, identity.certificate, log) {
            profile = made
        }
        let (newID, firstEntID) = try profile.signingIDs(for: options.bundleID ?? oldID, keep: keep)
        var entID = firstEntID
        // B138: an app on the phone keeps the application-identifier it was installed with
        if let have = installedAppID?(newID), have != "\(profile.team).\(entID)" {
            let others = [profile, imported].reduce(into: [Profile]()) { l, p in if !l.contains(where: { $0.data == p.data }) { l.append(p) } }
            guard let m = AppIDMatch.pick(others, installed: have) else {
                let name = main.plist["CFBundleDisplayName"] as? String ?? main.plist["CFBundleName"] as? String ?? options.name ?? ""
                log("Installed under App ID \(have); no profile here gives it (this one gives \(profile.team).\(entID))")
                throw AppIDMatch.mismatch(name: options.name ?? name, installed: have, profile: profile, wouldBe: "\(profile.team).\(entID)")
            }
            log("Installed under App ID \(have): signed with that (profile \(m.profile.name))")
            profile = m.profile
            entID = m.entitlementsID // the bundle ID stays the one it is installed as
        }

        // An explicit profile covers one app ID: extensions (and Watch apps) would need their own, so they go. Kept
        // IDs keep them (R25): each extension keeps its own Info.plist ID, prefixed by the app's as iOS requires,
        // and is signed under the app's application-identifier.
        var cut = [String]()
        if !profile.isWildcard && !keep {
            for dir in bundles.keys.sorted() where dir != appDir && (dir.hasSuffix(".appex/") || dir.hasSuffix(".app/")) { // sorted: a Dictionary's order changes per run
                cut.append(dir)
            }
        }
        for path in options.removeExtensions { // the ones the user left out (F14)
            let dir = appDir + path + "/"
            guard bundles[dir] != nil, path.hasSuffix(".appex") || path.hasSuffix(".app") else {
                throw SignError("bad_options", "The app has no extension \(path).")
            }
            cut.append(dir)
        }
        cut = cut.filter { c in !cut.contains { $0 != c && c.hasPrefix($0) } }
        for c in cut { removed.append(String(c.dropFirst(appDir.count).dropLast())); }
        bundles = bundles.filter { k, _ in !cut.contains { k.hasPrefix($0) } }
        log("App \(appDir.dropFirst(8).dropLast()): \(oldID)" + (newID == oldID ? "" : " -> \(newID)") + ", \(zip.entries.count) files")
        if keep && entID != newID { log("Kept its bundle ID; App ID \(profile.team).\(entID) in the entitlements") }
        for r in removed { log("Left out \(r)" + (profile.isWildcard || keep ? "" : " (the profile covers one app ID)")) }
        func gone(_ name: String) -> Bool { dropped(name) || cut.contains { name.hasPrefix($0) } }

        // New bundle IDs: the app's, and the extensions' that start with the app's old one.
        func moved(_ id: String) -> String { id == oldID ? newID : id.hasPrefix(oldID + ".") ? newID + id.dropFirst(oldID.count) : id }
        var changed = [String: Data]() // path -> new contents
        for (dir, var b) in bundles where dir.hasSuffix(".app/") || dir.hasSuffix(".appex/") {
            var pl = b.plist
            if let id = pl["CFBundleIdentifier"] as? String { pl["CFBundleIdentifier"] = moved(id) }
            if let id = pl["WKCompanionAppBundleIdentifier"] as? String { pl["WKCompanionAppBundleIdentifier"] = moved(id) }
            if var ext = pl["NSExtension"] as? [String: Any], var at = ext["NSExtensionAttributes"] as? [String: Any],
               let id = at["WKAppBundleIdentifier"] as? String {
                at["WKAppBundleIdentifier"] = moved(id); ext["NSExtensionAttributes"] = at; pl["NSExtension"] = ext
            }
            pl.removeValue(forKey: "UISupportedDevices")
            if dir == appDir { options.apply(toApp: &pl) }
            if !NSDictionary(dictionary: pl).isEqual(to: b.plist) {
                changed[dir + "Info.plist"] = try PropertyListSerialization.data(fromPropertyList: pl, format: b.format, options: 0)
                b.plist = pl
                bundles[dir] = b
            }
        }
        main = bundles[appDir]!

        // One pass over every kept file: hashes for CodeResources, and which ones are Mach-O.
        var files = [String: File]()
        var machos = Set<String>()
        let kept = zip.entries.filter { !gone($0.name) }
        let order = kept.map(\.name)
        let totalBytes = max(1, kept.reduce(UInt64(0)) { $0 + $1.size })
        for e in kept where e.isSymlink && !e.isDirectory {
            files[e.name] = .symlink(String(decoding: try zip.data(e, limit: 4096), as: UTF8.self), e)
        }
        let read = try readAll(zip, kept.filter { !$0.isDirectory && !$0.isSymlink }, total: totalBytes, progress: progress)
        for (e, r) in read {
            files[e.name] = .entry(e, sha1: r.sha1, sha256: r.sha256)
            if e.name.hasPrefix(appDir) && r.macho { machos.insert(e.name) }
        }
        log("Read \(kept.count) files (\(ByteCountFormatter.string(fromByteCount: Int64(totalBytes), countStyle: .file))), \(machos.count) Mach-O, \(bundles.count) bundles to sign")
        for (path, d) in changed { files[path] = .data(d, mode: 0o100644) }
        // The user's name in the app's own localisations, and the user's icon (F14).
        if options.name != nil {
            for e in kept where e.name.hasPrefix(appDir) && !e.isDirectory {
                let rel = e.name.dropFirst(appDir.count).split(separator: "/")
                guard rel.count == 2, rel[0].hasSuffix(".lproj"), rel[1] == "InfoPlist.strings" else { continue }
                if let d = options.renamedStrings(try zip.data(e, limit: 1 << 20)) { files[e.name] = .data(d, mode: 0o100644) }
            }
        }
        if let icon = options.icon { for f in options.iconFiles { files[appDir + f] = .data(icon, mode: 0o100644) } }
        // F329a: your own icon over the own-icon sets' files (Info.plist untouched: its alternate icons stay)
        for (f, png) in options.ownIconFiles.sorted(by: { $0.key < $1.key }) { files[appDir + f] = .data(png, mode: 0o100644) }
        if !options.ownIconFiles.isEmpty { log("Own icon: \(options.ownIconFiles.count) files of the own-icon sets replaced") }
        // B211: the original signature's app groups and keychain groups, read before signing, decide whether the app
        // gets the group fix (GroupFix.swift) beside the user's tweaks; never iFizBox's own IPA.
        var tweaks = options.tweaks
        var groupFix: String? = nil // B259: kept in the record's SignerStamp
        // B327: every sign logs the keychain groups the app gets and the group fix it got (or why none), so a report of
        // an app that lost its data can be read from Console Logs
        let appEnts = profile.entitlements(for: entID, keptID: keep ? newID : nil)
        log(Profile.keychainLine(appEnts))
        if oldID == SignOptions.selfBundleID {
            log(GroupFix.logLine(nil, none: "\(Brand.name)'s own IPA"))
        } else if let exe = main.plist["CFBundleExecutable"] as? String, files[appDir + exe] != nil {
            let plan = GroupFix.plan(original: Inspect.entitlements(try contents(appDir + exe, files, zip)), profile: appEnts,
                                     previous: files[appDir + GroupFix.configPath] == nil ? nil : try? contents(appDir + GroupFix.configPath, files, zip))
            if let plan = plan, let dylib = GroupFix.dylib() {
                tweaks = try GroupFix.adding(plan, dylib: dylib, to: tweaks)
                groupFix = SignerStamp.hash(dylib)
                log(GroupFix.logLine(plan))
                if let lost = plan.lost { log("Warning: this profile has no \(lost), where the app kept its shared data until now; iOS keeps that folder from it") }
            } else {
                log(GroupFix.logLine(nil, none: plan == nil ? GroupFix.notNeeded : "this build has no fix dylib, the app's groups go unmapped"))
            }
        } else {
            log(GroupFix.logLine(nil, none: "the app's executable is missing"))
        }
        // F288: the tweaks' files go in (over any the app has at those paths); their frameworks are bundles to sign
        if let t = tweaks {
            for f in t.files {
                let isMachO = MachO.isMachO([UInt8](f.data.prefix(4)))
                files[appDir + f.path] = .data(f.data, mode: isMachO ? 0o100755 : 0o100644)
                if isMachO { machos.insert(appDir + f.path) }
            }
            for f in t.files where f.path.hasSuffix(".framework/Info.plist") && f.path.split(separator: "/").count == 3 {
                let dir = appDir + String(f.path.dropLast("Info.plist".count))
                var format = PropertyListSerialization.PropertyListFormat.binary
                guard let pl = try? PropertyListSerialization.propertyList(from: f.data, format: &format) as? [String: Any],
                      let exe = pl["CFBundleExecutable"] as? String, files[dir + exe] != nil else { continue } // else its binary is a loose one
                bundles[dir] = BundleInfo(dir: dir, plist: pl, format: format)
            }
            if !t.names.isEmpty { log("Tweaks: \(t.names.joined(separator: ", ")) (\(t.files.count) files)") }
        }
        var injected = [String]()

        var fixedArm64e = [String]()
        var thin32 = [String]() // B162: loose Mach-Os with no 64-bit code, left unsigned and sealed as resources
        func fixed(_ path: String, _ data: Data) -> Data {
            guard options.fixArm64e else { return data }
            let (d, changed) = Arm64e.fixup(data)
            if changed { mutex.lock(); fixedArm64e.append(String(path.dropFirst(appDir.count))); mutex.unlock() }
            return d
        }

        // Sign inside out: deepest bundles first, the app last.
        let dirs = bundles.keys.sorted { $0.split(separator: "/").count > $1.split(separator: "/").count }
        for (n, dir) in dirs.enumerated() {
            let b = bundles[dir]!
            let inner = dirs.filter { $0 != dir && $0.hasPrefix(dir) }
            let exe = (b.plist["CFBundleExecutable"] as? String).map { dir + $0 }
            let isApp = dir.hasSuffix(".app/") || dir.hasSuffix(".appex/")
            let id = b.plist["CFBundleIdentifier"] as? String ?? (dir.dropLast().split(separator: "/").last.map { String($0.split(separator: ".")[0]) } ?? "unknown")

            // Loose Mach-Os of this bundle (dylibs in Frameworks/, helpers): signed with no entitlements.
            // B65: each one moves the bar within the bundle's share, so a big main bundle doesn't sit at "Signing 50%".
            let loose = machos.sorted().filter { p in p.hasPrefix(dir) && p != exe && !inner.contains(where: { p.hasPrefix($0) }) }
            // R41: side by side on `readers` threads (a game's 128 emulator cores, a framework's dylibs)
            let current = files
            let signedLoose = try parallel(loose.count, zip, done: { k in
                if k > 0 { progress?("signing", (Double(n) + Double(k) / Double(loose.count + 1)) / Double(dirs.count)) }
                return !self.stop()
            }) { k, reader -> File? in
                let path = loose[k]
                let data = fixed(path, try self.contents(path, current, reader))
                guard let ft = MachO.filetype(data), [2, 6, 8].contains(ft) else { return nil } // executables, dylibs, bundles
                // B162: 32-bit-only code (armv7 cores in an old emulator's modules/) can't run on iOS 15+: sealed
                // as a resource like any other file, as zsign and Feather leave it, instead of failing the IPA.
                guard MachO.has64BitCode(data) else {
                    let rel = String(path.dropFirst(appDir.count))
                    mutex.lock(); thin32.append(rel); mutex.unlock()
                    return nil
                }
                let name = String(path.split(separator: "/").last!)
                let ident = name.hasSuffix(".dylib") ? String(name.dropLast(6)) : name
                let m = self.mode(path, current)
                return try hold(try MachO.sign(consume data, CodeSignParams(identifier: ident, team: self.profile.team), self.identity,
                                               time: self.time), mode: m, sealed: true)
            }
            for (k, f) in signedLoose.enumerated() { if let f = f { files[loose[k]] = f } }
            if !loose.isEmpty { progress?("signing", (Double(n) + Double(loose.count) / Double(loose.count + 1)) / Double(dirs.count)) }
            if isApp { files[dir + "embedded.mobileprovision"] = .data(profile.data, mode: 0o100644) }
            let infoData = try contents(dir + "Info.plist", files, zip)
            let resources = try codeResources(dir: dir, exe: exe, files: files, order: order + newPaths(files, order))
            files[dir + "_CodeSignature/CodeResources"] = .data(resources, mode: 0o100644)
            if let exe = exe {
                guard files[exe] != nil else { throw SignError("bad_ipa", "\(exe.dropFirst(appDir.count)) is missing.") }
                var data = fixed(exe, try contents(exe, files, zip))
                if dir == appDir, let t = tweaks, !t.inject.isEmpty { // F288
                    (data, injected) = try MachOEdit.inject(data, t.inject)
                    for i in injected { log("Injected \(i)") }
                }
                let params = CodeSignParams(identifier: id, team: profile.team,
                                            entitlements: isApp ? profile.entitlements(for: keep || id == newID ? entID : id, keptID: keep ? newID : nil) : nil,
                                            infoPlist: infoData, codeResources: resources)
                let m = mode(exe, files)
                files[exe] = try hold(try MachO.sign(consume data, params, identity, time: time), mode: m, sealed: dir != appDir)
            }
            let rel = dir == appDir ? String(appDir.dropFirst(8).dropLast()) : String(dir.dropFirst(appDir.count).dropLast())
            log("Signed \(rel) (\(id))" + (isApp ? ", with the profile's entitlements" : ""))
            progress?("signing", Double(n + 1) / Double(dirs.count))
            if stop() { throw SignJob.cancelledError }
        }

        for f in fixedArm64e { log("Fixed the old arm64e slice of \(f)") }
        for f in thin32.sorted() { log("Skipped \(f): 32-bit only, iOS 15+ can't load it, sealed as a resource") }
        skipped += thin32
        if stop() { throw SignJob.cancelledError }
        // Write: kept entries in their order (copied raw when untouched), then the new files.
        let out = try ZipWriter(url: output)
        var written = Set<String>()
        var folders = [String: ZipEntry]()
        for e in kept where e.isDirectory { folders[e.name] = e }
        for name in order + newPaths(files, order) where !written.contains(name) {
            written.insert(name)
            if name.hasSuffix("/") {
                if let e = folders[name] { try out.copy(e, from: zip) }
                continue
            }
            switch files[name] {
            case .entry(let e, _, _)?: try out.copy(e, from: zip)
            case .symlink(_, let e)?: try out.copy(e, from: zip)
            case .data(let d, let m)?: try out.add(name, d, mode: m, level: level)
            case .spilled(let u, let size, let crc, let packed, _, _, let m)?:
                try out.add(name, file: u, size: size, crc: crc, packed: packed, mode: m)
                try? FileManager.default.removeItem(at: u)
            case nil: break
            }
            if stop() { throw SignJob.cancelledError }
        }
        out.close()
        return SignedApp(bundleID: newID, originalBundleID: oldID,
                         name: main.plist["CFBundleDisplayName"] as? String ?? main.plist["CFBundleName"] as? String ?? "",
                         version: main.plist["CFBundleShortVersionString"] as? String ?? main.plist["CFBundleVersion"] as? String ?? "",
                         removed: removed.sorted(), fixedArm64e: fixedArm64e.sorted(), skipped: skipped.sorted(),
                         appID: "\(profile.team).\(entID)", injected: injected, groupFix: groupFix)
    }

    private struct Read { let sha1: Data, sha256: Data, macho: Bool }

    // R41: body(i, reader) for every i in 0..<n on `readers` threads, each with its own handle on the IPA, in order of
    // i as threads come free. `done(k)` runs on the calling thread (its callers expect that thread) each time it has
    // finished one, with how many have finished in all; false stops the rest (SignJob.cancelledError). The results,
    // by i.
    private func parallel<T>(_ n: Int, _ zip: ZipReader, done: @escaping (Int) -> Bool,
                             _ body: @escaping (Int, ZipReader) throws -> T?) throws -> [T?] {
        var results = [T?](repeating: nil, count: n)
        let lock = NSLock()
        var next = 0, finished = 0
        var failure: Error?
        func worker(_ reader: ZipReader, reports: Bool) {
            while true {
                lock.lock()
                if failure != nil || next >= n { lock.unlock(); return }
                let i = next; next += 1
                lock.unlock()
                do {
                    let r = try body(i, reader)
                    lock.lock(); results[i] = r; finished += 1; let k = finished; lock.unlock()
                    if reports && !done(k) { lock.lock(); failure = failure ?? SignJob.cancelledError; lock.unlock(); return }
                } catch {
                    lock.lock(); failure = failure ?? error; lock.unlock()
                    return
                }
            }
        }
        let helpers = n < 2 ? 0 : min(readers, n) - 1
        let group = DispatchGroup()
        for _ in 0..<helpers {
            let r = try zip.clone()
            DispatchQueue.global(qos: .userInitiated).async(group: group) { worker(r, reports: false) }
        }
        if n > 0 && !done(0) { lock.lock(); failure = SignJob.cancelledError; lock.unlock() }
        worker(zip, reports: true)
        group.wait()
        if let f = failure { throw f }
        return results
    }

    // R41: every file inflated and hashed (SHA-1 and SHA-256, for CodeResources) once, on `readers` threads, each
    // with its own handle on the IPA; the biggest files first, so one big file doesn't run on alone at the end.
    // Progress and stop() are asked on the calling thread only (its callers expect that thread).
    private func readAll(_ zip: ZipReader, _ entries: [ZipEntry], total: UInt64,
                         progress: ((String, Double) -> Void)?) throws -> [(ZipEntry, Read)] {
        let work = entries.indices.sorted { entries[$0].size > entries[$1].size }
        var results = [Read?](repeating: nil, count: entries.count)
        let lock = NSLock()
        var next = 0, doneBytes: UInt64 = 0
        var failure: Error?
        func fail(_ e: Error) { lock.lock(); failure = failure ?? e; lock.unlock() }
        // The calling thread reports, a piece at a time, how far all the threads have got.
        func report() -> Bool {
            lock.lock(); let done = doneBytes; let failed = failure != nil; lock.unlock()
            if failed { return false }
            progress?("reading", Double(done) / Double(total))
            if stop() { fail(SignJob.cancelledError); return false }
            return true
        }
        func worker(_ reader: ZipReader, reports: Bool) {
            while true {
                lock.lock()
                if failure != nil || next >= work.count { lock.unlock(); return }
                let i = work[next]; next += 1
                lock.unlock()
                let e = entries[i]
                do {
                    var h = Hasher2()
                    var head = [UInt8]()
                    var sinceReport = 0
                    try reader.read(e) { piece in
                        if head.count < 4 { head += piece.prefix(4 - head.count) }
                        h.update(piece)
                        lock.lock(); doneBytes += UInt64(piece.count); lock.unlock()
                        sinceReport += piece.count
                        if reports && sinceReport >= 4 << 20 {
                            sinceReport = 0
                            if !report() { throw SignJob.cancelledError }
                        }
                    }
                    let (s1, s256) = h.final()
                    lock.lock(); results[i] = Read(sha1: s1, sha256: s256, macho: MachO.isMachO(head)); lock.unlock()
                    if reports && !report() { return }
                } catch {
                    fail(error)
                    return
                }
            }
        }
        let helpers = entries.count < 8 ? 0 : readers - 1
        let group = DispatchGroup()
        for _ in 0..<helpers {
            let r = try zip.clone()
            DispatchQueue.global(qos: .userInitiated).async(group: group) { worker(r, reports: false) }
        }
        worker(zip, reports: true)
        while group.wait(timeout: .now() + 0.25) == .timedOut { _ = report() } // the helpers' last files
        if let f = failure { throw f }
        progress?("reading", 1)
        return entries.indices.map { (entries[$0], results[$0]!) }
    }

    private func newPaths(_ files: [String: File], _ order: [String]) -> [String] {
        let known = Set(order)
        return files.keys.filter { !known.contains($0) }.sorted()
    }

    private func mode(_ path: String, _ files: [String: File]) -> UInt32 {
        if case .entry(let e, _, _)? = files[path] { return e.unixMode & 0o170000 == 0 ? 0o100755 : e.unixMode }
        if case .data(_, let m)? = files[path] { return m }
        if case .spilled(_, _, _, _, _, _, let m)? = files[path] { return m }
        return 0o100755
    }

    private func contents(_ path: String, _ files: [String: File], _ zip: ZipReader) throws -> Data {
        switch files[path] {
        // R41: room for the signature, so appending it doesn't move a big binary (cdSize is 32 bytes a 4 KB page)
        case .entry(let e, _, _)?: return try zip.data(e, limit: maxMachO, spare: Int(min(e.size, maxMachO) / 64) + (64 << 10))
        case .data(let d, _)?: return d
        case .spilled(let u, _, _, let packed, _, _, _)?:
            guard packed == nil else { throw SignError("internal", "\(path) was signed twice") }
            return try Data(contentsOf: u)
        default: throw SignError("bad_ipa", "\(path) is missing.")
        }
    }

    // _CodeSignature/CodeResources: every file in the bundle but its executable and this file, nested bundles'
    // files included (as zsign seals them), with SHA-1 (files) and SHA-1 + SHA-256 (files2) hashes, and the rules
    // Xcode writes.
    private func codeResources(dir: String, exe: String?, files: [String: File], order: [String]) throws -> Data {
        var f1 = [String: Any](), f2 = [String: Any]()
        for path in Set(order) where path.hasPrefix(dir) && !path.hasSuffix("/") && path != exe {
            let rel = String(path.dropFirst(dir.count))
            if rel == "_CodeSignature/CodeResources" { continue }
            let optional = rel.range(of: #"(^|/)[^/]+\.lproj/"#, options: .regularExpression) != nil
                && !rel.hasPrefix("Base.lproj/")
            let omit2 = rel == "Info.plist" || rel == "PkgInfo" || rel.hasSuffix(".DS_Store")
            let h1: Data, h2: Data
            switch files[path] {
            case .entry(_, let a, let b)?: h1 = a; h2 = b
            case .data(let d, _)?: h1 = sha1(d); h2 = sha256(d)
            case .spilled(_, _, _, _, let a?, let b?, _)?: h1 = a; h2 = b
            case .spilled(_, _, _, _, _, _, _)?: throw SignError("internal", "\(path) has no hashes")
            case .symlink(let target, _)?:
                if !omit2 { f2[rel] = ["symlink": target] }
                continue
            case nil: continue
            }
            if rel.hasSuffix("lproj/locversion.plist") { continue }
            f1[rel] = optional ? ["hash": h1, "optional": true] : h1
            if !omit2 { f2[rel] = optional ? ["hash": h1, "hash2": h2, "optional": true] : ["hash": h1, "hash2": h2] }
        }
        let rules: [String: Any] = [
            "^.*": true,
            "^.*\\.lproj/": ["optional": true, "weight": 1000],
            "^.*\\.lproj/locversion.plist$": ["omit": true, "weight": 1100],
            "^Base\\.lproj/": ["weight": 1010],
            "^version.plist$": true,
        ]
        let rules2: [String: Any] = [
            ".*\\.dSYM($|/)": ["weight": 11],
            "^(.*/)?\\.DS_Store$": ["omit": true, "weight": 2000],
            "^.*": true,
            "^.*\\.lproj/": ["optional": true, "weight": 1000],
            "^.*\\.lproj/locversion.plist$": ["omit": true, "weight": 1100],
            "^Base\\.lproj/": ["weight": 1010],
            "^Info\\.plist$": ["omit": true, "weight": 20],
            "^PkgInfo$": ["omit": true, "weight": 20],
            "^embedded\\.provisionprofile$": ["weight": 20],
            "^version\\.plist$": ["weight": 20],
        ]
        return try PropertyListSerialization.data(fromPropertyList: ["files": f1, "files2": f2, "rules": rules, "rules2": rules2],
                                                  format: .xml, options: 0)
    }
}
