// A hold on a package or app page's Install (Modify, Upgrade, Reinstall, the price): the nav spec carries onHold, app.js
// wires it with nav/menu.js holdButton (HOLD_MS, the tap's click eaten, a short tap unchanged). What the hold does is
// browse.js installHold (installtap.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDocument } from "../nav/fakedom.test-helper.js";
import { nav } from "./browse.js";

// Listeners kept by phase, dispatched as a browser would (as nav/menu-hold.test.js).
function phased(target) {
  const on = {};
  target.on = on;
  target.addEventListener = (t, f, o) => { const c = o === true || o?.capture ? "c" : "b"; (on[t + c] ??= new Set()).add(f); };
  target.removeEventListener = (t, f, o) => { const c = o === true || o?.capture ? "c" : "b"; on[t + c]?.delete(f); };
  return target;
}
function dispatch(doc, target, type, e = {}) {
  const ev = { type, target, detail: 1, pointerId: 1, isPrimary: true, clientX: 300, clientY: 20, defaultPrevented: false, stopped: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...e };
  const path = [];
  for (let n = target; n; n = n.parentNode) path.push(n);
  const run = (node, phase) => { for (const f of [...(node.on?.[type + phase] ?? [])]) f(ev); };
  run(doc, "c");
  for (const n of [...path].reverse()) { if (ev.stopped) return ev; run(n, "c"); }
  for (const n of path) { if (ev.stopped) return ev; run(n, "b"); }
  return ev;
}
function barButton() {
  const doc = phased(fakeDocument());
  const make = doc.createElement;
  doc.createElement = (t) => phased(make(t));
  phased(doc.body);
  globalThis.document = doc;
  const b = doc.createElement("button");
  b.classList.add("bar-button");
  doc.body.append(b);
  let clicks = 0;
  b.addEventListener("click", () => { clicks++; });
  return { doc, b, clicks: () => clicks };
}

const ROUTE = { tab: "sources", path: ["src1", "package:com.ex.tweak"] };

test("the package page's nav spec: Install taps and holds", () => {
  const spec = nav(ROUTE).right;
  assert.equal(spec.label, "Install");
  assert.equal(typeof spec.onClick, "function");
  assert.equal(typeof spec.onHold, "function");
});

test("holdButton: a ~0.5 s hold runs onHold and eats its click; a tap clicks; no callout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { holdButton, HOLD_MS } = await import("../nav/menu.js");
  assert.ok(HOLD_MS >= 500 && HOLD_MS <= 600);
  const { doc, b, clicks } = barButton();
  const held = [];
  holdButton(b, (x) => held.push(x), { doc });

  dispatch(doc, b, "pointerdown");
  t.mock.timers.tick(HOLD_MS - 1);
  assert.equal(held.length, 0);
  t.mock.timers.tick(1);
  assert.deepEqual(held, [b]);
  dispatch(doc, b, "pointerup");
  assert.ok(dispatch(doc, b, "click").defaultPrevented);
  assert.equal(clicks(), 0, "the hold's lift doesn't open Install's sheet too");

  dispatch(doc, b, "pointerdown", { pointerId: 2 });
  t.mock.timers.tick(100);
  dispatch(doc, b, "pointerup", { pointerId: 2 });
  dispatch(doc, b, "click", { pointerId: 2 });
  t.mock.timers.tick(HOLD_MS);
  assert.equal(clicks(), 1);
  assert.equal(held.length, 1);

  assert.ok(dispatch(doc, b, "contextmenu").defaultPrevented);
});
