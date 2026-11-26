// I3: the remembered apps' updates in Changes (core/appupdates.js), and the sideload app's background check fed.
//
//   upgrades = await withAppUpgrades(upgrades, holds);   // screens/changes.js, after catalog.upgrades
//
// Where there's no dpkg (the site, the sideload app), each app recorded by Install or Mark as Installed is matched
// against the newest version any loaded source offers this phone; a newer one joins Available Upgrades, so the tab
// badge counts it, and in the app the icon badge too (settings.js createUpgradeNotices). The jailbreak app is left
// as it was: dpkg's status file is what's installed there (I4 reads real app versions).
//
// F87: the jailbreak app does count the remembered apps now, at the version on the phone: rememberedApps() runs the
// records through backend.installedApps (I4, backend-native.js withRealVersions), so an app updated outside iFizBox
// is compared at its real version, and one no longer installed (`actual` null) is left out. dpkg's rows win where
// both list an id. Where the real versions can't be read (an older helper) the remembered ones stand, as in the
// sideload app. The Installed tab's Apps page and the app page show the record's `note` (screens/installed.js,
// screens/browse.js).
//
// The sideload app then hands its shell what to follow while iFizBox isn't open (BackgroundCheck.swift):
//   updates.watch { apps: [{ id, name, version, source }], known: ["<id> <version>"] } -> { scheduled }
// `known` are the upgrades already counted on screen: the background check only notifies about ones beyond them.
// iFizBox itself is followed through its own source (essential.js SELF_ALT_URL), unless Settings > Updates >
// <NAME> Updates is off (F285 withoutSelf). Sent again only when it changes.
// SPDX-License-Identifier: GPL-3.0-or-later
import { catalog } from "./catalog.js";
import { altKey } from "./core/altstore.js";
import { getBackend } from "./backend.js";
import { apps } from "./core/installed.js";
import { detectMode, selfUpdateAlertsOn } from "./core/settings.js";
import { SELF_ALT_URL } from "./core/essential.js";
import { IdMap } from "./core/apt.js";
import { rememberedUpgrades, mergeUpgrades, watchList, upgradeKeys, altSourceOf, SELF_ID, splitIgnoredVersions,
  settleIgnoredVersions } from "./core/appupdates.js";
import { NAME } from "./brand.js";
import { syncPush } from "./core/push.js";

let lastSent = null;

// The source's row for each remembered app, as screens/installed.js candidates() finds it. B47: `failed` counts the
// lookups that threw (the catalog not there), so a watch list isn't built from a half answer.
// B476: only on the source the app was installed from (ownKey): another source listing the same bundle ID (a modded
// X on fastsign beside AppTesters') is a different app, never its upgrade. No source of its own (My IPAs, a URL): none.
export const ownKey = (r) => (r?.key && r.key !== "*" ? r.key : typeof r?.source === "string" && r.source ? altKey(r.source) : null);

async function candidates(records, lookup = (id, key) => catalog.package(id, key)) {
  const out = new Map();
  let failed = 0;
  await Promise.all(records.filter((r) => r?.id && !r.self && ownKey(r)).map(async (r) => {
    const key = ownKey(r);
    const p = await Promise.resolve().then(() => lookup(r.id, key)).catch(() => { failed++; return null; });
    if (p?.key === key && p.stanza?.version) out.set(r.id, { ...(p.row ?? {}), id: r.id, version: p.stanza.version, key: p.key });
  }));
  return { cands: out, failed };
}

// What the shell follows: the watch list, plus iFizBox itself at the version it runs.
// B47: with `cands` (the Changes rows candidates() found), each app is followed at the AltStore source Changes reads
// it from, and only then: an app whose source was removed, or that no source lists, has no row in Changes, so the
// background check must not count it either (it used to fetch the record's own source and badge an update Changes
// never showed). `ignored`: Changes' Ignored Upgrades (holds, blocked), never followed. Without `cands` (old callers)
// the record's own source.
export function shellWatch(records, available, { cands = null, ignored = [] } = {}) {
  const sourceOf = cands ? (id) => altSourceOf(cands.get(id)?.key) : null;
  const list = watchList(records, { sourceOf, ignored });
  const me = (records ?? []).find((r) => r?.self && r.id === SELF_ID && r.version);
  if (me) list.unshift({ id: SELF_ID, name: NAME, version: String(me.version), source: SELF_ALT_URL });
  return { apps: list, known: upgradeKeys(available) };
}

// F87: the remembered apps (core/installed.js records); in the jailbreak app with the real versions and notes of
// backend.installedApps (I4), as they are where it can't say. Rejects only when the store can't be opened.
export async function rememberedApps({ mode = detectMode(), backend = null, store = apps } = {}) {
  const records = await (await store()).all();
  if (mode !== "jailbreak" || !records.length) return records;
  const b = backend ?? getBackend();
  if (typeof b?.installedApps !== "function") return records;
  try { return (await b.installedApps(records)) ?? records; } catch { return records; }
}

// F281: Ignore This Version. `versions` ({ id: version }, catalog.setIgnoredVersions) moves the rows at those versions
// under ignored, for the remembered apps as catalog.upgrades does for dpkg's; then the entries a newer version or the
// installed one has passed are dropped through `settle(next)` (core/appupdates.js settleIgnoredVersions), the
// installed versions taken from the records (in the jailbreak app the real ones) and dpkg's rows (`installedPkgs`).
async function withIgnoredVersions(merged, records, { versions, settle, installedPkgs }) {
  const out = splitIgnoredVersions(merged, versions);
  if (!versions || !Object.keys(versions).length || typeof settle !== "function") return out;
  const have = new Map();
  const pkgs = new IdMap(); // B412: dpkg's, names ignoring case
  try { for (const p of (await installedPkgs()) ?? []) if (p?.id && p.installed) pkgs.set(p.id, String(p.installed)); } catch { /* no status file */ }
  for (const r of records ?? []) if (r?.id && r.version && r.actual !== null) have.set(r.id, String(r.version));
  const next = settleIgnoredVersions(versions, { upgrades: out, installedOf: (id) => have.get(id) ?? pkgs.get(id) ?? null });
  if (JSON.stringify(next) !== JSON.stringify(versions)) { try { settle(next); } catch { /* settled again next time */ } }
  return out;
}

export async function withAppUpgrades(upgrades, holds = [], { mode = detectMode(), native = globalThis.ifizboxNative, store = apps,
  backend = null, lookup, versions = catalog.ignoredVersions(), settle = catalog.settleIgnoredVersions,
  installedPkgs = () => catalog.installed() } = {}) {
  const iv = { versions, settle, installedPkgs };
  if (mode === "jailbreak") {
    let records;
    try { records = (await rememberedApps({ mode, backend, store })).filter((r) => r?.actual !== null); } catch { return withIgnoredVersions(upgrades, [], iv); }
    if (!records.some((r) => r?.id && !r.self)) return withIgnoredVersions(upgrades, records, iv);
    const { cands } = await candidates(records, lookup);
    return withIgnoredVersions(mergeUpgrades(upgrades, rememberedUpgrades(records, (id) => cands.get(id) ?? null, holds)), records, iv);
  }
  let records = [];
  try { records = await (await store()).all(); } catch { return withIgnoredVersions(upgrades, [], iv); }
  const { cands, failed } = records.length ? await candidates(records, lookup) : { cands: new Map(), failed: 0 };
  const merged = await withIgnoredVersions(mergeUpgrades(upgrades, rememberedUpgrades(records, (id) => cands.get(id) ?? null, holds)), records, iv);
  // B47: a lookup that threw leaves the shell's last list as it is, rather than dropping apps Changes would count.
  // F281: an app whose version on offer is ignored (Ignore This Version) is still followed, its version counted as
  // known, so the next one notifies.
  if (mode === "sideload" && native?.call && !failed) {
    const skipped = merged.ignored.filter((r) => r.ignoredVersion);
    const ignored = [...new Set([...(holds ?? []), ...merged.ignored.filter((r) => !r.ignoredVersion).map((r) => r.id)])];
    const watch = shellWatch(records, [...merged.available, ...skipped], { cands, ignored });
    // B207: `known` holds the ignored versions too, which Changes doesn't count: the icon badge (the shell's and the
    // push server's) starts from the counted rows' keys, sent apart only when they differ.
    if (skipped.length) watch.counted = upgradeKeys(merged.available);
    lastWatch = { native, watch };
    sendWatch();
  }
  return merged;
}

// F285: Settings > Updates > <NAME> Updates (core/settings.js selfUpdateAlerts) off: iFizBox's own entry leaves the
// lists the background check and the push server follow, so only the user's apps alert; Changes still lists it.
export function withoutSelf(watch, selfAlerts = selfUpdateAlertsOn()) {
  return selfAlerts ? watch : { ...watch, apps: (watch?.apps ?? []).filter((a) => a?.id !== SELF_ID) };
}
let lastWatch = null; // the last full list, for selfAlertsChanged
function sendWatch() {
  if (!lastWatch) return;
  const { native } = lastWatch;
  const watch = withoutSelf(lastWatch.watch);
  const json = JSON.stringify(watch);
  if (json === lastSent) return;
  lastSent = json;
  Promise.resolve().then(() => native.call("updates.watch", watch)).catch(() => { lastSent = null; });
  // F280: the push server (the signing server) follows the same list (core/push.js; does nothing while Push is off)
  import("./signing/identity.js").then((s) => syncPush({ native, watch, server: s.getServer() })).catch(() => {});
}
// The switch flipped: send the last list again, with or without iFizBox.
export const selfAlertsChanged = () => sendWatch();
