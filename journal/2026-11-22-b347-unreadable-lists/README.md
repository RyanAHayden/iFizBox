# B347: Confirm sheet names apt's unreadable list file

When apt can't parse one of its own files it refuses every command with

```
E: Encountered a section with no Package: header
E: Problem with MergeList /var/jb/var/lib/apt/lists/repo.twickd.com_._en
E: The package lists or status file could not be parsed or opened.
```

and the apt-problem reader (`explainApt`, `web/app/core/deps.js`) had no sentence for it, so Cannot Comply fell
back to "apt refused this queue (exit 100)" (seen on the iPhone 7 in B329).

## What changed

- `explainApt` reads `E: Problem with MergeList <file>` into a problem of the new kind `lists`: "apt can't read
  the list it downloaded from repo.twickd.com (repo.twickd.com_._en), so it won't run. Refresh your sources to
  download it again." The host is the list file name's first `_` part (apt names list files after their URL),
  URL-decoded (a port is written `%3a`).
- dpkg's status file (`.../dpkg/status`) gets its own sentence: Refresh doesn't fix it, it needs repairing in a
  terminal.
- `The package lists or status file could not be parsed or opened.` alone (no MergeList line) still gives a
  sentence (Refresh your sources); next to a MergeList line it adds nothing.
- No action row: the Confirm sheet's `actionRow` (`web/app/screens/queue.js`, not this task's files) has no
  Refresh action. Filed as a follow-up.

## Tests

`deps.test.js` "apt that can't read its own lists ...": the 7's output verbatim, a host with a port, the status
file, and the summary line alone. `node --test web/app/core/deps.test.js`: 15 pass.

## Not verified

- On a phone: the Confirm sheet showing the new sentence. B329's helper fix (`Acquire::Languages=none`) means
  the 7 no longer produces this output for the Twickd page, so there is nothing to trigger it with; the wording
  goes through the same `drawIssues` path as every other `explainApt` sentence, which is unchanged.
