// The edge swipe ends however the touch goes away: lifted, cancelled, its capture lost (iOS taking it for a
// notification), or a new touch arriving when the old one never ended (user 2026-11-18: back swipe stuck half way).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { attachEdgeSwipe, lockScroll } from "./swipe.js";

function setup() {
  const on = {};
  const root = { addEventListener: (t, f) => { on[t] = f; }, setPointerCapture() {} };
  const ends = [];
  let begun = 0;
  globalThis.requestAnimationFrame ??= () => 1;
  globalThis.cancelAnimationFrame ??= () => {};
  attachEdgeSwipe(root, { canStart: () => true, begin: () => { begun++; return 390; }, move() {}, end: (dx, vx) => ends.push([dx, vx]) }, {});
  const ev = (pointerId, clientX, extra = {}) => ({ pointerId, clientX, clientY: 300, isPrimary: true, button: 0, timeStamp: 0, ...extra });
  const drag = (id, x0 = 5) => { on.pointerdown(ev(id, x0)); on.pointermove(ev(id, x0 + 20)); on.pointermove(ev(id, x0 + 120)); };
  return { on, ends, drag, ev, begun: () => begun };
}

test("lifted: ends with the finger's speed; the capture lost after it adds nothing", () => {
  const s = setup();
  s.drag(1);
  s.on.pointerup(s.ev(1, 125));
  s.on.lostpointercapture(s.ev(1, 125));
  assert.equal(s.ends.length, 1);
  assert.equal(s.ends[0][0], 100);
  assert.notEqual(s.ends[0][1], -1);
});

test("capture lost with no pointerup (iOS took the touch): cancelled, and the next swipe works", () => {
  const s = setup();
  s.drag(1);
  s.on.lostpointercapture(s.ev(1, 125));
  assert.deepEqual(s.ends, [[100, -1]], "slides back");
  s.drag(2);
  s.on.pointerup(s.ev(2, 125));
  assert.equal(s.ends.length, 2);
  assert.equal(s.begun(), 2);
});

test("a touch that never ended at all: the next touch cancels it instead of being ignored", () => {
  const s = setup();
  s.drag(1);
  s.drag(2);
  assert.deepEqual(s.ends, [[100, -1]]);
  s.on.pointerup(s.ev(2, 125));
  assert.equal(s.ends.length, 2);
});

// B387: the scrollers of both pages are held while a swipe back is under way.
const scroller = (overflowY = "") => ({ style: { overflowY } });
const pageOf = (...els) => ({ querySelectorAll: (sel) => { assert.equal(sel, ".page-body, [data-scroller]"); return els; } });

test("lockScroll holds every scroller of both pages, and the release frees them once", () => {
  const top = [scroller(), scroller()], below = [scroller()];
  const unlock = lockScroll([pageOf(...top), pageOf(...below)]);
  for (const el of [...top, ...below]) assert.equal(el.style.overflowY, "hidden");
  unlock();
  for (const el of [...top, ...below]) assert.equal(el.style.overflowY, "");
  top[0].style.overflowY = "hidden"; // another hold, later
  unlock();
  assert.equal(top[0].style.overflowY, "hidden");
});

test("lockScroll leaves a scroller something else holds to it", () => {
  const pulled = scroller("hidden"), free = scroller();
  lockScroll([pageOf(pulled, free)])();
  assert.deepEqual([pulled.style.overflowY, free.style.overflowY], ["hidden", ""]);
});

test("app.js: both swipes back lock as they begin and unlock once at rest, committed or not", () => {
  const js = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const swipe = js.slice(js.indexOf("const backSwipe = {"), js.indexOf("attachEdgeSwipe(edgeEl, backSwipe)"));
  assert.match(swipe, /begin\(\) \{[^]*lockScroll\(\[top\.page\.el, below\.page\.el\]\)[^]*move\(dx\)/);
  assert.match(swipe, /slide\(top, below, [^\n]*\{\n\s*unlock\(\);[^\n]*\n\s*if \(!commit\)/);
  assert.match(js, /attachPageSwipe\(screensEl, \{\n\s*\.\.\.backSwipe,/);
});
