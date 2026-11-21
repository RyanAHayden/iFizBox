# B297 Open <app> after a single-app upgrade

- Was leaving Upgrade out meant? The B111 commit (e457d9a3) that added `openRow` says only "Open <app> at the
  end" for installs on This iPhone, and its test lists what is left out (iFizBox itself, a sent row, the server
  route, more than one row), with no word on upgrades. An upgrade puts the new version in place through the same
  lane, so there is the same app to open: an oversight.
- `openRow` (web/app/screens/apprun.js) now takes mode `install` or `upgrade`. A re-sign is still left out (no
  new app; the task asked only for Upgrade).
- Test: web/app/install-here-progress.test.js, upgrade gives Open Alpha; resign and failed give none.

**Not verified**
- Not checked on the iPhone 15 Pro: a one-line mode check covered by the unit test; a device run needs an app
  with an upgrade waiting in a source, which a low-priority follow-up does not justify.
