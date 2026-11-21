# T70: sync-piracy-list.py sends GH_TOKEN

**Problem.** `tools/sync-piracy-list.py` called api.github.com anonymously; the 60-an-hour anonymous limit is shared
by every agent on the machine, so a release could fail with `HTTP 403: rate limit exceeded` (T54 hit it).

**Done.**
- `api_headers()` builds the request headers; when `GH_TOKEN` is set (and not blank) it adds
  `Authorization: Bearer <token>`. `fetch_json` uses it. No token: same anonymous request as before.
- `tools/release.sh` already exports the owner's `GH_TOKEN` in `gh_auth`, which a real run calls before the sync,
  so no change there. A `--dry-run --sync-piracy` doesn't call `gh_auth`; it sends a token only if the caller's
  environment has one.
- Tests (`tools/test_sync_piracy_list.py`): `urlopen` patched to capture the request; with `GH_TOKEN` the
  Authorization header goes out, without it (or blank) none does. Nothing is fetched.
- Live check: `GH_TOKEN=$(gh auth token) tools/sync-piracy-list.py --out <scratch>` fetched 145 hosts from
  f517ff676e47; the same token reports the 5000/hour authenticated limit on /rate_limit.

**Tried that failed.** nothing.

**Not verified.** A full `tools/release.sh` run (it publishes a release; out of scope). Behaviour when the token is
invalid: GitHub answers 401 and the script stops with that error, as it did with 403 before; not reproduced.
