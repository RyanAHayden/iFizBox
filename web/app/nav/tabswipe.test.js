// F390: swiping between the Details / Reviews / Related tabs: which touches may (direction, edge strip, sideways
// scrollers, rows), that swipe back and the tabs never share one, and what the panes do (follow, threshold, flick,
// lazy fill, rubber band, scroll kept, rapid swipes, reduced motion).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDocument } from "../fakes.test-helper.js";
import { tabPager, rubber } from "./tabswipe.js";
import { attachTabSwipe, attachPageSwipe, tabSwipeDecide, tabSwipeTakesBack } from "./swipe.js";

const W = 400, H = 800, TOP = 200;

// A page body with a header and three panes of these heights, laid out just enough: the header is TOP tall, then the
// pane in the flow, then 20px.
function page({ heights = [2000, 2000, 2000], motion = true } = {}) {
  const doc = fakeDocument();
  globalThis.matchMedia = (q) => ({ matches: !motion && q.includes("reduced-motion") });
  const body = doc.createElement("div");
  body.className = "page-body";
  doc.body.append(body);
  const head = doc.createElement("div");
  const panes = heights.map(() => doc.createElement("div"));
  body.append(head, ...panes);
  const anims = [];
  let scroll = 0;
  const flow = () => panes.find((p) => !p.hidden && p.style.position !== "absolute");
  const height = () => Math.max(H + 1, TOP + (flow()?.full ?? 0) + 20);
  Object.defineProperties(body, {
    clientWidth: { value: W }, clientHeight: { value: H }, scrollHeight: { get: height },
    scrollTop: { get: () => Math.min(scroll, height() - H), set: (v) => { scroll = v; } },
  });
  panes.forEach((p, i) => {
    p.full = heights[i];
    Object.defineProperties(p, {
      offsetTop: { value: TOP }, offsetLeft: { value: 0 }, offsetWidth: { value: W },
      offsetHeight: { get: () => (p.hidden ? 0 : p.style.height ? parseFloat(p.style.height) : p.full) },
    });
    p.hidden = i > 0;
  });
  for (const el of [head, ...panes]) {
    el.animate = (frames, opts) => {
      const a = { el, frames, opts, currentTime: 0, cancelled: false, cancel() { a.cancelled = true; } };
      anims.push(a);
      return a;
    };
  }
  const marks = [], fills = [];
  const pager = tabPager({ panes, mark: (i) => marks.push(i), fill: (i) => fills.push(i) });
  pager.select(0);
  pager.attach(body);
  fills.length = marks.length = 0;
  const done = () => { for (const a of anims.splice(0)) a.onfinish?.(); };
  const x = (i) => Number(/translate3d\((-?[\d.]+)/.exec(panes[i].style.transform)?.[1] ?? 0);
  const y = (n) => Number(/,(-?[\d.]+)px,0\)/.exec(n.style.transform ?? "")?.[1] ?? 0);
  const swipe = (dx, vx = 0) => { pager.begin(Math.sign(dx) * 11); pager.move(dx); pager.end(dx, vx, false); };
  const atRest = (i) => {
    assert.equal(pager.selected(), i);
    panes.forEach((p, j) => {
      assert.equal(p.hidden, j !== i);
      for (const k of ["transform", "position", "height", "top"]) assert.ok(!p.style[k], `pane ${j} ${k}`);
    });
    assert.ok(!head.style.transform);
  };
  return { body, head, panes, pager, marks, fills, anims, done, x, y, swipe, atRest };
}

test("decide: leftward always, rightward only with a tab before, never a vertical move", () => {
  assert.equal(tabSwipeDecide(-10, 0, false), "wait", "the slop");
  assert.equal(tabSwipeDecide(-11, 0, false), "swipe");
  assert.equal(tabSwipeDecide(11, 0, true), "swipe");
  assert.equal(tabSwipeDecide(11, 0, false), "none", "Details: swipe back's");
  assert.equal(tabSwipeDecide(-20, 20, true), "none", "45 degrees is a scroll");
  assert.equal(tabSwipeDecide(5, -30, true), "none");
  assert.equal(tabSwipeDecide(-30, 20, true), "swipe", "more sideways");
});

test("the panes follow the finger side by side, the neighbour filled as the drag begins; past half it settles", () => {
  const p = page();
  p.pager.begin(-11);
  assert.deepEqual(p.fills, [1]);
  p.pager.move(-120);
  assert.deepEqual([p.x(0), p.x(1)], [-120, 280]);
  assert.equal(p.panes[1].hidden, false);
  assert.equal(p.panes[1].style.position, "absolute", "out of the flow: the page's height stays its own");
  assert.equal(p.panes[2].hidden, true);
  p.pager.move(-230);
  p.pager.end(-230, 0, false);
  assert.deepEqual(p.marks, [1]);
  p.done();
  p.atRest(1);
});

test("short of half it slides back, a flick carries it, a flick back or a cancelled touch doesn't", () => {
  for (const [dx, vx, cancelled, to] of [[-150, 0, false, 0], [-60, -1, false, 1], [-260, 1, false, 0], [-260, -1, true, 0]]) {
    const p = page();
    p.pager.begin(-11);
    p.pager.move(dx);
    p.pager.end(dx, vx, cancelled);
    p.done();
    p.atRest(to);
    assert.deepEqual(p.marks, to ? [1] : []);
  }
});

test("one swipe moves one tab; right goes back one; Related rubber-bands; Details doesn't pass its start", () => {
  const p = page();
  p.swipe(-5000, -9);
  p.done();
  p.atRest(1);
  p.swipe(-300);
  p.done();
  p.pager.begin(-11);
  p.pager.move(-200);
  assert.ok(p.x(2) < 0 && p.x(2) > -110, `rubber band, not 1:1 (${p.x(2)})`);
  p.pager.end(-200, -2, false);
  p.done();
  p.atRest(2);
  p.swipe(300);
  p.done();
  p.atRest(1);
  p.swipe(300);
  p.done();
  p.atRest(0);
  p.pager.begin(-11);
  p.pager.move(100); // left, then back past the start
  assert.ok(p.x(0) > 0 && p.x(0) < 60);
  p.pager.end(100, 2, false);
  p.done();
  p.atRest(0);
  assert.ok(rubber(-100000, W) > -W);
});

test("a tap on a tab slides the same way, two tabs across too; only transforms animate", () => {
  const p = page();
  p.pager.select(2);
  assert.deepEqual(p.marks, [2]);
  assert.deepEqual(p.anims.map((a) => [p.panes.indexOf(a.el), a.frames[0].transform, a.frames[1].transform]),
    [[2, "translate3d(400px,0px,0)", "translate3d(0px,0px,0)"], [0, "translate3d(0px,0px,0)", "translate3d(-400px,0px,0)"]]);
  for (const a of p.anims) for (const f of a.frames) assert.deepEqual(Object.keys(f), ["transform"]);
  assert.deepEqual(p.fills, [2], "Reviews isn't asked for");
  p.done();
  p.atRest(2);
  p.pager.select(0);
  assert.equal(p.anims[0].frames[0].transform, "translate3d(-400px,0px,0)", "from the left");
  p.done();
  p.atRest(0);
});

test("a shorter pane: shown where it will be, the header slides in, nothing jumps as it is chosen", () => {
  const p = page({ heights: [2000, 900, 900] });
  p.body.scrollTop = 1000;
  const shown = (n, top) => top - p.body.scrollTop + p.y(n); // where a box at `top` shows
  p.pager.begin(-11);
  p.pager.move(-230);
  assert.equal(p.body.scrollTop, 1000, "the drag scrolls nothing");
  const at = shown(p.panes[1], TOP);
  assert.equal(at, TOP - 320, "where it will be: the page ends 320 down");
  const old = shown(p.panes[0], TOP), head = shown(p.head, 0);
  p.pager.end(-230, 0, false);
  assert.equal(p.body.scrollTop, 320);
  const first = (n, top) => { const a = p.anims.find((z) => z.el === n); return top - 320 + Number(/,(-?\d+)px,0\)/.exec(a.frames[0].transform)[1]); };
  assert.equal(first(p.panes[1], TOP), at);
  assert.equal(first(p.panes[0], TOP), old);
  assert.equal(first(p.head, 0), head);
  p.done();
  p.atRest(1);
  assert.equal(p.body.scrollTop, 320);
});

test("rapid swipes: a second drag takes the slide over where it is; a tap during a slide too", () => {
  const p = page();
  p.swipe(-300);
  const sliding = [...p.anims];
  p.pager.begin(-11); // the slide has only begun: Reviews still 100 from its place
  assert.ok(sliding.every((a) => a.cancelled));
  assert.equal(p.x(1), 100);
  p.pager.move(-50);
  assert.deepEqual([p.x(0), p.x(1)], [-350, 50], "from where it was");
  p.pager.move(-320);
  assert.deepEqual([p.x(1), p.x(2)], [-220, 180]);
  assert.equal(p.panes[0].hidden, true);
  p.pager.end(-320, 0, false);
  p.done();
  p.atRest(2);
  p.pager.select(1);
  p.pager.select(0);
  p.pager.select(2);
  p.done();
  p.atRest(2);
  p.pager.select(0);
  p.pager.begin(-11); // a slide across two tabs ends first
  assert.equal(p.x(0), 0);
  p.pager.end(0, 0, true);
  p.done();
  p.atRest(0);
});

test("reduced motion: nothing follows the finger, the tab switches as it lets go", () => {
  const p = page({ motion: false });
  p.pager.begin(-11);
  p.pager.move(-230);
  assert.equal(p.x(0), 0);
  assert.equal(p.panes[1].hidden, true);
  p.pager.end(-230, 0, false);
  p.atRest(1);
  p.pager.select(2);
  p.atRest(2);
  assert.equal(p.anims.length, 0);
});

// ---- the touches: both swipes on one root, as app.js attaches them
function touches(p) {
  const on = {};
  const root = { addEventListener: (t, f, o) => { assert.equal(o.passive, true); (on[t] ??= []).push(f); } };
  globalThis.requestAnimationFrame = (f) => { f(); return 0; };
  globalThis.cancelAnimationFrame = () => {};
  const win = { getComputedStyle: (e) => ({ touchAction: "auto", overflowX: e.overflowX ?? "visible" }), getSelection: () => null };
  let back = 0, popup = false;
  attachPageSwipe(root, { canStart: () => true, blocked: (t) => tabSwipeTakesBack(t), begin: () => { back++; return W; }, move() {}, end() {} }, win);
  attachTabSwipe(root, { canStart: () => true, blocked: () => popup }, win);
  const fire = (t, e) => on[t].forEach((f) => f(e));
  const pt = (x, y) => ({ identifier: 1, clientX: x, clientY: y });
  const drag = (target, x0, x1, y1 = 300) => {
    fire("touchstart", { target, touches: [0], changedTouches: [pt(x0, 300)] });
    for (const k of [.2, .6, 1]) fire("touchmove", { changedTouches: [pt(x0 + (x1 - x0) * k, 300 + (y1 - 300) * k)], timeStamp: 0 });
    fire("touchend", { changedTouches: [pt(x1, y1)], timeStamp: 0 });
    p.done();
    return [p.pager.selected(), back];
  };
  return { drag, popup: (v) => { popup = v; } };
}

test("swipe back on Details only; on Reviews and Related a right swipe is the tab before; never both", () => {
  const p = page();
  const t = touches(p);
  for (const target of [p.head, p.panes[0]]) assert.deepEqual(t.drag(target, 350, 50), [p.panes.indexOf(target) === 0 ? 2 : 1, 0]);
  assert.deepEqual(t.drag(p.panes[2], 50, 350), [1, 0]);
  assert.deepEqual(t.drag(p.panes[1], 50, 350), [0, 0]);
  assert.deepEqual(t.drag(p.panes[0], 50, 350), [0, 1], "Details: back");
  assert.deepEqual(t.drag(p.panes[0], 350, 300, 600), [0, 1], "a scroll is neither");
});

test("never from the edge strip, a sideways scroller at either end, a swipe row, or under a popup", () => {
  const p = page();
  const t = touches(p);
  p.pager.select(1);
  p.done();
  assert.deepEqual(t.drag(p.panes[1], 20, 380), [1, 0], "the edge strip's place");
  const gallery = fakeDocument().createElement("div");
  Object.assign(gallery, { overflowX: "auto", scrollWidth: 900, clientWidth: 300, scrollLeft: 0 });
  gallery.matches = () => false;
  for (const n of [...p.panes, p.body]) n.matches = () => false;
  p.panes[1].append(gallery);
  for (const at of [0, 200, 600]) {
    gallery.scrollLeft = at;
    assert.deepEqual(t.drag(gallery, 350, 50), [1, 0]);
    assert.deepEqual(t.drag(gallery, 50, 350), [1, 0]);
  }
  const row = fakeDocument().createElement("div");
  row.className = "pkg-row";
  p.panes[1].append(row);
  assert.deepEqual(t.drag(row, 350, 50), [1, 0]);
  t.popup(true);
  assert.deepEqual(t.drag(p.panes[1], 350, 50), [1, 0]);
  t.popup(false);
  assert.deepEqual(t.drag(p.panes[1], 350, 50), [2, 0]);
});

test("a page drawn again has the new panes; a body showing something else has none", () => {
  const p = page();
  const t = touches(p);
  p.body.replaceChildren();
  assert.equal(tabSwipeTakesBack(p.body), false);
  assert.deepEqual(t.drag(p.body, 350, 50), [0, 0]);
});
