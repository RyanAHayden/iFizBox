# B436: Pairing Limit

## What changed

- `native/sideload/idevice/IDeviceBridge.swift`: each pairing starts a Pairing Limit (`pairLimit`): 600 s on the wall clock, so sleep counts. At the limit, unless the pairing already ended or was canceled, it marks the `PairSession` expired and signals its cancel. The normal end on pairQueue gives back the background hold, removes the code notification, and replies "expired: the pairing code expired".
- A join (B320) or leave and return keeps the original deadline. `leaveGrace` and the Pairing Advertisement are otherwise unchanged.
- Also: a pairing that succeeds at the same moment still answers paired; an older pairing's end no longer removes a later pairing's code notification; a notification permission alert answered after the limit posts no dead code.
- `web/app/screens/installroute.js`: where the code was, the page shows Get New Code, with the footer "The code expired after 10 minutes." No alert, no automatic restart.

## Tests

- `native/test_pair_limit.py` builds the real `IDeviceBridge.swift` on Linux with stand-ins and a fake clock (`native/tests/pairlimit/main.swift`). Mutations it failed on, as intended: no limit; unconditional `removeCode`; no live check in `postCode`.
- Removing the timer's `pairing === s && !isCanceled` guard does not fail it. The timer only ever signals its own session, so a later pairing is safe either way.
- `web/app/screens/installroute-b436.test.js`.
- Chromium with the fake bridge (`shot.mjs`, `expired.png`): code, then expired, back in front stays expired, then Get New Code shows a new code.
- Result: nothing failed.

## Not verified

- On a real iPhone: that iOS suspends the app after the hold is given back, and that the page in the background shows the expired state on return. The reply goes through the same path as the existing pairing answers.
- The phone was not used. Chromium and the Linux build cover the logic.

## Spec review

Fixed: the page learned of the expiry only from idevice.pair's reply, which may not reach it in the background. Now
idevice.pairState says `expired` too and the page reads it on coming back; a late reply is dropped. The wait in
leaveGrace never goes past pairLimit (the header says so). The other Chromium states (code, new code) were printed by
shot.mjs and looked right; only expired.png is kept.
