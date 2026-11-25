# F428a: Restore My VPN footer after Don't Ask Again

What: `web/app/core/installroute.js` has `RESTORE_NEVER_FOOTER` ("You chose Don't Ask Again. To be asked again, turn this switch off and on."). `restoreFooter` shows it when the switch is on, nothing is left to do, and `vpn.restoreNever === true`. The left-to-do footers and the switch-off footer are unchanged.

`web/app/screens/installroute.js` `rememberStatus`: after a tap on the switch, the cached status has `restoreNever` false. Native clears it on off (F427's `RestoreBack` `forget()`), and without this the old footer would show until the next status read.

Test: `web/app/core/installroute.test.js` (F428a case). `installroute.test.js` and `installroute-f372.test.js` pass together: 28 tests.

Shots: `shot.mjs` in Chromium with a fake bridge. `1-never.png` shows the footer; `2-off-and-on.png` shows the usual footer after the switch goes off and on.

Not verified: on a real phone with the real shell. Native clearing on off is F427's code and was not run here.
