// This iPhone's page (screens/installroute.js): it draws at once with a spinner while idevice.status answers, then
// pairs by itself with the built-in VPN (or says the profile has no Network Extensions), and a tap on This iPhone
// acts at once.
import { test } from "node:test";
import assert from "node:assert/strict";

import { fakeDocument } from "../fakes.test-helper.js";

// The shared fake DOM: enough for nav/ui.js grouped() and the pair page's sections.
globalThis.document = fakeDocument();
const make = (tag) => document.createElement(tag);

const { drawInstallation, leave, setupGroups, pickRoute } = await import("./installroute.js");

const all = (e) => [e, ...e.children.flatMap(all)];
const withClass = (box, c) => all(box).filter((n) => n._cls.has(c));
const labels = (box) => withClass(box, "cell-label").map((n) => n.textContent);
const store = (route = "server") => { const m = { installRoute: route }; return { get: (k) => m[k], set: (k, v) => { m[k] = v; }, m }; };
const flush = () => new Promise((r) => setTimeout(r, 0));
const NOT_PAIRED = { paired: null, pairOnPhone: true, otherVPN: false, vpn: { available: true, tested: false } };
const NO_EXT = { paired: null, pairOnPhone: true, otherVPN: false, vpn: { available: false } };

// A native bridge whose answers the test gives; every call is recorded.
function bridge(answers) {
  const calls = [];
  return { calls, call: (m, p) => { calls.push([m, p]); const a = answers[m]; return typeof a === "function" ? a(p) : a instanceof Error ? Promise.reject(a) : Promise.resolve(a); } };
}

test("the page draws at once: the intro and a spinner while idevice.status answers", async () => {
  let answer;
  const native = bridge({ "idevice.status": () => new Promise((r) => { answer = r; }) });
  const box = make("div");
  const done = drawInstallation(box, "pair", { store: store(), native, alert: async () => ({ index: 0 }) });
  // before idevice.status answers
  assert.equal(withClass(box, "loading-spinner").length, 1);
  assert.match(withClass(box, "loading")[0].textContent, /Checking/);
  assert.match(box.textContent, /Install on This iPhone/);
  answer(NO_EXT);
  await done;
  assert.ok(!box.textContent.includes("Checking…"));
  leave();
});

test("a profile without Network Extensions: the page says so plainly, and pairing never starts", async () => {
  const native = bridge({ "idevice.status": NO_EXT });
  const asked = [];
  const box = make("div");
  await drawInstallation(box, "pair", { store: store(), native, alert: async (a) => { asked.push(a.title); return { index: 0 }; } });
  await flush();
  assert.deepEqual(labels(box), ["Network Extensions"]);
  assert.match(box.textContent, /no Network Extensions/);
  assert.deepEqual(asked, []);
  assert.ok(!native.calls.some(([m]) => m === "idevice.pair"));
  assert.ok(!/tailscale|localdevvpn/i.test(box.textContent));
  leave();
});

test("with the built-in VPN, iOS 27 pairing starts by itself", async () => {
  let stop;
  const native = { call: (m, p, ev) => {
    if (m === "idevice.status") return Promise.resolve(NOT_PAIRED);
    if (m === "idevice.pair") return new Promise((_, no) => { ev?.({ pin: "123456" }); stop = () => no(Object.assign(new Error("canceled"), { code: "canceled" })); });
    return Promise.resolve(null);
  } };
  const box = make("div");
  await drawInstallation(box, "pair", { store: store("iphone"), native, alert: async () => ({ index: 0 }) });
  await flush();
  assert.ok(stop, "idevice.pair started");
  assert.ok(labels(box).includes("iFizBox VPN"), `rows: ${labels(box)}`);
  leave();
  stop();
});

test("already paired: the page checks This iPhone itself", async () => {
  const native = bridge({ "idevice.status": { paired: "rp", vpn: { available: true, tested: true } } });
  const s = store("server");
  const box = make("div");
  await drawInstallation(box, "pair", { store: s, native, alert: async () => ({ index: 0 }) });
  assert.equal(s.m.installRoute, "iphone");
  assert.ok(labels(box).includes("Check Connection"));
  leave();
});

test("the checking page: the intro and one spinner line", () => {
  assert.deepEqual(setupGroups("checking", undefined, null)[1], { spinner: "Checking…" });
});

test("F300: a tap on This iPhone is checked at once, paired or not (Pairing shows right under it), never waiting", () => {
  const did = [];
  const h = { set: (v) => did.push(v) };
  pickRoute("iphone", h);
  pickRoute("server", h);
  assert.deepEqual(did, ["iphone", "server"]);
});

test("while pairing, the VPN row names the built-in VPN", () => {
  assert.equal(setupGroups("pairing", null, { pin: "1" })[1].rows[0].label, "iFizBox VPN");
});
