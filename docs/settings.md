# Settings

Settings is on Home, directly under the tiles, beside Theme. It is laid out like iOS 6's Settings app: short rows, one-line footers, each row
opening its own page.

The settings and their pages are defined in `web/app/core/settings.js` (`SETTINGS`, `SECTIONS`, `PAGES`).
`web/app/screens/settings.js` draws them.

## Layout

Like iOS 6's Settings app, the root is one list of short rows with no footers. Each row opens its own page.

| Root row | Builds | Page |
|---|---|---|
| iFizBox Account | all | sign in, create an account (screens/account.js) |
| General | all | Device and iOS Version (website only, one group); Works on My Phone and Compatibility Marks; Refresh Sources on Launch (apps only) and Return to Home After; Update Tweak Index (sideload only: on, the newest Tweak Index is fetched in the background; off, no such request is made and the copy already on the phone is used, which can be older); Blocked (packages and authors); Sideloading > Open Other Apps' Links (sideload only); Website > Lock Home and Other Apps > Install on the Website (website only; Install on the Website is padlocked while Home is locked) |
| Theme | all | Mode (Automatic / Light / Dark, a segmented control) and Themes (Light and Dark, each a checklist of themes) |
| Updates | all | Ignored Upgrades; Upgrade Notifications (jailbreak only); Automatic Installs (jailbreak only: Install Updates Automatically, When Charging and Locked, After a Respring Update, Keep Previous Versions); Update Alerts (sideload only) |
| Installation & Signing | sideload | no detail; how apps install, then the certificate: see "Settings > Installation & Signing" below |
| Signing | website | the certificate's name as its detail; see "Settings > Signing" below |
| Open in iFizBox App | website, not jailbroken | an action, not a setting (screens/importlink.js) |
| Install from URL | where Install IPA works | an action (screens/ipa-install.js) |
| Console Logs | jailbreak, or wherever there are logs | screens/queue.js |
| (version line) | all | Home's footer line (device, iOS, version, language) and the build's commit, at the bottom of the root. There is no About page; updates are checked on every launch and Reload |

- Switches sit in their rows (`createSwitch`). Choices are checkmark lists on their own page (Device, iOS Version, Install Updates Automatically, After a Respring Update, Keep Previous Versions,
  Re-sign Reminder).
- Each group's footer says what its rows do in one line. A test keeps each footer to 120 characters or fewer.
- Routes below Settings (`#/home/settings/…`): `general`, `theme` (`display` opens it too), `updates`, `installation[/pair]`, `<page>/<key>` (a list page),
  `<page>/holds`, `general/blocked`, `signing[/<key>]`, `signing/help` (How Signing Works), `account`, `logs[/<id>]`. In the sideload
  build `installation` and `signing` both open Installation & Signing; `installation/with`, `installation/iphone`, `installation/pair`,
  `signing/certificate`, `signing/server`, `signing/apps` and `signing/help` are the pages under it. The one-segment routes (`device`,
  `iosVersion`, `holds`) open their page too. Home's device hint and a package's "Set iOS Version" use them.

## Settings > Signing

The website's page, and the lower half of the sideload build's Installation & Signing. Laid out like an iOS 6 settings page, with one-line footers. `SIGNING_GROUPS` (core/settings.js) sets the order and
`signingLayout()` (screens/settings.js) picks the groups a build shows:

| Group | Builds | Rows |
|---|---|---|
| Certificate | website, sideload | Name, Team, Expires (or Certificate: None / Incomplete), then **Import Certificate** or **Replace Certificate**, which opens the file picker (the .p12, .mobileprovision and password file, or their .zip), and beside it in the same row the red **Remove Certificate** when there is a certificate or a picked file. The footer shows any problem in red |
| Files | while a file or the password is missing | .p12, .mobileprovision, Password, each with Browse |
| Provisioning Profile | once there is one | Name, (website: Type), Expires, Devices, App ID |
| Apple Developer Account | website, sideload, once there is a certificate | **Add API Key** (the App Store Connect `AuthKey_<Key ID>.p8`, then the Issuer ID); with a key: API Key, Issuer ID, Check Account, Remove API Key, and a Profiles Made by iFizBox group below (screens/devaccount.js; docs/signing.md, "Own provisioning profiles") |
| (options) | sideload | **Show Expiry Dates** (switch, on), Re-sign Reminder (list) |
| (expiry warning) | sideload | **Show Expiry Warning** (switch, on), Expiry Warning (list: 3 Days, 1 Week, 2 Weeks, 1 Month, 2 Months; hidden while the switch is off): how far ahead Home's certificate tile shows. The tile turns amber inside that window, red inside Re-sign Reminder's days, and solid red once the certificate or profile (whichever ends first) has expired. It stays solid red with the switch off |
| Signing Server | sideload | the server, Check Server, Run Your Own |
| Certificate Status, Signed Apps | sideload | Check Certificate; the signed apps (days left, or Expired), Re-sign All |
| Install iFizBox App, Bring My Certificate | website, certificate working | |
| Free Apple ID | website, no certificate set, the Worker's Apple relay on | **Use a Free Apple ID**, which opens the free route in place (the same group How Signing Works ends with) |
| How Signing Works | website, sideload | a link to `signing/help`: the two-step walkthrough (Select All Files, the Files picker's picture, the server) |

Show Expiry Dates is in the sideload build only: the website keeps no record of the apps it signs, so it shows no
dates and the switch would do nothing there.

## Settings > Installation & Signing

Sideload build only: one page, the root's Installation & Signing row. Its title shrinks to fit beside the back button
at 375pt, and the pages under it go back with "Back". The page (`mainPage` in `screens/installroute.js`, rules and
texts in `core/installroute.js`) is built once and filled in place: every row is there from the first frame, a
value still loading shows the grey spinner in its slot and fades in (opacity only), and answers never add or remove
rows or change footers. Top to bottom:

- A status cell, always two lines under its title (`installStatus`), and one action row whose label changes:
  Checking… (Check Connection, dimmed); Set Up This iPhone (not paired: the subtitle "Takes about a minute, once. Until
  then installs use the Signing Server."), or Finish Setting Up (paired, connection not tested yet), its action row
  Set Up This iPhone in both; that row opens This iPhone's page. The red failures are Couldn't Connect, iPhone Refused, Pairing Lost, No Network Extensions (the app's profile lacks them, so installs go through the Signing Server) and Not
  Responding, whose action row is Fix. Fix on Pairing Lost opens Pairing, which checks the kept pairing once more, then
  pairs. A failed check asks Not Now or Fix: Fix pairs again when the pairing is lost, otherwise it checks again
  from the start, and a second failure shows its plain reason (OK). Check
  Connection shows only while nothing is failing; a Fix tapped while a check runs joins it. On cellular without
  Wi-Fi, Check Connection, Fix, Test Connection and Set Up's test don't connect: they say "Can't Check on Cellular"
  ("Join Wi-Fi, then check again.", OK), with no Fix, no Pair Again and nothing kept as a Route Failure; the automatic
  checks stay silent. Installs there follow On Cellular. A tapped Check Connection, once the phone has answered, also
  checks Cellular Installs when Use Shortcut is chosen (never the automatic check): a failure shows "Shortcut Didn't Run"
  with Not Now and Add Shortcut Again (Try Again when the Shortcut itself isn't at fault). On cellular only the
  Shortcut is checked (its check touches no cellular data), after "Can't Check on Cellular". With Signing Server chosen: Ready to Install through the server, Check Server.
  With the built-in VPN (the app's profile has Network Extensions): Ready to Install, "Straight onto this iPhone,
  through iFizBox VPN".
- **Install Apps With**: This iPhone ("Works offline") and Signing Server ("Default - Uses ifizbox.com"), a row each
  with its icon. A tap on a row picks that way: its checkmark moves to it, and the way in use keeps its checkmark. A
  row for This iPhone that isn't set up yet (not paired, or its connection not tested once) opens its setup page
  (`installation/iphone`) instead. The first Test Connection that passes makes This iPhone the one in use; later tests
  keep the pick. On iOS 6 the row has a blue detail disclosure (the 4S's, `--accessory-detail`); on iOS 7, 13 and 26 it
  is an info circle (`--accessory-info`, in the era's tint). Tapping that button opens the way's page (`installation/iphone`,
  `installation/server`) with the push slide.
- **Signing**: Certificate › (`signing/certificate`, days left: the Certificate, Files, Provisioning Profile,
  Apple Developer Account and options groups, and Share Your Certificate), Signed Apps › (`signing/apps`, the
  count: Certificate Status and the list).
- How Signing Works › (`signing/help`).

The pages under it:

- **This iPhone with the built-in VPN** (`installation/iphone`, when `idevice.status`'s `vpn.available`): a status group
  first: Checking… (with a spinner), Not Set Up, Almost Done, Ready to Install, the failure (Pairing Lost or another
  red reason) or Not Responding, with one action: Start Setup, Test Connection, Check Connection or Fix. Its footer
  shows once it's ready: the other-VPN line ("Your VPN goes off during installs. Turn it back on after.") when another
  VPN is up or chosen in Settings > VPN and Restore My VPN is off, else
  none. Until This iPhone is set up, **Set Up** has three steps: 1. Pair This iPhone (opens Pairing),
  2. Allow iFizBox VPN, 3. Test Connection. A step that's done is checked, and the next one is open. Steps 2 and 3
  are done together: `vpn.test` turns the VPN on, connects once with the pairing and turns it off, and iOS asks to
  allow the VPN configuration the first time. The footer reads "Once is enough. It stays set up after updates and
  re-signing." Then **Restore My VPN**, a switch in a group of its own, off by default, shown when `idevice.status`'s
  `vpn.available` and the shell has the `restore` setting (before set-up too). Its footer reads "Your own VPN stays off after installs." when off. When on, the footer says what is left, with its fix row under the switch: **Add Shortcut** ("Add its Shortcut to finish.") until the Shortcut is added, then **Remember My VPN** ("Let the Shortcut remember your VPN to finish." with another VPN up, "Turn your VPN on, then remember it here." without). Once nothing is left, the footer reads "After installs, Shortcuts opens for a moment and turns your VPN back on." (with `vpn.restoreNever` true, "You chose Don't Ask Again. To be asked again, turn this switch off and on." instead), and **Remember VPN Again** ("Only if you changed VPN apps.") is a group of its own below.
  A tap shows at once and calls `vpn.setRestore`; a failed call puts the switch back. Turning it on adds the Shortcut unless it is added (the share sheet), then, back in the app with another VPN up, opens Shortcuts and runs its store run to remember the VPN. With the Shortcut added, it runs the store run only, when a VPN is up. The added state is kept in this browser's storage (`ifizbox.restoreShortcut`: 0 a run didn't find it, 1 added since the last store run that passed, 2 that passed); without it, `vpn.remembered` alone decides. Failures: alert "VPN Not Remembered" with Not Now, Try Again and, when the Shortcut wasn't found or wasn't allowed, Add Shortcut Again; "Turn Your VPN On" when no VPN is up; a Shortcut that can't be added here gives "Couldn't Add Shortcut", and the switch goes back off where this app or iOS has no such Shortcut. `busy` is retried every 2 s, up to 6 tries. Once paired, **On Cellular**, a group of its own (after Restore My VPN, before Forget Pairing): what an install does while the phone is on cellular data, where iOS refuses the connections. Three rows, **Ask Each Time** (the default; subtitle "Airplane Mode, Shortcut or server."), **Use Shortcut** (subtitle "Cellular data goes off for a moment.") and **Use Signing Server**, one checked, kept in this browser's storage (`ifizbox.onCellular`). Its footer follows the pick: "iOS can't install straight onto this iPhone while it's on cellular data." under Ask Each Time, "Shortcuts opens for a moment and turns cellular data back on by itself." under Use Shortcut, "On Wi-Fi, apps still go straight onto this iPhone." under Use Signing Server. Picking Use Shortcut adds the Shortcut first, unless it is added already: the share sheet, then one check once back in the app. If that doesn't pass, nothing is picked. While Use Shortcut is picked, its own group below On Cellular holds **Add Shortcut Again** ("Only if you deleted it from Shortcuts."). Ask Each Time shows a popup during a wait, and Use Shortcut runs Cellular Installs during it (docs/sideload.md); Use Signing Server sends the install through the Signing Server at once on cellular, with no popup. Where Cellular Installs can't run (`cellular.status` not available or not bundled), there are two rows, the first with the subtitle "Airplane Mode or server.", and a kept Use Shortcut counts as Ask Each Time. Then **Forget Pairing** (back to the Signing Server). Then **How It Works** › (`installation/how`:
  the five steps of one install: Download, Sign, iFizBox VPN On, Install, iFizBox VPN Off; and Offline). **Signing
  Server** (`installation/server`): Server, Check Server, Run Your Own. Without Network Extensions in the app's profile,
  This iPhone's page shows the Set Up group "Network Extensions: Missing" below.
- **Install Apps With** (`installation/with`, the older page): This iPhone (installd over the built-in VPN, docs/sideload.md) or Signing Server
  (the manifest and iOS's Install prompt, the default), with a checkmark, each subtitle a short point per line,
  wrapped. This iPhone's says Built-in VPN / No server, no install popup / Updates itself: installs
  through installation_proxy never show iOS's install prompt. Under the choice, the chosen route's groups slide in:
  This iPhone's (below), or the Signing Server's (Server, Check Server, Run Your Own). A tap moves the checkmark at
  once, whether or not the iPhone is paired, and the row shows the grey spinner until `idevice.status` answers.
- **This iPhone** (also `installation/iphone` on its own): the status group, then Set Up (until it's set up),
  Restore My VPN (when shown, with its fix row and, once nothing is left, Remember VPN Again), Forget Pairing (once paired), then **How It Works**, as above. While `idevice.status` is read, the status says Checking… with a
  spinner, and the steps appear once it answers. The last answer of this app run shows at once while it's read again; a failed or late read (past its deadline, `TIMEOUTS`) says Not Responding, red. A profile without Network
  Extensions shows a Set Up group "Network Extensions: Missing" with the footer "This profile has no Network Extensions,
  so it can't connect. Sign with one that has them, or use the Signing Server." No Developer Mode row: an install it
  stops explains it in its alert. Groups that come, go or change size slide (FLIP, transform and opacity only:
  nav/slide.js's watcher). An answer swaps only the rows that changed (`patchGroups`), never the whole page. Test
  Connection and Check Connection spin in their own row (no HUD) for at most 25 and 20 seconds. A check on this page
  doesn't change the Install Apps With pick.
- **Pairing** (`installation/pair`), one page that runs by itself: a sentence on what it gives, then on iOS 27 pairing starts
  on its own: the 6-digit code and where to type it, a line and a ringed Settings screenshot a step; before iOS 27,
  Import Pairing File; once paired, Paired with a check, Check Connection (which says Fix while it fails)
  and Forget Pairing. One pairing at a time: drawing the page again while it pairs, or coming back to it within 90
  seconds of leaving, keeps the same code and the same advertisement (iOS's Developer Mode page keeps a dead "Pair
  with" row for every advertisement that came and went).

## Retired keys

These keys are no longer settings. Nothing reads them (`RETIRED` in core/settings.js):

| Key | Now |
|---|---|
| `sideloader` (Sideloader) | iFizBox always signs and installs itself |
| `checkUpdates` (Check for Updates) | The app checks for its own updates on every launch and Reload (silent: a row in Changes), and the `ifizbox-upgrades` daemon checks daily, its default. A full `daemonPrefs()` sends `ifizbox.checkUpdates: null` so the shell removes any stored value |
| `cellular` (Use Cellular Data) | The daemon's default (cellular data on). Sent as null like `checkUpdates` |
| `notifications` (Off / Summary / One per Package) | Upgrade Notifications (jailbreak) and Update Alerts (sideload) are the controls |
| `badge` (App Icon Badge) | The icon always shows the upgrade count (Update Alerts > Icon Badge is iOS's own switch in the sideload build) |
| `allowZoom` (Zoom) | Zoom is always off: `applyZoom` keeps the no-zoom viewport, `html.no-zoom` and the cancelled pinch. Not in `TRAVELS`; an account or link that carries it is skipped (`isShown` is false) |

`createSettings()` runs `dropRetired()`, which removes `ifizbox.<key>` from storage for each key in `RETIRED`. It
runs on every launch and costs one lookup per key when nothing is left to remove.

## The settings and what reads them

| Key | Builds | Default | Read by |
|---|---|---|---|
| `appearance` | all | light | theme (screens/settings.js applyTheme, theme-boot.js) |
| `lightTheme`, `darkTheme` | all | classic, oled | the palette for Light and Dark (core/settings.js themeState, theme-boot.js) |
| `device` | website | none (Not Jailbroken) | device.js, home.js, sources.js, search.js |
| `arch` | none (stored only) | iphoneos-arm64 | backend.js getArch(). Device and the bridge set it |
| `worksOnMyPhone` | all | on | device.js, search.js |
| `compatMarks` | all | on | browse.js |
| `iosVersion` | website | auto | device.js |
| `refreshOnLaunch` | apps | on | app.js (the website refreshes on every unlocked launch by itself, so it shows no toggle) |
| `returnHome` | all | 2 minutes | app.js: back after this long, iFizBox opens on Home as if just launched |
| `holds` | all | none | upgrades, Changes, dpkg holds (jailbreak) |
| `upgradeNotifications` | jailbreak | on | ifizbox-helper notifications (the `ifizbox-upgrades` daemon) |
| `autoInstall`, `autoInstallIdle`, `respring`, `keepVersions` | jailbreak | off, on, notify, 1 | the `ifizbox-upgrades` daemon (daemonPrefs) |
| `showExpiry` | sideload | on | Installed's signature pills (installed.js withSignatures), an app page's Signature row (altstore.js signatureRow), Signed Apps' days (signed-apps.js). Off hides the days; Expired still shows |
| `resignReminder` | sideload | 2 days | signing.remind, Changes |
| `installRoute` | sideload | server | signing-client.js chooseRoute: every install, re-sign and queue run |

Nothing kept is only for debugging. Console Logs is an action that shows what installs did, not a setting.
