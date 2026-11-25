# B454: Sideload, a paid tweak its seller no longer sells

In the sideload build, a paid tweak whose seller no longer sells it now follows the package page's rules (F434). Someone
who bought it can sign in and add it to an app. Implemented in web/app/core/payment.js (`paidTweakDeb`) and
web/app/screens/tweaks.js (`notSoldText`, `offerPaid`, `worksInGroup`).

## What I did

- `paidTweakDeb` used to throw `PaidNeeded("unavailable")` before it looked at sign-in or purchase. Now `available`
  false goes through the same checks as any paid tweak:
  - signed out: `PaidNeeded("signin")`, carrying the new field `available: false`.
  - signed in and purchased: `authorize_download` is asked. The vendor's refusal (`PaymentError`) is thrown and
    shown in the existing "Can't Add This Tweak" alert, or in the Works In group's footer.
  - signed in and not purchased: `PaidNeeded("unavailable")`, as before.
  - a token the vendor invalidates: `PaidNeeded("signin")`, as before.
- The signed-out free tokenless ask (F318) is not tried when `available` is false, matching F434's `freeSignedOut`.
- `notSoldText` (new, tweaks.js) words the sheet (`offerPaid`) and the Add to an App group's footer (`worksInGroup`)
  as the package page does: "<seller> no longer sells <name>. If you bought it, sign in to download it."
  A free tweak is never called sold. This replaces "doesn't sell it right now", so the two groups on one page agree.

## Decision

- The wording changes for the `unavailable` case too, because "Same rules as the package page (F434)".

## Checked

- `payment.test.js`: the `paidTweakDeb` states.
- `tweaks-paid.test.js`: Add to App against the fake vendor, through sign-in, not bought, a vendor refusal, and free.
- Nothing tried failed.

## Not verified

- A real account that bought a withdrawn package. None exists here, so it is unknown whether Havoc answers
  `purchased:true` or authorizes the download for a buyer.
- worksInGroup's footer was not rendered (no Chromium run). It uses the same text function the tests cover.
- No phone was used. This is a web-only change.
