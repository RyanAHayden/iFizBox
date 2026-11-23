// B334: a file opened from Files (tap an .ipa, or Share > Open in iFizBox) that UIKit drops before the scene delegate.
// The sideload build opens documents in place, so iOS hands the file over as a File Provider bookmark that UIKit
// resolves before it calls scene(_:openURLContexts:) (or puts it in the launch's URL contexts). fileproviderd refuses
// that bookmark ("surprising bundle identifier", Cocoa error 257) when the app's signature names another App ID than
// its bundle ID: the usual case for a kept bundle ID signed with an explicit profile (the iPhone 15 Pro's
// com.ryha.sideload). UIKit then logs "Error resolving bookmark" and drops the open: no delegate call, no trail line,
// iFizBox comes up on whatever page it showed.
// The open action itself still carries the file's URL (UISOpenURLAction's url, read by UIKit as it handles the
// action). This reads it there: a file URL the delegate doesn't deliver within `grace` goes to Incoming.receive as if
// it had. A file in iFizBox's own Documents (On My iPhone > iFizBox) needs no bookmark to read and opens its page; an
// .ipa elsewhere, which iOS gives no access to without the bookmark, becomes the page's "Choose" alert (pickLink).
// Sideload build only: the jailbreak build copies opened files into Documents/Inbox (no in-place opening, no bookmark).
import Foundation
import ObjectiveC

enum OpenRescue {
    static let grace: TimeInterval = 1.5

    private static var started = false
    private static var lastDelivered: Date?
    private static var waiting: Set<String> = []

    // Once, at launch, before the scene connects (its launch URL is read while it connects).
    static func start() {
        guard !started, AppMode.current == .sideload else { return }
        started = true
        guard let cls = NSClassFromString("UIOpenURLAction") else {
            return OpenLog.scene("open rescue: no UIOpenURLAction in this iOS")
        }
        let sel = NSSelectorFromString("url")
        guard let m = class_getInstanceMethod(cls, sel) else { return OpenLog.scene("open rescue: no url on UIOpenURLAction") }
        typealias Original = @convention(c) (AnyObject, Selector) -> AnyObject?
        let original = unsafeBitCast(method_getImplementation(m), to: Original.self)
        let block: @convention(block) (AnyObject) -> AnyObject? = { me in
            let value = original(me, sel)
            if let url = value as? URL, url.isFileURL { seen(url) }
            return value
        }
        method_setImplementation(m, imp_implementationWithBlock(block))
    }

    // Incoming.receive calls this for every file URL the scene delegate (or the app delegate) handed over.
    static func delivered(_ url: URL) {
        let at = Date()
        DispatchQueue.main.async { lastDelivered = at }
    }

    // The open action named a file: unless the delegate delivers it within `grace`, take it from here.
    private static func seen(_ url: URL) {
        let path = key(url)
        let at = Date()
        DispatchQueue.main.async {
            guard !waiting.contains(path) else { return } // UIKit may read the action's URL more than once
            waiting.insert(path)
            DispatchQueue.main.asyncAfter(deadline: .now() + grace) {
                waiting.remove(path)
                // Any file delivered since: UIKit's own URL can be spelled differently from the action's (a resolved
                // bookmark), and one file per open is all Files sends. Never both.
                if let d = lastDelivered, d >= at.addingTimeInterval(-0.5) { return }
                OpenLog.hop("OpenRescue: iOS opened \(OpenLog.url(url)) but UIKit dropped it (its File Provider bookmark was refused); taking the URL from the open action")
                if let pick = pickLink(url) {
                    OpenLog.hop("OpenRescue: no access to it outside \(Brand.name)'s folder; the page asks to choose it in that folder")
                    return Incoming.receive(pick)
                }
                Incoming.receive(url)
            }
        }
    }

    // An .ipa iOS gave no access to (Downloads, iCloud Drive, another app's folder: only the refused bookmark carried
    // it): ifizbox://shared?route=pick-ipa&name=…&dir=…, the page's "Choose" alert, which opens the Files picker
    // (library.pick, asked to start in that folder: iOS 27 ignores that for On My iPhone > Downloads and starts at On
    // My iPhone), where the person taps the file. Nil when the file can be read, or isn't an .ipa (the rest end in
    // SharedInbox's "Couldn't Open" alert).
    static func pickLink(_ url: URL, readable: (String) -> Bool = FileManager.default.isReadableFile(atPath:)) -> URL? {
        guard url.pathExtension.lowercased() == "ipa", !readable(url.path) else { return nil }
        var q = URLComponents()
        q.scheme = "ifizbox"
        q.host = "shared"
        q.queryItems = [URLQueryItem(name: "route", value: "pick-ipa"), URLQueryItem(name: "name", value: url.lastPathComponent),
                        URLQueryItem(name: "dir", value: url.deletingLastPathComponent().path)]
        return q.url
    }

    // The same file whatever spelling arrives (/private/var or /var, a trailing slash).
    static func key(_ url: URL) -> String { url.standardizedFileURL.resolvingSymlinksInPath().path }
}
