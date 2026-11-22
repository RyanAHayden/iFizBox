// F367/F369: ui.glass, the iOS 26 style's glass bars (docs/eras.md "Native controls"). On iOS 26 and later,
// under the native controls hook, web/app/nav/glass.js has the shell draw:
//   - the tab bar as a real UITabBar: a UITabBarController (child of the root controller, its view over the root
//     view) with one UITab per page tab and Search as the UISearchTab, our own glyphs as template images, the
//     page's badges, and tabBarMinimizeBehavior .onScrollDown following the page's scroller. iOS draws every effect
//     itself: the glass, the press-and-drag lens between tabs, the stretch, the shrink on scroll. The one web view
//     sits inside the chosen tab's view (UIKit shrinks the bar only for a scroller in there), moved to the new tab on
//     each switch; a tab tap goes to the page's router ({tap: "tab:<id>"}).
//   - the nav bar's buttons as UIButtons with UIButton.Configuration.glass() (.prominentGlass() for Done), titles and
//     actions from each page, at the rects of the page's own buttons.
// The page hides its own tab bar and buttons while these show (<html data-glass="native">, ios26.css) and shows them
// again whenever the glass bars hide (a push sliding, a sheet, a popup over them).
//
//   ui.glass {op: "open", key, ...bars}  stream: {ready: true} once the bars are in place, then {tap: id} on each tap
//     of a tab ("tab:<id>") or a button ("button:<id>"). Settles (null) only when closed.
//   ui.glass {op: "update", key, ...bars} -> null
//   ui.glass {op: "close", key} -> null (also settles the open call)
//
// bars (every field optional on update; a missing one keeps what is there):
//   scale: Number                       the page's devicePixelRatio, for the icons
//   dark: Bool                          the page's theme (light or dark glass)
//   icons: {key: "data:image/png;base64,…"}   icons not sent before, drawn by the page (icons/rowicons.js)
//   colors: {text, active}              CSS colours: an unselected tab's, the chosen tab's (the tab bar's tint)
//   tabbar: {hidden: Bool, items: [{id, title, selected: Bool, search: Bool, icon: key, selectedIcon: key?,
//            badge: String?}]} | null
//   buttons: [{id, rect, kind: "back" | "done" | "plain", title, size, weight, color, tint?, disabled: Bool,
//              icon: {key, rect, template: Bool}?}]
//   buttonsHidden: Bool
//
// Rects are CSS px from the web view's top left, which are its points (the page isn't zoomed and the scroll view never
// moves: App.swift); the web view fills the screen wherever it sits, so they are the overlay's points too. Nothing moves per frame: the page sends an update only when its bars change (a page pushed, a
// tab chosen, a badge); the tab bar's shrink follows the page's own scroller (a UIScrollView WebKit keeps for each
// overflow scroller), found again on each update, so scrolling sends nothing over the bridge and keeps 120 Hz.
// Below iOS 26 the call answers "unsupported" and the page keeps its CSS bars. Both builds.
// SPDX-License-Identifier: GPL-3.0-or-later
import UIKit
import WebKit

enum NativeGlass {
    static func register(_ b: Bridge) {
        b.on("ui.glass") { c in
            DispatchQueue.main.async { handle(c) }
        }
    }

    private static var open: [String: AnyObject] = [:] // key -> GlassBars (iOS 26+), main thread only

    // Main thread only.
    private static func handle(_ c: Bridge.Call) {
        let p = c.params
        guard let key = p["key"] as? String, !key.isEmpty else { return c.reply(nil, "bad params: key") }
        guard #available(iOS 26.0, *) else { return c.reply(nil, "unsupported: Liquid Glass needs iOS 26") }
        switch p["op"] as? String ?? "" {
        case "open":
            guard let web = c.web, let root = web.window?.rootViewController, let host = root.view else {
                return c.reply(nil, "internal: no web view to show the glass in")
            }
            close(key)
            let bars = GlassBars(call: c, web: web)
            bars.frame = host.bounds
            bars.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            host.addSubview(bars)
            bars.attach(parent: root, host: host)
            bars.apply(p)
            open[key] = bars
            watchLoads(web)
            c.emit([["ready": true]])
        case "update":
            guard let bars = open[key] as? GlassBars else { return c.reply(nil, "not found: no glass \(key)") }
            bars.apply(p)
            c.reply(nil, nil)
        case "close":
            close(key)
            c.reply(nil, nil)
        default:
            c.reply(nil, "bad params: op")
        }
    }

    // A new page load (a reload, a style change saved) starts a page with no bars: the old page's go, as
    // NativeSegments' bars do. The page opens them again if it still wants them.
    private static var loads: NSKeyValueObservation?
    private static func watchLoads(_ web: WKWebView) {
        guard loads == nil else { return }
        loads = web.observe(\.isLoading, options: [.new]) { _, change in
            guard change.newValue == true else { return }
            DispatchQueue.main.async { for key in Array(open.keys) { close(key) } }
        }
    }

    private static func close(_ key: String) {
        guard let v = open.removeValue(forKey: key) else { return }
        if #available(iOS 26.0, *), let bars = v as? GlassBars {
            bars.detach()
            bars.removeFromSuperview()
            bars.call.reply(nil, nil)
        }
    }

    // MARK: values from the page

    static func number(_ v: Any?) -> CGFloat? { (v as? NSNumber).map { CGFloat($0.doubleValue) } }

    // A CSS colour as getComputedStyle gives it: rgb(r, g, b), rgba(r, g, b, a), or the newer "rgb(r g b / a)".
    static func color(_ v: Any?) -> UIColor? {
        guard let s = v as? String, let open = s.firstIndex(of: "("), let close = s.lastIndex(of: ")") else { return nil }
        let parts = s[s.index(after: open)..<close].split(whereSeparator: { ",/ ".contains($0) }).compactMap { Double($0) }
        guard parts.count >= 3 else { return nil }
        let a = parts.count >= 4 ? parts[3] : 1
        return UIColor(red: parts[0] / 255, green: parts[1] / 255, blue: parts[2] / 255, alpha: a)
    }

    static func weight(_ v: Any?) -> UIFont.Weight {
        switch Int(number(v) ?? 400) {
        case ..<350: return .light
        case ..<450: return .regular
        case ..<550: return .medium
        case ..<650: return .semibold
        default: return .bold
        }
    }

    // The back button's chevron (ios26.css's --bar-back: M22 17 6 30l16 13 in a 42 x 60 box), 3x scale, template.
    static let chevron: UIImage = {
        let size = CGSize(width: 12, height: 20)
        let image = UIGraphicsImageRenderer(size: size).image { _ in
            let p = UIBezierPath()
            let k: CGFloat = 20.0 / 60.0 * 1.5 // the SVG drawn 1.5x its 1x size, as the CSS draws it in the 38pt capsule
            func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: (x - 2) * k, y: (y - 30) * k + size.height / 2) }
            p.move(to: pt(22, 17))
            p.addLine(to: pt(6, 30))
            p.addLine(to: pt(22, 43))
            p.lineWidth = 5.5 * k
            p.lineCapStyle = .round
            p.lineJoinStyle = .round
            UIColor.black.setStroke()
            p.stroke()
        }
        return image.withRenderingMode(.alwaysTemplate)
    }()
}

// The glass bars: this overlay on the root view holds the nav bar's buttons; the tab bar controller's view sits under
// it, with the web view inside. Touches anywhere on the overlay but its buttons go through.
@available(iOS 26.0, *)
private final class GlassBars: UIView {
    let call: Bridge.Call
    private weak var web: WKWebView?
    private var images: [String: UIImage] = [:]
    private var scale: CGFloat = UIScreen.main.scale
    private var colors: (text: UIColor, active: UIColor) = (.label, .systemBlue)
    private lazy var tabs = NativeTabs(emit: { [weak self] id in self?.call.emit([["tap": "tab:" + id]]) })
    private var buttons: [String: UIButton] = [:]
    private var lastTabbar: [String: Any]?

    init(call: Bridge.Call, web: WKWebView) {
        self.call = call
        self.web = web
        super.init(frame: .zero)
        backgroundColor = .clear
    }

    required init?(coder: NSCoder) { fatalError("not from a nib") }

    func attach(parent: UIViewController, host: UIView) { tabs.attach(parent: parent, host: host, below: self, web: web) }
    func detach() { tabs.detach() }

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard let hit = super.hitTest(point, with: event), hit !== self else { return nil }
        return hit
    }

    func apply(_ p: [String: Any]) {
        if let s = NativeGlass.number(p["scale"]), s > 0 { scale = s }
        if let dark = p["dark"] as? Bool {
            overrideUserInterfaceStyle = dark ? .dark : .light
            tabs.controller.tabBar.overrideUserInterfaceStyle = overrideUserInterfaceStyle
        }
        if let icons = p["icons"] as? [String: Any] {
            for (key, v) in icons {
                guard let s = v as? String, let comma = s.firstIndex(of: ","),
                      let data = Data(base64Encoded: String(s[s.index(after: comma)...])),
                      let image = UIImage(data: data, scale: scale) else { continue }
                images[key] = image.withRenderingMode(.alwaysTemplate)
            }
        }
        if let c = p["colors"] as? [String: Any] {
            colors = (NativeGlass.color(c["text"]) ?? colors.text, NativeGlass.color(c["active"]) ?? colors.active)
        }
        if p.keys.contains("tabbar") { lastTabbar = p["tabbar"] as? [String: Any] }
        if p.keys.contains("tabbar") || p["icons"] != nil || p["colors"] != nil {
            tabs.apply(lastTabbar, images: images, colors: colors)
        }
        if let list = p["buttons"] as? [[String: Any]] { layoutButtons(list) }
        else if p["icons"] != nil { for b in buttons.values { (b as? GlassButton)?.refreshIcon(images) } }
        if let hidden = p["buttonsHidden"] as? Bool { for b in buttons.values { b.isHidden = hidden } }
    }

    // MARK: the nav bar's buttons

    private func layoutButtons(_ list: [[String: Any]]) {
        var keep = Set<String>()
        for b in list {
            guard let id = b["id"] as? String, let rect = NativeMenus.rect(b["rect"]) else { continue }
            keep.insert(id)
            let button = (buttons[id] as? GlassButton) ?? {
                let v = GlassButton()
                v.addAction(UIAction { [weak self] _ in self?.call.emit([["tap": "button:" + id]]) }, for: .primaryActionTriggered)
                addSubview(v)
                buttons[id] = v
                return v
            }()
            button.frame = rect
            button.update(b, images: images)
        }
        for (id, v) in buttons where !keep.contains(id) { v.removeFromSuperview(); buttons[id] = nil }
    }
}

// The real tab bar: a UITabBarController over the root view whose tabs are empty, clear views; the one web view sits in
// the chosen tab's (so the page's scroller is in UIKit's view tree and the bar shrinks as it scrolls) and moves to the
// new tab on each switch, parked in the controller's own view meanwhile, so it never leaves the window (no visibility
// change for the page) and the page never reloads. The page owns the selection: a tap is sent to the page's router and
// the page's next update says which tab is chosen (a tab the page doesn't switch to comes back as the old one and the
// bar follows).
@available(iOS 26.0, *)
private final class NativeTabs: NSObject, UITabBarControllerDelegate {
    let controller = UITabBarController()
    private let emit: (String) -> Void
    private var byId: [String: UITab] = [:]
    private var order: [String] = []
    private var pages: [String: UIViewController] = [:]
    private weak var web: WKWebView?
    private weak var host: UIView?
    private weak var parent: UIViewController?
    private weak var overlay: UIView?
    private var attached = false
    private var pick: DispatchWorkItem?

    init(emit: @escaping (String) -> Void) {
        self.emit = emit
        super.init()
        controller.delegate = self
        controller.tabBarMinimizeBehavior = .onScrollDown
    }

    // Remembers where to go; the controller goes in with the first tabs (apply).
    func attach(parent: UIViewController, host: UIView, below overlay: UIView, web: WKWebView?) {
        self.parent = parent
        self.host = host
        self.overlay = overlay
        self.web = web
    }

    private func attachNow() {
        guard !attached, let parent, let host else { return }
        attached = true
        parent.addChild(controller)
        controller.view.backgroundColor = .clear
        controller.view.frame = host.bounds
        controller.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        if let overlay, overlay.superview === host { host.insertSubview(controller.view, belowSubview: overlay) }
        else { host.addSubview(controller.view) }
        controller.didMove(toParent: parent)
    }

    // The web view back on the root view, under everything, with its own safe area again; the controller gone.
    func detach() {
        pick?.cancel()
        if let web, let host {
            host.insertSubview(web, at: 0)
            web.frame = host.bounds
            web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            (web as? PageWebView)?.pinnedSafeArea = nil
        }
        guard attached else { return }
        attached = false
        controller.willMove(toParent: nil)
        controller.view.removeFromSuperview()
        controller.removeFromParent()
    }

    // The web view into the chosen tab's view (once that view is in the window), its safe area pinned to the screen's:
    // UIKit adds the tab bar to a tab's safe area, and the page draws its own room for the bar.
    private func place() {
        guard let web, let host, let vc = controller.selectedTab?.viewController, vc.isViewLoaded, vc.view.window != nil
        else { return }
        (web as? PageWebView)?.pinnedSafeArea = host.safeAreaInsets
        guard web.superview !== vc.view else { return }
        vc.view.insertSubview(web, at: 0)
        web.frame = vc.view.bounds
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    }

    // During a switch the web view waits in the controller's own view, which stays in the window while UIKit swaps
    // the tabs' views.
    private func park() {
        guard let web, web.superview !== controller.view, attached else { return }
        controller.view.insertSubview(web, at: 0)
        web.frame = controller.view.bounds
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    }

    private func page(_ id: String) -> UIViewController {
        if let vc = pages[id] { return vc }
        let vc = UIViewController()
        vc.view.backgroundColor = .clear
        pages[id] = vc
        return vc
    }

    func apply(_ t: [String: Any]?, images: [String: UIImage], colors: (text: UIColor, active: UIColor)) {
        guard let t, let items = t["items"] as? [[String: Any]], !items.isEmpty else {
            if attached { controller.setTabBarHidden(true, animated: true) }
            return
        }
        let first = !attached
        attachNow()
        let ids = items.compactMap { $0["id"] as? String }
        if ids != order {
            park()
            byId = [:]
            var list: [UITab] = []
            for item in items {
                guard let id = item["id"] as? String else { continue }
                let provider: (UITab) -> UIViewController = { [weak self] _ in self?.page(id) ?? UIViewController() }
                let tab: UITab
                if item["search"] as? Bool ?? false {
                    tab = UISearchTab(viewControllerProvider: provider)
                } else {
                    tab = UITab(title: item["title"] as? String ?? id, image: nil, identifier: id, viewControllerProvider: provider)
                }
                byId[id] = tab
                list.append(tab)
            }
            order = ids
            controller.setTabs(list, animated: false)
        }
        var chosen: UITab?
        for item in items {
            guard let id = item["id"] as? String, let tab = byId[id] else { continue }
            tab.title = item["title"] as? String ?? tab.title
            if let key = item["icon"] as? String, let img = images[key] { tab.image = img }
            if #available(iOS 26.1, *), let key = item["selectedIcon"] as? String, let img = images[key] { tab.selectedImage = img }
            let badge = item["badge"] as? String
            if tab.badgeValue != badge { tab.badgeValue = badge }
            if item["selected"] as? Bool ?? false { chosen = tab }
        }
        controller.tabBar.tintColor = colors.active
        controller.tabBar.unselectedItemTintColor = colors.text
        if let chosen, controller.selectedTab !== chosen {
            park()
            controller.selectedTab = chosen
        }
        place()
        let hidden = t["hidden"] as? Bool ?? false
        if controller.isTabBarHidden != hidden { controller.setTabBarHidden(hidden, animated: !first) }
        schedulePick()
    }

    // A tap on a tab (the chosen one too: the page scrolls it to the top, or goes back to its root) goes to the page.
    // UIKit moves the selection as it does on any tab bar; the page's answer keeps it or puts it back.
    func tabBarController(_ tabBarController: UITabBarController, shouldSelectTab tab: UITab) -> Bool {
        if let id = byId.first(where: { $0.value === tab })?.key { emit(id) }
        if tab !== controller.selectedTab { park() }
        return true
    }

    func tabBarController(_ tabBarController: UITabBarController, didSelectTab selectedTab: UITab, previousTab: UITab?) {
        place()
        schedulePick()
    }

    // MARK: shrink on scroll

    // The page's scroller is an overflow box (.page-body), which WebKit backs with a UIScrollView of its own inside the
    // web view's. The one on screen now (the frontmost that scrolls and covers the middle of the screen) becomes the
    // chosen tab's content scroll view, so UIKit shrinks the tab bar as it scrolls down and brings it back up. UIKit
    // follows only a scroller inside the tab's own view (one elsewhere is ignored, and a stand-in scroll view copying
    // the page's offset, or with its pan laid on the window, never counts as the user's scroll: tried on the 15 Pro),
    // hence the web view inside the tab. Picked again after each update (a tab chosen, a page pushed), now and once the
    // new layer is in place.
    private func schedulePick() {
        pick?.cancel()
        pickScroller()
        let w = DispatchWorkItem { [weak self] in self?.pickScroller() }
        pick = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: w)
    }

    private func pickScroller() {
        place()
        guard let web, let vc = controller.selectedTab?.viewController, web.isDescendant(of: vc.view) else { return }
        let mid = CGPoint(x: web.bounds.midX, y: web.bounds.midY)
        var best: UIScrollView?
        func walk(_ v: UIView) {
            for s in v.subviews where !s.isHidden && s.alpha > 0.01 {
                // on screen whole across (not a page half slid away) and over the middle; the last such in drawing
                // order is the frontmost
                let r = s.convert(s.bounds, to: web)
                if let sv = s as? UIScrollView, sv !== web.scrollView, sv.contentSize.height > sv.bounds.height + 1,
                   r.contains(mid), r.minX > -1, r.maxX < web.bounds.width + 1 {
                    best = sv
                }
                walk(s)
            }
        }
        walk(web.scrollView)
        if vc.contentScrollView(for: .bottom) !== best { vc.setContentScrollView(best, for: .bottom) }
    }
}

// One nav bar button: a glass capsule (prominent for Done), the page's title or glyph in it.
@available(iOS 26.0, *)
private final class GlassButton: UIButton {
    private var info: [String: Any] = [:]

    func update(_ b: [String: Any], images: [String: UIImage]) {
        info = b
        let kind = b["kind"] as? String ?? "plain"
        var c: UIButton.Configuration = kind == "done" ? .prominentGlass() : .glass()
        let fg = NativeGlass.color(b["color"]) ?? .label
        if kind == "done" { c.baseBackgroundColor = NativeGlass.color(b["tint"]) ?? .systemBlue }
        c.baseForegroundColor = fg
        let font = UIFont.systemFont(ofSize: NativeGlass.number(b["size"]) ?? 15, weight: NativeGlass.weight(b["weight"]))
        let title = b["title"] as? String ?? ""
        let glyph = icon(b["icon"] as? [String: Any], images)
        c.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: 12, bottom: 0, trailing: 12)
        c.titleLineBreakMode = .byTruncatingTail
        if let glyph {
            c.image = glyph
            c.contentInsets = .zero
        } else if kind == "back" {
            c.image = NativeGlass.chevron
            // as tight as the CSS back button (4pt, the 13pt chevron slot, the label, 14pt), so the label fits its rect
            c.imagePadding = 3
            c.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: 6, bottom: 0, trailing: 8)
        }
        if glyph == nil, !title.isEmpty {
            c.attributedTitle = AttributedString(title, attributes: AttributeContainer([.font: font]))
        }
        configuration = c
        contentHorizontalAlignment = kind == "back" ? .leading : .center
        accessibilityLabel = title.isEmpty ? (b["label"] as? String) : title
        isEnabled = !(b["disabled"] as? Bool ?? false)
    }

    func refreshIcon(_ images: [String: UIImage]) {
        guard info["icon"] != nil else { return }
        update(info, images: images)
    }

    private func icon(_ i: [String: Any]?, _ images: [String: UIImage]) -> UIImage? {
        guard let i, let key = i["key"] as? String, let img = images[key] else { return nil }
        return (i["template"] as? Bool ?? true) ? img.withRenderingMode(.alwaysTemplate) : img.withRenderingMode(.alwaysOriginal)
    }
}
