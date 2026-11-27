// The Filter panel (F35; F426a moved it out of screens/search.js): Show Incompatible, Clear Filters, Installed, Price,
// Source and Section. It drops down from under its page's scope bar and covers only the results (the search field and
// the segments stay), like a menu. Transform only. A page gives it its own filters, so two pages' never mix.
// Show Incompatible is the Works on My Phone setting turned round (F17), so Search, Sections and Settings agree.
import { catalog, ALL } from "../catalog.js";
import { compatFilterOn } from "../device.js";
import { settings } from "../settings-store.js";
import { createSwitch } from "../nav/switch.js";
import { SECTION_GROUPS } from "../core/catalog.js";
import { displayName, sourcesFor, sourceIcons } from "../core/sources.js";
import { sourceIconImage } from "../source-icon.js";
import { orderSources, loadOrder } from "../core/sourcelist.js";
import { getBackend } from "../backend.js";
import { grouped, el } from "../nav/ui.js";
import { EASE } from "../nav/motion.js";
import { loadNew } from "./sources.js";
import { emptyFilters, searchFilters } from "./searchscope.js"; // F426c

export { emptyFilters, searchFilters };

// F53: the Filter panel's Source rows: only the sources the device type shows (Not Jailbroken: AltStore ones,
// core/sources.js sourcesFor), in the Sources tab's order (Manage > Sources, F45) and by its display name.
export function sourceChoices(list, type, order = null) {
  return sourcesFor(orderSources(list, order), type).shown.map((s) => ({ label: displayName(s), value: s.key, source: s }));
}

// One choice group: a row per option (with its `icon` when given), the chosen one checked; a tap picks it and redraws.
// F449: an option with a `source` shows that source's icon as on the Sources tab (its letter until the picture loads).
function choiceGroup(header, options, current, pick, footer) {
  const g = grouped([{ header, footer, rows: options.map((o) => ({
    label: o.label,
    ...(o.source ? { icon: { text: displayName(o.source)[0]?.toUpperCase() ?? "?", cls: "filter-source-icon" } } : o.icon ? { icon: o.icon } : {}),
    checked: (o.value ?? null) === (current ?? null), onClick: () => pick(o.value ?? null),
  })) }]);
  const cells = g.querySelectorAll(".cell");
  options.forEach((o, i) => {
    if (o.source) cells[i]?.querySelector(".cell-icon")?.append(sourceIconImage(o.source.key, sourceIcons(o.source), getBackend()));
  });
  return g;
}

let shown = null; // the one open panel: { close() }

// Opens the panel, closing any other. `filters` (emptyFilters()) is the page's own and is changed in place; `anchor` is
// the element it drops from under; `changed()` runs after each change; `closed()` once, as it is put away (close(), or
// `alive()`, whether its page is still the open one, false after a navigation). -> { close }
// F426c, a list's own (listfilter.js): `sorts` ([{ label, value }]) is a Sort group at the top (filters.sort, which
// Clear Filters leaves), `sectionRows()` -> { groups, sections } the Section rows instead of every section, and
// `compatFooter` the words under Show Incompatible.
export function openFilterPanel({ filters: f, anchor, alive, changed, closed, sorts = null, sectionRows = null,
  compatFooter = "Packages that say they don't work on this iPhone. An exact name always shows, in red." }) {
  shown?.close();
  const box = el("div", "grouped filter-sheet filter-drop-inner");
  box.dataset.scroller = ""; // the iOS 6 scroll indicator follows it too (nav/scroller.js)
  const wrap = el("div", "filter-drop");
  wrap.style.top = Math.round(anchor.getBoundingClientRect().bottom) + "px";
  wrap.append(box);
  document.body.append(wrap);
  box.animate([{ transform: "translateY(-100%)" }, { transform: "none" }], { duration: 280, easing: EASE });
  const onRoute = () => { if (!alive()) close(); };
  addEventListener("hashchange", onRoute);
  function close() {
    if (shown !== ctl) return;
    shown = null;
    removeEventListener("hashchange", onRoute);
    closed?.();
    const a = box.animate([{ transform: "none" }, { transform: "translateY(-100%)" }], { duration: 220, easing: EASE, fill: "forwards" });
    a.finished.then(() => wrap.remove(), () => wrap.remove());
  }
  const ctl = { close };
  shown = ctl;
  let sources = [], sections = [];
  const set = (key, value) => { f[key] = value; draw(); changed(); };

  function draw() {
    const top = box.scrollTop;
    box.replaceChildren();
    if (sorts) box.append(choiceGroup("Sort", sorts, f.sort, (v) => set("sort", v)));
    // Compatibility first: the one users reach for when a package they know isn't there.
    const compat = grouped([{ rows: [{ label: "Show Incompatible" }],
      footer: compatFooter }]);
    const cell = compat.querySelector(".cell-inner");
    cell.classList.add("has-switch");
    cell.append(createSwitch({ label: "Show Incompatible", checked: !compatFilterOn(),
      onToggle: (on) => { if (compatFilterOn() === on) settings.set("worksOnMyPhone", !on); } }));
    box.append(compat);
    if (searchFilters(f)) {
      const clear = grouped([{ rows: [{ label: "Clear Filters", onClick: () => { Object.assign(f, emptyFilters()); draw(); changed(); } }] }]);
      clear.querySelector(".cell-inner").classList.add("filter-clear");
      box.append(clear);
    }
    box.append(choiceGroup("Installed", [{ label: "All Packages" }, { label: "Installed", value: "installed" },
      { label: "Not Installed", value: "not" }], f.installed, (v) => set("installed", v),
    catalog.statusSource() === "upload" ? "Installed packages come from the dpkg status file uploaded on the Installed page." : null));
    box.append(choiceGroup("Price", [{ label: "Free and Paid" }, { label: "Free", value: "free" }, { label: "Paid", value: "paid" }],
      f.price, (v) => set("price", v)));
    box.append(choiceGroup("Source", [{ label: "All Sources", icon: { text: "", cls: "filter-all-icon" } }, ...sources],
      f.source, (v) => set("source", v)));
    const own = sectionRows?.();
    const groupRows = (own?.groups ?? SECTION_GROUPS).map((g) => ({ label: `All ${g}`, value: `group:${g}` }));
    box.append(choiceGroup("Section", [{ label: "All Sections" }, ...groupRows, ...(own?.sections ?? sections).map((s) => ({ label: s, value: s }))],
      f.section, (v) => set("section", v)));
    box.scrollTop = top;
  }
  draw();
  load();
  return ctl;

  // The Source and Section rows, drawn once read.
  async function load() {
    try {
      const type = settings.deviceType();
      const [list, data] = await Promise.all([getBackend().sources(), sectionRows ? null : catalog.sections(ALL)]);
      sources = sourceChoices(list, type, loadOrder());
      if (data) sections = data.sections.map((s) => s.name);
      // A source picked under the other device type, now hidden: back to All Sources.
      if (f.source != null && !sources.some((o) => o.value === f.source)) { f.source = null; changed(); }
      if (box.isConnected) draw();
      // F53: AltStore sources seeded by URL (F28) have no name until loaded, as on the Sources tab's first visit
      // (F43): load them (B75: the shared run under the reload bar, screens/sources.js loadNew) and redraw with
      // their names.
      if (await loadNew()) {
        sources = sourceChoices(await getBackend().sources(), type, loadOrder());
        if (box.isConnected) draw();
      }
    } catch {
      // no sources or sections yet (or a first load failed): the sheet keeps what it has
    }
  }
}
