# D24: iPhone 15 Home Screen icon gotchas in docs/iphone15.md

Added three bullets under Gotchas in `docs/iphone15.md`, from R63's findings
(`journal/2026-11-21-r63-icon-mode-phone-check/notes.md`):

- The Home Screen icon changes at once after an alternate-icon switch; only notification icons wait for a restart.
- Dark mode alone keeps Home Screen icons light while Customize is on Default; a Dark check needs Customize > Dark > Auto.
- WebDriverAgent's `POST /wda/device/appearance {"name":"dark"|"light"}` switches the phone's mode.

Docs only; no phone used.

## Not verified

- Not re-checked on the phone: the facts come from R63's device run the same day, and a docs task has no reason
  to take the phone lock (docs/iphone15.md: phone only when nothing else can check).
