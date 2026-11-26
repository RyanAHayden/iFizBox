# B473: free UDID detour on the website

## Problem
Website route Use a Free Apple ID. With no stored UDID, Register This iPhone ended red with only Try Again and Sign Out.
The detour to Find This iPhone's UDID (installing the UDID profile from Settings) reloaded the page and lost the Apple
sign-in. Found in T87a on the iPhone 15 Pro.

## What I did
- web/app/screens/free-apple-id.js: under the checklist, a group with a "Find This iPhone's UDID" row linking to the
  Find UDID page (#settings/signing/udid), footer "Register This iPhone needs its UDID. You stay signed in while you
  find it." While a UDID visit is pending, the detail reads "Waiting" and the footer changes to the waiting text. On a
  computer, only a footer says to open the page on the iPhone. Pure helper udidDetour().
- The "iPhone Not Known" alert is no longer shown on the website for this case, since the row explains it. The app
  (sideload build) is unchanged.
- Sign-in kept: on that failure the developer-portal session (Xcode app token, adsid, team, Apple ID name; never the
  password) is written to localStorage key ifizbox.freeid.session for at most 30 minutes or the token's own expiry,
  whichever is sooner (keepFreeSession / keptFreeSession / dropFreeSession).
  Why localStorage and not sessionStorage: the profile install's "UDID Sent" page opens in Safari, possibly in another
  tab, and a reloaded or restored tab may not keep sessionStorage. The free identity's private key already lives in
  localStorage.
  The kept session is dropped when setup finishes, on Sign Out, on Forget (which goes through Sign Out), and on a
  session error.
- Resume: on page load, when the relay is on and a session is kept, setup runs again with it (resumeKept). While the
  same page load lasts, coming back to Signing with the UDID now stored makes setup go on by itself (setupView). The
  pending UDID visit is watched (watchUdid), so the page redraws when the UDID lands. A guard (flow.running) stops two
  setups from running at once.

## Tests
- web/app/screens/free-apple-id.test.js: keep, expiry and drop of the kept session; udidDetour cases.
- Fake-DOM flow test: kept session and no UDID gives the checklist with Register This iPhone failed, the Find row, no
  alert, and nothing sent to Apple. Then, with the UDID stored and Signing drawn again, Register This iPhone runs, Apple
  is asked, and no sign-in form appears.

## Tried and failed
- The first version hid the row while setup was still finishing, because the failed-step redraw happens before setup
  ends. The flow test caught it. Fixed by gating only the auto-continue on the running flag.

## Not verified
- The real-device check (fresh iPhone, free Apple ID, no stored UDID, on ifizbox.com) was not run. It needs a live
  Apple sign-in with the free Apple ID and a two-factor code on the iPhone 15 Pro, plus the website's relay. The flow
  was checked with the fake-DOM node test only.
- No Chromium screenshot: a static server has no /apple/status relay, so the block stays hidden. The row is a standard
  grouped row.
- Whether iOS Safari really reloads or opens a new tab after the profile install comes from T87a's report and was not
  re-checked.
