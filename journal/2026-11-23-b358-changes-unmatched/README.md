# B358: Changes row for an app its source no longer lists

## Problem
An installed app whose source entry is gone showed "Package not found" from its Changes row with no way out, and
the source's app page lost its Modify / mark button. The case that hit it: Unbound, installed under a custom bundle
ID taken from another app on a source, so the ID the source lists never matched the installed one.

## What I did
- `web/app/screens/browse.js`: packageList got a `moreItems(item)` option. Its items are appended to a row's hold
  menu (the black callout), after the list's own items (Share, Source, queue items).
- `web/app/screens/changes.js`: `holdItems` and `markRowNotInstalled`. In the sideload app and the website, holding a
  Changes row offers Mark as Not Installed for anything installed: Needs Re-sign and upgrade rows always, a day's row
  when its ID is installed. Never iFizBox itself. The jailbreak build gets none (it has Remove). It forgets the device
  record and, in the sideload app, the shell's signed record (`signing.forget`), then Changes reloads.
- `web/app/core/installed.js`: `recordOf(records, id, signed)` matches a device record by the installed bundle ID
  first (`signed.bundleId`), then the asked ID, then `signed.originalBundleId`. `forgetInstalled` does Mark as Not
  Installed's forgetting.
- `web/app/screens/altstore.js`: trackingSection, toggleMarked and appPageAction find the record with `recordOf`. An
  app iFizBox signed counts as installed with no matching record: the nav button reads Modify, and the Modify sheet
  offers Reinstall / Upgrade, Re-sign, Mark as Not Installed. Re-sign from the Modify sheet queues the job under the
  signed record's installed bundle ID (it used the source's ID, so `signing.resign` could not find a custom-ID app).
  Mark as Not Installed there also forgets the signature (new `forgetSigned` option).
- Decision: the record written at install time (`screens/queue.js` `recordApp`, keyed by the source's ID) was left as
  it is. The matching side reads the installed ID first instead, so old records under either ID are found. Why:
  changing what is written would leave existing records unmatched and touch the website's records too.
- Tests: new `web/app/screens/changes-unmatched.test.js` (7 cases). `resignqueue.test.js` updated: a signed but
  unrecorded app's sheet is now Reinstall / Re-sign / Mark as Not Installed instead of Install / Re-sign (intended
  change).

- Spec review fixes: a Re-sign queued under the installed (custom) ID now reads as queued on the source's app page
  (Modify starts with Clear, which clears that job), and Mark as Not Installed on a package iFizBox has no record of
  (installed only by the installed packages list) says so in an alert instead of doing nothing.
- "Always offers": read as every row that is installed (Needs Re-sign, upgrades, installed day rows); a row for
  something not installed has nothing to forget, so it gets no item.

## Tried and failed
none

## Not verified
- Not checked in Chromium or on the iPhone 15 Pro: the real hold menu, the callout's look, and `signing.forget`
  against the real shell. Covered by `node --test` with fakes only. Why: the logic is pure and tested, and the callout
  itself is unchanged code (`browse.js` `attachRowMenu`) with items appended. Its guard needs the row's link, which
  every package-list row gets (`bindRow` sets `package:<id>` whether or not a source lists it); not driven by a test.
