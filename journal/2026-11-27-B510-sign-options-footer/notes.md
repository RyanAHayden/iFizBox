# B510: My IPAs' Sign Options on a free Apple ID's profile: the Install As footer offered a second copy

## What was wrong

On a free Apple ID's profile (free, not wildcard) a typed bundle ID makes no second copy (`docs/signing.md`,
"Per-app profiles"). The Install As footer in My IPAs' Sign Options still said "A new bundle ID installs a second
copy; your profile may still change it."

## What changed

- `web/app/screens/myipas.js` `renderOptions`: when `appIdOnly` (the flag B508 added) the footer reads only
  "Empty fields keep what the IPA has.". Other profiles keep the full footer.
- Same choice as Custom Install's signing sheet (B505).
- `web/app/myipas-pinned.test.js`: both cases extended. The free profile's footer has "Empty fields keep what the
  IPA has." and no "second copy"; any other profile's footer still has "A new bundle ID installs a second copy".

## Tests

- `node --test web/app/myipas-pinned.test.js`: 3/3 passed. Nothing tried failed.

## Not verified

- **The page itself**: not looked at in Chromium or on a phone. The change is footer text only, and the node test
  reads the drawn footers.
