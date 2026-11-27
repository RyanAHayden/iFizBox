# B487: Browse lists' Filter button pressed look

- Checked a 3x Chromium press (CDP forced `:active` and a real mouse press in the real app, Browse > Popular) in iOS 6
  light, dark, Brushed Metal, and iOS 7 / 13 / 26 light and dark: an unselected Filter already takes the same pressed
  look as a segment (`.scope-filter:active` shares the segments' rule). No bug there.
- The gap found: a Filter that is on (`.selected`) already wears the pressed art, so holding it changed nothing.
  Fixed in `web/app/packages.css`: `.scope-filter.selected:active` darkens it (iOS 6 light and dark).

**Not verified**
- iOS 7 / 13 / 26: a selected Filter held shows no change there (their `.selected` rule follows their `:active` rule in
  ios7.css / ios13.css / ios26.css, outside this task's files). Not fixed.
- Real iPhone touch: only Chromium mouse and forced `:active` were used.
