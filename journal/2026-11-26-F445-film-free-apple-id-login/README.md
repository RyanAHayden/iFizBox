# F445: film the Free Apple ID login of the sideload-only clip on the iPhone 15

## Status
Waiting for the iPhone 15: at 14:53 `tools/ui-15.sh state` exited 75, locked by T87a (the free Apple ID
setup on the same phone, same Apple ID, the person around for the 2FA code). Slot given up with
`run wait-for iphone15`.

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
- Everything in the task so far: the phone was busy.
