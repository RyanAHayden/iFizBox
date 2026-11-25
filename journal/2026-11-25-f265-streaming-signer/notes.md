# F265: the website signer streams the IPA

## What changed

- `web/app/websign-stream.js` (new): each file of the IPA stays compressed in the IPA's own bytes behind an
  emscripten MEMFS node; zsign's reads inflate as they go, what zsign writes is deflated as it comes. The signed IPA
  is put together in pieces (`core/pieces.js`): a file nothing changed is a view of the original bytes.
- `tools/zsign-wasm/stream-files.patch` (replaces `fs-mmap.patch`): zsign hashes files in 64 KB pieces and maps
  executables into one reserved malloc buffer, sized for the biggest executable.
- `tools/zsign-wasm/ifizbox.cpp`: exports inflate, deflate, CRC, SHA-256 and reserve instead of `ifizbox_unzip`.
- The IPA's SHA-256 is hashed by the wasm in pieces. `crypto.subtle.digest` copied the whole IPA, and it isn't
  available on plain-http pages.
- `editHead` injects load commands without reading a whole thin executable.
- Output became pieces, so these changed too: `signing-worker.js`, `signing/browser.js` (uploads its parts via
  `piecedBytes`), `core/websign.js` (`zsignArgs` lost `-z` and `-o`), `tools/resignprobe/sign-web.mjs`, the tests, and
  the shared `web/app/stream.test-helper.js`.
- Peak memory is now the IPA, plus the biggest executable, plus the compressed changed files.
- Decisions: an IPA with stored (uncompressed) entries uploads at its own size (the old signer recompressed it). A
  file that doesn't inflate gives "That IPA couldn't be unpacked." A failed malloc for a mapping aborts as "Out of
  memory" rather than leave a dylib unsigned. A wrong zip CRC is corrected from the data read. The output is
  identical, so `WEB_SIGNER_VERSION` isn't bumped.

## Checks

- Old vs new signer on 4 synthetic apps (one with a fat binary, one re-signed with the group fix): same entry names
  and same bytes, except the CMS signature blobs (signing time) and the hashes that depend on them. `unzip -t` is
  clean on every output.
- Node peak RSS (`/usr/bin/time`) on a 124 MB IPA (292 MB unpacked): 1003 MB before, 326 MB after; 4.1 s before,
  3.0 s after. On a 101 MB stored IPA: 479 MB before, 277 MB after.
- Chromium, a real worker: signed the same app.
- iPhone 7, Safari tab, through the local rig over `ssh -R` (a real device because only it has the iOS memory limit;
  Chromium couldn't show it). New signer, each on the first try: 101 MB signed and posted in 3.9 s; 124 MB (60 MB
  executable) in 13.7 s; 211 MB (442 MB unpacked, 40 MB executable) in 13.1 s; 327 MB (682 MB unpacked, 80 MB
  executable) in 22.9 s. The old signer never finished 101 MB or 124 MB on the phone: it hung at signing and the
  phone dropped the ssh tunnel.
- Failed attempts: `chromium --dump-dom` exits before the page finishes. Using `--remote-debugging-port=0` with a
  timeout worked.

## Not verified

- Installing a signed result on an iPhone. The test certificate isn't Apple's, so the output was compared byte for
  byte with the old signer instead.
- Apps with one very large executable (over about 80 MB) on the iPhone 7. zsign still needs that executable in one
  piece.
- A home-screen web app. A Safari tab was used.
- Signing inside the full ifizbox.com flow on the phone.

## Follow-up

- Limits learned under the old signer are kept in localStorage `ifizbox.signMemory` (`core/websign.js MEMORY_KEY`).
  They still open Too Big for This iPhone until Try Anyway succeeds. Filed as a follow-up to forget limits learned
  before this signer.
