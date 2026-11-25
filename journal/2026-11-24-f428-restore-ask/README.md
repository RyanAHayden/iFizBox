# F428: Restore My VPN asks on coming back

## What I did
- `web/app/signing/restoreask.js` (new): watches native `restore.due` and shows "Turn Your VPN Back On?" with
  Turn VPN On, Not Now, Don't Ask Again (answers on, notNow, never). It waits while an alert, sheet or menu is up,
  while the user types, or while the app is not in front, and asks 1.5 s after that is clear. `due: false` before an
  answer closes the alert unanswered; `due: true` again asks again. `later`, `on_already` and `not_due` are no failure;
  `not_opened` while still due asks again; any other failure shows "VPN Not Turned On".
- `web/app/signing/restoreask.test.js` (new): the answers, the waiting, the withdrawal and the next queue's question.
- `web/app/app.js`: starts `askRestore` at launch.
- `web/app/nav/alert.js`: `nativeAlertUp()`, so the page also waits for the shell's native alerts. Small edit outside
  the listed files. Why: native iOS 26 alerts aren't in the page, so "never over another alert" needs it.
- `docs/sideload.md`: the Restore My VPN paragraph (the "No page asks yet" sentence is replaced) and the bridge
  paragraph's Code list name `restoreask.js`.
- `GLOSSARY.md`: the Restore My VPN entry gets `askRestore`, `restoreask.js` in _In code_ and "Turn Your VPN Back On?" in _On screen_.
- `release-notes/F428.md`: one sentence for users.
- The This iPhone footer is F428a (filed in plan/TODO.md).

## Decisions
- After Turn VPN On answers `later`, the shell asks again if the app is left once more before the run. This is the
  native F427 design; the page can't tell it apart from a new queue.
- `never` is kept by the shell; the page only sends the answer.
- Only native alerts are waited for. Native action sheets and menus are not, since the page can't see them.

## Not verified
- On a real phone with the real shell and Shortcuts. The Chromium check used a fake bridge; the native side was F427's.
- The native iOS 26 alert.
- Native action sheets and menus: the page doesn't wait for them, only for native alerts.

## Checks
- `node --test web/app/signing/restoreask.test.js`: 9 pass, 0 fail.
- Chromium, `shot.mjs` with the fake bridge (402x874, served from `web/app`): the question shows; Turn VPN On with
  a failed run shows "VPN Not Turned On" and `on` is sent; typing holds the question, and it asks again once the
  field is gone; `due: false` withdraws it; Don't Ask Again sends `never`. Screenshot: 1-question.png.
