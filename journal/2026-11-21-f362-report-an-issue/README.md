# F362 Report an Issue

## What I did

- `web/app/core/report-issue.js`: the issue URL builder, with no DOM. `reportLog` picks the open Console Log, else the
  newest failed one, else the newest. `issueTitle` and `issueBody` give the version (build), the build name
  (jailbreak / Lite / website), iOS, the device model and the log in a code block. The fence is longer than any run
  of backticks in the log. `issueUrl` keeps the longest tail of the log whose URL stays within `URL_CAP` (8000)
  (a binary search over the line count, then over characters when even the last line is too long). It marks a cut
  log "(trimmed: the last N of M lines)" and adds a line asking for the full log to be pasted from the clipboard.
- `web/app/screens/queue.js`: a "Report an Issue" row (help icon) in its own group under Console Logs on Settings'
  root, in both builds and on the website. A second row sits under the log on each Console Log page. `reportIssue`
  copies the whole log to the clipboard only when it was trimmed, then calls `window.open`. In the app and in the
  Home Screen web app, app.js and the shell send that to Safari. The app's info (`app.info`, or on the website
  build.json and the user agent) is requested when the row draws. On the website, the clipboard write and
  `window.open` then run during the tap itself, not after an await.
- `core/report-issue.test.js`: the fields, the trim to the cap (the most lines that fit, one more goes over), one
  very long line, encoding (`& = ? # + %`, emoji, backticks) round-tripped through `URL`, which log gets picked,
  and the case with no log and no info.
- I checked it in Chromium with `capture.mjs` (F361's copy plus a `tap` step that sends real CDP mouse events) and
  `script.json`. It seeds three logs, one failed with 1500 lines. I ran it in all three builds (Lite here,
  `jb/`, `site/`). Shots: `settings-row.png` and `log-page-row.png`. Settings' row picked the failed run, which
  gave a URL of 7995 characters, 103 lines kept, and the clipboard held the full stored log (60 KB). The log page's
  row sent that page's log (Completed), untrimmed, with nothing copied.

## What failed along the way

- `rowIcon("github")` isn't a ROW_ICONS entry. It threw, and the rowicons test failed, so I used `help`.
- `runLogs.list()` drops each entry's text. The first run of the shot sent an empty code block, so `reportIssue`
  now reads the picked entry with `get()`.

## Decisions

- The clipboard is written only when the log was trimmed, so it isn't overwritten for nothing.
- On the website the page can't know the model, so the user agent stands in for "Device".
- The body has an empty "What happened:" section for the reporter to fill in.

## Not verified

- I did not test on a real iPhone (opening Safari through `app.openURL`, or the clipboard in WKWebView). Chromium
  with the fake bridge covers the page side, and the rule is phone only when Chromium can't check. The Safari
  handoff is existing code that the other link rows already use.
- GitHub's real URL limit: I did not open a prefilled URL on github.com. The 8000 cap comes from the brief's ~8 KB.
- The website's version line: a local checkout has no build.json, so the shot shows "unknown". On ifizbox.com it
  comes from build.json, the same as the version footer.
