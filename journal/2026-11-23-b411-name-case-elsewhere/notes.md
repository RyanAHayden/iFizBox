# B411: package names ignore case in the queue run, blocks, the daemon and the badge

apt and dpkg write names in lower case (oreo); a source may say Oreo.

- `core/installrun.js`: the queued and row maps are `IdMap`, so Depends: Oreo finds the row oreo (order, needed by,
  skipped).
- `core/settings.js` blocked: has, name, set, heldByBlock and the kept block holds use `sameId`. A block keeps the
  spelling it was made with; unblocking removes every spelling and lifts the block's own dpkg hold.
- `native/daemon/auto.c`: marked, hold and dpkg's holds match ignoring case. Before, a marked Oreo was not picked.
  `auto_ignored` (Ignore This Version) changed too: otherwise a marked Oreo, now picked, would install a version the
  user ignored. The state file's "failed" lines stay exact: the daemon writes them from apt's own names.
- `screens/changes.js` badgeAfterRun: the done set is an `IdSet`.

Tests: installrun, blocked and badge-after-update node tests; `native/daemon/test_auto.py` test_pick.

## Not verified
- On a jailbroken phone: no package with capitals was installed, held or updated there; only the node and host-built
  daemon tests ran.
- The web side of Update Automatically and Ignore This Version still compares exactly (filed as a follow-up).
