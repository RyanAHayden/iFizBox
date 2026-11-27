# F450a: depiction ratings as the Rating sort's fallback

Done: core/catalog.js `depictionUrls(ids)` op (id + http(s) SileoDepiction URL); core/ratingsort.js `depictionStars`,
`withDepiction`; catalog.js fetches unrated rows' depictions (cap 100 a list, 4 at a time, kept per session,
4 s wait) for the Rating sort and Popular (Popular ranks a 200-row candidate list, then re-ranks with the stars).
Unit test added to ratingsort.test.js.

**Not verified**: the Chromium check (a depiction-only package sorting among the rated) was not run; only node tests and the gate.
