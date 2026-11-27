import { test } from "node:test";
import assert from "node:assert/strict";
import { itemsOf, nav, scopeOf, emptyText, canUpgrade, upgradeLabel, upgradeJobs, upgradeAll } from "./changes.js";
import { createQueue } from "../core/queue.js";
import { pageOf, token } from "./browse.js";

test("Changes: a header per day, newest first, then its rows; package pages open below the tab", () => {
  const now = new Date(2026, 10, 17, 15).getTime();
  const day = (n) => new Date(2026, 10, 17 - n).getTime();
  const items = itemsOf([
    { day: day(0), rows: [{ id: "a", name: "A", change: "updated" }] },
    { day: day(1), rows: [{ id: "b", name: "B", change: "new" }, { id: "c", name: "C", change: "new" }] },
    { day: day(3), rows: [{ id: "d", name: "D", change: "new" }] },
  ], "en-US", undefined, { now });
  assert.deepEqual(items.map((i) => i.header ?? i.id), ["Today", "a", "Yesterday", "b", "c", "Saturday, November 14", "d"]);
  assert.equal(nav({ tab: "changes", path: [] }).left.label, "Refresh");
  assert.deepEqual(pageOf({ tab: "changes", path: [token("package", "a")] }), { key: "*", page: "package", value: "a" });
});

test("Changes: Available then Ignored Upgrades first; an upgraded package isn't listed again under New at", () => {
  const now = new Date(2026, 10, 17, 15).getTime();
  const items = itemsOf([{ day: new Date(2026, 10, 17).getTime(), rows: [{ id: "bash", name: "Bash", change: "updated" }, { id: "x", name: "X", change: "new" }] }],
    "en-US", { available: [{ id: "bash", name: "Bash", version: "2", installed: "1" }], ignored: [{ id: "wb", name: "WB", version: "3", installed: "2" }] }, { now });
  assert.deepEqual(items.map((i) => i.header ?? `${i.id}:${i.change}`),
    ["Available Upgrades", "bash:upgrade", "Ignored Upgrades", "wb:upgrade", "Today", "x:new"]);
  assert.deepEqual(itemsOf([], "en-US", { available: [], ignored: [] }), []);
});

test("Changes (F51): Installed scope keeps installed rows, upgrades stay on top; search filters both", () => {
  const now = new Date(2026, 10, 17, 15).getTime();
  const groups = [{ day: new Date(2026, 10, 17).getTime(), rows: [
    { id: "x", name: "Xen", short: "a theme", change: "new" }, { id: "y", name: "Yarn", author: "Saurik", change: "updated" }] }];
  const upgrades = { available: [{ id: "bash", name: "Bash", version: "2", installed: "1" }], ignored: [] };
  const installed = new Set(["bash", "y"]);
  const ids = (o) => itemsOf(groups, "en-US", upgrades, { now, installed, ...o }).map((i) => i.header ?? i.id);
  assert.deepEqual(ids({ scope: "all" }), ["Available Upgrades", "bash", "Today", "x", "y"]);
  assert.deepEqual(ids({ scope: "installed" }), ["Available Upgrades", "bash", "Today", "y"]);
  assert.deepEqual(ids({ scope: "all", query: "saurik" }), ["Today", "y"]);
  assert.deepEqual(ids({ scope: "all", query: "BA" }), ["Available Upgrades", "bash"]);
  assert.deepEqual(ids({ scope: "installed", query: "theme" }), []);
  assert.match(emptyText({ query: "q" }), /match/);
  assert.match(emptyText({ scope: "installed" }), /installed/);
});

test("Changes (F51): default scope is Installed with installs, All without; a pick holds", () => {
  assert.equal(scopeOf(null, new Set(["a"])), "installed");
  assert.equal(scopeOf(null, new Set()), "all");
  assert.equal(scopeOf("all", new Set(["a"])), "all");
  assert.equal(scopeOf("installed", new Set()), "installed");
});

test("Changes (F62): Upgrade (N) queues every available upgrade, never the ignored ones; jailbreak build only", () => {
  const upgrades = { available: [{ id: "bash", name: "Bash", version: "5.2", installed: "5.1" }, { id: "zsh", name: "Zsh", version: "5.9", installed: "5.8" }],
    ignored: [{ id: "wb", name: "WB", version: "3", installed: "2" }] };
  const q = createQueue();
  const events = [];
  q.subscribe((e) => events.push(e.type));
  const jobs = upgradeAll((job) => q.add(job), upgrades.available);
  assert.deepEqual(jobs, [
    { op: "install", id: "bash", version: "5.2", installed: "5.1", name: "Bash" },
    { op: "install", id: "zsh", version: "5.9", installed: "5.8", name: "Zsh" }]);
  assert.deepEqual(q.list().map((j) => `${j.id}=${j.version}:${j.mode}`), ["bash=5.2:upgrade", "zsh=5.9:upgrade"]);
  assert.equal(q.get("wb"), null);
  assert.deepEqual(events, ["add", "add"]); // the first add opens Confirm (screens/queue.js initQueue)
  assert.deepEqual(upgradeAll(null, upgrades.available), []);
  assert.deepEqual(upgradeJobs([{ id: "x" }, null]), []);
  assert.equal(upgradeLabel(2), "Upgrade (2)");

  const withQueue = () => ({ queue() {} });
  assert.equal(canUpgrade("jailbreak", withQueue), true);
  assert.equal(canUpgrade("jailbreak", () => ({})), false);
  assert.equal(canUpgrade("site", withQueue), false);
  assert.equal(canUpgrade("sideload", withQueue), false);
  assert.equal(nav({ tab: "changes", path: [] }).right, undefined); // node: the site
});

test("sideload Upgrade (N) (F80): every app upgrade with an IPA queued for Confirm; iFizBox's row by its own IPA", async () => {
  const { queueUpgrades } = await import("./changes.js");
  const pkg = (id) => ({ key: "alt:k", row: { id, name: id }, stanza: { kind: "ipa", ipa: { bundleIdentifier: id, name: id.toUpperCase(),
    sourceUrl: "https://s/", versions: [{ version: "2", downloadURL: `https://x/${id}.ipa`, size: 10 }, { version: "1", downloadURL: `https://x/${id}-1.ipa` }] } } });
  const added = [];
  const jobs = await queueUpgrades([
    { id: "com.ryha.ifizbox", name: "iFizBox", version: "0.9", installed: "0.8", ipa: "https://github.com/x/iFizBox.ipa" },
    { id: "a", version: "2", installed: "1" }, { id: "gone", version: "3", installed: "1" }, null],
  { pkgOf: async (id) => (id === "a" ? pkg(id) : null), add: (job) => added.push(job) });
  assert.deepEqual(added, jobs);
  assert.deepEqual(jobs.map((j) => `${j.id}=${j.version} from ${j.installed} ${j.url}`),
    ["com.ryha.ifizbox=0.9 from 0.8 https://github.com/x/iFizBox.ipa", "a=2 from 1 https://x/a.ipa"]);
  assert.equal(jobs[1].name, "A");
  assert.deepEqual(await queueUpgrades(undefined, { add: () => assert.fail("nothing to queue") }), []);
});

test("B159: iFizBox's row from GitHub's release installs that IPA even while its source still lists the older one", async () => {
  const { queueUpgrades } = await import("./changes.js");
  const source = { key: "alt:self", row: { id: "com.ryha.ifizbox", name: "iFizBox" }, stanza: { kind: "ipa", ipa: {
    bundleIdentifier: "com.ryha.ifizbox", name: "iFizBox", sourceUrl: "https://ifizbox.com/repo/source.json",
    versions: [{ version: "0.12.0", downloadURL: "https://ifizbox.com/repo/iFizBox-0.12.0.ipa", size: 15 }] } } };
  const gh = "https://github.com/x/releases/download/v0.13.0/iFizBox.ipa";
  const [job] = await queueUpgrades([{ id: "com.ryha.ifizbox", name: "iFizBox", version: "0.13.0", installed: "0.12.0", ipa: gh }],
    { pkgOf: async () => source, add: () => {} });
  assert.deepEqual([job.version, job.url, job.installed, job.size], ["0.13.0", gh, "0.12.0", null]);
  assert.equal(job.key, "alt:self", "still the source's package for its page");
  // the source's own newest (the row's version is listed): the source's IPA, as before
  const [same] = await queueUpgrades([{ id: "com.ryha.ifizbox", version: "0.12.0", installed: "0.11.0", ipa: gh }],
    { pkgOf: async () => source, add: () => {} });
  assert.deepEqual([same.version, same.url], ["0.12.0", "https://ifizbox.com/repo/iFizBox-0.12.0.ipa"]);
});

test("F87: Upgrade in the jailbreak app queues dpkg's rows, not the remembered apps' (apt has no such package)", () => {
  assert.deepEqual(upgradeJobs([{ id: "tweak", version: "2", installed: "1", name: "Tweak" },
    { id: "com.rileytestut.Delta", version: "1.7", installed: "1.6", name: "Delta", remembered: true }]).map((j) => j.id), ["tweak"]);
});

test("B68: the jailbreak app's Upgrade (N) counts the remembered apps' upgrades too", async () => {
  const { jailbreakUpgradeCount } = await import("./changes.js");
  const delta = { id: "delta", name: "Delta", version: "2", installed: "1", remembered: true };
  const tweak = { id: "tweak", name: "Tweak", version: "2", installed: "1" };
  // Every listed upgrade an app: the button used to say Upgrade (0) and hide.
  assert.equal(jailbreakUpgradeCount([delta]), 1);
  assert.equal(jailbreakUpgradeCount([tweak, delta, { ...delta, id: "paid" }], new Set(["paid"])), 2);
  assert.equal(jailbreakUpgradeCount(undefined), 0);

});

// F255: the app upgrades go into the app queue (app-queue.js) beside apt's packages, so one Confirm runs them all
// (screens/queue.js runJailbreakApps), instead of an install console per app.
test("F255: the jailbreak app's Upgrade (N) queues app upgrades in the app queue beside apt's packages", async () => {
  const { upgradeAllJailbreak } = await import("./changes.js");
  const { createAppQueue } = await import("../core/appqueue.js");
  const pkg = (id) => ({ key: "alt:k", row: { id, name: id }, stanza: { kind: "ipa", ipa: { bundleIdentifier: id, name: id.toUpperCase(),
    sourceUrl: "https://s/", versions: [{ version: "2", downloadURL: `https://x/${id}.ipa` }, { version: "1", downloadURL: `https://x/${id}-1.ipa` }] } } });
  const delta = { id: "delta", name: "Delta", version: "2", installed: "1", remembered: true };
  const tweak = { id: "tweak", name: "Tweak", version: "2", installed: "1" };

  // Apps only: nothing for apt, each app an upgrade job in the app queue (the first add opens Confirm: not quiet).
  let apps = createAppQueue();
  const events = [];
  apps.subscribe((e) => events.push(e));
  let r = await upgradeAllJailbreak([delta, { ...delta, id: "gba", name: "GBA" }], null,
    { queue: () => assert.fail("apt has no package for an app"), pkgOf: async (id) => pkg(id), apps });
  assert.deepEqual(r.apt, []);
  assert.deepEqual(apps.list().map((j) => `${j.id} ${j.mode} ${j.installed}->${j.version} ${j.url}`),
    ["delta upgrade 1->2 https://x/delta.ipa", "gba upgrade 1->2 https://x/gba.ipa"]);
  assert.deepEqual(r.apps.map((j) => j.id), ["delta", "gba"]);
  assert.ok(events.every((e) => e.type === "add" && !e.quiet), "queued loud, so Confirm opens");

  // Both: apt's row in the install queue, the app in the app queue: one Confirm lists them.
  apps = createAppQueue();
  const queued = [];
  r = await upgradeAllJailbreak([tweak, delta], null, { queue: (j) => queued.push(j.id), pkgOf: async (id) => pkg(id), apps });
  assert.deepEqual(queued, ["tweak"]);
  assert.deepEqual(apps.list().map((j) => j.id), ["delta"]);

  // A row the catalog doesn't know brings its own IPA; one with neither is left out; skipped (vendor-sold) ones too.
  apps = createAppQueue();
  r = await upgradeAllJailbreak([{ ...delta, id: "own", ipa: "https://y/own.ipa" }, { ...delta, id: "none" }, { ...delta, id: "paid" }],
    new Set(["paid"]), { queue: () => {}, pkgOf: async () => null, apps });
  assert.deepEqual(apps.list().map((j) => `${j.id} ${j.url}`), ["own https://y/own.ipa"]);
  assert.deepEqual(r.apps.map((j) => j.id), ["own"]);
});

test("Changes (B462): Refresh runs under the reload bar, no Reloading Data HUD; one at a time; waits for a running refresh", async () => {
  const { refreshInBar } = await import("./changes.js");
  const steps = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const ctx = { showHUD: () => { steps.push("hud"); return () => {}; } };
  const first = refreshInBar(ctx, {
    background: async (c) => { assert.equal(c, ctx); steps.push("bar"); await gate; },
    settled: async () => { steps.push("settled"); },
    reload: async () => { steps.push("reload"); },
  });
  assert.equal(await refreshInBar(ctx, { background: async () => { steps.push("second"); } }), false); // busy
  release();
  assert.equal(await first, true);
  assert.deepEqual(steps, ["bar", "settled", "reload"]); // never the HUD
  // the bar's Cancel stops the whole Refresh: no reload, not counted as a refresh
  const after = [];
  assert.equal(await refreshInBar(ctx, { background: async () => "cancelled", settled: async () => after.push("settled"), reload: async () => after.push("reload") }), false);
  assert.deepEqual(after, []);
  // a failure frees the job for the next tap
  const bad = [];
  assert.equal(await refreshInBar(ctx, { background: async () => {}, settled: async () => {}, reload: async () => { throw new Error("x"); }, failed: (f) => bad.push(...f) }), false);
  assert.deepEqual(bad, [{ title: "Changes", detail: "x" }]); // F456: the reload bar's failure line, no alert
  assert.equal(await refreshInBar(ctx, { background: async () => {}, settled: async () => {}, reload: async () => {} }), true);
});
