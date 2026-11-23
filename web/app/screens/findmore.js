// Find More Sources (F305, concept https://claude.ai/artifact/ACNfYiCTv6dz39vphokG8R, user-approved 2026-11-20): Canister's
// repository index inside the app, each repo with its trust label, and Add. Reached from the last row of the Sources
// tab's Tweak Sources group (the sideload app; Individual Sources where the device is jailbroken) and from Manage.
//
//   #/sources/manage/find          search bar (Search Repos), Popular on Canister (tiers 1 and 2, most packages first)
//                                  or the search's results, ADD / ADDED on each (More Sources' price button), Add All
//                                  in the nav bar (B272: addAllListed); Other Directories: ios-repo-updates.com
//                                  (opens in the browser, "Not checked by <name>"); footer crediting Canister
//   #/sources/manage/find/<slug>   one repo: Trust (Label, Why, HTTPS, Signed Releases), Packages (Tweaks for
//                                  Sideloaded Apps in the sideload app, All Packages), Add in the nav bar
//
//   findMoreOn(type, mode)          whether Find More shows (APT repos are kept: jailbroken, or the sideload app)
//   findMoreRow()                   the Sources list's row
//   isFind(route) / nav / render    manage.js hands its find/… routes here
//   canisterTrust(source)           -> Canister's facts for an APT source (cached a week per repo), or null
//   labelCanister(li, source)       an Unknown APT source row turns Known Safe · Canister when Canister says tier 1/bootstrap
//   repoHref(repo) / remember(repo) the repo page's link, with the row kept so its page draws at once
//   searchAllRepos({ appName })     Add Tweaks' Search All Repos: Canister's packages, injectable ones only, in a sheet
//
// Rules: core/canister.js (repoLabel, canisterSafe, mapRepos). Piracy-listed repos (core/warnings.js) are never shown.
import { el, plain, grouped, note, placeholder, buttonZone } from "../nav/ui.js";
import { searchBar, pinned } from "../nav/searchbar.js";
import { showAlert } from "../nav/alert.js";
import { showActionSheet } from "../nav/actionsheet.js";
import { liveHUD } from "../nav/hud.js";
import { format } from "../router.js";
import { getBackend } from "../backend.js";
import { NAME } from "../brand.js";
import { settings } from "../settings-store.js";
import { detectMode } from "../core/settings.js";
import { tweakSourcesOn, sourceIcons } from "../core/sources.js";
import { sourceIconImage } from "../source-icon.js";
import { sourceWarning } from "../core/warnings.js";
import { knownSafe } from "../core/safe-sources.js";
import { trustOf } from "../core/trust.js";
import { confirmUnknownSource, markTrusted, trustedNow } from "./safety.js";
import {
  askable, mapRepos, popularRepos, liteRepos, repoLabel, canisterSafe, repoMatch, trustQuery, createRepoCache, mapRepoPackages, mapResults,
  loadInjectable, normalRepo, POPULAR_RANKS, CANISTER_SAFE_LABEL,
} from "../core/canister.js";
import { canisterApi, offerTweak } from "./extras.js";
import { nativeBridge } from "../native.js";
import { tweakListRow } from "./tweakrow.js"; // B267

export const FIND = "find";
export const DIRECTORY_URL = "https://ios-repo-updates.com/";
export const CANISTER_SITE = "https://canister.me/";
export const NOT_CHECKED = `Not checked by ${NAME}`;

export const findMoreOn = (type = settings.deviceType(), mode = detectMode()) => type !== "none" || tweakSourcesOn(type, mode);
const sideloadTweaks = () => tweakSourcesOn(settings.deviceType(), detectMode());

const here = (...p) => format({ tab: "sources", path: ["manage", FIND, ...p] });
export const findHref = () => here();

export function findMoreRow() {
  return { label: "Find More Sources", subtitle: "Browse Canister's repos", href: here(), icon: { text: "+" }, cls: "find-more-row" };
}

// ---- routes ------------------------------------------------------------------------------------------------------

export const isFind = (route) => route.path[0] === "manage" && route.path[1] === FIND && route.path.length <= 3;

const stash = new Map(); // slug -> repo row, so a repo's page draws at once from the list it was opened from
export function remember(repo) { if (repo?.slug) stash.set(repo.slug, repo); return repo; }
export const repoHref = (repo) => here(remember(repo)?.slug ?? "");

export function nav(route, ctx) {
  const slug = route.path[2];
  if (!slug) return { title: "Find More", right: { label: "Add All", onClick: () => addAllListed(ctx) } }; // B272
  const r = stash.get(slug);
  return { title: r?.name || "Repo", right: { label: r?.added ? "Added" : "Add", onClick: (e) => addFromPage(slug, ctx, e?.currentTarget) } };
}

export function render(body, route, ctx) {
  const slug = route.path[2];
  return slug ? renderRepo(body, slug, ctx) : renderFind(body, ctx);
}

// ---- labels ------------------------------------------------------------------------------------------------------

const blocked = (u) => Boolean(sourceWarning(u));
export function labelOf(repo, { trusted = trustedNow() } = {}) {
  return repoLabel(repo, { blocked, safe: (u) => knownSafe(u), trusted: (u) => trustOf({ uri: u }, { trusted }) === "trusted" });
}

// The label at the start of a subtitle, as safety.js labelSource draws it: a pill for Known Safe (and Trusted, grey),
// the plain word for Unknown.
export function labelNode(kindLabel) {
  const { kind, label } = kindLabel;
  if (kind === "unknown" || kind === "blocked") return [el("span", "trust-word", label), " · "];
  return [el("span", `trust-pill${kind === "trusted" ? " trust-pill-grey" : ""}`, label), " "];
}

// ---- Known Safe · Canister on the Sources list -------------------------------------------------------------------

let cache = null;
const repoCache = () => (cache ??= createRepoCache({ storage: (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })() }));
const isApt = (s) => Boolean(s?.uri) && !String(s?.key ?? "").startsWith("alt:");

// `ask(host)` and `store` are seams for the tests.
export async function canisterTrust(source, { ask = (q) => canisterApi().repos(q), store = repoCache() } = {}) {
  if (!isApt(source) || blocked(source.uri)) return null;
  const hit = store.get(source.uri);
  if (hit !== undefined) return hit;
  const q = trustQuery(source.uri);
  if (!q) return null;
  let json;
  try { json = await ask(q); } catch { return null; } // offline: ask again next time
  const r = repoMatch(json, source.uri);
  store.put(source.uri, r);
  return r ? store.get(source.uri) : null;
}

export function labelCanister(li, source, opts) {
  if (!li || li.dataset.trust !== "unknown" || !isApt(source)) return Promise.resolve(false);
  return canisterTrust(source, opts).then((r) => {
    if (!canisterSafe(r).safe || li.dataset.trust !== "unknown") return false;
    const sub = li.querySelector(".cell-subtitle");
    const word = sub?.querySelector(".trust-word");
    if (!word) return false;
    const after = word.nextSibling;
    if (after?.nodeType === 3 && after.textContent === " · ") after.remove();
    word.replaceWith(el("span", "trust-pill trust-pill-canister", CANISTER_SAFE_LABEL), " ");
    li.dataset.trust = "canister";
    li.title = canisterSafe(r).why;
    return true;
  }, () => false);
}

// ---- Add ---------------------------------------------------------------------------------------------------------

const inputOf = (r) => (r.flat ? r.uri : { uri: r.uri, dist: r.dist, components: r.components });

// Adds `r` (a repo row). A repo neither on our list nor Known Safe · Canister asks Unknown Source first (Add & Trust /
// Add Source / Cancel), as Add Source does. `button` (a row's Add) turns green at once with a spinner while it is
// added. Resolves true once it is in the list; Sources loads it under the reload bar (manage.sourcesChanged).
export async function addRepo(r, ctx, { button = null, backend = getBackend(), alert = showAlert, unknown = confirmUnknownSource,
  changed = null } = {}) {
  if (blocked(r.uri)) return false;
  const kind = labelOf(r).kind;
  let trust = false;
  if (kind === "unknown") {
    const ok = await unknown(r.uri);
    if (!ok) return false;
    trust = ok.trust;
  }
  setButton(button, "adding");
  try {
    const saved = await backend.addSource(inputOf(r));
    if (trust) markTrusted(saved?.uri ? saved : r.uri);
  } catch (e) {
    setButton(button, "add");
    await alert({ title: e.title || "Verification Error", message: e.message, buttons: ["OK"] });
    return false;
  }
  r.added = true;
  remember(r);
  setButton(button, "added");
  (changed ?? (await import("./manage.js")).sourcesChanged)(ctx);
  return true;
}

// B272: ADD / ADDED is More Sources' button (moresources.js addButton: the App Store price button, flat in the iOS 7
// and 13 styles); while the repo is added it holds the small spinner in place of its label.
function setButton(b, st) {
  if (!b) return;
  b.classList.toggle("added", st === "added");
  b.classList.toggle("adding", st === "adding");
  b.disabled = st !== "add";
  b.textContent = st === "add" ? "ADD" : st === "added" ? "ADDED" : "";
  if (st === "adding") b.append(el("span", "loading-spinner find-spinner"));
}

export function addButton(r, ctx) {
  const b = el("button", "price-btn rec-add find-add" + (r.added ? " added" : ""), r.added ? "ADDED" : "ADD");
  b.type = "button";
  b.disabled = Boolean(r.added);
  b.setAttribute("aria-label", (r.added ? "Added: " : "Add ") + r.name);
  b.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!b.disabled) addRepo(r, ctx, { button: b });
  });
  return b;
}

async function addFromPage(slug, ctx, button) {
  const r = stash.get(slug) ?? (await loadRepo(slug).catch(() => null));
  if (!r || r.added) return;
  if (await addRepo(r, ctx)) {
    if (button) button.textContent = "Added";
    const body = document.querySelector(".page.is-top .find-repo")?.closest(".page-body");
    if (body) renderRepo(body, slug, ctx);
  }
}

// ---- Add All (B272) ----------------------------------------------------------------------------------------------

// The rows the Find More page shows now (Popular on Canister or a search's results) and how to draw them again.
let listed = { rows: [], redraw: () => {} };

// Add All in the nav bar: every listed repo not added yet, after one action sheet, then each in turn under a HUD that
// counts them, as Import adds its picks. No Unknown Source question per repo: the sheet is the one confirm, and an
// Unknown repo comes in as Unknown, as an imported one does. Failures are named in one alert at the end.
// `rows`, `backend`, `sheet`, `alert`, `hud` and `changed` are seams for the tests. B344: App Sources (moresources.js)
// runs the same Add All over its own rows: `noun` names them, `input` and `nameOf` read one, `title` is the page's.
// Resolves how many were added.
export async function addAllListed(ctx, { rows = listed.rows, backend = getBackend(), sheet = showActionSheet, alert = showAlert,
  hud = liveHUD, changed = null, redraw = listed.redraw, noun = "repo", input = inputOf, nameOf = (r) => r.name,
  title = "Find More" } = {}) {
  const todo = rows.filter((r) => !r.added && !blocked(r.uri ?? r.rec?.url ?? ""));
  if (!todo.length) {
    await alert({ title, message: rows.length ? `Every ${noun} listed here is in your sources.` : `No ${noun}s are listed.`,
      buttons: ["OK"] });
    return 0;
  }
  const what = todo.length === 1 ? `the 1 ${noun}` : `the ${todo.length} ${noun}s`;
  const i = await sheet({ title: `Add ${what} listed here that aren't in your sources yet?`, buttons: ["Add All"] });
  if (i !== 0) return 0;
  const failed = [];
  const h = hud(`Adding 1 of ${todo.length}`);
  try {
    for (const [n, r] of todo.entries()) {
      h.set(`Adding ${n + 1} of ${todo.length}`);
      try {
        await backend.addSource(input(r));
        r.added = true;
        remember(r);
      } catch (e) { failed.push(`${nameOf(r)}: ${e.message}`); }
    }
  } finally {
    h.hide();
  }
  const ok = todo.length - failed.length;
  if (ok) (changed ?? (await import("./manage.js")).sourcesChanged)(ctx);
  if (failed.length) {
    await alert({ title: "Some Sources Failed", message: [`Added ${ok} of ${todo.length}.`, ...failed].join("\n\n"), buttons: ["OK"] });
  }
  redraw();
  return ok;
}

// ---- the Find More page ------------------------------------------------------------------------------------------

const haveSources = () => Promise.resolve().then(() => getBackend().sources()).catch(() => []);

// `api`, `sources` and `sideload` are seams for the tests. B389: the sideload build leaves out the repos it doesn't
// recommend (core/canister.js liteRepos), so Add All never adds them either; a search that names one shows it.
export function renderFind(body, ctx, { api = canisterApi(), sources = haveSources, sideload = sideloadTweaks } = {}) {
  let seq = 0;
  const box = el("div", "find-more");
  const bar = searchBar({ placeholder: "Search Repos", ariaLabel: "Search Canister's repos", delay: 350, className: "find-search",
    onQuery: (q) => draw(q) });
  body.replaceChildren();
  pinned(body, bar).append(box);
  const done = draw("");
  return { el: box, bar, ready: done, draw };

  async function draw(q) {
    const turn = ++seq;
    const query = String(q ?? "").trim();
    const searching = askable(query);
    box.replaceChildren(placeholder("list", 6));
    let rows, error = null;
    try {
      const have = await sources();
      rows = searching ? mapRepos(await api.repos(query), { have, blocked })
        : popularRepos(await Promise.all(POPULAR_RANKS.map((r) => api.ranking(r))), { have, blocked });
      if (sideload()) rows = liteRepos(rows, searching ? query : "");
    } catch (e) { error = e; rows = []; }
    if (turn !== seq) return;
    const header = searching ? (rows.length ? `${rows.length} ${rows.length === 1 ? "Repo" : "Repos"}` : "Results") : "Popular on Canister";
    const ul = plain([{ header, rows: rows.map(repoCell) },
      { header: "Other Directories", rows: [{ label: "ios-repo-updates.com", subtitle: NOT_CHECKED, cls: "find-directory",
        onClick: () => openOutside(DIRECTORY_URL) }] }]);
    ul.classList.add("rec-list", "find-list");
    const cells = [...ul.querySelectorAll(".cell")]; // a plain list's cells hold no cells of their own
    const trusted = trustedNow();
    rows.forEach((r, i) => decorate(cells[i], r, ctx, trusted));
    const dir = cells[rows.length];
    // B272: the "opens outside" mark is drawn (sources.css .find-external), not the ↗ character, which iOS draws as
    // a colour emoji.
    dir?.querySelector(".cell-inner")?.append(el("span", "find-external"));
    listed = { rows, redraw: () => draw(query) };
    const parts = [ul];
    if (error) parts.push(note(`Canister didn't answer: ${error.message}`));
    else if (!rows.length && searching) parts.push(note("No repos found. Canister searches whole words: a name or a host."));
    parts.push(footer());
    box.replaceChildren(...parts);
  }
}

function repoCell(r) {
  return { label: r.name, subtitle: r.count != null ? `${r.count.toLocaleString()} ${r.count === 1 ? "package" : "packages"}` : r.uri,
    icon: { text: r.name[0]?.toUpperCase() ?? "?" }, href: repoHref(r), chevron: false };
}

function decorate(li, r, ctx, trusted) {
  if (!li) return;
  li.classList.add("source-row", "rec-row", "find-row");
  li.dataset.slug = r.slug;
  const sub = li.querySelector(".cell-subtitle");
  sub?.prepend(...labelNode(labelOf(r, { trusted })));
  const icon = li.querySelector(".cell-icon");
  try { icon?.append(sourceIconImage(r.key, sourceIcons({ key: r.key, uri: r.uri, dist: r.dist, components: r.components }), getBackend())); } catch { /* the letter stays */ }
  buttonZone(li, addButton(r, ctx));
}

function footer() {
  const p = el("p", "group-footer find-credit");
  const a = el("a", null, "canister.me");
  a.href = CANISTER_SITE;
  a.target = "_blank";
  a.rel = "noopener";
  p.append("Repo list from Canister (", a, "), the jailbreak package search. Piracy repos are never shown. ",
    `Repos from other directories go through Add Source's checks and show as Unknown.`);
  return p;
}

async function openOutside(url) {
  try { const r = await nativeBridge()?.call?.("app.openURL", { url }); if (r?.opened) return; } catch { /* an older shell */ }
  globalThis.open?.(url, "_blank", "noopener");
}

// ---- a repo's page -----------------------------------------------------------------------------------------------

async function loadRepo(slug, { api = canisterApi(), sources = haveSources } = {}) {
  const [json, have] = await Promise.all([api.repo(slug), sources()]);
  const r = mapRepos(json, { have, blocked })[0] ?? null;
  return r ? remember(r) : null;
}

const yesNo = (v) => (v == null ? "Unknown" : v ? "Yes" : "No");
const WHY_SHORT = { safe: `On ${NAME}'s list`, trusted: "You trusted it", unknown: "Not checked", blocked: "Piracy list" };

// `api`, `sources` and `sideload` are seams for the tests.
export async function renderRepo(body, slug, ctx, { api = canisterApi(), sources = haveSources, sideload = sideloadTweaks } = {}) {
  const box = el("div", "find-repo");
  body.replaceChildren(box);
  box.append(placeholder("list", 4));
  let r = stash.get(slug) ?? null;
  try {
    const have = await sources();
    if (r) r = { ...r, added: have.some((s) => normalRepo(s?.uri) === normalRepo(r.uri)) };
    else r = mapRepos(await api.repo(slug), { have, blocked })[0] ?? null;
  } catch (e) {
    if (!r) { box.replaceChildren(note(`Canister didn't answer: ${e.message}`)); return null; }
  }
  if (!r) { box.replaceChildren(note("Canister doesn't list this repo, or it is on the piracy list.")); return null; }
  remember(r);
  const label = labelOf(r);
  const why = label.kind === "canister" ? (r.tier === 1 ? "Canister Tier 1" : "Bootstrap repo") : WHY_SHORT[label.kind];
  const tweaksRow = { label: "Tweaks for Sideloaded Apps", detail: "…", cls: "find-tweaks", chevron: true,
    onClick: () => showRepoTweaks(r, ctx, { api }) };
  const pkgRows = [...(sideload() ? [tweaksRow] : []),
    { label: "All Packages", detail: r.count != null ? r.count.toLocaleString() : "—" }];
  if (r.added) pkgRows.push({ label: "Open Source", href: format({ tab: "sources", path: [r.key] }) });
  box.replaceChildren(grouped([
    { rows: [{ label: r.name, subtitle: r.uri, icon: { text: r.name[0]?.toUpperCase() ?? "?" }, cls: "find-head" }],
      footer: r.description || null },
    { header: "Trust", rows: [{ label: "Label", detail: "", cls: "find-label" }, { label: "Why", detail: why },
      { label: "HTTPS", detail: yesNo(r.https), cls: r.https === false ? "find-warn" : null },
      { label: "Signed Releases", detail: yesNo(r.gpg) }],
    footer: `${label.why}${r.https === false ? " Its files come without encryption." : ""}` },
    { header: "Packages", rows: pkgRows,
      footer: sideload() ? "Tweaks for Sideloaded Apps: the ones that can go into an app you sign here, from Canister's copy of the repo." : null },
  ]));
  const part = (row, cls) => box.querySelector(row)?.querySelector(cls) ?? null;
  part(".find-label", ".cell-detail")?.replaceChildren(...labelNode(label).slice(0, 1));
  try { part(".find-head", ".cell-icon")?.append(sourceIconImage(r.key, sourceIcons({ key: r.key, uri: r.uri, dist: r.dist }), getBackend())); } catch { /* letter */ }
  if (sideload()) {
    const tweaksDetail = (t) => { const d = part(".find-tweaks", ".cell-detail"); if (d) d.textContent = t; };
    repoTweaks(r, { api }).then((list) => tweaksDetail(list.length.toLocaleString()), () => tweaksDetail("—"));
  }
  return r;
}

// The repo's injectable tweaks, from Canister's copy of its package list (one request, kept 10 minutes).
export async function repoTweaks(r, { api = canisterApi() } = {}) {
  const [json, check] = await Promise.all([api.packages(r.slug), loadInjectable()]);
  return mapRepoPackages(json, r).filter((row) => check(row).ok);
}

async function showRepoTweaks(r, ctx, { api }) {
  const { showSheet } = await import("../nav/sheet.js");
  const body = el("div", "sheet-scroll page-body grouped tweak-pick find-tweak-list"); // B267: its own scroller
  body.append(placeholder("list", 6));
  const close = showSheet({ title: r.name, body });
  try {
    const list = await repoTweaks(r, { api });
    body.replaceChildren(tweakList(list, ctx, { viewRepo: false, onDone: () => close?.() }),
      el("p", "group-footer", list.length ? "Tap one to add the repo and pick the app it goes into."
        : "Nothing here can go into a sideloaded app."));
  } catch (e) {
    body.replaceChildren(note(`Canister didn't answer: ${e.message}`));
  }
}

// B267: Cydia's list rows (tweakrow.js): the package's icon cropped to 29pt over its section's, the name, version ·
// author (· the repo, for results from several repos). The repo's trust is said by offerTweak's sheet on the tap.
function tweakList(rows, ctx, opts) {
  const g = el("div", "group");
  const ul = el("ul", "table grouped");
  for (const r of rows) ul.append(tweakListRow(r, { repo: opts.viewRepo !== false, onClick: () => { opts.onDone?.(); offerTweak(r, ctx, opts); } }));
  g.append(ul);
  return g;
}

// ---- Add Tweaks: Search All Repos --------------------------------------------------------------------------------

// A sheet with Canister's package search, already holding `appName`: tweaks for sideloaded apps only, each opening
// the Add Source & Add to App sheet. `api` is a seam for the tests. Returns { close, ready } (ready: the first search).
export function searchAllRepos({ appName = "", ctx = null, api = canisterApi(), sources = haveSources, sheet = null } = {}) {
  // B267: the search bar stays under the fixed nav bar and the results scroll on their own (pinned: Search's layout)
  const body = el("div", "sheet-scroll page-body grouped tweak-pick find-all-repos");
  let seq = 0, close = () => {};
  const bar = searchBar({ placeholder: "Search All Repos", value: appName, delay: 400, className: "find-search", onQuery: (q) => run(q) });
  const results = pinned(body, bar);
  results.classList.add("find-all-results");
  const open = sheet ?? ((o) => import("../nav/sheet.js").then(({ showSheet }) => showSheet(o)));
  Promise.resolve(open({ title: "Search All Repos", body })).then((c) => { if (typeof c === "function") close = c; });
  const ready = run(appName);
  return { close: () => close(), ready, el: body };

  async function run(q) {
    const turn = ++seq;
    if (!askable(q)) { results.replaceChildren(el("p", "group-footer", "Type a tweak or an app's name: two letters or more.")); return []; }
    results.replaceChildren(placeholder("list", 5));
    let rows;
    try {
      const [json, have, check] = await Promise.all([api.search(String(q).trim()), sources(), loadInjectable()]);
      rows = mapResults(json, { have }).filter((r) => !r.repo.added && !blocked(r.repo.uri) && check(r).ok).slice(0, 40);
    } catch (e) {
      if (turn === seq) results.replaceChildren(note(`Canister didn't answer: ${e.message}`));
      return [];
    }
    if (turn !== seq) return rows;
    results.replaceChildren(rows.length ? tweakList(rows, ctx, { onDone: () => close() }) : note("No tweaks for sideloaded apps found."),
      el("p", "group-footer", "From repos you haven't added, found by Canister (canister.me)."));
    return rows;
  }
}
