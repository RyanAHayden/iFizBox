# B421 Copying says Installing at 100%

isCopying() in web/app/core/apprun.js: phase copying and fraction below 1. rowStatus, runStatus (one and several rows) use it; at 100% the row says Installing. The own row says closing only once phase is installing (selfClosing untouched). Test in apprun.test.js.

**Not verified**: on a phone (only node --test).
