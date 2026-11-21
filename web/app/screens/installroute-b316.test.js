// B316: opening Installation & Signing, Pairing or Install Apps With after a failed check or install checks the
// connection by itself (quietly), and a passing check clears the failure; Install Apps With's This iPhone group says
// the failure in its footer with the fix row in it.
import { test } from "node:test";
import assert from "node:assert/strict";

import { fakeDocument } from "../fakes.test-helper.js";

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.document ??= fakeDocument();
const { autoCheck, AUTO_CHECK, installationGroups, hudHooks } = await import("./installroute.js");
const { routeFailure, rememberRouteFailure, clearRouteFailure, routeFailureOf } = await import("../core/installroute.js");
hudHooks.show = () => () => {};
hudHooks.delay = 0;

const TS_FINE = { paired: "rp", localDevVPN: false, otherVPN: true, tailscale: { connect: "auto", signedIn: true, address: "100.64.0.2", use: true } };
const TS_SIGNED_OUT = { ...TS_FINE, tailscale: { ...TS_FINE.tailscale, signedIn: false, use: false } };
const refused = Object.assign(new Error("refused: this iPhone refused RemotePairing on port 49152"), { code: "refused" });
const iphone = { get: () => "iphone", set: () => {} };
function phone(answers) {
  const calls = [];
  return { calls, call: (m) => { calls.push(m); const a = answers[m]; return a instanceof Error ? Promise.reject(a) : Promise.resolve(a); } };
}

test("after a failure, opening the page checks by itself; a pass clears it with no alert", async () => {
  rememberRouteFailure(routeFailureOf(refused, TS_SIGNED_OUT));
  AUTO_CHECK.last = 0;
  const native = phone({ "idevice.status": TS_FINE, "idevice.verify": { ok: true } });
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
  rememberRouteFailure(routeFailureOf(refused, TS_FINE));
  AUTO_CHECK.last = 0;
  const native = phone({ "idevice.status": TS_SIGNED_OUT, "idevice.verify": refused });
  const alerts = [];
  await autoCheck(native, async (a) => { alerts.push(a); return { index: 0 }; }, () => {}, iphone, null, 200000);
  assert.deepEqual(alerts, []);
  assert.equal(routeFailure().title, "Tailscale Is Signed Out", "Tailscale first: its VPN on, iFizBox signed out");
  assert.equal(autoCheck(native, async () => ({}), () => {}, iphone, null, 200000 + 1000), null, "within the gap: no second check");
});

test("no failure, or the Signing Server route: nothing runs", () => {
  clearRouteFailure();
  AUTO_CHECK.last = 0;
  const native = phone({});
  assert.equal(autoCheck(native, async () => ({}), () => {}, iphone, null, 500000), null);
  rememberRouteFailure(routeFailureOf(refused, TS_FINE));
  assert.equal(autoCheck(native, async () => ({}), () => {}, { get: () => "server" }, null, 500000), null);
  assert.deepEqual(native.calls, []);
  clearRouteFailure();
});

test("Install Apps With: the failure in This iPhone's footer, its fix row in the group", () => {
  const f = routeFailureOf(refused, TS_SIGNED_OUT);
  const groups = installationGroups("iphone", TS_FINE, { failure: f });
  const g = groups.find((x) => x.header === "This iPhone");
  assert.equal(g.footer, "Tailscale Is Signed Out. Installs can't reach this iPhone. Sign in again.");
  assert.equal(g.warn, true);
  assert.ok(g.rows.some((r) => r.label === "Sign In" && r.cls === "sign-import"));
  // signed out now (the shell marked it): Tailscale's own Sign In row is the fix, and its footer says the failure
  const out = installationGroups("iphone", TS_SIGNED_OUT, { failure: f });
  const here = out.find((x) => x.header === "This iPhone"), tsg = out.find((x) => x.header === "Tailscale");
  assert.ok(!here.rows.some((r) => r.label === "Sign In"), "one Sign In row, not two");
  assert.ok(!here.warn);
  assert.equal(tsg.footer, "Tailscale Is Signed Out. Installs can't reach this iPhone. Sign in again.");
  assert.ok(tsg.rows.some((r) => r.label === "Sign In"));
  const ok = installationGroups("iphone", TS_FINE).find((x) => x.header === "This iPhone");
  assert.ok(!ok.rows.some((r) => r.label === "Sign In"));
  assert.ok(!ok.warn);
});
