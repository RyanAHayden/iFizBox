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
| General | all | Device and iOS Version (website only, one group); Works on My Phone and Compatibility Marks; Refresh Sources on Launch (apps only) and Return to Home After; Blocked (packages and authors); Sideloading > Open Other Apps' Links (sideload only); Website > Lock Home and Other Apps > Install on the Website (website only; Install on the Website is padlocked while Home is locked) |
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
  Checking… (Check Connection, dimmed); Ready to Install, "Straight onto this iPhone, through LocalDevVPN" (or
  Tailscale), with Check Connection; Another VPN Is On, red, when a VPN that isn't Tailscale's is on, with Open
  LocalDevVPN, or Open Tailscale when the user set up Tailscale (Connect With: Tailscale, or signed in to it);
  Pair This iPhone with Start Pairing; Sign In to Tailscale when Tailscale's VPN is on and the app isn't signed in.
  Once that sign-in is in, the cell checks by itself in its own row (Checking…, "Checking Connection…" then "Checking
  Pairing…" under it, the grey spinner; no HUD), and a pairing the phone dropped is redone on Pairing by itself.
  Pair Again (a check the phone turned down) opens Pairing, which starts pairing at once.
  Tailscale's own VPN is never a conflict. With Signing Server chosen: Ready to Install through the server, Check Server.
- **Installation**: one row, Install Apps With › (`installation/with`), its detail the route and, for This iPhone,
  the pairing: "This iPhone · Paired", "This iPhone · Not Paired" or "Signing Server".
- **Signing**: Certificate › (`signing/certificate`, days left: the Certificate, Files, Provisioning Profile,
  Apple Developer Account and options groups, and Share Your Certificate), Signed Apps › (`signing/apps`, the
  count: Certificate Status and the list).
- How Signing Works › (`signing/help`).

The pages under it:

- **Install Apps With**: This iPhone (installd over LocalDevVPN or Tailscale, docs/sideload.md) or Signing Server
  (the manifest and iOS's Install prompt, the default), with a checkmark, each subtitle a short point per line,
  wrapped. This iPhone's says LocalDevVPN or Tailscale / No server, no install popup / Updates itself: installs
  through installation_proxy never show iOS's install prompt. Under the choice, the chosen route's groups slide in:
  This iPhone's (below), or the Signing Server's (Server, Check Server, Run Your Own). A tap moves the checkmark at
  once, whether or not the iPhone is paired, and the row shows the grey spinner until `idevice.status` answers.
- **This iPhone** (also `installation/iphone` on its own): **Pairing** (Paired / Not Paired, opens
  `installation/pair`), **LocalDevVPN** (On, Off or Another VPN) and **Open LocalDevVPN** with the "LocalDevVPN must
  be on" footer, none of which shows when Tailscale is the way in (Connect With: Tailscale, or Automatic with the
  app signed in to Tailscale and its VPN on); then **Connect With** (Automatic, LocalDevVPN, Tailscale: a tap moves
  the checkmark at once and spins that row until `tailscale.setConnect` and the status read after it answer, no
  HUD) and **Tailscale** (Sign In, or the device with Test Connection and Sign Out). No Developer Mode row: an
  install it stops explains it in its alert. Groups that come, go or change size slide (FLIP, transform and opacity
  only: nav/slide.js's watcher). `idevice.status` (Pairing, the VPN) and `tailscale.status` (Connect With, Tailscale) are read
  at once and each fills its own rows as it answers; the last answer of this app run shows at once, its rows spinning
  while they're read again; a read past its deadline (`TIMEOUTS`) says Not Responding, red. An answer swaps only the
  rows that changed (`patchGroups`), never the whole page. Test Connection and Check Connection spin in their own
  row (no HUD) for at most 25 and 20 seconds; Check Connection with neither LocalDevVPN nor Tailscale's route on
  answers Turn On LocalDevVPN at once instead of waiting out `idevice.verify`.
- **Pairing** (`installation/pair`), one page that runs by itself: a sentence on what it gives, the LocalDevVPN
  check (Turn On LocalDevVPN alert when it's off, rechecked when the app comes back), then on iOS 27 pairing starts
  on its own: the 6-digit code and where to type it, a line and a ringed Settings screenshot a step; before iOS 27,
  Import Pairing File; once paired, Paired with a check, Check Connection (Pair Again when the pairing is refused)
  and Forget Pairing. One pairing at a time: drawing the page again while it pairs, or coming back to it within 90
  seconds of leaving, keeps the same code and the same advertisement (iOS's Developer Mode page keeps a dead "Pair
  with" row for every advertisement that came and went), and every advertisement uses one kept key.

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
