# F378 Confirm sheet: Refresh Sources row for unreadable list files

- deps.js: explainApt's `lists` problems for an apt list file (and the bare "could not be parsed" summary) carry
  `action: { kind: "refresh", label: "Refresh Sources" }`; dpkg's status file gets none, since Refresh doesn't fix it.
- queue.js actionRow: `refresh` closes Confirm and runs Changes' `reloadSources` (Reloading Data HUD, lists reloaded).
- deps.test.js asserts the action on each case.

**Not verified**: the row on a device or in Chromium (actionRow is not exported and has no DOM test; the 15 has no
broken list file to show Cannot Comply). Checked by reading the code and the deps tests only.
