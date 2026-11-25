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
Which tweaks a list shows (App Tweaks, Search, the sections, a source's own list and count, Add Tweaks and a source's
featured banners): the Source Filters first; then a verdict, from the shipped Tweak Index or a check kept on this phone,
decides. With no verdict (a free or paid tweak, or a source the index lacks), a tweak is listed only when its name or
description mentions an app iFizBox knows or one of your apps. A tweak already in an app is always listed, and one this
phone found to work stays listed while a newer version has no verdict. The phone does not download tweak `.deb`s in the
background to check them; opening a tweak or Add to App checks that one `.deb`. App Tweaks Only keeps a tweak if any
build of its newest version is iphoneos-arm64 or states firmware 15+. Paid tweaks for iOS itself (Glint, betterAlarm)
are left out on purpose (no verdict, and no app named), but a direct package link (`ifizbox://package?id=`)
still opens their page. Works on My Phone on a source's own page is that source's switch, as in Manage > Filters; on
All Sources' page it is the All Sources one. Works on My Phone never judges a Tweak Source's tweaks in the sideload
build, so a Tweak Source's page has no such switch there.
A new install starts with app-tweak sources only: GitHub repos whose releases carry the tweak's `.deb` (YTMusicUltimate;
YTLite and SCInsta are left out, but adding either by hand works; `web/app/tweak-sources.json` entries with `github` and `"inject": true`). The Sources tab
leaves out a Tweak Source the Tweak Index has fully checked with no tweak for the user's apps (or for any app);
searching and Manage still list it.
The Tweak Index is read from the copy shipped with the app (`web/app/tweak-index.json`, written at each release, see
docs/release.md), so it works offline. A newer copy is fetched in the background (Settings > General > Update Tweak
Index); no request says which sources the phone has.

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
  idevice's tools) and imported, plus a loopback VPN, so the device is reachable at `10.7.0.1` (Feather uses the App Store app LocalDevVPN for that; iFizBox runs its own, below). Feather keeps a lockdown heartbeat alive in the background. iOS 17.4+ uses
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
  built from source on Linux and linked statically. The signed IPA goes to this phone's installd over the built-in VPN
  (AFC upload to PublicStaging, then installation_proxy), so nothing reaches the Signing Server, no install sheet has
  to stay up, it works offline, and iFizBox updates itself (installd closes and replaces it). The install is sent with
  installation_proxy's `PackageType` = `Developer` (`native/sign/HerePackage.swift`): a plain install asks iOS to end the
  app being replaced only politely (NonInteractive), an app in front or playing audio refuses, and installd waits for it
  to close; while it waits, the row reads "Copied to iPhone, waiting for iOS", and after 15 s of silence "Close <App> to finish installing" (not for iFizBox's own update). Developer asks with Absolute, so iOS ends the app and its data stays. iFizBox's own update stays plain, since
  it closes itself once installd has accepted it. If iOS refuses with a reason the option might cause, the staged IPA is
  copied again and sent once more plainly (installd deletes the staged copy on a refusal). No retry for a dropped
  connection (iFizBox reconnects instead), a cancel, or a refusal about the IPA or the phone (other App ID, iOS too old,
  device family, architecture, extraction). Not known: whether iOS refuses a Developer package with Developer Mode off,
  or an enterprise-signed IPA. Choosing This iPhone
  opens its page (`installation/iphone`): Set Up (1. Pair This iPhone, 2. Allow iFizBox VPN, 3. Test Connection,
  the done ones checked) until it's set up, then How It Works. The status says Checking… until `idevice.status` answers;
  a failed or late answer says Not Responding. Pair This
  iPhone opens `installation/pair`, a page that runs by itself: one sentence on what it gives, then on iOS 27 pairing
  starts on its own, the 6-digit code big at the top and where to type it, a short line a step with a ringed screenshot
  of the Settings row (Privacy & Security, Developer Mode, "Pair with iFizBox"; `web/app/img/pair/`, the user's own iPhone
  screenshots, named in Credits). Pairing keeps listening while the page is open, and ends when it's left. Paired:
  "Paired" with a check, Check Connection (`idevice.verify`, Fix while it fails) and Forget Pairing. On cellular without Wi-Fi, iOS refuses
  the connect, so Check Connection, Fix and the other checks that the user asked for read `idevice.status` first and say
  "Can't Check on Cellular" instead, with nothing kept as a Route Failure; the automatic checks stay silent.
  Before iOS 27 a pairing file made on a computer is imported instead. Settings shows no Developer Mode row (iOS needs it
  for every kind of profile, iOS 27's Ad Hoc too, and an app can't open without it): an install that fails because of it
  says so in its alert, with the steps to turn it on (core/installroute.js `developerModeFailure`). Each install
  (`chooseRoute`, signing-client.js) asks `idevice.status`: paired, with the app's profile carrying Network Extensions,
  sends `route: "idevice"` with the bridge call (signing.install, signing.open, signing.resign/resignAll,
  library.install), and Sideload.swift `installHere` installs it, its progress on the progress page's Installing step
  (upload the first 30%, then installd's percentage). Not paired, or no Network Extensions: an alert says so ("No
  Network Extensions" when the profile lacks them) and the install goes through the Signing Server. An install that went
  to This iPhone and couldn't reach it (refused, the pairing lost, not paired: `serverFallback`) offers Use the Signing
  Server besides the fix: in the install's alert and its log, and on the IPA queue run's Log (each failed app's fix, then
  Use the Signing Server) and at its bottom. It runs the same install, or the same failed apps, again through the default
  Signing Server for that install or run only; Install Apps With stays This iPhone. The queue's fix row for a failed app
  reads `idevice.status` first, so a failure through the built-in VPN offers Fix and Use the Signing Server. In the install run's Log and install failure alerts, Fix opens Pairing, or
  Installation & Signing, which runs the check at once. Home's status slot shows Pair This iPhone (amber, opens Pairing) while This iPhone is chosen and `idevice.status` says it isn't paired, ahead of a Route Failure tile; a signing problem that stops every install still comes first.
- **Quiet Pairing Check**: with This iPhone chosen and set up (paired, and its VPN tested), the sideload app checks the pairing in the background: 5 s after launch and 2 s after coming back, at most once every 24 h (`ifizbox.quietPairingCheck` holds when it last ran), and at each launch while a Route Failure is kept (skipped then, it runs on coming back). It runs `idevice.verify` and is skipped, without using up the day, while another VPN is up, on cellular, off Wi-Fi, while the built-in VPN is untested or already on, while an install or an app run is under way, while the app is away, or while a check, a test or the Pairing page is open, and always with Restore My VPN on, since its check would need a trip to Shortcuts. A pairing refusal, or every connection refused (`route_refused`), is tried again 3 s later and then kept as a Route Failure, which Home shows; a pass clears it. A retry that finds cellular keeps nothing. A timeout, a failed connect or a VPN that didn't start changes nothing. It never opens Pairing, never forgets a pairing and shows no alert; a check the user starts meanwhile waits for it, and its answer counts instead. Code: `core/installroute.js` `quietCheckDue` and `quietCheckAllowed`, `screens/installroute.js` `quietPairingCheck`.
- **This iPhone with the built-in VPN** (`native/sideload/vpn/`): the sideload IPA carries its own packet tunnel,
  `PlugIns/iFizBoxVPN.appex` (`com.ryha.ifizbox.vpn`), the loopback idea of StosVPN: the phone is
  10.7.0.0 on the tunnel, only 10.7.0.1 is routed into it (no default route), and every packet is written back with
  its source and destination swapped, so a connect to 10.7.0.1 reaches this phone's own RemotePairing and lockdownd
  as from a peer. Nothing leaves the phone and no internet is needed. It needs the Network Extensions capability on
  the App ID (iFizBox's own App IDs get it, `APP_ID_CAPS`; the app and the extension are signed with the profile's
  `networkextension` entitlement); when the app's embedded profile lacks `packet-tunnel-provider`, This iPhone isn't offered: installs go through the Signing Server after the alert "No Network Extensions". `IDevice.Session` turns the VPN on just before it connects to iOS (`LocalVPN.begin`,
  saving the configuration the first time: iOS asks to allow it) and off 3 seconds after the last connection ends (under a background task, so an app that iOS suspends meanwhile
  still takes it down),
  so a queue of installs or a reconnect finds it on. A queue holds through an install's reconnects, however long the pauses between them (`installBegan` and `installEnded` in `IDevice.install`). The configuration is never On Demand. It is never removed, with Restore My VPN on or off (below), so it stays in
  Settings > VPN, only connected during installs, and iOS's "Add VPN Configurations" Allow comes once.
  Setting up asks it: right after pairing (or importing a pairing file), the pairing page runs the same test as
  Test Connection (`vpn.test`) before it says Paired. iOS runs one VPN at a time, so your VPN pauses for the install, and since ours keeps Settings > VPN's checkmark, that VPN stays off until you open Settings > VPN, or, with Restore My VPN on (below), until the Shortcut turns it back on after the queue.
  On cellular, iOS refuses these connections and starts no VPN without a network, but keeps one that is up. So before
  each connect, `IDevice.install` calls `LocalVPN.waitOffCellular`. The built-in VPN comes on while data is on, then the
  path is read again for 3 s (a short Wi-Fi drop isn't cellular). Only then does the install wait, its row reading
  "Waiting to leave cellular data", until NWPathMonitor's path has been off cellular for 1 s (Airplane Mode, or Wi-Fi
  joined), up to 5 minutes ("airplane_timeout", which offers the Signing Server). Control Center over the app is not
  leaving and doesn't stop the wait. Out of the app 30 s (`awayGrace`) with the path still on cellular, the wait pauses
  (see below) and the VPN goes off; once Airplane Mode is on (not cellular) it is never dropped. The pause isn't part of
  the 5 minutes. Cancel or the timeout ends the install's hold, and the VPN goes off 3 s
  later. Once the connection opens, the install emits `airplaneOff` and the page says "You can turn Airplane Mode off".
  A reconnect with cellular data back waits again.
  **Ask** (On Cellular, Ask Each Time; the default): while an install waits, the page shows the popup "You're on Cellular"
  with **Set Up Shortcut** (or **Use Shortcut** once it is set up, when Cellular Installs can run here), **Use Signing Server**
  and **Cancel**. **Set Up Shortcut** adds Cellular Installs (the share sheet, back in the app, then a run). It counts as set
  up as its last run or check went (`localStorage` `ifizbox.cellularShortcut`), else as `cellular.status` says. Either button
  sets On Cellular to Use Shortcut, once it was added. It is one popup for the run, not one per install, and it closes by itself
  once the path leaves cellular (the wait ends with `offCellular`, below), or once no install waits any more. Its
  answer holds for the rest of the run. **Use Signing Server** there: `signing.cancel {tag, keep: true}` ends the wait and
  keeps the signed copy, and the run's remaining rows go through the user's Signing Server, one iOS prompt at a time. (A
  single install, not through the queue, signs again for the server, since a cancelled `signing.install` keeps nothing.)
  **Cancel**: the rows fail "not installed, still on cellular", and Try Again asks anew.
  **Use Shortcut** as the On Cellular setting: an install that waits runs Cellular Installs at once, with no popup. One run
  serves every install waiting then, and a later wait runs it again, at most 2 runs per install; after that the popup asks.
  `not_waiting` (none wait, or the phone is off cellular or paused) is no failure. A failed run shows the popup "Shortcut
  Didn't Run" with **Add Shortcut Again** for `not_run`, `no_end` and `no_return`, where the Shortcut itself may be gone or
  old, and with **Use Shortcut** for `not_opened`, `busy`, `vpn_off` and `ran_out`, where adding it again would only leave
  two. The popup keeps that failure until one of its buttons is tapped. Check Connection checks it too (docs/settings.md).
  **Use Signing Server** as the On Cellular setting: `decideRoute` (core/installroute.js) goes to the server at once while
  on cellular, with no popup. Code: `web/app/core/cellular.js` (the setting, its texts and the popup's buttons),
  `web/app/signing/cellular.js` (the popup, one per run), `web/app/signing/cellularsetup.js` (Set Up Shortcut, Add Shortcut
  Again and the run from the popup, Use Shortcut).
  With no network and our tunnel not up (Airplane Mode just turned off, Wi-Fi or cellular data still coming back),
  LocalVPN waits up to 8 s awake for one (`networkWait`, `waitForNetwork`) before it fails with `vpn_failed`, "can't start
  without a network". That wait is outside `startLock`, so `status()` and other starts aren't held up. An install waits
  in `waitOffCellular` before it reads the path: Cancel ends it, and cellular that comes back goes on to the Airplane Mode
  wait. Checks wait in `up`.
  A start that stalls (off for 3 s, off again as it started, or not connected in 10 s) is logged with its status and done
  once more: the configuration is read again, a tunnel stuck on its way up is stopped first, and the second start has the
  whole 10 s. Not once the app was left, cancelled, or without a network. Code: `VPNStart.swift`, `LocalVPN.start`.
  In the background the VPN starts only to finish an install already connected (`finishing`). An install not yet
  connected pauses instead (`LocalVPN.waitForApp`): its row reads "Waiting for iFizBox" (event `appWait`), its KeepAlive
  is let go so iOS may suspend the app, and it goes on when the app is opened. Opened with no network (Airplane Mode went on
  meanwhile), the row reads "Turn Airplane Mode off for a moment" (`networkWait`) until there is one. Checks (verify, `vpn.test`) wait for the
  app the same way, up to 5 minutes awake (`awayLimit`), then fail with `vpn_failed`.
  A killed or suspended app can't turn its tunnel off, so two things stop it. At launch and when the app comes back to
  the front, `LocalVPN.takeDownLeftOver` takes our tunnel down when nothing holds it. And the extension
  (`PacketTunnelProvider`) stops itself after 60 s awake (`quietLimit`) with no packet for the peer. While anything
  holds the VPN, the app sends one UDP byte to 10.7.0.1:9 every 15 s (`beat`). `sendProviderMessage` isn't used: on
  iOS 27 it answers nil and never reaches the extension.
  Wi-Fi counts as joined when en0 has an IPv4 address, even if the path prefers cellular (Wi-Fi Assist, Wi-Fi without
  internet, another VPN's route). Joined Wi-Fi never waits, and joining Wi-Fi during the wait goes on by itself. The log
  records the path's interfaces where the wait begins.
  Events: `phase` (`signing.open`) / `here` (`signing.install`) "airplane", "airplaneOff", "appWait", "networkWait". The wait
  ends on cellular with `offCellular` (`phase`, and `here` in `signing.install`), which closes the popup; the row then says it is
  connecting. In the IPA queue, on cellular
  (`idevice.status` `vpn.cellular`) `openPrepared` holds the install until every row is downloaded and signed
  (`allSigned` in `core/apprun.js`); the off line shows only when every remaining row has its connection
  (`airplaneStatus`). One app at a time: Re-sign All's direct call (`signing.resignAll`) downloads each app in turn, so
  it needs data between. Real cellular is not verified on a phone.
  `LocalVPN.begin` runs `up()`: it saves the configuration the first time (iOS asks to allow it) and connects it. The end
  takes our VPN down 3 seconds after the queue's last connection. The configuration is never On Demand. iOS runs one VPN at
  a time, so while ours is on any other VPN is taken off, and `idevice.status`'s `vpn.otherVPN` says so. Without Restore My VPN, nothing puts that VPN back by itself: iOS leaves it disabled, On Demand or not, until you open
  Settings > VPN (measured on an iPhone 15 Pro, iOS 27.0; connecting it in its own app is not verified).
  **Restore My VPN** is a kept setting, off by default, set with the switch on This iPhone's page (docs/settings.md). Our configuration
  is never removed, so it stays in Settings > VPN and iOS asks Allow once. With the switch on, the other VPN is brought back after the queue. For iFizBox's own This iPhone update, the back run goes just before iFizBox closes, after the built-in VPN is off; the same conditions as the unasked run below apply, and it waits at most 15 s.
  Before ours starts, if another VPN is up and one is remembered (a `restore.store` passed; `vpn.remembered` in
  `idevice.status`), it is noted as owed (UserDefaults `ifizbox.vpn.backOwed`); with none remembered, nothing is owed and the
  log says so. After the queue's last connection (the 3 s linger over, ours down, no install waiting and no app being
  downloaded, signed or installed, a network there), the Restore My VPN Shortcut's back run opens once, under the start lock, so
  an install that starts meanwhile waits. Shortcuts shows for about 3-4 s and returns. Unasked, it runs only while the app
  stayed in front since ours took the other VPN's place: leaving the app or it being killed counts, but a Cellular Installs trip
  to Shortcuts does not while that run goes on and the app is back within 60 s. Once it was left or killed with a run owed, the run is held: the page is told by the `restore.due`
  stream (`{due: true}`, only while the app is in front, online and nothing going on), and `restore.answer` `{answer}` decides.
  `on` runs it; `notNow` drops it; `never` drops it and is kept (UserDefaults `ifizbox.vpn.backNever`, `restoreNever` in `vpn`
  status), so a later return neither asks nor runs, while a run right after an install still goes on. Turning Restore My VPN off
  clears `never`. A held run is dropped unasked when another VPN is up or took Settings > VPN's checkmark. An install starting
  while it waits withdraws the question until the queue ends; if another VPN was up again at that start, it counts anew. `on`
  during an install, or offline, answers `later` and runs unasked once it can, the app in front until then. The page asks
  with "Turn Your VPN Back On?", 1.5 s after the app is in front with no alert, sheet, menu or keyboard up (the iOS 26 style's own menus and action sheets are not waited for); a question the shell withdraws (`due` false) closes
  unanswered. A failed run shows "VPN Not Turned On" (`later`, `on_already` and `not_due` are no failure); `not_opened` while still due
  asks again. A look that has to wait looks again every 2 s, also while it asks, so the question is withdrawn if
  another VPN comes up. Owed is cleared before Shortcuts opens. Nothing runs when no other VPN was up, none was remembered,
  another VPN came up or took Settings > VPN's checkmark meanwhile, iOS is below 16, or the bundle ID is not the app's own.
  Success is judged by another VPN being up, not by Set VPN's error. A run that failed is not repeated; only `not_opened`,
  `busy` and `vpn_on` are tried again. `not_stored` clears `remembered`. With the switch off nothing is brought back. The log
  lines "vpn: Restore My VPN: ..." say what was decided and why. Code: `RestoreBack.swift` (the looks, the question and the back
  run), `RestoreDue.swift` (when a run is due), `web/app/signing/restoreask.js` (the page's question).
  Bridge: `idevice.status`'s `vpn` is `{available, bundled, entitled, tested, on, cellular, wifi, otherVPN, restore, remembered, restoreNever, name}`,
  `vpn.setRestore` `{on}` turns Restore My VPN on or off and answers the same status, and `vpn.test` runs the Set Up test.
  Cellular Installs bridge: `cellular.status` is `{available, bundled, added}`: whether the signed Shortcut is in this build
  and its last check passed. `cellular.add` opens the signed Shortcut (made by `tools/shortcuts/sign.sh`) in a share sheet,
  where Shortcuts opens it on Add Shortcut; it answers `{opened}`, false when the sheet was dismissed, and not whether it was added, which Shortcuts never says.
  `cellular.check` runs the Shortcut with `{"check":1}`, which touches no cellular data, and passes only when its Finish
  Cellular Installs ran in the app. The app judges a run by those actions, not by Shortcuts' callback
  (`ifizbox://cellular-installs`), whose error is only passed on as text. A failure answers `not_opened`, `not_run`, `no_end`,
  `no_return` or `busy` (`CellularShortcut.Verdict`). The bridge is refused in the jailbreak app and under any other bundle
  ID. Check Connection and the popup's Set Up Shortcut call it too; the run is below.
  Cellular run: `cellular.run` runs the Shortcut with `{"run":1}`, only while installs wait in `waitOffCellular` with the
  built-in VPN up. It answers `not_waiting` when none wait, `vpn_off` when the VPN is down, and `busy` while another run or
  a put-back goes on. Each install counts from before its wait until its connection is open or it ended; when the last
  one is done, the Wait for Install turns end early (20 s each, 15 of them). While the run goes on, the wait neither pauses
  nor times out. The app judges the run by its own actions only (`runVerdict`): `not_opened`, `not_run` and `no_return` as
  a check; `no_end` when no report comes for 30 s (10 s once the waits may end); `ran_out` when the Shortcut reached its end
  with installs not connected, so nothing is put back. After a failed run, cellular data seen on (a cellular-only
  NWPathMonitor path satisfied for 10 s) means nothing to put back; otherwise the app runs `{"on":1}`, once it is in front.
  The answer's `putBack` is `null`, `"on"` or `"failed"`. `ifizbox.cellular.owed` in UserDefaults is set just before
  Shortcuts opens and cleared once data is on again. Found at launch, it runs the same put-back, and `cellular.putBack`
  gives the page the outcome once. The page then says "Cellular Data Is Back On" or "Check Cellular Data" (turn it on in
  Settings > Cellular); a put-back that failed after a run is tried once more at the next launch. Installs queued behind (more than 3 at
  once) that start after the last connection wait again and need another run. The popup and Use Shortcut run it through
  `runCellular` (`signing/cellularrun.js`).
  Restore My VPN Shortcut bridge: `restore.add` opens the signed Shortcut (`web/app/shortcuts/Restore My VPN.shortcut`) in a
  share sheet, where Shortcuts opens it on Add Shortcut; it answers `{opened}`. `restore.store` and `restore.back` answer `{ok,
  error, text}`. Store remembers the VPN that is on: only while another VPN is up and the built-in VPN is down (`no_vpn` or
  `vpn_on` otherwise), so Shortcuts never saves the built-in VPN. Back sets that VPN on again: only with the built-in VPN down
  (`vpn_on`) and no other VPN up (`on_already`). For both, down means no install or connection uses it and iOS says
  disconnected; a failed read counts as up. It passes as soon as `otherVPN` is true, whatever Shortcuts' callback
  (`ifizbox://restore-vpn`) says, since Set VPN often ends with error 2 after switching. `busy`: another run, or one that ended
  under 10 s ago before its Shortcut did. Run failures: `not_opened`, `not_run`, `no_vpn` (Shortcuts found none), `not_stored`,
  `not_back`, `no_end`, `no_return` (`RestoreShortcut.Verdict`). Add, store and back are refused with `unavailable: …` in the
  jailbreak app, under another bundle ID and before iOS 16, and with `missing: …` while the signed file is not in the build; due
  and answer are not. This iPhone's page calls add and store (`web/app/signing/restoresetup.js`); back is still only the app's
  own run (Restore My VPN above). `restore.due` is a stream (one at a time; a newer call takes its place): `{due}` at once and
  on every change, `true` while a held back run waits for an answer. `restore.answer` `{answer}`: `on` runs it, `notNow` drops
  it, `never` drops it and keeps it (above). It answers `{ok, error, text}`; `error` only for `on`: `not_due`, `later`,
  `not_opened` while the app is not in front, or the back run's code. Code: `RestoreShortcutBridge.swift`,
  `web/app/core/restoreshortcut.js`, `web/app/signing/restoreask.js`, `RestoreBack.swift`, `RestoreDue.swift`.
- **Keep-alive and progress** as Feather does: a silent audio loop while the install sheet is up, and
  `LSApplicationWorkspace installProgressForBundleID:makeSynchronous:`. Until iOS asks for the IPA, the silent audio is given back 60 s after the prompt is dismissed, or after the app goes to the background with the prompt unanswered (`native/sign/PromptHold.swift`); opening the install link (Try Again) or iOS's first request takes it again. A suspension after that isn't treated as a freeze, so nothing is uploaded; the IPA stays served for 15 minutes. When signing ends in the background, so the prompt waits for the app in front, the install call's hold ends as serving begins, the serving hold is given back 60 s later, and the page's hold (`signing.hold`) about 10-15 s after that once no other hold is left (apps still being signed keep it); the page's hold is given back the same way while an opened prompt is unanswered in the background, or was closed and the watch hasn't ended yet. The install link opens once iFizBox is in front, within the 15 minutes the IPA is served. iFizBox's own update through the Signing Server, uploaded while the app is in the background, works the same way: the install call's hold is given back 60 s after the upload ended, and the page's hold about 10-20 s later once no other hold is left, so iFizBox may stop running; the link opens once iFizBox is in front, while it lives (10 minutes). Once iFizBox's own update's Install prompt has been opened, its hold is given back 60 s after the prompt is dismissed, or after iFizBox goes to the background, even if iOS has asked for the IPA by then (its second question can be cancelled too). iOS's prompt stays over the Home Screen: an Install tapped there ends a suspended iFizBox and installs the update, and in front the polls go on and iFizBox closes itself. Retrying the same IPA reuses the uploaded link only within the same installed copy, not after the update landed. If the link died while iFizBox was suspended, no notification is posted; the page says so when it is opened.
- **iFizBox's own update** can't come from 127.0.0.1 (the install closes iFizBox); it is signed on the phone and
  held on the Signing Server for iOS to fetch. iFizBox closes once iOS has started that download, and the download goes
  on without it (docs/signing.md, "What leaves the phone, and when").
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
  passcode) and saving the record to usbmuxd, with `EnableWifiConnections` on so the app can use it over the built-in VPN; asks for the code (three tries); reads `GET /sign/setup/<code>`; downloads the signed IPA (size and,
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
- The computer setup: no install or pairing-file write has run on a phone yet; finding the iPhone, the trust check and Developer Mode's status were read from
  an iPhone on iOS 27 with the Linux (x86_64, arm64 under qemu) and Windows x64 (under wine) builds. Not run on a
  Mac or on real Windows; the Microsoft Store link to the Apple Devices app is from memory.
