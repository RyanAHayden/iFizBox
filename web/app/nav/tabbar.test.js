import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tapTab, scrollToTop, setFloatingTabbar, floatingTabbarOn, FLOAT_OWN_TAB } from "./tabbar.js";
import { BAR_TABS } from "../router.js";
import * as search from "../screens/search.js";

function spy() {
  const calls = { selected: [], focused: 0 };
  return { calls, selectTab: (t) => calls.selected.push(t), reselect: () => { calls.focused++; } };
}

test("a second tap on Search at its root focuses the field, synchronously, without changing route", () => {
  const s = spy();
  assert.equal(tapTab("search", { tab: "search", path: [] }, s), "reselect");
  assert.equal(s.calls.focused, 1); // already done when tapTab returns: no await or timer in between
  assert.deepEqual(s.calls.selected, []);
});

test("below the root, the tap pops to root first and does not focus", () => {
  const s = spy();
  assert.equal(tapTab("search", { tab: "search", path: ["package:com.x"] }, s), "select");
  assert.deepEqual(s.calls.selected, ["search"]);
  assert.equal(s.calls.focused, 0);
  // then the next tap, now at the root, focuses
  tapTab("search", { tab: "search", path: [] }, s);
  assert.equal(s.calls.focused, 1);
});

test("a tap on another tab switches to it; at the root of a tab without reselect nothing is selected (F148 scrolls)", () => {
  const s = spy();
  tapTab("search", { tab: "home", path: [] }, s);
  assert.equal(tapTab("home", { tab: "home", path: [] }, { selectTab: s.selectTab }), "reselect");
  tapTab("search", null, s);
  assert.deepEqual(s.calls.selected, ["search", "search"]);
  assert.equal(s.calls.focused, 0);
});

test("Search's reselect is a no-op before its root page exists", () => {
  assert.equal(typeof search.reselect, "function");
  assert.equal(search.reselect(), false);
});

// F148: a second tap on the tab you are on, at its root, scrolls its page to the top; deeper, it pops to the root.
function scrollSpy() {
  const calls = { selected: [], tops: 0, order: [] };
  return {
    calls,
    selectTab: (t) => { calls.selected.push(t); calls.order.push("select"); },
    scrollTop: () => { calls.tops++; calls.order.push("top"); },
  };
}

test("every tab: a tap at its root scrolls to the top, synchronously, without changing route", () => {
  for (const tab of ["home", "sources", "changes", "installed", "search"]) {
    const s = scrollSpy();
    assert.equal(tapTab(tab, { tab, path: [] }, s), "reselect");
    assert.equal(s.calls.tops, 1, tab);
    assert.deepEqual(s.calls.selected, [], tab);
  }
});

test("below the root, a tap pops to the root and does not scroll", () => {
  const s = scrollSpy();
  assert.equal(tapTab("home", { tab: "home", path: ["package:com.x"] }, s), "select");
  assert.equal(s.calls.tops, 0);
  assert.deepEqual(s.calls.selected, ["home"]);
});

test("a tap on another tab switches without scrolling", () => {
  const s = scrollSpy();
  tapTab("sources", { tab: "home", path: [] }, s);
  assert.equal(s.calls.tops, 0);
  assert.deepEqual(s.calls.selected, ["sources"]);
});

test("Search at its root scrolls up and still focuses its field, both inside the tap", () => {
  const order = [];
  tapTab("search", { tab: "search", path: [] }, {
    selectTab: () => order.push("select"),
    scrollTop: () => order.push("top"),
    reselect: () => order.push("focus"),
  });
  assert.deepEqual(order, ["top", "focus"]);
});

function fakeBody(scrollTop) {
  const calls = [];
  const overflow = [];
  const body = {
    scrollTop,
    style: {
      set overflowY(v) { overflow.push(v); },
      get overflowY() { return overflow.at(-1) ?? ""; },
    },
    get offsetHeight() { calls.push("layout"); return 100; },
    scrollTo(o) { calls.push(o); },
  };
  return { body, calls, overflow };
}

// Without requestAnimationFrame (these fake windows) it falls back to native scrollTo; tabbar-slide.test.js has the
// frame-by-frame slide (B57).
test("scrollToTop stops a fling, then scrolls smoothly to 0 (instantly with reduced motion)", () => {
  const f = fakeBody(1200);
  assert.equal(scrollToTop(f.body, { matchMedia: () => ({ matches: false }) }), true);
  assert.deepEqual(f.overflow, ["hidden", ""]);
  assert.deepEqual(f.calls, ["layout", { top: 0, behavior: "smooth" }]);

  const r = fakeBody(50);
  scrollToTop(r.body, { matchMedia: () => ({ matches: true }) });
  assert.deepEqual(r.calls.at(-1), { top: 0, behavior: "auto" });
});

test("scrollToTop does nothing already at the top or without a page", () => {
  const f = fakeBody(0);
  assert.equal(scrollToTop(f.body, {}), false);
  assert.deepEqual(f.calls, []);
  assert.equal(scrollToTop(null), false);
});

// C52: the floating tab bar era hook (docs/eras.md). setFloatingTabbar only flips <html data-tabbar="float">; the
// layout is style.css's, behind that attribute, so iOS 6 (attribute absent) is untouched.
function fakeRoot() {
  const attrs = new Map();
  return {
    attrs,
    documentElement: {
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      setAttribute: (k, v) => attrs.set(k, String(v)),
      removeAttribute: (k) => attrs.delete(k),
    },
  };
}

test("C52: the floating tab bar is off by default, and setFloatingTabbar turns the attribute on and off", () => {
  const doc = fakeRoot();
  assert.equal(floatingTabbarOn(doc), false);
  setFloatingTabbar(true, doc);
  assert.equal(doc.attrs.get("data-tabbar"), "float");
  assert.equal(floatingTabbarOn(doc), true);
  setFloatingTabbar(true, doc); // idempotent
  assert.equal(doc.attrs.size, 1);
  setFloatingTabbar(false, doc);
  assert.equal(doc.attrs.has("data-tabbar"), false);
  assert.equal(floatingTabbarOn(doc), false);
  setFloatingTabbar(true, {}); // no document: nothing to do, no throw
});

const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
const rulesOf = (src) => [...src.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^}]*)\}/g)]
  .map((m) => ({ sel: m[1].trim(), decl: m[2] }));

test("C52: style.css floats the bar only behind html[data-tabbar=float]; iOS 6's --tab-h and bar stay as they were", () => {
  const rules = rulesOf(css);
  // iOS 6: the 49 pt bar edge to edge, its height --tab-h
  assert.match(css, /:root \{ --nav-h: calc\(44px \+ var\(--top-inset, env\(safe-area-inset-top\)\)\); --tab-h: calc\(49px \+ var\(--safe-bottom\)\); \}/);
  const base = rules.find((r) => r.sel === ".tabbar");
  assert.match(base.decl, /left: 0; right: 0; bottom: 0;/);
  assert.match(base.decl, /height: var\(--tab-h\)/);
  // every rule that reads a --tabbar-float-* hook is behind the attribute (the :root defining them aside)
  const readers = rules.filter((r) => /var\(--tabbar-float-/.test(r.decl) && r.sel !== ":root");
  // and nothing hides overflow on the bar, which would clip the circle sitting past its right edge
  for (const r of rules.filter((x) => /\.tabbar\b/.test(x.sel) && !/\.tab\b/.test(x.sel))) assert.doesNotMatch(r.decl, /overflow/, r.sel);
  assert.ok(readers.length >= 3, readers.map((r) => r.sel).join());
  for (const r of readers) assert.match(r.sel, /^html\[data-tabbar="float"\]/, `${r.sel} is drawn in iOS 6`);
  assert.equal(rules.filter((r) => /data-tabbar/.test(r.sel) && !r.sel.startsWith('html[data-tabbar="float"]')).length, 0);
});

test("C52: floating, --tab-h is the pill plus its gap, so the scrollers' end room and bars on the tab bar follow", () => {
  const rules = rulesOf(css);
  const root = rules.find((r) => r.sel === 'html[data-tabbar="float"]');
  assert.match(root.decl, /--tab-h: calc\(var\(--tabbar-float-h\) \+ var\(--tabbar-float-bottom\)\)/);
  const bar = rules.find((r) => r.sel === 'html[data-tabbar="float"] .tabbar').decl;
  assert.match(bar, /bottom: var\(--tabbar-float-bottom\)/);
  assert.match(bar, /height: var\(--tabbar-float-h\)/);
  assert.match(bar, /left: max\(var\(--tabbar-float-inset\), env\(safe-area-inset-left\)\)/);
  // the right edge leaves room for the circle and the gap before it
  assert.match(bar, /right: calc\(max\(var\(--tabbar-float-inset\), env\(safe-area-inset-right\)\) \+ var\(--tabbar-float-h\) \+ var\(--tabbar-float-gap\)\)/);
  // the scrollers fill the screen (content scrolls under the pill) and end --tab-h + 20px up
  const body = rules.find((r) => r.sel === ".page-body" && /inset: 0/.test(r.decl)).decl;
  assert.match(body, /padding: var\(--nav-h\) [^;]*calc\(var\(--tab-h\) \+ 20px\)/);
  assert.match(rules.find((r) => r.sel === ".page-body.grouped").decl, /calc\(var\(--tab-h\) \+ 20px\)/);
});

test("C52: Search is its own circle beside the pill, as tall as it, out of the tabs' row", () => {
  assert.ok(BAR_TABS.includes(FLOAT_OWN_TAB));
  const own = rulesOf(css).find((r) => r.sel === `html[data-tabbar="float"] .tab[data-tab="${FLOAT_OWN_TAB}"]`)?.decl ?? "";
  assert.match(own, /position: absolute; top: 0; bottom: 0;/);
  assert.match(own, /right: calc\(-1 \* \(var\(--tabbar-float-h\) \+ var\(--tabbar-float-gap\)\)\)/);
  assert.match(own, /width: var\(--tabbar-float-h\)/);
});
