// I3: updates to the apps iFizBox remembers (core/installed.js, F30), where there's no dpkg to ask (the site and the
// sideload app). Tapping Install on an app page records the version it installs; when a source later lists a newer
// one, it shows in Changes under Available Upgrades beside dpkg's (so the tab badge and, in the app, the icon badge
// count it), and the sideload app's shell checks for it in the background (native/Sources/BackgroundCheck.swift,
// with the same rules in native/sign/Updates.swift).
//
//   rememberedUpgrades(records, candidateOf, holds) -> { available, ignored }: findUpgrades' row shape, the source's
//       row with `installed` = the remembered version; Settings' Ignored Upgrades (holds) go to ignored
//   mergeUpgrades(a, b)        -> one { available, ignored }, each id once (a's row wins), sorted by name
//   watchList(records, { sourceOf, ignored }) -> [{ id, name, version, source }] the shell's background check
//                                follows: only apps Changes could count (B47)
//   upgradeKeys(rows)          -> ["<id> <version>"]: the upgrades already counted on screen (the shell's "known")
//   updatesTitle(n)            -> "1 Update" | "<n> Updates" (the notification's title; Updates.swift title(_:))
// SPDX-License-Identifier: GPL-3.0-or-later
import { compareVersions, IdMap } from "./apt.js";

export const SELF_ID = "com.ryha.ifizbox"; // core/installed.js SELF_ID: iFizBox's own row is essential.js's

const byName = (a, b) => String(a.name ?? a.id).localeCompare(String(b.name ?? b.id), undefined, { sensitivity: "base" }) ||
  String(a.id).localeCompare(String(b.id));

// `candidateOf(id)`: the source's row for the app ({ id, name, version, key, icon, ... }) or null.
export function rememberedUpgrades(records, candidateOf, holds = []) {
  const ignoredIds = new Set(holds);
  const available = [];
  const ignored = [];
  for (const rec of records ?? []) {
    if (!rec?.id || rec.self || rec.id === SELF_ID || !rec.version) continue;
    const cand = candidateOf(rec.id);
    if (!cand?.version || compareVersions(cand.version, rec.version) <= 0) continue;
    const row = { ...cand, id: rec.id, name: cand.name || rec.name, icon: cand.icon ?? rec.icon ?? null, installed: rec.version, remembered: true };
    (ignoredIds.has(rec.id) ? ignored : available).push(row);
  }
  return { available: available.sort(byName), ignored: ignored.sort(byName) };
}

export function mergeUpgrades(a, b) {
  const merge = (x = [], y = [], skip = new Set()) => {
    const seen = new Set(skip);
    const out = [];
    for (const r of [...x, ...y]) {
      if (!r?.id || seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
    return out;
  };
  // An id ignored on either side stays ignored; essential.js puts iFizBox's own row first, and it stays first.
  const ignored = merge(a?.ignored, b?.ignored).sort(byName);
  const ignoredIds = new Set(ignored.map((r) => r.id));
  const available = merge(a?.available, b?.available, ignoredIds);
  const self = available.filter((r) => r.id === SELF_ID);
  return { available: [...self, ...available.filter((r) => r.id !== SELF_ID).sort(byName)], ignored };
}

const httpUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u.trim()) ? u.trim() : null);

// B47: the AltStore source URL a Changes row came from (its key "alt:<url>"), or null (an APT or other source,
// which the shell's background check can't read).
export const altSourceOf = (key) => (typeof key === "string" && key.startsWith("alt:") ? httpUrl(key.slice(4)) : null);

// B47: `sourceOf(id)`, when given, is the source Changes reads the app from (altSourceOf its row's key), and an app
// it answers null for is left out: Changes can't show its upgrade (its source removed, or no longer listing it),
// so the background check must not badge one either. `ignored`: Settings' Ignored Upgrades and blocked packages,
// which Changes files under Ignored Upgrades, never counted.
export function watchList(records, { sourceOf = null, ignored = [] } = {}) {
  const skip = new Set(ignored ?? []);
  const out = [];
  for (const r of records ?? []) {
    const source = sourceOf ? (r?.id ? sourceOf(r.id) : null) : httpUrl(r?.source);
    if (!r?.id || r.self || r.id === SELF_ID || !r.version || !source || skip.has(r.id)) continue;
    out.push({ id: String(r.id), name: String(r.name || r.id), version: String(r.version), source });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export const upgradeKeys = (rows) => (rows ?? []).filter((r) => r?.id && r.version).map((r) => `${r.id} ${r.version}`).sort();

export const updatesTitle = (n) => (n === 1 ? "1 Update" : `${n} Updates`);

// F281: Ignore This Version. `versions` is { id: version } (core/settings.js ignoredVersions): an available row whose
// version on offer is that one (compareVersions equal, so "1.0" and "1.0.0"-style spellings dpkg calls the same
// match too) moves to ignored, marked `ignoredVersion: true`, so the badge, the background check and Upgrade All
// skip it; a newer version is a row like any other. Package names ignore case (B412); apps' rows (`remembered`) are
// matched by their exact bundle ID.
const sameVersion = (a, b) => { try { return compareVersions(String(a), String(b)) === 0; } catch { return String(a) === String(b); } };
const newer = (a, b) => { try { return compareVersions(String(a), String(b)) > 0; } catch { return false; } };

export function splitIgnoredVersions(upgrades, versions = {}) {
  const map = versions ?? {};
  const stored = new IdMap(); // lower-cased id -> the versions stored under any spelling of it
  for (const [id, v] of Object.entries(map)) stored.set(id, [...(stored.get(id) ?? []), v]);
  const available = [];
  const moved = [];
  for (const r of upgrades?.available ?? []) {
    const vs = !r?.id ? [] : r.remembered ? [map[r.id]] : stored.get(r.id) ?? [];
    if (r?.version && vs.some((v) => v && sameVersion(r.version, v))) moved.push({ ...r, ignoredVersion: true });
    else available.push(r);
  }
  if (!moved.length) return upgrades ?? { available: [], ignored: [] };
  return { ...upgrades, available, ignored: [...(upgrades?.ignored ?? []), ...moved].sort(byName) };
}

// F281: the sheet button and row menu item. Ignore This Version while a newer version than the installed one is out
// (and the item isn't ignored whole, `held`), Stop Ignoring This Version while the version on offer is the ignored
// one; null otherwise. `ignored`: the item's entry (core/settings.js ignoredVersions.get), or null.
export const IGNORE_VERSION = "Ignore This Version";
export const STOP_IGNORING_VERSION = "Stop Ignoring This Version";
export function ignoreVersionLabel({ installed = null, newest = null, ignored = null, held = false } = {}) {
  if (!newest || !installed || !newer(newest, installed)) return null;
  if (ignored && sameVersion(ignored, newest)) return STOP_IGNORING_VERSION;
  return held ? null : IGNORE_VERSION;
}

// F281: `buttons` with `label` put after Upgrade (else Reinstall, else first); as they were when `label` is null.
export function withVersionButton(buttons, label) {
  if (!label) return buttons;
  const at = buttons.indexOf("Upgrade") >= 0 ? buttons.indexOf("Upgrade") + 1 : buttons.indexOf("Reinstall") + 1;
  return [...buttons.slice(0, at), label, ...buttons.slice(at)];
}

// F281: what a press of `label` stores: the version on offer for Ignore This Version, null (take it back) for Stop
// Ignoring This Version.
export const versionToStore = (label, newest) => (label === IGNORE_VERSION ? String(newest) : null);

// F281: Ignore This Version as "<id> <version>" lines (account sync's set) and back.
export const versionLines = (map) => Object.entries(map ?? {}).map(([id, v]) => `${id} ${v}`).sort();
const lineOf = (line) => {
  const m = /^(\S+) (\S+)$/.exec(String(line ?? "").trim());
  return m ? [m[1], m[2]] : null;
};
// `map` with account sync's changes (core/account.js changesFor addVersions / removeVersions): a removed line goes
// only while the item still has that version, an added one is set (two for one item: the newer stands).
export function applyVersionLines(map, { add = [], remove = [] } = {}) {
  const out = { ...(map ?? {}) };
  for (const l of remove ?? []) { const p = lineOf(l); if (p && out[p[0]] === p[1]) delete out[p[0]]; }
  const added = new Map();
  for (const l of add ?? []) {
    const p = lineOf(l);
    if (p && (!added.has(p[0]) || newer(p[1], added.get(p[0])))) added.set(p[0], p[1]);
  }
  for (const [id, v] of added) out[id] = v;
  return out;
}

// F281: the entries that still stand. One goes once a newer version than it is on offer (the item's row offers a
// version past it) or once the installed version reaches it (`installedOf(id)`, else the row's `installed`). An
// item with no row and no known installed version keeps its entry: nothing says it went.
export function settleIgnoredVersions(versions = {}, { upgrades = null, installedOf = () => null } = {}) {
  const rows = new Map();
  const pkgRows = new IdMap(); // B412: packages' rows, ignoring case; apps' bundle IDs stay exact
  for (const r of [...(upgrades?.available ?? []), ...(upgrades?.ignored ?? [])]) {
    if (!r?.id) continue;
    if (!rows.has(r.id)) rows.set(r.id, r);
    if (!r.remembered && !pkgRows.has(r.id)) pkgRows.set(r.id, r);
  }
  const out = {};
  for (const [id, v] of Object.entries(versions ?? {})) {
    const row = rows.get(id) ?? pkgRows.get(id);
    if (row?.version && newer(row.version, v)) continue;
    const have = installedOf(id) ?? row?.installed ?? null;
    if (have && !newer(v, have)) continue;
    out[id] = v;
  }
  return out;
}
