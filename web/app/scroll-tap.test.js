// A scroll that starts and ends on a row must not open it: any touch that moved enough to scroll, scrolled its list,
// was cancelled or went down on a still-gliding list loses its pressed look and its click (nav/tapguard.js cancelDragTaps, wired in
// app.js). A plain tap still opens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cancelDragTaps, MOVE, GLIDE_MS } from "./nav/tapguard.js";

// A node with contains/closest enough for the guard; `sel` is the one selector closest() matches.
function node(parent = null, sel = null) {
  const n = { parent, sel, contains(o) { for (let p = o; p; p = p.parent) if (p === n) return true; return false; },
    closest(s) { for (let p = n; p; p = p.parent) if (p.sel && s.includes(p.sel)) return p; return null; } };
  return n;
}
function target() {
  const on = {};
  return {
    addEventListener(t, f) { (on[t] ??= []).push(f); },
    removeEventListener(t, f) { on[t] = (on[t] ?? []).filter((g) => g !== f); },
    fire(t, e) {
      const ev = { type: t, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; },
        stopImmediatePropagation() { this.stopped = true; }, ...e };
      for (const f of on[t] ?? []) { f(ev); if (ev.stopped) break; }
      return ev;
    },
  };
}

function setup() {
  let now = 0;
  const doc = target(), win = target();
  const list = node(), row = node(list), sw = node(list, ".switch");
  let drops = 0, opened = 0;
  const st = cancelDragTaps(doc, { win, now: () => now, onDrag: () => drops++ });
  // the row's own click handler, after the guard's window-capture listener
  win.addEventListener("click", (e) => { if (!e.defaultPrevented) opened++; });
  const down = (x, y, el = row, pointerType = "touch") => doc.fire("pointerdown", { pointerId: 1, isPrimary: true, pointerType, clientX: x, clientY: y, target: el });
  const move = (x, y) => doc.fire("touchmove", { touches: [{ clientX: x, clientY: y }] });
  const up = (x, y) => doc.fire("pointerup", { pointerId: 1, clientX: x, clientY: y });
  const click = (el = row) => win.fire("click", { detail: 1, target: el });
  const scroll = (el = list) => doc.fire("scroll", { target: el });
  const cancel = () => doc.fire("pointercancel", { pointerId: 1 });
  return { st, list, row, sw, down, move, up, cancel, click, scroll, tick: (ms) => { now += ms; }, get drops() { return drops; }, get opened() { return opened; } };
}

test("a plain tap still opens the row", () => {
  const s = setup();
  s.down(100, 200); s.move(103, 204); s.up(103, 204);
  assert.equal(s.st.dragging(), false);
  s.click();
  assert.equal(s.opened, 1);
  assert.equal(s.drops, 0, "the pressed look stays for a tap");
});

test("a drag from a row released on the same row scrolls and opens nothing", () => {
  const s = setup();
  s.down(100, 200);
  s.move(100, 200 - MOVE - 20); s.scroll();
  assert.equal(s.st.dragging(), true);
  assert.equal(s.drops, 1, "the pressed look goes the moment it is a drag");
  s.move(100, 202); s.up(100, 202); // back over the same row
  const ev = s.click();
  assert.equal(s.opened, 0);
  assert.ok(ev.defaultPrevented && ev.stopped, "a link's navigation is stopped too");
});

test("moving past MOVE px is a drag even when nothing scrolled (a list that fits)", () => {
  const s = setup();
  s.down(100, 200); s.move(100, 200 + MOVE + 1); s.up(100, 200);
  s.click();
  assert.equal(s.opened, 0);
});

test("the list scrolling under a resting finger is a drag; a pane elsewhere is not", () => {
  const s = setup();
  s.down(100, 200); s.scroll(); s.up(100, 200); s.click();
  assert.equal(s.opened, 0);
  s.tick(5000);
  s.down(100, 200); s.scroll(node()); s.up(100, 200); s.click();
  assert.equal(s.opened, 1, "a carousel moving on its own doesn't cancel this tap");
});

test("a touch on a still-gliding list stops it and opens nothing, and never presses", () => {
  const s = setup();
  s.scroll(); s.tick(16); s.scroll(); s.tick(16);
  s.down(100, 200);
  assert.equal(s.st.dragging(), true, "app.js skips the pressed look while this is true");
  s.up(100, 200); s.click();
  assert.equal(s.opened, 0);
  s.tick(GLIDE_MS + 500);
  s.down(100, 200); s.up(100, 200); s.click();
  assert.equal(s.opened, 1, "once the list has stopped, a tap opens");
});

test("a cancelled touch never clicks", () => {
  const s = setup();
  s.down(100, 200);
  s.cancel();
  assert.equal(s.drops, 1);
  s.click();
  assert.equal(s.opened, 0);
});

test("a switch's own drag keeps its click; mouse and keyboard clicks always run", () => {
  const s = setup();
  s.down(100, 200, s.sw); s.move(140, 200); s.up(140, 200); s.click(s.sw);
  assert.equal(s.opened, 1, "the switch settles itself on the click after its drag");
  s.down(100, 200, s.row, "mouse"); s.move(100, 260); s.up(100, 260); s.click();
  assert.equal(s.opened, 2);
  s.down(100, 200); s.move(100, 260); s.up(100, 260);
  s.click(); // a touch click: eaten
  assert.equal(s.opened, 2);
  assert.equal(s.st.endsDrag({ detail: 0, target: s.row }), false, "el.click() and the keyboard always run");
});

test("app.js drops the pressed look on a drag and never presses during one", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(app, /cancelDragTaps\(document,\s*\{\s*onDrag:\s*\(\)\s*=>\s*dropPress\(\)/);
  assert.match(app, /!delShown && !dragTaps\.dragging\(\)\) \{ pressed = el;/);
});
