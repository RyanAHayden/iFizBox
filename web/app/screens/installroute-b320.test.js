// B320 (iPhone 15 Pro): a pairing the phone answers and then drops ("connection invalidated") is tried again and then
// redone by itself; Pair Again from the main page's check opens Pairing, which pairs by itself.
import { test } from "node:test";
import assert from "node:assert/strict";

import { fakeDocument } from "../fakes.test-helper.js";

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.document = fakeDocument();

const { mainPage, recheckPairing, recheckHooks, hudHooks, turnedDown, AUTO_CHECK, forgetStatus } = await import("./installroute.js");
const { clearRouteFailure, verifyFailure } = await import("../core/installroute.js");
const huds = [];
hudHooks.show = (l) => { huds.push(l); return () => {}; };
hudHooks.delay = 0;
recheckHooks.retryMs = 5;

const all = (e) => [e, ...e.children.flatMap(all)];
const withClass = (box, c) => all(box).filter((n) => n._cls.has(c));
const tap = (cell) => Promise.all(cell.listeners.click.map((f) => f({})));
const store = (route = "iphone") => { const m = { installRoute: route }; return { get: (k) => m[k], set: (k, v) => { m[k] = v; }, m }; };
const fail = (message, code) => Object.assign(new Error(message), { code });
const PAIRED_TS = { paired: "rp", pairOnPhone: true, otherVPN: false, vpn: { available: true, tested: true } };
const PAIRED_LOCAL = PAIRED_TS;
const INVALIDATED = fail("bad_pairing: connection invalidated", "bad_pairing");

function phone(answers) {
  const calls = [];
  return { calls, call: (m) => { calls.push(m); const a = answers[m]; return typeof a === "function" ? a() : a instanceof Error ? Promise.reject(a) : Promise.resolve(a); } };
}

test("turnedDown: refused, pair_again, an early EOF or an invalidated channel; never a timeout or a late answer", () => {
  const why = (e) => verifyFailure(e, PAIRED_TS);
  const refused = fail("refused: port 49152", "refused");
  assert.equal(turnedDown(why(refused), refused), true);
  const again = fail("pair_again: this iPhone answered through the VPN, then closed the connection", "pair_again");
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
  const VPN_ON = { paired: null, pairOnPhone: true, otherVPN: false, vpn: { available: true, tested: true } };
  const pending = [];
  const calls = [];
  const native = { call: (m, p, ev) => {
    calls.push(m);
    if (m === "idevice.status") return Promise.resolve(VPN_ON);
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

test("Install Apps With's check of the kept pairing spins the Pairing row, not the HUD", async () => {
  const { installationGroups } = await import("./installroute.js");
  const pairingRow = (o) => installationGroups("iphone", PAIRED_TS, o).find((g) => g.header === "Set Up").rows[0];
  assert.equal(pairingRow({ pairChecking: true }).spin, true);
  assert.equal(pairingRow({}).spin, undefined);
  const src = (await import("node:fs")).readFileSync(new URL("./installroute.js", import.meta.url), "utf8");
  assert.match(src, /if \(v === "iphone" && v !== choice\) recheckPairing\(native, alert, redraw, \{ spin: pairSpin \}\)/);
});
