// B4: short pages rubber-band through a zero-width float in .page-body (style.css), never by stretching a child.
// dca99b5's `.page-body > :first-child { min-height: calc(100% + 1px) }` stretched the first group of every page
// that appends several groups straight into .page-body (Settings root, the package page), pushing the rest down.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const css = readFileSync(new URL("./ios6.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const base = readFileSync(new URL("./style.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
// C45: the shared chrome is style.css (its layout, "Era hooks" on) and ios6.css (its look), loaded in that order; the
// layout tests below read the two as one sheet, layout first.
const chrome = base + "\n" + css;
const rules = [...chrome.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, sel, decl]) => ({ sel: sel.trim(), decl }));
const zOf = (src, sel) => Number(new RegExp(`(^|\\n)${sel.replace(/\./g, "\\.")}\\s*\\{[^}]*z-index:\\s*(\\d+)`).exec(src)?.[2]);

test("no rule sizes a page's children to the scroller's height", () => {
  for (const { sel, decl } of rules) {
    if (/\.page-body\s*>/.test(sel)) assert.doesNotMatch(decl, /(min-)?height\s*:[^;]*100%/, sel);
  }
});

test("the rubber-band spacer is a zero-width float 1px taller than the page", () => {
  const r = rules.find((x) => x.sel === ".page-body::before");
  assert.ok(r, ".page-body::before missing");
  assert.match(r.decl, /float\s*:\s*left/);
  assert.match(r.decl, /margin-right\s*:\s*-1px/);
  assert.match(r.decl, /height\s*:\s*calc\(100% \+ 1px\)/);
});

// F204 (replaces B25/B26's push): top notices stop moving the page. Nothing moves the nav bar, the screens or the
// sheets for a banner or the reload bar any more.
test("no banner or reload-bar rule moves the nav bar, the screens or the sheets", () => {
  assert.doesNotMatch(css, /has-banner|--banner-h/, "html.has-banner is gone");
  for (const { sel, decl } of rules) {
    if (/#navbar|#screens|\.sheet\b(?!-)/.test(sel) && /has-reload|has-banner/.test(sel)) assert.fail(`${sel} still moves`);
    if (/^\.sheet$/.test(sel)) assert.doesNotMatch(decl, /translate/, ".sheet keeps no translate transition");
  }
});

// The banner sits right under the nav bar (top = --nav-h), below it in z-order and above the screens, so it slides
// out from behind the nav bar; it has no safe-area top padding of its own. Inside a sheet (banner.js) the same
// z-index puts it under the sheet's nav bar (a .navbar, z-index 3) and over its body.
test("the banner sits under the nav bar, below it in z-order, without the safe-area padding", () => {
  const b = rules.find((x) => x.sel === ".banner");
  assert.ok(b, ".banner missing");
  assert.match(b.decl, /top\s*:\s*var\(--nav-h\)/);
  assert.doesNotMatch(b.decl, /safe-area-inset-top/);
  const z = zOf(chrome, ".banner");
  assert.ok(z < zOf(base, ".navbar"), "below the nav bar");
  assert.ok(z > zOf(base, "#screens"), "over the page");
  const t = rules.find((x) => x.sel === ".banner-timer");
  assert.ok(t, "the timer line");
  assert.match(t.decl, /height\s*:\s*2px/);
  assert.match(t.decl, /bottom\s*:\s*0/);
  assert.match(t.decl, /transform-origin\s*:\s*left/);
});

// B40 (checked on the iPhone 7, 0.9.7, ref/7/screens/b40-*.png): the reload bar shows whole, right on top of the tab
// bar, and the last row scrolls clear of both. The geometry that makes it so: the strip's bottom edge is the tab bar's
// top (both from --tab-h), it paints over the screens and under the tab bar, the scrollers' end room while it shows is
// at least the strip's height, and over a sheet (no tab bar) it drops by exactly the tab bar's 49 pt, onto the home
// indicator's inset, never below the screen.
test("B40: the reload bar sits whole right above the tab bar, and the last row can scroll clear of it", () => {
  const bar = rules.find((x) => x.sel === ".reload-bar");
  assert.ok(bar, ".reload-bar missing");
  assert.match(bar.decl, /position\s*:\s*fixed/);
  assert.match(bar.decl, /bottom\s*:\s*var\(--tab-h\)/, "its bottom edge is the tab bar's top");
  const h = Number(/(?:^|;)\s*height\s*:\s*(\d+)px/.exec(bar.decl)?.[1]);
  assert.equal(h, 44);
  assert.doesNotMatch(bar.decl, /(?:^|;)\s*(transform|translate|margin-bottom)\s*:/, "nothing shifts it off the tab bar when idle");
  const tab = new RegExp(String.raw`(^|\n)\.tabbar\s*\{([^}]*)\}`).exec(base)?.[2] ?? "";
  assert.match(tab, /bottom\s*:\s*0/);
  assert.match(tab, /height\s*:\s*var\(--tab-h\)/, "the tab bar is exactly --tab-h tall");
  assert.match(base, /--tab-h\s*:\s*calc\(49px \+ var\(--safe-bottom\)\)/);
  const z = zOf(chrome, ".reload-bar");
  assert.ok(z > zOf(base, "#screens"), "over the page, not behind it");
  assert.ok(z < zOf(base, ".tabbar"), "under the tab bar, so it slides out from behind it");
  const room = rules.find((x) => /^html\.has-reload :is\([^)]*\.page-body[^)]*\)::after$/.test(x.sel));
  assert.ok(room, "the scrollers get room at their end while it shows");
  assert.ok(Number(/height\s*:\s*(\d+)px/.exec(room.decl)?.[1]) >= h, "at least the strip's height");
  assert.match(room.decl, /display\s*:\s*block/);
  assert.match(room.decl, /clear\s*:\s*both/, "below the rubber-band float, not beside it");
});

// B154: a modal sheet covers the reload bar, as on iOS 6: no rule lifts the strip over a sheet, and its z-index stays
// under the sheets' and the dark action sheets' scrim, so it shows again when the sheet closes.
test("B154: modal sheets cover the reload bar", () => {
  const pk = readFileSync(new URL("./packages.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const z = zOf(chrome, ".reload-bar");
  assert.ok(z < zOf(pk, ".sheet"), "under the modal sheets");
  assert.ok(z < zOf(pk, ".action-scrim"), "under the action sheets");
  for (const r of rules.filter((x) => /reload-bar/.test(x.sel) && x.sel !== ".reload-bar")) {
    assert.doesNotMatch(r.decl, /z-index/, `${r.sel} must not lift the strip`);
  }
  assert.ok(!rules.some((x) => /\.sheet\b[^,{]*\.reload-bar/.test(x.sel)), "no rule moves the strip onto a sheet");
});

// B191: 120 Hz (AGENTS.md): only transform and opacity animate. No `transition` in any web/app stylesheet names a
// layout property (or leaves the property out, which means `all`); a size change slides with a transform instead
// (nav/slide.js, or a counter-transform as on sources.css's rows).
const LAYOUT = /^(all|width|height|(min|max)-(width|height)|inline-size|block-size|(min|max)-(inline|block)-size|margin(-[a-z]+)*|padding(-[a-z]+)*|top|right|bottom|left|inset(-[a-z]+)*|border(-(top|right|bottom|left|inline|block)(-(start|end))?)?(-width)?|flex(-[a-z]+)*|(row-|column-)?gap|grid(-[a-z]+)*|font|font-size|line-height|letter-spacing|word-spacing|text-indent|vertical-align)$/;
const EASING = /^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|normal|allow-discrete|initial|inherit|unset)$/;
const splitTop = (s) => { // on commas outside parentheses (cubic-bezier(...))
  const out = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
};
export function transitionedProps(src) {
  const props = [];
  const text = src.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, name, value] of text.matchAll(/(?:^|[;{\s])(transition(?:-property)?)\s*:\s*([^;}]*)/g)) {
    for (const item of splitTop(value.replace(/!important/, ""))) {
      if (name === "transition-property") { props.push(item); continue; }
      const words = item.replace(/\([^)]*\)/g, "").split(/\s+/).filter((w) => /^-?[a-z][a-z-]*$/.test(w) && !EASING.test(w));
      if (words[0] === "none") continue;
      props.push(words[0] ?? "all");
    }
  }
  return props;
}

test("B191: no transition in web/app/*.css animates a layout property", () => {
  assert.deepEqual(transitionedProps(".a { transition: width .3s ease, opacity .2s; } .b{transition:.3s}"), ["width", "opacity", "all"]);
  assert.deepEqual(transitionedProps(".a { transition: transform .3s cubic-bezier(.25,.1,.25,1), opacity .3s linear; }"), ["transform", "opacity"]);
  assert.deepEqual(transitionedProps(".a { transition: none; transition-duration: 0s; transition-property: margin-left; }"), ["margin-left"]);
  const dir = new URL("./", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".css"));
  assert.ok(files.length > 5, "the stylesheets are there");
  const bad = [];
  for (const f of files) {
    for (const p of transitionedProps(readFileSync(new URL(f, dir), "utf8"))) if (LAYOUT.test(p)) bad.push(`${f}: ${p}`);
  }
  assert.deepEqual(bad, [], "animate transform/opacity instead (nav/slide.js FLIP, or a counter-transform)");
});

// C44, docs/eras.md "Definition of clean": an era is one stylesheet of look plus the named hooks, never a layout rule.
// Look properties are the paint and type ones below; everything else (box, position, flex/grid, overflow, wrapping,
// touch and cursor behaviour) is layout and lives in style.css, moved only through its "Era hooks" tokens.
// F345a: appearance (and its -webkit- spelling) is look too: it hands a control's paint to the browser (the native
// controls hook, ios26.css) and sizes nothing the page's own rules don't.
export const LOOK = /^(--.+|(-webkit-)?appearance|color|color-scheme|accent-color|caret-color|opacity|filter|-webkit-backdrop-filter|-webkit-box-reflect|backdrop-filter|box-shadow|text-shadow|content|background(-[a-z]+)*|border(-[a-z]+)*|outline(-[a-z]+)*|-webkit-mask(-[a-z]+)*|mask(-[a-z]+)*|font(-[a-z]+)*|line-height|letter-spacing|word-spacing|text-align|text-transform|text-decoration(-[a-z]+)*|-webkit-font-smoothing|-webkit-text-stroke(-[a-z]+)*|fill|stroke(-[a-z]+)*|list-style(-[a-z]+)*)$/;
const splitDecls = (decl) => { // on ";" outside quotes and parentheses (data: URIs hold both)
  const out = [];
  let depth = 0, quote = "", cur = "";
  for (const ch of decl) {
    if (quote) { if (ch === quote) quote = ""; }
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === ";" && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((d) => d.trim()).filter(Boolean);
};
export const cssRules = (src) => [...src.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, sel, decl]) => ({ sel: sel.trim().replace(/\s+/g, " "), props: splitDecls(decl).map((d) => d.slice(0, d.indexOf(":")).trim().toLowerCase()) }));
// "selector: property" for every declaration that sets layout.
export const layoutIn = (src) => cssRules(src).flatMap(({ sel, props }) => props.filter((p) => !LOOK.test(p)).map((p) => `${sel}: ${p}`));

// A look-only stretch: from "/* ==== look-only { ====" to "/* ==== } look-only ==== */", in any web/app stylesheet.
const STRETCH = /\/\* ==== look-only \{ ====[\s\S]*?\*\/([\s\S]*?)\/\* ==== \} look-only ==== \*\//g;
export const stretchesOf = (src) => [...src.matchAll(STRETCH)].map((m) => m[1]);
const raw = readFileSync(new URL("./ios6.css", import.meta.url), "utf8");
const regions = stretchesOf(raw);
const outside = raw.replace(STRETCH, "");

test("C44: the look/layout checker tells look from layout", () => {
  assert.deepEqual(layoutIn(".a { color: red; margin: 0; background: url(\"data:x;base64,AA\") 0 0 / 4px; } .b { --x: 1px; height: var(--x); }"),
    [".a: margin", ".b: height"]);
  assert.deepEqual(layoutIn("@media (min-width: 1px) { .a { font-size: 2px; text-shadow: none; display: none; } }"), [".a: display"]);
});

test("C44: ios6.css's look-only stretches paint only; their layout is style.css's", () => {
  assert.equal((raw.match(/look-only \{/g) ?? []).length, regions.length, "every look-only stretch is closed");
  assert.ok(regions.length >= 3, "the nav bar and bar buttons, the tab bar and grouped tables, the Share glyph");
  assert.deepEqual(regions.flatMap(layoutIn), [], "move these to style.css (Era hooks) and give an era a token for them");
  // The four components' rules all sit in a stretch: none of these selectors has a rule outside one, so their layout
  // can't creep back into ios6.css.
  const OWN = [".navbar", ".navbar::after", ".navbar::before", ".nav-title", ".bar-button", ".bar-button.back", ".bar-button.share-button::before",
    ".tabbar", ".tabbar::before", ".tab", ".tab.active", ".tab-icon", ".tab-icon::before", ".tab-label", ".badge", ".tab .badge",
    ".page-body.grouped", ".group", ".group + .group", ".group-header", ".group-footer", ".table", ".table.grouped",
    ".cell-inner", ".cell-text", ".cell-label", ".cell-subtitle", ".cell-detail", ".cell-count", ".cell-icon",
    ".cell-icon.row-icon", ".cell-inner.chevron::after", ".bar-button.bar-icon"];
  const inside = new Set(regions.flatMap((r) => cssRules(r).flatMap(({ sel }) => sel.split(",").map((s) => s.trim()))));
  // A theme- or shell-qualified rule (html[data-theme="dark"] .tabbar) counts as the same selector.
  const subject = (s) => s.replace(/^(html|:root)(\[[^\]]*\]|:not\([^)]*\)|\.[\w-]+)*\s+/, "");
  for (const { sel } of cssRules(outside)) for (const s of sel.split(",").map((x) => x.trim())) assert.ok(!OWN.includes(subject(s)), `${s} has a rule outside the look-only stretches`);
  for (const s of [".navbar", ".bar-button", ".tabbar", ".tab", ".table.grouped", ".group-header", ".cell-inner"]) assert.ok(inside.has(s), s);
});

// Every stylesheet can mark its own look-only stretches the same way (a component sheet keeps its layout in its own
// rules beside them); each one is held to the same rule.
test("C44: every look-only stretch in web/app/*.css paints only, and every one is closed", () => {
  const dir = new URL("./", import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".css"))) {
    const src = readFileSync(new URL(f, dir), "utf8");
    const opened = (src.match(/\/\* ==== look-only \{ ====/g) ?? []).length;
    const closed = (src.match(/\/\* ==== \} look-only ==== \*\//g) ?? []).length;
    assert.equal(opened, closed, `${f}: every look-only stretch is closed`);
    assert.equal(stretchesOf(src).length, opened, `${f}: look-only stretches don't nest`);
    assert.deepEqual(stretchesOf(src).flatMap(layoutIn), [], `${f}: layout belongs outside the look-only stretches`);
  }
});

test("C44: style.css's era hooks are defined once and all used", () => {
  const src = base;
  const block = /:root \{([^}]*--bar-btn-h[^}]*)\}/.exec(src)?.[1];
  assert.ok(block, "style.css's Era hooks :root block");
  const hooks = [...block.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]);
  assert.ok(hooks.length >= 20, hooks.join());
  const rest = src.replace(block, "");
  for (const h of hooks) assert.match(rest, new RegExp(`var\\(${h}\\)`), `${h} is never used`);
  // the four components take their geometry from the hooks
  for (const [sel, hook] of [[".bar-button", "--bar-btn-h"], [".tab", "--tab-item-h"], [".group", "--group-margin"], [".cell-inner", "--cell-min-h"]]) {
    assert.ok(cssRules(src).some((r) => r.sel === sel) && new RegExp(`(^|\\n)\\${sel}\\s*\\{[^}]*var\\(${hook}\\)`).test(src), `${sel} uses ${hook}`);
  }
});

// An era (data-style=ios7, ios13, ios26: docs/eras.md) is a stylesheet web/app/ios<N>.css beside ios6.css. All of it is
// look: tokens, hooks and look-only rules. None exists yet; this holds the first one to the rule.
test("C44: an era stylesheet sets no layout", () => {
  const dir = new URL("./", import.meta.url);
  for (const f of readdirSync(dir).filter((x) => /^ios\d+\.css$/.test(x) && x !== "ios6.css")) {
    assert.deepEqual(layoutIn(readFileSync(new URL(f, dir), "utf8")), [], `${f}: layout belongs in style.css; move it through a hook`);
  }
});

// C45: the rest of ios6.css (switch, plain tables and section header, button pair, HUD, menu callout, queue hint,
// signing rows, banner, share sheet, reload bar, segmented control, undo bar, pull to refresh, placeholders, locked
// tab, and the odds and ends) went the same way: ios6.css is all look now and its layout is style.css's, in the order
// it had, after style.css's own rules (journal/2026-11-20-c45-ios6-era-readiness/cascade.py proves the order).
test("C45: ios6.css sets no layout at all, and every rule in it but the token blocks sits in a look-only stretch", () => {
  assert.deepEqual(layoutIn(raw), [], "move it to style.css (Era hooks), after the rules there, keeping its order");
  assert.doesNotMatch(css, /@keyframes|@media/, "motion and reduced motion are layout: style.css's");
  const tokensOnly = (sel, props) => props.every((p) => p.startsWith("--") || p === "color-scheme");
  for (const { sel, props } of cssRules(outside)) {
    if (sel === "body") continue; // the page's own text colour and ground
    assert.ok(/^(:root|html)(\[[^\]]*\])*$/.test(sel) && tokensOnly(sel, props), `${sel} sits outside the look-only stretches`);
  }
});

test("C45: ios6.css's decorations come from tokens: no gradient, image or emboss written into a rule", () => {
  // Custom properties hold the values; a rule reads them. Hairlines built from a colour token (inset 0 1px 0
  // var(--divider-hi)) are allowed; literal gradients, url() art and text embosses are not, so an era swaps values
  // instead of undoing them. The one url() left is the Share button's glyph, an icon (C51's icon map, not a decoration).
  const ICON = new Set([".bar-button.share-button::before"]);
  const bad = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim().replace(/\s+/g, " ");
    for (const d of m[2].split(/;(?![^(]*\))/).map((x) => x.trim()).filter(Boolean)) {
      const [p, ...v] = d.split(":");
      const val = v.join(":").trim();
      if (p.trim().startsWith("--")) continue;
      if (/gradient\(/.test(val) || (/url\(/.test(val) && !ICON.has(sel))) bad.push(`${sel}: ${p.trim()}`);
      if (/^(text-shadow|filter|border-image(-source)?)$/.test(p.trim()) && !/^(var\(|none$|brightness\()/.test(val)) bad.push(`${sel}: ${p.trim()}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("C45: style.css holds the moved layout and the new hooks drive it", () => {
  for (const [sel, hook] of [[".section-header", "--section-head-h"], [".cell-inner.pair-button", "--pair-h"], [".store-segmented", "--seg-h"],
    [".hud", "--hud-w"], [".menu-items", "--callout-h"], [".queue-hint-text", "--callout-h"], [".banner", "--banner-pad"],
    [".plain .cell-inner", "--plain-cell-pad-y"]]) {
    assert.ok(new RegExp(`(^|\\n)${sel.replace(/\./g, "\\.")}\\s*\\{[^}]*var\\(${hook}\\)`).test(base), `${sel} uses ${hook}`);
  }
  for (const k of ["@keyframes hud-spin", "@keyframes ph-pulse", ".page-body::before", ".switch {", ".sw-knob {", ".reload-bar {", ".undo-bar {", ".pull-refresh {", ".share-sheet {"]) {
    assert.ok(base.includes(k), `${k} in style.css`);
  }
});

// T61: the reflections under the store icon and the Browse hero icon paint, so they sit in packages.css's look-only
// stretches, where an era can turn them off.
test("T61: packages.css's -webkit-box-reflect declarations all sit in look-only stretches", () => {
  const src = readFileSync(new URL("./packages.css", import.meta.url), "utf8");
  const reflects = (s) => cssRules(s).flatMap(({ sel, props }) => props.filter((p) => p === "-webkit-box-reflect").map(() => sel));
  assert.deepEqual(reflects(src.replace(STRETCH, "")), []);
  const inside = stretchesOf(src).flatMap(reflects);
  for (const sel of [".store-icon", ".browse-hero-icon", ".browse-hero.is-loading .browse-hero-icon"]) assert.ok(inside.includes(sel), sel);
});

// F331: a geometry hook must not share a name with a look token (style.css's --sw-knob hook once overwrote ios6.css's
// knob gradient, so iOS 6's knob drew 2px wide), and the switch, Theme's Mode and Home move only through their hooks.
test("F331: era hooks don't reuse a look token's name, and the new geometry reads them", () => {
  const hookBlocks = [...base.matchAll(/:root \{([^}]*)\}/g)].map((m) => m[1]).join("\n");
  const hooks = new Set([...hookBlocks.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const looks = new Set();
  for (const f of readdirSync(new URL(".", import.meta.url)).filter((x) => x.endsWith(".css") && x !== "style.css" && !/^ios\d+\.css$/.test(x))) {
    for (const m of readFileSync(new URL(f, import.meta.url), "utf8").matchAll(/(--[\w-]+)\s*:/g)) looks.add(m[1]);
  }
  for (const m of css.matchAll(/(--[\w-]+)\s*:/g)) if (m[1] !== "--x") looks.add(m[1]);
  const clash = [...hooks].filter((h) => looks.has(h) && !["--tab-h", "--nav-h", "--safe-bottom"].includes(h));
  assert.deepEqual(clash.filter((h) => /^--(sw|settings-seg|home)-/.test(h)), []);
  for (const [sel, hook] of [[".switch", "--sw-w"], [".sw-knob", "--sw-knob-size"]]) {
    assert.ok(new RegExp(`(^|\\n)\\${sel}\\s*\\{[^}]*var\\(${hook}\\)`).test(base), `${sel} uses ${hook}`);
  }
  assert.match(css, /\.switch\[aria-checked="true"\]\s*\{\s*--x:\s*var\(--sw-travel\)/);
  const settings = readFileSync(new URL("./settings.css", import.meta.url), "utf8");
  assert.match(settings, /\.store-segmented\.settings-segmented \{ margin: var\(--settings-seg-margin\);/);
  const home = readFileSync(new URL("./home.css", import.meta.url), "utf8");
  assert.match(home, /\.home-row \{ margin: 0 var\(--home-inset\)/);
  const ios7 = readFileSync(new URL("./ios7.css", import.meta.url), "utf8");
  for (const v of ["--sw-w: 51px", "--sw-h: 31px", "--sw-travel: 20px", "--settings-seg-margin: 0 15px", "--home-inset: 0px"]) assert.ok(ios7.includes(v), v);
});

// F336: Theme's Mode's height is a hook: iOS 6's 44pt row, iOS 7's own 29pt control; its text follows the height.
test("F336: Theme's Mode height comes from --settings-seg-h", () => {
  const settings = readFileSync(new URL("./settings.css", import.meta.url), "utf8");
  const ios7 = readFileSync(new URL("./ios7.css", import.meta.url), "utf8");
  assert.match(base, /--settings-seg-h: 44px;/);
  assert.match(settings, /\.store-segmented\.settings-segmented \{[^}]*height: var\(--settings-seg-h\);/);
  assert.match(settings, /\.settings-segmented \.store-segment \{[^}]*line-height: calc\(var\(--settings-seg-h\) - 2px\);/);
  assert.match(ios7, /--settings-seg-h: 29px;/);
});

test("F338: the row tile's place is an era hook; iOS 7 puts it 15pt in, the label 15pt after, the separator there", () => {
  const base = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  const ios7 = readFileSync(new URL("./ios7.css", import.meta.url), "utf8");
  assert.match(base, /--row-icon-in: -3px; --row-icon-after: 3px;/);
  assert.match(base, /\n\.cell-icon\.row-icon \{ margin: 0 var\(--row-icon-after\) 0 var\(--row-icon-in\); \}/);
  assert.match(ios7, /--cell-pad: 0 15px;/);
  assert.match(ios7, /--row-icon-in: 0px; --row-icon-after: 7px;/); // 15 + 0 = 15pt in; 7 + --cell-gap 8 = 15pt after
  assert.match(ios7, /\.cell-icon\.row-icon\) \{\s*background-position: calc\(15px \+ var\(--row-icon-in\) \+ 29px \+ var\(--row-icon-after\) \+ var\(--cell-gap\)\) 0;/);
});

// F333: iOS 7's controls after the Teehan+Lax iOS 7 kit (ref/teehanlax/ios7/sheet.svg): the alert, action sheet, callout
// menu, counts and plain-table keylines are iOS 7's, and the plain keyline is a full-height tile (a .5pt tile at a row's
// bottom is not painted at 3x; the package list is virtual, so no sibling selector can draw it).
test("F333: ios7.css draws the kit's alert, action sheet, menu, counts and keylines", () => {
  const ios7 = readFileSync(new URL("./ios7.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (sel) => [...ios7.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, s]) => s.split(",").map((x) => x.trim()).includes(sel)).map(([, , d]) => d).join(";");
  const alert = rule('html[data-style="ios7"] .alert');
  assert.match(alert, /border-radius: 7px/);
  assert.match(alert, /box-shadow: none/);
  assert.match(rule('html[data-style="ios7"] .alert-button'), /background: none[\s\S]*font-size: 17px; font-weight: 400; color: var\(--i7-tint\)/);
  assert.match(rule('html[data-style="ios7"] .alert-button:last-child:not(.cancel)'), /font-weight: 600/);
  // the Too Big alert's Download IPA (altstore.css .alert-button.blue, iOS 6's gloss) is flat tinted text too, in
  // both tones (the rule's colours are tone tokens), and pressed takes the same highlight as the others
  for (const kind of ["cancel", "green", "red", "blue"]) {
    assert.match(rule(`html[data-style="ios7"] .alert-button.${kind}`), /border: 0;[\s\S]*background: none[\s\S]*color: var\(--i7-tint\)/, kind);
  }
  assert.match(rule('html[data-style="ios7"] .alert-button.is-pressed'), /background: var\(--i7-alert-pressed\)/);
  assert.match(rule('html[data-style="ios7"] .action-button'), /font-size: 21px; font-weight: 400; border-radius: 3px/);
  assert.match(ios7, /--action-btn: #f3f3f3;/);
  assert.match(ios7, /--action-cancel: #ebebeb;/);
  assert.match(ios7, /--callout-h: 36px;/);
  assert.match(ios7, /--menu: #232323;/);
  assert.match(rule('html[data-style="ios7"] .menu-items'), /border-radius: 8px/);
  assert.match(rule('html[data-style="ios7"] .cell-count'), /background: none/);
  assert.match(rule('html[data-style="ios7"] .group-header'), /font-size: 14px/);
  assert.match(ios7, /--i7-keyline: linear-gradient\(to top, var\(--keyline\) \.5px, transparent \.5px\);/);
  assert.match(rule('html[data-style="ios7"] .plain .cell'), /background-image: var\(--i7-keyline\); background-position: 15px 0; background-size: calc\(100% - 15px\) 100%; background-repeat: no-repeat;/);
  assert.match(rule('html[data-style="ios7"] .pkg-row'), /var\(--i7-keyline\) 51px 0/);
});

// F341: the action sheet's and the alert's geometry are era hooks (style.css, iOS 6's values; packages.css and
// sources.css read them), and iOS 7 sets the kit's: the sheet's choices one 3pt block split by .5pt, 8pt from the
// sides and over Cancel; the alert 270pt with its buttons edge to edge in a 44pt row, each drawing its own lines.
test("F341: action sheet and alert geometry are era hooks; iOS 7 sets the kit's", () => {
  const base = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  const pk = readFileSync(new URL("./packages.css", import.meta.url), "utf8");
  const src = readFileSync(new URL("./sources.css", import.meta.url), "utf8");
  const ios7 = readFileSync(new URL("./ios7.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const v of ["--action-sheet-pad: 21px 21px", "--action-sheet-pad-bottom: 22px", "--action-gap: 11px", "--action-list-gap: 11px",
    "--action-list-bleed: 2px", "--action-title-margin: -6px 0 2px", "--action-title-pad: 0", "--action-cancel-gap: 14px",
    "--alert-w: 340px", "--alert-pad: 16px 12px 11px", "--alert-buttons-margin: 4px 0 0", "--alert-buttons-gap: 8px",
    "--alert-stacked-gap: 9px", "--alert-button-h: 43px"]) assert.ok(base.includes(v), `style.css ${v}`);
  assert.match(pk, /\n\.action-sheet \{[^}]*gap: var\(--action-gap\);[^}]*padding: var\(--action-sheet-pad\) calc\(var\(--action-sheet-pad-bottom\) \+ var\(--safe-bottom\)\)/);
  assert.match(pk, /\n\.action-list \{[^}]*gap: var\(--action-list-gap\);[^}]*margin: calc\(-1 \* var\(--action-list-bleed\)\); padding: var\(--action-list-bleed\);/);
  assert.match(pk, /\n\.action-title \{ margin: var\(--action-title-margin\); padding: var\(--action-title-pad\);/);
  assert.match(pk, /\n\.action-button\.cancel \{ margin-top: var\(--action-cancel-gap\); \}/);
  assert.match(src, /\n\.alert \{[^}]*width: min\(var\(--alert-w\), 100%\);[^}]*padding: var\(--alert-pad\);/);
  assert.match(src, /\n\.alert-buttons \{[^}]*gap: var\(--alert-buttons-gap\); margin: var\(--alert-buttons-margin\);/);
  assert.match(src, /\n\.alert-buttons\.stacked \{[^}]*gap: var\(--alert-stacked-gap\);/);
  assert.match(src, /\n\.alert-button \{[^}]*height: var\(--alert-button-h\);/);
  for (const v of ["--action-sheet-pad: 8px 8px", "--action-sheet-pad-bottom: 8px", "--action-gap: 8px", "--action-list-gap: 0px",
    "--action-list-bleed: 0px", "--action-title-margin: 0 0 -8px", "--action-title-pad: 14px 16px", "--action-cancel-gap: 0px",
    "--alert-w: 270px", "--alert-pad: 18px 16px 0", "--alert-buttons-margin: 8px -16px 0", "--alert-buttons-gap: 0px",
    "--alert-stacked-gap: 0px", "--alert-button-h: 44px"]) assert.ok(ios7.includes(v), `ios7.css ${v}`);
  // the lines are the buttons' own now, not drawn on the box from its bottom
  assert.doesNotMatch(ios7, /calc\(100% - \d+(\.\d+)?px\) \/ 100% \.5px/);
  assert.match(ios7, /\.alert-button:disabled \{\s*border: 0; border-radius: 0; box-shadow: inset 0 \.5px 0 var\(--i7-alert-line\);/);
  assert.match(ios7, /\.alert-buttons:not\(\.stacked\) > \.alert-button \+ \.alert-button \{\s*box-shadow: inset 0 \.5px 0 var\(--i7-alert-line\), inset \.5px 0 0 var\(--i7-alert-line\);/);
  assert.match(ios7, /\.action-list \{ border-radius: 3px; \}/);
  assert.match(ios7, /\.action-list > \.action-button \{ border-width: 0; border-radius: 0; \}/);
  // the sheet's separators are the buttons' own .5pt lines (a .5pt flex gap lands on half pixels and Chromium drops some)
  assert.match(ios7, /\.action-title \+ \.action-list > \.action-button:first-child \{ box-shadow: inset 0 \.5px 0 var\(--i7-action-line\); \}/);
});

// The status-bar strip is plain black and only the top inset tall, in the app as on the website, in the iOS 6 era;
// the app's iOS 7 and iOS 13 eras keep the bar's art stretched 22 pt into the bar. The iOS 6 era alone takes the
// shell's --status-bar-bottom as its top inset, and every top-inset use falls back to the safe area.
test("iOS 6's status-bar strip is black, the top inset tall; only that era takes the shell's line", () => {
  const strip = rules.filter((x) => x.sel === ".navbar::before");
  assert.ok(strip.some((r) => /height\s*:\s*var\(--top-inset, env\(safe-area-inset-top\)\)\s*;/.test(r.decl)), "height");
  assert.ok(strip.some((r) => /background\s*:\s*var\(--site-strip\)/.test(r.decl)), "background");
  assert.match(css, /--site-strip:\s*#000/);
  const later = rules.filter((x) => /navbar::before/.test(x.sel) && x.sel !== ".navbar::before");
  for (const r of later) assert.match(r.sel, /^html\[data-shell="app"\]:is\(\[data-style="ios7"\], \[data-style="ios13"\]\) \.navbar::before$/, r.sel);
  const era = rules.filter((x) => /--top-inset\s*:/.test(x.decl));
  assert.deepEqual(era.map((r) => r.sel), ['html[data-shell="app"]:not([data-style="ios7"]):not([data-style="ios13"])']);
  assert.match(era[0].decl, /--top-inset:\s*var\(--status-bar-bottom, env\(safe-area-inset-top\)\)/);
  const dir = new URL("./", import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".css"))) {
    const src = readFileSync(new URL(f, dir), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const bare = src.replace(/var\(--(top-inset|status-bar-bottom), env\(safe-area-inset-top(, 0px)?\)\)/g, "");
    assert.doesNotMatch(bare, /safe-area-inset-top/, `${f}: use var(--top-inset, env(safe-area-inset-top))`);
  }
});
