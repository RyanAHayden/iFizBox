// F345d: ui.segments, the iOS 26 style's native scope bar (docs/eras.md "Native controls"). web/app/nav/ui.js
// segments() sends it in the app under the native controls hook, for a scope bar pinned under the search bar
// (nav/searchbar.js pinned); a scope bar inside a scroller stays the page's CSS one. One call per op, `key` naming
// the bar:
//
//   ui.segments {op: "open", key, items: [String], selected: Int (-1: none), rect: {x, y, width, height}, hidden: Bool}
//     stream: {ready: true} once the control is in place, then {pick: Int} on each tap of another segment.
//     The call settles (null) only when the bar is closed: its stream lives as long as the control.
//   ui.segments {op: "update", key, items?, selected?, rect?, hidden?} -> null
//   ui.segments {op: "close", key} -> null (also settles the open call)
//
// The control is a UISegmentedControl laid over the web element's rect, a subview of the web view. Rects are CSS px
// from the web view's top left, which are its points (the page isn't zoomed and the scroll view never moves:
// App.swift). The page decides when it shows: it hides it while one of its own sheets, alerts or a push covers the
// bar, and closes it when its page goes. The shell's own alerts, sheets and menus are presented above it anyway.
// Both builds. SPDX-License-Identifier: GPL-3.0-or-later
import UIKit
import WebKit

enum NativeSegments {
    static func register(_ b: Bridge) {
        b.on("ui.segments") { c in
            DispatchQueue.main.async { handle(c) }
        }
    }

    // One bar on screen: its control and the open call, which answers when the bar closes.
    private final class Bar {
        let control: UISegmentedControl
        let call: Bridge.Call
        var items: [String] = []
        init(control: UISegmentedControl, call: Bridge.Call) {
            self.control = control
            self.call = call
        }
    }

    private static var bars: [String: Bar] = [:] // main thread only

    // Main thread only.
    private static func handle(_ c: Bridge.Call) {
        let p = c.params
        guard let key = p["key"] as? String, !key.isEmpty else { return c.reply(nil, "bad params: key") }
        switch p["op"] as? String ?? "" {
        case "open":
            open(key, c)
        case "update":
            guard let bar = bars[key] else { return c.reply(nil, "not found: no scope bar \(key)") }
            apply(p, to: bar)
            c.reply(nil, nil)
        case "close":
            close(key)
            c.reply(nil, nil)
        default:
            c.reply(nil, "bad params: op")
        }
    }

    private static func open(_ key: String, _ c: Bridge.Call) {
        guard let web = c.web, web.window != nil else { return c.reply(nil, "internal: no web view to show the scope bar in") }
        guard NativeMenus.rect(c.params["rect"]) != nil else { return c.reply(nil, "bad params: rect") }
        close(key) // a page that opens the same key again replaces its bar
        let control = UISegmentedControl(items: [])
        let bar = Bar(control: control, call: c)
        apply(c.params, to: bar)
        control.addAction(UIAction { [weak control] _ in
            guard let control else { return }
            c.emit([["pick": control.selectedSegmentIndex]])
        }, for: .valueChanged)
        web.addSubview(control)
        bars[key] = bar
        watchLoads(web)
        c.emit([["ready": true]])
    }

    // A new page load (a reload, the self-update's) starts a page with no bars: the old page's controls go, or they
    // would stay over the new page. The page reopens what it still wants (an update for a key that went answers
    // "not found", and the page opens it again).
    private static var loads: NSKeyValueObservation?
    private static func watchLoads(_ web: WKWebView) {
        guard loads == nil else { return }
        loads = web.observe(\.isLoading, options: [.new]) { _, change in
            guard change.newValue == true else { return }
            DispatchQueue.main.async { for key in Array(bars.keys) { close(key) } }
        }
    }

    private static func close(_ key: String) {
        guard let bar = bars.removeValue(forKey: key) else { return }
        bar.control.removeFromSuperview()
        bar.call.reply(nil, nil)
    }

    private static func apply(_ p: [String: Any], to bar: Bar) {
        let control = bar.control
        let was = control.selectedSegmentIndex // removeAllSegments() drops it
        if let items = (p["items"] as? [Any])?.map({ "\($0)" }), items != bar.items {
            control.removeAllSegments()
            for (i, title) in items.enumerated() { control.insertSegment(withTitle: title, at: i, animated: false) }
            bar.items = items
        }
        if p["items"] != nil || p["selected"] != nil {
            let s = (p["selected"] as? NSNumber)?.intValue ?? was
            control.selectedSegmentIndex = (0..<control.numberOfSegments).contains(s) ? s : UISegmentedControl.noSegment
        }
        if let r = NativeMenus.rect(p["rect"]) { control.frame = r }
        if let hidden = p["hidden"] as? Bool { control.isHidden = hidden }
    }
}
