// F447 (concept K10): This iPhone's Connect Through, the built-in VPN or LocalDevVPN (App Store). The shell says the one
// in use as vpn.via ("builtin" | "app"); a profile without Network Extensions (a free Apple ID) has LocalDevVPN only,
// its built-in row Missing. Through LocalDevVPN: its own Set Up steps, no Restore My VPN, no On Cellular, a Quiet
// Pairing Check only while it is up, and failures that say to turn it on.
import { test } from "node:test";
import assert from "node:assert/strict";

import { fakeDocument } from "../fakes.test-helper.js";

globalThis.document = fakeDocument();
const make = (tag) => document.createElement(tag);

const { drawInstallation, installationGroups, localGroups, howGroups, forgetStatus, hudHooks, needsTestAfterPairing } = await import("./installroute.js");
const core = await import("../core/installroute.js");
const { VPN_APP, VPN_APP_LINK, BUILTIN_VPN, NO_VPN, APP_OFF, viaApp, canConnect, ownVPN, routeVPN, iphoneSetUp, setupSteps, decideRoute,
  installStatus, verifyFailure, routeFailureOf, vpnTestResult, quietCheckAllowed, restoreShown, otherVPNOn, onCellular, setupState,
  connectFooter, howSteps, HOW_STEPS } = core;
const { NAME } = await import("../brand.js");
hudHooks.show = () => () => {};
hudHooks.delay = 0;

const all = (e) => [e, ...e.children.flatMap(all)];
const withClass = (box, c) => all(box).filter((n) => n._cls.has(c));
const labels = (box) => withClass(box, "cell-label").map((n) => n.textContent);
const cellOf = (box, label) => withClass(box, "cell-inner").find((n) => withClass(n, "cell-label")[0]?.textContent === label);
const spins = (box, label) => withClass(cellOf(box, label), "loading-spinner").length === 1;
const tap = (box, label) => {
  const cell = cellOf(box, label);
  assert.ok(cell, `no row ${label}: ${labels(box)}`);
  return Promise.all(cell.listeners.click.map((f) => f({})));
};
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };
const store = () => { const m = { installRoute: "iphone" }; return { get: (k) => m[k], set: (k, v) => { m[k] = v; } }; };

const vpn = (o = {}) => ({ available: true, tested: false, cellular: false, wifi: true, otherVPN: false, restore: false, via: "builtin", ...o });
const ST = (o = {}, top = {}) => ({ paired: "rp", pairOnPhone: true, ...top, vpn: vpn(o) });
const FREE = (o = {}, top = {}) => ST({ available: false, via: "app", ...o }, top); // a free Apple ID's profile
const group = (gs, key) => gs.find((g) => g.key === key);

test("the rules: LocalDevVPN is a way in; the built-in VPN's own branches are off through it", () => {
  assert.equal(VPN_APP, "LocalDevVPN");
  assert.match(VPN_APP_LINK, /^https:\/\/apps\.apple\.com\/app\/id\d+$/);
  assert.equal(viaApp(ST()), false);
  assert.equal(viaApp(ST({ via: "app" })), true);
  assert.equal(viaApp({ paired: "rp", vpn: { available: true } }), false, "an older shell says no via");
  assert.equal(canConnect(FREE()), true, "a free Apple ID connects through LocalDevVPN");
  assert.equal(canConnect({ paired: "rp", vpn: { available: false } }), false, "an older shell without Network Extensions can't");
  assert.equal(ownVPN(ST()), true);
  assert.equal(ownVPN(ST({ via: "app" })), false);
  assert.equal(routeVPN(ST()), BUILTIN_VPN);
  assert.equal(routeVPN(FREE()), VPN_APP);
  assert.equal(iphoneSetUp(FREE({ tested: true })), true);
  assert.equal(iphoneSetUp(FREE()), false);
  assert.deepEqual(decideRoute("iphone", FREE({ tested: true })), { route: "idevice" });
  assert.deepEqual(decideRoute("iphone", { paired: "rp", vpn: { available: false } }), { route: "server", alert: "noVPN" });
  assert.deepEqual(decideRoute("iphone", FREE({ tested: true, cellular: true }), "server"), { route: "idevice" }, "On Cellular's hidden choice doesn't count");
  assert.deepEqual(decideRoute("iphone", ST({ tested: true, cellular: true }), "server"), { route: "server", cellular: true });
  assert.equal(setupState({ paired: null, pairOnPhone: true, vpn: vpn({ available: false, via: "app" }) }), "pairing");
  const ready = installStatus("iphone", FREE({ tested: true }));
  assert.equal(ready.state, "ready");
  assert.equal(ready.subtitle, `Straight onto this iPhone, through ${VPN_APP}.`);
  assert.equal(restoreShown(ST({ via: "app" })), false, "no Restore My VPN through LocalDevVPN");
  assert.equal(restoreShown(ST()), true);
  assert.equal(otherVPNOn(ST({ via: "app", otherVPN: true })), false, "LocalDevVPN is the way in, not a VPN taken off");
  assert.equal(onCellular(FREE({ cellular: true })), true, "on cellular, as through the built-in VPN");
  assert.equal(connectFooter(FREE()), "Turn LocalDevVPN on before each install. Works with a free Apple ID.");
  assert.equal(connectFooter(ST()), `${NAME} turns its VPN on for each install and off after.`);
  assert.deepEqual(howSteps(ST()), HOW_STEPS);
  assert.deepEqual(howSteps(FREE()).map((s) => s.label), ["1. Download", "2. Sign", "3. LocalDevVPN On", "4. Install"]);
});

test("LocalDevVPN's Set Up steps: pair, turn it on (its App Store page), test with it on", () => {
  const steps = (st) => setupSteps(st).map((p) => [p.key, p.label, Boolean(p.done), Boolean(p.next)]);
  assert.deepEqual(steps(FREE({}, { paired: null })), [["pair", "1. Pair This iPhone", false, true], ["app", "2. Turn On LocalDevVPN", false, true],
    ["test", "3. Test Connection", false, false]]);
  assert.deepEqual(steps(FREE()), [["pair", "1. Pair This iPhone", true, false], ["app", "2. Turn On LocalDevVPN", false, true],
    ["test", "3. Test Connection", false, true]]);
  assert.equal(setupSteps(ST())[1].label, `2. Allow ${BUILTIN_VPN}`, "the built-in VPN keeps its steps");
});

test("failures through LocalDevVPN say to turn it on", () => {
  const off = Object.assign(new Error("vpn_app_off: LocalDevVPN is off: open it and tap Connect, then try again"), { code: "vpn_app_off" });
  assert.equal(verifyFailure(off, FREE()), APP_OFF);
  assert.equal(APP_OFF.title, "Turn On LocalDevVPN");
  const f = routeFailureOf(off, FREE());
  assert.equal(f.title, "Turn On LocalDevVPN");
  assert.equal(f.short, APP_OFF.short);
  assert.equal(vpnTestResult(null, off).title, "Turn On LocalDevVPN");
  assert.equal(vpnTestResult({ ok: true, ms: 40, via: "app" }).message, `${NAME} reached this iPhone through LocalDevVPN in 40 ms.`);
  const timeout = Object.assign(new Error("timeout: no answer"), { code: "timeout" });
  assert.match(verifyFailure(timeout, FREE()).message, /^LocalDevVPN was on/);
  assert.equal(verifyFailure(timeout, { paired: "rp", vpn: { available: false } }), NO_VPN, "an older shell without Network Extensions");
});

test("the Quiet Pairing Check through LocalDevVPN runs only while it is up, on Wi-Fi, whatever Restore My VPN says", () => {
  assert.equal(quietCheckAllowed("iphone", FREE({ tested: true, otherVPN: true })), true);
  assert.equal(quietCheckAllowed("iphone", FREE({ tested: true, otherVPN: false })), false, "LocalDevVPN off: nothing to check through");
  assert.equal(quietCheckAllowed("iphone", FREE({ tested: true, otherVPN: true, cellular: true, wifi: false })), false);
  assert.equal(quietCheckAllowed("iphone", ST({ via: "app", tested: true, otherVPN: true, restore: true })), true, "Restore My VPN's branch skipped");
  assert.equal(quietCheckAllowed("iphone", ST({ tested: true, otherVPN: true })), false, "the built-in VPN's branches stand");
  assert.equal(needsTestAfterPairing(FREE({ otherVPN: true })), true);
  assert.equal(needsTestAfterPairing(FREE()), false, "LocalDevVPN off: Set Up's step 2 asks for it, no test that must fail");
});

test("Connect Through: both rows, the one in use checked, under the status", () => {
  const gs = localGroups(ST());
  assert.deepEqual(gs.map((g) => g.key ?? g.header ?? g.rows[0].label).slice(0, 3), ["status", "via", "setup-builtin"]);
  const via = group(gs, "via");
  assert.equal(via.header, "Connect Through");
  assert.deepEqual(via.rows.map((r) => [r.label, r.subtitle, Boolean(r.checked)]), [
    [BUILTIN_VPN, "Built in, turns on by itself", true], [VPN_APP, "Free app on the App Store", false]]);
  assert.equal(via.footer, `${NAME} turns its VPN on for each install and off after.`);
  const app = localGroups(ST({ via: "app" }));
  assert.deepEqual(group(app, "via").rows.map((r) => Boolean(r.checked)), [false, true]);
  assert.ok(group(app, "setup-app"), "LocalDevVPN's own steps");
  assert.equal(group(app, "via").footer, "Turn LocalDevVPN on before each install. Works with a free Apple ID.");
  assert.equal(localGroups({ paired: "rp", vpn: vpn({ via: undefined }) }).find((g) => g.key === "via"), undefined, "an older shell: no choice");
  assert.equal(group(localGroups(ST(), { reading: true }), "via"), undefined, "not while the first answer is out");
});

test("a free Apple ID: the built-in row says Missing and can't be picked; LocalDevVPN is the one", () => {
  const gs = localGroups(FREE());
  const [own, app] = group(gs, "via").rows;
  assert.deepEqual([own.detail, own.dim, own.subtitle, Boolean(own.checked), own.onClick], ["Missing", true, "Needs Network Extensions", false, undefined]);
  assert.equal(app.checked, true);
  assert.ok(!gs.some((g) => g.rows?.some((r) => r.label === "Network Extensions")), "not the old dead end");
});

test("through LocalDevVPN: no Restore My VPN, no On Cellular; step 2 opens its App Store page", () => {
  const opened = [];
  const gs = localGroups(FREE({ restore: true }), { openApp: () => opened.push(VPN_APP_LINK) });
  assert.equal(group(gs, "restore"), undefined);
  assert.equal(group(gs, "cellular"), undefined);
  assert.ok(group(localGroups(ST({ restore: true })), "restore"), "the built-in VPN keeps Restore My VPN");
  assert.ok(group(localGroups(ST()), "cellular"), "and On Cellular");
  const step = group(gs, "setup-app").rows[1];
  assert.equal(step.label, "2. Turn On LocalDevVPN");
  step.onClick();
  assert.deepEqual(opened, [VPN_APP_LINK]);
  assert.match(JSON.stringify(howGroups(FREE())), /LocalDevVPN On/);
});

test("Install Apps With's footer names the way in", () => {
  assert.equal(installationGroups("iphone", FREE())[0].footer, `Signed apps go straight to iOS through ${VPN_APP}.`);
  assert.equal(installationGroups("iphone", ST())[0].footer, `Signed apps go straight to iOS through ${BUILTIN_VPN}.`);
});

test("a tap on LocalDevVPN: checked and spinning at once, vpn.setVia sent, then its steps", async () => {
  forgetStatus();
  let st = ST();
  const calls = [];
  let answer;
  const native = { call: (m, p) => {
    calls.push([m, p]);
    if (m === "idevice.status") return Promise.resolve(st);
    if (m === "vpn.setVia") return new Promise((r) => { answer = () => { st = ST({ via: p.via }); r(st.vpn); }; });
    return Promise.resolve(null);
  } };
  const box = make("div");
  await drawInstallation(box, "iphone", { store: store(), native });
  assert.ok(labels(box).includes(`2. Allow ${BUILTIN_VPN}`), labels(box).join(", "));
  const tapped = tap(box, VPN_APP);
  await flush();
  assert.deepEqual(calls.find(([m]) => m === "vpn.setVia"), ["vpn.setVia", { via: "app" }]);
  assert.ok(spins(box, VPN_APP), "spins until the shell answers");
  answer();
  await tapped;
  await flush();
  assert.ok(!spins(box, VPN_APP));
  assert.ok(labels(box).includes("2. Turn On LocalDevVPN"), labels(box).join(", "));
  assert.ok(!labels(box).includes("Restore My VPN"));
  forgetStatus();
});
