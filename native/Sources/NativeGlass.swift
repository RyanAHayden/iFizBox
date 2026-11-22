// F367: ui.glass, the iOS 26 style's real Liquid Glass bars (docs/eras.md "Native controls"). On iOS 26 and later,
// under the native controls hook, web/app/nav/glass.js has the shell draw the floating tab bar (the pill and the
// Search circle) and the nav bar's capsule buttons as UIGlassEffect views laid over the web view, at the rects of the
// page's own look-alikes. The page's content scrolls under them (the screens already run under both bars), so the
// glass refracts it. The page keeps its CSS bars underneath, see-through while the glass shows (<html
// data-glass="native">, ios26.css), and shows them whenever the glass hides (a push, a sheet, a popup over it).
//
//   ui.glass {op: "open", key, ...bars}  stream: {ready: true} once the glass is in place, then {tap: id} on each tap
//     of a tab or a button. Settles (null) only when closed: its stream lives as long as the glass.
//   ui.glass {op: "update", key, ...bars} -> null
//   ui.glass {op: "close", key} -> null (also settles the open call)
//
// bars (every field optional on update; a missing one keeps what is there):
//   scale: Number                       the page's devicePixelRatio, for the icons
//   dark: Bool                          the page's theme (the glass's light or dark material)
//   icons: {key: "data:image/png;base64,…"}   icons not sent before, drawn by the page from its own CSS glyphs
//   colors: {text, active, chosen}      CSS colours: a tab's label, the chosen tab's, the chosen tab's capsule
//   tabbar: {pill: rect, circle: rect?, hidden: Bool, items: [{id, rect, own: Bool (the circle's), selected: Bool,
//            icon: {key, rect, template: Bool}?, label: {text, rect, size, weight}?, badge: {text, rect, spin: Bool}?}]} | null
//   buttons: [{id, rect, kind: "back" | "done" | "plain", title, size, weight, color, tint?, disabled: Bool,
//              icon: {key, rect, template: Bool}?}]
//   buttonsHidden: Bool
//
// Rects are CSS px from the web view's top left, which are its points (the page isn't zoomed and the scroll view never
// moves: App.swift). Nothing moves per frame: the glass sits still while the page scrolls under it, and the page sends
// an update only when its bars change (a page pushed, a tab chosen, a badge), so scrolling keeps 120 Hz.
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
            guard let web = c.web, web.window != nil else { return c.reply(nil, "internal: no web view to show the glass in") }
            close(key)
            let bars = GlassBars(call: c)
            bars.frame = web.bounds
            bars.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            web.addSubview(bars)
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

    // A new page load (a reload, a style change saved) starts a page with no glass: the old page's goes, as
    // NativeSegments' bars do. The page opens it again if it still wants it.
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

// The glass over the web view: the tab bar's pill and circle and the nav bar's buttons. Touches anywhere else go
// through to the page.
@available(iOS 26.0, *)
private final class GlassBars: UIView {
    let call: Bridge.Call
    private var images: [String: UIImage] = [:]
    private var scale: CGFloat = UIScreen.main.scale
    private var colors: (text: UIColor, active: UIColor, chosen: UIColor) = (.label, .systemBlue, UIColor.label.withAlphaComponent(0.08))

    // spacing 0: the pill and the circle (7-10pt apart) stay two shapes, as iOS's tab bar and its Search tab, and only
    // blend if they touch; 12 drew a liquid bridge between them on the 15 Pro
    private let tabGroup = UIVisualEffectView(effect: { let e = UIGlassContainerEffect(); e.spacing = 0; return e }())
    private let pill = GlassBars.glass()
    private let circle = GlassBars.glass()
    private let chosen = UIView()
    private var tabs: [String: TabItem] = [:]
    private var buttons: [String: UIButton] = [:]
    private var lastTabbar: [String: Any]?

    init(call: Bridge.Call) {
        self.call = call
        super.init(frame: .zero)
        backgroundColor = .clear
        tabGroup.isHidden = true
        tabGroup.contentView.addSubview(pill)
        tabGroup.contentView.addSubview(circle)
        chosen.isUserInteractionEnabled = false
        chosen.cornerConfiguration = .capsule()
        pill.contentView.addSubview(chosen)
        addSubview(tabGroup)
    }

    required init?(coder: NSCoder) { fatalError("not from a nib") }

    private static func glass() -> UIVisualEffectView {
        let e = UIGlassEffect(style: .regular)
        e.isInteractive = true
        let v = UIVisualEffectView(effect: e)
        v.cornerConfiguration = .capsule()
        return v
    }

    // Only the glass takes touches; the overlay itself, the tab group's ground between the pill and the circle, and
    // a glass's own ground outside its items let them through to the page.
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hit = super.hitTest(point, with: event)
        if hit === self || hit === tabGroup || hit === tabGroup.contentView { return nil }
        return hit
    }

    func apply(_ p: [String: Any]) {
        if let s = NativeGlass.number(p["scale"]), s > 0 { scale = s }
        if let dark = p["dark"] as? Bool { overrideUserInterfaceStyle = dark ? .dark : .light }
        if let icons = p["icons"] as? [String: Any] {
            for (key, v) in icons {
                guard let s = v as? String, let comma = s.firstIndex(of: ","),
                      let data = Data(base64Encoded: String(s[s.index(after: comma)...])),
                      let image = UIImage(data: data, scale: scale) else { continue }
                images[key] = image
            }
        }
        if let c = p["colors"] as? [String: Any] {
            colors = (NativeGlass.color(c["text"]) ?? colors.text, NativeGlass.color(c["active"]) ?? colors.active,
                      NativeGlass.color(c["chosen"]) ?? colors.chosen)
        }
        if p.keys.contains("tabbar") { lastTabbar = p["tabbar"] as? [String: Any] }
        if p.keys.contains("tabbar") || p["icons"] != nil || p["colors"] != nil { layoutTabbar(lastTabbar) }
        if let list = p["buttons"] as? [[String: Any]] { layoutButtons(list) }
        else if p["icons"] != nil { for b in buttons.values { (b as? GlassButton)?.refreshIcon(images) } }
        if let hidden = p["buttonsHidden"] as? Bool { for b in buttons.values { b.isHidden = hidden } }
    }

    private func image(_ icon: [String: Any]?) -> UIImage? {
        guard let icon, let key = icon["key"] as? String, let img = images[key] else { return nil }
        return (icon["template"] as? Bool ?? true) ? img.withRenderingMode(.alwaysTemplate) : img.withRenderingMode(.alwaysOriginal)
    }

    // MARK: the tab bar

    private func layoutTabbar(_ t: [String: Any]?) {
        guard let t, let pillRect = NativeMenus.rect(t["pill"]) else {
            tabGroup.isHidden = true
            return
        }
        let circleRect = NativeMenus.rect(t["circle"])
        let all = circleRect.map { pillRect.union($0) } ?? pillRect
        tabGroup.frame = all
        pill.frame = pillRect.offsetBy(dx: -all.minX, dy: -all.minY)
        circle.isHidden = circleRect == nil
        if let r = circleRect { circle.frame = r.offsetBy(dx: -all.minX, dy: -all.minY) }
        tabGroup.isHidden = t["hidden"] as? Bool ?? false

        let items = (t["items"] as? [[String: Any]]) ?? []
        var keep = Set<String>()
        chosen.isHidden = true
        for item in items {
            guard let id = item["id"] as? String, let rect = NativeMenus.rect(item["rect"]) else { continue }
            keep.insert(id)
            let own = item["own"] as? Bool ?? false
            let host = own ? circle : pill
            let origin = own ? (circleRect ?? .zero).origin : pillRect.origin
            let view = tabs[id] ?? {
                let v = TabItem()
                v.addAction(UIAction { [weak self] _ in self?.call.emit([["tap": "tab:" + id]]) }, for: .touchUpInside)
                tabs[id] = v
                return v
            }()
            if view.superview !== host.contentView { host.contentView.addSubview(view) }
            view.frame = rect.offsetBy(dx: -origin.x, dy: -origin.y)
            let selected = item["selected"] as? Bool ?? false
            view.update(item, image: image(item["icon"] as? [String: Any]), origin: rect.origin,
                        color: selected ? colors.active : colors.text)
            if selected && !own {
                chosen.backgroundColor = colors.chosen
                chosen.frame = view.frame
                chosen.isHidden = false
            }
        }
        for (id, v) in tabs where !keep.contains(id) { v.removeFromSuperview(); tabs[id] = nil }
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

// One tab: its glyph, label and badge where the page draws them.
@available(iOS 26.0, *)
private final class TabItem: UIControl {
    private let icon = UIImageView()
    private let label = UILabel()
    private let badge = UILabel()
    private let spinner = UIActivityIndicatorView(style: .medium)

    override init(frame: CGRect) {
        super.init(frame: frame)
        for v in [icon, label, badge, spinner] as [UIView] { v.isUserInteractionEnabled = false; addSubview(v) }
        icon.contentMode = .scaleAspectFit
        label.textAlignment = .center
        label.lineBreakMode = .byTruncatingTail
        badge.textAlignment = .center
        badge.textColor = .white
        badge.backgroundColor = .systemRed
        badge.clipsToBounds = true
        spinner.color = .white
        spinner.hidesWhenStopped = true
    }

    required init?(coder: NSCoder) { fatalError("not from a nib") }

    // `origin` is the item's top left on the page: the page's rects for the glyph, label and badge are page rects too.
    func update(_ item: [String: Any], image: UIImage?, origin: CGPoint, color: UIColor) {
        func local(_ v: Any?) -> CGRect? { NativeMenus.rect(v).map { $0.offsetBy(dx: -origin.x, dy: -origin.y) } }
        let iconInfo = item["icon"] as? [String: Any]
        icon.image = image
        icon.tintColor = color
        if let r = local(iconInfo?["rect"]) { icon.frame = r }
        icon.isHidden = image == nil
        let l = item["label"] as? [String: Any]
        let text = l?["text"] as? String ?? ""
        label.text = text
        label.isHidden = text.isEmpty
        label.textColor = color
        label.font = .systemFont(ofSize: NativeGlass.number(l?["size"]) ?? 10, weight: NativeGlass.weight(l?["weight"]))
        if let r = local(l?["rect"]) { label.frame = r }
        accessibilityLabel = text.isEmpty ? item["id"] as? String : text
        accessibilityTraits = (item["selected"] as? Bool ?? false) ? [.button, .selected] : .button
        isAccessibilityElement = true

        let b = item["badge"] as? [String: Any]
        let spin = b?["spin"] as? Bool ?? false
        let r = local(b?["rect"])
        badge.isHidden = b == nil || r == nil
        if let r {
            badge.frame = r
            badge.layer.cornerRadius = r.height / 2
            badge.text = spin ? "" : b?["text"] as? String
            badge.font = .systemFont(ofSize: max(11, r.height * 0.7))
            spinner.center = CGPoint(x: r.midX, y: r.midY)
            spinner.transform = CGAffineTransform(scaleX: 0.6, y: 0.6)
        }
        if spin && r != nil { spinner.startAnimating() } else { spinner.stopAnimating() }
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
