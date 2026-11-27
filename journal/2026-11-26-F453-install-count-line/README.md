# F453: install count line on package pages

- Brought F452 back (git revert of B493's revert 6ead1b77).
- `installsLine(count)` in web/app/screens/details.js: "N installs" only when N > MIN_TIER (5, Popular's minimum), else null.
- browse.js renderPackage: a slot under Information, filled (sliding in) from `backend.installs.counts()`; an `enabled:false` server gives `{}`, so no line.
- Unit test in details.test.js. tools/check.sh passes.
- Apt package pages only; AltStore app pages are not changed.

**Not verified**: the line drawn in a browser or on a phone (no counts server here).
