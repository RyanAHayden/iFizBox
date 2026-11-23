// Sources > Manage (F45), a grouped page after Cydia's Manage tab: a row per page.
//
//   #/sources/manage                     Sources, Import & Export, Hidden; then More Sources (F327,
//                                        screens/moresources.js), its badge the recommended sources not added yet
//   #/sources/manage/recommended         F327: More Sources' page (screens/sources.js hands it to moresources.js)
//   #/sources/manage/sources            the edit list: Add, tick sources (Installed's circles), Delete (n) in the toolbar
//   #/sources/manage/io                  Export (share text, save a file, QR code) and Import (file or the clipboard)
//   #/sources/manage/io/review           what an import found: new ones (ticked), already listed, can't add; Add
//   #/sources/manage/hidden              F104: what's hidden, sections (Section Visibility) and authors (Hide
//                                        Packages by <author>), each with a switch to show it again
//   #/sources/manage/recommended/<key>   one not added yet, read from its URL: its apps (F52) or packages (F54), and Add
//
// Source keys always hold a ':' (deb:..., alt:...), so "manage" can't be one. The parsing, export text and order
// live in core/sourcelist.js; the QR code in core/qr.js. A change here (add, delete) tells sources.js
// through onSourcesChanged, so the tab's list is right when the user goes back.
import { cleanSourceUrl, httpsInput } from "../core/sources.js";
import { grouped, plain, collapse, placeholder, el, note, barButton } from "../nav/ui.js";
import { showActionSheet } from "../nav/actionsheet.js";
import { showAlert } from "../nav/alert.js";
import { showSheet } from "../nav/sheet.js";
import { format, mounted, parse } from "../router.js";
import { getBackend, getParser, getArch, siteJailbroken } from "../backend.js";
import { detectMode } from "../core/settings.js";
import { repoLayout } from "../core/apt.js";
import { packageList } from "./browse.js";
import { displayName, sourceIcons, sourceSubtitle, sourcesFor } from "../core/sources.js";
import { tweakSourcesFor } from "../core/sources.js"; // F302
import { sourceIconImage } from "../source-icon.js";
import { altRecord, parseSource } from "../core/altstore.js";
import {
  exportText, clipboardText, parseImport, reviewImport, orderSources, loadOrder, recommendedRows, recommendedSeed,
  packagePreview, EXPORT_FILENAME,
} from "../core/sourcelist.js";
import { qrSvg } from "../core/qr.js";
import { sourceWarning, warningAlert } from "../core/warnings.js";
import {
  RECOMMENDED_SOURCES, detectJailbreak, jailbreakFromMarkers, recommendedFor, savedJailbreak,
} from "../core/recommended.js";
import { findAppSources } from "../core/appsources.js"; // B272: Find App Sources' directory
import { copyText, nativePaste } from "../nav/menu.js";
import { builtinFirst, isBuiltin, exportable } from "../core/essential.js";
import { lockMark } from "../nav/lock.js";
import { settings } from "../settings-store.js";
import { createSwitch } from "../nav/switch.js";
import { NAME } from "../brand.js";
import { rowIcon } from "../icons/rowicons.js";
import { confirmUnknownSource, markTrusted } from "./safety.js"; // F291
import * as findMore from "./findmore.js"; // F305: #/sources/manage/find(/<slug>), Find More Sources
import { nativeBridge } from "../native.js";

export const SEGMENT = "manage";
export const isManage = (route) => route.path[0] === SEGMENT;

const listeners = new Set();
// Returns unsubscribe (B98: Search's page listens while it is on screen).
export const onSourcesChanged = (f) => { listeners.add(f); return () => listeners.delete(f); };
// B75: the add paths pass their ctx, so the Sources tab can load what was added under the reload bar (screens/sources.js).
const changed = (ctx) => { for (const f of listeners) f(ctx); };
// B141: the same for adds made outside this screen (the website's Open in App import, screens/importlink.js).
export const sourcesChanged = (ctx) => changed(ctx);

let pending = null; // the import under review: [entry with status and `pick`]

const here = (...path) => format({ tab: "sources", path: [SEGMENT, ...path] });
// F327: More Sources' route (screens/moresources.js MORE), spelled here so this file needn't import that one (it
// imports this).
const MORE_HREF = format({ tab: "sources", path: ["more"] });

function page(route) {
  const p = route.path.slice(1);
  if (!p.length) return "root";
  if (p[0] === "sources" && p.length === 1) return "sources";
  if (p[0] === "hidden" && p.length === 1) return "hidden";
  if (p[0] === "recommended" && p.length === 2) return "preview";
  if (p[0] === "io") {
    if (p.length === 1) return "io";
    if (p[1] === "review" && p.length === 2) return "review";
  }
  return "missing";
}

export function nav(route, ctx) {
  if (findMore.isFind(route)) return findMore.nav(route, ctx); // F305
  switch (page(route)) {
    case "root": return { title: "Manage", right: { label: "Add", onClick: () => addSource(ctx) } }; // F52
    case "sources": return { title: "Sources", style: "plain", right: { label: "Add", onClick: () => addSource(ctx) } };
    case "io": return { title: "Import & Export" };
    case "hidden": return { title: "Hidden" };
    case "review": return { title: "Import", right: { label: "Add", onClick: () => addPicked(ctx) } };
    case "preview": return { title: [...RECOMMENDED_SOURCES, ...appSourceEntries()].find((r) => recommendedSeed(r).key === route.path[2])?.name || "Source",
      right: { label: "Add", onClick: () => addFromPreview(route, ctx) } };
    default: return { title: "Not Found" };
  }
}

export function render(body, route, ctx) {
  if (findMore.isFind(route)) return findMore.render(body, route, ctx); // F305
  switch (page(route)) {
    case "root": return renderRoot(body, ctx);
    case "sources": return renderSources(body);
    case "io": return renderIO(body, route, ctx);
    case "hidden": return renderHidden(body);
    case "review": return renderReview(body);
    case "preview": return renderPreview(body, route);
    default: body.append(note("Nothing here."));
  }
}

// The list in the user's order, as the Sources tab shows it (Not Jailbroken: AltStore sources only).
async function shownSources() {
  // F72: iFizBox's own source (built in) stays first whatever the order.
  const all = builtinFirst(orderSources(await getBackend().sources(), loadOrder()));
  const { shown, hidden } = sourcesFor(all, settings.deviceType());
  // F302: the sideload app's Tweak Sources are managed (reordered, deleted) with the rest.
  const tweaks = tweakSourcesFor(all, settings.deviceType(), detectMode());
  return { all, shown: tweaks.length ? all.filter((s) => shown.includes(s) || tweaks.includes(s)) : shown, hidden: hidden - tweaks.length };
}

const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

// ---- Manage --------------------------------------------------------------------------------------------------

function renderRoot(body, ctx) {
  const rows = [
    { label: "Sources", href: here("sources"), icon: rowIcon("sources") },
    { label: "Import & Export", href: here("io"), icon: rowIcon("transfer") },
    { ...hiddenRow(), icon: rowIcon("hidden") },
  ];
  // F327: Recommended and Find More Sources are one page now, More Sources (screens/moresources.js).
  body.replaceChildren(grouped([{ rows, footer: "Add and delete your sources, or move them to another phone "
    + "or package manager." }, { rows: [{ label: "More Sources", href: MORE_HREF, cls: "rec-entry", icon: rowIcon("moreSources") }],
    footer: findMore.findMoreOn() ? "Recommended sources, and more to find for tweaks and apps." : "Recommended app sources, and more to find." }]));
  // The badge: how many aren't added yet.
  recRows().then((rs) => {
    const n = rs.filter((r) => !r.added).length;
    const inner = body.querySelector(".rec-entry .cell-inner");
    if (n && inner && !inner.querySelector(".cell-count")) inner.append(el("span", "cell-count", String(n)));
  }).catch(() => {});
  getBackend().sources().then((list) => {
    const n = sourcesFor(list, settings.deviceType()).shown.length;
    const detail = body.querySelector(".cell .cell-inner");
    if (detail && !detail.querySelector(".cell-detail")) detail.insertBefore(el("span", "cell-detail", String(n)), detail.querySelector(".cell-check"));
  }).catch(() => {});
}

// ---- F104: Hidden: hidden sections and authors -------------------------------------------------------------------

// The Manage row: how many sections and authors are hidden.
export function hiddenRow(sections = settings.hiddenSections.list(), authors = settings.hiddenAuthors.list()) {
  const n = sections.length + authors.length;
  return { label: "Hidden", detail: n ? String(n) : undefined, href: here("hidden") };
}

// The page's groups: { header, footer, items: [{ kind, name }] }; empty kinds are left out.
export function hiddenGroups(sections, authors) {
  const out = [];
  if (sections.length) out.push({ header: "Sections", items: sections.map((name) => ({ kind: "section", name })) });
  if (authors.length) out.push({ header: "Authors", items: authors.map((name) => ({ kind: "author", name })) });
  return out;
}

function renderHidden(body) {
  const draw = () => {
    const groups = hiddenGroups(settings.hiddenSections.list(), settings.hiddenAuthors.list());
    if (!groups.length) {
      body.replaceChildren(grouped([{ footer: "Nothing is hidden. Hide a section with Edit on Sections, or an author "
        + "with Hide Packages by on their page." }]));
      return;
    }
    const ul = grouped(groups.map((g) => ({ header: g.header, rows: g.items.map((it) => ({ label: it.name, chevron: false })) }))
      .concat([{ footer: "Hidden packages are left out of lists, Search and Changes. Switch one on to show it again." }]));
    const cells = ul.querySelectorAll(".cell .cell-inner");
    groups.flatMap((g) => g.items).forEach((it, i) => {
      const inner = cells[i];
      if (!inner) return;
      inner.classList.add("has-switch");
      inner.append(createSwitch({ label: `Show ${it.name}`, checked: false, onToggle: (on) => {
        if (!on) return;
        if (it.kind === "section") settings.hiddenSections.set(it.name, false);
        else settings.hiddenAuthors.set(it.name, false);
        setTimeout(draw, 250); // the switch slides on, then the row goes
      } }));
    });
    body.replaceChildren(ul);
  };
  draw();
}

// ---- Sources: the edit list ------------------------------------------------------------------------------------

async function renderSources(body) {
  let list;
  try {
    ({ shown: list } = await shownSources());
  } catch (e) {
    body.replaceChildren(note(e.message));
    return;
  }
  const backend = getBackend();
  const ul = plain([{ rows: list.map((s) => ({ label: displayName(s), subtitle: sourceSubtitle(s),
    icon: { text: displayName(s)[0]?.toUpperCase() ?? "?" } })) }]);
  ul.classList.add("editing", "managing", "manage-list");
  const cells = [...ul.querySelectorAll(":scope > .cell")];
  list.forEach((s, i) => editRow(cells[i], s, backend, body));
  body.replaceChildren(ul);
  if (!list.length) body.append(note("No sources. Tap Add."));
  syncPick(body);
}

function editRow(li, source, backend, body) {
  li.classList.add("source-row");
  li.dataset.key = source.key;
  li._source = source;
  if (source.error) li.querySelector(".cell-subtitle")?.classList.add("cell-error");
  li.querySelector(".cell-icon").append(sourceIconImage(source.key, sourceIcons(source), backend)); // B58: cached
  // F72: iFizBox's own source is built in: a lock where the circle goes, and it can't be picked.
  if (isBuiltin(source)) {
    li.dataset.builtin = "1";
    li.append(lockMark("source-lock", `${displayName(source)} is built in: it can't be removed`));
    return;
  }
  // Installed's multi-select circle (packages.css .manage-row/.manage-check); a tap ticks the row for Delete (n).
  li.classList.add("manage-row");
  const inner = li.querySelector(".cell-inner");
  inner?.setAttribute("aria-selected", "false");
  const check = el("span", "manage-check");
  check.setAttribute("aria-hidden", "true");
  li.addEventListener("click", (e) => {
    e.preventDefault();
    const on = li.classList.toggle("picked");
    inner?.setAttribute("aria-selected", String(on));
    syncPick(body);
  });
  li.append(check);
}

// ---- Sources: picking and deleting --------------------------------------------------------------------------------

// The live refresh state of one source, from the Sources tab (screens/sources.js sets it: this file can't import
// that one, which imports this): { count, failed }, or null when no refresh holds it.
let rowState = () => null;
export function setSourceRowState(f) { rowState = f ?? (() => null); }

// One source as the Sources tab counts it: its badge (the refresh's count once it landed, else the stored count) and
// whether its row shows failed (the refresh's failure, else the stored error).
// A refresh that failed shows "!" in place of the count, so it adds nothing; one still loading keeps the stored badge.
export function sourceTally(source, live = rowState(source.key)) {
  if (live?.failed) return { count: 0, failed: true };
  const count = typeof live?.count === "number" ? live.count : typeof source.count === "number" ? source.count : 0;
  return { count, failed: live ? false : Boolean(source.error) };
}

// The grey line over the list: "2 selected · 3 sources · 1,204 apps · 1 not loading". `tallies` is every shown
// source ({ count, failed }), `picked` how many are ticked; packages where APT is kept, apps where it isn't.
export function sourceSummary(tallies, picked = 0, apt = aptKept()) {
  const total = tallies.reduce((t, s) => t + (s.count || 0), 0);
  const failing = tallies.filter((s) => s.failed).length;
  return [...(picked ? [`${picked} selected`] : []), plural(tallies.length, "source"),
    `${total.toLocaleString("en-US")} ${apt ? "package" : "app"}${total === 1 ? "" : "s"}`, `${failing} not loading`].join(" · ");
}

// The bottom toolbar from `pickable` (rows that can be ticked) and `picked`: Select All / Deselect, Delete (n).
export function sourceToolbar(pickable, picked) {
  const every = pickable > 0 && picked === pickable;
  return {
    select: { label: every ? "Deselect" : "Select All", disabled: !pickable },
    delete: { label: picked ? `Delete (${picked})` : "Delete", disabled: !picked },
  };
}

// The action sheet's one button: "Delete <name>" for one source, "Delete N Sources" for more.
export const deleteSourcesLabel = (names) => names.length === 1 ? `Delete ${names[0]}` : `Delete ${names.length} Sources`;

const pick = { body: null, summary: null, bar: null };
const pickRows = (body = pick.body) => [...(body?.querySelectorAll(".manage-list > .source-row.manage-row") ?? [])];
const pickedRows = () => pickRows().filter((r) => r.classList.contains("picked"));
// On screen: this page's body, and the route (in this tab or opened from another, #/home/~sources/…) is this page.
const pickShown = () => {
  if (!pick.body?.isConnected || typeof location === "undefined") return false;
  const r = mounted(parse(location.hash));
  return r.tab === "sources" && isManage(r) && page(r) === "sources";
};

function pickBar() {
  if (pick.bar) return pick.bar;
  const bar = el("div", "manage-toolbar source-toolbar");
  bar.setAttribute("role", "toolbar");
  const select = barButton("Select All", "manage-select");
  const del = barButton("Delete", "manage-delete");
  select.addEventListener("click", () => {
    const rows = pickRows();
    const every = rows.length && rows.every((r) => r.classList.contains("picked"));
    for (const r of rows) {
      r.classList.toggle("picked", !every);
      r.querySelector(".cell-inner")?.setAttribute("aria-selected", String(!every));
    }
    syncPick();
  });
  del.addEventListener("click", () => deletePicked());
  bar.append(select, del);
  pick.bar = { el: bar, select, delete: del };
  return pick.bar;
}

// The grey line, the toolbar's labels, and the toolbar shown only while this page is (My IPAs' syncToolbar).
function syncPick(body = pick.body) {
  if (typeof document === "undefined" || !body) return;
  pick.body = body;
  const ul = body.querySelector(".manage-list");
  const sources = [...(ul?.querySelectorAll(":scope > .source-row") ?? [])].map((r) => r._source).filter(Boolean);
  const rows = pickRows(body);
  const n = rows.filter((r) => r.classList.contains("picked")).length;
  if (ul) {
    pick.summary ??= el("p", "manage-summary");
    pick.summary.textContent = sourceSummary(sources.map((s) => sourceTally(s)), n);
    if (pick.summary.nextSibling !== ul) ul.before(pick.summary);
  }
  // the page is drawn before it is pushed: the toolbar waits a frame for it to be on screen
  requestAnimationFrame(() => syncPickBar());
}

function syncPickBar(pickable = pickRows().length, picked = pickedRows().length) {
  const show = pickShown();
  if (!show && !pick.bar) return;
  const bar = pickBar();
  if (show) {
    const spec = sourceToolbar(pickable, picked);
    for (const kind of ["select", "delete"]) {
      bar[kind].textContent = spec[kind].label;
      bar[kind].disabled = spec[kind].disabled;
    }
    if (!bar.el.isConnected) document.body.append(bar.el);
    requestAnimationFrame(() => requestAnimationFrame(() => { if (pickShown()) bar.el.classList.add("shown"); }));
  } else bar.el.classList.remove("shown");
  document.documentElement.classList.toggle("has-manage-toolbar", show);
}

// Leaving the page (Back, another tab, a pushed page) puts the toolbar away; coming back shows it again.
if (typeof window !== "undefined") window.addEventListener("hashchange", () => requestAnimationFrame(() => syncPickBar()));

// Delete (n): one action sheet, then the picked rows collapse away.
async function deletePicked() {
  const rows = pickedRows();
  if (!rows.length) return;
  const index = await showActionSheet({ buttons: [deleteSourcesLabel(rows.map((r) => displayName(r._source)))], destructive: 0 });
  if (index !== 0) return;
  await removeRows(rows, pick.body);
}

// One at a time (each remove rewrites the saved list), then the rows that went collapse together and the rows below
// slide up; a remove that fails says why and its row stays, still ticked.
async function removeRows(rows, body) {
  const gone = [];
  let error = null;
  for (const li of rows) {
    li.classList.add("removing");
    try {
      await getBackend().removeSource(li._source.key);
      gone.push(li);
    } catch (e) {
      li.classList.remove("removing");
      error ??= e;
    }
  }
  if (gone.length) changed();
  if (error) await showAlert({ title: "Error", message: error.message, buttons: ["OK"] });
  if (!gone.length) return;
  const ul = gone[0].parentNode;
  if (ul && ul.querySelectorAll(":scope > .source-row").length > gone.length) {
    for (const li of gone) { li.classList.remove("manage-row", "picked"); li._source = null; collapse(li); }
    syncPick(body);
  } else renderSources(body);
}

// F144: where APT repos aren't kept (the sideload app; the site while Settings > Device says Not Jailbroken), Add
// takes app sources only, so the alert doesn't ask for an APT URL.
export const aptKept = (mode = detectMode(), site = siteJailbroken) => (mode === "site" ? site() : mode !== "sideload");
export const addSourceText = (apt = aptKept()) => apt
  ? { title: "Enter APT URL", message: "Or an app source (.json): AltStore, ESign, Scarlet or GBox." }
  : { title: "Enter Source URL", message: "An app source (.json): AltStore, ESign, Scarlet or GBox." };

// Add Source, as the Sources tab's Edit mode had it (docs/cydia.md "Sources tab").
// F8: `prefill` ({ url, dist?, components? }, from a /add?url= link, core/handoff.js parseAddLink) fills the field;
// a dist repo's suite and components are named in the message and go along while the URL is left as it was.
// B177: `edit` ({ title, button }: a failed source's Edit Source, screens/sourceerror.js) renames the alert, and an
// unchanged URL saves nothing. Resolves to the saved record (null when nothing was added).
// B335: `pasteSubmits` (Sources' Add only, screens/sources.js addSourceNow) makes the alert's Paste add the pasted URL
// at once, as Add Source would; `alert` is for tests (the first alert only).
export async function addSource(ctx, prefill = null, edit = null, { pasteSubmits = false, alert = showAlert } = {}) {
  const dist = prefill?.dist ? `Suite ${prefill.dist}${prefill.components?.length ? `, ${prefill.components.join(" ")}` : ""}.` : "";
  const { index, value } = await alert({
    ...addSourceText(),
    ...(dist ? { message: dist } : {}),
    ...(edit?.title ? { title: edit.title } : {}),
    input: { placeholder: "https://", value: prefill?.url || "https://", type: "url", paste: cleanSourceUrl,
      ...(pasteSubmits ? { pasteSubmits: 1 } : {}) },
    buttons: ["Cancel", edit?.button || "Add Source"],
    cancel: 0,
  });
  if (index !== 1) return null;
  // A pasted https://… into the field's own https:// would read https://https://…: cleanSourceUrl fixes it.
  const typed = cleanSourceUrl(value) || value.trim();
  if (edit && typed === prefill?.url) return null;
  const input = dist && typed === prefill.url ? { uri: prefill.url, dist: prefill.dist, components: prefill.components } : typed;
  if (!(await confirmWarning(input))) return;
  // F291: a source not on the known-safe list: Unknown Source (Add & Trust / Add Source / Cancel)
  const unknown = await confirmUnknownSource(input);
  if (!unknown) return;
  let error = null;
  let saved = null;
  try {
    saved = await addSecure(input, { backend: getBackend(), showHUD: ctx.showHUD, replaces: edit?.replaces ?? null });
    if (!saved) return null; // F220: Cancel
    if (saved.alreadyAdded) { // B273: in the list already, under this or another spelling: nothing saved
      await showAlert(alreadyAddedAlert(saved));
      return null;
    }
    if (unknown.trust) markTrusted(saved.uri ? saved : input);
  } catch (e) {
    error = e;
  }
  if (error) {
    await showAlert({ title: error.title || "Verification Error", message: error.message, buttons: ["OK"] });
    return null;
  }
  // B306: an add from a link (incoming.js: another app's source link, ifizbox://add) brings only a HUD, no screen's
  // ctx: the Sources tab loads the new source with its own (sources.js), under the reload bar and the badge.
  changed(ctx.fromLink ? undefined : ctx);
  const body = document.querySelector(".page.is-top .manage-list")?.closest(".page-body");
  if (body) renderSources(body);
  return saved;
}

// B273: Add Source on a source the list has already (any spelling of its URL, or the same app source identifier).
export const alreadyAddedAlert = (source) => ({
  title: "Already Added",
  message: `${displayName(source)} is in your sources already.`,
  buttons: ["OK"],
});

// F220: Zebra's warning for an http: source, the iOS 6 way. Cancel is the safe choice, so it gets the darker
// "Button (Cancel)" look and Escape.
export const INSECURE_ALERT = {
  title: "This Source Is Not Secure",
  message: "Its files are sent without encryption, and someone on the same network could change them. Add it anyway?",
  buttons: ["Cancel", "Add"],
  cancel: 0,
};

// F220: adds `input` under the Verifying URL HUD. An http:// one is tried over https:// first: if that answers, the
// https source is added and nothing is said; otherwise INSECURE_ALERT asks before the http one is added. Resolves
// to the saved record, or null on Cancel; throws the backend's error (SourceError) when the add fails.
export async function addSecure(input, { backend, showHUD = () => () => {}, alert = showAlert, replaces = null } = {}) {
  const opts = replaces ? [{ replaces }] : []; // B273: Edit Source's old key doesn't count as Already Added
  const https = httpsInput(input);
  if (https) {
    const hide = showHUD("Verifying URL");
    let saved = null, ok = false;
    try { saved = await backend.addSource(https, ...opts); ok = true; } catch { /* no https twin: ask */ } finally { hide(); }
    if (ok) return saved ?? { input: https };
    if ((await alert(INSECURE_ALERT)).index !== 1) return null;
  }
  const hide = showHUD("Verifying URL");
  try {
    return (await backend.addSource(input, ...opts)) ?? { input };
  } finally {
    hide();
  }
}

// F19: Cydia's Source Warning, from our own list (core/warnings.js), before anything is fetched. Resolves true to
// go on: the source isn't listed, or the user tapped Add Anyway.
async function confirmWarning(input) {
  const w = sourceWarning(input);
  if (!w) return true;
  return (await showAlert(warningAlert(w))).index === 1;
}

// ---- Import & Export -------------------------------------------------------------------------------------------
// F317: Import's hint in two short sentences (AGENTS.md, Hints).
export const IMPORT_FOOTER = "Reads a list of URLs, Sileo's .sources, Cydia's .list and AltStore-style JSON. "
  + "You see which are new before anything is added.";

function renderIO(body, route, ctx) {
  const file = Object.assign(document.createElement("input"), { type: "file", hidden: true,
    accept: ".txt,.list,.sources,.json,text/plain,application/json" });
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    try {
      await startReview(await f.text(), route, ctx);
    } catch (e) {
      await showAlert({ title: "Error", message: e.message, buttons: ["OK"] });
    }
  });
  body.replaceChildren(grouped([
    { header: "Export", rows: [
      { label: "Share List", onClick: () => shareList(), icon: rowIcon("share") },
      { label: "Copy to Clipboard", onClick: () => copyList(), icon: rowIcon("copy") },
      { label: "Save as File", onClick: () => saveFile(), icon: rowIcon("saveFile") },
      { label: "Show QR Code", onClick: () => showQR(), icon: rowIcon("qr") },
    ], footer: `Every source's URL, one per line. Another phone's ${NAME} reads it back (Import), and so do most `
      + "package managers, one URL at a time." },
    { header: "Import", rows: [
      { label: "From File", onClick: () => file.click(), icon: rowIcon("fromFile") },
      { label: "From Clipboard", onClick: (e) => importClipboard(e.currentTarget, route, ctx), icon: rowIcon("fromClipboard") },
    ], footer: IMPORT_FOOTER },
  ]), file);
}

// F72: iFizBox's own source (built in) is left out: every iFizBox has it.
async function exportNow() {
  const all = exportable((await shownSources()).all);
  return { text: exportText(all), count: all.length };
}

// F52: the URLs alone, one per line (no header comment), for pasting anywhere.
async function copyList() {
  const all = exportable((await shownSources()).all); // F72: not the built-in source
  await copyText(clipboardText(all));
  await showAlert({ title: "Copied", message: `${plural(all.length, "source")} on the clipboard, one URL per line.`, buttons: ["OK"] });
}

async function shareList() {
  const { text } = await exportNow();
  if (navigator.share) {
    try { await navigator.share({ title: `${NAME} Sources`, text }); return; } catch (e) { if (e?.name === "AbortError") return; }
  }
  try {
    await navigator.clipboard.writeText(text);
    await showAlert({ title: "Copied", message: "The source list is on the clipboard.", buttons: ["OK"] });
  } catch {
    await showAlert({ title: "Can't Share", message: "This browser has no share sheet or clipboard. Use Save as File.", buttons: ["OK"] });
  }
}

// A file through the share sheet where it takes files (iOS: Save to Files, AirDrop), else a download.
async function saveFile() {
  const { text } = await exportNow();
  const blob = new Blob([text], { type: "text/plain" });
  const f = typeof File === "function" ? new File([blob], EXPORT_FILENAME, { type: "text/plain" }) : null;
  if (f && navigator.canShare?.({ files: [f] })) {
    try { await navigator.share({ files: [f], title: `${NAME} Sources` }); return; } catch (e) { if (e?.name === "AbortError") return; }
  }
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: EXPORT_FILENAME });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function showQR() {
  const { text, count } = await exportNow();
  let svg;
  try {
    svg = qrSvg(text, { ecc: text.length > 1200 ? "L" : "M" });
  } catch {
    await showAlert({ title: "Too Many Sources", message: `${plural(count, "source")} won't fit in one QR code. Use Share List or Save as File.`, buttons: ["OK"] });
    return;
  }
  const box = el("div", "sheet-scroll page-body grouped manage-qr"); // page-body: clears the sheet's nav bar
  const img = new Image();
  img.alt = `QR code of ${plural(count, "source")}`;
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  box.append(img, el("p", "group-footer", `${plural(count, "source")}. Scan it with the other phone's Camera, `
    + "copy the text it shows, then Import > From Clipboard."));
  showSheet({ title: "QR Code", body: box });
}

// Import > From Clipboard, as Sources' Add (sources.js addFromClipboard): the app reads UIPasteboard (nav/menu.js
// nativePaste); the website iOS's Paste bubble, read straight from the tap (Safari allows no timer between).
// Dismissed or empty: nothing found.
async function importClipboard(row, route, ctx) {
  row?.classList.remove("is-pressed");
  let text = nativeBridge() ? await nativePaste() : null; // no await on the website: it could lose the tap
  if (text == null) { try { text = await navigator.clipboard.readText(); } catch { text = ""; } }
  if (!/^#\/sources\/manage\/io\/?$/.test(location.hash)) return; // left the page while the bubble was up
  await startReview(text, route, ctx);
}

async function startReview(text, route, ctx) {
  const { entries } = parseImport(text);
  if (!entries.length) {
    await showAlert({ title: "No Sources Found", message: "There are no source URLs in that text. Copy a list of URLs or a sources file first.", buttons: ["OK"] });
    return;
  }
  const have = await getBackend().sources().catch(() => []);
  pending = reviewImport(entries, have).map((e) => ({ ...e, pick: e.status === "new" && !e.warning }));
  ctx.go({ tab: "sources", path: [SEGMENT, "io", "review"] });
}

function renderReview(body) {
  if (!pending) {
    body.replaceChildren(note("Nothing to import. Go back and pick a file or copy a list."));
    return;
  }
  const row = (e) => ({ label: e.uri.replace(/^https?:\/\//, ""), subtitle: e.dist && e.dist !== "./" ? `${e.dist} ${e.components.join(" ")}` : undefined });
  const fresh = pending.filter((e) => e.status === "new" && !e.warning);
  const warned = pending.filter((e) => e.status === "new" && e.warning); // F19: Source Warning, unticked
  const listed = pending.filter((e) => e.status === "listed");
  const unsupported = pending.filter((e) => e.status === "unsupported");
  const sections = [];
  const toggle = (e) => (ev) => {
    e.pick = !e.pick;
    const inner = ev.currentTarget;
    inner.querySelector(".cell-check")?.remove();
    if (e.pick) inner.append(el("span", "cell-check"));
  };
  if (fresh.length) {
    sections.push({ header: `New (${fresh.length})`, rows: fresh.map((e) => ({ ...row(e), checked: e.pick, onClick: toggle(e) })),
      footer: "Tap a source to leave it out." });
  }
  if (warned.length) {
    sections.push({ header: `Source Warning (${warned.length})`,
      rows: warned.map((e) => ({ ...row(e), subtitle: e.warning.reason, checked: e.pick, onClick: toggle(e) })),
      footer: `These are on ${NAME}'s list of piracy sources. `
        + "Tap one to add it anyway." });
  }
  if (listed.length) sections.push({ header: `Already Listed (${listed.length})`, rows: listed.map(row) });
  if (unsupported.length) {
    sections.push({ header: `Can't Add (${unsupported.length})`, rows: unsupported.map(row),
      footer: `These lines name no source ${NAME} can add.` });
  }
  body.replaceChildren(grouped(sections));
  body.classList.add("manage-review");
}

async function addPicked(ctx) {
  const picks = (pending ?? []).filter((e) => e.status === "new" && e.pick);
  if (!picks.length) {
    await showAlert({ title: "Nothing to Add", message: "No new sources are ticked.", buttons: ["OK"] });
    return;
  }
  const hide = ctx.showHUD("Adding Sources");
  const failed = [];
  for (const e of picks) {
    try { await getBackend().addSource(e.input); e.status = "listed"; } catch (err) { failed.push(`${e.uri}: ${err.message}`); }
  }
  hide();
  changed(ctx);
  const ok = picks.length - failed.length;
  await showAlert({ title: failed.length ? "Some Sources Failed" : "Sources Added",
    message: [`Added ${plural(ok, "source")}.`, ...failed].join("\n\n"), buttons: ["OK"] });
  pending = null;
  ctx.go({ tab: "sources", path: [SEGMENT, "sources"] });
}

// ---- Recommended (F52) ----------------------------------------------------------------------------------------
// The data behind More Sources' Recommended group (F327, screens/moresources.js draws it): recRows (core/sourcelist.js
// recommendedRows for this device), loadPreview, addRecommended, recHref. A row opens the source: an added one its
// real page, one not added yet a preview here (#/sources/manage/recommended/<key>) read straight from its URL. No
// Games: this page lists sources; a game is a package and belongs on Home.

const previews = new Map(); // key -> { record fields read before adding (name, iconURL, count), apps }

// F19: which jailbreak Recommended is for: the user's pick, else the jailbreak's marker files (F56, core/recommended.js
// jailbreakFromMarkers), else what apt's source files say (the jailbreak app; detectJailbreak), else null (every tweak repo, as before). { id, detected }.
let detectedJailbreak; // a promise, asked once per session
export async function currentJailbreak() {
  const saved = savedJailbreak();
  if (saved) return { id: saved, detected: false };
  const backend = getBackend();
  // F56: the shell's marker files (app.info `markers`) answer for sure; apt's source files are the fallback.
  const native = nativeBridge();
  const fromMarkers = () => (native?.call
    ? Promise.resolve().then(() => native.call("app.info", {})).then((i) => jailbreakFromMarkers(i?.markers), () => null)
    : Promise.resolve(null));
  const fromApt = () => (backend.aptSourceFiles
    ? backend.aptSourceFiles().then(detectJailbreak, () => null)
    : Promise.resolve(null));
  detectedJailbreak ??= fromMarkers().then((id) => id ?? fromApt());
  const id = await detectedJailbreak;
  return { id, detected: Boolean(id) };
}

export const recRows = async () => {
  const sources = await getBackend().sources().catch(() => []);
  const jailbroken = settings.deviceType() !== "none";
  const recs = jailbroken ? recommendedFor(RECOMMENDED_SOURCES, (await currentJailbreak()).id) : RECOMMENDED_SOURCES;
  return recommendedRows(recs, sources, { jailbroken, previews });
};

// B272: Find App Sources' rows (core/appsources.js findAppSources): Recommended's AltStore sources and the directory's,
// added ones included, as recRows draws them, so the same ADD, preview and icon code serves both pages.
const appSourceEntries = () => findAppSources(RECOMMENDED_SOURCES, { blocked: (u) => Boolean(sourceWarning(u)) });
export const appSourceRows = async () => {
  const sources = await getBackend().sources().catch(() => []);
  return recommendedRows(appSourceEntries(), sources, { jailbroken: false, previews });
};

// An AltStore source's JSON, read once per visit, so its row gets a name, icon and count and its preview its apps.
export async function loadPreview(row) {
  if (row.rec.jailbreak) return null;
  if (previews.has(row.key)) return previews.get(row.key);
  // B272: one read per source at a time (Find App Sources' row icon and its "did any answer" check ask together).
  if (!reading.has(row.key)) {
    reading.set(row.key, (async () => {
      const text = await getBackend().text(row.record.uri);
      const parsed = parseSource("altstore", text);
      const p = { ...altRecord(row.record.uri, parsed), updated: null, apps: parsed.apps };
      previews.set(row.key, p);
      return p;
    })().finally(() => reading.delete(row.key)));
  }
  return reading.get(row.key);
}
const reading = new Map(); // key -> the read in flight

// Search's "Recommended Sources" group: the AltStore sources Recommended lists that aren't added yet, each with its
// apps (read once per visit, as above). A source that doesn't answer is left out.
export async function recommendedApps() {
  const rows = (await recRows()).filter((r) => !r.added && !r.rec.jailbreak);
  const read = await Promise.all(rows.map((row) => loadPreview(row).then((p) => ({ row, apps: p?.apps ?? [] }), () => null)));
  return read.filter(Boolean);
}

// A successful add tells onSourcesChanged's listeners with `ctx`: screens/sources.js starts loading the new source
// under the reload bar (loadNew), and an open Search drops it from Recommended Sources and runs its query again
// once its packages land (B98). `backend` and `alert` are for the tests.
export async function addRecommended(row, ctx, { backend = getBackend(), alert = showAlert } = {}) {
  const hide = ctx.showHUD("Verifying URL");
  let error = null;
  try {
    await backend.addSource(row.input);
  } catch (e) {
    error = e;
  } finally {
    hide();
  }
  if (error) {
    await alert({ title: error.title || "Verification Error", message: error.message, buttons: ["OK"] });
    return false;
  }
  changed(ctx);
  return true;
}

export const recHref = (row) => (row.added ? format({ tab: "sources", path: [row.key] }) : here("recommended", row.key));

// A recommended source before it is added: its apps as read from its URL (an AltStore source), or its packages
// by section (a tweak repo, F54: its Packages parsed in the worker). Add in the nav bar adds it and opens
// its real page.
async function previewRow(route) {
  const key = route.path[2];
  return (await recRows()).find((r) => r.key === key) ?? (await appSourceRows()).find((r) => r.key === key) ?? null; // B272
}

async function addFromPreview(route, ctx) {
  const row = await previewRow(route);
  if (!row) return;
  if (!row.added && !(await addRecommended(row, ctx))) return;
  ctx.go({ tab: "sources", path: [row.key] });
}

async function renderPreview(body, route) {
  const row = await previewRow(route);
  if (!row) {
    body.replaceChildren(note("Nothing here."));
    return;
  }
  const head = { header: row.label, rows: [{ label: row.subtitle, subtitle: row.rec.why }],
    footer: row.added ? "This source is in your list." : "Tap Add to put it in your Sources." };
  if (row.rec.jailbreak) return renderRepoPreview(body, route, row, head);
  body.replaceChildren(placeholder("page"));
  let p;
  try {
    p = await loadPreview(row);
  } catch (e) {
    body.replaceChildren(grouped([head]), note(e.message));
    body.classList.add("manage-why");
    return;
  }
  const apps = p.apps.map((a) => ({ label: a.name, subtitle: a.subtitle || a.developerName || a.id,
    icon: { text: a.name?.[0]?.toUpperCase() ?? "?" }, iconURL: a.iconURL }));
  body.replaceChildren(grouped([head]));
  const ul = plain([{ header: `${plural(apps.length, "App")}`, rows: apps }]);
  ul.classList.add("rec-apps");
  const backend = getBackend();
  [...ul.querySelectorAll(":scope > .cell")].forEach((li, i) => {
    const url = apps[i].iconURL;
    if (!url) return;
    li.classList.add("source-row");
    const img = new Image();
    img.alt = "";
    img.decoding = "async";
    img.loading = "lazy";
    img.onload = () => img.classList.add("loaded");
    img.onerror = () => img.remove();
    img.src = backend.assetUrl ? backend.assetUrl(url) : url;
    li.querySelector(".cell-icon").append(img);
  });
  body.append(ul);
  body.classList.add("manage-why");
}

// ---- A tweak repo's preview (F54) -----------------------------------------------------------------------------
// Its Packages, fetched as Refresh fetches it (backend.packages: .xz, .bz2, .gz or plain, decompressed off the page)
// and parsed in the worker (core/parser.js), summed up by core/sourcelist.js packagePreview: the packages for this
// iPhone's arch under Cydia's section names, in a virtualised list (nav/vlist.js via browse.js packageList), as
// the Sources tab shows them once added. Rows don't open a package page: that needs the repo in the catalog, so
// Add first. Read once per visit, like the AltStore previews.

const repoPreviews = new Map(); // key -> Promise<{ total, sections }>

async function loadRepoPreview(row) {
  const arch = getArch();
  const id = `${row.key} ${arch}`;
  if (!repoPreviews.has(id)) {
    const p = (async () => {
      const layout = repoLayout(row.record, arch);
      const stanzas = [];
      let firstError = null;
      for (const file of layout.packages) {
        try {
          const { text } = await getBackend().packages(file.slice(0, -"Packages".length));
          stanzas.push(...(await getParser().packages(text, layout.root)));
        } catch (e) {
          firstError ??= e;
        }
      }
      if (!stanzas.length && firstError) throw firstError;
      return packagePreview(stanzas, arch);
    })();
    repoPreviews.set(id, p);
    p.catch(() => repoPreviews.delete(id)); // a failed read is tried again next visit
  }
  return repoPreviews.get(id);
}

async function renderRepoPreview(body, route, row, head) {
  body.classList.add("manage-why");
  body.replaceChildren(grouped([head]), placeholder("list", 6));
  let preview;
  try {
    preview = await loadRepoPreview(row);
  } catch (e) {
    body.replaceChildren(grouped([head]), note(e?.message || String(e)));
    return;
  }
  if (!body.isConnected) return;
  const summary = { rows: [], footer: `${plural(preview.total, "package")} in ${plural(preview.sections.length, "section")}`
    + (row.added ? "." : ". Add it to install them; its packages then show under Sources.") };
  body.replaceChildren(grouped([head, summary]));
  if (!preview.total) {
    body.append(note("No packages for this iPhone."));
    return;
  }
  const items = preview.sections.flatMap((s) => [{ header: `${s.name} (${s.packages.length.toLocaleString()})` },
    ...s.packages.map((p) => ({ ...p, version: "", section: s.name, key: row.key }))]);
  const list = packageList(body, route, items, {
    letters: false,
    // Not in the catalog yet, so no package page to open.
    decorate: (r) => { r._.a.removeAttribute("href"); r._.a.setAttribute("aria-disabled", "true"); },
  });
  list.el.classList.add("rec-packages");
  body.append(list.el);
}
