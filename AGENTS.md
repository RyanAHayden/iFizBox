# Agent rules

iFizBox: a package manager with the iOS 6 Cydia look, for modern iPhones. Three front doors, one brain:

1. `web/app/`: **the one frontend** (HTML, CSS, vanilla JS modules, no build step). It runs on the public site and
   inside the jailbreak app. `core/` is pure JS (parsing, versions, Changes, upgrades), tested with `node --test`.
   The UI only talks to a backend interface: `backend-http.js` on the site, `backend-native.js` in the app.
   ifizbox.com (brand.js `DOMAIN`) is one Cloudflare Worker (`worker/`): `web/app/` as static assets, the fetch proxy (`/api/fetch`)
   and the install server (`/sign/*`). No server of our own: the app signs on the phone, the website in the browser
   (F93: zsign as WebAssembly, `web/app/vendor/zsign`, built by `tools/build-zsign-wasm.sh`).
2. `native/`: jailbreak app, a Swift shell around a WKWebView running `web/app/`, plus a root helper for apt.
   Rootless iOS 15+ up to the coming iOS 27 jailbreak. Shape and feel rules: `docs/native.md`. It must hold
   120 Hz: animate only transform/opacity, virtualise long lists, parse in a Web Worker.

3. The sideload IPA (`iFizBox.ipa`, "Lite"): the same `native/` shell built without the root helper, for phones
   without a jailbreak. It's a main build, used all the time: AltStore sources, signing and installing apps on the
   phone, re-signing and updating them (plan section "IPA: sideload management"). One app, two builds; there is
   no separate `ipa/`. (The early "drop the IPA" research was overruled: `journal/2026-11-17-r4-ipa-decision/`.)

Shortcuts recipes live in `docs/shortcuts.md`.

UI concepts (a screen proposed before it's built) go through the concept skill, `.claude/skills/concept/`: the real
`web/app` with the change, live in a phone frame, published as an Artifact. Never a hand-copied mockup.

- Gate: `tools/check.sh` (the `native/` builds, jailbreak and sideload, then every `test_*.py`). It must pass
  before `done`.
- Python: stdlib only (`bz2`, `lzma`, `gzip`, `email`-style parsing); the gate needs no pip packages. Local
  reference tools (`tools/themecmp.py`, `tools/kitmatch.py`) may use Pillow/numpy. Ask in the journal before
  adding a dependency.
- Look and feel: **iOS 6 is the base style, 100%**. iOS 5 elements only where the user asks for one. Source of
  truth: the Teehan+Lax GUI PSDs, converted in `ref/teehanlax/ios6/` (and `ios5/`): `sheet.svg` (vector, layer
  names as `<title>`), `original-2x.png` (Photoshop's composite), `img/` (bitmaps) and `img-hd/` (bitmaps upscaled
  with 4xHDcube4). Take exact colours, gradients and sizes from the SVG. Text is real Helvetica Neue (the system
  font on iPhones); never use upscaled text. Artwork pulled off the 4S (`ref/4s/artwork/`, from `tools/artwork.py`) is the
  original for comparison only: use its HD counterpart from the kit (`ref/4s/hd/`, from `tools/kitmatch.py`;
  `ref/4s/kitmatch.html` flips HD/Original). Cydia's behaviour: `docs/cydia.md` (R2) and Cydia's GPLv3 source at
  https://git.saurik.com/cydia.git.
- iFizBox is its own project, with its own patterns: don't copy or depend on the user's other projects (code,
  CSS, deploy scripts, signing or hosting). Sideload installs happen on the phone, Feather-style (docs/sideload.md, R5).
- The name (and domain, IDs, repo) come from one place: `web/app/brand.js` (`NAME`, imported by the frontend and
  `worker/`) and `native/brand.env` (build.sh's `$(BRAND_NAME)` in plists, `Brand.name` in Swift, `brand.py` for
  Python). Never spell the name in code or a user-visible string; `native/test_brand.py` checks it.
- Bundle ID and package name: `com.ryha.ifizbox` (extensions and spikes add a suffix: `com.ryha.ifizbox.share`),
  from brand.env's `BRAND_BUNDLE_ID`. Internal IDs, storage keys, paths and env variables use the lowercase name
  (`ifizbox.*`, `ifizbox-helper`, `IFIZBOX_*`); F171 made a clean break from the old name (no migration).
- Drawing iOS 6 controls: take colours and shapes from the 4S's UIKit art (`ref/4s/artwork/Shared@2x/`, sample the
  pixels), pressed states from its `*Pressed` images. Never add highlights, glows or bottom lines the phone doesn't
  draw. A gradient on an element with a border needs `background-origin: border-box` (repeat it after any
  `background:` shorthand), or it tiles into the border and shows a light line at the bottom. The bar buttons, back
  arrow and switch in `web/app/ios6.css` are the reference: copy their approach for new controls, and check a 3x
  render zoomed in before calling it done.
- Hints (group footers): iOS 6 style, as the 4S's Wi-Fi and Mail > Fetch New Data: a footer explains only the group
  above it (split groups so each switch gets its own), one or two short sentences, never two hints joined; when
  something is off the footer says so and the fix row sits in that group; status rows get none; centred.
- Never commit Apple artwork (UIKit `.artwork` extracts, system icons) or Cydia's logo. One exception: screenshots
  of iOS's own Settings screens used as tutorial steps (e.g. the pairing walkthrough) may be committed whole,
  system icons included (user, 2026-11-19). Pulled device files go in
  `ref/` (gitignored). Use them as a reference and redraw in CSS/SVG. Don't name the product or pages "Cydia".
  `ref/` exists only in the main checkout. In a worktree, link it first:
  `ln -s "$(git rev-parse --path-format=absolute --git-common-dir)/../ref" ref`.
- The server fetches URLs visitors type in (`/api/fetch`, `/api/ipainfo`, App Store lookups). On ifizbox.com,
  Cloudflare's own fetch is what keeps them off private and loopback addresses; on the self-hosted Node server
  (`worker/node.mjs`) `worker/src/ssrf-node.js` resolves every host and redirect hop, refuses private, loopback,
  link-local, CGNAT, ULA and multicast addresses and connects to the address it checked. Both runtimes refuse
  literal private hosts and `localhost` up front (`worker/src/ssrf.js`). Caps: 30 s for the answer's headers,
  plain `/api/fetch` bodies 64 MB / 120 s, IPAs `MAX_UPLOAD_MB`. A new outgoing fetch uses `env.FETCH` when given.
- The iPhone 4S (iOS 6, jailbroken) is a reference device only: `ssh 4s` (see R1). It shows how iOS 6 and Cydia look
  and behave. It will never run iFizBox (the app or the site), so never test, benchmark or time iFizBox on it.
  Only touch it when your task says so.
  Never run `apt-get upgrade`, `dpkg -i` or `rm` on it unless the task says so. It can't be re-jailbroken
  easily.
  Only one agent may drive its screen at a time. Taps, swipes, opening URLs and screenshots go through
  `tools/ui-4s.sh` under its lock: `lock <ID>` first, `unlock <ID>` when done (also after a failure). If it's
  locked, do other work and try later. Reading or pulling files over ssh needs no lock and can run alongside.
- The iPhone 7 (iOS 15.8.8, palera1n rootless) is the test phone for the jailbreak app (.deb): `ssh 7` (user
  `mobile`; `sudo -n` works, passwordless since 2026-11-18; if it fails, ask the user). Read `docs/iphone7.md` before using it. Touch it only when
  your task says so; drive its screen only through `tools/ui-7.sh` under its own lock. If `ssh 7` fails or
  `/var/jb` is missing, it rebooted: stop and ask the user to re-jailbreak it. Phone only when Chromium/local can't
  check (the rule under the iPhone 15 Pro, below).
- The iPhone 15 Pro (iOS 27, no jailbreak, on this desktop's USB) is the test phone for the sideload build (Lite
  IPA). Agents may install, launch and tap on it without the user, only through `tools/ui-15.sh` under its own
  lock (go-ios + WebDriverAgent from Linux; read `docs/iphone15.md` first). If it isn't listed (`ios list`), it's
  unplugged or untrusted: ask the user.
- **Phone only when Chromium/local can't check** (both phones; user, 2026-11-21). Web and app changes in `web/app/`
  are checked in Chromium (the `tools/readme_shots.py` / `capture.mjs` route with the fake bridge) and with
  `node --test`. Take a phone's lock only for what needs the real device: the native shell, signing and installing,
  iOS-only WebKit bugs, Home Screen icons, notifications. Say in the journal why Chromium couldn't do it. Give the
  lock back as soon as you're done (`trap 'tools/ui-15.sh unlock ME' EXIT` in a script); when a session ends or is
  dropped, the runner frees its task's locks (`runner.toml` `on_exit`: `tools/ui-release.sh`). A lock left behind
  stalls every phone task for its 30-minute stale timeout.
- License: GPL-3.0-or-later. Code taken from GPLv3 projects (Cydia) is fine; never copy code under a license GPLv3 can't include.
- Write findings worth keeping to `journal/<ID>/notes.md`.

## The main checkout

agent-runner merges every task into `~/repos/iFizBox` (the main checkout). Don't leave uncommitted work there:
commit and push it, or work in a worktree or a clone of your own. Edits left in files a merge changes are moved to
a `wip/main-checkout-<time>` branch (and a stash) after 3 minutes so the merge can land (`runner.toml`
`land_edited = "wip"`); get them back with `git checkout wip/main-checkout-…` or `git stash pop`.

Tasks: this repo is worked by agent-runner. Use the agent-runner skill (or run `agent-runner guide`): queue work with `agent-runner plan add`, never edit the plan's TODO.md by hand, never merge task/* or wip/* branches. Asked to do something now? Use `agent-runner take "what" --kind K` (a worktree of your own; `--here` brings edits already made along); never edit the main checkout.
