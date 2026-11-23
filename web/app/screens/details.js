// The Details page's rows, after Cydia's Details (the 4S): one page, nav title "Details", for an apt package
// (browse.js renderPackage) and an AltStore app (altstore.js renderApp). Under the store header and Details | Reviews |
// Related, the Details pane is icon-tile rows: the options at the top, the Preview gallery, the description in a
// dashed box (its first LINES lines; More Information opens the rest), the Version group,
// Information with icons, Links with globe tiles, Block, and the centred "id\n· source - section" footer.
//
// What rows a page has is worked out here from plain facts (packageRows, appRows, moreInfoShown), so node tests can
// check every state; the pages turn the rows into grouped() sections and add each row's link or tap (detailRows).
//
//   packageRows(facts) -> { options, versionHeader, version, info, price, payment }
//                                                                  rows: { key, label, detail, icon, cls }
//   appRows(facts)     -> { addTweaks, version, info }
//   moreInfoShown({ text, depiction, whatsNew, permissions }) -> bool
//   detailsFooter(id, source, section) -> "id\n· source - section"
//   detailRows(rows, actions) -> grouped() rows, each with its tile and actions[key]'s href / onClick
//   descGroup(text, { full }) / tileCells(node, icon) / footerGroup(text)
import { el, grouped } from "../nav/ui.js";
import { rowIcon } from "../icons/rowicons.js";
import { estimateLines, LINES, linkified } from "./description.js";

export const DETAILS_TITLE = "Details";
export const PREVIEW_HEADER = "Preview";
export const MORE_INFO_LABEL = "More Information";
export const SETTINGS_LABEL = "Change Package Settings";
export const FILES_LABEL = "Filesystem Content";

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
//   author / maintainer: names (Maintainer only when it isn't the author)
//   files: Filesystem Content can be listed (the jailbreak app)   sideloadTweak: Add to App picks apps, not versions
//   installedOnly: no source carries it   source, section, worksOn, installedSize, depends: Information's facts
//   paid: cydia::commercial (the header's price, and the payment group: extras.js paymentGroup)
export function packageRows({ installed = null, version = "", author = null, maintainer = null, files = false,
  sideloadTweak = false, installedOnly = false, paid = false, source = "", section = null, worksOn = "", installedSize = null,
  depends = [] } = {}) {
  const options = [];
  if (installed) options.push(row("settings", SETTINGS_LABEL, null, "pkgSettings"));
  if (maintainer && author && maintainer.toLowerCase() !== author.toLowerCase()) options.push(row("maintainer", "Maintainer", maintainer, "pkgAuthor"));
  const ver = [row("version", "Version", installed ?? version ?? "", "pkgVersion")];
  if (installed && files) ver.push(row("files", FILES_LABEL, null, "pkgFiles"));
  const info = [];
  if (!installedOnly) info.push(row("source", "Source", source || "Unknown", "sources"));
  if (section) info.push(row("section", "Section", section, "pkgSection"));
  info.push(row("worksOn", "Works On", worksOn || "", "worksOnMyPhone"));
  if (installedSize) info.push(row("size", "Installed Size", installedSize, "pkgSize"));
  if (depends.length) info.push(row("depends", "Depends", depends.join(", "), "pkgDepends", { cls: "store-info-long" }));
  return { options, versionHeader: installed ? "Installed Package" : "Version", version: ver, info,
    price: installedOnly ? null : paid ? "Paid" : "Free", payment: paid && !installedOnly && !sideloadTweak };
}

// An AltStore app's rows.
//   sideload: the sideload build (Add Tweaks)   version: "1.2 (34)"
//   storeVersion / storeRequires: the App Store's, once looked up   tooBig: past the website's size cap
export function appRows({ sideload = false, bundleId = "", version = "", source = "", category = "",
  worksOn = "", size = null, tooBig = false, storeVersion = null, storeRequires = null } = {}) {
  const ver = [row("version", "Version", version, "pkgVersion")];
  const info = [row("source", "Source", source || "Unknown", "sources"), row("section", "Category", category || "App", "pkgSection"),
    row("worksOn", "Works On", worksOn || "Any iOS", "worksOnMyPhone")];
  if (size) info.push(row("size", "Size", size, "pkgSize", tooBig ? { cls: "size-over" } : {}));
  if (storeVersion) info.push(row("storeVersion", "App Store Version", storeVersion, "pkgVersion"));
  if (storeRequires) info.push(row("storeRequires", "App Store Requires", storeRequires, "worksOnMyPhone"));
  if (bundleId) info.push(row("bundleId", "Bundle ID", bundleId, "pkgBundle", { cls: "store-info-long" }));
  return { addTweaks: Boolean(sideload && bundleId), version: ver, info };
}

// An IPA in My IPAs (myipas.js renderIpa), as an app's rows with what a local file doesn't have left out (Source,
// Category, the Version page): Version, then Information with Works On (its MinimumOSVersion), Size,
// Extensions, Bundle ID and the File.
//   sideload: the sideload build (Add Tweaks)   minimumOS: "15.0"   extensions: how many   file: its file name
export function ipaRows({ sideload = false, bundleId = "", version = "", minimumOS = "", size = null, extensions = 0, file = "" } = {}) {
  const ver = [row("version", "Version", version || "—", "pkgVersion")];
  const info = [];
  if (minimumOS) info.push(row("worksOn", "Works On", `iOS ${minimumOS} or later`, "worksOnMyPhone"));
  info.push(row("size", "Size", size || "—", "pkgSize"));
  if (extensions > 0) info.push(row("extensions", "Extensions", String(extensions), "pkgDepends"));
  info.push(row("bundleId", "Bundle ID", bundleId || "—", "pkgBundle", { cls: "store-info-long" }));
  if (file) info.push(row("file", "File", file, "pkgFiles"));
  return { addTweaks: Boolean(sideload && bundleId), version: ver, info };
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
// text on More Information (`full`). URLs in it stay links (description.js linkified). `onOverflow`: called once the
// box is on screen when its text runs past the clamp after all (longText only estimates), so the page can add More
// Information.
export function descGroup(text, { full = false, onOverflow = null } = {}) {
  const g = el("div", "group cy-desc-group");
  const box = el("div", full ? "cy-desc cy-desc-full" : "cy-desc");
  const t = linkified(text);
  t.classList.add("cy-desc-text");
  box.append(t);
  g.append(box);
  if (onOverflow && !full && typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (t.isConnected && t.scrollHeight > t.clientHeight + 1) onOverflow();
    }));
  }
  return g;
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
