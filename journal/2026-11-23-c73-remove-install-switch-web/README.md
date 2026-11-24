# C73: remove the Install Switch and Cellular Shortcuts from the web

**Did**
- core/installroute.js: removed the Shortcut names and links, the switch*/shortcutsAdded/cellularWarning helpers,
  the cellular, Update, Later and "VPN stays off" alerts, switchFailed and leftOffAlert. decideRoute now only
  chooses server or This iPhone. Added `otherVPNOn` and `OTHER_VPN_LINE`: Set Up's footer adds "Your VPN goes off
  during installs. Turn it back on after." when another VPN is up or chosen. On cellular only the failure words
  stay ("On cellular, join Wi-Fi.").
- screens/installroute.js: no Install Switch row, no installation/shortcuts page, no Add/Update/Test, no offers.
  Home: no cellular or Update tile. apprun, signing/route, incoming, app.js: no switch_failed alert, no leftOff watch.
- Deleted web/app/shortcuts/, tools/shortcuts/, five test files that only tested it; trimmed the rest; removed
  GONE_NATIVE from native/test_bridge_contract.py. Docs and glossary updated.
- `shot.mjs` here: Chromium shots of Set Up and Home (Wi-Fi, another VPN up, cellular). None mentions Shortcuts.

**Checks**: `node --test web/` passes (3466).

**Not verified**: the phone itself (the 15 Pro); only the fake-bridge Chromium pages were checked. The source.json
release notes of old versions still name the Install Switch (history, left as written).
