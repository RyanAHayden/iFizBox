// F372: the built-in VPN for This iPhone installs. idevice.status's `vpn` (native/sideload/vpn/App/LocalVPN.swift)
// makes it the way in. F414: This iPhone's page is its status, the Set Up steps until done, Forget Pairing, How It Works.
import { test } from "node:test";
import assert from "node:assert/strict";

import { fakeDocument } from "../fakes.test-helper.js";

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.document ??= fakeDocument();

const core = await import("../core/installroute.js");
const { decideRoute, installStatus, builtinVPN, iphoneSetUp, setupFooter, verifyFailure,
  vpnTestResult, routeFailureOf, HOW_STEPS, BUILTIN_VPN, setupState, OTHER_VPN_LINE } = core;
const screens = await import("./installroute.js");
const { installationGroups, subGroups, localGroups, howGroups, SUB_TITLES } = screens;
const { NAME } = await import("../brand.js");

const VPN = (o = {}) => ({ available: true, tested: false, cellular: false, wifi: true, shortcuts: { off: false, on: false }, ...o });
const ST = (vpn = {}, o = {}) => ({ paired: "rp", pairOnPhone: true, otherVPN: false, vpn: VPN(vpn), ...o });

test("the built-in VPN is the way in when the shell can run it, and the only way in", () => {
  assert.equal(BUILTIN_VPN, `${NAME} VPN`);
  assert.equal(builtinVPN(ST()), true);
  assert.equal(builtinVPN(ST({ available: false })), false);
  assert.equal(builtinVPN({ paired: "rp" }), false, "an older shell");
  assert.deepEqual(decideRoute("iphone", ST()), { route: "idevice" });
  assert.deepEqual(decideRoute("iphone", ST({}, { paired: null })), { route: "server", alert: "notPaired" });
  assert.deepEqual(decideRoute("server", ST()), { route: "server" });
  assert.equal(setupState(ST({}, { paired: null })), "pairing");
  const s = installStatus("iphone", ST());
  assert.equal(s.state, "finish", "paired, not tested yet");
  const r = installStatus("iphone", ST({ tested: true }));
  assert.equal(r.state, "ready");
  assert.equal(r.subtitle, `Straight onto this iPhone, through ${BUILTIN_VPN}.`);
  assert.equal(s.local, true);
  // without it (no Network Extensions) it can't be used
  assert.equal(installStatus("iphone", ST({ available: false })).state, "noVPN");
  assert.deepEqual(decideRoute("iphone", ST({ available: false })), { route: "server", alert: "noVPN" });
  assert.equal(setupState(ST({ available: false }, { paired: null })), "noVPN");
});

test("set up = paired and tested once; the footer is one hint, once set up", () => {
  assert.equal(iphoneSetUp(ST({}, { paired: null })), false);
  assert.equal(iphoneSetUp(ST()), false, "paired, not tested");
  assert.equal(iphoneSetUp(ST({ tested: true })), true);
  assert.equal(iphoneSetUp({ paired: "rp" }), false, "an older shell has no VPN to set up");
  assert.equal(setupFooter(ST()), "");
  assert.equal(setupFooter(ST({ tested: true })), "");
  assert.equal(setupFooter(ST({ tested: true, cellular: true })), "", "On Cellular's own footer says it");
  // C73: another VPN up, or chosen in Settings > VPN
  assert.equal(OTHER_VPN_LINE, "Your VPN goes off during installs. Turn it back on after.");
  assert.equal(setupFooter(ST({ tested: true, otherVPN: true, cellular: true })), OTHER_VPN_LINE);
  assert.equal(setupFooter(ST({ tested: true, otherVPNSelected: true })), OTHER_VPN_LINE);
});

test("F414: This iPhone's page: status and one action, the steps until they're done, Forget Pairing, How It Works", () => {
  const page = (st, o) => localGroups(st, o);
  const steps = (gs) => gs.find((g) => g.header === "Set Up")?.rows.map((r) => [r.label, Boolean(r.checked), Boolean(r.onClick)]);
  const head = (gs) => gs[0].rows.map((r) => r.label);
  const last = (gs) => gs.slice(1).map((g) => g.header ?? g.rows[0].label);
  const fresh = page(ST({}, { paired: null }));
  assert.deepEqual(head(fresh), ["Not Set Up", "Start Setup"]);
  assert.deepEqual(steps(fresh), [["1. Pair This iPhone", false, true], [`2. Allow ${BUILTIN_VPN}`, false, false], ["3. Test Connection", false, false]]);
  assert.equal(fresh[1].footer, core.SETUP_FOOTER);
  assert.deepEqual(last(fresh), ["Set Up", "How It Works"]);
  assert.match(page(ST({}, { paired: null, pairOnPhone: false }))[1].rows[0].subtitle, /pairing file/, "older iOS");
  const half = page(ST());
  assert.deepEqual(head(half), ["Almost Done", "Test Connection"]);
  assert.deepEqual(steps(half), [["1. Pair This iPhone", true, false], [`2. Allow ${BUILTIN_VPN}`, false, true], ["3. Test Connection", false, true]]);
  const done = page(ST({ tested: true }));
  assert.deepEqual(head(done), ["Ready to Install", "Check Connection"]);
  assert.deepEqual(last(done), ["On Cellular", "Forget Pairing", "How It Works"]);
  assert.match(done.at(-1).rows[0].href, /settings\/installation\/how$/);
  for (const o of [{ testing: true }, { fixing: true }, { pairChecking: true }]) {
    const [s, a] = page(ST({ tested: true }), o)[0].rows;
    assert.deepEqual([s.label, s.tone, a.spin], ["Checking…", "wait", true]);
  }
  assert.deepEqual(head(page(ST(), { reading: true, late: true })), ["Not Responding", "Check Connection"]);
  const f = { title: "iPhone Refused", short: "Every connection was refused.", fix: "check" };
  assert.deepEqual(head(page(ST({ tested: true }), { failure: f })), ["iPhone Refused", "Fix"]);
  assert.deepEqual(head(page(ST({ tested: true }), { failure: { ...f, fix: "pair" } })), ["Pairing Lost", "Fix"]);
  assert.deepEqual(head(page(ST({}, { paired: null }), { failure: f })), ["Not Set Up", "Start Setup"], "nothing paired: setup, not a failure");
  assert.deepEqual(subGroups(installationGroups("iphone", ST({ tested: true })), "iphone").map((g) => g.key), ["status", "cellular", undefined, undefined]);
  for (const k of ["how", "server", "iphone", "pair"]) assert.ok(SUB_TITLES[k], k);
});

test("F412: Restore My VPN, its own group, off by default; shown only when the shell can do it", async () => {
  const group = (st) => localGroups(st).find((g) => g.key === "restore");
  assert.equal(group(ST({ tested: true })), undefined, "a shell without the setting");
  assert.equal(group(ST({ available: false, restore: false })), undefined);
  assert.equal(group(null), undefined);
  const off = group(ST({ tested: true, restore: false }));
  assert.deepEqual(off.rows.map((r) => r.label), ["Restore My VPN"]);
  assert.equal(off.footer, "Your own VPN stays off after installs.");
  assert.equal(group(ST({ tested: true, restore: true })).footer, "After installs your own VPN comes back once you open Settings > VPN.");
  assert.equal(setupFooter(ST({ tested: true, otherVPN: true, restore: true })), "", "it comes back: not told to turn it on");

  const { drawInstallation, forgetStatus, cachedStatus } = screens;
  forgetStatus();
  core.clearRouteFailure();
  const sent = [];
  let fail = false, kept = false;
  const native = { call: async (x, p) => {
    if (x === "idevice.status") return ST({ tested: true, restore: kept });
    if (x !== "vpn.setRestore" || fail) throw new Error("no");
    sent.push(p.on);
    kept = p.on;
    return {};
  } };
  const box = document.createElement("div");
  const every = (e) => [e, ...e.children.flatMap(every)];
  const sw = () => every(box).filter((e) => e._cls.has("switch"));
  const on = () => sw()[0].getAttribute("aria-checked");
  const says = (t) => every(box).some((e) => e._cls.has("group-footer") && e.textContent === t);
  const draw = () => drawInstallation(box, "iphone", { store: { get: () => "iphone", set() {} }, native, alert: async () => ({ index: 0 }) });
  const tap = async () => { for (const f of sw()[0].listeners.click) await f({ stopPropagation() {}, preventDefault() {} }); await new Promise((r) => setTimeout(r, 0)); };
  await draw();
  assert.equal(sw().length, 1);
  assert.equal(on(), "false");
  const first = sw()[0];
  await tap();
  assert.deepEqual(sent, [true]);
  assert.equal(on(), "true");
  assert.equal(sw()[0], first, "the row is kept, so the knob slides");
  assert.ok(says(core.restoreFooter(true)));
  assert.equal(cachedStatus().vpn.restore, true);
  await draw();
  await tap();
  assert.deepEqual(sent, [true, false], "a redrawn page: the tap goes out once");
  assert.ok(says(core.restoreFooter(false)));
  fail = true;
  await Promise.all([tap(), tap()]);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(on(), "false", "two that fail");
  await tap();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(on(), "false", "a failed call puts it back");
  assert.ok(says(core.restoreFooter(false)));
  fail = false;
  await tap();
  screens.rememberStatus(ST({ tested: true, restore: false }));
  assert.equal(cachedStatus().vpn.restore, true, "a read begun before the tap");
  forgetStatus();
});

test("F414: a failed check asks to fix", () => {
  const q = core.fixQuestion({ title: "Pair Again", message: "x", again: true });
  assert.deepEqual([q.title, q.buttons, q.cancel], ["Pairing Lost", ["Not Now", "Fix"], 0]);
  assert.match(q.message, /Fix it now\?$/);
  const c = core.fixQuestion(verifyFailure(new Error("connect_failed: no answer"), ST()), ST({ cellular: true }));
  assert.equal(c.title, "Couldn't Connect");
  assert.ok(c.message.includes("Fix tries again from the start.") && c.message.includes(core.CELL_LINE));
  assert.equal(core.fixQuestion({ title: "iPhone Refused", message: "why" }).message, "why", "the other reasons keep their words");
});

test("F414: Check Connection on This iPhone's page: fails, turns red, asks; Fix checks again and passes; the pick stays", async () => {
  const { drawInstallation, forgetStatus } = screens;
  forgetStatus();
  core.clearRouteFailure();
  const m = { installRoute: "server" };
  const store = { get: (k) => m[k], set: (k, v) => { m[k] = v; } };
  let n = 0;
  const native = { call: (x) => (x === "idevice.status" ? Promise.resolve(ST({ tested: true }))
    : x === "idevice.verify" ? (n++ ? Promise.resolve({ ok: true }) : Promise.reject(Object.assign(new Error("connect_failed: no answer"), { code: "connect_failed" }))) : Promise.reject(new Error("no"))) };
  const box = document.createElement("div");
  const every = (e) => [e, ...e.children.flatMap(every)];
  const has = (t) => every(box).some((e) => e._cls.has("cell-label") && e.textContent === t);
  const asked = [];
  await drawInstallation(box, "iphone", { store, native, alert: async (a) => { asked.push([a.title, has("Couldn't Connect"), has("Fix")]); return { index: 1 }; } });
  const cell = every(box).find((e) => e._cls.has("install-action")).children[0];
  await Promise.all(cell.listeners.click.map((f) => f({})));
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(asked, [["Couldn't Connect", true, true]]);
  assert.equal(n, 2);
  assert.ok(has("Ready to Install"));
  assert.equal(m.installRoute, "server");
  forgetStatus();
});

test("a profile without Network Extensions says so instead of the VPN's rows", () => {
  const gs = subGroups(installationGroups("iphone", { paired: "rp", vpn: { available: false } }), "iphone");
  assert.deepEqual(gs[0].rows.map((r) => [r.label, r.detail]), [["Network Extensions", "Missing"]]);
  assert.equal(gs[0].footer, core.NO_VPN.message);
  assert.equal(gs[1].rows[0].label, "How It Works");
});

test("How It Works: one install's steps, a row each, and offline", () => {
  const [steps, offline] = howGroups();
  assert.equal(steps.header, "Each Install");
  assert.equal(steps.rows.length, HOW_STEPS.length);
  assert.deepEqual(steps.rows.map((r) => r.label), ["1. Download", "2. Sign", `3. ${BUILTIN_VPN} On`, "4. Install", `5. ${BUILTIN_VPN} Off`]);
  assert.deepEqual(offline.rows, [{ label: "Offline", detail: "Works" }]);
});

test("the tests' answers in words", () => {
  assert.deepEqual(vpnTestResult({ ok: true, ms: 38 }), { title: "Connected", message: `${BUILTIN_VPN} reached this iPhone in 38 ms, then turned off again.` });
  assert.equal(vpnTestResult(null, new Error("vpn_failed: iOS didn't save the VPN configuration (permission denied). Allow it when iOS asks")).title, `${BUILTIN_VPN} Didn't Start`);
  assert.equal(vpnTestResult(null, new Error("refused: this iPhone no longer has the pairing")).again, true);
});

test("a failed connect through the built-in VPN never says to turn on another VPN app; on cellular it says check on Wi-Fi", () => {
  const st = ST({ tested: true, cellular: true });
  const why = verifyFailure(new Error("connect_failed: no answer"), st);
  assert.equal(why.title, "Couldn't Connect");
  assert.match(why.message, /On cellular, check on Wi-Fi\./);
  const refused = routeFailureOf(new Error("route_refused: every port"), st);
  assert.equal(refused.fix, "check");
  assert.match(refused.message, /On cellular, check on Wi-Fi\./);
  assert.ok(!/Shortcut|Install Switch/i.test(JSON.stringify([why, refused])));
  assert.ok(!/LocalDevVPN|Tailscale|Turn On/.test(JSON.stringify([why, refused])));
});

test("F392: the first test that passes uses This iPhone; a later one keeps the pick, unless its row was just tapped", async () => {
  const { vpnTest, setUseAfterSetup, USE_HOLD, rememberStatus, forgetStatus } = screens;
  const m = { installRoute: "server" };
  const store = { get: (k) => m[k], set: (k, v) => { m[k] = v; } };
  let pass = false;
  const native = { call: (x) => (x === "vpn.test" ? Promise.resolve({ ok: pass, ms: 40, error: "no" }) : Promise.reject(new Error("no"))) };
  const said = [];
  const alert = async (a) => { said.push(a.message); return { index: 0 }; };
  forgetStatus();
  rememberStatus(ST({ tested: false }));
  await vpnTest(native, alert, store);
  assert.equal(m.installRoute, "server", "a failed test switches nothing");
  pass = true;
  await vpnTest(native, alert, store);
  assert.equal(m.installRoute, "iphone", "the first pass uses it");
  assert.match(said.at(-1), /^Set up\. Apps now install straight/);
  m.installRoute = "server";
  await vpnTest(native, alert, store);
  assert.equal(m.installRoute, "server", "a later pass keeps the pick");
  rememberStatus({ ...ST({ tested: true }), paired: null });
  await vpnTest(native, alert, store);
  assert.equal(m.installRoute, "server", "paired again, the test not its first");
  setUseAfterSetup(true, Date.now() - USE_HOLD - 1);
  await vpnTest(native, alert, store);
  assert.equal(m.installRoute, "server", "its row tapped long ago");
  setUseAfterSetup(true);
  await vpnTest(native, alert, store);
  assert.equal(m.installRoute, "iphone", "its row tapped, then the test");
  forgetStatus();
  m.installRoute = "server";
  await vpnTest(native, alert, store);
  assert.equal(m.installRoute, "server", "no status: not known to be the first");
});
