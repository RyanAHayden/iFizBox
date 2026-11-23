// B359 (iPhone 18 Pro, iOS 26): Cellular Shortcuts' Add opened an empty new Shortcut and the row said Added at once.
// Now Add shares our signed Shortcut (web/app/shortcuts/, tools/shortcuts/), and back in the app it runs once
// (vpn.checkShortcut): only a run that passed shows Added; otherwise the row stays Add and the footer says it didn't run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

import { fakeDocument } from "../fakes.test-helper.js";

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.document ??= fakeDocument();

const { SHORTCUT_NAMES, shortcutFileURL, shortcutDidntRun } = await import("../core/installroute.js");
const { shortcutGroups, addShortcut, backInApp } = await import("./installroute.js");
const { DOMAIN } = await import("../brand.js");

const here = new URL(".", import.meta.url);

// vpn.openShortcuts answers `opened`; vpn.checkShortcut answers `check` (and the status it leaves).
function phone({ opened = true, check = { ok: true } } = {}) {
  const calls = [];
  const added = { off: false, on: false };
  const native = { call: (m, p) => {
    calls.push([m, p]);
    if (m === "vpn.openShortcuts") return Promise.resolve({ opened, via: "share" });
    if (m === "vpn.checkShortcut") { added[p.which] = Boolean(check.ok); return Promise.resolve({ ...check, status: { shortcuts: { ...added } } }); }
    if (m === "vpn.setShortcut") return Promise.reject(new Error("Add must not mark a Shortcut added"));
    return Promise.resolve({});
  } };
  return { native, calls };
}

test("Add: not Added on open, only once the check run passed", async () => {
  const { native, calls } = phone();
  let back;
  const states = [];
  const p = addShortcut(native, "off", { whenBack: () => new Promise((r) => { back = r; }), checking: (on) => states.push(on) });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls.map((c) => c[0]), ["vpn.openShortcuts"], "nothing runs or is marked until the user is back");
  assert.deepEqual(calls[0][1], { which: "off", url: shortcutFileURL("off") });
  back(true);
  const r = await p;
  assert.deepEqual(calls.map((c) => c[0]), ["vpn.openShortcuts", "vpn.checkShortcut"]);
  assert.deepEqual(calls[1][1], { which: "off" });
  assert.deepEqual(states, [true, false]);
  assert.equal(r.ok, true);
  assert.equal(shortcutGroups(r.status)[0].rows[0].detail, "Added");
});

test("Add: a check run that fails leaves the row Add, and its footer says it didn't run", async () => {
  const { native } = phone({ check: { ok: false, error: "Shortcuts didn't come back in 25 s" } });
  const r = await addShortcut(native, "on", { whenBack: async () => true });
  assert.equal(r.ok, false);
  const gs = shortcutGroups(r.status, { failed: { on: r.error } });
  assert.equal(gs[1].rows[0].detail, "Add");
  assert.equal(gs[1].warn, true);
  assert.equal(gs[1].footer, `"${SHORTCUT_NAMES.on}" didn't run: Shortcuts didn't come back in 25 s. Tap Add to try again.`);
  assert.equal(gs[1].footer, shortcutDidntRun("on", r.error));
  assert.notEqual(gs[0].warn, true, "the other Shortcut's footer is its own hint");
});

test("Add: a share sheet that never opened says so, not that the Shortcut didn't run", async () => {
  const native = { call: (m) => m === "vpn.openShortcuts" ? Promise.reject(new Error("no window to show the share sheet in")) : Promise.resolve({}) };
  const r = await addShortcut(native, "off", { whenBack: async () => true });
  assert.deepEqual(r, { opened: false, ok: false, error: "no window to show the share sheet in" });
  const gs = shortcutGroups({ shortcuts: { off: false, on: false } }, { failed: { off: { open: r.error } } });
  assert.equal(gs[0].footer, `"${SHORTCUT_NAMES.off}" couldn't be shared to Shortcuts: no window to show the share sheet in. Tap Add to try again.`);
  assert.equal(gs[0].warn, true);
});

test("Add: a closed share sheet, or the user still away, runs nothing and marks nothing", async () => {
  const closed = phone({ opened: false });
  assert.deepEqual(await addShortcut(closed.native, "off", { whenBack: async () => true }), { opened: false, ok: false, error: null });
  assert.deepEqual(closed.calls.map((c) => c[0]), ["vpn.openShortcuts"]);
  const away = phone();
  const r = await addShortcut(away.native, "off", { whenBack: async () => false });
  assert.equal(r.ok, false);
  assert.deepEqual(away.calls.map((c) => c[0]), ["vpn.openShortcuts"]);
});

test("the row spins while its check runs; Added rows have no footer warning", () => {
  const gs = shortcutGroups({ shortcuts: { off: false, on: false } }, { checking: "off", failed: { off: "old" } });
  assert.equal(gs[0].rows[0].detail, "Checking…");
  assert.notEqual(gs[0].warn, true);
  const done = shortcutGroups({ shortcuts: { off: true, on: false } }, { failed: { off: "old" } });
  assert.equal(done[0].rows[0].detail, "Added");
  assert.notEqual(done[0].warn, true);
});

test("backInApp: hidden then visible is back; no leave at all resolves after leaveMs", async () => {
  const ls = new Set();
  const doc = { hidden: false, addEventListener: (_, f) => ls.add(f), removeEventListener: (_, f) => ls.delete(f) };
  const p = backInApp(doc, { leaveMs: 1000, limit: 1000 });
  doc.hidden = true; for (const f of ls) f();
  doc.hidden = false; for (const f of ls) f();
  assert.equal(await p, true);
  assert.equal(ls.size, 0);
  assert.equal(await backInApp({ hidden: false }, { leaveMs: 5, limit: 50 }), true);
  assert.equal(await backInApp({ hidden: true }, { leaveMs: 5, limit: 5 }), false);
});

test("the signed Shortcuts are on the site under their names, and the app runs them by those names", () => {
  for (const k of ["off", "on"]) {
    const f = new URL(`../shortcuts/${SHORTCUT_NAMES[k]}.shortcut`, here);
    assert.ok(existsSync(f), `${f.pathname} (tools/shortcuts/sign.sh)`);
    assert.equal(readFileSync(f).subarray(0, 4).toString(), "AEA1", "signed (Apple Encrypted Archive)");
    assert.equal(shortcutFileURL(k), `https://${DOMAIN}/shortcuts/${SHORTCUT_NAMES[k].replaceAll(" ", "%20")}.shortcut`);
  }
  const swift = readFileSync(new URL("../../../native/sideload/vpn/App/LocalVPN.swift", here), "utf8");
  assert.match(swift, /shortcutNames = \["off": "Cellular Data Off", "on": "Cellular Data On"\]/);
  assert.match(swift, /b\.on\("vpn\.checkShortcut"\)/);
  assert.doesNotMatch(swift, /create-shortcut/, "Add never opens an empty new Shortcut");
});
