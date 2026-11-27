# B495 merge versioned names

entryKey in core/altparse.js now uses baseName(): a trailing (..)/[..] holding a version number is dropped for the key. Merged apps sort versions newest first (dotted compare) and take the newest entry's base name. "(Duplicate)" and "(Duplicate, iOS 15)" stay separate. Tests: web/app/core/altparse.test.js; node --test web/app/core passes.

**Not verified**: none (real Alan source not fetched).
