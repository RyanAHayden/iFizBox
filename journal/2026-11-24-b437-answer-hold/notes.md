# B437: the install prompt waits for the app in front

## Code

- `Sideload.install`'s `holdUntilAnswer` is handed over to `InstallPrompt.Awake` when `serveChecked` starts (the
  `serving` callback). The KeepAlive begin is queued before the end, so audio never drops.
- `SignAhead.open` holds nothing itself in Swift. What kept the queue (and the sheet) awake is the page's
  `signing.hold` (`pageHold`, up to 10 min), found by reading. So it yields too: `Sideload.yieldPageHold`, rule
  `PageYield` in `native/sign/PromptHold.swift`. It goes only after Awake let go with the link never opened, in the
  background, and only when it is the sole KeepAlive hold for 10 s (looked at every 5 s). iOS may refuse to start
  audio from the background, and the page has short gaps between signing calls.
- `SignAhead.swift` needed no change.
- Tests: `native/test_prompt_hold.py` and `native/tests/prompthold`.

## Device run

- iPhone 15 Pro, iOS 27, this build. Route: Signing Server.
- `signing.hold {on}`, then `signing.install` of UTM SE over Web Inspector; Home 4 s after the call. Log: `phone.log`
  beside this file.
- 21:50:03 serving began in background; the link waited.
- 21:51:03 serving hold let go.
- 21:51:13 page's hold let go.
- Frozen by iOS from 21:51:49.
- Opened 21:52:24: no upload, listener back, hold retaken; link opened and prompt shown 21:52:26.
- Cancelled on the prompt; nothing installed.
- Chromium could not do this run: it has no native audio and no suspension.
- First try: Home straight after the call. `signing.install` answered "Could not connect to the server" (read 8 min
  later; when and why unknown; a later download worked in 22 s). It never reached serving.
- idevicesyslog showed almost none of the app's lines; `pymobiledevice3 syslog live` did.

## Not verified

- On a phone, still open: the sign-ahead queue (`signing.prepare` + `signing.open`) with another app still signing
  while the prompt waits (unit/text tests only); Install after such a return (prompt cancelled); return after the
  15 min expiry; the first try's connection error.
- A page gap between signing calls longer than 10 s with the app in background would let the page hold go early; the
  run would go on when the app is in front.

## Follow-up

- Filed B438: a prompt that was opened but left unanswered (iFizBox to the background) keeps the app awake past
  the serving hold's 60 s, because `web/app/signing/queue.js` `heldLanes` keeps `signing.hold` on for the install lane.
