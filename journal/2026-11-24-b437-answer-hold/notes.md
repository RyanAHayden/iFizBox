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

## Not verified

- On a phone: nothing was run on the iPhone 15; build and unit/text tests only (timing, suspension, link opening on
  return are from reading the code).
- A page gap between signing calls longer than 10 s with the app in background would let the page hold go early; the
  run would go on when the app is in front.

## Follow-up

- Filed B438: a prompt that was opened but left unanswered (iFizBox to the background) keeps the app awake past
  the serving hold's 60 s, because `web/app/signing/queue.js` `heldLanes` keeps `signing.hold` on for the install lane.
