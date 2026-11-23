# B348: a web page saved as an apt list breaks every apt command

## What I did

- `native/helper/policy.c`: `helper_drop_web_lists(prefix, source_line, out)`. Reads every file in
  `<prefix>/var/lib/apt/lists` (not `lock`, not `partial/`, regular files only, no symlinks followed) and deletes
  each one whose first byte that isn't blank (spaces, tabs, line ends, a UTF-8 BOM; up to 64 KB read) is `<`.
  Each deleted file is named on stderr the way apt names a failed fetch, `E: Failed to fetch <url>  the repo
  answered with a web page, not an apt index`, which `core/aptupdate.js` already reads (no app change needed).
  The URL is rebuilt from the file name: apt's URItoFileName (scheme and user dropped, `\|{}[]<>"^~_=!@#$%&*` as
  `%xx`, `/` as `_`) is matched against every http(s) word in `etc/apt/sources.list` and `sources.list.d/*.list`,
  `*.sources` (and update-source's own `deb` line); the longest matching source URI wins, the rest of the name is
  turned back (`_` -> `/`, `%xx` undone). A file no source has gets a `W: ifizbox-helper: deleted <file>` line.
- `native/helper/main.c`: `update` no longer execs apt-get; it runs as a child through the same function as
  `update-source`, and both then call `helper_drop_web_lists`. When a source was named for a file that isn't a
  Translation file and apt said 0, the helper exits 100 (apt's exit for a failed fetch), which the app's
  `update()`/`updateSource()` accept when failures are listed. A Translation file is dropped and named but leaves
  the exit alone, since the app counts no Translation failure (100 with no failure would be an error).
- `native/helper/test_helper.py`: `test_chain_update_drops_web_lists` (HTML Packages for a flat https repo and a
  dist http repo with `_` in its path, an XML page no source has, a good list, an empty file, a BOM + blank lines
  before `<`; apt's own non-zero exit kept; Translation case; update-source naming its own URI not in any file).
- `native/helper/README.md`: a paragraph on it.

## Tried and failed

- First cut passed `plan->argv[1]` as update-source's URI: by then argv holds apt-get's words (`-o`), so the file
  went unnamed. Now the plan's `source_line` (`deb <uri> <suite> ...`) is scanned instead.

## Not verified

- Not run on a phone against a real repo serving HTML for Packages: no such repo at hand, and the chain test
  stands in for apt with a shell script. The file-name mapping follows apt's URItoFileName as I know it; a URI
  with characters it quotes beyond `_` (e.g. `~`) is mapped by the same table but only `_` is covered by the test.
- A `.sources` file with `Enabled: no` stanzas still contributes its URIs to the lookup; harmless (it only names
  a URL), not tested.
