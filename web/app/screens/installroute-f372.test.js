// F372: the built-in VPN for This iPhone installs. idevice.status's `vpn` (native/sideload/vpn/App/LocalVPN.swift)
// makes it the way in; This iPhone's page is Set Up (Pair This iPhone, Test Connection, Cellular Shortcuts) and How
// It Works; Cellular Shortcuts has a group a Shortcut and Test Shortcuts; on cellular without them, Home, the status
// cell and an install that starts say so (user 2026-11-22).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { fakeDocument } from "../fakes.test-helper.js";

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.document ??= fakeDocument();

const core = await import("../core/installroute.js");
const { decideRoute, installStatus, builtinVPN, iphoneSetUp, setupFooter, cellularWarning, shortcutsAdded, vpnOn, verifyVPN, verifyFailure,
  vpnTestResult, switchTestResult, routeFailureOf, HOW_STEPS, SHORTCUT_NAMES, ALERTS, CELLULAR, BUILTIN_VPN, setupState } = core;
const screens = await import("./installroute.js");
const { installationGroups, subGroups, localGroups, shortcutGroups, howGroups, SUB_TITLES } = screens;
const { cellularTile, slotVPN, routeTile, slotOrRoute } = await import("./home.js");
const { chooseRoute, forgetRoute, runFix } = await import("../signing/route.js");
const { NAME } = await import("../brand.js");

const VPN = (o = {}) => ({ available: true, tested: false, cellular: false, wifi: true, shortcuts: { off: false, on: false }, ...o });
const ST = (vpn = {}, o = {}) => ({ paired: "rp", pairOnPhone: true, localDevVPN: false, otherVPN: true, tailscale: { connect: "tailscale", signedIn: false, address: "100.64.0.2" }, vpn: VPN(vpn), ...o });

test("the built-in VPN is the way in when the shell can run it, whatever Tailscale or LocalDevVPN say", () => {
  assert.equal(BUILTIN_VPN, `${NAME} VPN`);
  assert.equal(builtinVPN(ST()), true);
  assert.equal(builtinVPN(ST({ available: false })), false);
  assert.equal(builtinVPN({ paired: "rp" }), false, "an older shell");
  assert.deepEqual(decideRoute("iphone", ST()), { route: "idevice" });
  assert.deepEqual(decideRoute("iphone", ST({}, { paired: null })), { route: "server", alert: "notPaired" });
  assert.deepEqual(decideRoute("server", ST()), { route: "server" });
  assert.equal(vpnOn(ST()), true, "pairing needs no VPN app on");
  assert.equal(setupState(ST({}, { paired: null })), "pairing");
  assert.equal(verifyVPN(ST()), BUILTIN_VPN);
  const s = installStatus("iphone", ST());
  assert.equal(s.state, "ready");
  assert.equal(s.subtitle, `Straight onto this iPhone, through ${BUILTIN_VPN}.`);
  assert.equal(s.local, true);
  // without it, the Tailscale rules as before
  assert.notEqual(installStatus("iphone", ST({ available: false })).state, "ready");
});

test("set up = paired and tested once; the footer says the next step", () => {
  assert.equal(iphoneSetUp(ST({}, { paired: null })), false);
  assert.equal(iphoneSetUp(ST()), false, "paired, not tested");
  assert.equal(iphoneSetUp(ST({ tested: true })), true);
  assert.equal(iphoneSetUp({ paired: "rp" }), true, "an older shell: paired is set up");
  assert.equal(setupFooter(ST({}, { paired: null })), "Pair this iPhone once to install straight onto it.");
  assert.equal(setupFooter(ST()), "Test the connection to finish setting up.");
  assert.equal(setupFooter(ST({ tested: true })), "Set up for Wi-Fi and offline. Add the Install Switch to install on cellular and get your VPN back after.");
  assert.equal(setupFooter(ST({ tested: true, shortcuts: { off: true, on: true } })), "Set up. Apps install straight onto this iPhone, on Wi-Fi, cellular or offline.");
  assert.equal(setupFooter(ST({ tested: true, shortcuts: { switch: true } })), "Set up. Apps install straight onto this iPhone, on Wi-Fi, cellular or offline.");
});

test("This iPhone's page: Set Up (Pair, Test, Install Switch) with its footer, then How It Works; no Tailscale rows", () => {
  const all = installationGroups("iphone", ST());
  const page = subGroups(all, "iphone");
  assert.deepEqual(page.map((g) => g.header), ["Set Up", undefined]);
  assert.deepEqual(page[0].rows.map((r) => [r.label, r.detail]), [["Pair This iPhone", "Done"], ["Test Connection", "Test"], ["Install Switch", "Add"]]);
  assert.match(page[0].rows[0].href, /settings\/installation\/pair$/);
  assert.equal(page[0].rows[2].href, undefined, "Add runs on Set Up itself (F386)");
  assert.equal(typeof page[0].rows[2].onClick, "function");
  assert.equal(page[0].rows[2].subtitle, "Optional: cellular, and your VPN back after");
  assert.equal(page[0].footer, "Test the connection to finish setting up.");
  assert.equal(page[1].rows[0].label, "How It Works");
  assert.match(page[1].rows[0].href, /settings\/installation\/how$/);
  assert.ok(!JSON.stringify(all).includes("Tailscale\""), "no Tailscale group");
  assert.ok(!JSON.stringify(all).includes("Connect With"));
  const tested = localGroups(ST({ tested: true, shortcuts: { switch: true } }));
  assert.deepEqual(tested[0].rows.map((r) => r.detail), ["Done", "Connected", "Done"]);
  assert.match(tested[0].rows[2].href, /settings\/installation\/shortcuts$/, "added: its page, for the test");
  assert.equal(localGroups(ST(), { testing: true })[0].rows[1].detail, "Testing…");
  assert.equal(localGroups(ST(), { testing: true })[0].rows[1].spin, true);
  assert.equal(localGroups(ST(), { reading: true })[0].rows[0].detail, "Checking…");
  assert.equal(localGroups(ST(), { late: true })[0].rows[0].detail, "Not Responding");
  // a failed install: said in the footer, red, with its fix row
  const f = { title: "iPhone Refused", short: "Every connection was refused.", fix: "shortcuts", button: "Set Up" };
  const failed = localGroups(ST({ tested: true }), { failure: f });
  assert.equal(failed[0].warn, true);
  assert.equal(failed[0].footer, "iPhone Refused. Every connection was refused.");
  assert.equal(failed[0].rows.at(-1).label, "Set Up");
  // the page's own titles, each pushed
  for (const k of ["how", "shortcuts", "server", "iphone", "pair"]) assert.ok(SUB_TITLES[k], k);
});

test("an older shell or a profile without Network Extensions keeps the Tailscale and LocalDevVPN groups", () => {
  const gs = installationGroups("iphone", { paired: "rp", localDevVPN: true, tailscale: { connect: "auto" } });
  assert.deepEqual(subGroups(gs, "iphone").map((g) => g.header), ["This iPhone", "Connect With", "Tailscale"]);
});

test("How It Works: one install's steps, a row each, and offline", () => {
  const [steps, offline] = howGroups();
  assert.equal(steps.header, "Each Install");
  assert.equal(steps.rows.length, HOW_STEPS.length);
  assert.deepEqual(steps.rows.map((r) => r.label), ["1. Download", "2. Sign", `3. ${BUILTIN_VPN} On`, "4. Cellular Data Off", "5. Install", "6. All Back On"]);
  assert.deepEqual(offline.rows, [{ label: "Offline", detail: "Works" }]);
});

test("Install Switch's page: one Add row (no Cellular Shortcuts rows); Test once it is added", () => {
  const added = [];
  const gs = shortcutGroups({ shortcuts: { off: false, on: false } }, { add: (k) => added.push(k) });
  assert.equal(gs.length, 1);
  assert.deepEqual(gs[0].rows.map((r) => [r.label, r.detail]), [[SHORTCUT_NAMES.switch, "Add"]]);
  assert.deepEqual(SHORTCUT_NAMES, { off: "Cellular Data Off", on: "Cellular Data On", switch: "Install Switch" });
  gs[0].rows[0].onClick();
  assert.deepEqual(added, ["switch"]);
  assert.match(gs[0].footer, /Add Shortcut/);
  assert.equal(shortcutGroups({ shortcuts: { off: true, on: true } }).length, 1, "the old two don't count as added here");
  const on = shortcutGroups({ shortcuts: { switch: true } });
  assert.deepEqual(on.map((g) => g.rows[0].detail ?? null), ["Added", null]);
  assert.equal(on[1].rows[0].label, "Test Install Switch");
  assert.equal(shortcutGroups({ shortcuts: { switch: true } }, { testing: true })[1].rows[0].detail, "Testing…");
});

test("the tests' answers in words", () => {
  assert.deepEqual(vpnTestResult({ ok: true, ms: 38 }), { title: "Connected", message: `${BUILTIN_VPN} reached this iPhone in 38 ms, then turned off again.` });
  assert.equal(vpnTestResult(null, new Error("vpn_failed: iOS didn't save the VPN configuration (permission denied). Allow it when iOS asks")).title, `${BUILTIN_VPN} Didn't Start`);
  assert.equal(vpnTestResult(null, new Error("refused: this iPhone no longer has the pairing")).again, true);
  // F386: the Install Switch's test
  assert.equal(switchTestResult({ ok: true, start: { ok: true }, end: { ok: true }, vpnOn: true, cellular: false }).title, "Install Switch Works");
  assert.match(switchTestResult({ ok: true, start: { ok: true }, end: { ok: true }, vpnOn: true, cellular: true, wentOff: true }).message, /Cellular Data off/);
  assert.match(switchTestResult({ ok: true, start: { ok: true }, end: { ok: true }, vpnOn: false }).message, new RegExp(`${BUILTIN_VPN} didn't connect`));
  assert.match(switchTestResult({ ok: true, start: { ok: true }, end: { ok: true }, vpnOn: true, cellular: true, wentOff: false }).message, /cellular stayed in use/);
  const nope = switchTestResult({ ok: false, start: { ok: false, error: "Could not find the shortcut" }, end: { ok: true } });
  assert.equal(nope.title, "Shortcut Didn't Run");
  assert.match(nope.message, /"Install Switch": Could not find the shortcut/);
});

test("a failed connect through the built-in VPN never says to turn on LocalDevVPN or Tailscale", () => {
  const st = ST({ tested: true, cellular: true });
  const why = verifyFailure(new Error("connect_failed: no answer"), st);
  assert.equal(why.title, "Couldn't Connect");
  assert.match(why.message, /Install Switch/);
  const refused = routeFailureOf(new Error("route_refused: every port"), st);
  assert.equal(refused.fix, "shortcuts");
  assert.equal(refused.button, CELLULAR.button);
  assert.ok(!/LocalDevVPN|Tailscale/.test(JSON.stringify([why, refused])));
});

test("the test that finishes setting up uses This iPhone only after USE, and only for a while", async () => {
  const { vpnTest, setUseAfterSetup, USE_HOLD } = screens;
  const m = { installRoute: "server" };
  const store = { get: (k) => m[k], set: (k, v) => { m[k] = v; } };
  const native = { call: (x) => (x === "vpn.test" ? Promise.resolve({ ok: true, ms: 40 }) : Promise.reject(new Error("no"))) };
  const alert = async () => ({ index: 0 });
  await vpnTest(native, alert, store);
  assert.equal(m.installRoute, "server", "a plain test switches nothing");
  setUseAfterSetup(true, Date.now() - USE_HOLD - 1);
  await vpnTest(native, alert, store);
  assert.equal(m.installRoute, "server", "USE long ago");
  setUseAfterSetup(true);
  await vpnTest(native, alert, store);
  assert.equal(m.installRoute, "iphone", "USE, then the test: ACTIVE");
});

// ---- user 2026-11-22: on cellular without the Cellular Shortcuts

test("cellular + no Shortcuts -> the warning; Wi-Fi, or the Shortcuts added -> none", () => {
  assert.equal(cellularWarning("iphone", ST({ cellular: true, wifi: false })), true);
  assert.equal(cellularWarning("iphone", ST({ cellular: false, wifi: true })), false, "Wi-Fi");
  assert.equal(cellularWarning("iphone", ST({ cellular: true, shortcuts: { off: true, on: true } })), false, "Shortcuts set");
  assert.equal(cellularWarning("iphone", ST({ cellular: true, shortcuts: { off: true, on: false } })), true, "one of two");
  assert.equal(cellularWarning("server", ST({ cellular: true })), false, "the Signing Server");
  assert.equal(shortcutsAdded(ST({ shortcuts: { off: true, on: true } })), true);
  assert.equal(cellularWarning("iphone", ST({ cellular: true, shortcuts: { switch: true } })), false, "the Install Switch (F386)");
  // Installation & Signing's status cell, with the fix as its action
  const s = installStatus("iphone", ST({ cellular: true }));
  assert.deepEqual([s.state, s.title, s.action, s.tone], ["cellular", CELLULAR.title, "shortcuts", "warn"]);
  assert.equal(installStatus("iphone", ST({ cellular: true, shortcuts: { off: true, on: true } })).state, "ready");
});

test("Home: the slot warns on cellular and opens Cellular Shortcuts; a failed install comes first", async () => {
  const t = cellularTile("sideload", "iphone", VPN({ cellular: true }));
  assert.match(t.href, /settings\/installation\/shortcuts$/);
  assert.deepEqual({ ...t, href: null }, { stage: "close", kind: "cellular", title: CELLULAR.title, subtitle: "On cellular, installs need them", href: null });
  assert.equal(cellularTile("sideload", "iphone", VPN({ cellular: false })), null);
  assert.equal(cellularTile("sideload", "iphone", VPN({ cellular: true, shortcuts: { off: true, on: true } })), null);
  assert.equal(cellularTile("site", "iphone", VPN({ cellular: true })), null);
  assert.equal(cellularTile("sideload", "server", VPN({ cellular: true })), null);
  assert.equal(cellularTile("sideload", "iphone", null), null, "no vpn.status");
  const failed = routeTile("sideload", { title: "Pair Again" }, "iphone");
  assert.equal(slotOrRoute(null, failed ?? t).kind, "route");
  assert.equal(slotOrRoute(null, null ?? t).kind, "cellular");
  // vpn.status is asked only for This iPhone in the sideload app
  const asked = [];
  const native = { call: (m) => { asked.push(m); return Promise.resolve(VPN({ cellular: true })); } };
  assert.equal(await slotVPN("sideload", "server", native), null);
  assert.equal((await slotVPN("sideload", "iphone", native)).cellular, true);
  assert.deepEqual(asked, ["vpn.status"]);
  const home = readFileSync(new URL("./home.js", import.meta.url), "utf8");
  assert.match(home, /routeTile\(settings\.mode, routeFailure\(\), settings\.get\(ROUTE_KEY\)\) \?\? cellularTile\(/);
});

test("an install that starts on cellular asks first: Use Server or Set Up (opens Cellular Shortcuts); no Try Anyway", async () => {
  assert.deepEqual(decideRoute("iphone", ST({ cellular: true })), { route: "idevice", alert: "cellular" });
  assert.deepEqual(ALERTS.cellular.buttons, ["Use Server", "Set Up"]);
  const storage = { getItem: (k) => (k === "ifizbox.installRoute" ? "iphone" : null) };
  const native = { call: (m) => (m === "idevice.status" ? Promise.resolve(ST({ cellular: true })) : Promise.reject(new Error("no"))) };
  const answer = (index) => async (a) => { assert.equal(a.title, CELLULAR.title); return { index }; };
  forgetRoute();
  assert.deepEqual(await chooseRoute({ native, storage, alert: answer(0) }), {}, "Use Server");
  forgetRoute();
  const was = globalThis.location;
  globalThis.location = { hash: "" };
  try { assert.equal(await chooseRoute({ native, storage, alert: answer(1) }), null, "Set Up: the install stops"); } finally { globalThis.location = was; }
  forgetRoute();
  const wifi = { call: () => Promise.resolve(ST({ cellular: false })) };
  let asked = false;
  assert.deepEqual(await chooseRoute({ native: wifi, storage, alert: async () => { asked = true; return { index: 0 }; } }), { route: "idevice" });
  assert.equal(asked, false, "on Wi-Fi nothing is asked");
  forgetRoute();
  const went = [];
  runFix("shortcuts", { go: (r) => went.push(r) });
  assert.deepEqual(went, [["installation", "shortcuts"]]);
});
