// B465: every tappable control shows its pressed look wherever a finger lands in it. app.js marks
// e.target.closest(PRESSABLE) with .is-pressed at pointerdown, so a press on any part of a control (its icon, its
// label, its badge, its own padding) has to resolve to the control itself. The tab bar items had no held look at all:
// a.tab was missing from PRESSABLE and ios6.css drew nothing for a held tab.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const PRESSABLE = /const PRESSABLE = "([^"]+)"/.exec(read("app.js"))[1];

// A tiny element: tag, classes and parent, with closest() for PRESSABLE's simple "tag.class" selectors.
const node = (tag, cls = "", parent = null) => {
  const n = { tag, classes: new Set(cls.split(/\s+/).filter(Boolean)), parent, children: [], attrs: {} };
  if (parent) parent.children.push(n);
  // B471: and "tag[attr]" / "[attr='value']" (tapguard.js CLICKABLE); a node's attributes are in n.attrs.
  n.matches = (sel) => sel.split(",").some((one) => {
    const m = /^([a-z]*)((?:\.[\w-]+)*)((?:\[[\w-]+(?:='[^']*')?\])*)$/.exec(one.trim());
    assert.ok(m, `selector the test can't read: ${one}`);
    const attrs = [...m[3].matchAll(/\[([\w-]+)(?:='([^']*)')?\]/g)].every(([, k, v]) => k in n.attrs && (v === undefined || n.attrs[k] === v));
    return (!m[1] || m[1] === n.tag) && m[2].split(".").filter(Boolean).every((c) => n.classes.has(c)) && attrs;
  });
  n.closest = (sel) => { for (let e = n; e; e = e.parent) if (e.matches(sel)) return e; return null; };
  return n;
};
const all = (n) => [n, ...n.children.flatMap(all)];

// The tab bar item exactly as nav/tabbar.js builds it: its class and every child span of its markup.
const tabbarJs = read("nav/tabbar.js");
const tabClass = /a\.className = "([^"]+)"/.exec(tabbarJs)[1];
const tabChildren = [...(/a\.innerHTML = '([^']+)'/.exec(tabbarJs)[1]).matchAll(/<span class="([^"]+)"/g)].map((m) => m[1]);
const tabItem = () => {
  const bar = node("nav", "tabbar");
  const a = node("a", tabClass, bar);
  for (const c of tabChildren) node("span", c, a);
  return a;
};

// The other controls, each with the inner parts it carries.
const CONTROLS = {
  "tab bar item": tabItem,
  "bar button": () => { const b = node("button", "bar-button"); node("span", "bar-button-label", b); return b; },
  "back button": () => node("button", "bar-button back"),
  "row (link)": () => { const a = node("a", "cell-inner chevron", node("li", "cell", node("ul", "table grouped"))); node("span", "cell-label", a); node("span", "cell-detail", a); return a; },
  "row (button)": () => { const b = node("button", "cell-inner", node("li", "cell")); node("span", "cell-label", b); return b; },
  "Home tile": () => { const a = node("a", "cell-inner chevron home-tile", node("li", "cell")); const t = node("span", "home-tile-text", a); node("span", "home-tile-lead", t); return a; },
  "alert button": () => node("button", "alert-button blue"),
  "action sheet button": () => { const b = node("button", "action-button"); node("span", "action-icon", b); return b; },
  "Delete confirm": () => node("button", "del-confirm"),
};

test("a press anywhere in a control marks that control pressed", () => {
  for (const [name, make] of Object.entries(CONTROLS)) {
    const control = make();
    for (const part of all(control)) {
      assert.equal(part.closest(PRESSABLE), control, `${name}: a press on its ${[...part.classes].join(".") || part.tag} marks ${part.closest(PRESSABLE) ? "something else" : "nothing"}`);
    }
  }
});

test("the tab bar's tap handler acts only on what the press code marks", () => {
  const sel = /getElementById\("tabbar"\)\.addEventListener\("click"[\s\S]*?closest\("([^"]+)"\)/.exec(read("app.js"))[1];
  assert.ok(PRESSABLE.split(",").map((s) => s.trim()).includes(sel), `${sel} missing from PRESSABLE`);
});

test("a held iOS 7 tab swaps to the chosen tab's filled glyph", () => {
  const css = read("ios7.css");
  const chosen = [...css.matchAll(/\.tab\[data-tab="(\w+)"\]\.active(?=[,\s{])/g)].map((m) => m[1]);
  assert.ok(chosen.length >= 6, "a filled glyph per tab");
  for (const t of chosen) {
    assert.ok(css.includes(`.tab[data-tab="${t}"].is-pressed { --glyph`), `${t}: .is-pressed missing beside .active glyph`);
  }
});

test("a held tab wears the selected look, in every era that draws the shared tab bar", () => {
  const css = read("ios6.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, sel, decl]) => ({ sels: sel.split(",").map((s) => s.trim()), decl }));
  const chosen = (s) => /^\.tab\.active(?![\w.-])/.test(s); // the chosen tab's look, not the held chosen tab's dim
  const active = rules.filter((r) => r.sels.some(chosen));
  assert.ok(active.length >= 3, "the selected tab's rules");
  for (const r of active) {
    for (const s of r.sels.filter(chosen)) {
      const held = s.replace(".tab.active", ".tab.is-pressed");
      assert.ok(r.sels.includes(held), `${held} missing beside ${s}`);
    }
  }
  // The chosen tab (Home, mostly) already wears that look: held, it dims instead, so it too goes down.
  const dim = rules.find((r) => r.sels.includes(".tab.active.is-pressed .tab-icon"));
  assert.ok(dim?.sels.includes(".tab.active.is-pressed .tab-label") && /opacity\s*:\s*\.5/.test(dim.decl), "the held chosen tab's dim");
});

// B471: a touch beside a control still opens it on the phone. iOS's WebKit sends a tap on nothing clickable (a grouped
// table's 1 px edge, the gap between Home's tiles, the nav bar around About) to a clickable element close by: the
// first hit of its diagonal steps (4, 9 px up-left, 4 px down-right, 13 px up-left). app.js marks that control too
// (nav/tapguard.js reachedControl), so the pressed look covers exactly the area that opens it.
import { reachedControl, REACH, REACH_STEPS } from "./nav/tapguard.js";

// A page of boxes: elementFromPoint gives the last (topmost) box holding the point.
const page = (...boxes) => ({ elementFromPoint: (x, y) => boxes.findLast((b) => x >= b.r[0] && x < b.r[0] + b.r[2] && y >= b.r[1] && y < b.r[1] + b.r[3])?.n ?? null });
const box = (n, x, y, w, h) => ({ n, r: [x, y, w, h] });
// Home as Chromium lays it out at 390 wide (iOS 6): the nav bar with About, a stack tile's table (1 px edge) over a
// half-width row's table 10 px below, each holding its tile link.
const home = () => {
  const body = node("div", "page-body"), bar = node("div", "navbar"), left = node("div", "nav-left", bar);
  const about = node("button", "bar-button", left);
  const why = node("ul", "table grouped home-tiles home-stack", node("div", "home-row stack", body));
  const whyTile = node("a", "cell-inner chevron home-tile", node("li", "cell", why));
  const ipas = node("ul", "table grouped home-tiles", node("div", "home-row halves", body));
  const ipasTile = node("a", "cell-inner chevron home-tile", node("li", "cell", ipas));
  const doc = page(box(body, 0, 44, 390, 800), box(bar, 0, 0, 390, 44), box(left, 0, 0, 120, 44), box(about, 5, 8, 54, 29),
    box(why, 10, 123, 370, 60), box(whyTile, 11, 124, 368, 58), box(ipas, 10, 193, 370, 45), box(ipasTile, 11, 194, 368, 43));
  return { doc, about, whyTile, ipasTile };
};

test("WebKit's tap search: a 15 pt radius, diagonal steps up-left first", () => {
  assert.equal(REACH, 15);
  assert.deepEqual(REACH_STEPS, [[-0.3, -0.3], [-0.6, -0.6], [0.3, 0.3], [-0.9, -0.9]]);
});

test("a touch on a Home tile's edge or corner marks the tile", () => {
  const { doc, whyTile, ipasTile } = home();
  for (const [x, y] of [[10, 150], [200, 123], [379, 150], [200, 182], [10, 123], [379, 182]]) assert.equal(reachedControl(doc, x, y, PRESSABLE), whyTile, `edge ${x},${y}`);
  assert.equal(reachedControl(doc, 10, 193, PRESSABLE), ipasTile, "the next tile's corner");
});

test("a touch in the gap below a tile marks the tile above, as WebKit opens it", () => {
  const { doc, whyTile, ipasTile } = home();
  for (const y of [184, 188]) assert.equal(reachedControl(doc, 200, y, PRESSABLE), whyTile, `gap at y ${y}`);
  assert.equal(reachedControl(doc, 200, 192, PRESSABLE), ipasTile, "1 px above the next: its down-right step comes before the 13 px one");
  assert.equal(reachedControl(doc, 200, 196, PRESSABLE), ipasTile, "inside the next one");
  assert.equal(reachedControl(doc, 200, 120, PRESSABLE), whyTile, "4 px above the link: the down-right step lands inside");
  assert.equal(reachedControl(doc, 200, 119, PRESSABLE), null, "5 px above: no step lands inside");
  assert.equal(reachedControl(doc, 200, 105, PRESSABLE), null, "out of reach above");
  assert.equal(reachedControl(doc, 200, 260, PRESSABLE), null, "out of reach below");
});

test("a touch on the nav bar beside About marks About; farther off, nothing", () => {
  const { doc, about } = home();
  for (const [x, y] of [[30, 40], [62, 20], [70, 42], [3, 6]]) assert.equal(reachedControl(doc, x, y, PRESSABLE), about, `${x},${y}`);
  for (const [x, y] of [[80, 20], [100, 42]]) assert.equal(reachedControl(doc, x, y, PRESSABLE), null, `${x},${y}`);
});

test("another clickable thing under a step ends the search: WebKit clicks that one", () => {
  const body = node("div", "page-body"), field = node("input", ""), row = node("a", "cell-inner", node("li", "cell"));
  const doc = page(box(body, 0, 0, 390, 800), box(row, 0, 0, 390, 44), box(field, 0, 46, 390, 30));
  assert.equal(reachedControl(doc, 100, 80, PRESSABLE), null, "the field is the first step's hit");
  assert.equal(reachedControl(doc, 100, 50, PRESSABLE), null, "on the field itself");
  assert.equal(reachedControl(doc, 100, 45, PRESSABLE), row, "the row's own step comes first");
});

test("app.js marks the control a touch reaches, keeps it while in reach, and marks what a tap opened", () => {
  const app = read("app.js");
  assert.match(app, /const pressedBy = \(e\) => e\.target\.closest\?\.\(PRESSABLE\) \?\? \(e\.pointerType === "mouse" \? null : reachedControl\(document, e\.clientX, e\.clientY, PRESSABLE\)\)/);
  assert.match(app, /addEventListener\("pointerdown", \(e\) => \{\s*unpress\(\);\s*const el = pressedBy\(e\);/);
  assert.match(app, /addEventListener\("pointermove"[\s\S]{0,200}reachedControl\(document, e\.clientX, e\.clientY, PRESSABLE\) !== pressed/);
  assert.match(app, /addEventListener\("click", \(e\) => \{\s*if \(!e\.isTrusted \|\| e\.detail === 0\) return;[\s\S]{0,120}closest\?\.\(PRESSABLE\)[\s\S]{0,200}classList\.add\("is-pressed"\)/);
});
