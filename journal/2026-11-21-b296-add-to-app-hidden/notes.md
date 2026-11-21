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
- `web/app/screens/browse-addtoapp.test.js`: hidden for can't/library, kept for ok and for null, other labels and
  no button untouched, plus a wiring check on the package page.

## Not verified

- On the iPhone 15 Pro (Chariz betterAlarm): not run; the change is small and covered by the unit test. The
  button's hiding relies on the UA `[hidden]` rule; `.bar-button` sets no `display` for text buttons (only
  `.bar-icon` does), so it applies.
- A paid tweak that becomes "can't go into an app" only after Buy (the group re-checks itself inside
  screens/tweaks.js) keeps the button until the page is opened again: that re-check isn't exposed outside
  tweaks.js, which this task's files don't cover.
