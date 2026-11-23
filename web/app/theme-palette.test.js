// F198: the dark palettes; F320: Gunmetal is the default (OLED Black stays first in the list). <html data-palette> beside data-theme;
// every dark rule paints with palette tokens, so each palette repaints all of them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { themeFor, paletteFor, themeState, createSettings, DARK_PALETTES, LIGHT_PALETTES } from "./core/settings.js";
import { STYLES, hooksOf, setPhoneIos } from "./core/settings.js"; // F202
setPhoneIos("26.0"); // C70: the iOS 26 style needs an iOS 26 phone
import { applyTheme, settings, THEME_COLORS } from "./screens/settings.js";

const here = new URL(".", import.meta.url);
const read = (f) => readFileSync(new URL(f, here), "utf8");
const mem = (init) => {
  const m = new Map(Object.entries(init).filter(([, v]) => v != null));
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

test("paletteFor: classic in light; Gunmetal in dark unless another is chosen (F320)", () => {
  assert.deepEqual(DARK_PALETTES, ["oled", "gunmetal", "midnight", "linen", "nord", "dracula", "leather", "felt", "wood"]);
  assert.equal(paletteFor("light", "gunmetal"), "classic");
  assert.equal(paletteFor("dark", null), "gunmetal");
  assert.equal(paletteFor("dark", "oled"), "oled");
  assert.equal(paletteFor("dark", "neon"), "gunmetal");
  assert.deepEqual(Object.keys(THEME_COLORS).sort(), [...LIGHT_PALETTES, ...DARK_PALETTES, "white"].sort()); // F200: one per theme; F201: iOS 7's White
  assert.deepEqual([THEME_COLORS.classic, THEME_COLORS.oled, THEME_COLORS.gunmetal], ["#4f698b", "#000", "#5f656f"]);
});

// theme-boot.js in a sandbox: what it puts on <html> before first paint for a stored Appearance and dark theme.
function boot({ appearance = null, lightTheme = null, darkTheme = null, systemDark = false, hash = "", style = null, withStyle = false, native = true } = {}) {
  const attrs = {};
  const meta = { attrs: { content: "#4f698b" }, setAttribute(k, v) { this.attrs[k] = v; } };
  const store = { "ifizbox.appearance": appearance, "ifizbox.lightTheme": lightTheme, "ifizbox.darkTheme": darkTheme, "ifizbox.style": style };
  const ctx = {
    ...(native ? { ifizboxNative: {} } : {}), // C69: the eras are the apps' (the shell's bridge); the website is iOS 6
    location: { hash },
    localStorage: { getItem: (k) => store[k] ?? null },
    navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15" }, // C70: iOS 26 needs WebKit 26's
    CSS: { supports: () => true },
    matchMedia: () => ({ matches: systemDark }),
    document: {
      documentElement: { setAttribute: (k, v) => { attrs[k] = v; } },
      querySelectorAll: (q) => (q.startsWith('meta[name="theme-color"]') ? [meta] : []),
    },
  };
  ctx.window = ctx;
  runInNewContext(read("theme-boot.js"), ctx);
  const out = { theme: attrs["data-theme"], palette: attrs["data-palette"], color: meta.attrs.content };
  return withStyle ? { ...out, style: attrs["data-style"], ...(attrs["data-sheet"] ? { sheet: attrs["data-sheet"] } : {}),
    ...(attrs["data-tabbar"] ? { tabbar: attrs["data-tabbar"] } : {}) } : out; // F203
}

test("theme-boot.js agrees with themeFor and paletteFor for every Appearance, dark theme and system", () => {
  for (const appearance of [null, "auto", "light", "dark"]) {
    for (const darkTheme of [null, "oled", "gunmetal"]) {
      for (const systemDark of [false, true]) {
        const theme = themeFor(appearance ?? "auto", systemDark); // F320: nothing stored is Automatic
        const palette = paletteFor(theme, darkTheme);
        assert.deepEqual(boot({ appearance, darkTheme, systemDark }), { theme, palette, color: THEME_COLORS[palette] },
          JSON.stringify({ appearance, darkTheme, systemDark }));
      }
    }
  }
  assert.deepEqual(boot({ appearance: "dark" }), { theme: "dark", palette: "gunmetal", color: "#5f656f" });
  // F320: a fresh install follows the iPhone: Gunmetal while it is dark, Classic while it is light
  assert.deepEqual(boot({ systemDark: true }), { theme: "dark", palette: "gunmetal", color: "#5f656f" });
  assert.deepEqual(boot({ systemDark: false }), { theme: "light", palette: "classic", color: "#4f698b" });
  // a stored choice stays as it is
  assert.deepEqual(boot({ appearance: "light", systemDark: true }), { theme: "light", palette: "classic", color: "#4f698b" });
  assert.deepEqual(boot({ appearance: "dark", darkTheme: "oled" }), { theme: "dark", palette: "oled", color: "#000" });
});

test("applyTheme: data-palette and a black theme-color for OLED Black, Gunmetal when chosen", () => {
  const metas = [];
  const doc = { documentElement: { dataset: {} }, querySelectorAll: () => metas };
  const meta = (media = "") => ({ media, content: "", cloneNode() { return meta(this.media); }, replaceWith(f) { metas[metas.indexOf(this)] = f; } });
  metas.push(meta(), meta("(prefers-color-scheme: light)"));
  const win = (dark, hash = "") => ({ matchMedia: () => ({ matches: dark }), location: { hash } });
  const was = [settings.get("appearance"), settings.get("darkTheme")];
  try {
    settings.set("appearance", "dark");
    settings.set("darkTheme", "oled"); // F199: Theme > Dark
    applyTheme(doc, win(false));
    assert.equal(doc.documentElement.dataset.palette, "oled");
    assert.deepEqual(metas.map((m) => m.content), ["#000", "#000"]);
    settings.set("darkTheme", "gunmetal");
    applyTheme(doc, win(false));
    assert.equal(doc.documentElement.dataset.palette, "gunmetal");
    assert.deepEqual(metas.map((m) => m.content), ["#5f656f", "#5f656f"]);
    settings.set("darkTheme", "oled");
    // F199: Theme > Dark's list previews dark in Light mode; Theme > Light's previews light in Dark mode
    settings.set("appearance", "light");
    applyTheme(doc, win(false, "#/home/settings/theme/darkTheme"));
    assert.deepEqual([doc.documentElement.dataset.theme, doc.documentElement.dataset.palette], ["dark", "oled"]);
    assert.deepEqual(metas.map((m) => m.content), ["#000", "#000"]);
    applyTheme(doc, win(false, "#/home/settings/theme"));
    assert.deepEqual([doc.documentElement.dataset.theme, doc.documentElement.dataset.palette], ["light", "classic"]);
    settings.set("appearance", "dark");
    applyTheme(doc, win(false, "#/home/settings/theme/lightTheme"));
    assert.deepEqual([doc.documentElement.dataset.theme, doc.documentElement.dataset.palette], ["light", "classic"]);
    settings.set("appearance", "auto"); // the bare meta takes what shows; one with a media query its own scheme's
    applyTheme(doc, win(true));
    assert.deepEqual([doc.documentElement.dataset.theme, doc.documentElement.dataset.palette], ["dark", "oled"]);
    assert.deepEqual(metas.map((m) => m.content), ["#000", "#4f698b"]);
    settings.set("appearance", "light");
    applyTheme(doc, win(true));
    assert.equal(doc.documentElement.dataset.palette, "classic");
  } finally { settings.set("appearance", was[0]); settings.set("darkTheme", was[1]); }
});

// F199: every combination of Mode, light theme, dark theme, system and preview, through the one rule (themeState),
// theme-boot.js before first paint, and the settings store's own stored values.
test("F199: themeState, theme-boot.js and the store agree for every Mode, theme pair, system and preview", () => {
  const lights = [null, "classic", "sepia", "solarized", "legalpad", "metal", "neon"];
  const darks = [null, "oled", "gunmetal", "midnight", "linen", "nord", "dracula", "leather", "felt", "wood", "neon"];
  const previews = [[null, ""], ["light", "#/home/settings/theme/lightTheme"], ["dark", "#/home/settings/theme/darkTheme"]];
  for (const appearance of [null, "auto", "light", "dark", "bogus"]) {
    for (const lightTheme of lights) for (const darkTheme of darks) for (const systemDark of [false, true]) for (const [preview, hash] of previews) {
      const store = createSettings({ storage: mem({ "ifizbox.appearance": appearance, "ifizbox.lightTheme": lightTheme, "ifizbox.darkTheme": darkTheme }) });
      const got = themeState({ appearance: store.get("appearance"), lightTheme: store.get("lightTheme"), darkTheme: store.get("darkTheme"), preview }, systemDark);
      const tone = preview ?? (appearance === "dark" || (appearance !== "light" && systemDark) ? "dark" : "light");
      const known = (list, v) => (v && v !== "neon" ? v : list);
      const want = { theme: tone, palette: tone === "dark" ? known("gunmetal", darkTheme) : known("classic", lightTheme) };
      const what = JSON.stringify({ appearance, lightTheme, darkTheme, systemDark, preview });
      assert.deepEqual(got, { ...want, style: "ios6" }, what);
      assert.deepEqual(boot({ appearance, lightTheme, darkTheme, systemDark, hash }), { ...want, color: THEME_COLORS[want.palette] }, what);
    }
  }
  assert.deepEqual(LIGHT_PALETTES, ["classic", "sepia", "solarized", "legalpad", "metal"]);
});

// F201: iOS 7 has its own two themes, White and OLED Black: the theme picks and the lists' previews don't change it,
// and theme-boot.js agrees with themeState for every stored Style, Mode, system and preview.
test("F201: iOS 7's White and OLED Black, the same in themeState and theme-boot.js", () => {
  const previews = [[null, ""], ["light", "#/home/settings/theme/lightTheme"], ["dark", "#/home/settings/theme/darkTheme"]];
  for (const style of [null, "ios6", "ios7", "ios99"]) for (const appearance of [null, "auto", "light", "dark"])
    for (const systemDark of [false, true]) for (const [preview, hash] of previews) {
      const store = createSettings({ storage: mem({ "ifizbox.style": style, "ifizbox.appearance": appearance, "ifizbox.darkTheme": "nord", "ifizbox.lightTheme": "sepia" }), mode: "jailbreak" }); // C69: the eras are the apps'
      const got = themeState({ style: store.get("style"), appearance: store.get("appearance"), lightTheme: "sepia", darkTheme: "nord", preview }, systemDark);
      const what = JSON.stringify({ style, appearance, systemDark, preview });
      if (style === "ios7") {
        const tone = appearance === "dark" || (appearance !== "light" && systemDark) ? "dark" : "light";
        assert.deepEqual(got, { theme: tone, palette: tone === "dark" ? "oled" : "white", style: "ios7" }, what);
      } else assert.equal(got.style, "ios6", what);
      assert.deepEqual(boot({ style, appearance, lightTheme: "sepia", darkTheme: "nord", systemDark, hash, withStyle: true }),
        { theme: got.theme, palette: got.palette, color: THEME_COLORS[got.palette], style: got.style }, what);
    }
  assert.equal(themeState({ style: "bogus", appearance: "light" }, false).style, "ios6");
});

// C69: the stylesheets in the order the apps load them: index.html's links, with era-css.js (which writes the three
// era links in the apps, none on the website) at its place in the head.
function pageStyles() {
  const eras = [...read("era-css.js").matchAll(/"(ios\d+\.css)"/g)].map((m) => m[1]);
  return [...read("index.html").matchAll(/<link rel="stylesheet" href="([^"]+)"|<script src="(era-css\.js)"/g)]
    .flatMap((m) => (m[2] ? eras : [m[1]]));
}

test("C69: the website is iOS 6: a stored era is ignored before first paint, and index.html links no era stylesheet", () => {
  for (const style of ["ios7", "ios13", "ios26"]) {
    assert.deepEqual(boot({ style, appearance: "dark", native: false, withStyle: true }),
      { theme: "dark", palette: "gunmetal", color: "#5f656f", style: "ios6" }, style);
  }
  assert.doesNotMatch(read("index.html"), /href="ios(7|13|26)\.css"/);
  assert.match(read("era-css.js"), /if \(!window\.ifizboxNative\) return;/);
});

// F201: ios7.css is linked after palettes.css (its tone blocks outrank the palette blocks they tie with) and before
// wide.css, and every rule in it is scoped to html[data-style="ios7"], so iOS 6 never sees it.
test("F201: ios7.css is linked after palettes.css and only styles html[data-style=ios7]", () => {
  const links = pageStyles();
  assert.ok(links.indexOf("ios7.css") > links.indexOf("palettes.css"));
  const css = read("ios7.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const sels = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());
  assert.ok(sels.length > 20);
  for (const sel of sels) for (const one of sel.split(/,(?![^(]*\))/)) assert.match(one.trim(), /^html\[data-style="ios7"\]/, one);
});

// F202: iOS 13 has the same pair as iOS 7 and turns on card sheets before first paint (its large titles wait for
// the app: nav/navbar.js draws them); themeState and theme-boot.js agree for every Mode, system and preview.
test("F202: iOS 13's White and OLED Black and its card sheets, the same in themeState and theme-boot.js", () => {
  const previews = [[null, ""], ["light", "#/home/settings/theme/lightTheme"], ["dark", "#/home/settings/theme/darkTheme"]];
  for (const appearance of [null, "auto", "light", "dark"]) for (const systemDark of [false, true]) for (const [preview, hash] of previews) {
    const store = createSettings({ storage: mem({ "ifizbox.style": "ios13", "ifizbox.appearance": appearance }), mode: "jailbreak" }); // C69: the eras are the apps'
    const got = themeState({ style: store.get("style"), appearance: store.get("appearance"), lightTheme: "sepia", darkTheme: "nord", preview }, systemDark);
    const tone = appearance === "dark" || (appearance !== "light" && systemDark) ? "dark" : "light";
    const what = JSON.stringify({ appearance, systemDark, preview });
    assert.deepEqual(got, { theme: tone, palette: tone === "dark" ? "oled" : "white", style: "ios13" }, what);
    assert.deepEqual(boot({ style: "ios13", appearance, lightTheme: "sepia", darkTheme: "nord", systemDark, hash, withStyle: true }),
      { theme: got.theme, palette: got.palette, color: THEME_COLORS[got.palette], style: "ios13", sheet: "card" }, what);
  }
  assert.deepEqual(STYLES, ["ios6", "ios7", "ios13", "ios26"]); // F203: iOS 26 the fourth
  assert.deepEqual([hooksOf("ios13"), hooksOf("ios7"), hooksOf("ios6")],
    [{ nav: "large", sheet: "card", tabbar: null }, { nav: null, sheet: null, tabbar: null }, { nav: null, sheet: null, tabbar: null }]);
});

// F202: ios13.css is linked after palettes.css and ios7.css, before wide.css, and every rule in it is scoped to
// html[data-style="ios13"], so iOS 6 and iOS 7 never see it; F370: its tab glyphs are its own (icons/rowicons.js).
test("F202: ios13.css is linked after palettes.css and only styles html[data-style=ios13]", () => {
  const links = pageStyles();
  assert.ok(links.indexOf("ios13.css") > links.indexOf("ios7.css"));
  assert.ok(links.indexOf("ios13.css") > links.indexOf("palettes.css"));
  assert.ok(links.indexOf("ios13.css") < links.indexOf("wide.css"));
  const css = read("ios13.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const sels = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());
  assert.ok(sels.length > 20);
  for (const sel of sels) for (const one of sel.split(/,(?![^(]*\))/)) assert.match(one.trim(), /^html\[data-style="ios13"\]/, one);
  // F370: its own filled tab glyphs, only on the tabs (rowicons.test.js checks them against the icon map)
  for (const m of css.matchAll(/([^{}]+)\{[^}]*--glyph:/g)) assert.match(m[1].trim(), /^html\[data-style="ios13"\] \.tab\[data-tab="\w+"\](\.active)?$/);
  // 120 Hz: nothing that animates or blurs
  assert.doesNotMatch(css, /transition|animation|backdrop-filter|will-change/);
});

// F203: iOS 26 has the same pair and turns on card sheets and the floating tab bar before first paint (its large
// titles wait for the app's nav/navbar.js); themeState and theme-boot.js agree for every Mode, system and preview.
test("F203: iOS 26's White and OLED Black, card sheets and floating tab bar, the same in themeState and theme-boot.js", () => {
  const previews = [[null, ""], ["light", "#/home/settings/theme/lightTheme"], ["dark", "#/home/settings/theme/darkTheme"]];
  for (const appearance of [null, "auto", "light", "dark"]) for (const systemDark of [false, true]) for (const [preview, hash] of previews) {
    const store = createSettings({ storage: mem({ "ifizbox.style": "ios26", "ifizbox.appearance": appearance }), mode: "jailbreak" }); // C69: the eras are the apps'
    const got = themeState({ style: store.get("style"), appearance: store.get("appearance"), lightTheme: "sepia", darkTheme: "nord", preview }, systemDark);
    const tone = appearance === "dark" || (appearance !== "light" && systemDark) ? "dark" : "light";
    const what = JSON.stringify({ appearance, systemDark, preview });
    assert.deepEqual(got, { theme: tone, palette: tone === "dark" ? "oled" : "white", style: "ios26" }, what);
    assert.deepEqual(boot({ style: "ios26", appearance, lightTheme: "sepia", darkTheme: "nord", systemDark, hash, withStyle: true }),
      { theme: got.theme, palette: got.palette, color: THEME_COLORS[got.palette], style: "ios26", sheet: "card", tabbar: "float" }, what);
  }
  assert.deepEqual(hooksOf("ios26"), { nav: "large", sheet: "card", tabbar: "float" });
  // the other eras leave the tab bar where iOS 6 has it
  for (const style of ["ios6", "ios7", "ios13"]) assert.equal(boot({ style, withStyle: true }).tabbar, undefined, style);
});

// F203: ios26.css is linked after ios13.css, before wide.css, every rule in it is scoped to html[data-style="ios26"],
// and its glass holds the frame budget: nothing animates, backdrop-filter only on the tab pill, the Search circle and
// the undo bar (where the page scrolls under them), the anchored menu (a still page under it) and only through the one --i26-glass-blur token per tone, the fallback's switch.
test("F203: ios26.css is linked after ios13.css, only styles html[data-style=ios26] and blurs only the tab bar and undo bar", () => {
  const links = pageStyles();
  assert.ok(links.indexOf("ios26.css") > links.indexOf("ios13.css"));
  assert.ok(links.indexOf("ios26.css") < links.indexOf("wide.css"));
  const css = read("ios26.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
  assert.ok(rules.length > 20);
  for (const [sel] of rules) for (const one of sel.split(/,(?![^(]*\))/)) assert.match(one.trim(), /^html\[data-style="ios26"\]/, one);
  assert.doesNotMatch(css, /transition|animation|will-change/);
  // F370: its own filled tab glyphs, only on the tabs (rowicons.test.js checks them against the icon map)
  for (const m of css.matchAll(/([^{}]+)\{[^}]*--glyph:/g)) assert.match(m[1].trim(), /^html\[data-style="ios26"\] \.tab\[data-tab="\w+"\](\.active)?$/);
  const blurring = rules.filter(([, body]) => /backdrop-filter/.test(body));
  assert.equal(blurring.length, 3); // B333: the undo bar floats over the content in the same glass
  for (const [sel, body] of blurring) {
    assert.match(sel, /\.tabbar|\.tab\[data-tab="search"\]|\.undo-bar$/, sel);
    for (const m of body.matchAll(/backdrop-filter:\s*([^;]+)/g)) assert.equal(m[1].trim(), "var(--i26-glass-blur)", sel);
  }
  // 22pt table corners, capsule bar buttons
  assert.match(css, /html\[data-style="ios26"\] \.table\.grouped \{[^}]*border-radius: 22px/);
  assert.match(css, /html\[data-style="ios26"\] \.bar-button \{[^}]*border-radius: 19px/);
});

// F325: the textured themes (Leather, Felt, Wood; Legal Pad, Brushed Metal): a texture drawn in CSS where Linen's
// weave goes, nothing that moves (120 Hz), and their nav bars keep the four layers the app's status strip stretches.
test("F325: the textured themes paint a still CSS texture and keep the nav bar's four layers", () => {
  const pal = read("palettes.css");
  const layers = (v) => { const out = []; let d = 0, cur = ""; for (const ch of v) { if (ch === "(") d++; if (ch === ")") d--; if (ch === "," && !d) { out.push(cur.trim()); cur = ""; } else cur += ch; } out.push(cur.trim()); return out; };
  for (const [tone, p, bar] of [["dark", "leather", "--dk-nav-bar"], ["dark", "felt", "--dk-nav-bar"], ["dark", "wood", "--dk-nav-bar"],
    ["light", "legalpad", "--lt-nav-bar"], ["light", "metal", "--lt-nav-bar"]]) {
    const sel = `html[data-theme="${tone}"][data-palette="${p}"] {`;
    const at = pal.indexOf(sel);
    assert.ok(at >= 0, p);
    const t = tokens(pal.slice(at, pal.indexOf("\n}", at)));
    assert.match(t.get("--weave") ?? "", /gradient\(/, `${p}: a CSS texture`);
    assert.doesNotMatch(t.get("--weave"), /url\(/, `${p}: no artwork`);
    assert.equal(layers(t.get(bar).replace(/\/\*[\s\S]*?\*\//g, "")).length, 4, `${p}: four nav bar layers`);
    assert.match(pal, new RegExp(`\\[data-palette="${p}"\\][^{]*\\.page-body\\.grouped`), `${p}: the texture on grouped pages`);
  }
  // the textures sit still: no keyframe animation in the palettes (transitions on other rules stay allowed)
  assert.doesNotMatch(pal.replace(/\/\*[\s\S]*?\*\//g, ""), /animation|@keyframes/, "no animated texture");
});

// ---- the stylesheets ----
const sheets = readdirSync(here).filter((f) => f.endsWith(".css")).map((f) => [f, read(f)]);
const ios6 = read("ios6.css");
const block = (selector) => {
  const at = ios6.indexOf(selector + " {");
  assert.ok(at >= 0, selector);
  return ios6.slice(at, ios6.indexOf("\n}", at));
};
const tokens = (css) => new Map([...css.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const oled = tokens(block('html[data-theme="dark"]'));
const gunmetal = tokens(block('html[data-theme="dark"][data-palette="gunmetal"]'));

test("OLED Black is the mockup's palette", () => {
  const want = { "--pin-dark": "#000", "--pin-light": "#000", "--table": "#0e0e0f", "--table-edge": "#1f1f22",
    "--divider": "#1c1c1f", "--divider-hi": "transparent", "--table-inset": "transparent", "--head": "#d6d6db",
    "--emboss": "none", "--text": "#fff", "--subtitle": "#8d8d93", "--detail": "#5fa2ff", "--dk-ground": "#000",
    "--dk-nav-shadow": "none", "--dk-btn-edge": "#000", "--dk-btn": "linear-gradient(#3a3a3e, #121214)" };
  for (const [k, v] of Object.entries(want)) assert.equal(oled.get(k), v, k);
  assert.match(oled.get("--chevron"), /%2355555b/);
  assert.match(oled.get("--dk-nav-bar"), /#333336, #151517 50%, #070708 51%, #000/);
  assert.match(oled.get("--dk-nav-bar"), /rgba\(255,255,255,\.16\)/);
  assert.match(oled.get("--dk-nav-bar"), /linear-gradient\(#1a1a1c, #1a1a1c\) bottom/);
  assert.match(oled.get("--dk-tabbar"), /^linear-gradient\(#1c1c1e, #1c1c1e\) top \/ 100% 1px no-repeat, #000$/);
});

test("Gunmetal keeps F13's colours and overrides only tokens OLED Black defines", () => {
  assert.equal(gunmetal.get("--table"), "#3b3f46");
  assert.equal(gunmetal.get("--dk-ground"), "#5f656f");
  assert.match(gunmetal.get("--dk-nav-bar"), /#5f656f, #3b4048 50%, #30343b 51%, #23262b/);
  for (const k of gunmetal.keys()) assert.ok(oled.has(k), `${k} is Gunmetal's only: OLED Black would keep the light value`);
});

test("every dark rule paints with tokens: no fixed colours but black and the kit's black action sheet", () => {
  const allowed = /^(#000|rgba\(0,0,0,[.\d]+\)|rgba\(255,255,255,\.(15|18)\))$/;
  for (const [file, css] of sheets) {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").split("}").map((r) => r.trim()).filter((r) => /data-theme="dark"/.test(r.split("{")[0]));
    for (const rule of rules) {
      const [sel, body = ""] = rule.split("{");
      // the palettes themselves, and an era's dark tone (F201: ios7.css's OLED Black block)
      if (/^html(\[data-style="ios\d+"\])?\[data-theme="dark"\](\[data-palette="\w+"\])?$/.test(sel.trim())) continue;
      if (/\.action-sheet|\.action-button/.test(sel)) continue; // UIAlertSheetBlack*: the kit's own black sheet
      if (/\.scope-filter\.done/.test(sel)) continue; // shared with light: the nav bar's blue Done
      if (/^html\[data-theme="dark"\] \.dm-shot$/.test(sel.trim())) continue; // F254i: a picture of iOS's own dark Settings
      for (const c of body.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) ?? []) {
        assert.match(c, allowed, `${file}: ${sel.trim()} has ${c}`);
      }
      for (const [, v] of body.matchAll(/var\((--dk-[\w-]+)\)/g)) assert.ok(oled.has(v), `${file}: ${v} is not a palette token`);
    }
  }
});
