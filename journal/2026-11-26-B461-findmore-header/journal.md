# B461 Find More header over ADD buttons

Added z-index 0 to the ADD/ADDED buttons and z-index 2 to the section header above Find More rows (web/app/sources.css), plus a CSS test.

**Not verified**: not seen in a browser or on a phone; the cause of the overdraw was not reproduced (the old stacking looked correct on paper), so this is a defensive fix.
