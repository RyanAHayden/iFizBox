// B381: Shortcuts opened again when the user came back after an install. The Install Switch's end runs only for what it
// has to put back (LocalVPN.swift's switchEndNeeded and switchEndDue), and the automatic check never opens Shortcuts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { fakeDocument } from "../fakes.test-helper.js";

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.document ??= fakeDocument();
const { autoCheck, AUTO_CHECK } = await import("./installroute.js");
const { routeFailure, rememberRouteFailure, clearRouteFailure, routeFailureOf, switchWouldRun } = await import("../core/installroute.js");

const ST = ({ other = false, cellular = false, added = true } = {}) => ({ paired: "rp", otherVPN: other, tunnels: other ? ["utun4"] : [],
  vpn: { available: true, tested: true, cellular, wifi: !cellular, shortcuts: { switch: added } } });

test("switchWouldRun: on cellular or with another VPN up", () => {
  for (const other of [false, true]) for (const cellular of [false, true]) {
    assert.equal(switchWouldRun(ST({ other, cellular })), cellular || other);
    assert.equal(switchWouldRun(ST({ other, cellular, added: false })), false, "not added");
  }
  assert.equal(switchWouldRun({ ...ST(), tunnels: ["utun4"] }), true, "a VPN that routes 10.7.0.1 too (otherVPN false)");
  assert.equal(switchWouldRun({ ...ST(), tunnels: ["utun6"], vpn: { ...ST().vpn, on: true } }), false, "our own VPN, still up");
  assert.equal(switchWouldRun(null), false);
});

test("coming back to the page after a failed install: the automatic check never opens Shortcuts", async () => {
  const refused = Object.assign(new Error("refused: no"), { code: "refused" });
  const iphone = { get: () => "iphone", set: () => {} };
  const run = async (st) => {
    rememberRouteFailure(routeFailureOf(refused, st));
    AUTO_CHECK.last = 0;
    const calls = [];
    const native = { call: (m) => { calls.push(m); return Promise.resolve(m === "idevice.status" ? st : { ok: true }); } };
    await autoCheck(native, async () => assert.fail("no alert"), () => {}, iphone, null, 100000);
    return calls;
  };
  assert.deepEqual(await run(ST({ other: true })), ["idevice.status"], "another VPN on: no connect, so no Shortcuts");
  assert.ok(routeFailure(), "the failure stays until Check Connection or an install passes");
  assert.deepEqual(await run(ST({ cellular: true })), ["idevice.status"]);
  assert.deepEqual(await run(ST()), ["idevice.status", "idevice.verify"], "Wi-Fi, no other VPN: checks as before");
  assert.equal(routeFailure(), null);
  clearRouteFailure();
});
