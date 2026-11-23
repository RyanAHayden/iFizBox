# F399: Install Switch iCloud link

## What was done

- The owner's link is set in `web/app/core/installroute.js`:
  `https://www.icloud.com/shortcuts/733163d13cc04d469e36a6c85c66f32e`.
- Checked: the iCloud record's shortcut has 92 actions, equal to origin/main's
  `tools/shortcuts/install-switch.plist` (only `WFWorkflowClientVersion` differs). Its `signingStatus` is APPROVED.
- Tests b359, f372 and f394 are updated for the link. Docs (`docs/sideload.md`, `docs/settings.md`) and a release note
  say Add opens Shortcuts directly with the link. `release-notes/F399.md` says the same.
- The Swift change in `native/sideload/vpn/App/LocalVPN.swift` (`vpn.openShortcuts` with `link`) opens the iCloud link
  itself as a universal link (`universalLinksOnly`), not through `shortcuts://import-shortcut`.

## Finding: the live site serves a different file

- On 2026-11-23, `https://ifizbox.com/shortcuts/Install%20Switch.shortcut` had md5
  `66403dd230114c131b04f4ee306ba1b0`.
- Main's `web/app/shortcuts/Install Switch.shortcut` (re-signed in F394, commit `e0e07268`) and its
  raw.githubusercontent.com copy both had md5 `e7ee904c53a6e6bf66ca02a4806a71bb`.
- Why the live site's file differs is not checked.

## iPhone 15 Pro test (iOS 27)

Chromium can't check Shortcuts, so this ran on the phone.

- The old Install Switch was deleted in Shortcuts, and `vpn.checkShortcut` was run from Web Inspector, so the app
  marked it not added. The Install Switch page showed Add and Share Shortcut File.
- First attempt failed. F392's `shortcuts://import-shortcut?url=<link>&name=` (and the same without `name`) showed the
  Shortcuts alert "The file isn't in the correct format." `shortcuts://shared/<id>` and `shortcuts://www.icloud.com/...`
  did not open Add Shortcut. The plain https link did.
- Fixed in `LocalVPN.swift`: the app opens the link itself with `universalLinksOnly`. The build was rebuilt and installed.
- With the fixed build, Add on Set Up opened Add Shortcut (Install Switch). After Add Shortcut, the app came back.
  The check run asked to Allow "Install Switch" to run actions from the app; Allowed. The row then said Done.
- The phone was left on that build with the link's Install Switch. Only a comment changed in Swift after the test.

## Gotcha

- No bridge call marks a Shortcut as not added (`vpn.setShortcut` is gone). To test "not added", delete the Shortcut
  in Shortcuts and run `vpn.checkShortcut`.

## Not verified

- The Share Shortcut File tap. The row was seen on the page but not tapped. Its path is unchanged since B359.
- Update opening the link.
- The case where Shortcuts isn't installed. It should say "Shortcuts didn't open".
- iOS before 27.
- The Add tap on the Install Switch page itself with the fixed build. It is the same function as Set Up's.
- Why the live site's file differs from main.
