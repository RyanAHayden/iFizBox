// F193: swiping a package row left to queue it: when a move is a swipe, how far the row goes, when it is armed, and
// that only an armed lift runs the action (a right swipe, a scroll, a cancel or a recycled row never do).
import { test } from "node:test";
import assert from "node:assert/strict";
import { swipeDecide, swipeOffset, swipeArmed, attachRowSwipe, EDGE, SLOP, ARM } from "./rowswipe.js";
import { swipeOffsetFull, swipeArmedFull, FULL_ARM, fullSwipeEra } from "./rowswipe.js"; // B332
import { fakeDocument } from "./fakedom.test-helper.js";

test("a move is a swipe only when clearly leftward; vertical is the list's, rightward the back swipe's", () => {
  assert.equal(swipeDecide(-5, 2), "wait");               // inside the slop
  assert.equal(swipeDecide(-SLOP - 1, 0), "swipe");
  assert.equal(swipeDecide(-30, 15), "swipe");
  assert.equal(swipeDecide(-30, 25), "wait");              // diagonal: not yet
  assert.equal(swipeDecide(-12, 14), "scroll");
  assert.equal(swipeDecide(3, -40), "scroll");
  assert.equal(swipeDecide(SLOP + 1, 0), "none");          // a right swipe does nothing
  assert.equal(swipeDecide(40, 20), "none");
});

test("the row follows the finger to ARM, then rubber-bands and never passes ARM + half the width", () => {
  const w = 375;
  assert.equal(swipeOffset(0, w), -0);
  assert.equal(swipeOffset(30, w), -0);                    // never right of rest
  assert.equal(swipeOffset(-50, w), -50);
  assert.equal(swipeOffset(-w * ARM, w), -w * ARM);
  const a = swipeOffset(-w * ARM - 50, w), b = swipeOffset(-w * ARM - 100, w);
  assert.ok(a < -w * ARM && a > -w * ARM - 50, "slower than the finger past ARM");
  assert.ok(b < a && (b - a) > -50, "still moves, less each step");
  assert.ok(swipeOffset(-10000, w) > -w * (ARM + 0.5));
  assert.equal(swipeArmed(-w * ARM + 1, w), false);
  assert.equal(swipeArmed(-w * ARM, w), true);
  assert.equal(swipeArmed(-200, 0), false);
});

// A list element and rows good enough for the gesture (no browser in node).
// The shared fake DOM's element, as wide as a phone; fire(t, e) runs the listeners with `e` as it is.
function fakeEl(cls = "") {
  const el = document.createElement("div");
  el.className = cls;
  el.clientWidth = 375;
  el.fire = (t, e) => { for (const f of el.listeners[t] ?? []) f(e); };
  return el;
}

function setup(action = { kind: "add" }) {
  globalThis.document = fakeDocument(); // haptic() draws a hidden switch
  globalThis.requestAnimationFrame = (f) => { queueMicrotask(f); return 1; }; // a frame later, as a browser
  globalThis.cancelAnimationFrame = () => {};
  const list = fakeEl("vlist");
  const row = fakeEl("pkg-row");
  const inner = fakeEl("cell-inner");
  row.append(inner);
  list.append(row);
  row._item = { id: "a" };
  const commits = [];
  const s = attachRowSwipe(list, { prepare: async () => action, commit: (r, a) => commits.push(a), kindOf: (a) => a.kind });
  const ev = (x, y = 300, extra = {}) => ({ pointerId: 1, clientX: x, clientY: y, isPrimary: true, button: 0, target: inner, ...extra });
  return { list, row, inner, commits, s, ev };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("let go past ARM: the action runs once and the row springs back; before ARM nothing runs", async () => {
  const t = setup();
  t.list.fire("pointerdown", t.ev(300));
  await tick();
  t.list.fire("pointermove", t.ev(285));                   // decided: a swipe, starts here
  t.list.fire("pointermove", t.ev(285 - 200));
  await tick();
  assert.ok(t.row.classList.contains("swiping"));
  assert.match(t.inner.style.transform, /translate3d\(-1/);
  assert.ok(t.row._swipeBack.classList.contains("armed"));
  assert.equal(t.row._swipeBack.dataset.kind, "add");
  t.list.fire("pointerup", t.ev(285 - 200));
  await tick();
  assert.equal(t.commits.length, 1);
  assert.equal(t.inner.style.transform, "translate3d(0,0,0)"); // springing back
  // The click the lift makes doesn't open the row.
  let opened = true;
  t.list.fire("click", { preventDefault() { opened = false; }, stopPropagation() {} });
  assert.equal(opened, false);

  const u = setup();
  u.list.fire("pointerdown", u.ev(300));
  await tick();
  u.list.fire("pointermove", u.ev(285));
  u.list.fire("pointermove", u.ev(285 - 60));
  await tick();
  assert.equal(u.row._swipeBack.classList.contains("armed"), false);
  u.list.fire("pointerup", u.ev(285 - 60));
  await tick();
  assert.equal(u.commits.length, 0);
});

test("a right swipe, a scroll, a touch at the left edge, a cancel or a recycled row run nothing", async () => {
  for (const moves of [[340, 400], [300, 300, 340], [300, 280]]) {
    const t = setup();
    t.list.fire("pointerdown", t.ev(300));
    await tick();
    for (const x of moves) t.list.fire("pointermove", t.ev(x, moves[1] === 280 ? 280 : 300));
    t.list.fire("pointerup", t.ev(moves.at(-1)));
    await tick();
    assert.equal(t.commits.length, 0);
    assert.equal(t.row.classList.contains("swiping"), false);
  }
  const edge = setup();
  edge.list.fire("pointerdown", edge.ev(EDGE - 1));
  edge.list.fire("pointermove", edge.ev(EDGE - 1 - 200));
  edge.list.fire("pointerup", edge.ev(EDGE - 1 - 200));
  await tick();
  assert.equal(edge.commits.length, 0);

  const c = setup();
  c.list.fire("pointerdown", c.ev(300));
  await tick();
  c.list.fire("pointermove", c.ev(285));
  c.list.fire("pointermove", c.ev(50));
  c.list.fire("pointercancel", c.ev(50));
  await tick();
  assert.equal(c.commits.length, 0);

  const r = setup();
  r.list.fire("pointerdown", r.ev(300));
  await tick();
  r.list.fire("pointermove", r.ev(285));
  r.list.fire("pointermove", r.ev(50));
  r.s.reset(r.row);                                        // vlist rebinds it to another package
  assert.equal(r.row.classList.contains("swiping"), false);
  assert.equal(r.inner.style.transform, "");
  r.list.fire("pointerup", r.ev(50));
  await tick();
  assert.equal(r.commits.length, 0);
});

test("a row with nothing to do doesn't move", async () => {
  const t = setup(null);
  t.list.fire("pointerdown", t.ev(300));
  await tick();
  t.list.fire("pointermove", t.ev(285));
  t.list.fire("pointermove", t.ev(50));
  assert.equal(t.row.classList.contains("swiping"), false);
  t.list.fire("pointerup", t.ev(50));
  await tick();
  assert.equal(t.commits.length, 0);
});

// B332: the full-row swipe (Installed's Delete under iOS 7 and later): 1:1 with the finger to the row's left edge, armed
// past FULL_ARM, and an armed lift slides the content off, then commits; a false from commit springs the row back.
test("a full-row swipe follows the finger 1:1, never past the row's left edge, armed past FULL_ARM", () => {
  const w = 375;
  assert.equal(swipeOffsetFull(30, w), -0);
  assert.equal(swipeOffsetFull(-200, w), -200);
  assert.equal(swipeOffsetFull(-1000, w), -w);
  assert.equal(swipeArmedFull(-w * FULL_ARM + 1, w), false);
  assert.equal(swipeArmedFull(-w * FULL_ARM, w), true);
  assert.equal(swipeArmedFull(-200, 0), false);
});

function fullSetup(result) {
  const t = setup({ kind: "remove" });
  const commits = [];
  const list = fakeEl("table");
  const row = fakeEl("installed-app");
  const inner = fakeEl("cell-inner");
  row.append(inner);
  list.append(row);
  attachRowSwipe(list, { rowSelector: ".installed-app", prepare: async () => ({ kind: "remove" }), kindOf: (a) => a.kind,
    full: () => true, commit: (r, a) => { commits.push(a); return result; } });
  const ev = (x) => t.ev(x, 300, { target: inner });
  return { list, row, inner, commits, ev };
}

test("an armed full-row lift slides the row off, then commits; false springs it back; before FULL_ARM it springs back", async () => {
  const t = fullSetup(true);
  t.list.fire("pointerdown", t.ev(300));
  await tick();
  t.list.fire("pointermove", t.ev(285));
  t.list.fire("pointermove", t.ev(285 - 250));
  await tick();
  assert.equal(t.inner.style.transform, "translate3d(-250px,0,0)");
  assert.equal(t.row._swipeBack.dataset.full, "1");
  assert.ok(t.row._swipeBack.classList.contains("armed"));
  t.list.fire("pointerup", t.ev(285 - 250));
  assert.equal(t.inner.style.transform, "translate3d(-375px,0,0)");
  assert.equal(t.commits.length, 0, "not before the slide ends");
  for (const f of t.inner.listeners.transitionend ?? []) f();
  await tick();
  await tick();
  assert.equal(t.commits.length, 1);
  assert.equal(t.inner.style.transform, "translate3d(-375px,0,0)", "stays off: removing the row is commit's");

  const no = fullSetup(false);
  no.list.fire("pointerdown", no.ev(300));
  await tick();
  no.list.fire("pointermove", no.ev(285));
  no.list.fire("pointermove", no.ev(285 - 250));
  await tick();
  no.list.fire("pointerup", no.ev(285 - 250));
  for (const f of no.inner.listeners.transitionend ?? []) f();
  await tick();
  await tick();
  assert.equal(no.commits.length, 1);
  assert.equal(no.inner.style.transform, "translate3d(0,0,0)", "Cancel: springs back");

  const short = fullSetup(true);
  short.list.fire("pointerdown", short.ev(300));
  await tick();
  short.list.fire("pointermove", short.ev(285));
  short.list.fire("pointermove", short.ev(285 - 150)); // past ARM, short of FULL_ARM
  await tick();
  assert.equal(short.inner.style.transform, "translate3d(-150px,0,0)");
  assert.ok(!short.row._swipeBack.classList.contains("armed"));
  short.list.fire("pointerup", short.ev(285 - 150));
  await tick();
  assert.equal(short.commits.length, 0);
  assert.equal(short.inner.style.transform, "translate3d(0,0,0)");
});

test("fullSwipeEra: iOS 7, 13 and 26 swipe a row off; iOS 6 (or no era set) keeps the red Delete", () => {
  const doc = (s) => ({ documentElement: { getAttribute: () => s } });
  for (const s of ["ios7", "ios13", "ios26"]) assert.equal(fullSwipeEra(doc(s)), true, s);
  assert.equal(fullSwipeEra(doc("ios6")), false);
  assert.equal(fullSwipeEra(doc(null)), false);
  assert.equal(fullSwipeEra(doc("ios99")), false, "an era it doesn't know keeps the button");
  assert.equal(fullSwipeEra(undefined), false);
});

// B332: each era draws the strip: iOS 6 the kit's control over the pinstripes; iOS 7, 13 and 26 a flat strip per kind
// (green add, red remove, grey cancel) with a plain white glyph (no rim, gloss or shadow).
test("the row swipe's look per era: pinstripes in iOS 6, a flat colour per kind in iOS 7, 13 and 26", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../packages.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  // every rule with exactly this selector, their declarations joined (null: none)
  const rule = (sel) => [...css.matchAll(new RegExp(`(^|\\})\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "g"))]
    .map((m) => m[2]).join(";") || null;
  assert.match(rule(".row-swipe") ?? "", /repeating-linear-gradient/, "iOS 6: the pinstripes");
  assert.match(rule('html[data-style="ios7"]') ?? "", /--swipe-add:\s*#4cd964;\s*--swipe-remove:\s*#ff3b30;\s*--swipe-cancel:/);
  assert.match(rule('html:is([data-style="ios13"], [data-style="ios26"])') ?? "", /--swipe-add:\s*#34c759/);
  const eras = 'html:is([data-style="ios7"], [data-style="ios13"], [data-style="ios26"])';
  assert.match(rule(`${eras} .row-swipe`) ?? "", /background:\s*var\(--swipe-add\);\s*box-shadow:\s*none/);
  assert.match(rule(`${eras} .row-swipe[data-kind="remove"]`) ?? "", /var\(--swipe-remove\)/);
  assert.match(rule(`${eras} .row-swipe .row-swipe-control`) ?? "", /border:\s*0;.*box-shadow:\s*none;\s*background:\s*none/);
  assert.match(rule(`${eras} .row-swipe .row-swipe-control::before`) ?? "", /display:\s*none/, "no gloss");
  // Installed's rows show the strip too.
  assert.ok(rule(".pkg-row.swiping > .row-swipe, .installed-app.swiping > .row-swipe"));
});
