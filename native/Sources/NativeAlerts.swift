// F345b: ui.alert, the iOS 26 style's native alert (docs/eras.md "Native controls"). web/app/nav/alert.js showAlert
// sends it in the app under the native controls hook; here it becomes a UIAlertController (.alert):
//
//   {title, message, buttons: [String], cancel: Int (-1: none), colors: {"<index>": "red" | "green"},
//    input?: {placeholder, value, type}}  ->  {index, value?}
//
// `cancel` is the .cancel action, red buttons are .destructive and the green one is the preferredAction. One text field
// (addTextField) when `input` is given; its text comes back as `value`. The reply waits for the tap. An error only when
// there is no window to show it in: the page then shows its CSS alert. Both builds.
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
        if let input {
            vc.addTextField { f in
                f.placeholder = input["placeholder"] as? String
                f.text = input["value"] as? String
                field(f, type: input["type"] as? String ?? "text")
            }
        }
        var replied = false
        var preferred: UIAlertAction?
        for (i, label) in buttons.enumerated() {
            let color = colors[String(i)] as? String
            // UIKit allows one .cancel action; a second would throw, so only `cancel` gets it.
            let style: UIAlertAction.Style = i == cancel ? .cancel : color == "red" ? .destructive : .default
            let action = UIAlertAction(title: label, style: style) { [weak vc] _ in
                guard !replied else { return }
                replied = true
                var out: [String: Any] = ["index": i]
                if input != nil { out["value"] = vc?.textFields?.first?.text ?? "" }
                c.reply(out, nil)
            }
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
