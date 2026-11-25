// F420: setting up Restore My VPN: the Shortcut added, then its store run.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fakeDocument, fakeNative, memStorage } from "../fakes.test-helper.js";

globalThis.document ??= fakeDocument();
globalThis.localStorage = memStorage();
const { setUpRestore } = await import("./restoresetup.js");
const { keepRestore, restoreKept } = await import("../core/installroute.js");
beforeEach(() => localStorage.clear());

// store: the store runs' answers, in turn; a pass is kept in the status
async function run({ kept, vpn = {}, add = { opened: true }, store = [{ ok: true }], taps = [], turnedOn = true, back = true } = {}) {
  if (kept) keepRestore(kept);
  const st = { vpn: { available: true, restore: true, remembered: false, otherVPN: true, ...vpn } };
  const said = [], waits = [];
  const native = fakeNative({ "restore.add": add instanceof Error ? add : () => add, "restore.store": () => store.shift() });
  const answer = await setUpRestore(native, { turnedOn, status: async () => st, whenBack: async () => back, wait: async (ms) => waits.push(ms),
    alert: async (a) => { said.push([a.title, a.buttons]); return { index: taps.shift() ?? 0 }; } });
  return { answer, said, waits, calls: native.calls.map((c) => c.method.replace("restore.", "")), kept: restoreKept() };
}

test("added, then remembered with the VPN on; off, only added", async () => {
  assert.deepEqual(await run(), { answer: true, said: [], waits: [], calls: ["add", "store"], kept: "2" });
  localStorage.clear();
  assert.deepEqual(await run({ vpn: { otherVPN: false } }), { answer: true, said: [], waits: [], calls: ["add"], kept: "1" });
});

test("already added: never added twice; turning it on remembers the VPN that is on now", async () => {
  assert.deepEqual((await run({ kept: "1" })).calls, ["store"]);
  assert.deepEqual((await run({ kept: "2", vpn: { remembered: true } })).calls, ["store"]);
  assert.deepEqual((await run({ kept: "2", vpn: { remembered: true, otherVPN: false } })).calls, []);
});

test("the share sheet closed, or never back: nothing more; refused: says so, and false", async () => {
  assert.deepEqual(await run({ add: { opened: false } }), { answer: true, said: [], waits: [], calls: ["add"], kept: null });
  assert.deepEqual((await run({ back: false })).calls, ["add"]);
  localStorage.clear();
  const r = await run({ add: new Error("unavailable: the Shortcut needs iOS 16") });
  assert.equal((await run({ add: new Error("no screen to show the share sheet on") })).answer, true, "only for now: it stays on");
  assert.deepEqual([r.answer, r.said, r.kept], [false, [["Couldn't Add Shortcut", ["OK"]]], null]);
});

test("turned off meanwhile: nothing is remembered", async () => {
  assert.deepEqual((await run({ vpn: { restore: false } })).calls, ["add"]);
});

test("the row, the VPN off: says to turn it on", async () => {
  const r = await run({ kept: "1", turnedOn: false, vpn: { otherVPN: false }, store: [{ ok: false, error: "no_vpn" }] });
  assert.deepEqual(r.said, [["Turn Your VPN On", ["OK"]]]);
  assert.equal(r.kept, "1");
});

test("a Shortcut that wasn't found: Add Shortcut Again, then remembered; Not Now leaves Add Shortcut", async () => {
  const gone = { ok: false, error: "not_run", text: "Could not find the shortcut" };
  const r = await run({ kept: "2", store: [gone, { ok: true }], taps: [2] });
  assert.deepEqual(r.said, [["VPN Not Remembered", ["Not Now", "Try Again", "Add Shortcut Again"]]]);
  assert.deepEqual([r.calls, r.kept], [["store", "add", "store"], "2"]);
  assert.equal((await run({ kept: "2", store: [gone] })).kept, "0");
});

test("Allow still up: not forgotten; Try Again waits out a busy one", async () => {
  const r = await run({ kept: "1", store: [{ ok: false, error: "not_run", text: "canceled" }, { ok: false, error: "busy" }, { ok: true }], taps: [1] });
  assert.deepEqual([r.calls, r.waits, r.kept], [["store", "store", "store"], [2000], "2"]);
  const busy = await run({ kept: "1", store: Array(9).fill({ ok: false, error: "busy" }) });
  assert.deepEqual([busy.calls.length, busy.said[0][1]], [6, ["Not Now", "Try Again"]]);
});
