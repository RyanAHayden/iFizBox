# B422 one Log of everything

Removed page.filter(id) from showLog and the Apps segment in web/app/screens/apprun.js; fixed header comment; test asserts no filter and Log view. node --test apprun.test.js passes (22).

**Not verified**: Chromium with two apps interleaving (no filter code remains; the page.filter(null) default is unchanged in nav/progress.js).
