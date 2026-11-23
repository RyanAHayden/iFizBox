# B383: menus from buttons open as native menus, the same way each time

## Reproduced (iPhone 15 Pro, iOS 27, 0.25.0 build)
- Select… opened UIAlertController's popover bubble (base-select.mp4). In 8 taps 120 ms apart, the page got
  answer -1 after 108 ms while a popover stayed on screen, answering nobody.
- From the code, not reproduced on the phone: Share with icons always used the CSS menu.
- Also from the code: a source lost (the element was redrawn, more than 3 s after the tap, e.g. Modify > wait > Downgrade) fell to
  the bottom middle of the screen.

## Fix
- showActionSheet with a source (a button, or the tapped row) sends ui.menu with sheet: true, title, items,
  destructive, icons and rect. The native UIMenu opens from the shell's own glass button (NativeGlass.button(at:))
  or from an invisible button over the rect. ui.actionSheet only with no source.
- Icons: nativeIcons from sharesheet.js (SF Symbols doc.on.doc and qrcode, app images, letter tiles).
- One menu at a time: a call meanwhile answers -1; a call after the answer is queued until the menu goes.
- Items keep the menu presented. A tap in the first 0.4 s, or within 0.4 s of the previous tap, picks nothing and
  the menu stays up.
- Answer -1 comes when the menu starts to go.
- lastTap is refreshed after an answer and by a "menupick" event from menu.js. A redrawn row uses the rect it had.

## Tried and failed
- Ending the session at the dismiss animation's completion: about 1.2 s late. The button reopened the already
  answered menu natively, and its items did nothing.
- Answering early picks with -1: the menu opened and closed within the run.
- An invisible button left over the row for 1.5 s swallowed the next tap on Clear Logs. It now takes no touches.

## Checked on the 15 Pro
Not in Chromium: these are UIKit menus.
- Recordings: select, share, modify, logs, downgrade.
- Logs: 3 slow opens, and fast runs at 120 and 250 ms; select also at 60 ms. Same items, same place, nothing picked.
- Downgrade: 3 times; waited 4 s before picking on 2 of them.
- Slow pick of With Updates selected 2 rows.
- Share > Copy Link answered index 0.
- A held source row's Copy URL menu opens and puts away.
- Review: the real Write a Review sheet with a made-up review and an onDelete that does nothing.
- Builds: select.mp4 and review.mp4 are on the final build; share, modify, downgrade and logs a build or two
  earlier. Since then: the invisible button takes no touches once its menu goes (logs, downgrade have it), and the
  review fixes below. The 60 ms Select run was on the first of these builds.
- location.href to an app link with no gesture opens the app (shortcuts:// opened Shortcuts), so Share's app rows
  work after the native answer.
- The user said mid-run that they tested it on the phone and it looks good, on an earlier build than the final one.
  Touches of theirs may be in the counts of one discarded run.

## Spec review
Fixed: a second call while a menu goes answers -1 instead of replacing (and never answering) the first; the fast-tap
rule and keepsMenuPresented are only for sheets, so a held row's menu and the edit menu fallback close as before.
Kept: a sheet with no source, or whose menu failed to show, is still ui.actionSheet; rows count as sources (Clear
Logs is one); the web app and the shell ship together, so an older ui.menu never gets these fields.

## Not verified
- Sources' and Installed's Manage toolbar Delete (n), Delete IPA and Add All on the phone: same code path as Clear
  Logs and Delete Review. The Sources script hit the tab bar instead.
- Manage itself opens no menu on Installed or Sources, so there is nothing to record.
- The held row's menu after the review fixes (it was checked before them).
- The clipboard's contents after Copy Link.
- Icons in light mode.
- iPad.
- iOS 26.x (only 27 was tested).
- VoiceOver.
