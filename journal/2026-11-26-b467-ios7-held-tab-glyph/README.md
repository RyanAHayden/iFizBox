# B467 iOS 7 held tab shows the filled glyph

Added `.tab[data-tab=X].is-pressed` beside each `.active` glyph rule in web/app/ios7.css (six tabs), so a held tab matches the chosen look. New test in web/app/press-hitbox.test.js checks every `.active` glyph has its `.is-pressed` twin.

**Not verified**: the Chromium probe (journal/2026-11-26-b465-tab-pressed/probe.mjs, STYLE=ios7) was not run; only the CSS unit test was. Selectors are a direct copy of the `.active` ones.
