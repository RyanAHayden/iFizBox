# B427b Restore My VPN footer

On: footer now reads "After installs your own VPN comes back once you open Settings > VPN." (the phone showed removing our configuration does not reconnect it, on demand or not). Changed core/installroute.js restoreFooter, the f372 test and docs/settings.md. Node test passes.

**Not verified**: the Chromium shot (footer text is a plain string, covered by the node test).
