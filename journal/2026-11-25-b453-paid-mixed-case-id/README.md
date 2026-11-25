# B453: paid packages with capital letters in their ID

**Cause.** The vendor APIs return 404 for a package ID as listed when it has capital letters.

**Evidence.** Signed-out curl on 2026-11-25 to `package/<id>/info` with a zero udid:
- Havoc `com.thetimeloop.EchoUI`: 404. Lowercase: $0.99.
- Havoc `com.bousrih.Lyre`: 404. $1.99.
- Havoc `orensito.Tango`: 404. $2.49.
- Chariz: all four mixed-case commercial IDs in its Packages (`ha.tinyapps.FindAlert`, `lunotech11.Legizmo.Grace`,
  `.Jupiter`, `.Kincaid`) return 404 as listed. Their prices come back in lowercase ($3.99, $4.99 x3).
- An empty udid gets 400 from Havoc, so the zero udid is what the check used.
- `authorize_download` with a bogus token on Havoc: EchoUI 404, lowercase 401 Unauthorized. The same rule applies
  there. Chariz returns 404 for both, so that check tells nothing.

**Fix.** `pkgPath(base, id)` in `web/app/core/payment.js` lowercases the ID for the hosts in `LOWERCASE_ID_HOSTS`
(`havoc.app`, `chariz.com`). It is used by info, purchase and authorize_download. Other vendors get the ID as listed.
This is a host list, not a retry on Not Found, so no purchase request is sent twice and no request is added.
`paid.install` and the download still use the ID as listed, and the downloaded .deb must match that one.

**Tests.** `payment.test.js`: all three calls for both vendors in lowercase, plus unchanged lowercase and another
vendor. `paidTweakDeb` downloads as the listed package. Live, through `buildRequest`: EchoUI and FindAlert.

**Not verified.** A phone, a real sign-in, a real purchase or a paid download (none were made). Chariz's purchase and
authorize_download with lowercase are inferred from its info call. Lowercase purchase on Havoc is inferred too.
