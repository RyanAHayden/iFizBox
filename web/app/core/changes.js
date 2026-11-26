// The Changes tab's memory: when each package version was first seen, kept on the device in IndexedDB, like
// Cydia's metadata.cb0 (docs/cydia.md "Changes and metadata.cb0"). Pure JS plus a thin IndexedDB wrapper; the
// IDBFactory is passed in so node tests can hand it a fake.
//
// One record per (repo, package, version): { k, key, id, version, first }. Every catalog reload ("refresh")
// stamps `now` once and files every triple it hasn't seen before under it, so a repeat refresh adds nothing.
// Per package, Cydia's {first, last} come out as minimums over repos, so a package mirrored on two repos isn't
// new twice:
//   first = the earliest record of the package (any repo, any version): when it was first seen;
//   last  = the earliest record of its current candidate version: when that version showed up.
// The tab groups packages by `last` (a bumped version moves the package to the refresh that found it), newest
// first, under "New at <date>", and drops the oldest group: that is everything from the first load, so a fresh
// install doesn't list the whole archive. A row is "updated" when last > first, else "new" (iFizBox's addition:
// Cydia doesn't mark rows).
//
//   const store = await openSeenStore();
//   await recordRefresh(store, [[key, id, version], ...], Date.now())  -> number of new records
//   changeGroups(await store.all(), rows)                              -> [{ seen, rows: [{ ...row, change }] }]

import { isInstalledRow } from "./installed.js";
import { ownKey } from "./altstore.js";

const STORE = "seen";

export const recordKey = (key, id, version) => `${key}\u0000${id}\u0000${version}`;

// The records a refresh at `now` adds: every (key, id, version) in `current` not in `known` (a Set of recordKey).
// F51: a fourth element, the version's own date (AltStore versions[] carry one; epoch ms), is kept as `date`, so
// the version files under the day it came out rather than the day iFizBox first saw it. `known` may instead be a
// Map(recordKey -> record): then a known record that has no date yet and now gets one is returned too, updated.
export function newRecords(known, current, now) {
  const out = [];
  const added = new Set();
  for (const [key, id, version, date] of current) {
    const k = recordKey(key, id, version ?? "");
    if (added.has(k)) continue;
    const d = Number.isFinite(date) ? date : null;
    if (known.has(k)) {
      const old = known instanceof Map ? known.get(k) : null;
      if (old && d != null && old.date == null) { added.add(k); out.push({ ...old, date: d }); }
      continue;
    }
    added.add(k);
    const rec = { k, key, id, version: version ?? "", first: now };
    if (d != null) rec.date = d;
    out.push(rec);
  }
  return out;
}

// id -> { first, byVersion: Map(version -> earliest first) }.
function packageTimes(records) {
  const times = new Map();
  for (const r of records) {
    let t = times.get(r.id);
    if (!t) times.set(r.id, (t = { first: r.first, byVersion: new Map() }));
    if (r.first < t.first) t.first = r.first;
    const v = t.byVersion.get(r.version);
    if (v === undefined || r.first < v) t.byVersion.set(r.version, r.first);
  }
  return times;
}

// The Changes list: `rows` are the catalog's rows (All Sources, one per id, the candidate version). Groups are
// newest first; within a group rows keep their order (the catalog's: by name). `dropOldest`: Cydia's rule.
export function changeGroups(records, rows, { dropOldest = true } = {}) {
  const times = packageTimes(records);
  const groups = new Map(); // seen -> rows
  for (const row of rows) {
    const t = times.get(row.id);
    const last = t?.byVersion.get(row.version ?? "");
    if (last === undefined) continue; // not recorded yet: the next refresh files it
    const item = { ...row, change: last > t.first ? "updated" : "new", seen: last };
    if (!groups.has(last)) groups.set(last, []);
    groups.get(last).push(item);
  }
  const list = [...groups].sort((a, b) => b[0] - a[0]).map(([seen, rs]) => ({ seen, rows: rs }));
  if (dropOldest) list.pop();
  return list;
}

// ---- By day (F51) -------------------------------------------------------------------------------------------
// The tab lists the last `days` days (today and the 6 before it, by the phone's clock), one group per day, newest
// first: "Today", "Yesterday", then the date. A record's time is its `date` (the source's own, AltStore) or else
// `first` (when a refresh saw it). Cydia's first-load rule stays, per record: an undated record filed by the very
// first refresh is the archive as it was, not a change, so a package whose version only has such records is left
// out. Within a day rows go newest first, then by the catalog's order (name).
//
//   dayGroups(records, rows, { now, days })  -> [{ day, rows: [{ ...row, change, seen }] }]   (day: local midnight)
//   dayTitle(day, now, locale)               -> "Today" | "Yesterday" | "Sunday, November 15"
//   filterRows(rows, { query, scope, installed }) and filterGroups(groups, ...): the search field and scope bar
//   defaultScope(installedCount)             -> "installed" when anything is installed, else "all"

export const WINDOW_DAYS = 7;

// Local midnight of the day `t` falls on.
export function dayOf(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// `days` local days back from `now`'s day (DST-safe: by the calendar, not by 24-hour steps).
export function daysBefore(now, days) {
  const d = new Date(dayOf(now));
  d.setDate(d.getDate() - days);
  return d.getTime();
}

const timeOf = (r) => r.date ?? r.first;
const ownMark = (key, id) => `${key}\u0000${id}`;

// B482: the catalog's rows are All Sources, one per id (the newest copy), so an app installed from one source is
// replaced there by another source's newer copy of the same bundle ID (a modded X on fastsign beside AppTesters'),
// which the Installed scope rightly leaves out. ownPicks lists, for each remembered app (core/installed.js apps())
// whose All Sources row comes from another source, [key, id] of its own source (ownKey); the catalog fetches those
// rows (catalog row()) and hands them to dayGroups as `own`.
export function ownPicks(rows, appRecords) {
  const shown = new Map();
  for (const r of rows ?? []) if (r?.id) shown.set(r.id, r.key);
  const out = [];
  const seen = new Set();
  for (const rec of appRecords ?? []) {
    const key = ownKey(rec);
    if (!rec?.id || !key || !shown.has(rec.id) || shown.get(rec.id) === key) continue;
    const m = ownMark(key, rec.id);
    if (seen.has(m)) continue;
    seen.add(m);
    out.push([key, rec.id]);
  }
  return out;
}

// B482: `own` are extra rows, an installed app's own source's copy where All Sources shows another source's (ownRows):
// each is dated by its own source's records only, marked `own: true`, and shown only in the Installed scope.
export function dayGroups(records, rows, { now = Date.now(), days = WINDOW_DAYS, own = [] } = {}) {
  let baseline = Infinity; // the first refresh: the earliest stamp of an undated record
  for (const r of records) if (r.date == null && r.first < baseline) baseline = r.first;
  const ownMarks = new Set(own.map((r) => ownMark(r.key, r.id)));
  // id (and, for `own` rows, key + id) -> { first: earliest time of any version, byVersion: version -> earliest
  // counted time }
  const times = new Map();
  const note = (at, r, t) => {
    let p = times.get(at);
    if (!p) times.set(at, (p = { first: t, byVersion: new Map() }));
    if (t < p.first) p.first = t;
    if (r.date == null && r.first === baseline) return; // the archive at the first load
    const v = p.byVersion.get(r.version);
    if (v === undefined || t < v) p.byVersion.set(r.version, t);
  };
  for (const r of records) {
    const t = timeOf(r);
    note(r.id, r, t);
    const m = ownMark(r.key, r.id);
    if (ownMarks.has(m)) note(m, r, t);
  }
  const from = daysBefore(now, days - 1);
  const today = dayOf(now);
  const groups = new Map(); // day -> rows
  for (const row of [...rows, ...own.map((r) => ({ ...r, own: true }))]) {
    const p = times.get(row.own ? ownMark(row.key, row.id) : row.id);
    const seen = p?.byVersion.get(row.version ?? "");
    if (seen === undefined || seen < from) continue;
    const day = Math.min(dayOf(seen), today); // a date in the future (a wrong clock or source) counts as today
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push({ ...row, change: seen > p.first ? "updated" : "new", seen });
  }
  return [...groups].sort((a, b) => b[0] - a[0])
    .map(([day, rs]) => ({ day, rows: rs.map((r, i) => [r, i]).sort((a, b) => b[0].seen - a[0].seen || a[1] - b[1]).map(([r]) => r) }));
}

export function dayTitle(day, now = Date.now(), locale) {
  const d = dayOf(day);
  if (d === dayOf(now)) return "Today";
  if (d === daysBefore(now, 1)) return "Yesterday";
  return new Date(d).toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric" });
}

export const defaultScope = (installedCount) => (installedCount > 0 ? "installed" : "all");

// The search field matches name, id, description and author, case-insensitively, every word; the Installed scope
// keeps rows in `installed` (core/installed.js installedIds: dpkg ids, apps by source and id).
export function filterRows(rows, { query = "", scope = "all", installed = new Set() } = {}) {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (scope === "installed" && !isInstalledRow(installed, r)) return false;
    if (scope !== "installed" && r.own) return false; // B482: All shows All Sources' copy instead
    if (!words.length) return true;
    const hay = [r.name, r.id, r.short, r.author].filter(Boolean).join("\n").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function filterGroups(groups, opts) {
  return groups.map((g) => ({ ...g, rows: filterRows(g.rows, opts) })).filter((g) => g.rows.length);
}

// Files a refresh: one `now` for every triple it saw. Returns how many records it added (or dated).
export async function recordRefresh(store, current, now = Date.now()) {
  const known = new Map((await store.all()).map((r) => [r.k, r]));
  const add = newRecords(known, current, now);
  if (add.length) await store.putMany(add);
  return add.length;
}

export function openSeenStore({ indexedDB: idb = globalThis.indexedDB, name = "ifizbox-changes" } = {}) {
  if (!idb) return Promise.reject(new Error("IndexedDB is not available"));
  return new Promise((resolve, reject) => {
    const req = idb.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "k" });
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(wrap(req.result));
  });
}

function wrap(db) {
  const run = (mode, f) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = f(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error ?? req?.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
  return {
    all: () => run("readonly", (s) => s.getAll()),
    keys: () => run("readonly", (s) => s.getAllKeys()),
    // One transaction for the whole refresh: BigBoss alone is ~30k records on the first load.
    putMany: (records) => run("readwrite", (s) => { for (const r of records) s.put(r); return null; }).then(() => undefined),
    clear: () => run("readwrite", (s) => s.clear()).then(() => undefined),
    close: () => db.close(),
  };
}
