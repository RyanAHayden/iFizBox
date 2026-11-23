// F77: My IPAs, under Installed (#/installed/myipas): the user's own IPAs, signed with their certificate.
// F79: the page is Install IPAs, reached from Home's tile. F224 (user 2026-11-18): one page for the user's own IPAs only
// (browsing source apps is Sources' and Search's): back | Install IPAs | Manage; a search bar over the IPAs, an
// 'Add an IPA' group (Choose from Files, Download from URL; the website's Choose File), then Not Installed and
// Installed, A-Z, each row with iOS 6's App Store price button (grey SIGN, a first tap turns it green INSTALL, the
// second is the IPA page's Install, Confirm and all; installed rows OPEN). A left swipe shows Delete in place of the
// button (deletes at once); Manage is Installed's (F222): select circles, Select… presets, the grey summary line and a
// Sign / Unsign / Delete toolbar, each confirmed by an action sheet, then the 1-of-n HUD.
//
//   #/installed/myipas                      Install IPAs (above)
//   #/installed/myipas/search, /apps, /category:<name> and below   F79's Browse pages, kept for older links only
//   .../package:<id> and deeper             browse.js's pages (an app's page, Version History)
//   #/installed/myipas/ipa:<file>           an IPA's page, like a package page: header, Install (nav bar), Sign
//                                           Options, Sign Now, Save Signed IPA, details, Delete
//   #/installed/myipas/ipa:<file>/options   Sign Options: name, bundle ID, icon, extensions, arm64e fix-up
//
// In the sideload app the files live in iFizBox's Documents (Files > On My iPhone > iFizBox) and the shell signs them
// (signing-client.js libraryCall, native/Sources/MyIPAs.swift); an IPA page's Install queues it in the IPA queue
// (F241, queueLibraryInstall) while the Signing Server answers. F212: the jailbreak app uses the same library (its
// Documents is /var/mobile/Documents) but doesn't sign: an IPA's page is its details and Delete, and Install runs
// Install IPA's console over library.helperInstall (ifizbox-helper installs the file as it is). On the website there is no signer on the phone:
// Add is Choose File (F197: the IPA is kept in this browser's IndexedDB and Install signs it here, signInBrowser with
// its bytes) or From URL; links are kept on this device, and a link's Install is an app page's (F95, user 2026-11-18: no
// Open in iFizBox / Get in AltStore / SideStore / Feather): it signs in the browser (F93), and until that lands it says
// the certificate is needed, with Download IPA (altstore.js siteCertificateAlert).
// Rules and labels: core/myipas.js.
// SPDX-License-Identifier: GPL-3.0-or-later
import { grouped, placeholder, el, note } from "../nav/ui.js";
import { searchBar, pinned } from "../nav/searchbar.js";
import * as browse from "./browse.js";
import { catalog, ALL } from "../catalog.js";
import { indexLetter } from "../core/catalog.js";
import { withLetterHeaders } from "../nav/vlist.js";
import { format, mounted, parse, settingsRoute } from "../router.js";
import { showAlert } from "../nav/alert.js";
import { showActionSheet } from "../nav/actionsheet.js";
import { showHUD } from "../nav/hud.js";
import { selectPreset } from "../nav/selection.js";
import { cleanSourceUrl } from "../core/sources.js";
import { detectMode } from "../core/settings.js";
import { deviceError, phaseLabel, isCgBI, fromBase64 } from "../core/signing.js";
import { apps, recordInstall, onAppsChange } from "../core/installed.js";
import { appQueue } from "../app-queue.js";
import { MYIPAS, libraryRows, stateOf, formatBytes, ipaToken, fileOfToken, optionsParams, siteEntries, addSiteUrl,
  STATE_LABELS, addSiteFile, removeSiteEntry, openIpaStore, memoryIpaStore, listState, listStep, tapOpens,
  deleteSheetTitle, deleteButtonText, deleteEntries, holdActions, HOLD, libraryMode, ipaSections, installedIdOf, priceButton, priceTap, priceAway,
  priceProgress, ipaSelectSheet, ipaSelectLabel, ipaPresetFiles, ipaCounts, ipaSummary, ipaToolbar, ipaSheet, unsignEntries,
  IPA_SELECT, siteTooBig, freshNote } from "../core/myipas.js";
import { mediaUrl } from "./depiction.js";
import { barButton } from "../nav/ui.js";
import { longPress, showMenu, copyText } from "../nav/menu.js";
import { fitFileNames, isFileName } from "../core/midtrunc.js";
import { readIpaFile } from "../core/ipainfo.js";
import { localSigning } from "../signing/common.js";
import { libraryCall, installFromLibrary } from "../signing/library.js";
import { signAndInstall } from "../signing/install.js";
import { openSigning } from "../signing/device.js";
import { handOffIpa } from "../signing/toobig.js";
import { siteCertificateAlert } from "./altstore.js";
import { NAME } from "../brand.js";
import { signingPage } from "../core/signingpage.js"; // C15: Installation & Signing in the sideload build
import { serverReachable } from "../signing/library.js";
import { libraryJob } from "../core/appqueue.js";
import { queueApp } from "./queue.js";
import { storedKeep, originalState, originalNote, OLD_WAY_ALERT, OLD_WAY_TEXT } from "../core/keepid.js";
import { loadStyle } from "../nav/motion.js";
import { go as navGo, back, handleOf } from "../nav/go.js";
import { nativeBridge } from "../native.js";
import { storedRoute, vpnList } from "../core/installroute.js"; // B294
import { USERAPPS, PAGE_TITLE as USERAPPS_TITLE, bundleIdOfToken, userAppTitle, listRow as userAppsRow } from "../core/userapps.js"; // F374

export { MYIPAS };

const view = { body: null, page: null, add: null, search: null, route: null, seq: 0, fresh: null };
const known = new Map(); // file -> the last entry seen (titles, the page before its list call answers)
// F208/F224: the list's swipe and Manage state (core/myipas.js listStep: `editing` is Manage, `armed` the row showing
// Delete, `selected` the picked files), its controller, the bottom toolbar, the IPAs and which of them iOS has, the
// search, the price buttons' state (`armed`: the green INSTALL) and the ones running (file -> { label, fill }).
const lib = { state: listState(), ctl: null, bar: null, list: [], installed: {}, shared: {}, query: "", price: { armed: null }, busy: new Map(),
  manageBtn: null, selectBtn: null, summary: null };

export const PAGE_TITLE = "Install IPAs";

// F79: Browse's own segments below the page: Search, All Apps, a category.
function browseSeg(seg) {
  if (seg === "search" || seg === "apps") return { page: seg };
  if (typeof seg === "string" && seg.startsWith("category:")) return { page: "category", value: seg.slice(9) };
  return null;
}

// Which page a route under Installed is: "list" (Install IPAs), "ipa", "options", F79's "search", "apps",
// "category" and "browse" (browse.js's pages below them), or null (not one of ours).
export function pageOf(route) {
  if (route.path[0] !== MYIPAS) return null;
  if (route.path.length === 1) return { page: "list" };
  const b = browseSeg(route.path[1]);
  if (b) return route.path.length === 2 ? b : { page: "browse" };
  if (route.path[1] === USERAPPS) { // F374: Installed Apps and an app's page (screens/userapps.js)
    if (route.path.length === 2) return { page: "userapps" };
    const id = route.path.length === 3 ? bundleIdOfToken(route.path[2]) : null;
    return id ? { page: "userapp", id } : { page: "missing" };
  }
  const file = fileOfToken(route.path[1]);
  if (!file) return { page: "missing" };
  if (route.path.length === 2) return { page: "ipa", file };
  if (route.path.length === 3 && route.path[2] === "options" && localSigning()) return { page: "options", file };
  return { page: "missing" };
}

// F212: the jailbreak app keeps its IPAs in the shell's library too (/var/mobile/Documents, library.*), installed by
// ifizbox-helper as they are (library.helperInstall); localSigning stays the sideload build's alone (Sign Options,
// Sign Now, Save Signed IPA).
export const listMode = () => libraryMode(detectMode());
const site = () => listMode() === "site";
const jailbreak = () => listMode() === "jailbreak";

export function nav(route) {
  const p = pageOf(route);
  switch (p?.page) {
    case "list": // F224: Manage only (Add is the page's own group); a new list page starts out of Manage
      lib.state = listState();
      lib.price = { armed: null };
      return { title: PAGE_TITLE, right: { label: "Manage", onClick: () => setManaging(!lib.state.editing),
        ref: (b) => { lib.manageBtn = b; b.classList.add("manage-button"); } } };
    case "search": return { title: "Search Apps", style: "plain" };
    case "apps": return { title: "All Apps", style: "plain" };
    case "category": return { title: p.value || "Apps", style: "plain" };
    case "browse": return browse.nav(route);
    case "ipa": return { title: known.get(p.file)?.name || p.file.replace(/\.ipa$/i, ""),
      right: { label: "Install", onClick: () => install(p.file) } };
    case "options": return { title: "Sign Options", right: { label: "Save", onClick: (e) => saveOptions(p.file, e.currentTarget) } };
    case "userapps": return { title: USERAPPS_TITLE, style: "plain" }; // F374
    case "userapp": return { title: userAppTitle(p.id) };
    default: return { title: "Not Found" };
  }
}

export function render(body, route, ctx, nav = handleOf(body)) {
  style();
  const p = pageOf(route);
  if (p?.page === "list") {
    // One wrapper (the first child of a page stretches, ios6.css): the search bar over the IPAs, Add an IPA, the IPAs.
    const page = el("div", "install-ipas");
    view.route = route;
    view.page = nav; // its nav item: Select… goes in the back button's place (syncManage)
    lib.query = "";
    // F257: the link the Too Big alert just kept: its row at the top for this visit, and the note under the bar
    view.fresh = site() ? freshNote() : null;
    // C10: the shared bar (nav/searchbar.js), pinned: the IPAs scroll under it.
    view.search = searchBar({ placeholder: "Search Apps", ariaLabel: "Search IPAs", delay: 120,
      onQuery: (q) => { if (q.trim() !== lib.query) { lib.query = q.trim(); redraw(); } } });
    view.add = el("div", "install-ipas-add");
    view.add.append(grouped(addGroups(site())));
    view.body = el("div", "install-ipas-mine");
    view.body.append(note("Loading"));
    if (view.fresh?.note) page.append(el("p", "myipa-fresh-note", view.fresh.note));
    page.append(view.add, view.body);
    pinned(body, view.search).append(page);
    load();
    return;
  }
  if (p?.page === "search") return renderSearch(body, route);
  if (p?.page === "apps") return renderFiltered(body, route, async () => appsOf(await catalog.list(ALL, ALL)), "Search All Apps");
  if (p?.page === "category") return renderFiltered(body, route, async () => appsOf(await catalog.browse(p.value)), `Search ${p.value}`);
  if (p?.page === "browse") return browse.render(body, route, ctx);
  if (p?.page === "ipa") return renderIpa(body, route, p.file);
  if (p?.page === "options") return renderOptions(body, route, p.file);
  if (p?.page === "userapps") return import("./userapps.js").then((m) => m.renderUserApps(body, route)); // F374
  if (p?.page === "userapp") return import("./userapps.js").then((m) => m.renderUserApp(body, route, p.id));
  body.append(note("Nothing here."));
}

function style() { loadStyle("myipas.css"); loadStyle("signsheet.css"); }

const go = (path) => navGo({ tab: "installed", path });
const ipaPath = (file) => [MYIPAS, ipaToken(file)];

// ---- the library ----------------------------------------------------------------------------------------------

async function entries() {
  if (site()) return { ipas: siteEntries(), identity: false };
  return libraryCall("list", {});
}

function remember(list) {
  for (const e of list ?? []) known.set(e.file, e);
}

async function load() {
  const seq = ++view.seq;
  let r;
  try { r = await entries(); } catch (e) {
    if (seq === view.seq) view.body.replaceChildren(note(deviceError(e).message));
    return;
  }
  if (seq !== view.seq || !view.body) return;
  remember(r?.ipas);
  draw(r?.ipas ?? []);
  refreshInstalled(r?.ipas ?? [], seq);
}

// Which IPAs iOS has: the apps.isInstalled answer per bundle ID, then redrawn when it changed.
async function refreshInstalled(list, seq) {
  let map;
  let shared;
  try { map = await installedOf(list, { mode: listMode() }); shared = await sharedInstalls(list, map); } catch { return; }
  if (seq !== view.seq || !view.body?.isConnected) return;
  const same = JSON.stringify(map) === JSON.stringify(lib.installed) && JSON.stringify(shared) === JSON.stringify(lib.shared);
  lib.installed = map;
  lib.shared = shared;
  if (!same) redraw();
}

// B229: back in front (iOS's install prompt, another app): the library again too, since a row's install through the
// IPA queue keeps its signed copy there (SignAhead.swift), then which IPAs iOS has; redrawn only when it changed.
async function recheck() {
  const seq = view.seq;
  let r = null;
  try { r = await entries(); } catch { /* the list as it is */ }
  if (seq !== view.seq || !view.body?.isConnected) return;
  if (Array.isArray(r?.ipas) && JSON.stringify(r.ipas) !== JSON.stringify(lib.list)) { remember(r.ipas); draw(r.ipas); }
  refreshInstalled(lib.list, seq);
}

// F224: { bundleId: true } for the IPAs whose app is on the phone. The apps (both builds): the shell's apps.isInstalled
// (every build, F219); an id it can't answer, and the website, go by Installed's records (recordInstall, F30).
// B229: in the sideload app such an id also counts when the shell's own record of signing it says so
// (signing.installed: kept from when iOS was handed the IPA): on iOS 27 apps.isInstalled can't tell (null for every
// app), and a row's install through the IPA queue writes Installed's record only once iOS confirms, which it never does.
export async function installedOf(list, { mode = listMode(), native = nativeBridge(), records = async () => (await apps()).all(),
  signed = async () => (await native.call("signing.installed", {}))?.apps ?? [] } = {}) {
  const ids = [...new Set((list ?? []).filter((e) => e && !e.error).map(installedIdOf).filter(Boolean))];
  const out = {};
  if (!ids.length) return out;
  let answer = {};
  if (mode !== "site" && typeof native?.call === "function") {
    try { answer = (await native.call("apps.isInstalled", { bundleIds: ids }))?.installed ?? {}; } catch { answer = {}; }
  }
  let recorded = null;
  let shell = null;
  for (const id of ids) {
    if (typeof answer[id] === "boolean") { if (answer[id]) out[id] = true; continue; }
    recorded ??= new Set(((await Promise.resolve().then(records).catch(() => [])) ?? []).map((r) => r?.id));
    if (recorded.has(id)) { out[id] = true; continue; }
    if (mode !== "sideload" || typeof native?.call !== "function") continue;
    // by the installed ID or the IPA's own (an old-way copy, Keep Bundle IDs off, is installed under the profile's)
    shell ??= new Set(((await Promise.resolve().then(signed).catch(() => [])) ?? []).flatMap((r) => [r?.bundleId, r?.originalBundleId]));
    if (shell.has(id)) out[id] = true;
  }
  return out;
}

// B80: Installed's record key for an IPA installed from the library (the file it came from), so two IPAs that share a
// bundle ID can be told apart once one of them is on the phone.
export const libraryKey = (file) => `library:${file}`;
const shownName = (e) => e?.options?.name || e?.name || String(e?.file ?? "").replace(/\.ipa$/i, "");

// B80: { bundleId: { file, name } } for each installed bundle ID that two or more IPAs in the library share. `file`:
// the IPA that matches Installed's record for that ID (its library key first, then the only one with the recorded
// name and version), or null when nothing tells them apart (no record, installed outside the app, a tie). `name`: the
// installed app's name (the record's, else the bundle ID). IDs with one IPA are left out: they stay as before.
export async function sharedInstalls(list, installed = {}, { records = async () => (await apps()).all() } = {}) {
  const byId = new Map();
  for (const e of list ?? []) {
    const id = e && !e.error ? installedIdOf(e) : null;
    if (id && installed?.[id] === true) byId.set(id, [...(byId.get(id) ?? []), e]);
  }
  const out = {};
  const ids = [...byId].filter(([, es]) => es.length > 1);
  if (!ids.length) return out;
  const recs = ((await Promise.resolve().then(records).catch(() => [])) ?? []).filter((r) => r?.id);
  for (const [id, es] of ids) {
    const rec = recs.find((r) => r.id === id) ?? null;
    let match = rec?.key ? es.find((e) => rec.key === libraryKey(e.file)) ?? null : null;
    if (!match && rec) {
      const same = es.filter((e) => [shownName(e), e.name].includes(rec.name) && (e.version || "") === (rec.version || ""));
      if (same.length === 1) [match] = same;
    }
    out[id] = { file: match?.file ?? null, name: rec?.name || id };
  }
  return out;
}

// B80: ipaSections with the shared IDs settled per IPA: only `shared[id].file` is Installed, the others Not Installed
// with "Replaces <name>" ahead of their line (row.replaces: the installed app's name).
export function sharedSections(list, { installed = {}, shared = {}, ...opts } = {}) {
  if (!Object.keys(shared ?? {}).length) return ipaSections(list, { installed, ...opts });
  const all = ipaSections(list, { ...opts, installed: () => false }).flatMap((s) => s.rows);
  const rows = all.map((r) => {
    const id = installedIdOf(r);
    const s = id ? shared[id] : null;
    if (!s || r.error) return { ...r, installed: !r.error && Boolean(id && installed?.[id] === true) };
    if (s.file === r.file) return { ...r, installed: true };
    return { ...r, installed: false, replaces: s.name, line: [`Replaces ${s.name}`, r.line].filter(Boolean).join(" · ") };
  });
  return [
    { key: "notInstalled", header: "Not Installed", rows: rows.filter((r) => !r.installed) },
    { key: "installed", header: "Installed", rows: rows.filter((r) => r.installed) },
  ].filter((s) => s.rows.length);
}

// F257: the row the Too Big alert's Download IPA just added (`file`) in its own group at the top, headed New, for that
// visit; the sections without it below. Unchanged when there is no such row.
export const FRESH_HEADER = "New";
export function freshFirst(sections, file) {
  if (!file) return sections;
  const row = sections.flatMap((s) => s.rows).find((r) => r.file === file);
  if (!row) return sections;
  const rest = sections.map((s) => ({ ...s, rows: s.rows.filter((r) => r.file !== file) })).filter((s) => s.rows.length);
  return [{ key: "new", header: FRESH_HEADER, rows: [{ ...row, fresh: true }] }, ...rest];
}

// B80: the IPA another app with its bundle ID is installed over -> that app's name, else null (not shared, or the match).
export function replacesOf(entry, shared = lib.shared) {
  const id = entry && !entry.error ? installedIdOf(entry) : null;
  const s = id ? shared?.[id] : null;
  return s && s.file !== entry.file ? s.name : null;
}

// B80: before installing an IPA that replaces another app with its ID, an iOS 6 alert: Cancel or Replace.
// -> true to go on (nothing to replace, or Replace tapped).
export async function confirmReplace(entry, { shared = lib.shared, alert = showAlert } = {}) {
  const other = replacesOf(entry, shared);
  if (!other) return true;
  const r = await alert({ title: "Replace App?",
    message: `${other} is already on this iPhone with the same ID. Installing ${shownName(entry)} will replace it.`,
    buttons: ["Cancel", "Replace"], cancel: 0 }).catch(() => null);
  return r?.index === 1;
}

function draw(list) {
  lib.list = list ?? [];
  redraw();
}

// The groups again from lib (a search typed, Manage, iOS's answer, an install's progress).
function redraw() {
  if (!view.body) return;
  const isSite = site();
  const jb = jailbreak();
  const files = libraryRows(lib.list, { site: isSite, jailbreak: jb }).map((r) => r.file);
  lib.state = files.length ? listStep(lib.state, { type: "list", files }) : { ...listState(), editing: lib.state.editing };
  if (lib.price.armed && !files.includes(lib.price.armed)) lib.price = { armed: null };
  lib.ctl = libraryGroup(lib.list, { site: isSite, jailbreak: jb, state: lib.state, installed: lib.installed, shared: lib.shared,
    query: lib.state.editing ? "" : lib.query, price: lib.price, busy: lib.busy, fresh: view.fresh?.file ?? null,
    on: { change: onListChange, delete: (es) => swipeDelete(es), hold: (e) => holdSheet(e), price: (r) => onPrice(r) } });
  view.body.replaceChildren(lib.ctl.el);
  onListChange(lib.state);
}

// The Add an IPA group: the app's Files picker and a download; the website's Choose File (kept in this browser) and a link.
export function addGroups(isSite, { jailbreak: jb = jailbreak() } = {}) {
  const groups = [{ header: "Add an IPA", rows: [
    { label: isSite ? "Choose File" : "Choose from Files", onClick: () => (isSite ? chooseSiteFile() : pickFiles()), chevron: false },
    { label: "Download from URL", onClick: () => addFromUrl(), chevron: false },
  ] }];
  // F374: the jailbreak app makes IPAs of the apps on the phone too (Installed Apps: Decrypt, Add Tweaks)
  if (jb && !isSite) groups[0].rows.push(userAppsRow(format({ tab: "installed", path: [MYIPAS, USERAPPS] })));
  return groups;
}

// Under the last group: how else IPAs get here. F212: the jailbreak app's Documents is /var/mobile/Documents, which the
// Files app doesn't show; the website keeps what is chosen in this browser.
export function libraryEmptyText(site, { jailbreak = false } = {}) {
  if (!site && jailbreak) return "No IPAs yet. Choose one in Files, download one, or put IPAs in /var/mobile/Documents.";
  return site
    ? "No IPAs yet. Choose an IPA in Files (kept in this browser, signed here when you install it) or keep a link to one."
    : `No IPAs yet. Choose one in Files, download one, share an .ipa to ${NAME} from Files, Safari or Mail, or put IPAs in Files under On My iPhone > ${NAME}.`;
}

export function libraryFooterText(site, { jailbreak = false } = {}) {
  if (site) return "IPAs you choose are kept in this browser and signed here when you install them.";
  if (jailbreak) return `You can also share an .ipa to ${NAME} from Files, Safari or Mail, or put it in /var/mobile/Documents.`;
  return `You can also share an .ipa to ${NAME} from Files, Safari or Mail.`;
}

// ---- F208: managing the list: swipe to Delete, Edit (red minus, multi-select, toolbar), hold for a sheet ----------
//
// The rows wear Installed's and Sources' delete controls (sources.css .source-row: the red minus slides in with
// .editing, the red Delete opens with .armed), with Installed's swipe (B36 attachRowGestures: a left swipe arms the
// row, a right one or a tap puts it away). Editing, a tap on a row ticks it (.picked) for the toolbar's Delete (n).
// The state is core/myipas.js listStep's; this only draws it.

// The IPAs' groups for `list`: Not Installed, then Installed (core/myipas.js ipaSections), the footer under the last.
// -> { el (a div holding the groups), ul (that div), rows (the rows shown, in order), sections, state, step(action),
// cellOf(file), price(file) (the row's price button) }. on.change(state) after each step, on.delete([row]) for a row's
// Delete, on.hold(row) for a held row, on.price(row) for a tap on its price button.
export function libraryGroup(list, { site: isSite = site(), jailbreak: jb = jailbreak(), state = listState(), installed = {}, query = "",
  price = { armed: null }, busy = new Map(), on = {}, shared = {}, fresh = null } = {}) {
  const sections = freshFirst(sharedSections(list, { installed, shared, query, site: isSite, jailbreak: jb }), fresh);
  const rows = sections.flatMap((s) => s.rows);
  const any = libraryRows(list, { site: isSite, jailbreak: jb }).length > 0;
  const groups = sections.map((s, i) => ({ header: s.header, rows: s.rows.map((r) => ({
    label: r.title, subtitle: r.line, icon: { text: r.title.charAt(0).toUpperCase() },
    href: format({ tab: "installed", path: ipaPath(r.file) }),
  })), footer: i === sections.length - 1 ? libraryFooterText(isSite, { jailbreak: jb }) : "" }));
  if (!sections.length) groups.push({ footer: any ? "No Results" : libraryEmptyText(isSite, { jailbreak: jb }) });
  const box = el("div", "myipa-groups");
  box.append(grouped(groups));
  const cells = [...box.querySelectorAll(".cell")];
  const byFile = new Map();
  const buttons = new Map();
  const ctl = {
    el: box, ul: box, rows, sections, state,
    cellOf: (file) => byFile.get(file) ?? null,
    price: (file) => buttons.get(file) ?? null,
    step(a) {
      const next = listStep(ctl.state, a);
      if (next === ctl.state) return next;
      ctl.state = next;
      paint();
      on.change?.(next);
      return next;
    },
  };
  rows.forEach((r, i) => {
    const li = cells[i];
    li.classList.add("myipa-row", `is-${r.state.kind}`, "source-row", "manage-row");
    li.dataset.file = r.file;
    li._ipa = r;
    byFile.set(r.file, li);
    putIcon(li.querySelector(".cell-icon"), r.icon);
    if (!r.icon && r.iconUrl) putIconUrl(li.querySelector(".cell-icon"), r.iconUrl); // F257: a kept link's app icon
    if (r.fresh) li.classList.add("is-fresh");
    const spec = priceButton(r, { armed: price.armed, busy: busy.get(r.file) ?? null, site: isSite, jailbreak: jb });
    if (spec) {
      const b = Object.assign(document.createElement("button"), { type: "button", className: "price-btn" });
      paintPrice(b, spec, r.title);
      b.addEventListener("click", (e) => { e.preventDefault?.(); e.stopPropagation?.(); on.price?.(r); });
      li.classList.add("has-price");
      li.append(b);
      buttons.set(r.file, b);
    }
    const confirm = Object.assign(document.createElement("button"), { type: "button", className: "del-confirm", textContent: "Delete" });
    confirm.addEventListener("click", () => on.delete?.([r]));
    const circle = Object.assign(document.createElement("span"), { className: "manage-check" });
    circle.setAttribute("aria-hidden", "true");
    li.append(confirm, circle);
  });
  function paint() {
    const s = ctl.state;
    box.classList.toggle("managing", s.editing);
    for (const [file, li] of byFile) {
      li.classList.toggle("armed", s.armed === file);
      li.classList.toggle("picked", s.editing && s.selected.includes(file));
      li.querySelector(".cell-inner")?.setAttribute("aria-selected", String(s.editing && s.selected.includes(file)));
    }
  }
  paint();
  attachLibraryGestures(box, ctl, on);
  fitFileNames(box); // B92: a row named by its file ('opentennis-be…p146.ipa') is cut in the middle, not at the end
  return ctl;
}

// A price button's look from its spec (core/myipas.js priceButton): grey, green (.go), or filling (.busy, --fill).
export function paintPrice(b, spec, name = "") {
  b.textContent = spec.label;
  b.dataset.kind = spec.kind;
  b.classList.toggle("go", Boolean(spec.green));
  b.classList.toggle("busy", spec.kind === "busy");
  b.disabled = spec.kind === "busy";
  b.style.setProperty?.("--fill", String(spec.kind === "busy" ? Math.round((spec.fill ?? 0) * 1000) / 1000 : 0));
  b.setAttribute("aria-label", `${spec.label[0]}${spec.label.slice(1).toLowerCase()} ${name}`.trim());
}

// As Installed's attachRowGestures (B36): a left swipe shows Delete, a right swipe or a tap puts it away; managing,
// a tap picks the row instead of opening it. A hold (nav/menu.js longPress) opens the row's sheet, but not while
// managing or while a Delete shows.
function attachLibraryGestures(ul, ctl, on) {
  let start = null;
  let swiped = false;
  ul.addEventListener("click", (e) => {
    if (e.target.closest(".del-confirm")) return;
    if (swiped) { swiped = false; e.preventDefault(); e.stopPropagation(); return; } // B315: a swipe's lift on the button signs nothing
    if (e.target.closest(".price-btn")) return;
    const li = e.target.closest(".myipa-row");
    if (!li || tapOpens(ctl.state)) return;
    e.preventDefault();
    e.stopPropagation();
    ctl.step({ type: "tap", file: li.dataset.file });
  }, true);
  ul.addEventListener("pointerdown", (e) => {
    const li = e.target.closest(".myipa-row");
    swiped = false;
    start = li && !ctl.state.editing && !e.target.closest(".del-confirm") ? { li, x: e.clientX, y: e.clientY } : null;
  });
  ul.addEventListener("pointermove", (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { start = null; return; } // a scroll
    if (Math.abs(dx) < 30 || Math.abs(dx) < Math.abs(dy) * 2) return;
    start.li.querySelector(".cell-inner")?.classList.remove("is-pressed");
    ctl.step({ type: "swipe", file: start.li.dataset.file, dir: dx < 0 ? "left" : "right" });
    swiped = true;
    start = null;
  });
  const stop = () => { start = null; };
  ul.addEventListener("pointerup", stop);
  ul.addEventListener("pointercancel", stop);
  longPress(ul, ".myipa-row", (li) => {
    if (ctl.state.editing || ctl.state.armed || !li._ipa) return;
    li.querySelector(".cell-inner")?.classList.remove("is-pressed");
    on.hold?.(li._ipa);
  });
}

// ---- F224: Manage, as Installed's (F222): circles, Select…, the grey line, the Sign / Unsign / Delete toolbar ---------

// Manage on or off: Done (blue) or Manage on the right; Select… in the back button's place; the search bar and Add
// an IPA hide; the circles slide in (packages.css .manage-check); the grey line and the toolbar come or go.
export function setManaging(on) {
  if (!lib.ctl) { lib.state = on ? listStep(lib.state, { type: "edit" }) : listState(); onListChange(lib.state); return; }
  if (on && lib.query) { lib.query = ""; if (view.search?.set) view.search.set(""); else { const input = view.search?.querySelector?.("input"); if (input) input.value = ""; } }
  lib.price = { armed: null };
  if (on) { lib.state = listStep(lib.state, { type: "edit" }); redraw(); } else lib.ctl.step({ type: "done" });
}

function onListChange(s) {
  lib.state = s;
  syncManage();
}

// The rows Manage counts and picks from: every IPA (the search is cleared and hidden while managing).
const manageRows = () => lib.ctl?.rows ?? [];

// Select…'s sheet (All IPAs, Not Installed (n), Signed (n), Cancel) picks a preset in place of the selection; with every
// row picked the button is Deselect, which drops it. -> the preset, "none" (Deselect), or null (Cancel).
export async function selectButton({ sheet = showActionSheet, ctl = lib.ctl } = {}) {
  const rows = ctl?.rows ?? [];
  return selectPreset({
    selecting: ipaSelectLabel(rows, ctl?.state.selected) === IPA_SELECT,
    options: () => ipaSelectSheet(rows),
    apply: (preset) => ctl?.step({ type: "selectAll", files: ipaPresetFiles(rows, preset) }),
    clear: () => ctl?.step({ type: "deselectAll" }),
    sheet,
  });
}

function syncManage() {
  if (typeof document === "undefined") return;
  const on = lib.state.editing;
  const rows = manageRows();
  const b = lib.manageBtn;
  if (b) { b.textContent = on ? "Done" : "Manage"; b.classList.toggle("done", on); b.hidden = !on && !rows.length; }
  if (view.search) view.search.hidden = on;
  if (view.add) view.add.hidden = on;
  // The grey line above the IPAs.
  if (on && view.body) {
    if (!lib.summary) lib.summary = el("p", "manage-summary");
    lib.summary.textContent = ipaSummary(rows, lib.state.selected);
    if (lib.summary.parentNode !== view.body.parentNode) view.body.before?.(lib.summary);
  } else lib.summary?.remove();
  // Select… in the back button's place (the nav bar's left side).
  const left = b && view.page?.left();
  if (left) {
    for (const x of left.children) if (x !== lib.selectBtn) x.hidden = on;
    if (on) {
      if (!lib.selectBtn) {
        lib.selectBtn = barButton(IPA_SELECT, "manage-select");
        lib.selectBtn.addEventListener("click", () => selectButton());
      }
      lib.selectBtn.textContent = ipaSelectLabel(rows, lib.state.selected);
      if (lib.selectBtn.parentNode !== left) left.append(lib.selectBtn);
    } else lib.selectBtn?.remove();
  }
  syncToolbar();
}

// The bottom toolbar (packages.css .manage-toolbar, Installed's): Sign (blue, the Done button's look), Unsign, Delete (red).
function toolbar() {
  if (lib.bar) return lib.bar;
  const bar = el("div", "manage-toolbar myipa-toolbar");
  bar.setAttribute("role", "toolbar");
  const buttons = { sign: barButton("Sign", "done ipa-sign"), unsign: barButton("Unsign", "ipa-unsign"),
    delete: barButton("Delete", "manage-delete ipa-delete") };
  for (const [kind, x] of Object.entries(buttons)) x.addEventListener("click", () => runManage(kind));
  bar.append(buttons.sign, buttons.unsign, buttons.delete);
  lib.bar = { el: bar, buttons };
  return lib.bar;
}

function listShown() {
  return Boolean(view.body?.isConnected && view.route && format(mounted(parse(location.hash))) === format(view.route));
}

function syncToolbar() {
  const show = lib.state.editing && listShown();
  if (!show && !lib.bar) return;
  const { el: bar, buttons } = toolbar();
  if (show) {
    const opts = { site: site(), jailbreak: jailbreak() };
    const specs = ipaToolbar(ipaCounts(manageRows(), lib.state.selected, opts), opts);
    for (const [kind, x] of Object.entries(buttons)) x.hidden = !specs.some((s) => s.kind === kind);
    for (const s of specs) { buttons[s.kind].textContent = s.label; buttons[s.kind].disabled = s.disabled; }
    if (!bar.isConnected) document.body.append(bar);
    requestAnimationFrame(() => requestAnimationFrame(() => { if (lib.state.editing) bar.classList.add("shown"); }));
  } else {
    bar.classList.remove("shown");
  }
  document.documentElement.classList.toggle("has-manage-toolbar", show);
}

// Leaving the page (another tab, Back) ends Manage, so the toolbar never shows over another page.
if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => { if (lib.state.editing && !listShown()) setManaging(false); });
  // Back from iOS's install prompt or another app: which IPAs are installed may have changed.
  document.addEventListener?.("visibilitychange", () => { if (document.visibilityState === "visible" && listShown()) recheck(); });
  // B277: an app out of the IPA queue (installed, or cleared) or Installed's records changed: the list and the IPA's
  // page read the library again (its signed copy, which IPA is on the phone), even under the run's page
  appQueue.subscribe((e) => { if (e.type === "clear" || e.type === "clearAll") afterInstall(); });
  onAppsChange(() => afterInstall());
  // A tap anywhere but a green INSTALL puts it back to SIGN (as the App Store's confirm button).
  document.addEventListener?.("pointerdown", (e) => {
    if (!lib.price.armed || e.target?.closest?.(".price-btn")) return;
    lib.price = priceAway(lib.price);
    repaintPrices();
  }, true);
}

// B277: after an install from the IPA queue (an IPA's own Install, Confirm, the run's page): Install IPAs reads the
// library and which IPAs iOS has again (recheck), and the IPA's page is drawn again, while they are on a stack (not
// only on screen: the list sits under the IPA's page). Several changes at once draw once. The IPA's page is drawn
// again only when its library entry changed (ipaChanged), so an unrelated app's change never blanks it.
let againSoon = false;
export async function ipaChanged(shown, { read = entryOf } = {}) {
  if (!shown?.body?.isConnected || shown.drawn == null) return false;
  let now;
  try { now = await read(shown.file); } catch { return false; }
  return shown.body.isConnected && JSON.stringify(now) !== shown.drawn;
}
export function afterInstall({ list = () => { if (view.body?.isConnected) recheck(); },
  page = async () => {
    const v = view.ipa;
    if (!v?.body?.isConnected) { if (view.ipa === v) view.ipa = null; return; }
    if (await ipaChanged(v) && view.ipa === v) rerender(v.body, v.route);
  } } = {}) {
  if (againSoon) return;
  againSoon = true;
  setTimeout(() => { againSoon = false; list(); page(); }, 0);
}

// The price buttons again from lib (armed, busy) without rebuilding the rows.
function repaintPrices() {
  if (!lib.ctl) return;
  for (const r of lib.ctl.rows) {
    const b = lib.ctl.price(r.file);
    const spec = priceButton(r, { armed: lib.price.armed, busy: lib.busy.get(r.file) ?? null, site: site(), jailbreak: jailbreak() });
    if (b && spec) paintPrice(b, spec, r.title);
  }
}

// A toolbar button: the confirm sheet, then each picked IPA in turn behind the 1-of-n HUD; Manage ends and the list
// loads again. -> true when it went ahead.
export async function runManage(kind, { rows = manageRows(), selected = lib.state.selected, isSite = site(), isJailbreak = jailbreak(),
  sheet = showActionSheet, alert = showAlert, hud = showHUD, call = libraryCall, store = siteStore, storage = globalThis.localStorage,
  sign = signMany, done = () => { setManaging(false); refresh(); } } = {}) {
  const sel = new Set(selected ?? []);
  const opts = { site: isSite, jailbreak: isJailbreak };
  let picked = rows.filter((r) => sel.has(r.file));
  if (kind === "sign") picked = picked.filter((r) => !isJailbreak && !r.error && (!isSite || r.stored));
  if (kind === "unsign") picked = picked.filter((r) => !isSite && !isJailbreak && r.signed);
  if (!picked.length) return false;
  const s = ipaSheet(kind, picked, opts);
  if (await sheet({ title: s.title, buttons: [s.button], ...(s.destructive ? { destructive: 0 } : {}) }) !== 0) return false;
  if (kind === "sign") { await sign(picked, { isSite }); done(); return true; }
  const verb = kind === "unsign" ? "Unsigning" : "Deleting";
  const n = picked.length;
  const failed = [];
  let ipas = null;
  for (let i = 0; i < n; i++) {
    const e = picked[i];
    const hide = hud(`${verb} ${e.title || e.file} (${i + 1} of ${n})`);
    const r = kind === "unsign" ? await unsignEntries([e], { call })
      : await deleteEntries([e], { site: isSite, store, call, storage });
    hide?.();
    if (r.ipas) ipas = r.ipas;
    if (kind === "delete") for (const f of r.deleted) known.delete(f);
    for (const f of r.failed) failed.push(`${e.title || f.file}: ${isSite ? f.message : deviceError(f.error).message}`);
  }
  if (ipas) remember(ipas);
  done();
  if (failed.length) await alert({ title: kind === "unsign" ? "Couldn't Unsign" : "Couldn't Delete", message: failed.join("\n"), buttons: ["OK"] });
  return true;
}

// Sign (n): each picked IPA signed and installed in turn (installFromLibrary; the website signs a kept file in this
// browser), its progress page labelled "Signing Delta (1 of 3)" (Installed's bulkHud). The first that doesn't install
// (an error, already shown; no connection; the walkthrough) stops the run.
export async function signMany(picked, { isSite = site(), install = installFromLibrary, siteInstall = siteFileInstall, hudFor = null,
  confirm = confirmReplace } = {}) {
  const n = picked.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const e = picked[i];
    if (!(await confirm(e))) { out.push("cancelled"); continue; } // B80: Cancel on Replace App? skips that one
    const name = e.options?.name || e.name || e.file.replace(/\.ipa$/i, "");
    const onInstalled = recorder(e, name);
    let r;
    if (isSite) r = await siteInstall(e, { onInstalled });
    else {
      const hud = hudFor ? hudFor(name, i + 1, n) : await bulkHudFor(name, i + 1, n);
      r = await install({ file: e.file, name, signed: Boolean(e.signed), onInstalled }, { hud });
    }
    out.push(r);
    if (isSite ? r === false : r !== "installed") break;
  }
  return out;
}

async function bulkHudFor(name, i, n) {
  const [{ bulkHud }, { progressHUD }] = await Promise.all([import("./installed.js"), import("../nav/progress.js")]);
  return bulkHud(progressHUD, { verb: "Signing", name, i, n });
}

// Installed's record once iOS has the app (F30), as Install's.
function recorder(entry, name) {
  return (r) => {
    if (!r?.bundleId) return;
    apps().then((s) => recordInstall(s, { id: r.bundleId, name: r.name || name, version: r.version || entry?.version || "",
      key: entry?.file ? libraryKey(entry.file) : null, source: null,
      sourceName: "My IPAs", icon: (entry?.options?.icon || entry?.icon) ? `data:image/png;base64,${entry.options?.icon || entry.icon}` : null })).catch(() => {});
  };
}

// A row's swipe Delete: the IPA file and its signed copy go at once (no sheet, as Mail's), then the list again.
export async function swipeDelete(es, { alert = showAlert, isSite = site(), store = siteStore, call = libraryCall, storage = globalThis.localStorage } = {}) {
  if (!es?.length) return null;
  for (const e of es) lib.ctl?.cellOf(e.file)?.classList.add("removing");
  const r = await deleteEntries(es, { site: isSite, store, call, storage });
  for (const f of r.deleted) known.delete(f);
  lib.state = listStep(lib.state, { type: "deleted", files: r.deleted });
  if (r.failed.length) {
    for (const f of r.failed) lib.ctl?.cellOf(f.file)?.classList.remove("removing");
    const names = r.failed.map((f) => es.find((e) => e.file === f.file)?.title || f.file);
    const why = isSite ? r.failed[0].message : deviceError(r.failed[0].error).message;
    await alert({ title: "Couldn't Delete", message: `${names.join(", ")}: ${why}`, buttons: ["OK"] });
  }
  if (r.ipas && view.body?.isConnected) { remember(r.ipas); draw(r.ipas); } else refresh();
  return r;
}

// The hold sheet's Delete: asks first ('Delete n IPAs' red / Cancel), then as the swipe's.
export async function deleteMany(es, { sheet = showActionSheet, isSite = site(), isJailbreak = jailbreak(), ...rest } = {}) {
  if (!es?.length) return null;
  const n = es.length;
  const i = await sheet({ title: deleteSheetTitle(n, { site: isSite, jailbreak: isJailbreak, stored: es.some((e) => e.stored) }),
    buttons: [deleteButtonText(n)], destructive: 0 });
  if (i !== 0) return null;
  return swipeDelete(es, { isSite, ...rest });
}

// ---- F224: the price button: SIGN, then INSTALL (green), which is the IPA page's Install; OPEN ------------

async function onPrice(r) {
  if (lib.state.armed) { lib.ctl?.step({ type: "tap", file: lib.state.armed }); return; } // a tap only puts a Delete away
  const opts = { site: site(), jailbreak: jailbreak(), busy: lib.busy.get(r.file) ?? null };
  const { state, act } = priceTap(lib.price, r, opts);
  lib.price = state;
  repaintPrices();
  if (act === "open") return openApp(r);
  if (act === "install") return install(r.file, r); // the IPA page's Install: Confirm in the sideload app (user 2026-11-19)
}

async function openApp(r, { native = nativeBridge(), alert = showAlert } = {}) {
  const name = r.options?.name || r.name || r.title;
  if (!site() && !jailbreak() && typeof native?.call === "function") {
    try { if ((await native.call("signing.openApp", { bundleId: installedIdOf(r) }))?.opened) return true; } catch { /* below */ }
    await alert({ title: "Couldn't Open", message: `iOS didn't open ${name}.`, buttons: ["OK"] });
    return false;
  }
  await alert({ title: name, message: `Open ${name} from your Home Screen.`, buttons: ["OK"] });
  return false;
}

// A held row's sheet: Install, Sign Now, Save Signed IPA, Delete (the website: Install, Delete).
async function holdSheet(entry) {
  const buttons = holdActions(entry, { site: site(), jailbreak: jailbreak() });
  if (!buttons.length) return;
  const i = await showActionSheet({ title: entry.title || entry.name || entry.file, buttons, destructive: buttons.indexOf(HOLD.DELETE) });
  const b = buttons[i];
  if (b === HOLD.INSTALL) return install(entry.file);
  if (b === HOLD.SIGN) return signNow(entry, null, null);
  if (b === HOLD.SAVE) return saveSigned(entry, null, null);
  if (b === HOLD.DELETE) return deleteMany([entry]);
}

// ---- F79's Browse pages (Search Apps, All Apps, a category), kept for older links: F224 took Browse off the page ----

// The catalog's rows that are AltStore apps (core/catalog.js slim: kind "ipa"); APT packages stay out.
export const appsOf = (rows) => (rows ?? []).filter((r) => r?.kind === "ipa");

// All Apps and a category: their list with a search bar that narrows this list only.
export const matchApp = (r, q) => [r.name, r.short, r.author, r.id].some((v) => String(v ?? "").toLowerCase().includes(q.toLowerCase()));
async function renderFiltered(body, route, fetchRows, hint) { // hint: the search bar's label (not "placeholder", the loading rows)
  const wait = placeholder("list");
  body.append(wait);
  let rows;
  try { await catalog.ensure(); rows = await fetchRows(); } catch (e) { wait.replaceWith(note(e.message)); return; }
  if (!rows.length) { wait.replaceWith(note("No apps.")); return; }
  wait.remove();
  const lettered = (list) => withLetterHeaders(list, (r) => indexLetter(r.name));
  const none = note("No Results");
  none.hidden = true;
  // C10: the shared bar (nav/searchbar.js), pinned over the list.
  const results = pinned(body, searchBar({ placeholder: "Search Apps", ariaLabel: hint, delay: 120, onQuery: (t) => {
    const q = t.trim();
    const shown = q ? rows.filter((r) => matchApp(r, q)) : rows;
    list.setItems(q ? shown : lettered(shown));
    none.hidden = shown.length > 0;
  } }));
  const list = browse.packageList(results, route, rows, { letters: true });
  results.append(none, list.el);
}

// Search Apps (older links): the shared bar (nav/searchbar.js) over the AltStore apps only, results as browse.js rows.
function renderSearch(body, route) {
  const bar = searchBar({ placeholder: "Search Apps", ariaLabel: "Search apps: name, description or developer", delay: 120,
    onQuery: () => run() });
  const input = bar.input;
  const hint = el("p", "empty search-note", "App names, descriptions and developers.");
  const results = pinned(body, bar);
  results.append(hint);
  const list = browse.packageList(results, route, [], { letters: false });
  results.append(list.el);
  let seq = 0;
  async function run() {
    const q = input.value.trim();
    const mine = ++seq;
    if (!q) { list.setItems([]); hint.textContent = "App names, descriptions and developers."; return; }
    let rows;
    try {
      await catalog.ensure();
      rows = appsOf(await catalog.search(q));
    } catch (e) {
      if (mine === seq) hint.textContent = e.message;
      return;
    }
    if (mine !== seq) return;
    browse.rememberNames(rows);
    list.setItems(rows);
    hint.textContent = rows.length ? "" : "No Results";
  }
  setTimeout(() => { if (input.isConnected) input.focus(); }, 350); // after the push animation
}

// An IPA's icon on a placeholder box (the letter stays under it): Apple's CgBI PNG doesn't draw in a browser, but the
// shell hands over plain PNGs (UIKit decodes CgBI).
function putIcon(box, b64) {
  if (!box || typeof b64 !== "string" || !b64) return;
  try { if (isCgBI(fromBase64(b64))) return; } catch { return; }
  const img = new Image();
  img.alt = "";
  img.decoding = "async";
  img.onload = () => img.classList.add("loaded");
  img.onerror = () => img.remove();
  img.src = `data:image/png;base64,${b64}`;
  box.append(img);
}

// F257: a link's icon from the source (an https URL: through the proxy on the website, as app pages draw it).
function putIconUrl(box, url) {
  if (!box || typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
  const img = new Image();
  img.alt = "";
  img.decoding = "async";
  img.onload = () => img.classList.add("loaded");
  img.onerror = () => img.remove();
  img.src = mediaUrl(url);
  box.append(img);
}

const refresh = () => { if (view.body?.isConnected) load(); };

async function pickFiles() {
  let r;
  try { r = await libraryCall("pick", {}); } catch (e) {
    await showAlert({ title: "Couldn't Add", message: deviceError(e).message, buttons: ["OK"] });
    return;
  }
  remember(r?.ipas);
  if (view.body?.isConnected) draw(r?.ipas ?? []);
  if (r?.files?.length === 1) go(ipaPath(r.files[0]));
}

// ---- F197: the website's Choose File: an IPA from Files, kept in this browser -----------------------------------

let ipaStore = null;
const siteStore = () => (ipaStore ??= openIpaStore().catch(() => memoryIpaStore()));
// What this site may still keep (Safari's quota less what it uses), or null when the browser doesn't say.
const siteRoom = async () => {
  const est = await globalThis.navigator?.storage?.estimate?.();
  return est && Number.isFinite(est.quota) && Number.isFinite(est.usage) ? est.quota - est.usage : null;
};

function chooseSiteFile() {
  const input = Object.assign(el("input", "visually-hidden"), { type: "file", accept: ".ipa,application/octet-stream" });
  document.body.append(input);
  input.addEventListener("change", async () => {
    const f = input.files?.[0];
    input.remove();
    if (f) await addPickedFile(f);
  }, { once: true });
  input.addEventListener("cancel", () => input.remove(), { once: true });
  input.click();
}

// A picked File into My IPAs (the HUD while its Info.plist is read and its bytes stored), then its page.
export async function addPickedFile(file, { store, read = readIpaFile, room = siteRoom, alert = showAlert, hud = showHUD, open = go } = {}) {
  const hide = hud("Adding");
  let entry;
  try { entry = await addSiteFile(file, { store: store ?? (await siteStore()), read, room }); } catch (e) {
    hide();
    await alert({ title: "Couldn't Add", message: String(e?.message ?? e), buttons: ["OK"] });
    return null;
  }
  if (hide.done) hide.done("Added"); else hide();
  known.set(entry.file, entry);
  refresh();
  // F302a: an App Store copy (still encrypted) is flagged now, not at signing: "<App> Is Locked", How to Get One
  await (await import("./tweaks.js")).checkPickedIpa(file, { alert }).catch(() => null);
  open(ipaPath(entry.file));
  return entry;
}

// F302a: the IPA page's tweak rows under its header: "<App> Is Locked" for an App Store copy (How to Get One), else
// in the sideload app Add Tweaks (screens/tweaks.js), whose changes go into the file's Sign Options too, so Sign Now
// and Save Signed IPA inject them as Install does.
async function ipaTweakRows(entry) {
  const t = await import("./tweaks.js");
  if (t.isEncrypted(entry.bundleId)) {
    return grouped([{ header: "Tweaks", rows: [{ label: `${entry.name || "This App"} Is Locked`, detail: "App Store copy", chevron: false },
      { label: "How to Get One", onClick: () => t.lockedAlert(entry.name || entry.file) }],
    footer: "This IPA came from the App Store and is still encrypted, so tweaks can't go in and it can't be signed. A decrypted copy works." }]);
  }
  if (site() || jailbreak() || entry.error) return null;
  return t.addTweaksGroup({ bundleId: entry.bundleId, name: entry.name || entry.file,
    open: async (o) => { let changed = false; await t.openAddTweaks({ ...o, onChange: () => { changed = true; } }); if (changed) await syncLibraryTweaks(entry); } }).el;
}

async function syncLibraryTweaks(entry) {
  try {
    const [t, { tweakParams }, { toBase64 }] = await Promise.all([import("./tweaks.js"), import("../core/tweaks.js"), import("../core/signing.js")]);
    const p = await t.preparedFor(entry.bundleId);
    const o = entry.options ?? {};
    await libraryCall("options", { ...optionsParams(entry, { ...o, tweaks: p ? tweakParams(p, toBase64) : null }),
      ...(typeof o.keepBundleId === "boolean" ? { keepBundleId: o.keepBundleId } : {}) });
  } catch (e) {
    await showAlert({ title: "Can't Inject These Tweaks", message: String(e?.message ?? e), buttons: ["OK"] });
  }
}

// Install for a kept IPA: signed in this browser from its bytes (no download), with the same early itms link,
// progress page, Cancel and upload as an app page's Install. Called inside Install's tap, nothing awaited before
// signInBrowser opens iOS's prompt; the bytes are read after.
export function siteFileInstall(entry, { store = siteStore, sign = signAndInstall, onInstalled = () => {} } = {}) {
  return sign({ name: entry.name || entry.file.replace(/\.ipa$/i, ""), bundleId: entry.bundleId || null, version: entry.version || "",
    bytes: async () => (await (typeof store === "function" ? store() : store)).get(entry.file), onInstalled });
}

// The Add alert as Sources has it: a URL field with Paste, cleaned up by cleanSourceUrl.
async function addFromUrl() {
  const { index, value } = await showAlert({
    title: "Enter IPA URL",
    message: site() ? "A link to an .ipa, kept on this iPhone. Install opens it in a sideloader." : `A link to an .ipa: ${NAME} downloads it into My IPAs.`,
    input: { placeholder: "https://", value: "https://", type: "url", paste: cleanSourceUrl },
    buttons: ["Cancel", "Add"],
    cancel: 0,
  });
  if (index !== 1) return;
  const url = cleanSourceUrl(value) || String(value ?? "").trim();
  if (site()) {
    let entry;
    try { entry = addSiteUrl(globalThis.localStorage, url); } catch (e) {
      await showAlert({ title: "Couldn't Add", message: e.message, buttons: ["OK"] });
      return;
    }
    known.set(entry.file, entry);
    refresh();
    return;
  }
  const hide = showHUD("Downloading");
  const label = [...document.querySelectorAll(".hud-label")].at(-1);
  let r;
  try {
    r = await libraryCall("add", { url }, (ev) => { const t = phaseLabel(ev); if (t && label) label.textContent = t; });
  } catch (e) {
    hide();
    if (e?.code === "cancelled") return; // B104: Cancel on This Download Is Not Secure
    await showAlert({ title: "Couldn't Download", message: deviceError(e).message, buttons: ["OK"] });
    return;
  }
  if (hide.done) hide.done("Added"); else hide();
  remember(r?.ipas);
  if (view.body?.isConnected) draw(r?.ipas ?? []);
}

// ---- an IPA's page ----------------------------------------------------------------------------------------------

async function entryOf(file) {
  const r = await entries();
  remember(r?.ipas);
  return { entry: (r?.ipas ?? []).find((e) => e.file === file) ?? null, identity: Boolean(r?.identity) };
}

function setTitle(body, title) {
  handleOf(body)?.setTitle(title);
}

const dateText = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" }) : "");

function header(entry) {
  const name = entry.name || entry.file;
  const head = el("div", "pkg-head");
  const icon = el("span", "pkg-icon large");
  icon.append(el("span", "pkg-letter", name.charAt(0).toUpperCase()));
  putIcon(icon, entry.icon);
  const ht = el("div", "pkg-head-text");
  const top = el("span", "pkg-head-top");
  top.append(el("span", isFileName(name) ? "pkg-head-name myipa-head-file" : "pkg-head-name", name)); // B92: a file name wraps
  ht.append(top);
  if (entry.version) ht.append(el("span", "pkg-head-version", entry.version));
  ht.append(el("span", "pkg-head-version myipa-bundle", entry.bundleId || (site() ? hostOf(entry.url) : "")));
  head.append(icon, ht);
  const size = formatBytes(entry.size);
  if (size) head.append(el("span", "pkg-head-size", size));
  const g = el("div", "group");
  const t = el("div", "table grouped pkg-head-table");
  t.append(head);
  g.append(t);
  return g;
}

const hostOf = (u) => { try { return new URL(u).host; } catch { return ""; } };

// F317: a website IPA kept in this browser, in the iOS 6 hint style (AGENTS.md, Hints): the Install hint under an
// Install row (the nav bar's Install, here too, as the app page has), Details as status rows with no footer, and
// where the file is kept under Delete, the row it's about.
export const SITE_IPA_INSTALL_FOOTER = "Signs it here with your certificate (Settings > Signing), then iOS installs it.";
export const SITE_KEPT_FOOTER = "Kept in this browser until you delete it.";
export function siteIpaSections(details, onInstall = () => {}) {
  return [{ rows: [{ label: "Install", onClick: onInstall }], footer: SITE_IPA_INSTALL_FOOTER },
    { header: "Details", rows: details }];
}

async function renderIpa(body, route, file) {
  const shown = { body, route, file, drawn: null };
  view.ipa = shown; // B277: drawn again when an install changes its entry (afterInstall, ipaChanged)
  body.append(placeholder("page"));
  let entry, identity;
  try { ({ entry, identity } = await entryOf(file)); } catch (e) {
    body.replaceChildren(note(deviceError(e).message));
    return;
  }
  shown.drawn = JSON.stringify({ entry, identity });
  if (!entry) {
    body.replaceChildren(grouped([{ rows: [{ label: "Not in My IPAs" }], footer: `${file} was deleted or moved.` }]));
    return;
  }
  setTitle(body, entry.name || file);
  body.replaceChildren(header(entry));
  if (entry.bundleId) { // F302a: directly under the header (Install is the nav bar's)
    const tw = await ipaTweakRows(entry).catch(() => null);
    if (tw) body.append(tw);
  }
  if (site() && entry.stored) {
    const details = [
      { label: "Version", detail: entry.version || "—", chevron: false },
      { label: "Bundle ID", detail: entry.bundleId || "—", chevron: false },
      { label: "Size", detail: formatBytes(entry.size) || "—", chevron: false },
    ];
    if (entry.minimumOS) details.push({ label: "Requires", detail: `iOS ${entry.minimumOS}`, chevron: false });
    body.append(grouped(siteIpaSections(details, () => install(entry.file))));
    // F288: Inject Tweaks, kept for this app in this browser as soon as they change; Install injects them
    if (entry.bundleId) {
      const { tweaksGroup } = await import("./tweaks.js");
      const tg = tweaksGroup({ bundleId: entry.bundleId, onChange: () => { tg.save(); } });
      body.append(tg.el);
    }
    body.append(grouped([{ rows: [{ label: "Delete", onClick: () => confirmDelete(entry) }], footer: SITE_KEPT_FOOTER }]));
    markDelete(body);
    return;
  }
  if (site()) {
    body.append(grouped([
      { header: "Link", rows: [{ label: entry.url, chevron: false }],
        footer: `Install opens this link in ${NAME}, AltStore, SideStore or Feather, which sign it on the iPhone, or downloads the IPA.` },
      { rows: [{ label: "Delete", onClick: () => confirmDelete(entry) }] },
    ]));
    markDelete(body);
    return;
  }
  if (jailbreak()) {
    body.append(grouped(jailbreakIpaGroups(entry, () => confirmDelete(entry), () => shareFile(entry))));
    markFileRow(body, entry.file);
    markDelete(body);
    return;
  }
  const st = stateOf(entry);
  const status = [{ label: "Status", detail: st.label, chevron: false }];
  if (entry.signed) {
    status.push({ label: "Signed", detail: dateText(entry.signed.at), chevron: false });
    if (entry.signed.expires) status.push({ label: "Signature Expires", detail: dateText(entry.signed.expires), chevron: false });
    if (entry.signed.bundleId && entry.signed.bundleId !== entry.bundleId) status.push({ label: "Signed As", detail: entry.signed.bundleId, chevron: false });
  }
  const changed = optionsChanged(entry.options);
  const actions = [
    { label: "Sign Options", detail: changed ? "Changed" : "As Is", href: format({ tab: "installed", path: [...ipaPath(file), "options"] }) },
    { label: "Sign Now", subtitle: entry.signed ? "Signed already: signs again" : "Signs on this iPhone, no connection needed", onClick: () => signNow(entry, body, route) },
    { label: "Save Signed IPA", subtitle: "Files, AirDrop and other apps", onClick: () => saveSigned(entry, body, route) },
  ];
  const details = [
    { label: "Version", detail: entry.version || "—" },
    { label: "Bundle ID", detail: entry.bundleId || "—" },
    { label: "Size", detail: formatBytes(entry.size) || "—" },
  ];
  if (entry.minimumOS) details.push({ label: "Requires", detail: `iOS ${entry.minimumOS}` });
  if (entry.extensions?.length) details.push({ label: "Extensions", detail: String(entry.extensions.length) });
  details.push({ label: "File", detail: entry.file });
  const groups = [
    { rows: status, footer: entry.error ? `This file can't be signed: ${entry.error}` : !identity ? `Add your certificate in ${signingPage()} to sign it.` : "" },
  ];
  if (!entry.error) groups.push({ rows: actions, footer: actionsFooter(storedRoute()) });
  groups.push({ header: "Details", rows: details });
  groups.push({ rows: [{ label: "Delete", onClick: () => confirmDelete(entry) }] });
  body.append(grouped(groups));
  markFileRow(body, entry.file);
  markDelete(body);
}

// B92: the page's File row shows the whole name, wrapped (myipas.css .myipa-file), and a hold on it shows iOS 6's
// black Copy callout, as a Contacts value row does; Copy puts the full file name on the clipboard.
export function markFileRow(body, file, { menu = showMenu, copy = copyText, hold = longPress } = {}) {
  const li = [...body.querySelectorAll(".cell")].find((c) => c.querySelector(".cell-label")?.textContent === "File");
  if (!li || !file) return null;
  li.classList.add("myipa-file");
  hold(li, ".cell-inner", (inner) => menu(inner, [{ label: "Copy", onClick: () => copy(file) }]));
  return li;
}

// F212: an IPA's page in the jailbreak app: its details and Delete; Install (nav bar) hands the file to ifizbox-helper
// as it is (no Sign Options, Sign Now or Save Signed IPA: that app doesn't sign).
export function jailbreakIpaGroups(entry, onDelete, onShare = null) {
  const details = [
    { label: "Version", detail: entry.version || "—", chevron: false },
    { label: "Bundle ID", detail: entry.bundleId || "—", chevron: false },
    { label: "Size", detail: formatBytes(entry.size) || "—", chevron: false },
  ];
  if (entry.minimumOS) details.push({ label: "Requires", detail: `iOS ${entry.minimumOS}`, chevron: false });
  if (entry.extensions?.length) details.push({ label: "Extensions", detail: String(entry.extensions.length), chevron: false });
  details.push({ label: "File", detail: entry.file, chevron: false });
  return [
    { header: "Details", rows: details,
      footer: entry.error ? `This file can't be read: ${entry.error}` : `In /var/mobile/Documents. Install hands it to ${NAME}'s helper, which installs it as it is.` },
    // F374: a decrypted IPA, or one with tweaks, goes to other phones and apps from here (library.share)
    ...(onShare && !entry.error ? [{ rows: [{ label: "Share", subtitle: "Files, AirDrop and other apps", onClick: onShare, chevron: false }] }] : []),
    { rows: [{ label: "Delete", onClick: onDelete }] },
  ];
}

// F374: the jailbreak app's Share for a library IPA: the share sheet for the file itself (library.share).
async function shareFile(entry, { native = nativeBridge() } = {}) {
  try { await native.call("library.share", { file: entry.file }); } catch (e) {
    await showAlert({ title: "Couldn't Share", message: deviceError(e).message, buttons: ["OK"] });
  }
}

function markDelete(body) {
  const last = [...body.querySelectorAll(".group")].at(-1);
  last?.querySelector(".cell-inner")?.classList.add("myipa-delete");
}

const optionsChanged = (o) => Boolean(o && (o.name || o.bundleId || o.icon || o.removeExtensions?.length || o.fixArm64e === false
  || o.tweaks?.length // F288
  || o.keepBundleId === false)); // F243: the old way (or Sign Options saved before Keep Bundle IDs)

// B294: the footer under Sign Now / Save Signed IPA says what installing needs on the Install Apps With route
// (core/installroute.js storedRoute): This iPhone's VPN, or the Signing Server's install manifest.
export function actionsFooter(route) {
  const needs = route === "iphone"
    ? `only the VPN to this iPhone (${vpnList()}), no Signing Server`
    : "a connection only for the Signing Server's install manifest";
  return `Signing happens on this iPhone and works offline. Installing needs ${needs}.`;
}

function rerender(body, route) {
  if (!body?.isConnected) return; // F208: a hold's Sign Now from the list has no page to redraw
  body.replaceChildren();
  render(body, route);
}

// Offline is fine: no Signing Server check here (Install makes it). Without a certificate the shell answers
// no_identity, which opens Settings > Signing.
async function signNow(entry, body, route) {
  const hide = showHUD("Signing");
  const label = [...document.querySelectorAll(".hud-label")].at(-1);
  try {
    await libraryCall("sign", { file: entry.file }, (ev) => { const t = phaseLabel(ev); if (t && label) label.textContent = t; });
  } catch (e) {
    hide();
    const why = deviceError(e, entry.name);
    await showAlert({ title: why.open ? why.title : `Couldn't Sign ${entry.name || ""}`.trim(), message: why.message, buttons: ["OK"] });
    if (why.open === "signing") openSigning(); // B39: back to this IPA's page once it's set up
    return;
  }
  if (hide.done) hide.done("Signed"); else hide();
  rerender(body, route);
  refresh();
}

async function saveSigned(entry, body, route) {
  if (!entry.signed) {
    const i = await showActionSheet({ title: `${entry.name || "It"} isn't signed yet. Sign it now, then save it?`, buttons: ["Sign and Save"] });
    if (i !== 0) return;
    await signNow(entry, body, route);
    const { entry: now } = await entryOf(entry.file).catch(() => ({ entry: null }));
    if (!now?.signed) return;
  }
  try { await libraryCall("export", { file: entry.file }); } catch (e) {
    await showAlert({ title: "Couldn't Save", message: deviceError(e).message, buttons: ["OK"] });
  }
}

async function confirmDelete(entry) {
  const i = await showActionSheet({ title: deleteSheetTitle(1, { site: site(), jailbreak: jailbreak(), stored: Boolean(entry.stored) }),
    buttons: ["Delete IPA"], destructive: 0 });
  if (i !== 0) return;
  try {
    if (site()) await removeSiteEntry(entry, { store: entry.stored ? await siteStore() : null });
    else await libraryCall("delete", { file: entry.file });
  } catch (e) {
    await showAlert({ title: "Couldn't Delete", message: deviceError(e).message, buttons: ["OK"] });
    return;
  }
  known.delete(entry.file);
  back();
  refresh();
}

// Install (nav bar, and the list's green INSTALL): F30's record in Installed once iOS has it.
async function install(file, row = null) {
  let entry = known.get(file) ?? row;
  const record = (id, name, version, icon) => apps().then((store) => recordInstall(store, {
    id, name, version, key: libraryKey(file), source: null, sourceName: "My IPAs", icon: icon ? `data:image/png;base64,${icon}` : null })).catch(() => {});
  if (site()) {
    entry ??= siteEntries().find((e) => e.file === file);
    if (!entry) return;
    if (!(await confirmReplace(entry))) return; // B80
    if (entry.stored) {
      await siteFileInstall(entry, { onInstalled: (r) => {
        if (r?.bundleId) record(r.bundleId, r.name || entry.name, r.version || entry.version || "", entry.icon);
      } });
      return;
    }
    await siteInstallSheet(entry);
    return;
  }
  if (jailbreak()) {
    if (entry && !(await confirmReplace(entry))) return; // B80
    const name = entry?.name || file.replace(/\.ipa$/i, "");
    await jailbreakInstall(file, name, { onInstalled: (r) => {
      if (r?.bundleId) record(r.bundleId, r.name || name, r.version || entry?.version || "", entry?.icon);
    } });
    return;
  }
  if (await queueLibraryInstall(entry)) return; // F241: through the IPA queue's run when the Signing Server answers
  const name = entry?.options?.name || entry?.name || file.replace(/\.ipa$/i, "");
  await installFromLibrary({ file, name, signed: Boolean(entry?.signed), onInstalled: (r) => {
    if (r?.bundleId) record(r.bundleId, r.name || name, r.version || entry?.version || "", entry?.options?.icon || entry?.icon);
  } });
  refresh();
  const route = { tab: "installed", path: ipaPath(file) };
  const body = shownBody(route);
  if (body) rerender(body, route);
}

// F241: the sideload app's Install on an IPA's page queues it in the IPA queue (core/appqueue.js libraryJob: signed
// from the library file with its Sign Options) and opens Confirm, so several My IPAs (and source apps) install signed
// ahead, one at a time, each with its own stop (screens/apprun.js). Offline (the Signing Server doesn't answer) it
// returns false and Install stays installFromLibrary's: signed now, kept in My IPAs, and the No Connection message.
// -> true once queued. B80: an IPA that replaces another app with its bundle ID asks first (confirmReplace); Cancel
// returns "cancelled" (truthy: nothing else installs it). The job carries the file as its key, so Installed's record
// says which IPA is on the phone.
export async function queueLibraryInstall(entry, { reachable = serverReachable, add = queueApp, installed = lib.installed,
  shared = lib.shared, alert = showAlert, versionOf = installedVersionOf } = {}) {
  const id = installedIdOf(entry);
  const job = libraryJob(entry, { installed: Boolean(id && installed?.[id]) });
  if (!job) return false;
  if (!(await confirmReplace(entry, { shared, alert }))) return "cancelled";
  if (!(await Promise.resolve().then(() => reachable()).catch(() => false))) return false;
  // B277: the version on the phone, so Confirm says Upgrade (or Downgrade) for another version, not Reinstall
  if (job.installed != null) job.installed = (await Promise.resolve().then(() => versionOf(id)).catch(() => null)) || job.installed;
  add({ ...job, key: job.key ?? libraryKey(entry.file) });
  return true;
}

// B277: the installed version of the app with bundle ID `id`: Installed's record, else the shell's record of signing
// it (signing.installed: on iOS 27 Installed's record may never be written, B229), else null (not known).
export async function installedVersionOf(id, { records = async () => (await apps()).all(), native = nativeBridge(),
  signed = async () => (await native.call("signing.installed", {}))?.apps ?? [] } = {}) {
  if (!id) return null;
  const rec = ((await Promise.resolve().then(records).catch(() => [])) ?? []).find((r) => r?.id === id);
  if (rec?.version) return rec.version;
  const own = ((await Promise.resolve().then(signed).catch(() => [])) ?? []).find((r) => r?.bundleId === id || r?.originalBundleId === id);
  return own?.version || null;
}

// F212: the jailbreak app's Install for a library file: Install IPA's console (screens/ipa-install.js, as a URL's or a
// shared file's), whose ipa.install call goes to library.helperInstall {file} instead (MyIPAs.swift: the file staged
// where ifizbox-helper takes IPAs, then install-ipa), as share.js does for share.ipaInstall.
export function helperBridge(file, native = nativeBridge()) {
  return { call: (method, params, onEvent) => native.call("library.helperInstall", { file, stream: params?.stream }, onEvent) };
}

export async function jailbreakInstall(file, name, { onInstalled = () => {}, native = nativeBridge(), open } = {}) {
  const run = open ?? (await import("./ipa-install.js")).openIpaInstall;
  return run({ url: file, name, native: helperBridge(file, native), onInstalled });
}

// The IPA's page body when it is on screen (its own tab, or mounted on Home's stack), else null. Only the active
// tab's stack: every tab has an .is-top page, and Home's came first, so its root got the IPA's page (user 2026-11-18).
export function shownBody(route) {
  if (format(mounted(parse(location.hash))) !== format(route)) return null;
  return document.querySelector(".tab-stack.is-active > .page.is-top .page-body");
}

// F95: the website's Install for one of the user's links, as an app page's (F92): the certificate alert, whose
// Download IPA opens the link. -> whether it downloaded.
// F257: a link too big for the website (siteTooBig) is handed to a sideloader (signing-client.js handOffIpa), never
// to the website's signer.
export function siteInstallSheet(entry, { alert, open = (u) => { location.href = u; }, handoff = handOffIpa } = {}) {
  const url = entry?.url;
  if (!url) return Promise.resolve(false);
  if (siteTooBig(entry)) return Promise.resolve(handoff({ url, name: entry.name || "" })).then(Boolean);
  return siteCertificateAlert({ download: () => open(url), ...(alert ? { alert } : {}) });
}

// ---- Sign Options -----------------------------------------------------------------------------------------------

const edits = new Map(); // file -> the options page's edits until Save

async function renderOptions(body, route, file) {
  body.append(placeholder("page", 5));
  let entry;
  try { ({ entry } = await entryOf(file)); } catch (e) {
    body.replaceChildren(note(deviceError(e).message));
    return;
  }
  if (!entry) {
    body.replaceChildren(note(`${file} isn't in My IPAs any more.`));
    return;
  }
  const o = entry.options ?? {};
  const ed = { name: o.name || "", bundleId: o.bundleId || "", icon: o.icon || null,
    removeExtensions: [...(o.removeExtensions ?? [])], fixArm64e: o.fixArm64e !== false,
    keepBundleId: keepStart(o) }; // F243
  edits.set(file, { entry, ed });
  const { iconPNG } = await import("../signing-sheet.js");
  const { createSwitch } = await import("./settings.js");
  body.replaceChildren();

  const g = el("div", "group");
  g.append(el("h2", "group-header", "Install As"));
  const ul = el("ul", "table grouped");
  const field = (label, value, placeholder, set, extra = {}) => {
    const li = el("li", "cell");
    const row = el("label", "cell-inner sign-row ss-field");
    const input = Object.assign(el("input", "sign-value"), { type: "text", value, placeholder, ...extra });
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("autocorrect", "off");
    input.spellcheck = false;
    input.addEventListener("input", () => set(input.value));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
    row.append(el("span", "cell-label", label), input);
    li.append(row);
    return li;
  };
  ul.append(field("Name", ed.name, entry.name || "", (v) => { ed.name = v; }));
  ul.append(field("Bundle ID", ed.bundleId, entry.bundleId || "", (v) => { ed.bundleId = v; }, { inputMode: "url" }));
  ul.append(iconCell(ed, { iconPNG }));
  g.append(ul, el("p", "group-footer", "Empty fields keep what the IPA has. A new bundle ID installs a second copy; your profile may still change it."));
  body.append(g);

  const exts = entry.extensions ?? [];
  if (exts.length) {
    const eg = el("div", "group");
    eg.append(el("h2", "group-header", "Extensions"));
    const eul = el("ul", "table grouped");
    for (const x of exts) {
      const li = el("li", "cell");
      const inner = el("div", "cell-inner has-switch ss-ext");
      const text = el("span", "cell-text");
      text.append(el("span", "cell-label", x.name || x.path.split("/").pop()), el("span", "cell-subtitle", x.point || x.bundleId || x.path));
      inner.append(text, createSwitch({ label: `Keep ${x.name || x.path}`, checked: !ed.removeExtensions.includes(x.path), onToggle: (on) => {
        const set = new Set(ed.removeExtensions);
        if (on) set.delete(x.path); else set.add(x.path);
        ed.removeExtensions = [...set];
      } }));
      li.append(inner);
      eul.append(li);
    }
    eg.append(eul, el("p", "group-footer", "Turn one off to leave it out: each extension needs an App ID of its own, which a free account may not have to spare."));
    body.append(eg);
  }

  const ag = el("div", "group");
  const aul = el("ul", "table grouped");
  const ali = el("li", "cell");
  const ainner = el("div", "cell-inner has-switch");
  ainner.append(el("span", "cell-label", "arm64e Fix-Up"), createSwitch({ label: "arm64e Fix-Up", checked: ed.fixArm64e, onToggle: (on) => { ed.fixArm64e = on; } }));
  ali.append(ainner);
  aul.append(ali);
  ag.append(aul, el("p", "group-footer", "Mends binaries built for the old arm64e ABI so they run on newer iPhones. Leave it on unless an app won't open."));
  body.append(ag);

  // F288: Inject Tweaks (screens/tweaks.js); sent with Save only once changed, so the app keeps its saved ones
  const { tweaksGroup } = await import("./tweaks.js");
  const cur = edits.get(file);
  cur.tweaks = tweaksGroup({ bundleId: entry.bundleId || "", onChange: () => { cur.tweaksChanged = true; } });
  body.append(cur.tweaks.el);

  // F243: Keep Bundle ID, as Custom Install's (signing-sheet.js): starts as this IPA's saved choice, else Settings >
  // Signing's; turning it off says what the old way does first; the footer warns when the original is on the phone.
  const kg = el("div", "group");
  const kul = el("ul", "table grouped");
  const kli = el("li", "cell");
  const kinner = el("div", "cell-inner has-switch");
  const kfoot = el("p", "group-footer", "");
  let orig = { installed: false, ours: false };
  const drawKeep = () => { kfoot.textContent = keepFooter(entry, ed, orig); };
  kinner.append(el("span", "cell-label", "Keep Bundle ID"), createSwitch({ label: "Keep Bundle ID", checked: ed.keepBundleId, onToggle: async (on) => {
    if (!on) {
      const { index } = await showAlert({ title: OLD_WAY_ALERT.title, message: OLD_WAY_TEXT(ed.name || entry.name, ""),
        buttons: OLD_WAY_ALERT.buttons, cancel: 0 });
      if (index !== 1) { kinner.querySelector?.(".switch")?.setAttribute("aria-checked", "true"); return; }
    }
    ed.keepBundleId = on;
    drawKeep();
  } }));
  kli.append(kinner);
  kul.append(kli);
  kg.append(kul, kfoot);
  body.append(kg);
  drawKeep();
  originalState(nativeBridge(), entry.bundleId).then((s) => { orig = s; if (kfoot.isConnected) drawKeep(); }, () => {});
}

// B164: Sign Options' Icon row: the label, the value at the right and the Choose (or Reset) button inside the row
// itself (.sign-row.has-browse, ios6.css), so nothing floats over the next group's footer.
export function iconCell(ed, { iconPNG, alert = showAlert } = {}) {
  const iconLi = el("li", "cell sign-files-cell");
  const iconRow = el("div", "cell-inner sign-row ss-icon-row has-browse");
  const iconState = el("span", "sign-value", ed.icon ? "Chosen" : "The App's");
  const fileInput = Object.assign(el("input", "visually-hidden"), { type: "file", accept: "image/*" });
  fileInput.id = "mio" + Math.random().toString(36).slice(2);
  const choose = Object.assign(el("label", "bar-button sign-browse", ed.icon ? "Reset" : "Choose"), { htmlFor: fileInput.id });
  choose.addEventListener("click", (e) => {
    if (!ed.icon) return; // the label opens the picker
    e.preventDefault();
    ed.icon = null;
    iconState.textContent = "The App's";
    choose.textContent = "Choose";
  });
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files?.[0];
    fileInput.value = "";
    if (!f) return;
    try {
      ed.icon = await iconPNG(f);
      iconState.textContent = "Chosen";
      choose.textContent = "Reset";
    } catch {
      await alert({ title: "Can't Use This Image", message: `${NAME} couldn't read it. Choose a PNG or JPEG.`, buttons: ["OK"] });
    }
  });
  iconRow.append(el("span", "cell-label", "Icon"), iconState, choose);
  iconLi.append(iconRow, fileInput);
  return iconLi;
}

// F243: the Sign Options page's Keep Bundle ID at first: the IPA's saved choice (library.options keepBundleId; null
// when none was saved), else Settings > Signing's Keep Bundle IDs.
export const keepStart = (o, keep = storedKeep()) => (typeof o?.keepBundleId === "boolean" ? o.keepBundleId : keep);

// Its footer: what the switch does now, and, while the ID is kept, the original on the phone (core/keepid.js
// originalNote) when the user typed no other bundle ID.
export function keepFooter(entry, ed, orig = { installed: false, ours: false }) {
  const name = String(ed?.name ?? "").trim() || entry?.name || "";
  if (!ed?.keepBundleId) return OLD_WAY_TEXT(name, "");
  const own = !String(ed?.bundleId ?? "").trim() || String(ed.bundleId).trim() === entry?.bundleId;
  const note = own ? originalNote(name, orig) : null;
  return note ? note.text : `The app keeps its own ID: it replaces the original and can get its notifications. ${signingPage()}'s Keep Bundle IDs decides for IPAs without Sign Options.`;
}

async function saveOptions(file) {
  const cur = edits.get(file);
  if (!cur) return;
  let params;
  // F288: changed tweaks go prepared (null clears them); unchanged, the key stays out and the app keeps its own
  if (cur.tweaks && cur.tweaksChanged) {
    try {
      const [{ tweakParams }, { toBase64 }] = await Promise.all([import("../core/tweaks.js"), import("../core/signing.js")]);
      const p = await cur.tweaks.prepared();
      cur.ed.tweaks = p ? tweakParams(p, toBase64) : null;
    } catch (e) {
      await showAlert({ title: "Can't Inject These Tweaks", message: String(e?.message ?? e), buttons: ["OK"] });
      return;
    }
    await cur.tweaks.save();
  }
  // F243: the Keep Bundle ID switch is saved as it stands (library.options keepBundleId)
  try { params = { ...optionsParams(cur.entry, cur.ed), keepBundleId: cur.ed.keepBundleId !== false }; } catch (e) {
    await showAlert({ title: "Can't Save", message: e.message, buttons: ["OK"] });
    return;
  }
  try { await libraryCall("options", params); } catch (e) {
    await showAlert({ title: "Can't Save", message: deviceError(e).message, buttons: ["OK"] });
    return;
  }
  edits.delete(file);
  back();
  setTimeout(() => {
    const route = { tab: "installed", path: ipaPath(file) };
    const body = shownBody(route);
    if (body) rerender(body, route);
    refresh();
  }, 400);
}

export { STATE_LABELS };
