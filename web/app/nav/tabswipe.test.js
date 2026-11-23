// F390: a tap on the Details / Reviews / Related segments slides the panes (lazy fill, scroll kept, rapid taps,
// reduced motion). F403: nothing follows a finger; there is no swiping between the tabs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDocument } from "../fakes.test-helper.js";
import { tabPager } from "./tabswipe.js";

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
  const atRest = (i) => {
    assert.equal(pager.selected(), i);
    panes.forEach((p, j) => {
      assert.equal(p.hidden, j !== i);
      for (const k of ["transform", "position", "height", "top"]) assert.ok(!p.style[k], `pane ${j} ${k}`);
    });
    assert.ok(!head.style.transform);
  };
  return { body, head, panes, pager, marks, fills, anims, done, x, y, atRest };
}

test("a tap on a tab slides the same way, two tabs across pass the one between; only transforms animate", () => {
  const p = page();
  p.pager.select(2);
  assert.deepEqual(p.marks, [2]);
  const t = (x) => `translate3d(${x}px,0px,0)`;
  assert.deepEqual(p.anims.map((a) => [p.panes.indexOf(a.el), a.frames[0].transform, a.frames[1].transform]).sort(),
    [[0, t(0), t(-800)], [1, t(400), t(-400)], [2, t(800), t(0)]]);
  for (const a of p.anims) for (const f of a.frames) assert.deepEqual(Object.keys(f), ["transform"]);
  assert.deepEqual(p.fills, [1, 2]);
  p.done();
  p.atRest(2);
  p.pager.select(0);
  assert.equal(p.anims.find((a) => a.el === p.panes[0]).frames[0].transform, t(-800), "from the left");
  p.done();
  p.atRest(0);
});

test("a shorter pane: shown where it will be, the header slides in, nothing jumps as it is chosen", () => {
  const p = page({ heights: [2000, 900, 900] });
  p.body.scrollTop = 1000;
  const shown = (n, top) => top - p.body.scrollTop + p.y(n); // where a box at `top` shows
  p.pager.select(1);
  assert.equal(p.body.scrollTop, 320);
  const first = (n, top) => { const a = p.anims.find((z) => z.el === n); return top - 320 + Number(/,(-?\d+)px,0\)/.exec(a.frames[0].transform)[1]); };
  assert.equal(first(p.panes[1], TOP), TOP - 320, "starts where it will be: the page ends 320 down");
  assert.equal(first(p.panes[0], TOP), TOP - 1000, "the old pane starts where it was");
  assert.equal(first(p.head, 0), -1000, "the header slides from where it was");
  p.done();
  p.atRest(1);
  assert.equal(p.body.scrollTop, 320);
  void shown;
});

test("rapid taps: one during a slide takes it over; nothing on screen goes away", () => {
  const p = page();
  p.pager.select(1);
  p.pager.select(0);
  p.pager.select(2);
  p.done();
  p.atRest(2);
  p.pager.select(0);
  p.done();
  p.pager.select(1); // a tap further on while one slides
  p.pager.select(2);
  assert.deepEqual(p.anims.slice(-3).map((a) => p.panes.indexOf(a.el)).sort(), [0, 1, 2]);
  assert.equal(p.panes[0].hidden, false);
  p.done();
  p.atRest(2);
});

test("reduced motion: the tab switches at once", () => {
  const p = page({ motion: false });
  p.pager.select(1);
  p.atRest(1);
  p.pager.select(2);
  p.atRest(2);
  assert.equal(p.anims.length, 0);
});

test("a body not attached has no slide: the tab switches at once", () => {
  const p = page();
  p.body.replaceChildren();
  p.pager.select(1);
  assert.equal(p.pager.selected(), 1);
  assert.equal(p.anims.length, 0);
});
