// Search tab: the kit's "grey search bar" over a virtualised result list. Every keystroke (debounced) asks the
// catalog in the parse worker, which matches name, id, description, Author and Maintainer (core/catalog.js
// search), best matches first. Results open the package page; its Author row lists all their packages.
// Below the root, the routes are screens/browse.js tokens (package:<id>, author:<name>).
//
// Filters (F35): under the bar, iOS 6's search scope bar: a segmented control over the broad kinds (All, Tweaks,
// Themes, Apps: core/catalog.js SECTION_GROUPS) and a Filter button whose drop-down panel picks a section, a source,
// installed or not, free or paid, and Show Incompatible. Show Incompatible is the Works on My Phone setting turned
// round (F17), so Search, Sections and Settings agree; an exact name or id match shows even when it can't work, in
// red with the reason under it (browse.js bindRow).
//
// Recent (F100, from Zebra): with the field empty, a grouped Recent table of the last five queries (saved on
// Search or when a result is opened; core/settings.js recentSearches) with Clear in its header; a tap runs one again.
import * as browse from "./browse.js";
import { catalog } from "../catalog.js";
import { compatFilterOn } from "../device.js";
import { settings } from "../settings-store.js";
import { searchable } from "../core/catalog.js";
import { tweakSourcesOn } from "../core/sources.js"; // F305
import { openFilterPanel } from "./filterpanel.js";
import { SCOPES, scopesFor, scopeIndex, sheetActive, emptyFilters, searchFilters } from "./searchscope.js"; // F426c
import { loadNew, onLanded, onSettled, isLoading } from "./sources.js";
import { grouped, el, segments } from "../nav/ui.js";
import { discoveryGroup } from "./extras.js";
import { recommendedApps, addRecommended, onSourcesChanged } from "./manage.js";
import { matchRecommendedApps } from "../core/recommended.js";
import { showAlert } from "../nav/alert.js";
import { searchBar, pinned } from "../nav/searchbar.js";
import { detectMode } from "../core/settings.js";
import { onPageShow } from "../nav/pagestate.js"; // B172

export const title = "Search";
export { SCOPES, scopesFor, scopeIndex, sheetActive };

// The filters, kept for the session like the query: section (a section name or "group:<kind>"), source (a key),
// installed ("installed" | "not"), price ("free" | "paid"); null is any (searchscope.js).
const state = { query: "", seq: 0, filters: emptyFilters() };
let drop = null; // Search's open Filter panel (filterpanel.js): { close() }
let rootInput = null; // the root page's field, for reselect()

// B75: sources added but never loaded (Manage > Recommended > Add All, then Search) load at once, under the Sources
// tab's reload bar (screens/sources.js loadNew: one shared run, Refresh's words, progress and Cancel), and the query
// runs again each time one's packages reach the catalog, so they show without leaving Search. Called on opening;
// `follow.load()` again as a query is typed (a source tried once is not asked again). `alive()` false (the page was
// left) unsubscribes. `load`, `landed`, `changed` and `loaded` are for the tests.
// B98: an add (Search's Recommended Add Source, Manage's Add / Add All; manage.js onSourcesChanged, whose listener in
// screens/sources.js starts the load) runs it at once too, so Recommended Sources drops the added source; and so does
// any catalog load (catalog.onLoaded): Add Source opens the source's page, whose catalog.ensure() often reads the new
// source before the reload bar's run gets to it, and that path never fires onLanded.
// B141: each visit keeps its own `retry` set, so a source whose last fetch failed or that has no apps (first launch,
// the network still coming up) loads once more per visit (core/sources.js retryFilter), not only never-loaded ones;
// and a run ending (screens/sources.js onSettled) runs the query again, so "still loading" turns into the answer.
export function followNewSources(ctx, rerun, alive = () => true,
  { load = loadNew, landed = onLanded, changed = onSourcesChanged, loaded = catalog.onLoaded, settled = onSettled } = {}) {
  const offs = [];
  const off = () => { for (const f of offs.splice(0)) f?.(); };
  const listen = (subscribe) => offs.push(subscribe(() => { if (!alive()) { off(); return; } rerun(); }));
  listen(landed);
  listen(changed);
  listen(loaded);
  listen(settled);
  const retry = new Set();
  const kick = async () => { try { return await load(ctx, { retry }); } catch { return null; } };
  kick();
  return { load: kick, off };
}

// B141: the note under an answered query: nothing when it found rows; while sources are still loading (the reload
// bar's run) it says so rather than No Results, which comes once they have all answered.
export const LOADING_NOTE = "Sources are still loading…";
export const emptyNote = (count, loading) => (count ? "" : loading ? LOADING_NOTE : "No Results");

// F100: the Recent table's rows (nav/ui.js grouped), one per query, a tap hands it to `pick`.
export function recentRows(list, pick) {
  return (list || []).map((q) => ({ label: q, cls: "recent-row", onClick: () => pick(q) }));
}

// A tap on the Search tab while already on its root (nav/tabbar.js tapTab, F36): focus the field. Called straight
// from the tap's click handler, never after an await or timer, or iOS won't bring up the keyboard.
export function reselect() {
  if (drop) { drop.close(); return true; } // an open Filter panel closes first
  if (!rootInput || !rootInput.isConnected) return false;
  rootInput.focus();
  return true;
}

// The field's placeholder (user 2026-11-19): tweaks in the jailbreak app, apps everywhere else.
export const searchPlaceholder = (mode = detectMode()) => (mode === "jailbreak" ? "Search Tweaks" : "Search Apps");

export function nav(route) {
  if (route.path.length) return browse.nav(route);
  return { title: "Search", style: "plain" };
}

export function render(body, route, ctx) {
  if (route.path.length) {
    browse.render(body, route, ctx);
    return;
  }
  // The shared bar (nav/searchbar.js): its Cancel empties the field and puts the keyboard away; Search saves the
  // query to Recent.
  const bar = searchBar({ placeholder: searchPlaceholder(), ariaLabel: "Search packages: name, description or author",
    value: state.query, delay: 120, className: "has-scope", onQuery: () => run(),
    onSubmit: (q) => settings.recentSearches.add(q),
    onFocus: () => drop?.close() }); // typing a search puts the Filter panel away
  const input = bar.input;
  rootInput = input;

  // The scope bar: segments, then Filter.
  const scope = el("div", "search-scope");
  const seg = segments(SCOPES, {}, null, (name) => {
    state.filters.section = name === SCOPES[0] ? null : `group:${name}`;
    drawScope();
    run();
  });
  const filterButton = el("button", "scope-filter", "Filter");
  filterButton.type = "button";
  filterButton.addEventListener("click", () => {
    if (drop) drop.close();
    else {
      drop = openFilterPanel({ filters: state.filters, anchor: scope, alive: () => /^#\/search\/?$/.test(location.hash),
        changed: () => { drawScope(); run(); }, closed: () => { drop = null; drawScope(); } });
      drawScope();
    }
  });
  scope.append(seg, filterButton);
  function drawScope() {
    const shown = scopesFor(settings.deviceType());
    // A Tweaks or Themes scope left from Jailbroken goes back to All once those segments are hidden.
    if (scopeIndex(state.filters.section) > 0 && !shown.includes(SCOPES[scopeIndex(state.filters.section)])) state.filters.section = null;
    seg.show(shown);
    seg.select(SCOPES[scopeIndex(state.filters.section)] ?? null);
    // While the panel is open the button is a blue Done that puts it away.
    filterButton.textContent = drop ? "Done" : "Filter";
    filterButton.classList.toggle("done", Boolean(drop));
    filterButton.classList.toggle("selected", !drop && sheetActive(state.filters));
  }
  drawScope();

  const note = document.createElement("p");
  note.className = "empty search-note";
  // The bar and its scope row stay put, as Cydia's search bar does on the 4S (ref/4s/screens/search-85.png); only the
  // results scroll, and bounce, under them (packages.css .search-root).
  const results = pinned(body, bar, scope);
  // F100: the Recent table, shown in place of the note while the field is empty.
  const recent = el("div", "search-recent");
  results.append(note, recent);

  const list = browse.packageList(results, route, [], { letters: false });
  results.append(list.el);
  // F20: packages from sources the user hasn't added (Canister), under the local results.
  // B33: its rows not built for this device follow Show Incompatible too (settings.onChange below runs it again).
  const others = discoveryGroup(ctx, { hideIncompatible: compatFilterOn });
  const recs = recommendedGroup(ctx);
  results.append(recs.el, others.el);

  // Show Incompatible, the iOS version or the Architecture changed (here, in the sheet or in Settings): search
  // again. A page left behind unsubscribes.
  const off = settings.onChange((key) => {
    if (key === "recentSearches") { if (body.isConnected) drawRecent(); else off(); return; }
    if (!["worksOnMyPhone", "iosVersion", "arch", "device"].includes(key)) return;
    if (!body.isConnected) { off(); return; }
    if (key === "device") drawScope();
    run();
  });

  function drawRecent() {
    const items = input.value.trim() ? [] : settings.recentSearches.list();
    recent.replaceChildren();
    recent.hidden = !items.length;
    note.hidden = !input.value.trim() && items.length > 0;
    if (!items.length) return;
    recent.append(grouped([{ header: "Recent", rows: recentRows(items, pick) }]));
    const clear = el("button", "recent-clear", "Clear");
    clear.type = "button";
    clear.addEventListener("click", () => settings.recentSearches.clear());
    recent.querySelector(".group-header").append(clear);
  }
  // A Recent row: search it again, as if typed and Searched (it moves to the top).
  function pick(q) {
    bar.set(q);
    settings.recentSearches.add(q);
    run();
    input.blur();
  }
  // Opening a result (a package row here or under Other Sources) saves the query that found it.
  results.addEventListener("click", (e) => {
    if (e.target.closest?.("a[href]") && !recent.contains(e.target)) settings.recentSearches.add(input.value);
  });
  // B75: `again`: the same query run once more because a source's packages landed: the list keeps its scroll and
  // Other Sources and Recommended Sources aren't asked again.
  async function run({ again = false } = {}) {
    const q = input.value.trim();
    // B172: only a run the user started here sets the session's query: a source landing re-runs every copy still
    // drawn (again), and a copy left behind would put its old text back.
    if (!again) state.query = input.value;
    const copy = copies.get(body); // what this copy last asked
    if (copy && !again) copy.asked = askedKey();
    const seq = ++state.seq;
    if (!again) {
      // One character searches here; Canister needs two (core/canister.js askable()).
      // jailbreak packages only; F305: and the sideload app's tweaks for its apps (extras.js keeps injectable ones)
      others.search(searchable(q) && (settings.deviceType() !== "none" || tweakSourcesOn(settings.deviceType(), detectMode())) ? q : "");
      recs.search(searchable(q) ? q : "");
      drawRecent();
      if (searchable(q)) follow.load(); // B75: anything added since opening loads too
    }
    if (!searchable(q)) {
      list.setItems([]);
      note.textContent = "Package names, descriptions and authors.";
      return;
    }
    if (!again) note.textContent = "";
    let rows;
    try {
      rows = await catalog.search(q, searchFilters(state.filters));
    } catch (e) {
      if (seq === state.seq) note.textContent = e.message;
      return;
    }
    if (seq !== state.seq) return; // a newer keystroke won
    if (!again) results.scrollTop = 0;
    browse.rememberNames(rows);
    list.setItems(rows);
    note.textContent = emptyNote(rows.length, isLoading());
  }
  // B75: opening Search loads sources never loaded; each one landing runs a typed query again.
  // B98: Recommended Sources is asked again too, so a source just added leaves it once it is in the list.
  const follow = followNewSources(ctx, () => {
    const q = input.value.trim();
    if (!searchable(q)) return;
    run({ again: true });
    recs.search(q, { again: true });
  }, () => body.isConnected);
  run();
  copies.set(body, { input, bar, drawScope, run, asked: askedKey() });
}

// B172: Search's root page can be on screen twice, its own tab and pushed on Home (Find Extensions for Applications:
// router.js rootOn). Each copy has its own field and list (render's closures); the query and filters are the
// session's (state) and rootInput is the copy drawn last. A copy that comes back to the top (a tab switch, Back)
// becomes reselect()'s field, and takes the query and filters the other copy left and searches again. -> true when it
// searched again.
const copies = new WeakMap(); // a root copy's body -> { input, bar, drawScope, run, asked }
const askedKey = () => JSON.stringify([state.query, state.filters]);
export function showCopy(body) {
  const copy = body && copies.get(body);
  if (!copy) return false;
  rootInput = copy.input;
  if (copy.asked === askedKey() && copy.input.value === state.query) return false;
  copy.bar.set(state.query);
  copy.drawScope();
  copy.run();
  copy.asked = askedKey();
  return true;
}
onPageShow((route) => route.tab === "search" && !route.path.length, (_route, el) => showCopy(el));

// ---- apps in recommended sources not added yet ---------------------------------------------------------------
// Under the local results: apps whose source Recommended lists (core/recommended.js) but the user hasn't added.
// A tap offers Add Source, then opens the source's page, where the app installs as usual.
function recommendedGroup(ctx) {
  const box = el("div", "discovery");
  let seq = 0;
  // `again` (B98: a source added or landed): no wait and no blank first; the group is swapped once read.
  async function search(q, { again = false } = {}) {
    const turn = ++seq;
    if (!again) box.replaceChildren();
    if (!q) { box.replaceChildren(); return; }
    if (!again) await new Promise((r) => setTimeout(r, 450)); // once typing stops, as Other Sources does
    if (turn !== seq) return;
    const found = matchRecommendedApps(await recommendedApps().catch(() => []), q);
    if (turn !== seq) return;
    if (!found.length) { box.replaceChildren(); return; }
    box.replaceChildren(grouped([{
      header: "Recommended Sources",
      rows: found.map(({ row, app }) => ({
        label: app.name,
        subtitle: [row.label, app.subtitle || app.developerName].filter(Boolean).join(" · "),
        icon: { text: app.name?.[0]?.toUpperCase() ?? "?" },
        onClick: () => offer(row, app, ctx),
      })),
      footer: "From recommended sources you haven't added. Add the source to install.",
    }]));
  }
  return { el: box, search };
}

async function offer(row, app, ctx) {
  const { index } = await showAlert({ title: app.name, message: `In ${row.label} (${row.record.uri}). Add this source?`,
    buttons: ["Cancel", "Add Source"], cancel: 0 });
  if (index !== 1 || !(await addRecommended(row, ctx))) return;
  ctx.go({ tab: "sources", path: [row.key] });
}
