# B396: an outdated Install Switch is offered up front

## Summary

When This iPhone is in use and the Install Switch added on the phone is an older one, the update is offered
before the first install, not only when an install fails. Home, Installation & Signing's status and Set Up offer
Update Install Switch; choosing This iPhone asks once; an install that would run the Switch asks before it starts.

## What was done

- `web/app/core/installroute.js`: `SWITCH_OLD` texts, `switchOutdated(choice, st)`, `SWITCH_OFFER`, the
  `ifizbox.switchLater` helpers (`switchLater`, `rememberSwitchLater`, `noteSwitch`), and `decideRoute` taking
  `later` (an install that would run an outdated Switch goes to the `switchOld` alert unless Later was "install").
- `web/app/screens/installroute.js`: `offerSwitchUpdate` asks the offer; `recheckPairing` takes `first`, so the
  offer comes before its `idevice.verify`, which may run the Switch; the status cell, Set Up's Install Switch row
  (Update) and its footer; Home's warning slot shows Update Install Switch.
- `release-notes/B396.md`: one sentence for the release.
- `docs/settings.md`: the status cell, Set Up's Install Switch row, and the choose / install prompts with Later.

## Decisions

- Later at choosing leaves one more ask at the next install that would run the Switch. Later there ends the
  questions (`install`). Both are forgotten once the Switch is current.
- `recheckPairing` takes `first` so the offer comes before `idevice.verify`, which may run the Switch.
- Home's tile is amber (installs still work), in the cellular one's slot; a red signing warning (certificate ending) comes first.
- The Pairing page's own switches to This iPhone offer it too (found in the spec review).
- A route held for a run (60 s, as before) isn't asked again when the network changes inside it.
- Not offered to a renamed app (`trips` false): no Install Switch can do one trip there.

## Failed

- The first version read the status separately before `recheckPairing`. It broke two source-text tests (b220,
  b320). The read now goes through `first`, and b320's regex is loosened to match.

## Checked

- Node tests in `web/app/screens/installroute-f394.test.js` for old, current and none in each place.
- Chromium shots at 402 and 320pt with the fake bridge (`shots-402.png` in this folder).

## Not verified

- On a real phone. Chromium covers the web change. Deleting and adding the Shortcut itself is unchanged.
