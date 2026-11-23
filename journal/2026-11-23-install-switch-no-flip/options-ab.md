# R78b: Install Switch options A and B on the iPhone 15 Pro

**Nothing was measured.** The iPhone 15 Pro's UI lock (`tools/ui-15.sh`) was held by T76 for the whole session
(taken 11:17, still held after about 5 minutes of retries every 30 s). No test A1-A7 or B was run, and no result
below is a hypothesis turned into a fact: the expectations stay those in `notes.md` (options A and B sections).

## What this run settled

- The tests need more than the lock. A1 to A6 need a probe that posts a local notification from the app in front
  (with `willPresent` set to banner, list, none in turn) and A7 needs an iOS 27 Shortcuts export read on the phone.
  B needs the Wait for Install intent from the shared piece (R78a). A research task changes no product code, so the
  probe build has to be its own task, not part of this one.

## Not verified

Everything in A1-A7 and B: latency, Shortcuts UI, prompts for Set VPN and Cellular Data, Focus, whether a signed
`.shortcut` carries the trigger, App Opened loop survival, and its cost. Why: phone lock held by T76; no probe build.

## Next

R78b is blocked until the phone lock is free and R78a's probe (intents) exists. Reopen it then.
