# D28: eras.md Alerts row, input.pasteSubmits

- docs/eras.md, Alerts row of the native controls hook table: added that with `input.pasteSubmits`
  (Sources' Add) the native field's own Paste fills the field with the trimmed text and answers for that
  button, as the CSS alert's Paste does; `input.paste` then makes the value, and unusable text reopens the
  alert with it in the field. Wording taken from `web/app/nav/alert.js` (nativeAlert) and
  `native/Sources/NativeAlerts.swift` (PasteSubmits), not from memory.
- Nothing failed.

**Not verified**: none (docs only; the behaviour itself was checked by F377).
