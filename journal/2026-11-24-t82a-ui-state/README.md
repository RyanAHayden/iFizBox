# T82a: state command for the phone tools

`tools/ui-15.sh state`, `ui-7.sh state`, `ui-4s.sh state`: exit 0 free, 75 busy (line 1 = holder's task ID),
69 missing (line 1 = why). Busy = the lock folder exists and its owner file was touched in the last 30 minutes (or
is missing); a lock past 30 minutes counts as free. Missing = ssh (7, 4S) or `ios list` (15) fails, each under
`timeout 10`. No lock taken, nothing written. Busy is checked first, so a busy answer needs no phone probe.

Test: tools/test_ui_state.py (fake lock folder via XDG_RUNTIME_DIR, fake ssh/ios on PATH): free, busy, missing, stale.

## Not verified
Real phones: never probed (fake commands only).
