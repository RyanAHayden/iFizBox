# B296: hide the nav bar's Add to App when a tweak can't go into an app

Seen in R45 (journal/2026-11-21-r45-iphone15-chariz): on the sideload build, a tweak whose Add to an App group says
Can't Go into an App (Chariz betterAlarm, filter com.apple.mobiletimer) kept the package page's Add to App button,
and tapping it only brought the Can't Take This Tweak alert.

## What I did

- `web/app/screens/browse.js`: the package page keeps `worksInGroup(st)`'s handle and, once its `ready` check
  resolves, calls the new `addToAppFollowsCheck(body, info)`. It hides the nav bar's right button (`hidden`) when
  the check says `ok: false` (Can't Go into an App, or A Library for Other Tweaks), and only when that button says
  Add to App. A check that couldn't finish (paid and not bought, or the .deb unreadable: `null`) keeps the button,
  since Add to App is still the way in there.
- Hidden, not disabled: the group already says why, and a dead button would just look broken.
- Ordering: there is no `await` between the group being made and `rememberPackage` setting the label to Add to
  App, so the `.then` always runs after the label is set (even with a cached check).
- Spec review found the first version only followed the first check: a paid tweak re-checked after Sign In / Buy
  kept the button. Fixed with a small additive `onCheck(info | null)` option on `worksInGroup`
  (`web/app/screens/tweaks.js`), called after every check (the first, and the one after Sign In / Buy); the
  package page passes `addToAppFollowsCheck` to it. Its `check`/`ready` still return the same results.
- `web/app/screens/browse-addtoapp.test.js`: hidden for can't/library, kept for ok and for null, other labels and
  no button untouched; worksInGroup with Comet (a library) through a tiny fake DOM hears onCheck and hides the
  button; plus wiring checks. The test file and the tweaks.js hook are outside the brief's file list (only
  browse.js); both are additive.

## Not verified

- On the iPhone 15 Pro (Chariz betterAlarm): not run; the change is small and covered by the unit test. The
  button's hiding relies on the UA `[hidden]` rule; `.bar-button` sets no `display` for text buttons (only
  `.bar-icon` does), so it applies.
- The paid path after Buy (onCheck from the re-check) is covered by the wiring check only, not run end to end:
  a real paid-tweak purchase needs a seller account.
