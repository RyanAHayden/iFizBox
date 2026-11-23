// B69: in the jailbreak app, Modify on an installed app's page opens Cydia's sheet (Upgrade/Reinstall, Ignore Upgrades,
// Remove, Downgrade, Version) instead of installing at once; Install (not installed) keeps its one tap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { jailbreakModify, jailbreakModifyButtons, IGNORE_UPGRADES, STOP_IGNORING } from "./altstore.js";
import { ignoreAction, ignoreVersionAction, versionRowItems } from "./browse.js";
import { IGNORE_VERSION, STOP_IGNORING_VERSION } from "../core/appupdates.js";
import { memoryAppStore } from "../core/installed.js";
import { createSettings } from "../core/settings.js";

const pkg = { key: "alt:k", row: { id: "com.x.a", name: "A" }, stanza: { kind: "ipa", ipa: { bundleIdentifier: "com.x.a", name: "A",
  sourceUrl: "https://s/", versions: [{ version: "3", downloadURL: "https://s/a3.ipa" }, { version: "2", downloadURL: "https://s/a2.ipa" },
    { version: "1", downloadURL: "https://s/a1.ipa" }] } } };

function memHolds(list = []) {
  const s = new Set(list);
  const calls = [];
  return { calls, has: (id) => s.has(id), set: async (id, on, opts) => { calls.push([id, on, opts]); if (on) s.add(id); else s.delete(id); return true; } };
}

// F281: Ignore This Version's store (core/settings.js ignoredVersions), in memory.
function memVersions(init = {}) {
  const m = { ...init };
  return { map: m, get: (id) => m[id] ?? null, set: (id, v) => { if (v) m[id] = v; else delete m[id]; } };
}

const run = async (records, pick, extra = {}) => {
  const installs = [];
  const asked = [];
  const done = await jailbreakModify(pkg, { install: (v) => installs.push(v.version), history: () => installs.push("history"),
    store: async () => memoryAppStore(records), holds: extra.holds ?? memHolds(), remove: extra.remove ?? (() => assert.fail("removed")),
    iv: extra.iv ?? memVersions(),
    ask: async (o) => { asked.push(o); return typeof pick === "function" ? pick(o, asked.length) : o.buttons.indexOf(pick); } });
  return { done, installs, asked };
};

test("not installed: false, so Install installs at once as before (no sheet)", async () => {
  const r = await run([], () => assert.fail("asked"));
  assert.equal(r.done, false);
  assert.deepEqual(r.installs, []);
});

test("installed, upgrade out: the sheet, nothing installed until a button is picked", async () => {
  const r = await run([{ id: "com.x.a", version: "2" }], () => -1);
  assert.equal(r.done, true);
  assert.deepEqual(r.installs, []);
  assert.equal(r.asked[0].title, "A");
  assert.deepEqual(r.asked[0].buttons, ["Upgrade", IGNORE_VERSION, IGNORE_UPGRADES, "Remove", "Downgrade", "Version"]);
  assert.deepEqual(r.asked[0].destructive, [2, 3, 1]);
});

test("F281: Ignore This Version keeps only the version on offer; Stop Ignoring This Version takes it back", async () => {
  const iv = memVersions();
  const r = await run([{ id: "com.x.a", version: "2" }], IGNORE_VERSION, { iv });
  assert.deepEqual(r.installs, []);
  assert.deepEqual(iv.map, { "com.x.a": "3" });
  const again = await run([{ id: "com.x.a", version: "2" }], STOP_IGNORING_VERSION, { iv });
  assert.deepEqual(again.asked[0].buttons, ["Upgrade", STOP_IGNORING_VERSION, IGNORE_UPGRADES, "Remove", "Downgrade", "Version"]);
  assert.deepEqual(iv.map, {});
  // Ignored whole (Ignore Upgrades): no version button; an older ignored version than the one on offer: Ignore again.
  const held = await run([{ id: "com.x.a", version: "2" }], () => -1, { holds: memHolds(["com.x.a"]), iv: memVersions() });
  assert.equal(held.asked[0].buttons.includes(IGNORE_VERSION), false);
  const old = await run([{ id: "com.x.a", version: "1" }], () => -1, { iv: memVersions({ "com.x.a": "2" }) });
  assert.equal(old.asked[0].buttons[1], IGNORE_VERSION);
});

test("F281: the package page's ignoreVersionAction, beside Ignore Upgrades", () => {
  const iv = memVersions();
  const a = ignoreVersionAction("p", { installed: "1", newest: "2" }, { holds: memHolds(), iv });
  assert.equal(a.label, IGNORE_VERSION);
  assert.equal(a.red, true);
  a.run();
  assert.deepEqual(iv.map, { p: "2" });
  const b = ignoreVersionAction("p", { installed: "1", newest: "2" }, { holds: memHolds(), iv });
  assert.equal(b.label, STOP_IGNORING_VERSION);
  b.run();
  assert.deepEqual(iv.map, {});
  assert.equal(ignoreVersionAction("p", { installed: "2", newest: "2" }, { holds: memHolds(), iv }), null);
  assert.equal(ignoreVersionAction("p", { installed: "1", newest: "2" }, { holds: memHolds(["p"]), iv }), null);
});

test("F281: Changes' hold menu: Ignore This Version on an available upgrade row, Stop Ignoring on one it filed", () => {
  const iv = memVersions();
  const deps = { holds: memHolds(), blocked: { has: () => false }, iv };
  const row = { id: "p", change: "upgrade", version: "2", installed: "1" };
  const [item] = versionRowItems(row, deps);
  assert.equal(item.label, IGNORE_VERSION);
  item.onClick();
  assert.deepEqual(iv.map, { p: "2" });
  assert.equal(versionRowItems({ ...row, ignoredVersion: true }, deps)[0].label, STOP_IGNORING_VERSION);
  assert.deepEqual(versionRowItems({ ...row, change: "updated" }, deps), []); // a day's row, not an upgrade
  assert.deepEqual(versionRowItems({ id: "q", change: "upgrade", version: "2", installed: "1" }, { ...deps, holds: memHolds(["q"]) }), []);
});

test("Upgrade installs the newest; Reinstall the installed version; Downgrade asks which", async () => {
  assert.deepEqual((await run([{ id: "com.x.a", version: "2" }], "Upgrade")).installs, ["3"]);
  const re = await run([{ id: "com.x.a", version: "3" }], "Reinstall");
  assert.deepEqual(re.asked[0].buttons, ["Reinstall", "Remove", "Downgrade", "Version"]); // no upgrade: no Ignore
  assert.deepEqual(re.installs, ["3"]);
  const down = await run([{ id: "com.x.a", version: "3" }], (o, n) => (n === 1 ? o.buttons.indexOf("Downgrade") : 1));
  assert.deepEqual(down.asked[1].buttons, ["2", "1"]);
  assert.deepEqual(down.installs, ["1"]);
  assert.deepEqual((await run([{ id: "com.x.a", version: "3" }], "Version")).installs, ["history"]);
});

test("Ignore Upgrades holds the app on the device (no dpkg); Stop Ignoring Upgrades lets it go", async () => {
  const holds = memHolds();
  await run([{ id: "com.x.a", version: "2" }], IGNORE_UPGRADES, { holds });
  assert.deepEqual(holds.calls, [["com.x.a", true, { dpkg: false }]]);
  const again = await run([{ id: "com.x.a", version: "2" }], STOP_IGNORING, { holds });
  assert.deepEqual(again.asked[0].buttons, ["Upgrade", STOP_IGNORING, "Remove", "Downgrade", "Version"]);
  assert.equal(holds.has("com.x.a"), false);
});

test("Remove hands the app to the Installed tab's Delete", async () => {
  const removed = [];
  await run([{ id: "com.x.a", version: "2" }], "Remove", { remove: (a) => removed.push(a) });
  assert.deepEqual(removed, [{ id: "com.x.a", name: "A" }]);
});

test("jailbreakModifyButtons: one version, nothing older, no Version", () => {
  assert.deepEqual(jailbreakModifyButtons({ installed: "1", newest: "1" }), ["Reinstall", "Remove"]);
});

test("browse.js packageActions asks jailbreakModify before the one-tap install row", () => {
  const src = readFileSync(new URL("./browse.js", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("async function packageActions("));
  const modify = body.indexOf("jailbreakModify(");
  assert.ok(modify > 0, "packageActions calls jailbreakModify");
  assert.ok(modify < body.indexOf("rows[0].onClick();"), "before Install's one tap");
});

test("APT Modify: Ignore Upgrades while an upgrade is out, Stop Ignoring once held", async () => {
  const holds = memHolds();
  assert.equal(ignoreAction("p", false, holds), null);
  const a = ignoreAction("p", true, holds);
  assert.equal(a.label, "Ignore Upgrades");
  await a.run();
  assert.equal(ignoreAction("p", false, holds).label, "Stop Ignoring Upgrades");
});

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}

test("settings.holds: an app hold ({ dpkg: false }) runs no helper and survives dpkg's showhold", async () => {
  const words = [];
  const helper = async (w) => { words.push(w); return { code: 0, stdout: w[0] === "showhold" ? "tweak\n" : "" }; };
  const s = createSettings({ storage: memStorage(), mode: "jailbreak", helper });
  assert.equal(await s.holds.set("com.x.a", true, { dpkg: false }), true);
  assert.deepEqual(words, []);
  await s.holds.sync();
  assert.deepEqual(s.holds.list(), ["com.x.a", "tweak"]);
  assert.equal(s.holds.has("com.x.a"), true);
  assert.equal(await s.holds.set("com.x.a", false), true); // Settings' Ignored Upgrades row: no helper for an app
  assert.deepEqual(words, [["showhold"]]);
  assert.deepEqual(s.holds.list(), ["tweak"]);
});
