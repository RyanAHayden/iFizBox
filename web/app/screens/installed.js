// Installed tab (F7): the packages dpkg has on the device, from its status file (core/installed.js, parsed in the
// worker's catalog). In the app the native backend reads the file; on the site the visitor chooses it here, and it
// stays on the device (catalog.js setStatus). A plain list with Cydia's A–Z headers, like every package list;
// rows open the package page (screens/browse.js tokens below the root, as on the Changes tab).
//
// F30: without a jailbreak (the site, the sideload build) the root lists the apps the user installed from an app
// page instead (core/installed.js apps(), recorded on the device), newest first, with an Upgrade badge when a
// source has a newer version; Edit or a left swipe deletes one the user removed from the phone. On the site the
// dpkg list above stays for jailbroken phones, one row down at #installed/dpkg. Jailbreak mode is F7 unchanged.
//
// F77: a My IPAs row under the apps opens the user's own IPAs (screens/myipas.js, #installed/myipas/...).
//
// F87: in the jailbreak app, apps iFizBox remembers (core/installed.js) are on an Apps page one row down
// (#installed/apps, the row above dpkg's packages, there only when it has any), listed at the version on the phone
// (app-updates.js rememberedApps, I4) with the note where it differs from what iFizBox remembered.
//
// F91: in the sideload app every app iFizBox signed (signing.installed) shows its signature's days left on the right,
// a small pill (core/signing.js signatureState; packages.css .sig-pill): green outside the re-sign window (Settings >
// Signing > Re-sign Reminder), amber inside it, red once expired. Signed apps the list doesn't remember (My IPAs,
// Custom Install as another ID) are listed under them, without Delete (Signed Apps in Settings forgets those).
//
// F104: the dpkg list has a scope bar as on iOS 6's Usage screen: Name (A–Z, as before), Recent (newest install
// first, by the mtime of dpkg's info/<pkg>.list, which the jailbreak app reads: apt.installDates in Apt.swift;
// the site's uploaded status file has no dates, so no Recent there) and Size (Installed-Size, largest first).
//
// F127: Installed as Cydia's (user 2026-11-18). Cydia 1.1's segmented control in the nav bar, User | Expert | Recent
// (core/installed.js modeRows: User leaves out Essential packages and dependencies, Expert lists everything, Recent
// newest install first in day sections), replaces F104's Name/Recent/Size bar; Recent needs the jailbreak app's
// install dates, so the site's dpkg page has User | Expert. Under the Apps and Wish List rows, a search bar narrows
// the list as it is typed and Search's scope segments filter by kind (All, Tweaks, Themes, Apps). Without a jailbreak
// the apps list gets User (A–Z) | Recent (newest first, by day) and the search bar, no kinds (it is all apps).
//
// F130: User mode from apt's own marks: in the jailbreak app apt.autoInstalled (Apt.swift, /var/lib/apt/
// extended_states) names the packages apt installed only for another's dependency, and core/installed.js markedRows
// hides those instead of F127's guess (anything another installed package needs), which hid tweaks the user chose
// that others also need. Where the marks can't be read (the site's uploaded status file) the guess stays.
//
// F125: the Wish List lives here (it was a row on Home): a Wish List row with its count (a grey count badge) on the
// root, under the installed lists (beside Apps above dpkg's packages in the jailbreak app, so it isn't hundreds of rows
// down; a Packages section under the apps elsewhere), opens #installed/wishlist: the wished packages as a package
// list, Edit (the red minus, then Delete) or a left swipe removes one, as on the apps list.
//
// F147: the Wish List moved off the page into the nav bar (user 2026-11-18: "the wishlist should go in the top left
// instead of as an entry in installed"): a bordered "Wish List" bar button in the left slot of Installed's root (the
// apps list without a jailbreak, dpkg's list in the jailbreak app), with the count as Mail's "Inbox (3)" does,
// opening the same #installed/wishlist page. Edit was already on the right, so nothing had to move.
//
// F222: Manage, bulk actions on the apps list without a jailbreak (the sideload app, the site). The root's nav bar is
// Wish List | User/Recent | Manage (Add and the Install IPAs tile left: Install IPAs is Home's tile, linked from the
// list's footer and empty state). Manage: Select… | User/Recent (sorting and headers keep working) | Done; each row
// gets UIKit's multi-select circle (UIRemoveControlMulti*: a faint ring, red with a white tick when picked, the row
// pale blue), a grey line above the list counts what is picked and what there is, and a bottom toolbar in the nav
// bar's colours (myipas.css .myipa-toolbar) has Re-sign (n), Update (n) and Delete (n). Select… opens a sheet of
// presets (core/installed.js selectSheet); with every row picked it reads Deselect. Each toolbar action confirms with
// a sheet, then runs its jobs through the app queue (screens/queue.js runAppQueue) on the progress page, labelled
// "Re-signing Delta (1 of 3)" with the run's progress on its bar; the list (and its pills) loads again at the end.
// F240: in the sideload app the jobs go through Confirm's sign-ahead run instead (screens/queue.js runAppQueueRun:
// every app signed first, a row per app on the black page, one failure doesn't stop the rest); the website keeps
// runAppQueue.
// Signed apps the list doesn't remember that came from the user's own IPAs say "From My IPAs" (the signature
// record's url is library:..., native MyIPAs.fileOf) and re-sign from that file (signing.resign does).
import * as browse from "./browse.js";
import * as myipas from "./myipas.js";
import { grouped, plain, placeholder, segments, barButton, note } from "../nav/ui.js";
import { searchBar, pinned } from "../nav/searchbar.js";
import { format, mounted, parse } from "../router.js";
import { catalog, ALL } from "../catalog.js";
import { showAlert } from "../nav/alert.js";
import { detectMode } from "../core/settings.js";
import { apps, appRows, appUpgrades, removeInstall, onAppsChange, MODES, MODE_LABEL, TYPES, modeRows, typeRows, queryRows,
  dayHeaders, dayLabel, markedRows, manageKinds, manageable, presetIds, selectSheet, selectLabel, manageCounts, manageSummary,
  manageToolbar, pruneSelection, SELECT } from "../core/installed.js";
import { signedAppsNamed } from "../core/installed.js"; // B150
import { recordInstall, unrecordedSigned, sourceRecordFor } from "../core/installed.js"; // B156
import { creditedRecords, recreditedRecords, urlCredit, recordWithCredit } from "../core/installed.js"; // B247
import { siteSignedApps } from "../core/installed.js"; // F342
import { mediaUrl } from "./depiction.js";
import { rememberedApps } from "../app-updates.js";
import { signatureState, signedIndex, resignWindow } from "../core/signing.js";
import { settings } from "../settings-store.js";
import { wishRows, wishCount, WISH_EMPTY } from "../core/wishlist.js";
import { compareNames, indexLetter } from "../core/catalog.js";
import { NAME } from "../brand.js";
import { showActionSheet } from "../nav/actionsheet.js";
import { longPress } from "../nav/menu.js";
import { guarded } from "../nav/tapguard.js";
import { libraryCall } from "../signing/library.js";
import { resignJob, appJob, markedResignJob, markedVersionOnSource, markedResignProblem } from "../core/appqueue.js";
import { hudLine } from "../core/progress.js";
import { deviceError } from "../core/signing.js";
import { getBackend } from "../backend.js";
import { nativeBridge, hasNativeCall } from "../native.js"; // C30
import { liveHUD } from "../nav/hud.js";
import { onPageOpen } from "../nav/pagestate.js";
import { pageViews } from "../nav/pageviews.js"; // C25
import { selectPreset } from "../nav/selection.js";
import { go as navGo, back as navBack } from "../nav/go.js";
import { flagPiracy, packageWarning, PIRACY_SUBTITLE } from "../core/warnings.js";
import { scanRequest, malwareFindings, removalIds, orphanFiles, malwareAlert, deleteConfirm } from "../core/known-malware.js";
import { installQueue } from "../queue.js";
import { rowIcon } from "../icons/rowicons.js";
import { siteEntries, libraryCounts, ipaCountText } from "../core/myipas.js";
import { tweakPill, tweakUpdateApps, runTweakUpdates } from "./tweaks.js"; // F302a
import { tweakCountText } from "../core/tweaks.js"; // F302a

// B46: Delete means what it says (user 2026-11-18: "I swiped and deleted an app in Installed and it just got rid of the
// icon, I had to remove it again"). In the jailbreak app, an app the helper sees in installd's containers (`actual`, I4)
// is uninstalled (ifizbox-helper uninstall-app, backend-native.js uninstallApp) behind a HUD, then its record goes.
// Where iFizBox can't uninstall (the sideload app, the site, a record of an app that is gone) the button is Remove from
// List, which drops the record at once (the app page's footer says deleting the app itself is done from the Home
// Screen). In the sideload app a row the shell reports installed (signing.isInstalled) isn't hidden: iOS's word wins
// over the record. A real uninstall is confirmed by an iOS 6 action sheet first (deleteAction, confirmDelete).

// B36: every row on the apps list opens a page (the source's package page, else an installed-app page for the record,
// #installed/app:<id>), a hold opens an action sheet (Open, Re-sign, Save Signed IPA, Remove: what applies) and a left
// swipe shows Delete on every row but iFizBox's own: Delete on a signed app the list doesn't remember (F91's extra
// rows) forgets it as Settings > Signed Apps does (signing.forget), on a remembered one removeInstall as before.

export const title = "Installed";

export const DPKG = "dpkg"; // the site's path segment for the status file's packages
export const APPS = "apps"; // F87: the jailbreak app's path segment for the remembered apps
export const WISH = "wishlist"; // F125: the Wish List page's path segment

// C25: per-page state. Installed's root can be on screen twice, its own tab and pushed on Home (the guides' Installed
// link: router.js rootOn), so every apps list and dpkg list page has a view of its own: its mode, kind, search text,
// Edit and Manage, its rows and its nav bar buttons. Loads (a catalog change, a recorded install) draw every live view.
// nav() makes the page's view (its buttons act on it) and render(), called right after for the same page (app.js
// drawPage), takes it over. A new page starts on the defaults (B43); Back and tab switches build nothing, so a page
// keeps what it showed.
const newDpkgView = () => ({ kind: "dpkg", route: null, list: null, results: null, seq: 0, dates: null, auto: null,
  mode: "user", type: "All", query: "", tail: [], rows: undefined, appCount: 0, wish: null });
const newAppView = () => ({ kind: "apps", route: null, results: null, seq: 0, editing: false, mode: "user", query: "", tail: [],
  last: null, managing: false, selected: new Set(), manageRows: [], signed: null, installedIds: null, tweakUps: null,
  right: null, summary: null, wish: null, hash: null });
const dpkgViews = pageViews(newDpkgView);
const appViews = pageViews(newAppView);
// The views nav() made last: the one the next render() takes, and what pageStates() and the exported helpers' defaults
// (tests) see before any page is drawn.
const latest = { dpkg: newDpkgView(), apps: newAppView(), pending: null };
function makeView(kind) {
  const view = kind === "apps" ? newAppView() : newDpkgView();
  latest[kind] = view;
  latest.pending = view;
  return view;
}
// render(): the view nav() just made for this page (its nav bar buttons act on it), or a new one where no nav() came
// first (tests). A page drawn again (app.js drawPage after a lazy load) gets the new one, as it got new buttons.
function takeView(kind, body, route) {
  const made = latest.pending?.kind === kind ? latest.pending : makeView(kind);
  latest.pending = null;
  made.route = route;
  return (kind === "apps" ? appViews : dpkgViews).adopt(body, made);
}
const dpkgLive = () => dpkgViews.all();
const appsLive = () => appViews.all();

// ---- F127: modes, kinds and search -----------------------------------------------------------------------------

// Whether install dates can be read (the jailbreak app: apt.installDates), so Recent can be offered.
export function canReadDates(native = nativeBridge()) {
  return typeof native?.call === "function" && typeof native?.dpkgStatus === "function";
}

// The modes the dpkg list offers.
export const dpkgModes = (hasDates) => MODES.filter((m) => m !== "recent" || hasDates);
// The apps list's: User (A–Z) and Recent; there are no dependencies or Essential apps to leave out.
export const APP_MODES = ["user", "recent"];

// What the dpkg list shows: the mode's rows of the kind, narrowed by the search; Recent with its day headers.
// F130: `auto` is apt's Auto-Installed set (autoInstalled), or null to keep the dependency guess.
export function dpkgItems(rows, { mode = "user", type = "All", query = "", dates = null, auto = null, locale } = {}) {
  const shown = queryRows(typeRows(modeRows(markedRows(rows, auto), mode, dates), type), query);
  return mode === "recent" ? dayHeaders(shown, dates, locale) : shown;
}

// The apps list's sections (nav/ui.js plain): User by name under A–Z headers, Recent newest first under day headers
// (r.date is in milliseconds), both narrowed by the search.
export function appSections(rows, { mode = "user", query = "", locale } = {}) {
  const shown = queryRows(rows, query);
  const out = [];
  if (mode === "recent") {
    for (const r of appRows(shown)) {
      const label = r.date > 0 ? dayLabel(r.date / 1000, locale) : NAME;
      if (out.at(-1)?.header !== label) out.push({ header: label, rows: [] });
      out.at(-1).rows.push(r);
    }
  } else {
    for (const r of [...shown].sort(compareNames)) {
      const label = indexLetter(r.name);
      if (out.at(-1)?.header !== label) out.push({ header: label, rows: [] });
      out.at(-1).rows.push(r);
    }
  }
  return out;
}

// { package: seconds } from apt.installDates (the jailbreak app), or null where it can't be read.
export async function installDates(native = nativeBridge()) {
  if (!canReadDates(native)) return null;
  try {
    const d = await native.call("apt.installDates", {});
    return d && typeof d === "object" && Object.keys(d).length ? d : null;
  } catch { return null; }
}

// F130: a Set of the packages apt marked Auto-Installed (apt.autoInstalled, the jailbreak app), or null where the
// marks can't be read: no dpkg (the site, the sideload build), an older shell, or no extended_states file.
export async function autoInstalled(native = nativeBridge()) {
  if (!canReadDates(native)) return null;
  try {
    const list = await native.call("apt.autoInstalled", {});
    return Array.isArray(list) ? new Set(list.filter((p) => typeof p === "string")) : null;
  } catch { return null; }
}


// Cydia's User | Expert | Recent, in the nav bar in place of the title (app.js titleView).
function modeControl(modes, current, onPick) {
  const wrap = Object.assign(document.createElement("div"), { className: "nav-segments" });
  wrap.append(segments(modes, MODE_LABEL, current, onPick));
  return wrap;
}

// The search bar (Search's look) that narrows `view`'s list as it is typed; with `types`, Search's kinds under it.
// C10: the shared bar (nav/searchbar.js, with Cancel); `types` is the dpkg list: tweaks, else apps.
function filterControls(view, { types = false, onChange }) {
  const bar = searchBar({ placeholder: types ? "Search Tweaks" : "Search Apps", ariaLabel: "Search installed packages",
    value: view.query ?? "", className: "installed-search" + (types ? " has-scope" : ""),
    onQuery: (q) => { if (q !== view.query) { view.query = q; onChange(); } } });
  if (!types) return [bar];
  const scope = Object.assign(document.createElement("div"), { className: "search-scope installed-scope" });
  scope.append(segments(TYPES, {}, view.type, (t) => { view.type = t; onChange(); }));
  return [bar, scope];
}

// Records apps (F30) rather than reading dpkg: everywhere but the jailbreak app.
export const recordsApps = (mode = detectMode()) => mode !== "jailbreak";

// Which page a route is: "apps" (F30's list), "dpkg" (the status file's packages), "myipas" (F77) or a browse.js page.
export function pageKind(route, mode = detectMode()) {
  if (route.path.length === 1 && route.path[0] === WISH) return "wishlist"; // F125, in every mode
  if (isAppPage(route, mode)) return "app"; // B36
  if (route.path[0] === myipas.MYIPAS) return "myipas"; // F209: ifizbox://myipas in the jailbreak app too
  if (!recordsApps(mode)) return !route.path.length ? "dpkg" : route.path.length === 1 && route.path[0] === APPS ? "apps" : "browse";
  if (!route.path.length) return "apps";
  return route.path.length === 1 && route.path[0] === DPKG && mode === "site" ? "dpkg" : "browse";
}

// B43: a page pushed onto the stack opens on its defaults (nav/pagestate.js): the apps and dpkg pages get a new view
// each (C25, above); the Wish List opens out of Edit. A tab root is built once, so Installed's own root keeps its
// choice; Back rebuilds nothing, so a page below keeps what it showed.
onPageOpen((r) => r.tab === "installed" && pageKind(r) === "wishlist", () => { wishView.editing = false; });
// The views nav() made last (the page drawn last of each kind), for tests.
export const pageStates = () => ({ apps: latest.apps, dpkg: latest.dpkg, wish: wishView });
// Every live apps list or dpkg list view (C25).
export const liveViews = () => ({ apps: appsLive(), dpkg: dpkgLive() });

const loadAllApps = () => { for (const v of appsLive()) loadApps(v); };

export function init(ctx) {
  // B81: the IPA queue's Q'd badge and Queue button (the jailbreak app's come from apt's queue, queue.js initQueue).
  if (recordsApps() && typeof document !== "undefined") import("./queue.js").then((q) => q.initAppQueueChrome(ctx), () => {});
  catalog.onChange(() => {
    for (const v of dpkgLive()) load(v);
    loadAllApps();
  });
  onAppsChange(() => {
    loadAllApps();
    for (const v of dpkgLive()) refreshAppCount({ view: v }); // B52: the root's Apps count, under the Apps page
  });
  // F125/F147: the count on the Wish List button, and the Wish List page, follow the list (the package page's sheet, a Delete).
  browse.wishlist().onChange(() => {
    if (wishView.body) loadWish();
    updateWishButton();
  });
  // F134: Settings > Signing > Show Expiry Dates puts the pills back or takes them away.
  settings.onChange((key) => { if (key === "showExpiry") for (const v of appsLive()) redrawApps(v); });
  // F269: back on Installed's root (built once, not drawn again), from Install IPAs or anywhere: count the IPAs again.
  if (typeof window !== "undefined") {
    window.addEventListener("hashchange", () => {
      const r = mounted(parse(location.hash));
      if (r.tab === "installed" && isRoot(r) && document.querySelector(".install-ipas-row")) loadIpaCounts();
    });
  }
}

export function nav(route, ctx) {
  const kind = pageKind(route);
  const view = kind === "apps" || kind === "dpkg" ? makeView(kind) : null; // C25: the page's own, taken by render()
  const info = navInfo(route, view);
  // F147: the Wish List button, top left of Installed's root (no back button there).
  if (isRoot(route)) {
    info.left = wishButton(route, wishCount(browse.wishlist().list(), knownInstalled(view)), { go: ctx?.go,
      ref: (b) => { if (view) view.wish = b; b.classList.add("wish-button"); updateWishButton(view); } });
  }
  // F222: while managing, the same button is Select… (or Deselect).
  if (isRoot(route) && kind === "apps") {
    const open = info.left.onClick;
    info.left.onClick = () => (view.managing ? selectButton({ view, sync: () => syncManage(view) }) : open());
  }
  return info;
}

function appsNav(view) {
  return { title: recordsApps() ? "Installed" : "Apps", style: "plain", // F87: "Apps" one row down in the jailbreak app
    // F127: User | Recent on the apps list's root (the jailbreak app's Apps page stays newest first).
    titleView: recordsApps() ? modeControl(APP_MODES, view.mode, (m) => pickMode(m, view)) : undefined,
    // F222: Manage (bulk Re-sign, Update, Delete), not Edit or F208's Add: a row still deletes with a swipe.
    right: recordsApps() ? { label: view.managing ? "Done" : "Manage", onClick: () => setManaging(!view.managing, view),
      ref: (b) => { view.right = b; b.classList.add("manage-button"); b.classList.toggle("done", view.managing); } }
      : { label: view.editing ? "Done" : "Edit", onClick: (e) => setEditing(!view.editing, e.currentTarget, view) } };
}

function dpkgNav(view) {
  const info = { title: recordsApps() ? "dpkg Status" : "Installed", style: "plain" };
  // F127: Cydia's User | Expert | Recent in place of the title.
  const modes = dpkgModes(canReadDates());
  if (!modes.includes(view.mode)) view.mode = "user";
  info.titleView = modeControl(modes, view.mode, (m) => { view.mode = m; if (view.body) drawList(view); });
  // The site: pick a newer status file whenever the phone's packages changed.
  if (catalog.statusSource() === "upload") info.right = { label: "Load", onClick: () => chooseStatus() };
  return info;
}

// The tab's pages, one entry each: `match` is the route's pageKind(), `nav` its bar (given the apps/dpkg page's own
// view, C25), `render` its page. nav() and render() only look the kind up here.
const ROUTES = [
  { match: "browse", nav: (route) => browse.nav(route), render: (body, route, ctx) => browse.render(body, route, ctx) },
  { match: "myipas", nav: (route) => myipas.nav(route), render: (body, route, ctx) => myipas.render(body, route, ctx) },
  { match: "app", nav: (route) => ({ title: appNames.get(appIdOf(route.path.at(-1))) || appIdOf(route.path.at(-1)) }),
    render: (body, route, ctx) => { renderAppPage(body, route, ctx); } },
  { match: "wishlist",
    nav: () => ({ title: "Wish List", style: "plain",
      right: { label: wishView.editing ? "Done" : "Edit", onClick: (e) => setWishEditing(!wishView.editing, e.currentTarget) } }),
    render: (body, route) => {
      wishView.body = body;
      wishView.route = route;
      body.append(placeholder("list"));
      loadWish();
    } },
  { match: "apps", nav: (route, view) => appsNav(view),
    render: (body, route) => {
      const view = takeView("apps", body, route);
      body.append(placeholder("list", 6));
      loadApps(view);
    } },
  { match: "dpkg", nav: (route, view) => dpkgNav(view),
    render: (body, route) => {
      const view = takeView("dpkg", body, route);
      body.append(placeholder("list"));
      load(view);
    } },
];

const routeOf = (kind) => ROUTES.find((r) => r.match === kind);

function navInfo(route, view) {
  return routeOf(pageKind(route)).nav(route, view);
}

export function render(body, route, ctx, page = null) {
  routeOf(pageKind(route)).render(body, route, ctx);
  if (isRoot(route)) handRootPage(page);
}

// The root page's handle to screens/queue.js, which keeps the Queue button on its nav bar; only where a queue shows
// one (the IPA queue's here, apt's in the jailbreak app), so the site never loads queue.js for it.
function handRootPage(page) {
  if (!page || typeof document === "undefined") return;
  if (!recordsApps() && typeof safeBackend()?.queue !== "function") return;
  import("./queue.js").then((q) => q.setInstalledRoot(page), () => {});
}

export function emptyText(source) {
  return source === "native"
    ? { label: "No packages", footer: "Couldn't read dpkg's status file." }
    : { label: "Choose Status File",
      footer: "Copy /var/jb/var/lib/dpkg/status (rootless) or /var/lib/dpkg/status off your iPhone, then choose it " +
        "here to see what's installed and which packages have upgrades. It stays on this device." };
}

// A dpkg list page's view (C25): its rows read again, then drawn.
async function load(view) {
  const seq = ++view.seq;
  let rows;
  let appCount = 0;
  let dates = null;
  let auto = null;
  if (!recordsApps()) loadIpaCounts(); // F269: the Install IPAs row's counts, painted in when they come
  try {
    // F87: the Apps row has to be there before the list measures where it starts (vlist.js caches the offset).
    [rows, appCount, dates, auto] = await Promise.all([catalog.installed(), recordsApps() ? 0 : jailbreakAppCount(), installDates(),
      autoInstalled()]);
  } catch (e) {
    if (seq === view.seq) view.body.replaceChildren(note(e.message));
    return;
  }
  if (seq !== view.seq) return;
  Object.assign(view, { rows, appCount, dates, auto });
  draw(view);
  checkMalware(); // F228: on opening Installed, and after every Refresh (catalog.onChange loads the list again)
}

// ---- F228: known malware (core/known-malware.js), in the jailbreak app ----------------------------------------

// What malware.scan (Apt.swift) found, as findings; [] where it can't look (the site, the sideload build, an older shell).
export async function scanMalware(native = nativeBridge(), mode = detectMode()) {
  if (mode !== "jailbreak" || typeof native?.call !== "function") return [];
  try { return malwareFindings(await native.call("malware.scan", scanRequest())); } catch { return []; }
}

// One alert per set of findings a session: what was found, why and where it is listed; Remove queues the packages
// (the IDs, and the packages that own the files), which opens the Confirm sheet as any queued change does.
const malwareSeen = new Set();
// F232: files no package owns get Delete where the backend can (removeMalware: ifizbox-helper remove-malware), after a
// confirm; the helper resprings, so this app ends there. A refusal or failure is shown in an alert.
export async function checkMalware({ scan = scanMalware, alert = showAlert, queue = installQueue, seen = malwareSeen,
  backend = null, hud = liveHUD } = {}) {
  const found = await scan();
  if (!found.length) return found;
  const sig = found.map((f) => f.path || f.id).sort().join("\n");
  if (seen.has(sig)) return found;
  seen.add(sig);
  const b = backend ?? safeBackend();
  const a = malwareAlert(found, { canDelete: typeof b?.removeMalware === "function" });
  const pick = await alert(a);
  const button = a.buttons.length > 1 ? a.buttons[pick?.index] : null;
  if (button === "Remove") for (const id of removalIds(found)) queue.add({ op: "remove", id });
  if (button === "Delete") await deleteMalwareFiles(orphanFiles(found), { alert, backend: b, hud });
  return found;
}

function safeBackend() {
  try { return getBackend(); } catch { return null; }
}

// F232: confirm, then one remove-malware run for every orphan file (deleted, then SpringBoard restarts).
async function deleteMalwareFiles(paths, { alert, backend, hud: makeHud }) {
  if (!paths.length) return;
  const sure = await alert(deleteConfirm(paths));
  if (sure?.index !== 1) return;
  const hud = makeHud(paths.length === 1 ? "Deleting File" : `Deleting ${paths.length} Files`);
  try {
    await backend.removeMalware(paths);
  } catch (e) {
    hud.hide();
    await alert({ title: "Couldn't Delete", message: e?.message || String(e), buttons: ["OK"] });
    return;
  }
  hud.done("Deleted");
}

// Draws the list from what load() read (F104: again when the sort changes, without asking the worker). `state`: the
// page's dpkg view (C25).
function draw(state) {
  const { rows, body } = state;
  const appCount = state.appCount ?? 0;
  browse.dropList(state.results?.parentNode === body ? state.results : body, state.list);
  state.list = null;
  if (!rows) {
    const t = emptyText(catalog.statusSource());
    body.classList.replace("plain", "grouped");
    body.replaceChildren(grouped([{
      rows: [{ label: t.label, onClick: catalog.statusSource() === "upload" ? () => chooseStatus() : null, chevron: false }],
      footer: t.footer,
    }]));
    return;
  }
  body.classList.replace("grouped", "plain");
  updateWishButton(state); // F147: dpkg's list is in, so the count leaves installed packages out
  // F87's Apps row (F147: F125's Wish List row is a nav-bar button now).
  const top = [appCount ? appsRow(state.route, appCount) : null].filter(Boolean);
  if (!recordsApps()) top.unshift(installIpasRow(state.route, ipaRowState.counts)); // F269: above the Apps row
  if (!rows.length) {
    body.replaceChildren(...(top.length ? [topTable(top, state.route)] : []), note("No packages."));
    return;
  }
  body.replaceChildren();
  // F127: the search bar and kinds go in before the list measures where it starts. C10: they stay put (nav/searchbar.js
  // pinned); the Apps row and the list scroll under them.
  state.results = pinned(body, ...filterControls(state, { types: true, onChange: () => drawList(state) }));
  if (top.length) state.results.append(topTable(top, state.route));
  state.tail = [];
  drawList(state);
}

// The list under the controls, again whenever the mode, the kind or the search changes (the field keeps its focus).
function drawList(state) {
  const { rows, body } = state;
  if (!rows?.length || !body) return;
  const results = state.results?.parentNode === body ? state.results : body;
  browse.dropList(results, state.list);
  state.list = null;
  for (const n of state.tail) n.remove();
  const { mode, dates, auto } = state;
  // F228: a package whose source is on the piracy list says so in place of its description.
  const items = flagPiracy(dpkgItems(rows, { mode, type: state.type, query: state.query, dates, auto }));
  if (!items.length) {
    state.tail = [note(state.query.trim() ? "No matches." : mode === "recent" ? "No install dates." : "No packages.")];
    results.append(...state.tail);
    return;
  }
  // Cydia: A–Z headers and the index for User and Expert, day headers for Recent.
  state.list = browse.packageList(results, state.route, items, { letters: mode !== "recent", wide: true }); // F348: Cydia's tall rows
  state.tail = [state.list.el];
  results.append(state.list.el);
}

// F87: how many apps (not iFizBox itself) the jailbreak app remembers; 0 when the store can't be read.
async function jailbreakAppCount() {
  try { return (await (await apps()).all()).filter((r) => r?.id && !r.self).length; } catch { return 0; }
}

function appsRow(route, n) {
  return { label: "Apps", subtitle: appsRowSubtitle(n), href: format({ tab: route.tab, path: [...route.path, APPS] }), cls: "installed-apps-row" };
}

// B291: the jailbreak app's rows above the package list (Install IPAs, Apps) as plain rows of the list, edge to edge
// at the package rows' height above the first letter header, not a rounded grouped card (packages.css .installed-top).
export function topTable(rows, route) {
  const ul = ipaTagged(plain([{ rows }]), route);
  ul.classList.add("installed-top");
  return ul;
}

// F269: the jailbreak app's top rows: the Install IPAs cell keeps its tab for paintIpaRows.
function ipaTagged(frag, route) {
  for (const li of frag.querySelectorAll?.(".install-ipas-row") ?? []) li.dataset.tab = route.tab;
  return frag;
}

export function appsRowSubtitle(n) {
  return n === 1 ? "1 app installed from an app page" : `${n} apps installed from an app page`;
}

// B52: the root stays in the page stack under the Apps page, so a Delete or Remove there (onAppsChange) counts the
// apps again for the root's Apps cell: its subtitle in place while the cell stays, the whole page when the cell
// comes or goes (vlist.js measures where the list starts). Nothing until load() has drawn the root.
export async function refreshAppCount({ view = latest.dpkg, mode = detectMode(), count = jailbreakAppCount, redraw = () => draw(view) } = {}) {
  if (recordsApps(mode) || !view.body || view.rows === undefined) return;
  const seq = view.seq;
  const n = await count();
  if (seq !== view.seq || n === (view.appCount ?? 0)) return; // load() is reading it afresh, or nothing changed
  const had = view.appCount ?? 0;
  view.appCount = n;
  const sub = had && n ? view.body.querySelector(".installed-top")?.querySelector(".installed-apps-row")?.querySelector(".cell-subtitle") : null;
  if (sub) sub.textContent = appsRowSubtitle(n);
  else redraw();
}

// ---- F147: the Wish List bar button ---------------------------------------------------------------------------

// Installed's root: the page whose left slot is free (every other Installed page has a back button there).
export const isRoot = (route) => route.path.length === 0;

// The button's label: `n` (wished, not installed) in brackets as Mail's "Inbox (3)", none at 0.
export const wishButtonLabel = (n) => (n > 0 ? `Wish List (${n})` : "Wish List");

// The Wish List page's route, under Installed's root whatever page asks.
export const wishRoute = (route) => ({ tab: route.tab, path: [WISH] });

// The nav bar spec for the button (app.js `left`): a tap opens the Wish List page; `ref` gets the drawn button.
export function wishButton(route, n, { go, ref } = {}) {
  const to = wishRoute(route);
  return { label: wishButtonLabel(n), ref,
    onClick: () => (go ?? navGo)(to) };
}

// The installed package ids known so far (the count leaves them out): dpkg's rows, or the apps page's ids; `view`'s
// own where it has them, else any live page's.
function knownInstalled(view = null) {
  const own = view?.rows ?? view?.installedIds;
  const any = own ?? dpkgLive().find((v) => v.rows)?.rows ?? appsLive().find((v) => v.installedIds)?.installedIds;
  return (any ?? []).map((r) => (typeof r === "string" ? r : r.id));
}

// The Wish List button of `view`'s page, or of every root page (C25: each copy has its own).
// The name may end in "…" on a narrow phone (the segmented title takes the middle); the count never does.
function updateWishButton(view = null) {
  if (!view) { for (const v of [...dpkgLive(), ...appsLive()]) if (v.wish) updateWishButton(v); return; }
  const b = view.wish;
  if (!b) return;
  if (view.managing && recordsApps()) { // F222: Select… / Deselect while managing
    const label = selectLabel(view.manageRows, view.selected);
    b.replaceChildren(label);
    b.setAttribute("aria-label", label === SELECT ? "Select" : label);
    return;
  }
  const n = wishCount(browse.wishlist().list(), knownInstalled(view));
  const name = Object.assign(document.createElement("span"), { className: "wish-name", textContent: "Wish List" });
  const count = n > 0 ? [Object.assign(document.createElement("span"), { className: "wish-count", textContent: `(${n})` })] : [];
  b.replaceChildren(name, ...count);
  b.setAttribute("aria-label", wishButtonLabel(n));
}

// A file picker for the status file; the read stays in the browser.
function chooseStatus() {
  const input = Object.assign(document.createElement("input"), { type: "file" });
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      await catalog.setStatus(await file.text());
    } catch (e) {
      await showAlert({ title: "Error", message: e.message, buttons: ["OK"] });
    }
  });
  input.click();
}

// ---- F30: the apps recorded on this device -------------------------------------------------------------------

// The newest version of each app on any source, from the catalog (null where no source has it any more). B247: on the
// source it was installed from first (the record's key), so RyukGram isn't offered AppTesters' Instagram as its upgrade.
async function candidates(rows) {
  const out = new Map();
  await Promise.all(rows.map(async (r) => {
    const own = r.key && r.key !== ALL ? await catalog.package(r.id, r.key).catch(() => null) : null;
    const p = own?.key && own.stanza?.version ? own : await catalog.package(r.id, ALL).catch(() => null);
    if (p?.key && p.stanza?.version) out.set(r.id, { version: p.stanza.version, key: p.key, pkg: p }); // F222: pkg for Manage's jobs
  }));
  return out;
}

export function appSubtitle(r, locale) {
  const date = r.date ? new Date(r.date).toLocaleDateString(locale, { dateStyle: "medium" }) : null;
  // F87: I4's note, where the phone's version isn't the one iFizBox remembered, comes first.
  // F228: an app from a source on the piracy list says so first.
  return [packageWarning(r) ? PIRACY_SUBTITLE : null, r.note || null, r.upgrade ? `Upgrade to ${r.upgrade}` : null, r.sourceName || r.source, date]
    .filter(Boolean).join(" · ");
}

// F87: the remembered apps for the list; an app the phone doesn't have (I4's `actual` null) offers no upgrade.
export function appListRows(records, candidateOf) {
  return appUpgrades(appRows(records), candidateOf).map((r) => (r.actual === null ? { ...r, upgrade: null } : r));
}

// F91: each row's signature ({ state, text, long } or none) from signing.installed, by bundle ID (installed or
// original), and the signed apps no row stands for, as rows of their own (`signedOnly`). -> { rows, extra }
// F134: `show` false (Show Expiry Dates off) leaves the days out; Expired still shows, since that app won't open.
// F221: `marked` (the sideload app's list): a row iFizBox holds no signature for was marked as installed, so its pill
// is a grey "?" (no expiry known) and the row says so (`marked: true`); not for iFizBox's own row or one iOS lacks.
export const MARKED_SIG = { state: "unknown", text: "?", long: "Marked as installed: no expiry known" };
export function withSignatures(rows, installed, { now = new Date(), window, show = true, marked = false } = {}) {
  const shown = (sig) => (sig && (show || sig.state === "expired") ? sig : null);
  const index = signedIndex(installed);
  const used = new Set();
  const out = rows.map((r) => {
    const a = index.get(r.id);
    if (!a) return marked && show && !r.self && r.actual !== null ? { ...r, sig: MARKED_SIG, marked: true } : r;
    used.add(a.bundleId);
    const sig = shown(signatureState(a.expires, { now, window }));
    return sig ? { ...r, sig } : r;
  });
  const extra = [];
  for (const a of Array.isArray(installed?.apps) ? installed.apps : []) {
    if (!a?.bundleId || used.has(a.bundleId)) continue;
    used.add(a.bundleId);
    extra.push({ id: a.bundleId, name: a.name || a.bundleId, version: a.version || "", signedOnly: true,
      sig: shown(signatureState(a.expires, { now, window })) ?? undefined, ...(fromMyIpas(a) ? { fromMyIpas: true } : {}) });
  }
  return { rows: out, extra };
}

// signing.installed in the sideload app; null anywhere else or when the call fails.
async function signedApps(native = nativeBridge()) {
  if (detectMode() !== "sideload" || typeof native?.call !== "function") return null;
  try { return await signedAppsNamed(native); } catch { return null; } // B150: a source app keeps its source name
}

// B156: a signed app no record stands for whose IPA a source offers (core/installed.js sourceRecordFor) gets its
// record back, so it reads its source and sorts under its letter; recordInstall's onAppsChange draws the list again.
// `pkgsOf(id)`: the catalog's packages for an ID on every source. -> the records written
export async function restoreSourceRecords(signed, records, { pkgsOf = catalogPkgs, record = async (rec) => recordInstall(await apps(), rec, rec.date) } = {}) {
  const out = [];
  for (const a of unrecordedSigned(signed, records)) {
    const ids = [...new Set([a.originalBundleId, a.bundleId].filter(Boolean))];
    const pkgs = (await Promise.all(ids.map((id) => pkgsOf(id).catch(() => [])))).flat();
    const rec = sourceRecordFor(a, pkgs);
    if (!rec) continue;
    try { out.push(await record(rec)); } catch { /* no store: the row stays signed-only */ }
  }
  return out;
}
// B247: records that name another source's app than the one a signed app was installed from are written again, their
// dates kept, with that entry's icon: by the shell's credit (core/installed.js recreditedRecords), else, for an app
// signed before the shell kept one, by the source entry offering its IPA's url (urlCredit). -> the records written
export async function recreditRecords(signed, records, { pkgsOf = catalogPkgs, record = async (rec) => recordInstall(await apps(), rec, rec.date) } = {}) {
  const fixes = recreditedRecords(records, signed);
  const byId = new Map((records ?? []).filter((r) => r?.id && !r.self).map((r) => [r.id, r]));
  const pkgsFor = async (a) => (await Promise.all([...new Set([a.originalBundleId, a.bundleId].filter(Boolean))]
    .map((id) => pkgsOf(id).catch(() => [])))).flat();
  for (const a of Array.isArray(signed?.apps) ? signed.apps : []) {
    const rec = byId.get(a?.bundleId) ?? byId.get(a?.originalBundleId);
    if (!rec || !a.url || a.credit || fixes.some((f) => f.id === rec.id)) continue;
    const c = urlCredit(a, await pkgsFor(a), rec);
    const fix = c ? recordWithCredit(rec, c) : null;
    if (fix) fixes.push(fix);
  }
  const out = [];
  for (const rec of fixes) {
    const pkg = rec.key ? (await pkgsOf(rec.id).catch(() => [])).find((p) => p?.key === rec.key) : null;
    const icon = pkg?.stanza?.ipa?.iconURL;
    try { out.push(await record(icon ? { ...rec, icon } : rec)); } catch { /* no store: the list still shows the credit */ }
  }
  return out;
}
async function catalogPkgs(id) {
  const first = await catalog.package(id, ALL);
  if (!first?.stanza?.ipa) return [];
  const others = await Promise.all((first.others ?? []).map((o) => catalog.package(id, o.key).catch(() => null)));
  return [first, ...others.filter((p) => p?.stanza?.ipa)];
}

// The apps list functions below take the page's apps view (C25) as `appView`.
async function loadApps(appView) {
  const seq = ++appView.seq;
  if (recordsApps()) loadIpaCounts(); // F269: the Install IPAs row's counts, painted in when they come
  let rows;
  try {
    rows = await rememberedApps(); // F87: the phone's versions and I4's notes in the jailbreak app
    rows = await withInstalled(rows); // B46: in the sideload app, whether iOS still has each one
  } catch (e) {
    if (seq === appView.seq) appView.body.replaceChildren(note(e.message));
    return;
  }
  const site = detectMode() === "site";
  // F125: the Wish List count leaves out what dpkg has; the worker answers once the sources are in, so the list
  // doesn't wait on it (the row is drawn again when it does).
  const installedIds = catalog.installed().then((x) => (x ?? []).map((r) => r.id), () => []);
  const [hasStatus, signed] = await Promise.all([site ? catalog.hasStatus() : false, signedApps()]);
  if (seq !== appView.seq) return;
  if (!recordsApps()) rows = rows.filter((r) => !r?.self); // iFizBox's own row is dpkg's there
  appView.signed = signed; // F91
  if (signed && recordsApps()) {
    recreditRecords(signed, rows).catch(() => {}); // B247: written back, so Changes and the app pages follow
    rows = creditedRecords(rows, signed); // B247: the source's app it was signed from names it, not the last record by ID
  }
  if (signed && recordsApps()) restoreSourceRecords(signed, rows).catch(() => {}); // B156
  if (signed && recordsApps()) loadTweakUpdates(appView, signed, seq); // F302a
  if (site) appView.signed = siteSignedApps(rows); // F342: the website's signatures on its records (no "?" for the rest)
  drawApps(appView, appListRows(rows, () => null), new Map(), site, hasStatus);
  const ids = await installedIds;
  if (seq !== appView.seq) return;
  if (ids.length) {
    appView.installedIds = ids;
    drawApps(appView, appListRows(rows, () => null), new Map(), site, hasStatus);
  }
  // The upgrade badges wait on the sources; the list doesn't.
  if (!rows.length) return;
  let cands;
  try { cands = await candidates(rows); } catch { return; }
  if (seq !== appView.seq) return;
  drawApps(appView, appListRows(rows, (id) => cands.get(id) ?? null), cands, site, hasStatus);
}

function drawApps(appView, listRows, cands, site, hasStatus) {
  const body = appView.body;
  appView.last = { listRows, cands, site, hasStatus };
  body.classList.replace("grouped", "plain");
  // F127: the search bar on the root, once there are apps to search. F222: the Install IPAs tile above it is gone
  // (Home's tile, linked from the list's footer).
  const head = [];
  if (recordsApps() && listRows.length) head.push(...filterControls(appView, { onChange: () => drawAppList(appView) }));
  body.replaceChildren();
  // C10: the bar stays put and the list scrolls under it (nav/searchbar.js pinned); no bar, the page scrolls.
  appView.results = head.length ? pinned(body, ...head) : body;
  appView.tail = [];
  drawAppList(appView);
}

// F127: the mode or the search changed: the list again, under the tile and the field (which keeps its focus).
function redrawApps(appView) {
  if (appView?.body && appView.last) drawAppList(appView);
}

function drawAppList(appView) {
  const body = appView.body;
  const route = appView.route;
  const { listRows, cands, site, hasStatus } = appView.last;
  for (const n of appView.tail ?? []) n.remove();
  // F91: the signature pill in place of the version (the version stays in the subtitle).
  const signed = appView.signed ? withSignatures(listRows, appView.signed, { window: resignWindow((k) => settings.get(k)), show: settings.get("showExpiry"), marked: !site }) : { rows: listRows, extra: [] };
  // F127: User (A–Z) or Recent (by day) on the root, narrowed by the search; the jailbreak app's Apps page as before.
  const appSecs = recordsApps() ? appSections(signed.rows, { mode: appView.mode, query: appView.query }) : [{ rows: signed.rows }];
  const extra = recordsApps() ? queryRows(signed.extra, appView.query) : signed.extra;
  const rows = appSecs.flatMap((sec) => sec.rows);
  const more = site ? [{ header: "Jailbroken iPhone", rows: [hasStatus
    ? { label: "dpkg Status File", subtitle: "Packages installed with apt", href: format({ tab: route.tab, path: [DPKG] }) }
    : { label: "Choose Status File", subtitle: "See the packages a jailbroken iPhone has", onClick: () => chooseStatus() }] }] : [];
  updateWishButton(appView); // F147 (F125's Packages section with the Wish List row is gone)
  // F222: the rows Manage picks from (the whole list, not only the search's), each with its signature record and,
  // for a marked app, whether its installed version is on its source.
  const index = signedIndex(appView.signed);
  if (recordsApps()) {
    appView.manageRows = [...signed.rows, ...signed.extra].map((r) => withManage(withSigned(r, index), cands));
    appView.selected = pruneSelection(appView.selected, appView.manageRows);
  }
  const ul = appListElement(appSecs, extra, { route, cands, signed: appView.signed, more, manage: recordsApps(), view: appView });
  appView.tail = [ul];
  if (!listRows.length) {
    appView.tail.unshift(installIpasNote(route, "No apps yet. Apps you install from an app's page or from ", ", on this device, are listed here.", "empty"));
  } else if (!rows.length && !extra.length) {
    appView.tail.unshift(note("No matches."));
  }
  // F269: the Install IPAs row heads the list (it replaced the footer's link; the empty state keeps its own).
  if (recordsApps()) appView.tail.unshift(installIpasTable(route, appView));
  if (recordsApps() && appView.tweakUps?.length) appView.tail.unshift(tweakUpdatesTable(appView)); // F302a
  if (recordsApps() && appView.managing) appView.tail.unshift(manageSummaryLine(appView));
  (appView.results?.parentNode === body ? appView.results : body).append(...appView.tail);
  syncManage(appView);
}

// The apps list's table: the sections' rows, F91's extra rows, then `more` (the site's dpkg row). B36: every app row
// is a link (the package page or the installed-app page, so it highlights on press), carries its signing.installed
// record, swipes to Delete (not iFizBox's own) and holds for the sheet (`hold`: attachRowHold's options).
// F222: `manage` (the root without a jailbreak) gives each row Manage can pick its select circle.
// `view`: the page's apps view (C25), whose Edit, Manage and picks the rows follow.
export function appListElement(appSecs, extra, { route, cands = new Map(), signed = null, more = [], view = latest.apps, editing = view.editing,
  hold = {}, manage = false, managing = view.managing, selected = view.selected } = {}) {
  const rows = appSecs.flatMap((sec) => sec.rows);
  const appRow = (r) => ({
    label: r.name, subtitle: r.marked && !r.upgrade ? markedSubtitle(r)
      : r.sig && !r.upgrade && r.version ? [`Version ${r.version}`, appSubtitle(r)].filter(Boolean).join(" · ") : appSubtitle(r),
    detail: r.sig && !r.upgrade ? r.sig.text : r.upgrade || r.actual === null ? undefined : r.version,
    badge: r.upgrade ? "Upgrade" : undefined, icon: { text: r.name.charAt(0).toUpperCase() },
    href: appRowHref(r, cands, route),
  });
  const sections = appSecs.map((sec) => ({ header: sec.header, rows: sec.rows.map(appRow) }));
  sections.push({ rows: extra.map(extraRow(route)) }, ...more);
  const ul = plain(sections);
  ul.classList.toggle("editing", editing);
  ul.classList.toggle("managing", manage && managing);
  const cells = ul.querySelectorAll(":scope > .cell");
  const index = signedIndex(signed);
  [...rows, ...extra].forEach((r, i) => decorateApp(cells[i], withSigned(r, index)));
  [...rows, ...extra].forEach((r, i) => { if (r.sig && !r.upgrade) sigPill(cells[i], r.sig); });
  [...rows, ...extra].forEach((r, i) => addTweakPill(cells[i], index.get(r.id), view.tweakUps)); // F302a
  if (manage) [...rows, ...extra].forEach((r, i) => { if (manageKinds(r)) selectCircle(cells[i], selected.has(r.id) && managing); });
  attachRowGestures(ul, view);
  attachRowHold(ul, { view, ...hold });
  return ul;
}

// F302a: a signed app's tweaks ("2 Tweaks", signing.installed's names) after its subtitle; "Tweak Update" when one of
// them is newer on a Tweak Source (the apps view's tweakUps).
export function addTweakPill(li, rec, ups = latest.apps.tweakUps) {
  const n = Array.isArray(rec?.tweaks) ? rec.tweaks.length : 0;
  if (!li || !n) return null;
  const sub = li.querySelector?.(".cell-subtitle");
  if (!sub) return null;
  const up = (ups ?? []).some((f) => f.app?.bundleId === rec.bundleId);
  const pill = tweakPill(up ? "Tweak Update" : tweakCountText(n), { up });
  sub.append(pill);
  return pill;
}

// F302a: the Tweak Updates row above the list (the sideload app), when a signed app's tweak has a newer version.
function tweakUpdatesTable(appView) {
  const found = appView.tweakUps ?? [];
  const ul = plain([{ rows: [{ label: "Tweak Updates", subtitle: found.map((f) => f.app.name).join(", "), badge: String(found.length),
    onClick: guarded(async () => { if (await runTweakUpdates(found)) { appView.tweakUps = []; redrawApps(appView); } }) }] }]);
  ul.classList.add("tweak-updates-top");
  return ul;
}

// F302a: which signed apps' tweaks a Tweak Source has newer; the list is drawn again with the row and pills.
async function loadTweakUpdates(appView, signed, seq) {
  const found = await tweakUpdateApps(signed?.apps ?? []).catch(() => []);
  if (seq !== appView.seq) return;
  const had = appView.tweakUps?.length ?? 0;
  appView.tweakUps = found;
  if (found.length || had) redrawApps(appView);
}

// F221: a marked app's subtitle: "Version x · Marked as installed".
export function markedSubtitle(r) {
  return [r.version ? `Version ${r.version}` : null, "Marked as installed"].filter(Boolean).join(" · ");
}

// F91: the row's detail drawn as the signature pill.
function sigPill(li, sig) {
  const d = li?.querySelector(".cell-detail");
  if (!d) return;
  d.classList.add("sig-pill");
  d.dataset.sig = sig.state;
  d.title = sig.long;
}

// F77: the row that opens My IPAs; F79: the page is Install IPAs (Browse, then My IPAs).
export function myIpasRow(route, site) {
  return { label: myipas.PAGE_TITLE, subtitle: site ? "Browse apps, or add links to IPAs" : "Browse apps, or sign your own IPAs",
    href: format({ tab: route.tab, path: [myipas.MYIPAS] }) };
}

// ---- F269: the Install IPAs row at the top of Installed ------------------------------------------------------------
// One row above the first letter header (the jailbreak app: in the top group, above the Apps row): the blue install
// tile, Install IPAs, "7 IPAs · 2 not installed", the grey count of IPAs not installed yet (none at 0) and a chevron.
// It opens the Install IPAs page. `managing` (Installed's Manage) hides it: it is not an app Manage can pick.
export function installIpasRow(route, counts = null, { managing = false } = {}) {
  const n = counts?.notInstalled ?? 0;
  return { label: myipas.PAGE_TITLE, subtitle: ipaCountText(counts), href: myIpasRow(route).href,
    badge: n > 0 ? String(n) : undefined, icon: rowIcon("ipa"), cls: "install-ipas-row", hidden: Boolean(managing) };
}

const ipaRowState = { counts: null, seq: 0 };

// The row's cell (nav/ui.js's), hidden while Manage is on.
function installIpasCell(route, view = null) {
  const row = installIpasRow(route, ipaRowState.counts, { managing: Boolean(view?.managing) && recordsApps() });
  const li = plain([{ rows: [row] }]).firstElementChild;
  li.hidden = row.hidden;
  li.dataset.tab = route.tab;
  return li;
}

// The apps list's own one-row table above the list (site and sideload app).
function installIpasTable(route, view) {
  const ul = plain([]);
  ul.classList.add("install-ipas-top");
  ul.append(installIpasCell(route, view));
  return ul;
}

// The drawn rows again with the counts in (in place: the lists under them don't move), on every page that has one.
function paintIpaRows() {
  if (typeof document === "undefined") return;
  for (const view of [...appsLive(), ...dpkgLive()]) {
    for (const li of view.body?.querySelectorAll?.(".install-ipas-row") ?? []) {
      li.replaceWith(installIpasCell({ tab: li.dataset.tab || "installed", path: [] }, view.kind === "apps" ? view : null));
    }
  }
}

// How many IPAs the library holds and how many of them the phone lacks, as the Install IPAs page counts them: the
// website's links and kept files on this device, the apps' shell library (library.list) elsewhere.
export async function loadIpaCounts({ mode = myipas.listMode(), list = null, call = libraryCall, paint = paintIpaRows } = {}) {
  const seq = ++ipaRowState.seq;
  let counts = null;
  try {
    const entries = list ?? (mode === "site" ? siteEntries() : ((await call("list", {}))?.ipas ?? []));
    const installed = await myipas.installedOf(entries, { mode });
    const shared = await myipas.sharedInstalls(entries, installed);
    counts = libraryCounts(entries, myipas.sharedSections(entries, { installed, shared, site: mode === "site", jailbreak: mode === "jailbreak" }));
  } catch { counts = null; }
  if (seq !== ipaRowState.seq) return ipaRowState.counts;
  ipaRowState.counts = counts;
  paint();
  return counts;
}

// iFizBox's own row: its record's icon is a file shipped beside the page (core/installed.js selfRecord's
// icons/icon-lite-glossy-76.png), which mediaUrl (remote images only) refuses. null for any other row or path.
export function selfIconUrl(r) {
  const s = String(r?.icon ?? "");
  return r?.self && /^icons\/[\w.-]+\.(png|svg)$/.test(s) ? s : null;
}

// Delete controls as on the Sources tab (sources.css styles .source-row: the red minus, Delete, the swipe).
function decorateApp(li, r) {
  li.classList.add("source-row", "installed-app");
  li.dataset.id = r.id;
  const src = mediaUrl(r.icon) ?? selfIconUrl(r);
  if (src) {
    const img = new Image();
    img.alt = "";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.onload = () => img.classList.add("loaded");
    img.onerror = () => img.remove();
    img.src = src;
    li.querySelector(".cell-icon").append(img);
  }
  li._app = r; // B36: what a hold or Delete acts on
  appNames.set(r.id, r.name);
  if (!canDelete(r)) { li.dataset.self = "1"; return; } // iFizBox's own row: no Delete
  const toggle = Object.assign(document.createElement("button"), { type: "button", className: "del-toggle" });
  toggle.setAttribute("aria-label", "Delete " + r.name);
  toggle.addEventListener("click", () => arm(li, !li.classList.contains("armed")));
  const confirm = Object.assign(document.createElement("button"), { type: "button", className: "del-confirm",
    textContent: deleteAction(r)?.label ?? DELETE }); // B46: Delete only where it uninstalls
  confirm.addEventListener("click", guarded(() => confirmDelete(r, { li }))); // B48: not on a drag's or scroll's click
  li.append(toggle, confirm);
}

function arm(li, on) {
  for (const other of li.parentNode.querySelectorAll(".installed-app.armed")) if (other !== li) other.classList.remove("armed");
  li.classList.toggle("armed", on);
}

// While editing, or while a row shows Delete, a tap on a row only puts the Delete away. A left swipe shows it.
function attachRowGestures(ul, appView) {
  let start = null;
  let swiped = false;
  ul.addEventListener("click", (e) => {
    if (e.target.closest(".del-toggle, .del-confirm")) return;
    if (appView.managing && ul.classList.contains("managing")) { // F222: a tap picks the row
      const li = e.target.closest(".installed-app");
      if (!li) return;
      e.preventDefault();
      e.stopPropagation();
      if (li.classList.contains("manage-row")) togglePick(li._app?.id, appView);
      return;
    }
    const armed = ul.querySelector(".installed-app.armed");
    if (!(appView.editing && e.target.closest(".installed-app")) && !armed && !swiped) return;
    e.preventDefault();
    e.stopPropagation();
    if (armed && !swiped) armed.classList.remove("armed");
    swiped = false;
  }, true);
  ul.addEventListener("pointerdown", (e) => {
    const li = e.target.closest(".installed-app");
    swiped = false;
    start = li && !li.dataset.self && !appView.editing && !appView.managing && !e.target.closest(".del-confirm") ? { li, x: e.clientX, y: e.clientY } : null;
  });
  ul.addEventListener("pointermove", (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { start = null; return; } // a scroll
    if (Math.abs(dx) < 30 || Math.abs(dx) < Math.abs(dy) * 2) return;
    arm(start.li, dx < 0);
    swiped = true;
    start = null;
  });
  const stop = () => { start = null; };
  ul.addEventListener("pointerup", stop);
  ul.addEventListener("pointercancel", stop);
}

// B112: the drawn apps list (not the Install IPAs row's table): in the pinned .search-results under the search bar
// (C10), else straight in the page body, as drawAppList appends it.
export function appListOf(view = latest.apps) {
  const box = view.results?.parentNode === view.body ? view.results : view.body;
  return [...(box?.children ?? [])].find((n) => n.classList?.contains("table") && !n.classList.contains("install-ipas-top")) ?? null;
}

function setEditing(on, button, appView) {
  appView.editing = on;
  appListOf(appView)?.classList.toggle("editing", on); // the apps, not My IPAs' tile (inside .home-row)
  for (const li of appView.body?.querySelectorAll(".installed-app.armed") ?? []) li.classList.remove("armed");
  if (button) {
    button.textContent = on ? "Done" : "Edit";
    button.classList.toggle("done", on);
  }
}

// Forgets an app the user deleted from the phone: the row fades, then the list redraws (onAppsChange).
function removeApp(li, r) {
  li.classList.add("removing");
  setTimeout(async () => {
    try {
      await forgetApp(r);
    } catch (e) {
      li.classList.remove("removing");
      await showAlert({ title: "Error", message: r.signedOnly ? deviceError(e).message : e.message, buttons: ["OK"] });
    }
  }, 250);
}

// ---- B36: every row opens, holds and swipes ---------------------------------------------------------------------

const appNames = new Map(); // id -> name, for the installed-app page's title before it loads

// The installed-app page's path segment for an app id, and back.
export const appToken = (id) => `app:${id}`;
export const appIdOf = (seg) => (typeof seg === "string" && seg.startsWith("app:") && seg.length > 4 ? seg.slice(4) : null);

// The page is under the apps list: Installed's root without a jailbreak, the Apps page (#installed/apps) in the app.
export function isAppPage(route, mode = detectMode()) {
  const p = route.path;
  if (appIdOf(p.at(-1)) == null) return false;
  return recordsApps(mode) ? p.length === 1 : p.length === 2 && p[0] === APPS;
}

// Where a row goes: the source's package page when a source still lists the app, else its installed-app page.
// B305: in the candidate's source (the record's own when it still lists it), so RyukGram's row opens RyukGram's entry.
export function appRowHref(r, cands, route) {
  const seg = cands?.has?.(r.id) ? browse.keyedToken(r.id, cands.get(r.id)?.key) : appToken(r.id);
  return format({ tab: route.tab, path: [...route.path, seg] });
}

// F91's extra row (a signed app the list doesn't remember), now with its page.
export function extraRow(route) {
  return (r) => ({ label: r.name, subtitle: [r.version ? `Version ${r.version}` : null, r.fromMyIpas ? "From My IPAs" : `Signed by ${NAME}`].filter(Boolean).join(" · "),
    detail: r.sig?.text, icon: { text: r.name.charAt(0).toUpperCase() }, href: appRowHref(r, null, route) });
}

// The row with its signing.installed record (`signed`, null when iFizBox didn't sign it), by bundle ID.
export const withSigned = (r, index) => ({ ...r, signed: index?.get?.(r.id) ?? null });

// iFizBox's own row is never removed (it is the app showing the list).
export const canDelete = (r) => !r?.self;

export const OPEN = "Open", RESIGN = "Re-sign", SAVE_IPA = "Save Signed IPA", REMOVE = "Remove from List", DELETE = "Delete";

// ---- B46: Delete uninstalls where it can, Remove from List where it can't ------------------------------------------

export const HOME_SCREEN = "Deleting the app itself is done from the Home Screen.";

// What a row's Delete is in this mode, or null (iFizBox's own row):
//   { kind: "uninstall" | "forget" | "installed", label (the swipe's and the hold sheet's button), button (the confirm
//     sheet's red button), note (the confirm sheet's one line, or null) }
// "uninstall": the jailbreak app and the helper sees the app installed (`actual`, I4). "installed": the sideload app's
// shell says iOS still has it (`installed` true, signing.isInstalled), so Remove from List only explains. "forget":
// everything else drops iFizBox's record, saying the app itself is deleted from the Home Screen (or that it's gone).
export function deleteAction(r, { mode = detectMode() } = {}) {
  if (!canDelete(r)) return null;
  if (mode === "jailbreak" && typeof r.actual === "string" && r.actual && !r.signedOnly) {
    return { kind: "uninstall", label: DELETE, button: `Delete ${r.name}`, note: null };
  }
  if (mode === "jailbreak" && r.actual === null) {
    return { kind: "forget", label: REMOVE, button: REMOVE, note: `${r.name} is no longer on your iPhone.` };
  }
  if (mode === "sideload" && r.installed === true && !r.signedOnly) {
    return { kind: "installed", label: REMOVE, button: null, note: `${r.name} is still on your iPhone. ${HOME_SCREEN}` };
  }
  return { kind: "forget", label: REMOVE, button: REMOVE, note: r.signedOnly ? `Forgets the signature record. ${HOME_SCREEN}` : HOME_SCREEN };
}

// The sideload app's rows with `installed` from the shell (signing.isInstalled): true, false or left out where it
// can't say. Anywhere else, or when the call fails, the rows as they were.
export async function withInstalled(rows, { mode = detectMode(), native = nativeBridge() } = {}) {
  if (mode !== "sideload" || typeof native?.call !== "function" || !rows?.length) return rows;
  const ids = rows.filter((r) => r?.id && !r.self).map((r) => r.id);
  if (!ids.length) return rows;
  let res;
  try { res = await native.call("signing.isInstalled", { bundleIds: ids }); } catch { return rows; }
  const map = res?.installed && typeof res.installed === "object" ? res.installed : {};
  return rows.map((r) => (typeof map[r?.id] === "boolean" ? { ...r, installed: map[r.id] } : r));
}

// "pmstatus:<id>:<percent>:<text>" (the helper's progress) -> its text, or null for any other line.
export function statusText(line) {
  const m = /^pmstatus:[^:]*:[\d.]+:(.+)$/.exec(String(line ?? "").trim());
  return m ? m[1] : null;
}

// The swipe's or the sheet's Delete: the iOS 6 action sheet ('Delete <App>' red, Cancel), then the uninstall. Remove
// from List drops the record at once, with no sheet: it only forgets iFizBox's record, and the swipe's red button or the
// hold sheet's was the choice already (Manage's Delete keeps its own confirm). "installed" only explains (an alert).
// -> true when it went ahead.
export async function confirmDelete(r, { mode = detectMode(), sheet = showActionSheet, alert = showAlert, run = runDelete, li = null, after = null } = {}) {
  const a = deleteAction(r, { mode });
  if (!a) return false;
  if (a.kind === "installed") {
    li?.classList.remove("armed");
    await alert({ title: "Still Installed", message: a.note, buttons: ["OK"] });
    return false;
  }
  if (a.kind === "forget") {
    await run(a, r, { li, after });
    return true;
  }
  const i = await sheet({ title: a.note ?? "", buttons: [a.button], destructive: 0 });
  if (i !== 0) { li?.classList.remove("armed"); return false; }
  await run(a, r, { li, after });
  return true;
}

// Uninstalls through the helper behind a HUD (its pmstatus text as the label), then drops the record; or forgets.
async function runDelete(a, r, { li = null, after = null } = {}) {
  if (a.kind !== "uninstall") {
    if (li) { removeApp(li, r); return; }
    try { await forgetApp(r); after?.(); } catch (e) { await showAlert({ title: "Error", message: deviceError(e).message, buttons: ["OK"] }); }
    return;
  }
  const hud = liveHUD(`Deleting ${r.name}`);
  try {
    const backend = getBackend();
    if (typeof backend?.uninstallApp !== "function") throw new Error("This build can't delete apps.");
    await backend.uninstallApp(r.id, (ev) => { const t = statusText(ev?.line); if (t) hud.set(t); });
  } catch (e) {
    hud.hide();
    li?.classList.remove("armed");
    await showAlert({ title: `Couldn't Delete ${r.name}`, message: e?.message || String(e), buttons: ["OK"] });
    return;
  }
  hud.done("Deleted");
  li?.classList.add("removing");
  try { await removeInstall(await apps(), r.id); } catch { /* the app is gone; the record goes next time */ }
  loadAllApps();
  after?.();
}

// The hold sheet's buttons for a row, in order. Open and Re-sign need the sideload app (signing.openApp,
// signing.resign); Re-sign only for an app iFizBox signed; Save Signed IPA when My IPAs keeps a signed copy (`ipa`).
export function appActions(r, { mode = detectMode(), ipa = null } = {}) {
  const out = [];
  if (mode === "sideload" && !r.self && r.actual !== null) out.push(OPEN);
  if (mode === "sideload" && r.signed) out.push(RESIGN);
  if (ipa) out.push(SAVE_IPA);
  const del = deleteAction(r, { mode }); // B46: Delete where it uninstalls, else Remove from List
  if (del) out.push(del.label);
  return out;
}

const isDelete = (label) => label === REMOVE || label === DELETE;

// My IPAs' entry with a signed copy of this app (by bundle ID, as signed or as in the IPA), or null.
export function keptIpaOf(r, entries) {
  const ids = new Set([r.id, r.signed?.bundleId, r.signed?.originalBundleId].filter(Boolean));
  return (entries ?? []).find((e) => e?.file && e.signed && (ids.has(e.signed.bundleId) || ids.has(e.bundleId))) ?? null;
}

async function keptIpa(r) {
  if (detectMode() !== "sideload" || !hasNativeCall()) return null;
  try { return keptIpaOf(r, (await libraryCall("list", {}))?.ipas); } catch { return null; }
}

// Forgets the row's app: a signed app the list doesn't remember through signing.forget (it stays installed, as on
// Settings > Signed Apps; the list draws again), a remembered one through removeInstall (onAppsChange redraws).
export async function forgetApp(r, native = nativeBridge(), remove = async (id) => removeInstall(await apps(), id)) {
  if (r.signedOnly) {
    await native.call("signing.forget", { bundleId: r.id });
    loadAllApps();
    return;
  }
  // A remembered app iFizBox also signed: forget the signature too, or it comes back as a signedOnly row (user
  // 2026-11-18: 'they need to be removed twice').
  if (r.signed && typeof native?.call === "function") await native.call("signing.forget", { bundleId: r.signed.bundleId ?? r.id });
  await remove(r.id);
}

// What a sheet button does. `li`: the row, when the sheet came from the list (Remove fades it out).
async function runAppAction(label, r, { ipa = null, li = null, after = null } = {}) {
  const native = nativeBridge();
  try {
    if (label === OPEN) {
      const res = await native.call("signing.openApp", { bundleId: r.signed?.bundleId ?? r.id });
      if (!res?.opened) await showAlert({ title: "Couldn't Open", message: `iOS didn't open ${r.name}.`, buttons: ["OK"] });
    } else if (label === RESIGN) {
      const job = resignJob(r.signed);
      if (job) (await import("./queue.js")).queueApp(job);
    } else if (label === SAVE_IPA) {
      await libraryCall("export", { file: ipa.file });
    } else if (isDelete(label)) {
      await confirmDelete(r, { li, after }); // B46: confirmed by its own sheet, then uninstalled or forgotten
    }
  } catch (e) {
    await showAlert({ title: "Error", message: deviceError(e).message, buttons: ["OK"] });
  }
}

// The hold's action sheet for a row -> the button chosen, or null (Cancel, or nothing applies).
export async function appSheet(r, { mode = detectMode(), sheet = showActionSheet, findIpa = keptIpa, act = runAppAction, li = null, after = null } = {}) {
  const ipa = mode === "sideload" ? await findIpa(r) : null;
  const buttons = appActions(r, { mode, ipa });
  if (!buttons.length) return null;
  const i = await sheet({ title: r.name, buttons, destructive: buttons.findIndex(isDelete) });
  if (!(i >= 0)) return null;
  await act(buttons[i], r, { ipa, li, after });
  return buttons[i];
}

// A hold on a row (nav/menu.js longPress, HOLD_MS) opens its sheet; not while editing or while it shows Delete.
// `view`: the page's apps view (C25).
export function attachRowHold(ul, { view = latest.apps, ...opts } = {}) {
  longPress(ul, ".installed-app", (li) => {
    if (view.editing || view.managing || li.classList.contains("armed") || !li._app) return;
    li.querySelector(".cell-inner")?.classList.remove("is-pressed");
    appSheet(li._app, { li, ...opts });
  });
}

// The installed-app page (#installed/app:<id>): what iFizBox knows of an app no source lists any more, or one it
// signed but doesn't remember: version (browse.js installedAppSection, with I4's note in the jailbreak app), bundle ID,
// source, install date and the signature's days left; then the sheet's actions as rows.
async function renderAppPage(body, route, ctx, { quiet = false } = {}) {
  const id = appIdOf(route.path.at(-1));
  appPages.open(body, { route, ctx }); // B281: drawn again by reloadSigned
  if (!quiet) body.append(placeholder("page"));
  let rec = null;
  let signed = null;
  try {
    const [records, installed] = await Promise.all([rememberedApps().catch(() => []), signedApps()]);
    signed = signedIndex(installed ?? (detectMode() === "site" ? siteSignedApps(records) : null)).get(id) ?? null; // F342
    rec = (records ?? []).find((x) => x?.id === id) ?? null;
    if (rec) [rec] = await withInstalled([rec]); // B46
  } catch { /* drawn from what there is */ }
  const r = rec ? { ...rec, signed } : signed ? { id, name: signed.name || id, version: signed.version || "", signedOnly: true, signed } : null;
  if (!r) { body.replaceChildren(note("This app isn't installed.")); return; }
  appNames.set(id, r.name);
  const ipa = detectMode() === "sideload" ? await keptIpa(r) : null;
  body.replaceChildren(grouped(appPageSections(r, { ipa, onAction: (label) => runAppAction(label, r, { ipa, after: navBack }) })));
}

// ---- B281: an install that records nothing itself ended ----------------------------------------------------------
// An ifizbox://install link's Install (incoming.js) and another sideloader's IPA link sign from a URL and write no
// Installed record, so nothing told the lists: Installed's row and the app's page kept the signed record from before
// (a My IPAs install's) until they were opened again. When that run ends, every live apps list and app page loads
// the signed records again.
//   reloadSigned({ load, draw })   -> the number of app pages drawn again (load, draw: stand-ins for tests)
const appPages = pageViews(() => ({ kind: "app", route: null, ctx: null }));

export function reloadSigned({ load = loadAllApps, draw = renderAppPage } = {}) {
  load();
  let n = 0;
  for (const p of appPages.all()) {
    if (!p.route || p.body?.isConnected === false) continue;
    draw(p.body, p.route, p.ctx, { quiet: true });
    n++;
  }
  return n;
}

// B283: a My IPAs install writes a device record (key library:<file>, sourceName "My IPAs"); a later install of the
// same app from a URL (an ifizbox://install link, another sideloader's IPA link) writes none, so that record kept the
// app's page on "Source: My IPAs" while the shell's signed record said the URL. Once such an install ends, the app's
// My IPAs record goes, but only when the shell's signed record for it is not a My IPAs one (the URL was signed for
// it; on the signing-server route that is once iOS's install prompt shows, before iOS has the app): the app then reads
// as its signed record does, as any URL install's signed-only row and page. keptIpa finds My IPAs' signed copy
// by bundle ID, not through this record, so Save Signed IPA stays; Re-sign signs from the signed record's URL.
// A source's record stays (Changes and Update read its source). The jailbreak build and the website keep no signed
// record of the shell's, so nothing is dropped there.
//   await dropMyIpasRecord(answer, { store, signed })   answer: the install's { bundleId }, or null -> true if dropped
export const libraryRecord = (rec) => !!rec && !rec.source && String(rec.key ?? "").startsWith("library:");

export async function dropMyIpasRecord(answer, { store = apps, signed = signedApps } = {}) {
  const id = typeof answer?.bundleId === "string" ? answer.bundleId : null;
  if (!id) return false;
  try {
    const sig = signedIndex(await signed()).get(id) ?? null;
    if (!sig || fromMyIpas(sig)) return false;
    const s = await store();
    const rec = (await s.all()).find((r) => r?.id === id && !r.self) ?? null;
    if (!libraryRecord(rec)) return false;
    await removeInstall(s, id); // onAppsChange: the lists load again
    return true;
  } catch { return false; }
}

// Registers `body` as an app page, as renderAppPage does (tests).
export const openAppPage = (body, route, ctx = null) => appPages.open(body, { route, ctx });

// The page's sections for a row `r` (with `signed`), testable without a page.
export function appPageSections(r, { ipa = null, mode = detectMode(), now = new Date(), window, onAction = () => {} } = {}) {
  const sec = browse.installedAppSection(r);
  const rows = [...sec.rows, { label: "Bundle ID", detail: r.signed?.bundleId || r.id }];
  if (r.signed?.bundleId && r.signed.bundleId !== r.id) rows.push({ label: "Original ID", detail: r.id });
  if (r.sourceName || r.source) rows.push({ label: "Source", detail: r.sourceName || r.source });
  if (r.date) rows.push({ label: "Installed", detail: new Date(r.date).toLocaleDateString(undefined, { dateStyle: "medium" }) });
  if (r.signed) {
    const sig = signatureState(r.signed.expires, { now, window: window ?? resignWindow((k) => settings.get(k)) });
    rows.push({ label: "Signature", detail: sig?.long || "Signed by " + NAME });
  }
  const out = [{ header: sec.header, rows, footer: sec.footer || (r.signedOnly ? `Signed by ${NAME}. No source lists it.` : null) }];
  const acts = appActions(r, { mode, ipa });
  const main = acts.filter((a) => !isDelete(a));
  if (main.length) out.push({ rows: main.map((label) => ({ label, onClick: () => onAction(label) })) });
  const del = acts.find(isDelete);
  if (del) {
    const a = deleteAction(r, { mode });
    out.push({ rows: [{ label: del, onClick: () => onAction(del) }],
      footer: a.kind === "uninstall" ? `Deletes ${r.name} and its data from your iPhone.` : a.note });
  }
  return out;
}

// ---- F222: Manage: pick apps, then Re-sign, Update or Delete them together ----------------------------------------

// The bottom toolbar (one for the app) and the apps view it acts for: the page Manage is on. Each page's own Manage
// button, grey line and picks are on its view (C25).
const manageBar = { toolbar: null, owner: null };

// A signature record made from the user's own IPA: native MyIPAs.fileOf's library:<file> url (signing.resign signs
// such an app again from that file, not a download).
export const fromMyIpas = (rec) => typeof rec?.url === "string" && rec.url.startsWith("library:");

// A list row with what Manage needs: `pkg` (the catalog package, for Update and a marked app's re-sign) and, for an app
// iFizBox holds no signature for, `onSource`: its installed version is still on its source (F221).
export function withManage(r, cands) {
  const pkg = cands?.get?.(r.id)?.pkg ?? null;
  const onSource = !r.signed && !r.signedOnly && Boolean(markedVersionOnSource(pkg, r.version));
  return { ...r, pkg, onSource };
}

// The row's select circle (packages.css .manage-check), slid in with the row's content while managing.
function selectCircle(li, on) {
  if (!li) return;
  li.classList.add("manage-row");
  li.classList.toggle("picked", Boolean(on));
  const c = Object.assign(document.createElement("span"), { className: "manage-check" });
  c.setAttribute("aria-hidden", "true");
  li.append(c);
}

// User | Recent's pick: the list again under the same mode, managing or not.
export function pickMode(m, view = latest.apps) {
  view.mode = m;
  redrawApps(view);
}

// Manage on or off for `view`'s page: Done (blue) or Manage on the right, Select… or Wish List on the left, the circles
// slide in or out, the grey line and the toolbar come or go. Off drops the selection. One page manages at a time (the
// toolbar is the app's): turning it on ends it on any other.
export function setManaging(on, view = latest.apps) {
  if (!recordsApps()) return;
  if (on) for (const v of appsLive()) if (v !== view && v.managing) setManaging(false, v);
  view.managing = Boolean(on);
  if (!on) view.selected = new Set();
  view.hash = on ? globalThis.location?.hash ?? null : null; // the page it was turned on over (rootShown)
  if (on) manageBar.owner = view;
  else if (manageBar.owner === view) manageBar.owner = null;
  if (typeof document === "undefined") return;
  for (const li of view.body?.querySelectorAll(".installed-app.armed") ?? []) li.classList.remove("armed");
  const b = view.right;
  if (b) { b.textContent = on ? "Done" : "Manage"; b.classList.toggle("done", Boolean(on)); }
  const ul = appListOf(view);
  ul?.classList.toggle("managing", Boolean(on));
  if (on && ul && !view.summary) {
    const line = manageSummaryLine(view);
    ul.before(line);
    view.tail.unshift(line);
  }
  if (!on) { view.summary?.remove(); view.summary = null; }
  for (const li of view.body?.querySelectorAll(".install-ipas-row") ?? []) li.hidden = Boolean(on); // F269
  syncManage(view);
  import("./queue.js").then((q) => q.setAppChromeManaging(on), () => {}); // B81: Manage on hides Queue
}

export function togglePick(id, view = latest.apps) {
  if (!id || !view.managing) return;
  const next = new Set(view.selected);
  if (next.has(id)) next.delete(id); else next.add(id);
  view.selected = next;
  syncManage(view);
}

// Select…'s sheet (All Apps, Expiring Soon (n), Not Signed Here (n), With Updates (n), Cancel) picks a preset's apps in
// place of the selection; with every row picked the button is Deselect, which drops it. -> the preset, or null.
export async function selectButton({ view = latest.apps, sheet = showActionSheet, sync = () => syncManage(view) } = {}) {
  return selectPreset({
    selecting: selectLabel(view.manageRows, view.selected) === SELECT,
    options: () => selectSheet(view.manageRows),
    apply: (preset) => { view.selected = new Set(presetIds(view.manageRows, preset)); sync(); },
    clear: () => { view.selected = new Set(); sync(); },
    sheet: (o) => sheet({ ...o, from: view.wish ?? null }), // B351: the sheet (iOS 26: the menu) comes out of Select…
  });
}

// The grey line over a managing page's list (drawAppList draws it again with the list, so the view keeps the newest).
function manageSummaryLine(view) {
  const p = Object.assign(document.createElement("p"), { className: "manage-summary" });
  p.textContent = manageSummary(view.manageRows, view.selected);
  view.summary = p;
  return p;
}

// "<before>Install IPAs<after>" with a link to Install IPAs (Home's tile): the list's empty state and its footer.
function installIpasNote(route, before, after, cls) {
  const p = Object.assign(document.createElement("p"), { className: cls });
  const a = Object.assign(document.createElement("a"), { textContent: myipas.PAGE_TITLE, href: myIpasRow(route, detectMode() === "site").href });
  p.append(before, a, after);
  return p;
}

// Whether `view`'s page is the one on screen (the toolbar shows only over it): still the page Manage was turned on over.
function rootShown(view) {
  if (!view?.body?.isConnected || typeof location === "undefined") return false;
  const r = mounted(parse(location.hash));
  return location.hash === view.hash && r.tab === "installed" && isRoot(r) && pageKind(r) === "apps";
}

// The picked circles, the grey line, Select…/Deselect and the toolbar's counts, from `view`.
function syncManage(appView = latest.apps) {
  if (typeof document === "undefined" || !appView.body) return;
  for (const li of appView.body.querySelectorAll(".manage-row") ?? []) {
    const picked = appView.managing && appView.selected.has(li._app?.id);
    li.classList.toggle("picked", picked);
    li.querySelector(".cell-inner")?.setAttribute("aria-selected", String(picked));
  }
  if (appView.summary) appView.summary.textContent = manageSummary(appView.manageRows, appView.selected);
  updateWishButton(appView);
  if (manageBar.owner && manageBar.owner !== appView) return; // the toolbar is another page's
  const show = appView.managing && recordsApps() && rootShown(appView);
  if (!show && !manageBar.toolbar) return;
  const t = manageToolbarEl();
  if (show) {
    const specs = manageToolbar(manageCounts(appView.manageRows, appView.selected));
    for (const s of specs) {
      t.buttons[s.kind].textContent = s.label;
      t.buttons[s.kind].disabled = s.disabled;
    }
    if (!t.el.isConnected) document.body.append(t.el);
    requestAnimationFrame(() => requestAnimationFrame(() => { if (appView.managing) t.el.classList.add("shown"); }));
  } else {
    t.el.classList.remove("shown");
  }
  document.documentElement.classList.toggle("has-manage-toolbar", show);
}

// The bottom toolbar (packages.css .manage-toolbar, My IPAs' bar): Re-sign (blue, the Done button's look), Update, Delete (red).
function manageToolbarEl() {
  if (manageBar.toolbar) return manageBar.toolbar;
  const el = Object.assign(document.createElement("div"), { className: "manage-toolbar" });
  el.setAttribute("role", "toolbar");
  const buttons = { resign: barButton("Re-sign", "done manage-resign"), update: barButton("Update", "manage-update"),
    delete: barButton("Delete", "manage-delete") };
  for (const [kind, b] of Object.entries(buttons)) b.addEventListener("click", () => { if (manageBar.owner) runManage(kind, { view: manageBar.owner }); });
  el.append(buttons.resign, buttons.update, buttons.delete);
  manageBar.toolbar = { el, buttons };
  return manageBar.toolbar;
}

// Leaving the root (another tab, a pushed page) ends Manage, so the toolbar never shows over another page.
if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => { for (const v of appsLive()) if (v.managing && !rootShown(v)) setManaging(false, v); });
}

// The queue jobs for `kind` ("resign" | "update") from the picked rows: Re-sign signs an app iFizBox signed again from
// its record (resignJob; one from My IPAs from the stored file), a marked app from its installed version's IPA on the
// source (markedResignJob); Update queues the newest version (appJob). Rows the kind doesn't apply to are left out.
export function manageJobs(kind, picked) {
  const out = [];
  for (const r of picked ?? []) {
    const k = manageKinds(r);
    if (!k) continue;
    let j = null;
    if (kind === "resign" && k.resign) j = r.signed ? resignJob(r.signed) : markedResignJob(r.pkg, r.version, { source: r.sourceName || null });
    else if (kind === "update" && k.update && r.pkg) j = appJob(r.pkg, { installed: r.version || null, source: r.sourceName || null });
    if (j) out.push(j);
  }
  return out;
}

export const MANAGE_VERB = { resign: "Re-signing", update: "Updating" };

// The confirm sheet's title and its button for Re-sign and Update.
// B66: `newest`, how many of the n are a blocked app's newest version installed over it (Re-sign's alert).
export function manageSheet(kind, n, marked = 0, newest = 0) {
  const apps = n === 1 ? "App" : `${n} Apps`;
  if (kind === "resign") {
    const dl = marked === 0 ? "" : marked === 1 ? " 1 app is downloaded from its source first." : ` ${marked} apps are downloaded from their sources first.`;
    const nw = newest === 0 ? "" : newest === 1 ? " 1 app is installed at its newest version." : ` ${newest} apps are installed at their newest versions.`;
    return { title: `Each app keeps its data.${dl}${nw}`, button: n === 1 ? "Re-sign App" : `Re-sign ${apps}` };
  }
  return { title: "Each app is updated to its newest version and keeps its data.", button: n === 1 ? "Update App" : `Update ${apps}` };
}

// B66: Re-sign with picked marked apps it can't sign (core/installed.js manageKinds' `blocked`): an alert names each
// one and why, and offers what can be done. `others`: how many picked apps Re-sign can sign. -> { title, message,
// buttons, actions } (actions[i]: what button i does: "cancel", "newest" (install each one's newest version over it,
// then the others), "skip" (re-sign only the others)); `newest`: the jobs "newest" queues.
const BLOCKED_WHY = {
  "no-source": (r) => `${r.name}: no source has it now, so there is no IPA to sign. Add its source again, or sign your own copy from ${myipas.PAGE_TITLE}.`,
  "no-version": (r) => `${r.name}: its source no longer has version ${r.version}, the one on your iPhone.`,
  "unknown-version": (r) => `${r.name}: it was marked as installed without a version, so there is no IPA to download.`,
  "no-download": (r) => `${r.name}: its source has version ${r.version} only as a link, not an IPA to download.`,
};
export function resignBlockedAlert(blocked, others = 0) {
  const lines = [];
  const newest = [];
  for (const r of blocked ?? []) {
    const p = markedResignProblem(r.pkg, r.version || null) ?? { why: "no-source", newest: null };
    const job = p.newest ? appJob(r.pkg, { installed: r.version || null, source: r.sourceName || null }) : null;
    if (job) newest.push(job);
    lines.push(BLOCKED_WHY[p.why](r) + (job ? ` Install the newest (${job.version}) instead: it keeps its data.` : ""));
  }
  const title = blocked.length === 1 ? `Can't Re-sign ${blocked[0].name}` : `Can't Re-sign ${blocked.length} Apps`;
  const actions = ["cancel"];
  const buttons = [newest.length || others ? "Cancel" : "OK"];
  if (newest.length) { actions.push("newest"); buttons.push(newest.length === 1 ? "Install Newest" : `Install ${newest.length} Newest`); }
  if (others) { actions.push("skip"); buttons.push(others === 1 ? "Re-sign the Other App" : `Re-sign the Other ${others}`); }
  return { title, message: lines.join("\n\n"), buttons, actions, newest };
}

// B46 per app for a bulk Delete:{ act: [{ r, a }] (uninstalled or removed from the list), stay: [r] (iOS still has
// them and iFizBox can't delete them: the sideload app) }.
export function bulkDeletePlan(picked, { mode = detectMode() } = {}) {
  const act = [];
  const stay = [];
  for (const r of picked ?? []) {
    const a = deleteAction(r, { mode });
    if (!a) continue;
    if (a.kind === "installed") stay.push(r); else act.push({ r, a });
  }
  return { act, stay };
}

const stayLine = (stay) => (stay.length === 1 ? `${stay[0].name} is still on your iPhone and stays on the list.`
  : `${stay.length} apps are still on your iPhone and stay on the list.`);

// The bulk Delete's sheet: { title, button } (button null: nothing to do but explain, an alert).
export function bulkDeleteSheet(plan) {
  const n = plan.act.length;
  const un = plan.act.filter((x) => x.a.kind === "uninstall").length;
  const lines = [];
  if (un) lines.push(un === 1 ? "Deletes the app and its data from your iPhone." : `Deletes ${un} apps and their data from your iPhone.`);
  if (n > un) lines.push(n - un === 1 ? `Removes 1 app from the list. ${HOME_SCREEN}` : `Removes ${n - un} apps from the list. ${HOME_SCREEN}`);
  if (plan.stay.length) lines.push(stayLine(plan.stay));
  const button = !n ? null : un === n ? (n === 1 ? `Delete ${plan.act[0].r.name}` : `Delete ${n} Apps`)
    : un ? `Delete ${n} Apps` : n === 1 ? REMOVE : `Remove ${n} Apps from List`;
  return { title: lines.join(" "), button };
}

// A toolbar button: the confirm sheet, then the jobs (Re-sign, Update) or the deletes; Manage ends and the list loads
// again (its pills follow). -> true when it went ahead. B66: Re-sign with picked apps it can't sign alerts first
// (resignBlockedAlert); a run that doesn't get through keeps Manage on with what's left picked (`keep`); Confirm's run
// still going (`busy`) is said, not swallowed.
export async function runManage(kind, { view = latest.apps, mode = detectMode(), sheet = showActionSheet, alert = showAlert, run = runManageJobs,
  remove = deleteOne, done = () => { setManaging(false, view); loadAllApps(); },
  keep = () => { syncManage(view); loadAllApps(); }, busy = appQueueBusy } = {}) {
  const picked = manageable(view.manageRows).filter((r) => view.selected.has(r.id));
  if (!picked.length) return false;
  if (kind === "delete") {
    const plan = bulkDeletePlan(picked, { mode });
    const s = bulkDeleteSheet(plan);
    if (!s.button) { await alert({ title: "Still Installed", message: `${s.title} ${HOME_SCREEN}`, buttons: ["OK"] }); return false; }
    if (await sheet({ title: s.title, buttons: [s.button], destructive: 0 }) !== 0) return false;
    const failed = [];
    for (const { r, a } of plan.act) {
      try { await remove(a, r); } catch (e) { failed.push(`${r.name}: ${deviceError(e).message}`); }
    }
    done();
    if (failed.length) await alert({ title: "Couldn't Remove", message: failed.join("\n"), buttons: ["OK"] });
    return true;
  }
  const jobs = manageJobs(kind, picked);
  // B66: picked marked apps Re-sign can't sign get an alert saying why (and the newest version to install instead),
  // never a quiet no-op.
  const blocked = kind === "resign" ? picked.filter((r) => manageKinds(r).blocked) : [];
  let newest = [];
  if (blocked.length) {
    const a = resignBlockedAlert(blocked, jobs.length);
    const tap = await alert({ title: a.title, message: a.message, buttons: a.buttons, stacked: a.buttons.length > 2 });
    const act = a.actions[tap?.index] ?? "cancel"; // nav/alert.js resolves { index, value }
    if (act === "cancel") return false;
    if (act === "newest") newest = a.newest;
  }
  if (!jobs.length && !newest.length) return false;
  if (jobs.length) { // the newest installs alone were confirmed by the alert
    const s = manageSheet(kind, jobs.length + newest.length, kind === "resign" ? jobs.filter((j) => j.url).length : 0, newest.length);
    if (await sheet({ title: s.title, buttons: [s.button] }) !== 0) return false;
  }
  const all = [...jobs, ...newest];
  if (await busy()) {
    await alert({ title: "Another Install Is Running", message: "Wait for it to finish, then try again. Your selection is kept.", buttons: ["OK"] });
    return false;
  }
  const res = await run(kind, all);
  // B66: the run stops at the first failure (its alert already shown) or before it starts (the Signing walkthrough);
  // F240: the sign-ahead run's failed and cancelled rows stay queued the same way:
  // Manage stays on with the apps that didn't go through still picked, so nothing is dropped quietly.
  const left = Array.isArray(res?.left) ? res.left.filter((id) => picked.some((r) => r.id === id)) : [];
  if (!left.length) { done(); return true; }
  view.selected = new Set(left);
  keep();
  return true;
}

// B66: Confirm's run is going (screens/queue.js runAppQueue would return 0 without a word).
async function appQueueBusy() {
  return (await import("./queue.js")).appQueueRunning();
}

// One app of a bulk Delete: the helper's uninstall behind its HUD, or forgetting the record.
async function deleteOne(a, r) {
  if (a.kind === "uninstall") return runDelete(a, r);
  return forgetApp(r);
}

// The run: every job into the app queue. F240: in the sideload app it is Confirm's sign-ahead run (screens/queue.js
// runAppQueueRun, screens/apprun.js: every app signed first, then handed to iOS in order, iFizBox last, on the black
// page with Apps | Log rows); a failed or cancelled row stays queued and comes back as `left`, the rest go on. The
// website (signing in the browser) keeps runAppQueue: one at a time, the first failure stops it and leaves the rest
// queued, each on the progress page as "Re-signing Delta (1 of 3)". `ahead`: use the sign-ahead run (null: the
// phone can sign ahead, unless a `run` was given); `aheadRun`: runAppQueueRun (tests).
export async function runManageJobs(kind, jobs, { queue = null, run = null, install = manageInstall, hud = null, ahead = null, aheadRun = null } = {}) {
  const q = queue ?? (await import("../app-queue.js")).appQueue;
  for (const j of jobs) q.add(j);
  if (ahead ?? (!run && await canSignAhead())) {
    const r = await (aheadRun ?? (await import("./queue.js")).runAppQueueRun)(jobs, { queue: q });
    // null: the Signing walkthrough opened instead (or another run holds the queue), nothing ran
    return { done: r?.installed ?? 0, left: jobs.filter((j) => q.get(j.id)).map((j) => j.id) };
  }
  const runner = run ?? (await import("./queue.js")).runAppQueue;
  let i = 0;
  const n = jobs.length;
  // B66: a blocked app's newest version under Re-sign is an install, and says so
  const verb = (j) => (kind === "resign" && j.mode !== "resign" ? "Installing" : MANAGE_VERB[kind] ?? "Installing");
  const done = await runner(jobs, { queue: q, install: (j) => install(j, { verb: verb(j), i: ++i, n, hud }) });
  // B66: the ids the run didn't get through (still queued: it stopped at a failure, or never started)
  return { done, left: jobs.filter((j) => q.get(j.id)).map((j) => j.id) };
}

// F240: the phone signs ahead (the sideload app with signing.prepare), as screens/queue.js useAppRun decides for Confirm.
async function canSignAhead() {
  const sc = await import("../signing-client.js");
  return sc.localSigning() && typeof sc.prepareOnDevice === "function";
}

// One job of the run with the bulk label: a re-sign through screens/queue.js resignApp, an update signed on the phone
// (installOnDevice) or, on the site, in the browser (signAndInstall).
export async function manageInstall(job, { verb, i, n, hud = null, sc = null, resign = null } = {}) {
  sc ??= await import("../signing-client.js");
  hud ??= (await import("../nav/progress.js")).progressHUD;
  const h = bulkHud(hud, { verb, name: job.name || job.id, i, n });
  if (job.mode === "resign") {
    resign ??= (await import("./queue.js")).resignApp;
    return resign(job, { sc, hud: h, deps: { hud: h } });
  }
  if (sc.localSigning() && !sc.isSelfIpa(job.url)) return sc.installOnDevice({ url: job.url, name: job.name || "" }, { hud: h });
  return sc.signAndInstall((await import("./queue.js")).siteInstallArgs(job)); // F262: with the app's bundle ID
}

// A HUD factory for job `i` of `n`: its label is always "<verb> <name> (i of n)", the bar the whole run's progress
// (the job's own percent counted in), and the job's own phases go to the page's log.
export function bulkHud(factory, { verb, name, i, n }) {
  return () => {
    let p = 0;
    let phase = null; // B65: the phase last written to the log, so a percent alone adds no line
    const label = () => `${verb} ${name} (${i} of ${n}) ${Math.round(((i - 1) + p / 100) / n * 100)}%`;
    const h = factory(label());
    const w = Object.create(h);
    w.set = (t) => {
      const { text, percent } = hudLine(t);
      if (percent != null) p = percent;
      if (text && text !== phase) h.page?.raw?.(text);
      if (text) phase = text;
      h.set(label());
    };
    return w;
  };
}

// ---- F125: the Wish List page --------------------------------------------------------------------------------

const wishView = { body: null, route: null, list: null, seq: 0, editing: false };

// The wished packages the sources carry, as a plain package list; installed ones drop off the list for good (as
// browse.js renderWishlist, F102).
async function loadWish() {
  const seq = ++wishView.seq;
  let rows;
  try {
    await catalog.ensure();
    const installed = ((await catalog.installed().catch(() => null)) ?? []).map((r) => r.id);
    browse.wishlist().prune(installed);
    const ids = browse.wishlist().list();
    const found = await Promise.all(ids.map((id) => catalog.package(id).then((p) => (p && !p.installedOnly ? p.row : null), () => null)));
    rows = wishRows(ids, found, installed);
  } catch (e) {
    if (seq === wishView.seq) wishView.body.replaceChildren(note(e.message));
    return;
  }
  if (seq !== wishView.seq) return;
  drawWish(rows);
}

function drawWish(rows) {
  const body = wishView.body;
  browse.dropList(body, wishView.list);
  wishView.list = null;
  body.classList.replace("grouped", "plain");
  if (!rows.length) { body.replaceChildren(note(WISH_EMPTY)); return; }
  body.replaceChildren();
  const list = browse.packageList(body, wishView.route, rows, { letters: false, decorate: decorateWish });
  list.el.classList.add("wish-list");
  list.el.classList.toggle("editing", wishView.editing);
  attachWishGestures(list.el);
  wishView.list = list;
  body.append(list.el);
}

// The list's rows are pooled (vlist.js): the Delete controls go in once per row and act on whatever it shows now.
function decorateWish(row, item) {
  if (!row._wish) {
    row._wish = true;
    row.classList.add("source-row", "wish-row");
    const toggle = Object.assign(document.createElement("button"), { type: "button", className: "del-toggle" });
    toggle.addEventListener("click", (e) => { e.preventDefault(); armWish(row, !row.classList.contains("armed")); });
    const confirm = Object.assign(document.createElement("button"), { type: "button", className: "del-confirm", textContent: "Delete" });
    confirm.addEventListener("click", (e) => { e.preventDefault(); removeWish(row, row._item.id); });
    row.append(toggle, confirm);
    row._wishToggle = toggle;
  }
  row.classList.remove("armed", "removing");
  row._wishToggle.setAttribute("aria-label", "Remove " + item.name);
}

function armWish(row, on) {
  for (const other of row.parentNode?.querySelectorAll(".wish-row.armed") ?? []) if (other !== row) other.classList.remove("armed");
  row.classList.toggle("armed", on);
}

// As the apps list's attachRowGestures: while editing, or while a row shows Delete, a tap only puts the Delete away;
// a left swipe shows it, a right one hides it.
function attachWishGestures(el) {
  let start = null;
  let swiped = false;
  el.addEventListener("click", (e) => {
    if (e.target.closest(".del-toggle, .del-confirm")) return;
    const armed = el.querySelector(".wish-row.armed");
    if (!(wishView.editing && e.target.closest(".wish-row")) && !armed && !swiped) return;
    e.preventDefault();
    e.stopPropagation();
    if (armed && !swiped) armed.classList.remove("armed");
    swiped = false;
  }, true);
  el.addEventListener("pointerdown", (e) => {
    const row = e.target.closest(".wish-row");
    swiped = false;
    start = row && !wishView.editing && !e.target.closest(".del-confirm") ? { row, x: e.clientX, y: e.clientY } : null;
  });
  el.addEventListener("pointermove", (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { start = null; return; } // a scroll
    if (Math.abs(dx) < 30 || Math.abs(dx) < Math.abs(dy) * 2) return;
    armWish(start.row, dx < 0);
    swiped = true;
    start = null;
  });
  const stop = () => { start = null; };
  el.addEventListener("pointerup", stop);
  el.addEventListener("pointercancel", stop);
}

function setWishEditing(on, button) {
  wishView.editing = on;
  wishView.list?.el.classList.toggle("editing", on);
  for (const row of wishView.body?.querySelectorAll(".wish-row.armed") ?? []) row.classList.remove("armed");
  if (button) {
    button.textContent = on ? "Done" : "Edit";
    button.classList.toggle("done", on);
  }
}

// The row fades, then leaves the list; the page redraws from the list's change (init).
function removeWish(row, id) {
  row.classList.add("removing");
  setTimeout(() => browse.wishlist().set(id, false), 250);
}
