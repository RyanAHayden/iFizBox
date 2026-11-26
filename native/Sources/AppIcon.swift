// F323: the Home Screen icon follows the theme (Settings > Theme > App Icon). The page works out which icon each
// mode shows (web/app/appicon.js: Match Theme gives the themes' icons, else the Light and Dark picks) and sends
//   app.icon {light, dark, onScreen} -> {name, changed, quiet}
// light/dark: the icon iOS should draw on a light and on a dark Home Screen; onScreen: the icon of the tone the app
// shows now. The shell picks the set (icon/alternates.py lists them, Info.plist's CFBundleAlternateIcons names them)
// and switches with setAlternateIconName; `name` is the set ("AppIcon" for the primary), `changed` whether it
// switched, `quiet` whether it went without iOS's "You have changed the icon" alert.
//
// iOS 18+ draws a set's dark appearance on a dark Home Screen, so a (light, dark) pair set does both modes. Pairs
// exist for every light theme or Clear with every dark theme or Clear; anything else (a dark theme's icon picked for
// Light), and iOS 15-17, which only draw the light one, get the one-icon set of the theme on screen. The primary,
// AppIcon, is the default pair (Classic, Gunmetal).
//
// The jailbreak build switches through UIApplication's private _setAlternateIconName:completionHandler:, which
// skips the alert; the sideload build uses the public call and iOS shows its alert (Theme's footer says so).
// iOS only switches while the app is active: a call that comes earlier waits for didBecomeActive.
// SPDX-License-Identifier: GPL-3.0-or-later
import UIKit

enum AppIcon {
    static let primary = (light: "classic", dark: "gunmetal")

    // Info.plist's alternate set names.
    static let sets: Set<String> = {
        let icons = Bundle.main.infoDictionary?["CFBundleIcons"] as? [String: Any]
        return Set((icons?["CFBundleAlternateIcons"] as? [String: Any]).map { Array($0.keys) } ?? [])
    }()

    // The set for these icons; nil is the primary. `variants`: iOS draws appearance variants (18+).
    static func setName(light: String, dark: String, onScreen: String, variants: Bool, sets: Set<String>) -> String? {
        if variants {
            if light == primary.light && dark == primary.dark { return nil }
            let pair = light == dark ? "Icon-\(light)" : "Icon-\(light)-\(dark)"
            if sets.contains(pair) { return pair }
        } else if onScreen == primary.light {
            return nil
        }
        let one = "Icon-\(onScreen)"
        return sets.contains(one) ? one : nil
    }

    static var variants: Bool { if #available(iOS 18.0, *) { return true } else { return false } }

    // B256: the set on screen. iOS 27 reads alternateIconName as nil right after a switch to a set, so whenever iOS
    // reads nil it's the last set the shell switched to (kept in UserDefaults by apply, "" for the primary). Every
    // reading of the set on screen goes through here (apply's unchanged check, OwnIcons.pick's current).
    static let shownKey = "ifizbox.appIcon.shown"
    static func shown(ios: String?, kept: String?) -> String? { ios ?? kept.flatMap { $0.isEmpty ? nil : $0 } }
    // On the main queue.
    static var onScreen: String? {
        shown(ios: UIApplication.shared.alternateIconName, kept: UserDefaults.standard.string(forKey: shownKey))
    }
    static func keepShown(_ name: String?) { UserDefaults.standard.set(name ?? "", forKey: shownKey) }

    static func register(_ b: Bridge) {
        OwnIcons.register(b) // F329
        b.on("app.icon") { c in
            let word = { (k: String) -> String? in
                guard let s = c.params[k] as? String, s.range(of: "^[a-z0-9]{1,24}$", options: .regularExpression) != nil
                else { return nil }
                return s
            }
            guard let light = word("light"), let dark = word("dark"), let shown = word("onScreen") else {
                return c.reply(nil, "bad_params: light, dark and onScreen are icon names")
            }
            // F329: with your own icon in either mode, the icon of the tone on screen (loose sets have no dark look)
            if [light, dark, shown].contains(where: OwnIcons.isOwn) { return OwnIcons.applyShown(shown, c) }
            let name = setName(light: light, dark: dark, onScreen: shown, variants: variants, sets: sets)
            DispatchQueue.main.async {
                whenActive(dropped: { c.reply(["name": name ?? "AppIcon", "changed": false, "quiet": false], nil) }) {
                    switchTo(name) { changed, quiet, err in
                        if let err = err { return c.reply(nil, "failed: \(err)") }
                        c.reply(["name": name ?? "AppIcon", "changed": changed, "quiet": quiet], nil)
                    }
                }
            }
        }
    }

    // Runs `f` now if the app is active, else once it becomes active (the latest call wins). On the main queue.
    // B243: a call the latest replaces runs its `dropped` instead (it answers unchanged, so its promise settles).
    private static var waiting: (() -> Void)?
    private static var waitingDropped: (() -> Void)?
    private static var observer: NSObjectProtocol?
    static func whenActive(dropped: (() -> Void)? = nil, _ f: @escaping () -> Void) {
        let before = waitingDropped
        waitingDropped = nil
        if UIApplication.shared.applicationState == .active { waiting = nil; before?(); return f() }
        waiting = f
        waitingDropped = dropped
        before?()
        guard observer == nil else { return }
        observer = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification,
                                                          object: nil, queue: .main) { _ in
            let f = waiting
            waiting = nil
            waitingDropped = nil
            f?()
        }
    }

    // B243: one switch at a time. iOS refuses a setAlternateIconName that comes while the last one is still going
    // (its alert still up, in the sideload build), so a call that comes then waits for it; only the latest waiting
    // one runs, and the one it replaces answers unchanged. On the main queue; `done` too.
    private static var switching = false
    private static var queued: (name: String?, done: (Bool, Bool, String?) -> Void)?
    static func switchTo(_ name: String?, done: @escaping (Bool, Bool, String?) -> Void) {
        if switching {
            queued?.done(false, false, nil)
            queued = (name, done)
            return
        }
        switching = true
        turn += 1
        let mine = turn
        let next = {
            guard switching, turn == mine else { return }
            switching = false
            if let q = queued {
                queued = nil
                switchTo(q.name, done: q.done)
            }
        }
        // A completion that never comes (the private call on some iOS) mustn't hold every later switch
        DispatchQueue.main.asyncAfter(deadline: .now() + 60, execute: next)
        apply(name) { changed, quiet, err in
            done(changed, quiet, err)
            next()
        }
    }
    private static var turn = 0

    // On the main queue; `done(changed, quiet, error)` too.
    static func apply(_ name: String?, done: @escaping (Bool, Bool, String?) -> Void) {
        let app = UIApplication.shared
        guard app.supportsAlternateIcons else { return done(false, false, "this iPhone doesn't switch app icons") }
        if onScreen == name { return done(false, false, nil) }
        let finish = { (e: Error?, quiet: Bool) in
            DispatchQueue.main.async {
                if e == nil { keepShown(name) }
                done(e == nil, quiet, e?.localizedDescription)
            }
        }
        let quietly = AppMode.current == .jailbreak && quiet(name) { e in finish(e, true) }
        if quietly { return }
        app.setAlternateIconName(name) { e in finish(e, false) }
    }

    // -[UIApplication _setAlternateIconName:completionHandler:]: the public call without its alert. false when this
    // iOS has no such method (the public one is used then).
    typealias Done = @convention(block) (NSError?) -> Void
    static func quiet(_ name: String?, _ done: @escaping (NSError?) -> Void) -> Bool {
        let app = UIApplication.shared
        let sel = NSSelectorFromString("_setAlternateIconName:completionHandler:")
        guard app.responds(to: sel), let m = class_getInstanceMethod(type(of: app), sel) else { return false }
        typealias F = @convention(c) (AnyObject, Selector, NSString?, Done) -> Void
        let f = unsafeBitCast(method_getImplementation(m), to: F.self)
        let block: Done = { e in done(e) }
        f(app, sel, name as NSString?, block)
        return true
    }
}

// F329: your own icons (web/app/screens/appicon.js). The page crops a picture to 1024 px; it's kept here, in the app's
// container (Application Support/<bundle id>/AppIcons/<name>.png, the list in index.json), and served to the page as
// appicon/<name>.png (Bridge.swift AppScheme).
//   app.icon.list                -> {icons: [{name, label}]}
//   app.icon.add {data, crop: {x, y, size, width, height}, label} -> {name, icons}   the picture (base64) and the
//                                square the page showed, drawn at 1024 px
//   app.icon.remove {name}       -> {icons}
//   app.icon.decode {data}       -> {jpeg}           a picture the web view can't draw (HEIC on iOS 15), as JPEG
// Applying one (app.icon with an own name): the jailbreak build draws it at every icon size into AppIcons/Apply/, the
// helper copies them over one of Info.plist's two own sets (helper/ownicon.h, icon/alternates.py OWN_SLOTS), the
// one not on screen, and the shell switches to it quietly.
// F329a: the sideload build's signed bundle can't change, so it re-signs itself with the picture in that set
// (selfSource: an IPA of the running bundle, SignOptions.ownIconFiles) and installs it as its own update
// (signing.install {selfIcon}, the hosted or This iPhone route); once it reopens, app.icon finds the picture in the
// set and switches to it with the public call (iOS's alert). Until then app.icon answers resign_needed.
//   app.icon.ready {name}        -> {ready, canResign}  ready: the picture is in an own set already (always true in
//                                the jailbreak build); canResign: this build has the own sets to re-sign into
// Lite pictures carry the LITE sash unless Move and Scale's switch left it off (app.icon.add's sash, drawn into the
// kept picture from web/icons/sash-lite.png, tools/icons.sh sash_only).
enum OwnIcons {
    static func isOwn(_ s: String) -> Bool { s.range(of: "^own[a-z0-9]{1,16}$", options: .regularExpression) != nil }

    static let dir: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent(Bundle.main.bundleIdentifier ?? "app").appendingPathComponent("AppIcons")
            .standardizedFileURL
    }()
    static func file(_ name: String) -> URL { dir.appendingPathComponent(name + ".png") }
    private static var index: URL { dir.appendingPathComponent("index.json") }
    private static let lock = NSLock()

    static func list() -> [[String: String]] {
        guard let d = try? Data(contentsOf: index), let a = try? JSONSerialization.jsonObject(with: d) as? [[String: String]]
        else { return [] }
        return a.filter { isOwn($0["name"] ?? "") && FileManager.default.fileExists(atPath: file($0["name"]!).path) }
    }

    private static func save(_ a: [[String: String]]) throws {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try JSONSerialization.data(withJSONObject: a).write(to: index, options: .atomic)
    }

    // A square PNG of `image` at px x px, opaque (iOS draws an icon's transparent parts black, so it's drawn on black).
    static func png(_ image: UIImage, px: Int) -> Data? {
        let f = UIGraphicsImageRendererFormat()
        f.scale = 1
        f.opaque = true
        let size = CGSize(width: px, height: px)
        return UIGraphicsImageRenderer(size: size, format: f).pngData { ctx in
            UIColor.black.setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }

    // The square `crop` (x, y, size in the picture's px as the page showed it: EXIF orientation applied, which
    // UIImage's draw applies too) drawn at px x px. nil when the picture can't be read or the square isn't inside it.
    static func cropped(_ data: Data, crop: [String: Double], px: Int) -> Data? {
        guard let image = UIImage(data: data), image.size.width > 0, image.size.height > 0,
              let x = crop["x"], let y = crop["y"], let size = crop["size"], size > 0 else { return nil }
        let w = image.size.width * image.scale, h = image.size.height * image.scale
        // The page measured the picture it drew; a decoded copy of another size is scaled to it
        let k0 = (crop["width"]).map { $0 > 0 ? w / $0 : 1 } ?? 1
        let (sx, sy, side) = (x * k0, y * k0, size * k0)
        guard sx >= -1, sy >= -1, sx + side <= w + 1, sy + side <= h + 1 else { return nil }
        let k = CGFloat(px) / side
        let f = UIGraphicsImageRendererFormat()
        f.scale = 1
        f.opaque = true
        let out = CGSize(width: px, height: px)
        return UIGraphicsImageRenderer(size: out, format: f).pngData { ctx in
            UIColor.black.setFill()
            ctx.fill(CGRect(origin: .zero, size: out))
            image.draw(in: CGRect(x: -sx * k, y: -sy * k, width: w * k, height: h * k))
        }
    }

    static func add(_ data: Data, crop: [String: Double], label: String, sash: Bool = false) throws -> String {
        guard let plain = cropped(data, crop: crop, px: 1024), let out = sash ? sashed(plain) : plain else {
            throw BridgeError("bad_image", "The picture couldn't be read.")
        }
        lock.lock(); defer { lock.unlock() }
        var a = list()
        var name = "own" + String(Int(Date().timeIntervalSince1970 * 1000), radix: 36)
        while a.contains(where: { $0["name"] == name }) { name += "x" }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try out.write(to: file(name), options: .atomic)
        let clean = String(label.filter { !$0.isNewline }.prefix(24))
        a.append(["name": name, "label": clean.isEmpty ? "Icon" : clean])
        try save(a)
        return name
    }

    static func remove(_ name: String) throws {
        lock.lock(); defer { lock.unlock() }
        try save(list().filter { $0["name"] != name })
        try? FileManager.default.removeItem(at: file(name))
    }

    // F329a: a 1024 px picture with the LITE sash over it (the bundle's web/icons/sash-lite.png); nil when either
    // can't be read.
    static let sashFile = Bundle.main.bundlePath + "/web/icons/sash-lite.png"
    static func sashed(_ png: Data) -> Data? {
        guard let image = UIImage(data: png), let sash = UIImage(contentsOfFile: sashFile) else { return nil }
        let f = UIGraphicsImageRendererFormat()
        f.scale = 1
        f.opaque = true
        let size = CGSize(width: 1024, height: 1024)
        return UIGraphicsImageRenderer(size: size, format: f).pngData { ctx in
            UIColor.black.setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
            image.draw(in: CGRect(origin: .zero, size: size))
            sash.draw(in: CGRect(origin: .zero, size: size))
        }
    }

    // A picture the web view can't draw, as JPEG (at most 4096 px on its long side).
    static func decode(_ data: Data) -> Data? {
        guard let image = UIImage(data: data), image.size.width > 0, image.size.height > 0 else { return nil }
        let k = min(1, 4096 / max(image.size.width * image.scale, image.size.height * image.scale))
        let size = CGSize(width: (image.size.width * image.scale * k).rounded(), height: (image.size.height * image.scale * k).rounded())
        let f = UIGraphicsImageRendererFormat()
        f.scale = 1
        return UIGraphicsImageRenderer(size: size, format: f).jpegData(withCompressionQuality: 0.9) { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }

    static func register(_ b: Bridge) {
        b.on("app.icon.list") { c in Apt.work(c) { ["icons": list()] } }
        b.on("app.icon.add") { c in
            Apt.work(c) {
                guard let s = c.params["data"] as? String, s.count < 64 << 20, let d = Data(base64Encoded: s),
                      let raw = c.params["crop"] as? [String: Any] else {
                    throw BridgeError("bad_params", "data is a base64 picture, crop its square")
                }
                let crop = raw.compactMapValues { ($0 as? NSNumber)?.doubleValue }
                let name = try add(d, crop: crop, label: c.params["label"] as? String ?? "",
                                   sash: AppMode.current == .sideload && c.params["sash"] as? Bool == true)
                return ["name": name, "icons": list()]
            }
        }
        b.on("app.icon.remove") { c in
            Apt.work(c) {
                guard let n = c.params["name"] as? String, isOwn(n) else { throw BridgeError("bad_params", "name is an own icon") }
                try remove(n)
                return ["icons": list()]
            }
        }
        // F329a: whether picking `name` needs the Lite app's re-sign first
        b.on("app.icon.ready") { c in
            guard let n = c.params["name"] as? String, isOwn(n) else { return c.reply(nil, "bad_params: name is an own icon") }
            if AppMode.current == .jailbreak { return c.reply(["ready": true, "canResign": false], nil) }
            DispatchQueue.main.async {
                let current = AppIcon.onScreen
                DispatchQueue.global(qos: .userInitiated).async {
                    lock.lock(); defer { lock.unlock() }
                    do {
                        let p = try plan(n, current: current)
                        Apt.reply(c, ["ready": !p.write && ready(p.slot), "canResign": ready(p.slot)], nil)
                    } catch let e as BridgeError {
                        Apt.reply(c, nil, e.text)
                    } catch {
                        Apt.reply(c, nil, "failed: \(error.localizedDescription)")
                    }
                }
            }
        }
        b.on("app.icon.decode") { c in
            Apt.work(c) {
                guard let s = c.params["data"] as? String, s.count < 64 << 20, let d = Data(base64Encoded: s) else {
                    throw BridgeError("bad_params", "data is a base64 picture")
                }
                guard let j = decode(d) else { throw BridgeError("bad_image", "The picture couldn't be read.") }
                return ["jpeg": j.base64EncodedString()]
            }
        }
    }

    // ---- Applying (jailbreak build)

    static func setName(_ slot: String) -> String { "Icon-own\(slot)" }
    // Every size the set has (icon/alternates.py OWN_SIZES, helper/ownicon.h): "<pt>x<pt>@<s>x" and its px
    static let sizes: [(file: String, px: Int)] = [20, 29, 40, 60].flatMap { pt in [2, 3].map { ("\(pt)x\(pt)@\($0)x", pt * $0) } }
    static func bundleFile(_ slot: String, _ size: String) -> String {
        Bundle.main.bundlePath + "/IconOwn\(slot.uppercased())\(size).png"
    }

    // The slot to show the picture in, given the set on screen: the one on screen if its files are the picture
    // already, else the other one (so the switch is a change of name and SpringBoard draws the new picture).
    // `write`: its files need the picture first. `holds(slot)`: that slot's files in the bundle are the picture (a
    // byte compare, so a .deb upgrade, which puts the placeholders back, is noticed).
    static func pick(current: String?, holds: (String) -> Bool) -> (slot: String, write: Bool) {
        let shown = current == setName("a") ? "a" : current == setName("b") ? "b" : nil
        if let s = shown, holds(s) { return (s, false) }
        let target = shown == "a" ? "b" : "a"
        return (target, !holds(target))
    }

    // The picture at every size in AppIcons/Apply/IconOwn<size>.png (what the helper copies), in `sizes` order.
    static func render(_ name: String) throws -> [Data] {
        guard let d = try? Data(contentsOf: file(name)), let image = UIImage(data: d) else {
            throw BridgeError("missing", "That icon isn't kept any more.")
        }
        let apply = dir.appendingPathComponent("Apply")
        try FileManager.default.createDirectory(at: apply, withIntermediateDirectories: true)
        return try sizes.map { size in
            guard let p = png(image, px: size.px) else { throw BridgeError("bad_image", "The picture couldn't be drawn.") }
            try p.write(to: apply.appendingPathComponent("IconOwn\(size.file).png"), options: .atomic)
            return p
        }
    }

    static func holds(_ slot: String, _ pngs: [Data]) -> Bool {
        zip(sizes, pngs).allSatisfy { size, p in FileManager.default.contents(atPath: bundleFile(slot, size.file)) == p }
    }

    // A slot's files in the bundle are the app's to switch to: Info.plist lists the set (a build since F329) and
    // every size's PNG is there.
    static func ready(_ slot: String) -> Bool {
        AppIcon.sets.contains(setName(slot)) && sizes.allSatisfy { FileManager.default.fileExists(atPath: bundleFile(slot, $0.file)) }
    }

    // SpringBoard keeps the picture it last drew for a set: a slot written again shows its old picture until the app
    // is registered again (uicache, checked on the iPhone 7). That closes the running app, so it waits until the app
    // goes to the background (the Home Screen is then where the picture is looked at): the helper's
    // own-icon-refresh starts uicache -p detached, and iOS closes the app in the background.
    private static var refreshObserver: NSObjectProtocol?
    static func refreshLater() {
        DispatchQueue.main.async {
            guard refreshObserver == nil else { return }
            refreshObserver = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification,
                                                                     object: nil, queue: .main) { _ in
                if let o = refreshObserver { NotificationCenter.default.removeObserver(o) }
                refreshObserver = nil
                var task = UIBackgroundTaskIdentifier.invalid
                task = UIApplication.shared.beginBackgroundTask { UIApplication.shared.endBackgroundTask(task) }
                DispatchQueue.global(qos: .userInitiated).async {
                    let out = try? Helper.run(["own-icon-refresh"], emit: nil)
                    if out?["code"] as? Int != 0 { NSLog("\(Brand.name): own-icon-refresh: \(out?["stderr"] ?? "not run")") }
                    DispatchQueue.main.async { UIApplication.shared.endBackgroundTask(task) }
                }
            }
        }
    }

    // The slot `name` goes in given the set on screen, and its PNGs (render, pick). Under `lock`, off the main queue.
    static func plan(_ name: String, current: String?) throws -> (slot: String, write: Bool, pngs: [Data]) {
        let pngs = try render(name)
        let p = pick(current: current) { holds($0, pngs) }
        return (p.slot, p.write, pngs)
    }

    // F329a: the Lite app's re-sign of itself with `name`: an IPA of the running bundle (deleted by the signer's
    // caller) and the own-set files to put in it (SignOptions.ownIconFiles). `current`: the set on screen (main queue's
    // AppIcon.onScreen). Off the main queue.
    static func selfSource(_ name: String, current: String?, stop: () -> Bool = { false }) throws -> (ipa: URL, files: [String: Data]) {
        lock.lock(); defer { lock.unlock() }
        let files = try setFiles(name, current: current)
        let out = SignBridge.work.appendingPathComponent("\(SignBridge.token())-self.ipa")
        do { try SelfIPA.make(app: Bundle.main.bundleURL, to: out, stop: stop) } catch {
            try? FileManager.default.removeItem(at: out)
            throw error
        }
        return (out, files)
    }

    // B469: the own-set files for `name` alone (SignOptions.ownIconFiles), for an IPA of the app itself downloaded as an
    // update (Sideload.withOwnIcon): the slot is the one plan picks, so an update while the picture is on screen puts
    // it in the set on screen and the reopened app's app.icon has nothing to switch. `other`: the other tone's own
    // icon when it differs, put in the other set (plan then finds it there when the tone changes); one that can't be
    // drawn is left out. Off the main queue.
    static func selfFiles(_ name: String, other: String? = nil, current: String?) throws -> [String: Data] {
        lock.lock(); defer { lock.unlock() }
        var files = try setFiles(name, current: current)
        guard let o = other, o != name, isOwn(o) else { return files }
        let slot = files.keys.contains { $0.hasPrefix("IconOwnA") } ? "b" : "a"
        guard ready(slot), let pngs = try? render(o) else { return files }
        for (size, png) in zip(sizes, pngs) { files["IconOwn\(slot.uppercased())\(size.file).png"] = png }
        return files
    }

    // The own-set files for `name` given the set on screen. Under `lock`.
    private static func setFiles(_ name: String, current: String?) throws -> [String: Data] {
        let p: (slot: String, write: Bool, pngs: [Data])
        do { p = try plan(name, current: current) } catch let e as BridgeError { throw SignError(e.code, e.message) }
        guard ready(p.slot) else { throw SignError("old_build", "This build has no own icon sets.") }
        var files = [String: Data]()
        for (size, png) in zip(sizes, p.pngs) { files["IconOwn\(p.slot.uppercased())\(size.file).png"] = png }
        return files
    }

    // Copies AppIcons/Apply/ (render) into `slot` through the helper. Off the main queue.
    static func write(slot: String) throws {
        let out = try Helper.run(["own-icon", slot, dir.appendingPathComponent("Apply").path], emit: nil)
        guard out["code"] as? Int == 0 else {
            throw BridgeError("helper", (out["stderr"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines))
        }
    }

    // app.icon with an own icon in a mode: show `shown` (own, or a theme's icon in its one-icon set).
    static func applyShown(_ shown: String, _ c: Bridge.Call) {
        let finish = { (name: String?) in
            DispatchQueue.main.async {
                AppIcon.whenActive(dropped: { c.reply(["name": name ?? "AppIcon", "changed": false, "quiet": false], nil) }) {
                    AppIcon.switchTo(name) { changed, quiet, err in
                        if let err = err { return c.reply(nil, "failed: \(err)") }
                        c.reply(["name": name ?? "AppIcon", "changed": changed, "quiet": quiet], nil)
                    }
                }
            }
        }
        guard isOwn(shown) else {
            return finish(AppIcon.setName(light: shown, dark: shown, onScreen: shown, variants: AppIcon.variants, sets: AppIcon.sets))
        }
        guard FileManager.default.fileExists(atPath: file(shown).path) else { return c.reply(nil, "missing: that icon isn't kept any more") }
        DispatchQueue.main.async {
            let current = AppIcon.onScreen
            DispatchQueue.global(qos: .userInitiated).async {
                lock.lock(); defer { lock.unlock() }
                do {
                    let p = try plan(shown, current: current)
                    guard ready(p.slot) else { return Apt.reply(c, nil, "old_build: this build has no own icon sets") }
                    // F329a: the sideload build gets the picture by re-signing itself (selfSource), not here
                    if p.write, AppMode.current != .jailbreak {
                        return Apt.reply(c, nil, "resign_needed: \(Brand.name) puts your icon in by re-signing itself first")
                    }
                    if p.write { try write(slot: p.slot); refreshLater() }
                    finish(setName(p.slot))
                } catch let e as BridgeError {
                    Apt.reply(c, nil, e.text)
                } catch {
                    Apt.reply(c, nil, "failed: \(error.localizedDescription)")
                }
            }
        }
    }
}
