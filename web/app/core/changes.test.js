import { test } from "node:test";
import assert from "node:assert/strict";
import { openSeenStore, recordRefresh, changeGroups, newRecords, recordKey } from "./changes.js";


const DAY = 86400000;
const row = (id, version, key = "r1") => ({ id, name: id, version, key, short: "", section: "Tweaks" });

test("changes: a refresh with a bumped version files it under today, and a repeat refresh doesn't", async () => {
  const indexedDB = fakeIndexedDB();
  const store = await openSeenStore({ indexedDB });
  const day1 = Date.UTC(2026, 10, 16, 9, 0, 0);
  const today = day1 + DAY;

  // First load: everything is seen at day1, and that oldest group is dropped (Cydia's rule).
  assert.equal(await recordRefresh(store, [["r1", "a", "1.0"], ["r1", "b", "2.0"]], day1), 2);
  assert.deepEqual(changeGroups(await store.all(), [row("a", "1.0"), row("b", "2.0")]), []);

  // Today's refresh: a's version is bumped and c is new; both file under today, b stays put.
  assert.equal(await recordRefresh(store, [["r1", "a", "1.1"], ["r1", "b", "2.0"], ["r1", "c", "0.1"]], today), 2);
  const rows = [row("a", "1.1"), row("b", "2.0"), row("c", "0.1")];
  let groups = changeGroups(await store.all(), rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].seen, today);
  assert.deepEqual(groups[0].rows.map((r) => [r.id, r.change]), [["a", "updated"], ["c", "new"]]);

  // A repeat refresh (later the same day, nothing changed) records nothing and moves nothing.
  assert.equal(await recordRefresh(store, [["r1", "a", "1.1"], ["r1", "b", "2.0"], ["r1", "c", "0.1"]], today + 3600000), 0);
  groups = changeGroups(await store.all(), rows);
  assert.deepEqual(groups.map((g) => g.seen), [today]);

  // Reopening the database keeps it all (it lives on the device).
  store.close();
  const again = await openSeenStore({ indexedDB });
  assert.equal((await again.all()).length, 4);
});

test("changes: newest group first; the oldest is dropped; dropOldest off keeps it", () => {
  const records = [
    ...newRecords(new Set(), [["r1", "a", "1"], ["r1", "b", "1"]], 100),
    ...newRecords(new Set(), [["r1", "c", "1"]], 200),
    ...newRecords(new Set(), [["r1", "d", "1"], ["r1", "b", "2"]], 300),
  ];
  const rows = [row("a", "1"), row("b", "2"), row("c", "1"), row("d", "1")];
  assert.deepEqual(changeGroups(records, rows).map((g) => [g.seen, g.rows.map((r) => r.id)]), [[300, ["b", "d"]], [200, ["c"]]]);
  assert.deepEqual(changeGroups(records, rows, { dropOldest: false }).map((g) => g.seen), [300, 200, 100]);
});

test("changes: a package mirrored on a second repo isn't new again; first/last are minimums over repos", () => {
  const known = new Set();
  const r1 = newRecords(known, [["r1", "a", "1"], ["r1", "z", "1"]], 100);
  r1.forEach((r) => known.add(r.k));
  // A second repo carrying a (same version) and a newer a on a third: only the newer version moves it.
  const r2 = newRecords(known, [["r2", "a", "1"]], 200);
  const r3 = newRecords(known, [["r3", "a", "2"]], 300);
  const records = [...r1, ...r2, ...r3];
  assert.deepEqual(changeGroups(records, [row("a", "1", "r2")], { dropOldest: false }).map((g) => g.seen), [100]);
  const g = changeGroups(records, [row("a", "2", "r3")], { dropOldest: false });
  assert.deepEqual(g.map((x) => [x.seen, x.rows[0].change]), [[300, "updated"]]);
});

test("changes: duplicate triples in one refresh make one record; unrecorded rows are left out", () => {
  const add = newRecords(new Set([recordKey("r1", "a", "1")]), [["r1", "a", "1"], ["r1", "b", "1"], ["r1", "b", "1"]], 5);
  assert.deepEqual(add.map((r) => r.id), ["b"]);
  assert.deepEqual(changeGroups(add, [row("b", "1"), row("x", "1")], { dropOldest: false })[0].rows.map((r) => r.id), ["b"]);
});

test("changes: no IndexedDB is a rejection, not a throw", async () => {
  await assert.rejects(openSeenStore({ indexedDB: null }), /not available/);
});

// ---- F51: by day, the last 7 days ----
import { dayGroups, dayTitle, dayOf, filterRows, filterGroups, defaultScope, WINDOW_DAYS } from "./changes.js";
import { installedIds } from "./installed.js";
import { fakeIndexedDB } from "../fakes.test-helper.js";

const at = (d, h = 12) => new Date(2026, 10, d, h).getTime(); // November 2026, local time
const rec = (id, version, first, date) => ({ k: recordKey("r1", id, version), key: "r1", id, version, first, ...(date != null ? { date } : {}) });

test("changes by day: one group per local day, newest first; the first load is left out, later refreshes count", () => {
  const now = at(17, 15);
  const records = [
    rec("old", "1", at(1, 9)), rec("a", "1", at(1, 9)), // the first load (archive)
    rec("a", "2", at(17, 8)),                          // a bumped this morning
    rec("b", "1", at(17, 10)),                         // b new this morning
    rec("c", "1", at(16, 23)),                         // c new late yesterday
    rec("d", "1", at(16, 1)),                          // d early yesterday
  ];
  const rows = ["a", "b", "c", "d", "old"].map((id) => row(id, id === "a" ? "2" : "1"));
  const groups = dayGroups(records, rows, { now });
  assert.deepEqual(groups.map((g) => [g.day, g.rows.map((r) => `${r.id}:${r.change}`)]),
    [[dayOf(now), ["b:new", "a:updated"]], [dayOf(at(16)), ["c:new", "d:new"]]]);
  assert.equal(dayTitle(groups[0].day, now, "en-US"), "Today");
  assert.equal(dayTitle(groups[1].day, now, "en-US"), "Yesterday");
  assert.equal(dayTitle(at(14), now, "en-US"), "Saturday, November 14");
});

test("changes by day: only the last 7 days (today and 6 before), however many refreshes", () => {
  const now = at(17, 15);
  const records = [rec("base", "1", at(1)), ...[17, 16, 12, 11, 10, 9].map((d) => rec(`p${d}`, "1", at(d, 0)))];
  const rows = [17, 16, 12, 11, 10, 9].map((d) => row(`p${d}`, "1"));
  const groups = dayGroups(records, rows, { now });
  assert.equal(WINDOW_DAYS, 7);
  assert.deepEqual(groups.map((g) => g.rows[0].id), ["p17", "p16", "p12", "p11"]); // Nov 11 is day 7; 10 and 9 are out
  assert.deepEqual(dayGroups(records, rows, { now, days: 1 }).map((g) => g.rows[0].id), ["p17"]);
});

test("changes by day: AltStore dates file a version under its own day, even on the first load", () => {
  const now = at(17, 15);
  const records = [
    rec("apt", "1", at(17, 9)),                     // first load, undated: archive
    rec("emu", "1.5", at(17, 9), at(14, 0)),        // dated: Saturday
    rec("emu", "1.4", at(17, 9), at(2, 0)),         // its older version: so 1.5 is an update
    rec("fresh", "1", at(17, 9), at(17, 1)),
    rec("ancient", "1", at(17, 9), at(1, 0)),       // dated outside the window
    rec("future", "1", at(17, 9), at(20, 0)),       // a source dated ahead: today
  ];
  const rows = [row("apt", "1"), row("emu", "1.5"), row("fresh", "1"), row("ancient", "1"), row("future", "1")];
  const groups = dayGroups(records, rows, { now });
  assert.deepEqual(groups.map((g) => [dayTitle(g.day, now, "en-US"), g.rows.map((r) => `${r.id}:${r.change}`)]),
    [["Today", ["future:new", "fresh:new"]], ["Saturday, November 14", ["emu:updated"]]]);
});

test("changes by day: refreshes file AltStore dates, and date a record filed before dates were kept", async () => {
  const store = await openSeenStore({ indexedDB: fakeIndexedDB(), name: "f51" });
  assert.equal(await recordRefresh(store, [["r1", "a", "1"], ["alt:x", "emu", "1.5", at(14)]], at(17)), 2);
  assert.equal((await store.all()).find((r) => r.id === "emu").date, at(14));
  assert.equal(await recordRefresh(store, [["r1", "a", "1"], ["alt:x", "emu", "1.5", at(14)]], at(17, 13)), 0);
  assert.equal(await recordRefresh(store, [["r1", "a", "1", at(10)]], at(17, 14)), 1); // undated record gets its date
  const a = (await store.all()).find((r) => r.id === "a");
  assert.deepEqual([a.first, a.date], [at(17), at(10)]);
});

test("changes filters: search matches name, id, description and author, every word; scope Installed", () => {
  const rows = [
    { id: "com.a.bar", name: "Barrel", short: "page effects", author: "Aaron" },
    { id: "com.b.zep", name: "Zeppelin", short: "carrier logo", author: "Alex" },
  ];
  const ids = (o) => filterRows(rows, o).map((r) => r.id);
  assert.deepEqual(ids({ query: "" }), ["com.a.bar", "com.b.zep"]);
  assert.deepEqual(ids({ query: "barr" }), ["com.a.bar"]);
  assert.deepEqual(ids({ query: "COM.B" }), ["com.b.zep"]);
  assert.deepEqual(ids({ query: "carrier alex" }), ["com.b.zep"]);
  assert.deepEqual(ids({ query: "carrier aaron" }), []);
  assert.deepEqual(ids({ scope: "installed", installed: new Set(["com.b.zep"]) }), ["com.b.zep"]);
  assert.deepEqual(ids({ scope: "installed" }), []);
  assert.deepEqual(filterGroups([{ day: 1, rows }, { day: 0, rows: [rows[0]] }], { query: "zep" }).map((g) => g.day), [1]);
});

test("changes default scope: Installed with dpkg packages or recorded apps, All with nothing installed", () => {
  assert.equal(defaultScope(installedIds(null, []).size), "all");
  assert.equal(defaultScope(installedIds([], undefined).size), "all");
  assert.equal(defaultScope(installedIds([{ id: "bash" }], []).size), "installed");
  assert.equal(defaultScope(installedIds(null, [{ id: "com.delta", source: "https://s/" }]).size), "installed");
  assert.deepEqual([...installedIds([{ id: "a" }], [{ id: "a" }, { id: "b" }])], ["a"]); // no source of their own
});

test("B477: an installed app counts only on the source it was installed from", () => {
  const own = "alt:https://apptesters.org/";
  const installed = installedIds([{ id: "bash" }], [{ id: "com.x", source: "https://apptesters.org/" }, { id: "com.y", key: "alt:https://b/" }]);
  const rows = [
    { id: "com.x", key: "alt:https://fastsign.dev/" }, // fastsign's modded X, same bundle ID
    { id: "com.x", key: own },
    { id: "com.y", key: "alt:https://b/" },
    { id: "bash", key: "apt:https://repo/" }, // dpkg packages stay by id
  ];
  assert.deepEqual(filterRows(rows, { scope: "installed", installed }).map((r) => r.key), [own, "alt:https://b/", "apt:https://repo/"]);
});

test("B482: Changes' Installed scope shows an installed app's own source's change when another source has it newer", async () => {
  const { createCatalog, ALL } = await import("./catalog.js");
  const { ownPicks } = await import("./changes.js");
  const now = new Date(2026, 10, 26, 15, 0, 0).getTime();
  const iso = (daysAgo) => new Date(now - daysAgo * DAY).toISOString();
  const app = (version, versions) => ({ name: "X", bundleIdentifier: "com.x", developerName: "X", version,
    downloadURL: "https://dl/x.ipa", localizedDescription: "x", versions: versions.map(([v, d]) => ({ version: v, date: iso(d), downloadURL: "https://dl/x.ipa" })) });
  const own = "alt:https://apptesters.org/", fast = "alt:https://fastsign.dev/";
  const c = createCatalog();
  c.loadAlt(own, JSON.stringify({ name: "AppTesters", apps: [app("1.1", [["1.1", 0], ["1.0", 30]])] }));
  c.loadAlt(fast, JSON.stringify({ name: "fastsign", apps: [app("2.0", [["2.0", 3]])] }));
  const records = newRecords(new Set(), c.versions(), now - 40 * DAY);
  const rows = c.list(ALL, ALL);
  assert.deepEqual(rows.map((r) => [r.key, r.version]), [[fast, "2.0"]], "All Sources keeps the newest copy");
  const recs = [{ id: "com.x", source: "https://apptesters.org/", version: "1.0" }];
  assert.deepEqual(ownPicks(rows, recs), [[own, "com.x"]]);
  assert.deepEqual(ownPicks(rows, [{ id: "com.x", key: fast }]), [], "installed from the source All shows: nothing extra");
  const extra = ownPicks(rows, recs).map(([k, id]) => c.row(id, k));
  const groups = dayGroups(records, rows, { now, own: extra });
  const installed = installedIds(null, recs);
  const mine = filterGroups(groups, { scope: "installed", installed });
  assert.deepEqual(mine.map((g) => [g.day, g.rows.map((r) => [r.key, r.version, r.change])]), [[dayOf(now), [[own, "1.1", "updated"]]]]);
  const all = filterGroups(groups, { scope: "all", installed });
  assert.deepEqual(all.flatMap((g) => g.rows.map((r) => [r.key, r.version])), [[fast, "2.0"]], "All still shows fastsign's");
});

// A fake IndexedDB whose first `aborts` transactions are aborted by the "browser" (no tx.error) mid-write.
function abortingIndexedDB(aborts) {
  const real = fakeIndexedDB();
  let left = aborts;
  return {
    open(name, version) {
      const req = {};
      const inner = real.open(name, version);
      inner.onupgradeneeded = () => { req.result = inner.result; req.onupgradeneeded?.(); };
      inner.onsuccess = () => {
        const db = inner.result;
        req.result = {
          objectStoreNames: db.objectStoreNames, createObjectStore: (...a) => db.createObjectStore(...a),
          close: () => db.close(),
          transaction(n, mode) {
            const tx = db.transaction(n, mode);
            if (mode === "readwrite" && left > 0) {
              left--;
              const o = {};
              o.objectStore = () => ({ put: () => ({}), clear: () => ({}) });
              setTimeout(() => o.onabort?.(), 0);
              return o;
            }
            return tx;
          },
        };
        req.onsuccess?.();
      };
      return req;
    },
  };
}

test("changes store: a transaction the browser aborts is retried once on a fresh connection", async () => {
  const store = await openSeenStore({ indexedDB: abortingIndexedDB(1), name: "b496a" });
  assert.equal(await recordRefresh(store, [["r1", "a", "1"]], 1000), 1);
  assert.deepEqual((await store.all()).map((r) => r.id), ["a"]);
});

test("changes store: a second abort reads as a plain sentence, not 'transaction aborted'", async () => {
  const store = await openSeenStore({ indexedDB: abortingIndexedDB(2), name: "b496b" });
  await assert.rejects(recordRefresh(store, [["r1", "a", "1"]], 1000), (e) => !/transaction aborted/.test(e.message) && /Try refreshing/.test(e.message));
});
