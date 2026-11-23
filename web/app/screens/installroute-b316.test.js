// B316: opening Installation & Signing, Pairing or Install Apps With after a failed check or install checks the
// connection by itself (quietly), and a passing check clears the failure; Install Apps With's This iPhone group says
// the failure in its footer with the fix row in it.
import { test } from "node:test";
import assert from "node:assert/strict";

import { fakeDocument } from "../fakes.test-helper.js";

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.document ??= fakeDocument();
const { autoCheck, AUTO_CHECK, installationGroups, hudHooks, withDetail, FAILING, TIMEOUTS } = await import("./installroute.js");
const { routeFailure, rememberRouteFailure, clearRouteFailure, routeFailureOf } = await import("../core/installroute.js");
hudHooks.show = () => () => {};
hudHooks.delay = 0;

const FINE = { paired: "rp", otherVPN: false, vpn: { available: true, tested: true } };
const noRoute = Object.assign(new Error("route_refused: every port refused"), { code: "route_refused" });
const refused = Object.assign(new Error("refused: this iPhone refused RemotePairing on port 49152"), { code: "refused" });
const iphone = { get: () => "iphone", set: () => {} };
function phone(answers) {
  const calls = [];
  return { calls, call: (m) => { calls.push(m); const a = answers[m]; return a instanceof Error ? Promise.reject(a) : Promise.resolve(a); } };
}

test("after a failure, opening the page checks by itself; a pass clears it with no alert", async () => {
  rememberRouteFailure(routeFailureOf(refused, FINE));
  AUTO_CHECK.last = 0;
  const native = phone({ "idevice.status": FINE, "idevice.verify": { ok: true } });
  const alerts = [];
  let redrawn = 0;
  await autoCheck(native, async (a) => { alerts.push(a); return { index: 0 }; }, () => { redrawn++; }, iphone, null, 100000);
  assert.deepEqual(native.calls, ["idevice.status", "idevice.verify"]);
  assert.equal(routeFailure(), null, "green again");
  assert.deepEqual(alerts, []);
  assert.ok(redrawn > 0, "the page repaints on its new state");
});

test("a failing automatic check keeps the failure, re-worded, with no alert; it doesn't run again at once", async () => {
  clearRouteFailure();
  rememberRouteFailure(routeFailureOf(refused, FINE));
  AUTO_CHECK.last = 0;
  const native = phone({ "idevice.status": FINE, "idevice.verify": noRoute });
  const alerts = [];
  await autoCheck(native, async (a) => { alerts.push(a); return { index: 0 }; }, () => {}, iphone, null, 200000);
  assert.deepEqual(alerts, []);
  assert.equal(routeFailure().title, "iPhone Refused", "re-worded from Pair Again: not the pairing");
  assert.equal(autoCheck(native, async () => ({}), () => {}, iphone, null, 200000 + 1000), null, "within the gap: no second check");
});

test("no failure, or the Signing Server route: nothing runs", () => {
  clearRouteFailure();
  AUTO_CHECK.last = 0;
  const native = phone({});
  assert.equal(autoCheck(native, async () => ({}), () => {}, iphone, null, 500000), null);
  rememberRouteFailure(routeFailureOf(refused, FINE));
  assert.equal(autoCheck(native, async () => ({}), () => {}, { get: () => "server" }, null, 500000), null);
  assert.deepEqual(native.calls, []);
  clearRouteFailure();
});

test("Paired turns to a red Failing while a failure is kept (main page's row and Install Apps With's Pairing)", () => {
  const f = routeFailureOf(refused, FINE);
  assert.equal(withDetail("iphone", FINE), "Paired");
  assert.equal(withDetail("iphone", FINE, f), FAILING);
  assert.equal(withDetail("iphone", { paired: false }, f), "Not Paired");
  assert.equal(withDetail("server", FINE, f), "");
  const test = installationGroups("iphone", FINE, { failure: f }).find((x) => x.header === "Set Up").rows[1];
  assert.equal(test.detail, FAILING);
});

test("a check that gets no answer in time is kept too (Check Again)", async () => {
  clearRouteFailure();
  rememberRouteFailure(routeFailureOf(refused, FINE));
  AUTO_CHECK.last = 0;
  TIMEOUTS.verify = 5;
  try {
    const native = { call: (m) => (m === "idevice.status" ? Promise.resolve(FINE) : new Promise(() => {})) };
    await autoCheck(native, async () => ({}), () => {}, iphone, null, 300000);
    assert.equal(routeFailure().title, "Not Responding");
    assert.equal(routeFailure().fix, "check");
  } finally { TIMEOUTS.verify = 20000; clearRouteFailure(); }
});

test("Install Apps With: the failure in Set Up's footer, its fix row in the group", () => {
  const f = routeFailureOf(refused, FINE);
  const groups = installationGroups("iphone", FINE, { failure: f });
  const g = groups.find((x) => x.header === "Set Up");
  assert.equal(g.footer, "Pair Again. Installs are refused. Pair again.");
  assert.equal(g.warn, true);
  assert.ok(g.rows.some((r) => r.label === "Pair Again" && r.cls === "sign-import"));
  const ok = installationGroups("iphone", FINE).find((x) => x.header === "Set Up");
  assert.ok(!ok.rows.some((r) => r.label === "Pair Again"));
  assert.ok(!ok.warn);
});
