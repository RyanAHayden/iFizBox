# iFizBox's install server (Cloudflare Worker)

The sideload app signs every app **on the iPhone**; your certificate and key never leave it. iOS still needs a
server for two things, and this Worker is that server:

- **The install manifest.** iOS installs only from an `itms-services` link whose manifest comes over real HTTPS.
  iFizBox serves the signed app itself at `127.0.0.1`; the Worker hands iOS a manifest pointing there.
- **iFizBox's own updates.** iOS closes iFizBox while it installs the new one, and iFizBox's local server closes with
  it, so the signed update waits here for 10 minutes (Cloudflare KV) and installs from here.
- **Apps the website signed in the browser**: the website signs with zsign as WebAssembly in your browser and
  leaves the signed app here for the same 10 minutes, for iOS's install prompt.

Beside those it stores only what you send it for other features: iFizBox Account's encrypted blobs (KV, ciphertext
only), package reviews (the `REVIEWS` D1 database, tokens and addresses hashed) and push devices with the sources
they follow (the `PUSH` D1 database). The tweak index (the `TWEAKS` D1 database) keeps only public facts about public
Tweak Sources' packages, nothing about who asked. It logs no request bodies. iFizBox uses `https://sign.ifizbox.com` unless you set your own.

## Host your own (free, about a minute)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/RyanAHayden/iFizBox/tree/main/worker)

Or by hand, with Node installed:

```sh
git clone https://github.com/RyanAHayden/iFizBox && cd iFizBox/worker
npx wrangler login
npx wrangler deploy        # makes the KV storage on the first deploy and prints your https://….workers.dev address
```

<img src="../docs/img/crop-signing-server.png" alt="Settings > Installation & Signing > Signing Server" width="300" align="right">

Then in iFizBox: **Settings > Installation & Signing > Signing Server**, paste that address, and **Check Server**.

<br clear="right">

### On your own PC or in Docker

The same code runs on Node 22 (`worker/node.mjs`): the website, `/api/fetch` and `/sign/*`, with held updates in
memory.

```sh
git clone https://github.com/RyanAHayden/iFizBox && cd iFizBox
node worker/node.mjs                       # http://0.0.0.0:8787 (PORT, HOST, HOST_IDS, TTL as below)
# or Docker:
docker build -f worker/Dockerfile -t ifizbox . && docker run -d --restart unless-stopped -p 8787:8787 -v ifizbox-data:/data ifizbox
```

**Reviews** (`/reviews/*`) are kept in a SQLite file through Node's built-in `node:sqlite` (Node 22.5+, nothing to
install): `reviews.db` in the folder you start it from, or `REVIEWS_DB=/path/to/reviews.db` (`REVIEWS_DB=off` keeps
none). The Docker image keeps it at `/data/reviews.db`: the `-v ifizbox-data:/data` volume above keeps it across
updates. `REVIEWS_ADMIN=<a long secret>` lets you delete a review (`DELETE /reviews/<package>/<id>` with
`Authorization: Bearer <secret>`); `REVIEWS_SALT` salts the stored token and address hashes, `REVIEW_DAILY` caps
writes per address a day (40) and `REPORT_HIDE` is the reports that hide a review (3), as on the Worker.

iOS takes the install manifest **only over HTTPS with a trusted certificate**, so put it behind one of:

- **Tailscale** (phone on your tailnet): `tailscale serve --bg 8787` gives `https://<machine>.<tailnet>.ts.net`;
- **Cloudflare Tunnel** (`cloudflared tunnel --url http://localhost:8787`) or **Caddy** with your own domain.

These pass the `Host` header through, which is the address the install links use. `X-Forwarded-Host` is ignored
unless you set `TRUST_PROXY=1` (only behind a proxy that sets it), so a visitor can't point those links elsewhere.

Then put that `https://` address in **Settings > Installation & Signing > Signing Server**.

### Settings (`wrangler.toml`)

- `HOST_IDS`: the bundle IDs it holds signed apps for. `*` (the default) holds any app. `*.ifizbox` limits it to IDs
  ending in `.ifizbox`.
- `TTL`: seconds a held update stays (600), and an app the website signed in the browser.
- `MAX_UPLOAD_MB`: the largest IPA the website signs in the browser (512): it downloads through `/api/fetch?kind=ipa`
  and comes back signed to `/sign/upload`, in 20 MB parts, for `TTL` seconds. `0` turns website signing off here.
- `FETCH_RATE`, `HOST_RATE`, `UPLOAD_RATE`: requests per address a minute to `/api/fetch` (300), `POST /sign/host`
  (10) and `POST /sign/upload` (12: each website install sends 2; its parts aren't counted). More get a 429. With the
  `FETCH_RATE_LIMIT`, `HOST_RATE_LIMIT` and `UPLOAD_RATE_LIMIT` rate-limit bindings (`[[ratelimits]]`) the count holds
  across Cloudflare's isolates and the binding's own `limit` applies; without them each isolate counts in memory, as
  `node.mjs` does. `0` turns that memory count off. `node.mjs` counts the connecting address, or, behind a proxy on
  the same machine (`tailscale serve`, Caddy, `cloudflared`), the last `X-Forwarded-For` entry; a proxy that sends
  none puts every visitor in one count.
- `GITHUB_TOKEN` (optional, a secret: `npx wrangler secret put GITHUB_TOKEN`): a GitHub token with **no permissions**
  (public repositories only). GitHub limits anonymous downloads per address, and a Worker's address is shared with
  other sites, so the website's downloads of IPAs on GitHub releases can get "429". With the token, those retry
  through GitHub's API, limited per token instead. A copy on your own PC doesn't need it (your address is yours).
- `APPLE_RELAY` (off unless `"1"`): the `/apple/<host>/<path>` relay for a free Apple ID sign-in in the browser
  (`src/apple-relay.js`, used by `web/app/core/gsa.js`). It forwards only to gsa.apple.com's sign-in paths,
  developerservices2.apple.com's Xcode API and a few public anisette servers, from this site's own pages, with size
  and time caps, and it never logs or keeps what passes through. Off, `/apple/status` and those paths are a 404, and
  the website hides Use a Free Apple ID; ifizbox.com turns it on (`wrangler.ifizbox.toml`). Self-hosted with `node.mjs`, gsa.apple.com needs
  Apple Root CA (`NODE_EXTRA_CA_CERTS`).
  `/apple/api.appstoreconnect.apple.com/v1/{devices,certificates,bundleIds,bundleIdCapabilities,profiles}` is not
  part of it and passes through **even with `APPLE_RELAY` off**: the website's own provisioning profiles with your
  App Store Connect API key (`web/app/core/asc.js`; Apple sends no CORS headers). Only for that host the
  Authorization header (your JWT) goes out and DELETE is allowed (an old profile, before its new one). The caps and
  the same-origin rule apply as above, and nothing is logged or kept.

- **Push notifications** (`src/push.js`, `docs/push.md`): the sideload app's update alerts, sent through Apple's push
  service. They need an **APNs Auth Key** from the Apple Developer team that owns your iFizBox's App ID
  (developer.apple.com > Keys > + > Apple Push Notifications service; an App Store Connect API key can't do it):
  `npx wrangler secret put APNS_KEY` (paste the `AuthKey_<id>.p8` file's text), then `APNS_KEY_ID` and
  `APNS_TEAM_ID`, and `APNS_TOPICS` if your iFizBox runs under another bundle ID than `com.ryha.ifizbox`. The
  devices are kept in the `PUSH` D1 database (made on the first deploy) and checked every 30 minutes (the Cron
  Trigger in `[triggers]`). Without the key push stays off on your server, the app's Settings shows no Push switch, and update
  alerts come from the app's own background check. `node.mjs` has no push.

## Routes

| | |
|---|---|
| `GET /sign/status` | `{ok, ttl, worker: true}` |
| `GET /sign/manifest?bundleid=&version=&title=&port=&path=` | the manifest for `http://127.0.0.1:<port>/<path>` |
| `POST /sign/host?bundleid=&version=&title=` (body: the IPA, up to 95 MB) | `{itms, manifest, expiresIn}` |
| `POST /sign/host?bundleid=&version=&title=&size=` (no body) | `{token, partSize, parts}`: then `PUT /sign/host/<token>/<i>` each 20 MB part and `POST /sign/host/<token>/done` → `{itms, manifest, expiresIn}` (the app sends it so; KV holds 25 MB a value) |
| `GET /sign/host/<token>/manifest.plist`, `/app.ipa` | what that link fetches (each looks again for a few seconds before a 404, as KV is eventually consistent) |
| `GET /sign/host/<token>/status` | `{manifest, started, finished}`: what iOS has fetched; the app closes for iOS to install over it only once `finished` |
| `GET /apple/status` | `{"on":true}` with `APPLE_RELAY` on, else a 404 |
| `/apple/<host>/<path>` | the Apple relay above: the free Apple ID hosts with `APPLE_RELAY` on, App Store Connect always |
| `GET /repo/<file>` | iFizBox's own APT repo (`Release`, `Packages`, `Packages.gz`, `*.deb`): the latest GitHub release's asset, fetched here so clients get no redirect (Zebra can't take GitHub's). `IFIZBOX_REPO` (owner/name) for another repo's releases |
| `GET /api/tweaks.json` | the whole Tweak Index as one file (`src/tweakindex.js`, format in `web/app/core/tweakindexfile.js`), the same for everyone, made from D1 and cached 30 minutes at the edge. Without D1, or when D1 fails, the deployed `/tweak-index.json` (the copy the release writes); `node.mjs` serves its own copy. The sideload app reads this |
| `GET /api/tweaks?source=<uri>&dist=<dist>[&components=a,b][&bundle=<id>]` | for older builds, which ask per source; the app reads `/api/tweaks.json` now. The tweak index (`src/tweakindex.js`): which app each tweak of that Tweak Source is for (`{enabled, source, pending, tweaks: [{package, version, ok, why, bundles, executables, anyApp, systemOnly, dylibs, needs}]}`), from each free tweak's .deb, downloaded once per version; `bundle` keeps that app's tweaks and the every-app ones. A source not seen before is added and read after the answer; the Cron Trigger reads the rest, `TWEAK_INDEX_PER_RUN` .debs a run (20). Kept in the `TWEAKS` D1 database (made on the first deploy); without it `{enabled: false}` and the app checks tweaks on the phone. `node.mjs` has none |

`node test.mjs` checks them against an in-memory KV. ifizbox.com's own deploy: `npx wrangler deploy -c wrangler.ifizbox.toml`, run on release tags only by `tools/deploy.sh vX.Y.Z` (which `tools/publish.sh` runs after tagging; a push to main deploys nothing).

The website's **Install** (no app to sign on) signs in the browser (zsign as WebAssembly, `web/app/vendor/zsign`)
and uploads the signed IPA to `/sign/upload` (in parts, kept 10 minutes) for iOS's install prompt.
