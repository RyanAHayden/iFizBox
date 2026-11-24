// B316: opening Installation & Signing, Pairing or Install Apps With after a failed check or install checks the
// connection by itself (quietly), and a passing check clears the failure; Install Apps With's This iPhone group says
// the failure in its footer with the fix row in it.
import { test } from "node:test";
import assert from "node:assert/strict";

import { fakeDocument } from "../fakes.test-helper.js";

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.document ??= fakeDocument();
const { autoCheck, AUTO_CHECK, installationGroups, hudHooks, withDetail, FAILING, TIMEOUTS, mainPage, recheckHooks, forgetStatus, setupGroups } = await import("./installroute.js");
const { routeFailure, rememberRouteFailure, clearRouteFailure, routeFailureOf, askFix, takeFix } = await import("../core/installroute.js");
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

test("a check that gets no answer in time is kept too", async () => {
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
  assert.ok(g.rows.some((r) => r.label === "Fix" && r.cls === "sign-import"));
  const ok = installationGroups("iphone", FINE).find((x) => x.header === "Set Up");
  assert.ok(!ok.rows.some((r) => r.label === "Fix"));
  assert.ok(!ok.warn);
});

// ---- F409: Fix in place of Check Connection while failing
const { runFix } = await import("../signing/route.js");
const all = (e) => [e, ...e.children.flatMap(all)];
const actionOf = (page) => all(page.el).find((n) => n._cls.has("install-action")).children[0];
const labelOf = (cell) => all(cell).find((n) => n._cls.has("cell-label")).textContent;
const tapOn = (cell) => Promise.all(cell.listeners.click.map((f) => f({})));
const DROPPED = Object.assign(new Error("pair_again: closed"), { code: "pair_again" });
async function failing(err, answers, { auto = false } = {}) {
  forgetStatus();
  clearRouteFailure();
  if (err) rememberRouteFailure(routeFailureOf(err, FINE));
  AUTO_CHECK.last = auto ? 0 : Date.now();
  const native = phone({ "idevice.status": FINE, ...answers });
  const alerts = [];
  let paired = 0;
  recheckHooks.goPair = () => { paired++; };
  const page = mainPage({ store: iphone, native, alert: async (a) => { alerts.push(a); return { index: 0 }; }, links: {} });
  Object.defineProperty(page.el, "isConnected", { value: true });
  await page.refresh();
  return { page, native, alerts, paired: () => paired, cell: actionOf(page) };
}

test("F409: the failed status cell's row says Fix; it checks at once and goes green", async () => {
  let go;
  const t = await failing(noRoute, { "idevice.verify": new Promise((r) => { go = r; }) });
  assert.equal(labelOf(t.cell), "Fix");
  const run = tapOn(t.cell);
  assert.ok(all(t.cell).some((n) => n._cls.has("loading-spinner")), "spins at once");
  go({ ok: true });
  await run;
  assert.equal(t.page.status().state, "ready");
  assert.equal(labelOf(t.cell), "✓Successful");
  assert.deepEqual(t.alerts, []);
});

test("F409: Fix that fails again says the plain reason, and the row stays Fix with no x", async () => {
  const t = await failing(noRoute, { "idevice.verify": noRoute });
  await tapOn(t.cell);
  assert.deepEqual(t.alerts.map((a) => [a.title, a.buttons]), [["iPhone Refused", ["OK"]]]);
  assert.equal(labelOf(t.cell), "Fix");
  assert.ok(!all(t.cell).some((n) => n._cls.has("check-mark")));
});

test("F409: Fix opens Pairing when the phone turned the pairing down, with no question", async () => {
  const t = await failing(noRoute, { "idevice.verify": DROPPED });
  await tapOn(t.cell);
  assert.equal(t.paired(), 1);
  assert.deepEqual(t.alerts, []);
  assert.equal(routeFailure().fix, "pair");
  assert.ok(!t.native.calls.includes("idevice.forget"), "Pairing checks it once more first");
});

test("F409: a failed Check Connection turns into Fix, and so does the automatic check", async () => {
  const t = await failing(null, { "idevice.verify": noRoute });
  assert.equal(labelOf(t.cell), "Check Connection");
  await tapOn(t.cell);
  assert.deepEqual(t.alerts[0].buttons, ["OK", "Fix"]);
  assert.equal(labelOf(t.cell), "Fix");
  const u = await failing(refused, { "idevice.verify": noRoute }, { auto: true });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(labelOf(u.cell), "Fix");
  assert.deepEqual(u.alerts, []);
});

test("F409: Fix tapped while the automatic check runs makes that check Fix's: one check, its reason said", async () => {
  let no;
  const t = await failing(refused, { "idevice.verify": new Promise((_, r) => { no = r; }) }, { auto: true });
  const run = tapOn(t.cell);
  await new Promise((r) => setTimeout(r, 5));
  no(noRoute);
  await run;
  assert.equal(t.native.calls.filter((c) => c === "idevice.verify").length, 1);
  assert.deepEqual(t.alerts.map((a) => a.title), ["iPhone Refused"]);
});

test("F409: Fix in an install's alert or Log: Pairing, or the page that then checks at once", async () => {
  const went = [];
  runFix("pair", { go: (p) => went.push(p.join("/")) });
  assert.equal(takeFix(), false);
  runFix("check", { go: (p) => went.push(p.join("/")), later: () => {} });
  assert.deepEqual(went, ["installation/pair", "installation"]);
  const t = await failing(noRoute, { "idevice.verify": noRoute }); // drawn after the tap
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(t.alerts.map((a) => a.title), ["iPhone Refused"], "checked by itself, its reason said");
  assert.equal(takeFix(), false, "once");
  askFix(0);
  assert.equal(takeFix(60_000), false, "an old tap is dropped");
  clearRouteFailure();
});

test("F409: Pairing's row says Fix while failing", () => {
  const label = (failing) => setupGroups("paired", FINE, null, { failing })[2].rows[0].label;
  assert.deepEqual([label(false), label(true)], ["Check Connection", "Fix"]);
});
