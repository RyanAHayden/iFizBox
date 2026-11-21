# The iPhone 7 test phone

The phone that runs iFizBox's jailbreak build (.deb). The iPhone 4S (`ssh 4s`, iOS 6) stays the
Cydia look reference only and never runs iFizBox.

| | |
|---|---|
| Model | iPhone 7 (iPhone9,1, A10, T8010) |
| iOS | 15.8.8 (19H422), the last iOS for the iPhone 7 |
| Jailbreak | palera1n v2.4, **rootless** (`/var/jb`, iphoneos-arm64), semi-tethered |
| Network | Wi-Fi `192.168.0.189`, `ssh 7` (Host 7 in `~/.ssh/config` on the desktop) |
| Login | `mobile`, the desktop's key. `sudo` is passwordless (`/var/jb/etc/sudoers.d/mobile`); if `sudo -n true` fails, ask the user, never store a password |
| Plugged into | the T490 (`ssh rytp@omarchy-tp`), used to re-jailbreak it |

## Rules

- Touch it only when your task says so. It is the only modern jailbroken phone.
- Only when Chromium or a local check can't do it. Changes to `web/app/` are checked in Chromium (the
  `tools/readme_shots.py` / `capture.mjs` route, with the fake bridge) and with `node --test`. The phone is for what
  needs the real device: the native shell and root helper, installing, iOS-only WebKit bugs (iOS 15 JavaScript
  syntax), Home Screen icons, notifications. Write in the journal why Chromium couldn't do it.
- Drive its screen only through `tools/ui-7.sh`, under its lock (below). `ssh`, `dpkg -s`, reading files and pulling
  logs need no lock.
- No `apt upgrade` of system packages, no removing palera1n, Sileo, ElleKit or openssh. Installing and removing
  iFizBox and test packages is fine when the task is about that.
- If `ssh 7` fails or `/var/jb` is missing, the phone rebooted and lost its jailbreak. Stop and ask the user to
  re-jailbreak it (below); don't try to do it yourself.

## Driving the screen: `tools/ui-7.sh`

```sh
tools/ui-7.sh lock $ID                # your task's ID; fails, naming the holder, if someone else has it
tools/ui-7.sh $ID shot before         # screenshot -> ref/7/screens/before.png (750x1334)
tools/ui-7.sh $ID open ifizbox://sources
tools/ui-7.sh $ID tap 375 600         # screenshot pixels, portrait
tools/ui-7.sh $ID swipe 375 2 375 900 0.4   # from the top edge: Notification Centre
tools/ui-7.sh $ID home
tools/ui-7.sh unlock $ID              # always, also after a failure
```

- `open` takes any URL. `ifizbox://<tab>` (home, sources, changes, installed, search, settings) opens iFizBox on
  that tab, launched or already running; the other `ifizbox://` links are listed in `web/app/incoming.js`.
- Coordinates are screenshot pixels (750x1334; points x2), so read a spot off a screenshot and tap it.
- From the top edge, `swipe 375 2 375 900 0.4` opens Notification Centre; `home` closes it.
- **Control Centre doesn't open yet:** bottom-edge swipes (`375 1333 → 375 500`, 0.4 s and 0.8 s) do nothing.
  Bottom-edge gestures probably need something phonectl doesn't send (a touch starting below the screen, or a
  different digitizer flag). Until that's fixed, a person checks iFizBox's Control Centre controls.
- Left-edge swipe-back (`swipe 2 600 600 600 0.3`) is the same kind of gesture, untested so far.
- Long-press: a swipe that doesn't move, `swipe X Y X Y 2.0`. On an icon that starts Home Screen jiggle mode (tap
  the badge's minus to remove a web clip); a 1-pixel move turns it into a drag and does nothing.
- App switcher: two Home presses in one ssh call (`ssh 7 '/var/jb/usr/local/bin/phonectl home;
  /var/jb/usr/local/bin/phonectl home'`, under your lock). Swipe a card up (`swipe X 700 X 30 0.2`) to close it.
- Deleting a test app the helper won't remove: `open 'prefs:root=General&path=STORAGE_MGMT'`, then search, pick the
  app, Delete App twice. `prefs:` links open Settings pages (give them a few seconds to load).
- Typing: tap the on-screen keyboard's keys; there is no pbcopy. In screenshot pixels: row 1 y=958 (q 37, w 112,
  e 187, r 262, t 337, y 412, u 487, i 562, o 637, p 712), row 2 y=1066 (a 75, s 150, d 225, f 300, g 375, h 450,
  j 525, k 600, l 675), row 3 y=1174 (z 150 … m 600, backspace 700), "." 250,1284 on the URL keyboard.
- Tapping a notification in Notification Centre through phonectl does nothing; a person checks notification taps.
- `lock-button` presses the side button (sleeps or wakes the screen). If a screenshot is all black, the screen is
  asleep: `home` wakes it. The phone has no passcode, so `home` again opens it from the lock screen.
- A lock unused for 30 minutes is stale and can be taken over. Give it back as soon as you're done (in a script,
  `trap 'tools/ui-7.sh unlock $ID' EXIT` after `lock`); when a runner session ends or is dropped, the runner frees
  every phone lock its task holds (`runner.toml` `on_exit` runs `tools/ui-release.sh`).

### `phonectl` (what ui-7.sh calls)

A small C tool on the phone, `/var/jb/usr/local/bin/phonectl` (setuid root), source in `tools/phonectl/`:

```
phonectl size | sender | tap X Y | swipe X1 Y1 X2 Y2 [secs] | home | lock | shot FILE.png|-
```

- Touches go through `IOHIDEventSystemClientDispatchEvent`, sent as the built-in touchscreen (its registry ID,
  `phonectl sender`). With any other sender ID backboardd drops them silently.
- Home and side buttons are consumer-page key events (0x0C/0x40, 0x0C/0x30).
- Screenshots use `CARenderServerRenderDisplay` into an IOSurface. The entitlements in
  `tools/phonectl/entitlements.plist` are all needed: without `com.apple.security.iokit-user-client-class`
  (IOSurfaceRootUserClient) `IOSurfaceCreate` returns NULL, and without `com.apple.QuartzCore.global-capture` the
  screenshot is black.
- `shot -` writes the PNG to stdout; ui-7.sh uses that so a setuid run leaves no root-owned file on the phone.
- Rebuild and reinstall: `tools/phonectl/build.sh` (needs `IOS_SDK` and ld64.lld like `native/build.sh`; signs
  on the phone with its `ldid`). It installs with `sudo -n`; `PHONE_SUDO_PASS` is only a fallback if that fails. It survives reboots (it's in `/var/jb`).

## Installing iFizBox on it

```sh
native/build.sh deb                                  # -> native/build/iFizBox.deb (tools/check.sh builds it too)
scp native/build/iFizBox.deb 7:/tmp/
ssh 7 'sudo -n apt-get install -y /tmp/iFizBox.deb'  # apt resolves Depends; plain dpkg -i doesn't
ssh 7 'launchctl list | grep com.ryha.ifizbox'       # the app and the upgrades daemon
```

`sudo` needs no password; scripts use `sudo -n` so they fail instead of
hanging at a prompt if the rule is ever gone. Remove with `sudo apt-get remove -y com.ryha.ifizbox`.

iFizBox is installed on the phone as `com.ryha.ifizbox` (`ssh 7 dpkg-query -W com.ryha.ifizbox` shows which build). Leave it installed: other tasks test iFizBox here. A build under the project's old name (another package ID) installs
beside iFizBox instead of over it: don't install one on this phone; if one is there, remove it and its
files as below. Check the version before assuming what a test runs. To reinstall a newer build, install the new
.deb over it as above (`--allow-downgrades` if its version is lower).

Where it lives:

| | |
|---|---|
| App | `/var/jb/Applications/iFizBox.app` |
| Root helper, upgrades daemon | `/var/jb/usr/libexec/ifizbox/ifizbox-helper`, `ifizbox-upgrades` |
| launchd job | `/var/jb/Library/LaunchDaemons/com.ryha.ifizbox.upgrades.plist` |
| Its APT sources | `/var/jb/etc/apt/sources.list.d/ifizbox.sources` |
| State, caches | `/var/jb/var/lib/ifizbox/`, `/var/jb/var/cache/ifizbox/` |
| WebView data | `/var/mobile/Library/WebKit/com.ryha.ifizbox` (localStorage, IndexedDB; made by postinst), `/var/mobile/Library/{Caches,HTTPStorages}/com.ryha.ifizbox`, `Cookies/com.ryha.ifizbox.binarycookies`, `Saved Application State/com.ryha.ifizbox.savedState` |

A fully clean removal: `apt-get remove`, then delete the sources file, the
state and cache folders and the WebView data above, the app's leftover containers (folders under
`/var/mobile/Containers/{Data/Application,Shared/AppGroup,Data/PluginKitPlugin}/` whose
`.com.apple.mobile_container_manager.metadata.plist` names the bundle ID), and run `uicache -a`.

## What's installed

Sileo 2.5.1, apt 2.9.4, dpkg 1.22.6, uikittools (`uicache`, `uiopen`, `sbreload`), `launchctl`, openssh 9.7,
`unzip` and `ldid` (iFizBox's Depends/Recommends), ElleKit 1.2 (tweak injection, for AppSync and paid-tweak tests),
`curl`. Sources: palera1n, ElleKit, Procursus, Havoc, Chariz, BigBoss. No `awk`.

Known quirks:
- Havoc answers command-line `apt` downloads with **418 I'm a teapot**; it serves only Sileo. Install Havoc
  packages from Sileo on the phone (a person has to tap).
- `apt update` warns that repo.palera.in is unsigned (`NO_PUBKEY 9E7E89B50CCF8DAA`; `nebula-keyring` is too old).
  Harmless: only the palera1n loader's own packages come from there.

## Re-jailbreaking after a reboot (a person does this)

palera1n is semi-tethered: after a reboot the phone boots stock, without `/var/jb` or SSH.

1. The phone stays plugged into the **T490** (Intel). checkm8 failed on the desktop (AMD Ryzen USB controllers:
   "UaF race … setup packet was not accepted") and on the M3 MacBook Air.
2. From the desktop: `ssh -t rytp@omarchy-tp 'sudo ~/jailbreak/palera1n -l'`.
3. usbmuxd isn't installed on the T490, so palera1n can't see a normally booted phone. Put it in DFU by hand while
   palera1n waits: hold Side + Volume Down 8 s, let go of Side, keep Volume Down 5 s more. Black screen = DFU.
4. palera1n boots the phone jailbroken; `ssh 7` works again within a minute.

The T490 has `apple_mfi_fastcharge` blacklisted (`/etc/modprobe.d/no-mfi-fastcharge.conf`): that driver grabs the
phone in DFU and breaks checkm8 on Linux. If palera1n says "Resource busy", another palera1n/checkra1n process is
still holding the phone: kill it and retry.

## Serving a test repo to the phone

The desktop's firewall blocks the phone from reaching it over the LAN. To serve a repo you built, use a reverse
tunnel instead: `python3 -m http.server 8711 --bind 127.0.0.1` in the repo folder, then
`ssh -N -R 8711:127.0.0.1:8711 7`. On the phone it is `http://127.0.0.1:8711/`, in iFizBox, Sileo
(`sileo://source/http://127.0.0.1:8711/`) and Zebra alike. Keep the pids, stop both when you're done, and take the
stanzas back out of `sileo.sources` and Zebra.

Sileo 2.5 drops a repo whose Release has no `Components:` field. Zebra 1.1.36 can't read files that redirect to very
long URLs (GitHub release assets; iFizBox's `/repo/` proxy answers with the file itself, see docs/release.md).

## Test IPAs: AppSync Unified and a fakesigned app

AppSync Unified 116.0 (`ai.akemi.appsyncunified`, rootless) is installed, from the upstream GitHub release
(github.com/akemin-dayo/AppSync, release 116.0). Leave it installed: the helper's `install-ipa` uses it.

installd still wants an `application-identifier` entitlement, even with AppSync: an unsigned binary (like
`native/testkit.py ipa()`'s) fails with "Application is missing the application-identifier entitlement". The
helper's `install-ipa` fakesigns it itself: each binary without `application-identifier` (the main one and every
`PlugIns/` or `Extensions/` .appex) gets `ldid -M -S<ent>` on that binary alone, with `<team>.<its own bundle id>`,
then `ldid -s` on the .app seals the bundle. `ldid -s` keeps the entitlements each binary already has.
`ldid -M -S` on the whole .app would give every nested .appex the main app's entitlements, ID included (checked on the
7). With AppSync, installd took an .appex with no `application-identifier`, and one carrying the main app's ID; the
extension's own ID is the correct signature all the same. To fakesign one by hand on the phone: `ldid -Sent.xml <binary>` (an `ent.xml` with
`application-identifier` `<TEAM>.<bundle id>` and `com.apple.developer.team-identifier` `<TEAM>`, any 10
characters), zip it back into `Payload/<Name>.app/`, and serve it as in "Serving a test repo" above.
`ifizbox://install?url=…&name=…` installs it through the helper and remembers it in Installed > Apps. Uninstall a
test app afterwards (Installed > Apps, swipe, Delete).

Launching such an app also needs AppSync's **FrontBoard** hook in SpringBoard, which only loads after a respring
following AppSync's install: until then SpringBoard logs "signature state: Generic … No code signature found" and
refuses the launch (the icon dims, nothing opens); `sbreload` fixes it. To see
why an app won't launch: `sudo apt-get install oslog`, then `sudo oslog` while opening it (`uiopen --bundleid <id>`).

### Why installd refused an IPA

`ifizbox-helper install-ipa` refuses any caller but the app, so over ssh ask installd yourself: a small tool that
calls `[[LSApplicationWorkspace defaultWorkspace] installApplication:withOptions:error:]` and prints the NSError's
`userInfo`. Sign it on the phone with `ldid -Snative/helper/entitlements.plist` and run it with `sudo -n`. The
helper's final stderr line ("installd refused the app: …") already carries installd's localizedDescription, the
staging path cut out, and the app's alert shows it.

Apps that need a newer iOS: iOS 15.8.8 is the last iOS for the iPhone 7, and current builds of big apps need more.
YouMod (YouTube 21.45.4, from the "YouMod Repo" AltStore source) needs iOS 17.0, while its source says
`minOSVersion` 14.0. installd: "The system version is lower than the minimum OS version … Have 15.8.8; need 17.0"
(`DeviceOSVersionTooLow`). So iFizBox doesn't trust a source's minOSVersion here. The jailbreak Install asks the
Worker's `/api/ipainfo` for the IPA's own MinimumOSVersion before downloading, and the app page's Install row says
"Needs iOS 17.0 (this iPhone has 15.8.8)". The helper checks MinimumOSVersion against `SystemVersion.plist` again
after unzipping, before ldid or installd.
