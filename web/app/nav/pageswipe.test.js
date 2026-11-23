// F373: swipe back from anywhere on the page. The decide-to-start rule (direction, slop), the places it steps aside
// (sideways scrollers not at their start, text fields and sliders, custom drag areas, a list showing a Delete, text
// selected) and the touch stream (passive listeners, a second finger, a lost touch).
import { test } from "node:test";
import assert from "node:assert/strict";
import { pageSwipeDecide, pageSwipeBlocked, attachPageSwipe, lockScroll } from "./swipe.js";

test("decide: waits inside the slop, starts only rightward and more sideways than down", () => {
  assert.equal(pageSwipeDecide(0, 0), "wait");
  assert.equal(pageSwipeDecide(8, 2), "wait", "inside the slop");
  assert.equal(pageSwipeDecide(10, 0), "wait", "the slop itself");
  assert.equal(pageSwipeDecide(11, 0), "swipe");
  assert.equal(pageSwipeDecide(30, 20), "swipe", "diagonal, more sideways");
  assert.equal(pageSwipeDecide(20, 20), "none", "45 degrees is a scroll");
  assert.equal(pageSwipeDecide(5, 30), "none", "vertical: the page's scroll");
  assert.equal(pageSwipeDecide(2, -30), "none", "up too");
  assert.equal(pageSwipeDecide(-30, 0), "none", "leftward: rows' swipe actions, never back");
  assert.equal(pageSwipeDecide(-8, 3), "wait");
});

// A tiny element: classes, attributes, a parent, scroll sizes and a computed style.
function el(cls = "", { tag = "div", attrs = {}, style = {}, scroll = null, parent = null, children = [] } = {}) {
  const classes = new Set(cls.split(" ").filter(Boolean));
  const e = {
    nodeType: 1, tagName: tag.toUpperCase(), classes, attrs, style, parentElement: parent, children,
    scrollWidth: scroll?.width ?? 100, clientWidth: 100, scrollLeft: scroll?.left ?? 0,
    matches(sel) { return sel.split(", ").some((s) => one(e, s)); },
    querySelector(sel) { return sel === ":scope > .armed" ? children.find((c) => c.classes.has("armed")) ?? null : null; },
  };
  for (const c of children) c.parentElement = e;
  return e;
}
// Enough of CSS for PAGE_SWIPE_SKIP: tag, .class, [attr], [attr="v"], :not([type=x]) chains.
function one(e, sel) {
  const m = /^([a-z]*)((?:\.[\w-]+)?)((?:\[[^\]]+\])?)((?::not\(\[[^\]]+\]\))*)$/.exec(sel.trim());
  if (!m) return false;
  if (m[1] && e.tagName !== m[1].toUpperCase()) return false;
  if (m[2] && !e.classes.has(m[2].slice(1))) return false;
  const attr = (a) => {
    const [, k, v] = /^\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]$/.exec(a);
    return k in e.attrs && (v === undefined || e.attrs[k] === v);
  };
  if (m[3] && !attr(m[3])) return false;
  for (const [, a] of m[4].matchAll(/:not\((\[[^\]]+\])\)/g)) if (attr(a)) return false;
  return true;
}
const win = (selected = "") => ({
  getComputedStyle: (e) => ({ touchAction: "auto", overflowX: "visible", ...e.style }),
  getSelection: () => ({ isCollapsed: !selected, toString: () => selected }),
});

function page(...inner) {
  const root = el("screens");
  const body = el("page-body", { style: { overflowX: "hidden", touchAction: "pan-y" }, parent: root, scroll: { width: 100 } });
  let p = body;
  for (const x of inner) { x.parentElement = p; p = x; }
  return { root, target: p };
}

test("blocked: plain page content, a package row, a button may start it", () => {
  for (const x of [el("cell-inner", { tag: "a" }), el("bar-button", { tag: "button" }), el("x", { tag: "input", attrs: { type: "checkbox" } })]) {
    const { root, target } = page(x);
    assert.equal(pageSwipeBlocked(target, root, win()), "");
  }
});

test("blocked: text fields, sliders and the custom drag areas step aside", () => {
  const cases = [
    el("", { tag: "input", attrs: { type: "range" } }),
    el("", { tag: "input", attrs: { type: "text" } }),
    el("", { tag: "input" }),
    el("", { tag: "textarea" }),
    el("", { attrs: { contenteditable: "" } }),
    el("roulette-wheel"), el("switch", { tag: "button" }), el("section-index"), el("theme-preview-grip"),
    el("theme-preview-top"), el("crop-stage"), el("shot-zoom"), el("edge-swipe"),
    el("sheet", { attrs: { role: "dialog" } }),
  ];
  for (const x of cases) {
    const { root, target } = page(x);
    assert.equal(pageSwipeBlocked(target, root, win()), "control", [...x.classes].join(".") || x.tagName);
  }
  // inside one, deeper down
  const { root, target } = page(el("roulette-wheel"), el("roulette-row"));
  assert.equal(pageSwipeBlocked(target, root, win()), "control");
});

test("blocked: anything with touch-action none handles its own drags", () => {
  const { root, target } = page(el("custom", { style: { touchAction: "none" } }), el("knob"));
  assert.equal(pageSwipeBlocked(target, root, win()), "drag");
});

test("blocked: a sideways scroller steps aside until it is back at its start", () => {
  const gallery = el("dep-shots", { style: { overflowX: "auto" }, scroll: { width: 600, left: 120 } });
  const shot = el("shot", { tag: "img" });
  const { root, target } = page(gallery, shot);
  assert.equal(pageSwipeBlocked(target, root, win()), "scroller");
  gallery.scrollLeft = 0;
  assert.equal(pageSwipeBlocked(target, root, win()), "", "at its left end the swipe goes back");
  const narrow = el("dep-shots", { style: { overflowX: "auto" }, scroll: { width: 100, left: 0 } });
  assert.equal(pageSwipeBlocked(...Object.values(page(narrow)).reverse(), win()), "", "nothing to scroll");
});

test("blocked: a list showing a row's Delete keeps the right swipe (it puts the Delete away)", () => {
  const row = el("source-row", { tag: "li" });
  const other = el("source-row armed", { tag: "li" });
  const ul = el("table", { tag: "ul", children: [row, other] });
  const { root } = page(ul);
  assert.equal(pageSwipeBlocked(row, root, win()), "armed");
  other.classes.delete("armed");
  assert.equal(pageSwipeBlocked(row, root, win()), "", "no Delete showing: a right swipe goes back");
});

test("blocked: selected text keeps the drag", () => {
  const { root, target } = page(el("detail"));
  assert.equal(pageSwipeBlocked(target, root, win("some words")), "selection");
});

// The touch stream.
function setup({ canStart = () => true, blocked = () => false } = {}) {
  const on = {};
  const opts = {};
  const root = { addEventListener: (t, f, o) => { on[t] = f; opts[t] = o; } };
  const ends = [], moves = [];
  let begun = 0;
  globalThis.requestAnimationFrame = (f) => { f(); return 0; };
  globalThis.cancelAnimationFrame = () => {};
  const s = attachPageSwipe(root, { canStart, blocked, begin: () => { begun++; return 390; }, move: (dx) => moves.push(dx), end: (dx, vx) => ends.push([dx, vx]) }, {});
  const pt = (id, x, y = 300) => ({ identifier: id, clientX: x, clientY: y });
  const start = (id, x, y, n = 1) => on.touchstart({ target: {}, touches: Array(n).fill(0), changedTouches: [pt(id, x, y)] });
  const mv = (id, x, y = 300, extra = {}) => on.touchmove({ changedTouches: [pt(id, x, y)], timeStamp: 0, defaultPrevented: false, ...extra });
  const up = (id, x) => on.touchend({ changedTouches: [pt(id, x)], timeStamp: 0 });
  return { on, opts, ends, moves, start, mv, up, s, begun: () => begun };
}

test("touch: every listener is passive (vertical scrolling never waits on us)", () => {
  const s = setup();
  for (const t of ["touchstart", "touchmove", "touchend", "touchcancel"]) assert.equal(s.opts[t]?.passive, true, t);
});

test("touch: a rightward drag mid-page begins after the slop, follows from there and ends with the finger", () => {
  const s = setup();
  s.start(1, 200, 300);
  s.mv(1, 205);
  assert.equal(s.begun(), 0, "inside the slop");
  s.mv(1, 220);
  assert.equal(s.begun(), 1);
  s.mv(1, 320);
  assert.deepEqual(s.moves, [0, 100], "no jump by the slop");
  s.up(1, 320);
  assert.equal(s.ends.length, 1);
  assert.equal(s.ends[0][0], 100);
});

test("touch: a vertical scroll or a leftward drag never becomes a swipe for the rest of that touch", () => {
  const s = setup();
  s.start(1, 200, 300);
  s.mv(1, 202, 340);
  s.mv(1, 320, 340);
  s.up(1, 320);
  const l = setup();
  l.start(1, 200, 300);
  l.mv(1, 170);
  l.mv(1, 320);
  assert.equal(s.begun() + l.begun(), 0);
  assert.equal(s.ends.length + l.ends.length, 0);
});

test("touch: blocked or not allowed at the touch, nothing starts; a move a handler took (preventDefault) neither", () => {
  for (const o of [{ blocked: () => true }, { canStart: () => false }]) {
    const s = setup(o);
    s.start(1, 200, 300);
    s.mv(1, 320);
    assert.equal(s.begun(), 0);
  }
  const p = setup();
  p.start(1, 200, 300);
  p.mv(1, 230, 300, { defaultPrevented: true });
  p.mv(1, 320);
  assert.equal(p.begun(), 0);
});

test("touch: held (the pairing page's running step) asks once the drag is a swipe, and drags nothing", () => {
  let asked = 0;
  const on = {};
  const root = { addEventListener: (t, f) => { on[t] = f; } };
  let begun = 0;
  attachPageSwipe(root, { canStart: () => true, held: () => true, onHeld: () => asked++, begin: () => { begun++; return 390; }, move() {}, end() {} }, {});
  const pt = (x) => ({ identifier: 1, clientX: x, clientY: 300 });
  on.touchstart({ target: {}, touches: [0], changedTouches: [pt(200)] });
  on.touchmove({ changedTouches: [pt(205)], timeStamp: 0 });
  assert.equal(asked, 0, "not inside the slop");
  on.touchmove({ changedTouches: [pt(230)], timeStamp: 0 });
  on.touchmove({ changedTouches: [pt(300)], timeStamp: 0 });
  assert.equal(asked, 1, "asked once");
  assert.equal(begun, 0);
});

test("touch: a second finger (a pinch) cancels a swipe under way and starts none", () => {
  const s = setup();
  s.start(1, 200, 300);
  s.mv(1, 260);
  s.start(2, 100, 300, 2);
  assert.deepEqual(s.ends, [[0, -1]], "slides back");
  s.mv(2, 300);
  assert.equal(s.begun(), 1);
});

test("touch: cancelled by iOS, or the app losing focus, slides back; the next swipe works", () => {
  const s = setup();
  s.start(1, 200, 300);
  s.mv(1, 260);
  s.mv(1, 300);
  s.on.touchcancel({ changedTouches: [{ identifier: 1 }], timeStamp: 0 });
  assert.deepEqual(s.ends, [[40, -1]]);
  s.start(2, 200, 300);
  s.mv(2, 260);
  s.s.drop();
  assert.equal(s.ends.length, 2);
  assert.equal(s.ends[1][1], -1);
});

test("B387: a page swipe holds both pages from its begin to its end, lifted or cancelled; a vertical drag holds nothing", () => {
  const c = new Set();
  const page = { classList: { add: (x) => c.add(x), remove: (x) => c.delete(x) } };
  for (const stop of ["touchend", "touchcancel"]) {
    const on = {};
    let unlock;
    attachPageSwipe({ addEventListener: (t, f) => { on[t] = f; } }, {
      canStart: () => true, begin: () => { unlock = lockScroll([page]); return 390; }, move() {}, end: () => unlock(),
    }, {});
    const at = (x, y) => ({ target: {}, touches: [0], changedTouches: [{ identifier: 1, clientX: x, clientY: y }], timeStamp: 0 });
    on.touchstart(at(100, 300));
    on.touchmove(at(102, 340));
    assert.equal(c.size, 0, "a scroll");
    on.touchend(at(102, 340));
    on.touchstart(at(100, 300));
    on.touchmove(at(105, 300));
    assert.equal(c.size, 0, "not decided");
    on.touchmove(at(130, 315));
    assert.equal(c.size, 1, "decided");
    on.touchmove(at(130, 500));
    assert.equal(c.size, 1, "still held while it drags down");
    on[stop](at(130, 500));
    assert.equal(c.size, 0, stop);
  }
});
