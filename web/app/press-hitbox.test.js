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
  const n = { tag, classes: new Set(cls.split(/\s+/).filter(Boolean)), parent, children: [] };
  if (parent) parent.children.push(n);
  n.matches = (sel) => sel.split(",").some((one) => {
    const m = /^([a-z]*)((?:\.[\w-]+)*)$/.exec(one.trim());
    assert.ok(m, `selector the test can't read: ${one}`);
    return (!m[1] || m[1] === n.tag) && m[2].split(".").filter(Boolean).every((c) => n.classes.has(c));
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
