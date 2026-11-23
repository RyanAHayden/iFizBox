# F392: split buttons from concept K7

## What was done

- Install Apps With (Settings > Installation & Signing): a tap on a row picks that way, its checkmark moves to it.
  An unset-up This iPhone opens its setup page. iOS 6's blue detail disclosure (settings.css `.cell-accessory`, tokens
  `--accessory-detail` / `--accessory-info`) opens the way's page. USE and ACTIVE are gone. Subtitle is "Works offline".
  The first Test Connection that passes makes This iPhone the one in use; later tests keep the pick.
- Install Switch: Add passes `vpn.openShortcuts` an optional `link` (`SHORTCUT_LINKS.switch` in core/installroute.js,
  an iCloud share link). The link is null today, so Add shares the signed file. With a link, "Share Shortcut File" is a
  backup row on Install Switch's page, and the "Shortcut Not Added" alert has Share File.
- More Sources, Find More / App Sources and Add Tweaks keep ADD. The row's whole right end (92px) is the button's
  (`nav/ui.js` buttonZone, `style.css` `.tap-zone`).
- Install IPAs rows have no SIGN / INSTALL / OPEN. They open the IPA's Details, whose bar button says Open when the app
  is on the phone (Install is then a row), else Install.
- Version History and Version are one page, "Version", reached from Details' Version row (value and chevron, no
  CHANGE). Each version is a button row with a chevron; tapping it opens the Install sheet. Its line reads
  "date · size · iOS 17.4+". Notes fold to three lines with Show More / Show Less. An installed version gets an
  "Installed" tag if it can be reinstalled, greyed INSTALLED if it can't (apps too).
- Holding Install (Upgrade / Modify…) queues quietly, with no Confirm, and shows the Undo bar; as a row's left swipe
  it does the same. Modify queues an upgrade when there is one; otherwise (up to date, already queued, paid, Add to
  App, website) it opens its usual menu. There is no version picker. Jailbreak app package pages got an Add to Wish
  List row (it was only in the old hold's sheet).
- Removed the price button's `.go` and `.busy` states from myipas.css and the era sheets. `.price-btn` is now ADD /
  ADDED and INSTALLED.
- docs: settings.md (Install Apps With, Install Switch), signing.md, sideload.md (`vpn.openShortcuts`), release.md,
  eras.md (price button tokens, accessory tokens), README.md alt text, GLOSSARY.md ("Version" entry). Release note
  `release-notes/F392.md`.

## Failed and decisions

- The concept's own SVG tick was replaced by the existing `.cell-check`.
- The concept's whole ios6.css block moved to settings.css, style.css, packages.css and the era sheets. ios6.css
  itself has no new rules.
- Add opening Shortcuts directly is blocked on the iCloud link. It was not made here: a link publishes the Shortcut to
  a person's iCloud, so an Apple ID owner has to make it by hand (Shortcuts > Share > Copy iCloud Link).

## Checks

- Chromium: the concept frame with the K7 sample shell (scratchpad). iOS 6 light (classic and legalpad), dark
  (gunmetal and wood), iOS 7, 13 and 26 in light and dark, iPhone 16 and SE.
- Screens covered: Install Apps With, More Sources, App Sources, Add Tweaks, Install IPAs (swipe and Manage), the IPA
  page, the Version page (pressed, sheet, Show More), and holds.
- No page errors. The concept's one-off error did not come back.

## Not verified

- The native link open. No iCloud link exists yet, and the Swift builds were not run for it.
- iOS 26's native alerts and menus. Chromium has no shell for them.
- Phones were not used.
