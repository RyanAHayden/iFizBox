# F423: default tweak sources without YTLite and SCInsta

Removed both from web/app/tweak-sources.json, YTLitePlus from APP_SOURCE_DIRECTORY, fixed docs/sideload.md and the
Find App Sources count test (>= 4), added a test that the defaults leave them out, and a release note.
`node --test web/`: 3595 pass.

**Not verified**: none
