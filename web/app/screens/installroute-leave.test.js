// B134: leaving This iPhone's page (screens/installroute.js) while a step runs (pairing, or the first check) asks
// "Stop Setting Up?" first: Back, a tab bar item and the edge swipe are held back in the capture phase; Cancel stays,
// Leave cancels the pairing once and goes on to where the tap or swipe was going.
import { test } from "node:test";
import assert from "node:assert/strict";

import { fakeDocument } from "../fakes.test-helper.js";

// The shared fake DOM: enough for nav/ui.js grouped() and the pair page's sections.
globalThis.document = fakeDocument();
const make = (tag) => document.createElement(tag);

const { format, settingsRoute } = await import("../router.js");
const { drawInstallation, leave, pendingStep, guardTap, guardSwipe, guardHooks } = await import("./installroute.js");
const { leaveQuestion, LEAVE } = await import("../core/installroute.js");

const PAIR_HASH = format(settingsRoute(["installation", "pair"]));
globalThis.location = { hash: PAIR_HASH };
const flush = () => new Promise((r) => setTimeout(r, 0));
const store = () => { const m = { installRoute: "server" }; return { get: (k) => m[k], set: (k, v) => { m[k] = v; } }; };
const VPN_ON = { paired: null, pairOnPhone: true, otherVPN: false, vpn: { available: true, tested: true } };

// A pairing that waits until idevice.pairCancel ends it, as the shell's does.
function phone(over = {}) {
  const calls = [];
  let cancel = null;
  const answers = {
    "idevice.status": VPN_ON,
    "idevice.pair": () => new Promise((_, no) => { cancel = () => no(Object.assign(new Error("canceled: left"), { code: "canceled" })); }),
    "idevice.pairCancel": () => { cancel?.(); return Promise.resolve(null); },
    ...over,
  };
  return { calls, count: (m) => calls.filter((c) => c === m).length,
    call: (m, p, ev) => { calls.push(m); const a = answers[m]; return typeof a === "function" ? a(p, ev) : Promise.resolve(a); } };
}
// A tap's click event on `target` (an element whose closest() finds the selector it matches).
function clickOn(matches) {
  let clicked = 0;
  const target = { isConnected: true, closest: (sel) => (sel.split(", ").some((s) => matches === s) ? target : null), click: () => { clicked++; } };
  const ev = { target, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
  return { ev, clicks: () => clicked };
}
function answering(index) {
  const asked = [];
  guardHooks.alert = (q) => { asked.push(q); return Promise.resolve({ index }); };
  return asked;
}
async function pairingPage(native) {
  const box = make("div");
  await drawInstallation(box, "pair", { store: store(), native, alert: async () => ({ index: 0 }) });
  await flush();
  assert.equal(pendingStep(), "pairing");
  return box;
}

test("leaveQuestion: Stop Setting Up? with Cancel / Leave for a running step, nothing otherwise", () => {
  const q = leaveQuestion("pairing");
  assert.equal(q.title, "Stop Setting Up?");
  assert.deepEqual(q.buttons, ["Cancel", "Leave"]);
  assert.equal(q.cancel, 0);
  assert.equal(q.buttons[LEAVE], "Leave");
  assert.match(q.message, /stops pairing/);
  assert.match(leaveQuestion("checking").message, /stops checking/);
  assert.equal(leaveQuestion(null), null);
});

test("Back while pairing: the alert, and Cancel stays with the pairing running", async () => {
  const native = phone();
  await pairingPage(native);
  const asked = answering(0);
  const { ev, clicks } = clickOn(".bar-button.back");
  guardTap(ev);
  assert.ok(ev.prevented && ev.stopped, "app.js never sees the tap");
  await flush();
  assert.equal(asked.length, 1);
  assert.equal(asked[0].title, "Stop Setting Up?");
  assert.equal(clicks(), 0, "Cancel: not replayed");
  assert.equal(native.count("idevice.pairCancel"), 0);
  assert.equal(pendingStep(), "pairing", "still pairing");
  leave();
  await flush();
});

test("a tab bar item while pairing: Leave cancels the pairing once and replays the tap", async () => {
  const native = phone();
  await pairingPage(native);
  const asked = answering(1);
  const { ev, clicks } = clickOn("#tabbar a.tab");
  guardTap(ev);
  await flush();
  assert.equal(asked.length, 1);
  assert.equal(clicks(), 1, "the tab tap goes on");
  assert.equal(native.count("idevice.pairCancel"), 1);
  leave(); // the hashchange that follows
  await flush();
  assert.equal(native.count("idevice.pairCancel"), 1, "not cancelled twice");
  assert.equal(pendingStep(), null);
});

test("the edge swipe while pairing never starts; moving right asks, and Leave taps the top page's Back", async () => {
  const native = phone();
  await pairingPage(native);
  const asked = answering(1);
  let backs = 0;
  const doc = () => { backs++; }; // nav/go.js back
  const strip = { closest: (s) => (s === ".edge-swipe" ? strip : null) };
  const pe = (type, x, y = 100) => ({ type, pointerId: 7, clientX: x, clientY: y, target: strip, stopped: false, stopImmediatePropagation() { this.stopped = true; } });
  const down = pe("pointerdown", 5);
  guardSwipe(down, doc);
  assert.ok(down.stopped, "nav/swipe.js never sees it");
  guardSwipe(pe("pointermove", 9), doc);
  assert.equal(asked.length, 0, "not before the slop");
  guardSwipe(pe("pointermove", 40), doc);
  await flush();
  assert.equal(asked.length, 1);
  assert.equal(backs, 1);
  assert.equal(native.count("idevice.pairCancel"), 1);
  leave();
});

test("a vertical drag from the edge asks nothing", async () => {
  const native = phone();
  await pairingPage(native);
  const asked = answering(1);
  const strip = { closest: (s) => (s === ".edge-swipe" ? strip : null) };
  const pe = (type, x, y) => ({ type, pointerId: 3, clientX: x, clientY: y, target: strip, stopImmediatePropagation() {} });
  guardSwipe(pe("pointerdown", 5, 100));
  guardSwipe(pe("pointermove", 8, 160));
  guardSwipe(pe("pointermove", 60, 170));
  await flush();
  assert.equal(asked.length, 0);
  leave();
  await flush();
});

test("while the page's first check runs it asks too; once paired nothing is held back", async () => {
  let answer;
  const native = phone({ "idevice.status": () => new Promise((r) => { answer = r; }) });
  const box = make("div");
  const done = drawInstallation(box, "pair", { store: store(), native, alert: async () => ({ index: 0 }) });
  assert.equal(pendingStep(), "checking");
  const asked = answering(0);
  const first = clickOn(".bar-button.back");
  guardTap(first.ev);
  await flush();
  assert.match(asked[0].message, /stops checking/);
  answer({ ...VPN_ON, paired: "rp" });
  await done;
  assert.equal(pendingStep(), null, "paired: nothing runs");
  const later = clickOn(".bar-button.back");
  guardTap(later.ev);
  assert.equal(later.ev.prevented, false);
  assert.equal(asked.length, 1);
  leave();
});

test("off the pair page, or a tap elsewhere, is never held back", async () => {
  const native = phone();
  await pairingPage(native);
  answering(1);
  const row = clickOn(".cell-inner");
  guardTap(row.ev);
  assert.equal(row.ev.prevented, false);
  assert.equal(pendingStep(false), null);
  leave();
  await flush();
});
