# F377: native alert's Paste adds the source

Sources' Add under the native controls hook (`data-controls="native"`) shows a UIAlertController through
`ui.alert`. Until now its field's Paste only filled the field; the CSS alert's Paste adds the source at once (B335,
`input.pasteSubmits`).

## What I did

- `web/app/nav/alert.js`: `showAlert` passes `input.pasteSubmits` (only a button index) to `ui.alert`. When the shell
  answers with `pasted: true` for that button, `input.paste` turns the text into the value, as the CSS Paste does;
  text it can't use ("") opens the alert again with the text in the field (the CSS alert would have stayed open).
- `native/Sources/NativeAlerts.swift`: under `input.pasteSubmits` the field gets a `UITextPasteDelegate`
  (`PasteSubmits`, kept alive as an associated object since `pasteDelegate` is weak). A paste with text replaces the
  whole field (as the CSS Paste sets the value), then the alert is dismissed and answered as that button with
  `pasted: true`. A blank paste pastes as usual. The reply closure now holds the alert weakly (no retain cycle
  through its actions); the pasted text is read before the dismissal.
- Tests in `web/app/nav/alert-native.test.js`; docs/eras.md's Alerts row says the Paste answers for the button.

Why the paste delegate and not the text field's `delegate`: UIKit routes the edit menu's Paste (and keyboard
shortcut, and drops) through `pasteDelegate`, so typing, the URL keyboard's ".com" key and dictation never trigger
it, and reading `UIPasteboard` ourselves (which would ask the user's permission) isn't needed.

## Tried and dropped

- Detecting a paste in `shouldChangeCharactersIn` by a multi-character insert: the URL keyboard's ".com" key would
  count as one.

## Not verified

- On the 15 Pro: copy a source URL, Sources > Add with data-controls=native, Paste adds it. Not run: it needs a Lite
  build installed on the 15 with the iOS 26 style; this unattended slot only ran the gate (which compiles the Swift
  for both builds) and the node tests. In particular not confirmed on device: that iOS 27's edit-menu Paste in a
  UIAlertController field calls `textPasteConfigurationSupporting(_:performPasteOf:to:)` (Apple's documentation says
  the paste delegate covers paste as well as drop).
