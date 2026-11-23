// Installed packages and their upgrades. The core takes dpkg's status file as text: on the site the visitor
// uploads it (kept on the device, catalog.js), in the app the native backend reads it (N3). Pure JS, no DOM, no
// I/O; the worker's catalog (core/catalog.js) holds the parsed list and answers `installed` and `upgrades`.
//
//   parseStatus(text)                         -> [pkg]: the installed packages, sorted by name
//   installedStanzas(text)                    -> [stanza]: their status stanzas, file order (the package page, F27)
//   findUpgrades(installed, candidateOf, holds, { dpkgHolds }) -> { available: [row], ignored: [row] }
//
// Cydia's rule (docs/cydia.md "Changes and metadata.cb0"): a package is upgradable when it is installed and its
// candidate (the newest version on any source) is newer than the installed one. Held packages (dpkg's `hold`
// selection, or iFizBox's Ignored Upgrades list) go under Ignored Upgrades, not Available Upgrades.
import { parseControl, description, compareVersions, parseRelations } from "./apt.js";
import { sectionName, parseAuthor, compareNames, sectionGroup } from "./sections.js"; // C36: not catalog.js, which imports this file
import { NAME } from "../brand.js";
import { nativeBridge } from "../native.js";

// Where dpkg keeps it: rootful, then rootless (Dopamine, palera1n rootless).
export const STATUS_PATHS = ["/var/lib/dpkg/status", "/var/jb/var/lib/dpkg/status"];

// dpkg's package states that leave the package's files on disk (dpkg(1) "package states"). `not-installed` and
// `config-files` don't: those stanzas are leftovers, not installed packages.
const ON_DISK = new Set(["installed", "half-installed", "unpacked", "half-configured", "triggers-awaited", "triggers-pending"]);

// "want flag state", e.g. "hold ok installed" -> { want: "hold", state: "installed" }.
export function parseStatusField(value) {
  const [want = "", , state = ""] = String(value ?? "").trim().split(/\s+/);
  return { want, state };
}

// One installed package, shaped like a catalog row (core/catalog.js) so the same lists draw it, plus `held`
// (dpkg's hold selection) and `state` (anything but "installed" means a broken install).
function installedRow(st, deps = new Set()) {
  const { want, state } = parseStatusField(st.status);
  const name = st.name || st.package;
  return {
    id: st.package, name, short: description(st).short, version: st.version ?? "", section: sectionName(st.section),
    icon: null, key: null, author: parseAuthor(st.author)?.name || parseAuthor(st.maintainer)?.name || "",
    held: want === "hold", state, essential: /^yes$/i.test(st.essential ?? ""), tier: packageTier(st, deps), // F127
  };
}

// The status stanzas of the packages dpkg has on disk, first stanza per package, in file order.
export function installedStanzas(text) {
  const out = [];
  const seen = new Set();
  for (const st of parseControl(text)) {
    if (!st.package || !st.version || seen.has(st.package)) continue;
    if (!ON_DISK.has(parseStatusField(st.status).state)) continue;
    seen.add(st.package);
    out.push(st);
  }
  return out;
}

// The packages dpkg has on disk, sorted by name. A file that isn't a status file (no Status fields) gives [].
// `stanzas` (installedStanzas' result) saves parsing the text again.
export function parseStatus(text, stanzas = installedStanzas(text)) {
  const deps = dependedOn(stanzas);
  return stanzas.map((st) => installedRow(st, deps)).sort(compareNames);
}

// Whether text looks like a dpkg status file: at least one stanza with Package and Status. For the upload, so a
// Packages file or a random text file is refused with a message instead of an empty Installed tab.
export function looksLikeStatus(text) {
  return parseControl(String(text ?? "").slice(0, 65536)).some((st) => st.package && st.status);
}

// `installed`: parseStatus rows. `candidateOf(id)`: the row of the newest version on any source (with `version`),
// or null. `holds`: iFizBox's Ignored Upgrades (package ids). Each result row is the candidate's row with
// `installed` (the version on the device) added; both lists sorted by name. `dpkgHolds` off ignores the status
// file's hold flags: the app passes that, since there `holds` already is dpkg's list (apt-mark showhold, F22) and
// is newer than the status file it read.
export function findUpgrades(installed, candidateOf, holds = [], { dpkgHolds = true } = {}) {
  const ignoredIds = new Set(holds);
  const available = [];
  const ignored = [];
  for (const pkg of installed) {
    const cand = candidateOf(pkg.id);
    if (!cand || compareVersions(cand.version, pkg.version) <= 0) continue;
    const row = { ...cand, installed: pkg.version };
    ((dpkgHolds && pkg.held) || ignoredIds.has(pkg.id) ? ignored : available).push(row);
  }
  return { available: available.sort(compareNames), ignored: ignored.sort(compareNames) };
}

// ---- Apps installed without a jailbreak (F30) ----------------------------------------------------------------
// On the site and in the sideload build there is no dpkg to ask, so tapping Install on an app page (an AltStore
// app, screens/altstore.js) records it here, on the device (IndexedDB, nothing uploaded). The Installed tab lists
// the records newest first, marks the ones a source now has a newer version of, and Edit or a swipe removes one
// the user deleted from the phone. Jailbreak mode doesn't record: it reads dpkg's status file as above.
//
//   appRecord(app, now)                 -> { id, name, version, key, source, sourceName, icon, date, expires?, signer? }
//                                          (F342: the website's signature, below)
//   recordInstall(store, app, now)      -> the record, put in the store (one per app id: a reinstall replaces it)
//   removeInstall(store, id)
//   undoRecord(store, id, before, wrote) B170: an IPA run's record undone (iOS reported the app missing): `before` back
//   appRows(records)                    -> newest first (then by name)
//   appUpgrades(rows, candidateOf)      -> each row with `upgrade`: the candidate's version when it is newer, else null
//   openAppStore({ indexedDB, name })   -> Promise of { all, put, remove }; memoryAppStore() is the same in memory
//   apps()                              -> the device's store, opened once; onAppsChange(f) after record/remove

const APP_DB = "ifizbox-installed";
const APP_STORE = "apps";

const text = (v) => (v == null ? "" : String(v).trim());

export function appRecord(app, now = Date.now()) {
  const id = text(app?.id);
  if (!id) throw new Error("An app needs an id to be recorded");
  return {
    id, name: text(app.name) || id, version: text(app.version), key: app.key ?? null, source: text(app.source) || null,
    sourceName: text(app.sourceName) || null, icon: app.icon ?? null, date: now, ...signatureOf(app),
  };
}

export async function recordInstall(store, app, now = Date.now()) {
  // F342: the website's sign of this app, just before; else the same version written again (account sync, a repeat
  // mark) keeps the signature its record had
  const sig = takeSiteSignature(app?.id, now) ?? (await keptSignature(store, app));
  const rec = appRecord(sig ? { ...app, ...sig } : app, now);
  await store.put(rec);
  for (const f of appListeners) f();
  return rec;
}

// ---- F342: the website's signature on its install records ------------------------------------------------------
// The website signs in the browser (websign-job.js), so no shell keeps a signed record for it. The sign's end and
// signer stamp (core/websign.js signatureEnd, webSignerStamp) go on the install record instead: signInBrowser notes
// them for the app's IDs just before its onInstalled, and the record that onInstalled writes for one of those IDs takes
// them. Installed's days left and Changes' Needs Re-sign then read the records as the app reads signing.installed.
//   signatureOf(app)                     { expires?, signer? } of a record (valid ones only), for appRecord
//   noteSiteSignature(ids, sig, now)     the sign just made, for the next record of one of `ids` (SITE_SIGNATURE_WAIT)
//   takeSiteSignature(id, now)           that note, once (recordInstall), or null
//   siteSignedApps(records, current)     signing.installed's shape from the records that carry a signature:
//                                        { apps: [{ bundleId, name, version, expires, signer }], signer: current }
//   siteSignerNow({ fetcher })           this website's current stamp: WEB_SIGNER_VERSION and the hosted dylib's hash
// Records written before F342 carry neither and stay out: nothing says the website signed them.
export const SITE_SIGNATURE_WAIT = 30 * 60 * 1000; // Ready to Install can wait a while for its tap
const siteSignatures = new Map();

export function signatureOf(app) {
  const out = {};
  const t = Date.parse(app?.expires ?? "");
  if (Number.isFinite(t)) out.expires = new Date(t).toISOString();
  const v = Number(app?.signer?.version);
  if (Number.isFinite(v)) out.signer = { version: v, groupFix: text(app.signer.groupFix) || null };
  return out;
}

export function noteSiteSignature(ids, sig, now = Date.now()) {
  const keep = signatureOf(sig);
  if (!Object.keys(keep).length) return;
  const note = { ...keep, at: now };
  for (const id of new Set((Array.isArray(ids) ? ids : [ids]).map(text).filter(Boolean))) siteSignatures.set(id, note);
}

export function takeSiteSignature(id, now = Date.now()) {
  const note = id ? siteSignatures.get(text(id)) : null;
  if (!note || now < note.at) return null; // a record dated before the sign (account sync's) leaves it for the install
  for (const [k, n] of siteSignatures) if (n === note) siteSignatures.delete(k);
  if (now - note.at > SITE_SIGNATURE_WAIT) return null;
  const { at, ...sig } = note; // eslint-disable-line no-unused-vars
  return sig;
}

// The signature of the stored record for `app`'s id when it is the same version and `app` brings none; else null.
async function keptSignature(store, app) {
  const id = text(app?.id);
  if (!id || Object.keys(signatureOf(app)).length || typeof store?.all !== "function") return null;
  let had = null;
  try { had = (await store.all()).find((r) => r?.id === id) ?? null; } catch { return null; }
  const sig = had && text(had.version) === text(app.version) ? signatureOf(had) : {};
  return Object.keys(sig).length ? sig : null;
}

export function siteSignedApps(records, current = null) {
  const apps = [];
  for (const r of records ?? []) {
    if (!r?.id || r.self) continue;
    const sig = signatureOf(r);
    if (!sig.expires && !sig.signer) continue;
    apps.push({ bundleId: r.id, name: text(r.name) || r.id, version: text(r.version), ...sig });
  }
  return { apps, signer: current };
}

let signerNow = null;
export function siteSignerNow({ fetcher = globalThis.fetch } = {}) {
  signerNow ??= (async () => {
    // loaded here, not at startup (module-graph.test.js): groupfix.js brings core/tweaks.js
    const [{ GROUPFIX }, { webSignerStamp, groupFixHash }] = await Promise.all([import("./groupfix.js"), import("./websign.js")]);
    let hash = null;
    try {
      const r = await fetcher(new URL(`../${GROUPFIX.file}`, import.meta.url));
      if (r.ok) hash = await groupFixHash(new Uint8Array(await r.arrayBuffer()));
    } catch { /* no dylib: the version alone decides */ }
    if (!hash) signerNow = null; // asked again next time, not kept for the session
    return webSignerStamp(hash);
  })();
  return signerNow;
}

export async function removeInstall(store, id) {
  await store.remove(id);
  for (const f of appListeners) f();
}

// ---- B358: an app installed under a custom bundle ID ---------------------------------------------------------------
// An install with its own bundle ID (Custom Install) is on the phone under that ID while its source lists the IPA's
// own, and the shell's signed record keeps both (`bundleId`, `originalBundleId`). The record is matched by the
// installed bundle ID first, then the asked one, then the signed record's original ID, so a source entry that no longer
// lists the app (or lists another app under the custom ID) still finds it.
//   recordOf(records, id, signed)                  -> the device record standing for that app, or null
//   await forgetInstalled({ id, signed }, { store, native }) -> Mark as Not Installed: its record(s) go and, where the
//                                                    shell signed it, its signed record (signing.forget); -> true if
//                                                    anything was forgotten
export function recordOf(records, id, signed = null) {
  const list = (records ?? []).filter((r) => r?.id && !r.self);
  for (const want of [signed?.bundleId, id, signed?.originalBundleId]) {
    const r = want ? list.find((x) => x.id === want) : null;
    if (r) return r;
  }
  return null;
}

export async function forgetInstalled({ id = null, signed = null } = {}, { store = apps, native = null } = {}) {
  let gone = false;
  if (signed?.bundleId && typeof native?.call === "function") {
    await native.call("signing.forget", { bundleId: signed.bundleId });
    gone = true;
  }
  const s = await store();
  const records = await s.all();
  const ids = new Set([id, signed?.bundleId].filter(Boolean));
  const rec = recordOf(records, id, signed);
  if (rec) ids.add(rec.id);
  for (const rid of ids) {
    if (!records.some((r) => r?.id === rid && !r.self)) continue;
    await removeInstall(s, rid);
    gone = true;
  }
  if (gone && !rec) for (const f of appListeners) f(); // a signed record only: the lists load again too
  return gone;
}

// B170: undo a record an IPA run wrote for an app iOS then reported missing: the record that stood before it (`before`,
// an upgrade's older version or a Mark as Installed) goes back, else the app's record goes. A record changed since
// (`wrote`: the one the run wrote, by its date) is left alone: something newer recorded the app.
export async function undoRecord(store, id, before = null, wrote = null) {
  if (!id) return false;
  if (wrote) {
    let now = null;
    try { now = (await store.all()).find((r) => r.id === id) ?? null; } catch { /* no list: undo anyway */ }
    if (now && now.date !== wrote.date) return false;
  }
  if (before?.id === id) await store.put(before);
  else await store.remove(id);
  for (const f of appListeners) f();
  return true;
}

export function appRows(records) {
  return [...(records ?? [])].sort((a, b) => (b.date ?? 0) - (a.date ?? 0) || compareNames(a, b));
}

// `candidateOf(id)`: the newest version on any source (a row with `version`), or null when no source has the app.
export function appUpgrades(rows, candidateOf) {
  return rows.map((r) => {
    const cand = candidateOf(r.id);
    const upgrade = cand?.version && r.version && compareVersions(cand.version, r.version) > 0 ? cand.version : null;
    return { ...r, upgrade };
  });
}

// B150: the shell's signed-app list (signing.installed: { apps: [{ bundleId, originalBundleId, name, ... }], ... })
// names each app by its IPA's Info.plist (RyukGram's IPA says "Instagram"). An app installed from a source keeps the
// name it was picked as there: the record Install wrote for the app iOS has under that ID (`source` set) gives the
// name; an app with no source record (My IPAs, Install from URL, no record) keeps the IPA's. The record is the one
// install iFizBox made on this phone under that ID (a reinstall replaces it), not a source lookup by bundle ID, so
// RyukGram variants and real Instagram, which share com.burbn.instagram, never borrow each other's names.
// -> the same object with `apps` renamed (the input untouched); anything else comes back as it is.
// B247: the shell's signed record keeps the source's app it was signed from (`credit`, below), and that comes first:
// the device record is matched by bundle ID only, and the last Install from any source sharing the ID wrote it.
export function withSourceNames(installed, records) {
  if (!Array.isArray(installed?.apps)) return installed;
  const named = new Map();
  for (const r of records ?? []) if (r?.id && r.source && !r.self && text(r.name)) named.set(r.id, text(r.name));
  if (!named.size && !installed.apps.some((a) => creditOf(a))) return installed;
  const apps = installed.apps.map((a) => {
    const name = creditOf(a)?.name ?? named.get(a?.bundleId) ?? (a?.originalBundleId ? named.get(a.originalBundleId) : undefined);
    return name && a.name !== name ? { ...a, name } : a;
  });
  return { ...installed, apps };
}

// ---- B247: the source's app a signed app was installed from ----------------------------------------------------
// Several sources can list apps under one bundle ID (RyukGram's source and AppTesters' Instagram both list
// com.burbn.instagram), so the bundle ID can't say which one is on the phone. Signing from a source (its app page,
// the queue) sends the source's app with the IPA (`credit` on signing.prepare and signing.install); the shell keeps it
// on its signed record (native/sign/SignOptions.swift SourceCredit), signing.installed hands it back on each app, and
// Re-sign keeps it. The lists match on it first and fall back to the bundle ID for apps signed without one.
//
//   sourceCredit(job)                    -> { name, source, sourceName, key } for a job from a source (core/appqueue.js
//                                           appJob: source = the source's URL, key its catalog key), else null
//   creditOf(app)                        -> a signed app's credit ({ name, source, sourceName, key }), or null
//   creditedRecords(records, installed)  -> the records, each one a credited signed app stands for (by bundle ID or
//                                           original ID) named and sourced by that credit; the rest as they are
//   recreditedRecords(records, installed) -> just the records creditedRecords changed (to write back), as records
export function sourceCredit(job) {
  const source = httpHref(job?.source);
  const name = text(job?.name);
  if (!source || !name) return null;
  return { name, source, sourceName: text(job.sourceName) || null, key: text(job.key) || null };
}

export function creditOf(app) {
  const c = app?.credit;
  const name = text(c?.name);
  if (!name) return null;
  return { name, source: text(c.source) || null, sourceName: text(c.sourceName) || null, key: text(c.key) || null };
}

// By installed ID; by original ID only where no signed app is installed under that ID: a copy (installed under the
// profile's ID) never credits the app that kept the original one (RyukGram copy beside AppTesters' Instagram).
function creditIndex(installed) {
  const out = new Map();
  const apps = Array.isArray(installed?.apps) ? installed.apps : [];
  const installedAs = new Set(apps.map((a) => a?.bundleId).filter(Boolean));
  for (const a of apps) { const c = creditOf(a); if (c && a.bundleId) out.set(a.bundleId, c); }
  for (const a of apps) {
    const c = creditOf(a);
    const id = a?.originalBundleId;
    if (c && id && !installedAs.has(id) && !out.has(id)) out.set(id, c);
  }
  return out;
}

function credited(r, c) {
  const next = { name: c.name, source: c.source ?? r.source ?? null, sourceName: c.sourceName ?? r.sourceName ?? null, key: c.key ?? r.key ?? null };
  return Object.keys(next).every((k) => (r[k] ?? null) === next[k]) ? r : { ...r, ...next };
}

export function creditedRecords(records, installed) {
  const index = creditIndex(installed);
  if (!index.size) return records ?? [];
  return (records ?? []).map((r) => {
    const c = r?.id && !r.self ? index.get(r.id) : null;
    return c ? credited(r, c) : r;
  });
}

export function recreditedRecords(records, installed) {
  const before = records ?? [];
  return creditedRecords(before, installed).filter((r, i) => r !== before[i]).map((r) => appRecord(r, r.date ?? Date.now()));
}

// B156: an app installed from a source whose Installed record never got written (Install records it only once iOS
// said it has the app, B136; an answer that came too early left none) listed as "Signed by iFizBox. No source
// lists it." under no letter. The shell's signed-app record keeps the IPA's `url`; a source whose app offers that
// exact download names it, and the record is written again. Matching the download, not the bundle ID, keeps B150's
// rule: RyukGram and real Instagram share an ID, never an IPA.
//   unrecordedSigned(installed, records) -> the signed apps no record stands for (by bundle ID or original ID)
//   sourceRecordFor(app, pkgs, now)     -> the record of `app` (a signed app) for the first catalog package
//                                          ({ stanza: { ipa }, key }) offering its url, or null
const httpHref = (u) => {
  try { const x = new URL(String(u ?? "").trim()); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; }
};
export function unrecordedSigned(installed, records) {
  if (!Array.isArray(installed?.apps)) return [];
  const ids = new Set((records ?? []).map((r) => r?.id).filter(Boolean));
  return installed.apps.filter((a) => a?.bundleId && !ids.has(a.bundleId) && !(a.originalBundleId && ids.has(a.originalBundleId)));
}
const offersUrl = (p, want) => {
  const ipa = p?.stanza?.ipa;
  if (!ipa || !want) return false;
  return [p.stanza.downloadURL, ipa.downloadURL, ...(ipa.versions ?? []).map((v) => v?.downloadURL)].some((u) => httpHref(u) === want);
};

// B247: a signed app with no credit (signed before the shell kept one) whose record names a source entry that doesn't
// offer its IPA, while another entry does: that entry's credit, to write on the record (creditedRecords' rule). Null
// when the record's own entry offers it, or none does: the bundle ID's record stands.
export function urlCredit(app, pkgs, record) {
  const want = httpHref(app?.url);
  if (!want || creditOf(app)) return null;
  const offering = (pkgs ?? []).filter((p) => offersUrl(p, want));
  if (!offering.length || offering.some((p) => record?.key && p.key === record.key)) return null;
  const ipa = offering[0].stanza.ipa;
  return creditOf({ credit: { name: ipa.name || app.name, source: ipa.sourceUrl, sourceName: ipa.sourceName, key: offering[0].key } });
}

export function sourceRecordFor(app, pkgs, now = Date.now()) {
  if (!app?.bundleId) return null;
  const signedAt = Date.parse(app.signed);
  const c = creditOf(app); // B247: the source's app it was signed from, when the shell kept it, names it first
  if (c?.source) {
    const ipa = (pkgs ?? []).find((p) => p?.stanza?.ipa && c.key && p.key === c.key)?.stanza.ipa;
    return appRecord({ id: app.bundleId, name: c.name, version: app.version, key: c.key, source: c.source,
      sourceName: c.sourceName, icon: ipa?.iconURL ?? null }, Number.isFinite(signedAt) ? signedAt : now);
  }
  const want = httpHref(app?.url);
  if (!want) return null;
  for (const p of pkgs ?? []) {
    if (!offersUrl(p, want)) continue;
    const ipa = p.stanza.ipa;
    return appRecord({ id: app.bundleId, name: text(ipa.name) || app.name, version: app.version, key: p.key ?? null,
      source: ipa.sourceUrl, sourceName: ipa.sourceName, icon: ipa.iconURL ?? null }, Number.isFinite(signedAt) ? signedAt : now);
  }
  return null;
}

// B247: `record` with `credit` (creditOf's) written on it, as creditedRecords would: an appRecord to store.
export function recordWithCredit(record, credit) {
  const r = credited(record, credit);
  return r === record ? null : appRecord(r, r.date ?? Date.now());
}

// signing.installed through the bridge, renamed by its credits and the device's records (withSourceNames). Throws as the call does.
export async function signedAppsNamed(native = nativeBridge(), { store = apps } = {}) {
  const [installed, records] = await Promise.all([native.call("signing.installed", {}), store().then((s) => s.all()).catch(() => [])]);
  return withSourceNames(installed, records);
}

export function memoryAppStore(initial = []) {
  const m = new Map(initial.map((r) => [r.id, r]));
  return {
    all: async () => [...m.values()],
    put: async (rec) => { m.set(rec.id, rec); return rec; },
    remove: async (id) => { m.delete(id); },
  };
}

export function openAppStore({ indexedDB: idb = globalThis.indexedDB, name = APP_DB } = {}) {
  if (!idb) return Promise.reject(new Error("IndexedDB is not available"));
  return new Promise((resolve, reject) => {
    const req = idb.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(APP_STORE)) db.createObjectStore(APP_STORE, { keyPath: "id" });
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const run = (mode, f) => new Promise((res, rej) => {
        const tx = db.transaction(APP_STORE, mode);
        const r = f(tx.objectStore(APP_STORE));
        tx.oncomplete = () => res(r?.result);
        tx.onerror = () => rej(tx.error ?? r?.error);
        tx.onabort = () => rej(tx.error ?? new Error("transaction aborted"));
      });
      resolve({
        all: () => run("readonly", (s) => s.getAll()),
        put: (rec) => run("readwrite", (s) => s.put(rec)).then(() => rec),
        remove: (id) => run("readwrite", (s) => s.delete(id)).then(() => undefined),
      });
    };
  });
}

let shared = null;
// Where IndexedDB is missing (Safari private mode can refuse it) the records last for this session only.
// The sideload app always lists itself, at the version it is (app.info), whatever was recorded: so iFizBox's own
// updates show in Installed and Changes like any app's. (The jailbreak app reads dpkg, which already has it.)
export const apps = () => (shared ??= openAppStore().catch(() => memoryAppStore()).then(withSelf));

export const SELF_ID = "com.ryha.ifizbox";
let selfInfo = null;
function selfRecord(native = nativeBridge()) {
  if (!native?.call) return Promise.resolve(null);
  selfInfo ??= Promise.resolve().then(() => native.call("app.info", {})).then((i) => (i?.mode === "jailbreak" || !i?.version ? null
    : { id: SELF_ID, name: NAME, version: String(i.version), key: null, source: null, sourceName: NAME,
      icon: "icons/icon-lite-glossy-76.png", date: 0, self: true }), () => null); // the sideload app's LITE icon
  return selfInfo;
}
export function withSelf(store, native) {
  return { ...store, all: async () => {
    const recs = await store.all();
    const me = await selfRecord(native);
    return me ? [me, ...recs.filter((r) => r.id !== SELF_ID)] : recs;
  } };
}

const appListeners = new Set();
export function onAppsChange(f) {
  appListeners.add(f);
  return () => appListeners.delete(f);
}

// F51: the ids of everything the user has installed, for the Changes tab's Installed scope: dpkg's packages
// (parseStatus rows, or null without a status file) and the apps recorded on the device (appRecord records).
export function installedIds(dpkgRows, appRecords) {
  const ids = new Set();
  for (const r of dpkgRows ?? []) if (r?.id) ids.add(r.id);
  for (const r of appRecords ?? []) if (r?.id) ids.add(r.id);
  return ids;
}

// ---- F127: Installed's modes, type filters and search (Cydia's InstalledController) ----------------------------
// Cydia 1.1's Installed tab has a segmented control in the nav bar: User, Expert, Recent (MobileCydia.mm
// InstalledController, checked on the 4S: ref/4s/screens/cydia-installed-*.png). Cydia ranks each package by its
// `Tag: role::…` (Package role_: none 0, enduser 1, hacker 2, developer 3, any other role 4, cydia 7): User lists
// role <= 1, Expert role <= 3, Recent role < 7 by the birth time of dpkg's info/<pkg>.list, newest first, in day
// sections (long date style), leaving out packages with no date. Few packages carry role tags now, so User also
// leaves out what the user didn't choose (the brief, user 2026-11-18): Essential packages (`Essential: yes`, the
// `cydia::essential` tag, `Priority: required`) and dependencies (anything another installed package Depends or
// Pre-Depends on, by name or through Provides). A row's `tier` holds that rank: 1 User, 2 Expert as a dependency
// only (F130), 3 Expert, 6 Recent only, 7 never listed.
//
// F130: the dependency rule is a guess, and it hides tweaks the user chose that others also need (Activator,
// AppList, AppSync). Where apt's own marks can be read (the jailbreak app: apt.autoInstalled, the packages
// /var/lib/apt/extended_states marks `Auto-Installed: 1`), markedRows puts them in its place: tier 2 rows apt
// didn't mark go back to User, User rows apt marked go to Expert. Without marks (the site's uploaded status file,
// an older shell) the guess stays.
//
//   dependedOn(stanzas)                     -> Set of the installed ids another installed package needs
//   packageTier(stanza, deps)               -> 1 | 2 | 3 | 6 | 7
//   markedRows(rows, auto)                  -> rows re-tiered by apt's Auto-Installed marks (auto: Set, or null)
//   modeRows(rows, mode, dates)             -> the rows a mode lists, in its order (dates: { id: seconds })
//   typeRows(rows, type)                    -> rows of one TYPES kind (Search's scope bar: core/catalog.js sectionGroup)
//   queryRows(rows, query)                  -> rows whose name, id, description or author hold every word of query
//   dayHeaders(rows, dates, locale)         -> Recent's list items: { header: "November 16, 2026" } before each day

export const MODES = ["user", "expert", "recent"];
export const MODE_LABEL = { user: "User", expert: "Expert", recent: "Recent" };
export const TYPES = ["All", "Tweaks", "Themes", "Apps"]; // Search's segments (screens/search.js SCOPES), same order

const tagsOf = (st) => String(st?.tag ?? "").split(",").map((t) => t.trim()).filter(Boolean);

// Cydia's role_: the first role:: tag decides.
export function roleRank(st) {
  const tag = tagsOf(st).find((t) => t.startsWith("role::"));
  if (!tag) return 0;
  return { enduser: 1, hacker: 2, developer: 3, cydia: 7 }[tag.slice(6)] ?? 4;
}

export function dependedOn(stanzas) {
  const ids = new Set(stanzas.map((st) => st.package));
  const providers = new Map(); // virtual name -> installed ids that provide it
  for (const st of stanzas) {
    for (const [p] of parseRelations(st.provides)) {
      if (!providers.has(p.name)) providers.set(p.name, []);
      providers.get(p.name).push(st.package);
    }
  }
  const out = new Set();
  for (const st of stanzas) {
    for (const group of [...parseRelations(st["pre-depends"]), ...parseRelations(st.depends)]) {
      for (const alt of group) {
        for (const id of [...(ids.has(alt.name) ? [alt.name] : []), ...(providers.get(alt.name) ?? [])]) {
          if (id !== st.package) out.add(id);
        }
      }
    }
  }
  return out;
}

export function packageTier(st, deps = new Set()) {
  const role = roleRank(st);
  if (role === 7) return 7;
  if (role >= 4) return 6;
  if (role >= 2) return 3;
  const essential = /^yes$/i.test(st.essential ?? "") || tagsOf(st).includes("cydia::essential") ||
    /^required$/i.test(String(st.priority ?? "").trim());
  if (essential) return 3;
  return deps.has(st.package) ? 2 : 1;
}

export function markedRows(rows, auto) {
  if (!(auto instanceof Set)) return rows;
  return rows.map((r) => {
    const t = tierOf(r);
    if (t === 2 && !auto.has(r.id)) return { ...r, tier: 1 };
    if (t === 1 && auto.has(r.id)) return { ...r, tier: 2 };
    return r;
  });
}

// Rows without a tier (an older worker's) count as User, so nothing disappears.
const tierOf = (r) => (Number.isFinite(r?.tier) ? r.tier : 1);
const dateOf = (dates, r) => Number(dates?.[r.id]) || 0;

export function modeRows(rows, mode, dates = null) {
  if (mode === "recent") {
    return rows.filter((r) => tierOf(r) < 7 && dateOf(dates, r) > 0)
      .sort((a, b) => dateOf(dates, b) - dateOf(dates, a) || compareNames(a, b));
  }
  const max = mode === "expert" ? 3 : 1; // tier 2 (F130) is Expert
  return rows.filter((r) => tierOf(r) <= max);
}

export function typeRows(rows, type) {
  if (!type || type === "All" || !TYPES.includes(type)) return rows;
  return rows.filter((r) => sectionGroup(r.section) === type);
}

export function queryRows(rows, query) {
  const words = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return rows;
  return rows.filter((r) => {
    const hay = [r.name, r.id, r.short, r.author].filter(Boolean).join("\n").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function dayLabel(seconds, locale) {
  return new Date(seconds * 1000).toLocaleDateString(locale, { dateStyle: "long" });
}

export function dayHeaders(rows, dates, locale) {
  const out = [];
  let cur = null;
  for (const r of rows) {
    const t = dateOf(dates, r);
    const label = t > 0 ? dayLabel(t, locale) : null;
    if (label && label !== cur) { out.push({ header: label }); cur = label; }
    out.push(r);
  }
  return out;
}

// ---- F222: Installed's Manage mode (the apps list without a jailbreak) -------------------------------------------
//
// Pure helpers for screens/installed.js's Manage: the rows are the list's own (withSignatures' rows and extra rows,
// each with `signed`: its signing.installed record or null, and `onSource`: a marked app's installed version is on its
// source, core/appqueue.js markedVersionOnSource). `selected` is a Set of bundle IDs.
//
//   manageKinds(r)                  -> { resign, update, expiring, marked, blocked } for a row Manage can pick, or null
//                                      (iFizBox's own); B66: `blocked`, a marked app Re-sign can't sign (its installed
//                                      version isn't on its source): Re-sign then explains and offers the newest
//   manageable(rows)                -> the rows Manage can pick
//   MANAGE_PRESETS                  -> Select…'s presets: all, expiring, marked (Not Signed Here), updates
//   presetIds(rows, preset)         -> the ids a preset picks
//   selectSheet(rows)               -> Select…'s action sheet buttons: [{ preset, label }] ("Expiring Soon (2)")
//   selectLabel(rows, selected)     -> the nav bar's left button: "Select…", or "Deselect" once every row is picked
//   manageCounts(rows, selected)    -> { n, resign, update, del, marked, blocked }: the picked rows each toolbar button
//                                      acts on (Re-sign (n) counts what it signs; it is enabled for blocked ones too)
//   manageSummary(rows, selected)   -> the grey line above the list: "2 selected · 5 apps · 1 expiring · 3 updates"
//   manageToolbar(counts)           -> [{ kind, label, disabled }]: Re-sign (n), Update (n), Delete (n)
//   pruneSelection(selected, rows)  -> the selection without ids the list no longer has
export const MANAGE_PRESETS = ["all", "expiring", "marked", "updates"];
export const SELECT = "Select…";
export const DESELECT = "Deselect";
const PRESET_LABEL = { all: "All Apps", expiring: "Expiring Soon", marked: "Not Signed Here", updates: "With Updates" };

export function manageKinds(r) {
  if (!r?.id || r.self) return null;
  const marked = !r.signed && !r.signedOnly;
  return {
    resign: Boolean(r.signed) || (marked && Boolean(r.onSource)),
    update: Boolean(r.upgrade),
    expiring: r.sig?.state === "soon" || r.sig?.state === "expired", // inside the re-sign window, or past it
    marked,
    blocked: marked && !r.onSource,
  };
}

export const manageable = (rows) => (rows ?? []).filter((r) => manageKinds(r));

export function presetIds(rows, preset) {
  const pick = { all: () => true, expiring: (k) => k.expiring, marked: (k) => k.marked, updates: (k) => k.update }[preset];
  if (!pick) return [];
  return manageable(rows).filter((r) => pick(manageKinds(r))).map((r) => r.id);
}

export function selectSheet(rows) {
  return MANAGE_PRESETS.map((preset) => ({ preset,
    label: preset === "all" ? PRESET_LABEL.all : `${PRESET_LABEL[preset]} (${presetIds(rows, preset).length})` }));
}

export function selectLabel(rows, selected) {
  const ids = manageable(rows).map((r) => r.id);
  return ids.length && ids.every((id) => selected?.has(id)) ? DESELECT : SELECT;
}

export function manageCounts(rows, selected) {
  const out = { n: 0, resign: 0, update: 0, del: 0, marked: 0, blocked: 0 };
  for (const r of manageable(rows)) {
    if (!selected?.has(r.id)) continue;
    const k = manageKinds(r);
    out.n++;
    out.del++; // every row Manage picks can be deleted or removed (B46's rules decide which, per app)
    if (k.resign) out.resign++;
    if (k.resign && !r.signed) out.marked++; // downloaded from its source first
    if (k.blocked) out.blocked++; // Re-sign says why it can't, and offers the newest version
    if (k.update) out.update++;
  }
  return out;
}

export function manageSummary(rows, selected) {
  const all = manageable(rows);
  const c = manageCounts(rows, selected);
  const expiring = all.filter((r) => manageKinds(r).expiring).length;
  const updates = all.filter((r) => manageKinds(r).update).length;
  return [`${c.n} selected`, all.length === 1 ? "1 app" : `${all.length} apps`, `${expiring} expiring`,
    updates === 1 ? "1 update" : `${updates} updates`].join(" · ");
}

const counted = (label, n) => (n > 0 ? `${label} (${n})` : label);
export function manageToolbar(c) {
  return [
    { kind: "resign", label: counted("Re-sign", c.resign), disabled: !c.resign && !c.blocked },
    { kind: "update", label: counted("Update", c.update), disabled: !c.update },
    { kind: "delete", label: counted("Delete", c.del), disabled: !c.del },
  ];
}

export function pruneSelection(selected, rows) {
  const have = new Set(manageable(rows).map((r) => r.id));
  return new Set([...(selected ?? [])].filter((id) => have.has(id)));
}
