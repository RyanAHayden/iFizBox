// B220: choosing This iPhone again, a kept pairing is checked once; when the phone no longer accepts it (refused on
// every RemotePairing port, or turned down) it is forgotten and the pair step runs again instead of being skipped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { fakeDocument } from "../fakes.test-helper.js";

globalThis.document = fakeDocument();
const { recheckPairing, recheckHooks, hudHooks, cachedStatus, rememberStatus } = await import("./installroute.js");
hudHooks.show = () => () => {};
hudHooks.delay = 0;
recheckHooks.retryMs = 5;

const PAIRED_TS = { paired: "rp", pairOnPhone: true, otherVPN: false, vpn: { available: true, tested: true } };
const fail = (message, code) => Object.assign(new Error(message), { code });

function phone(answers) {
  const calls = [];
  return { calls, call: (m) => { calls.push(m); const a = answers[m]; return a instanceof Error ? Promise.reject(a) : Promise.resolve(typeof a === "function" ? a() : a); } };
}

async function run(answers) {
  const native = phone(answers), alerts = [];
  let wentToPair = 0, redrawn = 0;
  recheckHooks.goPair = () => { wentToPair++; };
  const r = await recheckPairing(native, async (a) => { alerts.push(a); return { index: 0 }; }, () => { redrawn++; });
  return { r, calls: native.calls, alerts, wentToPair, redrawn };
}

test("refused on every port: the pairing is forgotten and Pairing opens to pair again", async () => {
  rememberStatus(PAIRED_TS);
  const o = await run({ "idevice.status": PAIRED_TS, "idevice.verify": fail("refused: this iPhone refused RemotePairing on port 49152", "refused"), "idevice.forget": {} });
  assert.equal(o.r, "repair");
  assert.deepEqual(o.calls, ["idevice.status", "idevice.verify", "idevice.verify", "idevice.forget"], "tried again once first");
  assert.equal(o.alerts.length, 1);
  assert.match(o.alerts[0].message, /Pairing starts again/);
  assert.equal(o.wentToPair, 1);
  assert.equal(cachedStatus(), null, "the cached Paired answer is dropped");
});

test("a pairing the phone turns down is redone too", async () => {
  const o = await run({ "idevice.status": PAIRED_TS, "idevice.verify": fail("pairing_rejected: RemotePairing(PairVerifyFailed)", "pairing_rejected"), "idevice.forget": {} });
  assert.equal(o.r, "repair");
  assert.ok(o.calls.includes("idevice.forget"));
});

test("refused for a moment (remotepairingd restarting): the retry connects and the pairing stays", async () => {
  let n = 0;
  const o = await run({ "idevice.status": PAIRED_TS, "idevice.verify": () => (n++ ? { ok: true, kind: "rp" } : Promise.reject(fail("refused: port 49152", "refused"))) });
  assert.equal(o.r, "ok");
  assert.deepEqual(o.alerts, []);
  assert.ok(!o.calls.includes("idevice.forget"));
});

test("a good pairing stays, with no alert", async () => {
  const o = await run({ "idevice.status": PAIRED_TS, "idevice.verify": { ok: true, kind: "rp" } });
  assert.equal(o.r, "ok");
  assert.deepEqual(o.alerts, []);
  assert.ok(!o.calls.includes("idevice.forget"));
});

test("no built-in VPN, not paired, or another failure: nothing is forgotten", async () => {
  let o = await run({ "idevice.status": { ...PAIRED_TS, vpn: { available: false } } });
  assert.equal(o.r, "skipped");
  assert.deepEqual(o.calls, ["idevice.status"]);
  o = await run({ "idevice.status": { ...PAIRED_TS, paired: null } });
  assert.equal(o.r, "skipped");
  o = await run({ "idevice.status": PAIRED_TS, "idevice.verify": fail("timeout: no answer from iOS for 30 s", "timeout") });
  assert.equal(o.r, "failed");
  assert.ok(!o.calls.includes("idevice.forget"));
  assert.deepEqual(o.alerts, []);
});

test("picking This iPhone again checks the kept pairing too (setting up local signing again)", () => {
  const src = readFileSync(new URL("./installroute.js", import.meta.url), "utf8");
  assert.match(src, /if \(v === "iphone" && v !== choice\) recheckPairing\(native, alert, redraw[,)]/);
});
