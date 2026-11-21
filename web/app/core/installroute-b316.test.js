// B316: a refused connect on the Tailscale route checks Tailscale first (signed out, VPN off) and blames the pairing
// only when Tailscale is fine; every connection refused (lockdown's port too) isn't the pairing at all. A failure is
// kept until a check passes, and turns Ready to Install (Installation & Signing, Home's slot) into the broken state.
import { test } from "node:test";
import assert from "node:assert/strict";

import { verifyFailure, routeFailureOf, tailscaleProblem, installStatus, routeFailure, rememberRouteFailure, clearRouteFailure,
  failureStatus, tailscaleTestResult, TAILSCALE_SIGNED_OUT, FAILURE_KEY } from "./installroute.js";
import { deviceError } from "./signing.js";

const refused = Object.assign(new Error("refused: this iPhone refused RemotePairing on port 49152: it no longer has this pairing. Pair again"), { code: "refused" });
// the user's phone: Tailscale's VPN on, Connect With Automatic, iFizBox's node signed out
const TS_SIGNED_OUT = { paired: "rp", localDevVPN: false, otherVPN: true, tailscale: { connect: "auto", signedIn: false, address: "100.64.0.2", use: false } };
const TS_FINE = { paired: "rp", localDevVPN: false, otherVPN: true, tailscale: { connect: "auto", signedIn: true, address: "100.64.0.2", use: true } };
const TS_PICKED_OFF = { paired: "rp", localDevVPN: false, otherVPN: false, tailscale: { connect: "tailscale", signedIn: true, address: null, use: false } };
const LDV = { paired: "rp", localDevVPN: true, otherVPN: false, tailscale: { connect: "localdevvpn", signedIn: false, address: null, use: false } };

function memory() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

test("refused with Tailscale signed out: the fix is Tailscale's Sign In, not Pair Again", () => {
  const f = routeFailureOf(refused, TS_SIGNED_OUT);
  assert.equal(f.title, "Tailscale Is Signed Out");
  assert.equal(f.fix, "signIn");
  assert.equal(f.button, "Sign In");
  assert.match(f.message, /Install Apps With/);
  assert.doesNotMatch(f.message, /pair/i);
  const why = verifyFailure(refused, TS_SIGNED_OUT);
  assert.equal(why.again, false, "Check Connection doesn't offer Pair Again");
  assert.ok(!why.unusable, "the pairing isn't forgotten for Tailscale's sake");
});

test("refused with Tailscale fine: Pair Again, as before", () => {
  const f = routeFailureOf(refused, TS_FINE);
  assert.equal(f.title, "Pair Again");
  assert.equal(f.fix, "pair");
  assert.equal(verifyFailure(refused, TS_FINE).unusable, true);
  // and over LocalDevVPN, Tailscale's state doesn't matter
  assert.equal(routeFailureOf(refused, LDV).fix, "pair");
});

test("the other refusals and resets on a pairing check Tailscale first too", () => {
  for (const e of [
    Object.assign(new Error("pairing_rejected: RemotePairing(PairVerifyFailed)"), { code: "pairing_rejected" }),
    Object.assign(new Error("pair_again: this iPhone answered through Tailscale, then closed the connection"), { code: "pair_again" }),
    Object.assign(new Error('connect_failed: Socket(UnexpectedEof "early eof")'), { code: "connect_failed" }),
  ]) assert.equal(routeFailureOf(e, TS_SIGNED_OUT).fix, "signIn", e.message);
  // Connect With: Tailscale with its VPN off: Open Tailscale
  assert.equal(routeFailureOf(refused, TS_PICKED_OFF).fix, "openTailscale");
});

test("tailscaleProblem: only when Tailscale is the way in", () => {
  assert.equal(tailscaleProblem(TS_SIGNED_OUT), "signedOut");
  assert.equal(tailscaleProblem(TS_FINE), null);
  assert.equal(tailscaleProblem(TS_PICKED_OFF), "off");
  assert.equal(tailscaleProblem(LDV), null);
  assert.equal(tailscaleProblem({ paired: "rp", localDevVPN: true, tailscale: { connect: "auto", signedIn: false, address: null } }), null, "Automatic, Tailscale's VPN off: LocalDevVPN's route");
  assert.equal(tailscaleProblem(null), null);
  // Automatic, Tailscale's VPN on and iFizBox signed out, but LocalDevVPN really on: the connect went to 10.7.0.1
  const both = { ...TS_SIGNED_OUT, localDevVPN: true, otherVPN: false };
  assert.equal(tailscaleProblem(both), null);
  assert.equal(routeFailureOf(refused, both).fix, "pair", "a refusal over LocalDevVPN is the pairing's");
});

test("the shell's own codes: tailscale_signed_out, and every connection refused (not the pairing)", () => {
  const out = Object.assign(new Error("tailscale_signed_out: Tailscale signed iFizBox out"), { code: "tailscale_signed_out" });
  assert.equal(routeFailureOf(out).title, TAILSCALE_SIGNED_OUT.title);
  const ts = Object.assign(new Error("route_refused: this iPhone refused every connection through Tailscale, lockdown's port 62078 too"), { code: "route_refused" });
  const f = routeFailureOf(ts);
  assert.equal(f.title, "Tailscale Refused");
  assert.equal(f.fix, "openTailscale");
  assert.match(f.message, /isn't the pairing/);
  assert.equal(verifyFailure(ts).again, false);
  const ldv = routeFailureOf(Object.assign(new Error("route_refused: this iPhone refused every connection through LocalDevVPN"), { code: "route_refused" }));
  assert.equal(ldv.fix, "openVPN");
  // the install alert and log say the same (deviceError), with the fix button
  const d = deviceError(out, "Unbound");
  assert.equal(d.title, "Tailscale Is Signed Out");
  assert.equal(d.button, "Sign In");
  assert.equal(deviceError(ts, "Unbound").title, "Tailscale Refused");
  // tailscale.test's answers
  assert.equal(tailscaleTestResult({ ok: false, code: "needs_login" }).title, "Tailscale Is Signed Out");
  assert.equal(tailscaleTestResult({ ok: false, code: "route_refused", detail: "x" }).title, "Tailscale Refused");
});

test("not a route failure: Developer Mode, signing, a download", () => {
  assert.equal(routeFailureOf(Object.assign(new Error("developer_mode: Developer Mode is off"), { code: "developer_mode" })), null);
  assert.equal(routeFailureOf(Object.assign(new Error("no_identity: x"), { code: "no_identity" })), null);
  assert.equal(routeFailureOf(Object.assign(new Error("offline: No internet connection"), { code: "offline" })), null);
});

test("a failure is kept until a check passes, and turns Ready to Install into it", () => {
  const storage = memory();
  assert.equal(routeFailure(storage), null);
  const before = installStatus("iphone", TS_FINE);
  assert.equal(before.state, "ready");
  rememberRouteFailure(routeFailureOf(refused, TS_SIGNED_OUT), { storage, now: 5 });
  const f = routeFailure(storage);
  assert.equal(f.title, "Tailscale Is Signed Out");
  assert.equal(f.at, 5);
  assert.ok(storage.m.has(FAILURE_KEY));
  const s = installStatus("iphone", TS_FINE, { failure: f });
  assert.equal(s.state, "failed");
  assert.equal(s.title, "Tailscale Is Signed Out");
  assert.equal(s.action, "signIn");
  assert.equal(s.red, true);
  assert.equal(s.local, false, "the Signing Server row no longer says This iPhone");
  assert.deepEqual(s, failureStatus(f));
  // the status's own broken states stand (Sign In to Tailscale, Pair This iPhone), and the server route is untouched
  assert.equal(installStatus("iphone", TS_SIGNED_OUT, { failure: f }).state, "signIn");
  assert.equal(installStatus("server", undefined, { failure: f }).state, "server");
  clearRouteFailure(storage);
  assert.equal(routeFailure(storage), null);
  assert.equal(installStatus("iphone", TS_FINE, { failure: routeFailure(storage) }).state, "ready");
});

test("every failure's status subtitle fits two lines at 320pt", () => {
  const errs = [refused, Object.assign(new Error("route_refused: through Tailscale"), { code: "route_refused" }),
    Object.assign(new Error("route_refused: through LocalDevVPN"), { code: "route_refused" })];
  for (const st of [TS_SIGNED_OUT, TS_FINE, TS_PICKED_OFF, LDV, null]) {
    for (const e of errs) {
      const f = routeFailureOf(e, st);
      assert.ok(f.short.length <= 70, `${f.short} (${f.short.length})`);
    }
  }
});
