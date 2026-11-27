// AltStore sources (F9): the JSON source format AltStore, SideStore, Feather and LiveContainer read, listing IPA
// apps for phones without a jailbreak. Pure JS, no DOM: the parse runs in the worker beside the APT catalog
// (core/catalog.js loadAlt), so an app is a catalog row like any package, in lists, Search and Changes.
//
//   parseAltSource(json | text)          -> { name, identifier, subtitle, description, iconURL, headerURL, website,
//                                            tintColor, featuredApps, news: [...], apps: [app] }  or throws
//   app: { id, bundleIdentifier, name, developerName, subtitle, localizedDescription, iconURL, tintColor, category,
//          screenshots: [{ url, width, height }], permissions: { entitlements: [{ name, description }],
//          privacy: [{ name, description }] }, versions: [version] }   (versions newest first, as the source lists them)
//          id: the catalog key, the bundle id; a variant sharing it gets <bundle id>~<name slug> (F42, see variantId)
//   version: { version, buildVersion, date, localizedDescription, downloadURL, size, minOSVersion, maxOSVersion }
//   runsOn(version, ios)                 -> false when the phone's iOS is outside min/maxOSVersion (ios null: true)
//   runnableVersions(app, ios)           -> the versions this phone can run: the only ones shown or filed in Changes
//   appStanza(app, source, ios)          -> the catalog's record for an app (null when no version runs here)
//   installOptions(version, sourceUrl)   -> { itms, download, open: [{ name, url }] }
//   newsToNotify(source, sentIds)        -> news items with notify: true not sent yet (for the push job, F10)
//   withAltSources(calls, backend, opts) -> a backend's source calls with AltStore sources kept beside the APT ones
//
// The format: https://faq.altstore.io/developers/make-a-source (2.0 with `versions`; 1.x apps carry version,
// versionDate, versionDescription, downloadURL and size on the app itself, and `screenshotURLs`/`permissions`).
// Anything optional that is missing or the wrong type is dropped, never thrown: sources are hand-written JSON.
//
// F16a: the list keeps every IPA source format (core/sources/detect.js FORMATS: altstore, esign, scarlet, gbox) as a
// record with `format`; parseSource(format, json) reads any of them into parseAltSource's shape (plus `extra`) through
// core/sources/ipa.js parseIpaSource. A record with `unsupported` (an encrypted GBox source) has a reason and no
// apps: its page shows the reason and the Open in row (F8).
import { pool, withTimeout, healthFields, REFRESH_TIMEOUT, REFRESH_CONCURRENCY } from "./health.js";
import { parseIpaSource } from "./sources/ipa.js";
import { NAME } from "../brand.js";
// The parse half lives in core/altparse.js (core/sources/ipa.js imports it from there, not from here: no cycle).
import { str, httpUrl, looksLikeAltSource } from "./altparse.js";
import { idbRunner } from "./idb.js";
export { str, httpUrl, tintOf, dateOf, compareOS, runsOn, parseAltSource, appSection, appStanza } from "./altparse.js";

const ALT_PREFIX = "alt:";
export const isAltKey = (key) => String(key ?? "").startsWith(ALT_PREFIX);
export const altKey = (url) => ALT_PREFIX + url;
// B476: the source a remembered app record was installed from: its catalog key, else its AltStore source's. No
// source of its own (My IPAs, a URL): null.
export const ownKey = (r) => (r?.key && r.key !== "*" ? r.key : typeof r?.source === "string" && r.source ? altKey(r.source) : null);

// How an app gets onto the phone. iOS installs an IPA over the air only from an itms-services link to a signed
// manifest, so that is offered only where the source gives one: a downloadURL that already is itms-services://,
// or a manifestURL (an https .plist). Otherwise the app opens in a sideloader that signs on the phone (AltStore,
// SideStore, Feather) by adding the source there; `download` is the raw IPA for doing it by hand.
// AltStore and SideStore take <scheme>://source?url=<encoded url>; Feather takes feather://source/<url>, the URL
// unencoded after the path (FeatherApp.swift, `validatedScheme(after: "/source/")`), as for /install/ (B6).
const sourceQuery = (scheme) => (u) => `${scheme}://source?url=${encodeURIComponent(u)}`;
const SIDELOADERS = [
  { name: "AltStore", scheme: "altstore", source: sourceQuery("altstore") },
  { name: "SideStore", scheme: "sidestore", source: sourceQuery("sidestore") },
  { name: "Feather", scheme: "feather", source: (u) => `feather://source/${u}` },
];

export function installOptions(version, sourceUrl) {
  let itms = null;
  const dl = str(version?.downloadURL);
  if (/^itms-services:\/\//i.test(dl)) itms = dl;
  else if (version?.manifestURL) itms = `itms-services://?action=download-manifest&url=${encodeURIComponent(version.manifestURL)}`;
  const download = httpUrl(dl);
  const url = httpUrl(sourceUrl);
  const open = url ? SIDELOADERS.map(({ name, source }) => ({ name, url: source(url) })) : [];
  return { itms, download, open };
}

// B269: whether an IPA source's app entry can be signed and installed (the sideload build's lists hide the rest).
//   signableDownload(url)  -> { ok, why }   one version's downloadURL, as installOptions reads it
//   signableApp(stanza)    -> { ok, why }   a catalog app record (appStanza: kind "ipa", ipa): its newest runnable version
// The install page's check is core/appqueue.js appJob (an http(s) download from installOptions, never itms-services),
// which asks signableDownload too: a row the lists keep queues a job, a row Install would refuse is left out.
// why: "no-ipa" (none, or only an itms-services / manifest link), "deb" (a tweak), "app-store" (an App Store page),
// "web-clip" (.mobileconfig), "not-app". An iOS range this phone isn't in needs nothing here: appStanza keeps only the
// versions that run on it, and none means no entry at all.
const APP_STORE_HOST = /^(apps|itunes|geo\.itunes)\.apple\.com$/i;
export function signableDownload(url) {
  const download = installOptions({ downloadURL: url }, null).download;
  let u = null;
  try { u = download ? new URL(download) : null; } catch { u = null; }
  if (!u) return { ok: false, why: "no-ipa" };
  let path = u.pathname;
  try { path = decodeURIComponent(path); } catch { /* keep it encoded */ }
  path = path.toLowerCase();
  if (APP_STORE_HOST.test(u.hostname)) return { ok: false, why: "app-store" };
  if (path.endsWith(".deb")) return { ok: false, why: "deb" };
  if (/\.(mobileconfig|webclip)$/.test(path)) return { ok: false, why: "web-clip" };
  return { ok: true, why: null };
}
export function signableApp(st) {
  if (st?.kind !== "ipa" || !st.ipa) return { ok: false, why: "not-app" };
  const v = st.ipa.versions?.[0];
  return v ? signableDownload(v.downloadURL) : { ok: false, why: "no-ipa" };
}

// News items flagged notify: true that haven't been pushed (sentIds: identifiers already sent), newest first.
export function newsToNotify(source, sentIds = []) {
  const sent = new Set(sentIds);
  return (source?.news ?? []).filter((n) => n.notify && !sent.has(n.identifier));
}

// ---- adding and refreshing -----------------------------------------------------------------------------------

// What the user typed -> the source URL, or null when it isn't an http(s) URL. A sideloader link
// (altstore://source?url=..., sidestore://, feather://) gives its url. No trailing slash is added: a source is a file.
export function normalizeAltUrl(input) {
  let s = str(input);
  const link = s.match(/^[a-z][a-z0-9+.-]*:\/\/source\/?\?(.*)$/i);
  if (link && !/^https?:/i.test(s)) s = new URLSearchParams(link[1]).get("url") ?? "";
  if (s && !/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
  if (!/^https?:\/\/[^#\s/?]+[^#\s]*$/i.test(s)) return null;
  try { return new URL(s).href; } catch { return null; }
}

// Worth trying as AltStore before APT: a .json file, or a sideloader link.
export const looksLikeAltUrl = (input) => /^(altstore|sidestore|feather):\/\//i.test(str(input)) || /\.json([?#]|$)/i.test(str(input));

// The record the source list keeps: { key, kind: "altstore", uri, name, iconURL, tintColor, count, updated, error,
// identifier }. B273: `identifier` (the JSON's own, null when it has none) tells a source added twice under two URLs.
export function altRecord(url, parsed) {
  return { key: altKey(url), kind: "altstore", uri: url, name: parsed.name || null, iconURL: parsed.iconURL,
    tintColor: parsed.tintColor, count: parsed.apps.length, updated: Date.now(), error: null,
    identifier: parsed.identifier || null };
}

// F16a: an IPA source's JSON (text or parsed) by its record's `format` (none: AltStore, the records from before
// F16a) -> parseAltSource's result with `format` and `extra` (core/sources/ipa.js parseIpaSource), so the rows and
// extras are the same whether the source was just added, refreshed, or loaded into the catalog. Throws.
export function parseSource(format, input) {
  const fmt = format || "altstore";
  let json = input;
  if (typeof input === "string") {
    try { json = JSON.parse(input.replace(/^\uFEFF/, "")); } catch { throw new Error("The source is not valid JSON."); }
  }
  if (fmt === "altstore" && !looksLikeAltSource(json)) throw new Error("This JSON is not an AltStore source (it has no apps list).");
  return parseIpaSource(fmt, json);
}

// An encrypted GBox source (appRepositories is a string): known, but only GBox can read it (detect.js detectJson).
export const GBOX_ENCRYPTED = "This GBox source is encrypted, so only GBox can read it.";
const unreadable = (format, input) => {
  if (format !== "gbox") return null;
  try {
    const json = typeof input === "string" ? JSON.parse(input.replace(/^\uFEFF/, "")) : input;
    return typeof json?.appRepositories === "string" ? GBOX_ENCRYPTED : null;
  } catch { return null; }
};

export async function refreshAltSource(backend, source) {
  try {
    const text = await backend.text(source.uri);
    const reason = unreadable(source.format, text);
    // Still encrypted: nothing to read, and no error either (the page says why and offers Open in).
    if (reason) return { updated: Date.now(), error: null, count: null, unsupported: reason };
    const parsed = parseSource(source.format, text);
    const { key, kind, uri, ...fields } = altRecord(source.uri, parsed);
    if (source.format) fields.format = source.format;
    // A source that was unsupported and now reads (GBox dropped the encryption) loses the mark.
    if (source.unsupported) fields.unsupported = null;
    return fields;
  } catch (e) {
    return { updated: Date.now(), error: e?.message || String(e) };
  }
}

// F16a: Telesphoreo's suite for this phone, as Cydia writes it: ios/<kCFCoreFoundationVersionNumber %.2f>
// (docs/cydia.md, ios/793.00 on the 4S), or null without a number.
export function coreFoundationDist(cf) {
  const n = Number(cf);
  return Number.isFinite(n) && n > 0 ? `ios/${n.toFixed(2)}` : null;
}

// A default source's record before its first refresh: the URL and nothing read from it yet (F28).
export function seedRecord(url) {
  return { key: altKey(url), kind: "altstore", uri: url, name: null, iconURL: null, tintColor: null, count: null,
    updated: null, error: null };
}

// F43: a source nothing has been read from yet (a seedRecord: no refresh, not even a failed one, has saved
// `updated`), so its row would show the bare host and a letter icon.
export const neverLoaded = (source) => Boolean(source) && source.updated == null && !source.error;

// The AltStore source list: its own IndexedDB database, so the APT list, apt's sources.list in the app (F33) and
// its helper never see these. `defaults` (URLs, or a function resolving to them, asked only then: core/sources.js
// loadAppSources on the site) go in once, the first time a store with a "meta" store opens (version 2), so a
// default the user deletes stays deleted.
function openAltStore({ indexedDB: idb = globalThis.indexedDB, name = "ifizbox-altsources", defaults = [] } = {}) {
  if (!idb) return Promise.reject(new Error("IndexedDB is not available"));
  const connect = () => new Promise((resolve, reject) => {
    const req = idb.open(name, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("sources")) db.createObjectStore("sources", { keyPath: "key" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
  return connect().then(async (first) => {
    const db = idbRunner(first, connect, ALT_STORE_FAILED);
    const run = (mode, f) => db.run("sources", mode, f);
    const meta = (mode, f) => db.run("meta", mode, f);
    const store = {
      list: () => run("readonly", (s) => s.getAll()),
      get: (key) => run("readonly", (s) => s.get(key)),
      put: (rec) => run("readwrite", (s) => s.put(rec)).then(() => rec),
      remove: (key) => run("readwrite", (s) => s.delete(key)).then(() => undefined),
    };
    const seed = async () => {
      if (!defaults || (Array.isArray(defaults) && !defaults.length)) return;
      if (await meta("readonly", (s) => s.get("seeded"))) return;
      const urls = (typeof defaults === "function" ? await defaults() : defaults) ?? [];
      if (!urls.length) return;
      for (const url of urls) if (!(await store.get(altKey(url)))) await store.put(seedRecord(url));
      await meta("readwrite", (s) => s.put({ key: "seeded", at: Date.now() }));
    };
    await seed();
    return store;
  });
}

export const ALT_STORE_FAILED = "Could not read or save your sources. Try again.";

// F144: what Add says to an APT repo where APT sources aren't kept (withAltSources aptAllowed false): one short
// alert (screens show `title` and `message`), the source not added.
export const JAILBREAK_SOURCE_TITLE = "Jailbreak Source";
export const JAILBREAK_SOURCE_MESSAGE = `This source lists tweaks for jailbroken iPhones. ${NAME} adds app sources here.`;
export function jailbreakSourceError() {
  const e = new Error(JAILBREAK_SOURCE_MESSAGE);
  e.title = JAILBREAK_SOURCE_TITLE;
  e.code = "jailbreak_source";
  return e;
}

// Wraps a backend's source calls (core/sources.js sourceCalls, or backend-native's) so AltStore sources live
// beside the APT ones: listed together (`sort`: the list's order), added from the same Add Source alert, removed
// and refreshed by key. F16a: Add Source asks core/sources/add.js detectSource what the URL is: an IPA source of
// any format (AltStore, ESign, Scarlet, GBox; an encrypted GBox one saved with `unsupported`) goes in this list
// with its `format`; an APT repo (flat, or dist under dists/<d>/ for each `dists` candidate) goes to the wrapped
// calls, which save it their own way (apt's sources in the app). A dist repo given as { uri, dist, components }
// (F48) goes straight to the wrapped calls.
// opts: { indexedDB, altName, sort, altDefaults: URLs (or () => Promise<URLs>) seeded once (F28), arch: () => string, count,
//         dists: [suite] or () => [suite] (add.js DEFAULT_DISTS when none; give it coreFoundationDist's suite),
//         coreFoundation: () => number, the phone's kCFCoreFoundationVersionNumber (adds its Telesphoreo suite),
//         aptAllowed: bool or () => bool (F144, default true), dropApt: bool (F144) }.
// F144: with aptAllowed false (the sideload build; the website while Settings > Device says Not Jailbroken) APT
// sources don't exist here: Add refuses one with jailbreakSourceError, and sources() and refreshSources() leave the
// wrapped calls' list out. dropApt (the sideload build, whose store no jailbreak build reads) also deletes the APT
// records an older build stored, once, quietly; the website keeps them for when Device says jailbroken again.
export function withAltSources(calls, backend, opts = {}) {
  let opened = null;
  const store = () => (opened ??= openAltStore({ indexedDB: opts.indexedDB, name: opts.altName, defaults: opts.altDefaults }));
  const sort = opts.sort ?? ((l) => l);
  const value = (v) => (typeof v === "function" ? v() : v);
  const aptOk = () => opts.aptAllowed == null || Boolean(value(opts.aptAllowed));
  let dropped = null; // F144: the one sweep of stored APT records (dropApt)
  const dropOld = () => (dropped ??= calls.sources().then(async (list) => {
    // `forget` (backend-native): the device store's record only, no apt files read; else removeSource.
    for (const s of list ?? []) if (!s?.builtin) await (calls.forget ?? calls.removeSource)(s.key).catch(() => {});
  }).catch(() => {}));
  const aptList = async () => {
    if (aptOk()) return calls.sources();
    if (opts.dropApt) dropOld();
    return [];
  };
  async function saveAlt(rec) {
    const db = await store();
    const cur = await db.get(rec.key);
    const next = { ...cur, ...rec };
    if (!rec.unsupported) delete next.unsupported;
    return db.put(next);
  }
  // F304: a GitHub repo (core/github.js detectGithub): its tweaks as a Tweak Source where the wrapped calls keep them
  // (`addGithub`: the sideload app's sourceCalls), else its apps as an app source, else Add says why not.
  async function addGithub(found) {
    if (found.source && typeof calls.addGithub === "function") return calls.addGithub(found.source);
    if (found.app) return saveAlt(found.app);
    const { githubTweaksHereError } = await import("./github.js");
    throw await githubTweaksHereError(found.repo);
  }
  // Loaded when first needed: add.js imports core/sources.js, which imports this file.
  async function detectOpts() {
    const { DEFAULT_DISTS } = await import("./sources/add.js");
    const dists = [...(value(opts.dists) ?? DEFAULT_DISTS)];
    const cf = coreFoundationDist(value(opts.coreFoundation));
    if (cf && !dists.includes(cf)) dists.push(cf);
    const arch = value(opts.arch);
    return { ...(arch ? { arch } : {}), ...(opts.count ? { count: opts.count } : {}), dists };
  }
  // B273: a source saved twice under two spellings (core/sources.js duplicateSources) is merged as the list is read:
  // the one kept stays, the others are removed (each tried once a session, so a removal that fails isn't retried on
  // every read; it is left out of the list all the same).
  const merged = new Set();
  async function mergeDuplicates(list) {
    const { duplicateSources } = await import("./sources.js");
    const drop = new Set(duplicateSources(list));
    if (!drop.size) return list;
    for (const key of drop) {
      if (merged.has(key)) continue;
      merged.add(key);
      try {
        if (isAltKey(key)) await (await store()).remove(key);
        else await calls.removeSource(key);
      } catch { /* left out of the list below anyway */ }
    }
    return list.filter((s) => !drop.has(s?.key));
  }
  async function listAll() {
    const [apt, alt] = await Promise.all([aptList(), store().then((db) => db.list()).catch(() => [])]);
    return mergeDuplicates([...apt, ...alt]);
  }
  // B273: Add Source on a source the list has under any spelling (or, once read, the same app source identifier)
  // saves nothing and hands back the listed record marked `alreadyAdded` (screens say Already Added). opts.replaces:
  // the key an Edit Source is replacing, which doesn't count.
  const already = (rec) => (rec ? { ...rec, alreadyAdded: true } : null);
  async function listedAs(want, opts) {
    const { findSameSource } = await import("./sources.js");
    return already(findSameSource(await listAll(), want, { except: opts?.replaces ?? null }));
  }
  return {
    async sources() {
      return sort(await listAll());
    },
    async addSource(input, opts = {}) {
      if (input && typeof input === "object") {
        if (!aptOk()) throw jailbreakSourceError(); // a dist repo ({ uri, dist, components }) is always APT
        return (await listedAs(input, opts)) ?? calls.addSource(input);
      }
      const typed = normalizeAltUrl(input);
      const before = typed ? await listedAs({ uri: typed }, opts) : null;
      if (before) return before;
      const { detectSource } = await import("./sources/add.js");
      const found = await detectSource(backend, input, await detectOpts());
      for (const read of [found.source, found.app]) {
        const after = read ? await listedAs(read, opts) : null;
        if (after) return after;
      }
      if (found.kind === "github") return addGithub(found);
      if (found.kind === "ipa") return saveAlt(found.source);
      if (!aptOk()) throw jailbreakSourceError();
      const s = found.source;
      // The wrapped calls check it again on their own terms (and the app writes it into apt's sources).
      return calls.addSource(!s.dist || s.dist.endsWith("/") ? s.uri : { uri: s.uri, dist: s.dist, components: s.components });
    },
    async removeSource(key) {
      if (isAltKey(key)) return (await store()).remove(key);
      return calls.removeSource(key);
    },
    // `filter` (F41, core/sources.js sourceFilter): only the sources it keeps are fetched. When it keeps no APT
    // source the wrapped calls aren't asked at all (no proxy fetches, no apt-get update in the app).
    // F233: `onRow`, `signal` and `retry` go on to the wrapped calls; onRow(key, "loading") as each AltStore source starts.
    async refreshSources(onEach = () => {}, { filter, onRow, signal, retry } = {}) {
      const keep = filter ?? (() => true);
      const db = await store().catch(() => null);
      const alt = (db ? await db.list().catch(() => []) : []).filter(keep);
      const aptWanted = aptOk() && (!filter || (await calls.sources().catch(() => [])).some(keep));
      const more = { ...(onRow ? { onRow } : {}), ...(signal ? { signal } : {}), ...(retry ? { retry } : {}) };
      const aptOpts = filter || Object.keys(more).length ? { ...(filter ? { filter } : {}), ...more } : undefined;
      const [apt, alts] = await Promise.all([
        aptWanted ? calls.refreshSources(onEach, aptOpts) : [],
        // F19: in waves, each with a time limit, and the health fields (core/health.js) saved with the result.
        pool(alt, opts.concurrency ?? REFRESH_CONCURRENCY, async (s) => {
          if (signal?.aborted) return null;
          onRow?.(s.key, "loading");
          let fields;
          try {
            fields = await withTimeout(refreshAltSource(backend, s), opts.timeout ?? REFRESH_TIMEOUT);
          } catch (e) {
            fields = { updated: Date.now(), error: e?.message || String(e) };
          }
          const next = await db.put({ ...s, ...fields, ...healthFields(s, fields) });
          onEach(next);
          return next;
        }),
      ]);
      const out = [...(apt ?? []), ...alts.filter(Boolean)];
      if (apt?.failed) out.failed = apt.failed; // B23: the sources apt-get update failed on (backend-native)
      return out;
    },
  };
}
