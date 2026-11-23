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

const swift = readFileSync(new URL("../../../native/sideload/vpn/App/LocalVPN.swift", import.meta.url), "utf8");
// a one-line Swift Bool rule, run as JS: the app's own expression, not a copy of it
function rule(name) {
  const m = swift.match(new RegExp(`static func ${name}\\(([^)]*)\\) -> Bool \\{ ([\\w\\s&|!()]+) \\}`));
  assert.ok(m, name);
  const args = m[1].split(",").map((a) => a.split(":")[0].trim());
  return (o) => new Function(...args, `return ${m[2]}`)(...args.map((a) => Boolean(o[a])));
}

test("the Install Switch's end runs only when the run turned data off or another VPN was on before, and it isn't back", () => {
  const needed = rule("switchEndNeeded");
  assert.equal(needed({}), false, "nothing to put back (a start whose VPN or data off never came)");
  assert.equal(needed({ dataBack: true, vpnBack: true }), false);
  assert.equal(needed({ dataOff: true }), true, "data is off");
  assert.equal(needed({ dataOff: true, dataBack: true }), false, "cellular is in use: data is on");
  assert.equal(needed({ vpnBefore: true }), true, "Tailscale was on and isn't");
  assert.equal(needed({ vpnBefore: true, vpnBack: true }), false, "the user turned it on again");
  assert.equal(needed({ dataOff: true, vpnBefore: true, vpnBack: true }), true, "the VPN is back, data isn't");
  assert.equal(needed({ dataOff: true, dataBack: true, vpnBefore: true }), true);
});

test("the end is wired to the rule, and coming to the front ends nothing before the queue is over", () => {
  const end = swift.slice(swift.indexOf("static func endSwitch()"), swift.indexOf("static func switchEnded("));
  assert.ok(end.indexOf("guard switchEndNeeded(") > 0 && end.indexOf("guard switchEndNeeded(") < end.indexOf("runShortcut("));
  assert.match(end, /guard switchedOn, switchEndDue, holds == 0, active/);
  assert.match(swift, /holds \+= 1; stopGen \+= 1; switchEndDue = false/);
  assert.match(swift, /if stop \{ switchEndDue = switchedOn \}/);
  assert.match(swift, /if !notOpened\(r\.error\) \{ lock\.lock\(\); switchDataOff = true/);
});

const ST = ({ other = false, cellular = false, added = true } = {}) => ({ paired: "rp", localDevVPN: false, otherVPN: other, tunnels: other ? ["utun4"] : [],
  vpn: { available: true, tested: true, cellular, wifi: !cellular, shortcuts: { switch: added } } });

test("switchWouldRun follows the app's rule for the start", () => {
  const start = rule("switchNeeded");
  for (const other of [false, true]) for (const cellular of [false, true]) {
    assert.equal(switchWouldRun(ST({ other, cellular })), start({ cellular, otherVPN: other }));
    assert.equal(switchWouldRun(ST({ other, cellular, added: false })), false, "not added");
  }
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
  assert.deepEqual(await run(ST({ other: true })), ["idevice.status"], "Tailscale on: no connect, so no Shortcuts");
  assert.ok(routeFailure(), "the failure stays until Check Connection or an install passes");
  assert.deepEqual(await run(ST({ cellular: true })), ["idevice.status"]);
  assert.deepEqual(await run(ST()), ["idevice.status", "idevice.verify"], "Wi-Fi, no other VPN: checks as before");
  assert.equal(routeFailure(), null);
  clearRouteFailure();
});
