// I3: Changes' remembered-app upgrades and the sideload shell's watch list (app-updates.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withAppUpgrades, shellWatch, rememberedApps } from "./app-updates.js";
import { createNativeBackend } from "./backend-native.js";
import { createQueue } from "./core/queue.js";
import { createFakeNative, makeFixture } from "../../native/fake/fake-native.mjs";
import { fakeIndexedDB } from "./fakes.test-helper.js";
import { memoryAppStore } from "./core/installed.js";
import { SELF_ALT_URL } from "./core/essential.js";

const SRC = "https://a.example/apps.json";
const self = { id: "com.ryha.ifizbox", name: "iFizBox", version: "0.2.6", self: true, source: null, date: 0 };

test("jailbreak mode leaves dpkg's upgrades as they are", async () => {
  const up = { available: [{ id: "x", version: "2" }], ignored: [] };
  const store = () => Promise.reject(new Error("must not be read"));
  assert.equal(await withAppUpgrades(up, [], { mode: "jailbreak", store }), up);
});

test("sideload: nothing new to show, and the shell is told what to follow", async () => {
  const calls = [];
  const native = { call: async (m, p) => { calls.push([m, p]); return { scheduled: true }; } };
  const store = async () => memoryAppStore([self, { id: "delta", name: "Delta", version: "1.5", source: SRC, date: 1 }]);
  // B47: the shell follows an app at the source Changes reads it from (its row's key), here at Delta's own version.
  const lookup = async (id) => (id === "delta" ? { key: `alt:${SRC}`, stanza: { version: "1.5" }, row: { name: "Delta" } } : null);
  const up = await withAppUpgrades({ available: [], ignored: [] }, [], { mode: "sideload", native, store, lookup });
  assert.deepEqual(up, { available: [], ignored: [] });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls.filter((c) => c[0] !== "signing.installed"), [["updates.watch", { apps: [
    { id: "com.ryha.ifizbox", name: "iFizBox", version: "0.2.6", source: SELF_ALT_URL },
    { id: "delta", name: "Delta", version: "1.5", source: SRC }], known: [] }]]);
  // The same list again isn't sent twice.
  await withAppUpgrades({ available: [], ignored: [] }, [], { mode: "sideload", native, store, lookup });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.filter((c) => c[0] === "updates.watch").length, 1);
});

test("the shell's known list is every upgrade already counted on screen", () => {
  const w = shellWatch([{ id: "delta", name: "Delta", version: "1.5", source: SRC }], [{ id: "delta", version: "1.6" }, { id: "com.ryha.ifizbox", version: "0.3" }]);
  assert.deepEqual(w.known, ["com.ryha.ifizbox 0.3", "delta 1.6"]);
  assert.deepEqual(w.apps.map((a) => a.id), ["delta"]);
});

// ---- F87: the jailbreak app, with I4's real versions (the fake helper's app-versions over IFIZBOX_APPS_DIR) ----

const plist = (values) => `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n${
  Object.entries(values).map(([k, v]) => `\t<key>${k}</key>\n\t<string>${v}</string>\n`).join("")}</dict>\n</plist>\n`;

function jailbreakBackend(t, { apps = true } = {}) {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const env = {};
  if (apps) {
    const dir = mkdtempSync(join(tmpdir(), "ifizbox-apps-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    for (const [uuid, name, info] of [
      ["0A1B", "Delta.app", { CFBundleIdentifier: "com.rileytestut.Delta", CFBundleShortVersionString: "1.6", CFBundleVersion: "45" }],
      ["2C3D", "UTM.app", { CFBundleIdentifier: "com.utmapp.UTM", CFBundleShortVersionString: "4.5.2", CFBundleVersion: "98" }],
    ]) {
      mkdirSync(join(dir, uuid, name), { recursive: true });
      writeFileSync(join(dir, uuid, name, "Info.plist"), plist(info));
    }
    env.IFIZBOX_APPS_DIR = dir;
  }
  const native = createFakeNative({ prefix: fx.prefix, remote: fx.remote, net: null, env });
  return createNativeBackend({ native, sourceOptions: { indexedDB: fakeIndexedDB(), mode: "jailbreak", queue: createQueue() } });
}

const jbRecords = [
  { ...self, version: "0.2.8" },
  { id: "com.rileytestut.Delta", name: "Delta", version: "1.5", source: SRC, date: 3 }, // updated outside iFizBox to 1.6
  { id: "com.utmapp.UTM", name: "UTM", version: "4.5.2", source: SRC, date: 2 },
  { id: "com.example.gone", name: "Gone", version: "2.0", source: SRC, date: 1 }, // deleted from the Home Screen
];
const offers = (versions) => async (id) => (versions[id] ? { key: `alt:${SRC}`, stanza: { version: versions[id] }, row: { name: id } } : null);

test("jailbreak: a remembered app's upgrade is worked out from the version on the phone", async (t) => {
  const backend = jailbreakBackend(t);
  const store = async () => memoryAppStore(jbRecords);
  const dpkg = { available: [{ id: "com.ex.tweak", name: "Tweak", version: "2", installed: "1" }], ignored: [] };
  const lookup = offers({ "com.rileytestut.Delta": "1.7", "com.utmapp.UTM": "4.6", "com.example.gone": "2.1" });
  const up = await withAppUpgrades(dpkg, ["com.utmapp.UTM"], { mode: "jailbreak", backend, store, lookup });
  assert.deepEqual(up.available.map((r) => [r.id, r.installed, r.version]), [
    ["com.rileytestut.Delta", "1.6", "1.7"], // from 1.6 (on the phone), not the remembered 1.5
    ["com.ex.tweak", "1", "2"], // dpkg's row stays
  ]); // Gone isn't installed: no upgrade for it
  assert.deepEqual(up.ignored.map((r) => r.id), ["com.utmapp.UTM"]); // Ignored Upgrades still apply
});

test("jailbreak: an app the source has at the phone's version is no upgrade, though iFizBox remembered an older one", async (t) => {
  const backend = jailbreakBackend(t);
  const store = async () => memoryAppStore(jbRecords);
  const dpkg = { available: [], ignored: [] };
  const up = await withAppUpgrades(dpkg, [], { mode: "jailbreak", backend, store, lookup: offers({ "com.rileytestut.Delta": "1.6" }) });
  assert.deepEqual(up, { available: [], ignored: [] });
});

test("jailbreak: no remembered apps, or a backend without installedApps, leaves dpkg's upgrades as they are", async (t) => {
  const up = { available: [{ id: "x", version: "2" }], ignored: [] };
  const lookup = () => { throw new Error("must not be asked"); };
  assert.equal(await withAppUpgrades(up, [], { mode: "jailbreak", backend: jailbreakBackend(t), store: async () => memoryAppStore([self]), lookup }), up);
  assert.equal(await withAppUpgrades(up, [], { mode: "jailbreak", backend: {}, store: async () => memoryAppStore([self]), lookup }), up);
});

test("jailbreak: rememberedApps carries I4's notes; the site and the sideload app get the records as they are", async (t) => {
  const backend = jailbreakBackend(t);
  const store = async () => memoryAppStore(jbRecords);
  const notes = Object.fromEntries((await rememberedApps({ mode: "jailbreak", backend, store })).map((r) => [r.id, r.note ?? null]));
  assert.deepEqual(notes, {
    "com.ryha.ifizbox": null,
    "com.rileytestut.Delta": "Installed: 1.6 (iFizBox remembered 1.5)",
    "com.utmapp.UTM": null,
    "com.example.gone": "Not installed (iFizBox remembered 2.0)",
  });
  const boom = { installedApps: () => { throw new Error("must not be asked"); } };
  assert.deepEqual(await rememberedApps({ mode: "sideload", backend: boom, store }), jbRecords);
  // installedApps failing (the helper gone): the records stand.
  const failing = { installedApps: async () => { throw new Error("no helper"); } };
  assert.deepEqual(await rememberedApps({ mode: "jailbreak", backend: failing, store }), jbRecords);
});

// ---- F281: Ignore This Version ----

test("F281 sideload: an app at its ignored version goes under Ignored Upgrades, still followed with that version known", async () => {
  const calls = [];
  const native = { call: async (m, p) => { calls.push([m, p]); return { scheduled: true }; } };
  const store = async () => memoryAppStore([{ id: "delta", name: "Delta", version: "1.5", source: SRC, date: 1 },
    { id: "utm", name: "UTM", version: "4.0", source: SRC, date: 1 }]);
  const offer = { delta: "1.6", utm: "4.5" };
  const lookup = async (id) => (offer[id] ? { key: `alt:${SRC}`, stanza: { version: offer[id] }, row: { name: id } } : null);
  const settled = [];
  const opts = { mode: "sideload", native, store, lookup, installedPkgs: async () => [], settle: (n) => settled.push(n) };
  const up = await withAppUpgrades({ available: [], ignored: [] }, [], { ...opts, versions: { delta: "1.6" } });
  assert.deepEqual(up.available.map((r) => r.id), ["utm"]);
  assert.deepEqual(up.ignored.map((r) => [r.id, r.ignoredVersion]), [["delta", true]]);
  assert.deepEqual(settled, []); // still on offer, not installed: it stays
  await new Promise((r) => setTimeout(r, 0));
  const watch = calls.at(-1)[1];
  assert.deepEqual(watch.apps.map((a) => a.id), ["delta", "utm"]); // the next Delta still notifies
  assert.deepEqual(watch.known, ["delta 1.6", "utm 4.5"]);
  // B207: the icon badge starts from what Changes counts, without the ignored version
  assert.deepEqual(watch.counted, ["utm 4.5"]);
  // The next version shows again, and the entry goes.
  offer.delta = "1.7";
  const next = await withAppUpgrades({ available: [], ignored: [] }, [], { ...opts, versions: { delta: "1.6" } });
  assert.deepEqual(next.available.map((r) => r.id), ["delta", "utm"]);
  assert.deepEqual(settled, [{}]);
});

test("F281: dpkg's rows filed by catalog.upgrades stay ignored; an entry the installed version reached is dropped", async () => {
  const settled = [];
  const up = { available: [{ id: "tweak", name: "Tweak", version: "3", installed: "2" }],
    ignored: [{ id: "old", name: "Old", version: "2", installed: "1", ignoredVersion: true }] };
  const out = await withAppUpgrades(up, [], { mode: "site", store: async () => memoryAppStore([]), lookup: async () => null,
    versions: { old: "2", done: "5" }, installedPkgs: async () => [{ id: "done", installed: "5" }], settle: (n) => settled.push(n) });
  assert.deepEqual(out.ignored.map((r) => r.id), ["old"]);
  assert.deepEqual(out.available.map((r) => r.id), ["tweak"]);
  assert.deepEqual(settled, [{ old: "2" }]);
});

// F285: Settings > Updates > <NAME> Updates off: iFizBox's own entry leaves the lists the background check and the
// push server follow; on again, the last list goes out again with it.
test("self-update alerts off: the shell isn't told to follow iFizBox", async () => {
  const { withoutSelf, selfAlertsChanged } = await import("./app-updates.js");
  const { SELF_ID } = await import("./core/appupdates.js");
  const w = { apps: [{ id: SELF_ID, version: "1" }, { id: "delta", version: "1.5" }], known: [`${SELF_ID} 2`] };
  assert.equal(withoutSelf(w, true), w);
  assert.deepEqual(withoutSelf(w, false), { apps: [{ id: "delta", version: "1.5" }], known: [`${SELF_ID} 2`] });
  const data = new Map([["ifizbox.selfUpdateAlerts", "false"]]);
  const had = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) } });
  try {
    const calls = [];
    const native = { call: async (m, p) => { calls.push([m, p]); return { scheduled: true }; } };
    const store = async () => memoryAppStore([{ ...self, version: "0.9.1" }, { id: "delta", name: "Delta", version: "1.5", source: SRC, date: 1 }]);
    const lookup = async (id) => (id === "delta" ? { key: `alt:${SRC}`, stanza: { version: "1.5" }, row: { name: "Delta" } } : null);
    await withAppUpgrades({ available: [], ignored: [] }, [], { mode: "sideload", native, store, lookup });
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(calls.at(-1)[1].apps.map((a) => a.id), ["delta"]);
    data.set("ifizbox.selfUpdateAlerts", "true");
    selfAlertsChanged();
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(calls.at(-1)[1].apps.map((a) => a.id), [SELF_ID, "delta"]);
    const n = calls.length;
    selfAlertsChanged(); // nothing changed: not sent twice
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(calls.length, n);
  } finally {
    if (had) Object.defineProperty(globalThis, "localStorage", had); else delete globalThis.localStorage;
  }
});

// ---- B476: upgrades only from the source the app was installed from ----

test("B476: another source listing the same bundle ID offers no upgrade; the app's own source does", async () => {
  const OTHER = "https://fastsign.example/repo.json";
  const store = async () => memoryAppStore([
    { id: "com.atebits.Tweetie2", name: "X", version: "10.0", source: SRC, date: 1 },
    { id: "com.google.ios.youtube", name: "YouMod", version: "19.0", key: `alt:${SRC}`, source: SRC, date: 1 },
    { id: "com.local.ipa", name: "Mine", version: "1.0", source: null, date: 1 }]); // My IPAs: no source of its own
  const asked = [];
  // The other source has every app newer; the app's own source has only YouMod newer.
  const lookup = async (id, key) => {
    asked.push([id, key]);
    if (key === `alt:${SRC}` && id === "com.google.ios.youtube") return { key, stanza: { version: "19.1" }, row: { name: "YouMod" } };
    if (key === `alt:${SRC}`) return { key, stanza: { version: id === "com.atebits.Tweetie2" ? "10.0" : "1.0" }, row: {} };
    return { key: `alt:${OTHER}`, stanza: { version: "99" }, row: {} }; // what an any-source lookup would answer
  };
  const up = await withAppUpgrades({ available: [], ignored: [] }, [], { mode: "site", store, lookup });
  assert.deepEqual(up.available.map((r) => [r.id, r.version]), [["com.google.ios.youtube", "19.1"]]);
  assert.ok(asked.every(([, key]) => key === `alt:${SRC}`), "only the install's own source is asked");
  assert.ok(!asked.some(([id]) => id === "com.local.ipa"), "an app with no source of its own is not looked up");
});

// B489: an app kept under its custom bundle ID gets its upgrade from the source's package, and queues from it.
test("a custom-ID record's upgrade looks up the signed record's original ID and queues the source's package", async () => {
  const native = { call: async (m) => (m === "signing.installed" ? { apps: [{ bundleId: "com.me.x", originalBundleId: "com.x" }] } : { scheduled: true }) };
  const store = async () => memoryAppStore([{ id: "com.me.x", name: "X", version: "1.0", source: SRC, date: 1 }]);
  const asked = [];
  const lookup = async (id) => { asked.push(id); return id === "com.x" ? { key: `alt:${SRC}`, stanza: { version: "2.0" }, row: { name: "X" } } : null; };
  const up = await withAppUpgrades({ available: [], ignored: [] }, [], { mode: "sideload", native, store, lookup });
  assert.ok(asked.includes("com.x") && !asked.includes("com.me.x"));
  assert.equal(up.available.length, 1);
  assert.equal(up.available[0].id, "com.me.x");
  assert.equal(up.available[0].sourceId, "com.x");
  const { queueUpgrades } = await import("./screens/changes.js");
  const queued = [];
  const pkgOf = (id) => (id === "com.x" ? { id: "com.x", name: "X", key: `alt:${SRC}`, stanza: { kind: "ipa", ipa: { bundleIdentifier: id, name: "X", sourceUrl: "https://a.example/", versions: [{ version: "2.0", downloadURL: "https://a.example/x.ipa", size: 10 }] } }, row: { id, name: "X" } } : null);
  const jobs = await queueUpgrades(up.available, { add: (j) => queued.push(j), pkgOf });
  assert.equal(jobs.length, 1);
  assert.equal(queued[0].id, "com.x");
  assert.equal(queued[0].installed, "1.0");
});
