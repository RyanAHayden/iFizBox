// F372: the built-in VPN for This iPhone installs. idevice.status's `vpn` (native/sideload/vpn/App/LocalVPN.swift)
// makes it the way in; This iPhone's page is Set Up (Pair This iPhone, Test Connection) and How It Works.
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
  assert.equal(s.state, "ready");
  assert.equal(s.subtitle, `Straight onto this iPhone, through ${BUILTIN_VPN}.`);
  assert.equal(s.local, true);
  // without it (no Network Extensions) it can't be used
  assert.equal(installStatus("iphone", ST({ available: false })).state, "noVPN");
  assert.deepEqual(decideRoute("iphone", ST({ available: false })), { route: "server", alert: "noVPN" });
  assert.equal(setupState(ST({ available: false }, { paired: null })), "noVPN");
});

test("set up = paired and tested once; the footer says the next step", () => {
  assert.equal(iphoneSetUp(ST({}, { paired: null })), false);
  assert.equal(iphoneSetUp(ST()), false, "paired, not tested");
  assert.equal(iphoneSetUp(ST({ tested: true })), true);
  assert.equal(iphoneSetUp({ paired: "rp" }), false, "an older shell has no VPN to set up");
  assert.equal(setupFooter(ST({}, { paired: null })), "Pair this iPhone once to install straight onto it.");
  assert.equal(setupFooter(ST()), "Test the connection to finish setting up.");
  const set = "Set up. Apps install straight onto this iPhone, on Wi-Fi or offline.";
  assert.equal(setupFooter(ST({ tested: true })), set);
  assert.equal(setupFooter(ST({ tested: true, cellular: true })), `${set} ${core.CELL_FOOTER}`);
  // C73: another VPN up, or chosen in Settings > VPN: one short line, no Install Switch to offer
  assert.equal(OTHER_VPN_LINE, "Your VPN goes off during installs. Turn it back on after.");
  assert.equal(setupFooter(ST({ tested: true, otherVPN: true })), `${set} ${OTHER_VPN_LINE}`);
  assert.equal(setupFooter(ST({ tested: true, otherVPNSelected: true })), `${set} ${OTHER_VPN_LINE}`);
});

test("This iPhone's page: Set Up (Pair, Test) with its footer, then How It Works", () => {
  const all = installationGroups("iphone", ST());
  const page = subGroups(all, "iphone");
  assert.deepEqual(page.map((g) => g.header), ["Set Up", undefined]);
  assert.deepEqual(page[0].rows.map((r) => [r.label, r.detail]), [["Pair This iPhone", "Done"], ["Test Connection", "Test"]]);
  assert.match(page[0].rows[0].href, /settings\/installation\/pair$/);
  assert.equal(page[0].footer, "Test the connection to finish setting up.");
  assert.equal(page[1].rows[0].label, "How It Works");
  assert.match(page[1].rows[0].href, /settings\/installation\/how$/);
  assert.ok(!/tailscale|localdevvpn|connect with|shortcut|install switch/i.test(JSON.stringify(all)));
  const tested = localGroups(ST({ tested: true }));
  assert.deepEqual(tested[0].rows.map((r) => r.detail), ["Done", "Connected"]);
  assert.equal(localGroups(ST(), { testing: true })[0].rows[1].detail, "Testing…");
  assert.equal(localGroups(ST(), { testing: true })[0].rows[1].spin, true);
  assert.equal(localGroups(ST(), { reading: true })[0].rows[0].detail, "Checking…");
  assert.equal(localGroups(ST(), { late: true })[0].rows[0].detail, "Not Responding");
  // a failed install: said in the footer, red, with its fix row
  const f = { title: "iPhone Refused", short: "Every connection was refused.", fix: "check", button: "Fix" };
  const failed = localGroups(ST({ tested: true }), { failure: f });
  assert.equal(failed[0].warn, true);
  assert.equal(failed[0].footer, "iPhone Refused. Every connection was refused.");
  assert.equal(failed[0].rows.at(-1).label, "Fix");
  // the page's own titles, each pushed
  for (const k of ["how", "server", "iphone", "pair"]) assert.ok(SUB_TITLES[k], k);
  assert.equal(SUB_TITLES.shortcuts, undefined);
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

test("a failed connect through the built-in VPN never says to turn on another VPN app; on cellular it says installs ask for Airplane Mode", () => {
  const st = ST({ tested: true, cellular: true });
  const why = verifyFailure(new Error("connect_failed: no answer"), st);
  assert.equal(why.title, "Couldn't Connect");
  assert.match(why.message, /On cellular, check on Wi-Fi\. Installs ask for Airplane Mode\./);
  const refused = routeFailureOf(new Error("route_refused: every port"), st);
  assert.equal(refused.fix, "check");
  assert.match(refused.message, /On cellular, check on Wi-Fi\. Installs ask for Airplane Mode\./);
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
