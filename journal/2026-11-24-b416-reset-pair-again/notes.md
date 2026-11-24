# B416: a reset first connect is Pair Again

With no host paired, remotepairingd takes the TCP connection and resets it (B246), so the install's first connect
ends in `connect_failed: Socket(Os { code: 54, kind: ConnectionReset … })`.

- Shell: `IDevice.isEarlyEOF` takes a reset too, so a first connect becomes `pair_again`; the raw text goes to the
  grey log (`note`). Once connected, a reset stays a drop that reconnects.
- Page: `droppedPairing` (core/installroute.js) is the one test for `pair_again` and a `connect_failed` early EOF or
  reset: `verifyFailure`, `deviceError`, `turnedDown`. All say `PAIR_AGAIN_LINE`, with fix "pair". It names the app
  rather than "the app": in "Feather: This iPhone isn't paired with the app" that reads as Feather.
- `plainSocket` takes idevice's socket text out of red lines, alerts and the pairing footer. A timeout is now
  Couldn't Connect, not Pairing Didn't Work.
- A queue row's pairing failure wasn't kept (only single installs' were), so Pair Again opened a page that still said
  Paired. `openPrepared` keeps it, and Pairing then runs `recheckPairing` once a visit (checks, checks again, forgets, pairs).

## Not verified

- On a phone: the reset needs a phone that has dropped its only host pairing. The 15 Pro's pairing is shared with
  the other phone tasks, so it was not removed. Nothing here needs the device but the shell's string match, which the
  user's screenshot gives word for word.
