# F410b Quiet Pairing Check

Did:

- With This iPhone chosen and set up, the sideload app checks its pairing in the background (`idevice.verify`) at
  5 s after launch and 2 s after coming back, at most once a day, plus at each launch while a Route Failure is kept.
  A pairing refusal is kept as Home's Pair Again failure; a pass clears it. Code: `core/installroute.js`
  (`quietCheckDue`, `markQuietCheck`, `quietCheckAllowed`), `screens/installroute.js` (`quietPairingCheck`,
  `runQuietCheck`), `app.js` (the launch and coming-back timers), `signing/route.js` (`installingNow`).
- Docs: `docs/sideload.md` (Quiet Pairing Check bullet under This iPhone), `release-notes/F410b.md`, and the
  glossary entry Quiet Pairing Check.
- Tests: `core/installroute-b316.test.js` (the day's timing, the allowed conditions) and
  `screens/installroute-f410b.test.js` (what a check does with each answer, each skip condition, one at a time,
  the app.js wiring).

Decisions:

- No network is skipped because the built-in VPN can't start without one; it is covered by the Wi-Fi condition.
- Only pairing failures and route_refused are kept. A timeout, a failed connect or a VPN that didn't start changes
  nothing, so a slow phone never shows a warning.
- The second try (3 s later) avoids a false warning while remotepairingd restarts. Its status is read again and the
  conditions are checked before it runs.
- An app run counts as an install until its page closes.
- With a failure kept at launch, a launch check that couldn't run runs on coming back. The day is only used up when a
  check starts.
- An install or a user's check that starts during the verify drops the quiet answer. Test Connection waits for it.
- After a page reload during a native install only the built-in VPN being on stops it; the page has no other sign.

Not verified: on a real iPhone (node tests only, fake bridge). Not checked: a background verify's VPN icon, and a VPN
app that's chosen but off with On Demand (not seen by the check). The phone wasn't used.
