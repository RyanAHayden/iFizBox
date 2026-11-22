// B220: after a Tailscale sign-in, a kept pairing is checked once; when the phone no longer accepts it (refused on
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

const PAIRED_TS = { paired: "rp", pairOnPhone: true, localDevVPN: false, otherVPN: true, tailscale: { connect: "auto", signedIn: true, address: "100.64.0.2", use: true } };
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

test("the VPN route off, not paired, or another failure: nothing is forgotten", async () => {
  let o = await run({ "idevice.status": { ...PAIRED_TS, otherVPN: false, tailscale: { ...PAIRED_TS.tailscale, address: null, use: false } } });
  assert.equal(o.r, "skipped");
  assert.deepEqual(o.calls, ["idevice.status"]);
  o = await run({ "idevice.status": { ...PAIRED_TS, paired: null } });
  assert.equal(o.r, "skipped");
  o = await run({ "idevice.status": PAIRED_TS, "idevice.verify": fail("timeout: no answer from iOS for 30 s", "timeout") });
  assert.equal(o.r, "failed");
  assert.ok(!o.calls.includes("idevice.forget"));
  assert.deepEqual(o.alerts, []);
});

test("Tailscale's sign-in checks the kept pairing once it's in", () => {
  const src = readFileSync(new URL("./installroute.js", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("async function tailscaleSignIn"), src.indexOf("export const recheckHooks"));
  assert.match(body, /await connectAfterSignIn\(native, alert, redraw/); // B219: it tests the connection, then recheckPairing
  const after = src.slice(src.indexOf("export async function connectAfterSignIn"), src.indexOf("// B220: setting Tailscale up again"));
  assert.match(after, /await recheckPairing\(native, alert, redraw[,)]/);
});

test("picking This iPhone again, or a new Connect With, checks it too (setting up local signing again)", () => {
  const src = readFileSync(new URL("./installroute.js", import.meta.url), "utf8");
  assert.match(src, /if \(v === "iphone" && v !== choice\) recheckPairing\(native, alert, redraw\)/);
  assert.match(src, /if \(ts\) recheckPairing\(native, alert, redraw\)/);
});
