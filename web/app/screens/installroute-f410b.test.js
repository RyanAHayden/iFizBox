// F410b: the Quiet Pairing Check: what keeps it from running, and what it keeps or clears. It only ever calls
// idevice.status and idevice.verify: no idevice.forget, no Pairing page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { fakeDocument } from "../fakes.test-helper.js";

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.document ??= fakeDocument();
const { quietPairingCheck, autoCheck, AUTO_CHECK, hudHooks, recheckHooks, TIMEOUTS } = await import("./installroute.js");
const { routeFailure, rememberRouteFailure, NO_ANSWER_FAILURE, QUIET_KEY, QUIET_EVERY } = await import("../core/installroute.js");
hudHooks.show = () => () => {};
recheckHooks.retryMs = 1;
let paged = 0;
recheckHooks.goPair = () => { paged++; };

const NOW = 1_800_000_000_000;
const OK = { paired: "rp", otherVPN: false, vpn: { available: true, tested: true, wifi: true, cellular: false, otherVPN: false, on: false } };
const vpn = (o) => ({ ...OK, vpn: { ...OK.vpn, ...o } });
const coded = (code) => Object.assign(new Error(`${code}: x`), { code });
const iphone = { get: () => "iphone", set: () => { throw new Error("the pick stays"); } };
// `verifies`: each idevice.verify's answer in turn, the last one again after
function phone(st, ...verifies) {
  const calls = [];
  return { calls, call: (m) => {
    calls.push(m);
    let a = { "idevice.status": st, "idevice.verify": verifies.length > 1 ? null : verifies[0] }[m];
    if (m === "idevice.verify" && verifies.length > 1) a = verifies.shift();
    if (typeof a === "function") a = a();
    return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
  } };
}
const run = (native, opts = {}, store = iphone) => quietPairingCheck(native, store, { now: () => NOW, ...opts });
const verifies = (n) => n.calls.filter((m) => m === "idevice.verify").length;
const PAIR = { title: "Pair Again", message: "m", short: "s", fix: "pair", button: "Fix" };
const fresh = () => { mem.clear(); paged = 0; };

test("a pass clears a kept failure, quietly; not again that day", async () => {
  fresh();
  rememberRouteFailure(PAIR);
  const n = phone(OK, { ok: true });
  assert.equal(await run(n), "ok");
  assert.deepEqual(n.calls, ["idevice.status", "idevice.verify"]);
  assert.equal(routeFailure(), null);
  assert.equal(await run(n, { launch: true, now: () => NOW + 60_000 }), "off");
  assert.equal(await run(n, { now: () => NOW + QUIET_EVERY }), "ok");
});

test("a refused pairing is tried twice, then kept as Pair Again; nothing is forgotten, no page opens", async () => {
  fresh();
  const n = phone(OK, coded("refused"));
  assert.equal(await run(n), "failed");
  assert.deepEqual(n.calls, ["idevice.status", "idevice.verify", "idevice.status", "idevice.verify"]);
  assert.equal(routeFailure().title, "Pair Again");
  assert.equal(routeFailure().at, NOW);
  assert.equal(paged, 0);
  // kept: each launch checks, coming back doesn't
  assert.equal(await run(phone(OK, { ok: true }), { now: () => NOW + 1000 }), "off");
  assert.equal(await run(phone(OK, { ok: true }), { launch: true, now: () => NOW + 1000 }), "ok");
  assert.equal(routeFailure(), null);
});

test("refused only for a moment: no warning", async () => {
  fresh();
  assert.equal(await run(phone(OK, coded("refused"), { ok: true })), "ok");
  assert.equal(routeFailure(), null);
});

test("every connection refused is kept too", async () => {
  fresh();
  assert.equal(await run(phone(OK, coded("route_refused"))), "failed");
  assert.equal(routeFailure().title, "iPhone Refused");
});

test("a timeout, a failed connect or a VPN that didn't start shows no warning and leaves a kept one", async () => {
  const was = TIMEOUTS.verify;
  TIMEOUTS.verify = 5;
  try {
    const keep = setTimeout(() => {}, 5000); // `within`'s deadline alone doesn't keep node up
    for (const a of [() => new Promise(() => {}), coded("timeout"), coded("connect_failed"), coded("vpn_failed"), coded("developer_mode")]) {
      fresh();
      const n = phone(OK, a);
      assert.equal(await run(n), "unknown");
      assert.equal(verifies(n), 1);
      assert.equal(routeFailure(), null);
      rememberRouteFailure(NO_ANSWER_FAILURE, { now: 1 });
      assert.equal(await run(n, { launch: true }), "unknown");
      assert.equal(routeFailure().at, 1);
    }
    clearTimeout(keep);
  } finally { TIMEOUTS.verify = was; }
});

test("another VPN, cellular, no network, an untested VPN, not paired, the VPN on: no verify, and the day isn't used up", async () => {
  for (const st of [vpn({ otherVPN: true }), { ...OK, otherVPN: true }, vpn({ cellular: true, wifi: false }), vpn({ wifi: false }),
    vpn({ tested: false }), vpn({ on: true }), vpn({ available: false }), { ...OK, paired: null }, null, new Error("no")]) {
    fresh();
    rememberRouteFailure(PAIR);
    const n = phone(st, { ok: true });
    assert.equal(await run(n, { launch: true }), "off");
    assert.equal(verifies(n), 0, JSON.stringify(st));
    assert.equal(mem.has(QUIET_KEY), false);
    assert.ok(routeFailure());
  }
});

test("the Signing Server route, an install running, the app away: nothing is asked", async () => {
  fresh();
  const n = phone(OK, { ok: true });
  assert.equal(await run(n, {}, { get: () => "server" }), "off");
  assert.equal(await run(n, { installing: () => true }), "off");
  assert.equal(await run(n, { visible: () => false }), "off");
  assert.deepEqual(n.calls, []);
});

test("an install that starts while idevice.status answers, or before the second try, stops it", async () => {
  fresh();
  let busy = false;
  const a = phone(() => { busy = true; return OK; }, { ok: true });
  assert.equal(await run(a, { installing: () => busy }), "off");
  assert.equal(verifies(a), 0);
  busy = false;
  const b = phone(OK, () => { busy = true; return coded("refused"); });
  assert.equal(await run(b, { installing: () => busy }), "unknown");
  assert.equal(verifies(b), 1);
  assert.equal(routeFailure(), null);
});

test("an install that starts during the verify: its answer is dropped, pass or fail", async () => {
  for (const a of [{ ok: true }, coded("refused")]) {
    fresh();
    rememberRouteFailure(PAIR, { now: 1 });
    let busy = false;
    const n = phone(OK, coded("refused"), () => { busy = true; return a; });
    assert.equal(await run(n, { launch: true, installing: () => busy }), "unknown");
    assert.equal(routeFailure().at, 1);
  }
});

test("another VPN that came up before the second try stops it", async () => {
  fresh();
  let st = OK;
  const n = phone(() => st, () => { st = vpn({ otherVPN: true }); return coded("refused"); });
  assert.equal(await run(n), "unknown");
  assert.equal(verifies(n), 1);
  assert.equal(routeFailure(), null);
});

test("one at a time, and a page's check waits for it", async () => {
  fresh();
  rememberRouteFailure(PAIR);
  let answer;
  const n = phone(OK, () => new Promise((r) => { answer = r; }), { ok: true });
  const first = run(n, { launch: true });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(await run(n, { launch: true }), "off");
  AUTO_CHECK.last = 0;
  const page = autoCheck(n, async () => ({}), () => {}, iphone, null, NOW);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(verifies(n), 1);
  answer({ ok: true });
  assert.equal(await first, "unknown", "the page's own check answers instead");
  await page;
  assert.equal(routeFailure(), null);
  assert.equal(verifies(n), 2);
  assert.equal(paged, 0);
});

test("app.js runs it in the sideload app, at launch and on coming back, told of installs", () => {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(app, /quietPairingCheck\(nativeBridge\(\), settingsScreen\.settings, \{ launch: first, visible,\s+installing: \(\) => r\.installingNow\(\) \|\| Boolean\(loadedScreen\("queue"\)\?\.appQueueRunning\(\)\)/);
  assert.match(app, /addEventListener\("visibilitychange", checkPairing\)/);
});
