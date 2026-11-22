// F205: the iOS 6 Settings row tiles (rowicons.js): every icon draws, the sizes are the 4S's, and every setting or
// page they name exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ROW_ICONS, GLYPHS, SETTING_ICONS, PAGE_ICONS, tileSvg, rowIcon } from "./rowicons.js";
import { SETTINGS, PAGES, SECTIONS } from "../core/settings.js";

test("every row icon has a colour and a glyph, and draws a 29pt tile with 6pt corners", () => {
  for (const [name, [colour, glyph]] of Object.entries(ROW_ICONS)) {
    assert.match(colour, /^#[0-9a-f]{6}$/, name);
    assert.ok(GLYPHS[glyph], `${name}: glyph ${glyph}`);
    const svg = tileSvg(name);
    assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="29" height="29" viewBox="0 0 29 29">/);
    assert.match(svg, /<rect width="29" height="29" rx="6" fill="#[0-9a-f]{6}"\/>/);
    assert.equal((svg.match(/<path /g) || []).length >= 1, true, name); 
    assert.doesNotMatch(svg, /NaN|undefined|Gradient/, name); // flat: no gloss
  }
  assert.throws(() => tileSvg("nope"));
});

test("rowIcon is a grouped() row icon: the tile as a data: picture, the same object text for the same name", () => {
  const a = rowIcon("general");
  assert.equal(a.cls, "row-icon");
  assert.ok(a.src.startsWith("data:image/svg+xml,%3Csvg"));
  assert.equal(decodeURIComponent(a.src.slice("data:image/svg+xml,".length)), tileSvg("general"));
  assert.equal(rowIcon("general").src, a.src);
});

test("SETTING_ICONS and PAGE_ICONS name real settings, pages and icons", () => {
  for (const [key, icon] of Object.entries(SETTING_ICONS)) {
    const d = SETTINGS.find((s) => s.key === key);
    assert.ok(d, key);
    assert.notEqual(d.kind, "choice", `${key}: a choice's options stay bare`);
    assert.ok(ROW_ICONS[icon], icon);
  }
  // every setting a row shows has a tile, except choices (their options are the rows) and Theme's (F199): Mode is a
  // segmented control with no row, and Themes' Light and Dark rows are its tones, bare as Appearance's options were
  // F285: nor a setting no SECTIONS group draws (selfUpdateAlerts sits among the bare Update Alerts rows)
  const bare = (d) => d.kind === "choice" || d.kind === "segmented" || d.tone || !SECTIONS.some((s) => s.id === d.section);
  for (const d of SETTINGS) if (d.modes.length && !bare(d)) assert.ok(SETTING_ICONS[d.key], d.key);
  for (const p of PAGES) assert.ok(ROW_ICONS[PAGE_ICONS[p.id]], p.id);
});

test("ios6.css places the tile as the 4S does: 7pt in, the label 11pt after", () => {
  const css = readFileSync(new URL("../ios6.css", import.meta.url), "utf8");
  const rule = css.match(/\.cell-icon\.row-icon \{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /background: none/);
  assert.match(rule, /box-shadow: none/);
  // C44: the layout is style.css's (its Era hooks): .cell-inner's 10px padding, 8px gap -> 7 and 11
  const layout = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(layout, /\.cell-icon\.row-icon \{ margin: 0 var\(--row-icon-after\) 0 var\(--row-icon-in\); \}/);
  assert.match(layout, /--row-icon-in: -3px; --row-icon-after: 3px;/); // F338: iOS 6's values of the era hooks
  assert.match(layout, /--cell-pad: 0 10px;/);
  assert.match(layout, /--cell-gap: 8px;/);
  assert.match(layout, /\.cell-inner \{[^}]*gap: var\(--cell-gap\);[^}]*padding: var\(--cell-pad\);/);
});

test("F223: Home's Settings row and Settings > General draw one gear, from this file", async () => {
  const { homeLinks, settingsIcon } = await import("../screens/home.js");
  const settingsRow = homeLinks()[0].rows.find((r) => r.label === "Settings");
  assert.equal(PAGE_ICONS.general, "general");
  assert.deepEqual(settingsRow.icon, rowIcon(PAGE_ICONS.general), "Home's Settings row is General's tile");
  assert.equal(settingsIcon().src, rowIcon("general").src);
  assert.equal(ROW_ICONS.general[1], "gear");
  const home = readFileSync(new URL("../home.css", import.meta.url), "utf8");
  assert.doesNotMatch(home, /\.glyph-settings/, "no second gear drawn in home.css");
});

// C51: the per-style icon map (docs/eras.md, "Icon map").
test("C51: ios6.css's tab glyph tokens are the map's iOS 6 tabs, as tabGlyphTokens prints them", async () => {
  const { ICON_SETS, tabGlyphTokens, cssSvgUrl } = await import("./rowicons.js");
  const css = readFileSync(new URL("../ios6.css", import.meta.url), "utf8");
  const inCss = {};
  for (const m of css.matchAll(/^\.tab\[data-tab="(\w+)"\]\s*\{ --glyph: (url\("[^"]*"\)); \}/gm)) inCss[m[1]] = m[2];
  const tabs = ICON_SETS.ios6.tabs;
  assert.deepEqual(Object.keys(inCss), Object.keys(tabs), "one ios6.css rule per tab in the map, in its order");
  for (const [tab, svg] of Object.entries(tabs)) assert.equal(inCss[tab], cssSvgUrl(svg), tab);
  // the same rules, ios6.css only lines the braces up
  assert.equal(tabGlyphTokens("ios6"),
    Object.entries(inCss).map(([tab, url]) => `.tab[data-tab="${tab}"] { --glyph: ${url}; }`).join("\n"));
});

test("C51: an era stylesheet carries the tab glyph tokens of its own set", async () => {
  const { ICON_SETS, tabGlyphTokens } = await import("./rowicons.js");
  for (const style of Object.keys(ICON_SETS)) {
    if (style === "ios6" || !ICON_SETS[style].tabs) continue;
    const css = readFileSync(new URL(`../${style}.css`, import.meta.url), "utf8");
    for (const line of tabGlyphTokens(style).split("\n")) assert.ok(css.includes(line), `${style}.css: ${line}`);
  }
});

test("C51: the page's data-style picks the set, and an era falls back to iOS 6 for what it leaves out", async () => {
  const { ICON_SETS, iconStyle, icon, tileSvg, rowIcon, guideSvg, homeTileCss } = await import("./rowicons.js");
  assert.equal(iconStyle({ documentElement: { dataset: {} } }), "ios6");
  assert.equal(iconStyle({ documentElement: { dataset: { style: "ios7" } } }), "ios7");
  assert.equal(iconStyle(undefined), "ios6");
  ICON_SETS.test = { rows: { general: ["#000000", "outline"] }, glyphs: { outline: [["s", "M2 2h20v20H2z", 1.5]] },
    tile: { radius: 7 } };
  try {
    assert.equal(icon("rows", "general", "test")[0], "#000000");
    assert.deepEqual(icon("rows", "theme", "test"), ICON_SETS.ios6.rows.theme, "left out: iOS 6's");
    assert.equal(icon("rows", "general", "nope"), ICON_SETS.ios6.rows.general, "an unknown style draws iOS 6");
    const svg = tileSvg("general", "test");
    assert.match(svg, /rx="7" fill="#000000"/);
    assert.match(svg, /stroke-width="1.5"/);
    assert.match(tileSvg("theme", "test"), /rx="7"/, "the era's tile shape, iOS 6's glyph");
    assert.notEqual(rowIcon("general", "test").src, rowIcon("general", "ios6").src, "cached per style");
    assert.equal(guideSvg("files", "test"), guideSvg("files", "ios6"));
    assert.equal(homeTileCss("why", "test"), homeTileCss("why", "ios6"));
  } finally {
    delete ICON_SETS.test;
  }
  assert.throws(() => guideSvg("nope"));
  assert.throws(() => homeTileCss("nope"));
});

test("C51: the screens draw no inline SVG of their own: their art comes from the map (QR codes from core/qr.js)", () => {
  for (const f of ["why", "notiphone", "manage", "handoff", "guides", "account"]) {
    const src = readFileSync(new URL(`../screens/${f}.js`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /<svg|%3Csvg|viewBox|<path /i, f);
  }
});

test("C51: Why's tile and Copying Files' tiles are the map's", async () => {
  const { homeTileCss, guideSvg, GUIDE_TILE_NAMES, ICON_SETS } = await import("./rowicons.js");
  const why = await import("../screens/why.js");
  assert.ok(why.whyCss("ios6").includes(`.home-glyph.glyph-why { ${homeTileCss("why", "ios6")}`));
  assert.match(homeTileCss("why", "ios6"), /^background-color: #d8820f; background-image: url\("data:image\/svg\+xml,%3Csvg [^"]*%3C\/svg%3E"\), linear-gradient\(#f4b03f, #d8820f\);$/);
  const guides = await import("../screens/guides.js");
  assert.deepEqual(guides.GLYPH_IDS, GUIDE_TILE_NAMES);
  for (const id of GUIDE_TILE_NAMES) {
    assert.equal(guides.glyphSvg(id), guideSvg(id, "ios6"), id);
    assert.equal(guides.glyph(id, "X").color, ICON_SETS.ios6.guides[id][1], id);
  }
});

// F332: iOS 7's set, after the Teehan+Lax iOS 7 kit (ref/teehanlax/ios7/sheet.svg).
test("F332: iOS 7 redraws every row tile: kit corners (6.5pt), iOS 7 colours, thin white line glyphs", async () => {
  const { ICON_SETS } = await import("./rowicons.js");
  const s7 = ICON_SETS.ios7;
  const palette = new Set(["#8e8e93", "#007aff", "#34aadc", "#4cd964", "#ff3b30", "#ff9500", "#5856d6", "#4a4a4f",
    "#5ac8fa", "#ffcc00", "#a2845e", "#ff2d55", "#c86edf"]);
  const { TO_C7 } = await import("./rowicons.js");
  assert.equal(Object.keys(TO_C7).length, 13, "iOS 6's 13 tile colours, each its own hex");
  assert.equal(new Set(Object.values(TO_C7)).size, 13, "and each its own iOS 7 colour");
  assert.deepEqual(Object.keys(s7.rows), Object.keys(ROW_ICONS), "every row has its iOS 7 tile");
  assert.deepEqual(Object.keys(s7.glyphs).sort(), Object.keys(GLYPHS).sort(), "every glyph redrawn");
  for (const [name, [colour, glyph]] of Object.entries(s7.rows)) {
    assert.ok(palette.has(colour), `${name}: ${colour}`);
    assert.equal(glyph, ROW_ICONS[name][1], `${name}: the same thing, the same glyph`);
    const svg = tileSvg(name, "ios7");
    assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="29" height="29" viewBox="0 0 29 29">/);
    assert.match(svg, new RegExp(`<rect width="29" height="29" rx="6.5" fill="${colour}"/>`), name);
    assert.doesNotMatch(svg, /NaN|undefined|Gradient/, name);
    assert.notEqual(svg, tileSvg(name, "ios6"), name);
    for (const m of svg.matchAll(/stroke-width="([\d.]+)"/g)) assert.ok(Number(m[1]) <= 2.2, `${name}: a thin line`);
    assert.ok(svg.includes("stroke=\"#fff\""), `${name}: drawn in lines`);
  }
  // 20pt across, centred: the 24 units scaled 20/24
  assert.match(tileSvg("general", "ios7"), /translate\(4\.5 4\.5\) scale\(0\.8333/);
});

test("F332: iOS 6's tiles are as they were", () => {
  assert.match(tileSvg("general", "ios6"), /rx="6" fill="#8c9097"/);
  assert.equal(rowIcon("general").src, rowIcon("general", "ios6").src);
});

test("F332: iOS 7's Copying Files and Why tiles are its own, flat", async () => {
  const { ICON_SETS, guideSvg, homeTileCss, GUIDE_TILE_NAMES } = await import("./rowicons.js");
  assert.deepEqual(Object.keys(ICON_SETS.ios7.guides), GUIDE_TILE_NAMES);
  for (const id of GUIDE_TILE_NAMES) {
    const svg = guideSvg(id, "ios7");
    assert.match(svg, new RegExp(`<rect width='58' height='58' fill='${ICON_SETS.ios7.guides[id][1]}'/>`), id);
    assert.notEqual(svg, guideSvg(id, "ios6"), id);
  }
  const why = homeTileCss("why", "ios7");
  assert.match(why, /^background-color: #ff9500; .*linear-gradient\(#ff9500, #ff9500\);$/, "flat: one colour");
  assert.notEqual(why, homeTileCss("why", "ios6"));
});

test("F332: ios7.css carries iOS 7's tab glyphs, outline and (chosen) filled, from the map", async () => {
  const { ICON_SETS, tabGlyphTokens } = await import("./rowicons.js");
  const css = readFileSync(new URL("../ios7.css", import.meta.url), "utf8");
  for (const kind of ["tabs", "tabsSelected"]) {
    for (const line of tabGlyphTokens("ios7", kind).split("\n")) assert.ok(css.includes(`html[data-style="ios7"] ${line}`), line);
    assert.deepEqual(Object.keys(ICON_SETS.ios7[kind]), Object.keys(ICON_SETS.ios6.tabs), kind);
  }
  for (const svg of Object.values(ICON_SETS.ios7.tabs)) assert.match(svg, /fill='none'/, "outline");
  // filled: the root paints black (no fill='none' on it), and nothing leans on an SVG <mask>
  for (const [tab, svg] of Object.entries(ICON_SETS.ios7.tabsSelected)) {
    assert.doesNotMatch(svg.match(/^<svg[^>]*>/)[0], /fill='none'/, `${tab}: filled`);
    assert.doesNotMatch(svg, /<mask/, tab);
  }
  assert.doesNotMatch(css, /:not\(\.active\) \{ --glyph/, "one glyph rule per tab and state");
  assert.throws(() => tabGlyphTokens("ios6", "tabsSelected"), "iOS 6 draws no separate chosen glyph");
});

test("F339: home.css's tile glyphs are the map's iOS 6 home tiles, and none is drawn outside it", async () => {
  const { homeGlyphRules } = await import("./rowicons.js");
  const css = readFileSync(new URL("../home.css", import.meta.url), "utf8");
  const lines = homeGlyphRules("ios6").split("\n");
  for (const line of lines) assert.ok(css.split("\n").includes(line), `home.css: ${line.slice(0, 60)}`);
  // every .glyph-* rule painting a background is one of them
  const painted = css.split("\n").filter((l) => /^\.glyph-[a-z]+.*background/.test(l));
  assert.deepEqual(painted.filter((l) => !lines.includes(l)), []);
});

test("F339: iOS 7 redraws every Home tile flat, a line glyph in iOS 7's colours, and ios7.css carries them", async () => {
  const { ICON_SETS, TO_C7, homeGlyphRules } = await import("./rowicons.js");
  const six = ICON_SETS.ios6.home, seven = ICON_SETS.ios7.home;
  assert.deepEqual(Object.keys(seven).sort(), Object.keys(six).sort(), "every tile redrawn");
  const c7 = new Set(Object.values(TO_C7));
  for (const [name, t] of Object.entries(seven)) {
    if (name === "why") continue; // F332's, checked above
    assert.equal(t.gradient, undefined, `${name}: flat`);
    if (t.colour) assert.ok(c7.has(t.colour), `${name}: ${t.colour} is an iOS 7 colour`);
    assert.match(t.svg, /stroke='#fff'/, `${name}: a line glyph`);
    assert.notEqual(t.svg, six[name].svg, name);
    assert.doesNotMatch(t.svg, /"/, `${name}: single quotes, for url("…")`);
  }
  const css = readFileSync(new URL("../ios7.css", import.meta.url), "utf8").split("\n");
  for (const line of homeGlyphRules("ios7").split("\n")) assert.ok(css.includes(`html[data-style="ios7"] ${line}`), line.slice(0, 60));
  assert.throws(() => homeGlyphRules("nope"));
});

test("F339: every glyph Home's tiles name is in the map", async () => {
  const { ICON_SETS } = await import("./rowicons.js");
  const src = readFileSync(new URL("../screens/home.js", import.meta.url), "utf8");
  const names = new Set([...src.matchAll(/glyph: "([a-z]+)"/g), ...src.matchAll(/kind: "([a-z]+)", label/g)].map((m) => m[1]));
  names.add("theme"); // THEME_ICON
  assert.ok(names.size > 8, [...names].join(" "));
  for (const n of names) assert.ok(ICON_SETS.ios6.home[n] && ICON_SETS.ios7.home[n], n);
});

test("C61: Home's old state-tile glyphs are gone from both maps and both stylesheets; the cert row's and More Sources' stay", async () => {
  const { ICON_SETS } = await import("./rowicons.js");
  const home = readFileSync(new URL("../home.css", import.meta.url), "utf8");
  const ios7 = readFileSync(new URL("../ios7.css", import.meta.url), "utf8");
  for (const gone of ["add", "upgrades", "current", "loading"]) {
    assert.equal(ICON_SETS.ios6.home[gone], undefined, `ios6 home: ${gone}`);
    assert.equal(ICON_SETS.ios7.home[gone], undefined, `ios7 home: ${gone}`);
    assert.doesNotMatch(home, new RegExp(`\\.glyph-${gone}\\b`), `home.css: .glyph-${gone}`);
    assert.doesNotMatch(ios7, new RegExp(`\\.glyph-${gone}\\b`), `ios7.css: .glyph-${gone}`);
  }
  for (const kept of ["failed", "more"]) assert.ok(ICON_SETS.ios6.home[kept] && ICON_SETS.ios7.home[kept], kept);
});

test("C62: Home's send glyph is gone from both maps and both stylesheets, and home.js names no send tile", async () => {
  const { ICON_SETS } = await import("./rowicons.js");
  const home = readFileSync(new URL("../home.css", import.meta.url), "utf8");
  const ios7 = readFileSync(new URL("../ios7.css", import.meta.url), "utf8");
  const screen = readFileSync(new URL("../screens/home.js", import.meta.url), "utf8");
  assert.equal(ICON_SETS.ios6.home.send, undefined, "ios6 home: send");
  assert.equal(ICON_SETS.ios7.home.send, undefined, "ios7 home: send");
  assert.doesNotMatch(home, /\.glyph-send\b/, "home.css: .glyph-send");
  assert.doesNotMatch(ios7, /\.glyph-send\b/, "ios7.css: .glyph-send");
  assert.doesNotMatch(screen, /glyph: "send"/, "screens/home.js: a send tile");
});

// F370: iOS 13's and iOS 26's sets (the approved concept: iOS 7's drawings in each era's colours, weight and corners).
const ERAS = { ios13: { radius: 6.8, glyph: 19, line: 2.2, blue: "#007aff" }, ios26: { radius: 7.8, glyph: 18, line: 2.4, blue: "#0088ff" } };

test("F370: iOS 13 and iOS 26 each draw a full set: rows, glyphs, guides, home, tabs, tabsSelected, tile", async () => {
  const { ICON_SETS, GUIDE_TILE_NAMES } = await import("./rowicons.js");
  for (const [style, want] of Object.entries(ERAS)) {
    const s = ICON_SETS[style];
    for (const kind of ["rows", "glyphs", "guides", "home", "tabs", "tabsSelected", "tile"]) assert.ok(s[kind], `${style}: ${kind}`);
    assert.deepEqual(Object.keys(s.rows), Object.keys(ROW_ICONS), `${style}: every row`);
    assert.deepEqual(Object.keys(s.glyphs).sort(), Object.keys(GLYPHS).sort(), `${style}: every glyph`);
    assert.deepEqual(Object.keys(s.guides), GUIDE_TILE_NAMES, `${style}: every guide tile`);
    assert.deepEqual(Object.keys(s.home).sort(), Object.keys(ICON_SETS.ios6.home).sort(), `${style}: every Home tile`);
    assert.deepEqual(Object.keys(s.tabs), Object.keys(ICON_SETS.ios6.tabs), `${style}: every tab`);
    assert.deepEqual(Object.keys(s.tabsSelected), Object.keys(ICON_SETS.ios6.tabs), `${style}: every chosen tab`);
    assert.deepEqual(s.tile, { size: 29, radius: want.radius, glyph: want.glyph }, style);
  }
});

test("F370: the eras' row tiles: their own colours and corners, white line glyphs in their weight", async () => {
  const { ICON_SETS } = await import("./rowicons.js");
  for (const [style, want] of Object.entries(ERAS)) {
    const colours = new Set(Object.values(ICON_SETS[style].rows).map(([c]) => c));
    assert.equal(colours.size, 13, `${style}: iOS 6's 13 tile colours, each its own`);
    assert.equal(ICON_SETS[style].rows.ipa[0], want.blue, `${style}: its blue`);
    for (const [name, [colour, glyph]] of Object.entries(ICON_SETS[style].rows)) {
      assert.match(colour, /^#[0-9a-f]{6}$/, `${style} ${name}`);
      assert.equal(glyph, ROW_ICONS[name][1], `${style} ${name}: the same thing, the same glyph`);
      const svg = tileSvg(name, style);
      assert.match(svg, new RegExp(`<rect width="29" height="29" rx="${want.radius}" fill="${colour}"/>`), `${style} ${name}`);
      assert.doesNotMatch(svg, /NaN|undefined|Gradient/, `${style} ${name}`);
      assert.notEqual(svg, tileSvg(name, "ios7"), `${style} ${name}: not iOS 7's`);
      assert.notEqual(svg, tileSvg(name, "ios6"), `${style} ${name}: not iOS 6's`);
    }
    // the plain line glyphs take the era's weight
    assert.match(tileSvg("logs", style), new RegExp(`stroke-width="${want.line}"`), style);
  }
  assert.notEqual(tileSvg("general", "ios13"), tileSvg("general", "ios26"));
});

test("F370: the eras' guide and Home tiles are their own, flat, line glyphs, single-quoted for url()", async () => {
  const { ICON_SETS, guideSvg, homeTileCss, GUIDE_TILE_NAMES } = await import("./rowicons.js");
  for (const style of Object.keys(ERAS)) {
    for (const id of GUIDE_TILE_NAMES) assert.notEqual(guideSvg(id, style), guideSvg(id, "ios7"), `${style} guide ${id}`);
    for (const [name, t] of Object.entries(ICON_SETS[style].home)) {
      if (name !== "why") assert.equal(t.gradient, undefined, `${style} ${name}: flat`);
      assert.match(t.svg, /stroke='#fff'/, `${style} ${name}: a line glyph`);
      assert.doesNotMatch(t.svg, /"/, `${style} ${name}: single quotes`);
      assert.notEqual(homeTileCss(name, style), homeTileCss(name, "ios7"), `${style} ${name}`);
    }
  }
});

test("F370: the eras' tab bars are filled glyphs, and each stylesheet carries its tab tokens and Home tile rules", async () => {
  const { ICON_SETS, tabGlyphTokens, homeGlyphRules } = await import("./rowicons.js");
  for (const style of Object.keys(ERAS)) {
    const css = readFileSync(new URL(`../${style}.css`, import.meta.url), "utf8");
    const lines = css.split("\n");
    for (const kind of ["tabs", "tabsSelected"]) {
      for (const line of tabGlyphTokens(style, kind).split("\n")) assert.ok(lines.includes(`html[data-style="${style}"] ${line}`), `${style}.css: ${line.slice(0, 60)}`);
      for (const [tab, svg] of Object.entries(ICON_SETS[style][kind])) {
        assert.doesNotMatch(svg.match(/^<svg[^>]*>/)[0], /fill='none'/, `${style} ${kind} ${tab}: filled`);
        assert.doesNotMatch(svg, /<mask/, `${style} ${tab}`);
        assert.notEqual(svg, ICON_SETS.ios6.tabs[tab], `${style} ${tab}: not iOS 6's`);
      }
    }
    for (const line of homeGlyphRules(style).split("\n")) assert.ok(lines.includes(`html[data-style="${style}"] ${line}`), `${style}.css: ${line.slice(0, 60)}`);
    assert.ok(lines.includes(`html[data-style="${style}"] .home-glyph { border-radius: ${ERAS[style].radius}px; background-size: ${ERAS[style].glyph}px ${ERAS[style].glyph}px; }`), `${style}.css: Home's tile`);
  }
});

test("F370: a style change redraws the row tiles already on screen in the new era's set", async () => {
  const { restyleRowIcons, followRowIconStyle } = await import("./rowicons.js");
  const make = (src) => { const o = { s: src, getAttribute: () => o.s, setAttribute: (_, v) => { o.s = v; } }; return o; };
  const general = make(rowIcon("general", "ios6").src), stranger = make("data:image/png,x");
  const root = { dataset: { style: "ios6" } };
  const doc = { documentElement: root, querySelectorAll: (sel) => (assert.equal(sel, ".row-icon img"), [general, stranger]) };
  assert.equal(restyleRowIcons(doc, "ios13"), 1);
  assert.equal(general.s, rowIcon("general", "ios13").src);
  assert.equal(stranger.s, "data:image/png,x", "a picture that isn't a row tile is left alone");
  assert.equal(restyleRowIcons(doc, "ios13"), 0, "nothing left to change");
  // the observer: a data-style change restyles; another attribute's doesn't
  let fire;
  class Obs { constructor(f) { fire = f; } observe(el, opts) { assert.equal(el, root); assert.deepEqual(opts.attributeFilter, ["data-style"]); } }
  assert.ok(followRowIconStyle(doc, Obs));
  root.dataset.style = "ios26";
  fire();
  assert.equal(general.s, rowIcon("general", "ios26").src);
  assert.equal(followRowIconStyle({}, Obs), null, "no page: nothing to follow");
});
