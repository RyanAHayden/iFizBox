# B311 Tailscale machine name for iPhone19,x, and the label rule in the test

## What I did
- `Tailscale.modelNames`: nothing left to add. F357 (merged just before this task started) already has
  `iPhone19,2 = iPhone 18 Pro`, read from the user's phone's ProductType. The other iPhone19,x identifiers are not
  known and can't be guessed (19,2 is the Pro, so the old ",1 = Pro" order does not hold); that is F364's job.
- `test_tailscale.py` `tailscale_label`: was "lower case, runs of other characters to '-'", which would turn
  `iPhone19,2` into `iphone19-2`. Now a port of Tailscale's own rule, read from the pinned module
  (`tailscale.com@v1.104.7/util/dnsname/dnsname.go`, `SanitizeHostname` / `SanitizeLabel`): drop `.local`,
  `.localdomain`, `.lan`; cut to 63 bytes; trim to the first and last letter or digit; lower case; a space `.` `@` `_`
  inside becomes `-`; `-` is kept; every other character (`,` `'` …) is dropped.
- New test `test_label_drops_punctuation`: `iFizBox on iPhone19,2` -> `ifizbox-on-iphone192` (what R64 saw on
  Tailscale), `Sam's iPhone` -> `sams-iphone`, plus the separator and suffix cases.

## Correction to F353's journal
`journal/2026-11-21-f353-tailscale-machine-name/README.md` gives `ifizbox-on-iphone19-1` as the fallback label for
an unknown model. Tailscale drops the comma, so the label is `ifizbox-on-iphone191`; that one example is corrected in
place (the task asked for it).

## Spec review
- It asked for the F353 journal fix in place instead of only noting it here: done.
- It said the 63-byte cut should come after the trim. The pinned Go source cuts `end` to 63 before it trims, and so
  does the port, so I made no change.

## Tried and failed
- A `find /` for the dnsname source ran past the time limit; the module cache is at
  `~/.cache/ifizbox/tailscale/gopath/pkg/mod` (build.sh's `GOMODCACHE`).

## Not verified
- The ported rule against Tailscale itself for anything but the two names seen on the admin page
  (`ifizbox-on-iphone-3`, `ifizbox-on-iphone192`): it follows the Go source line by line, but I did not run the Go
  function here (the Go toolchain lives in the tailscale build cache; a Go test was not worth adding for a test helper).
- The control server can add its own suffix (`-1`, `-2`) when a name is taken; the helper doesn't model that.
