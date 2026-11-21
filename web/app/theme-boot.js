// Before first paint (a classic script in <head>, not a module): put the stored Theme settings on <html data-theme>
// (the tone) and <html data-palette> (that tone's theme, F198) so a dark page never flashes light, or grey. F199: Mode
// (ifizbox.appearance) picks the tone, ifizbox.lightTheme and ifizbox.darkTheme the theme in each. Same rule as
// core/settings.js themeState(); screens/settings.js applyTheme() takes over once the app runs.
(function () {
  var a = null, l = null, d = null, s = null;
  try {
    s = localStorage.getItem("ifizbox.style"); // F201: the era, iOS 6 unless iOS 7 is chosen
    a = localStorage.getItem("ifizbox.appearance");
    l = localStorage.getItem("ifizbox.lightTheme");
    d = localStorage.getItem("ifizbox.darkTheme");
  } catch (e) { /* private mode */ }
  // Mode: Light or Dark when chosen; anything else (nothing stored, or Automatic, the default) follows the iPhone.
  var dark = a === "dark" || (a !== "light" && !!window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  // A reload on Theme > Light or Theme > Dark shows that list's preview (screens/settings.js previewOf).
  var m = /^#\/(?:home\/)?settings\/(?:(?:theme|display)\/)?(lightTheme|darkTheme)\/?$/.exec((window.location && window.location.hash) || "");
  // F201: iOS 7 has its own two themes (core/settings.js STYLE_PALETTES) and no theme lists to preview.
  // F202: iOS 13 the same, and its card sheets (STYLE_HOOKS; its large titles wait for the app's nav/navbar.js).
  // F203: iOS 26 the same as iOS 13, plus its floating tab bar (nav/tabbar.js setFloatingTabbar), set here so the
  // bars don't move after first paint.
  var era = s === "ios7" || s === "ios13" || s === "ios26" ? s : "ios6";
  var own = era !== "ios6"; // an era with its own White / OLED Black pair
  if (m && !own) dark = m[1] === "darkTheme";
  var root = document.documentElement;
  root.setAttribute("data-style", era);
  if (era === "ios13" || era === "ios26") root.setAttribute("data-sheet", "card");
  if (era === "ios26") root.setAttribute("data-tabbar", "float");
  // F345a: the native controls hook, as native-controls.js drawsIos26Controls() (which corrects it in the app once
  // app.info answers): iOS 26's form controls are WebKit's own only on an iPhone or iPad whose WebKit is 26 or later,
  // by Safari's Version/ or else by anchor positioning (first in WebKit 26).
  if (era === "ios26") {
    var nav = window.navigator || {}, ua = nav.userAgent || "", ver = /\bVersion\/(\d+)/.exec(ua);
    var onIos = /\b(iPhone|iPad|iPod)\b/.test(ua) || (/\bMacintosh\b/.test(ua) && (nav.maxTouchPoints || 0) > 1);
    var css = window.CSS, f26 = false;
    try { f26 = !!(css && css.supports && css.supports("anchor-name: --a")); } catch (e) { /* no CSS.supports */ }
    if (onIos && (ver ? Number(ver[1]) >= 26 : f26)) root.setAttribute("data-controls", "native");
  }
  root.setAttribute("data-theme", dark ? "dark" : "light");
  // Each tone's themes, in core/settings.js's order, and the default (its `default`: Gunmetal, Classic): a new theme
  // adds its name here, beside its ios6.css or palettes.css block (F200), and its top-bar colour below.
  var darks = ["oled", "gunmetal", "midnight", "linen", "nord", "dracula", "leather", "felt", "wood"],
    lights = ["classic", "sepia", "solarized", "legalpad", "metal"];
  var palette = own ? (dark ? "oled" : "white")
    : dark ? (darks.indexOf(d) >= 0 ? d : "gunmetal") : (lights.indexOf(l) >= 0 ? l : "classic");
  root.setAttribute("data-palette", palette);
  // The browser's top bar too (screens/settings.js THEME_COLORS): index.html's meta says light until now.
  var color = { classic: "#4f698b", oled: "#000", gunmetal: "#5f656f", midnight: "#0a1424", linen: "#000",
    nord: "#2e3440", dracula: "#21222c", sepia: "#7a5c36", solarized: "#2a74a8",
    leather: "#4a2e1a", felt: "#6a4220", wood: "#42270f", legalpad: "#5a3218", metal: "#9aa0a9", white: "#f7f7f7" }[palette];
  var metas = document.querySelectorAll('meta[name="theme-color"]:not([media])');
  for (var i = 0; i < metas.length; i++) metas[i].setAttribute("content", color);
})();

// Rotation fix for the Home Screen app (iOS 15, iPhone 7, opaque status bar): back in portrait after landscape, its view
// comes back screen-tall (667pt) but still 20pt below the status bar, so its bottom hangs off the screen. clientHeight
// says 667 while only innerHeight (647) shows: the tab bar was cut off and the whole page, nav bar too, scrolled natively.
// A reload doesn't cure it and a see-through status bar is worse (a black band at launch). So: lift the bottom by the
// gap (--vgap, in style.css --safe-bottom), keep html to the visible height and the document at the top.
(function () {
  if (!(window.navigator && navigator.standalone)) return;
  var de = document.documentElement, gap = 0;
  function fit() {
    gap = innerWidth < innerHeight ? Math.max(0, de.clientHeight - innerHeight) : 0;
    de.style.setProperty("--vgap", gap + "px");
    de.style.height = gap ? innerHeight + "px" : "";
    if (gap && scrollY) scrollTo(0, 0);
  }
  fit();
  addEventListener("resize", fit);
  addEventListener("orientationchange", function () { setTimeout(fit, 500); });
  addEventListener("scroll", function () { if (gap && scrollY) scrollTo(0, 0); });
})();
