# B322 Install Apps With: kept-pairing check spins the Pairing row

## What I did

Checked whether anything was left after B320. Nothing was:

- `web/app/screens/installroute.js`: both Install Apps With calls (picking This iPhone again, a new Connect With)
  pass `{ spin: pairSpin }` to `recheckPairing`; `pairSpin` sets `pairChecking`, which makes the Pairing row spin.
  `recheckPairing` uses the spinner when one is given and falls back to the "Checking Pairing" HUD only without one.
- `web/app/screens/installroute-b320.test.js` already tests it ("Install Apps With's check of the kept pairing spins
  the Pairing row, not the HUD"), so no new test went in `installroute-b220.test.js`.

No code change; the task is closed as covered by B320.

## Not verified

- On-device look of the spinning row: not re-checked here, since nothing changed; B320 checked its flows on the 15.
