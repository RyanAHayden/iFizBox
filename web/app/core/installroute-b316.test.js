// B316: a refused connect isn't always the pairing: every connection refused (lockdown's port too) isn't the pairing at
// all. A failure is kept until a check passes, and turns Ready to Install (Installation & Signing, Home's slot) into
// the broken state.
import { test } from "node:test";
import assert from "node:assert/strict";

import { verifyFailure, routeFailureOf, installStatus, routeFailure, rememberRouteFailure, clearRouteFailure,
  failureStatus, FAILURE_KEY, BUILTIN_VPN } from "./installroute.js";
import { deviceError } from "./signing.js";

const refused = Object.assign(new Error("refused: this iPhone refused RemotePairing on port 49152: it no longer has this pairing. Pair again"), { code: "refused" });
const FINE = { paired: "rp", otherVPN: false, vpn: { available: true, tested: true, cellular: false } };
const CELL = { paired: "rp", otherVPN: false, vpn: { available: true, tested: true, cellular: true, shortcuts: {} } };
const NO_VPN = { paired: "rp", otherVPN: false };

function memory() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

test("refused: Pair Again; the pairing is forgotten", () => {
  const f = routeFailureOf(refused, FINE);
  assert.equal(f.title, "Pair Again");
  assert.equal(f.fix, "pair");
  assert.equal(f.button, "Pair Again");
  assert.equal(verifyFailure(refused, FINE).unusable, true);
});

test("the other refusals and resets on a pairing are the pairing's too", () => {
  for (const e of [
    Object.assign(new Error("pairing_rejected: RemotePairing(PairVerifyFailed)"), { code: "pairing_rejected" }),
    Object.assign(new Error('connect_failed: Socket(UnexpectedEof "early eof")'), { code: "connect_failed" }),
  ]) assert.equal(routeFailureOf(e, FINE).fix, "pair", e.message);
});

test("the shell's every-connection-refused (route_refused): not the pairing", () => {
  const e = Object.assign(new Error("route_refused: this iPhone refused every connection, lockdown's port 62078 too"), { code: "route_refused" });
  const f = routeFailureOf(e, FINE);
  assert.equal(f.title, "iPhone Refused");
  assert.equal(f.fix, "check");
  assert.match(f.message, /isn't the pairing/);
  assert.ok(f.message.includes(BUILTIN_VPN));
  assert.equal(verifyFailure(e, FINE).again, false);
  // on cellular without the Install Switch: add it
  const c = routeFailureOf(e, CELL);
  assert.equal(c.fix, "shortcuts");
  assert.equal(c.button, "Set Up");
  assert.match(c.message, /Install Switch/);
  // the install alert and log say the same (deviceError), with the fix button
  const d = deviceError(e, "Unbound");
  assert.equal(d.title, "iPhone Refused");
  assert.equal(d.button, "Check Again");
});

test("a profile without Network Extensions: the failure is No Network Extensions, not the pairing", () => {
  const f = routeFailureOf(refused, NO_VPN);
  assert.equal(f.title, "No Network Extensions");
  assert.equal(f.fix, "check");
  assert.equal(verifyFailure(refused, NO_VPN).again, false);
});

test("not a route failure: Developer Mode, signing, a download", () => {
  assert.equal(routeFailureOf(Object.assign(new Error("developer_mode: Developer Mode is off"), { code: "developer_mode" })), null);
  assert.equal(routeFailureOf(Object.assign(new Error("no_identity: x"), { code: "no_identity" })), null);
  assert.equal(routeFailureOf(Object.assign(new Error("offline: No internet connection"), { code: "offline" })), null);
});

test("a failure is kept until a check passes, and turns Ready to Install into it", () => {
  const storage = memory();
  assert.equal(routeFailure(storage), null);
  const before = installStatus("iphone", FINE);
  assert.equal(before.state, "ready");
  rememberRouteFailure(routeFailureOf(refused, FINE), { storage, now: 5 });
  const f = routeFailure(storage);
  assert.equal(f.title, "Pair Again");
  assert.equal(f.at, 5);
  assert.ok(storage.m.has(FAILURE_KEY));
  const s = installStatus("iphone", FINE, { failure: f });
  assert.equal(s.state, "failed");
  assert.equal(s.title, "Pair Again");
  assert.equal(s.action, "pair");
  assert.equal(s.red, true);
  assert.equal(s.local, false, "the Signing Server row no longer says This iPhone");
  assert.deepEqual(s, failureStatus(f));
  // the status's own broken states stand (Pair This iPhone), and the server route is untouched
  assert.equal(installStatus("iphone", { paired: null, vpn: { available: true } }, { failure: f }).state, "pair");
  assert.equal(installStatus("server", undefined, { failure: f }).state, "server");
  clearRouteFailure(storage);
  assert.equal(routeFailure(storage), null);
  assert.equal(installStatus("iphone", FINE, { failure: routeFailure(storage) }).state, "ready");
});

test("every failure's status subtitle fits two lines at 320pt", () => {
  const errs = [refused, Object.assign(new Error("route_refused: x"), { code: "route_refused" }),
    Object.assign(new Error("vpn_failed: can't start without a network"), { code: "vpn_failed" })];
  for (const st of [FINE, CELL, NO_VPN, null]) {
    for (const e of errs) {
      const f = routeFailureOf(e, st);
      assert.ok(f.short.length <= 70, `${f.short} (${f.short.length})`);
    }
  }
});
