// F345c: ui.actionSheet and ui.menu, the iOS 26 style's native action sheets and long-press menus (docs/eras.md "Native
// controls"). web/app/nav/actionsheet.js showActionSheet and nav/menu.js showMenu send them in the app under the native
// controls hook:
//
//   ui.actionSheet {title, buttons: [String], cancel: String ("": none), destructive: [Int], rect?: {x, y, width, height}}
//     -> {index} (-1: Cancel, or the popover put away)
//   ui.menu {items: [String], rect: {x, y, width, height}, x?: Number} -> {index} (-1: put away)
//
// Rects are CSS px from the web view's top left, which are its points (the page isn't zoomed and the scroll view
// never moves: App.swift). The sheet is a UIAlertController (.actionSheet); on an iPad its popover points at `rect`.
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
            pop.delegate = once // weak: the actions above keep `once`; a tap outside the popover is Cancel
        }
        top.present(vc, animated: true)
    }

    // One answer per call, whichever comes first.
    private final class Once: NSObject, UIPopoverPresentationControllerDelegate {
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

    // How long a menu has to start showing before the next way is tried.
    private static let showWait: TimeInterval = 0.4

    // Main thread only.
    private static func menu(_ c: Bridge.Call) {
        guard let web = c.web, web.window != nil else { return c.reply(nil, "internal: no web view to show the menu in") }
        let p = c.params
        let items = (p["items"] as? [Any] ?? []).map { "\($0)" }
        guard !items.isEmpty, let area = rect(p["rect"]) else { return c.reply(nil, "bad params: items and rect") }
        let x = (p["x"] as? NSNumber).map { CGFloat($0.doubleValue) } ?? area.midX
        let once = Once(c)
        let actions = items.enumerated().map { i, label in UIAction(title: label) { _ in once.reply(i) } }
        let menu = UIMenu(children: actions)

        let viaEdit = {
            if #available(iOS 16.0, *) {
                EditMenu.show(menu, at: CGPoint(x: x, y: area.minY), in: web, once: once, wait: showWait)
            } else {
                once.fail("internal: no menu on this iOS")
            }
        }
        if #available(iOS 17.4, *) {
            let button = MenuButton(frame: area, once: once)
            button.menu = menu
            button.showsMenuAsPrimaryAction = true
            web.addSubview(button)
            button.performPrimaryAction()
            DispatchQueue.main.asyncAfter(deadline: .now() + showWait) {
                guard !button.shown else { return }
                NSLog("ui.menu: performPrimaryAction showed no menu; trying UIEditMenuInteraction")
                button.removeFromSuperview()
                viaEdit()
            }
        } else {
            viaEdit()
        }
    }

    // An invisible button over the held element: its menu is the UIMenu, shown by performPrimaryAction(). It goes once
    // the menu has gone.
    private final class MenuButton: UIButton {
        let once: Once
        var shown = false
        init(frame: CGRect, once: Once) {
            self.once = once
            super.init(frame: frame)
            backgroundColor = .clear
            isAccessibilityElement = false
        }
        required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

        override func contextMenuInteraction(_ interaction: UIContextMenuInteraction, willDisplayMenuFor configuration: UIContextMenuConfiguration,
                                             animator: UIContextMenuInteractionAnimating?) {
            super.contextMenuInteraction(interaction, willDisplayMenuFor: configuration, animator: animator)
            shown = true
        }

        override func contextMenuInteraction(_ interaction: UIContextMenuInteraction, willEndFor configuration: UIContextMenuConfiguration,
                                             animator: UIContextMenuInteractionAnimating?) {
            super.contextMenuInteraction(interaction, willEndFor: configuration, animator: animator)
            // A chosen item answers from its UIAction; put away with none, it answers -1 once the menu has gone.
            let end = { [weak self] in
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    self?.once.reply(-1)
                    self?.removeFromSuperview()
                }
            }
            if let animator { animator.addCompletion(end) } else { end() }
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
