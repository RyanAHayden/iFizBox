// B316: a refused connect isn't always the pairing: every connection refused (lockdown's port too) isn't the pairing at
// all. A failure is kept until a check passes, and turns Ready to Install (Installation & Signing, Home's slot) into
// the broken state.
import { test } from "node:test";
import assert from "node:assert/strict";

import { verifyFailure, routeFailureOf, installStatus, routeFailure, rememberRouteFailure, clearRouteFailure,
  failureStatus, FAILURE_KEY, BUILTIN_VPN, PAIR_AGAIN_LINE, LOST_LINE, hasSocketText, plainSocket, pairFooter, vpnTestResult, serverFallback, STATUS_ACTIONS } from "./installroute.js";
import { deviceError, loggedBridge } from "./signing.js";

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
  assert.equal(f.button, "Fix");
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
  // on cellular: installs ask for Airplane Mode
  const c = routeFailureOf(e, CELL);
  assert.equal(c.fix, "check");
  assert.match(c.message, /On cellular, check on Wi-Fi\. Installs ask for Airplane Mode\./);
  assert.ok(!/Install Switch|Shortcut/.test(c.message));
  // the install alert and log say the same (deviceError), with the fix button
  const d = deviceError(e, "Unbound");
  assert.equal(d.title, "iPhone Refused");
  assert.equal(d.button, "Fix");
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
  assert.deepEqual([STATUS_ACTIONS[s.action], s.fix], ["Fix", "pair"]);
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

// ---- B416: a first connect the phone resets: no pairing any more. Raw socket text stays in the grey log lines.
const RESET = 'Socket(Os { code: 54, kind: ConnectionReset, message: "Connection reset by peer" }) (1)';
const coded = (code, text, prefix = true) => Object.assign(new Error(prefix ? `${code}: ${text}` : text), { code });

test("B416: the first connect reset: the red line, the alert, the kept failure and fix=pair", () => {
  for (const e of [coded("connect_failed", RESET), coded("connect_failed", RESET, false),
    coded("pair_again", "this iPhone answered through the VPN, then closed the connection")]) {
    const d = deviceError(e, "Feather"); // the row's red line (signing/queue.js rowError) and the alert
    assert.equal(d.message, PAIR_AGAIN_LINE);
    assert.equal(d.title, "Pair Again");
    assert.equal(d.fix, "pair");
    assert.equal(d.button, "Fix");
    const storage = memory();
    rememberRouteFailure(routeFailureOf(e, FINE), { storage });
    const f = routeFailure(storage);
    assert.deepEqual([f.title, f.message, f.fix, f.button], ["Pair Again", PAIR_AGAIN_LINE, "pair", "Fix"]);
    assert.deepEqual([failureStatus(f).action, failureStatus(f).fix], ["fix", "pair"]);
    assert.ok(!hasSocketText(JSON.stringify(f)) && f.short.length <= 70);
    assert.equal(serverFallback(e, { route: "idevice" }, FINE).button, "Fix");
    assert.equal(verifyFailure(e, FINE).again, true);
    assert.ok(!verifyFailure(e, FINE).unusable, "checked once more before it is forgotten");
    assert.equal(vpnTestResult(null, e).title, "Pair Again");
  }
});

test("B416: a timeout or a mid-install drop never says Pair Again", () => {
  const errs = [coded("connect_failed", "Socket(Kind(TimedOut)) (1)"), coded("timeout", "no answer from iOS for 30 s"),
    coded("upload_failed", RESET), coded("install_failed", RESET), coded("install_failed", "Socket(Kind(UnexpectedEof)) (1)"),
    coded("service_failed", RESET),
    coded("upload_failed", `lost the connection to iOS during the copy (102.0 MB of 351.5 MB) and couldn't get it back (${RESET})`)];
  for (const e of errs) {
    for (const words of [deviceError(e, "Feather"), verifyFailure(e, FINE), routeFailureOf(e, FINE) ?? {}, vpnTestResult(null, e)]) {
      const s = JSON.stringify(words);
      assert.doesNotMatch(s, /pair/i, `${e.message}: ${s}`);
      assert.ok(!hasSocketText(s), s);
    }
  }
});

test("B416: no raw socket text in a red line or an alert, whatever the socket error", () => {
  const raws = [RESET, "Socket(Kind(UnexpectedEof)) (1)", 'Socket(Os { code: 32, kind: BrokenPipe, message: "Broken pipe" }) (1)',
    'Socket(Os { code: 65, kind: HostUnreachable, message: "No route to host" }) (1)', 'InternalError("connect: Operation Timeout") (16)',
    "InternalError(\"connect: device socket io failed\") (16)", "RemotePairing(Socket(Kind(TimedOut))) (103)"];
  for (const code of ["connect_failed", "refused", "pairing_rejected", "bad_pairing", "upload_failed", "install_failed", "service_failed", "timeout"]) {
    for (const raw of raws) {
      for (const text of [raw, `it broke (${raw}). Try again`]) {
        for (const e of [coded(code, text), coded(code, text, false)]) {
          for (const w of [deviceError(e, "Feather"), routeFailureOf(e, FINE) ?? {}, verifyFailure(e, FINE), vpnTestResult(null, e)]) {
            assert.ok(!hasSocketText(`${w.title} ${w.message} ${w.short}`), JSON.stringify(w));
          }
        }
      }
      assert.ok(!hasSocketText(pairFooter({ error: raw })));
    }
  }
  assert.equal(plainSocket(RESET), LOST_LINE);
  assert.equal(plainSocket(`Lost the connection during the copy (102.0 MB of 351.5 MB) and couldn't get it back (${RESET}). iOS may still have installed it`),
    "Lost the connection during the copy (102.0 MB of 351.5 MB) and couldn't get it back. iOS may still have installed it");
  assert.equal(plainSocket("iOS refused to install it (203)"), "iOS refused to install it (203)");
});

test("B416: a kept log keeps the raw text in a plain line, with the Error line in words", async () => {
  const lines = [];
  const store = { start: () => ({ line: (l) => lines.push(l), set() {}, end() {} }) };
  const e = coded("connect_failed", RESET, false);
  const native = loggedBridge({ call: () => Promise.reject(e) }, store);
  await assert.rejects(native.call("signing.install", { url: "x" }));
  assert.ok(lines.includes(RESET));
  assert.ok(lines.includes(`Error: ${PAIR_AGAIN_LINE}`));
});
