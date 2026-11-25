// Search's scope bar and Filter button for a list opened from Browse (F426c, browse.js renderSearchableList): the
// segments, the Filter panel (filterpanel.js) with Sort at its top, and what they ask of the catalog (catalog.refine).
// Each page has its own filters object, so Back finds its choice and a page pushed again starts clean.
import { settings } from "../settings-store.js";
import { SECTION_GROUPS, sectionGroup } from "../core/sections.js";
import { el, segments } from "../nav/ui.js";
import { SCOPES, scopesFor, scopeIndex, sheetActive, emptyFilters, searchFilters } from "./searchscope.js";

// The panel loads after the page: imported from the top it would close an import cycle (it imports sources.js, which
// imports browse.js).
const panel = () => import("./filterpanel.js");

// The Sort rows: the list's own order first, under the list's name for it, then the catalog's sorts not called the same.
export function listSorts(order) {
  const rest = [["Name", "name"], ["Newest", "newest"], ["Most Sources", "popular"]];
  return [{ label: order }, ...rest.filter(([label]) => label !== order).map(([label, value]) => ({ label, value }))];
}

// The panel's Section rows: the groups and sections the list's rows are in, plus the one picked now (it stays to be
// seen and undone once nothing is left in it).
export function listSections(rows, current = null) {
  const names = new Set(), groups = new Set();
  for (const r of rows) {
    if (!r.section) continue;
    names.add(r.section);
    const g = sectionGroup(r.section);
    if (g) groups.add(g);
  }
  if (current?.startsWith("group:")) groups.add(current.slice(6));
  else if (current) names.add(current);
  return { groups: SECTION_GROUPS.filter((g) => groups.has(g)),
    sections: [...names].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })) };
}

// What catalog.refine is asked; undefined when nothing is picked (the list as it came).
export function refineOptions(f) {
  const out = { ...searchFilters(f), ...(f.sort ? { sort: f.sort } : {}) };
  return Object.keys(out).length ? out : undefined;
}

// Whether the panel holds anything the segments don't show (the Filter button looks selected then).
export const filterOn = (f, withSegments) => Boolean(f.sort || sheetActive(f) || (!withSegments && f.section));

// Whether the rows are by name, so under A–Z letters; `letters`: the list's own order is.
export const byName = (f, letters) => (f.sort ? f.sort === "name" : letters);

// The note for a list drawn with `count` of its `total` rows.
export function listNote({ count, total, filters, query, empty }) {
  if (count) return "";
  if (!total) return empty;
  return searchFilters(filters) ? "No packages match your filters." : query.trim() ? "No packages match your search." : empty;
}

// -> { el, filters, close(), draw() }. `order` names the list's own order, `withSegments` false leaves the segments out
// (a list already of one kind), `rows()` is the unfiltered list, `changed()` runs after each choice.
export function listScope({ order, withSegments = true, rows, changed }) {
  const filters = { ...emptyFilters(), sort: null };
  let drop = null;
  const scope = el("div", "search-scope");
  const seg = withSegments ? segments(SCOPES, {}, null, (name) => {
    filters.section = name === SCOPES[0] ? null : `group:${name}`;
    draw();
    changed();
  }) : null;
  const button = el("button", "scope-filter", "Filter");
  button.type = "button";
  panel().catch(() => {}); // ready for the first tap
  button.addEventListener("click", async () => {
    if (drop) { drop.close(); return; }
    const at = location.hash;
    const { openFilterPanel } = await panel();
    if (drop || location.hash !== at) return;
    drop = openFilterPanel({ filters, anchor: scope, alive: () => location.hash === at,
      changed: () => { draw(); changed(); }, closed: () => { drop = null; draw(); },
      sorts: listSorts(order), sectionRows: () => listSections(rows(), filters.section),
      compatFooter: "Packages that say they don't work on this iPhone." });
    draw();
  });
  if (seg) scope.append(seg);
  scope.append(button);
  function draw() {
    if (seg) {
      const shown = scopesFor(settings.deviceType());
      const at = scopeIndex(filters.section);
      // As in Search: a Tweaks or Themes scope goes back to All once those segments are hidden.
      if (at > 0 && !shown.includes(SCOPES[at])) filters.section = null;
      seg.show(shown);
      seg.select(SCOPES[scopeIndex(filters.section)] ?? null);
    }
    button.textContent = drop ? "Done" : "Filter";
    button.classList.toggle("done", Boolean(drop));
    button.classList.toggle("selected", !drop && filterOn(filters, withSegments));
  }
  draw();
  return { el: scope, filters, close: () => drop?.close(), draw };
}
