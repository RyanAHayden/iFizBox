// F288: the "Inject Tweaks" group of a sign options sheet (the sideload app's Custom Install sheet and My IPAs' Sign
// Options; the website's IPA page): the tweaks the user added for this app, a row each (tap: Remove), then an
// "Add Tweak…" row that picks .dylib, .deb or zipped .framework files. iOS 6 grouped table, as the sheet's other
// groups. The files are kept per app (by bundle ID) in this browser's IndexedDB, so the next sign of the same app
// (a re-sign, an update, the website's Install) injects them again; the app's own Re-sign All keeps them in its
// signed record (native/sign/Tweaks.swift).
//
//   const g = tweaksGroup({ bundleId })     g.el (the group), await g.ready (the saved ones drawn), g.items()
//   await g.save()                          keeps the current list for bundleId (Install / Save call it)
//   await g.prepared()                      core/tweaks.js prepareTweaks of the list, or null; throws with words
//   await savedTweaks(bundleId)             [{ name, data }] kept for that app
//   await preparedFor(bundleId)             the kept ones, prepared, or null (the website's Install)
//   await preparedItems(items)              prepared, with the bundled ElleKit when a tweak needs CydiaSubstrate
//   await loadElleKit()                     the bundled ElleKit .deb (vendor/ellekit), SHA-256 checked, kept once loaded
// SPDX-License-Identifier: GPL-3.0-or-later
import { el } from "../nav/ui.js";
import { showAlert } from "../nav/alert.js";
import { showActionSheet } from "../nav/actionsheet.js";
import { nativeBridge, hasNativeCall } from "../native.js";
import { openIpaStore, memoryIpaStore } from "../core/myipas.js";
import { prepareTweaks, tweakProblem, tweakKind, TWEAK_ACCEPT, ELLEKIT, checkElleKit, needsElleKit, withElleKit } from "../core/tweaks.js";
import { inspectTweakDeb, targetsApp, worksInText, TWEAK_LIMIT, UnpackError } from "../core/tweaks.js"; // F302
import { isLibraryStanza, LIBRARY_WHY } from "../core/tweaks.js"; // B185
import { detectMode } from "../core/settings.js"; // F302
import { debOf, tweakTitle, withTweaksText, tweakSteps, madeFor, tweakUpdates, ipaEncrypted, ENCRYPTED_ALERT, HOW_TO_GET_ONE,
  HOW_TO_TEXT, tweakParams } from "../core/tweaks.js"; // F302a
import { BUNDLE_ID } from "../brand.js"; // F302a
import { indexSource, entryInfo, guessEntry, liteTweaks, worksInLine, dropsFromCatalog } from "../core/tweakindex.js"; // F344
import { createIndexFile, answerFromFile, FILE_PATH, FILE_URL, FILE_NAME } from "../core/tweakindexfile.js"; // F398
import { tweakIndexRefreshOn } from "../core/settings.js"; // F398
import { appNameOf } from "../core/tweaks.js"; // F344
import { loadStyle } from "../nav/motion.js";
import { filterRows } from "../core/changes.js"; // F352: Add Tweaks' search
import { tweakListRow } from "./tweakrow.js"; // B267
import { isCommercial, paymentEndpointUrl, parseEndpoint, createPaymentClient, createCredentialStore, isFreePrice,
  paidTweakDeb, PaidNeeded } from "../core/payment.js"; // F308

const DB = "ifizbox-tweaks";
let storeP = null;
export function tweakStore() {
  storeP ??= openIpaStore({ name: DB }).catch(() => memoryIpaStore()); // no IndexedDB: kept until the page closes
  return storeP;
}

const asItems = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x.name === "string" && x.data) : []);

export async function savedTweaks(bundleId, { store = tweakStore } = {}) {
  if (!bundleId) return [];
  try { return asItems(await (await store()).get(bundleId)); } catch { return []; }
}

export async function saveTweaks(bundleId, items, { store = tweakStore } = {}) {
  if (!bundleId) return;
  const s = await store();
  if (items.length) await s.put(bundleId, items.map((x) => ({ name: x.name, data: new Uint8Array(x.data), ...(x.title ? { title: String(x.title) } : {}) })));
  else await s.remove(bundleId);
  keptNames.delete(bundleId); // B391: tweaksKnown reads it again
}

// Prepared, or null for none; a problem (CydiaSubstrate missing, a bad file) throws an Error with words.
// `ellekit`: the checked bundled .deb (loadElleKit), or null to refuse a missing CydiaSubstrate.
export function prepareItems(items, ellekit = null) {
  if (!items.length) return null;
  const p = ellekit ? withElleKit(items, ellekit) : prepareTweaks(items);
  const why = tweakProblem(p);
  if (why) throw new Error(why);
  return p;
}

// The bundled ElleKit, fetched next to the page (the site and the app both carry web/app/vendor) and checked against
// its pinned SHA-256; a failed load is tried again next time.
let elleKitP = null;
export function loadElleKit({ fetch: get = globalThis.fetch } = {}) {
  elleKitP ??= (async () => {
    let data;
    try {
      const r = await get(new URL(`../${ELLEKIT.file}`, import.meta.url).href);
      if (!r.ok) throw new Error(String(r.status));
      data = new Uint8Array(await r.arrayBuffer());
    } catch {
      throw new Error(`The bundled ${ELLEKIT.name} couldn't be loaded. Add ElleKit's .deb to the tweaks yourself.`);
    }
    return checkElleKit(data);
  })();
  elleKitP.catch(() => { elleKitP = null; });
  return elleKitP;
}

// Prepared, or null for none; when a tweak needs CydiaSubstrate and nobody added it, the bundled ElleKit goes in.
export async function preparedItems(items, { ellekit = loadElleKit } = {}) {
  if (!items.length) return null;
  const p = prepareTweaks(items);
  if (!needsElleKit(p)) return p;
  return prepareItems(items, await ellekit());
}

export async function preparedFor(bundleId, opts) { return preparedItems(await savedTweaks(bundleId, opts), opts); }

const sizeText = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);
// F317: one or two short sentences (AGENTS.md, Hints); the ElleKit note shows only once a tweak needs it.
export const FOOTER = "A .dylib, .deb or zipped .framework tweak loads with the app. Kept for this app when it's signed again.";
export const WITH_ELLEKIT = `${ELLEKIT.name} ${ELLEKIT.version} goes in too, for CydiaSubstrate. `
  + "Add ElleKit's .deb to use another version.";

function style() { loadStyle("tweaks.css"); }

// `sources` (F302): whether "Add Tweak from a Source…" shows (a bool or () => bool); the sideload app by default.
export function tweaksGroup({ bundleId = "", store = tweakStore, alert = showAlert, sheet = showActionSheet, onChange = () => {},
  sources = () => detectMode() === "sideload" } = {}) {
  style();
  let items = [];
  const g = el("div", "group ss-tweaks");
  g.append(el("h2", "group-header", "Inject Tweaks"));
  const ul = el("ul", "table grouped");
  const foot = el("p", "group-footer", FOOTER);
  g.append(ul, foot);

  const input = Object.assign(el("input", "visually-hidden"), { type: "file", accept: TWEAK_ACCEPT, multiple: true });
  input.id = "tw" + Math.random().toString(36).slice(2);
  input.addEventListener("change", async () => {
    const picked = [...(input.files ?? [])];
    input.value = "";
    if (!picked.length) return;
    const next = [...items];
    for (const f of picked) {
      const data = new Uint8Array(await f.arrayBuffer());
      const one = { name: f.name, data };
      try { prepareTweaks([one]); } catch (e) {
        // CydiaSubstrate missing is fine here (ElleKit may come next); a file that can't be read is not
        if (!/CydiaSubstrate/.test(String(e?.message))) {
          await alert({ title: "Can't Add This Tweak", message: String(e?.message ?? e), buttons: ["OK"] });
          continue;
        }
      }
      const at = next.findIndex((x) => x.name === f.name);
      if (at >= 0) next[at] = one; else next.push(one);
    }
    items = next;
    draw();
    onChange(items);
  });

  function draw() {
    ul.replaceChildren();
    for (const it of items) {
      const li = el("li", "cell");
      const b = el("button", "cell-inner ss-tweak");
      b.type = "button";
      const t = el("span", "cell-text");
      t.append(el("span", "cell-label", it.name), el("span", "cell-subtitle", `${tweakKind(it.name)} · ${sizeText(it.data.length ?? it.data.byteLength ?? 0)}`));
      b.append(t);
      b.addEventListener("click", async () => {
        const i = await sheet({ title: it.name, buttons: ["Remove"], destructive: 0 });
        if (i !== 0) return;
        items = items.filter((x) => x !== it);
        draw();
        onChange(items);
      });
      li.append(b);
      ul.append(li);
    }
    const li = el("li", "cell");
    const add = Object.assign(el("label", "cell-inner ss-tweak-add"), { htmlFor: input.id });
    const word = items.length ? "Add Another Tweak" : "Add Tweak";
    // F302: in the sideload app a tweak also comes from a Tweak Source, beside Files
    const fromSources = typeof sources === "function" ? sources() : Boolean(sources);
    add.append(el("span", "cell-label", fromSources ? `${word} from Files…` : `${word}…`));
    li.append(add, input);
    ul.append(li);
    if (fromSources) {
      const sli = el("li", "cell");
      const sb = el("button", "cell-inner ss-tweak-add ss-tweak-source");
      sb.type = "button";
      sb.append(el("span", "cell-label", `${word} from a Source…`));
      sb.addEventListener("click", () => pickSourceTweak({ bundleId, alert, onPick: (one) => {
        const at = items.findIndex((x) => x.name === one.name);
        items = at >= 0 ? items.map((x, j) => (j === at ? one : x)) : [...items, one];
        draw();
        onChange(items);
      } }));
      sli.append(sb);
      ul.append(sli);
    }
    let why = null, bundles = false;
    try { bundles = Boolean(items.length) && needsElleKit(prepareTweaks(items)); } catch (e) { why = String(e?.message ?? e); }
    foot.textContent = why ? `${why}` : bundles ? WITH_ELLEKIT : FOOTER;
    foot.classList.toggle("ss-tweak-problem", Boolean(why));
  }
  draw();

  const ready = savedTweaks(bundleId, { store }).then((saved) => { if (!items.length && saved.length) { items = saved; draw(); } }, () => {});
  return {
    el: g,
    ready,
    items: () => [...items],
    save: () => saveTweaks(bundleId, items, { store }).catch(() => {}),
    prepared: async () => preparedItems(items),
  };
}

// ---- F302: tweaks from APT sources (the sideload build's Tweak Sources) -------------------------------------------
//
//   await tweakInfo(stanza, { fetchDeb })   core/tweaks.js inspectTweakDeb of the package's .deb, cached per package and
//                                           version on this device (INFO_KEY); the .deb itself is kept for the session
//   cachedTweakInfo(stanza)                 the cached check, or null when the .deb wasn't read yet
//   catalogVerdicts()  onTweakVerdicts(f)   B377: { "id@version": true|false } for every checked tweak: true when it
//                                           can't go into an app (core/tweakindex.js dropsFromCatalog); and f(map) for
//                                           each new batch (the index's verdicts, a check on this device; null: a
//                                           verdict taken back): catalog.js setTweakVerdicts
//   await tweaksKnown()                     B391: { apps, held, worked }: core/catalog.js setTweakKnown
//   await tweakDeb(stanza, { fetchDeb })    the .deb's bytes (the session's copy, else fetched)
//   await addDebTo(bundleId, stanza, data)  puts the .deb in that app's kept tweaks (the next sign injects it)
//   await signableApps()                    [{ bundleId, name, from }] My IPAs and the apps signed here
//   await addToApp(stanza, { … })           the package page's Add to App…: checks the .deb (HUD), then an action sheet
//                                           of the apps its filter names; the rest listed as not targeted. The picked
//                                           app is queued as a re-sign with it (B342), or keeps it when not signed here
//   await signedRecordFor(bundleId)         the signing.installed record Add to App re-signs from, or null
//   worksInGroup(stanza)                    the package page's group: "Works In" and Add to App…, filled once checked

export const INFO_KEY = "ifizbox.tweakInfo";
const INFO_MAX = 400;
const INFO_V = 2; // B185: libraries and plain reasons
const debKey = (st) => `${st?.package ?? ""}@${st?.version ?? ""}`;
// F304: a GitHub release's tweak may be a bare .dylib (core/github.js X-GitHub-Asset): kept and injected as it is.
export const isDylibTweak = (st) => String(st?.["x-github-asset"] ?? "").trim().toLowerCase() === "dylib";
const debName = (st) => `${st.package}_${st.version ?? "0"}.${isDylibTweak(st) ? "dylib" : "deb"}`;
const debs = new Map(); // debKey -> Uint8Array, this session only (a few at most)
const indexed = new Map(); // F344: debKey -> the Tweak Index's verdict (entryInfo) among the sources loaded so far

function infoStore(storage = globalThis.localStorage) {
  let map = {};
  try { map = JSON.parse(storage?.getItem(INFO_KEY) ?? "{}") ?? {}; } catch { map = {}; }
  return {
    // B185: a refusal kept by an older build (no INFO_V) is checked again: its reason may be the old jargon
    get: (k) => (map && typeof map[k] === "object" && map[k] && (map[k].ok || map[k].v === INFO_V) ? map[k] : null),
    keys: () => Object.keys(map ?? {}), // B377
    set(k, v) {
      map[k] = v;
      const keys = Object.keys(map);
      for (const old of keys.slice(0, Math.max(0, keys.length - INFO_MAX))) delete map[old];
      try { storage?.setItem(INFO_KEY, JSON.stringify(map)); } catch { /* private mode: kept for this page only */ }
    },
  };
}

// F344: the device's own check first, then the shared index's verdict (loadTweakIndex) for the same package and version.
export function cachedTweakInfo(st, { storage } = {}) {
  if (!st?.package) return null;
  const k = debKey(st);
  return infoStore(storage).get(k) ?? indexed.get(k) ?? null;
}

// B377: the catalog's side of the verdicts (core/catalog.js setTweakVerdicts): what this device and the index know.
const verdictListeners = new Set();
export function onTweakVerdicts(f) { verdictListeners.add(f); return () => verdictListeners.delete(f); }
function verdictsFor(keys, storage) {
  const dev = infoStore(storage);
  const out = {};
  // a check on this device that says the tweak works (after the index refused it) brings it back: false
  for (const k of keys) { const info = dev.get(k) ?? indexed.get(k); if (info && !info.unverified) out[k] = dropsFromCatalog(info); }
  return out;
}
export function catalogVerdicts({ storage } = {}) {
  return verdictsFor(new Set([...indexed.keys(), ...infoStore(storage).keys()]), storage);
}
function tellVerdicts(keys, storage) {
  if (!verdictListeners.size) return;
  // F398: a verdict a newer index file no longer has is taken back (null)
  const map = { ...Object.fromEntries([...keys].map((k) => [k, null])), ...verdictsFor(keys, storage) };
  if (!Object.keys(map).length) return;
  for (const f of [...verdictListeners]) { try { f(map); } catch { /* one listener's error stops no other */ } }
}

// B391: what the user has, for the catalog's lists: their apps' names (a tweak with no verdict that mentions one is
// listed), the tweaks already in an app (kept ones and those the shell signed in), and the ones this phone checked and
// found to work (a newer version with no verdict yet stays listed).
const tweakPackage = (file) => /^(.+?)_[^_]+\.(?:deb|dylib)$/i.exec(String(file ?? ""))?.[1] ?? null;
const keptNames = new Map(); // bundle ID -> its kept tweaks' file names, read once and kept current by saveTweaks
export async function tweaksKnown({ apps = signableApps, records = signedRecords, store = tweakStore, storage } = {}) {
  const [list, recs] = await Promise.all([apps(), Promise.resolve().then(records).catch(() => [])]);
  const signed = (Array.isArray(recs) ? recs : []).filter((r) => r?.bundleId);
  const held = new Set();
  const hold = (file) => { const id = tweakPackage(file); if (id) held.add(id); };
  for (const r of signed) for (const name of Array.isArray(r.tweaks) ? r.tweaks : []) hold(name);
  const ids = new Set([...list.map((a) => a.bundleId), ...signed.flatMap((r) => [r.bundleId, r.originalBundleId])].filter(Boolean));
  for (const id of ids) {
    if (!keptNames.has(id)) keptNames.set(id, (await savedTweaks(id, { store })).map((x) => x.name));
    keptNames.get(id).forEach(hold);
  }
  const dev = infoStore(storage);
  const worked = dev.keys().filter((k) => { const i = dev.get(k); return i?.ok && !i.unverified && !dropsFromCatalog(i); })
    .map((k) => k.slice(0, k.lastIndexOf("@")));
  return { apps: Object.fromEntries(list.map((a) => [a.bundleId, a.name])), held: [...held].sort(), worked: [...new Set(worked)].sort() };
}

async function defaultFetchDeb(url) {
  const { getBackend } = await import("../backend.js");
  const r = await getBackend().fetch(url);
  if (!r.ok) throw new Error(`The source answered HTTP ${r.status}.`);
  return new Uint8Array(await r.arrayBuffer());
}

export async function tweakDeb(st, { fetchDeb = defaultFetchDeb, paid = null } = {}) {
  const k = debKey(st);
  if (debs.has(k)) return debs.get(k);
  let data;
  if (isCommercial(st)) { // F308: the vendor hands it to this account (PaidNeeded: Sign In or Buy first)
    try { data = await (paid ?? paidTweaks()).deb(st); } catch (e) {
      if (e instanceof PaidNeeded || e?.name === "PaymentError") throw e;
      throw new Error(`The .deb couldn't be downloaded. ${e?.message ?? ""}`.trim());
    }
  } else {
    if (!st?.debUrl) throw new Error("This package has no .deb to download.");
    try { data = await fetchDeb(st.debUrl); } catch (e) { throw new Error(`The .deb couldn't be downloaded. ${e?.message ?? ""}`.trim()); }
  }
  if (data.length > TWEAK_LIMIT) throw new Error("This tweak is too big to go into an app (64 MB at most).");
  debs.set(k, data);
  for (const old of [...debs.keys()].slice(0, Math.max(0, debs.size - 4))) debs.delete(old);
  return data;
}

// ---- F308: paid tweaks (cydia::commercial) ---------------------------------------------------------------------------
//
// The same Sileo Payment Provider calls as the jailbreak build's Purchase group (screens/extras.js), through the
// shell: sign in (auth.session), Buy, authorize_download with udid/device/version/repo/architecture, then
// paid.download fetches the one-time URL and keeps the .deb in the app's own storage per package and version
// (Paid.swift PaidTweaks; paid.cached reads it back for re-signing and updates). The account is the one the package
// page's Purchase group signs in to (the same credential store).
//
//   createPaidTweaks({ call, vendorFor, storage })  -> { deb(st), seller(st), signIn(st), buy(st) }
//   paidTweaks()                                     the app's one (the shell's bridge)
//   await offerPaid(st, e, { paid, sheet, alert })   a PaidNeeded's action sheet: Sign In to <seller> or Buy for <price>;
//                                                    true once it's done (try the add again)

const bridge = () => (hasNativeCall() ? nativeBridge() : null);
async function bridgeCall(method, params) {
  const n = bridge();
  if (!n) throw new Error("A paid tweak downloads in the app, signed in to its seller.");
  return n.call(method, params);
}

function b64Bytes(b64) {
  const bin = atob(b64 || "");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const endpoints = new Map(); // source key -> Promise<vendor base | null>
function endpointOf(source, text, cache = endpoints) {
  const url = paymentEndpointUrl(source);
  if (!url) return Promise.resolve(null);
  if (!cache.has(source.key)) {
    // B268: a fetch that failed (offline, a timeout) is asked again next time, not kept as "no seller" for the session;
    // a source that answered it has none (not_found, upstream: BigBoss's 404) is kept
    const answered = (e) => e?.code === "not_found" || e?.code === "upstream";
    cache.set(source.key, Promise.resolve().then(() => text(url)).then(parseEndpoint, (e) => { if (!answered(e)) cache.delete(source.key); return null; }));
  }
  return cache.get(source.key);
}

// The source that carries this version and sells it: { base, source } or null. B268: All Sources ("*") leaves the
// sideload build's Tweak Sources out, so a tweak it doesn't list is looked up in each APT source the app has (the one
// its stanza came from among them) before the answer is "no seller". `catalog`: { package(id, key) }, `sources`: the
// backend's list, `text(url)`: the payment_endpoint file's text.
export async function findSeller(st, { catalog, sources, text, cache = endpoints }) {
  const hasVersion = (p) => p && (!st.version || p.stanza?.version === st.version || (p.others ?? []).some((o) => o.version === st.version));
  const tried = new Set();
  const sellerIn = async (keys) => {
    for (const key of keys) {
      if (!key || tried.has(key)) continue;
      tried.add(key);
      const source = sources.find((s) => s.key === key);
      const base = source ? await endpointOf(source, text, cache) : null;
      if (base) return { base, source };
    }
    return null;
  };
  const p = await catalog.package(st.package, "*").catch(() => null);
  const listed = [...(!st.version || p?.stanza?.version === st.version ? [p?.key] : []),
    ...(p?.others ?? []).filter((o) => !st.version || o.version === st.version).map((o) => o.key)];
  const found = await sellerIn(listed);
  if (found) return found;
  for (const s of sources) {
    if (!s?.key || tried.has(s.key) || String(s.key).startsWith("alt:")) continue;
    if (!hasVersion(await catalog.package(st.package, s.key).catch(() => null))) continue;
    const got = await sellerIn([s.key]);
    if (got) return got;
  }
  return null;
}

async function catalogVendorFor(st) {
  const [{ catalog }, { getBackend }] = await Promise.all([import("../catalog.js"), import("../backend.js")]);
  const backend = getBackend();
  return findSeller(st, { catalog, sources: await backend.sources(), text: (u) => backend.text(u) });
}

export function createPaidTweaks({ call = bridgeCall, vendorFor = catalogVendorFor, storage } = {}) {
  const clients = new Map();
  const keychain = {
    get: (key) => call("keychain.get", { key }),
    set: (key, value) => call("keychain.set", { key, value }),
    remove: (key) => call("keychain.remove", { key }),
  };
  const request = async ({ method, url, headers, body }) => {
    const r = await call("net.request", { method, url, headers, body });
    let json = null;
    try { json = JSON.parse(new TextDecoder().decode(b64Bytes(r.body))); } catch { json = null; }
    return { status: r.status, json };
  };
  const clientFor = (base) => {
    if (!clients.has(base)) {
      clients.set(base, createPaymentClient({ base, request, device: () => call("device.info"),
        credentials: createCredentialStore({ ...(storage ? { storage } : {}), secure: keychain }) }));
    }
    return clients.get(base);
  };
  async function vendor(st) {
    const v = await vendorFor(st);
    if (!v?.base) throw new Error("This paid tweak's source names no seller to buy it from.");
    return { ...v, client: clientFor(v.base) };
  }
  const which = (st) => ({ package: st.package, version: st.version ?? "" });
  return {
    async deb(st) {
      const { client, source } = await vendor(st);
      return paidTweakDeb(st, { client, repo: source?.uri ?? "", architecture: "iphoneos-arm64",
        cached: async (s) => { const r = await call("paid.cached", which(s)); return r?.body ? b64Bytes(r.body) : null; },
        download: async (url, s) => b64Bytes((await call("paid.download", { url, ...which(s) }))?.body) });
    },
    // { name } of the vendor (its /info), or null
    async seller(st) {
      const { client, base } = await vendor(st);
      const info = await client.info().catch(() => null);
      return { name: info?.name || new URL(base).hostname.replace(/^www\./, "") };
    },
    // auth.session answers null when the user closed the sheet: false, nothing to try again
    async signIn(st) {
      const { client } = await vendor(st);
      const cb = await call("auth.session", { url: await client.authenticateUrl(), callbackScheme: "sileo" });
      if (cb == null) return false;
      if (!(await client.finishSignIn(cb))) throw new Error("The seller sent nothing back that could be read.");
      return true;
    },
    async buy(st) {
      const { client } = await vendor(st);
      const r = await client.purchase(st.package);
      if (r.status === "action") return (await call("auth.session", { url: r.url, callbackScheme: "sileo" })) != null;
      if (r.status !== "done") throw new Error("The purchase did not go through.");
      return true;
    },
  };
}

let appPaid = null;
export const paidTweaks = () => (appPaid ??= createPaidTweaks());

export const buyLabel = (price) => `Buy${price ? ` for ${isFreePrice(price) ? "Free" : price}` : ""}`;

export async function offerPaid(st, e, { paid = null, sheet = showActionSheet, alert = showAlert } = {}) {
  const p = paid ?? paidTweaks();
  const name = st.name || st.package;
  const who = (await p.seller(st).catch(() => null))?.name || "its seller";
  if (e.need === "unavailable") {
    await alert({ title: name, message: `${who} doesn't sell ${name} right now.`, buttons: ["OK"] });
    return false;
  }
  const signIn = e.need === "signin";
  const price = e.price && !isFreePrice(e.price) ? ` for ${e.price}` : "";
  const title = signIn ? `${name} is sold by ${who}${price}. Sign in to buy it, or to download it if you have.`
    : `${name} is sold by ${who}. Buy it to add it to your apps.`;
  const i = await sheet({ title, buttons: [signIn ? `Sign In to ${who}` : buyLabel(e.price)] });
  if (i !== 0) return false;
  try { return await (signIn ? p.signIn(st) : p.buy(st)); } catch (err) {
    await alert({ title: "Purchase", message: String(err?.message ?? err), buttons: ["OK"] });
    return false;
  }
}

export async function tweakInfo(st, { fetchDeb = defaultFetchDeb, storage, paid = null } = {}) {
  const store = infoStore(storage);
  const hit = store.get(debKey(st));
  if (hit) return hit;
  // F344: the shared index already read this .deb and refused it: no download. A paid tweak's guess is never a verdict.
  const known = indexed.get(debKey(st));
  if (known && !known.ok && !known.unverified) return known;
  let info;
  // F304: a bare .dylib has no filter .plist to say which app it is for: it loads into whichever app it is put in.
  if (isDylibTweak(st)) info = { ok: true, why: null, bundles: [], anyApp: true };
  else if (isLibraryStanza(st)) info = { ok: false, why: LIBRARY_WHY, bundles: [], anyApp: false, library: true }; // B185: no download
  else try { info = inspectTweakDeb(await tweakDeb(st, { fetchDeb, paid })); } catch (e) {
    if (e instanceof UnpackError) info = { ok: false, why: String(e.message), bundles: [], anyApp: false };
    else throw e; // a failed download is asked again next time
  }
  const kept = { v: INFO_V, ok: info.ok, why: info.why ?? null, bundles: info.bundles ?? [], anyApp: Boolean(info.anyApp),
    ...(info.library ? { library: true } : {}), ...(info.systemOnly ? { systemOnly: true } : {}) };
  // F344: read again after the download: checks running side by side would otherwise
  // each write back the cache as it was when they started, and drop each other's verdicts
  infoStore(storage).set(debKey(st), kept);
  tellVerdicts([debKey(st)], storage); // B377
  return kept;
}

export async function addDebTo(bundleId, st, data, { store = tweakStore } = {}) {
  const name = debName(st);
  const prefix = `${st.package}_`;
  const items = (await savedTweaks(bundleId, { store })).filter((x) => !x.name.startsWith(prefix)); // another version goes
  items.push({ name, data, ...(st.name ? { title: st.name } : {}) }); // F302a: its name for people
  await saveTweaks(bundleId, items, { store });
  return items;
}

export async function signableApps({ library = null, records = null } = {}) {
  const out = new Map();
  try {
    const list = library ? await library() : (await (await import("../signing/library.js")).libraryCall("list"))?.ipas ?? [];
    for (const e of list) if (e?.bundleId && !out.has(e.bundleId)) out.set(e.bundleId, { bundleId: e.bundleId, name: e.options?.name || e.name || e.bundleId, from: "My IPAs" });
  } catch { /* no library (the website): the signed apps only */ }
  try {
    const recs = records ? await records() : await (await (await import("../core/installed.js")).apps()).all();
    for (const r of recs ?? []) if (r?.id && !r.self && !out.has(r.id)) out.set(r.id, { bundleId: r.id, name: r.name || r.id, from: "Signed" });
  } catch { /* none remembered */ }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const knownNames = (apps) => Object.fromEntries(apps.map((a) => [a.bundleId, a.name]));

// Which of `apps` take the tweak: { made: [app], not: [app] }.
export function splitApps(info, apps) {
  const made = [], not = [];
  for (const a of apps) (targetsApp(info, a.bundleId) ? made : not).push(a);
  return { made, not };
}

export async function addToApp(st, opts = {}) {
  const { alert = showAlert, pick = pickApp, hud = null, apps = signableApps, fetchDeb, storage, store = tweakStore, paid = null,
    sheet = showActionSheet, records = signedRecords, job = null, queue = null } = opts;
  const name = st.name || st.package;
  const hide = hud ? hud("Checking Tweak") : (await import("../nav/hud.js")).showHUD("Checking Tweak");
  let info, list, data;
  try {
    [info, list] = await Promise.all([tweakInfo(st, { fetchDeb, storage, paid }), apps()]);
    if (info.ok) data = await tweakDeb(st, { fetchDeb, paid });
  } catch (e) {
    hide();
    // F308: a paid tweak not bought (or signed out): Sign In or Buy, then the same add again
    if (e instanceof PaidNeeded) return (await offerPaid(st, e, { paid, sheet, alert })) ? addToApp(st, opts) : null;
    await alert({ title: "Can't Add This Tweak", message: String(e?.message ?? e), buttons: ["OK"] });
    return null;
  }
  hide();
  if (!info.ok) {
    await alert({ title: info.library ? "Not a Tweak for Apps" : "Can't Take This Tweak", message: info.why || "It can't go into an app.", buttons: ["OK"] });
    return null;
  }
  // F302a: an App Store copy (still encrypted) can't take tweaks: listed greyed under Can't Take Tweaks
  const split = splitApps(info, list);
  const locked = split.made.filter((a) => isEncrypted(a.bundleId, { storage }));
  const made = split.made.filter((a) => !locked.includes(a));
  const not = split.not;
  const works = worksInText(info, knownNames(list));
  if (!made.length && !locked.length) {
    await alert({ title: "No App for This Tweak", message: `${name} works in ${works ?? "apps you don't have"}. `
      + "Add that app's IPA to Install IPAs (or sign it here) first.", buttons: ["OK"] });
    return null;
  }
  const app = await pick({ name, made, locked, not, works });
  if (!app || !made.includes(app)) return null;
  // B342: the app is re-signed from its record with the tweak in, through the queue (as Installed's Re-sign): its kept
  // tweaks (under the ID it was signed from, as keptTweakParams reads them) now differ from the record's, so they go
  const rec = await signedRecordFor(app.bundleId, records);
  await addDebTo(rec?.originalBundleId || app.bundleId, st, data, { store });
  const j = rec ? await (job ?? (async (r) => (await import("../core/appqueue.js")).resignJob(r)))(rec) : null;
  if (j) {
    await (queue ?? (async (x) => (await import("./queue.js")).queueApp(x)))(j);
    return app;
  }
  await alert({ title: "Tweak Added", message: `${app.name} wasn't signed on this phone, so it can't be re-signed with ${name} now. `
    + `${name} is kept in its Sign Options under Inject Tweaks${needsHookLib(st) ? `, with ${ELLEKIT.name}` : ""}, and goes in when you sign it.`,
  buttons: ["OK"] });
  return app;
}

// B342: the signing.installed record Add to App re-signs from, by the app's bundle ID or the one it was signed from
// (kept tweaks are under that one); null when this phone didn't sign it (or isn't the sideload app).
export async function signedRecordFor(bundleId, records = signedRecords) {
  if (!bundleId) return null;
  const list = await Promise.resolve().then(records).catch(() => []);
  const recs = (Array.isArray(list) ? list : []).filter((r) => r?.bundleId);
  // the picked app's own record first: a copy signed from it shares its originalBundleId
  return recs.find((r) => r.bundleId === bundleId) ?? recs.find((r) => r.originalBundleId === bundleId) ?? null;
}
const signedRecords = async () => (hasNativeCall() ? (await nativeBridge()?.call?.("signing.installed", {}))?.apps ?? [] : []);

const needsHookLib = (st) => /(mobilesubstrate|cydia-substrate|ellekit)/i.test(`${st?.depends ?? ""} ${st?.["pre-depends"] ?? ""}`);

// The package page's group (the sideload build, an injectable tweak): a spinner row while the .deb is read on first
// open, then "Works In: <apps>" and Add to App…, or why it can't go into an app.
// F308: a paid tweak not bought yet (or signed out) gets Price and Sign In to <seller> / Buy for <price> instead, and
// is checked again once that's done.
// B296: `onCheck(info | null)` hears every check's result, the one after Sign In / Buy too (null: not finished).
export function worksInGroup(st, { paid = null, onAdd = () => addToApp(st, { paid }), apps = signableApps, fetchDeb, storage,
  onCheck = () => {} } = {}) {
  style();
  const g = el("div", "group tweak-works");
  g.append(el("h2", "group-header", "Add to an App"));
  const ul = el("ul", "table grouped");
  const foot = el("p", "group-footer", "Tweaks from a source go into an app you sign here, with ElleKit when they need it.");
  g.append(ul, foot);
  const spin = el("li", "cell tweak-checking");
  const inner = el("div", "cell-inner");
  inner.append(el("span", "loading-spinner"), el("span", "cell-label", "Checking the Tweak…"));
  spin.append(inner);
  ul.append(spin);
  const row = (label, detail, onClick) => {
    const li = el("li", "cell");
    const b = el(onClick ? "button" : "div", "cell-inner");
    if (onClick) { b.type = "button"; b.classList.add("chevron"); b.addEventListener("click", onClick); }
    const t = el("span", "cell-text");
    t.append(el("span", "cell-label", label));
    b.append(t);
    if (detail != null) b.append(el("span", "cell-detail", detail));
    li.append(b);
    return li;
  };
  const paidRows = async (e) => {
    const p = paid ?? paidTweaks();
    const who = (await p.seller(st).catch(() => null))?.name || "its seller";
    const price = e.price ? (isFreePrice(e.price) ? "Free" : e.price) : "Paid";
    const act = async (job) => {
      let done = false;
      try { done = await job(); } catch (err) { foot.textContent = String(err?.message ?? err); return; }
      if (done) { ul.replaceChildren(spin); foot.textContent = ""; await checked(); }
    };
    if (e.need === "unavailable") {
      ul.replaceChildren(row("Price", price));
      foot.textContent = `${who} doesn't sell it right now.`;
    } else if (e.need === "signin") {
      ul.replaceChildren(row("Price", price), row(`Sign In to ${who}`, null, () => act(() => p.signIn(st))));
      foot.textContent = `Sold by ${who}. Sign in to buy it, or to add it if you already have.`;
    } else {
      ul.replaceChildren(row("Price", price), row(buyLabel(e.price), null, () => act(() => p.buy(st))));
      foot.textContent = `Sold by ${who}. Once bought, it goes into an app you sign here.`;
    }
    return null;
  };
  const check = () => Promise.all([tweakInfo(st, { fetchDeb, storage, paid }), apps().catch(() => [])]).then(([info, list]) => {
    if (!info.ok) {
      ul.replaceChildren(row(info.library ? "A Library for Other Tweaks" : "Can't Go into an App"));
      foot.textContent = info.why || "";
      foot.classList.add("ss-tweak-problem");
      return info;
    }
    const works = worksInText(info, knownNames(list)) ?? "—";
    const { made } = splitApps(info, list);
    ul.replaceChildren(row("Works In", works), row("Add to App…", made.length ? String(made.length) : null, () => onAdd()));
    foot.textContent = made.length ? `Made for ${made.map((a) => a.name).join(", ")}.` : "None of your apps is one it's made for yet.";
    return info;
  }, (e) => {
    if (e instanceof PaidNeeded) return paidRows(e);
    ul.replaceChildren(row("Add to App…", null, () => onAdd()));
    foot.textContent = String(e?.message ?? e);
    return null;
  });
  const checked = () => check().then((info) => { try { onCheck(info); } catch { /* the group still stands */ } return info; });
  const ready = checked();
  return { el: g, ready, check: checked };
}

// "From a Source…" in Inject Tweaks: the Tweak Sources' tweaks in a sheet, those whose checked filter names this app
// first ("Made for This App"), then the rest; a tap checks the .deb and adds it. `list()` -> [stanza-ish rows with
// package, name, version, debUrl, section] (the catalog's, by default).
export async function sourceTweakRows({ catalogMod = null } = {}) {
  const [{ catalog }, { getBackend }, { tweakSourcesFor }, { settings }, { detectMode }] = await Promise.all([
    catalogMod ? Promise.resolve(catalogMod) : import("../catalog.js"), import("../backend.js"), import("../core/sources.js"),
    import("./settings.js"), import("../core/settings.js")]);
  await catalog.ensure();
  const keys = tweakSourcesFor(await getBackend().sources(), settings.deviceType(), detectMode()).map((s) => s.key);
  const byId = new Map();
  for (const k of keys) for (const r of await catalog.list(k).catch(() => [])) if (!byId.has(r.id)) byId.set(r.id, { ...r, key: k });
  return [...byId.values()];
}

export function pickSourceTweak({ bundleId, onPick, rows = sourceTweakRows, pkg = async (r) => (await (await import("../catalog.js")).catalog.package(r.id, r.key))?.stanza,
  alert = showAlert, storage, paid = null, lister = (o) => appTweakRows(bundleId, o) } = {}) {
  // B267: its own scroller under the fixed bar (sheet-scroll page-body, as Add Tweaks), Cydia's list rows (tweakrow.js)
  const body = el("div", "sheet-scroll page-body grouped tweak-pick tw-browse");
  const loading = el("div", "loading");
  loading.append(el("span", "loading-spinner"), el("span", null, "Loading Tweaks"));
  body.append(loading);
  let close = () => {};
  import("../nav/sheet.js").then(({ showSheet }) => {
    close = showSheet({ title: "Tweak Sources", body });
  });
  // F344: for an app, only the tweaks that work in it (its own, then every-app ones), from the shared index and the
  // phone's checks, and (B391) those with no verdict that mention it. With no app, all the sources list.
  const listed = bundleId ? lister({ rows, storage }) : rows().then((list) => ({ rows: list }));
  listed.then((l) => {
    draw(l.rows, bundleId ? liteTweaks(l.rows, bundleId, l.infoOf) : null, l.infoOf);
  }, (e) => { body.replaceChildren(el("p", "group-footer", String(e?.message ?? e))); });
  function draw(list, lite, infoOf) {
    const made = [], rest = [];
    if (lite) { made.push(...lite.made); rest.push(...lite.any); }
    else for (const r of list) {
      const info = cachedTweakInfo({ package: r.id, version: r.version }, { storage });
      if (info && !info.ok) continue;
      (info && targetsApp(info, bundleId) ? made : rest).push(r);
    }
    const ul = (items) => {
      const u = el("ul", "table grouped");
      for (const r of items) {
        const li = tweakListRow(r, { onClick: () => pick() });
        if (lite && infoOf) worksSubtitle(li, infoOf(r)); // F344
        const b = li.firstChild;
        const pick = async () => {
          const st = await pkg(r).catch(() => null);
          if (!st) return;
          const hide = (await import("../nav/hud.js")).showHUD("Checking Tweak");
          try {
            const info = await tweakInfo(st, { storage, paid });
            if (!info.ok) { hide(); await alert({ title: "Can't Take This Tweak", message: info.why || "", buttons: ["OK"] }); return; }
            const data = await tweakDeb(st, { paid });
            hide();
            if (bundleId && !targetsApp(info, bundleId)) {
              const i = await alert({ title: "Not Made for This App", message: `${st.name || st.package} works in ${worksInText(info) ?? "other apps"}.`,
                buttons: ["Cancel", "Add Anyway"] });
              if (i !== 1) return;
            }
            onPick({ name: debName(st), data, ...(st.name ? { title: st.name } : {}) });
            close();
          } catch (e) {
            hide();
            if (e instanceof PaidNeeded) { if (await offerPaid(st, e, { paid, alert })) b.click(); return; } // F308
            await alert({ title: "Can't Add This Tweak", message: String(e?.message ?? e), buttons: ["OK"] });
          }
        };
        u.append(li);
      }
      return u;
    };
    const groups = [];
    if (made.length) { const g = el("div", "group"); g.append(el("h2", "group-header", "Made for This App"), ul(made)); groups.push(g); }
    const restHead = lite ? "Works in Any App" : made.length ? "Other Tweaks" : "Tweaks";
    if (rest.length) { const g = el("div", "group"); g.append(el("h2", "group-header", restHead), ul(rest)); groups.push(g); }
    const foot = el("p", "group-footer", !list.length ? "No tweaks yet. Add a source under Tweak Sources (Sources tab), then Refresh."
      : lite ? (made.length || rest.length ? "Only tweaks for this app, or for any app, are listed."
        : "None of your sources has a tweak for this app.")
        : "Checked when you tap one: a tweak whose filter names this app goes in as it is.");
    body.replaceChildren(...groups, foot);
  }
  return { close: () => close() };
}

// ---- F302a: tweaks on the app side (the sideload build) ------------------------------------------------------------
//
//   addTweaksGroup({ bundleId, name })      the app page's group right under its header (Install): "Add Tweaks", the
//                                           count made for this app (cached checks) or of those added; opens the page
//   await installTweaksChoice({ … })        the install popup before an app is queued: "<app> <version>" and what goes in,
//                                           "Tweaks: N" (or "Add Tweaks…": pushes the Add Tweaks page, asks again after
//                                           back), Install. true: install, false: cancelled
//   await keptTweakParams(params, job)      signing.prepare's params with the app's kept tweaks (prepared, ElleKit when
//                                           needed), one log line per tweak; so updates from a source keep the tweaks
//   await tweakUpdatesFor(bundleId)         the kept .debs a Tweak Source has newer: [{ package, title, from, to, row }]
//   await updateTweaks(bundleId, ups)       those .debs fetched and kept in place of the old ones
//   isEncrypted(bundleId) / markEncrypted   apps known to be App Store copies (still encrypted), kept on this device
//   await lockedAlert(name)                 "<App> Is Locked", How to Get One
//   await checkPickedIpa(file)              an IPA picked in Files: encrypted -> marked and the alert; -> the check

export const ENC_KEY = "ifizbox.encryptedApps";
function encSet(storage = globalThis.localStorage) {
  try { const a = JSON.parse(storage?.getItem(ENC_KEY) ?? "[]"); return new Set(Array.isArray(a) ? a : []); } catch { return new Set(); }
}
export function isEncrypted(bundleId, { storage } = {}) { return Boolean(bundleId) && encSet(storage).has(bundleId); }
export function markEncrypted(bundleId, on = true, { storage = globalThis.localStorage } = {}) {
  if (!bundleId) return;
  const s = encSet(storage);
  if (on) s.add(bundleId); else s.delete(bundleId);
  try { storage?.setItem(ENC_KEY, JSON.stringify([...s].slice(-200))); } catch { /* private mode */ }
}

export async function lockedAlert(name, { alert = showAlert } = {}) {
  const a = ENCRYPTED_ALERT(name);
  const r = await alert(a);
  const i = typeof r === "number" ? r : r?.index;
  if (i === 0) await alert({ title: HOW_TO_GET_ONE, message: HOW_TO_TEXT, buttons: ["OK"] });
}

export async function checkPickedIpa(file, { alert = showAlert, storage, read = ipaEncrypted } = {}) {
  const r = await read(file).catch(() => null);
  if (r?.bundleId) markEncrypted(r.bundleId, r.encrypted, { storage });
  if (r?.encrypted) await lockedAlert(r.name, { alert });
  return r;
}

// Add to App's choice (addToApp): a sheet with Made For (a tap picks the app), Can't Take Tweaks (App Store copies,
// greyed, How to Get One under them) and the rest as Not Targeted. -> the app, or null when closed.
export function pickApp({ name, made, locked = [], not = [] }, { sheet = null, alert = showAlert } = {}) {
  style();
  return new Promise((resolve) => {
    let picked = null;
    const body = el("div", "sheet-scroll page-body grouped tweak-pick"); // B267: its own scroller, as Add Tweaks
    const group = (header, apps, { onTap = null, cls = "", detail = (a) => a.from ?? null, footer = null } = {}) => {
      const g = el("div", "group");
      g.append(el("h2", "group-header", header));
      const ul = el("ul", "table grouped");
      for (const a of apps) {
        const li = el("li", `cell tw-row ${cls}`.trim());
        const b = el(onTap ? "button" : "div", `cell-inner${onTap ? " chevron" : ""}`);
        if (onTap) { b.type = "button"; b.addEventListener("click", () => onTap(a)); }
        const t = el("span", "cell-text");
        t.append(el("span", "cell-label", a.name));
        b.append(t);
        const d = detail(a);
        if (d) b.append(el("span", "cell-detail", d));
        li.append(b);
        ul.append(li);
      }
      g.append(ul);
      if (footer) g.append(footer);
      return g;
    };
    if (made.length) body.append(group("Made For", made, { onTap: (a) => { picked = a; close(); } }));
    if (locked.length) {
      const foot = el("p", "group-footer", "Apps from the App Store are locked by Apple, so tweaks can't go in. Add a decrypted IPA to My IPAs. ");
      const how = el("button", "link-button", HOW_TO_GET_ONE);
      how.type = "button";
      how.addEventListener("click", () => alert({ title: HOW_TO_GET_ONE, message: HOW_TO_TEXT, buttons: ["OK"] }));
      foot.append(how);
      body.append(group("Can't Take Tweaks", locked, { cls: "tw-locked", detail: () => "App Store copy", footer: foot }));
    }
    if (not.length) body.append(group("Not Targeted", not, { cls: "tw-locked", footer: el("p", "group-footer", `${name}'s filter doesn't name these apps.`) }));
    const show = sheet ?? ((o) => { let c = () => {}; import("../nav/sheet.js").then(({ showSheet }) => { c = showSheet(o); }); return () => c(); });
    const close = show({ title: "Add to App", body, onClose: () => resolve(picked) });
  });
}

// The kept tweaks' bundle ID for a queue job: the app's own (a source's bundleIdentifier, a My IPAs entry's).
function keptIdOf(job) {
  const id = typeof job?.bundleId === "string" && job.bundleId ? job.bundleId : job?.id;
  return typeof id === "string" && id && !id.startsWith("library:") && id !== BUNDLE_ID ? id : null;
}

// signing.prepare's params with the kept tweaks: url jobs (installs and updates from a source) and My IPAs files get
// them; a re-sign from the phone's record keeps its own unless the kept ones differ from what it was signed with (a
// tweak update, or tweaks added since: signing.installed's `tweaks` names), and then sends those. Params that already
// carry tweaks (a Custom Install's) go as they are. Throws with words for a bad tweak.
export async function keptTweakParams(params, job, { log = () => {}, store = tweakStore, ellekit = loadElleKit, toBase64 = null,
  records = async () => (await nativeBridge()?.call?.("signing.installed", {}))?.apps ?? [] } = {}) {
  if (!params || params.tweaks !== undefined) return params;
  let id = keptIdOf(job), items;
  if (params.record) {
    const rec = (await Promise.resolve().then(records).catch(() => []))?.find?.((r) => r?.bundleId === params.record) ?? null;
    if (!rec) return params;
    id = rec.originalBundleId || rec.bundleId;
    items = await savedTweaks(id, { store });
    const had = Array.isArray(rec.tweaks) ? rec.tweaks : [];
    if (!items.length || (items.length === had.length && items.every((x) => had.includes(x.name)))) return params;
  }
  if (!id) return params;
  items ??= await savedTweaks(id, { store });
  if (!items.length) return params;
  const prepared = await preparedItems(items, { ellekit });
  const enc = toBase64 ?? (await import("../core/signing.js")).toBase64;
  const t = tweakParams(prepared, enc);
  if (!t) return params;
  for (const line of tweakSteps(prepared, items.map((x) => x.title || null))) log(line);
  return { ...params, tweaks: t };
}

// The source tweaks whose filter names an app, from the checks known on this device: its own and (F344) the shared
// index's, once loaded. Every-app tweaks aren't counted here: they'd be "for" every app (appTweakRows lists them).
export async function madeForRows(bundleId, { rows = sourceTweakRows, storage, index = rows === sourceTweakRows ? loadRowsIndex : null } = {}) {
  if (!bundleId) return [];
  const list = await rows().catch(() => []);
  if (index) await index(list).catch(() => 0);
  // a guess (unverified) isn't counted: it may not work
  const infoOf = (r) => { const i = cachedTweakInfo({ package: r.id, version: r.version }, { storage }); return i?.unverified ? null : i; };
  return liteTweaks(list, bundleId, infoOf).made;
}

// ---- F344: the Tweak Index ------------------------------------------------------------------------------------------
//
// F398: read from one file (core/tweakindexfile.js): the copy the app came with (web/app/tweak-index.json) or a newer
// one fetched whole, the same for everyone, so no request says which sources this device has; offline and with the
// server gone it answers the same. Settings > General > Update Tweak Index turns the fetching off.
//
//   indexFile()                                 the file this page uses (createIndexFile), opened on first use
//   await loadTweakIndex(sources, { file })     each Tweak Source's verdicts, read beside the device's own checks
//                                               (cachedTweakInfo reads both) and read again when a newer file comes; a
//                                               source the file doesn't have gives nothing. -> how many verdicts
//   await loadRowsIndex(rows)                   the same for the sources these catalog rows come from
//   await sellerKeys(rows)                      the keys of the sources (among these rows') that name a seller
//                                               (payment_endpoint): their paid tweaks may be listed
//   rowInfo(row, { storage, sellers })          the verdict for a row: cached or indexed, else the guess from its name
//                                               and description (unverified); a paid row's only from a selling source
//   await appTweakRows(bundleId, { … })         Add Tweaks for an app: { made, any, rows }: core/tweakindex.js
//                                               liteTweaks over the Tweak Sources' rows; nothing for iOS itself or another
//                                               app. B391: with no verdict, only one that mentions the app
//   worksSubtitle(li, info, known)              a list row's subtitle led by "Works in: <app>"
const loadedSources = new Map(); // tweakindex.js key -> { src, file, infos: Map(debKey -> info) }

// The app asks brand.js DOMAIN; a website its own server (ifizbox.com or a self-hosted one).
export function indexFileUrl() {
  const loc = globalThis.location;
  if (!hasNativeCall() && loc && /^https?:$/.test(loc.protocol ?? "")) return new URL(FILE_PATH, loc.href).href;
  return FILE_URL;
}

let indexFileOne = null;
export function indexFile() {
  if (indexFileOne) return indexFileOne;
  let storeOne = null;
  indexFileOne = createIndexFile({
    bundled: async () => (await import("../core/sources.js")).readBundled(FILE_NAME),
    store: () => (storeOne ??= openIpaStore({ name: "ifizbox-tweakindex" }).catch(() => memoryIpaStore())),
    url: indexFileUrl,
    // never under node (tests make their own); the jailbreak app has no use for it
    enabled: () => typeof globalThis.process?.versions?.node !== "string" && detectMode() !== "jailbreak" && tweakIndexRefreshOn(),
  });
  return indexFileOne;
}

// Two of the user's sources with the same package and version may have different files for it: the one that works
// wins, so nothing that works somewhere is hidden (opening it reads the .deb itself).
function mergeIndexed() {
  indexed.clear();
  for (const { infos } of loadedSources.values()) {
    for (const [k, info] of infos) {
      const had = indexed.get(k);
      if (!had || (dropsFromCatalog(had) && !dropsFromCatalog(info))) indexed.set(k, info);
    }
  }
}

const watchedFiles = new WeakSet();
export async function loadTweakIndex(sources, { file = indexFile() } = {}) {
  if (!watchedFiles.has(file)) {
    watchedFiles.add(file);
    file.onChange?.((f) => { applyIndex([...loadedSources.values()].map((l) => l.src), f); });
  }
  const f = await file.read().catch(() => null);
  return f ? applyIndex((sources ?? []).map((s) => indexSource(s, s?.arch)).filter(Boolean), f) : 0;
}

function applyIndex(list, f) {
  let n = 0;
  const got = new Set();
  for (const src of list) {
    const had = loadedSources.get(src.key);
    if (had?.file === f) { n += had.infos.size; continue; }
    const infos = new Map();
    for (const e of answerFromFile(f, src)?.tweaks ?? []) {
      if (e.package) infos.set(debKey(e), { v: INFO_V, ...entryInfo(e) });
    }
    for (const k of [...(had?.infos.keys() ?? []), ...infos.keys()]) got.add(k);
    loadedSources.set(src.key, { src, file: f, infos });
    n += infos.size;
  }
  if (got.size) {
    mergeIndexed();
    tellVerdicts([...got]); // B377
  }
  return n;
}

async function rowSources(rows) {
  const keys = new Set((rows ?? []).map((r) => r?.key).filter(Boolean));
  if (!keys.size) return [];
  const { getBackend } = await import("../backend.js");
  return (await getBackend().sources()).filter((s) => keys.has(s.key));
}

export async function loadRowsIndex(rows, opts) { return loadTweakIndex(await rowSources(rows), opts); }

export async function sellerKeys(rows, { sources = rowSources, text = null } = {}) {
  const paidKeys = new Set((rows ?? []).filter((r) => r?.paid).map((r) => r.key).filter(Boolean));
  if (!paidKeys.size) return new Set();
  const list = (await sources(rows.filter((r) => r?.paid)).catch(() => [])).filter((s) => paidKeys.has(s.key));
  const read = text ?? (async (u) => (await import("../backend.js")).getBackend().text(u));
  const out = new Set();
  await Promise.all(list.map(async (s) => { if (await endpointOf(s, read).catch(() => null)) out.add(s.key); }));
  return out;
}

export function rowInfo(r, { storage, sellers = new Set(), known = {} } = {}) {
  const info = cachedTweakInfo({ package: r?.id, version: r?.version }, { storage });
  const paid = Boolean(r?.paid) || Boolean(info?.paid);
  if (paid && !sellers.has(r?.key)) return info?.unverified ? null : info; // no seller named: not offered
  if (info) return info;
  // B391: free or paid, only what its name or description mentions (the catalog's own look read all of it: r.guess)
  const e = guessEntry({ package: r?.id, version: r?.version, name: r?.name, description: r?.short, paid }, known);
  const bundles = [...new Set([...(r?.guess ?? []), ...e.bundles])];
  return bundles.length ? entryInfo({ ...e, bundles }) : null;
}

export async function appTweakRows(bundleId, { rows = sourceTweakRows, storage, index = rows === sourceTweakRows ? loadRowsIndex : null,
  sellers = rows === sourceTweakRows ? sellerKeys : async () => new Set(),
  apps = rows === sourceTweakRows ? signableApps : async () => [], name = "" } = {}) {
  const list = await rows().catch(() => []);
  if (index) await index(list).catch(() => 0);
  const sell = await sellers(list).catch(() => new Set());
  const known = { ...knownNames(await apps().catch(() => [])), ...(name ? { [bundleId]: name } : {}) };
  const infoOf = (r) => rowInfo(r, { storage, sellers: sell, known });
  return { ...liteTweaks(list, bundleId, infoOf), rows: list, infoOf };
}

export function worksSubtitle(li, info, known = {}) {
  const line = worksInLine(info, known, appNameOf);
  if (!line) return li;
  const t = li.querySelector?.(".cell-text") ?? li.firstChild?.lastChild ?? null;
  let sub = li.querySelector?.(".cell-subtitle") ?? null;
  if (!sub && t) { sub = el("span", "cell-subtitle"); t.append(sub); }
  if (sub) sub.textContent = [line, sub.textContent].filter(Boolean).join(" · ");
  return li;
}

const keptHas = (kept, pkgId) => kept.some((x) => debOf(x.name)?.package === pkgId);

async function keepItem(bundleId, one, store) {
  const d = debOf(one.name);
  const items = (await savedTweaks(bundleId, { store })).filter((x) => x.name !== one.name && !(d && debOf(x.name)?.package === d.package));
  items.push(one);
  await saveTweaks(bundleId, items, { store });
  return items;
}

async function dropItem(bundleId, test, store) {
  const items = (await savedTweaks(bundleId, { store })).filter((x) => !test(x));
  await saveTweaks(bundleId, items, { store });
  return items;
}

// One tweak's ADD / ADDED. ADD: added at once (a spinner while its .deb is read and checked), kept for the app if the
// check passes; a paid tweak not bought offers Sign In / Buy, then ADD again (F308). ADDED: Remove. `cls` the button's
// look (Add Tweaks' sheet: tw-add / on; the Add Tweaks page: the price button, added / adding). A button drawn again
// while its tweak is still being added (a recycled list row) shows the spinner and waits for that add.
const addingTweaks = new Set(); // `${bundleId}\n${package}` while ADD reads and checks its .deb
const defaultPkg = async (r) => (await (await import("../catalog.js")).catalog.package(r.id, r.key))?.stanza;
export function addTweakButton(r, { bundleId, on = false, cls = "tw-add", onCls = "on", busyCls = "", store = tweakStore, storage, fetchDeb,
  paid = null, sheet = showActionSheet, alert = showAlert, pkg = defaultPkg, onChange = () => {}, onRemove = () => {} } = {}) {
  const busyKey = `${bundleId}\n${r.id}`;
  const btn = el("button", `${cls}${on ? ` ${onCls}` : ""}`, on ? "ADDED" : "ADD");
  btn.type = "button";
  btn.setAttribute("aria-label", `${on ? "Remove" : "Add"} ${r.name || r.id}`);
  const busy = (yes) => {
    btn.classList.toggle(onCls, yes);
    if (busyCls) btn.classList.toggle(busyCls, yes);
    if (yes) btn.dataset.busy = "1"; else delete btn.dataset.busy;
    btn.replaceChildren(...(yes ? [el("span", "loading-spinner")] : []), globalThis.document.createTextNode(yes ? "ADDED" : "ADD"));
  };
  if (addingTweaks.has(busyKey)) busy(true);
  btn.addEventListener("click", async (ev) => {
    ev.preventDefault(); // in a package row's link: the row opens the tweak, the button adds it
    ev.stopPropagation();
    if (btn.dataset.busy) return;
    if (btn.classList.contains(onCls)) { // added: Remove
      const i = await sheet({ title: r.name || r.id, buttons: ["Remove"], destructive: 0 });
      if (i !== 0) return;
      await dropItem(bundleId, (x) => (r.file ? x.name === r.file : debOf(x.name)?.package === r.id), store); // r.file: from Files
      onChange();
      onRemove();
      return;
    }
    // green at once, a spinner while the .deb is read and checked
    busy(true);
    addingTweaks.add(busyKey);
    let again = false, paidSt = null, added = false;
    try {
      const st = await pkg(r);
      if (!st) throw new Error("This tweak isn't on its source any more.");
      paidSt = st;
      const info = await tweakInfo(st, { fetchDeb, storage, paid });
      if (!info.ok) throw new Error(info.why || "It can't go into an app.");
      const data = await tweakDeb(st, { fetchDeb, paid });
      await addDebTo(bundleId, st, data, { store });
      added = true;
    } catch (e) {
      addingTweaks.delete(busyKey);
      busy(false);
      // F308: a paid tweak not bought (or signed out): Sign In or Buy, then ADD again
      if (e instanceof PaidNeeded) again = await offerPaid(paidSt, e, { paid, sheet, alert });
      else await alert({ title: "Can't Add This Tweak", message: String(e?.message ?? e), buttons: ["OK"] });
    }
    if (added) {
      addingTweaks.delete(busyKey);
      busy(false);
      btn.classList.add(onCls);
      btn.replaceChildren(globalThis.document.createTextNode("ADDED"));
      btn.setAttribute("aria-label", `Remove ${r.name || r.id}`);
      onChange();
    }
    if (again) btn.click();
  });
  return btn;
}

// The Add Tweaks page's list (F352): the tweaks as package rows under headers, filtered by `query` (name, id,
// description, author), [{ header } | row]. Added first (the listed tweaks kept for the app, then the ones from Files:
// { id: "file:<name>", file: <name> }), then Made for <app>, then Works in Any App, each without the added ones.
export function addTweaksItems({ made = [], any = [], kept = [], query = "", appName = "" } = {}) {
  const has = (r) => keptHas(kept, r.id);
  const listed = [...made, ...any];
  const files = kept.filter((x) => !listed.some((r) => debOf(x.name)?.package === r.id))
    .map((x) => ({ id: `file:${x.name}`, file: x.name, name: tweakTitle(x), version: "", short: tweakKind(x.name), section: "Tweaks" }));
  const pick = (rows) => filterRows(rows.map((r) => ({ ...r, short: r.short || "" })), { query });
  const added = [...pick(listed.filter(has)), ...pick(files)].map((r) => ({ ...r, added: true }));
  const out = [];
  const put = (header, rows) => { if (rows.length) out.push({ header }, ...rows); };
  put("Added", added);
  put(`Made for ${appName || "This App"}`, pick(made.filter((r) => !has(r))));
  put("Works in Any App", pick(any.filter((r) => !has(r))));
  return out;
}

// The Add Tweaks page's last group (F352): More Tweaks: Browse Tweak Sources, Search All Repos, From Files, one footer.
export function moreTweaksGroup({ bundleId, name = "", store = tweakStore, storage, alert = showAlert, onChange = () => {},
  browse = pickSourceTweak, searchAll = openSearchAllRepos } = {}) {
  style();
  const input = Object.assign(el("input", "visually-hidden"), { type: "file", accept: TWEAK_ACCEPT, multiple: true });
  input.id = "tw" + Math.random().toString(36).slice(2);
  input.addEventListener("change", async () => {
    const picked = [...(input.files ?? [])];
    input.value = "";
    for (const f of picked) {
      const one = { name: f.name, data: new Uint8Array(await f.arrayBuffer()) };
      try { prepareTweaks([one]); } catch (e) {
        if (!/CydiaSubstrate/.test(String(e?.message))) { await alert({ title: "Can't Add This Tweak", message: String(e?.message ?? e), buttons: ["OK"] }); continue; }
      }
      await keepItem(bundleId, one, store);
    }
    if (picked.length) onChange();
  });
  const cell = (label, onClick, detail = "") => {
    const li = el("li", "cell tw-row");
    const b = el("button", "cell-inner chevron");
    b.type = "button";
    b.addEventListener("click", onClick);
    const t = el("span", "cell-text");
    t.append(el("span", "cell-label", label));
    b.append(t);
    if (detail) b.append(el("span", "cell-detail", detail));
    li.append(b);
    return li;
  };
  const g = el("div", "group tw-more");
  const ul = el("ul", "table grouped");
  const filesLi = el("li", "cell tw-row");
  const files = Object.assign(el("label", "cell-inner chevron ss-tweak-add"), { htmlFor: input.id });
  files.append(el("span", "cell-label", "From Files…"));
  filesLi.append(files, input);
  const searchLi = cell("Search All Repos", () => searchAll({ appName: name, ctx: null }), "Canister");
  searchLi.classList.add("tw-search-all");
  ul.append(cell("Browse Tweak Sources", () => browse({ bundleId, storage, alert,
    onPick: async (one) => { await keepItem(bundleId, one, store); onChange(); } })), searchLi, filesLi);
  g.append(el("h2", "group-header", "More Tweaks"), ul,
    el("p", "group-footer", `Only tweaks for ${name || "this app"}, or for any app, are listed.`));
  return g;
}

// The Add Tweaks page's route under the page shown now (browse.js renderAddTweaks): "addtweaks:<bundle id>".
export const addTweaksToken = (bundleId) => `addtweaks:${bundleId}`;
const appNames = new Map(); // bundle ID -> the app's name, from its Details' Add Tweaks row (for the page's headers)
export const addTweaksAppName = (bundleId) => appNames.get(bundleId) ?? "";
export function pushAddTweaks(bundleId, loc = globalThis.location) {
  const h = String(loc.hash ?? "").replace(/\/$/, "");
  loc.hash = `${h}/${encodeURIComponent(addTweaksToken(bundleId))}`;
}

// An app's Details group, right under the header: Add Tweaks with a count; it opens the Add Tweaks page (F352), under
// an app's page and an IPA's in My IPAs alike (B361).
export function addTweaksGroup({ bundleId, name = "", rows = sourceTweakRows, store = tweakStore, storage, push = pushAddTweaks } = {}) {
  style();
  if (bundleId && name) appNames.set(bundleId, name);
  const g = el("div", "group tw-app");
  const ul = el("ul", "table grouped");
  const li = el("li", "cell tw-row");
  const b = el("button", "cell-inner chevron");
  b.type = "button";
  const label = el("span", "cell-label", "Add Tweaks");
  const t = el("span", "cell-text");
  t.append(label);
  const detail = el("span", "cell-detail", "");
  b.append(t, detail);
  li.append(b);
  ul.append(li);
  const foot = el("p", "group-footer", "");
  g.append(ul, foot);
  async function refresh() {
    const [kept, made] = await Promise.all([savedTweaks(bundleId, { store }), madeForRows(bundleId, { rows, storage })]);
    detail.textContent = kept.length ? `${kept.length} Added` : made.length ? `${made.length} for This App` : "";
    // F352: no footer naming the tweaks; the row's detail says how many
    foot.textContent = kept.length ? "They go in when it's installed or re-signed." : made.length ? ""
      : "Tweaks from your Tweak Sources or Files go into the app when it's signed.";
    foot.hidden = !foot.textContent;
    return { kept, made };
  }
  b.addEventListener("click", () => push(bundleId));
  // back from the Add Tweaks page: the count again (the page above may have added or removed some)
  globalThis.addEventListener?.("hashchange", function again() {
    if (!g.isConnected) { globalThis.removeEventListener?.("hashchange", again); return; }
    refresh().catch(() => null);
  });
  const ready = refresh().catch(() => null);
  return { el: g, ready, refresh };
}

// F305a: Add Tweaks' Search All Repos (screens/findmore.js, loaded when tapped so this module doesn't pull it in).
export const openSearchAllRepos = (o) => import("./findmore.js").then((m) => m.searchAllRepos(o));

// The install popup's Tweaks / Add Tweaks… (B374): the Add Tweaks page pushed under the page shown now (the app's page),
// as its Details' row does; resolves true once back on that page, false when the viewer went elsewhere (another tab,
// a link) so the popup isn't shown again over another page.
export function pushAddTweaksUntilBack(bundleId, { name = "", loc = globalThis.location, win = globalThis } = {}) {
  if (bundleId && name) appNames.set(bundleId, name);
  const trim = (h) => String(h ?? "").replace(/\/$/, "");
  const from = trim(loc.hash);
  return new Promise((resolve) => {
    const on = () => {
      const h = trim(loc.hash);
      if (h.startsWith(`${from}/`)) return; // the Add Tweaks page, or a tweak's page above it
      win.removeEventListener?.("hashchange", on);
      resolve(h === from);
    };
    win.addEventListener?.("hashchange", on);
    pushAddTweaks(bundleId, loc);
  });
}

// The install popup (the app page's Install in the sideload build): shown when the app has tweaks added or made for
// it, so they're offered on install; an app nobody made a tweak for installs straight away as before. Tweaks pushes
// the Add Tweaks page; back on the app's page the popup asks again with what was added.
export async function installTweaksChoice({ bundleId, name = "", version = "", ask = showActionSheet,
  open = (o) => pushAddTweaksUntilBack(o.bundleId, { name: o.name }),
  rows = sourceTweakRows, store = tweakStore, storage } = {}) {
  if (!bundleId) return true;
  const made = await madeForRows(bundleId, { rows, storage }).catch(() => []);
  for (;;) {
    const kept = await savedTweaks(bundleId, { store });
    if (!kept.length && !made.length) return true;
    const what = kept.length ? withTweaksText(kept.map(tweakTitle)) : `${made.length} ${made.length === 1 ? "tweak" : "tweaks"} made for it, none added`;
    const i = await ask({ title: `${[name, version].filter(Boolean).join(" ")}\n${what}`,
      buttons: [kept.length ? `Tweaks: ${kept.length}` : "Add Tweaks…", "Install"] });
    if (i === 1) return true;
    if (i !== 0) return false;
    if ((await open({ bundleId, name, rows, store, storage })) === false) return false;
  }
}

// Installed's pill after a row's subtitle: "2 Tweaks", or "Tweak Update" (up).
export function tweakPill(text, { up = false } = {}) {
  style();
  return el("span", `tweak-pill${up ? " up" : ""}`, text);
}

// Installed's Tweak Updates: for each signed app (signing.installed records with tweaks) whose kept .debs a source
// has newer, { app, ups }.
export async function tweakUpdateApps(records, { rows = sourceTweakRows, store = tweakStore } = {}) {
  const withTweaks = (records ?? []).filter((r) => r?.bundleId && Array.isArray(r.tweaks) && r.tweaks.length);
  if (!withTweaks.length) return [];
  let list = null;
  const once = async () => (list ??= await rows().catch(() => []));
  const out = [];
  for (const app of withTweaks) {
    const ups = await tweakUpdatesFor(app.originalBundleId || app.bundleId, { rows: once, store });
    if (ups.length) out.push({ app, ups });
  }
  return out;
}

// The Tweak Updates row's tap: what changes, then the newer .debs fetched and each app queued as a re-sign (its kept
// tweaks now differ from its record's, so keptTweakParams sends them). -> how many were queued.
export async function runTweakUpdates(found, { ask = showActionSheet, alert = showAlert, hud = null, queue = null, job = null, update = updateTweaks } = {}) {
  if (!found.length) return 0;
  const lines = found.map(({ app, ups }) => `${app.name}: ${ups.map((u) => `${u.title} ${u.to}`).join(", ")}`);
  const i = await ask({ title: `Re-sign with the newer tweaks?\n${lines.join("\n")}`, buttons: [found.length === 1 ? "Update" : `Update ${found.length} Apps`] });
  if (i !== 0) return 0;
  const hide = hud ? hud("Downloading Tweaks") : (await import("../nav/hud.js")).showHUD("Downloading Tweaks");
  const ready = [];
  try {
    for (const f of found) { await update(f.app.originalBundleId || f.app.bundleId, f.ups); ready.push(f); }
  } catch (e) {
    hide();
    await alert({ title: "Can't Update These Tweaks", message: String(e?.message ?? e), buttons: ["OK"] });
    if (!ready.length) return 0;
  }
  hide();
  const mk = job ?? (async (app) => (await import("../core/appqueue.js")).resignJob(app));
  const add = queue ?? (async (j) => (await import("./queue.js")).queueApp(j));
  for (const f of ready) { const j = await mk(f.app); if (j) await add(j); }
  return ready.length;
}

export async function tweakUpdatesFor(bundleId, { rows = sourceTweakRows, store = tweakStore } = {}) {
  const kept = await savedTweaks(bundleId, { store });
  if (!kept.some((x) => debOf(x.name))) return [];
  return tweakUpdates(kept, await rows().catch(() => []));
}

export async function updateTweaks(bundleId, ups, { store = tweakStore, fetchDeb, storage, paid = null, pkg = async (r) => (await (await import("../catalog.js")).catalog.package(r.id, r.key))?.stanza } = {}) {
  for (const u of ups) {
    const st = await pkg(u.row);
    if (!st) throw new Error(`${u.title} isn't on its source any more.`);
    const info = await tweakInfo(st, { fetchDeb, storage, paid });
    if (!info.ok) throw new Error(`${u.title} ${u.to}: ${info.why || "it can't go into an app."}`);
    await addDebTo(bundleId, st, await tweakDeb(st, { fetchDeb, paid }), { store });
  }
}
