// The package pages the Sources and Search tabs share: a source's Sections, a package list, a package's page and
// an author's packages. Not a tab of its own: sources.js and search.js hand it the routes below them.
//
// Routes. In the Sources tab the first segment is a source key (`deb:<URI>:<dist>`, or `*` for All Sources) and
// opens its Sections; every segment after that (and every segment in the Search tab) is a token:
//   section:<name>   the packages in that section ("section:*" = All Packages)
//   package:<id>     a package's page, in the source of the route (the newest version for All Sources/Search)
//   author:<name>    every package whose Author or Maintainer is <name>
//   versions:<id>    a package's Version History (F29): every version the sources offer, or an app's versions[]
// e.g. #/sources/deb%3Ahttps%3A%2F%2Frepo.chariz.com%2F%3A.%2F/section%3ATweaks/package%3Acom.example.tweak
//
// Lists come from the catalog in the parse worker (catalog.js); long ones are virtualised (nav/vlist.js).
import { grouped, placeholder, el, segments, note } from "../nav/ui.js";
import { createVList, withLetterHeaders } from "../nav/vlist.js";
import { createSectionIndex } from "../nav/sectionindex.js";
import { onPageOpen } from "../nav/pagestate.js";
import { showSheet } from "../nav/sheet.js";
import { format, settingsRoute } from "../router.js";
import { getBackend } from "../backend.js";
import { aptHeader, infoGroup } from "./sourcepage.js"; // F384: one source page
import { catalog, ALL } from "../catalog.js";
import { NO_SECTION, indexLetter, parseAuthor } from "../core/catalog.js";
import { packageIcon } from "../core/sectionicons.js";
import { description, parseRelations, compareVersions } from "../core/apt.js";
import { displayName, releaseDepiction } from "../core/sources.js";
import { insecureNote } from "../core/sources.js"; // F220
import { renderSileo, mediaUrl, reviewBody } from "./depiction.js";
import { piracyBanner } from "./depiction.js";
import { packageWarning } from "../core/warnings.js";
import { settings } from "../settings-store.js";
import { createSwitch } from "../nav/switch.js";
import { initDevice, filterRow, compatBadge, currentDevice } from "../device.js";
import { compat, markOf, isIncompatible } from "../core/compat.js";
import { isAltKey } from "../core/altstore.js";
import { renderAltSource, renderApp, installRows, appBundleId, formatDate, osRange, appPageAction, appPageCustom } from "./altstore.js";
import { previewSlot } from "./altstore.js";
import { previewText } from "./altstore.js"; // B328: the depiction page's fetch, shared with the gallery's
import { loadDepictionDescription, betterDescription } from "../core/previews.js"; // B328
import { slideChange } from "../nav/slide.js"; // B328: the longer description slides in
import { jailbreakModify } from "./altstore.js"; // B69
import { descriptionGroup } from "./description.js";
import { packageLinks, packageGithub, aptShots, sileoShots, sileoRatings, sileoWhatsNew } from "../core/previews.js";
import { storeHeader, headerLine, storeTabs, whatsNewGroup } from "./storepage.js";
import { reviewsTab } from "./reviews.js";
import { reviewsApi, reviewsBase, mergeReviews } from "../core/reviews.js";
import { showActionSheet } from "../nav/actionsheet.js";
import { showAlert } from "../nav/alert.js"; // B71a
import { signAndInstall } from "../signing/install.js";
import { localSigning } from "../signing/common.js";
import { installOptions } from "../core/altstore.js";
import { ipaInstallAvailable } from "../ipa-install.js";
import { IPA_FOOTER } from "../core/ipainstall.js";
import { detectMode } from "../core/settings.js";
import { apps, recordInstall } from "../core/installed.js";
import { rememberedApps } from "../app-updates.js";
import { ignoreVersionLabel, versionToStore, IGNORE_VERSION } from "../core/appupdates.js"; // F281
import { openInGroup, setSourceShare, shareHeadButton } from "./handoff.js";
import { sourceErrorGroup } from "./sourceerror.js"; // B177
import { load as loadLazy } from "../lazy.js"; // C38: Add Source from manage.js, loaded on the tap (manage.js imports browse.js)
import { featuredStrip, paymentGroup, paidStateOf, soldByVendor } from "./extras.js";
import { installQueue } from "../queue.js";
import { queuedFor, MODE_LABEL } from "../core/queue.js";
import { hasRollback, rollbackSlot } from "./rollback.js";
import { autoMarkShown, AUTO_MARK_LABEL } from "../core/automark.js";
import { createWishlist, wishLabel, wishRows, WISH_EMPTY } from "../core/wishlist.js";
import { filterRows } from "../core/changes.js";
import { sizeText as formatSize } from "../core/appqueue.js";
import { dailyPick, browseKind, collectionsFor, dayKey } from "../core/catalog.js";
import { readSpins, currentStreak, rouletteRow } from "./roulette-row.js"; // C38: not roulette.js, which imports browse.js
import { NAME } from "../brand.js";
import { PACKAGE } from "../brand.js"; // B71: iFizBox's own row never queues its Remove
import { appJob } from "../core/appqueue.js"; // B71
import { showMenu, longPress, copyText } from "../nav/menu.js";
const showRowMenu = (...a) => showMenu(...a); // B358: attachRowMenu adds a list's own items
import { showShareSheet } from "../nav/sharesheet.js";
import { showHUD } from "../nav/hud.js";
import { packageLinks as managerLinks, siteOrigin, formatOf } from "../core/handoff.js";
import { APP_TILES, installedManagers } from "./handoff.js";
import { appIcon, loadAppIcons } from "../app-icons.js";
import { attachRowSwipe, playHint } from "../nav/rowswipe.js";
import { showUndoBar } from "../nav/undobar.js";
import { go as navGo, handleOf } from "../nav/go.js";
import { runLogs } from "../queue.js";
import { appQueue } from "../app-queue.js"; // F213: the sideload build's rows queue apps
import { APP_MODE_LABEL } from "../core/appqueue.js";
import { rowAppJob, queueOriginalCheck } from "./altstore.js";
import { queueApp } from "./queue.js";
import { worksInGroup, addToApp, addableTweakRows, checkTweakRows } from "./tweaks.js"; // F302
import { installWhichVersion, INSTALL_WHICH_TITLE } from "./altstore.js"; // F346: a hold on Install
import { loadRowsIndex } from "./tweaks.js"; // F344
import { DETAILS_TITLE, packageRows, moreInfoShown, detailRows, descGroup, changeButton, footerGroup,
  detailsFooter, MORE_INFO_LABEL } from "./details.js"; // F350
import { rowIcon } from "../icons/rowicons.js";
import { appInfoNodes } from "./altstore.js"; // F350: an app's More Information
import { loadStyle } from "../nav/motion.js"; // F352: Add Tweaks' price button (myipas.css)
import { liteTweaks } from "../core/tweakindex.js"; // F352: Add Tweaks' background check

// B269: in the sideload build a Tweak Source's list leaves out the tweaks already checked and refused on this device.
export const sideloadListRows = (rows, mode = detectMode()) => (mode === "sideload" ? addableTweakRows(rows) : rows);

const ROW_HEIGHT = 58;
// F348: Cydia's tall package cell (Installed and a source's section lists): name, 'from <Author> (<Section>)', then the
// description across the whole row. One height for every wide row, so the virtualised list keeps placing by index.
export const WIDE_ROW_HEIGHT = 73;

// F348: a wide row's second line. Cydia says "Unknown" when it has no name to give; the section is left out when it
// says the same as the name (Cydia's rule for its source label).
export function fromLine({ author = "", section = "" } = {}) {
  const who = `from ${String(author || "").trim() || "Unknown"}`;
  const s = String(section || "").trim();
  return s && s !== String(author || "").trim() ? `${who} (${s})` : who;
}

// Section Visibility (F24): the hidden sections live on the device (core/settings.js hiddenSections) and reach
// the worker's catalog before its next answer, so every list, Search and Changes leave them out.
catalog.setHidden(settings.hiddenSections.list());
settings.onChange((key, value) => { if (key === "hiddenSections") catalog.setHidden(value); });
// Hide by Author (F104): the same, for authors hidden from their page (core/settings.js hiddenAuthors).
catalog.setHiddenAuthors(settings.hiddenAuthors.list());
settings.onChange((key, value) => { if (key === "hiddenAuthors") catalog.setHiddenAuthors(value); });
// Works on My Phone (F17): the device and the filter reach the worker the same way.
initDevice();

// Block (F226): blocked packages reach the worker's catalog the same way (core/settings.js blocked); blocked
// authors are F104's hidden authors, above.
catalog.setBlocked(settings.blocked.list());
settings.onChange((key, value) => { if (key === "blockedPackages") catalog.setBlocked(value); });
// F281: Ignore This Version ({ id: version }) reaches catalog.upgrades and app-updates.js; entries a newer version or
// the installed one passed are dropped from the setting (settle).
catalog.setIgnoredVersions(settings.ignoredVersions.all(), { onSettle: (next) => settings.ignoredVersions.replace(next) });
settings.onChange((key, value) => { if (key === "ignoredVersions") catalog.setIgnoredVersions(value); });

// Compatibility marks (F35): Settings > Show Compatibility Marks hides them all with one attribute, so rows bound
// while scrolling never read the setting.
function applyMarks() {
  if (globalThis.document?.documentElement) document.documentElement.dataset.compatMarks = settings.get("compatMarks") ? "on" : "off";
}
applyMarks();
settings.onChange((key) => { if (key === "compatMarks") applyMarks(); });

const MARK_LABEL = { works: "Works on this iPhone", no: "Doesn't work on this iPhone", unknown: "Compatibility unknown",
  unchecked: "Not checked yet: open the app to check" }; // F160

// The mark for a row's compat code: data-mark works | no | unknown (packages.css draws it); none when unjudged.
function setMark(span, code) {
  const m = markOf(code);
  if (m) { span.dataset.mark = m; span.setAttribute("aria-label", MARK_LABEL[m]); span.setAttribute("role", "img"); }
  else { delete span.dataset.mark; span.removeAttribute("aria-label"); span.removeAttribute("role"); }
}

export function parseToken(seg) {
  const s = String(seg ?? "");
  const i = s.indexOf(":");
  const kind = i > 0 ? s.slice(0, i) : "";
  return ["section", "package", "author", "versions", "info", "pkgsettings", "files", "addtweaks"].includes(kind) ? { kind, value: s.slice(i + 1) } : { kind: "unknown", value: s };
}

export const token = (kind, value) => `${kind}:${value}`;
// B305: a package page in one source outside the Sources tab ("package:<id>@<key>"): Installed's row for RyukGram
// opens RyukGram's entry, not the newest app on any source under com.burbn.instagram (Instagram). IDs have no "@".
export const keyedToken = (id, key) => token("package", key && key !== ALL ? `${id}@${key}` : id);

// Names seen in lists, so a package page's title (and the next page's back button) is ready before the worker
// answers. A deep link falls back to the id.
const names = new Map();
export const rememberNames = (rows) => { for (const r of rows) names.set(r.id, r.name); };

// What a route below the tab's own root shows: { key, page: "sections" | token kind, value }.
export function pageOf(route) {
  if (route.tab === "sources") {
    const key = route.path[0];
    if (route.path.length === 1) return { key, page: "sections" };
    const t = parseToken(route.path.at(-1));
    // F352: a tweak opened from an app's Add Tweaks is in its Tweak Source, not the app's ("package:<id>@<key>")
    const at = t.kind === "package" ? t.value.indexOf("@") : -1;
    if (at > 0) return { key: t.value.slice(at + 1), page: t.kind, value: t.value.slice(0, at) };
    return { key, page: t.kind, value: t.value };
  }
  const t = parseToken(route.path.at(-1));
  const at = t.kind === "package" ? t.value.indexOf("@") : -1;
  if (at > 0) return { key: t.value.slice(at + 1), page: t.kind, value: t.value.slice(0, at) };
  return { key: ALL, page: t.kind, value: t.value };
}

export function nav(route, sourceName = () => null) {
  const p = pageOf(route);
  switch (p.page) {
    case "sections": if (isAltKey(p.key)) return { title: sourceName(p.key) || "Source" }; // F9: screens/altstore.js
    return {
      title: p.key === ALL ? "Sections" : sourceName(p.key) || "Sections", style: "plain",
      right: { label: "Edit", onClick: (e) => toggleVisibility(route, e.currentTarget) },
    };
    case "section": return { title: p.value === ALL ? "All Packages" : p.value, style: "plain" };
    case "author": return { title: p.value || "Author", style: "plain" };
    // F29: Install (Modify once the page knows it's installed) opens the action sheet of what can be done here.
    // F350: Details (Cydia's title), with its More Information, Change Package Settings and Filesystem Content.
    case "info": return { title: MORE_INFO_LABEL };
    case "pkgsettings": return { title: "Settings" };
    case "files": return { title: "Files", style: "plain" };
    case "package": return { title: DETAILS_TITLE,
      right: { label: "Install", onClick: (e) => installTap(route, e.currentTarget).catch(() => {}),
        onHold: (b) => installHold(route, b).catch(() => {}) } }; // B330: tap queues, hold opens the options
    case "versions": return { title: "Versions" };
    case "addtweaks": return { title: "Add Tweaks", style: "plain" }; // F352
    default: return { title: "Not Found" };
  }
}

export function render(body, route, ctx) {
  const p = pageOf(route);
  switch (p.page) {
    case "sections": return isAltKey(p.key) ? renderAltSource(body, route, p.key, ctx) : renderSections(body, route, p.key, ctx);
    case "section": return renderList(body, route, async () => sideloadListRows(await catalog.list(p.key, p.value)), true,
      detectMode() === "sideload" && !isAltKey(p.key) ? dropRefusedTweaks : null);
    case "author": return renderAuthor(body, route, p.value);
    case "package": return renderPackage(body, route, p.key, p.value, ctx);
    case "info": return renderInfo(body, p.key, p.value);
    case "pkgsettings": return renderPackageSettings(body, p.value);
    case "files": return renderFiles(body, p.value);
    case "versions": return renderVersions(body, route, p.key, p.value);
    case "addtweaks": return renderAddTweaks(body, route, p.value); // F352
    default:
      body.append(note("Nothing here."));
  }
}

function spinner(text = "Loading Packages") {
  const p = el("div", "loading");
  p.append(el("span", "loading-spinner"), el("span", null, text));
  return p;
}

const deeper = (route, seg) => format({ tab: route.tab, path: [...route.path, seg] });

// ---- Sections (Cydia's SectionsController): "All Packages", then every section with its count -----------

// Sections pages on screen, by route, so their nav bar's Edit can find them: { body, route, key, editing, title }.
const sectionPages = new Map();

function renderSections(body, route, key, ctx = null) {
  for (const [k, p] of sectionPages) if (!p.body.isConnected) sectionPages.delete(k);
  const page = { body, route, key, editing: false, title: null, draw: 0, ctx };
  sectionPages.set(format(route), page);
  return drawSections(page);
}

async function drawSections(page) {
  const { body, route, key, editing } = page;
  const turn = ++page.draw; // an Edit tapped while the worker answers: only the last draw lands
  body.replaceChildren(placeholder("list", 7));
  let data;
  try {
    await catalog.ensure();
    data = await catalog.sections(key, editing ? { hidden: true } : undefined);
  } catch (e) {
    if (turn === page.draw) body.replaceChildren(note(e.message));
    return;
  }
  if (turn !== page.draw) return;
  const status = key === ALL ? null : catalog.status(key);
  const ul = el("ul", "table plain sections");
  if (editing) {
    // Cydia's edit mode: every section, hidden ones too, each with a switch (on = shown); no All Packages row.
    ul.classList.add("visibility");
    for (const s of data.sections) ul.append(visibilityRow(s));
  } else {
    ul.append(sectionRow("All Packages", data.total, deeper(route, token("section", ALL))));
    for (const s of data.sections) ul.append(sectionRow(s.name, s.count, deeper(route, token("section", s.name))));
  }
  body.replaceChildren(ul);
  if (!editing) body.prepend(filterRow(() => drawSections(page)));
  const statusNote = status?.error ? note(status.error) : null; // B177: the error group below takes its place
  if (statusNote) body.append(statusNote);
  else if (editing ? !data.sections.length : !data.total) {
    body.append(note(data.sections.length ? "Every section is hidden. Tap Edit to show them."
      : "No packages for this device. Works on My Phone hides the rest."));
  }
  // F76: Share in the nav bar (the iOS 6 share sheet: Copy Link, Add on Another Device, the APT managers) took the
  // place of F8's Open In group under the sections.
  if (!editing && key !== ALL) {
    const source = await getBackend().sources().then((l) => l.find((x) => x.key === key)).catch(() => null);
    if (source && turn === page.draw && body.isConnected) {
      // B177: a source whose refresh failed: the whole error and what to do about it, at the top (screens/sourceerror.js)
      const failed = sourceErrorGroup(source, { status, ctx: page.ctx, onChange: () => { if (body.isConnected) drawSections(page); } });
      body.prepend(featuredStrip(source)); // F20: the source's sileo-featured.json banners, above its sections
      if (failed) { statusNote?.remove(); body.prepend(failed); }
      body.prepend(aptHeader(source)); // F384: the same header card as an AltStore source
      setSourceShare(body, source);
      if (insecureNote(source)) body.append(grouped([{ footer: insecureNote(source) }])); // F220: an http source
      // F384: Trust, Updated, Last Release and Canister's HTTPS and Signed Releases (F305a, cached a week per repo) in
      // one Information group (screens/sourcepage.js)
      const canister = source.uri && !String(source.key ?? "").startsWith("alt:")
        ? import("./findmore.js").then((m) => m.canisterTrust(source)) : null;
      body.append(infoGroup(source, { canister }));
      // B23: what apt-get update said about it (the jailbreak app), when the catalog's own load didn't fail
      if (!failed && source.aptError && source.aptError !== status?.error) body.append(el("p", "empty source-apt-error", source.aptError));
    }
  }
}

// Edit <-> Done: the title becomes "Section Visibility" (Cydia's SECTION_VISIBILITY) and the rows turn into switches.
function toggleVisibility(route, button) {
  const page = sectionPages.get(format(route));
  if (!page || !page.body.isConnected) return;
  page.editing = !page.editing;
  button.textContent = page.editing ? "Done" : "Edit";
  button.classList.toggle("done", page.editing);
  const nav = handleOf(page.body);
  if (nav) {
    if (page.editing) { page.title = nav.title(); nav.setTitle("Section Visibility"); }
    else if (page.title != null) nav.setTitle(page.title);
  }
  drawSections(page);
}

function visibilityRow(s) {
  const li = el("li", "cell section-row");
  const inner = el("div", "cell-inner has-switch");
  const folder = el("span", "folder");
  folder.append(el("span", "folder-count", s.count > 9999 ? `${Math.floor(s.count / 1000)}k` : String(s.count)));
  inner.append(folder, el("span", "cell-label", s.name), createSwitch({
    label: `Show ${s.name}`, checked: !s.hidden,
    onToggle: (on) => settings.hiddenSections.set(s.name, !on),
  }));
  li.append(inner);
  return li;
}

function sectionRow(name, count, href) {
  const li = el("li", "cell section-row");
  const a = el("a", "cell-inner chevron");
  a.href = href;
  const folder = el("span", "folder");
  folder.append(el("span", "folder-count", count > 9999 ? `${Math.floor(count / 1000)}k` : String(count)));
  a.append(folder, el("span", "cell-label", name));
  li.append(a);
  return li;
}

// ---- package lists ---------------------------------------------------------------------------------------

const iconOk = new Set();  // icon URLs that loaded once: shown at once when their row comes back
const iconBad = new Set(); // and those that failed: never asked again

// F126, Cydia's PackageCell: the section's icon (else unknown.png) until the package's own icon loads, and a small
// badge in the bottom-right corner (core/sectionicons.js packageIcon: the purpose:: tag's, else the section's on
// an own icon). `art` holds the icon and the badge, which hangs over the icon's corner as in Cydia.
function createArt(large = false) {
  const art = el("span", large ? "pkg-art large" : "pkg-art");
  const icon = el("span", large ? "pkg-icon cy large" : "pkg-icon cy");
  const img = el("img");
  img.alt = "";
  img.decoding = "async";
  const badge = el("img", "pkg-badge");
  badge.alt = "";
  badge.hidden = true;
  icon.append(img);
  art.append(icon, badge);
  return { art, icon, img, badge };
}

// Fallback and badge for `item`; the own icon's <img> is the caller's (lists load it only once scrolling stops).
function paintArt(r, item) {
  const look = packageIcon(item);
  if (r.icon.dataset.fallback !== look.fallback) {
    r.icon.dataset.fallback = look.fallback;
    r.icon.style.backgroundImage = `url("${look.fallback}")`;
  }
  const badge = look.badgeKind === "section" && iconBad.has(item.icon) ? null : look.badge;
  r.badge.hidden = !badge;
  r.badge.classList.toggle("section", look.badgeKind === "section");
  if (badge && r.badge.dataset.url !== badge) { r.badge.dataset.url = badge; r.badge.src = badge; }
}

// F348: the wide row is the same row with the 'from' line between the name and the description (packages.css .wide).
function createWideRow() {
  const row = createRow();
  row.classList.add("wide");
  const from = el("span", "pkg-from");
  row._.desc.before(from);
  row._.from = from;
  return row;
}

function createRow() {
  const row = el("div", "pkg-row");
  const a = el("a", "cell-inner pkg");
  const { art, icon, img, badge } = createArt();
  img.onload = () => { iconOk.add(img.dataset.url); img.classList.add("loaded"); art.classList.add("own"); };
  img.onerror = () => { iconBad.add(img.dataset.url); img.removeAttribute("src"); badge.classList.contains("section") && (badge.hidden = true); };
  const text = el("span", "pkg-text");
  const top = el("span", "pkg-top");
  const compatEl = el("span", "compat-mark"); // F35: the check, X or ? (F17's text badge is on the package page)
  top.append(el("span", "pkg-name"), compatEl, el("span", "pkg-version"));
  text.append(top, el("span", "pkg-desc"));
  a.append(art, text);
  row.append(a);
  row._ = { a, art, icon, img, badge, name: top.firstChild, compat: compatEl, version: top.lastChild, desc: text.lastChild };
  return row;
}

function iconSrc(item) {
  if (!item.icon || iconBad.has(item.icon)) return null;
  return mediaUrl(item.icon);
}

const flaggedRow = (item) => Boolean((item.exact || item.misfit) && isIncompatible(item.compat));

function bindRow(row, item, route) {
  const r = row._;
  row._item = item;
  row.dataset.id = item.id;
  r.a.href = deeper(route, token("package", item.id));
  r.name.textContent = item.name;
  r.version.textContent = item.version;
  if (r.from) r.from.textContent = fromLine(item); // F348
  // Works on my phone (F17): the worker's code for this row, drawn as a mark (F35); rows never judged get none.
  setMark(r.compat, item.compat);
  // Search's exact match that can't work (F35), or the author page's misfit (B363): its name in red, the reason in
  // place of the description.
  const flagged = flaggedRow(item);
  r.name.classList.toggle("incompatible", flagged);
  r.desc.textContent = flagged && item.why ? item.why : item.short;
  markQueued(row);
  paintArt(r, item);
  const src = iconSrc(item);
  // Icons only load once scrolling stops (idle), unless this one already loaded: a fling starts no fetches.
  if (src && iconOk.has(item.icon)) {
    if (r.img.dataset.url !== item.icon) { r.img.dataset.url = item.icon; r.img.src = src; }
    r.img.classList.add("loaded");
    r.art.classList.add("own");
  } else {
    r.img.classList.remove("loaded");
    r.art.classList.remove("own");
    if (r.img.dataset.url) { r.img.removeAttribute("src"); delete r.img.dataset.url; }
  }
}

// N4: a queued package's row says so at once, in every list (Zebra #1992, #1892): Cydia's "Queued for <mode>" in
// place of the description, and data-queued for queue.css's tint. Rows on screen are redrawn on every change.
function markQueued(row) {
  const item = row._item;
  if (!item) return;
  // B71a: an AltStore app queued in the jailbreak app (app-queue.js) is marked the same way
  const job = installQueue.get(item.id) ?? (item.kind === "ipa" && appQueue.size && jbAppQueue() ? appQueue.get(String(item.id).replace(/~.*$/, "")) : null); // bundle id~name: a second app with that id
  if (job) row.dataset.queued = job.mode; else delete row.dataset.queued;
  if (job) row._.desc.textContent = queuedFor(job.mode);
  else if (row._.desc.textContent.startsWith("Queued for ")) {
    const flagged = flaggedRow(item);
    row._.desc.textContent = flagged && item.why ? item.why : item.short;
  }
}

// The package page's "Package Queue" row (Cydia's), shown while the package is queued.
function fillQueueSlot(slot) {
  const job = installQueue.get(slot.dataset.id);
  slot.replaceChildren(job ? grouped([{ header: "Package Queue", rows: [{ label: MODE_LABEL[job.mode] + (job.version && job.mode !== "remove" ? ` ${job.version}` : ""),
    detail: "Queued" }], footer: "Confirm from the Installed tab's Queue button, or tap Modify > Clear." }]) : "");
}

installQueue.subscribe(() => {
  if (!globalThis.document) return;
  for (const row of document.querySelectorAll(".pkg-row[data-id]")) markQueued(row);
  for (const slot of document.querySelectorAll(".package-queue-slot[data-id]")) fillQueueSlot(slot);
});
appQueue.subscribe(() => { // B71a
  if (!globalThis.document || !jbAppQueue()) return;
  for (const row of document.querySelectorAll(".pkg-row[data-id]")) markQueued(row);
});

function loadIcon(row, item) {
  const src = iconSrc(item);
  if (!src || row._.img.dataset.url === item.icon) return;
  row._.img.dataset.url = item.icon;
  row._.img.src = src;
}

// A virtualised package list. `letters`: Cydia's A–Z headers (lists sorted by name; search results aren't).
// `rows` may hold { header } items of their own when `letters` is off. `decorate(row, item)` runs after each bind.
// `wide` (F348): Cydia's tall rows (WIDE_ROW_HEIGHT), for Installed and a source's section lists; Search keeps the
// compact ones.
// B358: `moreItems(item)` -> more hold-menu items ({ label, onClick }) after the list's own (Changes' Mark as Not Installed).
export function packageList(body, route, rows, { letters = true, decorate = null, wide = false, moreItems = null } = {}) {
  rememberNames(rows.filter((r) => r.id));
  const items = letters ? withLetterHeaders(rows, (r) => indexLetter(r.name)) : rows;
  let swipe = null; // F193: a recycled row drops any swipe it was in
  const list = createVList(body, {
    items, rowHeight: wide ? WIDE_ROW_HEIGHT : ROW_HEIGHT, headerHeight: 23,
    createRow: wide ? createWideRow : createRow,
    bindRow: (row, item) => { swipe?.reset(row); bindRow(row, item, route); decorate?.(row, item); },
    idle: loadIcon,
  });
  list.el.classList.add("pkg-vlist"); // placeholder rows show through wherever real rows aren't drawn yet
  list.el.classList.toggle("wide", wide); // F348: the placeholders at the wide rows' height
  attachRowMenu(list.el, route, moreItems); // F192: hold a row for Install / Share / Source
  swipe = attachQueueSwipe(list.el, route); // F193: swipe a row left to queue it
  // Sorted by name with A–Z headers: Cydia's index down the right edge, instead of the scroll indicator.
  if (letters && body.parentElement) createSectionIndex(body, list);
  return list;
}

// F192: hold a package row for iOS 6's black callout (nav/menu.js), as a source row's Copy URL. Pure: what it lists.
// [{ kind: "queue", label: "Install" | "Upgrade" | "Remove", job } | { kind: "cancel", label: "Cancel" } |
//  { kind: "share", label: "Share" } | { kind: "source", label: "Source", key }].
// queue: the backend has an install queue (the jailbreak app); installed: the installed version or null; newest: the
// newest version a source can download (null when none can); queued: it is already in the queue; listKey: the source
// the list belongs to (Sources > a source), so Source isn't offered there. AltStore apps (kind "ipa") install from
// their page, and a paid package its vendor sells goes through the page's Purchase step (B11), so neither gets a
// queue item until installed.
// F213: `apps` (the sideload build's app queue, app-queue.js) gives AltStore apps the item instead: `job` is what the
// app page would queue (altstore.js rowAppJob), `installed` the apps store's version ("" when unknown), `queued` the
// app queue holds it: Cancel, Install (not installed) or Upgrade (a newer version is out); none when up to date.
// B71: `jbApps` (the jailbreak build's app rows: its app queue, B71a) gives AltStore apps Install / Upgrade
// (`job`: the IPA the helper installs, jailbreakAppRowState) or, installed and up to date, Remove; Cancel while
// `queued` (the app queue holds it). iFizBox's
// own package never lists Remove: up to date it offers Reinstall (when a source has that version), else nothing.
export function rowMenuItems(item, { queue = false, installed = null, newest = null, queued = false, listKey = null, apps = false, job = null,
  jbApps = false, id: appId = null } = {}) {
  const items = [];
  const id = item?.id;
  if (!id) return items;
  if (jbApps && item.kind === "ipa") {
    const up = newest && installed && compareVersions(newest, installed) > 0;
    if (queued) items.push({ kind: "cancel", label: "Cancel" }); // B71a: in the app queue already
    else if (job && installed == null) items.push({ kind: "queue", label: "Install", job: { app: "install", ...job } });
    else if (job && up) items.push({ kind: "queue", label: "Upgrade", job: { app: "install", ...job } });
    else if (installed != null) items.push({ kind: "queue", label: "Remove", job: { app: "remove", id: job?.id || appId || id, name: job?.name || item.name || id } });
  } else if (queue && item.kind !== "ipa" && id === PACKAGE) {
    if (queued) items.push({ kind: "cancel", label: "Cancel" });
    else if (installed && newest && compareVersions(newest, installed) > 0) items.push({ kind: "queue", label: "Upgrade", job: { op: "install", id, version: newest } });
    else if (installed && newest && compareVersions(newest, installed) === 0) items.push({ kind: "queue", label: "Reinstall", job: { op: "install", id, version: installed } });
    else if (!installed && newest) items.push({ kind: "queue", label: "Install", job: { op: "install", id, version: newest } });
  } else if (apps && item.kind === "ipa") {
    if (queued) items.push({ kind: "cancel", label: "Cancel" });
    else if (job && installed == null) items.push({ kind: "queue", label: "Install", job });
    else if (job && installed && newest && compareVersions(newest, installed) > 0) items.push({ kind: "queue", label: "Upgrade", job });
  } else if (queue && item.kind !== "ipa") {
    if (queued) items.push({ kind: "cancel", label: "Cancel" });
    else if (installed) {
      items.push(newest && compareVersions(newest, installed) > 0
        ? { kind: "queue", label: "Upgrade", job: { op: "install", id, version: newest } }
        : { kind: "queue", label: "Remove", job: { op: "remove", id } });
    } else if (newest && !item.paid) items.push({ kind: "queue", label: "Install", job: { op: "install", id, version: newest } });
  }
  items.push({ kind: "share", label: "Share" });
  if (item.key && item.key !== ALL && item.key !== listKey) items.push({ kind: "source", label: "Source", key: item.key });
  return items;
}

// F192: what Share on a package row lists (pure, as handoff.js shareItems): Copy Link, the package's page on the
// site (Search's package:<id>, which every visitor can open), then, for an APT package on the website with the phone
// set to Jailbroken, the package managers that open it (core/handoff.js packageLinks, imported as managerLinks).
// F219: the jailbreak build lists the managers this phone has (`managers`, a Set of names from handoff.js
// installedManagers), none when it has none; the sideload build lists none.
export function packageShareItems(item, source, { origin = siteOrigin(globalThis.location), mode = detectMode(),
  jailbroken = settings.jailbroken(), managers = null } = {}) {
  if (!item?.id) return [];
  const items = [{ kind: "copy", label: "Copy Link", text: origin + "/" + format({ tab: "search", path: [token("package", item.id)] }) }];
  const apt = source && formatOf(source) === "apt" && item.kind !== "ipa";
  const pick = mode === "site" && jailbroken ? () => true : mode === "jailbreak" && managers ? (app) => managers.has(app) : null;
  if (apt && pick) {
    for (const l of managerLinks(item.id, source)) {
      if (pick(l.app)) items.push({ kind: "open", label: l.app, url: l.url, ...(APP_TILES[l.app] ?? { letter: l.app[0] }) });
    }
  }
  return items;
}

function attachRowMenu(listEl, route, moreItems = null) {
  const listKey = route.tab === "sources" ? route.path[0] ?? null : null;
  longPress(listEl, ".pkg-row", async (row, e) => {
    const item = row._item;
    // Not while editing or showing a Delete (Wish List), nor on rows with no page (an unadded repo's preview).
    if (!item?.id || !row._.a.getAttribute("href") || row.classList.contains("armed") || row.closest(".editing")) return;
    const x = e.clientX;
    const more = moreItems ? await Promise.resolve().then(() => moreItems(item)).catch(() => []) ?? [] : []; // B358
    const showMenu = (anchor, items, opts) => showRowMenu(anchor, [...items, ...more], opts);
    if (item.kind === "ipa" && jbAppQueue()) { // B71a: the jailbreak app's app queue
      const st = await jbAppRowState(item);
      if (!row.isConnected || row._item !== item) return;
      const items = rowMenuItems(item, { ...st, listKey });
      showMenu(row, withVersionRowItems(items.map((it) => ({ label: it.label, onClick: () => runJbAppRowMenuItem(it, item, st) })), item), { x });
      return;
    }
    if (item.kind === "ipa" && queueKind() === "apps") { // F213: the sideload build's app queue
      const st = await appRowState(item);
      if (!row.isConnected || row._item !== item) return;
      const items = rowMenuItems(item, { apps: true, ...st, listKey });
      showMenu(row, withVersionRowItems(items.map((it) => ({ label: it.label, onClick: () => runAppRowMenuItem(it, item, st) })), item), { x });
      return;
    }
    const queue = queueOf();
    const history = queue && item.kind !== "ipa" ? await catalog.history(item.id, ALL).catch(() => null) : null;
    if (!row.isConnected || row._item !== item) return; // scrolled away and rebound while history came
    const installed = installedOf(history);
    const newest = history ? history.versions.find((v) => v.keys.length)?.version ?? null : item.version || null;
    const items = rowMenuItems(item, { queue: !!queue, installed, newest, queued: !!installQueue.get(item.id), listKey });
    showMenu(row, withVersionRowItems(items.map((it) => ({ label: it.label, onClick: () => runRowMenuItem(it, item, { installed, name: item.name }) })), item), { x });
  });
}

// F249: the job an app row's swipe or hold-menu Install puts in the app queue. A fresh install (`installed` null: no
// record) asks F243's once-per-app question first, as the app page does (altstore.js queueOriginalCheck): null for
// Cancel (queue nothing), keepBundleId: false for Install a Copy. Upgrades go in as they are.
export async function appRowQueueJob(job, installed, { check = queueOriginalCheck } = {}) {
  if (!job || installed != null) return job;
  return check(job);
}

// F213: an app row's Install / Upgrade queues it and opens Confirm, as the app page's button does; Cancel clears it.
async function runAppRowMenuItem(it, item, st) {
  if (it.kind === "cancel") return appQueue.clear(st.id);
  if (it.kind === "queue") { // F249
    const job = await appRowQueueJob(it.job, st.installed);
    return job ? queueApp(job) : undefined;
  }
  return runRowMenuItem(it, item, { installed: null, name: item.name });
}

// F213: which queue a list's rows go to: the jailbreak build's apt queue, the sideload build's app queue, or none
// (the website, F89).
const queueKind = () => (queueOf() ? "apt" : detectMode() === "sideload" ? "apps" : null);

// The app package and its source, asked at the touch (a short cache, as historyFor); the installed record and the
// queue are read fresh each time. -> rowMenuItems' { id, job, installed, newest, queued }.
const appRowPkg = new Map(); // id\nkey -> { at, p }
function appRowPkgOf(item) {
  const k = `${item.id}\n${item.key || ALL}`;
  let hit = appRowPkg.get(k);
  if (!hit || Date.now() - hit.at > 20000) {
    const p = Promise.all([catalog.package(item.id, item.key || ALL).catch(() => null), getBackend().sources().catch(() => [])])
      .then(([pkg, sources]) => ({ pkg, source: sources.find((s) => s.key === pkg?.key) ?? null }));
    hit = { at: Date.now(), p };
    appRowPkg.set(k, hit);
    if (appRowPkg.size > 200) appRowPkg.delete(appRowPkg.keys().next().value);
  }
  return hit.p;
}
async function appRowState(item) {
  const { pkg, source } = await appRowPkgOf(item);
  const r = await rowAppJob(pkg, source).catch(() => null);
  const id = r?.job?.id || pkg?.stanza?.ipa?.bundleIdentifier || item.id;
  return { id, job: r?.job ?? null, installed: r ? r.installed : null, newest: r?.newest ?? null, queued: !!appQueue.get(id) };
}

// ---- B71: app rows in the jailbreak build ------------------------------------------------------------------------
// What an app row's swipe or hold item would queue there (rowMenuItems' `jbApps`; jbAppRowState asks it, B71a: the
// app queue there runs through the helper, screens/queue.js runJailbreakApps).
// Pure: rowMenuItems' { id, job, installed, newest } from the row, its catalog package (`pkg`, or null) and the apps
// store's record (`rec`). Changes' remembered upgrade rows bring their own installed version and IPA (B68).
export function jailbreakAppRowState(item, { pkg = null, rec = null, source = null } = {}) {
  const app = pkg?.stanza?.ipa ?? null;
  const id = app?.bundleIdentifier || item?.id || null;
  const installed = item?.remembered && item.installed != null ? String(item.installed) : rec ? rec.version || "" : null;
  const newest = item?.remembered ? item.version || null : app?.versions?.find((v) => v?.version)?.version ?? item?.version ?? null;
  let job = app ? appJob(pkg, { installed: installed || null, version: item?.remembered ? newest : null, source }) : null;
  if (!job && typeof item?.ipa === "string" && /^https?:\/\//i.test(item.ipa)) {
    job = { id, name: item.name ?? null, version: newest, installed: installed || null, url: item.ipa, size: null, icon: item.icon ?? null,
      key: item.key ?? null, source: null, sourceName: null };
  }
  if (job) job = { ...job, id, name: job.name || item?.name || null };
  return { id, job, installed, newest };
}

// B71a: the jailbreak app queues AltStore apps (app-queue.js) beside apt's packages: the same Confirm sheet runs them
// through the helper (screens/queue.js runJailbreakApps). Its rows' swipe and hold menu use this.
const jbAppQueue = () => queueKind() === "apt" && ipaInstallAvailable();

// An app row's state there: its package and source (appRowPkgOf's short cache), the apps store's record (asked fresh)
// and the app queue. -> rowMenuItems' options { jbApps, id, job, installed, newest, queued }.
async function jbAppRowState(item) {
  const { pkg, source } = await appRowPkgOf(item);
  const bid = pkg?.stanza?.ipa?.bundleIdentifier || item.id;
  let rec = null;
  try { rec = (await (await apps()).all()).find((r) => r?.id === bid) ?? null; } catch { rec = null; }
  const st = jailbreakAppRowState(item, { pkg, rec, source: source ? displayName(source) : null });
  return { jbApps: true, ...st, queued: !!appQueue.get(st.id) };
}

// The hold menu's item: Install / Upgrade / Remove queue it and open Confirm (as a package's do), Cancel takes it out.
function runJbAppRowMenuItem(it, item, st) {
  if (it.kind === "cancel") return appQueue.clear(st.id);
  if (it.kind === "queue") return appQueue.add(it.job);
  return runRowMenuItem(it, item, { installed: null, name: item.name });
}

// The swipe's commit: quietly into the app queue (no Confirm), with the undo bar putting back what was there.
function commitJbAppSwipe(a) {
  const { item, id } = a;
  const prev = appQueue.get(id);
  const name = prev?.name || a.job?.name || item.name || item.id;
  if (a.kind === "cancel") appQueue.clear(id);
  else appQueue.add(a.job, { quiet: true });
  markHintSeen();
  showUndoBar({ message: swipeMessage(a, name, prev), onUndo: () => restoreApp(id, prev, { quiet: true }) });
}

// The app page's Modify (altstore.js jailbreakModify) queues too: `install(version)` an IPA of that version, `remove`
// the app; a queued app's sheet starts with Clear (Cydia's). -> jailbreakModify's options { install, remove, ask }.
export function jbModifyQueue(pkg, source, { queue = appQueue, ask = showActionSheet, store = apps } = {}) {
  const app = pkg?.stanza?.ipa;
  const id = app?.bundleIdentifier || pkg?.row?.id;
  const sourceName = source ? displayName(source) : null;
  const installedNow = async () => {
    try { return (await (await store()).all()).find((r) => r?.id === id)?.version ?? null; } catch { return null; }
  };
  let first = true;
  return {
    install: async (v) => {
      const job = appJob(pkg, { installed: await installedNow(), version: v?.version ?? null, source: sourceName });
      if (job) queue.add(job);
      else await showAlert({ title: app?.name || id, message: "This version has no IPA to install with the jailbreak.", buttons: ["OK"] });
    },
    remove: async ({ id: rid, name }) => { queue.add({ op: "remove", id: rid, name, installed: await installedNow() }); },
    ask: async (opts) => {
      if (!first || !queue.get(id)) { first = false; return ask(opts); }
      first = false;
      const shift = (d) => (Array.isArray(d) ? d.filter((i) => i >= 0).map((i) => i + 1) : typeof d === "number" && d >= 0 ? d + 1 : d);
      const i = await ask({ ...opts, buttons: ["Clear", ...opts.buttons], destructive: shift(opts.destructive) });
      if (i === 0) { queue.clear(id); return -1; }
      return i < 0 ? i : i - 1;
    },
  };
}

async function runRowMenuItem(it, item, { installed, name }) {
  if (it.kind === "cancel") return installQueue.clear(item.id);
  if (it.kind === "queue") return queueOf({ installed, name })?.(it.job);
  if (it.kind === "source") return go(format({ tab: "sources", path: [it.key] }));
  if (it.kind === "share") {
    const source = item.key ? (await getBackend().sources().catch(() => [])).find((s) => s.key === item.key) : null;
    return showPackageShare(item, source);
  }
}

async function showPackageShare(item, source) {
  // F219: the jailbreak build asks which managers the phone has (cached for the session after the first time).
  const managers = detectMode() === "jailbreak" ? await installedManagers() : null;
  const items = packageShareItems(item, source, { managers }).map((s) => s.kind === "copy"
    ? { label: s.label, glyph: "copy", onSelect: () => copyText(s.text).then(() => showHUD("Copying").done("Copied")) }
    : { label: s.label, letter: s.letter, color: s.color, image: appIcon(s.label), onSelect: () => { location.href = s.url; } });
  return showShareSheet({ items });
}

// ---- F193: swipe a package row left to queue it ---------------------------------------------------------------
// What the swipe does, from F192's rowMenuItems (the same states): its queue item, or null when it has none (the
// website and the sideload build have no queue; AltStore apps, unbought paid packages and ones no source can download
// get nothing). kind: the control behind the row: "add" (UITableView's green +, Install / Upgrade), "remove" (the red
// minus) or "cancel" (the same control in grey: take a queued one back out). F213: in the sideload build (`apps`)
// AltStore apps swipe to the app queue (add or cancel), and tweaks get nothing.
export function rowSwipeAction(item, opts = {}) {
  const it = rowMenuItems(item, opts).find((i) => i.kind === "queue" || i.kind === "cancel");
  if (!it) return null;
  if (it.kind === "cancel") return { kind: "cancel", label: "Cancel" };
  return { kind: it.label === "Remove" ? "remove" : "add", label: it.label, job: it.job };
}

// The undo bar's line: "Install Foo queued"; for a cancel, what was taken out: "Install Foo cancelled".
// F213: `labels` APP_MODE_LABEL for an app (its modes add Re-sign).
export function swipeMessage(action, name, prev = null, labels = MODE_LABEL) {
  if (action.kind === "cancel") return `${labels[prev?.mode] ?? "Queue for"} ${name} cancelled`;
  return `${action.label} ${name} queued`;
}

// The first-run hint plays once, for someone who has never queued anything (no flag, nothing queued, no console log
// kept), on a phone that has a queue. B129: maybeHint no longer passes `reduce`: with Reduce Motion it fades instead.
export const SWIPE_HINT_KEY = "ifizbox.swipeHint";
export function swipeHintDue({ seen = false, queued = 0, logs = 0, queue = false, reduce = false } = {}) {
  return queue && !seen && !queued && !logs && !reduce;
}

const hintStore = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
function markHintSeen() { try { hintStore()?.setItem(SWIPE_HINT_KEY, "1"); } catch { /* private mode: shows again */ } }
let hintPlayed = false; // this session, whatever the storage says
installQueue.subscribe((e) => { if (e.type === "add" && globalThis.document) markHintSeen(); });

// Installed and newest versions per package, asked at the touch: a short cache so a scroll's touches don't ask twice.
const swipeHistory = new Map(); // id -> { at, p }
function historyFor(id) {
  const hit = swipeHistory.get(id);
  if (hit && Date.now() - hit.at < 20000) return hit.p;
  const p = catalog.history(id, ALL).catch(() => null);
  swipeHistory.set(id, { at: Date.now(), p });
  if (swipeHistory.size > 200) swipeHistory.delete(swipeHistory.keys().next().value);
  return p;
}

function attachQueueSwipe(listEl, route) {
  const kind = queueKind();
  if (!kind) return null; // no queue here: nothing to swipe to
  if (kind === "apps") return attachAppSwipe(listEl, route); // F213
  const listKey = route.tab === "sources" ? route.path[0] ?? null : null;
  const swipe = attachRowSwipe(listEl, {
    rowSelector: ".pkg-row",
    // Not while editing, on a Wish List row (its left swipe shows Delete), a held row, or a row with no page.
    canStart: (row) => canSwipeRow(row),
    prepare: async (row) => {
      const item = row._item;
      if (item.kind === "ipa") { // B71a: AltStore apps go to the app queue, where the helper installs them
        if (!jbAppQueue()) return null;
        const st = await jbAppRowState(item);
        const action = rowSwipeAction(item, { ...st, listKey });
        return action && { ...action, item, app: true, id: st.id };
      }
      const history = item.kind !== "ipa" ? await historyFor(item.id) : null;
      const installed = installedOf(history);
      const newest = history ? history.versions.find((v) => v.keys.length)?.version ?? null : item.version || null;
      const action = rowSwipeAction(item, { queue: true, installed, newest, queued: !!installQueue.get(item.id), listKey });
      return action && { ...action, item, installed };
    },
    kindOf: (a) => a.kind,
    commit: (row, a) => {
      if (a.app) return commitJbAppSwipe(a); // B71a
      const { item, installed } = a;
      const name = item.name || item.id;
      const prev = installQueue.get(item.id);
      if (a.kind === "cancel") installQueue.clear(item.id);
      else installQueue.add({ ...a.job, installed, name }, { quiet: true });
      markHintSeen();
      showUndoBar({ message: swipeMessage(a, name, prev), onUndo: () => installQueue.restore(item.id, prev) });
    },
  });
  // The touch that starts a swipe also counts as having seen the hint.
  listEl.addEventListener("pointermove", () => { if (swipe.active) markHintSeen(); }, { passive: true });
  maybeHint(listEl);
  return swipe;
}

const canSwipeRow = (row) => !!row._item?.id && !!row._.a.getAttribute("href") && !row.classList.contains("armed")
  && !row.classList.contains("wish-row") && !row.classList.contains("is-held") && !row.closest(".editing");

// F213: the sideload build's swipe, on AltStore app rows only (tweaks have no queue there): Install / Upgrade adds the
// app page's job to the app queue quietly (no Confirm sheet, as F193), Cancel takes a queued one out; the undo bar
// puts back what was there.
appQueue.subscribe((e) => { if (e.type === "add" && globalThis.document) markHintSeen(); });
function attachAppSwipe(listEl, route) {
  const listKey = route.tab === "sources" ? route.path[0] ?? null : null;
  const swipe = attachRowSwipe(listEl, {
    rowSelector: ".pkg-row",
    canStart: (row) => canSwipeRow(row) && row._item.kind === "ipa",
    prepare: async (row) => {
      const item = row._item;
      const st = await appRowState(item);
      const action = rowSwipeAction(item, { apps: true, ...st, listKey });
      return action && { ...action, item, id: st.id, installed: st.installed };
    },
    kindOf: (a) => a.kind,
    commit: async (row, a) => {
      const { item, id } = a;
      const name = a.job?.name || item.name || item.id;
      // F249: a fresh install asks the original-app question first; Cancel queues nothing and shows no undo bar.
      const job = a.kind === "cancel" ? null : await appRowQueueJob(a.job, a.installed);
      if (a.kind !== "cancel" && !job) return;
      const prev = appQueue.get(id);
      if (a.kind === "cancel") appQueue.clear(id);
      else appQueue.add(job);
      markHintSeen();
      showUndoBar({ message: swipeMessage(a, prev?.name || name, prev, APP_MODE_LABEL), onUndo: () => restoreApp(id, prev) });
    },
  });
  listEl.addEventListener("pointermove", () => { if (swipe.active) markHintSeen(); }, { passive: true });
  // B129: the hint goes on the top row whose swipe does something (often not the first app row in the sideload build:
  // iFizBox's own row tops Top 25, Changes and its own source, and has nothing to queue once installed), with that
  // swipe's control.
  const hintAction = async (row) => {
    if (!canSwipeRow(row) || row._item.kind !== "ipa") return null;
    return rowSwipeAction(row._item, { apps: true, ...(await appRowState(row._item)), listKey });
  };
  maybeHint(listEl, () => appQueue.size, true, hintAction);
  return swipe;
}

// Undo: the queue as it was for that app (the job it held, or none). B71a: `quiet` in the jailbreak app (no Confirm).
function restoreApp(id, prev, { quiet = false } = {}) {
  if (!prev) return appQueue.clear(id);
  try { appQueue.add(prev, { quiet }); } catch { /* it can't be queued again: leave it out */ }
}

// F193's first-run hint: ~0.7 s after the list opens, its top row on screen eases left by 44pt and back, once.
// F213: `queued` counts the queue the rows swipe to; `apps` keeps the hint to rows that swipe (app rows in sideload).
// B129: `actionOf(row)` (the sideload build's app rows) -> the row's swipe action or null: the hint skips rows whose
// swipe does nothing and shows the control that row's swipe shows. With Reduce Motion the hint fades instead of
// moving (rowswipe.js playHint `fade`), so it still shows.
function maybeHint(listEl, queued = () => installQueue.size, apps = false, actionOf = null) {
  let seen = false;
  try { seen = !!hintStore()?.getItem(SWIPE_HINT_KEY); } catch { /* unreadable: treat as unseen */ }
  const reduce = !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (hintPlayed || !swipeHintDue({ seen, queued: queued(), logs: seen ? 0 : runLogs.list().length, queue: true })) return;
  setTimeout(async () => {
    if (hintPlayed || !listEl.isConnected) return;
    const rows = [...listEl.querySelectorAll(".pkg-row:not([hidden])")].filter((r) => r._item?.id && r._.a.getAttribute("href")
      && (!apps || r._item.kind === "ipa"));
    const view = listEl.parentElement?.getBoundingClientRect();
    const onScreen = [];
    for (const r of rows) {
      const b = r.getBoundingClientRect();
      if (b.height && b.top >= (view?.top ?? 0) - 1 && b.bottom <= innerHeight) onScreen.push({ r, top: b.top });
    }
    onScreen.sort((a, b) => a.top - b.top);
    let first = null, kind = "add";
    for (const { r } of onScreen.slice(0, actionOf ? 6 : 1)) {
      if (!actionOf) { first = r; break; }
      const a = await Promise.resolve(actionOf(r)).catch(() => null);
      if (hintPlayed || !listEl.isConnected) return;
      if (a && r._item && r.isConnected) { first = r; kind = a.kind; break; }
    }
    if (!first) return; // not on screen (another tab's list), empty, or nothing here swipes: the next list tries
    hintPlayed = true;
    markHintSeen();
    playHint(first, { distance: 44, duration: 1100, kind, fade: reduce });
  }, 700);
}

// Exported for Home's Browse (F46).
// B269: a sideload Tweak Source's list checks the tweaks not checked yet (screens/tweaks.js checkTweakRows) and
// drops each refused one, so no row is left that only leads to "can't go into an app".
function dropRefusedTweaks(body, list, rows) {
  checkTweakRows(rows, { stop: () => !list.el.isConnected, index: loadRowsIndex, // F344: the shared index first
    onRefused: (ids) => { const out = new Set(ids); list.setItems(withLetterHeaders(rows.filter((r) => !out.has(r.id)), (r) => indexLetter(r.name))); } });
}

async function renderList(body, route, fetchRows, letters, after = null) {
  body.append(placeholder("list"));
  let rows;
  try {
    await catalog.ensure();
    rows = await fetchRows();
  } catch (e) {
    body.replaceChildren(note(e.message));
    return;
  }
  body.replaceChildren();
  if (!rows.length) { body.append(note("No packages.")); return; }
  const list = packageList(body, route, rows, { letters, wide: true }); // F348: a source's section lists, Cydia's tall rows
  body.append(list.el);
  after?.(body, list, rows);
}

// F124: Browse's lists (New, Recently Updated, Popular, Featured, Free..., a category): the grey search bar, then the
// package list, filtered as you type (name, id, description, author: core/changes.js filterRows). `letters`: A–Z
// headers (lists by name); else `headers(rows)` may return the items with { header } rows of its own (New's days).
export async function renderSearchableList(body, route, fetchRows, { letters = false, headers = null, empty = "No packages.", label = "Search this list" } = {}) {
  const bar = listSearchBar(label);
  const none = note();
  none.hidden = true;
  const ph = placeholder("list");
  body.append(bar.el, none, ph);
  let rows;
  try {
    await catalog.ensure();
    rows = await fetchRows();
  } catch (e) {
    ph.remove();
    none.textContent = e.message;
    none.hidden = false;
    return;
  }
  ph.remove();
  const itemsFor = (rs) => (letters ? withLetterHeaders(rs, (r) => indexLetter(r.name)) : headers ? headers(rs) : rs);
  const shown = (q) => filterRows(rows, { query: q });
  let list = null;
  const draw = (q) => {
    const rs = shown(q);
    none.textContent = rs.length ? "" : q.trim() ? "No packages match your search." : empty;
    none.hidden = rs.length > 0;
    rememberNames(rs);
    if (!list) {
      list = packageList(body, route, letters ? rs : itemsFor(rs), { letters }); // packageList adds the letters itself
      body.append(list.el);
    } else list.setItems(itemsFor(rs));
  };
  draw(bar.input.value);
  bar.onQuery(draw);
}

// F352: Add Tweaks, a page of its own under an app's Details ("addtweaks:<bundle id>"): the grey search bar, then the
// tweaks for the app as Search draws packages (icon, name, version, description) with the price button at the end
// (tweaks.js addTweakButton: ADD checks and keeps the .deb, ADDED offers Remove, a paid one Sign In / Buy), grouped
// Added / Made for <app> / Works in Any App (tweaks.js addTweaksItems). A row opens the tweak's page in its Tweak
// Source; back comes here. Then More Tweaks: Browse Tweak Sources, Search All Repos, From Files, one footer.
async function renderAddTweaks(body, route, bundleId) {
  const tw = await import("./tweaks.js");
  const appName = tw.addTweaksAppName(bundleId) || names.get(bundleId) || "";
  const bar = listSearchBar("Search tweaks");
  const none = note();
  none.hidden = true;
  const ph = placeholder("list");
  body.append(bar.el, none, ph);
  loadStyle("myipas.css"); // the price button
  let made = [], any = [], kept = [], list = null, checking = null;
  const l = await tw.appTweakRows(bundleId).catch(() => ({ made: [], any: [], rows: [], infoOf: () => null }));
  ({ made, any } = l);
  const reload = async () => { kept = await tw.savedTweaks(bundleId).catch(() => []); draw(bar.input.value); };
  const decorate = (row, item) => {
    row._.add?.remove();
    const a = row._.a;
    if (item.file) a.removeAttribute("href"); // from Files: no page of its own
    else a.href = deeper(route, keyedToken(item.id, item.key));
    const b = tw.addTweakButton(item, { bundleId, on: Boolean(item.added), cls: "price-btn tw-row-add", onCls: "added", busyCls: "adding",
      onChange: reload });
    a.append(b);
    row._.add = b;
  };
  const more = tw.moreTweaksGroup({ bundleId, name: appName, onChange: reload });
  const draw = (q) => {
    if (!body.isConnected && list) { checking?.stop(); return; }
    const items = tw.addTweaksItems({ made, any, kept, query: q, appName });
    none.textContent = items.length ? "" : q.trim() ? "No tweaks match your search." : `No tweaks for ${appName || "this app"} in your Tweak Sources yet.`;
    none.hidden = items.length > 0;
    if (!list) {
      ph.remove();
      list = packageList(body, route, items, { letters: false, decorate });
      body.append(list.el, more);
    } else list.setItems(items);
  };
  kept = await tw.savedTweaks(bundleId).catch(() => []);
  draw("");
  bar.onQuery(draw);
  // the tweaks no index or earlier look has checked: checked here in the background, listed as they pass (F344)
  if (l.rows?.length) {
    checking = tw.checkForApp(l.rows, bundleId, { name: appName, onChecked: (r, info) => {
      if (!info?.ok) return;
      const next = liteTweaks(l.rows, bundleId, l.infoOf);
      if (next.made.length !== made.length || next.any.length !== any.length) { ({ made, any } = next); draw(bar.input.value); }
    } });
  }
}

// The grey search bar alone (Changes' and Search's look, packages.css), for a list's own filter.
function listSearchBar(label) {
  const form = el("form", "search-bar list-search");
  form.setAttribute("role", "search");
  const field = el("label", "search-field");
  const input = document.createElement("input");
  Object.assign(input, { type: "search", placeholder: "Search", autocapitalize: "off", autocomplete: "off", spellcheck: false, enterKeyHint: "search" });
  input.setAttribute("autocorrect", "off");
  input.setAttribute("aria-label", label);
  field.append(input);
  form.append(field);
  let handler = () => {};
  let timer = 0;
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => handler(input.value), 120); });
  form.addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(timer); handler(input.value); input.blur(); });
  return { el: form, input, onQuery: (f) => { handler = f; } };
}

// ---- Wish List (F102) --------------------------------------------------------------------------------------

// The device's Wish List (core/wishlist.js), made on first use.
let wishes = null;
export const wishlist = () => (wishes ??= createWishlist());

// Home's Wish List page: the wished packages the sources carry, as a plain package list; installed ones drop off the
// list for good (dpkg's status in the app, the uploaded one on the site; nothing drops where neither is known).
export async function renderWishlist(body, route) {
  body.append(placeholder("list"));
  let rows;
  try {
    await catalog.ensure();
    const installed = ((await catalog.installed().catch(() => null)) ?? []).map((r) => r.id);
    wishlist().prune(installed);
    const ids = wishlist().list();
    const found = await Promise.all(ids.map((id) => catalog.package(id).then((p) => (p && !p.installedOnly ? p.row : null), () => null)));
    rows = wishRows(ids, found, installed);
  } catch (e) {
    body.replaceChildren(note(e.message));
    return;
  }
  body.replaceChildren();
  if (!rows.length) { body.append(note(WISH_EMPTY)); return; }
  const list = packageList(body, route, rows, { letters: false });
  body.append(list.el);
}

// F104: an author's page: a Hide (or Show) Packages by <author> row, then their packages, which author() lists
// even while hidden. Manage > Hidden lists the hidden ones too.
export function authorToggleRow(name, hiddenNow) {
  return { label: `${hiddenNow ? "Show" : "Hide"} Packages by ${name}`, chevron: false };
}

// A list drawn again in the same page: the old one stops listening, and its A–Z index goes (packageList adds one).
const authorLists = new WeakMap();
export function dropList(body, list) {
  list?.destroy();
  for (const ix of body.parentElement?.querySelectorAll(":scope > .section-index") ?? []) ix.remove();
  delete body.dataset.sectionIndex;
}

async function renderAuthor(body, route, name) {
  dropList(body, authorLists.get(body));
  authorLists.delete(body);
  body.replaceChildren(placeholder("list"));
  let rows;
  try {
    await catalog.ensure();
    rows = await catalog.author(name);
  } catch (e) {
    body.replaceChildren(note(e.message));
    return;
  }
  body.replaceChildren();
  // The row goes in before the list, which measures where it starts (vlist.js); a tap redraws the page.
  if (name) {
    const hiddenNow = settings.hiddenAuthors.has(name);
    const g = grouped([{ rows: [{ ...authorToggleRow(name, hiddenNow), onClick: () => {
      settings.hiddenAuthors.set(name, !hiddenNow);
      renderAuthor(body, route, name);
    } }], footer: hiddenNow ? "Hidden everywhere else: lists, Search and Changes." : null }]);
    g.querySelector(".group").classList.add("author-hide"); // grouped() returns a fragment: the class goes on its .group
    body.append(g);
  }
  if (!rows.length) { body.append(note("No packages.")); return; }
  const list = packageList(body, route, rows);
  authorLists.set(body, list);
  body.append(list.el);
}

// ---- the package page --------------------------------------------------------------------------------------

// F226: the package page's Block group (Zebra #1037, #998): Block This Package, and Block Packages by <author>
// (F104's Hide by Author list). Pure: labels, the confirm sheets' words and the footer, for the tests.
export function blockRows({ name, author = null, blockedNow = false, authorBlocked = false, mode = "site", installed = false }) {
  const rows = [{ key: "package", label: blockedNow ? "Unblock This Package" : "Block This Package",
    confirm: blockedNow ? null : { title: `${name} will leave Browse, Search, Sections and Changes. Unblock it in Settings > General > Blocked.`, button: "Block Package" } }];
  if (author) {
    rows.push({ key: "author", label: authorBlocked ? `Unblock ${author}` : `Block Packages by ${author}`,
      confirm: authorBlocked ? null : { title: `Every package by ${author} will leave Browse, Search, Sections and Changes.`, button: "Block Author" } });
  }
  const held = mode === "jailbreak" && installed;
  const footer = blockedNow
    ? (held ? "Blocked, and held with dpkg so other package managers leave it alone too." : "Blocked: left out of every list on this device.")
    : held ? "Blocking an installed package also holds it with dpkg, so other package managers leave it alone."
      : null;
  return { rows, footer };
}

// The Block group, redrawn in place after each tap. In the app, blocking an installed package also holds it
// (core/settings.js blocked.set).
// F350: `tile`, a row icon in front of each row (the Details page's Block rows).
function blockGroup({ id, name, author, tile = null }) {
  const box = el("div", "package-block");
  let installed = false;
  const draw = () => {
    const { rows, footer } = blockRows({ name, author, blockedNow: settings.blocked.has(id), authorBlocked: author ? settings.blocked.hasAuthor(author) : false,
      mode: detectMode(), installed });
    box.replaceChildren(grouped([{ rows: rows.map((r) => ({ label: r.label, chevron: false, onClick: () => tap(r),
      ...(tile ? { icon: rowIcon(tile) } : {}) })), footer }]));
  };
  const tap = async (r) => {
    if (r.confirm && await showActionSheet({ title: r.confirm.title, buttons: [r.confirm.button], destructive: 0 }) !== 0) return;
    if (r.key === "package") {
      const on = !settings.blocked.has(id);
      // The helper's hold (or unhold) takes a moment: a HUD while it runs, as Reload Data's.
      const hud = installed && detectMode() === "jailbreak" ? showHUD(on ? "Blocking" : "Unblocking") : null;
      const { held } = await settings.blocked.set(id, on, { name, installed });
      hud?.done(on ? (held ? "Blocked and Held" : "Blocked") : "Unblocked");
    } else settings.blocked.setAuthor(author, !settings.blocked.hasAuthor(author));
    draw();
  };
  draw();
  if (detectMode() === "jailbreak") {
    catalog.installed().then((list) => { installed = Boolean(list?.some((p) => p.id === id)); if (box.isConnected) draw(); }).catch(() => {});
  }
  return box;
}

const httpUrl = (u) => (/^https?:\/\//i.test(String(u ?? "").trim()) ? String(u).trim() : null);

async function renderPackage(body, route, key, id, ctx) {
  body.append(placeholder("page"));
  let pkg, sources;
  try {
    await catalog.ensure();
    [pkg, sources] = await Promise.all([catalog.package(id, key), getBackend().sources()]);
  } catch (e) {
    body.replaceChildren(note(e.message));
    return;
  }
  if (!pkg) {
    body.replaceChildren(grouped([{ rows: [{ label: "Package not found" }], footer: id }]));
    return;
  }
  const st = pkg.stanza;
  if (st.kind === "ipa" && st.ipa) { // F9: an AltStore app
    names.set(id, st.name);
    const altSrc = sources.find((s) => s.key === pkg.key);
    // F181: its Related tab is the same as a package's: the source's other apps in that category.
    // F350: the same Details layout; Version's CHANGE opens Install Which Version? as the nav button's hold does.
    const { tail } = renderApp(body, route, pkg, altSrc, { related: (pane) => relatedPane(pane, route, pkg, id),
      onChange: () => installVersionHold(route).catch(() => {}) });
    // F102 for apps: their nav button installs at once (no sheet to hold Wish List), so it's a row on the page.
    const wishLi = grouped([{ rows: [{ label: wishLabel(wishlist().has(id)), icon: rowIcon("pkgWish"), onClick: () => {
      wishlist().set(id, !wishlist().has(id));
      wishLi.querySelector(".cell-label").replaceChildren(wishLabel(wishlist().has(id)));
    } }] }]).firstElementChild;
    tail.append(wishLi);
    if (detectMode() === "jailbreak") installedAppGroup(st.ipa.bundleIdentifier).then((g) => { if (g && tail.isConnected) tail.append(g); });
    rememberPackage(body, route, { id, pkg, source: altSrc, history: await catalog.history(id, key).catch(() => null) });
    return;
  }
  const sourceOf = (k) => sources.find((s) => s.key === k);
  const source = sourceOf(pkg.key);
  const sourceName = source ? displayName(source) : "";
  const desc = description(st);
  const name = st.name || st.package;
  names.set(id, name);
  const pid = st.package || id;

  // F181: the iOS 6 App Store's header (screens/storepage.js): the large glossy icon, name, author, stars once a
  // rating is known, "Version · size · price" and Share. Install / Modify stays the nav bar's right button.
  const art = createArt(true);
  paintArt(art, { ...pkg.row, icon: st.iconUrl ?? pkg.row.icon });
  const src = st.iconUrl && mediaUrl(st.iconUrl);
  if (src) {
    art.img.onload = () => { art.img.classList.add("loaded"); art.art.classList.add("own"); };
    art.img.onerror = () => { art.img.remove(); if (art.badge.classList.contains("section")) art.badge.hidden = true; };
    art.img.src = src;
  } else art.img.remove();
  // Works on my phone (F17): judged here from the stanza, so an installed-only page gets one too.
  const fit = compat(st, currentDevice());
  const fitCode = fit.status === "no" ? fit.reason : fit.status;
  const headMark = el("span", "compat-mark large");
  setMark(headMark, fitCode);
  const headAuthor = parseAuthor(st.author) || parseAuthor(st.maintainer);
  const size = formatSize(st.size);
  const header = storeHeader({ art: art.art, name, mark: headMark, author: headAuthor?.name ?? null,
    authorHref: headAuthor ? deeper(route, token("author", headAuthor.name)) : null, // F29: opens their packages
    line: headerLine({ version: st.version, size, price: pkg.installedOnly ? null : isPaid(st) ? "Paid" : "Free" }),
    // Share on the header, as an app page's (F194); the row hold menu's sheet (F192)
    action: shareHeadButton(() => showPackageShare({ id, key: pkg.key, kind: st.kind }, source)) });
  // F219: which managers the phone has and their icons, asked now so Share opens at once.
  if (detectMode() === "jailbreak") installedManagers().then((m) => loadAppIcons([...m])).catch(() => {});

  // Depiction: Sileo JSON drawn natively in Details; else an HTML depiction in a sheet, and the description. A package
  // with no Depiction: of its own gets the source's Release template (Cydia's fallback; an own non-http one
  // still counts as having one, so it gets neither).
  const sileo = httpUrl(st.sileodepiction);
  const html = st.depiction?.trim() ? httpUrl(st.depiction) : releaseDepiction(source, st.package || id);
  // One fetch of the Sileo JSON for the Details body, What's New, the stars and the Reviews tab (F181).
  const sileoJson = sileo ? getBackend().text(sileo).then((t) => JSON.parse(t)).catch(() => null) : Promise.resolve(null);
  const ratingOf = (json) => (json ? sileoRatings(json) : null);
  // F182: the stars and the Rating tile count reviews written here too (core/reviews.js mergeReviews).
  const reviewApi = getBackend().reviews ?? reviewsApi({ base: reviewsBase(detectMode()) });
  const reviewId = st.package || id;
  const oursFirst = reviewApi.list(reviewId, 0).catch(() => null);
  const showRating = (r) => { if (body.isConnected) header.setRating(r); };
  Promise.all([sileoJson, oursFirst]).then(([json, ours]) => showRating(mergeReviews({ ours, depiction: ratingOf(json) }).rating));
  const descText = desc.long || desc.short || "";

  const tabs = storeTabs({
    // F182: reviews written here (screens/reviews.js) merged with the depiction's; Tap to Rate, Write a Review.
    reviews: (pane) => reviewsTab(pane, { id: reviewId, version: st.version ?? "", depiction: sileoJson.then(ratingOf), first: oursFirst,
      api: reviewApi, renderText: (rv) => reviewBody(rv, { open: openSileoSheet }), onRating: showRating }),
    related: (pane) => relatedPane(pane, route, pkg, id),
  });
  const details = tabs.panes.details;
  // F350: what Details shows is known before the page is drawn, so nothing pops in under the header.
  // F18: what stops it installing, in plain words; its `targets` also link a virtual name to its provider.
  // F29: Version History, every version the sources offer (Downgrade's list).
  const [depReport, history, installedList] = await Promise.all([catalog.deps(id, key).catch(() => null),
    catalog.history(id, key).catch(() => null), catalog.installed().catch(() => null)]);
  const inst = installedList?.find((r) => r.id === pid) ?? null;
  const author = parseAuthor(st.author);
  const maint = parseAuthor(st.maintainer);
  const rels = [...parseRelations(st["pre-depends"]), ...parseRelations(st.depends)];
  const section = pkg.row.section && pkg.row.section !== NO_SECTION ? pkg.row.section : null;
  const isz = Number(st["installed-size"]);
  const plan = packageRows({ installed: inst?.version ?? null, version: st.version ?? "", author: author?.name ?? null,
    maintainer: maint?.name ?? null, versions: history?.versions.length ?? 0, files: typeof getBackend().packageFiles === "function",
    sideloadTweak: isSideloadTweak(st), installedOnly: pkg.installedOnly, paid: isPaid(st), source: sourceName, section,
    worksOn: fit.range ?? compatBadge(fitCode), installedSize: isz > 0 ? formatSize(isz * 1024) : null, depends: rels.map((g) => g[0].name) });
  body.replaceChildren(header.head, ...tabs.nodes);
  tabs.swipeOn(body); // F390
  // F228: from a source on the piracy list: Source Warning at the top of Details.
  const piracy = piracyBanner(packageWarning({ key: pkg.key, source: source?.uri }));
  if (piracy) details.append(piracy);
  // F375: an upgrade is out: What's New in it first, the installed version on the right.
  const upgradeNews = upgradeNewsSlot(st, inst, sileoJson);
  if (upgradeNews) details.append(upgradeNews);
  // F350: Change Package Settings (installed: its own page with the package's switches), Maintainer when it isn't the author.
  if (plan.options.length) details.append(grouped([{ rows: detailRows(plan.options, {
    settings: { href: deeper(route, token("pkgsettings", pid)) },
    maintainer: maint ? { href: deeper(route, token("author", maint.name)) } : {},
  }) }]));
  // F302: a Tweak Source's tweak in the sideload app: Works In (its filter's apps, read from the .deb on first open,
  // cached) and Add to App…, in Install's place.
  if (isSideloadTweak(st)) {
    // B296: a tweak that can't go into an app (or a library) loses the nav bar's Add to App, which only led to an
    // alert; every check tells it, the one after Sign In / Buy too. The first check's result always comes after
    // rememberPackage below has set the label (no await in between).
    details.append(worksInGroup(st, { onCheck: (info) => addToAppFollowsCheck(body, info) }).el);
  }
  // F20: price; in the app Sign In, Buy, Install. B11: in the app its state also drives the nav bar button.
  // F308: a paid sideload tweak's Price, Sign In and Buy are in its Add to an App group (worksInGroup) instead.
  const payBox = pkg.installedOnly || isSideloadTweak(st) ? null : paymentGroup(st, source, ctx, { onState: (s) => paidButton(body, s) });
  if (payBox) details.append(payBox);
  const shownDeps = pageDepReport(depReport, st);
  if (shownDeps?.problems.length) details.append(depProblemsGroup(shownDeps, route, ctx));
  if (queueOf()) {
    const slot = el("div", "package-queue-slot");
    slot.dataset.id = pid;
    fillQueueSlot(slot);
    details.append(slot);
  }
  // F122: the gallery, headed Preview (Screenshots:/Header:, a Sileo depiction's screenshots, else the HTML
  // depiction's pictures or the GitHub repo's), sideways with page dots and tap-to-zoom (altstore.js galleryGroup).
  const previews = el("div", "package-previews");
  details.append(previews);
  const previewKey = `pkg:${pkg.key ?? "installed"}:${pid}`;
  const drawPreviews = (json) => previews.replaceChildren(previewSlot(previewKey, {
    shots: [...aptShots(st), ...(json ? sileoShots(json) : [])],
    // B362: a Sileo depiction without screenshots (or one that didn't load) still has the HTML depiction's pictures.
    html,
    gh: packageGithub(st, json),
  }));
  if (!sileo) drawPreviews(null);

  // F350: the description in Cydia's dashed box, its first lines; More Information has the rest and the depiction.
  const moreSlot = el("div");
  const showMore = () => moreSlot.replaceChildren(grouped([{ rows: [{ label: MORE_INFO_LABEL, icon: rowIcon("pkgMore"),
    href: deeper(route, token("info", id)) }] }]));
  const descSlot = el("div", "package-desc-slot");
  const drawDesc = (t) => descSlot.replaceChildren(...(t ? [descGroup(t, { onOverflow: () => { if (!moreSlot.firstChild) showMore(); } })] : []));
  drawDesc(descText);
  details.append(descSlot, moreSlot);
  if (moreInfoShown({ text: descText, depiction: Boolean(sileo || html) })) showMore();
  // B328: an HTML depiction (BigBoss's) often holds the real description and Description: only a line of it: the
  // depiction's text takes the box when it's longer, sliding in.
  depictionDescriptionOf(st).then((t) => {
    const better = betterDescription(descText, t);
    if (better !== descText && descSlot.isConnected) slideChange(descSlot, () => drawDesc(better));
  });

  // Installed Package (or Version): Version with CHANGE (Install Which Version?), Version History, Filesystem Content.
  const versionBox = grouped([{ header: plan.versionHeader, rows: detailRows(plan.version, {
    history: history?.versions.length ? versionHistoryCell(route, id, history) : {},
    files: { href: deeper(route, token("files", pid)) },
  }) }]).firstElementChild;
  changeButton(versionBox, () => installVersionHold(route).catch(() => {}), { disabled: !plan.change });
  details.append(versionBox);
  // F71: the copies N7's daemon kept, filled in when the helper answers (screens/rollback.js).
  if (inst && hasRollback()) details.append(rollbackSlot(pid, { installed: installedOf(history), name: pkg.row?.name }));

  // Information, each row with its tile.
  details.append(grouped([{ header: "Information", footer: fit.detail, rows: detailRows(plan.info, {
    source: route.tab === "sources" && route.path[0] === pkg.key ? {} : { href: format({ tab: "sources", path: [pkg.key] }) },
    section: section ? { href: deeper(route, token("section", section)) } : {},
  }) }]));
  const conflicts = parseRelations(st.conflicts).map((g) => ({ label: g.map((r) => r.name + (r.op ? ` (${r.op} ${r.version})` : "")).join(" | ") }));
  if (conflicts.length) details.append(grouped([{ header: "Conflicts", rows: conflicts }]));
  // The same package from other sources, each with its version.
  const others = pkg.others.filter((o) => o.key !== pkg.key).map((o) => {
    const s = sourceOf(o.key);
    return { label: s ? displayName(s) : o.key, detail: o.version, icon: rowIcon("sources"),
      href: format({ tab: "sources", path: [o.key, token("package", id)] }) };
  });
  if (others.length) details.append(grouped([{ header: "Other Sources", rows: others }]));
  // Links (Homepage:, GitHub, a Sileo depiction's buttons), each with the globe tile.
  const links = el("div", "package-links");
  const drawLinks = (json) => {
    const list = packageLinks(st, json);
    links.replaceChildren(...(list.length ? [grouped([{ header: "Links", rows: list.map((l) => ({ label: l.label, subtitle: l.detail || l.url,
      icon: rowIcon("pkgLink"), chevron: true, onClick: () => window.open(l.url, "_blank", "noopener") })) }])] : []));
  };
  drawLinks(null);
  details.append(links);
  // F8: Open In, the package in another package manager (and its source from another device). Not in the jailbreak
  // build (F219: openInGroup returns nothing there; Share lists the installed managers).
  if (!pkg.installedOnly && source) details.append(openInGroup(source, { pkg: pid }));
  if (st.debUrl && getBackend().kind === "http") {
    // Paid packages (cydia::commercial) only download for a buyer's device: the repo refuses the proxy.
    if (/(^|,)\s*cydia::commercial\s*(,|$)/.test(st.tag ?? "")) details.append(grouped([paidDebSection()]));
    else details.append(downloadGroup(st));
  }
  details.append(blockGroup({ id: pid, name, author: headAuthor?.name ?? null, tile: "pkgBlock" })); // F226
  details.append(footerGroup(detailsFooter(st.package, pkg.installedOnly ? "" : sourceName, section)));
  rememberPackage(body, route, { id, key, pkg, source, history, payBox });
  if (sileo) sileoJson.then((json) => { if (previews.isConnected) { drawPreviews(json); drawLinks(json); } });
}

// F375: Details' What's New card when an upgrade is out (the installed version older than the source's): "What's
// New in <new version>", "Installed: <old version>" on the right and the Sileo depiction's newest changelog entry,
// drawn at once with NO_RELEASE_NOTES and swapped (sliding) when the JSON comes. No Version History row: Installed
// Package has it. null when nothing is installed or it's up to date. `.ready` settles once the notes are in.
export const NO_RELEASE_NOTES = "No release notes for this version.";
export function upgradeNewsSlot(st, inst, sileoJson = Promise.resolve(null)) {
  const newer = st?.version, old = inst?.version;
  if (!newer || !old || compareVersions(newer, old) <= 0) return null;
  const slot = el("div", "package-whatsnew-slot");
  const draw = (notes) => slot.replaceChildren(whatsNewGroup({ version: newer, date: `Installed: ${old}`, notes }));
  draw(NO_RELEASE_NOTES);
  slot.ready = Promise.resolve(sileoJson).catch(() => null).then((json) => {
    const text = json ? sileoWhatsNew(json)?.text?.trim() : null;
    if (text) { if (slot.isConnected) slideChange(slot, () => draw(text)); else draw(text); } // a page left: no slide
    return text || null;
  });
  return slot;
}

// B328: the description text of a package's own HTML Depiction: (not with a Sileo one, which Details draws, nor the
// source's Release template, which isn't about the package). "" without one or when it can't be read.
export function depictionDescriptionOf(st, { load = loadDepictionDescription, text = previewText } = {}) {
  const url = httpUrl(st?.depiction);
  if (!url || httpUrl(st?.sileodepiction)) return Promise.resolve("");
  return load(url, { text: (u) => text(u) }).catch(() => "");
}

// F350: More Information: the whole description in the dashed box, What's New and the depiction (a Sileo one drawn
// here, an HTML one behind Open Depiction); an app's: the whole text, What's New and Permissions (altstore.js).
async function renderInfo(body, key, id) {
  body.append(placeholder("page", 2));
  const pkg = await catalog.package(id, key).catch(() => null);
  if (!pkg) { body.replaceChildren(note("Package not found.")); return; }
  const st = pkg.stanza;
  if (st.kind === "ipa" && st.ipa) { body.replaceChildren(...appInfoNodes(st.ipa)); return; }
  const desc = description(st);
  const text = desc.long || desc.short || "";
  const sources = await getBackend().sources().catch(() => []);
  const source = sources.find((s) => s.key === pkg.key);
  const sileo = httpUrl(st.sileodepiction);
  const html = st.depiction?.trim() ? httpUrl(st.depiction) : releaseDepiction(source, st.package || id);
  const news = el("div", "store-news-slot");
  const slot = el("div", "depiction-slot");
  const descSlot = el("div", "package-desc-slot");
  const drawDesc = (t) => descSlot.replaceChildren(...(t ? [descGroup(t, { full: true })] : []));
  drawDesc(text);
  body.replaceChildren(descSlot, news, slot);
  depictionDescriptionOf(st).then((t) => { // B328: as on Details, the depiction's longer text in the full box
    const better = betterDescription(text, t);
    if (better !== text && descSlot.isConnected) slideChange(descSlot, () => drawDesc(better));
  });
  if (sileo) {
    loadSileo(slot, sileo, { fallback: "" }).then((json) => {
      const notes = json ? sileoWhatsNew(json) : null;
      const g = notes ? whatsNewGroup({ version: notes.title || st.version, notes: notes.text || null }) : null;
      if (g) news.replaceChildren(g);
    });
  } else if (html) {
    slot.append(grouped([{ rows: [{ label: "Depiction", icon: rowIcon("pkgLink"), chevron: true, onClick: () => openHtmlDepiction(html, st.name || id) }] }]));
  }
}

// F350: Change Package Settings, Cydia's own page: the package's switches (Ignore Upgrades, Update Automatically).
async function renderPackageSettings(body, id) {
  const g = await installedGroup(id, { version: false });
  body.replaceChildren(g ?? note("Not installed."));
}

// F350: Filesystem Content: the files dpkg lists for the installed package (backend packageFiles), as Cydia's list.
export const FILES_SHOWN = 2000;
async function renderFiles(body, id) {
  body.append(spinner("Loading Files"));
  let files = null;
  try { files = await getBackend().packageFiles?.(id); } catch { files = null; }
  if (!files) { body.replaceChildren(note("No files listed.")); return; }
  const shown = files.slice(0, FILES_SHOWN);
  const list = el("ul", "table plain pkg-files");
  for (const f of shown) {
    const li = el("li", "cell");
    const inner = el("div", "cell-inner");
    inner.append(el("span", "cell-label", f));
    li.append(inner);
    list.append(li);
  }
  body.replaceChildren(list);
  if (files.length > shown.length) body.append(note(`${shown.length} of ${files.length} files.`));
}

// F181: the Related tab: other packages in the same section from the same source (All Sources: from every source),
// as a plain list of up to RELATED rows; none when the package has no section.
const RELATED = 50;

// B41: one Related row. The package's own picture when its URL is one we can load (iconSrc: https/data, http
// through the proxy, not one that already failed in a list), over the icon its section list shows without one
// (B326: packageIcon's fallback, the section's icon, else Cydia's unknown.png; a letter tile here left most of a
// BigBoss tweak's Related rows blank, as their Icon is a file:/// path on the device). The fallback comes in as the
// tile's background (nav/ui.js icon.color); ui.js drops the <img> when it fails, and packages.css
// .store-related-icon keeps it out of sight until it loads, so the fallback shows while loading, without an icon,
// and after a failure.
export function relatedRow(r, route) {
  const { fallback } = packageIcon(r);
  return {
    label: r.name, subtitle: r.short || null, href: deeper(route, token("package", r.id)), cls: "store-related-row",
    icon: { text: "", color: `url("${fallback}") center / cover no-repeat`, src: iconSrc(r), cls: "store-related-icon" },
  };
}

async function relatedPane(pane, route, pkg, id) {
  const section = pkg.row?.section;
  if (!section || section === NO_SECTION || pkg.installedOnly) {
    pane.replaceChildren(note("No related packages."));
    return;
  }
  pane.replaceChildren(spinner("Loading Packages"));
  let rows;
  try { rows = await catalog.list(pkg.key ?? ALL, section); } catch (e) { pane.replaceChildren(note(e.message)); return; }
  rows = rows.filter((r) => r.id !== id);
  if (!rows.length) { pane.replaceChildren(note(`Nothing else in ${section}.`)); return; }
  pane.replaceChildren(grouped([{ header: `More in ${section}`, rows: rows.slice(0, RELATED).map((r) => relatedRow(r, route)), footer: rows.length > RELATED ? `${RELATED} of ${rows.length}: all of them are in ${section}.` : null }]));
  if (rows.length > RELATED) pane.append(grouped([{ rows: [{ label: `All of ${section}`, href: deeper(route, token("section", section)) }] }]));
}

// ---- Install / Modify and Version History (F29) ------------------------------------------------------------
//
// Cydia's nav bar button: Install, or Modify when the package is installed (ref/4s/screens/cydia-package-top.png),
// opening an action sheet (cydia-package-modify.png: Reinstall, Remove, Downgrade; Downgrade then lists the
// older versions, cydia-package-downgrade.png). The install queue is N4's: a backend that has one exposes
// `queue({ op: "install" | "remove", id, version })` and the sheet offers those; until then it offers what works
// here: the Version History page, the .deb on the site, and an AltStore app's install rows.

// Package pages on screen, by route, for their nav bar button: { body, route, id, pkg, source, history }.
const packagePages = new Map();

function rememberPackage(body, route, page) {
  for (const [k, p] of packagePages) if (!p.body.isConnected) packagePages.delete(k);
  packagePages.set(format(route), { body, route, ...page });
  const installed = page.pkg.stanza.kind !== "ipa" && page.history?.versions.some((v) => v.installed);
  setRightLabel(body, isSideloadTweak(page.pkg.stanza) ? ADD_TO_APP : buttonLabel(body, installed));
}

// F302: a tweak from a Tweak Source (core/catalog.js marks it `injectable`) in the sideload app: its page's button is
// Add to App (screens/tweaks.js addToApp), not Install.
export const ADD_TO_APP = "Add to App";
export const isSideloadTweak = (st, mode = detectMode()) => Boolean(st?.injectable) && st.kind !== "ipa" && mode === "sideload";

// B325: the dependency report (core/deps.js explain) the package page shows, or null. A sideload tweak gets none: it
// is checked against apt's sources and dpkg's status, which say nothing about a signed app. Its Depends can only name
// what Add to App bundles or drops (core/tweakfields.js injectableFromFields: the hooking library, PreferenceLoader,
// firmware, cy+ names), an unmet iOS range shows in the page's Works On (compat above) already, and the Lite app has no dpkg
// status to conflict with, so every sentence would be wrong ("Can't Install Yet: needs mobilesubstrate").
export const pageDepReport = (report, st, mode = detectMode()) => (isSideloadTweak(st, mode) ? null : report);

// B296: the Add to an App group's check (screens/tweaks.js tweakInfo: { ok, library, why }) says the tweak can't go
// into an app: the nav bar's Add to App is hidden, as the group already says why. A check that couldn't finish
// (null: paid, or the .deb unreadable) keeps it. `button(body)` -> the page's right button.
export function addToAppFollowsCheck(body, info, { button = (b) => handleOf(b)?.rightButton() } = {}) {
  const b = button(body);
  if (!b || b.textContent !== ADD_TO_APP) return false;
  b.hidden = Boolean(info && info.ok === false);
  return b.hidden;
}

// B11: a paid package a vendor sells (extras.js paidNav) shows its price on the button until it's bought, as Cydia
// did; Install once the vendor lets this account download it; Modify once it's installed, as for any package.
const paidLabels = new WeakMap(); // page body -> label
const buttonLabel = (body, installed) => installed ? "Modify" : paidLabels.get(body) ?? "Install";
function paidButton(body, state) {
  if (state) paidLabels.set(body, state.label);
  else paidLabels.delete(body);
  const page = [...packagePages.values()].find((p) => p.body === body);
  if (page) setRightLabel(body, buttonLabel(body, page.history?.versions.some((v) => v.installed)));
}

// N11: a run (install, upgrade, remove) re-reads dpkg (catalog.reloadInstalled), which fires catalog.onChange. A
// package page left open under the console kept saying Install after its package went in (and Modify after it was
// removed) until it was opened again (iPhone 7). Each APT page on screen asks for its Version History again, so the
// nav bar button and Modify's sheet follow what is installed now. AltStore pages keep their own state (altstore.js).
export async function refreshPackagePages(pages = packagePages, { history = (id, key) => catalog.history(id, key ?? ALL),
  label = setRightLabel } = {}) {
  for (const [k, p] of [...pages]) {
    if (!p.body.isConnected) { pages.delete(k); continue; }
    if (p.pkg.stanza.kind === "ipa" || isSideloadTweak(p.pkg.stanza)) continue; // F302: Add to App stays
    const h = await history(p.id, p.key).catch(() => null);
    if (!h || !p.body.isConnected) continue;
    p.history = h;
    label(p.body, buttonLabel(p.body, h.versions.some((v) => v.installed)));
  }
}
catalog.onChange(() => { refreshPackagePages().catch(() => {}); });

const installedOf = (history) => history?.versions.find((v) => v.installed)?.version ?? null;
// N4: `extra` ({ installed, name }) goes with every job, so the queue knows the mode (Reinstall, Downgrade...) at once.
const queueOf = (extra = {}) => { const b = getBackend(); return typeof b.queue === "function" ? (job) => b.queue({ ...extra, ...job }) : null; };
const isPaid = (st) => /(^|,)\s*cydia::commercial\s*(,|$)/.test(st?.tag ?? "");
const versionsHref = (route, id) => deeper(route, token("versions", id));
const go = navGo;

function downloadDeb(url, name) {
  const a = document.createElement("a");
  a.href = getBackend().assetUrl(url);
  a.download = decodeURIComponent(url.split("/").pop() || `${name}.deb`);
  document.body.append(a);
  a.click();
  a.remove();
}

// F30's record of an installed app (as renderApp does for its Install rows). F88: in the jailbreak app too, where
// installRows runs it on the helper's success.
function recordApp(pkg, source, v) {
  const app = pkg.stanza.ipa;
  return () => {
    apps().then((store) => recordInstall(store, { id: app.bundleIdentifier, name: app.name, version: v.version, key: pkg.key,
      source: app.sourceUrl, sourceName: app.sourceName || (source ? displayName(source) : ""), icon: app.iconURL })).catch(() => {});
  };
}

// An action sheet over [{ label, run }]; runs the tapped one.
// B351: the source button of packageActions' sheets (Install / Modify), so they (iOS 26: the anchored menu) come out of it.
let sheetFrom = null;
async function sheet(title, actions) {
  const i = await showActionSheet({ title, from: sheetFrom?.isConnected ? sheetFrom : null, buttons: actions.map((a) => a.label),
    destructive: actions.flatMap((a, j) => (a.red ? [j] : [])) });
  if (i >= 0) actions[i].run();
}

// ---- F346: a hold on Install (Modify, Upgrade, Reinstall, the price) picks the version to install ---------------
// The nav bar's button held (app.js button: nav/menu.js holdButton) opens Install Which Version?, the sheet of
// Change Installed Version (altstore.js installWhichVersion): the source's versions newest first, the installed one
// marked and left alone. An app's pick installs as Version History does (the sideload app queues that version, the
// website signs it, the jailbreak app queues its IPA through the helper or runs its first install row); a package's
// pick goes in the install queue as Modify > Downgrade's list does, and on the website it is that version's .deb.
// A tap is unchanged. Add to App (a sideload tweak) and pages with nothing to offer get no sheet.

// A package's sheet: -> { buttons, versions } as installWhichButtons, from its Version History (`history`, newest
// first): versions some source still offers, the installed one marked "(Installed)" with null at its index.
// `canInstall(v)`: whether a pick could do anything with it (the queue, or the .deb on the website).
export function packageWhichButtons(history, { canInstall = (v) => v.keys?.length > 0 } = {}) {
  const installed = history?.versions?.find((v) => v.installed)?.version ?? null;
  const list = (history?.versions ?? []).filter((v) => v?.version && (v.version === installed || canInstall(v)));
  return {
    buttons: list.map((v) => (v.version === installed ? `${v.version} (Installed)` : v.version)),
    versions: list.map((v) => (v.version === installed ? null : v)),
  };
}

// The hold's sheet and install for a package page. -> the version picked (installed, queued or downloaded), or null.
// `queue`: the install queue's add (undefined: the backend's; null: none, as on the website).
export async function packageWhichVersion(page, { ask = showActionSheet, queue = undefined, site = undefined,
  download = downloadDeb, vendorPaid = (st, source) => soldByVendor(st, source) } = {}) {
  const { id, pkg, source, history } = page;
  const st = pkg.stanza;
  const pid = st.package || id;
  const installed = installedOf(history);
  const q = queue === undefined ? queueOf({ installed, name: pkg.row?.name }) : queue;
  site ??= getBackend().kind === "http";
  if (q && isPaid(st) && await vendorPaid(st, source)) return null; // B11: apt can't fetch what a vendor sells
  const canInstall = (v) => (q ? v.keys?.length > 0 : site && Boolean(v.debUrl) && !isPaid(st));
  const { buttons, versions } = packageWhichButtons(history, { canInstall });
  if (!versions.some(Boolean)) return null;
  const i = await ask({ title: INSTALL_WHICH_TITLE, buttons });
  const v = i >= 0 ? versions[i] : null;
  if (!v) return null;
  if (q) await q({ op: "install", id: pid, version: v.version });
  else download(v.debUrl, pid);
  return v;
}

// The hold itself, for the page at `route`.
export async function installVersionHold(route, { pages = packagePages, mode = detectMode(), store = apps, ask = showActionSheet } = {}) {
  const page = pages.get(format(route));
  if (!page || !page.body.isConnected) return null;
  const { pkg, source } = page;
  const st = pkg.stanza;
  if (isSideloadTweak(st, mode)) return null; // F302: Add to App picks apps, not versions
  if (st.kind !== "ipa" || !st.ipa) return packageWhichVersion(page, { ask });
  const app = st.ipa;
  let installed = "";
  try { installed = (await (await store()).all()).find((r) => r?.id === app.bundleIdentifier)?.version ?? ""; } catch { installed = ""; }
  // The jailbreak app: that version's IPA into the app queue (Confirm) where the helper runs it, else its first row.
  const jailbreakInstall = async (v) => {
    const jbq = jbAppQueue() ? jbModifyQueue(pkg, source) : null;
    if (jbq && appJob(pkg, { version: v.version })) return jbq.install(v);
    const row = installRows(v, app.sourceUrl, undefined, recordApp(pkg, source, v), undefined, app.name,
      { bundleId: appBundleId(app, pkg.row?.id ?? page.id), iconUrl: app.iconURL }).rows[0];
    return row?.onClick();
  };
  return installWhichVersion(app, pkg, source, { installed, ask, mode, jailbreakInstall });
}

// ---- B330: Install taps straight into the queue; the options wait for a hold ------------------------------------
// A package that isn't installed (the button says Install, not Modify): a tap queues its version and the Confirm
// sheet opens (screens/queue.js, on the queue's add), and a hold opens the options sheet a tap used to
// (packageActions: Other Versions, Wish List...). Modify keeps its tap (the Modify sheet) and its hold (Install Which
// Version?, F346), as its options already cover the rest. An app's Install already installs on a tap and keeps its
// hold; Add to App, a paid package (its Purchase steps) and the website (no install queue) keep the options on a tap.

// Whether the page's button is Install for an apt package: no Modify, no app, no Add to App.
export function installNoModify(page, { mode = detectMode() } = {}) {
  const st = page?.pkg?.stanza;
  if (!st || st.kind === "ipa" || isSideloadTweak(st, mode)) return false;
  return !installedOf(page.history);
}

// The tap. -> "queued" (Confirm opens) or "options" (packageActions ran), or null for a page gone.
// `queue`: the install queue's add (undefined: the backend's; null: none, as on the website).
export async function installTap(route, button, { pages = packagePages, mode = detectMode(), queue = undefined,
  paidState = (box) => paidStateOf(box), options = packageActions } = {}) {
  const page = pages.get(format(route));
  if (!page || !page.body.isConnected) return null;
  if (installNoModify(page, { mode })) {
    const { id, pkg } = page;
    const q = queue === undefined ? queueOf({ installed: null, name: pkg.row?.name }) : queue;
    // A paid check that fails counts as paid: the options sheet, never a queue that skips the purchase.
    const paid = isPaid(pkg.stanza) && await Promise.resolve().then(() => paidState(page.payBox)).catch(() => true);
    if (q && !paid) {
      if (!page.body.isConnected) return null;
      await q({ op: "install", id, version: pkg.stanza.version });
      return "queued";
    }
  }
  await options(route, button);
  return "options";
}

// The hold. -> "options" where the button is Install (packageActions ran), else what F346's hold returns.
export async function installHold(route, button, { pages = packagePages, mode = detectMode(), options = packageActions,
  versions = installVersionHold } = {}) {
  const page = pages.get(format(route));
  if (!page || !page.body.isConnected) return null;
  if (!installNoModify(page, { mode })) return versions(route);
  await options(route, button);
  return "options";
}

async function packageActions(route, button) {
  sheetFrom = button ?? null;
  const page = packagePages.get(format(route));
  if (!page || !page.body.isConnected) return;
  const { id, pkg, source, history } = page;
  const st = pkg.stanza;
  if (isSideloadTweak(st)) return addToApp(st); // F302
  const many = (history?.versions.length ?? 0) > 1;
  const actions = [];
  if (st.kind === "ipa" && st.ipa) {
    const v = st.ipa.versions[0];
    // F80: Install / Upgrade / Reinstall queue the app and open Confirm; Modify while it's queued (altstore.js).
    if (await appPageAction(pkg, source)) return;
    // I5: in the sideload app Install signs this app on the phone and installs it.
    if (await signIfReady(st.ipa, v, recordApp(pkg, source, v))) return;
    // Install at the top right installs: the first row (the source's signed link, or the jailbreak). Download IPA and
    // older versions are on the page, not in a menu in between. On the website the first row is Install (F92: the
    // certificate alert until F93's browser signing).
    const rowsOf = (ver) => installRows(ver, st.ipa.sourceUrl, undefined, recordApp(pkg, source, ver), undefined, st.ipa.name,
      { bundleId: appBundleId(st.ipa, pkg.row?.id ?? id), iconUrl: st.ipa.iconURL });
    // B69: in the jailbreak app Modify (an installed app) opens Cydia's sheet; Install keeps its one tap below.
    // B71a: where the app queue runs through the helper, Modify's Upgrade / Reinstall / Downgrade / Remove queue it (Confirm
    // opens, as a package's Modify), Clear first while it's queued; a queued app not installed gets Clear alone.
    const jbq = jbAppQueue() ? jbModifyQueue(pkg, source) : null;
    if (ipaInstallAvailable() && await jailbreakModify(pkg, { install: (ver) => rowsOf(ver).rows[0]?.onClick(),
      history: many ? () => go(versionsHref(route, id)) : null, ...(jbq ?? {}) })) return;
    const qid = st.ipa.bundleIdentifier || id;
    if (jbq && appQueue.get(qid)) return sheet(st.ipa.name || "", [{ label: "Clear", run: () => appQueue.clear(qid) }]);
    // F255: Install (not installed) queues it there too and Confirm opens, as a row's Install does; an app with no IPA
    // the helper can install (a source-signed link) keeps the first row's one tap below.
    if (jbq && appJob(pkg, { version: v?.version ?? null })) return jbq.install(v);
    const { rows, options } = rowsOf(v);
    if (rows[0] && rows[0].label !== "Download IPA") return rows[0].onClick();
    for (const r of rows) actions.push({ label: r.label, run: r.onClick });
    if (many) actions.push({ label: "Version History", run: () => go(versionsHref(route, id)) });
    return sheet(options.itms ? "" : "Download IPA keeps the file.", actions);
  }
  const installed = installedOf(history);
  const queue = queueOf({ installed, name: pkg.row?.name });
  // B11: apt can't fetch a paid package its vendor sells, so the sheet offers the Purchase group's step instead.
  const paid = queue ? await paidStateOf(page.payBox) : null;
  if (paid) {
    if (!page.body.isConnected) return;
    const { actions: paidSheet, title } = paidActions(paid, { id: st.package || id, version: st.version, installed, queue,
      queued: !!installQueue.get(st.package || id) });
    return sheet(title, paidSheet);
  }
  const older = installed ? history.versions.filter((v) => v.keys.length && compareVersions(v.version, installed) < 0) : [];
  // Cydia's first action on a queued package: Clear (N4).
  if (queue && installQueue.get(st.package || id)) actions.push({ label: "Clear", run: () => installQueue.clear(st.package || id) });
  if (queue) {
    if (installed) {
      // Cydia's order: Upgrade or Reinstall (only what a source can download), then Remove, then Downgrade.
      const newest = history.versions.find((v) => v.keys.length);
      if (newest && compareVersions(newest.version, installed) > 0) actions.push({ label: "Upgrade", run: () => queue({ op: "install", id, version: newest.version }) });
      if (history.versions.some((v) => v.installed && v.keys.length)) actions.push({ label: "Reinstall", run: () => queue({ op: "install", id, version: installed }) });
      // B69: Ignore Upgrades (the Installed Package switch, Settings' Ignored Upgrades) while a newer one is out
      const ignore = ignoreAction(st.package || id, Boolean(newest && compareVersions(newest.version, installed) > 0));
      if (ignore) actions.push(ignore);
      const ignoreVer = ignoreVersionAction(st.package || id, { installed, newest: newest?.version ?? null }); // F281
      if (ignoreVer) actions.push(ignoreVer);
      if ((st.package || id) !== PACKAGE) actions.push({ label: "Remove", run: () => queue({ op: "remove", id }) }); // B71: never itself
      if (older.length) actions.push({ label: "Downgrade", run: () => sheet("", older.map((v) => ({ label: v.version, run: () => queue({ op: "install", id, version: v.version }) }))) });
    } else {
      actions.push({ label: "Install", run: () => queue({ op: "install", id, version: st.version }) });
    }
  } else if (installed && older.length) {
    actions.push({ label: "Downgrade", run: () => go(versionsHref(route, id)) });
  }
  if (many && !(installed && older.length)) actions.push({ label: "Other Versions", run: () => go(versionsHref(route, id)) });
  // The website: a jailbroken phone's iFizBox installs it with apt (ifizbox://package, websign-gate.js), so nobody has to
  // download a .deb (user 2026-11-18); Download .deb stays below for other package managers.
  if (getBackend().kind === "http" && (st.package || id)) {
    actions.push({ label: `Install in ${NAME}`, run: () => import("../websign-gate.js").then((g) => { location.href = g.packageLink(st.package || id); }) });
  }
  if (st.debUrl && getBackend().kind === "http" && !isPaid(st)) actions.push({ label: "Download .deb", run: () => downloadDeb(st.debUrl, st.package) });
  // F102: Add to Wish List while it isn't installed; Remove from Wish List whenever it is on the list.
  const wishId = st.package || id;
  if (!installed || wishlist().has(wishId)) actions.push({ label: wishLabel(wishlist().has(wishId)), run: () => wishlist().set(wishId, !wishlist().has(wishId)) });
  const title = queue ? "" : getBackend().kind === "http"
    ? `Packages install on the iPhone, from ${NAME}'s jailbreak app or another package manager.`
    : `Installing from ${NAME} comes with its install queue, which this build doesn't have yet.`;
  return sheet(title, actions);
}

// B69: Modify's Ignore Upgrades for an installed package: offered while an upgrade is out, Stop Ignoring Upgrades once
// it's ignored (a dpkg hold in the app, core/settings.js holds). Null when neither applies.
export function ignoreAction(id, upgrade, holds = settings.holds) {
  if (holds.has(id)) return { label: "Stop Ignoring Upgrades", run: () => holds.set(id, false) };
  return upgrade ? { label: "Ignore Upgrades", red: true, run: () => holds.set(id, true) } : null;
}

// F281: Modify's Ignore This Version for an installed package while an upgrade is out and it isn't ignored whole
// (holds), Stop Ignoring This Version while the version on offer is the ignored one. Null when neither applies.
export function ignoreVersionAction(id, { installed = null, newest = null } = {}, { holds = settings.holds, iv = settings.ignoredVersions } = {}) {
  const label = ignoreVersionLabel({ installed, newest, ignored: iv.get(id), held: holds.has(id) });
  if (!label) return null;
  return { label, red: label === IGNORE_VERSION, run: () => iv.set(id, versionToStore(label, newest)) };
}

// F281: the row hold menu's Ignore This Version for an upgrade row in Changes (Available Upgrades: its `version` is
// the one on offer, `installed` the one there), or Stop Ignoring This Version on a row Ignore This Version filed under
// Ignored Upgrades (`ignoredVersion`). [] for any other row.
export function versionRowItems(item, { holds = settings.holds, blocked = settings.blocked, iv = settings.ignoredVersions } = {}) {
  if (!item?.id || item.change !== "upgrade" || !item.version || !item.installed) return [];
  if (!item.ignoredVersion && (holds.has(item.id) || blocked?.has?.(item.id))) return [];
  const label = ignoreVersionLabel({ installed: item.installed, newest: item.version, ignored: iv.get(item.id) });
  return label ? [{ label, onClick: () => iv.set(item.id, versionToStore(label, item.version)) }] : [];
}
// The hold menu's entries with versionRowItems' put in before Share.
function withVersionRowItems(entries, item) {
  const extra = versionRowItems(item);
  if (!extra.length) return entries;
  const at = entries.findIndex((e) => e.label === "Share");
  return at < 0 ? [...entries, ...extra] : [...entries.slice(0, at), ...extra, ...entries.slice(at)];
}

// B11: the nav bar sheet of a paid package its vendor sells, in the app (`paid`: extras.js paidNav). Not installed:
// the Purchase group's step (Sign In, Buy, Download & Install). Installed: Upgrade or Reinstall through Download &
// Install (it fetches the page's version, `version`) once bought, and Remove through the queue; no Downgrade, since
// the vendor only hands out the current deb. Add to / Remove from Wish List as for any package.
export function paidActions(paid, { id, version, installed, queue, queued = false, wish = wishlist() }) {
  const actions = [];
  if (queued) actions.push({ label: "Clear", run: () => installQueue.clear(id) });
  if (installed) {
    if (paid.install && version && compareVersions(version, installed) > 0) actions.push({ label: "Upgrade", run: paid.install });
    else if (paid.install && version === installed) actions.push({ label: "Reinstall", run: paid.install });
    actions.push({ label: "Remove", run: () => queue({ op: "remove", id }) });
  } else {
    actions.push(...paid.actions);
  }
  if (!installed || wish.has(id)) actions.push({ label: wishLabel(wish.has(id)), run: () => wish.set(id, !wish.has(id)) });
  return { actions, title: installed && paid.install ? "" : paid.note ?? "" };
}

// I5: in the sideload app, sign `v` on the phone and install it when the version has an IPA. True when signing took
// over (whatever its outcome: errors are shown in an alert). False elsewhere: nothing else signs (F89).
async function signIfReady(app, v, record) {
  const url = installOptions(v, app.sourceUrl).download;
  // F75: Install goes straight to signAndInstall, which opens the Signing walkthrough at the missing step when the
  // certificate or the server isn't there yet (no sheet first, no alert)
  if (!url || !localSigning()) return false;
  await signAndInstall({ url, name: app.name, bundleId: app.bundleIdentifier || null, onInstalled: () => record?.() }); // F243: the original-app check
  return true;
}

// The package page's row to its Version History: how many versions are on offer.
// Version History's row (F29), for the What's New card (F181, screens/storepage.js whatsNewGroup).
export function versionHistoryCell(route, id, history) {
  const n = history.versions.filter((v) => (history.kind === "ipa" ? true : v.keys.length)).length;
  return { label: "Version History", detail: n === 1 ? "1 version" : `${n} versions`, href: versionsHref(route, id) };
}

// One version's cell: version (and build), its tags, the detail on the right, a line under it, release notes.
function versionCell({ label, tags = [], detail = null, sub = null, notes = null, onClick = null, unavailable = false }) {
  const li = el("li", "cell version-row");
  if (unavailable) li.classList.add("unavailable");
  const inner = el(onClick ? "button" : "div", "cell-inner");
  if (onClick) { inner.type = "button"; inner.addEventListener("click", onClick); }
  const top = el("div", "version-top");
  top.append(el("span", "cell-label", label));
  for (const t of tags) top.append(el("span", "version-tag", t));
  if (detail) top.append(el("span", "cell-detail", detail));
  inner.append(top);
  if (sub) inner.append(el("span", "version-sub", sub));
  if (notes) inner.append(el("p", "version-notes", notes));
  li.append(inner);
  return li;
}

// The title of a Version History version's sheet (altstore.js installRows' rows). The sideloader line only fits when
// no row installs it here: an Install (iFizBox signs it with your certificate, the jailbreak installs it, the website
// signs it, or the source's own signed link) or a Custom Install says otherwise, so the name and version stand alone.
export function versionSheetTitle(name, version, rows, options = {}) {
  const title = `${name} ${version}`;
  const installsHere = options.itms || rows.some((r) => r.label !== "Download IPA");
  return installsHere ? title : `${title}\nA sideloader signs it on the iPhone with your Apple ID.`;
}

function versionsGroup(cells, footer) {
  const g = el("div", "group");
  const ul = el("ul", "table grouped versions");
  ul.append(...cells);
  g.append(ul);
  if (footer) g.append(el("p", "group-footer", footer));
  return g;
}

// The Version History page. APT: every version any source offers, newest first, with the sources that carry it;
// tapping one offers installing it (N4's queue: Downgrade) or, on the site, its .deb. AltStore: every versions[]
// entry with its date, size, iOS range and notes; one this iPhone runs installs from its own row when it has an
// IPA (or a signed link); the others are greyed.
async function renderVersions(body, route, key, id) {
  body.append(placeholder("page"));
  let history, pkg, sources;
  try {
    await catalog.ensure();
    [history, pkg, sources] = await Promise.all([catalog.history(id, key), catalog.package(id, key), getBackend().sources()]);
  } catch (e) {
    body.replaceChildren(note(e.message));
    return;
  }
  if (!history || !pkg) {
    body.replaceChildren(grouped([{ rows: [{ label: "Package not found" }], footer: id }]));
    return;
  }
  const sourceLabel = (k) => { const s = sources.find((x) => x.key === k); return s ? displayName(s) : k; };
  body.replaceChildren();
  if (history.kind === "ipa") {
    const source = sources.find((s) => s.key === history.key);
    const cells = history.versions.map((v) => {
      const can = v.runs && v.installable;
      return versionCell({
        label: `Version ${v.version}${v.buildVersion ? ` (${v.buildVersion})` : ""}`,
        tags: v.candidate ? ["Latest"] : [],
        detail: formatDate(v.date),
        sub: [formatSize(v.size), v.runs ? osRange(v) : `Needs ${osRange(v) ?? "another iOS version"}`].filter(Boolean).join(" · ") || null,
        notes: v.localizedDescription || null,
        unavailable: !can,
        onClick: can ? async () => {
          const record = recordApp(pkg, source, v);
          // F85: Install and Custom Install go through the queue (Confirm) like the app page's (F84): that version's job.
          // Where Custom Install is on offer (the sideload app) the sheet comes first so it can be picked; elsewhere a
          // tap queues the version, or (no queue: the jailbreak build, no certificate) does what it did before.
          const queued = detectMode() !== "jailbreak";
          const queue = queued ? () => appPageAction(pkg, source, { version: v.version }) : null;
          const customize = queued ? (o) => appPageCustom(pkg, source, o, { version: v.version }) : null;
          const customOffered = localSigning() && !ipaInstallAvailable();
          if (queue && !customOffered && await queue()) return;
          if (!customOffered && await signIfReady(pkg.stanza.ipa ?? { name: history.name, sourceUrl: history.sourceUrl }, v, record)) return;
          const { rows, options } = installRows(v, history.sourceUrl, undefined, record, queue, history.name,
            { ...(customize ? { customize } : {}), bundleId: appBundleId(pkg.stanza.ipa, history.id) });
          sheet(versionSheetTitle(history.name, v.version, rows, options),
            rows.map((r) => ({ label: r.label, run: r.onClick })));
        } : null,
      });
    });
    const off = history.versions.filter((v) => !(v.runs && v.installable)).length;
    body.append(versionsGroup(cells, `Every version ${history.name}'s source lists.${off ? " Greyed ones don't run on this iPhone or have no download." : ""}`));
    return;
  }
  const st = pkg.stanza;
  const site = getBackend().kind === "http";
  const installed = installedOf(history);
  const queue = queueOf({ installed, name: history.name });
  // B11: a paid package its vendor sells only installs through its page's Download & Install, never apt.
  const vendorPaid = queue && isPaid(st) ? await soldByVendor(st, sources.find((s) => s.key === pkg.key)) : false;
  const cells = history.versions.map((v) => {
    const tags = [];
    if (v.candidate) tags.push("Latest");
    if (v.installed) tags.push("Installed");
    const actions = [];
    if (queue && !vendorPaid && v.keys.length) {
      const label = v.version === installed ? "Reinstall" : installed && compareVersions(v.version, installed) < 0 ? "Downgrade" : "Install";
      actions.push({ label, run: () => queue({ op: "install", id, version: v.version }) });
    }
    if (site && v.debUrl && !isPaid(st)) actions.push({ label: "Download .deb", run: () => downloadDeb(v.debUrl, id) });
    return versionCell({
      label: v.version, tags,
      detail: formatSize(v.size),
      sub: v.keys.length ? v.keys.map(sourceLabel).join(", ") : "No source offers it any more",
      unavailable: !v.keys.length,
      onClick: actions.length ? () => sheet(`${history.name} ${v.version}`, actions) : null,
    });
  });
  const how = vendorPaid ? "It's sold by its source: install it with Download & Install on its page." : queue ? "Tap one to install it." : site ? "Tap one for its .deb. Installing an older one is Downgrade, in the jailbreak app." : "Installing an older one is Downgrade, which comes with the install queue.";
  body.append(versionsGroup(cells, `Every version of ${history.name} your sources offer. ${how}`));
}

// The nav bar's right button on this page (Install / Modify): its page handle's (F76: not the Share icon).
function setRightLabel(body, label) {
  const b = handleOf(body)?.rightButton();
  if (b && b.textContent !== label) b.textContent = label;
}

// F87: in the jailbreak app, an app iFizBox remembers (core/installed.js) at the version on the phone, with I4's note
// where that isn't the one it remembered ("Installed: 1.6 (iFizBox remembered 1.5)", "Not installed (...)").
// Null when iFizBox doesn't remember the app.
async function installedAppGroup(id, { records = () => rememberedApps({ mode: "jailbreak" }) } = {}) {
  let rec;
  try { rec = (await records()).find((r) => r?.id === id && !r.self); } catch { return null; }
  return rec ? grouped([installedAppSection(rec)]) : null;
}

export function installedAppSection(rec) {
  const version = rec.actual === null ? "Not Installed" : rec.version || "Unknown";
  return { header: "Installed App", rows: [{ label: "Version", detail: version }], footer: rec.note || null };
}

// F314: Installed Package in the iOS 6 hint style (AGENTS.md, Hints): Version alone (a status row, no footer), then
// each switch in a group of its own with its own footer. `dpkgHeld`: a hold set on the phone (the site's uploaded
// status file), shown and not switchable, so its footer says what holds it and where to change it.
export const IGNORE_UPGRADES_FOOTER = "Leaves this package out of Upgrade All.";
export const DPKG_HELD_FOOTER = "Held on the phone, so Upgrade All leaves it out. Release the hold there to change it.";
export const AUTO_UPDATE_FOOTER = "Installs its updates by itself.";
export function installedSections({ version, dpkgHeld = false, mark = false }) {
  return [
    { header: "Installed Package", rows: [{ label: "Version", detail: version }] },
    { rows: [{ label: "Ignore Upgrades", detail: dpkgHeld ? "Held by dpkg" : null }],
      footer: dpkgHeld ? DPKG_HELD_FOOTER : IGNORE_UPGRADES_FOOTER },
    ...(mark ? [{ rows: [{ label: AUTO_MARK_LABEL }], footer: AUTO_UPDATE_FOOTER }] : []),
  ];
}

// F314: a paid package on the site: no Download .deb (the repo refuses the proxy), the row greyed with the footer
// saying where it installs instead. A group of its own with a row, so its hint isn't glued to the footer under it.
export const PAID_DEB_FOOTER = "A paid package: buy and install it from a package manager on the phone.";
export const paidDebSection = () => ({ rows: [{ label: "Download .deb", detail: "Paid", cls: "deb-paid" }], footer: PAID_DEB_FOOTER });

// Installed Package (F7, Cydia's Installed Details): the version on the device and the Ignore Upgrades switch
// (Settings' Ignored Upgrades; in the app a dpkg hold, core/settings.js holds). Null when it isn't installed.
// F350: `version: false` leaves out the Installed Package / Version group (Change Package Settings: the switches only).
async function installedGroup(id, { version = true } = {}) {
  let rows;
  try { rows = await catalog.installed(); } catch { return null; }
  const p = rows?.find((r) => r.id === id);
  if (!p) return null;
  // On the site a hold in the uploaded status file is dpkg's, set on the phone: shown, not switchable here.
  const dpkgHeld = p.held && catalog.statusSource() !== "native";
  const mark = autoMarkShown(settings); // F70: Update Automatically, for Only Packages I Mark
  const frag = grouped(installedSections({ version: p.version, dpkgHeld, mark }).slice(version ? 0 : 1));
  const at = version ? 1 : 0; // the Ignore Upgrades cell
  if (!dpkgHeld) {
    // grouped() draws plain rows; the switch goes into its cell afterwards, as on the Settings tab.
    const cell = frag.querySelectorAll(".cell-inner")[at];
    cell.append(createSwitch({ label: "Ignore Upgrades", checked: settings.holds.has(id), onToggle: (on) => { settings.holds.set(id, on); } }));
    cell.classList.add("has-switch");
  }
  if (mark) {
    const cell = frag.querySelectorAll(".cell-inner")[at + 1];
    cell.append(createSwitch({ label: AUTO_MARK_LABEL, checked: settings.autoMarked.has(id), onToggle: (on) => { settings.autoMarked.set(id, on); } }));
    cell.classList.add("has-switch");
  }
  return frag;
}

// F18: the package's dependency problems (core/deps.js explain), each sentence in a cell of its own with its
// action under it: Add <source>, Remove <package> (through N4's queue where the backend has one, else its page),
// Open <package>, or Settings' iOS Version. The firmware explanation goes in the footer.
function depProblemsGroup(report, route, ctx) {
  const frag = document.createDocumentFragment();
  const blocking = report.problems.some((p) => p.blocking);
  report.problems.forEach((p, i) => {
    const g = el("div", "group deps-problem");
    if (i === 0) g.append(el("h2", "group-header", blocking ? "Can't Install Yet" : "Before Installing"));
    // One table: the sentence in a wrapping cell, the action row under it.
    const row = depActionRow(p, route, ctx);
    const ul = row ? grouped([{ rows: [row] }]).firstElementChild.querySelector("ul") : el("ul", "table grouped");
    const li = el("li", "cell");
    li.append(el("div", "pkg-description", p.sentence));
    ul.prepend(li);
    g.append(ul);
    if (p.detail) g.append(el("p", "group-footer", p.detail));
    frag.append(g);
  });
  return frag;
}

function depActionRow(p, route, ctx) {
  const a = p.action;
  if (!a) return p.id && p.id !== "firmware" && p.kind !== "missing" ? { label: p.id, href: deeper(route, token("package", p.id)) } : null;
  switch (a.kind) {
    case "open": return { label: a.label, href: deeper(route, token("package", a.id)) };
    case "add-source": return { label: a.label, subtitle: a.url, chevron: true, onClick: () => loadLazy("manage").then((m) => m.addSource(ctx, { url: a.url })) };
    case "settings": return getBackend().kind === "http" ? { label: a.label, href: format(settingsRoute(["iosVersion"])) } : null;
    case "remove": {
      const q = queueOf();
      if (q) return { label: a.label, onClick: () => q({ op: "remove", id: a.id }) };
      return { label: a.label.replace(/^Remove /, "Open "), href: deeper(route, token("package", a.id)) };
    }
    default: return null;
  }
}

function downloadGroup(st) {
  const url = st.debUrl;
  const file = decodeURIComponent(url.split("/").pop() || `${st.package}.deb`);
  const g = grouped([{ rows: [{ label: "Download .deb", subtitle: file, href: getBackend().assetUrl(url), chevron: false }],
    footer: "Fetched through this site, for installing by hand." }]);
  const a = g.querySelector("a.cell-inner");
  a.setAttribute("download", file.endsWith(".deb") ? file : `${file}.deb`);
  a.classList.add("download");
  return g;
}

// `json`: the page's own fetch of it (F181: shared with the stars, What's New and Reviews), else fetched here.
async function loadSileo(slot, url, { fallback, json: fetched = null }) {
  slot.append(spinner("Loading Depiction"));
  try {
    const json = fetched ? await fetched : JSON.parse(await getBackend().text(url));
    if (!json) throw new Error("no depiction");
    const dep = renderSileo(json, { open: (u, title) => openSileoSheet(u, title) });
    const g = el("div", "group");
    const t = el("div", "table grouped dep-card");
    t.append(dep);
    g.append(t);
    slot.replaceChildren(g);
    return json; // F122: its screenshots and links go to the gallery and the Links group
  } catch {
    // A dead or broken JSON depiction: show the description instead, as if there were none.
    slot.replaceChildren();
    if (fallback) slot.append(descriptionGroup(fallback)); // F165
    return null;
  }
}

function openSileoSheet(url, title) {
  const box = el("div", "sheet-scroll grouped page-body");
  box.append(spinner("Loading Depiction"));
  showSheet({ title: title || "Depiction", body: box });
  getBackend().text(url).then((t) => {
    const g = el("div", "group");
    const card = el("div", "table grouped dep-card");
    card.append(renderSileo(JSON.parse(t), { open: openSileoSheet }));
    g.append(card);
    box.replaceChildren(g);
  }).catch((e) => box.replaceChildren(note(e.message)));
}

// HTML depictions open in a sheet, in a sandboxed iframe (docs/cydia.md). The sandbox keeps it off our origin and
// storage but not off the bridge: WebKit shows window.webkit.messageHandlers to every frame, so the app's Bridge.swift
// (fromApp) refuses any call that isn't from the main frame on ifizbox://app. Never add allow-same-origin.
// B365: the page is fetched first (the proxy on the site, the shell in the app), and depictionView picks how it shows,
// so the sheet is never left white: the live page, the page's own HTML with scripts off, or Open in Safari.
export function openHtmlDepiction(url, title, { backend = getBackend(), open = openOutside } = {}) {
  const box = el("div", "sheet-scroll grouped page-body");
  box.append(spinner("Loading Depiction"));
  const sheet = showSheet({ title, body: box });
  const mixed = globalThis.location?.protocol === "https:" && /^http:/i.test(url) && backend.kind === "http";
  const outside = (text) => {
    box.replaceChildren(note(text), grouped([{ rows: [{ label: "Open in Safari", chevron: true, onClick: () => open(url) }] }]));
  };
  const frame = (live, html) => {
    const f = document.createElement("iframe");
    f.className = "depiction-frame";
    f.title = title;
    f.referrerPolicy = "no-referrer";
    f.setAttribute("sandbox", live ? "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms"
      : "allow-popups allow-popups-to-escape-sandbox");
    if (live) f.src = url; else f.srcdoc = withBase(html, url);
    box.replaceWith(f);
  };
  Promise.resolve().then(() => backend.fetch(url)).then(async (res) => {
    const html = await res.text();
    const headers = backend.kind === "http" ? proxiedFraming(res.headers) : res.headers;
    const view = depictionView({ html, headers, mixed, origin: globalThis.location?.origin });
    if (!box.isConnected) return;
    if (view === "refused") outside(`${hostOf(url)} doesn't let its depiction open inside ${NAME}.`);
    else frame(view === "live", html);
  }).catch((e) => { if (box.isConnected) outside(e?.message || String(e)); });
  return sheet;
}

const openOutside = (url) => window.open(url, "_blank", "noopener"); // LinkOut in the shell, a new tab on the site
const hostOf = (url) => { try { return new URL(url).host; } catch { return url; } };

// B365: how a fetched HTML depiction shows.
//   "refused": the host forbids framing (X-Frame-Options, or a CSP frame-ancestors that leaves us out; the app sees
//              the headers, the site reads them from the proxy's X-Upstream-* ones, proxiedFraming), so Open in
//              Safari instead of a white frame;
//   "static":  the page's own HTML in srcdoc with scripts off: an http page on the https site (mixed content), or a
//              page whose scripts can't run in the sandbox's opaque origin anyway (module or crossorigin scripts need
//              CORS, which a host rarely grants origin null: Havoc's Next.js depictions), and that has text to show;
//   "live":    everything else loads from its own URL with scripts on (jQuery-era depictions read location).
export function depictionView({ html = "", headers = null, mixed = false, origin = "" } = {}) {
  if (framingRefused(headers, origin)) return "refused";
  if (mixed) return "static";
  return corsScripts(html) && visibleText(html).length >= 40 ? "static" : "live";
}

const header = (headers, name) => (typeof headers?.get === "function" ? headers.get(name) : headers?.[name]) ?? null;

// X-Frame-Options or CSP frame-ancestors (which wins when both are there) that keep the page out of a frame on
// `origin` (https://ifizbox.com on the site, ifizbox://app in the app; never the depiction's own origin).
export function framingRefused(headers, origin = "") {
  const csp = String(header(headers, "content-security-policy") ?? "");
  // Several policies (comma-joined headers) each have to let us in.
  const ancestors = csp.split(/[,;]/).map((d) => d.trim().split(/\s+/)).filter((d) => d[0]?.toLowerCase() === "frame-ancestors");
  if (ancestors.length) return ancestors.some((d) => !d.slice(1).some((s) => sourceMatches(s, origin)));
  const xfo = String(header(headers, "x-frame-options") ?? "").trim().toLowerCase();
  return xfo !== "" && xfo !== "allowall";
}

// F383: the site's proxy (/api/fetch, worker/src/index.js upstreamFraming) hands the page's framing headers on under
// names of its own, X-Upstream-Frame-Options and X-Upstream-Frame-Ancestors (one comma-separated source list per
// policy); its own Content-Security-Policy is the proxy's, never the page's. Turned back into the page's headers here.
export function proxiedFraming(headers) {
  const out = {};
  const xfo = header(headers, "x-upstream-frame-options");
  if (xfo) out["x-frame-options"] = xfo;
  const lists = header(headers, "x-upstream-frame-ancestors");
  if (lists) out["content-security-policy"] = String(lists).split(",").map((l) => `frame-ancestors ${l.trim()}`).join(", ");
  return out;
}

function sourceMatches(src, origin) {
  const s = src.toLowerCase();
  if (s === "*") return true;
  let o;
  try { o = new URL(origin); } catch { return false; }
  if (/^[a-z][a-z0-9+.-]*:$/.test(s)) return s === o.protocol;
  const m = s.match(/^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([^/:]+)(?::(\d+|\*))?/);
  if (!m) return false;
  const [, scheme, wild, host, port] = m;
  if (scheme && `${scheme}:` !== o.protocol) return false;
  if (!scheme && o.protocol !== "https:" && o.protocol !== "http:") return false;
  if (port && port !== "*" && port !== o.port) return false;
  return wild ? o.hostname.endsWith(`.${host}`) : o.hostname === host;
}

// Scripts with a src that load in CORS mode: type="module", or a crossorigin attribute.
export const corsScripts = (html) =>
  /<script\b(?=[^>]*\ssrc\s*=)(?=[^>]*\s(type\s*=\s*["']?module["'\s>]|crossorigin(?=[\s=>/])))[^>]*>/i.test(String(html));

// The page's text with its head, scripts, styles and tags taken out: an app shell with nothing in it has none.
export function visibleText(html) {
  return String(html).replace(/<head\b[\s\S]*?<\/head>/gi, " ").replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ").replace(/&[#a-z0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Relative links and images in a proxied depiction resolve against its real URL; links open outside the sheet.
export function withBase(html, url) {
  const base = `<base href="${escapeHtml(url)}" target="_blank">`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + base) : base + html;
}

// ---- Browse (F154) -----------------------------------------------------------------------------------------
//
// Home's Browse page, rebuilt from the approved concept (docs/concepts/browse/browse.dc.html): Featured | New | Top 25
// as a segmented control in a bar at the top of the page, as iOS 6 puts one under the nav bar (in the title's place it
// overlapped Back; a title drop-down isn't iOS 6, user 2026-11-18). Featured: the Tweak of the Day card, the Tweak Roulette row, New This Week, Collections, All Categories.
// New: F124's New list; Top 25: F124's Popular, ranked. No horizontal scroller. Placeholders while loading.
// home.js routes browse/ here (and the pages below it: collection:<id>, categories, roulette).

export const BROWSE_FILTERS = [
  { id: "featured", label: "Featured" },
  { id: "new", label: "New" },
  { id: "top", label: "Top 25" },
];
export const browseFilter = (id) => BROWSE_FILTERS.find((f) => f.id === id) ?? BROWSE_FILTERS[0];
export const TOP_LIMIT = 25;
export const WEEK_DAYS = 7;
const SECTION_ICON = (name) => `icons/sections/${name}.png`;

// The choice and the page on screen. B43: each Browse page keeps its own choice (page.filter), so Back finds it as it
// was left; a Browse page pushed again (from Home or anywhere) opens on Featured (nav/pagestate.js).
const browseHome = { filter: "featured", page: null };
export const browseFilterNow = () => browseHome.filter;
export const isBrowseHome = (route) => route.tab === "home" && route.path.length === 1 && route.path[0] === "browse";
onPageOpen(isBrowseHome, () => { browseHome.filter = BROWSE_FILTERS[0].id; });

// The Browse page's nav bar: "Browse" (also the back button of the pages above it).
export function browseHomeNav() {
  return { title: "Browse" };
}

// The bar at the top of the page: Featured | New | Top 25 (Search's scope bar and segments).
function filterBar(page) {
  const bar = el("div", "search-scope browse-scope");
  bar.append(segments(BROWSE_FILTERS.map((f) => f.id), Object.fromEntries(BROWSE_FILTERS.map((f) => [f.id, f.label])),
    page.filter, (id) => setBrowseFilter(id, page)));
  return bar;
}

// Shows filter `id` (unknown ids: Featured) on `page` (the last Browse page drawn): it redraws in place, its bar
// showing the choice.
export function setBrowseFilter(id, page = browseHome.page) {
  const f = browseFilter(id);
  browseHome.filter = f.id;
  if (page) {
    page.filter = f.id;
    browseHome.page = page;
    if (page.body.isConnected) drawBrowseHome(page);
  }
  return f.id;
}

// What each filter draws: the rows' source and how they read. Top 25 is ranked (rank on every row).
export function filterView(id, { fresh, popular }) {
  const f = browseFilter(id);
  if (f.id === "new") return { id: "new", rows: () => fresh("new"), ranked: false, empty: "Nothing new lately. Packages your sources add show up here after a refresh." };
  if (f.id === "top") return { id: "top", rows: async () => (await popular({ limit: TOP_LIMIT })).slice(0, TOP_LIMIT), ranked: true,
    empty: "Add a source to see what's popular.", footer: "Ranked by how many of your sources list each package." };
  return { id: "featured" };
}

// `opts`: { jailbroken, featured: () => rows (the sources' featured packages), headers: rows -> items (New's days) }.
export function renderBrowseHome(body, route, opts = {}) {
  const page = { body, route, turn: 0, list: null, filter: browseHome.filter, ...opts };
  browseHome.page = page;
  return drawBrowseHome(page);
}

function drawBrowseHome(page) {
  const turn = ++page.turn;
  page.list?.destroy();
  page.list = null;
  const { body } = page;
  const featured = page.filter === "featured";
  body.classList.toggle("grouped", featured);
  body.classList.toggle("plain", !featured);
  page.bar = filterBar(page);
  body.replaceChildren(page.bar);
  body.scrollTop = 0;
  return featured ? drawFeatured(page, turn) : drawFilterList(page, turn);
}

async function drawFilterList(page, turn) {
  const { body, route } = page;
  const v = filterView(page.filter, { fresh: catalog.fresh, popular: catalog.popular });
  body.append(placeholder("list", 8));
  let rows;
  try {
    await catalog.ensure();
    rows = await v.rows();
  } catch (e) {
    if (turn === page.turn) body.replaceChildren(page.bar, note(e.message));
    return;
  }
  if (turn !== page.turn || !body.isConnected) return;
  body.replaceChildren(page.bar);
  if (!rows.length) { body.append(note(v.empty)); return; }
  const items = v.ranked ? rows.map((r, i) => ({ ...r, rank: i + 1 })) : page.headers ? page.headers(rows) : rows;
  page.list = packageList(body, route, items, { letters: false, decorate: v.ranked ? rankRow : null });
  page.list.el.classList.add(v.ranked ? "browse-ranked" : "browse-new");
  body.append(page.list.el);
  if (v.footer) body.append(el("p", "browse-list-footer", v.footer));
}

// Top 25: the rank at the row's left (packages.css .pkg-rank).
function rankRow(row, item) {
  let r = row._.rank;
  if (!r) { r = row._.rank = el("span", "pkg-rank"); row._.a.prepend(r); }
  r.textContent = item.rank ? String(item.rank) : "";
}

const pkgHref = (route, id) => format({ tab: route.tab, path: [...route.path, token("package", id)] });

async function drawFeatured(page, turn) {
  const { body, route } = page;
  const jailbroken = page.jailbroken ?? true;
  const heroSlot = el("div", "browse-hero-slot");
  heroSlot.append(heroCard(null, { jailbroken }));
  const freshGroup = el("div", "group browse-fresh");
  const head = el("h2", "group-header browse-head");
  const seeAll = el("button", "browse-see-all", "See All");
  seeAll.type = "button";
  seeAll.addEventListener("click", () => setBrowseFilter("new"));
  head.append(el("span", null, "New This Week"), seeAll);
  const freshList = el("ul", "table grouped");
  freshList.append(...phCells(3));
  freshGroup.append(head, freshList);
  const roulette = grouped([rouletteRow({ jailbroken, streak: currentStreak(readSpins(), dayKey()) })]);
  for (const g of roulette.children) g.classList.add("browse-roulette");
  const collections = grouped([{ header: "Collections", rows: collectionsFor(jailbroken).map((c) => ({
    label: c.title, subtitle: c.subtitle, href: format({ tab: route.tab, path: [...route.path, `collection:${c.id}`] }),
    icon: { src: SECTION_ICON(c.icon) }, cls: "browse-icon-row" })) }]);
  const all = grouped([{ rows: [{ label: "All Categories", href: format({ tab: route.tab, path: [...route.path, "categories"] }) }] }]);
  body.append(heroSlot, roulette, freshGroup, collections, all);

  let popular = [], featured = [], fresh = [];
  try {
    await catalog.ensure();
    [popular, featured, fresh] = await Promise.all([
      catalog.popular({ limit: 60 }).catch(() => []),
      (page.featured ? page.featured() : Promise.resolve([])).catch(() => []),
      catalog.fresh("new").catch(() => []),
    ]);
  } catch (e) {
    if (turn === page.turn) heroSlot.replaceChildren(note(e.message));
  }
  if (turn !== page.turn || !body.isConnected) return;
  // Tweak of the Day: the sources' featured packages and the popular ones, of this build's kind when there are any.
  const pool = [...featured, ...popular];
  const kind = pool.filter((r) => browseKind(r, jailbroken));
  const pick = dailyPick(kind.length ? kind : pool, dayKey());
  heroSlot.replaceChildren(pick ? heroCard(pick, { jailbroken, href: pkgHref(route, pick.id) }) : "");
  if (pick) rememberNames([pick]);
  const week = fresh.filter((r) => r.seen >= Date.now() - WEEK_DAYS * 86400000).slice(0, 3);
  rememberNames(week);
  if (week.length) freshList.replaceChildren(...week.map((r) => pkgCell(r, pkgHref(route, r.id))));
  else {
    freshList.remove();
    freshGroup.append(el("p", "group-footer", "Nothing new this week. New packages show up here after a refresh."));
  }
}

// Grey pulsing rows the shape of a package cell (nav/ui.js placeholder's look), for a grouped table.
function phCells(n) {
  return Array.from({ length: n }, (_, i) => {
    const li = el("li", "cell");
    const inner = el("div", "cell-inner browse-ph");
    const lines = el("span", "ph-lines");
    lines.append(el("span", `ph-bar ${["ph-w50", "ph-w35", "ph-w60"][i % 3]}`), el("span", "ph-bar ph-sub ph-w70"));
    inner.append(el("span", "ph-box ph-icon"), lines);
    li.append(inner);
    return li;
  });
}

// A package as a grouped cell: its icon (the section's until its own loads), name, short description, chevron.
function pkgCell(row, href) {
  const li = el("li", "cell browse-icon-row");
  const a = el("a", "cell-inner chevron");
  a.href = href;
  a.append(iconBox(row, "cell-icon"));
  const text = el("span", "cell-text");
  text.append(el("span", "cell-label", row.name), el("span", "cell-subtitle", row.short || row.section || ""));
  a.append(text);
  li.append(a);
  return li;
}

// The package's icon over its section's (core/sectionicons.js packageIcon), dropped when it fails to load.
export function iconBox(row, cls) {
  const look = packageIcon(row);
  const box = el("span", cls);
  box.style.backgroundImage = `url("${look.fallback}")`;
  const src = iconSrc(row);
  if (src) {
    const img = el("img");
    img.alt = "";
    img.decoding = "async";
    img.onload = () => img.classList.add("loaded");
    img.onerror = () => img.remove();
    img.src = src;
    box.append(img);
  }
  return box;
}

// The banner's tint: one of a few deep iOS 6 hues, picked by the package id so a package keeps its colour.
// ponytail: hashed, not sampled from the icon (icons are cross-origin; a canvas read would taint). Sample if it matters.
const HERO_TINTS = [["#6b3fbf", "#3a1d7a"], ["#3f6fc4", "#1f3f80"], ["#2f8f8a", "#155552"], ["#c0443a", "#7a1d16"],
  ["#c9772a", "#80420f"], ["#5a6b82", "#2e3a4b"], ["#3f9a3f", "#1d5c1d"]];
export function heroTint(id) {
  let h = 0;
  for (const c of String(id ?? "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return HERO_TINTS[h % HERO_TINTS.length];
}

// The store's price button (iOS 6 App Store): FREE, or VIEW for a paid package (the price is on its page).
export const storeLabel = (row) => (row.paid ? "VIEW" : "FREE");

// The Tweak of the Day card (null: its placeholder while the lists load). The whole card opens the package.
export function heroCard(row, { jailbroken = true, href = null } = {}) {
  const card = el(row ? "a" : "div", "browse-hero");
  if (!row) { card.classList.add("is-loading"); card.setAttribute("aria-busy", "true"); card.setAttribute("aria-label", "Loading"); }
  const words = el("span", "browse-hero-words");
  words.append(el("span", "browse-hero-kicker", jailbroken ? "TWEAK OF THE DAY" : "APP OF THE DAY"));
  const foot = el("span", "browse-hero-foot");
  if (row) {
    card.href = href;
    const [a, b] = heroTint(row.id);
    card.style.setProperty("--hero-a", a);
    card.style.setProperty("--hero-b", b);
    card.append(iconBox(row, "browse-hero-icon"));
    words.append(el("span", "browse-hero-name", row.name), el("span", "browse-hero-desc", row.short || ""));
    foot.append(el("span", "browse-hero-meta", [row.author, row.section].filter(Boolean).join(" · ")), el("span", "store-btn", storeLabel(row)));
  } else {
    card.append(el("span", "browse-hero-icon ph-box"));
    words.append(el("span", "ph-bar ph-w60"), el("span", "ph-bar ph-sub ph-w70"));
  }
  words.append(foot);
  card.append(words);
  return card;
}
