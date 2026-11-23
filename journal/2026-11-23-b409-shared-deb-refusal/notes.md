# B409: a shared .deb's refusal shows the whole reason in plain words, not one cut-off row

## What the sheet does now (web/app/screens/sharedeb.js, openDebConfirm)

- A helper error used to be one `grouped` row with the raw message, cut off by an ellipsis. It now uses
  `refusedBlock` (screens/queue.js, split out of B404's `refusedGroups` and exported), so the message wraps whole.
- The footer is "Nothing was changed." The one exception is a missing helper: then the footer is "Reinstalling <name>
  puts it back." (`refusedBlock` gives the missing footer first).

## core/queuerefusal.js

- `debRefusal(message, name)` turns share.debSimulate's error into sentences. Its own sentences cover a gone file
  (`gone:` from ShareBridge.swift, or "that shared file isn't there") and a bad .deb path (policy.c's and paid.c's
  words).
- Every other reason goes to `helperRefusal`. It got a 4th parameter, `what` (default "these packages"), so its
  fallback names the file: "couldn't ask apt about Tweak.deb: ...".
- Error shapes: ShareBridge.swift sends "helper: ...", "gone: ..." and IntentFailure texts. native/bridge.js splits the
  code off the message before this code sees it.

## Checks

- `web/app/screens/sharedeb.test.js` (node --test): the wrong caller, a bad path, a gone file, any other reason, and a
  missing helper. Each checks the wrapped sentence, the footer and that Cancel discards. Passes 7 of 7.
- `journal/2026-11-23-b409-shared-deb-refusal/shots.mjs`: Chromium, fake bridge, iOS 6, 7, 13 and 26, light and dark,
  refused and missing (and, in iOS 6 and 26, a file the helper can't take). Nothing is cut off.

## Found, out of scope

- The same sheet's "Can't Do This Yet" rows (apt's refusal sentences) are still one-line rows. Filed as B410.

## Not verified

- On the real iPhone 7. Chromium can check this, so the phone was not used (phone rule).
- The real helper's refusal and missing states. The fake bridge threw their messages.
