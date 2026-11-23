# B335: Sources' Add: Paste adds the source at once

## What I did
- `web/app/nav/alert.js`: new opt-in `input.pasteSubmits` (the index of the button to tap; Sources gives Add
  Source's). When Paste gives something usable (the `paste` function's result is non-empty) the field takes it and
  the alert closes with that button, so the caller sees `{ index: <Add>, value: <url> }`. Nothing usable: unchanged
  (field left alone, alert stays).
- `web/app/screens/manage.js`: `addSource` takes a 4th argument `{ pasteSubmits, alert }`. The alert itself is
  built there, not in sources.js, so the option has to pass through it. This file was not on the task's file list;
  the change is additive (one new optional argument, one spread in the input options).
- `web/app/screens/sources.js`: `addSourceNow` opens that alert with `pasteSubmits: true`; Sources' Add
  (`addFromClipboard`, app and website) uses it. Manage's Add, Edit Source, My IPAs' Add, Sign In With Key and
  the other paste alerts keep Paste filling the field only.
- `web/app/screens/addsource.test.js`: three cases with the real showAlert on the fake DOM: Paste with a copied URL
  resolves as Add Source with the cleaned URL; a copy with no URL leaves the field and the alert; Manage's Add
  (no opt-in) only fills the field.

## Tried that failed
- nothing

## Not verified
- On a phone (the app's CSS alert, Paste through `clipboard.read`): not run; the change is web-only and covered by
  the node tests, and real-device checks would need the 15 Pro rig for a one-line behaviour change.
- Under the native controls hook (`data-controls="native"`), the alert is UIAlertController and `input.paste` is
  dropped (the field's own menu pastes), so Paste there still only fills the field. Making the native alert submit
  on paste would need a Swift change in NativeAlerts.swift; out of this task's scope.
