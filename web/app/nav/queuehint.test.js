// F272: the queue's hint shows on a tap of Installed while the Q'd badge is up (B130: never on queuing), until the Installed tab has been held once (kept in Settings'
// storage), and at most once per queued run; a hold on the tab opens the queue only while the badge is up.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { nextHint, createQueueHint, HINT_TEXT, SHOW_MS } from "./queuehint.js";
import { HOLD_MS } from "./menu.js";
import { createSettings } from "../core/settings.js";
import { fakeDocument } from "./fakedom.test-helper.js";

test("rules: shows on a tap of Installed with the badge up, never held, not yet shown this run", () => {
  const tapped = true;
  assert.deepEqual(nextHint({ shown: false }, { queued: true, badge: true, held: false, tapped }), { state: { shown: true }, show: true });
  assert.deepEqual(nextHint({ shown: false }, { queued: true, badge: true }), { state: { shown: false }, show: false },
    "B130: queuing (the badge coming up) alone never shows it");
  assert.equal(nextHint({ shown: true }, { queued: true, badge: true, tapped }).show, false, "once per run");
  assert.equal(nextHint({ shown: false }, { queued: true, badge: true, held: true, tapped }).show, false, "held once: never again");
  assert.equal(nextHint({ shown: false }, { queued: true, badge: false, tapped }).show, false, "no badge (Confirm open, a run going)");
  assert.equal(nextHint({ shown: false }, { queued: false, badge: false, tapped }).show, false);
});

test("rules: the badge hiding (Confirm open) keeps the run; an empty queue ends it", () => {
  const tapped = true;
  let s = nextHint({ shown: false }, { queued: true, badge: true, tapped }).state;
  s = nextHint(s, { queued: true, badge: false }).state; // Confirm sheet up, then Continue Queuing
  assert.equal(nextHint(s, { queued: true, badge: true, tapped }).show, false);
  s = nextHint(s, { queued: false, badge: false }).state; // run or Cancel emptied it
  assert.deepEqual(s, { shown: false });
  assert.equal(nextHint(s, { queued: true, badge: true, tapped }).show, true, "the next queued run shows it again");
});

function mem(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

test("settings remember the hold on the device", () => {
  const storage = mem();
  const a = createSettings({ storage });
  assert.equal(a.queueHint.held(), false);
  const heard = [];
  a.onChange((k, v) => heard.push([k, v]));
  a.queueHint.markHeld();
  a.queueHint.markHeld();
  assert.deepEqual(heard, [["queueHintHeld", true]]);
  assert.equal(storage.m.get("ifizbox.queueHintHeld"), "true");
  assert.equal(createSettings({ storage }).queueHint.held(), true, "a new launch still knows");
});

// The shared fake DOM, plus: the tab bar with its Installed tab, the document's body, event dispatch with capture
// and bubble. Listeners are kept by phase in `on` ("<type>c" for capture, "<type>b" for bubble).
function phased(el) {
  const on = {};
  el.on = on;
  el.addEventListener = (t, f, o) => { const c = o === true || o?.capture ? "c" : "b"; (on[t + c] ??= new Set()).add(f); };
  el.removeEventListener = (t, f, o) => { const c = o === true || o?.capture ? "c" : "b"; on[t + c]?.delete(f); };
  return el;
}
const target = (extra = {}) => Object.assign(phased(fakeDocument()), extra);
const dom = fakeDocument();
// An element with the tab bar's sizes; `tag` "a" for a tab (queuehint.js looks for "a.tab").
function node(cls = "", tag = "div") {
  return Object.assign(phased(dom.createElement(tag)), {
    className: cls, offsetWidth: 220, offsetHeight: 38,
    getBoundingClientRect: () => ({ left: 192, top: 431, width: 64, height: 49, bottom: 480 }),
  });
}
function dispatch(doc, t, type, e = {}) {
  const ev = { type, target: t, detail: 1, isPrimary: true, clientX: 220, clientY: 450, defaultPrevented: false, stopped: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...e };
  const path = [];
  for (let n = t; n; n = n.parentNode) path.push(n);
  const run = (n, phase) => { for (const f of [...(n.on[type + phase] ?? [])]) f(ev); };
  run(doc, "c");
  for (const n of [...path].reverse()) { if (ev.stopped) return ev; run(n, "c"); }
  for (const n of path) { if (ev.stopped) return ev; run(n, "b"); }
  return ev;
}
function setup({ held = false, style = "ios6", win = {} } = {}) {
  const body = node();
  const root = { style, getAttribute: (n) => (n === "data-style" ? root.style : null) }; // <html data-style>: the era
  const doc = target({ body, documentElement: root, createElement: () => node() });
  const bar = node("tabbar");
  const tab = node("tab", "a");
  bar.append(tab);
  bar.querySelector = (sel) => (sel.includes('data-tab="installed"') ? tab : null);
  let isHeld = held;
  const store = { held: () => isHeld, markHeld: () => { isHeld = true; } };
  const hint = createQueueHint({ bar, store, doc, win: { innerWidth: 320, innerHeight: 480, ...win }, showMs: 60_000 });
  return { body, doc, root, bar, tab, hint, store, opened: [] };
}

test("B343: the iOS 26 era never shows the hint (the app's own tab bar takes the hold there); every other era does", () => {
  const t = setup({ style: "ios26" });
  t.hint.update({ queued: true, badge: true });
  assert.equal(t.hint.tapped(), false);
  dispatch(t.doc, t.tab, "click");
  assert.equal(t.hint.toast, null);
  assert.equal(t.body.children.length, 0);
  t.root.style = "ios13"; // switched away in the same run: its first tap still shows it (iOS 26 used up nothing)
  assert.equal(t.hint.tapped(), true);
  t.hint.hide();
  // already showing when Theme > Style switches to iOS 26: it goes at once
  const watchers = [];
  class MO { constructor(f) { this.f = f; watchers.push(this); } observe() { this.on = true; } disconnect() { this.on = false; } }
  const w = setup({ style: "ios13", win: { MutationObserver: MO } });
  w.hint.update({ queued: true, badge: true });
  assert.equal(w.hint.tapped(), true);
  assert.equal(watchers.length, 1);
  w.root.style = "ios26";
  watchers[0].f();
  assert.equal(w.hint.toast, null);
  assert.equal(w.body.children.length, 0);
  assert.equal(watchers[0].on, false, "the watch stops with it");
  for (const style of ["ios6", "ios7", "ios13"]) {
    const u = setup({ style });
    u.hint.update({ queued: true, badge: true });
    assert.equal(u.hint.tapped(), true, style);
    u.hint.hide();
  }
});

test("B130: queuing never shows the hint (it would cover the 'added to queue' toast); a tap on Installed does", () => {
  const t = setup();
  assert.equal(t.hint.update({ queued: true, badge: true }), false);
  assert.equal(t.hint.update({ queued: true, badge: true }), false, "a second queued item");
  assert.equal(t.body.children.length, 0, "no hint after queue adds");
  assert.equal(t.hint.toast, null);
  dispatch(t.doc, t.tab, "click");
  assert.ok(t.hint.toast, "tapping Installed shows it");
  assert.equal(t.body.children.length, 1);
  t.hint.hide();
});

test("a tap on another tab does not show the hint", () => {
  const t = setup();
  const other = node("tab", "a");
  t.bar.append(other);
  t.hint.update({ queued: true, badge: true });
  dispatch(t.doc, other, "click");
  assert.equal(t.hint.toast, null);
  assert.equal(t.body.children.length, 0);
});

test("a tap on Installed with nothing queued shows nothing", () => {
  const t = setup();
  dispatch(t.doc, t.tab, "click");
  t.hint.update({ queued: false, badge: false });
  dispatch(t.doc, t.tab, "click");
  assert.equal(t.body.children.length, 0);
});

test("the hint shows once over the Installed tab, with its text and arrow, and not again this run", () => {
  const t = setup();
  t.hint.update({ queued: true, badge: true });
  assert.equal(t.hint.tapped(), true);
  const el = t.body.children[0];
  assert.ok(el.classList.contains("queue-hint"));
  assert.equal(el.children[0].textContent, HINT_TEXT);
  assert.equal(HINT_TEXT, "Hold Installed to see the queue");
  assert.ok(el.children[1].classList.contains("queue-hint-arrow"));
  assert.equal(el.style.bottom, "60px", "arrow tip just above the tab bar (480 - 431 + 10 + 1)");
  assert.equal(el.style.left, "94px", "centred over the tab: 224 - 110");
  assert.equal(el.children[1].style.left, "130px", "arrow on the tab's middle");
  assert.equal(t.hint.update({ queued: true, badge: true }), false, "a route change redraws the badge: no second hint");
  assert.equal(t.hint.tapped(), false, "a second tap this run: no second hint");
  assert.equal(t.body.children.length, 1);
  t.hint.hide();
});

test("near the screen's edge the bubble stays 6px in and the arrow still points at the tab", () => {
  const t = setup();
  t.tab.getBoundingClientRect = () => ({ left: 256, top: 431, width: 64, height: 49, bottom: 480 });
  t.hint.update({ queued: true, badge: true });
  t.hint.tapped();
  const el = t.body.children[0];
  assert.equal(el.style.left, "94px", "320 - 220 - 6");
  assert.equal(el.children[1].style.left, "194px", "tab middle 288 - 94");
  t.hint.hide();
});

test("the badge going (Confirm opened, a run started) fades the hint out", async () => {
  const t = setup();
  t.hint.update({ queued: true, badge: true });
  t.hint.tapped();
  assert.ok(t.hint.toast);
  t.hint.update({ queued: true, badge: false });
  assert.equal(t.hint.toast, null);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(t.body.children.length, 0);
});

test("it fades by itself after SHOW_MS", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const body = node();
    const doc = target({ body, createElement: () => node() });
    const bar = node();
    const tab = node("tab", "a");
    bar.append(tab);
    bar.querySelector = () => tab;
    const hint = createQueueHint({ bar, store: { held: () => false }, doc, win: { innerWidth: 320, innerHeight: 480 } });
    hint.update({ queued: true, badge: true });
    hint.tapped();
    assert.ok(hint.toast);
    mock.timers.tick(SHOW_MS - 1);
    assert.ok(hint.toast);
    mock.timers.tick(1);
    assert.equal(hint.toast, null);
  } finally {
    mock.timers.reset();
  }
});

test("never shows once the tab was held", () => {
  const t = setup({ held: true });
  t.hint.update({ queued: true, badge: true });
  assert.equal(t.hint.tapped(), false);
  assert.equal(t.body.children.length, 0);
  assert.ok(t.tab.classList.contains("hold-queue"), "the hold still opens the queue");
});

test("a hold on Installed with the badge up opens the queue, remembers it, hides the hint and eats the tap", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const t = setup();
    let opened = 0;
    t.hint.update({ queued: true, badge: true, open: () => opened++ });
    t.hint.tapped();
    assert.ok(t.hint.toast);
    dispatch(t.doc, t.tab, "pointerdown");
    mock.timers.tick(HOLD_MS);
    assert.equal(opened, 1);
    assert.equal(t.store.held(), true);
    assert.equal(t.hint.toast, null);
    const click = dispatch(t.doc, t.tab, "click");
    assert.ok(click.defaultPrevented && click.stopped, "the lift does not switch tabs");
    assert.equal(t.hint.toast, null, "the eaten lift is not a tap: no hint");
    // the next run: the hint stays away for good
    t.hint.update({ queued: false, badge: false });
    t.hint.update({ queued: true, badge: true });
    assert.equal(t.hint.tapped(), false);
  } finally {
    mock.timers.reset();
  }
});

test("without the badge a hold does nothing and the tap goes through", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const t = setup();
    let opened = 0;
    t.hint.update({ queued: true, badge: true, open: () => opened++ });
    t.hint.update({ queued: true, badge: false }); // a run is going
    assert.equal(t.tab.classList.contains("hold-queue"), false);
    dispatch(t.doc, t.tab, "pointerdown");
    mock.timers.tick(HOLD_MS * 2);
    assert.equal(opened, 0);
    assert.equal(t.store.held(), false);
    const click = dispatch(t.doc, t.tab, "click");
    assert.equal(click.defaultPrevented, false);
  } finally {
    mock.timers.reset();
  }
});

test("a quick tap on Installed with the badge up is still a tap", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const t = setup();
    let opened = 0;
    t.hint.update({ queued: true, badge: true, open: () => opened++ });
    dispatch(t.doc, t.tab, "pointerdown");
    mock.timers.tick(100);
    dispatch(t.doc, t.tab, "pointerup");
    mock.timers.tick(HOLD_MS);
    assert.equal(opened, 0);
    assert.equal(dispatch(t.doc, t.tab, "click").defaultPrevented, false);
    t.hint.hide();
  } finally {
    mock.timers.reset();
  }
});
