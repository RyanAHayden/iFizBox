# Push notifications

The sideload app's update alerts come from two places:

- **the background check** (`native/Sources/BackgroundCheck.swift`): iOS runs it when it likes, often hours apart;
- **push** (Settings > Updates > Checking for Updates > Push): the signing server checks the same list every 30
  minutes and sends the alert through Apple's push service (APNs) at once.

Both stay on together; push only makes the alert come sooner. The jailbreak build has neither: its daemon checks apt.

## Settings > Updates

The sideload app's Updates page, what you get first, how it's checked after:

| Group | Rows |
|---|---|
| **Update Alerts** | Notifications and Icon Badge (iOS's; flipping opens iOS Settings), iFizBox Updates |
| **Checking for Updates** | Push, Last Push (its own footer: what Push does, or what's wrong) |
| *(no header)* | Background Check, Last Check; Background App Refresh and Notifications (iOS's) with Turn On in Settings only when iOS has one off, the footer saying which |
| **Ignored Upgrades** | the held apps |

**iFizBox Updates** (on by default): off, iFizBox's own entry leaves the list the background check and the push
server follow, so only your apps' updates alert you. iFizBox's own update still shows in Changes, and the
Signature Expiring push still comes. The jailbreak build's Updates page is unchanged.

**Push is on by default.** A few seconds after launch, when the signing server says it can push (`GET /api/push`
answers `enabled: true`), nothing below blocks it and the user never turned Push off, the app turns Push on by
itself. If iOS has never asked about notifications for iFizBox, its permission prompt shows then; Don't Allow leaves
Push off for good (iOS won't ask again; Notifications on this page opens iOS Settings). While the server has no APNs
key it stays off, and turns on by itself at the first launch after the key is added, with no app update. Turning
Push off by hand is remembered (`ifizbox.push.userOff`): it never turns itself on again; turning it on by hand
clears that. An automatic try that fails (no token, the server refused) leaves Push off and tries again next launch.

## What travels

Turning Push on asks iOS for notification permission (once) and a device token, then sends to the signing server
(Settings > Installation & Signing > Signing Server, `https://sign.ifizbox.com` unless changed):

- the token, the APNs environment (`production` or `development`, from the app's embedded profile's
  `aps-environment`), the bundle ID (the APNs topic), the signing team, the app version and iOS version;
- what the background check follows: each app's ID, name, installed version and AltStore source URL, iFizBox
  itself through its own source (unless iFizBox Updates is off), and the updates already counted on screen (so they
  don't push);
- when iFizBox's own signature ends (from its embedded profile), for one "Signature Expiring" push two days before.

It is sent again whenever that list changes (`web/app/app-updates.js`), only while Push is on. Turning Push off
deletes everything kept for the device on the server; so does APNs saying the token is dead. Tokens and lists are
never logged.

## What gets pushed

| Push | When |
|---|---|
| **iFizBox X.Y** | iFizBox's own source has a newer iFizBox |
| **n Updates** (names in the body) | a followed app's source has a newer version that runs on this iOS (minOSVersion / maxOSVersion), not already counted on screen |
| **Signature Expiring** | iFizBox's signature ends within two days |
| **Test Push** | `POST /api/push/test` with the device's token (server admins; no button in the app) |

Each version is pushed once. A tap opens Changes and refreshes the sources.

## When push can't work

Checking for Updates shows no Push switch at all (update alerts then come from the background check alone) when:

- **The copy was renamed by its signer.** APNs delivers by topic = the app's **Info.plist bundle ID**, whichever team
  signed the copy. The key on ifizbox.com reaches `com.ryha.ifizbox` (an explicit App ID with Push Notifications on
  team S8NFX3A2LT), so every copy that keeps that ID gets pushes: Arctic Sign, RSideload, SideDrop, iFizBox's own
  signing, any team. iFizBox and the website now keep iFizBox's own ID when they sign it (Keep Bundle IDs, on by
  default). A copy installed earlier under the profile's ID gets the update **beside** it: the app says so once
  before signing, and the old copy is deleted by hand. (ifizbox.com's key: Apple Push Notifications service key
  made on developer.apple.com > Keys by an Admin of S8NFX3A2LT; set on the `ifizbox` Worker with
  `npx wrangler secret put APNS_KEY -c wrangler.ifizbox.toml` and `APNS_KEY_ID`.)
- **The profile has no Push** (no `aps-environment`): iOS gives no token. Wildcard profiles never have it; an explicit
  App ID with Push Notifications does (RSideload's and SideDrop's profiles do). `development` profiles push through
  APNs's sandbox host, `production` (Ad Hoc, distribution) through the production one. Other re-signed apps can need
  more than Push (App Groups with groups assigned, Communication and Time Sensitive Notifications):
  docs/developer-account.md.
- **Notifications are off** for iFizBox in iOS Settings.
- **The server has no APNs key** (or no push database). A self-hosted Worker needs its own key from the team that
  owns its iFizBox's App ID: worker/README.md.

The app's own entitlements (`native/entitlements-sideload.plist`) carry no `aps-environment`: signers use the
profile's, and one that kept a binary's `aps-environment` under a profile without Push would make iOS refuse the
install.

## A blank icon on the push

iOS draws a notification's icon from a copy it keeps of the app's icon, and refreshes that copy only when the
iPhone restarts: not when the app is updated or reinstalled over itself, and not when it switches to another icon
(Settings > Theme > App Icon). Builds before 0.17.1 had no asset catalog (`Assets.car`) for the `CFBundleIconName`
their Info.plist names, so iOS kept its blank grid placeholder for them; an iPhone that showed one of their
notifications keeps that blank icon on later versions' pushes until it restarts. Restarting the iPhone fixes it.

iFizBox's own Clear icon (a white square with a thin globe) looks much like that placeholder at notification size.

## The server

`worker/src/push.js`: `POST /api/push/register`, `/unregister`, `/status`, `/test`, `GET /api/push`; devices in the
`PUSH` D1 database; the Cron Trigger (`[triggers]` in `wrangler.toml`) runs the check. It signs the APNs provider
token (ES256) with the key in the `APNS_KEY` secret, renewed every 40 minutes. `worker/test-push.mjs` runs it all
against SQLite and a fake APNs.
