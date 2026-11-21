# B299 Tailscale sign-in timeout message as a sentence

- `Tailscale.signIn`'s timeout failure text now reads "The sign-in didn't finish in 10 minutes. Tap Sign In to
  try again." The web shows it as the message of the "Couldn't Sign In" alert (`installroute.js`), and both
  Tailscale rows offer a "Sign In" button, so the hint names a real control.
- Left the other lower-case failure texts in the file alone ("sign-in canceled" never reaches an alert; the
  `connect_failed` ones are out of this task's scope).

**Not verified**
- On a phone: the timeout takes 10 minutes of an open login page, and the change is one string literal; no
  device run for it. No test pins the old or new text (grep found none).
