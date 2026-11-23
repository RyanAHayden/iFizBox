import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHomeTop, homeRootOf, isHomeRoot, createReturnHome, createUserTouch, untilNotTyping } from "./hometop.js";
import { createStacks, newestRoute } from "./stack.js";
import { tapTab, scrollToTop } from "./tabbar.js";
import { createRouter, BAR_TABS } from "../router.js";

// F211: Home always starts at the top. The real router, stacks and tapTab, with pages that are plain scrollers, wired
// the way app.js wires them: the tab bar's click runs homeTop.tabTapped, then tapTab; the app coming to the front
// (launch, visibilitychange, pageshow) runs homeTop.opened.

function fakeWindow(hash = "") {
  const listeners = new Set();
  const fire = () => listeners.forEach((f) => f());
  const location = {
    _hash: hash,
    get hash() { return this._hash; },
    set hash(h) { const n = h.startsWith("#") ? h : "#" + h; if (n !== this._hash) { this._hash = n; fire(); } },
  };
  const win = {
    location,
    history: { replaceState(_s, _t, url) { location._hash = url; } },
    addEventListener(type, f) { if (type === "hashchange") listeners.add(f); },
    removeEventListener(type, f) { if (type === "hashchange") listeners.delete(f); },
  };
  return win;
}

function app(hash = "#/home") {
  const win = fakeWindow(hash);
  const stacks = createStacks({ tabs: BAR_TABS, create: () => ({ body: { scrollTop: 0, style: {} } }) });
  const router = createRouter({ win, onRoute: (r) => stacks.sync(r) });
  router.start();
  let overlay = false;
  const homeTop = createHomeTop({ homeRoot: homeRootOf(stacks), current: () => router.current(), overlayUp: () => overlay });
  // Reduced motion: tapTab's slide to the top lands at once.
  const still = { matchMedia: () => ({ matches: true }), requestAnimationFrame: () => 0 };
  const tap = (tab) => {
    homeTop.tabTapped(tab);
    return tapTab(tab, router.current(), { selectTab: (t) => router.selectTab(t),
      scrollTop: () => scrollToTop(stacks.top()?.page.body, still) });
  };
  const home = () => stacks.stack("home")[0].page.body;
  return { router, stacks, homeTop, tap, home, setOverlay: (v) => { overlay = v; } };
}

test("isHomeRoot: only Home's own root", () => {
  assert.equal(isHomeRoot({ tab: "home", path: [] }), true);
  assert.equal(isHomeRoot({ tab: "home", path: ["settings"] }), false);
  assert.equal(isHomeRoot({ tab: "sources", path: [] }), false);
  assert.equal(isHomeRoot(null), false);
});

test("launch: the app opening on Home puts Home at its top", () => {
  const a = app("#/home");
  a.home().scrollTop = 300; // e.g. a body restored by the web view, or drawn taller than the screen
  assert.equal(a.homeTop.opened(), true);
  assert.equal(a.home().scrollTop, 0);
});

test("resume: back from the background on Home puts Home at its top, not while a popup is up", () => {
  const a = app("#/home");
  a.home().scrollTop = 420;
  a.setOverlay(true);
  assert.equal(a.homeTop.opened(), false);
  assert.equal(a.home().scrollTop, 420);
  a.setOverlay(false);
  assert.equal(a.homeTop.opened(), true);
  assert.equal(a.home().scrollTop, 0);
});

test("resume on another tab or a page pushed on Home leaves Home's place alone", () => {
  const a = app("#/home");
  a.home().scrollTop = 250;
  a.router.go({ tab: "home", path: ["settings"] });
  assert.equal(a.homeTop.opened(), false);
  a.router.selectTab("sources");
  a.stacks.top().page.body.scrollTop = 90;
  assert.equal(a.homeTop.opened(), false);
  assert.equal(a.home().scrollTop, 250);
  assert.equal(a.stacks.top().page.body.scrollTop, 90);
});

test("tab tap from another tab: Home shows at its top; the other tab keeps its place", () => {
  const a = app("#/home");
  a.home().scrollTop = 500;
  assert.equal(a.tap("sources"), "select");
  const sources = a.stacks.top().page.body;
  sources.scrollTop = 120;
  assert.equal(a.tap("home"), "select");
  assert.equal(a.router.current().tab, "home");
  assert.equal(a.home().scrollTop, 0);
  assert.equal(a.tap("sources"), "select");
  assert.equal(sources.scrollTop, 120); // other tabs: today's behaviour
});

test("tab tap on Home's root slides it to the top (F148)", () => {
  const a = app("#/home");
  a.home().scrollTop = 640;
  assert.equal(a.tap("home"), "reselect");
  assert.equal(a.home().scrollTop, 0);
});

test("tab tap on Home below its root pops to the root, at its top", () => {
  const a = app("#/home");
  a.home().scrollTop = 333;
  a.router.go({ tab: "home", path: ["settings"] });
  assert.equal(a.tap("home"), "select");
  assert.deepEqual(a.router.current(), { tab: "home", path: [] });
  assert.equal(a.home().scrollTop, 0);
});

test("Back to Home from a page pushed on it keeps where Home was scrolled", () => {
  const a = app("#/home");
  const root = a.home();
  root.scrollTop = 777;
  a.router.go({ tab: "home", path: ["settings"] });
  a.router.go({ tab: "home", path: [] }); // the Back button / swipe back land on the parent route
  assert.equal(a.stacks.top().page.body, root); // the same page, never rebuilt
  assert.equal(root.scrollTop, 777);
});

test("app.js wires it: tabTapped before tapTab, opened at launch, on visibilitychange and on pageshow", () => {
  const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(src, /homeTop\.tabTapped\(tab\);[\s\S]{0,200}tapTab\(tab, router\.current\(\)/);
  assert.match(src, /createHomeTop\(\{ homeRoot: homeRootOf\(stacks\)/);
  assert.match(src, /\nhomeTop\.opened\(\);/);
  assert.match(src, /visibilitychange", \(\) => \{ if \(document\.visibilityState === "visible"\) homeTop\.opened\(\)/);
  assert.match(src, /pageshow", \(e\) => \{ if \(e\.persisted\) homeTop\.opened\(\)/);
});

// B406: once the user touched anything after the app opens or comes back, nothing moves them.
function fakeDoc() {
  const on = new Map();
  const doc = {
    visibilityState: "visible", activeElement: null,
    addEventListener(t, f) { (on.get(t) ?? on.set(t, new Set()).get(t)).add(f); },
    removeEventListener(t, f) { on.get(t)?.delete(f); },
    fire(t, e = {}) { for (const f of [...(on.get(t) ?? [])]) f(e); },
    show(state) { doc.visibilityState = state; doc.fire("visibilitychange"); },
  };
  return doc;
}
const field = () => ({ matches: (q) => q.includes("input") });

function returning({ after = 2 * 60_000, deferred = false } = {}) {
  const win = fakeWindow("#/home");
  // Browsers send hashchange in a later task: `late` holds it until flush().
  const late = [];
  const add = win.addEventListener;
  if (deferred) win.addEventListener = (t, f) => add(t, () => late.push(f));
  const stacks = createStacks({ tabs: BAR_TABS, create: () => ({ body: { scrollTop: 0 } }) });
  const router = createRouter({ win, onRoute: (r) => stacks.sync(r) });
  router.start();
  const doc = fakeDoc();
  const touch = createUserTouch(doc);
  const homeTop = createHomeTop({ homeRoot: homeRootOf(stacks), current: () => router.current(), touched: touch.touched });
  let time = 1000, refreshes = 0, blocked = false;
  const rh = createReturnHome({ afterMs: () => after, touched: touch.touched, blocked: () => blocked,
    goHome: () => router.goNow({ tab: "home", path: [] }), refresh: () => refreshes++, now: () => time });
  doc.addEventListener("visibilitychange", () => (doc.visibilityState === "hidden" ? rh.hidden() : rh.visible()));
  doc.addEventListener("visibilitychange", () => { if (doc.visibilityState === "visible") homeTop.opened(); });
  return { router, stacks, doc, touch, wait: (ms) => { time += ms; }, refreshes: () => refreshes,
    block: (v) => { blocked = v; }, flush: () => { for (const f of late.splice(0)) f(); },
    tap: (tab) => { doc.fire("pointerdown"); doc.fire("click"); router.selectTab(tab); } };
}

test("B406: a late visible event after a tap keeps the tab, and still refreshes", () => {
  const a = returning();
  a.doc.show("hidden");
  a.wait(10 * 60_000);
  a.tap("search"); // iOS: the tap lands while the page still says hidden
  a.doc.show("visible");
  assert.deepEqual(a.router.current(), { tab: "search", path: [] });
  assert.equal(a.refreshes(), 1);
  a.wait(10 * 60_000);
  a.doc.show("visible"); // a second, later event moves nobody either
  assert.equal(a.router.current().tab, "search");
  assert.equal(a.refreshes(), 1);
});

test("B406: without a touch Return to Home goes Home at once, in the same event", () => {
  const a = returning({ deferred: true });
  a.router.goNow({ tab: "search", path: [] });
  a.flush();
  a.doc.fire("pointerdown"); // used before it was left: not a touch of the coming return
  a.doc.show("hidden");
  a.wait(10 * 60_000);
  a.doc.show("visible");
  assert.deepEqual(a.router.current(), { tab: "home", path: [] });
  assert.equal(a.refreshes(), 1);
  a.tap("search"); // before the move's hashchange: that one finds nothing left to do
  a.flush();
  assert.deepEqual(a.router.current(), { tab: "search", path: [] });
});

test("B406: not away long enough, Never, or a popup up: nothing, and not later either", () => {
  for (const [after, ms, blocked] of [[120_000, 60_000, false], [0, 1e9, false], [120_000, 1e6, true]]) {
    const a = returning({ after });
    a.router.selectTab("search");
    a.block(blocked);
    a.doc.show("hidden");
    a.wait(ms);
    a.doc.show("visible");
    a.block(false);
    a.wait(1e6);
    a.doc.show("visible");
    assert.equal(a.router.current().tab, "search");
    assert.equal(a.refreshes(), 0);
  }
});

test("B406: the visible event doesn't scroll Home under a finger already on it", () => {
  const a = returning({ after: 0 });
  const body = a.stacks.stack("home")[0].page.body;
  a.doc.show("hidden");
  a.doc.fire("touchstart");
  body.scrollTop = 200;
  a.doc.show("visible");
  assert.equal(body.scrollTop, 200);
});

test("B406: userTouch: what counts, and that going hidden starts over", async () => {
  const doc = fakeDoc();
  const u = createUserTouch(doc);
  assert.equal(u.touched(), false);
  await u.untilAway();
  for (const t of ["pointerdown", "touchstart", "click", "keydown", "input", "wheel"]) {
    doc.fire(t);
    assert.equal(u.touched(), true, t);
    doc.show("hidden");
    assert.equal(u.touched(), false);
    doc.show("visible");
  }
  const f = field();
  doc.activeElement = f;
  doc.show("hidden");
  doc.show("visible");
  doc.fire("focusin", { target: f }); // iOS gives the field its focus back
  assert.equal(u.touched(), false);
  doc.fire("focusin", { target: field() });
  assert.equal(u.touched(), true);
  let away = false;
  const p = u.untilAway().then(() => { away = true; });
  await Promise.resolve();
  assert.equal(away, false);
  doc.show("hidden");
  await p;
});

test("B406: untilNotTyping waits until no field has the focus", async () => {
  const doc = fakeDoc();
  await untilNotTyping(doc);
  doc.activeElement = field();
  let done = false;
  const p = untilNotTyping(doc).then(() => { done = true; });
  await Promise.resolve();
  assert.equal(done, false);
  doc.activeElement = null; // removed from the page: no focusout
  await p;
});

test("B406: a slow first mount doesn't override a tab tapped meanwhile", async () => {
  const ends = {}; // tab -> end of its load
  const shown = [];
  let ready = 0;
  const onRoute = newestRoute({ need: (r) => (r.tab === "home" ? [] : [r.tab]), load: ([n]) => new Promise((ok, no) => { ends[n] = { ok, no }; }),
    loaded: () => { ready++; }, show: (r) => shown.push(r.tab) });
  const settle = () => new Promise((r) => setTimeout(r, 0));
  onRoute({ tab: "changes", path: [] }); // the launch's own route, still loading
  onRoute({ tab: "search", path: [] }); // tapped
  ends.search.ok();
  await settle();
  ends.changes.ok();
  await settle();
  assert.deepEqual(shown, ["search"]);
  assert.equal(ready, 2);
  onRoute({ tab: "sources", path: [] });
  onRoute({ tab: "home", path: [] });
  ends.sources.no(new Error("offline"));
  await settle();
  assert.deepEqual(shown, ["search", "home"]);
  onRoute({ tab: "installed", path: [] });
  ends.installed.no(new Error("offline"));
  await settle();
  assert.equal(shown.at(-1), "installed"); // a failed load still shows
});

test("B406: app.js wires Return to Home through goNow, never the async go", () => {
  const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(src, /router\.goNow\(\{ tab: "home", path: \[\] \}\)/);
  assert.doesNotMatch(src, /router\.go\(\{ tab: "home"/);
  assert.match(src, /touched: userTouch\.touched/);
});
