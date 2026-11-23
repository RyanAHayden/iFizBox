# B331 Lite info popup wording

- `web/app/screens/home.js` `versionLimits('sideload')`: dropped "• update itself (reinstall it instead)"
  (Lite updates itself now) and changed "• install tweaks or themes" to "• install system-wide tweaks or
  themes" (Lite adds tweaks to apps). The Web message is unchanged.
- `web/app/screens/home.test.js`: the test checked the old "update itself" line; it now checks the new
  tweaks line and that "update itself" is gone.
- Grepped `web/`, `tests/`, `tools/` for both old strings: no other test used them.
- `node --test web/app`: 3232 pass.

**Not verified**
- The popup on a phone: a wording-only change to a string the test covers; no device check needed.
