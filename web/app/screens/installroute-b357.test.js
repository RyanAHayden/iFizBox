// B357 (iPhone 15 Pro, Lite): with the built-in VPN, setting up ends with its test. Pairing (or a pairing file) is
// followed at once by vpn.test, as Test Connection runs it: that first test is when iOS asks to add the VPN
// configuration, so the page says Paired only after it. Without the built-in VPN, or once tested, pairing ends as
// before. The shell keeps the configuration saved (LocalVPN.swift never removes it), so later installs ask nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { fakeDocument } from "../fakes.test-helper.js";

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.document = fakeDocument();

const { format, settingsRoute } = await import("../router.js");
const { drawInstallation, leave, needsTestAfterPairing, setupGroups, TESTING_AFTER_PAIRING, forgetStatus } = await import("./installroute.js");
globalThis.location = { hash: format(settingsRoute(["installation", "pair"])) };

const tick = () => new Promise((r) => setTimeout(r, 0));
const VPN = (o = {}) => ({ available: true, tested: false, cellular: false, wifi: true, shortcuts: { off: false, on: false }, ...o });
const NOT_PAIRED = (vpn) => ({ paired: null, pairOnPhone: true, localDevVPN: false, otherVPN: false, tailscale: { connect: "auto", signedIn: false }, ...(vpn ? { vpn } : {}) });

// idevice.pair sends the code and answers when `pair()` is called; vpn.test answers when `test()` is.
function phone(before) {
  const calls = [];
  let paired = false, tested = false, pair = null, testOk = null;
  const native = { call: (m, p, ev) => {
    calls.push(m);
    if (m === "idevice.status") return Promise.resolve(paired ? { ...before, paired: "rp", ...(before.vpn ? { vpn: { ...before.vpn, tested } } : {}) } : before);
    if (m === "idevice.vpnApps") return Promise.resolve({});
    if (m === "idevice.pair") return new Promise((ok) => { ev?.({ pin: "123456" }); pair = () => { paired = true; ok({ ok: true }); }; });
    if (m === "vpn.test") return new Promise((ok) => { testOk = (r) => { tested = Boolean(r.ok); ok(r); }; });
    return Promise.resolve({ ok: true });
  } };
  return { native, calls, pair: () => pair(), test: (r = { ok: true, ms: 40, kind: "rp" }) => testOk(r) };
}

async function setUp(before) {
  forgetStatus();
  const p = phone(before);
  const alerts = [];
  const store = { m: { installRoute: "server" }, get(k) { return this.m[k]; }, set(k, v) { this.m[k] = v; } };
  const box = document.createElement("div");
  await drawInstallation(box, "pair", { store, native: p.native, alert: async (a) => { alerts.push(a); return { index: 0 }; } });
  await tick();
  return { ...p, alerts, store, box };
}

test("needsTestAfterPairing: only with the built-in VPN, not tested yet", () => {
  assert.equal(needsTestAfterPairing(NOT_PAIRED(VPN())), true);
  assert.equal(needsTestAfterPairing(NOT_PAIRED(VPN({ tested: true }))), false);
  assert.equal(needsTestAfterPairing(NOT_PAIRED(VPN({ available: false }))), false);
  assert.equal(needsTestAfterPairing(NOT_PAIRED()), false, "an older shell");
  assert.equal(needsTestAfterPairing(null), false);
  const g = setupGroups("testing");
  assert.equal(g.at(-1).spinner, TESTING_AFTER_PAIRING);
});

test("built-in VPN: pairing runs the test itself, with the page's spinner, and says Paired only after it", async () => {
  const s = await setUp(NOT_PAIRED(VPN()));
  assert.ok(s.calls.includes("idevice.pair"));
  s.pair();
  await tick(); await tick();
  assert.equal(s.calls.filter((c) => c === "vpn.test").length, 1, "the test started by itself");
  assert.match(s.box.textContent, new RegExp(TESTING_AFTER_PAIRING));
  assert.doesNotMatch(s.box.textContent, /Paired/, "not Paired while iOS may still be asking");
  assert.equal(s.store.m.installRoute, "iphone");
  s.test();
  await tick(); await tick(); await tick();
  assert.deepEqual(s.alerts.map((a) => a.title), ["Connected"]);
  assert.match(s.box.textContent, /Paired/);
  assert.doesNotMatch(s.box.textContent, new RegExp(TESTING_AFTER_PAIRING));
  leave();
});

test("built-in VPN: a failed test after pairing says why, and the page still shows Paired (Test Connection tries again)", async () => {
  const s = await setUp(NOT_PAIRED(VPN()));
  s.pair();
  await tick(); await tick();
  s.test({ ok: false });
  await tick(); await tick(); await tick();
  assert.equal(s.alerts.length, 1);
  assert.notEqual(s.alerts[0].title, "Connected");
  assert.match(s.box.textContent, /Paired/);
  leave();
});

test("without the built-in VPN, or already tested: pairing ends as before, no vpn.test", async () => {
  for (const before of [{ ...NOT_PAIRED(), localDevVPN: true }, NOT_PAIRED(VPN({ tested: true }))]) {
    const s = await setUp(before);
    s.pair();
    await tick(); await tick(); await tick();
    assert.ok(!s.calls.includes("vpn.test"));
    assert.match(s.box.textContent, /Paired/);
    leave();
  }
});

test("the shell keeps its VPN configuration: no removal after an install, so iOS asks Allow once", () => {
  const src = readFileSync(new URL("../../../native/sideload/vpn/App/LocalVPN.swift", import.meta.url), "utf8");
  assert.doesNotMatch(src, /removeFromPreferences/);
  assert.doesNotMatch(src, /otherWasOn/);
});
