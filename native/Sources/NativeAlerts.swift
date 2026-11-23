// F345b: ui.alert, the iOS 26 style's native alert (docs/eras.md "Native controls"). web/app/nav/alert.js showAlert
// sends it in the app under the native controls hook; here it becomes a UIAlertController (.alert):
//
//   {title, message, buttons: [String], cancel: Int (-1: none), colors: {"<index>": "red" | "green"},
//    input?: {placeholder, value, type, pasteSubmits?: Int}}  ->  {index, value?, pasted?}
//
// `cancel` is the .cancel action, red buttons are .destructive and the green one is the preferredAction. One text field
// (addTextField) when `input` is given; its text comes back as `value`. The reply waits for the tap. An error only when
// there is no window to show it in: the page then shows its CSS alert. Both builds.
// F377: `input.pasteSubmits` (Sources' Add: the Add Source button's index) makes the field's own Paste (its edit
// menu) put the pasted text in the field and answer as if that button were tapped, with `pasted: true`; the CSS
// alert's Paste button does the same (B335). A blank paste just pastes.
// SPDX-License-Identifier: GPL-3.0-or-later
import UIKit

enum NativeAlerts {
    static func register(_ b: Bridge) {
        b.on("ui.alert") { c in
            DispatchQueue.main.async { alert(c) }
        }
    }

    // Main thread only.
    private static func alert(_ c: Bridge.Call) {
        guard let top = MyIPAs.topController() else { return c.reply(nil, "internal: no window to show the alert in") }
        let p = c.params
        let title = p["title"] as? String ?? ""
        let message = p["message"] as? String ?? ""
        var buttons = (p["buttons"] as? [Any] ?? []).map { "\($0)" }
        if buttons.isEmpty { buttons = ["OK"] }
        let cancel = (p["cancel"] as? NSNumber)?.intValue ?? -1
        let colors = p["colors"] as? [String: Any] ?? [:]
        let input = p["input"] as? [String: Any]

        let vc = UIAlertController(title: title.isEmpty ? nil : title, message: message.isEmpty ? nil : message,
                                   preferredStyle: .alert)
        var replied = false
        weak var shown = vc // the actions' closures must not keep the alert alive
        func answer(_ i: Int, pasted: String? = nil) {
            guard !replied else { return }
            replied = true
            var out: [String: Any] = ["index": i]
            if input != nil { out["value"] = pasted ?? shown?.textFields?.first?.text ?? "" }
            if pasted != nil { out["pasted"] = true }
            c.reply(out, nil)
        }
        if let input {
            let submit = (input["pasteSubmits"] as? NSNumber)?.intValue ?? -1
            vc.addTextField { f in
                f.placeholder = input["placeholder"] as? String
                f.text = input["value"] as? String
                field(f, type: input["type"] as? String ?? "text")
                guard submit >= 0, submit < buttons.count else { return }
                // A paste ends the alert as the button's own tap would: dismissed, then answered.
                let d = PasteSubmits {
                    guard !replied else { return }
                    // The text is read now: once dismissed, nothing may hold the alert any more.
                    let text = shown?.textFields?.first?.text ?? ""
                    guard let vc = shown else { return answer(submit, pasted: text) }
                    vc.dismiss(animated: true) { answer(submit, pasted: text) }
                }
                f.pasteDelegate = d // weak: the field keeps it
                objc_setAssociatedObject(f, &PasteSubmits.key, d, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
            }
        }
        var preferred: UIAlertAction?
        for (i, label) in buttons.enumerated() {
            let color = colors[String(i)] as? String
            // UIKit allows one .cancel action; a second would throw, so only `cancel` gets it. A red cancel button
            // stays .cancel (no alert in the page has one).
            let style: UIAlertAction.Style = i == cancel ? .cancel : color == "red" ? .destructive : .default
            let action = UIAlertAction(title: label, style: style) { _ in answer(i) }
            vc.addAction(action)
            if color == "green", preferred == nil { preferred = action }
        }
        if let preferred { vc.preferredAction = preferred }
        top.present(vc, animated: true)
    }

    // The field as nav/alert.js's <input> is: no capitals, no autocorrect, no spellcheck; the keyboard from its type.
    private static func field(_ f: UITextField, type: String) {
        f.autocapitalizationType = .none
        f.autocorrectionType = .no
        f.spellCheckingType = .no
        f.clearButtonMode = .whileEditing
        switch type {
        case "url": f.keyboardType = .URL; f.textContentType = .URL
        case "email": f.keyboardType = .emailAddress; f.textContentType = .emailAddress
        case "number": f.keyboardType = .numberPad
        case "tel": f.keyboardType = .phonePad
        case "password": f.isSecureTextEntry = true; f.textContentType = .password
        default: f.keyboardType = .default
        }
    }
}

// F377: the alert field's paste delegate under `input.pasteSubmits`. UIKit hands it what the field's Paste (edit menu,
// keyboard shortcut) or a drop brings; a paste with text in it replaces the whole field, as the CSS alert's Paste
// does, and calls `submit` once the field shows it. A blank one is pasted as usual.
final class PasteSubmits: NSObject, UITextPasteDelegate {
    static var key = 0
    let submit: () -> Void
    init(_ submit: @escaping () -> Void) { self.submit = submit }

    func textPasteConfigurationSupporting(_ s: UITextPasteConfigurationSupporting, performPasteOf text: NSAttributedString,
                                          to range: UITextRange) -> UITextRange {
        let pasted = text.string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let f = s as? UITextField, !pasted.isEmpty else {
            (s as? UITextInput)?.replace(range, withText: text.string)
            return range
        }
        f.text = pasted
        f.sendActions(for: .editingChanged)
        DispatchQueue.main.async { [submit] in submit() }
        return f.textRange(from: f.endOfDocument, to: f.endOfDocument) ?? range
    }
}
