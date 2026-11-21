# D26: alerts row in docs/eras.md "Native controls"

Added an Alerts row to the "What it swaps" table in `docs/eras.md`. Checked each claim against the code:
`web/app/nav/alert.js` (`wantsNativeAlert`: bridge present, no countdown, no `onTap`, `data-controls="native"`;
falls back to the CSS alert when the call fails, e.g. an older shell) and `native/Sources/NativeAlerts.swift`
(cancel index -> `.cancel`, red -> `.destructive`, first green -> `preferredAction`, one `addTextField`).

Nothing failed.

**Not verified**: none (docs only; no rendering beyond the markdown table).
