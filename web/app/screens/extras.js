// Repo extras Sileo users expect (F20), as pieces the screens drop in:
//
//   featuredStrip(source)       the source page's banners (sileo-featured.json), filled in when they land
//   homeFeatured()              Home's banners (Browse's in the jailbreak app): a couple from each source,
//                               placeholder cards while they load (F135)
//   paymentGroup(st, source)    a paid package's Price row; in the app Sign In / Buy / Download & Install
//   paidStateOf(box)            B11: what the package page's nav bar button does for that paid package
//   discoveryGroup()            Search's "Other Sources" list (Canister), with Add Source; .search(q). In the
//                               jailbreak app Add Source & Install (F99): add, refresh it, open the page, queue.
//                               In the sideload app (F305) injectable tweaks only, with Add Source & Add to App
//   offerTweak(row, ctx)        F305: that tweak's sheet (Add Source & Add to App / View Repo)
//   canisterApi()               the one Canister client (core/canister.js createCanister), Find More's too
//
// Logic lives in core/featured.js, core/payment.js and core/canister.js; this file is DOM and transport only.
//
// The app's vendor calls need the shell (vendors send no CORS headers, and the spec wants the payment secret in the
// Keychain). It asks the shell for these methods and says "needs a newer iFizBox" when a shell doesn't have them:
//   net.request { method, url, headers, body }  -> { status, headers, body }  body base64, like net.fetch
//   device.info                                 -> { udid, model }
//   keychain.get { key } / keychain.set { key, value } / keychain.remove { key }  (passcode / Face ID protected)
//   auth.session { url, callbackScheme }        -> the callback URL (ASWebAuthenticationSession; "sileo" here)
//   paid.install { url, package, version, stream } -> { code, stdout, stderr }  download the one-time URL, dpkg it;
//                                                 streamed into the install queue's console (F74), dpkg status read
//                                                 again after, and the package page drawn again so it shows Installed
// The site never calls a vendor: it shows Canister's price and links to the vendor's page.
import { getBackend, getArch } from "../backend.js";
import { format, parse } from "../router.js";
import { grouped, el } from "../nav/ui.js";
import { showAlert } from "../nav/alert.js";
import { showHUD } from "../nav/hud.js";
import { mediaUrl } from "./depiction.js";
import { settings } from "../settings-store.js";
import { runPaidInstall } from "./queue.js";
import { createFeaturedStore, MAX_BANNERS, bannersInCatalog } from "../core/featured.js";
import { createCanister, mapResults, priceFor, normalRepo, askable } from "../core/canister.js";
import { loadInjectable } from "../core/canister.js"; // F305
import { sourceWarning } from "../core/warnings.js"; // F305
import { tweakSourcesOn } from "../core/sources.js"; // F305
import { detectMode } from "../core/settings.js"; // F305
import { showActionSheet } from "../nav/actionsheet.js"; // F305
import {
  isCommercial, paymentEndpointUrl, parseEndpoint, createPaymentClient, createCredentialStore, isFreePrice,
} from "../core/payment.js";
import { NAME } from "../brand.js";
import { showBanner } from "../nav/banner.js";
import { go as navGo } from "../nav/go.js";
import { failedBanner, FAILED_BANNER_MS } from "../core/aptupdate.js";
import { nativeBridge, hasNativeCall } from "../native.js";

const pkgHref = (key, id) => format({ tab: "sources", path: [key, `package:${id}`] });

// ---- featured banners -------------------------------------------------------------------------------------

let featured = null;
const featuredStore = () => (featured ??= createFeaturedStore({ getText: (u) => getBackend().text(u) }));

// A horizontal row of banners, scroll-snapped one per page like Sileo's. Sizes and corner radius from the repo.
function bannerRow(banners, { itemSize = { width: 263, height: 148 }, radius = 10 } = {}) {
  const row = el("div", "featured-row");
  row.style.setProperty("--banner-ratio", `${itemSize.width} / ${itemSize.height}`);
  row.style.setProperty("--banner-radius", `${radius}px`);
  for (const b of banners) {
    const a = el("a", "featured-banner");
    a.href = pkgHref(b.key, b.package);
    a.setAttribute("aria-label", b.title);
    const src = mediaUrl(b.url);
    if (src) {
      const img = el("img");
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.onload = () => img.classList.add("loaded");
      img.onerror = () => img.remove();
      img.src = src;
      a.append(img);
    }
    if (b.displayText) {
      const t = el("span", "featured-title", b.title);
      if (b.hideShadow) t.classList.add("no-shadow");
      a.append(t);
    }
    row.append(a);
  }
  return row;
}

// The source page: nothing until the file lands (most repos have none), then the strip.
// B182: only banners whose package the catalog has for this source (core/featured.js bannersInCatalog): the sideload
// app loads a Tweak Source's injectable tweaks only, so most of Chariz's banners would open "Package not found".
// B391: nor a tweak its lists leave out (core/catalog.js shows).
// `get` and `has(id)` are seams for the tests.
const catalogHas = (key) => async (id) => {
  const { catalog } = await import("../catalog.js"); // late: catalog.js pulls in the parse worker
  return catalog.shows(id, key);
};
export function featuredStrip(source, { get = (s) => featuredStore().get(s), has = source ? catalogHas(source.key) : null } = {}) {
  const box = el("div", "featured-box");
  if (!source || source.kind === "altstore") return box;
  box.ready = Promise.resolve().then(() => get(source)).then(async (f) => {
    if (!f?.banners.length) return;
    const banners = await bannersInCatalog(f.banners, has);
    if (!banners.length || !box.isConnected && box.parentNode == null) return;
    box.append(bannerRow(banners.map((b) => ({ ...b, key: source.key })), f));
  }).catch(() => {});
  return box;
}

// F135: the scroller while its banners load: grey cards the banners' size, pulsing like nav/ui.js placeholder()'s bars.
export const FEATURED_PLACEHOLDERS = 2; // one whole card and the next one peeking in, as the banners sit
export function featuredPlaceholder(n = FEATURED_PLACEHOLDERS) {
  const row = el("div", "featured-row featured-ph");
  row.setAttribute("aria-busy", "true");
  row.setAttribute("aria-label", "Loading");
  for (let i = 0; i < n; i++) row.append(el("span", "featured-banner ph-box"));
  return row;
}

// Home's banners (Browse's in the jailbreak app, F135): placeholder cards until they land, then the banners, or
// nothing when the sources have none. `deviceType`, `sources` and `forHome` are for the tests.
export function homeFeatured({ deviceType = () => settings.deviceType(), sources = () => getBackend().sources(),
  forHome = (list) => featuredStore().forHome(list) } = {}) {
  const box = el("div", "featured-box home-featured");
  box.ready = Promise.resolve(); // F82: settles once the banners are drawn (or there are none), for Home's Reload
  if (deviceType() === "none") return box; // Not Jailbroken: APT sources (and their tweaks) are hidden
  box.append(featuredPlaceholder());
  box.ready = Promise.resolve().then(sources).then(forHome).then((banners) => {
    box.replaceChildren(...(banners?.length ? [bannerRow(banners)] : []));
  }, () => { box.replaceChildren(); });
  return box;
}

// F124, Browse's Featured list: every banner of every APT source (in source order, round-robin like Home's), as
// [{ key, id }] for catalog.featured. None while Not Jailbroken: APT sources are hidden then.
export async function featuredRefs() {
  if (settings.deviceType() === "none") return [];
  const list = await getBackend().sources();
  const banners = await featuredStore().forHome(list, MAX_BANNERS, MAX_BANNERS * 50);
  return banners.map((b) => ({ key: b.key, id: b.package }));
}

// ---- Canister discovery (Search) ---------------------------------------------------------------------------

let canister = null;
// F305: shared with screens/findmore.js (Find More Sources), so one cache serves Search, Find More and the trust labels.
export const canisterApi = () => (canister ??= createCanister({ getJson: async (u) => JSON.parse(await getBackend().text(u)) }));

// Search's "Other Sources" group: packages from sources the user hasn't added. `.search(q)` redraws it; a newer
// call wins. Failures stay quiet (one footer line): Canister is an extra, local search is the main thing.
// B33: rows not built for this device (archOk false) are left out while the Filter's Show Incompatible is off
// (`hideIncompatible()` true, device.js compatFilterOn(), passed in by search.js), as incompatible packages from
// added sources are; Search runs `.search(q)` again when that switch changes. All hidden: no group at all.
// `search`, `sources`, `arch` and `wait` are seams for the tests.
const defaultHideIncompatible = () => settings.get("worksOnMyPhone") === true;
// F305: the sideload app (Tweak Sources on) lists only tweaks that can go into an app (core/tweaks.js
// injectableFromFields on Canister's Architecture, Section and tags), each with its repo's trust label; a tap offers
// Add Source & Add to App or View Repo (offerTweak). Piracy-listed repos are never offered, in either build.
const defaultTweaks = () => tweakSourcesOn(settings.deviceType(), detectMode());
export function discoveryGroup(ctx, { hideIncompatible = defaultHideIncompatible, search: ask = (q) => canisterApi().search(q),
  sources = () => getBackend().sources(), arch = getArch, wait = 450, tweaks = defaultTweaks, injectable = loadInjectable,
  label = null } = {}) {
  const box = el("div", "discovery");
  let seq = 0;
  async function search(q) {
    const turn = ++seq;
    box.replaceChildren();
    // 2+ characters, even CJK: Canister finds nothing for one character (F106, core/canister.js askable()).
    if (!askable(q)) return;
    // Local results come every 120 ms of typing; Canister only once typing has stopped a moment.
    await new Promise((r) => setTimeout(r, wait));
    if (turn !== seq) return;
    let json, have;
    try {
      [json, have] = await Promise.all([ask(q), Promise.resolve().then(sources).catch(() => [])]);
    } catch (e) {
      if (turn === seq) box.replaceChildren(grouped([{ footer: `Other sources: ${e.message}` }]));
      return;
    }
    if (turn !== seq || !json) return;
    if (tweaks()) {
      let check;
      try { check = await injectable(); } catch { return; }
      if (turn !== seq) return;
      const rows = mapResults(json, { have }).filter((r) => !r.repo.added && !piracyRepo(r.repo.uri) && check(r).ok).slice(0, 25);
      if (rows.length) box.replaceChildren(await tweakGroup(rows, ctx, label));
      return;
    }
    const hide = hideIncompatible();
    const rows = mapResults(json, { have, arch: arch() }).filter((r) => !r.repo.added && !piracyRepo(r.repo.uri) && (r.archOk || !hide)).slice(0, 25);
    if (!rows.length) return;
    box.replaceChildren(grouped([{
      header: "Other Sources",
      rows: rows.map((r) => ({
        label: r.name,
        subtitle: [r.repo.name, r.description].filter(Boolean).join(" · "),
        detail: r.price ?? (r.archOk ? null : "Other device"),
        icon: { text: r.name.charAt(0).toUpperCase() },
        onClick: () => offer(r, ctx),
      })),
      footer: "From sources you haven't added, found by Canister (canister.me). Add the source to install.",
    }]));
  }
  return { el: box, search };
}

const piracyRepo = (uri) => Boolean(sourceWarning(uri));

// F305: the sideload app's Other Sources · Canister: "Works in <apps>" when the tweak's .deb was checked here before
// (screens/tweaks.js cachedTweakInfo), its repo's label (screens/findmore.js labelOf) and name.
async function tweakGroup(rows, ctx, label) {
  const [{ labelOf, labelNode }, { cachedTweakInfo }] = await Promise.all([import("./findmore.js"), import("./tweaks.js")]);
  const { worksInText } = await import("../core/tweaks.js");
  const kindOf = label ?? ((repo) => labelOf(repo));
  const frag = grouped([{
    header: "Other Sources · Canister",
    rows: rows.map((r) => {
      const info = cachedTweakInfo({ package: r.id, version: r.version });
      const works = info?.ok ? worksInText(info) : null;
      return { label: r.name, subtitle: [works ? `Works in ${works}` : null, r.repo.name].filter(Boolean).join(" · "),
        icon: { text: r.name.charAt(0).toUpperCase() }, cls: "discovery-tweak", onClick: () => offerTweak(r, ctx) };
    }),
    footer: "Tweaks you can add to a sideloaded app, from repos you haven't added, found by Canister (canister.me).",
  }]);
  const cells = frag.querySelectorAll(".cell");
  rows.forEach((r, i) => {
    const sub = cells[i]?.querySelector(".cell-subtitle");
    if (!sub) return;
    const parts = labelNode(kindOf(r.repo));
    // the label goes before the repo's name: after "Works in …" when there is one
    const text = sub.textContent;
    const cut = text.lastIndexOf(r.repo.name);
    sub.replaceChildren(text.slice(0, cut), ...parts, r.repo.name);
  });
  return frag;
}

export const ADD_SOURCE_AND_ADD = "Add Source & Add to App";
export const VIEW_REPO = "View Repo";

// F305: the sheet for a tweak from a repo not added yet (Search's Other Sources · Canister, Find More's repo page, Search
// All Repos): Add Source & Add to App (adds the repo, then the tweak's Add to App picker) and View Repo (Find More's
// repo page; left out with `viewRepo: false`). An Unknown repo says so in the sheet. Every outside call is in the
// options, for the tests. Resolves to what happened: "cancel" | "view" | addSourceAndAddToApp's answer.
export async function offerTweak(r, ctx, { viewRepo = true, sheet = showActionSheet, label = null, go = null, add = null } = {}) {
  const { labelOf, repoHref } = await import("./findmore.js");
  const kind = (label ?? labelOf)(r.repo).kind;
  const unknown = kind === "unknown" ? ` ${NAME} hasn't checked this repo.` : "";
  const buttons = [ADD_SOURCE_AND_ADD, ...(viewRepo && r.repo.slug ? [VIEW_REPO] : [])];
  const i = await sheet({ title: `${r.name} is in ${r.repo.name}, which you haven't added.${unknown}`, buttons });
  if (buttons[i] === VIEW_REPO) {
    const href = repoHref({ ...r.repo, count: null });
    (go ?? navGo)(href);
    return "view";
  }
  if (buttons[i] !== ADD_SOURCE_AND_ADD) return "cancel";
  if (add) return add(r);
  const [{ catalog }, { addToApp }, { sourcesChanged }] = await Promise.all([import("../catalog.js"), import("./tweaks.js"), import("./manage.js")]);
  return addSourceAndAddToApp(r, { backend: getBackend(), catalog, showHUD: ctx?.showHUD ?? showHUD, showAlert, addToApp,
    changed: () => sourcesChanged(ctx) });
}

// F305: Add Source & Add to App: verify and add the repo, refresh it and load it into the catalog (as Add Source &
// Install), then the tweak's Add to App picker (screens/tweaks.js addToApp: checks the .deb, then the apps its filter
// names). `deps`: { backend, catalog, showHUD, showAlert, addToApp, changed }. Resolves "error" | "missing" | "added"
// (the picker ran; it answers for itself whether an app was picked).
export async function addSourceAndAddToApp(r, deps) {
  const got = await addAndLoad(r, deps);
  if (got.status !== "ok") return got.status;
  deps.changed?.();
  await deps.addToApp(got.pkg.stanza);
  return "added";
}

// Add Source & Install's and Add Source & Add to App's first steps: add the repo (Verifying URL), refresh it alone and
// load it (Reloading Data), and find the package in it. { status: "ok" | "error" | "missing", key, pkg, added }.
async function addAndLoad(r, { backend, catalog, showHUD: hud, showAlert: alert, go = () => {}, banner = showBanner }) {
  let hide = hud("Verifying URL");
  let added;
  try {
    added = await backend.addSource(r.repo.flat ? r.repo.uri : { uri: r.repo.uri, dist: r.repo.dist, components: r.repo.components });
  } catch (e) {
    hide();
    await alert({ title: e.title || "Verification Error", message: e.message, buttons: ["OK"] });
    return { status: "error" };
  }
  hide();
  hide = hud("Reloading Data");
  let key = added?.key ?? null, pkg = null;
  try {
    if (!key) {
      const want = normalRepo(r.repo.uri);
      key = (await backend.sources()).find((s) => normalRepo(s.uri) === want)?.key ?? null;
    }
    const only = (s) => s.key === key;
    const rows = await backend.refreshSources(() => {}, { filter: only });
    const mine = (rows ?? []).find(only);
    const own = mine?.aptError || (rows?.failed ?? []).find((f) => f.key === key)?.message;
    if (own) throw new Error(own);
    const others = (rows?.failed ?? []).filter((f) => f.key !== key);
    const words = failedBanner(others);
    if (words) banner({ ...words, duration: FAILED_BANNER_MS, onTap: () => go(format({ tab: "sources", path: [] })) });
    await catalog.ensure();
    pkg = key ? await catalog.package(r.id, key) : null;
  } catch (e) {
    hide();
    await alert({ title: "Error", message: `${r.repo.name} was added, but refreshing it failed: ${e.message}`, buttons: ["OK"] });
    return { status: "error" };
  }
  hide();
  if (!pkg || pkg.installedOnly || (pkg.key && pkg.key !== key)) {
    await alert({ title: "Not Found",
      message: `${r.repo.name} was added, but it doesn't list ${r.name} for this device. Canister's copy may be out of date.`,
      buttons: ["OK"] });
    return { status: "missing" };
  }
  return { status: "ok", key, pkg, added };
}

// The alert's buttons for a Canister row. F99: where the backend can queue (the jailbreak app), a flat source's
// row offers Add Source & Install (Sileo's provisional Get) instead of Add Source; the site and the sideload build
// keep Add Source.
export function offerButtons(r, { canQueue = false } = {}) {
  const buttons = ["Cancel"];
  if (r.repo.flat) buttons.push(canQueue ? "Add Source & Install" : "Add Source");
  if (r.depiction) buttons.push("Depiction");
  return buttons;
}

const canQueue = (b) => typeof b?.queue === "function";

async function offer(r, ctx) {
  const backend = getBackend();
  const buttons = offerButtons(r, { canQueue: canQueue(backend) });
  const lines = [`${r.version}${r.author ? ` · ${r.author}` : ""}`, r.repo.uri];
  if (!r.repo.flat) lines.push(`This source uses suite "${r.repo.dist}": add it from Sources > Edit.`);
  if (!r.archOk) lines.push(`Built for ${r.arch}, not this device.`);
  const { index } = await showAlert({ title: r.name, message: lines.join("\n"), buttons, cancel: 0 });
  const pick = buttons[index];
  if (pick === "Depiction") window.open(r.depiction, "_blank", "noopener");
  if (pick === "Add Source & Install") {
    const { catalog } = await import("../catalog.js"); // late: catalog.js pulls in the parse worker
    await addSourceAndInstall(r, {
      backend, catalog, showHUD: ctx?.showHUD ?? showHUD, showAlert,
      go: navGo,
    });
    return;
  }
  if (pick !== "Add Source") return;
  const hide = (ctx?.showHUD ?? showHUD)("Verifying URL");
  let error = null;
  try { await backend.addSource(r.repo.uri); } catch (e) { error = e; } finally { hide(); }
  if (error) await showAlert({ title: error.title || "Verification Error", message: error.message, buttons: ["OK"] });
  else await showAlert({ title: "Source Added", message: `${r.repo.name} is in your sources. Refresh Sources to list ${r.name}.`, buttons: ["OK"] });
}

// F99: Add Source & Install. Verify and add the source (the "Verifying URL" HUD), refresh that one source and load
// it into the catalog ("Reloading Data"), then open the package page and queue the package, which brings up
// Confirm as usual. When the refreshed source doesn't list it (Canister's data is stale, or the package isn't
// built for this device), an alert says so and the source stays added. Every outside call comes in `deps`
// ({ backend, catalog, showHUD, showAlert, go }), so the steps can be tested without a page.
// Resolves to what happened: "error" | "missing" | "queued" | "paid" (B19).
// B19: a paid package the source's vendor sells (`sold`, soldByVendor) is not queued (apt can't fetch it): its page
// opens on the Purchase group and nav bar price (B11), and the answer is "paid".
// B23: apt-get update failing on other sources doesn't stop it: those are named in a banner (`banner`, nav/banner.js,
// which opens Sources when tapped) and the install goes on. Only the added source's own failure is an alert.
export async function addSourceAndInstall(r, { backend, catalog, showHUD: hud, showAlert: alert, go, sold = soldByVendor,
  banner = showBanner }) {
  const got = await addAndLoad(r, { backend, catalog, showHUD: hud, showAlert: alert, go, banner });
  if (got.status !== "ok") return got.status;
  const { key, pkg, added } = got;
  go(pkgHref(key, r.id));
  if (await Promise.resolve().then(() => sold(pkg.stanza, { key, uri: added?.uri || r.repo.uri })).catch(() => false)) return "paid";
  backend.queue({ op: "install", id: r.id, version: pkg.stanza?.version ?? r.version, name: pkg.row?.name || pkg.stanza?.name || r.name });
  return "queued";
}

// ---- paid packages ---------------------------------------------------------------------------------------

const native = () => hasNativeCall() ? nativeBridge() : null;

class NeedsShell extends Error {
  constructor(method) {
    super(`This needs a newer ${NAME} app (the shell has no ${method} yet).`);
    this.name = "NeedsShell";
  }
}

async function shell(method, params, onEvent) {
  const n = native();
  if (!n) throw new NeedsShell(method);
  try {
    return await (onEvent ? n.call(method, params, onEvent) : n.call(method, params));
  } catch (e) {
    if (/unknown method/.test(e?.message ?? "")) throw new NeedsShell(method);
    throw e;
  }
}

function fromBase64(b64) {
  const bin = atob(b64 || "");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(out);
}

async function shellRequest({ method, url, headers, body }) {
  const r = await shell("net.request", { method, url, headers, body });
  let json = null;
  try { json = JSON.parse(fromBase64(r.body)); } catch { json = null; }
  return { status: r.status, json };
}

const keychain = {
  get: (key) => shell("keychain.get", { key }),
  set: (key, value) => shell("keychain.set", { key, value }),
  remove: (key) => shell("keychain.remove", { key }),
};

const endpoints = new Map(); // source key -> Promise<vendor base | null>
function vendorOf(source) {
  const url = paymentEndpointUrl(source);
  if (!url) return Promise.resolve(null);
  if (!endpoints.has(source.key)) {
    endpoints.set(source.key, getBackend().text(url).then(parseEndpoint, () => null));
  }
  return endpoints.get(source.key);
}

const clients = new Map();
function clientFor(base) {
  if (!clients.has(base)) {
    clients.set(base, createPaymentClient({
      base,
      request: shellRequest,
      device: () => shell("device.info"),
      credentials: createCredentialStore({ secure: keychain }),
    }));
  }
  return clients.get(base);
}

let canisterPrice = null;
async function sitePrice(st, source) {
  canisterPrice ??= canisterApi();
  return priceFor(await canisterPrice.lookup(st.package), source.uri, source.name || source.origin || null);
}

const vendorPage = (st, base) => {
  for (const u of [st.depiction, st.homepage]) if (/^https?:\/\//i.test(String(u ?? "").trim())) return String(u).trim();
  return new URL(base).origin + "/";
};

// The package page's purchase group, for packages tagged cydia::commercial on a source with a payment_endpoint.
// Empty (and stays empty) otherwise.
// B11: in the app, `onState(state)` hears what the nav bar button should do whenever the group is drawn (paidNav's
// shape, or null when the source has no vendor after all); paidStateOf(box) answers the latest one.
export function paymentGroup(st, source, ctx, { onState = null } = {}) {
  const box = el("div", "payment-box");
  if (!isCommercial(st) || !source) return box;
  const draw = (sections) => { box.replaceChildren(grouped(sections)); };
  const app = getBackend().kind === "native";
  const publish = app ? trackPaidState(box, onState) : () => {};
  (async () => {
    const base = await vendorOf(source);
    if (!base || !box.isConnected && box.parentNode == null) return publish(null);
    if (!app) return drawSite(st, source, base, draw);
    return drawApp(st, source, base, draw, ctx, box, publish);
  })().catch((e) => {
    draw([{ header: "Purchase", footer: e.message }]);
    publish(paidNav(null, false, { note: e.message }));
  });
  return box;
}

// ---- B11: the nav bar button of a paid package ------------------------------------------------------------
//
// Plain apt can't fetch a paid deb (Havoc answers apt with 418; it comes only through paid.install after the
// vendor authorizes it), so queuing one can only fail. The nav bar button does the Purchase group's next step
// instead: Cydia showed the price there until the package was bought, then Install.

const paidStates = new WeakMap(); // payment box -> { current, ready: Promise, resolve }

function trackPaidState(box, onState) {
  let resolve;
  const entry = { current: undefined, ready: new Promise((r) => { resolve = r; }) };
  entry.resolve = resolve;
  paidStates.set(box, entry);
  return (state) => {
    entry.current = state;
    entry.resolve(state);
    onState?.(state);
  };
}

// The state the nav bar button acts on: null when the box isn't a vendor's paid package in the app (the button
// then works as for any package); waits for the vendor's first answer.
export function paidStateOf(box) {
  const entry = box && paidStates.get(box);
  if (!entry) return Promise.resolve(null);
  return entry.current !== undefined ? Promise.resolve(entry.current) : entry.ready;
}

// From the vendor's package info: the button's label, and the actions its sheet offers (the Purchase group's own
// row: Sign In, Buy, or Download & Install), `install` set only once the vendor lets this account download it.
// `info` null: the vendor couldn't be asked; nothing to offer, and `note` says why.
export function paidNav(info, signedIn, { vendorName = "the vendor", signIn = null, buy = null, install = null,
  signInLabel = null, note = null, freeInstall = null } = {}) {
  const price = info?.price ?? null;
  const priced = price && !isFreePrice(price);
  if (!info) return { label: "Install", purchased: false, install: null, actions: [], note: note ?? null };
  if (!info.available) return { label: priced ? price : "Install", purchased: false, install: null, actions: [],
    note: `Not available to buy from ${vendorName}.` };
  // F319: signed out, a FREE package the vendor calls purchased (Chariz's betterAlarm) installs without Sign In
  // (`freeInstall`: a tokenless authorize_download that falls back to Sign In); Sign In stays on offer below it.
  if (!signedIn && freeInstall && freeSignedOut(info)) return { label: "Install", purchased: true, install: freeInstall,
    actions: [{ label: "Download & Install", run: freeInstall },
      ...(signIn ? [{ label: signInLabel || `Sign In to ${vendorName}`, run: signIn }] : [])], note: null };
  if (!signedIn) return { label: priced ? price : "Install", purchased: false, install: null,
    actions: signIn ? [{ label: signInLabel || `Sign In to ${vendorName}`, run: signIn }] : [], note: `Sold by ${vendorName}. Sign in to buy or install it.` };
  if (!info.purchased) return { label: priced ? price : "Install", purchased: false, install: null,
    actions: buy ? [{ label: buyLabel(price), run: buy }] : [], note: `Sold by ${vendorName}.` };
  return { label: "Install", purchased: true, install,
    actions: install ? [{ label: "Download & Install", run: install }] : [], note: null };
}

// F319: the vendor gives this package away and says so without a token: {price FREE, purchased true, available}.
export const freeSignedOut = (info) => !!(info?.available && info.purchased && isFreePrice(info.price));

// F319: the one-time URL for a signed-out free package: authorize_download without a token (core/payment.js F318).
// Any refusal offers Sign In instead (an alert: Cancel / Sign In); answers the URL, or null when there is none.
export async function authorizeFree(client, id, ask, { signIn, alert = showAlert, vendorName = "the vendor" } = {}) {
  try {
    return await client.authorizeDownload(id, { ...ask, tokenless: true });
  } catch {
    const { index } = await alert({ title: "Download & Install",
      message: `${vendorName} wants you to sign in before it hands out this package.`, buttons: ["Cancel", "Sign In"] });
    if (index === 1) await signIn?.();
    return null;
  }
}

const buyLabel = (price) =>`Buy${price ? ` for ${isFreePrice(price) ? "Free" : price}` : ""}`;

async function drawSite(st, source, base, draw) {
  const host = new URL(base).hostname.replace(/^www\./, "");
  const link = { label: `Buy from ${host}`, href: vendorPage(st, base), chevron: true };
  draw([{ header: "Purchase", rows: [{ label: "Price", detail: "…" }, link] }]);
  markExternal();
  const price = await sitePrice(st, source).catch(() => null);
  const rows = [{ label: "Price", detail: price ?? "Paid" }, link];
  draw([{ header: "Purchase", rows,
    footer: "Paid through the source's vendor. Buy there, then install with a package manager on the phone." }]);
  // A real link that leaves the site: open it in a new tab.
  markExternal();
}

function markExternal() {
  for (const box of document.querySelectorAll(".payment-box")) {
    for (const a of box.querySelectorAll("a.cell-inner[href^='http']")) { a.target = "_blank"; a.rel = "noopener"; }
  }
}

// B12: what a busy row's job answers when the user closed the vendor's sheet: no alert, and nothing to draw again.
export const CANCELLED = Symbol("cancelled");

// A Purchase row's action: the HUD while the job runs, then the page drawn again; an error goes to `fail` (the
// Purchase alert). A job that answers CANCELLED just takes the HUD down and leaves the page as it was (Sileo does).
export function busyAction(label, job, { hud, fail, refresh }) {
  return async () => {
    const hide = hud(label);
    let r;
    try { r = await job(); } catch (e) { hide(); await fail(e); return; }
    hide();
    if (r !== CANCELLED) refresh();
  };
}

// Sign In: the vendor's page in ASWebAuthenticationSession. auth.session answers null when the user tapped Cancel
// (Paid.swift, canceledLogin): CANCELLED, silently. A callback finishSignIn can't read is still an error.
export async function vendorSignIn(client, call = shell) {
  const cb = await call("auth.session", { url: await client.authenticateUrl(), callbackScheme: "sileo" });
  if (cb == null) return CANCELLED;
  if (!(await client.finishSignIn(cb))) throw new Error(`The vendor sent nothing back that ${NAME} could read.`);
}

// B13: the Price row's detail. "Free" for a package the vendor gives away (Chariz answers purchased: true for those
// even signed out), "Purchased" only for a signed-in account that owns it, else the vendor's price (or "Paid").
export function priceDetail(info, signedIn) {
  if (isFreePrice(info?.price)) return "Free";
  if (signedIn && info?.purchased) return "Purchased";
  return info?.price ?? "Paid";
}

async function drawApp(st, source, base, draw, ctx, box, publish = () => {}) {
  const client = clientFor(base);
  const id = st.package;
  const refresh = () => drawApp(st, source, base, draw, ctx, box, publish);
  const fail = async (e) => {
    const buttons = e.recoveryUrl ? ["OK", "More Info"] : ["OK"];
    const { index } = await showAlert({ title: "Purchase", message: e.message, buttons });
    if (index === 1) window.open(e.recoveryUrl, "_blank", "noopener");
    if (e.invalidate) refresh();
  };
  const busy = (label, job) => busyAction(label, job, { hud: ctx?.showHUD ?? showHUD, fail, refresh });
  let info = null, vendor = null, signedIn = false;
  try {
    [vendor, signedIn] = await Promise.all([client.info().catch(() => null), client.signedIn()]);
    info = await client.packageInfo(id);
  } catch (e) {
    publish(paidNav(null, false, { note: e.message }));
    if (e instanceof NeedsShell) return draw([{ header: "Purchase", rows: [{ label: "Price", detail: "Paid" }], footer: e.message }]);
    return draw([{ header: "Purchase", footer: e.message }]);
  }
  const name = vendor?.name || new URL(base).hostname;
  const rows = [{ label: "Price", detail: priceDetail(info, signedIn) }];
  const signIn = busy("Signing In", () => vendorSignIn(client));
  const buy = busy("Purchasing", async () => {
    const r = await client.purchase(id);
    if (r.status === "action") await shell("auth.session", { url: r.url, callbackScheme: "sileo" });
    else if (r.status !== "done") throw new Error("The purchase did not go through.");
  });
  const install = () => downloadAndInstall(st, source, client, box, ctx, fail);
  const freeInstall = () => downloadAndInstall(st, source, client, box, ctx, fail, { free: { signIn, vendorName: name } });
  // B11: the nav bar button offers the same step as the row below (paidNav), so both stay in step.
  const nav = paidNav(info, signedIn, { vendorName: name, signIn, buy, install, freeInstall,
    signInLabel: vendor?.banner?.button || null });
  if (!info.available) rows.push({ label: "Not available to buy" });
  for (const a of nav.actions) rows.push({ label: a.label, onClick: a.run });
  if (signedIn) rows.push({ label: `Sign Out of ${name}`, onClick: busy("Signing Out", () => client.signOut()) });
  const footer = vendor?.banner && !signedIn ? vendor.banner.message : `Sold by ${name}.`;
  // B183: the price came without this iPhone's UDID (the shell has none yet): say so, as Sign In and Buy need it.
  const udidNote = info.deviceError ? ` ${info.deviceError.replace(/^device:\s*/, "").replace(/^./, (c) => c.toUpperCase()).replace(/([^.])$/, "$1.")}` : "";
  // F314: the UDID note is a second hint: its own group (AGENTS.md, Hints), never joined to the seller's footer
  draw(purchaseSections(rows, footer, udidNote.trim()));
  publish(nav);
}

export const purchaseSections = (rows, footer, note = "") =>
  [{ header: "Purchase", rows, footer }, ...(note ? [{ footer: note }] : [])];

// B11: true when `st` is a paid package on a source whose vendor sells it (payment_endpoint): apt can't fetch it.
export async function soldByVendor(st, source) {
  if (!isCommercial(st) || !source) return false;
  return (await vendorOf(source).catch(() => null)) != null;
}

// B19: the ids among catalog rows (`paid`: tagged cydia::commercial; `key`: their source) that the source's vendor
// sells (payment_endpoint), which apt can't fetch: Changes' Upgrade (N) leaves them out (their pages offer Download
// & Install). `sources`: the backend's list; `sells(source)` -> whether it has a vendor. Failures count as not sold.
export async function vendorSoldIds(rows = [], sources = [], { sells = (s) => vendorOf(s).then((b) => b != null, () => false) } = {}) {
  const byKey = new Map((sources ?? []).map((s) => [s?.key, s]));
  const out = new Set();
  await Promise.all((rows ?? []).filter((r) => r?.id && r.paid && byKey.has(r.key)).map(async (r) => {
    if (await Promise.resolve().then(() => sells(byKey.get(r.key))).catch(() => false)) out.add(r.id);
  }));
  return out;
}

// F74: authorize (under a HUD: the vendor can refuse), then paid.install in the install queue's console, streamed
// (Paid.swift's dlstatus/pmstatus lines). The one-time URL expires in a minute or two, so the console opens at once.
// After the run dpkg status is read again and the package page drawn again: Installed, and Modify > Remove works.
// F319: `free` ({ signIn, vendorName }) asks without a token (authorizeFree); a refusal offers Sign In, no error.
async function downloadAndInstall(st, source, client, box, ctx, fail, { free = null } = {}) {
  const id = st.package;
  // The page the row is on, and its route (the top page's: the console is modal, so it stays on top).
  const body = box.closest(".page-body");
  const route = parse(location.hash);
  const hide = (ctx?.showHUD ?? showHUD)("Authorizing");
  const ask = { version: st.version, repo: source.uri, architecture: st.architecture || getArch() };
  let url;
  if (free) {
    let hidden = false;
    const hideOnce = () => { if (!hidden) { hidden = true; hide(); } };
    url = await authorizeFree(client, id, ask, { ...free,
      alert: (opts) => { hideOnce(); return showAlert(opts); } });
    hideOnce();
    if (!url) return;
  } else {
    try { url = await client.authorizeDownload(id, ask); } catch (e) { hide(); await fail(e); return; }
    hide();
  }
  const run = runPaidInstall({ id, version: st.version, name: st.name || "",
    run: (onEvent) => shell("paid.install", { url, package: id, version: st.version, stream: true }, onEvent) });
  if (!run) {
    await showAlert({ title: "Download & Install", message: "Another install is running. Try again when it has finished.", buttons: ["OK"] });
    return;
  }
  const { reloaded } = await run;
  await reloaded;
  if (body?.isConnected) await redrawPage(body, route, ctx);
}

// The package page drawn again in place (browse.js render), at the same scroll position. Imported late: browse.js
// imports this file.
async function redrawPage(body, route, ctx) {
  const top = body.scrollTop;
  const { render, pageOf } = await import("./browse.js");
  if (pageOf(route).page !== "package") return;
  await render(body, route, ctx);
  body.scrollTop = top;
}
