// F345c: ui.actionSheet and ui.menu, the iOS 26 style's native action sheets and long-press menus (docs/eras.md "Native
// controls"). web/app/nav/actionsheet.js showActionSheet and nav/menu.js showMenu send them in the app under the native
// controls hook:
//
//   ui.actionSheet {title, buttons: [String], cancel: String ("": none), destructive: [Int], rect?: {x, y, width, height}}
//     -> {index} (-1: Cancel, or the popover put away)
//   ui.menu {items: [String], rect: {x, y, width, height}, x?: Number, title?: String, destructive?: [Int],
//     icons?: [null | {symbol} | {image} | {letter, color}], sheet?: Bool} -> {index} (-1: put away)
//
// Rects are CSS px from the web view's top left, which are its points (the page isn't zoomed and the scroll view
// never moves: App.swift). The sheet is a UIAlertController (.actionSheet); on an iPad its popover points at `rect`.
// B383: an action sheet with a source (the button or row it was opened from) is a ui.menu with sheet: true, opened by
// the shell's own glass button when it covers that rect; ui.actionSheet is only for sheets with no source.
// The menu is a UIMenu shown by an invisible UIButton laid over `rect` (menu + showsMenuAsPrimaryAction, opened by
// performPrimaryAction(), iOS 17.4+); when that shows nothing, UIEditMenuInteraction.presentEditMenu at the finger
// (iOS 16+). An error only when nothing could be shown: the page then shows its CSS sheet or menu. Both builds.
// SPDX-License-Identifier: GPL-3.0-or-later
import UIKit
import WebKit

enum NativeMenus {
    static func register(_ b: Bridge) {
        b.on("ui.actionSheet") { c in
            DispatchQueue.main.async { actionSheet(c) }
        }
        b.on("ui.menu") { c in
            DispatchQueue.main.async { menu(c) }
        }
    }

    // {x, y, width, height} as a CGRect, nil when missing or empty.
    static func rect(_ v: Any?) -> CGRect? {
        guard let d = v as? [String: Any] else { return nil }
        func n(_ k: String) -> CGFloat? { (d[k] as? NSNumber).map { CGFloat($0.doubleValue) } }
        guard let x = n("x"), let y = n("y"), let w = n("width"), let h = n("height"), w > 0, h > 0 else { return nil }
        return CGRect(x: x, y: y, width: w, height: h)
    }

    // MARK: ui.actionSheet

    // Main thread only.
    private static func actionSheet(_ c: Bridge.Call) {
        guard let top = MyIPAs.topController() else { return c.reply(nil, "internal: no window to show the sheet in") }
        let p = c.params
        let title = p["title"] as? String ?? ""
        let buttons = (p["buttons"] as? [Any] ?? []).map { "\($0)" }
        let cancel = p["cancel"] as? String ?? "Cancel"
        let destructive = Set((p["destructive"] as? [Any] ?? []).compactMap { ($0 as? NSNumber)?.intValue })

        let vc = UIAlertController(title: title.isEmpty ? nil : title, message: nil, preferredStyle: .actionSheet)
        let once = Once(c)
        for (i, label) in buttons.enumerated() {
            vc.addAction(UIAlertAction(title: label, style: destructive.contains(i) ? .destructive : .default) { _ in once.reply(i) })
        }
        if !cancel.isEmpty { vc.addAction(UIAlertAction(title: cancel, style: .cancel) { _ in once.reply(-1) }) }
        if let pop = vc.popoverPresentationController {
            // iPad: the arrow points at the tapped element; with none, at the bottom middle of the web view.
            let view: UIView = c.web ?? top.view
            pop.sourceView = view
            pop.sourceRect = rect(p["rect"]) ?? CGRect(x: view.bounds.midX, y: view.bounds.maxY - 1, width: 1, height: 1)
            pop.delegate = once // weak; a tap outside the popover is Cancel
        }
        // The sheet keeps `once` (and so the popover's delegate) alive, also when no action holds it (no buttons, no Cancel).
        objc_setAssociatedObject(vc, &onceKey, once, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
        top.present(vc, animated: true)
    }

    private static var onceKey: UInt8 = 0

    // One answer per call, whichever comes first.
    fileprivate final class Once: NSObject, UIPopoverPresentationControllerDelegate {
        private let c: Bridge.Call
        private var done = false
        init(_ c: Bridge.Call) { self.c = c }
        func reply(_ index: Int) {
            guard !done else { return }
            done = true
            c.reply(["index": index], nil)
        }
        func fail(_ why: String) {
            guard !done else { return }
            done = true
            c.reply(nil, why)
        }
        func presentationControllerDidDismiss(_ presentationController: UIPresentationController) { reply(-1) }
    }

    // MARK: ui.menu

    // How long a held row's menu has to start showing before the next way is tried; a button's menu (sheet) gets longer,
    // as its next way looks different.
    private static let showWait: TimeInterval = 0.4
    private static let sheetWait: TimeInterval = 1.5

    // The menu on screen, or on its way (main thread only). A call meanwhile is a fast repeat tap: it answers -1 at
    // once and the menu stays as it is. A call after the menu's answer (Modify > Downgrade) waits until it starts to go.
    private static var live: MenuSession?

    // Main thread only.
    private static func menu(_ c: Bridge.Call) {
        guard let web = c.web, web.window != nil else { return c.reply(nil, "internal: no web view to show the menu in") }
        let p = c.params
        let items = (p["items"] as? [Any] ?? []).map { "\($0)" }
        guard !items.isEmpty, let area = rect(p["rect"]) else { return c.reply(nil, "bad params: items and rect") }
        if let live {
            if live.answered { live.next = { menu(c) } } else { c.reply(["index": -1], nil) }
            return
        }
        let sheet = p["sheet"] as? Bool ?? false
        let x = (p["x"] as? NSNumber).map { CGFloat($0.doubleValue) } ?? area.midX
        let once = Once(c)
        let session = MenuSession(once)
        let destructive = Set((p["destructive"] as? [Any] ?? []).compactMap { ($0 as? NSNumber)?.intValue })
        let icons = p["icons"] as? [Any] ?? []
        // A choice doesn't close the menu by itself: MenuSession.pick does, so an early tap leaves it up.
        var held: UIMenuElement.Attributes = []
        if #available(iOS 16.0, *) { held = .keepsMenuPresented }
        let actions = items.enumerated().map { i, label in
            UIAction(title: label, image: i < icons.count ? icon(icons[i]) : nil,
                     attributes: held.union(destructive.contains(i) ? .destructive : [])) { _ in session.pick(i) }
        }
        let menu = UIMenu(title: p["title"] as? String ?? "", children: actions)

        let viaEdit = {
            if #available(iOS 16.0, *) {
                EditMenu.show(menu, at: CGPoint(x: x, y: area.minY), in: web, once: once, wait: showWait)
            } else {
                once.fail("internal: no menu on this iOS")
            }
        }
        guard #available(iOS 17.4, *) else {
            return sheet ? once.fail("unsupported: a button's menu needs iOS 17.4") : viaEdit()
        }
        // A nav bar button drawn by the shell (NativeGlass) opens the menu itself; anything else gets an invisible
        // button laid over its rect.
        let glass = sheet ? NativeGlass.button(at: area, in: web) : nil
        let button = glass ?? {
            let b = MenuButton(frame: area)
            b.backgroundColor = .clear
            b.isAccessibilityElement = false
            web.addSubview(b)
            return b
        }()
        button.preferredMenuElementOrder = .fixed // the same order wherever the button is on the screen
        button.menu = menu
        button.showsMenuAsPrimaryAction = true
        button.session = session
        live = session
        session.dismiss = { [weak button] in button?.contextMenuInteraction?.dismissMenu() }
        session.ended = { [weak button] in
            if let button, button.session === session {
                button.session = nil
                button.showsMenuAsPrimaryAction = false
                button.menu = nil
                if glass == nil { // once its menu has folded back into it
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { button.removeFromSuperview() }
                }
            }
            guard live === session else { return }
            live = nil
            session.next?()
        }
        button.performPrimaryAction()
        DispatchQueue.main.asyncAfter(deadline: .now() + (sheet ? sheetWait : showWait)) {
            guard session.shownAt == nil, !session.answered else { return }
            NSLog("ui.menu: performPrimaryAction showed no menu")
            session.abandoned = true // a menu that still shows now is put away at once: the next way takes over
            session.end()
            if sheet { once.fail("internal: no menu showed") } else { viaEdit() }
        }
    }

    // An item's icon: {symbol} (an SF Symbol), {image} (a data: URL) or {letter, color} (an app's initial on its colour).
    private static func icon(_ v: Any) -> UIImage? {
        guard let d = v as? [String: Any] else { return nil }
        if let name = d["symbol"] as? String { return UIImage(systemName: name) }
        let size = CGSize(width: 24, height: 24)
        var picture: UIImage?
        if let s = d["image"] as? String, let comma = s.firstIndex(of: ",") {
            picture = Data(base64Encoded: String(s[s.index(after: comma)...])).flatMap { UIImage(data: $0) }
        }
        let letter = d["letter"] as? String ?? ""
        guard picture != nil || !letter.isEmpty else { return nil }
        return UIGraphicsImageRenderer(size: size).image { _ in
            let box = CGRect(origin: .zero, size: size)
            UIBezierPath(roundedRect: box, cornerRadius: 5.5).addClip()
            if let picture { return picture.draw(in: box) }
            (hex(d["color"]) ?? .systemGray).setFill()
            UIRectFill(box)
            let text = letter as NSString
            let look: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 14, weight: .semibold), .foregroundColor: UIColor.white]
            let t = text.size(withAttributes: look)
            text.draw(at: CGPoint(x: (size.width - t.width) / 2, y: (size.height - t.height) / 2), withAttributes: look)
        }.withRenderingMode(.alwaysOriginal)
    }

    // #rgb or #rrggbb.
    private static func hex(_ v: Any?) -> UIColor? {
        guard var s = v as? String, s.hasPrefix("#") else { return nil }
        s.removeFirst()
        if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
        guard s.count >= 6, let n = UInt32(s.prefix(6), radix: 16) else { return nil }
        return UIColor(red: CGFloat(n >> 16 & 255) / 255, green: CGFloat(n >> 8 & 255) / 255, blue: CGFloat(n & 255) / 255, alpha: 1)
    }

    // One menu from its call to its end.
    final class MenuSession {
        private let once: Once
        var shownAt: CFTimeInterval?
        var abandoned = false
        var answered = false
        var ended: (() -> Void)?
        var dismiss: (() -> Void)?
        var next: (() -> Void)? // the menu asked for while this one goes
        fileprivate init(_ once: Once) { self.once = once }

        // A run of fast taps on the button lands on the menu's first item as it grows: those choose nothing and the
        // menu stays up. A tap counts this long after the menu showed and after the tap before it.
        static let deliberate: CFTimeInterval = 0.4
        private var lastTap: CFTimeInterval = 0
        func pick(_ i: Int) {
            guard !answered else { return }
            let now = CACurrentMediaTime(), since = now - max(shownAt ?? 0, lastTap)
            lastTap = now
            guard since >= Self.deliberate else { return }
            answered = true
            once.reply(i)
            dismiss?()
        }

        func end() {
            let f = ended
            ended = nil
            f?()
        }

        // The menu goes: -1 when nothing was chosen.
        func gone() {
            if !abandoned, !answered { answered = true; once.reply(-1) }
            end()
        }
    }

    // A button that opens its menu for a MenuSession (performPrimaryAction) and tells it when the menu shows and goes.
    class MenuButton: UIButton {
        var session: MenuSession?

        override func contextMenuInteraction(_ interaction: UIContextMenuInteraction, willDisplayMenuFor configuration: UIContextMenuConfiguration,
                                             animator: UIContextMenuInteractionAnimating?) {
            super.contextMenuInteraction(interaction, willDisplayMenuFor: configuration, animator: animator)
            guard let session, !session.abandoned else { return interaction.dismissMenu() }
            session.shownAt = CACurrentMediaTime()
        }

        override func contextMenuInteraction(_ interaction: UIContextMenuInteraction, willEndFor configuration: UIContextMenuConfiguration,
                                             animator: UIContextMenuInteractionAnimating?) {
            super.contextMenuInteraction(interaction, willEndFor: configuration, animator: animator)
            guard let session, !session.abandoned else { return }
            // A chosen item has answered by now. Done here, not at the animation's end a second later: the button would
            // open this menu again, with its question answered, on the next tap.
            session.gone()
        }

        // Taken off the screen with its menu up (the glass bars close): the menu is gone too.
        override func didMoveToWindow() {
            super.didMoveToWindow()
            if window == nil, let session, !session.abandoned { session.gone() }
        }
    }

    // The other way: iOS 16's edit menu (a callout bar) at a point in the web view.
    @available(iOS 16.0, *)
    private final class EditMenu: NSObject, UIEditMenuInteractionDelegate {
        private let menu: UIMenu
        private let once: Once
        private var shown = false
        private weak var view: UIView?
        private var interaction: UIEditMenuInteraction?
        private static var live: EditMenu?

        private init(menu: UIMenu, once: Once) {
            self.menu = menu
            self.once = once
        }

        static func show(_ menu: UIMenu, at point: CGPoint, in view: UIView, once: Once, wait: TimeInterval) {
            let m = EditMenu(menu: menu, once: once)
            let i = UIEditMenuInteraction(delegate: m)
            view.addInteraction(i)
            m.view = view
            m.interaction = i
            live = m
            i.presentEditMenu(with: UIEditMenuConfiguration(identifier: nil, sourcePoint: point))
            DispatchQueue.main.asyncAfter(deadline: .now() + wait) {
                guard !m.shown else { return }
                NSLog("ui.menu: UIEditMenuInteraction showed no menu either")
                m.finish()
                once.fail("internal: no menu showed")
            }
        }

        private func finish() {
            if let interaction { view?.removeInteraction(interaction) }
            interaction = nil
            if EditMenu.live === self { EditMenu.live = nil }
        }

        func editMenuInteraction(_ interaction: UIEditMenuInteraction, menuFor configuration: UIEditMenuConfiguration,
                                 suggestedActions: [UIMenuElement]) -> UIMenu? {
            menu // only the page's items, none of WebKit's suggestions
        }

        func editMenuInteraction(_ interaction: UIEditMenuInteraction, willPresentMenuFor configuration: UIEditMenuConfiguration,
                                 animator: UIEditMenuInteractionAnimating) {
            // Too late: the page was told no menu showed and draws its own; this one goes at once.
            if self.interaction == nil { return interaction.dismissMenu() }
            shown = true
        }

        func editMenuInteraction(_ interaction: UIEditMenuInteraction, willDismissMenuFor configuration: UIEditMenuConfiguration,
                                 animator: UIEditMenuInteractionAnimating) {
            animator.addCompletion { [weak self] in
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    self?.once.reply(-1)
                    self?.finish()
                }
            }
        }
    }
}
