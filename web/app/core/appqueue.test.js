// F80: the sideload app's install queue (core/appqueue.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAppQueue, appJob, appPlan, jobDownloads, runOrder, appNavLabel, modifyActions, sizeText, SELF_ID } from "./appqueue.js";

const pkg = (id, versions, extra = {}) => ({ key: "alt:https://s/", row: { id, name: id.toUpperCase() },
  stanza: { kind: "ipa", ipa: { bundleIdentifier: id, name: id.toUpperCase(), sourceUrl: "https://s/apps.json", sourceName: "S",
    iconURL: `https://s/${id}.png`, versions, ...extra } } });

test("an app queue: one job per app, its mode, replaced when queued again, events for each change", () => {
  const q = createAppQueue();
  const seen = [];
  q.subscribe((e) => seen.push(e.type));
  assert.equal(q.add({ id: "a", name: "A", version: "2", installed: "1", url: "https://x/a.ipa" }).mode, "upgrade");
  assert.equal(q.add({ id: "b", version: "1", url: "https://x/b.ipa" }).mode, "install");
  assert.equal(q.add({ id: "a", version: "1", installed: "1", url: "https://x/a.ipa" }).mode, "reinstall");
  assert.deepEqual(q.list().map((j) => `${j.id}:${j.mode}`), ["a:reinstall", "b:install"]);
  assert.equal(q.size, 2);
  q.clear("a");
  q.clear("nope");
  assert.equal(q.get("a"), null);
  q.clearAll();
  q.clearAll();
  assert.deepEqual(seen, ["add", "add", "add", "clear", "clearAll"]);
  assert.throws(() => q.add({ id: "c" }), /no IPA/);
  assert.throws(() => q.add({ url: "https://x" }), /no app id/);
});

test("appJob: the newest version (or the one asked), its IPA, size and record fields; none for a source-signed link", () => {
  const p = pkg("com.x.a", [{ version: "2.0", downloadURL: "https://s/a2.ipa", size: 3145728 }, { version: "1.0", downloadURL: "https://s/a1.ipa" }]);
  assert.deepEqual(appJob(p, { installed: "1.0" }), { id: "com.x.a", name: "COM.X.A", version: "2.0", installed: "1.0", url: "https://s/a2.ipa",
    size: 3145728, icon: "https://s/com.x.a.png", key: "alt:https://s/", source: "https://s/apps.json", sourceName: "S" });
  assert.equal(appJob(p, { version: "1.0" }).url, "https://s/a1.ipa");
  assert.equal(appJob(pkg("i", [{ version: "1", downloadURL: "itms-services://?action=download-manifest&url=x" }])), null);
  assert.equal(appJob(pkg("n", [])), null);
  assert.equal(appJob({ stanza: { kind: "deb" } }), null);
});

test("appPlan: Confirm's groups (core/queue.js parseSimulation's shape) and the total download", () => {
  const q = createAppQueue();
  q.add({ id: "a", version: "2", installed: "1", url: "u", size: 1048576 });
  q.add({ id: "b", version: "1", url: "u", size: 2097152,
    deps: [{ id: "lib", version: "3", size: 1048576 }, { id: "a", version: "2", installed: "1" }] });
  const plan = appPlan(q.list());
  assert.deepEqual(plan.installs.map((e) => e.id), ["lib", "b"]); // a dependency shows under Install, ahead of its app
  assert.deepEqual(plan.upgrades, [{ id: "a", from: "1", to: "2" }]); // listed once
  assert.deepEqual([plan.reinstalls, plan.downgrades, plan.removes, plan.essential], [[], [], [], []]);
  assert.equal(plan.download, "4.0 MB");
  assert.equal(appPlan([]).download, null);
  assert.equal(sizeText(2048), "2 kB");
});

test("appPlan's download counts only jobs that download (B282)", () => {
  const q = createAppQueue();
  q.add({ id: "lib", version: "1", installed: "1", library: "Lib.ipa", size: 20480 }); // a My IPAs Reinstall
  q.add({ id: "rs", version: "1", installed: "1", mode: "resign", size: 4096 }); // Re-sign from the record
  q.add({ id: "mk", version: "1", installed: "1", mode: "resign", url: "https://s/mk.ipa", size: 1048576 }); // marked app
  q.add({ id: "up", version: "2", installed: "1", url: "https://s/up.ipa", size: 1048576 });
  q.add({ id: "gone", op: "remove", size: 999 });
  assert.equal(appPlan(q.list()).download, "2.0 MB");
  assert.equal(appPlan([q.get("lib"), q.get("rs")]).download, null);
  assert.equal(jobDownloads(q.get("lib")), false);
  assert.equal(jobDownloads(q.get("mk")), true);
});

test("runOrder: as queued, iFizBox itself last", () => {
  assert.deepEqual(runOrder([{ id: SELF_ID }, { id: "a" }, { id: "b" }]).map((j) => j.id), ["a", "b", SELF_ID]);
});

test("the app page's nav button: Modify while queued, else Install / Upgrade / Reinstall; Modify offers Clear first", () => {
  assert.equal(appNavLabel({}), "Install");
  assert.equal(appNavLabel({ installed: "1", newest: "2" }), "Modify"); // installed: Modify, as Cydia's
  assert.equal(appNavLabel({ installed: "2", newest: "2" }), "Modify");
  assert.equal(appNavLabel({ installed: "", newest: "2" }), "Modify"); // marked installed, version unknown
  assert.deepEqual(modifyActions({ installed: "1", newest: "2" }), ["Upgrade"]);
  assert.deepEqual(modifyActions({ installed: "2", newest: "2", older: true }), ["Reinstall", "Downgrade"]);
  assert.deepEqual(modifyActions({}), ["Install"]);
  assert.equal(appNavLabel({ queued: true, installed: "1", newest: "2" }), "Modify");
  assert.equal(appNavLabel({ queued: true }), "Modify");
  assert.deepEqual(modifyActions({ queued: true, installed: "1", newest: "2" }), ["Clear", "Upgrade"]);
  assert.deepEqual(modifyActions({ queued: true }), ["Clear", "Install"]);
  assert.deepEqual(modifyActions({}), ["Install"]);
});

// B484: an app installed under a custom bundle ID upgrades under that ID, not the source's bundleIdentifier.
test("B484: an upgrade of an app installed as com.me.x from source ID com.x signs as com.me.x", async () => {
  const { withInstalledId, installedIdFor, customParams } = await import("./appqueue.js");
  const { withInstalledIds, runAppQueue } = await import("../screens/queue.js");
  const { prepareParams } = await import("../signing/queue.js");
  const p = pkg("com.x", [{ version: "2.0", downloadURL: "https://s/x2.ipa" }, { version: "1.0", downloadURL: "https://s/x1.ipa" }]);
  const signed = [{ bundleId: "com.me.x", originalBundleId: "com.x", version: "1.0" }];
  // Installed's record is com.x at 1.0 (Changes' row and the app page's Upgrade both build this job)
  const job = { ...appJob(p, { installed: "1.0" }), mode: "upgrade" };
  assert.equal(job.id, "com.x");
  assert.equal(installedIdFor(job, signed), "com.me.x");
  const up = withInstalledId(job, { signed });
  assert.equal(up.id, "com.x", "the queue and Installed's record keep the source's ID");
  assert.equal(up.options.edits.bundleId, "com.me.x");
  assert.equal(up.options.signsAs, "com.me.x");
  assert.equal(customParams(up).bundleId, "com.me.x", "the one at a time run (installCustom)");
  assert.equal(customParams(up).url, "https://s/x2.ipa");
  assert.equal(prepareParams(up).bundleId, "com.me.x", "the sign-ahead run (signing.prepare)");
  // the saved IPA's Sign Options (F379) go with it; the installed ID wins
  const saved = [{ file: "x.ipa", bundleId: "com.x", version: "1.0", options: { bundleId: "com.me.x", name: "Mine" } }];
  const named = withInstalledId(job, { signed, saved });
  assert.deepEqual(named.options.edits, { bundleId: "com.me.x", name: "Mine" });
  assert.equal(named.options.name, "Mine");
  // left alone: a copy under its own ID too, no signed record, a fresh Install, a Custom Install's own choice, a Re-sign
  assert.equal(withInstalledId(job, { signed: [...signed, { bundleId: "com.x", originalBundleId: "com.x" }] }), job);
  assert.equal(withInstalledId(job, { signed: [] }), job);
  assert.equal(withInstalledId(job, { signed: [{ bundleId: "com.x", originalBundleId: "com.x" }] }), job);
  const fresh = appJob(p);
  assert.equal(withInstalledId(fresh, { signed }), fresh);
  const custom = { ...job, options: { edits: { bundleId: "com.other.x" } } };
  assert.equal(withInstalledId(custom, { signed }), custom);
  const resign = { id: "com.x", installed: "1.0", mode: "resign" };
  assert.equal(withInstalledId(resign, { signed }), resign);
  const self = { ...job, id: SELF_ID };
  assert.equal(withInstalledId(self, { signed: [{ bundleId: `${SELF_ID}.T`, originalBundleId: SELF_ID }] }), self);

  // the run reads the shell's records: Confirm's run signs com.me.x
  const calls = [];
  const native = { call: async (m) => { calls.push(m); return m === "signing.installed" ? { apps: signed } : { ipas: saved }; } };
  const [ran] = await withInstalledIds([job], { native });
  assert.equal(ran.options.edits.bundleId, "com.me.x");
  assert.deepEqual(calls, ["signing.installed", "library.list"]);
  const plain = appJob(pkg("com.y", [{ version: "1", downloadURL: "https://s/y.ipa" }]));
  calls.length = 0;
  assert.deepEqual(await withInstalledIds([plain], { native }), [plain], "nothing installed: no call");
  assert.deepEqual(calls, []);
  assert.deepEqual(await withInstalledIds([job], { native: null }), [job], "the website: as it is");
  const failing = { call: async () => { throw new Error("no"); } };
  assert.deepEqual(await withInstalledIds([job], { native: failing }), [job]);
  const q = createAppQueue();
  q.add(job);
  const seen = [];
  const n = await runAppQueue(q.list(), { queue: q, ready: async () => true, record: async () => {}, recount: () => {},
    installedIds: (js) => withInstalledIds(js, { native }), install: async (j) => { seen.push(j.options?.edits?.bundleId); return true; } });
  assert.equal(n, 1);
  assert.deepEqual(seen, ["com.me.x"]);
});
