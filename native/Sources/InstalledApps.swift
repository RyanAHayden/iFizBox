// F374: Installed Apps (jailbreak build), the bridge for web/app/screens/userapps.js. The list itself is the helper's
// `user-apps` (backend-native.js userApps); this file adds what needs the shell:
//
//   apps.icon {bundleId}            -> {png: base64 | null}   the Home Screen icon (UIKit's own, 60 pt)
//   library.decrypt {bundleId, stream}   ifizbox-helper decrypt-app, then the IPA zipped into My IPAs
//                                   stream: {fd: "out" | "err" | "status", line} as helper.run's
//                                   -> {file, name, version, left: [path], ipas}
//   library.addTweaks {file, tweaks}     a copy of a library IPA with the tweaks in (the files under the .app, the
//                                   main executable's weak load commands: MachOEdit, as the signer does) -> {file, injected, ipas}
//   library.share {file}            the share sheet (Save to Files, AirDrop...) for a library IPA itself -> {shared}
//
// Decrypt: the helper writes only the decrypted Mach-O files (HELPER_DECRYPT_DIR/<id>/<path in the .app>); the rest
// of the .app is read where installd put it (bundles are readable by mobile). The IPA is Payload/<App>.app with the
// decrypted files in place of the encrypted ones. Left out: SC_Info folders (the App Store's per-account
// licence files) and any extension whose executable stayed encrypted (it couldn't run; the line says so). Never in
// it: iTunesMetadata.plist (beside the .app, with the Apple ID's details). The jailbreak's install-ipa signs it
// again (ldid) when it is installed, so no signature is kept or made here.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import UIKit

enum InstalledApps {
    static let dropDir = "/var/mobile/Library/Caches/com.ryha.ifizbox/decrypt" // = native/helper/decrypt.h HELPER_DECRYPT_DIR
    static let queue = DispatchQueue(label: "ifizbox.installedapps", qos: .userInitiated)
    static let deflateMax: UInt64 = 32 << 20 // bigger files are stored, read a piece at a time

    static func register(_ b: Bridge) {
        b.on("apps.icon") { c in icon(c) }
        b.on("library.decrypt") { c in decrypt(c) }
        b.on("library.addTweaks") { c in addTweaks(c) }
        b.on("library.share") { c in share(c) }
    }

    static func jailbreakOnly(_ c: Bridge.Call) -> Bool {
        guard AppMode.current == .jailbreak else { Apt.reply(c, nil, "sideload: Installed Apps is the jailbreak app's"); return false }
        return true
    }

    // ---- icons

    typealias IconFn = @convention(c) (AnyClass, Selector, NSString, Int32, CGFloat) -> UIImage?

    static func icon(_ c: Bridge.Call) {
        guard let id = c.params["bundleId"] as? String, !id.isEmpty else { return Apt.reply(c, nil, "bad_request: no bundleId") }
        DispatchQueue.main.async {
            let sel = NSSelectorFromString("_applicationIconImageForBundleIdentifier:format:scale:")
            var png: String?
            if let m = class_getClassMethod(UIImage.self, sel) {
                let f = unsafeBitCast(method_getImplementation(m), to: IconFn.self)
                // format 2: the Home Screen's 60 pt icon, already masked
                if let img = f(UIImage.self, sel, id as NSString, 2, UIScreen.main.scale), let d = img.pngData() {
                    png = d.base64EncodedString()
                }
            }
            c.reply(["png": png as Any], nil)
        }
    }

    // ---- decrypt

    struct Decrypted { let app: URL; let left: [String] }

    static func decrypt(_ c: Bridge.Call) {
        guard jailbreakOnly(c) else { return }
        guard let id = c.params["bundleId"] as? String, !id.isEmpty, !id.contains("/") else {
            return Apt.reply(c, nil, "bad_request: no bundleId")
        }
        let stream = (c.params["stream"] as? Bool) ?? false
        let emit: ([[String: Any]]) -> Void = { if stream { c.emitOnMain($0) } }
        let say: (String) -> Void = { emit([["fd": "out", "line": $0]]) }
        queue.async {
            let drop = URL(fileURLWithPath: dropDir).appendingPathComponent(id, isDirectory: true)
            defer { try? FileManager.default.removeItem(at: drop) }
            do {
                try FileManager.default.createDirectory(atPath: dropDir, withIntermediateDirectories: true)
                try? FileManager.default.removeItem(at: drop) // an earlier run's, cut short
                let r = try Helper.run(["decrypt-app", id], emit: emit)
                let out = r["stdout"] as? String ?? ""
                guard (r["code"] as? Int) == 0 else {
                    let why = lastHelperLine(r["stderr"] as? String ?? "") ?? "ifizbox-helper exited \(r["code"] ?? "?")"
                    throw SignError("decrypt", why)
                }
                let d = try parse(out)
                let plist = NSDictionary(contentsOf: d.app.appendingPathComponent("Info.plist")) as? [String: Any] ?? [:]
                let name = plist["CFBundleDisplayName"] as? String ?? plist["CFBundleName"] as? String ?? d.app.deletingPathExtension().lastPathComponent
                let version = plist["CFBundleShortVersionString"] as? String ?? plist["CFBundleVersion"] as? String ?? ""
                let wanted = [name, version].filter { !$0.isEmpty }.joined(separator: " ") + " (decrypted)"
                let tmp = MyIPAs.library.root.appendingPathComponent(".decrypt-\(SignBridge.token()).ipa")
                defer { try? FileManager.default.removeItem(at: tmp) }
                say("Packing \(IPALibrary.safeName(wanted))")
                let started = Date()
                try pack(app: d.app, decrypted: drop, left: d.left, to: tmp, say: say)
                let file = try MyIPAs.library.add(tmp, name: wanted, move: true)
                say(String(format: "Added %@ to My IPAs (%.1f s)", file, Date().timeIntervalSince(started)))
                var reply = MyIPAs.list()
                reply["file"] = file
                reply["name"] = name
                reply["version"] = version
                reply["left"] = d.left
                Apt.reply(c, reply, nil)
            } catch let e as BridgeError { Apt.reply(c, nil, e.text) }
            catch { Apt.reply(c, nil, SignBridge.text(error)) }
        }
    }

    static func lastHelperLine(_ err: String) -> String? {
        err.split(separator: "\n").last { $0.hasPrefix("ifizbox-helper: ") }.map { String($0.dropFirst(16)) }
    }

    // The helper's "App: <path>" and "Still encrypted <path>: <why>" lines.
    static func parse(_ out: String) throws -> Decrypted {
        var app: String?, left = [String]()
        for line in out.split(separator: "\n") {
            if line.hasPrefix("App: ") { app = String(line.dropFirst(5)) }
            else if line.hasPrefix("Still encrypted "), let colon = line.range(of: ": ", options: .backwards) {
                left.append(String(line[line.index(line.startIndex, offsetBy: 16)..<colon.lowerBound]))
            }
        }
        guard let a = app, a.hasSuffix(".app") else { throw SignError("decrypt", "ifizbox-helper didn't say where the app is") }
        return Decrypted(app: URL(fileURLWithPath: a, isDirectory: true), left: left)
    }

    // What of the .app stays out of the IPA: SC_Info folders, and each extension (.appex) holding a file still
    // encrypted. Paths are relative to the .app.
    static func leftOut(_ rel: String, left: [String]) -> Bool {
        let parts = rel.split(separator: "/")
        if parts.contains("SC_Info") { return true }
        for l in left {
            let lp = l.split(separator: "/")
            guard let x = lp.firstIndex(where: { $0.hasSuffix(".appex") }) else { continue }
            if parts.count > x, Array(parts[0...x]) == Array(lp[0...x]) { return true }
        }
        return false
    }

    static func pack(app: URL, decrypted: URL, left: [String], to out: URL, say: (String) -> Void) throws {
        let fm = FileManager.default
        let zip = try ZipWriter(url: out)
        let top = "Payload/\(app.lastPathComponent)/"
        try zip.add("Payload/", Data(), mode: 0o40755)
        try zip.add(top, Data(), mode: 0o40755)
        for l in left {
            if let x = l.range(of: ".appex/") { say("Left out \(l[..<x.lowerBound]).appex: still encrypted") }
        }
        guard let walk = fm.enumerator(atPath: app.path) else { throw SignError("decrypt", "can't read \(app.path)") }
        while let rel = walk.nextObject() as? String {
            if leftOut(rel, left: left) { continue }
            let src = app.appendingPathComponent(rel)
            let attrs = try fm.attributesOfItem(atPath: src.path)
            let type = attrs[.type] as? FileAttributeType
            let perm = UInt32((attrs[.posixPermissions] as? NSNumber)?.uint32Value ?? 0o644) & 0o7777
            if type == .typeDirectory {
                try zip.add(top + rel + "/", Data(), mode: 0o40000 | (perm == 0 ? 0o755 : perm))
            } else if type == .typeSymbolicLink {
                let target = try fm.destinationOfSymbolicLink(atPath: src.path)
                try zip.add(top + rel, Data(target.utf8), mode: 0o120755, level: 0)
            } else if type == .typeRegular {
                let mine = decrypted.appendingPathComponent(rel)
                let file = fm.fileExists(atPath: mine.path) ? mine : src
                try addFile(zip, top + rel, file, mode: 0o100000 | perm)
            }
        }
        zip.close()
    }

    static func addFile(_ zip: ZipWriter, _ name: String, _ file: URL, mode: UInt32) throws {
        let size = (try FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.uint64Value ?? 0
        if size <= deflateMax {
            try autoreleasepool { try zip.add(name, try Data(contentsOf: file), mode: mode) }
            return
        }
        // stored: the CRC first, a piece at a time, then the bytes copied the same way
        let h = try FileHandle(forReadingFrom: file)
        var crc: UInt32 = 0
        while true {
            let more: Bool = autoreleasepool {
                let d = h.readData(ofLength: 4 << 20)
                if d.isEmpty { return false }
                crc = d.withUnsafeBytes { p in UInt32(truncatingIfNeeded: crc32(UInt(crc), p.bindMemory(to: Bytef.self).baseAddress, uInt(d.count))) }
                return true
            }
            if !more { break }
        }
        h.closeFile()
        try zip.add(name, file: file, size: size, crc: crc, mode: mode)
    }

    // ---- Add Tweaks

    static func addTweaks(_ c: Bridge.Call) {
        guard jailbreakOnly(c) else { return }
        let file = c.params["file"] as? String ?? ""
        queue.async {
            do {
                guard let t = try TweakSet(json: c.params["tweaks"]) else { throw SignError("bad_options", "No tweaks to add.") }
                let src = try MyIPAs.library.url(file)
                let stem = file.lowercased().hasSuffix(".ipa") ? String(file.dropLast(4)) : file
                let tmp = MyIPAs.library.root.appendingPathComponent(".tweaks-\(SignBridge.token()).ipa")
                defer { try? FileManager.default.removeItem(at: tmp) }
                let injected = try withTweaks(src, t, to: tmp)
                let out = try MyIPAs.library.add(tmp, name: stem.replacingOccurrences(of: " (decrypted)", with: "") + " (tweaks)", move: true)
                var reply = MyIPAs.list()
                reply["file"] = out
                reply["injected"] = injected
                Apt.reply(c, reply, nil)
            } catch { Apt.reply(c, nil, SignBridge.text(error)) }
        }
    }

    // The IPA at src copied entry by entry (raw), the main executable with the load commands added, the tweak files
    // put under the .app (replacing any of the same path).
    static func withTweaks(_ src: URL, _ t: TweakSet, to out: URL) throws -> [String] {
        let zip = try ZipReader(url: src)
        guard let info = zip.entries.first(where: { e in
            let p = e.name.split(separator: "/", omittingEmptySubsequences: false)
            return p.count == 3 && p[0] == "Payload" && p[1].hasSuffix(".app") && p[2] == "Info.plist"
        }) else { throw SignError("bad_ipa", "The IPA has no Payload/<App>.app/Info.plist.") }
        let top = String(info.name.dropLast("Info.plist".count))
        let plist = (try? PropertyListSerialization.propertyList(from: try zip.data(info, limit: 8 << 20), format: nil)) as? [String: Any]
        guard let exe = plist?["CFBundleExecutable"] as? String, !exe.isEmpty, !exe.contains("/") else {
            throw SignError("bad_ipa", "The app's Info.plist names no executable.")
        }
        let replaced = Set(t.files.map { top + $0.path })
        let w = try ZipWriter(url: out)
        var injected = [String]()
        var found = false
        for e in zip.entries where !replaced.contains(e.name) {
            if e.name == top + exe {
                var data = try zip.data(e)
                if try encrypted(data) { throw SignError("encrypted", "This IPA is still encrypted. Decrypt it first.") }
                (data, injected) = try MachOEdit.inject(data, t.inject)
                try w.add(e.name, data, mode: e.unixMode)
                found = true
            } else {
                try w.copy(e, from: zip)
            }
        }
        guard found else { throw SignError("bad_ipa", "The app's executable \(exe) is missing.") }
        for f in t.files {
            let macho = f.data.count >= 4 && [0xfeedfacf, 0xcafebabe, 0xbebafeca].contains(f.data.prefix(4).withUnsafeBytes { $0.load(as: UInt32.self) })
            try w.add(top + f.path, f.data, mode: macho ? 0o100755 : 0o100644)
        }
        w.close()
        return injected
    }

    // Whether a 64-bit slice of the executable still has LC_ENCRYPTION_INFO_64 with cryptid != 0 (an App Store copy:
    // the load commands would go in, but the app couldn't run).
    static func encrypted(_ d: Data) throws -> Bool {
        for (off, _) in MachOEdit.slices(d) where off + 32 <= d.count && d.le32(at: off) == MachO.magic64 {
            for c in try MachOEdit.commands(d, at: off) where c.cmd == 0x2C && c.offset + 20 <= d.count {
                if d.le32(at: c.offset + 16) != 0 { return true }
            }
        }
        return false
    }

    // ---- Share

    static func share(_ c: Bridge.Call) {
        guard jailbreakOnly(c) else { return }
        let file = c.params["file"] as? String ?? ""
        let src: URL
        do { src = try MyIPAs.library.url(file) } catch { return Apt.reply(c, nil, SignBridge.text(error)) }
        DispatchQueue.main.async {
            guard let top = MyIPAs.topController() else { return c.reply(nil, "internal: no window to show the share sheet in") }
            let vc = UIActivityViewController(activityItems: [src], applicationActivities: nil)
            vc.completionWithItemsHandler = { _, done, _, _ in c.reply(["shared": done], nil) }
            if let pop = vc.popoverPresentationController {
                pop.sourceView = top.view
                pop.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.maxY, width: 1, height: 1)
            }
            top.present(vc, animated: true)
        }
    }
}
