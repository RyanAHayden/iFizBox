// The Details page's rows, after Cydia's Details (the 4S): one page, nav title "Details", for an apt package
// (browse.js renderPackage) and an AltStore app (altstore.js renderApp). Under the store header and Details | Reviews |
// Related, the Details pane is icon-tile rows: the options at the top, the Preview gallery, the description in a
// dashed box (its first LINES lines; More Information opens the rest), the Version group with its CHANGE price button,
// Information with icons, Links with globe tiles, Block, and the centred "id\n· source - section" footer.
//
// What rows a page has is worked out here from plain facts (packageRows, appRows, moreInfoShown), so node tests can
// check every state; the pages turn the rows into grouped() sections and add each row's link or tap (detailRows).
//
//   packageRows(facts) -> { options, versionHeader, version, change, info, price, payment }
//                                                                  rows: { key, label, detail, icon, cls }
//   appRows(facts)     -> { addTweaks, version, change, info }
//   moreInfoShown({ text, depiction, whatsNew, permissions }) -> bool
//   detailsFooter(id, source, section) -> "id\n· source - section"
//   detailRows(rows, actions) -> grouped() rows, each with its tile and actions[key]'s href / onClick
//   descGroup(text, { full }) / changeButton(group, onClick) / tileCells(node, icon) / footerGroup(text)
import { el, grouped } from "../nav/ui.js";
import { rowIcon } from "../icons/rowicons.js";
import { loadStyle } from "../nav/motion.js";
import { estimateLines, LINES, linkified } from "./description.js";

export const DETAILS_TITLE = "Details";
export const PREVIEW_HEADER = "Preview";
export const MORE_INFO_LABEL = "More Information";
export const SETTINGS_LABEL = "Change Package Settings";
export const FILES_LABEL = "Filesystem Content";
export const CHANGE_LABEL = "CHANGE";

// A text longer than the box's LINES lines (description.js's estimate: no layout in node tests).
export const longText = (text) => Boolean(text) && estimateLines(String(text)) > LINES;

// More Information is there only when it has something the page doesn't: the rest of a long text, a depiction,
// What's New, or an app's Permissions.
export function moreInfoShown({ text = "", depiction = false, whatsNew = false, permissions = 0 } = {}) {
  return longText(text) || Boolean(depiction) || Boolean(whatsNew) || permissions > 0;
}

const row = (key, label, detail = null, icon = key, extra = {}) => ({ key, label, detail, icon, ...extra });

// An apt package's rows.
//   installed: the installed version (null: not installed)   version: the page's version
//   author / maintainer: names (Maintainer only when it isn't the author)   versions: how many Version History has
//   files: Filesystem Content can be listed (the jailbreak app)   sideloadTweak: Add to App picks apps, not versions
//   installedOnly: no source carries it   source, section, worksOn, installedSize, depends: Information's facts
//   paid: cydia::commercial (the header's price, and the payment group: extras.js paymentGroup)
export function packageRows({ installed = null, version = "", author = null, maintainer = null, versions = 0, files = false,
  sideloadTweak = false, installedOnly = false, paid = false, source = "", section = null, worksOn = "", installedSize = null,
  depends = [] } = {}) {
  const options = [];
  if (installed) options.push(row("settings", SETTINGS_LABEL, null, "pkgSettings"));
  if (maintainer && author && maintainer.toLowerCase() !== author.toLowerCase()) options.push(row("maintainer", "Maintainer", maintainer, "pkgAuthor"));
  const ver = [row("version", "Version", installed ?? version ?? "", "pkgVersion", { cls: "cy-version-row" })];
  if (versions > 0) ver.push(row("history", "Version History", null, "pkgHistory"));
  if (installed && files) ver.push(row("files", FILES_LABEL, null, "pkgFiles"));
  const info = [];
  if (!installedOnly) info.push(row("source", "Source", source || "Unknown", "sources"));
  if (section) info.push(row("section", "Section", section, "pkgSection"));
  info.push(row("worksOn", "Works On", worksOn || "", "worksOnMyPhone"));
  if (installedSize) info.push(row("size", "Installed Size", installedSize, "pkgSize"));
  if (depends.length) info.push(row("depends", "Depends", depends.join(", "), "pkgDepends", { cls: "store-info-long" }));
  return { options, versionHeader: installed ? "Installed Package" : "Version", version: ver,
    change: !sideloadTweak && versions > 1, info,
    price: installedOnly ? null : paid ? "Paid" : "Free", payment: paid && !installedOnly && !sideloadTweak };
}

// An AltStore app's rows.
//   sideload: the sideload build (Add Tweaks)   versions: how many it lists   version: "1.2 (34)"
//   storeVersion / storeRequires: the App Store's, once looked up   tooBig: past the website's size cap
export function appRows({ sideload = false, bundleId = "", versions = 0, version = "", source = "", category = "",
  worksOn = "", size = null, tooBig = false, storeVersion = null, storeRequires = null } = {}) {
  const ver = [row("version", "Version", version, "pkgVersion", { cls: "cy-version-row" })];
  if (versions > 0) ver.push(row("history", "Version History", versions === 1 ? "1 version" : `${versions} versions`, "pkgHistory"));
  const info = [row("source", "Source", source || "Unknown", "sources"), row("section", "Category", category || "App", "pkgSection"),
    row("worksOn", "Works On", worksOn || "Any iOS", "worksOnMyPhone")];
  if (size) info.push(row("size", "Size", size, "pkgSize", tooBig ? { cls: "size-over" } : {}));
  if (storeVersion) info.push(row("storeVersion", "App Store Version", storeVersion, "pkgVersion"));
  if (storeRequires) info.push(row("storeRequires", "App Store Requires", storeRequires, "worksOnMyPhone"));
  if (bundleId) info.push(row("bundleId", "Bundle ID", bundleId, "pkgBundle", { cls: "store-info-long" }));
  return { addTweaks: Boolean(sideload && bundleId), version: ver, change: versions > 1, info };
}

// Cydia's footer: the id, then "· source - section" (either may be missing).
export function detailsFooter(id, source = "", section = null) {
  const where = [source, section].filter(Boolean).join(" - ");
  return where ? `${id}\n· ${where}` : String(id);
}

// grouped() rows from packageRows/appRows rows: each with its tile, and actions[key] ({ href } / { onClick, chevron })
// merged in. A row with no action is plain.
export function detailRows(rows, actions = {}) {
  return rows.map(({ key, icon, ...r }) => ({ ...r, icon: rowIcon(icon), ...(actions[key] ?? {}), ...(r.cls ? { cls: r.cls } : {}) }));
}

// The description in Cydia's dashed box: its first LINES lines (packages.css .cy-desc-text clamps it), or the whole
// text on More Information (`full`). URLs in it stay links (description.js linkified).
export function descGroup(text, { full = false } = {}) {
  const g = el("div", "group cy-desc-group");
  const box = el("div", full ? "cy-desc cy-desc-full" : "cy-desc");
  const t = linkified(text);
  t.classList.add("cy-desc-text");
  box.append(t);
  g.append(box);
  return g;
}

// Version's CHANGE: the price button (myipas.css .price-btn, the eras' look in ios7.css / ios13.css) at the right of
// the group's .cy-version-row; it opens the pick-a-version sheet. `disabled` (no other version to pick, or Add to
// App's tweak) greys it, as the eras draw a disabled price button. -> the button, or null with no such row.
export function changeButton(node, onClick, { disabled = false } = {}) {
  const cell = node.querySelector?.(".cy-version-row .cell-inner");
  if (!cell) return null;
  loadStyle("myipas.css");
  const b = el("button", "price-btn cy-change", CHANGE_LABEL);
  b.type = "button";
  b.disabled = disabled;
  b.addEventListener("click", (e) => { e.stopPropagation?.(); onClick(); });
  cell.append(b);
  cell.classList.add("has-change");
  return b;
}

// A tile in front of every row of a group someone else builds (Block, Add Tweaks).
export function tileCells(node, icon) {
  const src = rowIcon(icon).src;
  for (const c of node.querySelectorAll?.(".cell-inner") ?? []) {
    if (c.querySelector?.(".cell-icon")) continue;
    const i = el("span", "cell-icon row-icon");
    const im = el("img");
    im.alt = "";
    im.onload = () => im.classList.add("loaded");
    im.src = src;
    i.append(im);
    c.prepend(i);
  }
  return node;
}

// The footer as its own group, centred in every era (packages.css / ios13.css .cy-foot).
export function footerGroup(text) {
  const f = grouped([{ footer: text }]);
  f.querySelector(".group-footer")?.classList.add("cy-foot");
  return f;
}
