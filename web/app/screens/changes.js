// Changes tab, after Cydia's ChangesController (docs/cydia.md "Changes and metadata.cb0"). Every catalog reload
// files what it saw in IndexedDB on the device (core/changes.js, via catalog.js); this tab lists the last 7 days
// of it, a section per day ("Today", "Yesterday", then the date; F51), newest first, leaving out what the first
// load saw. AltStore versions file under their own dates. Rows say New or Updated (iFizBox's addition). Nav bar:
// Refresh, as on the Sources tab. Below the root, the routes are screens/browse.js tokens (package:<id>, author:<name>).
// F51 filters, as on Search: a search field and a scope bar, All / Installed. Installed (dpkg's packages and the
// apps recorded on the device) is the default whenever anything is installed, else All; a tap on a segment holds
// for the session.
// Upgrades (F7): installed packages with a newer version on a source come first, under "Available Upgrades", then
// held ones (dpkg holds and Settings' Ignored Upgrades) under "Ignored Upgrades"; the tab badge counts the
// available ones, as Cydia's does.
// F62: Cydia's "Upgrade (N)" nav button (jailbreak build only: the site and the sideload build have no install
// queue). It queues every Available Upgrade, never the ignored ones, through N4's queue (one install job each, with
// the installed version so the queue reads it as an upgrade), which opens the Confirm sheet: Cydia's dist-upgrade.
// Hidden while there are none, as Cydia's is.
// F80: the sideload app's Upgrade (N) queues every available app upgrade too, in the app queue (app-queue.js), and
// opens the same Confirm (screens/queue.js openAppConfirm), which installs them in turn, iFizBox last.
// F91: the sideload app's apps whose signature is inside the re-sign window (Settings > Signing > Re-sign Reminder,
// default 2 days) or over get their own group above the upgrades, "Needs Re-sign" (core/signing.js needsResign, from
// signing.installed), count in the tab badge (and so the icon badge) and in Upgrade (N), which queues them as
// "resign" jobs (core/appqueue.js resignJob): Cydia's queue does both. An app with an upgrade is left to the upgrade,
// which signs it anew.
import { placeholder, el, segments, note } from "../nav/ui.js";
import { searchBar, pinned } from "../nav/searchbar.js";
import { pullToRefresh } from "../nav/pullrefresh.js";
import * as browse from "./browse.js";
import { catalog } from "../catalog.js";
import { getBackend } from "../backend.js";
import { showAlert } from "../nav/alert.js";
import { dayTitle, filterGroups, filterRows, defaultScope } from "../core/changes.js";
import { apps, installedIds, onAppsChange } from "../core/installed.js";
import { signedAppsNamed } from "../core/installed.js"; // B150
import { siteSignedApps, siteSignerNow } from "../core/installed.js"; // F342
import { settings } from "../settings-store.js";
import { sourceFilter } from "../core/sources.js";
import { detectMode } from "../core/settings.js";
import { upgradesWithSelf } from "../essential-ui.js";
import { withAppUpgrades } from "../app-updates.js";
import { appJob, resignJob, runOrder } from "../core/appqueue.js";
import { needsResign, resignWindow } from "../core/signing.js";
import { vendorSoldIds } from "./extras.js";
import { SELF_ID } from "../core/essential.js";
import { showHUD } from "../nav/hud.js"; // F250: reloadSources from outside the tab
import { appQueue } from "../app-queue.js"; // F255: the jailbreak app's Upgrade (N) queues app upgrades there
import { pageViews } from "../nav/pageviews.js"; // C25
import { go as navGo, handleOf } from "../nav/go.js";
import { isInsecureSource } from "../core/sources.js"; // B192
import { nativeBridge } from "../native.js";

export const title = "Changes";

// What every copy of the root page shares: the last load (`data`), the session's scope pick, a refresh under way.
const state = { busy: false, seq: 0, scope: null, data: null };

// C25: the root page can be on screen twice, its own tab and pushed on Home (Home's What's New, Check for Changes:
// router.js rootOn). Each copy has its own view (its list, search text and nav bar button); a load draws them all.
const views = pageViews(() => ({ page: null, route: null, list: null, results: null, query: "", note: null, ph: null, segs: null }));
const drawAll = () => { for (const v of views.all()) draw(v); };
const shown = () => views.all().length > 0;

export const SCOPES = [["all", "All"], ["installed", "Installed"]];

// The scope shown: the user's pick this session, else Installed when anything is installed.
export const scopeOf = (picked, installed) => picked ?? defaultScope(installed.size);

export function init(ctx) {
  state.ctx = ctx;
  catalog.onChange(() => { if (shown()) load(); else badge(); });
  onAppsChange(() => { if (shown()) load(); else badge(); }); // I3: a recorded install can end an upgrade
  // iFizBox's own source read (essential-ui.js readSelfInfo): its upgrade row and the badge count again.
  globalThis.addEventListener?.("ifizbox:self-info", () => { if (shown()) load(); else badge(); });
  settings.onChange((key) => { if (key === "holds" || key === "blockedPackages" || key === "resignReminder") { if (shown()) load(); else badge(); } });
  settings.onChange((key) => { if ((key === "autoInstall" || key === "autoMarked") && shown()) load(); }); // B192
  // At launch, only with a status file: without one there are no upgrades, and no reason to load every source.
  // Without one (the site, the sideload app) the remembered apps count, and iFizBox itself in the app: badge at
  // launch whenever there is anything installed to follow.
  catalog.hasStatus().then((has) => {
    if (has || detectMode() === "sideload") return badge(); // F91: signed apps can need a re-sign with nothing recorded
    return apps().then((s) => s.all()).then((recs) => { if (recs.length) badge(); });
  }).catch(() => {});
  // The app: take dpkg's holds (apt-mark showhold) as Ignored Upgrades; a change redraws through onChange.
  if (catalog.statusSource() === "native") settings.holds.sync().catch(() => {});
}

// F226: what Changes files under Ignored Upgrades: Settings' Ignored Upgrades (in the app dpkg's holds) and the
// blocked packages, so a blocked package's upgrade is never in Upgrade (N) or the badge, on the site too.
export function ignoredList(holds = [], blocked = []) {
  return [...new Set([...holds, ...blocked])].sort();
}
const ignoredIds = () => ignoredList(settings.holds.list(), settings.blocked.list());

// The tab badge: how many upgrades are available (ignored ones don't count), and F91's apps that need a re-sign.
// B264: counts run side by side (an install's record, the run's recount, a redraw); only the latest one asked for
// sets the badge, so an older count that answers late never puts a number back.
let badgeAsked = 0;
// B310: what the last count held (badgeAfterRun takes a run's packages off it), and whether a queue run has ended
// since: the next count then goes on the icon even when it is 0 and Changes isn't on screen. Only for a while
// (AFTER_RUN_MS): a recount that fails leaves later, ordinary counts to F65's rule.
let lastCounted = null;
let afterRunUntil = 0;
export const AFTER_RUN_MS = 2 * 60 * 1000;
async function badge(upgrades, resign) {
  const asked = ++badgeAsked;
  try {
    upgrades ??= await withAppUpgrades(await upgradesWithSelf(await catalog.upgrades(ignoredIds())), ignoredIds()); // F72, I3
    resign ??= await resignNow(upgrades);
    if (asked !== badgeAsked) return;
    sendResigns(resign);
    lastCounted = { upgrades, resign };
    setCount(badgeCount(upgrades, resign), Date.now() < afterRunUntil);
    afterRunUntil = 0;
  } catch {
    // no catalog yet: no badge
  }
}

const setCount = (n, ran, ctx = state.ctx) => {
  if (ran && typeof ctx?.badgeAfterRun === "function") ctx.badgeAfterRun("changes", n);
  else ctx?.setBadge("changes", n);
};

// B310: a queue run has just ended (screens/queue.js), and `ids` are the packages it installed, upgraded or removed.
// The tab badge and the icon badge drop to what's still waiting at once, from the last count less those packages,
// before dpkg's status is read again and Changes counts for real (catalog.reloadInstalled's change): iFizBox can go
// to the background right after the run, and a page in the background counts nothing. That recount goes on the
// icon too, 0 included, whichever tab is shown. -> the quick count set, or null without an earlier count.
export function badgeAfterRun(ids = [], { ctx = state.ctx, counted = lastCounted } = {}) {
  afterRunUntil = Date.now() + AFTER_RUN_MS;
  if (!counted || !ctx) return null;
  const done = new Set(ids);
  const { upgrades, resign } = counted;
  const left = { ...upgrades, available: (upgrades?.available ?? []).filter((r) => !done.has(r?.id)) };
  const n = badgeCount(left, resign);
  setCount(n, true, ctx);
  return n;
}

// B264: the sideload app's shell learns which Needs Re-sign rows the count holds (updates.resigns), so the icon badge
// drops a row the moment that app's re-sign is handed to iOS (BackgroundCheck.appHandedOff), even while this page
// sleeps in the background. Update rows it knows already (updates.watch's keys).
export function sendResigns(resign, { mode = detectMode(), native = nativeBridge() } = {}) {
  if (mode !== "sideload" || typeof native?.call !== "function") return false;
  const ids = [...new Set((resign ?? []).map((r) => r?.id).filter(Boolean))];
  Promise.resolve().then(() => native.call("updates.resigns", { ids })).catch(() => {});
  return true;
}

// B264: count again now (the tab badge, and through it the icon badge): an app's re-sign or install has just ended.
// A re-sign records nothing on the page (its signature lives in the shell's record), so nothing else would recount
// until the app is opened again. Resolves once the count is set (or failed), so a run can keep iFizBox running in
// the background until then. Changes on screen redraws as well.
export function recountBadge() {
  if (shown()) load();
  return badge();
}

export function nav(route, ctx) {
  if (route.path.length) return browse.nav(route);
  // B176: pushed on Home (What's New, Check for Changes) Back takes the left: Refresh goes to the right end.
  const info = { title: "Changes", style: "plain", left: { label: "Refresh", onClick: () => refresh(ctx), pushed: "right" } };
  if (canUpgrade()) info.right = { label: upgradeLabel(0), onClick: () => upgradeAllJailbreak(state.data?.upgrades.available, state.data?.vendorSold) };
  // The sideload app: Upgrade (N) queues each app's new IPA and opens Confirm (F80), signed on the phone in turn.
  else if (detectMode() === "sideload") info.right = { label: upgradeLabel(0), onClick: () => queueAll(state.data?.upgrades.available, state.data?.resign) };
  return info;
}

// ---- Upgrade (N) (F62) ----------------------------------------------------------------------------------------

// Only the jailbreak build has an install queue (backend-native.js queueCalls); the site and sideload never ask.
export function canUpgrade(mode = detectMode(), backend = () => getBackend()) {
  return mode === "jailbreak" && typeof backend()?.queue === "function";
}

export const upgradeLabel = (n) => `Upgrade (${n})`;

// ---- F91: Needs Re-sign -----------------------------------------------------------------------------------------

// The tab badge's number: available upgrades and apps that need a re-sign (needsResign already leaves out the ones
// with an upgrade).
export const badgeCount = (upgrades, resign = []) => (upgrades?.available?.length ?? 0) + (resign?.length ?? 0);

// The apps iFizBox signed that are inside the re-sign window, from signing.installed (sideload app only; [] anywhere
// else or when the call fails). `upgrades`: those with an upgrade are left to it.
// F342: on the website, the install records that carry the website's signature (core/installed.js siteSignedApps).
export async function resignNow(upgrades, { mode = detectMode(), native = nativeBridge(), get = (k) => settings.get(k), now = new Date(),
  records = () => apps().then((s) => s.all()), signer = siteSignerNow } = {}) {
  let installed;
  if (mode === "site") {
    try { installed = siteSignedApps(await records(), await signer()); } catch { return []; }
  } else if (mode !== "sideload" || typeof native?.call !== "function") return [];
  else try { installed = await signedAppsNamed(native); } catch { return []; } // B150: a source app keeps its source name
  const skip = new Set((upgrades?.available ?? []).map((r) => r?.id).filter(Boolean));
  return needsResign(installed, { now, window: resignWindow(get), skip });
}

// Upgrade (N) in the sideload app: the re-signs first, then the upgrades (an app in both is the upgrade's). -> jobs.
export async function queueAll(available = [], resign = [], { add = null, pkgOf } = {}) {
  add ??= (await import("./queue.js")).queueApp;
  const out = queueResigns(resign, { add });
  return [...out, ...(await queueUpgrades(available, { add, ...(pkgOf ? { pkgOf } : {}) }))];
}

// Each Needs Re-sign row as a "resign" job (core/appqueue.js resignJob), through `add` (screens/queue.js queueApp).
export function queueResigns(rows = [], { add }) {
  const jobs = (rows ?? []).map(resignJob).filter(Boolean);
  for (const j of jobs) add(j);
  return jobs;
}

// One install job per available upgrade, as browse.js's Upgrade action queues it. F87: not the jailbreak app's
// remembered apps (`remembered`, app-updates.js): apt has no package by an app's bundle id; their row opens the app page.
// B19: nor the ids in `skip`, paid packages their vendor sells (extras.js vendorSoldIds): apt can't fetch them, and
// their rows still open the page with its Download & Install.
export const upgradeJobs = (available = [], skip = null) =>
  available.filter((r) => r?.id && r.version && !r.remembered && !skip?.has(r.id)).map((r) => ({ op: "install", id: r.id, version: r.version, installed: r.installed ?? null, name: r.name ?? null }));

// Queues them all; the first add opens Confirm (screens/queue.js initQueue), the rest refresh it. -> jobs queued.
export function upgradeAll(queue, available, skip = null) {
  const jobs = upgradeJobs(available, skip);
  if (!queue) return [];
  for (const job of jobs) queue(job);
  return jobs;
}

// ---- B68: the jailbreak app's Upgrade (N) with app (IPA) upgrades --------------------------------------------------
//
// Changes lists the remembered apps' upgrades (app-updates.js withAppUpgrades, `remembered`) beside dpkg's, but apt
// can't fetch them (F87), so upgradeJobs leaves them out; counting only its jobs hid the button whenever every listed
// upgrade was an app. The count is both. Only `available` rows: never the ignored ones.
// F255: the tap queues apt's rows in the install queue and each app's new IPA in the app queue (app-queue.js), as a
// row's swipe queues an app there (B71a), so one Confirm lists them all and runs them (screens/queue.js
// runJailbreakApps: the apps on the helper's black page first, then apt's packages).

// The remembered apps' rows among the available upgrades (B19's `skip` too).
export const appUpgradeRows = (available = [], skip = null) =>
  (available ?? []).filter((r) => r?.id && r.version && r.remembered && !skip?.has(r.id));

// What Upgrade (N) says in the jailbreak app.
export const jailbreakUpgradeCount = (available = [], skip = null) =>
  upgradeJobs(available ?? [], skip).length + appUpgradeRows(available, skip).length;

// The tap. `queue`: the install queue's add (queueFn: its first add opens Confirm); `apps`: the app queue (its first
// add opens Confirm when apt's didn't, later ones redraw it). The run records each app at its new version
// (screens/queue.js recordJbApp). -> { apt, apps }: the jobs queued in each.
export async function upgradeAllJailbreak(available = [], skip = null, { queue = queueFn(), pkgOf = null, apps: appq = appQueue } = {}) {
  const rows = appUpgradeRows(available, skip);
  const apt = upgradeAll(queue, available, skip);
  const appJobs = runOrder(await queueUpgrades(rows, { add: () => {}, ...(pkgOf ? { pkgOf } : {}) }));
  const queued = [];
  for (const job of appJobs) {
    try { queued.push(appq.add(job)); } catch { /* no id: it stays listed in Changes */ }
  }
  return { apt, apps: queued };
}

// Sideload Upgrade (N) (F80): every available upgrade with an IPA as an app queue job (core/appqueue.js appJob, the
// version Changes shows; iFizBox's own row carries its IPA), queued through `add` (screens/queue.js queueApp: the first
// opens Confirm, the rest redraw it). -> jobs queued.
// The Home Screen icon's Upgrade All (native Shortcut): every available upgrade, ignored ones left out, queued,
// and Confirm opens. -> the jobs queued.
export async function upgradeEverything() {
  await catalog.ensure();
  const holds = ignoredIds();
  const u = await withAppUpgrades(await upgradesWithSelf(await catalog.upgrades(holds)), holds);
  // B68: the jailbreak app has apt's queue and installs IPAs itself (the app queue signs, which it refuses).
  if (canUpgrade()) { const r = await upgradeAllJailbreak(u.available, await vendorSoldNow(u)); return [...r.apt, ...r.apps]; }
  return queueAll(u.available, await resignNow(u)); // F91: and the apps that need a re-sign
}

// B44: the "iFizBox X is out." banner's Upgrade (essential-ui.js bannerOnce). Queues iFizBox's own upgrade alone, as
// its Changes row would be queued, and Confirm opens: jailbreak apt's com.ryha.ifizbox row through the install queue
// (initQueue's add opens Confirm), sideload its IPA through the app queue (queueApp opens openAppConfirm). It waits for
// the catalog (up to `wait` ms); with no row by then (not loaded, apt's repo not refreshed yet, ignored) it opens
// Changes instead. -> "queued" | "changes".
export async function upgradeSelf({ mode = detectMode(), upgrades = null, queue = queueFn, add = null, pkgOf = null, wait = 20000,
  changes = () => navGo("#/changes") } = {}) {
  upgrades ??= () => selfUpgrades(mode);
  let u = null;
  let timer = 0;
  try {
    u = await Promise.race([upgrades(), new Promise((r) => { timer = setTimeout(() => r(null), wait); })]);
  } catch { u = null; } finally { clearTimeout(timer); }
  const row = (u?.available ?? []).find((r) => r?.id === SELF_ID);
  let jobs = [];
  if (row && mode === "jailbreak") jobs = upgradeAll(queue(), [row]); // queueFn: null without a backend queue
  else if (row && mode === "sideload") jobs = await queueUpgrades([row], { add, ...(pkgOf ? { pkgOf } : {}) });
  if (jobs.length) return "queued";
  changes();
  return "changes";
}

// The upgrades Changes lists, for upgradeSelf: sideload's iFizBox row is upgradesWithSelf's, read with or without the
// catalog; the jailbreak row is apt's.
async function selfUpgrades(mode) {
  const holds = ignoredIds();
  const none = { available: [], ignored: [] };
  if (mode === "sideload") return upgradesWithSelf(await catalog.ensure().then(() => catalog.upgrades(holds)).catch(() => none));
  await catalog.ensure();
  return catalog.upgrades(holds);
}

export async function queueUpgrades(available = [], { pkgOf = (id) => catalog.package(id), add = null } = {}) {
  add ??= (await import("./queue.js")).queueApp;
  const jobs = [];
  for (const r of available ?? []) {
    if (!r?.id) continue;
    const p = await Promise.resolve().then(() => pkgOf(r.id)).catch(() => null);
    let job = p ? appJob(p, { installed: r.installed ?? null, version: r.version ?? null }) : null;
    if (!job && typeof r.ipa === "string" && /^https?:\/\//.test(r.ipa)) {
      job = { id: r.id, name: r.name ?? null, version: r.version ?? null, installed: r.installed ?? null, url: r.ipa, size: null,
        icon: r.icon ?? null, key: r.key ?? null };
    }
    // B159: a row whose version the package doesn't list (iFizBox's own row from GitHub's release while its source
    // still lists the old one) installs the row's own IPA, not the package's newest (an older) one
    if (job && typeof r.ipa === "string" && /^https?:\/\//.test(r.ipa) && r.version && job.version !== r.version) {
      job = { ...job, version: r.version, url: r.ipa, size: null };
    }
    if (!job) continue;
    job = { ...job, id: r.id, name: job.name || r.name || null };
    jobs.push(job);
  }
  for (const job of jobs) add(job);
  return jobs;
}

const queueFn = () => { const b = getBackend(); return typeof b.queue === "function" ? (job) => b.queue(job) : null; };

// A copy's nav bar button (its page handle's), labelled and shown with the count.
function drawUpgradeButton(view, n) {
  const b = view.page?.rightButton(); // B176: not a pushed copy's Refresh (nav/go.js pageHandle)
  if (!b) return;
  const label = upgradeLabel(n);
  if (b.textContent !== label) b.textContent = label;
  b.hidden = n === 0;
}

export function render(body, route, ctx, page = handleOf(body)) {
  if (route.path.length) {
    browse.render(body, route, ctx, page);
    return;
  }
  const had = views.of(body);
  had?.list?.destroy();
  const view = views.open(body, { page, route, list: null });
  drawUpgradeButton(view, 0);
  // C10: the bar and the scope row stay put; the list scrolls under them (nav/searchbar.js pinned).
  view.results = pinned(body, ...filterBar(view));
  // F270: pull the list down past its top: Refresh, as the nav button.
  pullToRefresh(view.results, { onRefresh: () => refresh(ctx), busy: () => state.busy, settings });
  view.note = note("");
  view.note.hidden = true; // errors and "no changes" show here; while loading, placeholder rows
  view.ph = placeholder("list");
  view.results.append(view.note, view.ph);
  draw(view); // another copy's last load, at once; the load below brings it up to date
  load();
}

// The shared bar (nav/searchbar.js) and Search's scope bar (screens/search.js, packages.css), without the Filter button.
// The search text is the copy's own; the scope is the session's pick, so a tap redraws every copy.
function filterBar(view) {
  const bar = searchBar({ placeholder: "Search Changes", ariaLabel: "Search changes: name, description or author",
    value: view.query, delay: 120, className: "has-scope", onQuery: (q) => { view.query = q; draw(view); } });

  const scope = el("div", "search-scope");
  view.segs = segments(SCOPES.map(([value]) => value), Object.fromEntries(SCOPES), null, (value) => { state.scope = value; drawAll(); });
  scope.append(view.segs);
  drawScope(view);
  return [bar, scope];
}

function drawScope(view, current = state.scope ?? (state.data ? scopeOf(null, state.data.installed) : null)) {
  view.segs?.select(current);
}

// Rows as the package list draws them, with each group's header in front: the upgrades first, then a group per
// day. An installed package shows under its upgrade, not again under its day (Cydia's rule). `filter`: the search
// field and scope (core/changes.js filterRows); upgrades are installed packages, so the scope never hides them.
// F91: `resign` (core/signing.js needsResign rows) comes first, as "Needs Re-sign".
// B192: `autoHttp` (autoHttpIds) are the available upgrades the daemon won't install by itself: their rows say why.
export function itemsOf(groups, locale, upgrades = { available: [], ignored: [] }, { now = Date.now(), query = "", scope = "all", installed = new Set(), resign = [], autoHttp = null } = {}) {
  const items = [];
  const upgraded = new Set();
  for (const [header, all] of [["Needs Re-sign", resign ?? []], ["Available Upgrades", upgrades.available], ["Ignored Upgrades", upgrades.ignored]]) {
    const rows = filterRows(all, { query });
    for (const r of all) upgraded.add(r.id);
    if (!rows.length) continue;
    items.push({ header });
    for (const r of rows) {
      const why = header === "Available Upgrades" && autoHttp?.has(r.id) ? { short: AUTO_HTTP_NOTE } : null;
      items.push({ ...r, change: r.change === "resign" ? "resign" : "upgrade", ...why });
    }
  }
  for (const g of filterGroups(groups, { query, scope, installed })) {
    const rows = g.rows.filter((r) => !upgraded.has(r.id));
    if (!rows.length) continue;
    items.push({ header: dayTitle(g.day, now, locale) });
    items.push(...rows);
  }
  return items;
}

// What the empty list says.
export function emptyText({ query = "", scope = "all" } = {}) {
  if (query.trim()) return "No changes match your search.";
  if (scope === "installed") return "No changes to installed packages in the last 7 days.";
  return "No changes in the last 7 days. New and updated packages show here after a refresh.";
}

function decorate(row, item) {
  row.dataset.change = item.change;
  if (item.sig) row.dataset.sig = item.sig; else delete row.dataset.sig; // F91: the pill's colour (packages.css)
}

// Everything installed (dpkg's packages and the apps recorded on the device), as ids; failures count as none.
async function installedNow() {
  const [rows, recs] = await Promise.all([catalog.installed().catch(() => null), apps().then((s) => s.all()).catch(() => [])]);
  return installedIds(rows, recs);
}

// B19: the available upgrades a vendor sells, which Upgrade (N) leaves out (only where it queues; none on failure).
async function vendorSoldNow(upgrades) {
  if (!canUpgrade() || !(upgrades?.available ?? []).some((r) => r?.paid)) return new Set();
  const sources = await Promise.resolve().then(() => getBackend().sources()).catch(() => []);
  return vendorSoldIds(upgrades.available, sources).catch(() => new Set());
}

// B192: the jailbreak daemon installs automatically from https sources only (native/daemon/auto.c auto_insecure),
// so an available upgrade it would pick (Install Updates Automatically: Everything, or Only Packages I Mark and
// marked) from an http source says so in place of its description. Upgrade (N) and its page still install it.
export const AUTO_HTTP_NOTE = "Not installed automatically: its source uses http, not https.";

// -> the ids among `available` (catalog rows; `key`: their source) that the daemon skips for http. `sources`: the
// backend's list ({ key, uri }); `autoInstall`: the setting ("off" | "marked" | "all"); `marked(id)`: Update
// Automatically is on for it.
export function autoHttpIds(available = [], sources = [], { autoInstall = "off", marked = () => false } = {}) {
  const out = new Set();
  if (autoInstall !== "marked" && autoInstall !== "all") return out;
  const http = new Set((sources ?? []).filter((s) => s?.key != null && isInsecureSource(s)).map((s) => s.key));
  for (const r of available ?? []) {
    if (!r?.id || r.remembered || !http.has(r.key)) continue;
    if (autoInstall === "all" || marked(r.id)) out.add(r.id);
  }
  return out;
}

// The ids above for this device's settings: jailbreak app only; none on failure.
async function autoHttpNow(upgrades) {
  if (!canUpgrade() || !settings.isShown?.("autoInstall")) return new Set();
  const autoInstall = settings.get("autoInstall");
  if (autoInstall !== "marked" && autoInstall !== "all") return new Set();
  const sources = await Promise.resolve().then(() => getBackend().sources()).catch(() => []);
  return autoHttpIds(upgrades?.available, sources, { autoInstall, marked: (id) => Boolean(settings.autoMarked?.has(id)) });
}

async function load() {
  const seq = ++state.seq;
  let groups, upgrades, installed, resign, vendorSold, autoHttp;
  try {
    await catalog.ensure();
    [groups, upgrades, installed] = await Promise.all([catalog.changes(), catalog.upgrades(ignoredIds()), installedNow()]);
    upgrades = await upgradesWithSelf(upgrades); // F72: the sideload build lists iFizBox's own upgrade here
    upgrades = await withAppUpgrades(upgrades, ignoredIds()); // I3: the apps Install remembered (app-updates.js)
    resign = await resignNow(upgrades); // F91
    vendorSold = await vendorSoldNow(upgrades); // B19
    autoHttp = await autoHttpNow(upgrades).catch(() => new Set()); // B192
  } catch (e) {
    if (seq !== state.seq) return;
    for (const v of views.all()) {
      if (!v.note) continue;
      v.ph?.remove();
      v.note.textContent = e.message;
      v.note.hidden = false;
    }
    return;
  }
  if (seq !== state.seq) return;
  badge(upgrades, resign);
  state.data = { groups, upgrades, installed, resign, vendorSold, autoHttp };
  drawAll();
}

// Draws a copy's list from the last load with its search and the scope (no reload: typing stays fast).
function draw(view) {
  const body = view?.body;
  if (!body || !state.data || !view.note) return;
  const { groups, upgrades, installed, resign = [], vendorSold = null, autoHttp = null } = state.data;
  view.ph?.remove();
  view.ph = null;
  drawUpgradeButton(view, canUpgrade() ? jailbreakUpgradeCount(upgrades.available, vendorSold) : upgrades.available.length + resign.length); // B68: apt's and the apps'; F91: re-signs too
  const scope = scopeOf(state.scope, installed);
  drawScope(view, scope);
  const items = itemsOf(groups, undefined, upgrades, { query: view.query, scope, installed, resign, autoHttp });
  view.note.hidden = items.length > 0;
  view.note.textContent = items.length ? "" : emptyText({ query: view.query, scope });
  if (!view.list) {
    const results = view.results ?? body;
    view.list = browse.packageList(results, view.route, items, { letters: false, decorate });
    results.append(view.list.el);
  } else {
    browse.rememberNames(items.filter((r) => r.id));
    view.list.setItems(items);
  }
}

async function refresh(ctx) {
  if (await reloadSources({ hud: ctx.showHUD })) settings.lastRefresh?.set(); // F270: pull to refresh's Last Updated
}

// F250: Changes' Refresh as one job, which the website also runs on Browse Anyway and on launch once browsing is
// unlocked (websign-gate.js refreshSourcesNow / refreshOnLaunch): the enabled sources refreshed (this device's
// filter), the Reloading Data HUD over it, then the lists reloaded. One at a time: a call while one runs does
// nothing. -> true when it ran
export async function reloadSources({ hud = state.ctx?.showHUD ?? showHUD, backend = () => getBackend(), alert = showAlert,
  reload = async () => { if (catalog.statusSource() === "native") await catalog.reloadInstalled(); await load(); } } = {}) {
  if (state.busy) return false;
  const hide = hud("Reloading Data");
  state.busy = true;
  try {
    await backend().refreshSources(undefined, { filter: sourceFilter(settings.deviceType()) }); // F41
    await reload();
  } catch (e) {
    hide();
    await alert({ title: "Error", message: e.message, buttons: ["OK"] });
  } finally {
    hide();
    state.busy = false;
  }
  return true;
}
