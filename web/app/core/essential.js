// iFizBox's own built-in source and its own upgrade row in Changes (F72, F183). Pure JS: everything that touches
// the network, the bridge, storage or the screen comes in through `deps`, so node tests drive every path
// (essential.test.js); essential-ui.js binds the real ones.
//
// The built-in source, like Cydia's apt.saurik.com: always in the list, first, with a lock instead of Delete; Manage
// can't remove it and Export skips it. Which one, by build (builtinSources):
//   jailbreak   iFizBox's flat APT repo, https://<DOMAIN>/repo/ (Packages, Release and the .debs are assets of
//               every release, tools/release.sh and tools/selfrepo.py; the Worker serves the latest one's, B17)
//   sideload    iFizBox's AltStore source, https://<DOMAIN>/repo/source.json (web/app/source.json, tools/altsource.py)
//   site        the same AltStore source (the site only installs IPAs)
// withBuiltins wraps a backend's source calls: sources() puts the built-in first (a seed record until it is read),
// removeSource refuses it, and refreshSources adds it back (apt's sources in the app) if it went missing.
//
// iFizBox's own upgrade (F183): never an alert. Every launch and Home's Reload read the source (and GitHub's release,
// core/selfupdate.js); a newer iFizBox is a row on top of Changes (selfUpgradeRow, withSelfUpgrade) and counts in its
// badge, installed from there. The source may still name a minimum version (AltStore "minimumVersion", APT
// X-iFizBox-Minimum-Version, minimumOf); nothing blocks on it any more.
// For IPAs only iFizBox itself (com.ryha.ifizbox from its own source) is ever essential.
import { compareVersions, isNewer, parseVersion } from "./selfupdate.js";
import { altKey, seedRecord } from "./altstore.js";
import { NAME, DOMAIN } from "../brand.js";
import { KEYS } from "./storagekeys.js";

export const SELF_ID = "com.ryha.ifizbox";
const SELF_NAME = NAME;
// F172: brand.js DOMAIN. A phone that still lists the old host's repo keeps it as an ordinary source (it is no longer
// the built-in, so it can be swiped away); nothing rewrites it (user 2026-11-18: no support for the old name).
export const SELF_APT_URI = `https://${DOMAIN}/repo/`;
// F178: the AltStore source at the site too (the Worker's /repo/source.json serves the latest release's source.json).
export const SELF_ALT_URL = `https://${DOMAIN}/repo/source.json`;
export const SELF_SITE = `https://${DOMAIN}/`;
export const MIN_FIELD = "x-ifizbox-minimum-version"; // the Release field, lower-cased as core/apt.js keeps them
const LOCKED_TEXT = `${NAME}'s own source is built in and can't be removed.`;
export const STORE_KEY = KEYS.essential;

// core/sources.js sourceKey, repeated here so this file doesn't import sources.js (which imports altstore.js).
const aptKey = (uri, dist = "./") => `deb:${uri}:${dist}`;

// ---- the built-in source -------------------------------------------------------------------------------------

export function builtinSources(mode) {
  if (mode === "jailbreak") {
    return [{ key: aptKey(SELF_APT_URI), uri: SELF_APT_URI, dist: "./", components: [], name: SELF_NAME, builtin: true }];
  }
  return [{ ...seedRecord(SELF_ALT_URL), name: SELF_NAME, builtin: true }];
}

export const isBuiltin = (s) => Boolean(s?.builtin);

// The list with every built-in first, marked `builtin` (a built-in the list lacks goes in as its seed record).
export function withBuiltinRecords(list, builtins = []) {
  const all = Array.isArray(list) ? list : [];
  const byKey = new Map(all.map((s) => [s?.key, s]));
  const keys = new Set(builtins.map((b) => b.key));
  const head = builtins.map((b) => {
    const cur = byKey.get(b.key);
    return cur ? { ...cur, name: cur.name || b.name, builtin: true } : { ...b, builtin: true };
  });
  return [...head, ...all.filter((s) => !keys.has(s?.key))];
}

// After any reorder (Manage's order, sort by name): the built-in ones go back to the top.
export const builtinFirst = (list) => [...(list ?? []).filter(isBuiltin), ...(list ?? []).filter((s) => !isBuiltin(s))];

// Export (Manage > Import & Export) leaves the built-in out: every iFizBox has it already.
export const exportable = (list) => (list ?? []).filter((s) => !isBuiltin(s));

export class BuiltinError extends Error {
  constructor() {
    super(LOCKED_TEXT);
    this.name = "BuiltinError";
    this.code = "builtin";
  }
}

// Wraps source calls { sources, addSource, removeSource, refreshSources } (the backend's, after withAltSources).
// `builtins`: the list, or a function giving it (builtinSources(mode)).
export function withBuiltins(calls, builtins) {
  const get = () => (typeof builtins === "function" ? builtins() : builtins) ?? [];
  const keys = () => new Set(get().map((b) => b.key));
  const mark = (s) => (s && keys().has(s.key) ? { ...s, name: s.name || SELF_NAME, builtin: true } : s);
  return {
    sources: async () => withBuiltinRecords(await calls.sources(), get()),
    addSource: async (input, opts) => mark(await calls.addSource(input, opts)),
    async removeSource(key) {
      if (keys().has(key)) throw new BuiltinError();
      return calls.removeSource(key);
    },
    // A built-in that isn't stored (never added, or deleted before F72) is added first, so the refresh reads it and,
    // in the app, apt's sources hold it. `filter` (F41) applies to it like to any source.
    async refreshSources(onEach = () => {}, opts) {
      const keep = opts?.filter ?? (() => true);
      const have = new Set((await calls.sources().catch(() => [])).map((s) => s?.key));
      for (const b of get()) {
        if (have.has(b.key) || !keep(b)) continue;
        try { await calls.addSource(b.uri); } catch { /* offline: it stays a seed row; the next refresh tries again */ }
      }
      const out = await calls.refreshSources((s) => onEach(mark(s)), opts);
      if (!Array.isArray(out)) return out;
      const rows = out.map(mark);
      // B23: the sources apt-get update failed on (backend-native), the built-in named as in the list
      if (out.failed) rows.failed = out.failed.map((f) => (f.key && keys().has(f.key) ? { ...f, name: f.name || SELF_NAME } : f));
      return rows;
    },
  };
}

// The same, in place over a backend object (backend.js).
export function applyBuiltins(backend, builtins) {
  const calls = {
    sources: backend.sources.bind(backend), addSource: backend.addSource.bind(backend),
    removeSource: backend.removeSource.bind(backend), refreshSources: backend.refreshSources.bind(backend),
  };
  return Object.assign(backend, withBuiltins(calls, builtins));
}

// ---- versions ------------------------------------------------------------------------------------------------

const cleanVersion = (v) => {
  const p = parseVersion(v);
  return p && /^\s*v?\d/.test(String(v)) ? p.join(".") : null;
};

// The minimum a source names: AltStore's app "minimumVersion" (or the source's), APT's X-iFizBox-Minimum-Version
// (a Release's fields, or the record core/sources.js saved as `minimumVersion`). Null when none or unreadable.
export function minimumOf(x) {
  if (!x || typeof x !== "object") return null;
  const raw = x.minimumVersion ?? x.fields?.[MIN_FIELD] ?? x[MIN_FIELD] ?? null;
  return raw == null ? null : cleanVersion(raw);
}

// iFizBox's AltStore source (text or parsed JSON) -> { version, ipa, date, notes, minimum, size } for the newest
// iFizBox it lists, or null when it lists none.
export function selfFromAltSource(input) {
  let json = input;
  if (typeof input === "string") {
    try { json = JSON.parse(input.replace(/^﻿/, "")); } catch { return null; }
  }
  const app = (Array.isArray(json?.apps) ? json.apps : []).find((a) => a?.bundleIdentifier === SELF_ID);
  if (!app) return null;
  const versions = (Array.isArray(app.versions) && app.versions.length ? app.versions : [app])
    .filter((v) => v && parseVersion(v.version) && typeof v.downloadURL === "string");
  if (!versions.length) return null;
  const newest = versions.reduce((a, b) => (compareVersions(b.version, a.version) > 0 ? b : a));
  const notes = String(newest.localizedDescription ?? newest.versionDescription ?? "").split(/\r?\n/)
    .map((l) => l.trim()).filter((l) => l && !/^Release notes:/i.test(l));
  return {
    version: cleanVersion(newest.version), ipa: newest.downloadURL, date: newest.date ?? null, notes,
    size: Number.isFinite(newest.size) ? newest.size : null,
    minimum: minimumOf(app) ?? minimumOf(json),
  };
}

// iFizBox's own upgrade as a Changes row (sideload and site: no dpkg to compare with), or null when `info` (from
// selfFromAltSource) isn't newer than `current`. `key`: the built-in source, so the row opens its package page.
export function selfUpgradeRow(info, current, key = altKey(SELF_ALT_URL)) {
  if (!info?.version || !current || !isNewer(info.version, current)) return null;
  return {
    id: SELF_ID, name: SELF_NAME, version: info.version, installed: String(current), key, section: "Apps (Utilities)",
    short: info.notes?.[0] ?? "", author: "Ryan Hayden", icon: null, ipa: info.ipa ?? null, essential: true,
  };
}

// Changes' upgrades with iFizBox's own row on top (once).
export function withSelfUpgrade(upgrades, row) {
  const available = upgrades?.available ?? [];
  const ignored = upgrades?.ignored ?? [];
  if (!row || available.some((r) => r.id === row.id) || ignored.some((r) => r.id === row.id)) return { available, ignored };
  return { available: [row, ...available], ignored };
}

// F183: what Changes' row is built from: the source's newest iFizBox, or GitHub's release (core/selfupdate.js
// newerRelease) when that is newer and has an IPA. Null when neither.
export function selfInfoWith(info, release) {
  const gh = release?.version && release.ipa ? { version: release.version, ipa: release.ipa, notes: release.notes ?? [], minimum: null } : null;
  if (!gh) return info ?? null;
  return !info?.version || isNewer(gh.version, info.version) ? gh : info;
}

// F183: every launch, Home's Reload and return: the source (sideload only: the jailbreak build's comes through apt)
// and GitHub's release, side by side, then `changed()` so Changes and its badge count again. Never an alert, and
// failures are silent. deps: { mode, readSource(), checkRelease(), changed() }.
// Resolves "site" | "checked".
export async function lookForSelfUpdate({ mode, readSource, checkRelease, changed }) {
  if (mode !== "sideload" && mode !== "jailbreak") return "site";
  await Promise.all([
    mode === "sideload" ? Promise.resolve().then(readSource).catch(() => null) : null,
    Promise.resolve().then(checkRelease).catch(() => null),
  ]);
  try { changed?.(); } catch { /* a listener's problem, not the check's */ }
  return "checked";
}

// ---- what was last read from the source (sideload: Changes shows iFizBox's row from it) ------------------------

export function loadInfo(storage) {
  try {
    const s = JSON.parse(storage?.getItem(STORE_KEY) ?? "null");
    return s && typeof s === "object" && s.info ? s.info : null;
  } catch { return null; }
}

export function saveInfo(storage, info, now = Date.now()) {
  try { storage?.setItem(STORE_KEY, JSON.stringify({ info, at: now })); } catch { /* full: asks the source again */ }
}

// ---- iFizBox's own IPA (sideload) -----------------------------------------------------------------------------
// The sideload app signs its own update on the phone and hosts it on the Signing Server (essential-ui.js
// installSelfNow, signing.install host: true). Only without that (no bridge, no IPA) does this answer: the user
// opens the site (brand.js DOMAIN) in Safari, whose Home > Install iFizBox Lite signs the IPA with the user's own
// certificate (home.js APP_ROW).

// row: { version, ipa } (selfUpgradeRow). deps: { alert(spec) -> { index }, open(url) }   open: outside the app.
// Resolves "site" | "cancelled" | "no-asset".
export async function installSelf(row, deps) {
  const { alert, open } = deps;
  const v = row?.version ? `${NAME} ${row.version}` : NAME;
  if (!row?.ipa) {
    await alert({ title: "Can't Install", message: `${v} has no ${NAME}.ipa in ${NAME}'s source.`, buttons: ["OK"] });
    return "no-asset";
  }
  const { index } = await alert({ title: `Install ${v}`,
    message: `Open ${DOMAIN} in Safari and tap Install ${NAME} Lite: it signs ${NAME} with your certificate.`,
    buttons: ["Cancel", "Open Safari"], cancel: 0 });
  if (index !== 1) return "cancelled";
  await open(SELF_SITE);
  return "site";
}
