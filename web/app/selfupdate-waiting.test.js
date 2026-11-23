// B123: iFizBox's own single install (signing-client.js installOnDevice): hosted, the page is locked on "Waiting for
// iOS" and followSelfUpdate turns it to "Closing iFizBox" only once the shell closes, then says to close it by hand if
// it's still open; a shell that can't be followed says so at once. This iPhone: an answer from installd means
// iFizBox wasn't closed, so the page ends unlocked with the instruction instead of a locked "Closing".
import test from "node:test";
import assert from "node:assert/strict";

const store = new Map();
Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true,
  value: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } });

const { followSelfUpdate, installOnDevice, SELF_UPDATE_LINES, forgetRoute, HERE_CLOSING_LINE } = await import("./signing-client.js");
const { lockSelfUpdate, WAITING_LABEL, CLOSING_LABEL, RETURN_LABEL, CLOSE_GRACE, CLOSE_BY_HAND, RESTART_BY_HAND } = await import("./nav/progress.js");
const { BUNDLE_ID } = await import("./brand.js");

function fakeHUD() {
  const lines = [], finishes = [];
  const page = { closed: false, step: (t) => lines.push(["step", t]), error: (t) => lines.push(["error", t]), finish: (o) => finishes.push(o) };
  const h = { page, set: () => {}, hide: () => {}, done: () => {}, finish: (o) => page.finish(o) };
  return { h, lines, finishes };
}
const native = (states) => ({
  async call(method, params, onEvent) {
    assert.equal(method, "signing.selfUpdate");
    for (const s of states) onEvent?.({ state: s });
    return { state: states.at(-1) ?? null };
  },
});

test("lockSelfUpdate: the label it is given (Waiting for iOS)", () => {
  const { h, finishes } = fakeHUD();
  lockSelfUpdate(h, { label: WAITING_LABEL });
  assert.deepEqual([finishes[0].label, finishes[0].locked], [WAITING_LABEL, true]);
});

test("followSelfUpdate waiting: Closing only at finished, then the instruction if iFizBox is still open", async () => {
  const { h, lines, finishes } = fakeHUD();
  lockSelfUpdate(h, { label: WAITING_LABEL });
  const timers = [];
  const order = [];
  const wrapped = { async call(m, p, onEvent) {
    return native(["prompt", "waiting", "downloading", "finished"]).call(m, p, (ev) => { order.push([ev.state, finishes.at(-1).label]); onEvent(ev); });
  } };
  assert.equal(await followSelfUpdate(h, { native: wrapped, waiting: true, later: (f, ms) => timers.push({ f, ms }) }), "finished");
  // the label while each state came in (before it was handled)
  assert.deepEqual(order.map(([, l]) => l), [WAITING_LABEL, WAITING_LABEL, WAITING_LABEL, WAITING_LABEL]);
  assert.deepEqual([finishes.at(-1).label, finishes.at(-1).locked], [CLOSING_LABEL, true]);
  assert.equal(finishes.length, 2);
  assert.ok(lines.some(([, t]) => t === SELF_UPDATE_LINES.finished));
  const grace = timers.find((t) => t.ms === CLOSE_GRACE); // B208: beside downloading's hint timer
  assert.ok(grace);
  grace.f();
  assert.deepEqual(lines.at(-1), ["error", CLOSE_BY_HAND]);
  assert.equal(finishes.at(-1).label, RETURN_LABEL);
  assert.ok(!finishes.at(-1).locked);
});

test("followSelfUpdate waiting: an older shell or none running says to close it by hand at once", async () => {
  for (const n of [native([]), { async call() { throw new Error("unknown method"); } }]) {
    const { h, lines, finishes } = fakeHUD();
    lockSelfUpdate(h, { label: WAITING_LABEL });
    assert.equal(await followSelfUpdate(h, { native: n, waiting: true, later: () => assert.fail("no timer") }), null);
    assert.deepEqual(lines.at(-1), ["error", CLOSE_BY_HAND]);
    assert.ok(!finishes.at(-1).locked);
  }
});

test("installOnDevice on This iPhone: iFizBox still open after installd answered ends unlocked with the instruction", async () => {
  store.set("ifizbox.installRoute", "iphone");
  forgetRoute();
  try {
    const { h, lines, finishes } = fakeHUD();
    const calls = [];
    const n = { mode: "sideload", async call(m, p) {
      calls.push(m);
      if (m === "idevice.status") return { paired: "rp", vpn: { available: true, tested: true } };
      if (m === "signing.install") { assert.equal(p.route, "idevice"); assert.ok(!p.host); return { bundleId: BUNDLE_ID, version: "2.0" }; }
      return null;
    } };
    assert.equal(await installOnDevice({ url: "https://e.example/x.ipa", name: "X", host: true }, { native: n, hud: () => h,
      later: () => assert.fail("no timer"), follow: () => assert.fail("not followed") }), true);
    assert.ok(calls.includes("signing.selfUpdate"), "B159: asks whether the shell is closing (it isn't: null)");
    assert.ok(lines.some(([k, t]) => k === "step" && t === RESTART_BY_HAND));
    assert.equal(finishes.length, 1);
    assert.ok(!finishes[0].locked);
    assert.notEqual(finishes[0].label, CLOSING_LABEL);
  } finally { store.delete("ifizbox.installRoute"); forgetRoute(); }
});

test("installOnDevice on This iPhone (B159): the shell answered for installd and is closing: locked Closing, then by hand", async () => {
  store.set("ifizbox.installRoute", "iphone");
  forgetRoute();
  try {
    const { h, lines, finishes } = fakeHUD();
    const timers = [];
    const n = { mode: "sideload", async call(m, p, onEvent) {
      if (m === "idevice.status") return { paired: "rp", vpn: { available: true, tested: true } };
      if (m === "signing.install") { assert.equal(p.route, "idevice"); return { bundleId: BUNDLE_ID, version: "2.0" }; }
      if (m === "signing.selfUpdate") { onEvent?.({ state: "finished" }); return { state: "finished" }; }
      return null;
    } };
    assert.equal(await installOnDevice({ url: "https://e.example/x.ipa", name: "X", host: true }, { native: n, hud: () => h,
      later: (f, ms) => timers.push({ f, ms }), follow: () => assert.fail("not followed") }), true);
    assert.ok(lines.some(([k, t]) => k === "step" && t === HERE_CLOSING_LINE));
    assert.ok(!lines.some(([, t]) => t === RESTART_BY_HAND));
    assert.deepEqual([finishes.at(-1).label, finishes.at(-1).locked], [CLOSING_LABEL, true]);
    const grace = timers.find((t) => t.ms === CLOSE_GRACE);
    assert.ok(grace, "a grace timer");
    grace.f();
    assert.deepEqual(lines.at(-1), ["error", CLOSE_BY_HAND]);
    assert.equal(finishes.at(-1).label, RETURN_LABEL);
    assert.ok(!finishes.at(-1).locked);
  } finally { store.delete("ifizbox.installRoute"); forgetRoute(); }
});

