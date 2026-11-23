# B404: Cannot Comply: Close keeps the queue, the reason in full, remove just the package in the way

## What the Confirm sheet does now (web/app/screens/queue.js, openConfirm)

- Until apt agrees (still checking, helper error, apt's refusal, or essential packages), the left button is a plain
  Close. Close only closes: the package queue and the app queue are both left as they were.
- The red Cancel (which empties both queues) shows only once apt has agreed, including "Nothing to change", or when
  only apps are queued.
- Closing bumps `generation`, so an apt answer still on its way can't queue linked dependencies (F131) or reopen the
  sheet.
- Helper error: the sheet shows the helper's stderr in plain words (`refusedGroups`), wrapped, with the package and
  the reason. Apt's refusal keeps drawIssues' fixes and adds the red "Remove <name> from Queue" rows (`unqueueGroup`).

## core/queuerefusal.js (pure, no DOM)

- `helperRefusal(message, jobs, names)` turns the helper's message into sentences and the queued ids it names. The
  name rule ("allowed: ...") is read from the helper's own message, so when B405 changes policy.c nothing here needs
  copying. "Reinstalling puts it back" is shown only when the helper is missing (`missing`).
- `refusalIds(r, jobs)` gives the queued packages that apt's output, essential packages or linked-download issues
  name. apt prints names in lowercase, so matching ignores case.
- Red "Remove <name> from Queue" rows: one per cause, or one per queued package when the cause names none.

## Checks

- `web/app/screens/queue-confirm.test.js` (node --test): Close keeps both queues (helper error, refusal, while asking, while a
  linked dependency is looked up), Remove takes one, Cancel clears an agreed plan; helperRefusal, refusalIds.
- `journal/2026-11-23-b404-cannot-comply-close/shots.mjs`: Chromium, fake bridge, copied from b330's probe. Shots in
  iOS 6, 7, 13 and 26, light (helper error, refused, asking, agreed) and dark (helper error). Nothing is cut off,
  Close leaves 2 queued, Remove leaves 1 and lands on an agreed Confirm, Cancel empties both.

## Tried and failed

- The probe first said the sheet stayed after Close. The probe compared undefined with null, so it was the probe's
  bug, not the sheet's.
- The iOS 26 era needs an iOS 26 user agent and `app.info` ios. Without them it falls back to iOS 6.

## Not verified

- On the real iPhone 7. Chromium can check this, so the phone was not used (phone rule).
- The exact line of the user's error: the screenshot cut it off.
- The real helper's "missing" state.
