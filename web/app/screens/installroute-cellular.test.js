// B428a: on cellular without Wi-Fi iOS refuses This iPhone's connects, so Check Connection, Fix, Test Connection and Set
// Up don't connect and say Can't Check on Cellular: no Fix, no Pair Again, nothing kept as a Route Failure. A check
// that was refused and ends on cellular says the same.
import { test } from "node:test";
import assert from "node:assert/strict";

import { fakeDocument } from "../fakes.test-helper.js";

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.document = fakeDocument();
const { format, settingsRoute } = await import("../router.js");
const { drawInstallation, leave, mainPage, autoCheck, AUTO_CHECK, vpnTest, recheckPairing, recheckHooks, quietPairingCheck, hudHooks, forgetStatus, rememberStatus } = await import("./installroute.js");
const { routeFailure, rememberRouteFailure, routeFailureOf, connectRefused, cellularCheck } = await import("../core/installroute.js");
hudHooks.show = () => () => {};
recheckHooks.retryMs = 1;

const VPN = { available: true, tested: true, wifi: true, cellular: false, otherVPN: false, on: false };
const WIFI = { paired: "rp", pairOnPhone: true, otherVPN: false, vpn: VPN };
const CELL = { ...WIFI, vpn: { ...VPN, wifi: false, cellular: true } };
const untested = (st) => ({ ...st, vpn: { ...st.vpn, tested: false } });
const coded = (code, text = "x") => Object.assign(new Error(`${code}: ${text}`), { code });
const REFUSALS = [coded("route_refused"), coded("refused"), coded("connect_failed", "Connection refused (os error 61)")];
const SAYS = { title: "Can't Check on Cellular", message: "Join Wi-Fi, then check again.", buttons: ["OK"] };
const iphone = { get: () => "iphone", set: () => {} };
const tick = () => new Promise((r) => setTimeout(r, 0));
const all = (e) => [e, ...e.children.flatMap(all)];
const cellOf = (page) => all(page.el).find((n) => n._cls.has("install-action")).children[0];
const labelOf = (cell) => all(cell).find((n) => n._cls.has("cell-label")).textContent;
const tapOn = (cell) => Promise.all(cell.listeners.click.map((f) => f({})));

// The phone: `st` before a connect, `after` once one was made (its answer `err`, or a pass).
function phone(st, after = st, err = null) {
  const calls = [];
  let tried = false;
  return { calls, connects: () => calls.filter((m) => m === "idevice.verify" || m === "vpn.test").length, call: (m) => {
    calls.push(m);
    if (m === "idevice.status") return Promise.resolve(tried ? after : st);
    if (m === "idevice.verify" || m === "vpn.test") { tried = true; return err ? Promise.reject(err) : Promise.resolve({ ok: true }); }
    return Promise.resolve({});
  } };
}
let paired = 0;
function setUp(kept = null) {
  mem.clear();
  forgetStatus();
  paired = 0;
  recheckHooks.goPair = () => { paired++; };
  if (kept) rememberRouteFailure(routeFailureOf(kept, WIFI));
  AUTO_CHECK.last = Date.now();
  const alerts = [];
  return { alerts, alert: async (a) => { alerts.push(a); return { index: 1 }; } };
}
async function main(native, alert) {
  const page = mainPage({ store: iphone, native, alert, links: {} });
  Object.defineProperty(page.el, "isConnected", { value: true });
  await page.refresh();
  return cellOf(page);
}

test("Check Connection on cellular: no connect, the one alert, nothing kept, the button as it was", async () => {
  const { alerts, alert } = setUp();
  const native = phone(CELL);
  const cell = await main(native, alert);
  await tapOn(cell);
  assert.deepEqual(alerts, [SAYS]);
  assert.equal(native.connects(), 0);
  assert.equal(routeFailure(), null);
  assert.equal(labelOf(cell), "Check Connection");
  assert.ok(!all(cell).some((n) => n._cls.has("loading-spinner")), "not spinning on");
});

test("Fix on cellular: no connect; the failure kept from before stays", async () => {
  const { alerts, alert } = setUp(coded("route_refused"));
  const native = phone(CELL);
  const cell = await main(native, alert);
  assert.equal(labelOf(cell), "Fix");
  await tapOn(cell);
  assert.deepEqual(alerts, [SAYS]);
  assert.equal(native.connects(), 0);
  assert.equal(routeFailure().title, "iPhone Refused");
});

test("Check Connection refused and on cellular by the end says the same", async () => {
  for (const err of REFUSALS) {
    const { alerts, alert } = setUp();
    const native = phone(WIFI, CELL, err);
    const cell = await main(native, alert);
    await tapOn(cell);
    assert.deepEqual(alerts, [SAYS], err.message);
    assert.equal(native.connects(), 1);
    assert.equal(routeFailure(), null);
    assert.equal(labelOf(cell), "Check Connection");
    assert.equal(paired, 0);
  }
});

test("refused on Wi-Fi, or a pairing turned down: as before", async () => {
  for (const [after, err] of [[WIFI, REFUSALS[0]], [CELL, coded("pairing_rejected")]]) {
    const { alerts, alert } = setUp();
    const cell = await main(phone(WIFI, after, err), async (a) => { await alert(a); return { index: 0 }; });
    await tapOn(cell);
    assert.notEqual(alerts[0].title, SAYS.title);
    assert.equal(alerts[0].buttons[1], "Fix");
    assert.ok(routeFailure());
  }
  assert.equal(connectRefused(coded("timeout")), false);
});

test("the automatic check on cellular: no connect, no alert", async () => {
  const { alerts, alert } = setUp(coded("refused"));
  const native = phone(CELL);
  await autoCheck(native, alert, () => {}, iphone, null, Date.now() + 60_000);
  assert.equal(native.connects(), 0);
  assert.deepEqual(alerts, []);
});

test("Test Connection on cellular: no connect; its refusal that ends there says the same", async () => {
  for (const [native, connects] of [[phone(CELL), 0], [phone(WIFI, CELL, REFUSALS[0]), 1], [phone(WIFI, CELL, REFUSALS[1]), 1]]) {
    const { alerts, alert } = setUp();
    let ended = 0;
    rememberStatus(WIFI); // an older answer
    await vpnTest(native, alert, iphone, { ended: () => ended++ });
    assert.deepEqual(alerts, [SAYS]);
    assert.equal(native.connects(), connects);
    assert.equal(ended, 1);
    assert.equal(routeFailure(), null);
    assert.equal(paired, 0);
  }
});

test("not set up yet: the alert says what finishes it", async () => {
  const { alerts, alert } = setUp();
  await vpnTest(phone(untested(CELL)), alert, iphone);
  assert.deepEqual(alerts, [{ ...SAYS, message: "Join Wi-Fi, then check again. Test Connection finishes setting up." }]);
  assert.equal(cellularCheck(null).message, SAYS.message);
});

test("Set Up on cellular: pairs, then says how to finish instead of testing", async () => {
  const { alerts, alert } = setUp();
  globalThis.location = { hash: format(settingsRoute(["installation", "pair"])) };
  const calls = [];
  let done = null;
  const native = { call: (m, p, ev) => {
    calls.push(m);
    if (m === "idevice.status") return Promise.resolve(untested(done === "paired" ? CELL : { ...CELL, paired: null }));
    if (m === "idevice.pair") return new Promise((ok) => { ev?.({ pin: "123456" }); done = () => { done = "paired"; ok({ ok: true }); }; });
    return Promise.resolve({});
  } };
  const box = document.createElement("div");
  const kept = { installRoute: "server" };
  try {
    await drawInstallation(box, "pair", { store: { get: (k) => kept[k], set: (k, v) => { kept[k] = v; } }, native, alert });
    await tick();
    done();
    for (let i = 0; i < 6; i++) await tick();
    assert.ok(calls.includes("idevice.pair") && !calls.includes("vpn.test"));
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].title, SAYS.title);
    assert.match(alerts[0].message, /Test Connection finishes setting up/);
    assert.match(box.textContent, /Paired/);
    assert.equal(kept.installRoute, "iphone");
  } finally { leave(); delete globalThis.location; }
});

test("Pairing's check of the kept pairing: nothing forgotten, and only Fix or Pair Again says so", async () => {
  for (const tell of [true, false]) {
    for (const native of [phone(CELL), ...REFUSALS.map((e) => phone(WIFI, CELL, e))]) {
      const { alerts, alert } = setUp();
      assert.equal(await recheckPairing(native, alert, () => {}, { tell }), "cellular");
      assert.deepEqual(alerts, tell ? [SAYS] : []);
      assert.ok(!native.calls.includes("idevice.forget"));
      assert.equal(routeFailure(), null);
      assert.equal(paired, 0);
    }
  }
});

test("the Quiet Pairing Check refused and on cellular by the end keeps nothing", async () => {
  setUp();
  let n = 0;
  const native = { call: (m) => (m === "idevice.status" ? Promise.resolve(n < 2 ? WIFI : CELL) : (n++, Promise.reject(coded("refused")))) };
  assert.equal(await quietPairingCheck(native, iphone), "unknown");
  assert.equal(n, 2);
  assert.equal(routeFailure(), null);
});
