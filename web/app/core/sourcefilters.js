// Source Filters (F382): what each source leaves out of its lists, set in Sources > Manage > Filters. Pure JS, no
// DOM: the settings store keeps the choices (core/settings.js sourceFilters), the worker's catalog (core/catalog.js
// setFilters) marks every row with the package tests below when a source is loaded and leaves the filtered rows out
// of every list, section and Search, like hidden sections.
//
// All Sources ("all") sets the defaults; a source follows it unless that switch was changed on the source's own page.
// Stored as { all: { id: bool }, "<source key>": { id: bool } }, only the switches someone changed.
//
//   SOURCE_FILTERS                      -> the switches, in the order the pages draw them
//   filtersFor(key, { lite })           -> the switches a page shows (All Sources or one source)
//   isLegacySource(key)                 -> an old source (BigBoss, ModMyi, ZodTTD): Hide Unknown is on there
//   filterOn(stored, key, id, { fit })  -> whether a switch is on for All Sources (key ALL_SOURCES) or a source;
//                                          `fit` is the worksOnMyPhone setting, All Sources' Works on My Phone
//   isCustom(stored, key, { lite, fit })-> whether a source (or All Sources) differs from what it would follow
//   resolveFilters(stored, keys, { lite, fit }) -> { dupes, byKey: { key: { fit?, old, unknown, paid, appTweaks } } }
//                                          what the worker gets; `fit` is there only where the source changed it
//   isOldPackage(stanza)                -> its stated minimum iOS is 10 or earlier; never an app
//   isUnknownIos(stanza)                -> it says nothing about the iOS version (core/compat.js iosRequirement)
//   isAppTweak(stanza)                  -> a tweak that can go into an app on a recent iPhone: an iphoneos-arm64 build,
//                                          or one stating firmware 15 or later (rootful-only tweaks are dropped)
//
// SPDX-License-Identifier: GPL-3.0-or-later
import { compareVersions } from "./apt.js";
import { iosRequirement } from "./compat.js";

export const ALL_SOURCES = "all";

// `lite`: only the sideload build has it; `allOnly`: All Sources only; `legacy`: on for old sources unless changed
// there. Footers follow AGENTS.md's hint rules: each explains only its own switch.
export const SOURCE_FILTERS = [
  { id: "fit", label: "Works on My Phone", def: true,
    footer: "Hides packages that say they don't work on this iPhone." },
  { id: "old", label: "Hide Old Packages", def: true,
    footer: "Hides packages made for iOS 10 or earlier." },
  { id: "unknown", label: "Hide Unknown", def: false, legacy: true,
    footer: "Hides packages that don't say which iOS they need. On for BigBoss and other old sources unless you change it there." },
  { id: "appTweaks", label: "App Tweaks Only", def: true, lite: true,
    footer: "Hides tweaks built only for older jailbreaks. They can't go into an app." },
  { id: "paid", label: "Hide Paid", def: false, footer: "Hides packages you have to buy." },
  { id: "dupes", label: "Newest Copy Only", def: true, allOnly: true,
    footer: "When two sources have the same package, shows it only in the one with the newest version." },
];
const byId = new Map(SOURCE_FILTERS.map((f) => [f.id, f]));

export const filtersFor = (key, { lite = false } = {}) =>
  SOURCE_FILTERS.filter((f) => (!f.lite || lite) && (!f.allOnly || key === ALL_SOURCES));

// Old sources whose packages mostly state no iOS range: written for iOS 3 to 10, rootful.
const LEGACY = /(?:^|[/.:])(?:thebigboss\.org|apt\.thebigboss\.org|modmyi\.com|apt\.modmyi\.com|zodttd\.com)(?:[/:]|$)/i;
export const isLegacySource = (key) => LEGACY.test(String(key ?? ""));

// The stored object, cleaned: only booleans of known switches.
export function normalizeFilters(o) {
  const out = {};
  if (!o || typeof o !== "object" || Array.isArray(o)) return out;
  for (const [key, sw] of Object.entries(o)) {
    if (!key || !sw || typeof sw !== "object" || Array.isArray(sw)) continue;
    const clean = {};
    for (const [id, on] of Object.entries(sw)) if (byId.has(id) && typeof on === "boolean") clean[id] = on;
    if (Object.keys(clean).length) out[key] = clean;
  }
  return out;
}

// All Sources' value of a switch: Works on My Phone is the worksOnMyPhone setting.
function allValue(stored, f, fit) {
  if (f.id === "fit") return fit !== false;
  return stored?.[ALL_SOURCES]?.[f.id] ?? f.def;
}
// What a source gets when its own switch wasn't changed: All Sources' choice, and Hide Unknown on old sources.
const followed = (stored, key, f, fit) => (f.legacy && isLegacySource(key)) || allValue(stored, f, fit);

export function filterOn(stored, key, id, { fit = true } = {}) {
  const f = byId.get(id);
  if (!f) return false;
  if (key === ALL_SOURCES) return allValue(stored, f, fit);
  return stored?.[key]?.[id] ?? followed(stored, key, f, fit);
}

export function isCustom(stored, key, { lite = false, fit = true } = {}) {
  return filtersFor(key, { lite }).some((f) => {
    const own = stored?.[key]?.[f.id];
    if (own == null) return false;
    return own !== (key === ALL_SOURCES ? f.def : followed(stored, key, f, fit));
  });
}

export function resolveFilters(stored, keys = [], { lite = false, fit = true } = {}) {
  const s = normalizeFilters(stored);
  const byKey = {};
  for (const key of keys) {
    const one = {
      old: filterOn(s, key, "old", { fit }),
      unknown: filterOn(s, key, "unknown", { fit }),
      paid: filterOn(s, key, "paid", { fit }),
      appTweaks: lite && filterOn(s, key, "appTweaks", { fit }),
    };
    if (typeof s[key]?.fit === "boolean") one.fit = s[key].fit;
    byKey[key] = one;
  }
  return { dupes: filterOn(s, ALL_SOURCES, "dupes", { fit }), byKey };
}

// ---- Package tests, from the Packages fields alone ----------------------------------------------------------

// The lowest iOS a package states (single-alternative firmware groups, minOSVersion), or null.
function lowest(st) {
  let lo = null;
  for (const g of iosRequirement(st).groups) {
    if (g.length !== 1 || !g[0].op) continue;
    const { op, version } = g[0];
    if ([">=", ">>", ">", "="].includes(op) && (!lo || compareVersions(version, lo) > 0)) lo = version;
  }
  return lo;
}
const major = (v) => Number.parseInt(String(v), 10);

// An app (AltStore source) is never old by this test: its minOSVersion is the oldest iOS it still runs on.
export function isOldPackage(st) {
  if (st?.kind === "ipa") return false;
  const lo = lowest(st);
  return Boolean(lo && major(lo) <= 10);
}

export const isUnknownIos = (st) => !iosRequirement(st).stated;

export function isAppTweak(st) {
  if (String(st?.architecture ?? "").trim() === "iphoneos-arm64") return true;
  const lo = lowest(st);
  return Boolean(lo && compareVersions(lo, "15") >= 0);
}
