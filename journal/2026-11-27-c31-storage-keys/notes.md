# C31 Storage keys in one module

Added web/app/core/storagekeys.js (`KEYS`, `KEY_PREFIXES`, `PREFIX`) and core/storagekeys.test.js. Every `ifizbox.*`
literal in web/app and worker/src now comes from it, including the keys settings.js builds from its own prefix and
the key screens/why.js builds from NAME. Key values are unchanged, so nothing stored on a device moves. The Symbol
description "ifizbox.loggedBridge" became "loggedBridge" (it is not a storage key). module-graph.test.js's startup
bound went from 120 to 121 for the one new module.

Left as literals:
- theme-boot.js: a classic script, so it can't import; the test checks its four keys against the module.
- tools/concept/frame.html and tools/smoke/smoke.mjs: tooling outside the app, not scanned by the test.
- Test files.
- Swift UserDefaults keys in native/: native's own keys, not the web app's storage.
- Setting keys built as PREFIX + setting id stay built that way.

Exports: took the second option (kept `export`, explained in docs/audit.md) instead of removing it from the ~220
names in ~80 modules. Removing it has no run-time effect, and the wide diff would collide with other tasks.

Checks:
- `node --test web/app`: 3852 passed, 0 failed.
- Every worker/test*.mjs passed.
- Full gate (tools/check.sh) runs at `done`.
- Tried and failed: the first run failed module-graph's "under 120 modules" check (120 loaded). Raised to 121.

Not verified: no browser or phone run. Only constant names moved and the values are the same; node tests cover the
module graph and import cycles. theme-boot.js is unchanged.
