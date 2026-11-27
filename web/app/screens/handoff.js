// "Open in" (F8): a grouped section on a source's page and a package's page with one row per package manager that
// takes that format (core/handoff.js builds the links), and a QR code of iFizBox's /add link for adding the source
// from another device. Since F76 only an APT package's page keeps the group; a source's page and an app's page
// have Share in the nav bar instead (shareItems below). In the jailbreak app the real install queue takes this
// place (N4).
import { grouped } from "../nav/ui.js";
import { showSheet } from "../nav/sheet.js";
import { qrSvg } from "../core/qr.js";
import { sourceLinks, packageLinks, addLink, appLink, siteOrigin, formatOf, isIpaFormat } from "../core/handoff.js";
import { settings } from "../settings-store.js";
import { detectMode } from "../core/settings.js";
import { showShareSheet, setShare } from "../nav/sharesheet.js";
import { showHUD } from "../nav/hud.js";
import { appIcon, loadAppIcons } from "../app-icons.js";
import { NAME } from "../brand.js";
import { getBackend } from "../backend.js";

// pkg: an id for a package's page; leave it out on a source's page.
// Only the visitor's format: APT managers run on jailbroken iPhones, so a phone set to Not Jailbroken (Settings >
// Device, F37) sees just the add link for an APT source; IPA sources (AltStore, ESign, Scarlet, GBox: F50) show the
// apps that read their format to everyone.
export function openInGroup(source, { pkg = null, jailbroken = settings.jailbroken(), mode = detectMode() } = {}) {
  // F219: the jailbreak build's package page has no Open In group: the managers this phone has are in its Share sheet
  // (screens/browse.js packageShareItems, installedManagers below).
  if (pkg && mode === "jailbreak") return document.createDocumentFragment();
  const apt = formatOf(source) === "apt";
  // An app's page has no Open In group: its Install group installs it (the user's certificate in the sideload app;
  // on the website, Install with the certificate alert until F93, F92) or Download IPA keeps the file (user 2026-11-17).
  const appPage = pkg && isIpaFormat(formatOf(source));
  const links = appPage || (apt && !jailbroken) ? [] : pkg ? packageLinks(pkg, source) : sourceLinks(source);
  const add = addLink(source, siteOrigin(globalThis.location));
  if (!links.length && !add) return document.createDocumentFragment();
  const rows = links.map((l) => ({ label: `Open in ${l.app}`, onClick: () => { location.href = l.url; } }));
  if (add) rows.push({ label: "Add on Another Device", onClick: () => showAddQR(add) });
  return grouped([{ header: "Open In", rows, footer: footerFor(source, pkg, links.length) }]);
}

function footerFor(source, pkg, shown) {
  if (!shown) return undefined; // F144: no hint pointing at Settings > Device
  if (isIpaFormat(formatOf(source))) {
    return pkg ? "Adds this app's source to that app, where it can install it." : "Adds this source to that app.";
  }
  const flat = !source.dist || String(source.dist).endsWith("/");
  if (pkg) {
    return flat ? "Sileo and Irisin open the package once its source is added there. Cydia and Zebra add the source on the way."
      : "Each opens the package once its source is added there.";
  }
  return flat ? "Adds this source to that app." : "Only Irisin takes a source with a suite; the others add flat repos only.";
}

function showAddQR(link) {
  let svg;
  try {
    svg = qrSvg(link, { ecc: "M" });
  } catch {
    return; // a source URL is far under a QR code's limit; nothing to show if it isn't
  }
  const box = document.createElement("div");
  box.className = "sheet-scroll page-body grouped manage-qr handoff-qr"; // manage.css draws the code
  const img = new Image();
  img.alt = "QR code of the add link";
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  const note = document.createElement("p");
  note.className = "group-footer";
  note.textContent = `Scan it with the other phone's Camera: ${NAME} opens with Add Source filled in.`;
  const url = document.createElement("p");
  url.className = "group-footer handoff-link";
  url.textContent = link;
  box.append(img, note, url);
  showSheet({ title: "Add Source", body: box });
}

// ---- Share (F76): the nav bar's Share button on a source's page and an app's page ---------------------------------
//
// The iOS 6 share sheet (nav/sharesheet.js) takes the Open In group's place there: Copy Link (the source's URL), Add
// on Another Device (the QR code of the /add link), then the apps that take the source (core/handoff.js
// sourceLinks), under the same rule as openInGroup: APT managers only for a phone set to Jailbroken. An app's page
// lists them too: they add its source to that app (iFizBox's own Install stays the way to install it here).

// Each app's tile: its real icon once app-icons.js has fetched it, until then (and for apps without one) its initial on
// a colour close to its icon's.
export const APP_TILES = {
  Cydia: { letter: "C", color: "#8b5a2b" },
  Sileo: { letter: "S", color: "#5e5ce6" },
  Zebra: { letter: "Z", color: "#2b2b2e" },
  Irisin: { letter: "I", color: "#7d4fd0" },
  "AltStore Classic": { letter: "A", color: "#0f8c78" },
  AltStore: { letter: "A", color: "#1cc0a0" },
  SideStore: { letter: "S", color: "#8445e8" },
  Feather: { letter: "F", color: "#e2547c" },
  LiveContainer: { letter: "L", color: "#2f7cf6" },
  StikStore: { letter: "S", color: "#f08a24" },
  TrollApps: { letter: "T", color: "#d63f8c" },
  Scarlet: { letter: "S", color: "#c8102e" },
  ESign: { letter: "E", color: "#2a6be0" },
  GBox: { letter: "G", color: "#22a45d" },
};
// F194: the sideload tools (every app that takes an IPA source). The jailbreak build's sheet leaves them out: it will
// likely never use them (user 2026-11-18); the sideload IPA and the website keep them.
export const SIDELOAD_TOOLS = new Set(["AltStore Classic", "AltStore", "SideStore", "Feather", "LiveContainer", "StikStore",
  "TrollApps", "Scarlet", "ESign", "GBox"]);

// F219: the APT package managers' bundle IDs, for asking iOS which this phone has (the jailbreak build's package Share).
// Sileo's from its Info.plist on the iPhone 7 (2026-11-18), Irisin's from its Xcode project (Lakr233/Irisin main-4.0).
export const MANAGER_BUNDLES = {
  Cydia: ["com.saurik.Cydia"],
  Sileo: ["org.coolstar.SileoStore", "org.coolstar.SileoNightly"],
  Zebra: ["xyz.willy.Zebra"],
  Irisin: ["wiki.qaq.irisin"],
};

// Pure: the manager names whose bundle IDs the answer marks installed (true only; unknown counts as not there).
export function managersIn(answer) {
  return new Set(Object.entries(MANAGER_BUNDLES).filter(([, ids]) => ids.some((id) => answer?.[id] === true)).map(([app]) => app));
}

// The managers this phone has, asked once through the backend (backend-native.js appsInstalled, cached for the
// session); an empty set where it can't ask (the website, the sideload IPA's older shells).
export async function installedManagers(backend = getBackend()) {
  if (typeof backend?.appsInstalled !== "function") return new Set();
  try { return managersIn(await backend.appsInstalled(Object.values(MANAGER_BUNDLES).flat())); } catch { return new Set(); }
}

const tileOf = (app) =>APP_TILES[app] ?? { letter: app.charAt(0).toUpperCase(), color: "#5a6270" };

// The source's own URL, the one a person would paste into Add Source.
export function sourceUrlOf(source) {
  const u = isIpaFormat(formatOf(source)) ? source?.uri || String(source?.key ?? "").replace(/^alt:/, "") : source?.uri;
  return /^https?:\/\/\S+$/i.test(String(u ?? "")) ? String(u) : null;
}

// Pure: what the sheet lists. [{ kind: "copy", label, text } | { kind: "qr", label, link } | { kind: "open", label,
// url, letter, color }]. app: true on an app's page. mode: "site" | "jailbreak" | "sideload" (core/settings.js
// detectMode); the jailbreak build lists no SIDELOAD_TOOLS (F194).
export function shareItems(source, { app = false, appId = null, jailbroken = settings.jailbroken(), origin = siteOrigin(globalThis.location),
  mode = detectMode() } = {}) {
  if (!source) return [];
  const items = [];
  const url = sourceUrlOf(source);
  if (url) items.push({ kind: "copy", label: "Copy Link", text: url });
  const add = addLink(source, origin);
  if (add) items.push({ kind: "qr", label: "Add on Another Device", link: add });
  // F451: iFizBox's own link: a source's opens iFizBox offering to add it, an app's opens that app's page.
  const own = app ? appLink(appId, origin) : add;
  if (own) items.push({ kind: "link", label: `Share ${NAME} link`, url: own, letter: NAME.charAt(0).toUpperCase(), color: "#2a6be0" });
  // An app's page lists them too (user 2026-11-17): they add the app's source to that app.
  const apt = formatOf(source) === "apt";
  if (apt && !jailbroken) return items;
  for (const l of sourceLinks(source)) if (!(mode === "jailbreak" && SIDELOAD_TOOLS.has(l.app))) items.push({ kind: "open", label: l.app, url: l.url, ...tileOf(l.app) });
  return items;
}

export async function shareLink(url, { nav = globalThis.navigator, copy = copyText } = {}) {
  if (typeof nav?.share === "function") {
    try { await nav.share({ url }); return "shared"; } catch (e) { if (e?.name === "AbortError") return "cancelled"; }
  }
  copy(url);
  return "copied";
}

export function showShareFor(source, opts) {
  const items = shareItems(source, opts).map((it) => {
    if (it.kind === "copy") return { label: it.label, glyph: "copy", onSelect: () => copyText(it.text) };
    if (it.kind === "link") return { label: it.label, letter: it.letter, color: it.color, onSelect: () => shareLink(it.url) };
    if (it.kind === "qr") return { label: it.label, glyph: "qr", onSelect: () => showAddQR(it.link) };
    return { label: it.label, letter: it.letter, color: it.color, image: appIcon(it.label), onSelect: () => { location.href = it.url; } };
  });
  return showShareSheet({ items });
}

// From a page's render: shows the nav bar's Share button (screens' nav() puts nav/sharesheet.js shareButton there)
// once there is something to share.
export function setSourceShare(body, source, opts) {
  const items = source ? shareItems(source, opts) : [];
  setShare(body, items.length ? () => showShareFor(source, opts) : null);
  // The apps' icons, fetched now so they're there by the time Share is tapped (cached after the first time).
  loadAppIcons(items.filter((it) => it.kind === "open").map((it) => it.label));
}

// F194: the Share button on an app page's header (screens/storepage.js storeHeader's `action`), in the spot the App
// Store's price/install button had: the nav bar's action glyph on a bar button. Opens the same sheet. null when there
// is nothing to share.
export function headerShareButton(source, opts) {
  const items = source ? shareItems(source, opts) : [];
  if (!items.length) return null;
  loadAppIcons(items.filter((it) => it.kind === "open").map((it) => it.label));
  return shareHeadButton(() => showShareFor(source, opts));
}

// The bare header Share button (also a tweak page's, screens/browse.js renderPackage).
export function shareHeadButton(onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "bar-button bar-icon share-button store-head-share";
  b.setAttribute("aria-label", "Share");
  b.addEventListener("click", onClick);
  return b;
}

function copyText(text) {
  const ok = () => showHUD("Copying").done("Copied");
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(ok, () => { if (legacyCopy(text)) ok(); });
  } else if (legacyCopy(text)) ok();
}

function legacyCopy(text) {
  const t = Object.assign(document.createElement("textarea"), { value: text, readOnly: true });
  t.style.cssText = "position:fixed;opacity:0;top:0;left:0";
  document.body.append(t);
  t.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { /* not allowed */ }
  t.remove();
  return ok;
}
