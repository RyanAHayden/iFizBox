# Eras

iOS 6 is the base style. An era is another iOS look (iOS 7, iOS 13, iOS 26) over the same markup, chosen by
`<html data-style="ios7">` (or `ios13`, `ios26`) and drawn by one stylesheet, `web/app/ios<N>.css`, loaded after
`ios6.css`. This page says what makes an era clean, how the look is split from the layout so it can be, and what is
clean today.

## Definition of clean

An era is clean when all of these hold:

1. **One stylesheet plus named hooks.** Everything the era changes is in `web/app/ios<N>.css`: token values, hook
   values and look-only rules. No other file gains an `html[data-style=…]` selector, except a named hook in `nav/`
   that the era turns on (large titles, a floating tab bar, card sheets), listed under [Hooks](#hooks).
2. **Zero layout overrides.** No rule in the era sets a layout property. Geometry it needs to change (a cell's height,
   a group's inset, a bar button's padding) moves only through the hooks in `style.css`. A look rule in the era may
   restyle any look property of an iOS 6 rule.
3. **A test that fails if a look rule sets layout.** `web/app/ios6-css.test.js` holds it:
   - every era stylesheet (`web/app/ios<N>.css` other than `ios6.css`) contains only look properties and custom
     properties;
   - every look-only stretch in any `web/app/*.css` (below) contains only look properties;
   - the nav bar, bar button, tab bar and grouped table selectors have no rule in `ios6.css` outside a look-only
     stretch, with or without an `html[…]` qualifier in front;
   - `ios6.css` sets no layout at all and holds no `@keyframes` or `@media` (motion and reduced motion are
     `style.css`'s); every rule outside its look-only stretches is `body` or a token block (`:root` or `html[…]`
     setting only custom properties and `color-scheme`);
   - no rule in `ios6.css` writes a decoration itself: no `gradient(` or `url()` art in a value (the Share button's
     glyph is the one `url()`, an icon), and `text-shadow` (the emboss), `filter` and `border-image` are only
     `var(…)`, `none` or (`filter`) `brightness(…)`. The values live in custom properties, so an era swaps them
     instead of undoing them.
4. **No visible change in iOS 6.** Splitting a component for eras keeps every pixel and every computed style of the
   iOS 6 page: check it with a 3x screenshot and computed-style diff against main
   (`journal/2026-11-20-c44-era-readiness/shots.mjs` then `diff.py`, both themes and every palette).

An era is ready to build when the components it restyles meet 1 to 4. [What is clean today](#what-is-clean-today)
lists the ones that do.

### Look and layout

Look is what paints: `color`, `background*`, `border*` (including radius, image and width), `box-shadow`,
`text-shadow`, `filter`, `backdrop-filter`, `-webkit-box-reflect`, `opacity`, `mask*`, `outline*`, `font*`, `line-height`,
`letter-spacing`, `word-spacing`, `text-align`, `text-transform`, `text-decoration*`, `caret-color`,
`color-scheme`, `content`, `fill`, `stroke*`, `list-style*`, `appearance` (and `-webkit-appearance`: it hands a
control's paint to the browser, "Native controls" below). The test's `LOOK` pattern is the list.

Everything else is layout: the box (`display`, size, `margin`, `padding`, `box-sizing`), position (`position`,
insets, `z-index`, `transform`), flex and grid, `overflow`, wrapping and truncation (`white-space`, `text-overflow`,
`overflow-wrap`), and behaviour (`cursor`, `touch-action`, `pointer-events`, `user-select`, `will-change`,
transitions and animations). Type sizes, line heights and border widths count as look on purpose: an era's
titles, labels and hairlines are its own. With `box-sizing: border-box` everywhere they don't resize a box that has
a fixed size. They do resize a box sized by its content (a group header, a label, a table's outline), and that
change is part of the era's look. The test cannot tell those cases apart, so this is a choice and not something it
enforces.

Some geometry of the four components has no hook yet and stays fixed: the icon bar button's 43px, the cell icon's
29px, the cell count pill, the chevron's 9x13px box and the badge's offset over the tab icon. A hook goes in
`style.css` the first time an era needs to move one.

### Look-only stretches

A stylesheet marks the rules that only paint:

```css
/* ==== look-only { ==== what these rules paint */
.navbar { background: var(--nav-bar); }
/* ==== } look-only ==== */
```

Stretches do not nest and are always closed. For the shared chrome (`ios6.css`), the layout of what a stretch paints
lives in `style.css`'s "Era hooks". A component stylesheet (`packages.css`, `sources.css`, …) keeps its layout in
its own rules beside its stretches.

## Tokenising, not overriding

A spike restyled the nav bar, tab bar, grouped tables and bar buttons as iOS 7 both ways
(`journal/2026-11-20-c44-era-readiness/`, renders in `spike-ios7-*.png`).

| | Overriding (era rules over today's `ios6.css`) | Tokenising (after the split) |
|---|---|---|
| Rules in the era | 42 | 12, all look-only |
| Declarations | 97 | 24, plus 85 token values |
| Layout declarations | 17 | 0 |
| Declarations undoing iOS 6 (`none`, `0`, `transparent`) | 46 | 4 |
| Specificity fights | dark and red bar buttons (`:not(.back):not(.done)`) need their own heavier rules | none: dark rules read the same tokens |

Overriding makes every era undo iOS 6 property by property, and every later iOS 6 change leaks into each era.
Tokenising puts iOS 6's decorations and geometry behind custom properties that an era sets, so the era is mostly two
token blocks. `@layer` would have let an era sit under iOS 6 without specificity work, but it needs Safari 15.4 and
the app supports iOS 15.0, so cascade layers are out.

## Writing an era

- **Hooks** (geometry) go on `html[data-style="ios7"]`: they are the same in both tones.
- **Colours and decorations** go on `html[data-style="ios7"][data-theme="light"]` and
  `html[data-style="ios7"][data-theme="dark"]`. A colour token on bare `html[data-style=…]` has the same specificity
  as `ios6.css`'s `html[data-theme="dark"]` block and comes later, so it wins in dark too.
- **Dark** keeps `ios6.css`'s dark rules, which paint with `--dk-*` tokens (`--dk-nav-bar`, `--dk-tabbar`,
  `--dk-btn`, `--dk-back`, …): the era sets those in its dark block, plus the shared tokens (`--table`, `--head`, …).
- **Palettes** set the same tokens from `html[data-theme][data-palette]` (the light ones map their `--lt-*` colours
  onto `--nav-bar`, `--bar-btn*`, `--bar-back*`, `--seg*`, `--search-*`, `--scope-seg*` and `--store-head*` in one
  `html[data-theme="light"]:is(…)` block), never heavier than html plus two attributes: the weight of an era's tone
  block, which wins because it is linked later (`palettes.test.js` holds both). So every token an era sets beats
  every palette, light or dark, and the era's dark block needs no extra weight. The tokens it does not set would
  still come from the palette, half-painting it, so **an era offers only its own themes** (White and OLED Black):
  the theme menu must hide the palettes while an era is chosen, and the app set no `data-palette` under it (a saved
  palette waits for iOS 6). One palette rule still paints chrome: Brushed Metal's etched text; with the
  palettes hidden it never meets an era.
- **Order**: link `ios<N>.css` after `palettes.css`; `wide.css` is layout and can stay last.

## Hooks

### Geometry (style.css, "Era hooks")

| Hook | iOS 6 | What it moves |
|---|---|---|
| `--bar-btn-h`, `--bar-btn-min-w`, `--bar-btn-pad` | 29px, 50px, 0 9px | a bordered bar button |
| `--bar-back-h`, `--bar-back-pad` | 30px, 0 5px 0 1px | the back button (its arrow is the border) |
| `--tab-item-h`, `--tab-item-margin`, `--tab-item-pad-top` | 44px, 3px 2px 0, 3.5px | a tab inside the 49 pt bar |
| `--tab-icon-size`, `--tab-label-gap` | 28px, 1px | the tab glyph and the space under it |
| `--badge-h`, `--badge-pad` | 20px, 0 5px | the red count badge |
| `--group-margin`, `--group-gap`, `--group-first-head` | 10px 10px 0, 23px, 10px | grouped tables: inset, space between, the first header |
| `--group-head-margin`, `--group-foot-margin` | 0 9px 7px, 7px 9px 0 | a group's header and footer |
| `--cell-min-h`, `--cell-pad`, `--cell-gap` | 43px, 0 10px, 8px | every table cell |
| `--row-icon-in`, `--row-icon-after` | -3px, 3px | a Settings row tile: its offset from the cell's padding, and what it adds to `--cell-gap` before the label |
| `--plain-cell-pad-y` | 4px | a plain table's cell, above and below |
| `--section-head-h`, `--section-head-pad` | 23px, 0 12px | a plain table's sticky section header |
| `--pair-h`, `--pair-gap` | 44px, 9px | two buttons in one row (the button pair) |
| `--seg-h`, `--seg-margin` | 30px, 10px 10px 0 | the segmented control |
| `--hud-w`, `--hud-pad` | 180px, 28px 12px 22px | the HUD |
| `--callout-h` | 38px | the menu callout and the queue hint |
| `--banner-pad` | 6px 12px 7px | the notification banner |
| `--spinner-turns` | hud-spin | the keyframes every spinner turns by: `hud-spin` holds 12 turns of 30 degrees, `hud-spin-8` holds 8 of 45 (iOS 13+'s 8 spokes) |
| `--undo-left`, `--undo-right`, `--undo-lift`, `--undo-h`, `--undo-pad` | 0px, 0px, 0px, 44px, 0 max(6px, safe area) 0 max(12px, safe area) | the undo bar: from the screen's sides, its gap over the tab bar (it slides that much further from behind it), its height and padding; iOS 13 floats it as a card, iOS 26 as a glass capsule |
| `--sw-w`, `--sw-h`, `--sw-knob-size`, `--sw-travel` | 77px, 27px, 27px, 50px | the switch's box, its knob and the knob's travel (`ios6.css`'s on `--x`; `nav/switch.js` reads it when a drag starts) |
| `--settings-seg-margin` | 0 | Settings > Theme's Mode, inside its group (`settings.css`) |
| `--home-inset`, `--home-tile-pad` | 10px, 0 10px 0 6px | Home's head and tile rows from the screen's sides, and a tile's padding (`home.css`) |
| `--action-sheet-pad`, `--action-sheet-pad-bottom` | 21px 21px, 22px | the action sheet's panel: its top and sides, and its bottom over the safe area (`packages.css`) |
| `--action-gap`, `--action-list-gap`, `--action-list-bleed` | 11px, 11px, 2px | between the sheet's title, choices and Cancel; between the choices; the room around the choices for iOS 6's button shadow |
| `--action-title-margin`, `--action-title-pad`, `--action-cancel-gap` | -6px 0 2px, 0, 14px | the sheet's title, and the extra space over Cancel |
| `--alert-w`, `--alert-pad` | 340px, 16px 12px 11px | the alert box (`sources.css`) |
| `--alert-buttons-margin`, `--alert-buttons-gap`, `--alert-stacked-gap`, `--alert-button-h` | 4px 0 0, 8px, 9px, 43px | the alert's button row (a negative side margin takes it to the box's edges), two side by side, stacked buttons, a button's height |
| `--share-layout` | grid | the share sheet's layout, read from the root element (`nav/sharesheet.js`): `grid` is iOS 6's activity sheet, `action` hands the items to the action sheet |
| `--share-row-icon`, `--share-row-radius`, `--share-row-glyph`, `--share-row-letter` | 29px, 6.5px, 20px, 16px | a share item's icon in an action sheet row (`--share-layout: action`): its size and corners, its glyph and its initial |
| `--share-row-gap`, `--share-row-pad`, `--share-row-dir`, `--share-row-justify` | 12px, 0 16px, row, flex-start | the same row: the gap to the label, its padding, which side the icon sits on, and how the row is justified |

A hook never reuses a look token's name (`ios6-css.test.js` checks the switch, Mode and Home hooks): the knob's size is
`--sw-knob-size` because `--sw-knob` is the knob's paint.

No hook yet, on purpose: the reload bar's 44pt, the share sheet's grid (its icons and pages; `--share-layout` picks
the grid or the action sheet, but nothing sizes the grid), the pull area and the placeholders.
`packages.css` and the other component stylesheets keep their layout in their own rules; only Home's, Theme's
Mode, the action sheet, the alert and the share sheet's action rows take the hooks above.

The bars' own heights (`--nav-h`, `--tab-h`) are layout that every screen depends on; an era that changes them
(large titles, a floating tab bar) does it through a nav hook, not by setting them.

### Look tokens (ios6.css)

- Nav bar: `--nav-bar`, `--nav-shadow`, `--nav-title`, `--nav-title-emboss`, `--site-strip`; dark `--dk-nav-bar`,
  `--dk-nav-shadow`, `--dk-ground`.
- Bar buttons: `--bar-btn`, `--bar-btn-edge`, `--bar-btn-edge-top`, `--bar-btn-text`, `--bar-btn-emboss`,
  `--bar-btn-shadow`, `--bar-btn-pressed`, `--bar-btn-pressed-edge`, `--bar-btn-pressed-edge-top`, `--bar-back`,
  `--bar-back-pressed` (a border-image drawn in a 13px left, 5px right slot); red `--lt-red*`; dark `--dk-btn`,
  `--dk-btn-edge`, `--dk-btn-pressed`, `--dk-back`, `--dk-red*`.
- Tab bar: `--tabbar`, `--tabbar-shadow`, `--tab-text`, `--tab-text-active`, `--tab-active`, `--tab-active-edge`,
  `--tab-icon`, `--tab-icon-active`, `--tab-icon-emboss`, `--tab-icon-emboss-active`, the glyph per tab
  (`.tab[data-tab] { --glyph }`); badge `--badge`, `--badge-ring`, `--badge-shadow`; dark `--dk-tabbar`.
- Grouped tables: `--grouped-ground` (also pull to refresh's area on a grouped page), `--table`, `--table-edge`,
  `--table-inset`, `--divider`, `--divider-hi`, `--head`, `--emboss`, `--text`, `--subtitle`, `--detail`, `--count`,
  `--chevron`, `--select`; a selected row's white chevron `--chevron-pressed`.
- Plain tables: section header `--section-head-text`, `--section-head-emboss` (its bar is `--category`).
- Button pair: `--pair-delete`, `--pair-delete-pressed`, `--pair-delete-text`, `--pair-delete-emboss`,
  `--pair-delete-edge`, `--pair-delete-edge-bottom`, `--pair-delete-shadow`, `--pair-delete-shadow-dark`.
- Switch: `--sw-edge`, `--sw-edge-on`, `--sw-track`, `--sw-on`, `--sw-on-label` ("ON"), `--sw-on-text`,
  `--sw-on-emboss`, `--sw-off-label` ("OFF"), `--sw-off-text`, `--sw-knob`, `--sw-knob-held`, `--sw-knob-edge`,
  `--sw-knob-edge-bottom`, `--sw-track-shadow-dark`.
- Segmented control: `--seg`, `--seg-edge`, `--seg-shadow`, `--seg-divider`, `--seg-text`, `--seg-emboss`,
  `--seg-pressed`, `--seg-selected`, `--seg-selected-text`, `--seg-selected-emboss`, `--seg-selected-edge`.
- HUD: `--hud`, `--hud-text`, `--hud-emboss`, `--hud-check`; scroll indicator `--scroll-thumb`, `--scroll-thumb-ring`.
- Menu callout: `--menu`, `--menu-drop`, `--menu-edge`, `--menu-shine`, `--menu-text`, `--menu-emboss`,
  `--menu-divider`, `--menu-divider-hi`, `--menu-pressed`, `--menu-arrow`, `--menu-arrow-below`; queue hint
  `--callout`, `--callout-drop`, `--callout-edge`, `--callout-text`, `--callout-emboss`, `--callout-arrow`.
- Signing rows: `--field-caret`, `--field-ring`, `--field-active`, `--pw-right`, `--pw-wrong`.
- Banner: `--banner`, `--banner-shadow`, `--banner-edge`, `--banner-icon-shadow`, `--banner-emboss`,
  `--banner-title`, `--banner-text`, `--banner-timer`.
- Share sheet: `--share-dim`, `--share-sheet`, `--share-sheet-shadow`, `--share-icon-shadow`, `--share-system`,
  `--share-system-metal`, `--share-system-shine`, `--share-system-glyph-emboss`, `--share-glyph-copy`,
  `--share-glyph-qr`, `--share-app-gloss`, `--share-app-shine`, `--share-letter`, `--share-letter-emboss`,
  `--share-pressed`, `--share-label`, `--share-label-emboss`, `--share-dot`, `--share-dot-on`, `--share-cancel`,
  `--share-cancel-edge`, `--share-cancel-shadow`, `--share-cancel-text`, `--share-cancel-emboss`,
  `--share-cancel-stroke`, `--share-cancel-pressed`, `--share-line-copy`, `--share-line-qr` (the grey line-art Copy
  and QR glyphs the eras set `--share-glyph-copy` and `--share-glyph-qr` to); the nav bar's Share glyph `--bar-glyph-emboss`.
- Reload bar `--reload-bar`, `--reload-text`, `--reload-emboss`; undo bar `--undo-bar`, `--undo-text`,
  `--undo-emboss`.
- Pull to refresh: `--pull-arrow`, `--pull-text`, `--pull-emboss`, `--pull-emboss-dark`.
- Placeholders `--placeholder` (dark `--dk-placeholder`); locked tab `--tab-lock` (the padlock), `--tab-locked` (the
  dimming).

The `…-dark` tokens hold the decorations `ios6.css`'s dark rules draw that are the same in every dark palette (the
sunken switch track, the delete button's shadow, the pull text's emboss); the dark rules' colours stay `--dk-*`.
Flat colours and corner radii are still literal in some rules (a held row's white text, the badge's): an era
restyles those with a look rule of its own.

### Look tokens (packages.css)

`packages.css` opens with a `:root` of iOS 6's decorations (its own look-only stretch); each of its sections keeps
their layout in plain rules and paint in a look-only stretch after them.

- Search bar: `--search-bar`, `--search-bar-scoped`, the field `--search-field` (white plus the magnifier),
  `--search-field-edge`, `--search-field-edge-top`, `--search-field-shadow`, `--search-text`, `--search-hint`, the
  clear button `--search-clear`, Cancel `--search-cancel`, `--search-cancel-pressed`, `--search-cancel-edge`,
  `--search-cancel-edge-top`, `--search-cancel-edge-bottom`, `--search-cancel-text`, `--search-cancel-emboss`,
  `--search-cancel-shadow`.
- Scope bar: `--search-scope`, segments `--scope-seg`, `--scope-seg-edge`, `--scope-seg-edge-top`,
  `--scope-seg-edge-bottom`, `--scope-seg-divider`, `--scope-seg-text`, `--scope-seg-emboss`, `--scope-seg-shadow`,
  selected `--scope-seg-selected`, `--scope-seg-selected-edge`, `--scope-seg-selected-edge-top`,
  `--scope-seg-selected-edge-bottom`, `--scope-seg-selected-divider`; dark `--scope-seg-dark-selected-edge`,
  `--scope-seg-dark-divider`.
- Filter: its Done `--scope-done`, `--scope-done-pressed`, `--scope-done-edge`, `--scope-done-edge-top`; the panel
  `--filter-ground`, `--filter-shadow`.
- Action sheet: `--action-dim`, `--action-sheet`, `--action-title`, `--action-title-emboss`, `--action-btn`,
  `--action-btn-text`, `--action-btn-emboss`, `--action-btn-edge`, `--action-btn-shadow`, `--action-btn-pressed`,
  `--action-btn-pressed-text`, `--action-btn-pressed-emboss`, `--action-destructive`, `--action-destructive-text`,
  `--action-destructive-emboss`, `--action-cancel`, `--action-cancel-pressed`, `--action-cancel-text`,
  `--action-cancel-emboss`; dark `--dk-action-sheet`, `--dk-action-btn`, `--dk-action-cancel`.
- Store header: `--store-head`, `--store-head-edge`, `--store-head-emboss`.
- Sheets (`nav/sheet.js`) paint with `--plain` and their bar is a `.navbar`, so the nav bar's tokens restyle them;
  card sheets are the [nav hook](#nav-hooks) below.
- Reflections: the store icon's and Browse hero icon's `-webkit-box-reflect` sit in packages.css's look-only
  stretches; an era drops them with `-webkit-box-reflect: none`.

### Nav hooks

iOS 13 and iOS 26 need three, each off in iOS 6:

- **large titles**: `<html data-nav="large">`, set by the era's JS through `nav/navbar.js` `setLargeTitles(true)`.
  Each tab's root page draws its title as a 34px bold left `.large-title` at the top of its body, which scrolls with
  the content; as it goes under the nav bar it fades out and the bar's `.nav-title` fades in (from half way).
  Opacity only, once a frame. Pushed pages and
  pages whose title is a control keep the bar title. Hooks in `style.css`: `--large-title-h` (52px, also the
  collapse distance) and `--large-title-pad` (3px 16px 8px); its type is look an era may restyle on `.large-title`;
- **floating tab bar**: `<html data-tabbar="float">`, set by the era's JS through `nav/tabbar.js`
  `setFloatingTabbar(true)`. The tab bar becomes a pill inset from the screen's sides and bottom, and the Search tab
  (`FLOAT_OWN_TAB`) leaves the tabs' row to sit as its own slot to the pill's right, as tall as the pill; the screens
  scroll under both. `--tab-h` becomes the pill's height plus its gap to the bottom, so every scroller's end room
  and the bars that sit on the tab bar (reload, undo, Filter, Theme's preview) follow. Layout only, same markup.
  Hooks in `style.css`: `--tabbar-float-h` (62px, the pill's height and the circle's size), `--tabbar-float-pad`
  (4px, inside the pill), `--tabbar-float-inset` (21px, from the sides), `--tabbar-float-gap` (10px, pill to circle)
  and `--tabbar-float-bottom` (safe bottom − 13px, at least 12px). The pill's and the circle's paint (round corners,
  glass, their own ground on `.tab[data-tab="search"]`) is the era's look. The app draws its own UITabBar (this one
  is hidden there), so the hook moves the website's bar only;
- **card sheets**: `<html data-sheet="card">`, set by the era's JS when it is chosen. A modal sheet (`nav/sheet.js`)
  stops below the status bar as a card with rounded top corners, and the page behind it (the nav bar, the screens
  and the tab bar) scales back about the screen's centre and dims onto the black ground. It comes back when the
  last card sheet closes. Transform and opacity only. Hooks, with their card values from `packages.css` (an era may
  set its own on `html[data-style=…][data-sheet="card"]`):

  | Hook | iOS 6 | Card | What it moves |
  |---|---|---|---|
  | `--sheet-top` | 0px | safe top + 10px | the gap above the sheet |
  | `--sheet-bar-top` | safe top | 0px | the status bar's room inside the sheet's bar |
  | `--sheet-radius` (look) | 0px | 10px | the sheet's top corners |
  | `--sheet-behind-scale`, `--sheet-behind-shift`, `--sheet-behind-opacity` | not used | 0.92, 0, 0.75 | the page behind (shift in px, down) |

In iOS 6 a sheet is clipped (`clip-path: inset(var(--sheet-bar-top) 0 0 0)`, packages.css) to below the page's own black status-bar strip, which stays still while the sheet slides under it.

### Native controls

iOS 26 adds a fourth hook: `<html data-controls="native">`, set only under `data-style="ios26"` and only where the
web view draws iOS 26's own form controls. Under it the page hands those controls to WebKit; without it the same
markup gets `ios26.css`'s look-alikes.

- **When it is on** (`native-controls.js` `drawsIos26Controls()`; `theme-boot.js` runs the same rule before first
  paint): in the app, the shell's `app.info` `ios` is 26 or later; on an iPhone or iPad (an iPad asking for the
  desktop page counts) whose user agent has Safari's `Version/`, that version is 26 or later; otherwise, on an
  iPhone or iPad, CSS anchor positioning is supported (first in WebKit 26). A web view's user agent freezes the OS
  version (the iPhone 15 Pro on iOS 27 says `iPhone OS 18_7`), so the app's first paint uses the feature test and
  `app.info` corrects it. Desktop browsers never get it. A change after first paint (Theme > Style, the app's
  answer) redraws the switches on screen in the other kind (`nav/switch.js` `redrawSwitches`).
- **What it swaps** (look in `ios26.css`, `appearance: auto` with the page's paint reverted; sizes unchanged):

  | Control | Under the hook | Without it |
  |---|---|---|
  | Search bar field (`nav/searchbar.js`) | WebKit's capsule and magnifier, 17pt, no focus ring; `packages.css` drops the drawn magnifier's room | the CSS capsule, magnifier and clear |
  | Text fields in cells | plain borderless inputs | the same, styled by the era |
  | Switches (`nav/switch.js` `createSwitch`) | `<input type=checkbox switch>`, WebKit's switch, in `--sw-w` x `--sw-h` (71 x 31, WebKit's own box) | the button art, in the same box |
  | Fixed-choice menus | a real `<select>`: iOS 26's pull-down button and its glass menu | (none built yet) |
  | The run page's bar (`nav/progress.js`) | `<progress class="progress-bar">` | the drawn track and fill |
  | Alerts (`nav/alert.js` `showAlert`), in the app only | the shell's `UIAlertController` (bridge call `ui.alert`, `native/Sources/NativeAlerts.swift`): the cancel button is the cancel action, red buttons are destructive, the green one is the preferred action, at most one text field; `input.paste` is dropped (the field has Paste in its own menu), but with `input.pasteSubmits` (Sources' Add) the field's own Paste puts the trimmed text in the field and answers for that button, as the CSS alert's Paste does; `input.paste` then turns the text into the value, and text it can't use opens the alert again with it in the field. A countdown alert and one with `onTap` keep the CSS alert | the CSS alert (`.alert`, "Overlays" below); so does the site, and a shell without `ui.alert` |
  | Action sheets and menus opened from a button or a row (`showActionSheet` in `nav/actionsheet.js`, `showMenu` in `nav/menu.js`), in the app only | The shell's `UIMenu` out of that button (bridge call `ui.menu`, with `sheet: true` for a sheet; `native/Sources/NativeMenus.swift`), with the items' icons; a sheet with no source is the shell's `UIAlertController` sheet (`ui.actionSheet`) | The CSS sheet or anchored menu (`.action-menu`, "Overlays" below); so does the site, and a shell without `ui.menu` |

  | The scope bar pinned under the search bar (`nav/ui.js` `segments` inside `nav/searchbar.js` `pinned`), in the app only | the shell's `UISegmentedControl` (bridge call `ui.segments`, `native/Sources/NativeSegments.swift`) laid over the CSS bar's rect, which turns see-through while it shows; hidden while a slide runs or one of the page's own popups or pages covers the bar, closed when its page leaves; a tap calls the page's `onPick`. A scope bar inside a scroller keeps the CSS bar | the CSS bar; so does the site, and a shell without `ui.segments` |

  `appearance` (and `-webkit-appearance`) is look: it is in the test's `LOOK` list.

### Overlays (nav/)

The overlays `nav/` draws build markup with the classes below and nothing else: no colour, SVG art or inline style
that paints comes from their JS (inline styles left are geometry and motion: a menu's position, a banner's drag, a
row's swipe offset). Their art is CSS, so an era restyles an overlay by setting its tokens or writing look rules
against these classes. The classes and states are the hooks: keep them when an overlay's markup changes.

| Overlay | JS | Classes and states | Look today |
|---|---|---|---|
| Alert | `alert.js` | `.alert-scrim`, `.alert`, `.alert-title`, `.alert-message`, `.alert-field`, `.alert-field-row`, `.alert-paste`, `.alert-buttons` (`.stacked`), `.alert-button` (`.cancel`, `.green`, `.red`) | `sources.css`, literal |
| Action sheet | `actionsheet.js` | `.action-scrim`, `.action-dim`, `.action-sheet`, `.action-title`, `.action-list`, `.action-button` (`.destructive`, `.cancel`); iOS 26's anchored menu (a sheet opened from a button): `.action-menu-scrim`, `.action-menu`, `.action-menu-room` | `packages.css`, tokens: `--action-*`; dark `--dk-action-sheet`, `--dk-action-btn`, `--dk-action-cancel`; the menu: `ios26.css`, `--i26-menu`, `--i26-menu-pressed`, `--i26-menu-dim` |
| Share sheet | `sharesheet.js` | `.share-scrim`, `.share-dim`, `.share-sheet`, `.share-pages`, `.share-grid`, `.share-item`, `.share-icon` (`.system`, `.app`, `.has-image`), `.share-glyph` (`.glyph-copy`, `.glyph-qr`), `.share-letter`, `.share-image`, `.share-label`, `.share-dots` (`span.on`), `.share-cancel`; the nav bar's `.share-button`. Under `--share-layout: action` it is the action sheet: `.action-button.has-icon`, its `.action-icon` (with `.share-icon`) and `.action-label` | `ios6.css`, tokens: `--share-*`, the glyphs `--share-glyph-copy`, `--share-glyph-qr`; an app's own colour comes in `--share-tint` |
| HUD | `hud.js` | `.hud-scrim`, `.hud`, `.hud-spinner`, `.hud-label`, `.hud-check` | `ios6.css`, tokens: `--hud`, `--hud-text`, `--hud-emboss`, `--spinner-large`, `--hud-check` (the checkmark's art) |
| Spinners | `spinner.js` | `.hud-spinner`, `.reload-spinner`, `.pull-spinner`, `.badge.spinning`, `.source-row.is-loading`, `.loading-spinner`, `.bar-button.is-reloading` | tokens `--spinner-white`, `--spinner-gray`, `--spinner-large` in `ios6.css` and again in `ios7.css`, `ios13.css` and `ios26.css`, each era's own; the hook `--spinner-turns` (`style.css`: `hud-spin`, 30 degrees a turn, or `hud-spin-8`, 45) |
| Reload bar | `reloadbar.js` | `.reload-bar`, `.reload-spinner`, `.reload-text`, `.reload-cancel` (a `.bar-button.done`) | `ios6.css`, tokens: `--reload-bar`, `--reload-text`, `--reload-emboss` |
| Section index | `sectionindex.js` | `.section-index` (`.held`), its letters (`.section-index span`) | `packages.css`, literal |
| Row swipe | `rowswipe.js` | `.row-swipe` (`.armed`, `.hint`, `.swiping`, `[data-kind="add"|"remove"|"cancel"]`), `.row-swipe-control` | `packages.css`, literal |
| Banner | `banner.js` | `.banner`, `.banner-icon`, `.banner-text`, `.banner-action` (a `.bar-button.done`), `.banner-timer` | `ios6.css`, tokens: `--banner*` |
| Undo bar | `undobar.js` | `.undo-bar` (`.shown`), `.undo-bar-text`, `.undo-bar-button` (a `.bar-button.done`) | `ios6.css`, tokens: `--undo-bar`, `--undo-text`, `--undo-emboss` |
| Menu | `menu.js` | `.menu` (`.below`), `.menu-items`, `.menu-item` (`.is-held`), `.menu-arrow` | `ios6.css`, tokens: `--menu*` |
| Placeholders | `ui.js` `placeholder()` | `.ph` (`.ph-list`, `.ph-page`), `.ph-head`, `.ph-lines`, `.ph-box` (`.ph-icon`, `.ph-icon-lg`), `.ph-bar` (`.ph-sub`, widths `.ph-w30`…`.ph-w70`) | `ios6.css`, tokens `--placeholder`, `--dk-placeholder` |
| Built-in lock | `lock.js` | `.name-lock`, `.source-lock`, `.lock-icon` | `sources.css`, token `--lock-icon` (the padlock's art) |
| Row icon tint | `ui.js` | `.cell-icon` | `ios6.css`, tokens `--cell-icon`, `--cell-icon-text`; a row's own colour (`icon.color`) comes in `--cell-icon-tint` |

`spinner.js` is not loaded by the app: it generates every era's spinner tokens (`spinnerURL(kind, era)`), and
`spinner.test.js` keeps each stylesheet's data URLs the same as it. An era draws its own spinner by setting those
tokens in its stylesheet:

- iOS 6 (`ios6.css`): 12 chunky spokes, five fading behind the brightest and the rest at one floor, measured from the
  4S's UIKit frames. Lists take the white one on the dark theme.
- iOS 7 (`ios7.css`): 12 thinner, shorter spokes whose tail fades all the way round; the grey one is `#8e8e93`. The
  dark theme takes the white one, as in iOS 6.
- iOS 13 and iOS 26 (`ios13.css`, `ios26.css`, the same images): 8 thicker, rounder spokes from Apple's iOS 27 UI
  Kit, in secondaryLabel (its dark value on the dark theme), white on the red tab badge and in the HUD. They set
  `--spinner-turns: hud-spin-8`, so they turn 45 degrees at a time. An era can't set `animation-name` itself (that
  counts as layout), so this hook is how it changes the turn.

Home's Reload button takes the grey spinner in iOS 7, 13 and 26, since their bars are light.
"Literal" means the look rules still hold their iOS 6 colours: an era restyles them with look rules of its own until
that sheet's cleanup turns them into tokens.

## What is clean today

Clean:

- all of `ios6.css`: the nav bar (bar, shadow, title, status-bar strip), bar buttons (bordered, back, red, the Share
  glyph), the tab bar (bar, tabs, glyph fills, badge) and grouped tables with their cells; and the switch, plain
  tables and section header, button pair, HUD, menu callout, queue hint, signing rows, banner, share sheet, reload
  bar, segmented control, undo bar, pull to refresh, placeholders and locked tab. Its layout is in `style.css`
  (geometry an era moves through [the hooks](#geometry-stylecss-era-hooks)), its paint in look-only stretches and
  its decorations in the [tokens](#look-tokens-ios6css);
- `packages.css`: the search bar, scope bar, Filter, action sheet, store header and sheets, and every other section
  (package rows, Sections, the package page, Browse, …) split into layout rules and a look-only stretch, with the
  decorations in its [tokens](#look-tokens-packagescss). Some of its colours and glyphs (the section index, the row
  swipe control) are still literal look rules.

Split, with their layout in their own rules and their paint in look-only stretches: `sources.css`, `home.css` and
`settings.css`. Their iOS 6 decorations are tokens an era sets:

- the Done bar button: `--done-btn`, `--done-btn-edge`, `--done-btn-edge-top`, `--done-btn-pressed` (`:root`);
- Home's tiles: `--tile`, `--tile-edge`, `--tile-radius`, `--tile-green`, `--tile-glyph-green`, `--tile-purple*`,
  `--by`, `--home-icon-shadow`, on `.home` (so an era sets them on `html[data-style=…] .home`);
- Theme's preview: `--preview-ground`, `--preview-shadow`, `--preview-grip` (the grabber's layers, from
  `--preview-grip-l`, `-r`, `-bar`), `--preview-grip-edge`, `--preview-grip-radius` (`:root`).

Their other colours (the alert, Delete, trust pills, Find More, the certificate tile, the status tiles) are still
literal look rules: an era restyles them with look rules of its own.

Split the same way, the small stylesheets. Each keeps its layout in its own rules, paints in the look-only stretches
below, and opens its first stretch with a `:root` of the iOS 6 decorations it draws (gradients, glosses, gloss edges,
shadows, embosses):

| Sheet | Look-only stretches | Tokens |
|---|---|---|
| `altstore.css` | header, news cards and screenshots; More Permissions and the website's greyed Install row; the toggles' glyphs; the gallery's spinner and the Too Big alert | `--alt-id-shade`, `--alt-icon-shadow`, `--alt-name-emboss`, `--alt-glyph-emboss`, `--alert-btn-blue`, `--alert-btn-blue-edge`, `--alert-btn-blue-pressed` |
| `progress.css` | the log's lines and jump button; the foot (status, bar, finish button); the queue run's segmented control; its rows, bars, stop and summary | `--progress-finish`, `--progress-finish-ring`, `--progress-finish-emboss`, `--progress-finish-pressed`, `--progress-finish-pressed-emboss`, `--progress-finish-text`, `--progress-track`, `--progress-track-edge`, `--progress-fill`, `--progress-seg`, `--progress-seg-text`, `--progress-seg-selected`, `--progress-seg-edge`, `--progress-seg-divider`, `--progress-seg-shadow`, `--progress-seg-emboss`, `--qr-bar`, `--qr-fill` |
| `reviews.css` | the stars and Tap to Rate; Write a Review / More Reviews, the hidden note, Report; the Write a Review sheet; the App Store view's card | `--review-star-emboss`, `--review-btn`, `--review-btn-edge`, `--review-btn-emboss`, `--review-btn-pressed` |
| `guides.css` | the answer text, steps and number badges; the terminal panel and its Copy button; the warning row, Copying Files' rows and glyphs | `--guide-num`, `--guide-num-edge`, `--guide-num-emboss`, `--guide-num-shine`, `--guide-done`, `--guide-done-edge`, `--guide-copy`, `--guide-copy-emboss`, `--guide-copy-pressed` |
| `freeid.css` | the checklist's marks, fields and buttons; Developer Mode's step heads and badges | `--free-done`, `--free-done-edge`, `--free-failed`, `--free-failed-edge`, `--free-optional` |
| `myipas.css` | the list's icons and lines, the File row, Delete; Install IPAs' fades, picks and New note; the price button | `--price-btn`, `--price-btn-edge`, `--price-btn-emboss`, `--price-btn-pressed`, `--price-btn-pressed-inset`, `--price-btn-go`, `--price-btn-go-edge`, `--price-btn-go-edge-top`, `--price-btn-go-emboss`, `--price-btn-go-pressed`, `--price-btn-fill` |
| `signing.css` | the walkthrough's cards, badges, text and buttons; the certificate step's picture | `--walk-badge`, `--walk-badge-edge`, `--walk-badge-emboss`, `--walk-badge-shine`, `--walk-badge-done`, `--walk-badge-done-edge`, `--walk-badge-todo`, `--walk-action`, `--walk-action-edge`, `--walk-action-emboss`, `--walk-action-pressed` |
| `signsheet.css` | the sign sheet's head, field rows and red Cancel; Settings > Signing's warnings and Signed Apps' rows | `--ss-icon-shadow`, `--ss-icon-placeholder`, `--ss-icon-letter-emboss`, `--ss-cancel`, `--ss-cancel-edge`, `--ss-cancel-emboss`, `--ss-cancel-pressed` |
| `extras.css` | the featured banners and their titles | `--featured-title-emboss`, `--featured-title-shade` |
| `queue.css` | queued packages in every list; Confirm's sections and the console; Continue Queuing, "needed by", the queue run's strip | `--console-bar`, `--console-btn`, `--console-btn-edge`, `--console-btn-pressed` |
| `tweaks.css` | the tweak rows, the ADD button, the pills | myipas.css's `--price-btn*` (all but `-go-pressed` and `-fill`, same values), `--tweak-pill`, `--tweak-pill-up`, `--tweak-pill-shadow` |
| `notiphone.css` | the hero, the domain, the steps' text | `--notiphone-icon-shadow` |
| `account.css` | the account key | none |
| `manage.css` | the grabber, the dragged row, the foot's links; Import's rows and the QR sheet | `--manage-grabber`, `--manage-drag-shadow` |

`tweaks.css` and `myipas.css` both define the price button's tokens, so either can load without the other; an era
sets them once for both. Their plain colours, the glyphs and badges drawn as SVG data URIs, and `freeid.css`'s
pictures of today's iOS (`--dm-*`, modern iOS in every style on purpose) are still literal look rules: an era
restyles them with look rules of its own.

Tokens in a lazily loaded sheet (`signing.css`, `signsheet.css`, `myipas.css`, `freeid.css`, `tweaks.css`, and
`settings.css`'s preview tokens; `nav/motion.js` `loadStyle`) come after any era sheet linked in `index.html`, so
their `:root` blocks win over an era's bare `:root`. An era sets them on `html[data-style="…"][data-theme="…"]`,
the way it sets colours, never on bare `:root`.

The light palettes in `palettes.css` paint the chrome through tokens: their shared `html[data-theme="light"]` block
maps the `--lt-*` colours onto `ios6.css`'s `--nav-bar`, `--bar-btn*`, `--bar-back*`, `--seg*` and `packages.css`'s
`--search-*`, `--scope-seg*`, `--store-head*` (see Palettes under [Writing an era](#writing-an-era)). Brushed
Metal's etched text stays a rule on purpose: its dark text skips Done, the red button, My IPAs' Delete and the
console, which one token cannot.

The screens' inline SVG art comes from the icon map below; the overlays `nav/` draws take theirs from CSS tokens
([Overlays](#overlays-nav)).

## Icon map

Every SVG a screen draws from JS comes from one map, `ICON_SETS` in `web/app/icons/rowicons.js`, keyed by style and
then by kind and icon name. iOS 6's set is `ICON_SETS.ios6`:

| Kind | Keyed by | What it draws | Read through |
|---|---|---|---|
| `rows` | icon name -> `[tile colour, glyph]` | the 29pt row tiles (Settings, Manage, Account, Why, …) | `rowIcon(name)`, `tileSvg(name)` |
| `glyphs` | glyph name -> paths | the white glyph on a row tile, 24 units | through `rows` |
| `tile` | | the row tile's size, corners and glyph size | through `rows` |
| `guides` | name -> `[light, colour, body]` | Copying Files' app and computer tiles | `guideSvg(name)` |
| `home` | name -> `{ colour, gradient, svg }` | Home tiles a screen paints in its own CSS (Why) | `homeTileCss(name)` |
| `tabs` | tab -> SVG | the tab bar's glyphs, the `--glyph` token of `.tab[data-tab]` | `tabGlyphTokens(style)` |

An era adds `ICON_SETS.ios<N>` with only what it redraws (outline or filled glyphs, a tile shape, other colours):
anything it leaves out falls back to iOS 6's entry, per name. The functions read the style from
`<html data-style>` (`iconStyle()`), or take it as their last argument. The tab glyphs stay CSS tokens, in the stylesheet with the
rest of a style's look: `ios6.css` holds `tabGlyphTokens("ios6")` and an era's stylesheet holds
`tabGlyphTokens("ios<N>")`, and `rowicons.test.js` fails when either drifts from the map. The same test fails if a
screen (`why.js`, `notiphone.js`, `manage.js`, `handoff.js`, `guides.js`, `account.js`) gains an inline SVG of its
own. QR codes (`core/qr.js`) are data, not art, and stay out of the map.
