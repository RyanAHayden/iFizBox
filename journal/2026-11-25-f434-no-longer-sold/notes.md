# F434: Paid packages the vendor no longer sells

A paid package whose vendor no longer sells it now says so on its Details page, and someone who bought it can still
sign in and download it. Implemented in web/app/screens/extras.js.

## What I did

- `unavailableNav` (new, called by `paidNav` when `available` is false) sets the nav:
  - signed out: Sign In, and "<vendor> no longer sells this. If you bought it, sign in to download it."
  - signed in and purchased: label Install, Download & Install, and "<vendor> no longer sells this."
  - signed in, not purchased: only that note.
  - A vendor refusal of the download shows in the existing Purchase alert.
- `purchaseFooter` (new): the group's footer is the same note, in place of the vendor's sign-in message or "Sold by".
  The old "Not available to buy" row is gone, since the footer says it.
- Vendor errors needed no product change: `parseReply` throws on them, so `paidNav` gets `info` null and the message
  shows. A test now holds that.

## Live answers

Havoc, checked 2026-11-25 with a synthetic UDID:

- `org.haxi0.lunar`: 200 `{"price":"Unavailable","purchased":false,"available":false}`
- `com.ichitaso.icontweak`: 200, price Free, `available` false
- unknown or capitalised ID: 404 `{"available":false,"error":"Not Found"}`
- no UDID: 400 "Bad Request", also with `available:false`

So `available:false` alone does not mean "no longer sold". An error answer wins.

## Decisions

- Free and unavailable also offers Sign In, with "Not available from <vendor>. If you already got it, sign in to
  download it." (never sold).
- An installed package's sheet, signed out, stays Remove only (the existing B11 rule). The Purchase group has Sign In.
- The nav button keeps showing the vendor's price word ("Unavailable") until the package is purchased.

## Checked

- `paidnav.test.js` and `extras.test.js`.
- Chromium with the fake bridge (journal/2026-11-23-f382-source-filters/capture.mjs, plus fakes for `net.request`
  and `device.info`, and a local flat repo with a `payment_endpoint` file). `states.png` shows, left to right: signed
  out, purchased, vendor refusal alert, not purchased, free. Second row: the Not Found error, then the nav sheets
  signed out, not purchased, purchased.

## Not verified

- A real Havoc account that bought Lunar Legacy. There is no such account, so it is unknown whether Havoc answers
  `purchased:true` or authorizes the download for a buyer.
- No phone was used. The task does not ask for one, and Chromium covers the states.
- Sideload's tweak download (`paidTweakDeb` in core/payment.js) still answers "unavailable" to a buyer. Filed as a
  follow-up.
