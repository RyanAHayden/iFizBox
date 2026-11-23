// More Sources (F327, concept https://claude.ai/artifact/AC5Fa8J4xqSqh66wCddGPV, user-approved 2026-11-20): one page
// for finding sources, opened from the Sources tab's More Sources row, from Home (on Home's own stack: router.js
// mountLink) and from Manage. It replaces Manage > Recommended, whose route still opens it.
//
//   #/sources/more                 two settings-style rows, each a 40pt section icon with the green plus badge:
//   #/sources/manage/recommended     Find Tweak Sources (F305's Canister page, screens/findmore.js; only where APT
//                                    repos are kept: findMoreOn) and Find App Sources; then Recommended, its header
//                                    holding Add All (a .bar-button, as the nav bar's), in sub-groups Tweak Sources
//                                    (jailbroken only, with the Jailbreak row), From the Developer and Modded Apps
//                                    (core/recommended.js recommendedGroups); each row its source icon, name, two
//                                    lines of why and ADD / ADDED (the App Store price button)
//   #/sources/more/apps            Find App Sources: B272's directory (core/appsources.js), Recommended's app sources
//                                  and more checked ones, added ones with ADDED; same groups and rows
//
//   moreRow()            the Sources tab's and Home's row (icons/rowicons.js moreSources: a white plus, no badge)
//   notAddedCount()      -> how many recommended sources aren't in the list yet (the Sources row's badge)
//
// The rows' data and adds are manage.js's (recRows, loadPreview, addRecommended, recHref); a row opens the source
// (added) or its preview (#/sources/manage/recommended/<key>).
import { el, grouped, plain, note, barButton } from "../nav/ui.js";
import { searchBar, pinned } from "../nav/searchbar.js";
import { showAlert } from "../nav/alert.js";
import { showActionSheet } from "../nav/actionsheet.js";
import { format } from "../router.js";
import { getBackend } from "../backend.js";
import { settings } from "../settings-store.js";
import { sourceIcons } from "../core/sources.js";
import { sourceIconImage } from "../source-icon.js";
import { rowIcon } from "../icons/rowicons.js";
import {
  JAILBREAKS, jailbreakName, saveJailbreak, markRecommendedSeen, recommendedGroups, shortWhy,
} from "../core/recommended.js";
import { recRows, appSourceRows, loadPreview, addRecommended, recHref, currentJailbreak, sourcesChanged } from "./manage.js";
import { findMoreOn, findHref, addAllListed } from "./findmore.js";

export const MORE = "more";
export const APPS = "apps";
export const moreHref = (...p) => format({ tab: "sources", path: [MORE, ...p] });

// Cydia's section icons (icons/sections/, GPLv3 artwork, core/sectionicons.js): Tweaks for tweak repos, Packaging for
// app sources.
export const TWEAKS_ICON = "icons/sections/Tweaks.png";
export const APPS_ICON = "icons/sections/Packaging.png";

// #/sources/more(/apps), and the old #/sources/manage/recommended (its preview pages below it stay manage.js's).
export function page(route) {
  const p = route.path;
  if (p[0] === "manage" && p[1] === "recommended" && p.length === 2) return "root";
  if (p[0] !== MORE) return null;
  if (p.length === 1) return "root";
  if (p[1] === APPS && p.length === 2) return "apps";
  return "missing";
}
export const isMore = (route) => page(route) != null;

export function nav(route, ctx) {
  switch (page(route)) {
    case "root": return { title: "More Sources" };
    case "apps": return { title: "App Sources", right: { label: "Add All", onClick: () => addAllApps(ctx) } }; // B344
    default: return { title: "Not Found" };
  }
}

export function render(body, route, ctx) {
  switch (page(route)) {
    case "root": return renderMore(body, ctx);
    case "apps": return renderApps(body, ctx);
    default: body.replaceChildren(note("Nothing here."));
  }
}

// The Sources tab's and Home's row.
export function moreRow() {
  return { label: "More Sources", subtitle: findMoreOn() ? "find tweak and app sources" : "find app sources",
    href: moreHref(), icon: rowIcon("moreSources"), cls: "more-sources-row" };
}

export async function notAddedCount() {
  return (await recRows()).filter((r) => !r.added).length;
}

// ---- the page ----------------------------------------------------------------------------------------------------

// The two Find rows (each icon gets its green plus after drawing: findIcons).
export function findRows({ tweaks = findMoreOn() } = {}) {
  return [
    ...(tweaks ? [{ label: "Find Tweak Sources", subtitle: "Repos from Canister's directory", href: findHref(),
      icon: { src: TWEAKS_ICON, cls: "more-find-icon" }, cls: "more-find-row" }] : []),
    { label: "Find App Sources", subtitle: "Apps from their developers, and modded apps", href: moreHref(APPS),
      icon: { src: APPS_ICON, cls: "more-find-icon" }, cls: "more-find-row" },
  ];
}

function findIcons(root) {
  for (const icon of root.querySelectorAll(".more-find-icon")) icon.append(el("span", "more-plus"));
}

export function renderMore(body, ctx) {
  const box = el("div", "more-sources");
  body.replaceChildren(box);
  markRecommendedSeen(); // F19's first-run flag: Recommended has been seen
  return drawMore(box, ctx);
}

async function drawMore(box, ctx) {
  const rows = await recRows();
  const find = grouped([{ rows: findRows() }]);
  findIcons(find);
  const head = el("div", "group rec-head");
  const h = el("h2", "group-header rec-head-title");
  const addAllButton = barButton("Add All", "rec-add-all");
  addAllButton.addEventListener("click", () => addAll(ctx, () => drawMore(box, ctx)));
  h.append(el("span", null, "Recommended"), addAllButton);
  head.append(h);
  const jb = settings.deviceType() !== "none" ? await currentJailbreak() : null;
  const parts = [find, head, recGroups(rows, ctx, () => drawMore(box, ctx), { jb })];
  parts.push(el("p", "group-footer rec-foot", "Tap a source to see what's in it before adding."));
  box.replaceChildren(...parts);
}

// Recommended's sub-groups as grouped tables. `jb` ({ id, detected }, jailbroken only) adds the Jailbreak row
// under Tweak Sources.
function recGroups(rows, ctx, redraw, { jb = null } = {}) {
  const groups = recommendedGroups(rows);
  const frag = grouped(groups.map((g) => ({ header: g.header, rows: [
    ...g.rows.map(recCell),
    ...(g.id === "tweaks" && jb ? [{ label: "Jailbreak", detail: jb.id ? jailbreakName(jb.id) : "Any", cls: "rec-jailbreak",
      onClick: () => pickJailbreak(redraw), chevron: true }] : []),
  ] })));
  const boxes = [...frag.children];
  groups.forEach((g, i) => {
    boxes[i].classList.add("rec-sub");
    const cells = boxes[i].querySelectorAll(".cell");
    g.rows.forEach((r, j) => decorate(cells[j], r, ctx, redraw));
  });
  return frag;
}

const recCell = (r) => ({ label: r.label, subtitle: shortWhy(r.rec), icon: { text: r.label[0]?.toUpperCase() ?? "?" },
  href: recHref(r), chevron: false, cls: "rec-more-row" });

// `find`: App Sources' rows, which wear Find More's ADD (findmore.js .find-add, centred on the row).
function decorate(li, r, ctx, redraw, { find = false } = {}) {
  if (!li) return;
  li.dataset.key = r.key;
  setIcon(li, r.key, r.icons);
  const b = addButton(r, ctx, redraw);
  if (find) b.classList.add("find-add");
  li.append(b);
  // An AltStore source not read yet gets its icon from its JSON (read once per visit; tweak repos wait for Refresh).
  if (!r.rec.jailbreak && !r.record.iconURL) {
    loadPreview(r).then((p) => {
      if (p?.iconURL && li.isConnected) setIcon(li, r.key, sourceIcons({ ...r.record, iconURL: p.iconURL }));
    }).catch(() => {});
  }
}

function setIcon(li, key, icons) {
  const icon = li.querySelector(".cell-icon");
  if (!icon) return;
  icon.querySelector("img")?.remove();
  try { icon.append(sourceIconImage(key, icons, getBackend())); } catch { /* the letter stays */ }
}

// ADD / ADDED: the iOS 6 App Store price button (myipas.css .price-btn, as FREE in Browse and My IPAs). ADDED is
// greyed and does nothing.
export function addButton(r, ctx, redraw = () => {}, { add = addRecommended } = {}) {
  const b = el("button", "price-btn rec-add" + (r.added ? " added" : ""), r.added ? "ADDED" : "ADD");
  b.type = "button";
  b.disabled = Boolean(r.added);
  b.setAttribute("aria-label", (r.added ? "Added: " : "Add ") + r.label);
  b.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (b.disabled) return;
    b.disabled = true;
    if (await add(r, ctx)) {
      b.classList.add("added");
      b.textContent = "ADDED";
      redraw();
    } else b.disabled = false;
  });
  return b;
}

// Add All: an action sheet with the count, then each source not added yet in turn under the Verifying URL HUD, as one
// ADD does. Failures are named in one alert at the end.
async function addAll(ctx, redraw) {
  const todo = (await recRows()).filter((r) => !r.added);
  if (!todo.length) {
    await showAlert({ title: "Recommended", message: "Every recommended source is in your list.", buttons: ["OK"] });
    return;
  }
  const what = todo.length === 1 ? "the 1 recommended source" : `the ${todo.length} recommended sources`;
  const i = await showActionSheet({ title: `Add ${what} that aren't in your list yet?`, buttons: ["Add All"] });
  if (i !== 0) return;
  const failed = [];
  const hide = ctx.showHUD("Verifying URL");
  try {
    for (const r of todo) {
      try { await getBackend().addSource(r.input); } catch { failed.push(r.label); }
    }
  } finally {
    hide();
  }
  sourcesChanged(ctx);
  if (failed.length) await showAlert({ title: "Verification Error", message: `Couldn't add ${failed.join(", ")}.`, buttons: ["OK"] });
  redraw();
}

// F19: the Jailbreak row's picker: one button per jailbreak, then Cancel.
async function pickJailbreak(redraw) {
  const buttons = [...JAILBREAKS.map((j) => j.name), "Cancel"];
  const { index } = await showAlert({ title: "Jailbreak", message: "Recommended lists the tweak sources that suit it.",
    buttons, cancel: buttons.length - 1 });
  if (index >= JAILBREAKS.length) return;
  saveJailbreak(JAILBREAKS[index].id);
  redraw();
}

// ---- Find App Sources --------------------------------------------------------------------------------------------

// Find More's row (findmore.js repoCell): the source's name and one line saying what it carries.
const appCell = (r) => ({ label: r.label, subtitle: shortWhy(r.rec), icon: { text: r.label[0]?.toUpperCase() ?? "?" },
  href: recHref(r), chevron: false });

// B344: the same page as Find Tweak Sources (findmore.js renderFind): a search bar pinned under the nav bar, one plain
// list with a section per group, Find More's rows (icon, name, one line, ADD / ADDED) and Add All in the nav bar
// (findmore.js addAllListed over the rows shown). The search filters the directory here; nothing is asked.
export function renderApps(body, ctx) {
  const box = el("div", "find-more more-apps");
  let query = "";
  const bar = searchBar({ placeholder: "Search Sources", ariaLabel: "Search app sources", delay: 150, className: "find-search",
    onQuery: (q) => { query = q; drawApps(box, ctx, { query }); } });
  body.replaceChildren();
  pinned(body, bar).append(box);
  return drawApps(box, ctx, { query });
}

// What App Sources' Add All works on: the rows the page shows now and how to draw them again.
let appsListed = { rows: [], redraw: () => {} };

export function addAllApps(ctx, opts = {}) {
  return addAllListed(ctx, { rows: appsListed.rows, redraw: appsListed.redraw, noun: "source", input: (r) => r.input,
    nameOf: (r) => r.label, title: "App Sources", ...opts });
}

// A row matches when the query is in its name, its reason or its URL (case ignored).
export function matchesQuery(r, q) {
  const words = String(q ?? "").trim().toLowerCase();
  if (!words) return true;
  return [r.label, r.rec?.why, r.rec?.url].some((t) => String(t ?? "").toLowerCase().includes(words));
}

// B272: every source in the directory (manage.js appSourceRows: Recommended's app sources and the checked extras of
// core/appsources.js), added ones kept with ADDED, so the page is never empty. Each source not added yet is read for
// its icon (decorate: loadPreview); only when none of them answers does a note say so, under the footer, where it
// pushes nothing down. `rows` and `preview` are seams for the tests. Resolves once that check has ended.
export async function drawApps(box, ctx, { rows: load = appSourceRows, preview = loadPreview, query = "" } = {}) {
  const turn = (box.drawTurn = (box.drawTurn ?? 0) + 1); // a newer draw (the next search letter) wins
  const all = await load();
  if (turn !== box.drawTurn) return;
  const rows = all.filter((r) => matchesQuery(r, query));
  const redraw = () => drawApps(box, ctx, { rows: load, preview, query });
  appsListed = { rows, redraw };
  const groups = recommendedGroups(rows);
  const ul = plain(groups.map((g) => ({ header: g.header, rows: g.rows.map(appCell) })));
  ul.classList.add("rec-list", "find-list");
  const cells = [...ul.querySelectorAll(".cell")];
  groups.flatMap((g) => g.rows).forEach((r, i) => {
    cells[i]?.classList.add("source-row", "rec-row", "find-row");
    decorate(cells[i], r, ctx, redraw, { find: true });
  });
  const parts = [ul];
  if (!rows.length) parts.push(note("No app sources found."));
  parts.push(el("p", "group-footer find-credit", "App sources from their developers and from mod makers. Tap one to see "
    + "its apps before adding. Piracy sources are never listed."));
  box.replaceChildren(...parts);
  const fresh = rows.filter((r) => !r.added);
  if (!fresh.length) return;
  const read = await Promise.allSettled(fresh.map((r) => preview(r)));
  if (turn === box.drawTurn && read.every((x) => x.status === "rejected" || !x.value) && box.isConnected !== false) {
    const why = read.find((x) => x.status === "rejected")?.reason?.message;
    box.append(note(`None of these sources answered${why ? `: ${why}` : ""}. Check the connection and open this page again.`));
  }
}
