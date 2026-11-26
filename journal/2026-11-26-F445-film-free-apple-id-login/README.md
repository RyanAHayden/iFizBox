# F445: film the Free Apple ID login of the sideload-only clip on the iPhone 15

## Status
Waiting for the iPhone 15: at 14:53 `tools/ui-15.sh state` exited 75, locked by T87a (the free Apple ID
setup on the same phone, same Apple ID, the person around for the 2FA code). Slot given up with
`run wait-for iphone15`.

Second try (14:57): the phone was free and I took the lock. It runs 1.0.3 (8400e1a), which has F444. Installation &
Signing shows the paid team's certificate (336 days left, 41 signed apps), so the Free Apple ID group is hidden. It
shows only when there is no certificate. I filmed nothing and gave the lock back (`unlock F445`), because:
- T87a was still running and signing in with the same free Apple ID (website route), with the person on hand for its
  2FA codes. An in-app sign-in at the same time makes another development certificate on that account. Free
  accounts have a low certificate limit, so it could revoke the one T87a just made, and the person would get two
  sets of codes at once.
- Filming needs the phone's certificate removed and later put back (`~/sync/default/signing/cert.p12` +
  `p12-password.txt`, through Import Certificate and the Files picker). That is shared test state, so do it once,
  in one go, when the account is free.
Blocked `--after T87a`.

## When it reopens
1. Lock the 15. Start WDA video. Settings > Installation & Signing > Certificate > Remove Certificate > "Use a
   Free Apple ID". Type the ID from `~/.config/ifizbox-appleid` (line 1 email, line 2 password; never print the
   file). Tap Sign In.
2. On the code page, `run ask` for the 6-digit code while holding the phone there. Type it, then wait for Ready.
3. Stop the video and pull it. Put the paid certificate back.
4. In `promo-sideload.html`, play the real clip, scaled to 402x874, in place of the `free`..`free-done` span, with
   a box over the Apple ID text. Drop the stubbed login steps from `shots-promo-sideload.json`.

## What I found so far
- The clip (`marketing/video/promo-sideload.html`) is cut from one Chromium recording (`rec/promo-sideload.mp4`,
  402x874 pt at 2x, virtual clock). The stubbed login is the span from mark `free` to mark `free-done` in
  `shots-promo-sideload.json` (gsa.js/freeroute.js overridden by `stubs/`).
- The in-app Free Apple ID sign-in (F444) has never run on a real phone (F444 journal, Not verified), so the
  first real run is also its first test.
- Plan for when the phone is free: record the 15 (WDA video, memory "15 Pro 60 fps recording") from tapping
  "Use a Free Apple ID" to Ready; ask the person for the 2FA code while the phone waits on the code page;
  scale the real footage to the 402x874 screen and play it in place of the `free`..`free-done` span, with a
  box over the Apple ID field.

## Not verified
- Everything in the task so far. First the phone was busy. Then T87a was using the same Apple ID (see above).
- I printed the credential file once by mistake (in the first session's tool output, not in the repo). Its
  password may be worth changing after these tasks.
