# F464 Donate page

## What I did
- Built the approved option from concept K12 (https://claude.ai/artifact/24YopCmt9KEavoyDohxT47): a Donate row on
  Credits, in its own group under the first group, and a Donate row on Home, in the same group as Credits / Thank You.
  Both open `#/home/donate`.
- The page (`web/app/screens/donate.js`): a "Chip in on Ko-fi" row (https://ko-fi.com/fizlo, `KOFI_URL` in
  `web/app/brand.js`) with a footer, then "What It Took So Far": Prompts, Tokens, Sessions, Commits (no Cost), with a
  since/counted footer.
- `web/app/core/devstats.js`: the generated counts, written by `tools/dev_stats.py`.
- `tools/dev_stats.py` (+ `tools/test_dev_stats.py`): reads the Claude Code transcripts of this project, current and old
  name folders under `~/.claude/projects/`. A ledger in `~/.local/share/ifizbox/dev-stats.json` keeps the sessions
  whose transcripts get deleted later. If a run would count fewer sessions than the committed file, it writes nothing.
- `tools/publish.sh`: runs the script at each release (not on a dry run) and adds the file to the version commit.
- `docs/release.md`: "Donate page counts", and the "Cutting one" paragraph names the counts.
- `release-notes/F464.md`.
- Tests: `web/app/screens/donate.test.js`, `home.test.js` and `homelock.test.js` updated.

## Choices made unattended
- Donate is open on the locked website, like Credits. A locked Donate row asking to install first made no sense, so the
  lock tests' expectations changed.
- A generated JS module, not a JSON file, so the page needs no fetch and no loading state.
- The ledger sits in `~/.local/share` because a task must not write into the main checkout.
- Prompts counts 1,605, not the concept's 1,910: the script also skips messages agent-runner types into sessions itself
  (run-changed notices, resume and answer messages and so on). Voice "Talk mode" and run-app "This chat is about"
  openings are still counted, since a person triggered them.

## Checks
- Chromium, with `tools/concept/build.py` and `check.mjs`: the Donate page in light and dark, the Credits row, the Home
  rows.
- The run with `--route '#/home/donate'` (jailbreak and website) was all clean. The runs used for screenshots, without
  `--route`, report "Home draws its rows (no Home)" because the page was built to start on a subpage (`--start`).
- No phone used: web-only change.

## Not verified
- Tapping Ko-fi in the native app, on a device. It uses the same `window.open(url, "_blank", "noopener")` call as the
  other external rows, but that was not tried on a phone.
- A real `tools/publish.sh` release run with the new step. Only its tests run it, in a throwaway repo without the script.
- Transcripts from other machines (e.g. the Mac) are not counted.
