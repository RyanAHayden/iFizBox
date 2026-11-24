// F417b: Use Shortcut on This iPhone's page, and Check Connection checking its Shortcut.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDocument } from "../fakes.test-helper.js";

const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.document = fakeDocument();
const { localGroups, drawInstallation, mainPage, hudHooks, AUTO_CHECK, forgetStatus, autoCheck } = await import("./installroute.js");
const { rememberRouteFailure, routeFailure, routeFailureOf } = await import("../core/installroute.js");
hudHooks.show = () => () => {};

const ST = { paired: "rp", pairOnPhone: true, otherVPN: false, vpn: { available: true, tested: true, wifi: true, cellular: false } };
const iphone = { get: () => "iphone", set: () => {} };
const all = (e) => [e, ...e.children.flatMap(all)];
const wait = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 1)); };
const group = (gs, key) => gs.find((g) => g.key === key);
function phone({ status = { available: true, bundled: true, added: true }, check = { ok: true }, add = { opened: false } } = {}) {
  const calls = [];
  return { calls, call: async (m) => {
    calls.push(m);
    return { "idevice.status": ST, "idevice.verify": { ok: true }, "cellular.status": status, "cellular.check": check, "cellular.add": add }[m] ?? {};
  } };
}

test("the rows: Use Shortcut in the middle, Add Shortcut Again while it's picked, neither where it can't run", () => {
  const on = localGroups(ST, { cellular: "shortcut", shortcut: true });
  assert.deepEqual(group(on, "cellular").rows.map((r) => [r.label, r.checked]), [["Ask Each Time", false], ["Use Shortcut", true], ["Use Signing Server", false]]);
  assert.equal(group(on, "cellshortcut").rows[0].label, "Add Shortcut Again");
  assert.equal(group(on, "cellshortcut").footer, "Only if you deleted it from Shortcuts.");
  assert.equal(group(localGroups(ST, { cellular: "ask", shortcut: true }), "cellshortcut"), undefined);
  const none = localGroups(ST, { cellular: "shortcut", shortcut: false });
  assert.deepEqual(group(none, "cellular").rows.map((r) => r.checked), [true, false]);
  assert.equal(group(none, "cellshortcut"), undefined);
});

test("picking Use Shortcut: an added one at once; else the share sheet first, and a closed one picks nothing", async () => {
  for (const [added, choice] of [[true, "shortcut"], [false, null]]) {
    mem.clear();
    forgetStatus();
    const native = phone({ status: { available: true, bundled: true, added } });
    const box = document.createElement("div");
    await drawInstallation(box, "iphone", { store: iphone, native, alert: async () => ({ index: 0 }) });
    await wait();
    const row = all(box).find((n) => n._cls.has("route-row") && /Use Shortcut/.test(n.textContent));
    await Promise.all((row.listeners.click ?? all(row).find((n) => n.listeners?.click).listeners.click).map((f) => f({})));
    await wait();
    assert.equal(mem.get("ifizbox.onCellular") ?? null, choice);
    assert.equal(native.calls.includes("cellular.add"), !added);
  }
});

async function check(native, taps = []) {
  forgetStatus();
  AUTO_CHECK.last = Date.now();
  const said = [];
  const page = mainPage({ store: iphone, native, alert: async (a) => { said.push(a); return { index: taps.shift() ?? 0 }; }, links: {} });
  Object.defineProperty(page.el, "isConnected", { value: true });
  await page.refresh();
  const cell = all(page.el).find((n) => n._cls.has("install-action")).children[0];
  await Promise.all(cell.listeners.click.map((f) => f({})));
  await wait();
  return said;
}

test("Check Connection checks the Shortcut only when it's chosen, and says so with a fix", async () => {
  mem.clear();
  const ask = phone();
  assert.deepEqual(await check(ask), []);
  assert.ok(!ask.calls.includes("cellular.check"));
  mem.set("ifizbox.onCellular", "shortcut");
  const fine = phone();
  assert.deepEqual(await check(fine), []);
  assert.ok(fine.calls.includes("cellular.check"));
  const old = phone({ status: { available: false } });
  assert.deepEqual(await check(old), []);
  assert.ok(!old.calls.includes("cellular.check"));
  const gone = phone({ check: { ok: false, error: "not_run" } });
  const said = await check(gone, [1]);
  assert.deepEqual([said.length, said[0].title, said[0].buttons], [1, "Shortcut Didn't Run", ["Not Now", "Add Shortcut Again"]]);
  assert.match(said[0].message, /^This iPhone answered.*wasn't found/);
  assert.ok(gone.calls.includes("cellular.add"));
  assert.equal(routeFailure(), null, "the connection works");
});

test("the automatic check never opens Shortcuts", async () => {
  mem.clear();
  mem.set("ifizbox.onCellular", "shortcut");
  rememberRouteFailure(routeFailureOf(Object.assign(new Error("refused: x"), { code: "refused" }), ST));
  const native = phone();
  await autoCheck(native, async () => ({ index: 0 }), () => {}, iphone, null, Date.now() + 60_000);
  assert.ok(native.calls.includes("idevice.verify") && !native.calls.includes("cellular.check"));
});
