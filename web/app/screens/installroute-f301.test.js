// F301: This iPhone's settings (sideload build) answer quickly and calmly: idevice.status is read at once and fills the
// rows; every read has a deadline (Not Responding instead of spinning on); the last answer shows at once on the next
// draw, its rows spinning while it's read again; a repaint changes only the rows that changed (no full redraw); Test
// Connection spins in its own row; Check Connection without the built-in VPN answers at once instead of waiting out
// idevice.verify.
import { test } from "node:test";
import assert from "node:assert/strict";

import { fakeDocument } from "../fakes.test-helper.js";

// The shared fake DOM: enough for nav/ui.js grouped().
globalThis.document = fakeDocument();
const make = (tag) => document.createElement(tag);

const { drawInstallation, hudHooks, TIMEOUTS, NOT_RESPONDING, forgetStatus, cachedStatus, within, leave } = await import("./installroute.js");

const all = (e) => [e, ...e.children.flatMap(all)];
const withClass = (box, c) => all(box).filter((n) => n._cls.has(c));
const labels = (box) => withClass(box, "cell-label").map((n) => n.textContent);
const cellOf = (box, label) => withClass(box, "cell-inner").find((n) => withClass(n, "cell-label")[0]?.textContent === label);
const detailOf = (box, label) => withClass(cellOf(box, label), "cell-detail")[0]?.textContent;
const spins = (box, label) => withClass(cellOf(box, label), "loading-spinner").length === 1;
const tap = (box, label) => {
  const cell = cellOf(box, label);
  assert.ok(cell, `no row ${label}: ${labels(box)}`);
  return Promise.all(cell.listeners.click.map((f) => f({})));
};
const store = (route = "iphone") => { const m = { installRoute: route }; return { get: (k) => m[k], set: (k, v) => { m[k] = v; }, m }; };
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };
const later = () => { let answer; const p = new Promise((r) => { answer = r; }); return { p, answer }; };
const PAIRED_ON = { paired: "rp", pairOnPhone: true, otherVPN: false, vpn: { available: true, tested: true } };

function bridge(answers) {
  const calls = [];
  return { calls, call: (m, p, ev) => { calls.push(m); const a = answers[m]; return typeof a === "function" ? a(p, ev) : a instanceof Error ? Promise.reject(a) : Promise.resolve(a); } };
}
const huds = [];
hudHooks.show = (l) => { huds.push(l); return () => {}; };
hudHooks.delay = 0;

test("the read goes out at once; every Set Up row says Checking… until it answers", async () => {
  forgetStatus();
  const dev = later();
  const native = bridge({ "idevice.status": () => dev.p });
  const box = make("div");
  const done = drawInstallation(box, "iphone", { store: store(), native });
  assert.deepEqual(native.calls, ["idevice.status"]);
  assert.equal(detailOf(box, "Pair This iPhone"), "Checking…");
  assert.ok(spins(box, "Pair This iPhone") && spins(box, "Test Connection") && spins(box, "Install Switch"), "each row has its own spinner");
  dev.answer(PAIRED_ON);
  await done;
  assert.equal(detailOf(box, "Pair This iPhone"), "Done");
  assert.equal(withClass(box, "loading-spinner").length, 0);
});

test("a read past its deadline says Not Responding in its rows, and nothing spins on", async () => {
  forgetStatus();
  const was = { ...TIMEOUTS };
  TIMEOUTS.status = 20;
  try {
    const native = bridge({ "idevice.status": () => new Promise(() => {}) });
    const box = make("div");
    await drawInstallation(box, "iphone", { store: store(), native });
    assert.equal(detailOf(box, "Pair This iPhone"), NOT_RESPONDING);
    assert.equal(withClass(box, "loading-spinner").length, 0, "no row spins for ever");
    assert.ok(withClass(box, "install-red").length >= 1, "in red");
  } finally { Object.assign(TIMEOUTS, was); }
  await assert.rejects(within(new Promise(() => {}), 5), (e) => e.code === "not_responding");
  assert.equal(await within(Promise.resolve(7), 50), 7);
});

test("the last answer shows at once on the next draw, its rows spinning while it's read again", async () => {
  forgetStatus();
  await drawInstallation(make("div"), "iphone", { store: store(), native: bridge({ "idevice.status": PAIRED_ON }) });
  assert.equal(cachedStatus().paired, "rp");
  const dev = later();
  const box = make("div");
  const done = drawInstallation(box, "iphone", { store: store(), native: bridge({ "idevice.status": () => dev.p }) });
  assert.equal(detailOf(box, "Pair This iPhone"), "Done", "no Checking… when an answer is known");
  assert.ok(spins(box, "Pair This iPhone"), "but its row spins while it's read again");
  assert.ok(labels(box).includes("Test Connection"));
  dev.answer({ ...PAIRED_ON, paired: null });
  await done;
  assert.equal(detailOf(box, "Pair This iPhone"), "Start", "the fresh answer replaces it");
  assert.equal(withClass(box, "loading-spinner").length, 0);
});

test("an answer patches the rows in place: groups and unchanged rows stay the same elements", async () => {
  forgetStatus();
  const dev = later();
  const box = make("div");
  const done = drawInstallation(box, "iphone", { store: store(), native: bridge({ "idevice.status": () => dev.p }) });
  await flush();
  const groups = [...box.children];
  const howRow = cellOf(box, "How It Works");
  const pairRow = cellOf(box, "Pair This iPhone");
  dev.answer(PAIRED_ON);
  await done;
  assert.equal(box.children.length, groups.length);
  assert.ok(box.children[1] === groups[1], "so is How It Works' group (Set Up's gets its footer, so it's drawn again)");
  assert.ok(cellOf(box, "How It Works") === howRow, "a row whose content didn't change is the same element");
  assert.ok(cellOf(box, "Pair This iPhone") !== pairRow, "the row that changed was swapped");
  assert.equal(detailOf(box, "Pair This iPhone"), "Done");
});

test("a row kept from an earlier draw calls the latest draw's handler", async () => {
  forgetStatus();
  const box = make("div");
  const calls = [];
  const native = bridge({ "idevice.status": { ...PAIRED_ON, vpn: { available: true, tested: false } }, "vpn.test": () => { calls.push(1); return Promise.resolve({ ok: true }); } });
  const alert = async () => ({ index: 0 });
  await drawInstallation(box, "iphone", { store: store(), native, alert });
  const row = cellOf(box, "Test Connection");
  await drawInstallation(box, "iphone", { store: store(), native, alert });
  assert.equal(cellOf(box, "Test Connection"), row, "kept");
  await tap(box, "Test Connection");
  assert.deepEqual(calls, [1]);
});

test("Test Connection spins Testing… in its own row (no HUD) and ends with the answer's alert", async () => {
  forgetStatus();
  huds.length = 0;
  const alerts = [];
  const test = later();
  const box = make("div");
  const native = bridge({ "idevice.status": PAIRED_ON, "vpn.test": () => test.p });
  await drawInstallation(box, "iphone", { store: store(), native, alert: async (a) => { alerts.push(a); return { index: 0 }; } });
  const run = tap(box, "Test Connection");
  await flush();
  assert.ok(spins(box, "Test Connection"));
  assert.equal(detailOf(box, "Test Connection"), "Testing…");
  tap(box, "Test Connection"); // a second tap while it runs does nothing
  test.answer({ ok: true, ms: 40 });
  await run;
  assert.deepEqual(huds, []);
  assert.deepEqual(alerts.map((a) => a.title), ["Connected"]);
  assert.equal(native.calls.filter((c) => c === "vpn.test").length, 1);
});

test("Check Connection on the Pairing page: no built-in VPN by the time it's tapped, the answer comes from idevice.status alone", async () => {
  forgetStatus();
  const alerts = [];
  let n = 0;
  const native = bridge({ "idevice.status": () => Promise.resolve(n++ ? { ...PAIRED_ON, vpn: { available: false } } : PAIRED_ON),
    "idevice.verify": () => new Promise(() => {}) });
  const box = make("div");
  await drawInstallation(box, "pair", { store: store(), native, alert: async (a) => { alerts.push(a.title); return { index: 0 }; } });
  await tap(box, "Check Connection");
  assert.deepEqual(alerts, ["No Network Extensions"]);
  assert.ok(!native.calls.includes("idevice.verify"), "idevice.verify isn't asked");
  leave();
});
