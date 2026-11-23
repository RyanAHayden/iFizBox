# Signing with your own certificate

The iFizBox app's sideload build signs every app **on the iPhone** with your certificate, which never leaves the phone
for other apps, and needs a server only for iOS's install manifest and iFizBox's own update; the website signs in the
browser (below). That
server is the Signing Server: `https://sign.ifizbox.com` by default, a Cloudflare Worker anyone can deploy for
themselves (`worker/`, `worker/README.md`). [On the phone](#on-the-phone) has the whole picture.

The page's signing code lives in `web/app/signing/`, one module a part (`common.js`, `identity.js`, `install.js`,
`device.js`, `route.js`, `selfupdate.js`, `queue.js`, `library.js`, `browser.js`, `early.js`, `toobig.js`,
`watch.js`, `prompt.js`, `password.js`); `web/app/signing-client.js` re-exports all of it, so a name this page gives
as `signing-client.js <name>` is found through that file's export list.

## The website signs in the browser

ifizbox.com is one Cloudflare Worker with no server of its own, and a Worker can't run zsign. So the website signs
**in the browser**: zsign compiled to WebAssembly runs in a Web Worker, and the Worker only hosts the signed IPA for
iOS's install prompt.

- **zsign as WebAssembly**: `web/app/vendor/zsign/` (`zsign.js` + `zsign.wasm`, ~2.2 MB), built by
  `tools/build-zsign-wasm.sh` from zsign at a pinned commit and OpenSSL 3.5 (static,
  legacy provider built in for RC2 `.p12`s), both checked by SHA-256; `SOURCE` and the licences (zsign MIT, OpenSSL
  Apache-2.0, zlib) sit beside it. `tools/zsign-wasm/ifizbox.cpp` adds two calls into zsign's own code: unzip, and
  read a plist (binary or XML) as JSON. The build is reproducible: `tools/check.sh` rebuilds it where emcc is (emsdk
  on PATH or in `~/emsdk`) and fails when the committed copy differs from what the same emcc builds.
- **Settings > Signing**: the `.p12`, its password and the `.mobileprovision` in this browser's
  IndexedDB (`signing-client.js`), the profile's details, **Install iFizBox App** and **Bring My Certificate**,
  Remove Certificate. Until signing is set up (a certificate, or a Free Apple ID login), Home shows a solid red
  Signing Needs Setup tile under the welcome, opening Settings > Signing. In the sideload app the same tile reads
  Signing Server Down when the Signing Server doesn't answer, checked again each time Home shows and when the app
  comes back.
- **Install** (an app's page, first row; the nav bar's Install runs it): `signing-client.js signInBrowser`:
  1. *Downloading*: the IPA through the Worker's `/api/fetch?url=…&kind=ipa` (most hosts send no CORS headers),
     streamed, up to 512 MB (`MAX_UPLOAD_MB`). The Worker hands the upstream body on untouched (no JS per chunk:
     a TransformStream there ran a 104 MB IPA out of Worker CPU, `exceededCpu`, and cut it short), with
     `Content-Length` and `X-IPA-Length` (the whole app's size, also on a 206). So the browser checks the cap and
     the length itself (`downloadIpa`). A body that breaks off ("Load failed") or ends short of `X-IPA-Length` is
     resumed from the bytes already here: the next request sends `Range: bytes=n-`, which `/api/fetch?kind=ipa`
     passes upstream (only that form; others are dropped) and answers with the upstream's 206 and `Content-Range`.
     Up to `CUT_TRIES` (5) more tries, each of which has to bring more bytes; an answer that isn't the asked-for
     part (a 200, or a `Content-Range` starting elsewhere) starts again from byte 0. Cancel isn't retried. When it
     gives up, the alert says "The app's download broke off before the end. Check the connection and tap Install
     again." (`CUT_TEXT`).
  2. *Signing*: `signing-worker.js` (a module Web Worker) runs `websign-job.js`: unzip, read `Info.plist`, the
     IDs (`core/websign.js signingIds`, see "Keep Bundle IDs" below), the profile's entitlements narrowed to the
     profile's App ID (`appEntitlements`, never `get-task-allow`), the app's injected tweaks (see "Tweak injection"
     below: `websign-job.js putTweaks` writes their files into the folder and the weak load commands into the
     executable), then zsign on the folder (`-b` only when the app is signed the old way). zsign's own last error is
     what the alert shows.
     Before it signs, when the app's ID is known, a Signed Before Under Another ID alert (Cancel, Sign Anyway) comes
     up if this browser signed that app before under another team or App ID (`core/keepid.js siteSigned`,
     `resignNote`; team and App ID kept per bundle ID in localStorage `ifizbox.siteSigned` once the upload is done):
     iOS refuses an update whose `application-identifier` differs, and deleting the app first loses its data. After
     signing, a Before You Install alert (Cancel, Install) shows the job's `warnings` (a group folder the app used
     that this profile lacks), and the same other-ID warning for an IPA whose ID only the job found; Cancel uploads
     nothing.
  3. *Uploading*: the signed IPA to `POST /sign/upload` in 20 MB parts (KV holds 25 MB a value), kept 10 minutes
     (`TTL`), served at `/sign/up/<token>/manifest.plist` and `app.ipa` (Range too).
  4. iOS's install prompt (`itms-services`), with a banner saying to press Install.
  When the bundle ID it will be signed as is known at the tap (an explicit profile, or a wildcard one for
  iFizBox's own IPA or a caller's `bundleId`; `expectedBundleId`, from the profile kept in memory, `identityNow`),
  step 4 comes first, inside the tap: the website makes its own token, opens
  `/sign/up/<token>/manifest.plist?bundleid=&version=&title=` (the Worker answers it from the query), reserves the
  token (`POST /sign/upload?token=`, no size), then signs and uploads into it (`&token=&size=`). The Worker holds
  iOS's `app.ipa` up to 2 minutes: headers once the upload has started, the body once it's done. A different bundle
  ID out of zsign, a failed reservation, or more than 8 minutes (iOS retries a held `app.ipa` for 5+ minutes) fall back to the Ready to Install alert.
  The early link needs a password known to open the `.p12` (`passwordOk` true): a sign that fails after iOS was
  sent to the link leaves iOS waiting. The page's own check (`core/signing.js checkP12Password`) can't read every
  `.p12`, and synced identities come unchecked, so whenever a save leaves a `.p12`, a profile and a password not yet
  known right or wrong, and once on load, `signing-client.js confirmPassword` asks zsign in the Web Worker
  (`websign-job.js runPasswordCheck`: zsign on the certificate and profile with an empty folder; "Can't find app
  folder" means both loaded, OpenSSL's "mac verify failure" a wrong password) and saves its answer. Settings >
  Signing repaints its Password row from the `ifizbox:password` event.
  When the early link won't get this app (signing failed or was cancelled, no certificate, or a different bundle
  ID out of zsign), the website drops it (`dropEarly`, not awaited, never throws): `POST /sign/upload/<token>/fail`
  marks the token failed, and from then on the Worker answers its manifest and `app.ipa` (also a request it's
  holding) with 404 "That install was stopped: the app couldn't be signed." instead of holding them. Before, iOS
  waited on an app that never came and left a blank icon on the Home Screen. A token whose parts have started
  coming in is refused (409), and a failed token can't be reserved or uploaded into again (409, "That token is
  taken."). When iOS was already sent to the link, the failure alert ends with "If a blank <app> icon stays on the Home Screen, press and hold it and delete it."
  (`iconLeftText`).
  On the iPhone 7 (iOS 15.8.8, seen with `wrangler tail`) the prompt opens straight from the tap (manifest
  fetched 0.6 s after it, no "Open in iTunes?"), and Safari keeps downloading, signing and uploading behind iOS's
  alert. iOS's installer (`com.apple.appstored`) never gives up on a held `app.ipa`; it retries. It sends a HEAD and
  drops it after 30 s of silence, a second HEAD (30 s), then a GET it drops at 60 s *from the request's start*
  (headers sent part-way don't reset it), then HEAD/GET pairs again. A link whose upload finished 300 s after the
  Install tap still got its app. Each retry is a new request, so the Worker's 2-minute wait per request never runs out.
  Download IPA is its own row. No hand-offs follow Install (no Open in iFizBox, no Get in AltStore / SideStore /
  Feather); the nav bar's Share offers the source to those sideloaders. The app opens a
  `ifizbox://install?url=<ipa>&name=…` link (`incoming.js`: Install IPAs, "Install IPA", then `signAndInstall`) for
  links already out there. A source's own signed link (`itms-services`) installs straight away. Nothing queues
  on the website (the install queue is the sideload app's).
- **My IPAs' links**: Install is the alert saying the certificate is needed, with **Download IPA** beside
  OK (`altstore.js siteCertificateAlert`).
- **Home's Install iFizBox Lite** (Not Jailbroken; `home.js installApp`; Settings > Signing's Install iFizBox App
  does the same): with a certificate, iFizBox's IPA signed and
  installed as above, carrying the certificate (`ifizbox-identity.plist`, the shell's `BundledIdentity` imports it on
  first launch) unless Bring My Certificate is off, and always the website's sources and settings
  (`web/transfer.link`, which `app.js` imports once on first launch). Both files go in before zsign seals the
  bundle. Without a certificate it opens Settings > Signing, and offers Install Now there once the certificate is in.
  Jailbroken visitors get Home's **Jailbroken? Install iFizBox** row instead: iFizBox's APT repo in Sileo or Zebra, or
  the release's `.deb`.
- **Open in iFizBox App** (Settings): sources, travelling settings, Ignored Upgrades and the certificate.
- iFizBox's own upgrade row in Changes, when the app can't sign iFizBox itself (no bridge), opens ifizbox.com in Safari
  (`core/essential.js installSelf`).

What leaves the browser: the IPA's address (to `/api/fetch`) and the signed app (to `/sign/upload`, for 10 minutes).
The certificate, key and password never do, except inside iFizBox's own signed IPA with Bring My Certificate (that
copy waits on the Worker for the same 10 minutes). With an App Store Connect API key added, the App Store Connect
calls and their JWT go through the Worker's pass-through to Apple ("Own provisioning profiles" below); the `.p8` stays
in the browser.

Limits: the whole IPA, unpacked, and the signed copy sit in the browser's memory at once (WebAssembly up to 4 GB,
less on an iPhone), so very large apps may fail with "zsign stopped … too big for this browser".

A browser that still has an old push service worker registered drops it at the next visit (`app.js`).

## Free Apple ID (website)

For people with no certificate. The certificate route stays the recommended one: a free Apple ID signs 3 apps at a
time, makes 10 App IDs a week, and its profiles last 7 days. iOS refuses apps with a free profile from a website
(`MIInstallerErrorDomain` 111, "free provisioning profile … not allowed to be installed from this source"), so the
website does the Apple side only: sign-in, the development certificate and the profiles. Installing is the app's job,
through `installation_proxy` (pairing file + LocalDevVPN), which the app doesn't have yet.

Where: How Signing Works (the walkthrough Install opens when there's no certificate), under the two steps, as
**Use a Free Apple ID**. It shows only when the Worker's Apple relay is on (`GET /apple/status` answers
`{"on":true}`; off, `/apple/status` and every sign-in, developer-services and anisette path are a 404). The relay is
off unless the deploy sets `APPLE_RELAY = "1"` (`worker/src/apple-relay.js`, `worker/README.md`), and ifizbox.com's
deploy does (`worker/wrangler.ifizbox.toml`), so the site shows it. The App Store Connect pass-through for your own API key (below) is not part of it and works
either way.

The flow (`web/app/screens/free-apple-id.js`):

1. **Sign in**: Apple ID and password. SRP runs in the browser (`core/gsa.js`), so the password never leaves it;
   anisette v3 comes from a public anisette server with a machine of this browser's own (kept in localStorage).
   Two-factor: the code screen (a trusted-device push, or an SMS to the first trusted number).
2. **Setup runs by itself** as a checklist (`core/freeroute.js runSetup`): Register This iPhone (the UDID from Find
   This iPhone's UDID), Development Certificate (this browser's own if Apple still lists it as issued, else a new
   RSA key and CSR made in the browser, `core/freecert.js`), App ID (`<bundle ID>.<TEAMID>`: App IDs are unique
   across Apple, so a free team's always carry the suffix and Keep Bundle IDs doesn't apply), Provisioning Profile
   (Apple's 7-day team profile for that App ID; it must list this iPhone). Each step shows a spinner, then a tick and
   a summary; steps not reached are grey. It stops to ask only at Apple's certificate limit: an alert lists the
   issued certificates (this site's first, SideStore's and other tools' last) to revoke one, with the warning that
   every app signed with it stops until signed again. Cancel stops setup and revokes nothing.
3. **Ready**: the team, certificate and profile dates, **Save for the App** (a `.zip` with the `.p12`, its password
   and the profile, which the app's Select All Files imports), the Developer Mode + Trust note, Refresh Profile,
   and Forget Free Apple ID (removes the key and certificate from this browser; Apple's copy isn't revoked).

The setup makes the App ID and profile for the app itself (`BUNDLE_ID`, `brand.js`). The certificate (a `.p12`:
the certificate in a plain bag, the key under PBES2 with PBKDF2-HMAC-SHA256 and AES-256-CBC, an HMAC-SHA256 MAC:
OpenSSL 3's defaults) is kept in localStorage (`ifizbox.freeid`) for its year, with the last profile and the team.

Sign-in errors are iOS alerts worded by `gsa.js signInAlert`: Incorrect Password (-20101, -22406: the Apple ID
stays, the password is cleared and focused), Incorrect Code (-21669: the code screen stays), This Apple ID Is Locked
(-20209, -20283, -20751: a button opens iforgot.apple.com), -36607 (Apple refused this machine: wait 15 minutes; the
page refuses to try again before then), Apple ID Not Found (-20970), else the step, the code and Apple's message.
Setup errors (`freeroute.js setupError`): developer agreement not accepted (a button opens
developer.apple.com/account), session ended, the 10-a-week App ID limit, no UDID yet, else the step and Apple's words.

Rules for apps on this route (`freeroute.js`): `freeEntitlements` keeps `get-task-allow` as the development profile
allows (with it false iOS says "integrity could not be verified"), drops `aps-environment` (Personal Teams have no
Push) and takes the profile's keychain group; `freeExpiry` says "soon" 3 days before the 7-day profile ends
(`FREE_EXPIRY_WARNING`), not the certificate route's setting.

What leaves the browser: every Apple and anisette request goes through the Worker's relay (allow-listed hosts and
paths, no logging); that includes the Xcode app token and the developer-portal replies, but not the password or
the private key. Tests: `core/freeroute.test.js` (CSR checked with WebCrypto, the `.p12` opened by
`checkP12Password` and decrypted back, a real zsign WebAssembly signing run with it, the checklist against a fake
portal, the limit and Cancel), `screens/free-apple-id.test.js` (the alerts' effects, storage, the hand-off zip read
back by the import's unzip, the relay check), `worker/test.mjs` (`/apple/status`).

## Own provisioning profiles (App Store Connect API key)

For a paid developer account. Instead of one imported `.mobileprovision` that covers one App ID and goes stale when
an iPhone is added, iFizBox makes the App ID and an Ad Hoc profile for each app itself, with the account's App Store
Connect API key. The website and the sideload build both do it; the jailbreak build doesn't sign.

**Where:** the **Apple Developer Account** group (`screens/devaccount.js`), under the Provisioning Profile on the
website's Settings > Signing and on the sideload build's Settings > Installation & Signing. It shows once a
certificate is imported: the key makes profiles, not certificates, so the `.p12` and a first profile still come from
[developer-account.md](developer-account.md).

- **Add API Key**: the `AuthKey_<Key ID>.p8` downloaded from App Store Connect > Users and Access > Integrations (the
  Key ID is read from the file name, or asked when the name doesn't hold it), then the Issuer ID. One pick takes the
  `.p8` with a `.txt` holding the Issuer ID, or the `.zip` they came in (`core/certfiles.js sortKeyFiles`); without a
  `.txt` the Issuer ID comes from the field's Paste button (the website also fills it in by itself from a copied UUID
  where the browser has granted clipboard reading; the app never reads the clipboard unasked, which would show iOS's
  Allow Paste). The Issuer ID isn't in
  the `.p8` and no Apple call returns it without it. The key is saved only once Apple accepts a token made from it. A
  key with the Admin or App Manager role. The group's footer links the **How to make an API key** guide (User Guides,
  `asc-key`: Users and Access > Integrations > App Store Connect API > Team Keys, the one-time download, the Issuer ID).
- **API Key**, **Issuer ID**, **Check Account** (is the imported certificate in this account; is this iPhone
  registered, and it registers it when it isn't) and **Remove API Key** (iFizBox stops making profiles; the ones it
  made stay in the account). In the app, when Check Account can't tell this iPhone is in the account (not paired, and
  its own profile came from another team), it offers **Find UDID**: the website's Profile Service visit opens in
  Safari, the app polls for the answer, keeps the UDID (`device.udid.set`) and registers it.
- **Profiles Made by iFizBox**: one row per App ID, from the cache (`core/asc.js profileRows`).

**When signing**, with Keep Bundle IDs on (for this app), every route that signs (install, My IPAs, sign-ahead,
re-sign; on the website, Install) asks for the app's profile first:

1. The App ID: `<prefix>.<last component of the app's bundle ID>`, explicit, one per app so keychains and App Groups
   don't mix. The prefix comes from the imported profile's App ID (else `ifizbox.<team>`; `core/asc.js appIdFor`,
   `appIdPrefix`; two apps whose IDs end the same share one). Made when missing, with Push and every other capability
   the API can turn on (`APP_ID_CAPS`). App Groups is switched on but holds no groups (the API can't make or assign
   them), and Communication and Time Sensitive Notifications aren't in the API, so an app that needs those (and its
   notification extension) needs them added to its App ID on developer.apple.com, or the one shared App ID route
   ("Keep Bundle IDs" below).
2. This iPhone is registered in the account when its UDID is known and it isn't there yet. Without a UDID the
   profile still gets every enabled iPhone.
3. The profile: `IOS_APP_ADHOC`, named `iFizBox <App ID>`, with every enabled iOS device and the imported
   certificate. A cached one is reused unless it's missing, expires within a day, lacks this iPhone, the App ID's
   capabilities changed or the certificate did (`remakeReason`); the old profile is deleted before its new one is
   made.

"The imported certificate" is the `.p12`'s own. The app has its serial from the Keychain (`signing.status`). The
website reads it out of the `.p12` in the browser (`core/p12cert.js`: the certificate bag decrypted with the password,
PBES2/AES through WebCrypto, 3DES and RC2 in JS) and keeps it with the identity (`signing-client.js identityCert`,
`p12Cert`, keyed to the `.p12`'s SHA-256). That serial is used rather than every certificate the imported profile lists,
since a profile made from an API key for a `.p12` picked alone can list all the account's distribution certificates.
Only when the `.p12` can't be read there (a cipher or encoding it doesn't know) does the website fall back to the
profile's list. A cached profile that doesn't list the `.p12`'s certificate is made again.

The app is then signed with that profile instead of the imported one. An Apple error stops the sign with Apple's
words, and a certificate that isn't in the key's account stops it with a line that says so. Keep Bundle IDs off
signs with the imported profile.

**The app** (`native/Sources/ASC.swift`): the key goes into the Keychain (`com.ryha.ifizbox.asc`, this device only)
through `asc.key.set` and never comes back to the page; the ES256 JWT is made with CryptoKit and goes only to Apple.
The UDID comes from `device.udid` (the app's own profile), else This iPhone's pairing (`IDevice.readUDID`, lockdown),
which is remembered. Bridge calls: `asc.key.set`, `asc.key.info`, `asc.key.remove`, `asc.request` (host fixed, a
`/v1/...` path, for the page's checks), `asc.profiles` (the cache) and `asc.udid`.

**The website** (`core/asc.js`, `autoProfileSite` in devaccount.js, called from `signing-client.js` before zsign):
the key stays in this browser's localStorage (`ifizbox.asc`, the cache in `ifizbox.asc.profiles`), like the `.p12`;
the JWT is made with WebCrypto. App Store Connect sends no CORS headers, so the calls go through the Worker's
`/apple/api.appstoreconnect.apple.com/v1/…` pass-through (`devices`, `certificates`, `bundleIds`,
`bundleIdCapabilities`, `profiles`), which forwards the Authorization header and allows DELETE for that host only,
logs nothing and stays on whatever `APPLE_RELAY` says. The UDID is the one Find This iPhone's UDID stored.

What leaves: the JWT and the requests above, to Apple (on the website through the pass-through). The `.p8` never
leaves the phone or the browser. Tests: `core/asc.test.js` (the JWT checked with WebCrypto, every step against a
fake App Store Connect, the remake rules), `worker/test.mjs` (the pass-through).

## On the phone

The iFizBox app's sideload build signs IPAs by itself and serves the signed IPA from the phone; the certificate
never leaves it when installing other apps (the one exception, iFizBox updating itself, is below). Only the
install manifest comes from a server: the Signing Server (sign.ifizbox.com by default, or the user's own deployment of
`worker/`), which sees the app's bundle ID, version and name. A fully local install isn't possible (iOS refuses it,
below). In the jailbreak build none of this runs: the root helper installs IPAs directly, and the `signing.*` calls
answer code `jailbreak`.

### The install step: the options

Signing on the phone is plain work (below). Installing is the hard part: a sideloaded app can't call installd, so
the only door is `itms-services://?action=download-manifest&url=<manifest>`, and iOS fetches that manifest only
over **HTTPS with a certificate it trusts**. The IPA the manifest names can be on plain HTTP (Feather's Semi Local
relies on it). What could serve a trusted manifest:

| Option | Trusted how | Needs | Verdict |
| --- | --- | --- | --- |
| **A. backloop.dev** (Feather's Fully Local): `*.backloop.dev` resolves to 127.0.0.1, served with a public CA's wildcard certificate whose private key is published | a public CA | backloop's pack fetched, public DNS | **No.** A CA must revoke a certificate whose key is public, so the pack lives on borrowed time and expires (docs/sideload.md). Shipping our own such key breaks CA rules; using theirs makes installs depend on a third party re-issuing it. |
| **B. A manifest from a server, IPA from the phone** (Feather's Semi Local): `GET <server>/sign/manifest?bundleid=&version=&title=&port=&path=` answers a manifest whose IPA URL is `http://127.0.0.1:<port>/<path>` | the server's own certificate | the Signing Server (sign.ifizbox.com by default, or the user's own), which sees the app's bundle ID, name and version on every install | **Used.** Nothing to set up on the phone; the certificate and the IPA stay there. |
| C. A CA made on the phone: the user installs iFizBox's own root as a profile and turns on full trust; an HTTPS server on 127.0.0.1 uses a certificate it issues | the user's own trust setting | a one-time setup in Settings | **No.** iOS's installer ignores a hand-trusted root: a page on such a server opens fine in Safari while every install through it fails. |
| D. A pairing file + LocalDevVPN (idevice, Feather's third mode) | lockdownd, no TLS | a computer once to make the pairing file, an App Store VPN app | Works without any certificate, but it needs a computer and keeps a full lockdown credential on the phone. Not built (docs/sideload.md). |
| E. A `data:` URL or a file URL as the manifest | – | – | Not accepted: the manifest URL must be https. |

So every install in the app takes its manifest from the Signing Server; with no server set (or one that isn't
https) `signing.install` and `signing.resignAll` answer `no_server`, and Install opens Settings > Installation & Signing at the
server step.

### Setting it up (once)

Getting the certificate and profile from an Apple Developer account: [developer-account.md](developer-account.md).
With the account's App Store Connect API key added too, iFizBox makes each app's profile itself ("Own provisioning
profiles" above).

1. **Settings > Installation & Signing**: the `.p12`, its password and the `.mobileprovision`. In the app they go
   to `signing.import`: the `.p12` is opened with `SecPKCS12Import` and its identity (certificate and private key)
   is added to the iOS Keychain, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` (never synced to iCloud, never in
   a backup that restores to another phone). The `.p12` file as picked and its password are kept too, as one
   Keychain generic-password item (service `com.ryha.ifizbox.signing.p12`, also `...ThisDeviceOnly`), for iFizBox's own
   update (below); nothing else reads it. The checks: a wrong password, an expired certificate or profile, a
   certificate the profile doesn't list.
2. **A Signing Server**: sign.ifizbox.com unless the user enters their own (a saved ifizbox.com counts as the
   default). That's all: no profile to install, nothing to trust. A phone that ran 0.1.x drops that version's local
   CA keys and files at launch (`SignStore.removeOldInstallCA`); its profile stays in iOS Settings until the user
   deletes it.

The identity outlives the app: the Keychain keeps it when the app is deleted, as long as the next install is
signed by the same team. What picks it out (its certificate's SHA-256) and the profile are kept beside it, as
generic-password items (service `com.ryha.ifizbox.signing.setup`, `...ThisDeviceOnly`; neither is a secret), so a
reinstall comes back with its certificate and profile (`SignStore.restored`, once per launch).

Remove Certificate (`signing.remove`) deletes the identity, the kept `.p12` and those two items from the Keychain,
and the profile file.

### What leaves the phone, and when

Installing other apps sends only the app's bundle ID, version and name (to the Signing Server, for the manifest):
they are signed on the phone and served from 127.0.0.1. iFizBox itself can't be served that way (iOS closes iFizBox
while it installs, which stops its install server), so iFizBox's own update is signed on the phone too and then
uploaded to the Signing Server (`signing.install {host: true}`, `POST /sign/host`), which holds that signed IPA for
10 minutes and serves it to iOS (`worker/README.md`). The certificate and key stay on the phone; the signed iFizBox
(which embeds the profile, as every signed app does) is on the server for those 10 minutes. With an App Store
Connect API key, signing also calls Apple's App Store Connect API directly (the app's App ID, profile and this
iPhone's UDID; "Own provisioning profiles" above); the key stays in the Keychain.

One exception for other apps: iOS can freeze iFizBox while it serves an IPA (seen on iOS 27, even with the silent
audio playing), and the frozen app's listening socket stays shut, so iOS's installer can't reach 127.0.0.1 and says
"Unable to Install". iFizBox notices the freeze once it runs again (a heartbeat that finds a gap), re-creates the
listener on the same port, and, if iOS doesn't ask for the IPA within 5 s, uploads that app's signed IPA to the
Signing Server's `POST /sign/host` as for its own update. It opens no new Install prompt by itself: iFizBox can't tell
the user's Cancel from a frozen server, so the app's row ends "Failed: iOS didn't download it", and its tap (Try
Again, `signing.reprompt`) hands iOS the server's link. That app's signed IPA is then on the server for its 10
minutes. The install log says when iFizBox went to the background, the phone locked, how long it was frozen, and
which copy iOS fetched.

iFizBox opens an Install prompt by itself only until one was shown for that IPA (again when iOS refuses the link, or
shows nothing within 8 s). Once a prompt was shown and closed, only the user's tap opens another.

iOS won't install the new iFizBox over the running one, so iFizBox closes itself, but only once iOS has the whole
IPA: after the Install prompt is answered it stays alive (silent audio) and polls `GET /sign/host/<token>/status`;
when iOS has fetched `app.ipa` to its end it exits, with no notification (the progress page has said it will close;
the icon badge drops this update as it goes). The This iPhone route closes the same way, without a notification, once
installd has accepted the IPA. If iOS hasn't
started the download within 2 minutes, iFizBox stays open and the progress page offers Try Again
(`signing.selfUpdate`). Once iOS has started it, iOS downloads from the server, so iFizBox closing can't break it: if
the server hasn't said `finished` a minute after the start, iFizBox closes anyway, and from 15 s after the start the
progress page says to close it from the app switcher if the new iFizBox is already installing on the Home Screen.
The server keeps the `finished` mark's write alive past the response (`ctx.waitUntil`), since Cloudflare cancels the
request the moment iOS has every byte. The version handed to iOS is remembered, and if the next launch is
still the older version, a banner says the update didn't finish, with Try Again.

`signing.export` (the `.p12` and password kept in the Keychain) is what iFizBox Account reads to sync the certificate
(`screens/account.js`, with Sync Certificate on).

### The page's side: setting up

In the sideload build Settings > Installation & Signing has the Certificate rows (`.p12`, `.mobileprovision`, Password, each
with Browse; one pick can fill all three), but the picks wait in memory only (`signing-client.js`: no IndexedDB)
until all three are there and the password isn't known to be wrong, then go to `signing.import`; after that only the
file names stay, until the app quits. The rest of the page comes from `signing.status`: the identity and its profile
(`core/signing.js deviceSummary`, the signer's `problem` as its footer) and Remove Certificate (`signing.remove`).
The page is a walkthrough (`screens/signing.js`) of two steps, each ticking green once done: **Import Your
Certificate** (a big Select All Files button over the three rows: one multi-select pick of the `.p12`, the
`.mobileprovision` and the password file, or their `.zip`, fills whatever is missing, over a picture of the iOS
file picker, `web/app/icons/steps/select-files-light.jpg` and `-dark.jpg`) and
**Signing Server** (the server row and Check Server). Install on an AltStore app's page and Version History's rows
first look whether both are there (`firstInstallCheck`: `signing.status` and `getServer()`); the first Install with
one missing opens this page at that step, with no alert. Then `signing.install {url, manifestServer}`
(`installOnDevice`); the HUD follows its phase events (`phaseLabel`: "Downloading 42%", "Reading", "Signing",
"Installing") and an error alerts by its code (`deviceError`): `no_server` and `no_identity` then open Settings >
Signing. Tests: `web/app/signing-client-device.test.js`, `web/app/screens/signing.test.js` and
`web/app/core/signing-device.test.js`, against a fake `ifizboxNative`.

### From the website to the app

- **Open in iFizBox App** (Settings; Not Jailbroken only): `ifizbox://import?d=<base64url of
  gzipped JSON>`, the source list as export lines, the settings in `core/settings.js TRAVELS`, Ignored Upgrades and
  the website's certificate, after a banner saying to press Open. The app adds what's new
  straight away and puts the certificate into the Keychain (`signing.import`). Gzip keeps 400 sources around 5 kB.
  No Signing Server travels.
- `ifizbox://install?url=…&name=…`: the app's Install IPA alert, for links already out there (the website doesn't
  send it; "The website signs in the browser", above).
- **Install iFizBox App** on the website: iFizBox's IPA, signed in the browser, carries `ifizbox-identity.plist`
  (Bring My Certificate) and `web/transfer.link` (sources and settings), imported on first launch.
- **iFizBox first** (`web/app/websign-gate.js`): the website asks "Install iFizBox First" at launch until iFizBox
  is installed from it or the user taps Not Now. Other apps' pages offer **Install in iFizBox**
  (`ifizbox://package?id=<id>`: the app opens that app's page, Search's `package:<id>`), Download IPA, then **Install
  on the Website**, greyed out until the user accepts a warning once (its I Understand counts down 5 seconds); the
  acceptance is kept in localStorage and Settings > General > Other Apps > Install on the Website turns it back off. iFizBox's own IPA always
  installs from the website.

The shell keeps the latest `ifizbox://` link (`IncomingLink`, at most 512 kB) and tells the page (`ifizbox:url`), which
takes it with `app.takeURL` (also at start, for a link that launched the app). `app.gunzip` unpacks the import link
where WebKit has no `DecompressionStream` (before iOS 16.4).

### Installing an app

`signing.install {url, manifestServer}`, with progress events (`downloading`, `reading`, `signing`, `installing`):

1. Downloads the IPA to the app's temporary folder (http or https, 4 GB cap). See "Plain http IPA links" below.
2. Signs it on the phone (`native/sign/`, below), into a second file.
3. Starts the plain HTTP server (Network.framework, `NWListener` bound to 127.0.0.1 only), serves `/<token>/app.ipa`
   (ranges supported), and opens `itms-services://?action=download-manifest&url=<server>/sign/manifest?bundleid=…
   &version=…&title=…&port=<port>&path=<token>/app.ipa` (`InstallManifest`): the Signing Server answers a manifest
   pointing at `http://127.0.0.1:<port>/<token>/app.ipa`.
   Before the link goes to iOS, the app GETs that exact manifest URL itself (10 s, `ManifestCheck`). iOS shows
   no prompt and no error when it can't load the manifest, so anything but HTTP 200 with a plist holding `items`
   fails the install with `no_manifest: Couldn't reach <host>: <why>. iOS can't show Install without it.` (or
   `<host> didn't give the install manifest: <why>` when the server answered), and the install log says which.
   My IPAs' install takes the same path (`Sideload.serveAndOpen`).
4. iOS asks to install and fetches the IPA from 127.0.0.1. Once the whole IPA has gone out the token is spent and the
   file is deleted a minute later; unused, it goes after 15 minutes. A background task keeps the server alive while
   the install sheet covers iFizBox.

Nothing listens on Wi-Fi or cellular; every path has a random 128-bit token.

### Plain http IPA links

App Transport Security keeps URLSession off plain http, and the app has no ATS exception (the WKWebView must never
get `NSAllowsArbitraryLoads`). So `Sideload.download`, which `signing.install`, `signing.inspect`, `signing.prepare`,
Re-sign and `library.add` all use, handles an http link like this:

- It first downloads the https twin (the same link over https, port 80 dropped; `web/app/core/insecureipa.js
  httpsTwin` has the same rule). If that works, nothing is asked.
- If the twin fails (any error but `cancelled`, `too_large` or `offline`), the call answers `insecure: …`. The page
  (`signing-client.js askInsecure`) shows "This Download Is Not Secure" with Cancel (the darker safe button) and
  Install Anyway, the same choice http sources get (`screens/manage.js addSecure`).
- Install Anyway sends the same call again with `insecure: true`. The shell then downloads over plain http with
  `PlainDownload` (Network.framework, `native/Sources/Icons.swift`, which also fetches http .debs). A link let through
  once goes straight to http for the rest of the session, so Custom Install's look and then the queue ask only once.
- Re-sign of a recorded app tries the twin, then plain http without asking: the user already let that link through
  when it was installed.
- An https link that redirects to http still fails under ATS. `Download` answers `ats: …` for it, and
  `core/signing.js deviceError` (and `core/ipainstall.js ipaError` in the jailbreak app) shows our own message
  instead of iOS's "App Transport Security policy" sentence.

The twin gets a 20 s idle limit instead of 60 s, so a host whose port 443 hangs asks sooner.

The jailbreak app's `ipa.install` (`native/Sources/Apt.swift IPAInstall.fetchHTTP`: `ifizbox://install`, Settings >
Install IPA, app pages and queued apps from http sources) follows the same rules: the twin first, else `insecure: …`,
and `web/app/ipa-install.js runIpaInstall` asks with the same alert on the install page. Install Anyway sends
`ipa.install` again with `insecure: true` and the link comes over `PlainDownload` into the helper's IPA folder;
Cancel closes the page (a queued app's row ends as cancelled). An http download shows its percent on the bar.

### The signer (`native/sign/`)

iFizBox's own, in Swift, with no OpenSSL: the private key stays inside Security.framework (`SecKeyCreateSignature`)
and only the CMS signature comes out. zsign would need the key handed over as a file or bytes and OpenSSL
cross-compiled into the app; this way neither. It writes what Apple's `codesign` writes:

- each Mach-O (thin, or fat with its 64-bit slices kept): a SuperBlob of a CodeDirectory (version 0x20400,
  SHA-256, 4 KiB pages, the team ID, the executable segment with the main-binary flag), an empty requirement set,
  the entitlements as XML and as DER (iOS 15+ reads the DER ones), and a detached CMS SignedData over the
  CodeDirectory with the signed attributes iOS reads (content type, signing time, message digest, the CDHashes plist
  and the CDHashes2 attribute) and the certificate chain: the user's certificate, then Apple's WWDR intermediate and
  root picked by issuer from `native/sign/certs/` (public certificates from apple.com/certificateauthority);
  an unsigned binary gets an `LC_CODE_SIGNATURE` in the room after its load commands; an App Store-encrypted one is
  refused;
- each bundle inside out (frameworks and extensions before the app): `_CodeSignature/CodeResources` sealing every
  file with SHA-1 and SHA-256 (nested bundles' files included, as zsign seals them; symlinks as links; `.lproj`
  optional), `embedded.mobileprovision` in apps and extensions, the entitlements narrowed per bundle, as the website does
  (`application-identifier` and the keychain group set to the bundle's ID, `get-task-allow` off);
- the bundle ID rules (see "Keep Bundle IDs" below): kept, Info.plist and every code signature keep the app's and
  its extensions' own IDs, and the app and its extensions all carry the profile's App ID as `application-identifier`,
  with the app's own keychain group first ("Keeping an app's data across re-signs" below). The old way, a wildcard profile keeps the app's ID (a `com.you.*` one moves it under the prefix
  if it doesn't fit), an explicit one renames the app and **leaves out its extensions and Watch apps** (one profile,
  one app ID), and says which in `removed`. Extensions' IDs follow the app's;
- an app already on the phone keeps the `application-identifier` it was installed with (installd refuses an update
  that changes it: `MismatchedApplicationIdentifierEntitlement`). The installed one comes from the signed record, else
  from installd through the pairing (installation_proxy Browse); a profile that can give it signs (an explicit one
  only its own ID, a wildcard its pattern as written or any ID under its prefix). When none can, signing stops first
  with `appid_mismatch` and plain words: import the profile it was installed with, or delete the app and install it
  again (its data is lost). `native/sign/AppIDMatch.swift`;
- zip to zip: the IPA is read once to hash every file and is never unpacked to disk; untouched entries are copied
  still compressed, only signed binaries, changed Info.plists and the new files are deflated. ZIP64 is read and
  written.
- speed and memory on a big app: the reading pass and a bundle's loose binaries run on all cores (`readers`), each
  thread with its own handle on the IPA. A signed binary over 1 MB waits in a file next to the output until the IPA
  is written, so only the binaries being signed are in memory. Changed files are deflated at level 1 (`level`), in
  4 MB blocks deflated side by side (one valid stream, as pigz does); level 6 only when the IPA is uploaded to the
  server, whose 25 MB cap matters more than the time. Level 6 ran at 12 MB/s on the iPhone 7 and was most of a big
  app's signing time. FileHandle reads sit in an autorelease pool each: the signer runs as one long block, and
  without that every piece read stayed in memory until it ended. `native/sign/bench/` times it on a real IPA.

Plus the arm64e fix-up, the user's edits and tweak injection (below).

### Before and around signing

`native/sign/SignOptions.swift`, `Inspect.swift`, `CertCheck.swift` (Linux-tested) and `native/Sources/Sideload.swift`
(the phone half, which also handles `signing.install`). The calls are listed at the top of
`Sideload.swift`.

- **Look first.** `signing.inspect {url}` downloads the IPA, keeps it 15 minutes under a token and answers what it is
  and asks for: name, bundle ID, version, minimum iOS, size, its entitlements (read from the main executable's
  current signature; none when unsigned), its privacy permissions (the `NS…UsageDescription` keys, with Settings'
  names and the app's own reason), its extensions and Watch apps (path, ID, extension point), its icon (the PNG as it
  is in the IPA: often Apple's CgBI form, which a browser can't draw), the entitlements the user's profile can't give
  it (`missing`: the signed app goes without them), the ID it will be signed as, and the profile's kind (Development,
  Ad Hoc, Enterprise, Distribution, as the site's `profileKind`).
- **Edit.** `signing.install {token | url, name?, bundleId?, icon?, removeExtensions?, fixArm64e?}` signs with them:
  the name goes into `CFBundleDisplayName`, `CFBundleName` and every `<lang>.lproj/InfoPlist.strings` that names
  either (rewritten as a binary plist); the bundle ID is asked of the profile (the rules above, so an explicit profile
  still signs as its own ID) and extensions follow it (`old.share` -> `new.share`); the icon (a PNG the page sizes,
  180x180 best) is written as `iFizBoxIcon60x60@2x.png` and `@3x.png` and named in `CFBundleIcons` (and `~ipad`), with
  `CFBundleIconName` dropped so iOS doesn't take the asset catalog's; `removeExtensions` leaves those bundles out
  (an unknown path is refused); `tweaks` injects tweaks (below). Bad input answers `bad_options`.
- **Tweak injection.** The sign options (Custom Install's sheet, My IPAs' Sign Options, and on the website an IPA's
  page) have an **Inject Tweaks** group: a row per added file (tap: Remove) and Add Tweak…, which takes `.dylib`,
  `.deb` and zipped `.framework` files. The files are kept per app (by bundle ID) in the page's IndexedDB
  (`ifizbox-tweaks`), so the next sign of that app injects them again; the app's signed record and My IPAs' options
  keep the prepared tweaks too, so Re-sign All and the IPA queue inject them without the page. The page does the
  unpacking for both signers (`web/app/core/tweaks.js prepareTweaks`, archive readers in `core/unpack.js`, plain JS
  so an iOS 15 web view without `DecompressionStream` runs it):
  - a `.deb` is read as ar, then its `data.tar` (`.gz`, `.xz`, `.lzma`, `.zst`, `.bz2` or plain; a zstd frame that
    needs a dictionary is refused); paths lose `./` and the rootless `var/jb/` prefix. `Library/MobileSubstrate/
    DynamicLibraries/*.dylib` and `usr/lib/TweakInject/*.dylib` go to `Frameworks/` and are injected;
    `Library/Frameworks/*.framework` and `usr/lib/*.dylib` go to `Frameworks/` as what the tweaks link;
    `Library/Application Support/*.bundle` goes to the app's top folder; symlinks and the rest (filter plists,
    PreferenceLoader) stay out;
  - a `.dylib` goes to `Frameworks/` and is injected; a zipped `.framework` goes to `Frameworks/` and is injected by
    its executable (the stem, or its only Mach-O);
  - every Mach-O among them has its load commands pointed at what is bundled (`@rpath/X.dylib`,
    `@rpath/Y.framework/Y`) and its own ID set to its `@rpath` name. CydiaSubstrate (`CydiaSubstrate.framework`,
    `libsubstrate.dylib`, and the ElleKit/libhooker names) points at the bundled `CydiaSubstrate.framework`, or
    ElleKit's `libellekit.dylib` when only that is there. When a tweak links CydiaSubstrate and neither was added,
    the bundled ElleKit goes in: `web/app/vendor/ellekit/ellekit_1.2_iphoneos-arm64.deb`, ElleKit 1.2 rootless as
    https://ellekit.space serves it (SHA-256 `e21dc91b…3906dc`, 331444 bytes, pinned in `core/tweaks.js ELLEKIT`;
    BSD-3-Clause, its `LICENSE` beside it; source and update steps in that folder's `README.md`). The page fetches
    it next to itself (the site and the app both carry `web/app/vendor/`), checks size and SHA-256 in plain JS
    (`core/sha256.js`: the app's web view has no `crypto.subtle`), and `withElleKit` prepares again with it first,
    so only its `libellekit.dylib` lands in `Frameworks/` (ID `@rpath/libellekit.dylib`; its Swift runtime comes
    from its own `/usr/lib/swift` rpath) and the tweak's CydiaSubstrate load command points there. The group's
    footer says "ElleKit 1.2 goes in too" as soon as it's the case. The user's own ElleKit or CydiaSubstrate.framework
    always wins. Only when the bundled file can't be loaded or isn't the pinned one is the sign refused, with words
    saying to add ElleKit's .deb;
  - 64 MB of tweaks at most, unpacked.

  What the signer gets is `tweaks: {files: [{path, data}], inject: ["@rpath/…"], names}` (base64 data in the app's
  bridge). It writes the files into the app (paths under `Frameworks/` or a top-level `.bundle` only), adds an
  `LC_LOAD_WEAK_DYLIB` per `inject` path and `LC_RPATH @executable_path/Frameworks` (when missing) to every 64-bit
  slice of the main executable, in the room after its load commands (16 bytes stay free for an unsigned binary's
  `LC_CODE_SIGNATURE`; an executable with no room answers `tweak_no_room`), nothing twice, then signs as usual: the
  tweaks' dylibs and frameworks like any other in `Frameworks/` (a framework with an `Info.plist` is a bundle with
  its own seal). The app: `native/sign/Tweaks.swift` (`MachOEdit.inject`), called by `IPASigner`; the reply lists
  `injected`. The website: `core/tweaks.js injectInto` before zsign.
- **arm64e fix-up**, on by default: Feather's `_locateMachosAndFixupArm64eSlice` (via LiveContainer's
  `LCPatchMachOFixupARM64eSlice`, Apache-2.0): a fat binary's arm64e slice of the old pointer-auth ABI (subtype
  exactly 2) gets `CPU_SUBTYPE_LIB64` in its own header and the fat header, which iOS 26 wants. Done on every Mach-O
  the signer signs, before signing (Feather only does `.dylib`s and frameworks' executables; the change only touches
  a fat file's old-ABI arm64e slice, so doing all of them costs nothing and covers bundles' and extensions' too); the reply lists the fixed ones in `fixedArm64e`.
- **Keep-alive.** From the moment the itms-services link opens until iOS has fetched the whole IPA (plus a minute),
  or the link expires, iFizBox plays one second of silence on a loop (`AVAudioPlayer`, volume 0, mixed with other
  audio; `UIBackgroundModes: audio` is in `Info-sideload.plist`), as Feather's `BackgroundAudioManager` does: the
  install sheet sends iFizBox to the background, and `beginBackgroundTask` alone gives about 30 seconds.
- **Install progress.** `signing.progress {bundleId}` streams iOS's own progress from the private
  `LSApplicationWorkspace installProgressForBundleID:makeSynchronous:` (looked up at run time, as Feather does) and
  answers `installed: true/false` when it ends, `false` when none showed in 45 seconds, `null` when the API isn't
  there. Once iOS has fetched every byte of the IPA it also sends `{served: true}`, once, and goes on watching. It is
  its own call because the bridge drops a call's stream once it has answered, and `signing.install`
  answers as soon as iOS has the link.
- **Re-sign All.** Every install is recorded in `Application Support/Signing/signed.json` (installed and original ID,
  name, version, the IPA's URL, when, its signature's expiry (the earlier of the certificate's and the profile's),
  and the edits). There is no IPA library: `signing.resignAll` downloads each again from its URL, signs it with the
  current certificate and the same edits, and installs them one after another (the next once iOS has fetched the
  previous IPA, or its link expired), answering which worked and which didn't. `signing.installed` lists the
  records; `signing.forget {bundleId}` drops one.
- **Which source's app it is.** Several sources can list apps under one bundle ID (RyukGram and Instagram share
  `com.burbn.instagram`), and an IPA's Info.plist may name a variant after the app it changes. So signing from a
  source sends `credit: {name, source, sourceName, key}` (the source's app: its name there, the source's URL and name,
  its catalog key) with `signing.prepare` and `signing.install`. The record keeps it (Re-sign too), `signing.installed`
  hands it back on each app, and the sign log, the reminder, Installed, Signed Apps and Needs Re-sign name the app by
  it. An app signed without one (My IPAs, an older record) goes by its Installed record, matched by bundle ID, or by
  the source entry that offers its IPA's URL when the record's entry doesn't (`core/installed.js`).
- **Revoked?** `signing.checkCertificate` asks the OCSP responder in the certificate's AIA extension (Apple's
  `ocsp.apple.com`), over plain HTTP as OCSP is, with a request naming the certificate by its issuer (Apple's WWDR
  intermediate from `certs/`) and serial: no nonce, unsigned. The answer is `good`, `revoked` (with `revokedAt`) or
  `unknown`; its signature isn't checked (Feather's doesn't either): it's a warning, and iOS checks for itself when
  the app opens. The last answer is cached and `signing.status` shows it as `identity.revocation`, beside
  `identity.signatureExpires` and `profile.kind`. Asking is an internet call to Apple only when the page asks.
- **Re-sign reminder.** `signing.remind {days}` (Settings > Installation & Signing > Re-sign Reminder) keeps one local notification at 10:00,
  `days` before the earliest recorded signature expiry (or the certificate's and profile's, with no apps yet):
  "Delta stops opening in 2 days. Open iFizBox and tap Re-sign All." It moves after every install and `forget`; 0 turns
  it off. The first call asks for notification permission.

Not in the app: backloop.dev and api.palera.in installs (the Signing Server serves the manifest instead, above), so
no backloop pack expiry check or genPlist URL encoding; and no Zsign-Package (iFizBox's own signer does the job).

### Keep Bundle IDs

**Keep Bundle IDs** (on by default, `core/settings.js keepBundleId`; Settings > Signing on the website, Settings >
Installation & Signing in the sideload build), and the same switch per app in Custom Install. Both signers apply it (`Profile.signingIDs`,
`SignOptions.keepBundleID`; `core/websign.js signingIds`). iOS's installer never compares `application-identifier`
with the bundle ID, and keys the app's data by the bundle ID:

- **On**: Info.plist's `CFBundleIdentifier` and the code signature's identifier stay the app's own (or the ID typed in
  Custom Install), extensions keep theirs (prefixed by the app's, as installd requires) and stay in with an explicit
  profile. Only the entitlements change: `application-identifier` is `TEAM.<App ID>`, the profile's explicit App ID,
  or a wildcard narrowed (`com.you.*` -> `com.you.<last part>`), for the app and every extension; the keychain groups
  are `TEAM.<the app's own ID>` then `TEAM.<App ID>` (below); `aps-environment` comes from the profile. So the app replaces the original instead of sitting beside
  it, and with an Ad Hoc profile whose App ID has Push it can get its own notifications.
- **Off** (the old way, asked first: `OLD_WAY_ALERT`): the app becomes a copy under the profile's ID; its
  notifications won't work and sign-in, iCloud or shared data tied to its ID may not.

Notifications:

- An app signed with Keep Bundle IDs on and a profile that has Push (`aps-environment`) gets its own server's
  notifications, whoever signed it. iOS registers the app for push under the bundle ID in its Info.plist, and the
  app's server sends to that ID with its own key, so the signing team doesn't matter.
- Push is needed but not always enough. Apps that hand notifications to an extension (a modded Discord, for one) use
  the profile's App Groups: with an empty `com.apple.security.application-groups` and without Communication and Time
  Sensitive Notifications they get none. An App ID with Push, groups created and assigned on developer.apple.com, and
  both notification capabilities works (which of the three is decisive isn't known; set up all of them).
  docs/developer-account.md has the steps and how to check a profile.
- One explicit App ID set up like that in an Ad Hoc profile covers every app's notifications. A signing service's
  `.p12` and profile work as well as your own account's. One App ID per app is not needed for push, nor to keep apps'
  keychains and App Group data apart: iFizBox does that under one App ID (below).
- Changing an App ID's capabilities or groups makes its profiles invalid: make the profile again, import it (iFizBox
  keeps the identity it holds until a new one is imported) and re-sign.
- With an App Store Connect API key (Settings > Signing > Apple Developer Account, see "Own provisioning profiles"
  above), iFizBox makes one App ID per app and an Ad Hoc profile for it. That gives each app its own keychain, but its
  group list is empty and it lacks Communication and Time Sensitive Notifications (the API can't set them), so apps
  that need groups get their notifications through the one shared App ID above, or once groups are assigned to their
  App ID on the website.
- Wildcard profiles never get Push (Apple doesn't allow it on a wildcard App ID). Development profiles get
  sandbox push only, which apps' own servers don't send to.
- A renamed copy (Keep Bundle IDs off) has a bundle ID the app's server doesn't know, so it gets no notifications.
- What is sent: the page adds `keepBundleId: false` to `signing.install`, `signing.prepare` and `signing.inspect`
  (and the website's worker job) only while it's off (`core/keepid.js withKeep`); absent means on. Custom Install
  always sends its switch. Records and My IPAs Sign Options saved before the setting existed have no
  `keepBundleID` and keep the old way, so Re-sign replaces what they installed.
- My IPAs: Sign Options has the same **Keep Bundle ID** switch, starting as the IPA's saved choice or else the global
  setting, and saved as it stands (`library.options keepBundleId`). An IPA without saved Sign Options follows the
  global setting: every `library.*` call but `options` carries `keepBundleId: false` while it's off
  (`signing-client.js libraryCall`), `IPALibrary.options(_:keep:)` signs with it, and a signed copy made the other way
  no longer counts. `library.list` answers `options.keepBundleId` null for such an IPA, so the IPA queue's job
  (`core/appqueue.js libraryJob`) leaves it to the setting and sends a saved switch as it is.
- iFizBox's own IPA keeps `com.ryha.ifizbox` like any other app (`SignOptions.keeps`, `websign-job.js`): push
  notifications reach only a copy with that Info.plist ID (docs/push.md). On a copy installed earlier under the
  profile's ID, the update installs beside it; the app says so once before signing (`core/push.js
  renamedUpdateNotice`), and the old copy is deleted by hand.
- Warnings (`core/keepid.js profileNotes`, under the switch and in Custom Install): a wildcard profile (Apple gives
  it no Push), a development one (sandbox push only), an App ID without Push, and an explicit App ID's shared
  App Groups (each app keeps its own keychain group first, but apps signed with one App ID share the profile's App
  Groups folders; their notifications are not affected). Custom Install also warns when the original (same ID, not signed by iFizBox:
  `apps.isInstalled`, `signing.installed`) is on the phone: iOS refuses to put a signed app over the App Store copy,
  which must be deleted first. None of these falls back to the old way: every profile kind installs with the ID kept.
  A plain Install (`signAndInstall`, when the app's bundle ID is known) asks the same before it signs
  (`signing-client.js originalWarning`): Install (remembered per app in `ifizbox.originalWarned`, so it asks once),
  Install a Copy (this time the old way, beside the original) or Cancel. My IPAs' Sign Options says it under its switch.
- The guide: Home > User Guides > Notifications for Signed Apps (`screens/guides.js`, route `guides/keep-bundle-id`),
  linked from those warnings: an explicit App ID with Push (one for every app), the iPhones' UDIDs, an Ad Hoc
  profile, import it. (docs/developer-account.md adds the App Groups and notification capabilities some apps need.) With a signing service's `.p12` and Push profile, only the last two steps apply.

### Keeping an app's data across re-signs

An app keeps its data in three places, and a re-sign must leave each where the app finds it:

- **Its data container** (Documents, Library, its preferences): iOS keys it by the Info.plist bundle ID, so Keep
  Bundle IDs keeps it across any re-sign iOS accepts as an update.
- **The keychain**: items go to the first of the signature's `keychain-access-groups`. Both signers write
  `TEAM.<the app's own bundle ID>` first, when the profile's keychain entry allows it (`TEAM.*`, which every Apple
  profile has), and `TEAM.<App ID>` second (`Profile.keychainGroups`, `core/websign.js keychainGroups`). So apps
  signed under one explicit App ID no longer write into one keychain, where one app clearing its keychain on a fresh
  install cleared the others' sign-ins. Items an earlier signature put in `TEAM.<App ID>` stay readable through the
  second group; until the app writes them again they stay where every app under that App ID can reach them. An app that names a group of its own (Instagram's
  `MH9GU9K5PX.*`) gets the group fix below; one that builds it from its team prefix and bundle ID finds
  `TEAM.<its ID>` entitled.
- **App Groups**: a re-signed app still asks for its original groups (`group.com.burbn.instagram`), which the profile
  can't give. When the original signature names groups or keychain groups the profile lacks, both signers inject
  the group fix (`native/groupfix/groupfix.m`, committed built in `web/app/vendor/groupfix/`, planned by
  `core/groupfix.js` and `GroupFix.swift`; never into iFizBox's own IPA): those groups' folder becomes
  `Library/AppGroups/<group>/` in the app's own container and their suite `ifizbox.appgroup.<group>` in its own
  preferences, and keychain calls lose `kSecAttrAccessGroup` (items land in the app's own group). That place is the
  same under any profile, whatever groups it has or in what order, and no other app shares it. An app an earlier
  sign mapped onto the profile's first group gets that folder and suite copied into its own once (`legacy` in
  `ifizbox-groupfix.plist`; only for an app that had run before it got this fix, never a fresh install, which would
  take in what other apps left in that shared group).
- **Keeping an app's passwords to itself**: `TEAM.<App ID>` (and the profile's app groups) stay keychain groups every
  app under that App ID can reach, and a read that names no group finds what is there: a fresh app took over another
  app's item, and one app's delete that named no group (a fresh install clearing its keychain, a logout, any app the
  group fix strips) deleted every other app's items there, signing them out at no re-sign of their own. So whenever
  the app gets a group of its own first, both signers give it the group fix with `isolate` (that group), even when
  its original names no groups: the dylib names that group on every generic and internet password call (add, read,
  update, delete), so no other app's call reaches the app's passwords and the app never sees theirs. The first launch
  with it copies every password the app could see outside its own group into its own (`copySharedPasswords`, never
  over one it has, in the order a read naming no group finds them, so it keeps the one it read until now), only for
  an app that had run before (anything of its own in its preferences, Documents, Application Support or
  Library/AppGroups; a fresh install copies nothing) and marks `ifizbox.groupfix.isolated` in its preferences. Until
  every item could be copied (locked before the first unlock after a restart, or behind Face ID or a passcode) calls
  stay as before and the next launch tries again. Keys and certificates keep the plain stripping. Extensions don't
  get the dylib; they have the app's keychain groups, so they still find its items.

Every sign logs what it gave the app, so a report of an app that lost its sign-in or settings can be read from
Console Logs (the run's log): `Keychain: TEAM.<its ID>, TEAM.<App ID> (application-identifier TEAM.<App ID>)`, the
groups in their order (new items go to the first), and `Group fix: <groups> -> the app's own folder; keychain groups
stripped; <group> copied in once if the app ran before; passwords kept in TEAM.<its ID>, the shared groups' copied in
once if the app ran before` (every part of `ifizbox-groupfix.plist`), or `Group fix:
none (<why>)`: the original names no groups, iFizBox's own IPA, or no fix dylib in the build (the app's groups then
go unmapped). The app's signer writes them to the log (`Profile.keychainLine`, `GroupFix.logLine`); the website's
job returns them as `signLog` (`core/websign.js keychainLogLine`, `core/groupfix.js groupFixLogLine`), which the
page writes to the browser console.

What iOS doesn't let a re-sign keep:

- **Another team, or another App ID**: installd refuses the update (`MismatchedApplicationIdentifierEntitlement`),
  and deleting the app to get past that deletes its data; the keychain's groups also start with the team. The app's
  signer stops before signing with words saying so (`AppIDMatch.swift`, with the profiles it holds); the website
  can't see what is installed, so iOS's refusal is what the user gets there.
- **A profile group the app used directly** (an app built for it, or one an earlier sign mapped there) that the new
  profile doesn't have: iOS keeps that group's folder from the app. When the IPA being signed carries the earlier
  sign's `ifizbox-groupfix.plist`, the signers say so (the native log, the website job's `warnings`); a sign from the
  original IPA can't tell.

`tools/resignprobe/` checks all of this on the iPhone 15 Pro: a probe app writes a marker to each place and shows
which it still reads after each re-sign (`run.sh`: our two signers, any identity).

### Is this iPhone in the profile?

A development or ad hoc profile installs only on the devices it lists (`ProvisionedDevices`, by UDID). On any other
iPhone iOS refuses the app with "integrity could not be verified", which doesn't say why. So the profile is checked
against this phone (`native/sign/DeviceCheck.swift`, and the same check and sentences in `core/signing.js`
`deviceCheck`):

- **This phone's UDID.** The jailbreak build asks `ifizbox-helper udid` (MobileGestalt's `UniqueDeviceID`). The
  sideload build reads its own `embedded.mobileprovision`: one device there is this phone's UDID; several are a set
  it is one of, so a profile that lists all of them has it and one that lists none can't. The apps use no
  "identify this iPhone" configuration profile. `device.udid` answers it in every build (`native/Sources/PhoneID.swift`).
- **The website's UDID** comes from a configuration profile (below): Find This iPhone's UDID, under This iPhone
  while the check is unknown on an iPhone or iPad.
- **Settings > Signing** (website) and **Settings > Installation & Signing** (sideload), under the Provisioning Profile: "This iPhone is in the profile.", or in red "This iPhone
  isn't in the profile: add its UDID … to the developer account, then make the profile again." with Copy UDID. When
  the UDID can't be read, it gives the profile's device count and how to find the UDID (Finder, or `idevice_id -l`).
  `signing.status`'s `profile.device` is `{state: in | out | unknown | skip, udid?, count, shared}`.
- **Before signing**, `signing.install`, Re-sign and My IPAs fail with `device_not_in_profile` and that sentence.
- An enterprise profile (`ProvisionsAllDevices`) or one with no device list skips the check.
- **When nobody could check** (the website, which can't read a UDID; the app when the check came out unknown), the
  progress page ends on "Sent to iOS. Press Home to watch it install." and a grey "Not on the Home Screen?" line whose
  Help button opens Guides > FAQ > "An app won't install", which explains the UDID in the profile and how to find it.

#### The website's UDID, through a configuration profile

A web page can't read the UDID, but iOS gives it to a "Profile Service" profile that asks for it
(`worker/src/udid.js`, all under `/sign/udid`, so no Worker config changes):

1. Find This iPhone's UDID (`screens/signing.js` `startUdid`) POSTs `/sign/udid`. The Worker makes a challenge,
   keeps `udid:<challenge>` = `{state: "waiting"}` in the `HOSTED` KV for `TTL`, and answers `{challenge, profile,
   poll, expiresIn}`. The page keeps `{poll, expires}` (`ifizbox.udid.pending`) and opens `profile`.
2. `GET /sign/udid/<c>/udid.mobileconfig`: `PayloadType Profile Service`, `DeviceAttributes [UDID, PRODUCT,
   VERSION]`, `Challenge <c>`, `URL https://…/sign/udid/<c>/answer`. It's unsigned, so iOS shows "Not Verified";
   the page's footer says that's fine. The user allows the download, then installs it in the Settings app.
3. iOS POSTs a CMS-signed plist to the answer URL. The Worker finds `<?xml … </plist>` in the bytes (no signature
   check: the challenge, given out by this Worker and repeated in the plist as `CHALLENGE`, is what ties it to a
   visit), checks the UDID's shape, stores `{state: "done", udid, product, version}` and answers 301 to
   `/sign/udid/<c>/done`. An answer for a challenge it never gave out is refused (404), so strangers can't fill KV.
4. iOS opens the done page in **Safari**, not the Home Screen web app, and the two don't share storage. The done
   page writes Safari's own copy (`ifizbox.udid`), and the page that started it polls `GET /sign/udid/<c>` every 2 s
   (and at once when it's shown again: `watchUdid`), saves the UDID in `ifizbox.udid` and redraws. This iPhone
   then says In Profile, or Not in Profile with the UDID and Copy UDID.

### The page's side: installing

- **Install** on an AltStore app in the sideload build (`signing-client.js` `signAndInstall`, so the package page,
  Sign with My Certificate and Version History alike) signs and installs straight away (one tap). **Custom
  Install**, the row under it on an app page (`signing-sheet.js` `customInstall`), goes through `signing-sheet.js`:
  `signing.inspect` under a Downloading HUD, then a sheet (iOS 6 grouped table, **Install** at the top right of its
  bar, a red **Cancel** at the bottom): the app's head, **Install As** (Name, Bundle
  ID, Icon: Choose draws the picked image centred and cropped into a 180x180 canvas and sends that PNG), App
  (version, size, minimum iOS, profile kind), Permissions, Entitlements (each one the profile lacks marked Missing),
  **Your Profile Can't Give It** (red), and Extensions with a switch each (off leaves it out). The IPA's own icon is
  shown when it's a plain PNG; Apple's CgBI PNG (most) can't be drawn, so a letter placeholder stands in.
  **Install** sends `signing.install {token, ...}` with only what changed (`core/signing.js installParams`: a
  name or ID left as it was isn't sent; a bad ID is refused before signing), then `signing.progress {bundleId}`
  keeps the HUD on "Installing N%" until iOS says it's installed. A shell without `signing.inspect` installs
  with a straight `signing.install {url}`.
- **Through the queue**: on an app page, Install (the nav button and the Install row) queues the app with no
  sheet and opens Confirm (`screens/queue.js`); Custom Install's sheet Install queues it with its options
  (`altstore.js appPageCustom`, `signing-sheet.js inspectToQueue`) kept on the job (`core/appqueue.js` `options`:
  the look's token and time, the edits). Confirm signs each in turn with its own options (`queue.js installCustom`):
  the token while it's under 14 minutes old (the phone keeps the looked-at IPA 15), else `{url, ...edits}`, which
  downloads it again; a token goes with one try only. The Queue row says what's custom ("Custom: as \"Name\", ID").
  Version History's rows sign straight away.
- **The queue's run** in the sideload app (Confirm's Confirm, so app pages, Changes' Upgrade (N), Re-sign and Re-sign
  All; `screens/apprun.js` on the black progress page, the brain `core/apprun.js`): one row per app, iFizBox's own
  last. Every app is downloaded and signed first, two at a time (`signing.prepare`, which keeps the signed IPA for 30
  minutes; a Re-sign without a url signs from the phone's record, `{record: bundleId}`), and the rows read Downloading
  / Signing / Signed. Then iOS gets them one at a time in order (`signing.open {token}`, then `signing.progress
  {bundleId, wait: 600}`): "Tap Install on the iOS prompt", and the next waits until iOS has the whole IPA (the
  watch's `{served: true}` event): the row reads Sent to iOS and turns Installed when the watch, still going, sees
  iOS finish. Each try
  of an app carries its own `tag`: the working row's round stop button sends `signing.cancel {tag}`, which stops only
  that app's download, signing, serving or watch, and the next app goes on. A prompt that closed without iOS asking
  for the IPA ends its row "Failed: iOS didn't download it" (the user's Cancel and a frozen server look the same;
  "Cancelled" is only iFizBox's own Stop and Cancel); the IPA stays served, and the row's Try Again asks iOS again
  (`signing.reprompt`, no new signing; it signs again when the IPA is no longer served). A download or signing phase with no
  progress for 3 minutes fails its row. Top right: the red Cancel while it runs (everything not finished is abandoned,
  then Confirm again with the finished apps cleared), Retry All after failures, Done when clean. Re-sign rows end
  "Re-signed, expires <date>". The Log has one line per phase per app; percents only move the bars. A Custom Install
  job signs from its url with its edits here (the look's token isn't used). The website keeps the one-at-a-time run.
- **Settings > Installation & Signing** (sideload, under the walkthrough; `screens/signed-apps.js`): Certificate Status with Check
  Certificate (`signing.checkCertificate`; the row shows Good / Revoked / Unknown / Not Checked from
  `identity.revocation`) and a red footer when the certificate is revoked or `identity.signatureExpires` is under 7
  days away (`certificateWarnings`); Signed Apps from `signing.installed`, soonest to expire first, with Re-sign All
  (`signing.resignAll`, one HUD whose label follows each app: "Signing 40% Delta (1 of 3)", then an alert for any that
  failed) and a left swipe to Delete, which is `signing.forget`.
- **Re-sign Reminder** shows (FEATURES has `resign`); its value goes to `signing.remind {days}` on every change and
  at launch (`screens/settings.js remindNow`, `core/signing.js syncReminder`).

### My IPAs

Installed > Install IPAs (Home's Install IPAs tile) is the user's own IPAs, "My IPAs". In the jailbreak app it lists
the IPAs in `/var/mobile/Documents` and the root helper installs them, with no signing. In the sideload app they are plain files in iFizBox's Documents, which
Files shows under On My iPhone > iFizBox (`UIFileSharingEnabled`, `LSSupportsOpeningDocumentsInPlace`), so an IPA
dropped there from Files is listed too. Add offers Browse (the iOS Files picker, several at once) and From URL (the
Add alert with Paste); an .ipa another app opens in iFizBox (AirDrop, Files, Mail: the document type in
`Info-sideload.plist`) is copied in and its page opens (`ifizbox://myipas?file=<name>`, `web/app/incoming.js`).

- `native/sign/Library.swift` (`IPALibrary`, Foundation only, tested on Linux in `native/sign/tests/main.swift`):
  the list, the details cache (by size and date) with the icon, each IPA's Sign Options, and the signed copy in
  Application Support/MyIPAs. A signed copy counts only while it fits: same file, the certificate in use, the
  Sign Options set now, signature not expired. Anything else is "Not signed yet".
- `native/Sources/MyIPAs.swift`: the `library.*` bridge calls (list, add, pick, options, sign, install, export,
  delete). Sign Now signs offline. Install signs if needed and then installs through `Sideload.serveAndOpen`, the
  second half of `signAndOpen`, with the Signing Server's manifest. The server gets a copy, so the signed copy stays.
  The record's url is `library:<file>`, so Re-sign All signs from the library's file instead of downloading.
- `web/app/signing-client.js` `installFromLibrary`: signs first, then checks that `<server>/sign/status` answers.
  Offline it says installing needs the Signing Server for iOS's manifest and keeps the signed copy.
- `web/app/core/myipas.js` holds the states and rows, and `web/app/screens/myipas.js` draws the pages. On the
  website the library is a list of links kept in localStorage: Add is From URL only, and Install is the certificate
  alert with Download IPA (`altstore.js siteCertificateAlert`). There are no Sign Options there.

### Tests

`native/test_sign.py` builds `native/sign/` with `native/sign/tests/main.swift` for Linux (the Swift toolchain the
native build uses; it skips and says so without one) and runs it against `native/testkit.py`'s throwaway CA,
certificate and profiles, with openssl holding the key. It signs a fixture IPA with a framework, a loose dylib, an
extension, localisations, a symlink and an old signature's leftovers, then re-signs the result, signs with an
explicit profile, signs an unsigned and a fat binary, and, where the build made one, `native/build/iFizBox.ipa`
itself. Each signature is read back: identifier, team, every page hash, the Info.plist, requirements,
CodeResources and entitlement slots, and the CMS checked by `openssl cms -verify`, also against the test CA. Python
then reads the signed IPA again on its own (the DER entitlements decode to the XML ones; CodeResources lists exactly
the bundle's files with their real hashes). Also: SHA vectors, the DER entitlements bytes, a zip round trip, the
profile rules, refusals (not an IPA, a path out of the folder, an encrypted binary), the manifest and itms link, and
the HTTP parsing and ranges. `test_sideload.py`'s Swift also covers `BundledIdentity` (parse, the first-launch
rule), `IncomingLink` and `gunzip`; its `HandoffSourceTest` reads the sources for the URL hand-off, the launch import
and that nothing of the local CA is left. Node: `core/transfer.test.js` (the import link's encode/decode and
review), `incoming.test.js` (the hand-off, `ifizbox://install` and the import's merge), `screens/siteinstall.test.js`
(the website's Install rows and certificate alert, Home's Install iFizBox Lite, My IPAs' Install). `rcodesign verify`
also passed on the signed fixture and the signed iFizBox.ipa (by hand, not in the gate).

The phone half (Keychain, `NWListener`, opening the links, the scene's URL contexts) compiles in the native build but runs only on an iPhone.
`test_sign.py` also checks that `signing.export` is registered and answers `p12`, `profile` and `password`
from the kept item, and that `signing.remove` deletes that item.

`native/test_sideload.py` builds the same way with `native/sign/tests/sideload/main.swift`: profile kinds,
signature expiry, the bridge's options and their refusals, `.strings` parsing (UTF-8 and UTF-16), the arm64e fix-up
on fat fixtures, the inspector, signing a fixture with two extensions, localised names and an old-ABI arm64e
framework with a new name, ID and icon and one extension left out (Python then reads the IPA: the plists, the
CodeDirectory identifiers, the icon files sealed in CodeResources, the fixed slice, `openssl cms -verify` against the
test CA), an explicit profile overriding the asked-for ID, OCSP (the request checked by `cryptography`, answers made
by its OCSP builder: good, revoked, unknown, another certificate's, tryLater), the reminder's date and words, and the
record of signed apps. The phone half of these (audio, `LSApplicationWorkspace`, notifications, the OCSP fetch) is
compiled by the native build only.
