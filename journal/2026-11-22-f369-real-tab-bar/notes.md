# F369 Glass bars: a real UITabBar and UIKit glass bar buttons (iOS 26 style, iOS 26+)

## What changed

- `native/Sources/NativeGlass.swift` (ui.glass): the F367 UIGlassEffect pill and circle laid over the page's tab bar
  are gone. The tab bar is now a real `UITabBarController` (class `NativeTabs`), a child of the web view's controller
  with its view inside the glass bars' overlay over the web view:
  - one `UITab` per page tab, Search as the `UISearchTab` (its title and image set to ours, so no system glyph);
  - glyphs: template PNGs the page draws once from `icons/rowicons.js` (`tabsOutline` for the tabs, `tabsSelected`
    as `selectedImage` on iOS 26.1+);
  - badges: `badgeValue` from the page's `setBadge` (the Sources spinner becomes "" = a dot);
  - taps: `tabBarController(_:shouldSelectTab:)` emits `{tap: "tab:<id>"}`, the page clicks its own tab, so
    `tapTab` runs (switch, back to the root, to the top, Search's reselect). The page owns the selection: after a tap
    it resends its state even if nothing changed, so a tab it doesn't switch to puts the bar back.
  - shrink on scroll: `tabBarMinimizeBehavior = .onScrollDown`, with the chosen tab's content scroll view set to the
    UIScrollView WebKit keeps for the page's `.page-body` (the frontmost one that scrolls and covers the screen's
    middle), picked again on each update and 0.4 s later. No per-frame bridge traffic.
  - its tab views are empty, clear and take no touches; the overlay's hitTest passes everything but the tab bar and
    the buttons through to the page.
  - hidden (animated) while a popup is up or a sheet covers the page's bar, as before.
- Nav bar buttons: kept F367's `UIButton` with `UIButton.Configuration.glass()` / `.prominentGlass()` at the page's
  button rects, titles and actions from the page (the brief allows "UIBarButtonItem / UIButton.Configuration.glass()").
- `web/app/nav/glass.js`: the tab bar part of the snapshot is now semantic (id, title, search, selected, icon keys,
  badge), no rects; tab glyphs drawn from rowicons SVGs into 26 pt PNGs.
- `web/app/icons/rowicons.js`: `tabsOutline` in the iOS 13/26 sets (iOS 7's outline tab glyphs at the era's tab
  weight, round caps and joins).
- `web/app/ios26.css`: under data-glass the page's hidden tabs take no touches.
- `native/test_web_bars.py` (outside the file list, needed): it forbade any UITabBarController in the shell (F354);
  now NativeGlass.swift is the one allowed place, and a new case checks it stays iOS 26-only behind ui.glass.

## Decisions

- Kept the tab bar controller as a child overlay rather than making it the window's root: `rootViewController.view
  as? WKWebView` is used in several places in App.swift, and moving the web view between tab views would risk
  reloads/flicker. The page stays the one web view under every tab.
- Unselected tabs outline, the chosen tab filled (iOS's own convention; F370 named `tabsSelected` for this).
