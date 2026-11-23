# Sideload: signing and installing IPAs on the phone

How Feather signs and installs IPAs with nothing but the phone, how jailbreak installers do it, and what iFizBox
does. iFizBox is its own project: it never routes through another project's server. How iFizBox signs and installs
in detail: docs/signing.md.

**Tweaks in sideloaded apps.** iFizBox injects tweaks into the apps it signs, on phones without a jailbreak. The
sideload app reads APT repos as Tweak Sources and lists only the tweaks it can inject (an arm64 or arm `.dylib` under
`Library/MobileSubstrate/DynamicLibraries` with its filter plist, no dependencies beyond the hook libraries).
A tweak's page says which apps it works in and has Add to App; Sign Options' Inject Tweaks also takes a tweak from a
source or your own `.deb`, `.dylib` or zipped `.framework`. ElleKit is bundled for tweaks that link CydiaSubstrate,
and an app's tweaks are kept for its re-signs. How it's done: docs/signing.md "Tweak injection".
A new install starts with app-tweak sources only: GitHub repos whose releases carry the tweak's `.deb` (YTLite,
YTMusicUltimate, SCInsta; `web/app/tweak-sources.json` entries with `github` and `"inject": true`). The Sources tab
leaves out a Tweak Source the Tweak Index has fully checked with no tweak for the user's apps (or for any app);
searching and Manage still list it.

The notes on the other projects come from their source, not from runs on a phone. Sources, at these commits:

| Project | Commit | Licence | Can iFizBox (GPL-3.0-or-later) take code? |
|---|---|---|---|
| [Feather](https://github.com/khcrysalis/Feather) (incl. its `NimbleKit/`, `AltSourceKit/`) | `31ab6de`, 2026-11-01 | GPL-3.0 | Yes, keep the file headers and credit |
| [Zsign-Package](https://github.com/khcrysalis/Zsign-Package) (`package` branch: zsign + Swift wrapper) | `c4ba9da`, 2026-09-19 | MIT | Yes |
| [zsign](https://github.com/zhlynn/zsign) upstream | (GitHub API, not cloned) | MIT | Yes |
| [IDeviceKit](https://github.com/khcrysalis/IDeviceKit) (Swift over idevice) | `837cf1e`, 2026-04-14 | MIT | Yes |
| [idevice](https://github.com/jkcoxson/idevice) (Rust, ships `IDevice.xcframework`) | v0.1.57 used by IDeviceKit | MIT | Yes |
| [krzyzanowskim/OpenSSL](https://github.com/krzyzanowskim/OpenSSL) (zsign's crypto, OpenSSL 3) | | Apache-2.0 | Yes (Apache-2.0 goes into GPLv3, one way) |
| Vapor / swift-nio-ssl (Feather's HTTP server) | | MIT / Apache-2.0 | Yes |
| [AppSync Unified](https://github.com/akemin-dayo/AppSync) (incl. `appinst`) | `235aca6`, 2024-11-28 | GPL-3.0-or-later | Yes |
| [TrollStore](https://github.com/opa334/TrollStore) | `88424f6`, 2026-04-01 | MIT, **except `RootHelper/uicache.m`: BSD-4-Clause** | MIT parts yes. **`uicache.m` no**: the advertising clause is GPL-incompatible |
| SideStore / minimuxer | | AGPL-3.0 | Avoid. GPLv3 §13 allows linking, but the AGPL network clause would then apply to those parts. idevice does the same job under MIT |

Feather's server files say "Copyright © 2024 Lakr Aream … ORIGINALLY LICENSED UNDER GPL-3.0, MODIFIED FOR USE
FOR FEATHER". Keep that line, add Feather's, then ours.

## How Feather works, step by step

### 1. Importing the user's certificate

The user brings a signing identity from elsewhere: a `.p12` (cert + private key), its password, and a
`.mobileprovision`. Feather has **no Apple ID login**. It never creates certificates or registers devices.
That is AltStore/SideStore's job, and it needs Apple's servers plus an anisette server.

- `Feather/Utilities/Handlers/CertificateFileHandler.swift`: parse the profile, copy both files to
  `Documents/Feather/Certificates/<uuid>/`, then add a Core Data row (password, nickname, expiry, `PPQCheck`).
  **The p12 password is kept in Core Data, not the Keychain.** iFizBox keeps it in the Keychain.
- `Feather/Utilities/CertificateReader/CertificateReader.swift` reads the profile cheaply: find `<?xml` in the
  CMS blob and decode the plist from there. It does not verify the CMS signature. Enough to show the name,
  team, expiry, entitlements, `ProvisionedDevices`, `ProvisionsAllDevices` and `PPQCheck`.
- `FR.checkPasswordForCertificate` uses zsign's `p12_password_check` to test the password before saving.
- Ways in: the Files picker, `.p12`/`.mobileprovision` document types, and
  `feather://import-certificate?p12=<b64>&mobileprovision=<b64>&password=<b64>`. `feather://export-certificate?callback_template=…`
  hands the p12 and password to another app (LiveContainer uses it). iFizBox has **no** such export route: any
  app that opens that URL gets the user's private key after one tap.
- Revocation: `Storage+Certificate.swift` → `Zsign.checkRevokage` → `checkCert` in `swift/zsign.mm`. It reads
  the OCSP URL from the cert's AIA extension and asks Apple's OCSP responder. That is an internet call, but only
  a status check, and it can be skipped.

### 2. Signing on the device (`SigningHandler.swift` → `ZsignHandler.swift` → zsign)

`SigningHandler.modify()` runs these steps in order, on a copy of the `.app` in a temp folder:

1. **Bundle ID change**, if set. `_modifyPluginIdentifiers` walks every nested `.app`/`.appex` and does a string
   replace of the old main ID with the new one in `CFBundleIdentifier`, `WKCompanionAppBundleIdentifier`,
   `NSExtension.NSExtensionAttributes.WKAppBundleIdentifier` and `NSExtensionFileProviderDocumentGroup`.
   Extensions keep their suffix (`old.share` → `new.share`).
2. **Info.plist edits**: name (and `InfoPlist.strings` in each `.lproj`), version, icon, file sharing, minimum OS,
   and so on. It always drops `UISupportedDevices`.
3. **Cleanup**: remove `_CodeSignature` everywhere, `embedded.mobileprovision` ("zsign doesn't replace it"),
   `com.apple.WatchPlaceholder`, `SignedByEsign`, and Watch apps with no Info.plist.
4. Optional dylib injection (`TweakHandler`, can unpack `.deb` tweaks, bundles ElleKit). iFizBox does it too, in both
   signers (Inject Tweaks in the sign options, docs/signing.md "Tweak injection"): `.dylib`, `.deb` and zipped
   `.framework` files into `Frameworks/`, weak load commands and the Frameworks rpath in the main executable, install
   names pointed at `@rpath`. It bundles ElleKit too (a pinned, hash-checked 1.2 rootless `.deb`): its
   `libellekit.dylib` goes in when a tweak links CydiaSubstrate and the user added no ElleKit of their own.
5. **arm64e fix-up** (`_locateMachosAndFixupArm64eSlice`): rewrites old-ABI arm64e slices so iOS 26 accepts them.
   This is mostly for CydiaSubstrate. iFizBox does it too: an IPA from an AltStore source may carry one.
6. **Entitlements**. By default zsign takes the profile's `Entitlements` dict as-is
   (`ZSignAsset::Init` in `src/openssl.cpp`: `application-identifier`, `TeamIdentifier[0]`, and if no
   entitlements file is given, the profile's). The optional `mergeEntitlements` replaces `*` in the profile's
   values with the new bundle ID, except `associated-domains`. It then copies only `keychain-access-groups`
   from the binary's own entitlements (read with `LCGetMachOEntitlements`, from LiveContainer). Its own comment
   says it ignores extensions.
7. **Sign**: `Zsign.sign(appPath, provisionPath, p12Path, p12Password, entitlementsPath, removeProvision)` →
   `zsign()` in `swift/zsign.mm` → `ZBundle::SignFolder`. zsign signs nested frameworks, dylibs, `.appex` and
   `.app` bundles inside out, writes the code directory, CMS and entitlement slots (XML and DER), and caches
   unchanged Mach-Os. **One profile for every bundle.** Upstream zsign supports one profile per extension, but
   Feather's wrapper doesn't expose it. Ad hoc signing exists in zsign. Feather comments it out of the UI.

What this means for a profile:

- **Wildcard App ID** (`TEAM.*`): any bundle ID works, extensions included. Push, App Groups and iCloud are
  missing: Apple doesn't allow those capabilities on a wildcard App ID.
- **Explicit App ID**: the main app must be re-IDed to exactly that ID, and extensions get IDs the profile
  doesn't cover. iOS refuses the install, so either delete `PlugIns/` (zsign's `m_bRemoveExtensions`) or sign
  each extension with its own profile.
- **Free Apple ID profiles** are explicit, 7-day, 3 apps, and need Apple's servers to make. Feather doesn't make
  them: it doesn't log in to Apple. (iFizBox's website can: docs/signing.md, "Free Apple ID".)

### 3. Install modes

Settings → Installation (`InstallationView.swift`) picks **Server** (default) or **idevice**. Server has two
sub-modes (`ServerView.swift`): **Fully Local** (`Feather.serverMethod = 0`) and **Semi Local** (`= 1`).
Both start an in-app HTTP server: Vapor on SwiftNIO, `0.0.0.0`, a random port from 4000 to 8000, one per install
(`ServerInstaller.swift`). The routes:

| Path | Serves |
|---|---|
| `/<uuid>.plist` | the itms-services manifest: `software-package` URL, 57/512 px images (a flat tint-colour square), `bundle-identifier`, `bundle-version`, `title` |
| `/<uuid>.ipa` | the signed IPA, streamed from disk. Status goes to "sending payload", then "installing" when the stream ends |
| `/app57x57.png`, `/app512x512.png` | the images |
| `/install` | an HTML page that only does `window.location = <itms-services link>` (Semi Local) |

#### Fully Local: the trick that makes itms-services accept a local URL

itms-services needs the **manifest over HTTPS, with a certificate the system trusts**. The answer is
**[backloop.dev](https://backloop.dev)**: a public domain whose wildcard DNS points every `*.backloop.dev` name
at loopback, plus a real, publicly trusted wildcard certificate for `*.backloop.dev` **whose private key is
published** at `https://backloop.dev/pack.json` (`cert`, `ca`, `key1` + `key2`, `info.domains.commonName`).

- At build time the `Makefile` `deps` target fetches `pack.json` and copies `server.crt`, `server.pem` and
  `commonName.txt` into the `.app`. "Update SSL Certificates" in Settings fetches it again into `Documents/`,
  which wins over the bundled copy (`ServerInstaller.getUrl`).
- The server loads the pair with `NIOSSL` (`ServerInstaller+TLS.swift`). The manifest URL is
  `https://<commonName>:<port>/<uuid>.plist`, opened with `UIApplication.shared.open`.
- Feather puts the `commonName` straight into the URL host: the literal `*.backloop.dev`. It resolves (a `*`
  label matches the wildcard record: `*.backloop.dev` → `127.0.0.1`), though a concrete label like
  `local.backloop.dev` would be cleaner.
- **The pack expires.** A CA must revoke a cert whose key is public, so the pack is short-lived and someone has to
  keep reissuing it; once its `notAfter` passes, every Feather install using it fails Fully Local until backloop.dev
  rotates it (the pack served in November 2026 had `notAfter 2026-10-29`). Publishing such a key ourselves would
  break CA rules. iFizBox doesn't use this mode.
- The phone (its `installd`/`appstored`, not our app) then connects to `127.0.0.1:<port>` for the manifest,
  images and IPA.

What still touches the internet in Fully Local: the **DNS lookup** for `*.backloop.dev` (public DNS, cached
afterwards; no DNS means no install), fetching the pack (build time, or the Update button), and Apple's own
checks (below). The IPA never leaves the phone.

#### Semi Local: plain HTTP on the phone, manifest from someone else's server

- The server runs **without TLS**. The host is the phone's Wi-Fi/cellular IPv4 (`getifaddrs`, `en0` or
  `pdp_ip0`), or `127.0.0.1` with "Only use localhost address".
- The itms-services `url=` points at
  `https://api.palera.in/genPlist?bundleid=…&name=…&version=…&fetchurl=http://<ip>:<port>/<uuid>.ipa`,
  percent-encoded twice. That is **palera1n's server**: it echoes back a manifest whose `software-package` is
  our local **http** URL. iOS fetches the manifest over HTTPS from palera.in and the payload over plain HTTP
  from the phone. So iOS demands HTTPS for the manifest only, not for the IPA.
- Feather opens `/install` in an `SFSafariViewController`, and that page redirects to the itms-services link.
  It closes the sheet once the payload starts.

What touches the internet: **api.palera.in sees the app's bundle ID, name, version and the phone's LAN IP**,
on every install. The IPA stays on the phone, but it's a third party. iFizBox uses the same split with its own
Signing Server in palera.in's place (below).

#### Both server modes: keeping the server alive, progress, self-update

- When the install dialog appears the app goes to the background, but its server must keep streaming the IPA.
  Feather plays silent audio (`BackgroundAudioManager`, `UIBackgroundModes = [audio]`) for as long as the
  install sheet is up. That's an App Store violation, but fine for a sideloaded app. `beginBackgroundTask` alone
  gives about 30 s, which isn't enough for a large IPA.
- Progress: polls private `LSApplicationWorkspace installProgressForBundleID:makeSynchronous:`, and Open uses
  `openApplicationWithBundleID:`. Both are reached through base64-hidden selectors
  (`NimbleKit/.../UIApplication+open_private.swift`), and both work from a sideloaded app: `LSApplicationWorkspace`
  is not blocked outright for sideloaded apps. Listing all installed apps is not shown to work.
- Feather won't install **itself** through the server ("use an alternative tool to update it"), because the
  install kills the process that serves the IPA. iFizBox has the same limit, and serves its own update from the
  Signing Server instead (docs/signing.md, "What leaves the phone, and when").

#### idevice: no server, no TLS, no internet

`IDeviceSwift/InstallationProxy/InstallationProxy.swift` and `Heartbeat/` in IDeviceKit, over the Rust idevice
library. The app talks to the phone's own lockdownd as if it were a computer on USB:

- **Setup, once:** a pairing file (`pairingFile.plist`) made on a computer (with jitterbugpair, iloader or
  idevice's tools) and imported, plus the App Store app **LocalDevVPN**. That app runs a loopback VPN, so the
  device is reachable at `10.7.0.1`. Feather keeps a lockdown heartbeat alive in the background. iOS 17.4+ uses
  the RSD/RemotePairing tunnel (`tunnel_create_rppairing`); older versions use plain TCP lockdown.
- **Install:** AFC writes the IPA to `PublicStaging/`, then `installation_proxy_install_with_callback` asks
  installd to install it, with real progress callbacks. It can update the app itself (`suspend:` in the call).
- Internet: none. The pairing file is the risk. It's a full lockdown credential for the phone, so keep it like
  a key.
- Cost: IDeviceKit pulls `IDevice.xcframework` as a binary download from idevice's GitHub release; an app using it
  under the GPL would build it from source, to keep corresponding source simple. iFizBox builds it from source
  (see "What iFizBox does").

### 4. What Apple still checks, whatever the mode

This is iOS behaviour, not Feather's. It is from Apple's docs and common knowledge, not measured.

- The **profile must cover this phone**: development or ad hoc profiles with the UDID in `ProvisionedDevices`, or
  an enterprise profile (`ProvisionsAllDevices`). Development and ad hoc need **Developer Mode** (iOS 16+).
- **Enterprise certs**: the first launch needs the user to trust the developer in Settings → VPN & Device
  Management, which goes online. iOS also checks the profile periodically (`ppq.apple.com`; that's the
  `PPQCheck` field, and Feather's "PPQ Protection" randomises bundle IDs to dodge it). Revoked certs stop working.
- **OCSP** for the signing cert (`ocsp.apple.com`) at install and launch, cached.

## How jailbreak installers do it

On a jailbreak, an installer with root can install an IPA directly. There's no itms-services and no server.

- **AppSync Unified** (`AppSyncUnified-installd/AppSyncUnified-installd.x`): a Substrate tweak in installd that
  hooks `MISValidateSignatureAndCopyInfo` (`…WithProgress` since iOS 14) and returns success, so installd takes
  ad hoc-signed, fake-signed or unsigned-but-ldid'd apps. `control`: `firmware (>= 5.0)`, `firmware (<= 18.2)`.
  **It doesn't claim iOS 18.3+**, so no iOS 26/27 jailbreak should be assumed to have it.
- **`appinst`** (`appinst/appinst.m`, ships with AppSync): unzips the IPA and calls
  `[[LSApplicationWorkspace defaultWorkspace] installApplication:[NSURL fileURLWithPath:ipa] withOptions:@{@"CFBundleIdentifier": id} error:]`
  (iOS 8+). It falls back to `MobileInstallationInstall` on iOS 5-7. Entitlements it needs
  (`appinst_entitlements.plist`): `com.apple.private.mobileinstall.allowedSPI = [Install, InstallForLaunchServices]`,
  `com.apple.security.exception.mach-lookup.global-name = [com.apple.mobile.installd]`, `platform-application`.
  GPL-3.0, so iFizBox's helper can take it as-is. The IPA must still be signed in a way installd accepts: validly signed for
  this phone, or anything with AppSync.
- **TrollStore** (`RootHelper/main.m`, `installApp`): first tries `installApplication:withOptions:@{LSInstallType: 1, PackageType: @"Placeholder"}`
  on a temp copy. If that fails, it creates the container itself with
  `[MCMAppContainer containerWithIdentifier:createIfNecessary:YES …]`, copies the `.app` in, fixes permissions,
  and registers it with LaunchServices (`registerPath`, in `uicache.m`). On stock iOS (14.0-16.6.1, 16.7 RC, 17.0)
  it signs with the **CoreTrust bug** (`apply_coretrust_bypass`, from ChOma), so apps run with any entitlements and
  never expire. Those versions aren't iFizBox's iOS 26/27 target.
- **TrollStore Lite** (`TrollStoreLite/`, `#ifdef TROLLSTORE_LITE`): the same installer for jailbroken phones.
  No CoreTrust bypass: it ad hoc-signs with **ldid** (`signAdhoc`, `Depends: ldid`) and relies on the jailbreak
  to run ad hoc code. It only refuses FairPlay-encrypted main binaries.
- **Hand-off**: TrollStore and TrollStore Lite take `apple-magnifier://install?url=<IPA URL>` when the user turns
  the URL scheme on (an app checking with `canOpenURL` needs `apple-magnifier` in `LSApplicationQueriesSchemes`).
- **Licence trap**: TrollStore's `uicache.m` is BSD-4-Clause and can't be copied. The jailbreak's own
  `uicache` (uikittools, a dependency) or a `registerApplicationDictionary:` call of our own does the job.

## What iFizBox does

**Sideload build** (details in docs/signing.md):

- **Certificate**: Settings > Installation & Signing imports the `.p12`, its password and the `.mobileprovision`
  (Files picker and document types). The identity and the password go in the Keychain. There is no export route.
- **Own profiles**: with an App Store Connect API key (Apple Developer Account on the same page,
  `native/Sources/ASC.swift`), each app signed with Keep Bundle IDs gets its own explicit App ID and Ad Hoc profile,
  made at sign time, and this iPhone is registered in the account (docs/signing.md, "Own provisioning profiles").
  The API turns App Groups on but can't assign groups, so apps that need one (and their notification extensions)
  need groups assigned on developer.apple.com, or the one shared App ID route (docs/developer-account.md).
- **Signing** on the phone with iFizBox's own Swift signer (`native/sign/`, no OpenSSL, no zsign): the key stays
  in Security.framework. With Keep Bundle IDs on (the default) the app keeps its bundle ID with any profile, and
  only the entitlements carry the profile's App ID; with a profile that has Push (and, for some apps, App Groups
  and Communication and Time Sensitive Notifications) it gets its own server's notifications, whoever signed it (docs/signing.md, "Keep Bundle IDs"). Off, an explicit profile renames the app
  into a copy without notifications. Feather's arm64e fix-up (via LiveContainer) runs on every Mach-O. Re-signs keep
  each app's data: its own keychain group (`TEAM.<its bundle ID>`, never one shared by every app under the App ID)
  and its original App Groups mapped to a folder of its own (docs/signing.md, "Keeping an app's data across
  re-signs"; docs/developer-account.md, "Keep your apps' data", for what a team or App ID change costs).
- **Installing**: Feather's Semi Local split, with iFizBox's own Signing Server (`worker/`, sign.ifizbox.com by
  default, or the user's own) in api.palera.in's place: the manifest comes from the server over HTTPS, the signed
  IPA from a plain HTTP server on 127.0.0.1. The server sees the app's bundle ID, name and version. A hand-trusted
  root CA on the phone doesn't work for this: iOS's installer ignores it. There's no backloop.dev mode.
- **This iPhone** (Settings > Installation & Signing > Install Apps With; `native/sideload/idevice/`, its README): idevice
  built from source on Linux and linked statically. The signed IPA goes to this phone's installd over LocalDevVPN
  (AFC upload to PublicStaging, then installation_proxy), so nothing reaches the Signing Server, no install sheet has
  to stay up, it works offline, and iFizBox updates itself (installd closes and replaces it). Choosing This iPhone
  opens one page that runs by itself (`installation/pair`): one sentence on what it gives, then the connection check
  (LocalDevVPN on, `idevice.status`; when it's off, a "Turn On LocalDevVPN" alert with Open LocalDevVPN, rechecked
  every 2 s and when the app comes back), then pairing starts on its own on iOS 27: the 6-digit code big at the
  top, and where to type it, a short line a step with a ringed screenshot of the Settings row (Privacy & Security,
  Developer Mode, "Pair with iFizBox"; `web/app/img/pair/`, the user's own iPhone screenshots, named in Credits).
  Pairing keeps listening while the page is open, and ends when it's left. Paired: "Paired" with a check, Check
  Connection (`idevice.verify`, Pair Again when the pairing is refused) and Forget Pairing. Settings shows no
  Developer Mode row (iOS needs it for every kind of profile, iOS 27's Ad Hoc too, and an app can't open without it):
  an install that fails because of it says so in its alert, with the steps to turn it on (core/installroute.js
  `developerModeFailure`). Before iOS 27 a pairing
  file made on a computer is imported. Each
  install (`chooseRoute`, signing-client.js) asks `idevice.status`: paired and LocalDevVPN on sends
  `route: "idevice"` with the bridge call (signing.install, signing.open, signing.resign/resignAll,
  library.install), and Sideload.swift `installHere` installs it, its progress on the progress page's Installing
  step (upload the first 30%, then installd's percentage). Not paired, LocalDevVPN off or another VPN on: an alert
  says so and the install goes through the Signing Server ("Another VPN Is On" also offers Open LocalDevVPN, which
  stops the install). The VPN apps' names come from one list (`VPNS`, core/installroute.js).
  An install that went to This iPhone and couldn't reach it (refused, the pairing lost, Tailscale or LocalDevVPN
  down, not paired: `serverFallback`) offers Use the Signing Server besides the fix: in the install's alert and its
  log, and on the IPA queue run's Log (each failed app's fix, then Use the Signing Server) and at its bottom. It
  runs the same install, or the same failed apps, again through the default Signing Server for that install or run
  only; Install Apps With stays This iPhone. The queue's fix row for a failed app reads `idevice.status` first, so a
  failure through the built-in VPN offers Check Again and Use the Signing Server, not Open LocalDevVPN.
- **This iPhone with the built-in VPN** (`native/sideload/vpn/`): the sideload IPA carries its own packet tunnel,
  `PlugIns/iFizBoxVPN.appex` (`com.ryha.ifizbox.vpn`), the loopback idea of StosVPN and LocalDevVPN: the phone is
  10.7.0.0 on the tunnel, only 10.7.0.1 is routed into it (no default route), and every packet is written back with
  its source and destination swapped, so a connect to 10.7.0.1 reaches this phone's own RemotePairing and lockdownd
  as from a peer. Nothing leaves the phone and no internet is needed. It needs the Network Extensions capability on
  the App ID (iFizBox's own App IDs get it, `APP_ID_CAPS`; the app and the extension are signed with the profile's
  `networkextension` entitlement); when the app's embedded profile lacks `packet-tunnel-provider`, This iPhone keeps
  using LocalDevVPN or Tailscale. `IDevice.Session` turns the VPN on just before it connects to iOS (`LocalVPN.begin`,
  saving the configuration the first time: iOS asks to allow it) and off 3 seconds after the last connection ends,
  so a queue of installs or a reconnect finds it on. The configuration is never On Demand and never removed: it
  stays in Settings > VPN, only connected during installs, so iOS's "Add VPN Configurations" Allow comes once.
  Setting up asks it: right after pairing (or importing a pairing file), the pairing page runs the same test as
  Test Connection (`vpn.test`) before it says Paired. iOS runs one VPN at a time, so the user's own VPN pauses for
  the install, and since ours keeps Settings > VPN's checkmark, a VPN that relies on On Demand (Tailscale) stays
  off until the user turns it on again, unless the Install Switch below is added.
  On cellular (cellular in use, no Wi-Fi joined) iOS refuses these connections while cellular data is on
  (journal/2026-11-21-r72-cellular-this-iphone), so, as SideStore's Cellular Refresh, the user adds one Shortcut
  on Set Up, "Install Switch" (signed by `tools/shortcuts/sign.sh` from `tools/shortcuts/install-switch.plist`,
  shipped in `web/app/shortcuts/`). Add shares it to Shortcuts' Add Shortcut sheet; back in the app it runs once
  with the input `{"check":1}` (it does nothing) and shows Done only if it ran. Once added, the page
  `installation/shortcuts` (Install Switch) shows an Added row and Test Install Switch (`vpn.testSwitch`).
  The first connect of a queue of installs runs it through `shortcuts://x-callback-url/run-shortcut` (Shortcuts
  comes back to `ifizbox://vpn-shortcut`) with the input `{"start":1}`: it stores the VPN connected now (Get Current
  VPN, as "previous VPN") and connects the built-in VPN (found with Find VPNs by its server address, 10.7.0.1) with
  Set VPN, which iOS runs without a prompt. The app then connects its tunnel as before. A start that didn't run, or
  whose Set VPN ended with NEVPNErrorDomain error 2, is not fatal: on the iPhone 15 Pro (iOS 27) Set VPN often ends
  with error 2 while iOS is still enabling the configuration, and the app's own connect covers it. On cellular, once
  the built-in VPN is connected, the app runs the Install Switch again with `{"dataOff":1}`: Cellular Data Off. The
  order matters: iOS starts no VPN without a network (nesessionmanager logs "No network available", and the VPN goes
  connecting to disconnected at once), but a VPN that is already connected keeps working when the network goes away
  (checked on the iPhone 15 Pro with Airplane Mode), so cellular data goes off only after the VPN is up, the order
  SideStore's docs give. The Shortcut still accepts `{"start":1,"cellular":1}` from older app builds: it turns data
  off after Set VPN, not before. With no network at all, the built-in VPN's start fails at once, saying it can't
  start without Wi-Fi or cellular data, instead of waiting 10 s. After
  the last connect, once the VPN goes off (the 3 second linger, so a queue shares one start and one end), it runs
  with `{"end":1}`, plus `"cellular":1` on cellular: cellular data goes back on, then the stored VPN (Tailscale, say)
  connects and is forgotten. Shortcuts opens only from the front, so an end due while the app is in the background
  runs when the app is next active. The Shortcut reads its input as a dictionary and tests its flags with "has any
  value". Without the Install Switch the built-in VPN connects by itself and the user's VPN stays off after. Phones
  that added the two older Shortcuts, "Cellular Data Off" and "Cellular Data On", still run them (data off before
  the connect, on once connected), but Set Up no longer offers them. An install that starts on cellular without the
  Install Switch asks first (Use Server or Set Up), and Home's status slot and Installation & Signing's status cell
  say Add the Install Switch. Bridge calls: `vpn.status` (also `idevice.status`'s `vpn`; its `shortcuts` is
  `{off, on, switch}`), `vpn.test`, `vpn.testSwitch` (runs start, waits for the VPN, runs dataOff on cellular, then
  end; answers `{ok, start, end, cellular, wentOff, vpnOn}`), `vpn.checkShortcut`, `vpn.openShortcuts`.
- **This iPhone over Tailscale** (`native/sideload/tailscale/`, its README): for Tailscale users, who can't run
  LocalDevVPN at the same time. The sideload app embeds tsnet (tailscale.com, BSD-3-Clause, a Go c-archive built on
  Linux with a pinned Go; not in the jailbreak executable) and joins the tailnet as its own device ("iFizBox on
  <device>"). Settings > Installation & Signing, with This iPhone chosen, has Connect With: Automatic (Tailscale when the Tailscale VPN is
  on and iFizBox is signed in, else LocalDevVPN), LocalDevVPN or Tailscale, and a Tailscale group: Sign In (the
  login page opens in the app; approval is waited for), the device's name, Test Connection (RemotePairing's
  handshake to this phone's own Tailscale address through the tailnet; on failure it names the fix: an access rule
  to copy, device approval, or an expired key) and Sign Out. The node runs only while signing in, testing or
  installing. An install through it hands idevice a 127.0.0.1 relay per port (49152, then the tunnel's port via
  idevice's `tunnel_set_port_map`), each dialed through tsnet to the phone's own 100.x address; iOS resets plain
  sockets to the phone's own addresses but answers ones that arrive through the Tailscale app's node. Tailscale
  needs the internet; LocalDevVPN works offline. The phone must be on Wi-Fi: iOS takes RemotePairing (49152) and
  lockdownd (62078) from the network only on Wi-Fi, and on cellular refuses every port, so an install there ends in
  Tailscale Refused (join Wi-Fi, or use the Signing Server). Pairing is the same one-time step.
- **Keep-alive and progress** as Feather does: a silent audio loop while the install sheet is up, and
  `LSApplicationWorkspace installProgressForBundleID:makeSynchronous:`.
- **iFizBox's own update** can't come from 127.0.0.1 (the install closes iFizBox); it is signed on the phone and
  held on the Signing Server for iOS to fetch.
- **The IPA itself** is built unsigned, then signed ad hoc (`codesign -s -`/`ldid -S`), as Feather's `Makefile`
  does. The way in is the website's **Install iFizBox Lite** (Home), which signs this IPA in the browser with the
  user's certificate and hands that certificate, sources and settings to the installed app, so it signs other IPAs
  at once. Feather, SideStore, AltStore or a computer also work, but aren't needed.
- Entitlements: `get-task-allow` and the App Group `group.com.ryha.ifizbox` (for the widget; a profile without it
  just leaves the widget at "Open iFizBox"). Info.plist adds `UIBackgroundModes` `audio` (install keep-alive) and
  `fetch`, `CFBundleDocumentTypes` for `.ipa`, `.p12` and `.mobileprovision`, and the `ifizbox://` URL scheme.

**Free Apple ID: the one-time computer setup** (`tools/setup/`). iOS refuses a free-profile app from
itms-services (error 111), so the first install of the free route needs a computer once. The person signs in on
the website on the phone, the website signs the app and shows a short code, and one line on the computer does the
rest:

    curl -fsSL https://ifizbox.com/sign/setup.sh | sh          (macOS, Linux; `sh -s -- ABCD-2345` gives the code)
    iwr -useb https://ifizbox.com/sign/setup.ps1 | iex         (Windows, PowerShell)

- **The scripts** (`install.sh.in`, `install.ps1.in`) pick the build for the computer (macOS universal, Linux
  x86_64/arm64 static musl, Windows x64; Windows on ARM uses the arm64 build when one was released, else the x64
  one under emulation), download it, check its SHA-256 against the one written into the script at release, and run
  it; a mismatch runs nothing. Linux without usbmuxd and Windows without Apple's device driver (nothing on
  127.0.0.1:27015, no Apple Mobile Device service) say how to get it; the Windows script opens the Apple Devices app
  in the Microsoft Store.
- **The command** (`cli/`, on idevice, the commit `native/sideload/idevice/pin.env` pins; the steps and their words
  are `core/`, tested with fakes): finds the iPhone over USB (waits for it to be plugged in); makes sure the computer
  is trusted, reusing usbmuxd's pairing record when the iPhone takes it, else pairing (the iPhone asks Trust and its
  passcode) and saving the record to usbmuxd, with `EnableWifiConnections` on so the app can use it over
  LocalDevVPN; asks for the code (three tries); reads `GET /sign/setup/<code>`; downloads the signed IPA (size and,
  when the website sent one, SHA-256 checked); installs it with installation_proxy; writes the pairing file into
  the app's container (house_arrest `VendContainer`, the path the website chose); and says what's left on the phone
  (Developer Mode, Trust the developer). It never asks for an Apple ID. `--check` only looks (found, trusted,
  Developer Mode), `--download-only` saves the IPA without an iPhone.
- **The code** (`worker/src/setup.js`): the website uploads the signed IPA as usual (`/sign/upload`), then
  `POST /sign/setup?token=…[&bundleid=…][&pairing=<path>][&sha256=…]` gives `ABCD-2345`, 8 characters without
  look-alikes, living as long as the upload (the TTL from its `done`). `pairing=` empty writes no pairing file (for
  an iOS that pairs by itself). The Worker also serves the scripts and binaries from the GitHub release tagged
  `setup`.
- **Release**: `tools/setup/release.sh --probe` names what each build needs; `--dry-run` builds into
  `tools/setup/dist`; without it, it publishes them as the `setup` release's assets (a pre-release, so the app's
  self-update and the APT repo never see it). macOS is cross-built on Linux with `MACOS_SDK` (a MacOSX.sdk's
  `usr/` and a few frameworks), clang, rustup's ld64.lld and llvm-lipo. `tools/setup/macos-sdk.sh` pulls that SDK
  part out of Apple's Command Line Tools .dmg (or its .pkg, or an Xcode .xip), so no Mac is needed;
  `tools/setup/llvm-mingw.sh` fetches the llvm-mingw that the Windows on ARM build needs. release.sh finds both in
  their default folders.

**Jailbreak build**: the root helper's `install-ipa` installs an IPA through `LSApplicationWorkspace
installApplication:withOptions:error:`, as AppSync's `appinst` does (`native/helper/README.md`). It needs AppSync
Unified; when the binary has no `application-identifier`, the helper fakesigns the app with `ldid` first. No
TrollStore hand-off.

## Not verified

From reading code, not from a phone:

- That itms-services on iOS 26 accepts the literal `*.backloop.dev` hostname for a `127.0.0.1` manifest over HTTPS.
  Feather ships it, which suggests it works.
- Whether iOS checks revocation for the backloop TLS cert, which would make Fully Local fail once the CA revokes
  it but before `notAfter`, and how often backloop.dev rotates the pack.
- AppSync's `firmware (<= 18.2)` cap and TrollStore Lite's reliance on the jailbreak running ad hoc code are from
  their package metadata and code. Untested on any iOS 26/27 jailbreak.
- Apple's online checks (OCSP, PPQ, enterprise trust) are from general knowledge, not observed traffic.
- Upstream zsign's per-extension profiles: seen in its README only, not in the code.
- The computer setup: no install or pairing-file write has run on a phone yet (the website's side that signs the app
  and asks for a code isn't built); finding the iPhone, the trust check and Developer Mode's status were read from
  an iPhone on iOS 27 with the Linux (x86_64, arm64 under qemu) and Windows x64 (under wine) builds. Not run on a
  Mac or on real Windows; the Microsoft Store link to the Apple Devices app is from memory.
