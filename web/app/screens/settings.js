// Settings (F13; at the bottom of Home since F123), laid out like iOS 6's Settings app (F128, docs/settings.md):
// the root is one list of short rows (iFizBox Account; General, Theme, Updates; Signing, in the sideload build
// Installation & Signing (F271); Console Logs), each
// opening its own page. The settings' rows come from core/settings.js (which ones this mode shows, defaults,
// storage, which page they're on); this file only draws them:
//   choice  one row per option, the chosen one checked
//   segmented  an iOS 6 segmented control under the group's header (F199: Theme > Mode: Automatic / Light / Dark)
//   toggle  the iOS 6 switch (ios6.css .switch)
//   list    the current value as detail; pushes <page>/<key>, a page of checked options
//   holds   the ignored packages' count; pushes <page>/holds
// F205: rows carry iOS 6 Settings' 29pt tiles (icons/rowicons.js): every root row, and each setting that names a
// thing (SETTING_ICONS); Appearance's choices and plain values stay bare, as iOS 6 leaves them.
// Routes below Settings: <page> (general, theme, updates; "display", Theme's old id, still opens Theme), <page>/<key>, signing[/<key>], account,
// logs[/<id>], and the older <key> and holds, which links from elsewhere use. F183: the root ends with Home's
// version line (version-foot.js); there is no About page and no manual update check (every launch and Reload checks).
// It also owns the theme: init() puts the Appearance setting on <html data-theme> and the theme-color metas, and
// follows the system while Appearance is Automatic. theme-boot.js does the same before first paint.
import { grouped, segmented } from "../nav/ui.js";
import { format, parse, settingsRoute } from "../router.js";
import { settings } from "../settings-store.js";
import { createSwitch } from "../nav/switch.js";
import { detectMode, themeState, paletteFor, DARK_THEME_KEY, SETTINGS, SIGNING_GROUPS } from "../core/settings.js";
import { hooksOf } from "../core/settings.js"; // F202
import { setFloatingTabbar } from "../nav/tabbar.js"; // F203 (app.js loads it at startup already)
import { launchKey } from "../core/settings.js"; // B235
import { showAlert, alertOK } from "../nav/alert.js";
import { showHUD } from "../nav/hud.js";
import { parseProfile, checkP12Password, deviceSummary, deviceError, summary, profileKind, deviceCheck, deviceCheckText } from "../core/signing.js";
import { sortCertFiles, resolvePassword } from "../core/certfiles.js";
import { mod, load } from "../lazy.js";
// F313: the parts below load with Settings' pages (lazy.js; router.js lazyFor SETTINGS_PARTS), not at startup. They
// are only drawn on those pages, so each call reaches its module through mod().
const lazyFn = (name, fn) => (...args) => mod(name)[fn](...args);
const logsSection = lazyFn("queue", "logsSection"), logsPage = lazyFn("queue", "logsPage"), logsTitle = lazyFn("queue", "logsTitle");
const LOGS = "logs"; // queue.js LOGS (#/settings/logs), here so a Settings page's title needs no queue.js
import { loadIdentity, saveIdentity, clearIdentity, getServer, setServer, serverStatus, defaultServer, getBring,
  setBring } from "../signing/identity.js";
import { localSigning, browserSigning } from "../signing/common.js";
import { deviceStatus, importToDevice, removeFromDevice, statusReady } from "../signing/device.js";
import { signAndInstall } from "../signing/install.js";
import { PASSWORD_EVENT } from "../signing/password.js";
import { APP_IPA_URL, APP_NAME } from "../core/appoffer.js";
import { drawWalkthrough, walkOpen, offerInstall, missingStep, siteReady, deviceRows } from "./signing.js";
import { storedUdid, udidPending, startUdid, watchUdid, canFindUdid, udidFindRows, udidPageSections, UDID_PAGE,
  UDID_PAGE_TITLE } from "./signing.js";
const freeRouteBlock = lazyFn("freeAppleId", "freeRouteBlock");
const accountGroup = lazyFn("devaccount", "accountGroup");
const openInAppSection = lazyFn("importlink", "openInAppSection");
const accountSection = lazyFn("account", "accountSection"), drawAccount = lazyFn("account", "drawAccount");
const startAccountSync = () => load("account").then((m) => m.startAccountSync(), () => {}); // at launch, once account.js is in
const signingExtras = lazyFn("signedApps", "signingExtras");
import { syncReminder } from "../core/signing.js";
const websiteSection = lazyFn("websiteSettings", "websiteSection");
const pushActions = lazyFn("pushSettings", "pushActions");
import { whyAboutSection } from "./why.js"; // F306: Settings > About > Why <NAME>, in the installed apps
import { pushRows } from "../core/push.js";
import { versionLines } from "./version-foot.js";
const ipaSection = lazyFn("ipaInstall", "ipaSection");
import { otherLinksOn, setOtherLinks } from "../core/otherlinks.js";
import { NAME, GITHUB_REPO } from "../brand.js";
import { profileNotes, keepOn, GUIDE_LINK } from "../core/keepid.js";
import { keepGuideHref } from "./guide-index.js"; // C32: not guides.js, which loads at #/home/guides
import { rowIcon, SETTING_ICONS, PAGE_ICONS } from "../icons/rowicons.js";
import { drawInstallation, PAGE as INSTALLATION, SUB_TITLES as INSTALLATION_TITLES } from "./installroute.js";
import { installationBlock } from "./installroute.js";
import { ROUTE_KEY } from "../core/installroute.js";
import { mainPage } from "./installroute.js";
import { certificateDetail } from "../core/installroute.js";
import { signedAppRows } from "../core/signing.js";
import { onPageShow, patchDetails, cellsOf } from "../nav/pagestate.js";
import { refreshInstallation } from "./installroute.js";
import { loadStyle, EASE, DURATION } from "../nav/motion.js";
import { APP_ICONS, iconGroups, isOwnIcon } from "../core/settings.js";
import { nativeBridge, hasNativeCall } from "../native.js";
import { nativeIcons, iconSrc, iconOf, iconImage, refreshIcons, tellIcon, clearHere, readIcons } from "../appicon.js";

// F284: Installation & Signing's own sub-pages under signing/ (the main page's Signing rows), sideload build only.
// How Signing Works stays signing/help.
export const SIGNING_SUBS = { certificate: "Certificate", server: "Signing Server", apps: "Signed Apps" };
export const opensSigningSub = ([first, second] = [], on = true) => on && first === "signing" && Boolean(SIGNING_SUBS[second]);

// F271: the sideload build has one Installation & Signing page (Install Apps With and This iPhone's groups on top,
// the Certificate and Provisioning Profile below) in place of Installation and Signing; #settings/installation and
// #settings/signing both open it, installation/pair and signing/help stay sub-pages. Other builds keep "Signing".
export const MERGED_TITLE = "Installation & Signing";
const merged = () => localSigning() && settings.isShown("installRoute");
// Pure, for the tests: whether `path` opens the merged page.
export const opensMerged = ([first, second] = [], on = true) => on && !second && (first === "signing" || first === INSTALLATION);
// The title is wider than the nav bar leaves at 375pt beside "Settings": it shrinks to fit (settings.css
// .nav-title-fit) instead of ending in "…", and the pages above it (This iPhone, How Signing Works) say Back, as iOS
// does for a title too long for the back button.
function mergedNav() {
  const info = { title: MERGED_TITLE, back: "Back" };
  if (typeof document === "undefined") return info;
  const span = document.createElement("span");
  span.className = "nav-title-fit";
  span.textContent = MERGED_TITLE;
  return { ...info, titleView: span };
}

export const title = "Settings";

// F134: this page's own stylesheet (settings.css), linked once from this module's folder (no build step).
function style() { loadStyle("settings.css"); }

// The one store the app uses lives in settings-store.js and the iOS 6 switch in nav/switch.js, so screens that need
// only those don't import this screen (C24 broke the import cycle that made). Re-exported for the screen's own users.
export { settings, createSwitch };

// Light: the top of the blue status bar under the nav bar; dark: "Status Bar (Black)".
// By palette (F198): OLED Black's status bar is #000, Gunmetal's the top of its bar. ios6.css --dk-ground matches.
// F200: the palettes.css ones, each its bar's status-bar colour.
export const THEME_COLORS = { classic: "#4f698b", oled: "#000", gunmetal: "#5f656f", midnight: "#0a1424", linen: "#000",
  nord: "#2e3440", dracula: "#21222c", sepia: "#7a5c36", solarized: "#2a74a8",
  // F325: the textured ones, each its bar's status-bar colour
  leather: "#4a2e1a", felt: "#6a4220", wood: "#42270f", legalpad: "#5a3218", metal: "#9aa0a9",
  white: "#f7f7f7" }; // F201: iOS 7's White, its #f7f7f7 bar

const defOf = (key) => SETTINGS.find((d) => d.key === key);
const optionLabel = (d, v) => d.options.find((o) => o.value === v)?.label ?? String(v);

const TITLES = { holds: "Ignored Upgrades", blocked: "Blocked", signing: "Signing", account: `${NAME} Account` };
// F205: pages that were renamed, old id -> new, so a saved link still lands (Display became Theme).
const OLD_PAGES = { display: "theme" };
const pathOf = (route) => { const [first, second] = route.path; return [OLD_PAGES[first] ?? first, second]; };

export function nav(route) {
  const [first, second] = pathOf(route);
  if (first === LOGS) return { title: logsTitle(second) }; // N4: Console Logs
  if (opensMerged([first, second], merged())) return mergedNav(); // F271
  if (opensSigningSub([first, second], merged())) return { title: SIGNING_SUBS[second] }; // F284
  if (first === "signing" && second === HELP) return { title: HELP_TITLE }; // F134: the walkthrough
  if (first === "signing" && second === UDID_PAGE) return { title: UDID_PAGE_TITLE }; // F316: Find UDID's steps
  if (first === INSTALLATION && INSTALLATION_TITLES[second]) return { title: INSTALLATION_TITLES[second] };
  const key = second ?? first;
  if (key && TITLES[key]) return { title: TITLES[key] };
  if (defOf(key)?.kind === "icon") return { title: `${defOf(key).label} Icon` }; // F323: Theme > App Icon's grids
  if (key && settings.pageOf(key)) return { title: settings.pageOf(key).title };
  if (key && defOf(key)) return { title: defOf(key).label };
  return { title: "Settings" };
}

// Pages on screen, each with its route, so a change anywhere redraws them all (a list page's choice updates the
// root's detail). Pages popped off the stack are out of the DOM and get forgotten here.
const pages = new Set();
settings.onChange((key) => {
  // The switch already shows it, and keeps its slide; unless the value went back (F65: the helper refused it).
  if (defOf(key)?.kind === "toggle") return syncSwitches(key);
  for (const p of pages) {
    if (p.el.isConnected) draw(p);
    else pages.delete(p);
  }
});

export function render(el, route) {
  const p = { el, route };
  const [first, second] = pathOf(route);
  const tone = defOf(second ?? first)?.tone;
  // F231: opening Theme > Light or Dark switches Mode to that tone at once, as picking a theme there does (pick()),
  // before this page joins `pages`, so the change redraws only the pages already open (Theme's Mode control).
  if (tone && settings.get("appearance") !== tone) settings.set("appearance", tone);
  pages.add(p);
  if (tone) { resetSplit(); dropStoredSplit(); } // F215/F230: a theme list opens at its peek
  draw(p);
  // Holds can change outside the app (another package manager, apt-mark by hand): ask dpkg each time Settings
  // opens a page; a change redraws through onChange. Without a helper this does nothing.
  settings.holds.sync().catch(() => {});
}

function draw({ el, route }) {
  style();
  const [first, second] = pathOf(route);
  const top = el.scrollTop;
  if (first === LOGS) el.replaceChildren(logsPage(second, () => draw({ el, route })));
  else if (first === "account") drawAccount(el); // F97
  else if ((second ?? first) === "holds") el.replaceChildren(holdsPage());
  else if ((second ?? first) === "blocked") el.replaceChildren(blockedPage()); // F226
  else if (first === "signing" && second === HELP) drawSigningHelp(el); // F134
  else if (first === "signing" && second === UDID_PAGE) drawUdidPage(el); // F316
  else if (opensMerged([first, second], merged())) drawSigning(el); // F271: Installation & Signing
  else if (opensSigningSub([first, second], merged())) drawSigningSub(el, second); // F284
  else if (first === INSTALLATION && settings.isShown("installRoute")) drawInstallation(el, second, { store: settings, server: () => serverSections(el, { footer: true }) }); // sideload
  else if (second && defOf(second)?.kind === "icon") el.replaceChildren(iconPage(second)); // F323
  else if (second) el.replaceChildren(listPage(second));
  else if (first === "signing") drawSigning(el);
  else if (first && settings.pageOf(first)) el.replaceChildren(groupPage(first));
  else if (first) el.replaceChildren(listPage(first));
  else el.replaceChildren(rootPage());
  el.scrollTop = top;
}

// The root, like iOS 6's: short rows, each opening a page; no footers. F183: Home's version line at the bottom.
function rootPage() {
  const frag = document.createDocumentFragment();
  // F271: in the sideload build Installation lives on the Signing row's page (Installation & Signing)
  const pageRows = settings.pages().filter((p) => p.id !== "signing" && !(p.id === INSTALLATION && merged()))
    .map((p) => ({ label: p.title, href: format(settingsRoute([p.id])), ...(PAGE_ICONS[p.id] ? { icon: rowIcon(PAGE_ICONS[p.id]) } : {}) }));
  const whyAbout = whyAboutSection(detectMode()); // F306: installed apps only (the website has Home's tile)
  frag.append(accountSection(), grouped([{ rows: pageRows }]), signingSection(), openInAppSection(), ipaSection(),
    logsSection(detectMode()), ...(whyAbout ? [grouped([whyAbout])] : []), ...versionLines());
  return frag;
}

// A page under the root (General, Theme, Updates): its groups, then what other parts of the app add there.
function groupPage(id) {
  const frag = settingsGroups(settings.sections().filter((s) => s.page === id), id);
  if (id === "general") frag.append(blockedSection()); // F226: Blocked packages and authors, every mode
  if (id === "general") frag.append(sideloadingSection()); // F83, sideload build
  if (id === "general") frag.append(websiteSection()); // F145: Lock Home, Install on the Website; website only
  if (id === "theme") frag.append(appIconGroups()); // F323: App Icon, the apps only
  // F285: the sideload build's Update Alerts and Checking for Updates, above Ignored Upgrades
  if (id === "updates" && detectMode() === "sideload") frag.prepend(notifySection());
  return frag;
}

// B148: a list row's detail (its choice) and Ignored Upgrades' count, as drawn and as refreshed on Back.
export const listDetail = (d, store = settings) => optionLabel(d, store.get(d.key));
export function holdsDetail(store = settings) {
  const n = store.holds.list().length + Object.keys(store.ignoredVersions.all()).length; // F281: this version only too
  return n ? String(n) : "None";
}

// Groups of setting rows on page `page`; a list row pushes <page>/<key>.
function settingsGroups(list, page) {
  const switches = [];
  const segs = [];
  const needs = [];
  const sections = list.map((s) => {
    const rows = [];
    // F205: a setting's tile (SETTING_ICONS); a choice's option rows stay bare.
    const icon = (d) => (SETTING_ICONS[d.key] ? { icon: rowIcon(SETTING_ICONS[d.key]) } : {});
    for (const d of s.settings) {
      if (d.kind === "choice") {
        const v = settings.get(d.key);
        for (const o of settings.optionsOf(d.key)) rows.push({ label: o.label, checked: o.value === v, onClick: () => settings.set(d.key, o.value) });
      } else if (d.kind === "segmented") {
        segs.push(d); // F199: Theme's Mode; drawn under the group's header below
      } else if (d.kind === "toggle") {
        switches.push([rows.length, d]);
        rows.push({ label: d.label, ...icon(d) });
      } else if (d.kind === "list") {
        if (d.needs) needs.push([rows.length, d]); // F244: shown only while its switch is on (Expiry Warning)
        // B148: live, so Back from its list page shows the choice in place (nav/pagestate.js)
        rows.push({ label: d.label, detail: listDetail(d), live: () => listDetail(d), href: format(settingsRoute([page, d.key])), ...icon(d) });
      } else if (d.kind === "holds") {
        rows.push({ label: d.label, detail: holdsDetail(), live: () => holdsDetail(), href: format(settingsRoute([page, "holds"])), ...icon(d) });
      }
    }
    rows.push(...(s.extraRows ?? [])); // F315: a fix row in the group its footer explains (Keep Bundle IDs' guide)
    return { header: s.title, footer: s.footer, rows, id: s.id, switches: switches.splice(0), segs: segs.splice(0), needs: needs.splice(0) };
  });
  const frag = grouped(sections);
  // grouped() draws plain rows; the switches go into their cells afterwards, a segmented control under its header.
  const groups = frag.querySelectorAll(".group");
  sections.forEach((s, i) => {
    if (s.segs.length) {
      const g = groups[i];
      const kids = [...g.children];
      const head = kids.filter((c) => c.classList.contains("group-header"));
      g.replaceChildren(...head, ...s.segs.map((d) => modeControl(d)), ...kids.filter((c) => !head.includes(c)));
    }
    const cells = groups[i].querySelectorAll(".cell-inner");
    for (const [row, d] of s.switches) {
      cells[row].append(makeSwitch(d));
      cells[row].classList.add("has-switch");
    }
    for (const [row, d] of s.needs) followNeeds(cells[row].closest(".cell") ?? cells[row], d);
  });
  return frag;
}

// F244: a row that only means something while a switch is on (Expiry Warning under Show Expiry Warning) hides while
// it is off. Switch changes don't redraw the page (the switch keeps its slide), so the row follows on its own.
export function needsShown(d, get = (k) => settings.get(k)) {
  return !d?.needs || get(d.needs) === true;
}
function followNeeds(row, d) {
  row.hidden = !needsShown(d);
  const off = settings.onChange((key) => {
    if (key !== d.needs) return;
    if (!row.isConnected) { off(); return; } // a redraw replaced it, or its page was popped
    row.hidden = !needsShown(d);
  });
}

// A settings row's switch: createSwitch bound to the toggle setting `d`.
// F65: a toggle whose value changed under its switch (Upgrade Notifications when ifizbox-helper fails) shows it.
function syncSwitches(key) {
  const on = settings.get(key) === true;
  for (const p of pages) {
    for (const b of p.el.querySelectorAll?.(".switch[data-key]") ?? []) {
      if (b.dataset.key === key && (b.getAttribute("aria-checked") === "true") !== on) b.setAttribute("aria-checked", String(on));
    }
  }
}

function makeSwitch(d) {
  const b = createSwitch({
    label: d.label,
    checked: settings.get(d.key) === true,
    onToggle: (on) => {
      if ((settings.get(d.key) === true) === on) return;
      if (on || !d.confirmOff) { settings.set(d.key, on); return; }
      // F237: a switch whose Off needs saying first (Keep Bundle IDs): Cancel puts it back
      showAlert({ ...d.confirmOff, cancel: 0 }).then(({ index }) => {
        if (index === 1) settings.set(d.key, false); else syncSwitches(d.key);
      }, () => syncSwitches(d.key));
    },
  });
  b.dataset.key = d.key;
  return b;
}

// F199: a "segmented" setting (Theme's Mode: Automatic / Light / Dark) as the iOS 6 segmented control, the same one
// as the package page's (nav/ui.js segmented, ios6.css .store-segmented); settings.css fits it into the group.
export function modeControl(d, store = settings) {
  const values = d.options.map((o) => o.value);
  const { bar } = segmented(d.options.map((o) => o.label), {
    selected: Math.max(0, values.indexOf(store.get(d.key))),
    onSelect: (i) => { if (store.get(d.key) !== values[i]) store.set(d.key, values[i]); },
  });
  bar.classList.add("settings-segmented");
  bar.setAttribute("role", "radiogroup");
  bar.setAttribute("aria-label", d.label);
  // VoiceOver reads Mode as a set of radio buttons (the bar is redrawn on every change, so this stays right)
  for (const b of bar.children) { b.setAttribute("role", "radio"); b.setAttribute("aria-checked", b.getAttribute("aria-selected")); }
  bar.dataset.key = d.key;
  return bar;
}

// F199: a theme's little tile in Theme > Light / Dark: its bar colour over its ground (core/settings.js `swatch`).
export function swatchIcon(o) {
  if (!o.swatch) return {};
  const [bar, ground] = o.swatch;
  return { icon: { cls: "theme-swatch", color: `linear-gradient(${bar} 0 45%, ${ground} 45%)` } };
}

function listPage(key) {
  const d = defOf(key);
  if (!d || !settings.isShown(key) || d.kind !== "list") {
    return grouped([{ footer: "This setting is not available here." }]);
  }
  const v = settings.get(key);
  // F215: a tap on a theme also grows the preview to half the screen (until the divider has been dragged).
  const choose = (value) => { if (d.tone) splitTapped(); pick(d, value); if (d.tone) layoutSoon(); };
  const frag = grouped([{
    rows: d.options.map((o) => ({ label: o.label, subtitle: o.subtitle, checked: o.value === v, onClick: () => choose(o.value),
      ...swatchIcon(o) })),
    footer: settings.footerOf(key),
  }]);
  if (d.tone) {
    const list = frag.firstElementChild;
    const space = Object.assign(document.createElement("div"), { className: "theme-preview-space" });
    const box = themePreview(d.tone);
    frag.append(space, box);
    splitPane(box, space, list);
  }
  return frag;
}

// ---- F215: Theme > Light / Dark's preview as a movable split (like iOS 6's resizable panes) ---------------------
// The preview's height, in px, from where the page is laid out (geo: `top` the list's visible top under the nav bar,
// `bottom` the preview's bottom on the tab bar, `screen` the page's height, `edges` the bottoms of the list's rows and
// of its footer at scroll 0, all in the page's px). F230: on entry it is a short peek (SPLIT_PEEK: the divider and the
// sample's nav bar); when a row edge falls within a row of that line the divider snaps to it, so no row is cut. The
// first tap on a theme springs it up to half the screen. A drag wins over both, for this visit only: the position
// lives in `split` below, which a theme list clears when it opens (nothing is stored).
export const SPLIT_KEY = "ifizbox.themePreviewSplit"; // F215 stored the dragged position here; F230 removes it
export const SPLIT_PEEK = 100; // px: the grip (25) and the sample's nav bar (44), with a little of what is under it
export const SPLIT_TAP = 0.5;
export const SPLIT_MIN = 64; // px: the dragged preview keeps its divider and a bit of sample
const LIST_MIN = 44; // px: and the list one row's height

export function entrySplit({ top, bottom, edges = [] }) {
  const fit = edges.filter((e) => e > top && bottom - e >= SPLIT_PEEK);
  const low = fit.length ? Math.max(...fit) : null;
  return low != null && bottom - low - SPLIT_PEEK < LIST_MIN ? bottom - low : SPLIT_PEEK;
}

export function clampSplit(h, { top, bottom }) {
  return Math.round(Math.max(SPLIT_MIN, Math.min(bottom - top - LIST_MIN, h)));
}

// state: { dragged } the height the divider was let go at this visit (px, or null), { tapped } a theme was tapped.
export function splitHeight(geo, { dragged = null, tapped = false } = {}) {
  if (dragged != null && Number.isFinite(dragged)) return clampSplit(dragged, geo);
  const entry = entrySplit(geo);
  return tapped ? Math.max(entry, Math.min(Math.round(geo.screen * SPLIT_TAP), geo.bottom - geo.top - LIST_MIN)) : entry;
}

// F230: F215 kept the dragged position in localStorage; drop that key once per launch so no stale one lingers.
let oldKeyGone = false;
export function dropStoredSplit(storage = globalThis.localStorage) {
  if (oldKeyGone) return;
  oldKeyGone = true;
  try { storage?.removeItem(SPLIT_KEY); } catch { /* private mode */ }
}

// The live state: the preview on screen, its height now, whether a theme was tapped since the list opened, and where
// the divider was dragged to. A theme tap redraws the page (a new preview), so the height carries over here and the
// new one animates from it.
let split = { box: null, space: null, list: null, h: null, tapped: false, dragged: null, moving: false };
export const resetSplit = () => { split = { box: null, space: null, list: null, h: null, tapped: false, dragged: null, moving: false }; };
// The state changes, apart from the DOM (settings.test.js drives them): a theme tapped, the divider let go, and the
// height the preview should have now.
export const splitTapped = () => { split.tapped = true; };
export const splitDropped = (h) => { split.dragged = h; };
export const splitNow = (geo) => splitHeight(geo, split);

function splitPane(box, space, list) {
  Object.assign(split, { box, space, list });
  if (split.h != null) setSplit(box, space, split.h); // a redraw: keep the height on screen, then move from it
  // F347: the whole top bar (divider, the sample's nav bar and search bar) is the handle, not just the grip
  box.querySelector(".theme-preview-top")?.addEventListener?.("pointerdown", (e) => dragSplit(e, box, space));
  layoutSoon();
}

function setSplit(box, space, h) {
  box.style.height = h + "px";
  box.style.transform = "";
  space.style.height = h + "px";
}

let layoutQueued = false;
function layoutSoon() {
  if (layoutQueued || !globalThis.requestAnimationFrame) return; // no layout to measure (node's tests)
  layoutQueued = true;
  requestAnimationFrame(() => { layoutQueued = false; layoutSplit(); });
}

function geometry(box, list) {
  const scroller = box.closest(".page-body");
  if (!scroller || !box.isConnected) return null;
  const r = scroller.getBoundingClientRect();
  const top = r.top + (parseFloat(getComputedStyle(scroller).paddingTop) || 0);
  const bottom = r.bottom - (parseFloat(getComputedStyle(box).bottom) || 0);
  const at0 = (el) => el.getBoundingClientRect().bottom + scroller.scrollTop;
  const rows = [...(list?.querySelectorAll(".table > li") ?? [])];
  const edges = rows.map((li, i) => at0(i === rows.length - 1 ? li.parentElement : li));
  const footer = list?.querySelector(".group-footer");
  if (footer) edges.push(at0(footer) + 10); // the whole list fits: end under its footer, with a group's gap
  return { top, bottom, screen: r.height, edges };
}

function layoutSplit() {
  const { box, space, list } = split;
  if (!box || split.moving) return;
  const geo = geometry(box, list);
  if (!geo) return;
  const to = splitNow(geo);
  const from = split.h;
  split.h = to;
  if (from == null || from === to || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return setSplit(box, space, to);
  if (to > from) return springSplit(box, space, from, to);
  // Transform only (120 Hz): lay it out at the taller of the two once, slide, then settle at the new height.
  const tall = Math.max(from, to);
  box.style.height = tall + "px";
  if (to > from) space.style.height = to + "px";
  const anim = box.animate([{ transform: `translateY(${tall - from}px)` }, { transform: `translateY(${tall - to}px)` }],
    { duration: DURATION, easing: EASE, fill: "forwards" });
  split.moving = true;
  anim.finished.catch(() => {}).then(() => {
    split.moving = false;
    anim.cancel();
    if (split.box === box) setSplit(box, space, split.h);
  });
}

// F230: the first theme tap pops the preview up: laid out once at the new height plus a small overshoot, it rises
// past the line (~65% of the time), then settles back down onto it. Transform only (120 Hz); ~380ms in all.
function springSplit(box, space, from, to) {
  const over = Math.min(14, Math.max(4, Math.round((to - from) * 0.06)));
  const tall = to + over;
  box.style.height = tall + "px";
  space.style.height = to + "px";
  const anim = box.animate([
    { transform: `translateY(${tall - from}px)`, offset: 0, easing: "cubic-bezier(.2,.75,.35,1)" },
    { transform: "translateY(0px)", offset: 0.65, easing: "cubic-bezier(.45,0,.55,1)" },
    { transform: `translateY(${over}px)`, offset: 1 },
  ], { duration: 380, fill: "forwards" });
  split.moving = true;
  anim.finished.catch(() => {}).then(() => {
    split.moving = false;
    anim.cancel();
    if (split.box === box) setSplit(box, space, split.h);
  });
}

// Dragging the divider: the preview is laid out at its tallest once, the finger moves it by transform, and where it
// is let go is the height for the rest of this visit (F230: kept in `split` only, never stored).
function dragSplit(e, box, space) {
  if (split.moving && !split.dragging) return;
  const geo = geometry(box, split.list);
  if (!geo) return;
  e.preventDefault();
  const grip = e.currentTarget;
  grip.setPointerCapture?.(e.pointerId);
  grip.classList.add("is-held");
  const tall = geo.bottom - geo.top - LIST_MIN;
  const h0 = split.h ?? box.getBoundingClientRect().height;
  const y0 = e.clientY;
  let h = h0;
  split.moving = split.dragging = true;
  // F347: laid out tall at the first move, not on the press: a press on the sample's Back or Edit that doesn't move
  // keeps the sample's scroll (a resize scrolls it, and a scroll lets go of the pressed button)
  let tallNow = false;
  const move = (m) => {
    if (m.pointerId !== e.pointerId) return;
    if (!tallNow) { tallNow = true; box.style.height = tall + "px"; }
    h = clampSplit(h0 - (m.clientY - y0), geo);
    box.style.transform = `translateY(${tall - h}px)`;
  };
  const end = (u) => {
    if (u.pointerId !== e.pointerId) return;
    grip.removeEventListener("pointermove", move);
    grip.removeEventListener("pointerup", end);
    grip.removeEventListener("pointercancel", end);
    grip.classList.remove("is-held");
    split.moving = split.dragging = false;
    split.h = h;
    if (h !== h0) splitDropped(h);
    setSplit(box, space, h);
  };
  grip.addEventListener("pointermove", move);
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
}

// A theme picked in Theme > Light / Dark also switches Mode to that tone, so it shows once back on Theme.
export function pick(d, value, store = settings) {
  store.set(d.key, value);
  if (d.tone && store.get("appearance") !== d.tone) store.set("appearance", d.tone);
}

// Theme > Light / Dark: a sample of the app's controls in the theme showing, pinned over the page's bottom half
// (settings.css .theme-preview). F347: it works as a sample: buttons show their pressed state, the switch, the
// segmented control and the Checked row toggle; nothing else happens.
function themePreview(tone) {
  const make = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls, textContent: text ?? "" });
  loadStyle("appicon.css");
  loadStyle("sources.css"); // .bar-button.done's blue
  // F347: the pane is a top bar (the divider, the sample's nav bar and its search bar, pinned: the handle that moves
  // the split) over the sample, which scrolls on its own.
  const pane = make("div", "theme-preview");
  const top = make("div", "theme-preview-top");
  top.setAttribute("aria-hidden", "true");
  const grip = make("div", "theme-preview-grip");
  const box = make("div", "theme-preview-body");
  pane.append(top, box);
  box.setAttribute("aria-hidden", "true"); // a picture of the controls: it works to the finger, not to VoiceOver
  const bar = make("div", "navbar theme-preview-bar");
  bar.append(make("span", "bar-button back", "Back"), make("span", "nav-title", "Preview"), make("span", "bar-button", "Edit"));
  const search = make("div", "search-bar");
  const field = make("label", "search-field");
  field.append(Object.assign(document.createElement("input"), { type: "search", placeholder: "Search", readOnly: true, tabIndex: -1 }));
  search.append(field);
  top.append(grip, bar, search);
  // F323: in the apps, a small Home header, its icon the one this theme (or Theme > App Icon's pick) gives the app.
  // The website's preview stays as it was (its icon never changes).
  const home = document.createDocumentFragment();
  if (nativeIcons()) {
    const head = make("div", "theme-preview-home");
    const icon = make("img", "theme-preview-icon");
    icon.alt = "";
    iconImage(icon, tone);
    head.append(icon, make("span", "theme-preview-home-title", `Welcome to ${NAME}`));
    home.append(head);
  }
  const seg = segmented(["Details", "Reviews", "Related"], { onSelect: (i) => seg.mark(i) });
  seg.bar.classList.add("theme-preview-seg");
  const btn = (cls, text) => Object.assign(make("button", cls, text), { type: "button" });
  const buttons = make("div", "theme-preview-buttons");
  buttons.append(btn("store-btn", "FREE"), btn("store-btn", "$0.99"), make("span", "badge", "3"));
  pressable(buttons, ".store-btn"); // app.js presses bar buttons and rows; the store buttons press here
  const colours = make("div", "theme-preview-buttons theme-preview-colours");
  colours.append(btn("bar-button red", "Remove"), btn("bar-button green", "Install"), btn("bar-button done", "Done"));
  const nothing = () => {};
  const groups = grouped([{ header: "Sample", rows: [
    { label: "Sources", detail: "12", chevron: true, icon: rowIcon(PAGE_ICONS.general), onClick: nothing },
    { label: "Upgrades", badge: "3", chevron: true, icon: rowIcon(PAGE_ICONS.updates), onClick: nothing },
    { label: "Switch" },
    { label: "Checked", checked: true, onClick: (e) => toggleCheck(e.currentTarget) },
    { label: "Package", subtitle: "A row with a subtitle", detail: "1.0", onClick: nothing },
  ], footer: "A group footer reads like this." }]);
  const sw = groups.querySelectorAll(".cell-inner")[2];
  sw.append(createSwitch({ label: "Switch", checked: true }));
  sw.classList.add("has-switch");
  box.append(home, seg.bar, buttons, colours, groups);
  return pane;
}

// F347: the preview's Checked row: a tap takes its check mark off, the next puts it back.
export function toggleCheck(inner) {
  const mark = inner.querySelector(".cell-check");
  if (mark) mark.remove();
  else inner.append(Object.assign(document.createElement("span"), { className: "cell-check" }));
  return !mark;
}

// F347: .preview-pressed on a `sel` element of `root` while a finger is on it (:active alone is unreliable on iOS).
// Not .is-pressed: app.js's own pointerdown, after this one, takes that off everything it didn't press.
function pressable(root, sel) {
  const off = () => root.querySelector(".preview-pressed")?.classList.remove("preview-pressed");
  root.addEventListener("pointerdown", (e) => { off(); e.target.closest?.(sel)?.classList.add("preview-pressed"); });
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) root.addEventListener(type, off);
}

// ---- F323: Theme > App Icon ----------------------------------------------------------------------------------
// The apps only (nativeIcons: the website's icon can't switch). One group with the Match Theme switch (on by default,
// its footer says the icon follows the theme); off, a second group slides in under it with Light and Dark, each
// with its icon's thumbnail, pushing theme/lightIcon or theme/darkIcon (iconPage). They start on the themes' own
// icons, so turning the switch off changes nothing until one is picked. A pick applies to its mode only.
const iconLabel = (name) => APP_ICONS.find((i) => i.value === name)?.label ?? (isOwnIcon(name) ? ownIcons?.ownLabel(name) ?? "Your Icon" : name);
// F329: your own icons (screens/appicon.js), the jailbreak app only; loaded when Theme > App Icon draws, out of the
// startup closure, so the grid behind it has it at once.
let ownIcons = null;
const ownOffered = () => (settings.mode === "jailbreak" || settings.mode === "sideload") && hasNativeCall(); // appicon.js ownIconsOffered
const loadOwnIcons = () => import("./appicon.js").then((m) => (ownIcons = m));
const iconThumb = (name, tone) => ({ icon: { cls: "app-icon-thumb", src: iconSrc(name, tone) } });

// The groups' data, pure for the tests: [switch group, picks group].
export function appIconLayout(store = settings) {
  const pick = (key) => {
    const d = defOf(key);
    const name = iconOf(d.iconTone, readIcons((k) => store.get(k)));
    return { key, label: d.label, detail: iconLabel(name), icon: name, href: format(settingsRoute(["theme", key])) };
  };
  return [
    { header: "App Icon", id: "appicon", rows: [{ key: "iconMatch", label: defOf("iconMatch").label }], footer: store.footerOf("iconMatch") },
    { id: "appicon-picks", rows: [pick("lightIcon"), pick("darkIcon")], footer: store.footerOf("lightIcon"), hidden: store.get("iconMatch") !== false },
  ];
}

function appIconGroups() {
  if (!nativeIcons()) return document.createDocumentFragment();
  loadStyle("appicon.css");
  const [sw, picks] = appIconLayout();
  const frag = grouped([
    { header: sw.header, rows: sw.rows.map((r) => ({ label: r.label })), footer: sw.footer },
    { rows: picks.rows.map((r) => ({ label: r.label, detail: r.detail, href: r.href, ...iconThumb(r.icon, defOf(r.key).iconTone),
      live: () => iconLabel(iconOf(defOf(r.key).iconTone)) })), footer: picks.footer },
  ]);
  const [group, pickGroup] = frag.querySelectorAll(".group");
  // F329: a pick of your own icon is named from the shell's list, which may not be read yet
  if (ownOffered()) {
    loadOwnIcons().then((m) => m.loadIcons().then((list) => m.dropMissing(settings, list))).then(() => picks.rows.forEach((r, i) => {
      const detail = pickGroup.querySelectorAll(".cell-detail")[i];
      if (detail && isOwnIcon(r.icon)) detail.textContent = iconLabel(iconOf(defOf(r.key).iconTone));
    })).catch(() => {});
  }
  group.dataset.key = "appicon";
  pickGroup.dataset.key = "appicon-picks";
  const cell = group.querySelector(".cell-inner");
  cell.append(makeSwitch(defOf("iconMatch")));
  cell.classList.add("has-switch");
  const foot = group.querySelector(".group-footer");
  // The switch doesn't redraw the page (it keeps its slide): the groups follow it, and nav/slide.js slides what
  // moves (the picks group fades in, everything under it slides down).
  const follow = () => {
    const on = settings.get("iconMatch") !== false;
    pickGroup.hidden = on;
    if (foot) foot.hidden = !on;
  };
  follow();
  const off = settings.onChange((key) => {
    if (key !== "iconMatch") return;
    if (!pickGroup.isConnected) { off(); return; }
    redrawPicks(pickGroup, picks.rows);
    follow();
  });
  return frag;
}

// B226: the picks group is drawn while Match Theme may be on (iconOf then gives the themes' icons); when the
// switch turns, each row's detail and thumbnail follow what iconOf gives now.
function redrawPicks(pickGroup, rows) {
  const cells = pickGroup.querySelectorAll(".cell-inner");
  rows.forEach((r, i) => {
    const cell = cells[i];
    if (!cell) return;
    const name = iconOf(defOf(r.key).iconTone);
    const detail = cell.querySelector(".cell-detail");
    if (detail) detail.textContent = iconLabel(name);
    const box = cell.querySelector(".cell-icon");
    if (!box) return;
    const src = iconSrc(name, defOf(r.key).iconTone);
    let img = box.querySelector("img");
    if (img && img.getAttribute("src") === src) return;
    if (!img) { // dropped after a failed load: a new one, as nav/ui.js draws it
      img = document.createElement("img");
      img.alt = "";
      img.onload = () => img.classList.add("loaded");
      img.onerror = () => img.remove();
      box.append(img);
    }
    img.src = src;
  });
}

// Theme > App Icon > Light / Dark: a grid of icons in groups (core/settings.js iconGroups: this mode's themes, then
// Clear and the other mode's; Clear only from iOS 18 on), the icon this mode has now checked. A tap picks it for this mode (the shell switches
// at once: applyTheme's tellIcon) and the page redraws with the check on it.
function iconPage(key) {
  const d = defOf(key);
  if (!d || !settings.isShown(key)) return grouped([{ footer: "This setting is not available here." }]);
  loadStyle("appicon.css");
  const now = iconOf(d.iconTone);
  const frag = document.createDocumentFragment();
  for (const g of iconGroups(d.iconTone, { clear: clearHere() })) { // no Clear below iOS 18
    const group = document.createElement("div");
    group.className = "group";
    const head = Object.assign(document.createElement("h2"), { className: "group-header", textContent: g.header });
    const table = document.createElement("div");
    table.className = "table grouped icon-table";
    const grid = document.createElement("div");
    grid.className = "icon-grid";
    grid.setAttribute("role", "radiogroup");
    grid.setAttribute("aria-label", g.header);
    for (const i of g.icons) {
      const b = Object.assign(document.createElement("button"), { type: "button", className: "icon-cell" });
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(i.value === now));
      b.dataset.icon = i.value;
      const img = Object.assign(document.createElement("img"), { src: iconSrc(i.value, d.iconTone), alt: "" });
      b.append(img, Object.assign(document.createElement("span"), { className: "icon-cell-label", textContent: i.label }));
      b.addEventListener("click", () => { if (settings.get(key) !== i.value) settings.set(key, i.value); });
      grid.append(b);
    }
    table.append(grid);
    group.append(head, table);
    frag.append(group);
  }
  // F329: Your Icons (loaded by Theme > App Icon; a page opened straight from a link waits for the module)
  if (ownOffered()) {
    const make = (m) => m.ownIconsGroup({ key, now, store: settings });
    if (ownIcons) frag.append(make(ownIcons));
    else {
      const slot = document.createElement("div");
      frag.append(slot);
      loadOwnIcons().then((m) => { if (slot.isConnected) slot.replaceWith(make(m)); }).catch(() => {});
    }
  }
  return frag;
}

function holdsPage() {
  return grouped(holdsLayout({ held: settings.holds.list(), versions: settings.ignoredVersions.all(), footer: settings.footerOf("holds") || "",
    unhold: (pkg) => settings.holds.set(pkg, false), unversion: (id) => settings.ignoredVersions.set(id, null) }));
}

// F281: Settings > Ignored Upgrades' groups (nav/ui.js grouped): the packages ignored whole (holds), then those with
// only the version on offer ignored (Ignore This Version, `versions` { id: version }), each row "this version only"
// with its version; a tap on either takes it back. Pure, for the tests.
export function holdsLayout({ held = [], versions = {}, footer = "", unhold = () => {}, unversion = () => {} } = {}) {
  const only = Object.entries(versions ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if (!held.length && !only.length) {
    return [{ footer: "No upgrades are ignored. Turn on Ignore Upgrades on a package's page, or pick Ignore This Version for one upgrade." }];
  }
  const groups = [];
  if (held.length) {
    groups.push({
      header: "Ignored",
      rows: held.map((pkg) => ({ label: pkg, checked: true, onClick: () => unhold(pkg) })),
      footer: footer + " Tap a package to take its upgrades again.",
    });
  }
  if (only.length) {
    groups.push({
      header: "This Version Only",
      rows: only.map(([id, v]) => ({ label: id, subtitle: `${v}, this version only`, checked: true, onClick: () => unversion(id) })),
      footer: "Hidden until a newer version comes or this one is installed. Tap one to show its upgrade again.",
    });
  }
  return groups;
}

// F226: Settings > General > Blocked (Zebra #1037, #998): the packages blocked from their page and the authors
// (F104's hidden authors), each with a check; a tap unblocks it. Pure: the groups for nav/ui.js grouped(), for the
// tests. `entries` [{ id, name }], `authors` [name].
// F317 (AGENTS.md, Hints): the sentence that depends on the mode (kept on this device / held with dpkg) is a group of
// its own at the end, about the whole page, never mid-footer under Packages.
export function blockedLayout({ entries = [], authors = [], mode = "site" } = {}) {
  const where = { footer: mode === "jailbreak"
    ? "An installed package you block is also held with dpkg, so other package managers leave it alone."
    : "Blocks are kept on this device." };
  if (!entries.length && !authors.length) {
    return [{ footer: "Nothing is blocked. Block a package or its author on the package's page: it leaves Browse, Search, Sections and Changes." }, where];
  }
  const groups = [];
  if (entries.length) {
    groups.push({ header: "Packages", key: "packages",
      rows: entries.map((e) => ({ id: e.id, label: e.name, subtitle: e.name !== e.id ? e.id : undefined, checked: true })),
      footer: "Left out of Browse, Search, Sections and Changes. Tap a package to unblock it." });
  }
  if (authors.length) {
    groups.push({ header: "Authors", key: "authors", rows: authors.map((a) => ({ author: a, label: a, checked: true })),
      footer: "Every package by these authors is left out the same way. Tap an author to unblock them." });
  }
  return [...groups, where];
}

// The General page's row: how many are blocked, pushing the list.
export function blockedDetail(store = settings) {
  const n = store.blocked.list().length + store.blocked.authors().length;
  return n ? String(n) : "None";
}
function blockedSection() { // B148: live, so Back from Blocked shows the count in place
  return grouped([{ rows: [{ label: "Blocked", detail: blockedDetail(), live: () => blockedDetail(), href: format(settingsRoute(["general", "blocked"])), icon: rowIcon("hidden") }] }]);
}

function blockedPage() {
  // Unblock lifts a dpkg hold only where the block made it (core/settings.js blocked.set); a change redraws the page.
  return grouped(blockedLayout({ entries: settings.blocked.entries(), authors: settings.blocked.authors(), mode: detectMode() }).map((g) => ({
    ...g,
    rows: (g.rows ?? []).map((r) => ({ label: r.label, subtitle: r.subtitle, checked: true,
      onClick: () => (r.author ? settings.blocked.setAuthor(r.author, false) : settings.blocked.set(r.id, false).catch(() => {})) })),
  })));
}

// ---- Theme ---------------------------------------------------------------------------------------------------

// F198: the dark palette chosen (raw, as theme-boot.js reads it). F199: Theme > Dark sets it (settings' darkTheme,
// stored at the same key); paletteFor() reads anything but a known palette as Gunmetal (the default).
export function darkTheme(win = globalThis) {
  try { return win.localStorage?.getItem(DARK_THEME_KEY) ?? null; } catch { return null; }
}

// F199: Theme > Light and Theme > Dark are live previews: while one of their lists is the page on screen, the app
// shows that tone in the theme picked there, whatever Mode says; back on Theme it shows Mode's again. Read off the
// route (the URL hash), so it holds before the page is drawn and the moment back is tapped. theme-boot.js matches.
const THEME_LISTS = { lightTheme: "light", darkTheme: "dark" };
export function previewOf(route) {
  if (route?.tab !== "home" || route.path[0] !== "settings") return null;
  const [first, second] = pathOf({ path: route.path.slice(1) });
  if (second && first !== "theme") return null;
  return THEME_LISTS[second ?? first] ?? null;
}
function currentPreview(win) {
  try { return previewOf(parse(win.location?.hash)); } catch { return null; }
}

// F202: the nav hooks the era turns on (core/settings.js STYLE_HOOKS): large titles through nav/navbar.js (it draws
// and removes the titles itself), card sheets as <html data-sheet="card"> (nav/sheet.js reads it when a sheet opens).
// navbar.js loads only when an era turns large titles on (or off again), so iOS 6's startup is unchanged
// (module-graph.test.js). Returns a promise of the hook being set, for the tests.
export function applyStyleHooks(style, doc = document) {
  const { nav, sheet } = hooksOf(style);
  const on = nav === "large";
  const root = doc.documentElement;
  let done = Promise.resolve();
  if (on || root.getAttribute?.("data-nav") === "large") {
    done = import("../nav/navbar.js").then((m) => m.setLargeTitles(hooksOf(root.dataset?.style).nav === "large", doc)) // the style by then
      .catch(() => {}); // offline with the module not cached: iOS 13 keeps the bar titles
  }
  if (sheet) root.setAttribute?.("data-sheet", sheet);
  else root.removeAttribute?.("data-sheet");
  // (a real <html> always has removeAttribute; some tests' fake roots don't)
  if (root.removeAttribute) setFloatingTabbar(hooksOf(style).tabbar === "float", doc); // F203: iOS 26's pill and Search circle
  return done;
}

export function applyTheme(doc = document, win = window) {
  const dark = win.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  const appearance = settings.get("appearance");
  const lightTheme = settings.get("lightTheme");
  const darkPalette = settings.get("darkTheme");
  const preview = currentPreview(win);
  const { theme, palette, style } = themeState({ style: settings.get("style"), appearance, lightTheme, darkTheme: darkPalette, preview }, dark);
  doc.documentElement.dataset.style = style; // F201: the era, ios6.css alone or ios7.css over it
  applyStyleHooks(style, doc); // F202: iOS 13's large titles and card sheets
  doc.documentElement.dataset.theme = theme;
  doc.documentElement.dataset.palette = palette; // F198/F199: Mode's tone in its chosen theme
  // A meta with a media query (light or dark) is painted for its own scheme while Mode is Automatic; a fixed
  // choice, a preview, or a meta with none (index.html has one), takes the palette showing now.
  // A fresh meta element, not a changed one: Safari doesn't always repaint its top bar when only `content` changes.
  for (const m of doc.querySelectorAll('meta[name="theme-color"]')) {
    const own = m.media?.includes("dark") ? "dark" : m.media?.includes("light") ? "light" : null;
    const color = THEME_COLORS[appearance === "auto" && own && !preview
      ? themeState({ style, appearance: own, lightTheme, darkTheme: darkPalette }, false).palette : palette]; // F201: the era's pair
    if (m.content === color) continue;
    const fresh = m.cloneNode();
    fresh.content = color;
    m.replaceWith(fresh);
  }
  // A preview pins the shell to the tone on screen (its status bar and keyboard follow the page) until it ends.
  // B221: the era's own light theme (iOS 7: White), not the iOS 6 pick, and dark status-bar text on a light bar.
  const lightPalette = themeState({ style, appearance: "light", lightTheme, darkTheme: darkPalette }, false).palette;
  // B231: the dark one likewise (iOS 7: OLED Black, not the iOS 6 pick's ground).
  const eraDark = themeState({ style, appearance: "dark", lightTheme, darkTheme: darkPalette }, true).palette;
  // B235: the era's own launch set where it has one (iOS 7's OLED Black: oled7, flat bars), not iOS 6's of that name.
  tellShell(preview ? theme : appearance, theme, win, launchKey(style, eraDark), launchKey(style, lightPalette),
    DARK_TEXT_BARS.has(palette));
  // F323: the Home Screen icon follows, once the theme lists are left (a tap through them would switch it each time,
  // with iOS's alert in the sideload build); the icons the page shows follow at once.
  if (!preview) tellIcon(theme);
  refreshIcons(doc);
}

// The jailbreak/sideload shell (F23): native parts the page can't style (keyboard, <select> pickers, alerts,
// the window behind the web view) follow the theme through the bridge's app.theme. Automatic sends "auto" so the
// shell lets the system decide; pinning a style there would also pin prefers-color-scheme inside the web view and
// Automatic would stop following the system. On the site there is no handler and this does nothing.
// F198: darkPalette is the dark palette chosen (oled or gunmetal), sent in light too: the shell keeps it to paint its
// window at the next launch before the page runs (black for OLED Black), whichever way Automatic then goes.
// F214: lightPalette (classic, sepia or solarized) likewise, so a light launch paints Sepia's or Solarized Light's
// pinstripes, not the kit's blue-grey.
// B221: statusBar "dark" (sent only then) while the theme showing has a light bar (iOS 7's White): the shell's status
// bar text goes dark; without it the text stays light, as on every iOS 6 bar.
export const DARK_TEXT_BARS = new Set(["white"]);
export function themeMessage(appearance, theme, darkPalette = "gunmetal", lightPalette = "classic", darkText = false) {
  const params = { style: appearance === "auto" ? "auto" : theme, theme, darkPalette, lightPalette };
  if (darkText) params.statusBar = "dark";
  return { id: 0, method: "app.theme", params };
}
let lastSent = "";
function tellShell(appearance, theme, win, darkPalette, lightPalette, darkText) {
  const h = win.webkit?.messageHandlers?.ifizbox;
  if (!h) return;
  const msg = themeMessage(appearance, theme, darkPalette, lightPalette, darkText);
  const key = JSON.stringify(msg.params);
  if (key === lastSent) return;
  lastSent = key;
  try { Promise.resolve(h.postMessage(msg)).catch(() => {}); } catch { /* an older shell without app.theme */ }
}

// Zoom is always off (F134 retired Display > Zoom, allowZoom). iOS Safari ignores user-scalable=no, so besides the
// viewport and touch-action (html.no-zoom in ios6.css) the pinch gesture itself is cancelled.
function applyZoom(doc = document) {
  const allow = false;
  doc.documentElement.classList.toggle("no-zoom", !allow);
  const vp = doc.querySelector('meta[name="viewport"]');
  if (vp) vp.content = "width=device-width, initial-scale=1, viewport-fit=cover" +
    (allow ? "" : ", maximum-scale=1, user-scalable=no");
  return allow;
}
function stopPinch(e) { if (document.documentElement.classList.contains("no-zoom")) e.preventDefault(); }

export function init() {
  applyTheme();
  applyZoom();
  for (const type of ["gesturestart", "gesturechange"]) document.addEventListener(type, stopPinch, { passive: false });
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => applyTheme());
  window.addEventListener?.("hashchange", () => applyTheme()); // F199: a theme list's preview starts and ends
  settings.onChange((key) => {
    if (key === "style" || key === "appearance" || key === "lightTheme" || key === "darkTheme") applyTheme(); // F201: style
    if (key === "iconMatch" || key === "lightIcon" || key === "darkIcon") applyTheme(); // F323
    if (key === "resignReminder") remindNow();
  });
  // F260: the signer confirmed the website's password in the background: repaint the Password rows (no redraw: one
  // may be in the middle of typing)
  window.addEventListener?.(PASSWORD_EVENT, () => loadIdentity().then((id) => {
    for (const p of pages) if (p.el.isConnected) showPasswordState(p.el, id);
  }).catch(() => {}));
  startAccountSync(); // F97: read the account on launch, save it when iFizBox goes to the background
  remindNow(); // F68: on launch too, so the notification follows the setting (and any change the shell missed)
}

// F68: Re-sign Reminder to the shell (signing.remind {days}, F14), sideload build only.
function remindNow() {
  if (!localSigning() || !settings.isShown("resignReminder")) return;
  const n = nativeBridge();
  syncReminder((k) => settings.get(k), n?.call ? (m, p) => n.call(m, p) : null);
}

// ---- Signing (I5, F58) ---------------------------------------------------------------------------------------
// Settings > Signing, in the sideload build only: the user's .p12, its password and a .mobileprovision go into the
// Keychain, and the Signing Server hands iOS the manifests. F93: the website signs in the browser again (its page is
// at the end of this file), and the jailbreak app installs with its helper.

// The root page's row: the certificate's name once one is set.
function signingSection() {
  const box = document.createElement("div");
  if (localSigning()) return deviceSigningSection(box);
  if (browserSigning()) return siteSigningSection(box);
  return box;
}
// After a change on the Signing page: redraw every Settings page on screen (the root's Certificate row too).
function redrawAll() {
  for (const p of pages) {
    if (p.el.isConnected) draw(p);
    else pages.delete(p);
  }
}


// Everything picked at once: the .p12 and profile are checked and saved as if picked alone, then the password is
// found among any text files (or the empty password), unless the saved one already opens the certificate.
async function chooseFiles(el, files, slot) {
  const hide = showHUD("Reading");
  let found;
  try { found = await sortCertFiles(files); } catch { found = { p12: null, profile: null, passwords: [] }; }
  hide();
  // One file on a button that sorting didn't place: that button's file (its checks below say if it's wrong).
  if (slot && files.length === 1 && !found.p12 && !found.profile && !found.passwords.length) found[slot] = files[0];
  if (!found.p12 && !found.profile && !found.passwords.length) {
    await alertOK("No Certificate Files", "Choose your .p12, its .mobileprovision and (if you have one) a .txt with the password, or the .zip they came in.");
    return;
  }
  if (found.profile) await chooseProfile(el, found.profile, false);
  if (found.p12) await chooseP12(el, found.p12, false);
  const id = await loadIdentity();
  // F248: a .p12 the empty password opens is saved with "" (the Password row says Not Needed); one that needs a
  // password nobody gave gets the field focused after the redraw (the keyboard comes up in the app, FocusKeyboard).
  let locked = false;
  if (id?.p12) {
    const r = await resolvePassword(id.p12, id.password ?? null, found.passwords);
    if (r.passwordOk === true && r.password !== id.password) await saveIdentity({ password: r.password, passwordOk: true });
    locked = r.locked;
  }
  if (id?.p12) await recheckPassword(el, false);
  if (id?.p12 && !id.profile) await (await import("./devaccount.js")).profileFromKey(localSigning() ? undefined : false); // F276: the profile from an API key
  if (localSigning()) await importIfComplete(el, false);
  if (locked) wantPasswordFocus(el);
  redrawAll();
}

// F248: the next Password field certificateBlock draws in `el` takes the focus (once), scrolled into view.
let passwordFocusIn = null;
export const wantPasswordFocus = (el) => { passwordFocusIn = el; };
export function takePasswordFocus(el, input) {
  if (!el || passwordFocusIn !== el) return false;
  passwordFocusIn = null;
  const go = () => {
    if (!input.isConnected) return;
    input.scrollIntoView?.({ block: "center" });
    input.focus({ preventScroll: true });
  };
  (globalThis.requestAnimationFrame ?? ((f) => setTimeout(f, 0)))(go);
  return true;
}

// F83: Sideloading > Open Other Apps' Links (sideload build only, which claims the schemes; on by default). The
// footer says the limit: iOS fixed the schemes at install, so off can't hand a link back to the app it was for.
const OTHER_LINKS_FOOTER = `AltStore, SideStore, Feather and other sideloaders' links open in ${NAME}. `
  + "iOS picks the app for each kind of link, so Off can't always hand them back.";
function sideloadingSection(mode = detectMode()) {
  const box = document.createElement("div");
  if (mode !== "sideload") return box;
  const frag = grouped([{ header: "Sideloading", rows: [{ label: "Open Other Apps' Links", icon: rowIcon("otherLinks") }], footer: OTHER_LINKS_FOOTER }]);
  const cell = frag.querySelector(".cell-inner");
  cell?.append(createSwitch({ label: "Open Other Apps' Links", checked: otherLinksOn(), onToggle: (on) => setOtherLinks(on) }));
  cell?.classList.add("has-switch");
  box.append(frag);
  return box;
}

async function chooseP12(el, f, redraw = true) {
  if (!f) return;
  if (f.bytes[0] !== 0x30 || f.bytes.length > 256 * 1024) {
    await alertOK("Not a Certificate", `${f.name} is not a .p12 file. Export your certificate and its key from Keychain as .p12.`);
    return;
  }
  await saveIdentity({ p12: f.bytes, p12Name: f.name.split("/").pop(), passwordOk: null });
  if (redraw) redrawAll();
}

async function chooseProfile(el, f, redraw = true) {
  if (!f) return;
  try {
    if (f.bytes.length > 1024 * 1024) throw new Error("too large");
    parseProfile(f.bytes);
  } catch {
    await alertOK("Not a Profile", `${f.name} is not a provisioning profile (.mobileprovision).`);
    return;
  }
  await saveIdentity({ profile: f.bytes, profileName: f.name.split("/").pop() });
  if (redraw) redrawAll();
}

// Whether the saved password opens the .p12; the result shows under the password field. `redraw` false while the
// field is being typed in (a redraw would take its focus).
async function recheckPassword(el, redraw = true) {
  const id = await loadIdentity();
  if (!id?.p12) return;
  const ok = await checkP12Password(id.p12, id.password ?? "");
  await saveIdentity({ passwordOk: ok });
  if (redraw) redrawAll();
  else showPasswordState(el, { ...id, passwordOk: ok });
}

// B20: the Signing Server row's alert: a text field with the server's URL (empty for the default), then Save stores
// it and checks it (Check Server's alerts). Injectable for the tests.
export async function askServer(el, { alert = showAlert, current = getServer, def = defaultServer, save = setServer,
  check = checkServer, redraw = redrawAll } = {}) {
  const server = current(), fallback = def();
  const { index, value } = await alert({ title: "Signing Server", message: `Hands iOS the install manifests. Empty for ${new URL(fallback).host}.`,
    input: { type: "url", placeholder: fallback, value: server === fallback ? "" : server }, buttons: ["Cancel", "Save"], cancel: 0 });
  if (index !== 1) return false;
  save(String(value ?? "").trim() || fallback);
  redraw();
  await check();
  return true;
}

// B20: the row that opens it, drawn as a field (F149): "Server" on the left, the host in the field blue-grey on the
// right, or the default's host in the grey hint colour (what the empty field falls back to).
export function serverRow({ server, fallback, ask }) {
  const own = server !== fallback;
  return { label: "Server", detail: new URL(server).host, subtitle: own ? null : "Default",
    cls: own ? "server-field" : "server-field-default", chevron: true, onClick: () => ask() };
}

const RUN_YOUR_OWN = `https://github.com/${GITHUB_REPO}/tree/main/worker#host-your-own-free-about-a-minute`;

async function checkServer() {
  const hide = showHUD("Checking");
  try {
    const st = await serverStatus();
    hide();
    const host = new URL(getServer()).host;
    // The app needs only manifests and the update hand-off (worker/ answers worker: true).
    if (st?.worker || st?.ok) await alertOK("Server Works", `${host} hands iOS the install manifests and holds ${NAME}'s own updates. Signing happens on this iPhone.`);
    else await alertOK("Server Not Ready", `${host} answers but isn't a Signing Server.`);
  } catch (e) {
    hide();
    await alertOK("Server Not Reachable", `${new URL(getServer()).host}: ${e.message || "no answer"}.`);
  }
}

async function drawSigning(el) {
  if (localSigning()) return drawDeviceSigning(el);
  if (browserSigning()) return drawSiteSigning(el);
  el.replaceChildren(grouped([{ footer: `Apps are signed in the ${NAME} app, on the iPhone itself, with your own certificate.` }]));
}

// The certificate, its profile and its password: one group of rows, each with its name on the left, its value in the
// middle and a Browse button on the right (a <label> over a hidden file input, so iOS opens its picker straight from
// the tap). F75: above them the big Select All Files button, the same multi-select picker: one pick of the .p12, the
// .mobileprovision and the password file (or their .zip) fills whatever is missing (core/certfiles.js sorts them and
// finds the password). Any row's Browse takes several files too.
// F134: Settings > Signing shows it as its "Files" group while files are picked but not all in (`files`: no Select
// All Files, which the Certificate group's Import row already is, and a one-line footer); the walkthrough as before.
export const certFilesFooter = (browser) => (browser
  ? "Your .p12, its .mobileprovision and the password. They stay in this browser, where apps are signed."
  : "Your .p12, its .mobileprovision and the password. Once all three are here, they go into this iPhone's Keychain.");
function certificateBlock(el, id, status = null, { files = false } = {}) {
  const kept = statusReady(status) ? status.identity : null; // F58: what the sideload build's Keychain holds
  const box = document.createElement("div");
  box.className = "group sign-files"; // a .group, like every grouped section: its 10px side margins
  const head = Object.assign(document.createElement("h3"), { className: "group-header", textContent: files ? "Files" : "Certificate" });
  const ul = document.createElement("ul");
  ul.className = "table grouped";
  const accept = ".p12,.pfx,.mobileprovision,.txt,.zip,application/x-pkcs12,application/zip,text/plain";
  const fileRow = (name, value, slot) => {
    const shown = Object.assign(document.createElement("span"), { className: "sign-value" + (value ? "" : " is-empty"), textContent: value || "None" });
    return signRow(name, shown, browseButton(accept, true, (files) => chooseFiles(el, files, slot)));
  };

  // F248: the password is its own group under the files (passwordBlock).
  const pw = passwordBlock(el, id, kept);

  // F69: in the sideload build a name stays on the row only while its file is picked (in memory) or the Keychain
  // holds the identity (statusReady), never as a leftover of an import the signer can't see.
  const p12Shown = !status || id?.p12 ? id?.p12Name ?? (kept ? "In Keychain" : null) : kept ? id?.p12Name ?? "In Keychain" : null;
  const profShown = !status || id?.profile ? id?.profileName ?? kept?.profile?.name : kept ? id?.profileName ?? kept.profile?.name : null;
  ul.append(fileRow(".p12", p12Shown, "p12"), fileRow(".mobileprovision", profShown, "profile"));
  // F316: one or two short sentences
  const foot = Object.assign(document.createElement("p"), { className: "group-footer",
    textContent: files ? "Browse for what's missing." : certFilesFooter(browserSigning()) });
  if (files) {
    box.append(head, ul, foot, pw);
    return box;
  }
  const [allInput, allLabel] = browseButton(accept, true, (picked) => chooseFiles(el, picked, null));
  allLabel.className = "walk-action sign-all";
  allLabel.textContent = "Select All Files";
  box.append(head, allInput, allLabel, ul, foot, pw);
  return box;
}

// F248: the Password group: a full-width secure field with the state's glyph before it (a lock while it waits, in a
// white row with a blue inset ring; a red x when wrong; a green check when it opens the .p12 or none is needed; a
// grey lock while the Keychain holds the identity), "Read From a .txt File" under it, and the state as its footer.
const PW_GLYPH = { none: "lock", waiting: "lock", unchecked: "lock", wrong: "wrong", right: "right", notNeeded: "right", kept: "kept" };
export function passwordState(id, kept = null) {
  const name = id?.p12Name || "the .p12";
  const s = (state, footer = "", extra = {}) => ({ state, glyph: PW_GLYPH[state], placeholder: `Password for ${name}`, footer, ...extra });
  if (!id?.p12) {
    return kept ? s("kept", "The certificate is in the Keychain. Its password isn't kept.", { placeholder: passwordPlaceholder(kept, null) })
      : s("none", "", { placeholder: passwordPlaceholder(kept, null) });
  }
  if (id.passwordOk === true) return id.password ? s("right", `Opens ${name}.`) : s("notNeeded", `${name} has no password.`, { placeholder: "Not Needed" });
  if (!id.password) return s("waiting", `${name} is locked. Type the password it was exported with.`);
  if (id.passwordOk === false) return s("wrong", `It doesn't open ${name}.`, { warn: "Wrong password." });
  return s("unchecked"); // typed, and this .p12 can't be checked here: the import (or the signer) tries it
}

// The state onto a drawn Password group (typing keeps its focus: no redraw).
function paintPasswordState(cell, input, foot, st) {
  cell.dataset.state = st.state;
  cell.querySelector(".sign-pw-glyph").className = `sign-pw-glyph pw-${st.glyph}`;
  input.placeholder = st.placeholder;
  input.readOnly = st.state === "notNeeded";
  foot.replaceChildren();
  if (st.warn) foot.append(Object.assign(document.createElement("b"), { className: "sign-pw-wrong", textContent: st.warn }), " ");
  foot.append(st.footer);
  foot.hidden = !st.warn && !st.footer;
  // B94: Read From a .txt File only while a password is still wanted
  const txt = cell.parentElement?.querySelector(".sign-pw-txt-cell");
  if (txt) txt.hidden = !wantsPasswordFile(st.state);
}
// B94: whether the Password group shows Read From a .txt File: not once the password opens the .p12 or none is needed.
export const wantsPasswordFile = (state) => state !== "right" && state !== "notNeeded";
// B94: the website's page redraws (its focus goes) only when the typed password made the certificate ready: once it
// opens the .p12, or, for a .p12 that can't be checked here, when the entry is finished. Never per keystroke.
export function siteBecameReady(before, now, done = false) {
  if (siteReady(before) && before?.passwordOk === true) return false;
  if (now?.passwordOk === true) return siteReady(now);
  return done && siteReady(now) && !siteReady(before);
}
function showPasswordState(el, id) {
  const cell = el.querySelector(".sign-pw-cell"), input = el.querySelector(".sign-pw-input"), foot = el.querySelector(".sign-pw-status");
  if (cell && input && foot) paintPasswordState(cell, input, foot, passwordState(id));
}

function passwordBlock(el, id, kept) {
  const box = document.createElement("div");
  box.className = "sign-password";
  const head = Object.assign(document.createElement("h3"), { className: "group-header", textContent: "Password" });
  const ul = document.createElement("ul");
  ul.className = "table grouped";
  const input = Object.assign(document.createElement("input"), { type: "password", className: "sign-value sign-field sign-pw-input",
    value: id?.password ?? "" });
  input.autocomplete = "off";
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("autocorrect", "off");
  input.setAttribute("aria-label", "Password");
  const cell = document.createElement("li");
  cell.className = "cell sign-pw-cell";
  const row = document.createElement("label");
  row.className = "cell-inner sign-pw-row";
  row.append(Object.assign(document.createElement("span"), { className: "sign-pw-glyph" }), input);
  cell.append(row);
  const foot = Object.assign(document.createElement("p"), { className: "group-footer sign-pw-status" });
  paintPasswordState(cell, input, foot, passwordState(id, kept));

  let timer = 0;
  // F58: in the sideload build a password that opens the .p12 (or, where it can't be checked here, a finished
  // entry) sends all three to the Keychain.
  const save = async (done = false) => {
    clearTimeout(timer);
    const before = await loadIdentity();
    await saveIdentity({ password: input.value });
    await recheckPassword(el, false);
    const now = await loadIdentity();
    if (localSigning()) {
      if (now?.passwordOk === true || (done && now?.passwordOk !== false)) await importIfComplete(el, true);
    } else if (siteBecameReady(before, now, done)) redrawAll(); // B94: the Certificate group's rows, no files group
  };
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(save, 500); });
  input.addEventListener("change", () => save(true));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });

  // Read From a .txt File: the password from a text file (its first line), a button row on a hidden file input.
  const [file] = browseButton(".txt,text/plain", false, async ([f]) => {
    if (!f || f.bytes.length > 4096) return;
    input.value = new TextDecoder().decode(f.bytes).split(/\r?\n/)[0];
    await save(true);
  });
  const txt = document.createElement("li");
  txt.className = "cell sign-pw-txt-cell";
  txt.hidden = !wantsPasswordFile(passwordState(id, kept).state);
  const btn = Object.assign(document.createElement("button"), { type: "button", className: "cell-inner sign-pw-txt", textContent: "Read From a .txt File" });
  btn.addEventListener("click", () => file.click());
  txt.append(btn, file);
  ul.append(focusOnRowTap(cell, input), txt);
  box.append(head, ul, foot);
  takePasswordFocus(el, input);
  return box;
}

// F149: the Password row's grey hint, iOS 6's "Required" (Mail's account fields), never the file rows' "None".
// "Not Kept" while the Keychain holds the identity and no .p12 is picked: the password isn't kept with it.
export function passwordPlaceholder(kept, p12) {
  return kept && !p12 ? "Not Kept" : "Required";
}

// F149: a tap anywhere on the row (its padding and edges too, outside the <label>) puts the caret in the field,
// except on the Browse button, which opens its picker.
export function focusOnRowTap(li, input) {
  li.addEventListener("click", (e) => {
    if (e.target === input || e.target?.closest?.(".sign-browse")) return;
    input.focus();
  });
  return li;
}

function signRow(name, value, button) {
  const li = document.createElement("li");
  li.className = "cell";
  const row = document.createElement(value.tagName === "INPUT" ? "label" : "div");
  row.className = "cell-inner sign-row";
  row.append(Object.assign(document.createElement("span"), { className: "cell-label", textContent: name }), value);
  li.append(row, ...button);
  return li;
}

// [hidden file input, its Browse label]; onFiles gets [{ name, bytes }].
function browseButton(accept, multiple, onFiles) {
  const input = Object.assign(document.createElement("input"), { type: "file", accept, multiple, className: "visually-hidden" });
  input.id = "f" + Math.random().toString(36).slice(2);
  const label = Object.assign(document.createElement("label"), { className: "bar-button sign-browse", textContent: "Browse" });
  label.htmlFor = input.id;
  input.addEventListener("change", async () => {
    const files = await Promise.all([...(input.files ?? [])].map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
    input.value = "";
    if (files.length) onFiles(files);
  });
  return [input, label];
}

// ---- Signing on the phone (F58) ------------------------------------------------------------------------------
// The sideload build: the same Certificate rows, but the picks wait in memory (signing-client.js) until the .p12, the
// profile and a password are there, then go to the Keychain through signing.import (I6, docs/signing.md "On the
// phone"). What the page shows comes from signing.status: the identity, its profile and their problem. F75: and the
// Signing Server, which hands iOS the manifest for the IPA iFizBox serves at 127.0.0.1 (the certificate never leaves
// the phone; the server sees the app's ID, version and name).

// F128: the root's Signing row, the certificate as its detail (the page explains the rest).
// F271: named Installation & Signing where it opens the merged page, without the certificate as its detail (beside
// the longer name it left "Installatio…" at 375pt; the page shows the certificate first thing).
// B148: the detail is live (nav/pagestate.js liveText): Back from Signing after an import or a removal shows the
// certificate now in use, in place. The merged row has no detail, so nothing to follow.
const signingRow = (box, detail) => box.replaceChildren(grouped([{ rows: [{ label: merged() ? MERGED_TITLE : "Signing", detail: "",
  ...(merged() ? {} : { live: detail }), href: format(settingsRoute(["signing"])), icon: rowIcon("signing") }] }]));
// F69: statusReady, the rule Install goes by: the row names a certificate only when Install will use it
export const deviceSigningDetail = (st, id) => (statusReady(st) ? (st.identity.name || "In Keychain") : id?.p12 || id?.profile ? "Incomplete" : "None");
const readDeviceSigning = () => Promise.all([deviceStatus().catch(() => null), loadIdentity()]);
export function deviceSigningSection(box, read = readDeviceSigning) {
  signingRow(box, () => read().then(([st, id]) => deviceSigningDetail(st, id)));
  return box;
}

// The staged .p12, profile and password into the Keychain, once all are there and the password isn't known to be
// wrong. True when imported. `typing`: the password field has focus, so a wrong password only updates its footer.
async function importIfComplete(el, typing) {
  const id = await loadIdentity();
  if (!id?.p12 || !id?.profile || id.password == null || id.passwordOk === false) return false;
  const hide = showHUD("Importing");
  let after;
  try {
    after = await importToDevice(id);
  } catch (e) {
    hide();
    if (e?.code === "wrong_password") {
      await saveIdentity({ passwordOk: false });
      if (typing) showPasswordState(el, { ...id, passwordOk: false });
      else redrawAll();
      return false;
    }
    await alertOK("Couldn't Import", deviceError(e).message);
    return false;
  }
  hide();
  // F69: the status the import answers must show the identity, as Install will look for it; if it doesn't, say why
  // instead of leaving the names on the rows as if it worked.
  if (after && !statusReady(after)) {
    await clearIdentity();
    await alertOK("Couldn't Import", after.identityProblem || `The certificate went into the Keychain but ${NAME} can't find it there. Remove it and import it again.`);
    redrawAll();
    return false;
  }
  // In the Keychain now: only the names stay in memory, for the rows.
  await clearIdentity();
  await saveIdentity({ p12Name: id.p12Name, profileName: id.profileName });
  redrawAll();
  return true;
}

async function removeDeviceCertificate() {
  const { index } = await showAlert({ title: "Remove Certificate?", message: "The certificate, its key and the profile are deleted from this iPhone's Keychain.",
    buttons: ["Cancel", "Remove"], cancel: 0 });
  if (index !== 1) return;
  try { await removeFromDevice(); } catch (e) { await alertOK("Couldn't Remove", deviceError(e).message); }
  await clearIdentity();
  redrawAll();
}

// Back in iFizBox (from Safari or the Files app): redraw, and while the Signing page is open look at signing.status
// every 2 s, so the walkthrough ticks the moment a certificate lands (the launch import of one that came inside the
// app, an import finished elsewhere). The app's web view doesn't always send visibilitychange, so focus and
// pageshow count too.
// B20: but the web view also gets window focus back on an ordinary tap (the first one after a keyboard or a native
// sheet went away), and a full redraw then swapped the rows under the finger: iOS dropped the click (the Signing
// Server row "can't be tapped"). Focus now only looks at signing.status and redraws when it changed, as the 2 s check
// does; visibilitychange (back from hidden) and pageshow still redraw at once.
let watchingReturn = false;
function watchReturn() {
  if (watchingReturn || typeof document === "undefined") return;
  watchingReturn = true;
  returnWatcher({ doc: document, win: globalThis, redraw: redrawAll, status: deviceStatus, interval: setInterval,
    back: () => { installStale = true; } }); // B140: a fresh Installation block after the background
}

// watchReturn's listeners, injectable for the tests. Returns the status check (what focus and the timer run).
export function returnWatcher({ doc, win, redraw, status, interval, back = () => {} }) {
  let last = null;
  const onPage = () => doc.visibilityState !== "hidden" && doc.querySelector(".page.is-top .walkthrough, .page.is-top .signing-page");
  const check = async () => {
    if (!onPage()) return;
    let st = null;
    try { st = await status(); } catch { return; }
    const now = String(statusReady(st));
    if (last !== null && now !== last) redraw();
    last = now;
  };
  const again = () => { if (doc.visibilityState !== "hidden") { back(); redraw(); } };
  doc.addEventListener("visibilitychange", again);
  win.addEventListener("pageshow", again);
  win.addEventListener("focus", check);
  interval(check, 2000);
  return check;
}

// F134: Settings > Signing as an iOS 6 settings page (signingPage below): the certificate (with Replace and Remove
// Certificate), the files while some are missing, the profile, Show Expiry Dates and Re-sign Reminder, the Signing
// Server, Certificate Status and Signed Apps, and How Signing Works at the bottom. That link opens the walkthrough (screens/signing.js,
// drawSigningHelp), which keeps its steps, picture and Select All Files.
async function deviceSigningState(el) {
  const id = await loadIdentity();
  let status = null, failure = null;
  try { status = await deviceStatus(); } catch (e) { failure = e; }
  return { id, status, failure, kept: statusReady(status) ? status.identity : null };
}

const serverGroup = (el) => grouped(serverSections(el));
// F300: the same rows as sections, for Install Apps With's page (screens/installroute.js drawInstallation `server`)
// with the Signing Server chosen.
export const serverSections = (el, { footer = false } = {}) => {
  const server = getServer();
  return [{ header: "Signing Server", ...(footer ? { footer: SERVER_FOOTER } : {}), rows: [
    { ...serverRow({ server, fallback: defaultServer(), ask: () => askServer(el) }), icon: rowIcon("server") },
    { label: "Check Server", onClick: () => checkServer(), icon: rowIcon("checkServer") },
    // Nothing depends on our own server: anyone can run their own, free (worker/README.md's Deploy to Cloudflare).
    { label: "Run Your Own", subtitle: "Free on Cloudflare, about a minute", chevron: true, icon: rowIcon("runYourOwn"),
      onClick: () => window.open(RUN_YOUR_OWN, "_blank", "noopener") }] }];
};
const SERVER_FOOTER = `Hands iOS the install manifests when apps don't install straight onto this iPhone, and holds ${NAME}'s own updates.`;

// F237: under Keep Bundle IDs, what the profile can't do with the ID kept (wildcard, development, no Push), or the
// old way's warning while it's off, with the guide's row. Nothing for an Ad Hoc profile with Push.
export function keepNotes(profile, keep) {
  return profileNotes(profile, { keep }).filter((n) => n.id !== "one-app");
}

// F315: Keep Bundle IDs' group footer, by state (AGENTS.md Hints: the footer turns into what's wrong when something
// is): off, the old way in a line; on, the profile's one notification problem, shortened (wildcard, development, no
// Push), with How to Get Notifications in the group (`guide`); else what the switch does. One sentence each.
export const KEEP_SHORT = {
  "old-way": "Off, each app becomes a copy under your ID, without its notifications.",
  wildcard: "Your wildcard profile can't get notifications for kept IDs.",
  development: "Your development profile gets only Apple's test notifications, which apps don't use.",
  "no-push": "Your profile has no Push, so kept IDs get no notifications.",
};
export function keepHint(profile, keep, fine = SETTINGS.find((d) => d.key === "keepBundleId")?.footer ?? "") {
  const note = keepNotes(profile, keep)[0];
  if (!note) return { footer: fine, guide: false };
  return { footer: KEEP_SHORT[note.id] ?? note.text, guide: Boolean(note.guide) };
}

// Settings > Signing's generated groups (Show Expiry Dates and Re-sign Reminder; Keep Bundle IDs), with Keep Bundle
// IDs' footer by state and its guide row. The switch doesn't redraw the page (it keeps its slide), so the footer
// and the guide row follow it in place; nav/slide.js slides what moves.
function keepGroups(list, profile) {
  const has = (s) => s.settings.some((d) => d.key === "keepBundleId");
  const keep = keepOn((k) => settings.get(k));
  const guide = keepHint(profile, true).guide;
  const shaped = list.map((s) => (has(s) ? { ...s, footer: keepHint(profile, keep).footer,
    extraRows: guide ? [{ label: GUIDE_LINK, href: keepGuideHref() }] : [] } : s));
  const frag = settingsGroups(shaped, "signing");
  const group = frag.querySelector?.('.switch[data-key="keepBundleId"]')?.closest(".group");
  if (!group) return frag;
  const foot = group.querySelector(".group-footer");
  const cells = group.querySelectorAll(".table > *");
  const guideRow = guide ? cells[cells.length - 1] : null;
  if (guideRow) guideRow.hidden = !keep;
  const off = settings.onChange((key) => {
    if (key !== "keepBundleId") return;
    if (!group.isConnected) { off(); return; } // a redraw replaced it, or its page was popped
    const on = keepOn((k) => settings.get(k));
    if (foot) foot.textContent = keepHint(profile, on).footer;
    if (guideRow) guideRow.hidden = !on;
  });
  return frag;
}

// B140: the page redraws whole each time one of its other slow calls answers (asc.key.info, signing.installed,
// signing.status). A new installationBlock each time asked idevice.status and idevice.developerMode again and put
// This iPhone's rows back to Checking… So the page keeps its block (which repaints itself, and goes on with its
// reads after it moves into the new page) and builds a new one only when the Install Apps With choice changed, the
// app came back from the background (visibilitychange/pageshow: the pairing or VPN may have changed meanwhile), or
// the kept one is older than INSTALL_KEEP_MS. Pure, for the tests.
export const INSTALL_KEEP_MS = 30000;
export function keepInstallBox(kept, { choice, now, stale = false }) {
  return Boolean(kept) && !stale && kept.choice === choice && now - kept.at < INSTALL_KEEP_MS;
}
const installKept = new WeakMap(); // page element → { box, choice, at }
let installStale = false; // set by watchReturn's back-from-background redraw
function keptInstallation(el) {
  const choice = settings.get(ROUTE_KEY);
  const now = Date.now();
  const kept = installKept.get(el);
  if (keepInstallBox(kept, { choice, now, stale: installStale })) return kept.box;
  installStale = false;
  const box = installationBlock({ store: settings });
  installKept.set(el, { box, choice, at: now });
  return box;
}

// F284: Installation & Signing's main page (screens/installroute.js mainPage), built once per page and refreshed in
// place on every later draw (a setting changed, back from the background, the signing status changed): no rebuild,
// no row back to its spinner.
const mainKept = new WeakMap(); // page element → mainPage
const signingLink = (sub) => format(settingsRoute(["signing", sub]));
const installLink = (sub) => format(settingsRoute([INSTALLATION, sub]));
function drawMain(el) {
  watchReturn();
  let m = mainKept.get(el);
  if (!m || m.el.parentNode !== el) {
    m = mainPage({
      store: settings,
      links: { with: installLink("with"), certificate: signingLink("certificate"), apps: signingLink("apps"), help: signingLink(HELP) },
      signing: async () => {
        const { id, status, failure, kept } = await deviceSigningState(el);
        if (!failure && typeof CustomEvent === "function") globalThis.dispatchEvent?.(new CustomEvent("ifizbox:signing-status", { detail: kept })); // F244
        offerInstall(missingStep(status, getServer()) == null); // F177
        // B250: `ready` (a certificate kept) lets the status cell say Import Your Certificate; unknown when the read failed
        return { certificate: failure ? { text: "Unknown" } : certificateDetail(kept, { staged: Boolean(id?.p12 || id?.profile) }),
          ...(failure ? {} : { ready: Boolean(kept) }) };
      },
      apps: async () => {
        const n = nativeBridge();
        try { return String(signedAppRows(await n.call("signing.installed", {})).length); } catch { return ""; }
      },
      checkServer: () => checkServer(),
      host: () => { try { return new URL(getServer()).host; } catch { return ""; } },
    });
    mainKept.set(el, m);
    el.replaceChildren(m.el);
  }
  m.refresh();
}

// B148: a Settings page shown again (Back to it) refreshes in place what it read from state when it was drawn. Rows
// with a `live` detail (the root's iFizBox Account and Signing, list rows' choices, Ignored Upgrades, Blocked) follow
// on their own (nav/pagestate.js liveText); these pages refresh their own:
//   Installation & Signing   the main page's refresh() (F284: every slot in place)
//   This iPhone              idevice.status again, its rows' details patched (installroute.js refreshInstallation)
//   Certificate              the certificate and profile rows' details from signing.status again
const patchEl = (el, rows) => patchDetails(cellsOf(el), rows);
export function settingsShown(route, el, { main = (e) => mainKept.get(e), installation = refreshInstallation, certificate = refreshCertificate,
  isMerged = merged } = {}) {
  const [first, second] = pathOf(route);
  if (opensMerged([first, second], isMerged())) return main(el)?.refresh();
  if (first === INSTALLATION && second && second !== "pair") return installation(el, second, { store: settings, patch: patchEl });
  if (opensSigningSub([first, second], isMerged()) && second === "certificate") return certificate(el);
  return undefined;
}
onPageShow((r) => r.tab === "settings", (route, el) => settingsShown(route, el));

// The Certificate page's rows as drawDeviceSigning draws them, from a fresh read (for the patch above).
export function certificateRows({ kept, staged }) {
  const info = deviceSummary(kept);
  const split = splitSummary(info.rows);
  const cert = kept && split.certificate.length ? split.certificate : [{ label: "Certificate", detail: staged ? "Incomplete" : "None" }];
  return [...cert, ...split.profile, ...(deviceRows(info.device)?.rows ?? [])];
}
async function refreshCertificate(el) {
  const { id, failure, kept } = await deviceSigningState(el);
  if (failure) return;
  patchEl(el, certificateRows({ kept, staged: Boolean(id?.p12 || id?.profile) }));
}

// F284: the Signing rows' pages: Certificate (the certificate, files, profile, account and options groups, and Share
// Your Certificate), Signing Server (Server, Check Server, Run Your Own), Signed Apps (Certificate Status and the list).
const CERTIFICATE_PARTS = ["certificate", "files", "profile", "account", "options"];
async function drawSigningSub(el, sub) {
  if (sub === "certificate") return drawDeviceSigning(el, { only: CERTIFICATE_PARTS });
  watchReturn();
  const page = document.createElement("div");
  page.className = "signing-page";
  if (sub === "server") {
    page.append(serverGroup(el), grouped([{ footer: `Hands iOS the install manifests when apps don't install straight onto this iPhone, and holds ${NAME}'s own updates.` }]));
  } else {
    const { kept } = await deviceSigningState(el);
    page.append(signingExtras({ identity: kept, redraw: redrawAll, dates: settings.get("showExpiry") }));
  }
  const top = el.scrollTop;
  el.replaceChildren(page);
  el.scrollTop = top;
}

async function drawDeviceSigning(el, { only = null } = {}) {
  if (!only && merged()) return drawMain(el);
  watchReturn();
  const { id, status, failure, kept } = await deviceSigningState(el);
  // F244: Home's certificate tile follows the status this page just read (an import, a removal, a new profile)
  if (!failure && typeof CustomEvent === "function") globalThis.dispatchEvent?.(new CustomEvent("ifizbox:signing-status", { detail: kept }));
  const info = deviceSummary(kept);
  const staged = Boolean(id?.p12 || id?.profile);
  const notes = [failure ? `The signer didn't answer: ${deviceError(failure).message}` : null, status?.identityProblem ?? null,
    ...info.problems].filter(Boolean);
  const split = splitSummary(info.rows);
  const parts = {
    certificate: () => certificateGroup(el, { rows: split.certificate, has: Boolean(kept), staged, notes,
      footer: CERT_KEPT_FOOTER, remove: () => removeDeviceCertificate() }),
    files: () => certificateBlock(el, id, status ?? { identity: null }, { files: true }),
    profile: () => profileGroup(split.profile, info.device), // F236: with "This iPhone is in the profile"
    account: () => accountGroup({ redraw: redrawAll }),
    options: () => keepGroups(settings.sections().filter((s) => s.page === "signing"), kept?.profile),
    server: () => serverGroup(el),
    status: () => signingExtras({ identity: kept, redraw: redrawAll, dates: settings.get("showExpiry") }),
    help: () => helpGroup(),
    install: () => keptInstallation(el), // F271: Install Apps With and This iPhone's groups
  };
  const layout = signingLayout({ mode: "sideload", certificate: Boolean(kept), staged, profile: split.profile.length > 0,
    options: settings.sections().some((s) => s.page === "signing") });
  if (only) { // F284: the Certificate page, with Share Your Certificate at its end
    parts.share = () => helpGroup({ howItWorks: false });
    showSigningPage(el, [...layout.filter((g) => only.includes(g)), "share"], parts);
  } else showSigningPage(el, mergedLayout(layout, merged()), parts);
  offerInstall(missingStep(status, getServer()) == null); // F177: Install sent the user here: Install Now once ready
}

// The walkthrough (F69, F75): Import Your Certificate (Select All Files, the rows, the Files picker's picture), then
// the Signing Server, ticked as each is done. walkOpen keeps the user's expand/collapse taps across redraws (and
// Install's redirect sets it: openAt).
async function drawSigningHelp(el) {
  if (localSigning()) {
    watchReturn();
    const { id, status, failure } = await deviceSigningState(el);
    const server = getServer();
    drawWalkthrough(el, {
      status, failure: failure ? deviceError(failure).message : "",
      certificate: certificateBlock(el, id, status ?? { identity: null }),
      server: serverGroup(el), serverUrl: server, open: walkOpen,
    });
    offerInstall(missingStep(status, server) == null); // F177
    return;
  }
  if (!browserSigning()) return drawSigning(el);
  const id = await loadIdentity();
  // The same walkthrough as the app's (user 2026-11-18: "the webpage one needs to match the ipa one"): step 1 the
  // certificate, step 2 the server, which on the website is this site itself (it holds the signed app for iOS).
  const ready = Boolean(id?.p12 && id?.profile && id?.passwordOk !== false);
  const here = grouped([{ rows: [{ label: location.host, subtitle: "This site holds each signed app for iOS" }] }]);
  drawWalkthrough(el, {
    status: ready ? { identity: { website: true } } : null,
    certificate: certificateBlock(el, id),
    server: here, serverUrl: location.origin, open: walkOpen,
    extra: [grouped([{ header: "How It Works",
      footer: "Install downloads the app, signs it in this browser with your certificate, and leaves the signed app on "
        + `${location.host} for 10 minutes so iOS can install it. Your certificate, key and password stay in this browser.` }])],
  });
  offerInstall(siteReady(id)); // F177
}

export const HELP = "help";
const HELP_TITLE = "How Signing Works";

// F134: which of SIGNING_GROUPS (core/settings.js, their order) the page shows. `certificate`: one is in use (the
// Keychain's, or the browser's .p12 with its profile); `staged`: files are picked but not all in, or the password
// is wrong; `profile`: there are profile rows; `options`: the build has Signing's settings. Pure, for the tests.
export function signingLayout({ mode, certificate = false, staged = false, profile = false, options = false, ready = false } = {}) {
  const site = mode === "site";
  const on = {
    certificate: true,
    // B94: no files (and with them no Password group) once the certificate is good: the site's ready identity, or
    // the sideload Keychain's with no picks left (its caller clears the picks after an import)
    files: staged && !(site && ready),
    profile,
    // own profiles with an App Store Connect key (devaccount.js), shown with or without a certificate: hiding it after
    // Remove Certificate made the API key look deleted (only Remove API Key deletes it)
    account: mode === "sideload" || site,
    options,
    server: mode === "sideload",
    status: mode === "sideload",
    app: site && ready,
    other: site,
    free: site && !certificate, // F254j: Use a Free Apple ID, while the website has no certificate
    // B118: no Remove Certificate group: its button is in the Certificate group (certificateActions)
    help: true,
  };
  return SIGNING_GROUPS.filter((g) => on[g]);
}

// F271: Installation & Signing's order: the "install" part (Install Apps With, then This iPhone's Set Up when it's
// chosen) above signingLayout's groups. Pure, for the tests.
export const mergedLayout = (layout, on = true) => (on ? ["install", ...layout] : layout);

// F134: core/signing.js summary()/deviceSummary() rows, split into the Certificate group (Name, Team, Expires) and
// the Provisioning Profile group (Name, Expires, Devices, App ID). Long values go under the label, where they wrap.
const CERT_LABELS = { Certificate: "Name", Team: "Team", "Certificate Expires": "Expires" };
const PROFILE_LABELS = { Profile: "Name", Type: "Type", "Profile Expires": "Expires", Devices: "Devices", "App ID": "App ID",
  "Certificates in Profile": "Certificates" };
export function splitSummary(rows = []) {
  const fit = (label, detail) => (String(detail).length > 16 ? { label, subtitle: detail } : { label, detail });
  return {
    certificate: rows.filter((r) => CERT_LABELS[r.label]).map((r) => fit(CERT_LABELS[r.label], r.detail)),
    profile: rows.filter((r) => PROFILE_LABELS[r.label]).map((r) => fit(PROFILE_LABELS[r.label], r.detail)),
  };
}

// The Certificate group: its rows (or None / Incomplete), then Import Certificate or Replace Certificate, a row that
// opens the file picker (the hidden multi-file input Browse uses, clicked in the tap's own handler so iOS allows it;
// a button row, so it shows the pressed look). Its footer is what's wrong, else `footer`.
// B118: once there is something to remove (a certificate in use, or files picked), Remove Certificate sits beside
// Import or Replace Certificate under the rows, two buttons in one row, the remove one red (ios6.css .pair-button,
// .delete-button): no group of its own at the bottom any more.
// `removable`: the website's stored identity counts even when its profile can't be read.
export function certificateActions({ has = false, staged = false, removable = has || staged } = {}) {
  const pick = has ? "Replace Certificate" : "Import Certificate";
  return removable ? [pick, "Remove Certificate"] : [pick];
}
export const CERT_KEPT_FOOTER = "Kept in this iPhone's Keychain.";
export const CERT_NONE_FOOTER = "Choose your .p12, its .mobileprovision and the password file, or their .zip.";
export const certificateFooter = ({ notes = [], has = false, footer = CERT_KEPT_FOOTER } = {}) =>
  (notes.length ? notes[0] : has ? footer : CERT_NONE_FOOTER);
function certificateGroup(el, { rows, has, staged, notes = [], footer, remove, removable }) {
  const list = has && rows.length ? rows : [{ label: "Certificate", detail: staged ? "Incomplete" : "None" }];
  const accept = ".p12,.pfx,.mobileprovision,.txt,.zip,application/x-pkcs12,application/zip,text/plain";
  const [input] = browseButton(accept, true, (files) => chooseFiles(el, files, null));
  const [pick, removeLabel] = certificateActions({ has, staged, removable });
  const action = { label: pick, cls: "sign-import", onClick: () => input.click() };
  // F316: only the most important problem (the first: the signer, then the identity, then expiry and password)
  const frag = grouped([{ header: "Certificate", rows: removeLabel ? list : [...list, action],
    footer: certificateFooter({ notes, has, footer }) }]);
  if (removeLabel) {
    const button = (label, cls, onClick) => Object.assign(document.createElement("button"),
      { type: "button", className: `cell-inner pair-button ${cls}`, textContent: label, onclick: onClick });
    const pair = document.createElement("div");
    pair.className = "button-pair";
    pair.append(button(pick, "sign-import", () => input.click()), button(removeLabel, "delete-button", () => remove()));
    const table = frag.querySelector(".table");
    table.after(pair);
    pair.append(input); // beside the buttons, not in one: a click inside a button would bubble back to its handler
  } else frag.querySelector(".sign-import")?.append(input);
  if (notes.length) frag.querySelector(".group-footer")?.classList.add("sign-warning");
  return frag;
}

// The Provisioning Profile group, with F236's "This iPhone" rows and the check's sentence as its footer (red when this
// iPhone isn't in the profile; Copy UDID puts the UDID on the clipboard for the developer account's Add Device).
// F316 (AGENTS.md Hints): three groups, never one joined footer: the profile's status rows (no hint), This iPhone (its
// UDID and Copy UDID) with deviceHint's state hint, and the website's Find This iPhone's UDID on its own (profileLayout).
export function profileLayout(rows, device, find = null) {
  const extra = deviceRows(device, { find: Boolean(find) });
  if (!extra) return { sections: [{ header: "Provisioning Profile", rows }], warn: false };
  return { sections: [{ header: "Provisioning Profile", rows }, { rows: extra.rows, footer: extra.footer },
    ...(find ? [{ rows: find.rows, ...(find.footer ? { footer: find.footer } : {}) }] : [])], warn: extra.warn };
}
function profileGroup(rows, device, find = null) {
  const { sections, warn } = profileLayout(rows, device, find);
  const copy = (r) => (r.copy ? { label: r.label, cls: "sign-copy-udid", onClick: (e) => copyUdid(r.copy, e) } : r);
  const frag = grouped(sections.map((s, i) => (i === 1 ? { ...s, rows: s.rows.map(copy) } : s)));
  if (warn) frag.querySelectorAll(".group")[1]?.querySelector(".group-footer")?.classList.add("sign-warning");
  return frag;
}

async function copyUdid(udid, e) {
  const label = e?.currentTarget?.querySelector?.(".cell-label") ?? null;
  try {
    await navigator.clipboard.writeText(udid);
    if (label) label.textContent = "Copied";
  } catch {
    await showAlert({ title: "UDID", message: udid, buttons: ["OK"] }); // no clipboard: show it to copy by hand
  }
}

const SIDEDROP = "https://github.com/RyanAHayden/sidedrop";
// How Signing Works, then Share Your Certificate: SideDrop, a site the certificate's owner runs so friends can sideload too.
const helpGroup = ({ howItWorks = true } = {}) => {
  const f = document.createDocumentFragment();
  if (howItWorks) f.append(grouped([{ rows: [{ label: HELP_TITLE, href: format(settingsRoute(["signing", HELP])), icon: rowIcon("help") }] }]));
  f.append(grouped([{ rows: [{ label: "Share Your Certificate", subtitle: "Help your friends sideload with SideDrop", chevron: true,
      icon: rowIcon("shareCert"), onClick: () => window.open(SIDEDROP, "_blank", "noopener") }],
    footer: SHARE_FOOTER }]));
  return f;
};
export const SHARE_FOOTER = "SideDrop signs apps for your friends' iPhones with your certificate. Share it only with people you trust: they can pull it out.";

// The page from its parts, in signingLayout's order, keeping the scroll position.
function showSigningPage(el, layout, parts) {
  const page = document.createElement("div");
  page.className = "signing-page";
  for (const g of layout) if (parts[g]) page.append(parts[g]());
  const top = el.scrollTop;
  el.replaceChildren(page);
  el.scrollTop = top;
}

// ---- Update Alerts (I3) ---------------------------------------------------------------------------------------
// iFizBox's own update check has no page (F183): essential-ui.js lookForUpdates runs on every launch and Reload.

// The sideload app: what iOS lets iFizBox do for update alerts (badges, notifications, Background App Refresh) and
// when the background check last ran. A "no" given once can only be changed in iOS Settings: the row opens it.
// F285, F311: iOS 6 Settings style, what you get first, how it's checked after; each footer explains only its own
// group (AGENTS.md, Hints):
//   Update Alerts          Notifications (iOS), Icon Badge (iOS), <NAME> Updates (selfUpdateAlerts); with Icon Badge
//                          off in iOS: Notifications, Icon Badge, Turn On in Settings, the footer says it's off,
//                          and <NAME> Updates in a group of its own under it
//   Checking for Updates   Push, Last Push; Push's footer (core/push.js pushRows: what it does, or what's wrong)
//   (no header)            Background Check, Background App Refresh and Notifications (iOS, each only when off),
//                          Last Check, Turn On in Settings (only when one is off); the footer says what's off, else
//                          when the check runs
// No Push group when push can't work here: the Background Check group then takes the header.
// `push`: core/push.js pushRows (null: no Push rows, as when push can't work here or its state can't be read). Switch rows carry `toggle`:
// "ours" (Background Check), "ios" (opens iOS Settings), "push", "self".
export function notifyRows(st, now = Date.now(), { push = null, selfAlerts = true } = {}) {
  const g = checkRows(st, now, { pushOn: Boolean(push?.rows[0]?.on) });
  if (!g) return null;
  const row = (label) => g.rows.find((r) => r.label === label);
  const self = SETTINGS.find((d) => d.key === "selfUpdateAlerts");
  const selfRow = { label: self.label, detail: selfAlerts ? "On" : "Off", on: selfAlerts, toggle: "self" };
  // B207: Icon Badge off in iOS (once iOS has been asked): an update alert can't badge the icon, so the group says so
  // with the fix row, and the <NAME> Updates switch takes a group of its own for its footer (one hint per group).
  // Notifications off too, with the check on: its group already says so with the same fix row; one is enough.
  const badgeOff = st.badges === false && st.status !== "notDetermined" && (st.alerts !== false || st.backgroundOn === false);
  const alertGroups = badgeOff
    ? [{ header: "Update Alerts", rows: [row("Notifications"), row("Icon Badge"), { label: "Turn On in Settings", chevron: true, open: true }],
      footer: "Icon Badge is off in iOS, so update alerts can't show a count on the icon." }, { rows: [selfRow], footer: self.footer }]
    : [{ header: "Update Alerts", rows: [row("Notifications"), row("Icon Badge"), selfRow], footer: self.footer }];
  return [...alertGroups, ...checkGroups(g, push)];
}
function checkGroups(g, push) {
  const check ={ rows: g.rows.filter((r) => r.check).map(({ check: _, ...r }) => r), footer: g.footer };
  if (!push) return [{ header: "Checking for Updates", ...check }];
  return [{ header: "Checking for Updates", rows: [{ ...push.rows[0], toggle: "push" }, ...push.rows.slice(1)],
    footer: push.footer }, check];
}
function checkRows(st, now, { pushOn = false } = {}) {
  if (!st) return null;
  const onOff = (v) => (v ? "On" : "Off");
  const ago = (iso) => {
    const t = Date.parse(iso ?? "");
    if (Number.isNaN(t)) return "Not yet";
    const m = Math.round((now - t) / 60000);
    return m < 1 ? "Just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
  };
  // what iOS has off that the check needs (asked only while the check is on: turned off here, nothing to fix)
  const on = st.backgroundOn !== false;
  const noRefresh = on && !st.backgroundRefresh;
  const noAlerts = on && !st.alerts;
  const footer = !on ? `Off, updates are found only while ${NAME} is open${pushOn ? " or Push brings them" : ""}.`
    : noRefresh && noAlerts ? "Background App Refresh and Notifications are off in iOS, so this check can't run or alert you."
      : noRefresh ? "Background App Refresh is off in iOS, so this check can't run."
        : noAlerts ? "Notifications are off in iOS, so this check can't alert you."
          : pushOn ? "Used when Push can't reach this iPhone. iOS decides when it runs, usually every few hours."
            : "iOS decides when this runs, usually every few hours.";
  return { rows: [
    // switch rows (our iOS 6 switch, notifySection): ours to flip, or iOS's (flipping opens its Settings). `check`:
    // the Background Check group's rows, in order; the others are Update Alerts'.
    { label: "Background Check", detail: onOff(on), on, toggle: "ours", check: true },
    { label: "Icon Badge", detail: onOff(st.badges), on: Boolean(st.badges), toggle: "ios" },
    { label: "Notifications", detail: onOff(st.alerts), on: Boolean(st.alerts), toggle: "ios" },
    ...(noRefresh ? [{ label: "Background App Refresh", detail: "Off", on: false, toggle: "ios", check: true }] : []),
    ...(noAlerts ? [{ label: "Notifications", detail: "Off", on: false, toggle: "ios", check: true }] : []),
    { label: "Last Check", detail: ago(st.lastCheck), check: true },
    ...(noRefresh || noAlerts ? [{ label: "Turn On in Settings", chevron: true, open: true, check: true }] : [])],
  footer };
}
function notifySection() {
  const box = document.createElement("div");
  const n = nativeBridge();
  if (detectMode() !== "sideload" || !n?.call) return box;
  const push = pushActions({ native: n });
  const redraw = () => box.replaceWith(notifySection());
  Promise.all([Promise.resolve(n.call("app.notifyStatus", {})), push.info().then(pushRows, () => null)]).then(([st, pg]) => {
    const groups = notifyRows(st, Date.now(), { push: pg, selfAlerts: settings.get("selfUpdateAlerts") });
    if (!groups) return;
    const openIOS = () => {
      n.call("app.openSettings", {});
      // back from iOS Settings: show what was changed there
      const back = () => { if (document.visibilityState !== "visible") return; document.removeEventListener("visibilitychange", back); redraw(); };
      document.addEventListener("visibilitychange", back);
    };
    const flip = {
      ours: (on) => Promise.resolve(n.call("updates.background", { on })).then(redraw, () => {}),
      ios: () => openIOS(),
      push: (on) => push.toggle(on).then(redraw),
      self: (on) => { settings.set("selfUpdateAlerts", on); import("../app-updates.js").then((m) => m.selfAlertsChanged()).catch(() => {}); },
    };
    const frag = grouped(groups.map((g) => ({ ...g, rows: g.rows.map((r) => (r.open ? { label: r.label, chevron: true, onClick: openIOS }
      : r.toggle ? { label: r.label } : r)) })));
    // Our iOS 6 switch in each switch row, in place of an On/Off text.
    const cells = [...frag.querySelectorAll(".cell")];
    const rows = groups.flatMap((g) => g.rows);
    cells.forEach((li, i) => {
      const r = rows[i];
      if (!r?.toggle) return;
      const sw = createSwitch({ label: r.label, checked: r.on, onToggle: (on) => flip[r.toggle](on) });
      li.querySelector(".cell-inner").append(sw);
      li.querySelector(".cell-inner").classList.add("has-switch");
    });
    box.replaceChildren(frag);
  }, () => {});
  return box;
}

// ---- Signing on the website (F93, as before F89) --------------------------------------------------------------
// The .p12, its password and the .mobileprovision in this browser's IndexedDB (signing-client.js); Install on an app
// page and Home's Install iFizBox App sign in the browser with them (zsign as WebAssembly, signing-worker.js) and the
// Worker only hosts the signed IPA for iOS's install prompt.

export function siteSigningDetail(id) {
  if (id?.profile) {
    try { return summary({ profile: parseProfile(id.profile) }).rows[0].detail; } catch { return "Unreadable"; }
  }
  return id?.p12 ? "Incomplete" : "None";
}
function siteSigningSection(box) {
  signingRow(box, () => loadIdentity().then(siteSigningDetail)); // B148: live
  return box;
}

// Install iFizBox App, green, once the certificate works, with Bring My Certificate under it.
const installApp = () => signAndInstall({ url: APP_IPA_URL, name: APP_NAME, bring: getBring() });
function siteAppSection(id) {
  if (!(id?.p12 && id?.profile && id.passwordOk !== false)) return [];
  const frag = grouped([{ rows: [{ label: `Install ${NAME} App`, onClick: installApp, icon: { text: "" } }],
    footer: `${NAME} as an app, signed here with this certificate. It signs apps on the iPhone itself.` }]);
  frag.firstChild.classList.add("app-offer");
  frag.querySelector(".cell-icon")?.classList.add("home-glyph", "glyph-install");
  const bring = grouped([{ rows: [{ label: "Bring My Certificate", icon: rowIcon("syncCert") }],
    footer: `Puts a copy of your certificate inside the app, so ${NAME} has it on first launch.` }]);
  const cell = bring.querySelector(".cell-inner");
  cell?.append(createSwitch({ label: "Bring my certificate into the app", checked: getBring(), onToggle: (on) => setBring(on) }));
  cell?.classList.add("has-switch");
  return [frag, bring];
}

// F96's Install on the Website and Home's lock moved to General > Website (F145: screens/website-settings.js).

async function removeSiteCertificate() {
  const { index } = await showAlert({ title: "Remove Certificate?", message: "The .p12, its password and the profile are deleted from this browser.",
    buttons: ["Cancel", "Remove"], cancel: 0 });
  if (index !== 1) return;
  await clearIdentity();
  redrawAll();
}

// F253: Find This iPhone's UDID on the website (screens/signing.js udidFindRows). F316: its row opens the page with
// the steps (drawUdidPage), whose Download Profile row starts the visit.
function siteUdidFind(check) {
  const find = udidFindRows(check, { pending: Boolean(udidPending()), can: canFindUdid() });
  if (!find) return null;
  const href = format(settingsRoute(["signing", UDID_PAGE]));
  return { ...find, rows: find.rows.map(({ find: _, ...r }) => ({ ...r, href })) };
}

function drawUdidPage(el) {
  watchUdid(() => redrawAll());
  const sections = udidPageSections({ pending: Boolean(udidPending()), udid: storedUdid()?.udid ?? null });
  const top = el.scrollTop;
  const wire = ({ start, ...r }) => (start ? { ...r, onClick: () => findUdid() } : r);
  el.replaceChildren(grouped(sections.map((s) => (s.rows ? { ...s, rows: s.rows.map(wire) } : s))));
  el.scrollTop = top;
}

async function findUdid() {
  let url;
  try { url = await startUdid(); } catch (e) {
    await showAlert({ title: "Couldn't Ask for the UDID", message: String(e?.message || e), buttons: ["OK"] });
    return;
  }
  watchUdid(() => redrawAll());
  redrawAll();
  location.href = url; // iOS: "This website is trying to download a configuration profile" (Allow)
}

async function drawSiteSigning(el) {
  const id = await loadIdentity();
  let profile = null;
  try { profile = id?.profile ? parseProfile(id.profile) : null; } catch { /* checked when picked */ }
  const info = summary({ profile, passwordOk: id?.passwordOk ?? null, password: id?.password ?? null });
  const ready = Boolean(id?.p12 && id?.profile && id?.passwordOk !== false);
  const staged = Boolean(id?.p12 || id?.profile) && !ready;
  const rows = profile ? [{ label: "Profile", detail: profile.name || "Unnamed" }, { label: "Type", detail: profileKind(profile) }, ...info.rows] : [];
  const split = splitSummary(rows);
  const check = profile ? deviceCheck(profile, storedUdid()) : null; // F253: the UDID the profile service fetched
  watchUdid(() => redrawAll());
  const parts = {
    certificate: () => certificateGroup(el, { rows: split.certificate, has: ready && Boolean(profile), staged, notes: info.problems,
      footer: "Kept in this browser only. Apps are signed here, not on a server.", remove: () => removeSiteCertificate(),
      removable: ready || staged }),
    files: () => certificateBlock(el, id, null, { files: true }),
    // F236: the website can't read the UDID itself: F253's profile fetches it (Find This iPhone's UDID), else a
    // profile that lists devices says how to check it
    profile: () => profileGroup(split.profile, check ? deviceCheckText(check) : null, siteUdidFind(check)),
    account: () => accountGroup({ native: false, redraw: redrawAll }),
    options: () => keepGroups(settings.sections().filter((s) => s.page === "signing"), profile),
    app: () => { const f = document.createDocumentFragment(); f.append(...siteAppSection(id)); return f; },
    // F254j: the same Free Apple ID group as How Signing Works' (it stays hidden unless the Worker's relay is on)
    free: () => freeRouteBlock(),
    help: () => helpGroup(),
  };
  showSigningPage(el, signingLayout({ mode: "site", certificate: ready, staged, profile: split.profile.length > 0, ready,
    options: settings.sections().some((s) => s.page === "signing") }), parts);
  offerInstall(siteReady(id)); // F177: Install sent the user here: Install Now once ready
}
