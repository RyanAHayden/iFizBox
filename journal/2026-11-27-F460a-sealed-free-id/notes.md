# F460a Website side: the computer install seals the Free Apple ID record

## What I did
- `core/websign.js`: `newRecordKey`, `sealRecord`, `openRecord`. WebCrypto AES-GCM with a random 256-bit key. The file
  is JSON `{"v":1,"alg":"A256GCM","iv":<base64url, 12 bytes>,"data":<base64url, ciphertext + tag>}`; the plaintext is the
  record's JSON.
- `websign-job.js`: a `sealedFreeId` option writes the record sealed as `web/free-id.json` and then never writes
  `ifizbox-identity.plist`.
- `screens/computer-install.js`: the key is made once and kept in localStorage `ifizbox.freeid.key` (beside
  `ifizbox.freeid`). `Forget Free Apple ID` removes it. The key never goes to the Worker.
  - Finish Setup: a group headed "After the Install" with a row linking to `ifizbox://free-id#<base64url key>`. Safari
    never sends a fragment to a server. It shows in the Computer Install block once a key exists (also after a reload),
    and above "Use a Free Apple ID" while that group is closed, so `https://ifizbox.com/#/home/settings/signing` shows it.
  - Save the IPA now signs a second time, apart, with the plain record and `ifizbox-identity.plist` (for other tools).
    Its finished page has a "Save the IPA" button.
- `screens/free-apple-id.js`: `forgetFreeIdentity` also removes the key.
- Tests: `websign-job.test.js`, `computer-install.test.js`, `free-apple-id.test.js`, `storagekeys.test.js`,
  `websign-free.test.js`, `websign.test.js` (`node --test`): 59 pass, run before a one-class style change to the Finish
  Setup row (`free-button` -> `free-primary`).
- Docs: `docs/signing.md` (what leaves the browser, Download for a Computer Install, After a computer install).
  `release-notes/F460a.md`. Plan note on F460b.

## The plist decision
`ifizbox-identity.plist` held the same `.p12` and password, in the clear, in the same bundle. Encrypting
`free-id.json` alone would have protected nothing: the Worker would still get the certificate in the IPA. So the
uploaded computer-install IPA carries no identity plist. Consequence: the installed app has no certificate in its
Keychain at first launch. It gets one only once it has the key and imports the identity from the decrypted record.
That is F460b (app side), not yet built. The certificate route's Install iFizBox App is unchanged and still carries
`ifizbox-identity.plist` with Bring My Certificate.

## What failed or changed on the way
- The first Chromium screenshot of the Computer Install block was taken on a bare test page that lacked `style.css`.
  The shot that was kept uses only the ios6/style/freeid CSS on that bare page.

## Not verified
- No real iPhone and no real Apple ID computer install. The sealed IPA has only been checked by the node tests.
- The `ifizbox://free-id#…` link opening the app: the app side is not built (F460b).
- Whether the app route works at all until F460b lands: after a computer install the app has no certificate.
- Save the IPA's progress page button saving a file on iOS Safari.
- Finish Setup on the real Settings > Signing page: only a bare harness page was screenshotted (Chromium, with the
  ios6/style/freeid CSS only).
