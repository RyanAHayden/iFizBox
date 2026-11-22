// B320 (iPhone 15 Pro, a Tailscale sign-in from Installation & Signing): the sign-in's tap no longer starts the
// automatic check (its x flashed on the row while the sign-in waited behind it); the checks after the sign-in spin the
// status cell, not a HUD; a pairing the phone answers and then drops ("connection invalidated") is tried again and then
// redone by itself; Pair Again from the main page's check opens Pairing, which pairs by itself.
import { test } from "node:test";
import assert from "node:assert/strict";

import { fakeDocument } from "../fakes.test-helper.js";

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.document = fakeDocument();

const { mainPage, recheckPairing, connectAfterSignIn, recheckHooks, hudHooks, turnedDown, autoCheck, AUTO_CHECK, forgetStatus, AFTER_SIGN_IN } = await import("./installroute.js");
const { rememberRouteFailure, clearRouteFailure, routeFailureOf, verifyFailure } = await import("../core/installroute.js");
const huds = [];
hudHooks.show = (l) => { huds.push(l); return () => {}; };
hudHooks.delay = 0;
recheckHooks.retryMs = 5;
AFTER_SIGN_IN.gapMs = 5;

const all = (e) => [e, ...e.children.flatMap(all)];
const withClass = (box, c) => all(box).filter((n) => n._cls.has(c));
const tap = (cell) => Promise.all(cell.listeners.click.map((f) => f({})));
const store = (route = "iphone") => { const m = { installRoute: route }; return { get: (k) => m[k], set: (k, v) => { m[k] = v; }, m }; };
const fail = (message, code) => Object.assign(new Error(message), { code });
const PAIRED_TS = { paired: "rp", pairOnPhone: true, localDevVPN: false, otherVPN: true, tailscale: { connect: "tailscale", signedIn: true, address: "100.64.0.2", use: true } };
const SIGNED_OUT = { ...PAIRED_TS, tailscale: { ...PAIRED_TS.tailscale, signedIn: false, use: false } };
const PAIRED_LOCAL = { paired: "rp", pairOnPhone: true, localDevVPN: true, otherVPN: false, tailscale: { connect: "auto", signedIn: false } };
const INVALIDATED = fail("bad_pairing: connection invalidated", "bad_pairing");

function phone(answers) {
  const calls = [];
  return { calls, call: (m) => { calls.push(m); const a = answers[m]; return typeof a === "function" ? a() : a instanceof Error ? Promise.reject(a) : Promise.resolve(a); } };
}

test("turnedDown: refused, pair_again, an early EOF or an invalidated channel; never a timeout or a late answer", () => {
  const why = (e) => verifyFailure(e, PAIRED_TS);
  const refused = fail("refused: port 49152", "refused");
  assert.equal(turnedDown(why(refused), refused), true);
  const again = fail("pair_again: this iPhone answered through Tailscale, then closed the connection", "pair_again");
  assert.equal(turnedDown(why(again), again), true);
  assert.equal(turnedDown(why(INVALIDATED), INVALIDATED), true);
  const timeout = fail("timeout: no answer from iOS for 30 s", "timeout");
  assert.equal(turnedDown(why(timeout), timeout), false, "Pairing Didn't Work's catch-all, but not the pairing's fault");
  assert.equal(turnedDown({ late: true }, null), false);
  assert.equal(turnedDown(null, null), false);
});

test("a pairing the phone drops twice is forgotten and Pairing opens by itself, with its spinner, no HUD", async () => {
  huds.length = 0;
  const native = phone({ "idevice.status": PAIRED_TS, "idevice.verify": INVALIDATED, "idevice.forget": {} });
  const alerts = [], spins = [];
  let wentToPair = 0;
  recheckHooks.goPair = () => { wentToPair++; };
  const r = await recheckPairing(native, async (a) => { alerts.push(a); return { index: 0 }; }, () => {}, { spin: (l) => { spins.push(l); return () => spins.push("stop"); } });
  assert.equal(r, "repair");
  assert.deepEqual(native.calls, ["idevice.status", "idevice.verify", "idevice.verify", "idevice.forget"], "tried again once first");
  assert.equal(wentToPair, 1);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].message, /no longer accepts .*'s pairing\. Pairing starts again now\./);
  assert.doesNotMatch(alerts[0].message, /refused/, "it wasn't refused");
  assert.deepEqual(spins, ["Checking Pairing", "stop"]);
  assert.deepEqual(huds.filter((h) => h !== "Forgetting Pairing"), [], "the check itself shows no HUD");
});

test("dropped once, then the retry connects: the pairing stays", async () => {
  let n = 0;
  const native = phone({ "idevice.status": PAIRED_TS, "idevice.verify": () => (n++ ? Promise.resolve({ ok: true }) : Promise.reject(INVALIDATED)) });
  recheckHooks.goPair = () => assert.fail("no pairing again");
  const r = await recheckPairing(native, async () => assert.fail("no alert"), () => {});
  assert.equal(r, "ok");
  assert.ok(!native.calls.includes("idevice.forget"));
});

test("the checks after a sign-in use the page's spinner for both steps, never the HUD", async () => {
  huds.length = 0;
  const native = phone({ "tailscale.test": { ok: true }, "idevice.status": PAIRED_TS, "idevice.verify": { ok: true } });
  const spins = [];
  const r = await connectAfterSignIn(native, async () => assert.fail("no alert"), () => {}, { spin: (l) => { spins.push(l); return () => spins.push("stop"); } });
  assert.equal(r, "ok");
  assert.deepEqual(spins, ["Checking Connection", "stop", "Checking Pairing", "stop"]);
  assert.deepEqual(huds, []);
});

test("no automatic check while Tailscale signs in; the main page's Sign In spins its status cell, no HUD", async () => {
  forgetStatus();
  huds.length = 0;
  clearRouteFailure();
  rememberRouteFailure(routeFailureOf(fail("tailscale_signed_out: Tailscale signed iFizBox out", "tailscale_signed_out"), SIGNED_OUT));
  let signedIn = false, finish = null;
  const native = phone({
    "idevice.status": () => Promise.resolve(signedIn ? PAIRED_TS : SIGNED_OUT),
    "tailscale.signIn": () => new Promise((r) => { finish = () => { signedIn = true; r(PAIRED_TS.tailscale); }; }),
    "tailscale.test": () => new Promise((r) => { tested = () => r({ ok: true }); }), "idevice.verify": { ok: true },
  });
  let tested = null;
  const page = mainPage({ store: store(), native, alert: async () => assert.fail("no alert"), links: {} });
  AUTO_CHECK.last = Date.now(); // the page's first read: no automatic check yet
  await page.refresh();
  assert.equal(page.status().action, "signIn", `status: ${page.status().state}`);
  AUTO_CHECK.last = 0;
  const action = withClass(page.el, "install-action")[0].children[0];
  const tapped = tap(action);
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(finish, "the sign-in runs");
  assert.ok(!native.calls.includes("idevice.verify"), "the sign-in's redraw starts no check");
  assert.equal(autoCheck(native, async () => ({}), () => {}, store(), null, Date.now() + 60000), null, "nor does opening a page meanwhile");
  finish();
  await new Promise((r) => setTimeout(r, 5));
  const status = withClass(page.el, "install-status")[0].children[0];
  assert.ok(tested, "Checking Connection runs");
  assert.equal(withClass(status, "loading-spinner").length, 1, "the status cell spins in its row");
  assert.equal(page.status().state, "checking");
  tested();
  await tapped;
  assert.deepEqual(huds, []);
  assert.equal(withClass(status, "loading-spinner").length, 0);
  assert.ok(native.calls.includes("idevice.verify"), "the pairing was checked after the sign-in");
  clearRouteFailure();
});

test("Pair Again from the main page's Check Connection opens Pairing (it pairs by itself)", async () => {
  forgetStatus();
  clearRouteFailure();
  let wentToPair = 0;
  recheckHooks.goPair = () => { wentToPair++; };
  const native = phone({ "idevice.status": PAIRED_LOCAL, "idevice.verify": fail("bad_pairing: the pairing file is damaged", "bad_pairing"), "idevice.forget": {} });
  const alerts = [];
  const page = mainPage({ store: store(), native, alert: async (a) => { alerts.push(a); return { index: 1 }; }, links: {} });
  AUTO_CHECK.last = Date.now();
  await page.refresh();
  await tap(withClass(page.el, "install-action")[0].children[0]);
  assert.deepEqual(alerts.map((a) => a.buttons), [["Cancel", "Pair Again"]]);
  assert.ok(native.calls.includes("idevice.forget"));
  assert.equal(wentToPair, 1);
  clearRouteFailure();
});

test("leaving and coming back pairs again at once; the left visit's late answer leaves the new pairing alone", async () => {
  const { format, settingsRoute } = await import("../router.js");
  const { drawInstallation, leave, pendingStep } = await import("./installroute.js");
  globalThis.location = { hash: format(settingsRoute(["installation", "pair"])) };
  const VPN_ON = { paired: null, pairOnPhone: true, localDevVPN: true, otherVPN: false, tailscale: { connect: "auto", signedIn: false } };
  const pending = [];
  const calls = [];
  const native = { call: (m, p, ev) => {
    calls.push(m);
    if (m === "idevice.status") return Promise.resolve(VPN_ON);
    if (m === "idevice.vpnApps") return Promise.resolve({ localdevvpn: true });
    if (m === "idevice.pair") return new Promise((_, no) => { ev?.({ pin: "123456" }); pending.push(() => no(Object.assign(new Error("canceled: pairing stopped"), { code: "canceled" }))); });
    return Promise.resolve({ ok: true });
  } };
  const st = { m: { installRoute: "iphone" }, get(k) { return this.m[k]; }, set(k, v) { this.m[k] = v; } };
  const draw = async () => { const box = document.createElement("div"); await drawInstallation(box, "pair", { store: st, native, alert: async () => ({ index: 0 }) }); await new Promise((r) => setTimeout(r, 0)); return box; };
  await draw();
  assert.equal(pendingStep(), "pairing");
  leave(); // the shell's answer to the left visit comes later (it keeps the advertisement a while)
  await draw();
  assert.equal(calls.filter((c) => c === "idevice.pair").length, 2, "the new visit asked at once");
  pending[0](); // the left visit's call answers now
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(pendingStep(), "pairing", "the new visit still pairs");
  leave();
  pending[1]();
});
