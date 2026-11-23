// Home tab, laid out like Cydia's on the 4S (ref/4s/screens/cydia-home.png; styles in home.css):
//   - iFizBox's icon beside "Welcome to iFizBox" and a by-line
//   - tile rows: GitHub | Sources as one outlined pair (Cydia: Facebook | Twitter), then Featured and Themes as two
//     white half-width tiles
//   - a full-width green tile in Cydia's Manage Account place: always More Sources (MORE_SOURCES_TILE; F327:
//     Recommended and finding more, screens/moresources.js)
//   - a grouped list like Cydia's help links: Upgrading & Jailbreaking Help (our page), Find Extensions for
//     Applications (Search); User Guides (screens/guides.js); Credits
// Every tile and row is a .cell-inner link, so it gets the table cells' held look (blue selection) from ios6.css
// and app.js. No featured banners above the tiles (F154: Browse's Tweak of the Day card instead).
//
// Routes below the tab: help, featured, sources (Recommended Sources), guides/<id>, credits, wishlist (F102), and browse (F46): Browse's list
// (F124: New, Recently Updated, Popular, Featured, Free Apps / Tweaks / Themes, then the categories), browse/<list id>
// (core/catalog.js BROWSE_LISTS: new, updated, popular, featured, free-apps...), browse/category:<name>, and below those browse.js's tokens
// (package:<id>, author:<name>, versions:<id>), as in the Search tab.
import { grouped, el, placeholder, note } from "../nav/ui.js";
import { format, settingsRoute, parse, rootOn } from "../router.js";
import { getBackend } from "../backend.js";
import { showAlert } from "../nav/alert.js";
import { popupOpen, whenNoPopup } from "../nav/popups.js";
import { sourceKey } from "../core/sources.js";
import { settings } from "../settings-store.js";
import { nativeIcons, iconImage } from "../appicon.js"; // F323: Home's header shows the app's icon now
import { pullToRefresh } from "../nav/pullrefresh.js";
import { go as navGo } from "../nav/go.js";
import { lazyNs, load } from "../lazy.js";
// F313: Browse and Tweak Roulette load at their routes (lazy.js; router.js lazyFor), not with Home.
const browse = lazyNs("browse");
const roulette = lazyNs("roulette");
import { catalog } from "../catalog.js";
import { footLine, versionLines, buildInfo } from "./version-foot.js";
import { signAndInstall } from "../signing/install.js";
import { signingReady, getBring, getServer } from "../signing/identity.js";
import { deviceStatus, statusReady } from "../signing/device.js";
import { serverReachable } from "../signing/library.js";
import { expiryWarning, expiryWarningDays, resignWindow, signingTile, normalizeServer } from "../core/signing.js";
import { rememberInstall } from "./signing.js";
const featuredRefs = () => load("extras").then((m) => m.featuredRefs()); // F313: loaded with the Featured list
import { browseList, browseListsFor, FRESH_DAYS, collection } from "../core/catalog.js";
import { dayOf, dayTitle } from "../core/changes.js";
import { isAltKey } from "../core/altstore.js";
import { homeOffer, debUrl, debAlert, REPO_URL, DISCORD_URL, APP_IPA_URL, APP_NAME, ownBuilds, APP_APT_REPO } from "../core/appoffer.js";
import { fetchRelease, debFor } from "../core/selfupdate.js";
const refreshInBackground = (ctx) => load("sources").then((m) => m.refreshInBackground(ctx)); // F313: Sources loads after Home
import { markiFizBoxInstalled, browsingLocked, askToBrowse } from "../websign-gate.js";
// C32: Home's root needs only the guide list (guide-index.js); the guides load at #/home/guides (lazy.js).
import { guideRows, JAILBREAK_INFO_URL, isLite } from "./guide-index.js";
const guides = lazyNs("guides");
import * as why from "./why.js"; // F303: Why <NAME> (#/home/why)
import { NAME } from "../brand.js";
import { rowIcon, PAGE_ICONS } from "../icons/rowicons.js";
import { nativeBridge } from "../native.js";
import { routeFailure, ROUTE_KEY } from "../core/installroute.js"; // B316
import { cellularWarning, CELLULAR } from "../core/installroute.js"; // F372


export const title = "Home";

// Recommended Sources: well-known flat repos, added in one tap (core/sources.js addSource takes flat repos only, so
// the dist ones among the defaults can't be offered here). Each answered with a Release on 2026-11-17.
export const CURATED_SOURCES = [
  { name: "Chariz", uri: "https://repo.chariz.com/", blurb: "tweaks and themes, free and paid" },
  { name: "Havoc", uri: "https://havoc.app/", blurb: "tweaks and themes, free and paid" },
  { name: "Twickd", uri: "https://repo.twickd.com/", blurb: "tweaks from the Twickd team" },
  { name: "SparkDev", uri: "https://sparkdev.me/", blurb: "SparkDev's tweaks" },
  { name: "ElleKit", uri: "https://ellekit.space/", blurb: "the tweak injection library" },
  { name: "palera1n", uri: "https://repo.palera.in/", blurb: "palera1n's own packages" },
].map((s) => ({ ...s, key: sourceKey({ uri: s.uri, dist: "./" }) }));

// B172: Home's link to Search (Find Extensions for Applications) pushes it onto Home's stack (it slides in, Back
// returns to Home), as every other page opens; a plain #/search would switch tabs without a slide.
export const SEARCH_HREF = format(rootOn("search"));
const HELP_ROUTE = { tab: "home", path: ["help"] };

// F327: More Sources (screens/moresources.js), with the Sources tab's plus tile, on Home's own stack (router
// mountLink): Back comes home.
export const MORE_SOURCES_HREF = format({ tab: "sources", path: ["more"] });
// B295 (user 2026-11-21): the green row under the tiles is always More Sources, highlighted with its own blue plus
// (.glyph-more); it no longer follows the sources or upgrades (the Changes badge and the Sources tab show those), and
// Home's list has no More Sources row.
export const MORE_SOURCES_TILE = { label: "More Sources", href: MORE_SOURCES_HREF, glyph: "more" };

// F79: Home's Install IPAs tile, beside Browse: the Installed tab's Install IPAs page (screens/myipas.js). F212: in the
// jailbreak app too, now that the page lists /var/mobile/Documents' IPAs there and installs them with the helper.
// F93 (as before F89): Install iFizBox App on the website, Not Jailbroken: with a certificate in Settings > Signing,
// iFizBox's IPA signed in the browser and installed, carrying the certificate (Bring My Certificate), sources and
// settings into its first launch; without one, Settings > Signing first. -> "install" | "signing"
// F96: once iOS was asked to install it, the website stops asking "Install iFizBox First" (websign-gate.js).
// F177: on the way to Signing it remembers this install (signing.js rememberInstall), so Signing offers Install Now
// once the certificate is in.
// F385: not straight to Signing any more: Sign iFizBox First (signing-sheet.js signFirstSheet) says why and lists the
// ways (Use a Free Apple ID only while the Apple relay is on); a pick opens Signing at its group, Cancel stays here.
// -> "install" | "signing" | "cancelled"
const freeRouteOn = async () => !nativeBridge() && (await import("./free-apple-id.js")).relayAvailable(); // as signing.js
const signFirst = async (opts) => (await import("../signing-sheet.js")).signFirstSheet(opts);
const focusWay = async (id) => (await import("../signing-sheet.js")).focusSigningGroup(id);
export async function installApp({ ready = signingReady, install = signAndInstall, bring = getBring, go = navGo,
  installed = markiFizBoxInstalled, remember = rememberInstall, sheet = signFirst, free = freeRouteOn, focus = focusWay } = {}) {
  const run = () => install({ url: APP_IPA_URL, name: APP_NAME, bring: bring(), onInstalled: () => installed() });
  if (!(await ready())) {
    let on = false;
    try { on = Boolean(await free()); } catch { /* no relay: no free route */ }
    const way = await sheet({ free: on });
    if (!way) return "cancelled";
    remember({ name: APP_NAME, run });
    go(format(settingsRoute(["signing"])).replace(/^#/, ""));
    focus(way);
    return "signing";
  }
  run();
  return "install";
}

// F96: Home's Install iFizBox App tile's action, also the first-visit prompt's Install iFizBox: Not Jailbroken, signed
// in the browser (installApp); jailbroken, the .deb for the device's arch (installDeb).
export function installiFizBox({ offer = homeOffer({ mode: settings.mode, deviceType: settings.deviceType() }) } = {}) {
  if (!offer) return null;
  return offer.action === "deb" ? installDeb(offer.arch) : installApp();
}

// Home's Signing tile (Settings > Signing) where something signs: the sideload app and, F93, the website (in the
// browser). The jailbreak app shows Themes there. F123: only while signing isn't set up (user 2026-11-18: "when
// signing is setup it should be hidden in settings"); after that it lives in Settings > Signing alone.
// F307: the tile itself is now certRow's solid red Signing Needs Setup (core/signing.js signingTile); this still
// answers where and when it shows.
export const showsSigningTile = (mode, setUp = false) => (mode === "sideload" || mode === "site") && !setUp;

// F123: whether signing is set up, for the Signing tile. The website: a certificate and profile saved, password
// right (signingReady). The sideload app: every step of Settings > Signing's walkthrough done (signing.js
// missingStep: the certificate on the device and an https Signing Server). Anything that fails counts as not set up.
// F307: on the website a Free Apple ID login (free-apple-id.js, kept in this browser) counts too (the approved
// concept: the warning is for "no certificate and no login").
export async function signingSetUp(mode, { ready = signingReady, status = () => deviceStatus(), server = getServer,
  missing = async (st, sv) => (await import("./signing.js")).missingStep(st, sv),
  free = async () => (await import("./free-apple-id.js")).loadFreeIdentity() != null } = {}) {
  try {
    if (mode === "site") return Boolean(await ready()) || Boolean(await free());
    if (mode === "sideload") return (await missing(await status(), server())) == null;
  } catch { /* the signer didn't answer */ }
  return false;
}

// F123: Home's list below the tiles, as Cydia's: the help links, User Guides, then Credits / Thank You. Settings (it left
// the tab bar; its pages open on Home's stack, router.js settingsRoute) is its own group, F135: first, directly under
// the tiles (user 2026-11-18: "move settings up on the main page and give it an icon"). F159: it has the tiles' inset,
// so it lines up with Featured/Signing above. F223: its gear is Settings > General's (icons/rowicons.js, the same
// PAGE_ICONS entry Settings' root draws), one gear in both places (user 2026-11-18). Read when Home draws, not at
// import, so it is the Style showing then (iOS 6 or iOS 7's tile).
export const settingsIcon = (style) => rowIcon(PAGE_ICONS.general, style);
// Settings shares its row with Theme (Settings > Theme) as two halves, like the Featured | Signing tiles (user
// 2026-11-18: "split the homescreen setting button to have setting and theme"); render() makes the group a pair.
export const THEME_ICON = "home-glyph glyph-theme";
// F157: the User Guides' lite set (no jailbreak guides) while Not Jailbroken: the sideload build, and the website
// while Settings > Device says so (as F144).
const guidesLite = () => isLite(settings.deviceType());
export function homeLinks() {
  return [{ pair: true, rows: [{ label: "Settings", href: format(settingsRoute()), icon: settingsIcon(), cls: "home-settings-row" },
    { label: "Theme", href: format(settingsRoute(["theme"])), icon: { cls: THEME_ICON }, cls: "home-settings-row" }] }, {
    rows: [
      { label: "Upgrading & Jailbreaking Help", href: format({ tab: "home", path: ["help"] }) },
      { label: "Find Extensions for Applications", href: SEARCH_HREF, chevron: true },
    ],
  }, { header: "User Guides", rows: guideRows(format, guidesLite()) },
  { rows: [{ label: "Credits / Thank You", href: format({ tab: "home", path: ["credits"] }) }] }];
}

// F156: Home's link rows that stay open on the locked website (user 2026-11-18: "dont lock credits and thank you or
// jailbreaking help"): Settings (F123), Upgrading & Jailbreaking Help, the User Guides and Credits / Thank You. They
// need no install and help people get to one. Find Extensions and More Sources stay locked.
const OPEN_WHILE_LOCKED = new Set(["settings", "help", "guides", "credits", "why"]); // F303: Why <NAME> too
export function openWhileLocked(href) {
  if (!href?.startsWith?.("#/")) return false;
  const route = parse(href);
  if (route.tab !== "home") return false;
  const first = route.path[0];
  return first === settingsRoute().path[0] ? true : OPEN_WHILE_LOCKED.has(first);
}
// Marks Home's locked link rows (.home-locked on the row's li; a group whose rows are all locked gets it too) and
// returns what it marked. links is homeLinks(), groups the .group boxes grouped(links) drew, in the same order.
export function lockHomeLinks(groups, links) {
  const marked = [];
  links.forEach((section, i) => {
    const group = groups[i];
    const cells = group?.querySelectorAll(".cell") ?? [];
    const shut = section.rows.map((r) => !openWhileLocked(r.href));
    if (shut.length && shut.every(Boolean)) { group.classList.add("home-locked"); marked.push(group); return; }
    shut.forEach((s, j) => { if (s && cells[j]) { cells[j].classList.add("home-locked"); marked.push(cells[j]); } });
  });
  return marked;
}
// Repaints the row tiles Home's link groups drew (groups, as lockHomeLinks) with links' icons: homeLinks() read again
// after Theme > Style changes, so Settings' gear is the new Style's at once. Returns how many.
export function repaintLinkIcons(groups, links) {
  let n = 0;
  links.forEach((section, i) => {
    const cells = groups[i]?.querySelectorAll(".cell") ?? [];
    section.rows.forEach((r, j) => {
      const img = cells[j]?.querySelector(".cell-icon > img");
      if (!r.icon?.src || !img || img.src === r.icon.src) return;
      img.src = r.icon.src;
      n++;
    });
  });
  return n;
}
// Calls onStyle each time <html data-style> changes (Theme > Style, and its live preview on the theme lists) while
// box is on the page; stops once box has left it. Returns the stop function.
export function followStyle(box, onStyle, doc = globalThis.document, Observer = globalThis.MutationObserver) {
  const root = doc?.documentElement;
  if (!root || typeof Observer !== "function") return () => {};
  let last = root.dataset?.style;
  const mo = new Observer(() => {
    if (!box.isConnected) { mo.disconnect(); return; }
    const now = root.dataset?.style;
    if (now === last) return;
    last = now;
    onStyle(now);
  });
  mo.observe(root, { attributes: true, attributeFilter: ["data-style"] });
  return () => mo.disconnect();
}
// A tap on anything in box marked .home-locked asks (askToBrowse) instead of opening; other taps go through.
export function askOnLocked(box, ask) {
  box.addEventListener("click", async (e) => {
    if (!e.target.closest?.(".home-locked")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    await ask();
  }, true);
}

// F154: no horizontal scroller of featured banners on Home or Browse, in any build (user 2026-11-18, the Browse
// concept). F135 had moved them from the jailbreak app's Home to Browse's top; Browse's Tweak of the Day card took
// their place. A source's own page still shows its banners (browse.js drawSections, F20).
export const homeShowsFeatured = () => false;
export const browseShowsFeatured = () => false;

export function ipasTile() { // F212: every build has the page; callers still pass the mode
  return { label: "Install IPAs", href: format({ tab: "installed", path: ["myipas"] }) };
}

// F37: the one-line hint Home shows while Settings > Device is Not Jailbroken, or null. `type` is deviceType().
export const DEVICE_HINT = "Showing apps for iPhones without a jailbreak. Jailbroken? Settings > Device.";
export function deviceHint(type, mode = "site") {
  if (type !== "none") return null;
  // The sideload build is always Not Jailbroken: nothing to change there, so no hint. Nor on the website (user
  // 2026-11-18: it's obviously the web; jailbroken visitors get "Jailbroken? Get iFizBox.deb" in the iFizBox App card).
  if (mode === "sideload" || mode === "site") return null;
  return { text: DEVICE_HINT, href: format(settingsRoute(["device"])) };
}

// F41: whether Home offers Themes (the tile, Featured's Browse Themes). Not Jailbroken lists apps only (F37).
export const showsThemes = (type) => type !== "none";

// F46: what a route under browse/ shows: { page: "root" | "list" | "category" | "browse" (browse.js's own pages,
// below a list), value }. F124: "list" is one of Browse's lists, by id (core/catalog.js BROWSE_LISTS).
// F154: also "roulette" (Tweak Roulette, screens/roulette.js), "categories" (All Categories) and "collection"
// (browse/collection:<id>, core/catalog.js COLLECTIONS).
export function browsePage(path) {
  if (path.length === 1) return { page: "root" };
  if (path.length === 2 && path[1] === "roulette") return { page: "roulette" };
  if (path.length === 2 && path[1] === "categories") return { page: "categories" };
  if (path.length === 2 && path[1].startsWith("collection:") && collection(path[1].slice(11))) return { page: "collection", value: path[1].slice(11) };
  if (path.length === 2 && browseList(path[1])) return { page: "list", value: path[1] };
  if (path.length === 2 && path[1].startsWith("category:")) return { page: "category", value: path[1].slice(9) };
  return { page: "browse" };
}

// The tab's routes, one entry each: `match` is the route's first path segment (null: the tab's root, also anything
// unknown), `nav` its bar, `render` its page. nav() and render() below only look the route up here.
const ROUTES = [
  { match: "credits", nav: () => ({ title: "Credits" }), render: (body) => renderCredits(body) },
  { match: "guides", nav: (route) => guides.nav(route, guidesLite()), render: (body, route) => { guides.render(body, route, { lite: guidesLite() }); } }, // F157
  { match: "help", nav: () => ({ title: "Help" }), render: (body) => renderHelp(body) },
  { match: "why", nav: () => why.nav(), render: (body) => { why.render(body, { mode: settings.mode, install: () => installiFizBox() }); } }, // F303
  { match: "featured", nav: () => ({ title: "Featured" }), render: (body) => renderFeatured(body) },
  { match: "sources", nav: () => ({ title: "More Sources" }), render: (body, route, ctx) => renderSources(body, ctx) },
  { match: "browse", nav: (route) => browseRoute(route).nav(route), render: (body, route, ctx) => browseRoute(route).render(body, route, ctx) },
  // F102; F125 moved its row to Installed, the route stays for old links
  { match: "wishlist",
    nav: (route) => route.path.length === 1 ? { title: "Wish List", style: "plain" } : browse.nav(route),
    render: (body, route, ctx) => route.path.length === 1 ? browse.renderWishlist(body, route) : browse.render(body, route, ctx) },
  { match: null, nav: (route, ctx) => homeNav(ctx), render: (body) => renderRoot(body) },
];

// Browse's pages (F46, browsePage's `page`), the same way: `match` is the page, null for browse.js's own pages.
const BROWSE_ROUTES = [
  { match: "root", nav: () => browse.browseHomeNav(), // F154: "Browse", the Featured / New / Top 25 drop-down as its title
    render: (body, route) => browse.renderBrowseHome(body, route, { jailbroken: showsThemes(settings.deviceType()), featured: featuredRows, headers: dayHeaders }) },
  { match: "roulette", nav: () => roulette.nav(), render: (body, route) => roulette.render(body, route, { jailbroken: showsThemes(settings.deviceType()) }) },
  { match: "categories", nav: () => ({ title: "All Categories" }), render: (body) => renderCategories(body) },
  { match: "collection", nav: (route, b) => ({ title: collection(b.value).title, style: "plain" }),
    render: (body, route, ctx, b) => {
      const c = collection(b.value);
      return browse.renderSearchableList(body, route, () => catalog.collection(c.id), { letters: true, label: `Search ${c.title}`,
        empty: `None of your sources' packages fit ${c.title} yet.` });
    } },
  { match: "list", nav: (route, b) => ({ title: browseList(b.value).title, style: "plain" }),
    render: (body, route, ctx, b) => {
      const v = LIST_VIEW[b.value];
      return browse.renderSearchableList(body, route, v.rows, { letters: Boolean(v.letters), headers: v.headers ?? null,
        empty: v.empty, label: `Search ${browseList(b.value).title}` });
    } },
  { match: "category", nav: (route, b) => ({ title: b.value || "Browse", style: "plain" }),
    render: (body, route, ctx, b) => browse.renderSearchableList(body, route, () => catalog.browse(b.value), { letters: true, label: `Search ${b.value}` }) },
  { match: null, nav: (route) => browse.nav(route), render: (body, route, ctx) => browse.render(body, route, ctx) },
];

const lookUp = (table, key) => table.find((r) => r.match === key) ?? table.find((r) => r.match === null);
const homeRoute = (route) => lookUp(ROUTES, route.path[0]);
// The Browse entry for a browse/... route, its nav/render bound to browsePage's result.
function browseRoute(route) {
  const b = browsePage(route.path);
  const r = lookUp(BROWSE_ROUTES, b.page);
  return { nav: (rt) => r.nav(rt, b), render: (body, rt, ctx) => r.render(body, rt, ctx, b) };
}

export function nav(route, ctx) {
  return homeRoute(route).nav(route, ctx);
}

// Home's own bar, at the tab's root.
function homeNav(ctx) {
  return {
    title: NAME,
    back: "Home", // the back button above it reads Home, as Cydia's
    left: { label: "About", onClick: () => showAbout(ctx) },
    // F82 Reload, as Cydia's: the button turns into the small white spinner in its own spot while the sources and
    // Home's content reload, then back to Reload. The page keeps its content and swaps the new in place: no Loading
    // screen, no flash (it used to be location.reload()).
    right: { label: "Reload", onClick: (e) => reloadHome(e?.currentTarget, ctx), ref: (b) => { state.reloadButton = b; } },
  };
}

// About, laid out like Cydia's on the 4S (ref/4s/screens/cydia-about.png): centred lines in groups with a blank line
// between them, and one wide Close button.
async function showAbout(ctx) {
  const version = (await nativeBridge()?.call?.("app.info", {}).catch(() => null))?.version;
  await ctx.showAlert({
    title: `About ${NAME}`,
    message: `${version ? `Version ${version}` : `${NAME} Web`}\nFree and open source`
      + "\n\nRyan Hayden (Fizlo)\n\nInspired by Cydia\nby Jay Freeman (saurik)\nNot affiliated with SaurikIT",
    // What we take from Cydia, and under what licence, is in Credits (C9).
    buttons: ["Close"],
  });
}

// ---- Reload (F82) -----------------------------------------------------------------------------------------

// The nav button while `work` runs: Cydia's small white spinner in the button's spot (home.css .is-reloading), not
// tappable; then the button again, whether `work` ended well or not. A tap while it spins does nothing (false).
export async function withReloadSpinner(button, work) {
  if (!button || button.classList.contains("is-reloading")) return false;
  const label = button.getAttribute("aria-label");
  button.classList.add("is-reloading");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.setAttribute("aria-label", "Reloading");
  try {
    await work();
  } catch {
    // a source that failed shows on Sources and in the tile; the button still comes back
  } finally {
    button.classList.remove("is-reloading");
    button.disabled = false;
    button.removeAttribute("aria-busy");
    if (label == null) button.removeAttribute("aria-label");
    else button.setAttribute("aria-label", label);
  }
  return true;
}

// Resolves once no source is refreshing (screens/sources.js announce: globalThis.ifizboxRefreshing and the
// ifizbox:refreshing event), or after `ms` at most, so a refresh that never says it ended can't keep the spinner.
export function untilRefreshed(ms = 120000) {
  return new Promise((resolve) => {
    if (!(globalThis.ifizboxRefreshing > 0)) { resolve(); return; }
    let timer = null;
    const check = () => {
      if (globalThis.ifizboxRefreshing > 0) return;
      clearTimeout(timer);
      globalThis.removeEventListener?.("ifizbox:refreshing", check);
      resolve();
    };
    timer = setTimeout(() => { globalThis.removeEventListener?.("ifizbox:refreshing", check); resolve(); }, ms);
    globalThis.addEventListener?.("ifizbox:refreshing", check);
  });
}

// What Reload does, each step injectable for the test: refresh the sources (Settings' Refresh on Launch's way: the
// Sources tab's spinning badge, no HUD; when a refresh already runs, wait for that one), load the new package lists
// (new versions: Changes' badge and list), re-read dpkg in the app, look for iFizBox's own update (app.js listens for
// ifizbox:reloaded, as a launch does), then redraw Home in place.
const loadNew = async () => {
  await catalog.ensure();
  if (catalog.statusSource() === "native") await catalog.reloadInstalled();
  globalThis.dispatchEvent?.(new Event("ifizbox:reloaded"));
};
// The website's Reload first re-downloads every file of the site (build.json lists them), which replaces whatever
// copy the browser kept, then loads the page again: a phone holding stale files gets the new version (user
// 2026-11-18). True when it reloaded the page.
export async function refreshWebFiles({ fetcher = globalThis.fetch, info = buildInfo, reloadPage = () => location.reload(), batch = 12 } = {}) {
  const b = await info(fetcher);
  if (!b?.files?.length) return false;
  for (let i = 0; i < b.files.length; i += batch) {
    await Promise.all(b.files.slice(i, i + batch).map((f) => fetcher(f, { cache: "reload" }).catch(() => null)));
  }
  reloadPage();
  return true;
}

// The website, on every open, reload and return to the foreground: build.json (never cached) names a commit other
// than the one this browser last loaded -> refreshWebFiles (every file again, then one page load), so a phone never
// sits on an old build (user 2026-11-18). A first visit only notes the commit. True when it reloaded the page.
// B56: never while a popup is up (?install's popup vanished under a reload, and ?install was already gone from the
// URL): `hold` waits until the last alert/sheet closes, and the new commit is noted only when the reload runs, so a
// page left with the popup up still reloads on its next open. A check made while one is already held joins it.
let buildCheck = null;
export function refreshIfNewBuild(opts = {}) {
  if (!buildCheck) buildCheck = checkBuildOnce(opts).finally(() => { buildCheck = null; });
  return buildCheck;
}
async function checkBuildOnce({ info = buildInfo, store = globalThis.localStorage, refresh = refreshWebFiles,
  busy = () => popupOpen(), hold = () => whenNoPopup() } = {}) {
  const b = await info();
  if (!b?.commit) return false;
  let last;
  try { last = store.getItem("ifizbox.webBuild"); } catch { return false; }
  if (!last) { try { store.setItem("ifizbox.webBuild", b.commit); } catch { /* private mode */ } return false; }
  if (last === b.commit) return false;
  // A popup that opens while the files download holds the page load itself too.
  const reloadPage = () => (busy() ? Promise.resolve(hold()) : Promise.resolve()).then(() => location.reload());
  const go = () => {
    try { store.setItem("ifizbox.webBuild", b.commit); } catch { return false; }
    return refresh({ info: async () => b, reloadPage });
  };
  if (busy()) await hold();
  return go();
}

export function reloadHome(button, ctx, { refresh = () => refreshInBackground(ctx), settled = untilRefreshed, reload = loadNew, redraw = () => state.redraw?.(),
  web = !nativeBridge() } = {}) {
  if (web) return withReloadSpinner(button, async () => { if (!(await refreshWebFiles())) location.reload(); });
  return withReloadSpinner(button, async () => {
    if ((await refresh()) === "cancelled") return; // F150: the reload bar's Cancel stops the whole Reload
    await settled();
    await reload();
    await redraw();
  });
}

// F145: Home's root follows the website's lock (websign-gate.js setFirstVisit fires ifizbox:browse-lock): when it flips
// from what the page was drawn with, `redraw` draws it again, so no locked rows or padlocks stay after Browse Anyway
// (nor unlocked ones after Lock Home). Stops once `alive()` is false (the page is gone). -> a function that stops it.
export function followBrowseLock({ wasLocked, locked, alive = () => true, redraw, target = globalThis }) {
  const off = () => target.removeEventListener?.("ifizbox:browse-lock", on);
  function on() {
    if (!alive()) { off(); return; }
    if (locked() === wasLocked) return;
    off(); // the redrawn page follows with its own
    redraw();
  }
  target.addEventListener?.("ifizbox:browse-lock", on);
  return off;
}

// ---- state shared by the root page and the pages that change it ------------------------------------------

// redraw: set by the root page, Reload's in-place update of its content (renderRoot).
// F96: no question at launch (user 2026-11-18); Home's rows below the iFizBox App card are locked instead (renderRoot).
const state = { redraw: null };

// ---- DOM -------------------------------------------------------------------------------------------------

// A page's content in one wrapper: the first child of a page stretches past its height (ios6.css rubber band), so
// a bare list of groups would push every group after the first off the screen.
function wrap(frag) {
  const d = el("div");
  d.append(frag);
  return d;
}

// One tile: a cell link with a glyph, a bold label and the chevron. External links open in a new tab.
// F229: the website Home's green install row. Not Jailbroken it installs the Lite (sideload) build, for any iPhone; on a
// jailbroken device the same row hands over the .deb, so it keeps "The .deb for your jailbreak" and drops "Lite".
export const APP_ROW = { label: `Install ${NAME} Lite`, subtitle: "For any iPhone · no jailbreak needed" };
export function appRowWords(offer) {
  return offer?.action === "deb" ? { label: `Install ${NAME}`, subtitle: "The .deb for your jailbreak" } : APP_ROW;
}

// `lead`: words in front of the label in their own span (F229: Home's "Jailbroken?" in lavender, normal weight).
function tile({ label, href, glyph, external = false, subtitle = null, lead = null }) {
  const li = el("li", "cell");
  const a = el("a", "cell-inner chevron home-tile");
  a.href = href;
  if (external) { a.target = "_blank"; a.rel = "noopener"; }
  a.append(el("span", "cell-icon home-glyph glyph-" + glyph));
  if (subtitle) {
    const text = el("span", "home-tile-text");
    const name = el("span", "cell-label", lead ? "" : label);
    if (lead) name.append(el("span", "home-tile-lead", lead), " " + label);
    text.append(name, el("span", "cell-subtitle", subtitle));
    a.append(text);
  } else a.append(el("span", "cell-label", label));
  li.append(a);
  return li;
}

function tileRow(cls, ...tiles) {
  const row = el("div", "home-row " + cls);
  if (cls.split(" ").includes("stack")) { // one table, the tiles as full-width rows under each other
    const ul = el("ul", "table grouped home-tiles home-stack");
    ul.append(...tiles);
    row.append(ul);
  } else if (cls === "pair") {
    const ul = el("ul", "table home-pair");
    ul.append(...tiles);
    row.append(ul);
  } else {
    for (const t of tiles) {
      const ul = el("ul", "table grouped home-tiles");
      ul.append(t);
      row.append(ul);
    }
  }
  return row;
}

// ---- F244: the certificate-expiry tile (sideload build) ----------------------------------------------------------
// A full-width stack tile under the welcome, above GitHub | Discord, while the certificate or the profile (whichever
// ends first, core/signing.js expiryWarning) nears its end or has ended; a tap opens Settings > Signing. No dismiss.
// home.css .home-row.cert draws its three stages: soon (amber), close (red tint), gone (solid red).
export const CERT_STAGES = ["soon", "close", "gone"];
export const showsCertTile = (mode, shown = settings.isShown("showExpiryWarning")) => mode === "sideload" && Boolean(shown);
// The warning for `identity` with Settings' values (`get` reads a setting).
export function certWarning(identity, { get = (k) => settings.get(k), now = new Date() } = {}) {
  return expiryWarning(identity, { now, warn: expiryWarningDays(get), resign: resignWindow(get), show: get("showExpiryWarning") !== false });
}
// signing.status's identity, or null (none, the signer didn't answer, or not the sideload build).
export async function certIdentity({ status = () => deviceStatus() } = {}) {
  try {
    let st = await status();
    if (typeof st === "string") st = JSON.parse(st);
    return statusReady(st) ? st.identity : null;
  } catch {
    return null;
  }
}
// Paints `row` (tileRow "stack cert") for warning `w`: hidden for null.
export function paintCert(row, w) {
  row.hidden = !w;
  for (const s of CERT_STAGES) row.classList.toggle(s, w?.stage === s);
  if (!w) return;
  row.querySelector(".cell-label").textContent = w.title;
  row.querySelector(".cell-subtitle").textContent = w.subtitle;
  const a = row.querySelector(".home-tile");
  if (a) a.href = w.href ?? CERT_HREF(); // F372: the cellular tile opens Cellular Shortcuts
}
const CERT_HREF = () => format(settingsRoute(["signing"]));
// F307 (concept K3, option C): the same slot holds Signing Needs Setup and Signing Server Down (core/signing.js
// signingTile), on the website and in the sideload app; the plain Signing half-tile is gone. The jailbreak app has none.
export const showsSigningSlot = (mode) => mode === "sideload" || mode === "site";
// What the slot needs to know: signing set up (signingSetUp), the certificate's identity (sideload: for the expiry
// warning) and, once set up, whether the sideload app's Signing Server answers (serverReachable). The website signs
// in the browser and installs through its own Worker, so it has no server to check.
export async function signingSlot(mode, { setUp = (m) => signingSetUp(m), identity = () => certIdentity(),
  reachable = (s) => serverReachable(s), server = getServer } = {}) {
  if (!showsSigningSlot(mode)) return { setUp: true, identity: null, serverUp: true, server: null };
  const ok = await setUp(mode).catch(() => false);
  if (mode !== "sideload") return { setUp: ok, identity: null, serverUp: true, server: null };
  // B245: not set up but with an https Signing Server: the certificate is the step left (slotTile says so).
  if (!ok) return { setUp: false, identity: null, serverUp: true, server: httpsServer(server()) };
  const sv = server();
  const [ident, up] = await Promise.all([identity().catch(() => null), reachable(sv).catch(() => false)]);
  return { setUp: true, identity: ident, serverUp: Boolean(up), server: sv };
}
// The tile for a signingSlot answer, with Settings' expiry values (the expiry warning only where showsCertTile).
export function slotTile(mode, slot, { get, now, certShown = showsCertTile(mode) } = {}) {
  if (!showsSigningSlot(mode) || !slot) return null;
  const warning = certShown && slot.identity ? certWarning(slot.identity, { ...(get ? { get } : {}), ...(now ? { now } : {}) }) : null;
  const t = signingTile({ setUp: slot.setUp, serverUp: slot.serverUp, server: slot.server, warning });
  // B245: the sideload app with its Signing Server set (Installation & Signing says Ready to Install through it) and
  // no certificate yet: the tile names the step left instead of "Nothing can be installed yet".
  if (t?.kind === "setup" && mode === "sideload" && slot.server) return { ...t, subtitle: CERT_STEP_LEFT };
  return t;
}
export const CERT_STEP_LEFT = "Import your certificate to install"; // fits the tile at 320pt
// B316: the sideload app installing through This iPhone, with the last check or install failed to reach it (core
// installroute.js routeFailure, kept until a check passes): the slot names the failure, red, and opens Installation &
// Signing, where the status says it with the fix. A signing problem that stops every install (gone) stays first; a
// coming expiry gives way to it.
export const ROUTE_TILE_SUBTITLE = "Installs are failing · Fix in Settings"; // fits the tile at 320pt
export function routeTile(mode, failure, choice) {
  if (mode !== "sideload" || choice !== "iphone" || !failure?.title) return null;
  return { stage: "close", kind: "route", title: failure.title, subtitle: ROUTE_TILE_SUBTITLE };
}
export function slotOrRoute(t, route) { return t?.stage === "gone" ? t : route ?? t; }
// F372 (user 2026-11-22): This iPhone in use, the phone on cellular and the Cellular Shortcuts not added (core
// cellularWarning, from vpn.status `vpn`): the slot says so and opens Cellular Shortcuts. A failed install (routeTile)
// says more, so it comes first.
export const CELLULAR_TILE_SUBTITLE = "On cellular, installs need them"; // fits the tile at 320pt
export function cellularTile(mode, choice, vpn) {
  if (mode !== "sideload" || !cellularWarning(choice, { vpn })) return null;
  return { stage: "close", kind: "cellular", title: CELLULAR.title, subtitle: CELLULAR_TILE_SUBTITLE, href: format(settingsRoute(["installation", "shortcuts"])) };
}
// vpn.status for the slot, only when This iPhone is the way in use (null otherwise, or when the shell has none)
export async function slotVPN(mode, choice, native = nativeBridge()) {
  if (mode !== "sideload" || choice !== "iphone" || typeof native?.call !== "function") return null;
  try { return await native.call("vpn.status", {}); } catch { return null; }
}
// The Signing Server when installs can use it (an https:// address, as screens/signing.js serverReady), else null.
// Settings > Signing has two steps (certificate, server), so with this set, not set up means no certificate.
export function httpsServer(server) {
  const s = normalizeServer(server);
  return s && /^https:\/\//.test(s) ? s : null;
}
// The tile, kept up to date: Home showing again (Back from Settings > Signing), the app coming back, Settings'
// Expiry Warning, Show Expiry Warning and Re-sign Reminder, and Settings > Signing's status ("ifizbox:signing-status",
// its identity as the detail) after an import or removal. Stops once the row leaves the page.
function certRow() {
  const row = tileRow("stack cert", tile({ label: "", subtitle: " ", href: format(settingsRoute(["signing"])), glyph: "failed" }));
  row.hidden = true;
  if (!showsSigningSlot(settings.mode)) return row;
  let seq = 0;
  let last = null;
  let vpn = null; // F372: vpn.status, for the cellular tile
  const routeOrCellular = () => routeTile(settings.mode, routeFailure(), settings.get(ROUTE_KEY)) ?? cellularTile(settings.mode, settings.get(ROUTE_KEY), vpn);
  const draw = (slot) => {
    seq++; last = slot;
    paintCert(row, slotOrRoute(slotTile(settings.mode, slot), routeOrCellular())); // B316, F372
  };
  const onRoute = () => { if (alive()) { seq++; paintCert(row, slotOrRoute(slotTile(settings.mode, last), routeOrCellular())); } };
  const check = async () => {
    const mine = ++seq;
    const [slot, v] = await Promise.all([signingSlot(settings.mode), slotVPN(settings.mode, settings.get(ROUTE_KEY))]);
    vpn = v;
    if (mine === seq && alive()) draw(slot);
  };
  const onHash = () => { if (/^#\/home\/?$/.test(location.hash)) check(); };
  const onVis = () => { if (document.visibilityState !== "hidden") check(); };
  // Settings > Signing's status after an import or removal: its identity at once, then the whole check again
  const onStatus = (e) => {
    if (!alive()) return;
    if (last?.setUp && e?.detail) draw({ ...last, identity: e.detail });
    check();
  };
  const offSettings = settings.onChange((key) => {
    if (["showExpiryWarning", "expiryWarning", "resignReminder"].includes(key) && alive()) draw(last);
  });
  let seen = false; // on the page at least once: not connected before then is "not drawn yet", after it is "gone"
  const alive = () => {
    if (row.isConnected) { seen = true; return true; }
    if (!seen) return true;
    removeEventListener("hashchange", onHash);
    removeEventListener("ifizbox:signing-status", onStatus);
    removeEventListener("ifizbox:route-failure", onRoute);
    document.removeEventListener("visibilitychange", onVis);
    offSettings();
    return false;
  };
  addEventListener("hashchange", onHash);
  addEventListener("ifizbox:signing-status", onStatus);
  addEventListener("ifizbox:route-failure", onRoute); // B316: an install or a check set or cleared the route's failure
  document.addEventListener("visibilitychange", onVis);
  row.recheck = () => { if (alive()) check(); }; // Reload (state.redraw)
  check();
  return row;
}

// The icon on the website and in the sideload (LITE) app: what that version can't do, the jailbreak app can.
export function versionLimits(kind) {
  if (kind === "web") return { title: `${NAME} Web`, message: "The website can't:\n• install tweaks or themes\n• see the apps on your phone\n• remove apps\n• keep signed copies of your IPAs\n• remind you to re-sign apps\n\nThe app does all of this." };
  if (kind === "sideload") return { title: `${NAME} Lite`, message: "Without a jailbreak, Lite can't:\n• install system-wide tweaks or themes\n• see apps it didn't install\n• remove apps\n\nApps it signs stop opening when your certificate expires: re-sign them before." };
  return null;
}

function renderRoot(body) {
  const home = el("div", "home");
  const head = el("div", "home-head");
  const icon = el("img", "home-icon");
  // The website shows its WEB icon (the home-screen one), so it's never taken for the app (user 2026-11-18).
  // The sideload app shows its LITE icon (its Home Screen icon), the jailbreak app the plain one.
  const g = !nativeBridge() ? "icon-web-glossy" : settings.mode === "sideload" ? "icon-lite-glossy" : "icon-glossy";
  icon.src = `icons/${g}-76.png`;
  icon.srcset = `icons/${g}-76.png 1x, icons/${g}-152.png 2x, icons/${g}-228.png 3x`;
  icon.width = icon.height = 57;
  icon.alt = "";
  // F323: the apps show the icon the app has now (the theme's, or Theme > App Icon's pick), as the Home Screen does;
  // screens/settings.js applyTheme repaints it when the theme or the pick changes. The website keeps its WEB icon.
  if (nativeIcons()) iconImage(icon, "current");
  const limits = versionLimits(!nativeBridge() ? "web" : settings.mode);
  if (limits) {
    icon.classList.add("tappable");
    icon.alt = limits.title;
    icon.setAttribute("role", "button");
    icon.addEventListener("click", () => showAlert(limits));
  }
  const words = el("div", "home-words");
  const title = el("h2", "home-title", `Welcome to ${NAME}`);
  words.append(title);
  const by = el("p", "home-by", "by ");
  const who = el("a", null, "Ryan Hayden (Fizlo)"); // as Cydia's "Jay Freeman (saurik)"
  who.href = REPO_URL;
  who.target = "_blank";
  who.rel = "noopener";
  by.append(who);
  words.append(by);
  head.append(icon, words);
  const hintBox = el("div", "home-hint-box");
  const drawHint = () => {
    const h = deviceHint(settings.deviceType(), settings.mode);
    if (!h) { hintBox.replaceChildren(); return; }
    const a = el("a", "home-hint", h.text);
    a.href = h.href;
    hintBox.replaceChildren(a);
  };
  // F307 (concept K3, option C): no plain Signing tile any more (it was a half-tile under Browse, and full width at the
  // top of the locked website Home). While signing isn't set up, the solid red Signing Needs Setup tile in the
  // certificate-expiry tile's place (certRow) is the way to Settings > Signing.
  const slotRow = certRow();
  // F303: Why <NAME>, high on Home (why.js showsWhyTile): the website always, the installed apps until the page has
  // been opened there (F306), then Settings > About has it. Its glyph and the page's styles come from why.js.
  why.ensureWhyStyle();
  const whyRow = tileRow("stack why", tile({ label: why.WHY_TILE.label, subtitle: why.WHY_TILE.subtitle, href: why.whyHref(), glyph: "why" }));
  const drawThemes = () => {
    whyRow.hidden = !why.showsWhyTile(settings.mode, why.whyOpened()); // F306: until opened, in the installed apps
  };
  const onHash = () => {
    if (!whyRow.isConnected) { removeEventListener("hashchange", onHash); return; }
    if (!/^#\/home\/?$/.test(location.hash)) return;
    if (!whyRow.hidden && !why.showsWhyTile(settings.mode, why.whyOpened())) drawThemes(); // F306: Back from Why
  };
  addEventListener("hashchange", onHash);
  const lockedNow = browsingLocked({ mode: settings.mode });
  drawHint();
  drawThemes();
  const offHint = settings.onChange((key) => {
    if (key !== "device") return;
    if (!hintBox.isConnected) { offHint(); return; }
    drawHint();
    drawThemes();
    drawApp();
  });

  // Install iFizBox App, full width under Featured | Signing, on the website only (I7, core/appoffer.js homeOffer):
  // Not Jailbroken, the sideload build signed in the browser with the user's own certificate (F93, installApp), or
  // Settings > Signing first when there's none; jailbroken, the release's .deb for the device's arch.
  // One green split button (user 2026-11-17): Install iFizBox App | Send Settings (Open in iFizBox App: the
  // certificate, sources and settings into the app).
  // The website: jailbroken visitors get iFizBox from its own APT repo (Sileo, Zebra) or as a .deb (user 2026-11-18).
  // Its own purple tile (user 2026-11-18): the full iFizBox, for a jailbroken phone, from iFizBox's APT repo or a .deb.
  // F178: the website only; never in the sideload (lite) app, which offers no .deb or APT repo (core/appoffer.js ownBuilds).
  // F229 (a visitor kept tapping the bright purple tile): the green row says it's for any iPhone, the jailbroken one
  // asks first ("Jailbroken?" in lavender) and wears a pale lavender tint like the green row's (home.css .purple).
  const debTile = settings.mode === "site" && ownBuilds(settings.mode).deb ? tile({ lead: "Jailbroken?", label: `Install ${NAME}`, subtitle: "Tweaks, themes and apt",
    href: format({ tab: "home" }), glyph: "jailbreak" }) : null;
  debTile?.querySelector("a").addEventListener("click", (e) => { e.preventDefault(); e.stopImmediatePropagation(); jailbrokenSheet(); }, true);
  const appRow = tileRow("green stack", tile({ label: APP_ROW.label, subtitle: APP_ROW.subtitle,
    href: format(settingsRoute(["signing"])), glyph: "install" }));
  // No Send Settings to iFizBox (user 2026-11-18): Install iFizBox App already carries the certificate and settings.
  const debRow = debTile ? tileRow("purple", debTile) : null;
  const appLink = appRow.querySelector("a");
  const appSub = appLink.querySelector(".cell-subtitle");
  let offer = null;
  appLink.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!offer) return;
    installiFizBox({ offer });
  }, true);
  const drawApp = () => {
    const type = settings.deviceType();
    offer = homeOffer({ mode: settings.mode, deviceType: type });
    appRow.hidden = !offer;
    const words = appRowWords(offer);
    if (appSub) appSub.textContent = words.subtitle;
    const appLabel = appLink.querySelector(".cell-label");
    if (appLabel) appLabel.textContent = words.label;
  };
  drawApp();

  // F46: Browse, at the top (user 2026-11-18: in Featured's place). F124: a row of its own, full width and taller, with what it holds
  // (user 2026-11-18: "browse should be bigger"); F79's Install IPAs, which sat beside it, gets its own row below.
  const ipas = ipasTile(settings.mode);
  const browseRow = tileRow("stack browse", tile({ label: "Browse", subtitle: BROWSE_SUBTITLE,
    href: format({ tab: "home", path: ["browse"] }), glyph: "browse" }));
  const ipasRow = ipas ? tileRow("halves", tile({ label: ipas.label, href: ipas.href, glyph: "install" })) : null;

  const stateRow = tileRow("green", tile(MORE_SOURCES_TILE));
  // Locked Home (the website before iFizBox is installed): Signing full width at the top, Browse down among the
  // locked rows (user 2026-11-18); unlocked, Browse is the first row under GitHub | Discord.

  home.append(
    head,
    slotRow, // F244/F307 certRow(): hidden unless signing needs setup, its server is down, or the certificate nears its end
    hintBox,
    whyRow,
    tileRow("pair",
      tile({ label: "GitHub", href: REPO_URL, glyph: "github", external: true }),
      // Cydia's pair was Facebook | Twitter: here GitHub | Discord (the community)
      tile({ label: "Discord", href: DISCORD_URL, glyph: "discord", external: true })),
    ...(lockedNow ? [] : [browseRow]),
    appRow,
    ...(debRow ? [debRow] : []),
    ...(lockedNow ? [browseRow] : []),
    ...(ipasRow ? [ipasRow] : []),
    stateRow,
  );
  body.append(home);
  // Cydia's list below the tiles: Settings (F135), the help links, User Guides, then Credits / Thank You (About is the nav button).
  const links = homeLinks();
  const list = grouped(links);
  const groups = [...list.children]; // the fragment empties once appended
  for (const group of groups) group.classList.add("home-links");
  links.forEach((l, i) => { if (l.pair) groups[i].querySelector(".table")?.classList.add("home-pair"); });
  home.append(list);
  // Theme > Style swaps the Why tile's and the link rows' icons at once, without a reload (iOS 6 <-> iOS 7).
  followStyle(home, () => { why.ensureWhyStyle(); repaintLinkIcons(groups, homeLinks()); });
  // The website before iFizBox is installed: everything below the iFizBox App card is locked; a tap asks first. Not
  // Settings (F123: unlocked like Home, as its tab was), nor help, guides and credits (F156, lockHomeLinks).
  if (browsingLocked({ mode: settings.mode })) {
    const locked = [browseRow, ...(ipasRow ? [ipasRow] : []), stateRow];
    for (const box of locked) box.classList.add("home-locked");
    lockHomeLinks(groups, links);
    askOnLocked(home, () => askToBrowse({ install: installiFizBox })); // Browse Anyway redraws Home (followBrowseLock below)
  }
  // F145: Browse Anyway (here, on a locked tab or in Settings) and Settings' Lock Home switch redraw Home at once.
  followBrowseLock({ wasLocked: lockedNow, locked: () => browsingLocked({ mode: settings.mode }), alive: () => home.isConnected,
    redraw: () => {
      const top = body.scrollTop;
      home.remove();
      renderRoot(body);
      body.scrollTop = top;
    } });
  // Cydia's line at the bottom of Home (and of Settings' root, F183): device, iOS, version, language, and the build.
  home.append(...versionLines());
  // F270: pull Home down past its top: Reload, as the nav button (its spinner and all; a tap on it while it spins
  // does nothing, and neither does a pull).
  pullToRefresh(body, { onRefresh: () => state.reloadButton?.click(), busy: () => Boolean(state.reloadButton?.disabled), settings });
  // F82: Reload's redraw. Everything stays on screen; each part is updated where it is: the hint, the Install
  // iFizBox App offer and the signing row at once.
  state.redraw = async () => {
    if (!home.isConnected) return;
    drawHint();
    drawThemes();
    drawApp();
    slotRow.recheck?.();
  };
}

// The Home footer's text (version-foot.js; Settings' root shows it too, F183).
export { footLine };

// F317: Help's Which Jailbreak and Upgrading in the iOS 6 hint style (AGENTS.md, Hints): Not Jailbroken in a group
// of its own with what it lists, the three jailbreak kinds in one with how to list their packages; Check for Changes
// and Refresh Sources a group each. F144: the sideload build lists apps only and has no Settings > Device, so its
// kinds footer names the jailbreak app instead of the Device setting.
export const HELP_NOT_JAILBROKEN_FOOTER = { sideload: "Apps from AltStore-style sources, signed and installed on this iPhone.",
  other: "Apps from AltStore-style sources, installed with a sideloader." };
export const HELP_KINDS_FOOTER = { sideload: `Tweaks and themes need a jailbroken iPhone and ${NAME}'s jailbreak app.`,
  other: "Set Settings > Device to Jailbroken to list packages for your kind. A package built for another kind will not install." };
export const HELP_CHANGES_FOOTER = "Shows what is new or updated since the last refresh. Hold a package to keep it at its version.";
export const HELP_REFRESH_FOOTER = "Fetches every source's package list again.";
export function helpSections(mode = "site", { changes = null, refresh = null } = {}) {
  const k = mode === "sideload" ? "sideload" : "other";
  return [
    { header: "Which Jailbreak", rows: [{ label: "Not Jailbroken", detail: "apps only" }], footer: HELP_NOT_JAILBROKEN_FOOTER[k] },
    { rows: [{ label: "Rootless", detail: "iOS 15 and later" }, { label: "Rootful", detail: "older, or palera1n" },
      { label: "Roothide", detail: "Dopamine roothide, Bootstrap" }], footer: HELP_KINDS_FOOTER[k] },
    { header: "Upgrading", rows: [{ label: "Check for Changes", href: changes }], footer: HELP_CHANGES_FOOTER },
    { rows: [{ label: "Refresh Sources", href: refresh }], footer: HELP_REFRESH_FOOTER },
  ];
}

// Our own help page: what iFizBox lists, for which jailbreaks, and how upgrades reach the phone.
function renderHelp(body) {
  body.append(wrap(grouped([
    ...helpSections(settings.mode, { changes: format(rootOn("changes", { tab: "home", path: ["help"] })),
      refresh: format(rootOn("sources", HELP_ROUTE)) }),
    {
      header: "Jailbreaking",
      // ponytail: the site isn't up yet; drop "Coming Soon" once it is.
      rows: [{ label: "jailbreakme.dev", detail: "Coming Soon", chevron: true, onClick: () => window.open(JAILBREAK_INFO_URL, "_blank", "noopener") }],
      footer: "Which jailbreak works on your iPhone and iOS version, and how to run it.",
    },
    {
      header: "Before You Upgrade iOS",
      footer: "A jailbreak supports only the iOS versions it was made for. Check that one exists for the "
        + "version you are about to install, and keep a list of your packages so you can put them back.",
    },
  ])));
}

// Who Special Thanks thanks: [name, handle, their page, GitHub account for the picture, what for].
const THANKS = [
  ["Jay Freeman", "@saurik", "https://x.com/saurik", "saurik", `For Cydia, whose look and GPLv3 source ${NAME} follows.`],
  ["Teehan+Lax", "@teehanlax", "https://x.com/teehanlax", "teehanlax", "For the iOS 6 GUI kit."],
  ["Riley Testut", "@rileytestut", "https://x.com/rileytestut", "rileytestut", "For AltStore and its source format."],
  ["Procursus", "GitHub", "https://github.com/ProcursusTeam", "ProcursusTeam", "For the bootstrap today's jailbreaks run on."],
  ["Dopamine", "@opa334dev", "https://x.com/opa334dev", "opa334", "opa334 and team, for the iOS 15 and 16 jailbreak."],
  ["palera1n", "@palera1n", "https://x.com/palera1n", "palera1n", "For the checkm8 jailbreak."],
  ["Calif", "@calif_io", "https://x.com/calif_io", "califio", "For the iOS 27.0.1 exploit."],
];

// Credits / Thank You (Cydia's credits.html: who it thanks), with what iFizBox is and its version.
function renderCredits(body) {
  const rows = [{ label: "Version", detail: `${NAME} Web` }, { label: "License", detail: "GPL-3.0+" },
    { label: "Source Code", detail: "GitHub", chevron: true, onClick: () => window.open(REPO_URL, "_blank", "noopener") }];
  body.append(wrap(grouped([
    { header: NAME, rows, footer: "A package manager with the iOS 6 look, for modern iPhones, by Ryan Hayden (Fizlo)." },
    {
      header: "Special Thanks",
      rows: THANKS.map(([label, handle, url, gh, why]) => ({
        label, subtitle: `${handle}\n${why}`, chevron: true, cls: "thanks-row",
        icon: { text: label.charAt(0), color: "#7a8a99", src: `https://github.com/${gh}.png?size=128` },
        onClick: () => window.open(url, "_blank", "noopener"),
      })),
      footer: `${NAME} is not affiliated with SaurikIT or any of the above.`,
    },
    { // F126, C9: what we use from Cydia (artwork and wording), with its licence
      header: "Artwork",
      rows: [{ label: "Section Icons", subtitle: "Jay Freeman (saurik)\nFrom Cydia, GPLv3", cls: "thanks-row",
        icon: { text: "C", color: "#7a8a99", src: "icons/sections/Tweaks.png" } },
      { label: "Interface Wording", subtitle: "Jay Freeman (saurik)\nFrom Cydia, GPLv3", cls: "thanks-row",
        icon: { text: "C", color: "#7a8a99", src: "icons/sections/Text_Editors.png" } }],
      footer: `${NAME} uses Cydia's section icons and purpose badges and some of its interface wording (titles, `
        + "buttons and alerts, typos fixed), under GPLv3, from its source at git.saurik.com/cydia.git. "
        + `${NAME} is not affiliated with SaurikIT.`,
    },
    ...softwareSections(),
  ])));
  nativeBridge()?.call?.("app.info", {}).then((i) => {
    if (i?.version) body.querySelector(".cell-detail").textContent = i.version;
  }, () => {});
}

// F317: Credits > Software, one group per row (AGENTS.md, Hints): ElleKit and Canister each with the footer that says
// what of theirs ships; the signer's and install route's parts (native/test_notices.py) need none past their subtitle.
export const ELLEKIT_FOOTER = `Added to a signed app when a tweak you inject needs CydiaSubstrate and you added none. `
  + "© 2022 Évelyne Bélanger, BSD 3-Clause licence.";
export const CANISTER_FOOTER = "Other Sources in Search, Find More Sources, the piracy list and the Known Safe label come from canister.me.";
export function softwareSections() {
  const open = (url) => () => window.open(url, "_blank", "noopener");
  // B205: every row shows its project's picture (a GitHub avatar or the project's own logo), the letter only if it fails
  const gh = (owner) => `https://github.com/${owner}.png?size=128`;
  const row = (label, subtitle, url, src, cls) => ({ label, subtitle, chevron: true, cls: "thanks-row",
    icon: { text: label.charAt(0).toUpperCase(), color: "#7a8a99", src, cls }, onClick: open(url) });
  return [
    // ElleKit (vendor/ellekit): bundled for tweak injection, with its BSD-3-Clause licence
    // literal labels: native/test_notices.py reads `label: "X"` rows and ["X", "subtitle", url] entries
    { header: "Software", rows: [{ label: "ElleKit", subtitle: "Évelyne Bélanger\nTweak injection, BSD-3-Clause", chevron: true, cls: "thanks-row",
      icon: { text: "E", color: "#7a8a99", src: "https://ellekit.space/favicons/apple-touch-icon.png" }, onClick: open("https://github.com/tealbathingsuit/ellekit") }],
      footer: ELLEKIT_FOOTER },
    // F305: Canister's package search and repo index (Search's Other Sources, Find More Sources, the piracy list)
    { rows: [{ label: "Canister", subtitle: "Aarnav Tale\nPackage search and repo index", chevron: true, cls: "thanks-row", // F317: one class (ui.js classList.add): two threw and broke Credits
      icon: { text: "C", color: "#7a8a99", src: "https://canister.me/favicon.png" }, onClick: open("https://canister.me/") }],
      footer: CANISTER_FOOTER },
    // Third-party notices: no hint, so one group (a footer-less row per group would only add gaps)
    { rows: [["zsign", "zhlynn\nApp signing, MIT", "https://github.com/zhlynn/zsign", gh("zhlynn")],
      ["OpenSSL", "The OpenSSL Project\nzsign's cryptography, Apache-2.0", "https://www.openssl.org/", gh("openssl")],
      ["zlib", "Jean-loup Gailly and Mark Adler\nzsign's compression, zlib licence", "https://zlib.net/", "https://zlib.net/images/zlib3d-b1.png", "thanks-logo"],
      ["idevice", "Jackson Coxson\nInstalling on this iPhone, MIT", "https://github.com/jkcoxson/idevice", gh("jkcoxson")],
      ["Tailscale", "Tailscale Inc\nInstalling over a tailnet, BSD-3-Clause", "https://github.com/tailscale/tailscale", gh("tailscale")],
    ].map(([label, subtitle, url, src, cls]) => row(label, subtitle, url, src, cls)) },
  ];
}

function renderFeatured(body) {
  body.append(grouped([{
    rows: [...(showsThemes(settings.deviceType()) ? [{ label: "Browse Themes", href: format({ tab: "sources", path: ["*", "section:Themes"] }) }] : []),
      { label: "All Packages", href: format({ tab: "sources", path: ["*", "section:*"] }) }],
    footer: "Featured packages appear here when your sources publish them.",
  }]));
}

// ---- Browse (F46) ----------------------------------------------------------------------------------------

// Browse's own page: F124's lists (New, Recently Updated, Popular, Featured, Free Apps / Tweaks / Themes), then the
// merged categories (core/catalog.js mergeCategories) with their counts. The catalog leaves Themes and Tweaks out
// while Settings > Device is Not Jailbroken, and so do the lists (browseListsFor).
// F154: Browse's page is browse.js renderBrowseHome now; this is its All Categories row's page: the categories first,
// then F124's lists. Placeholder rows while the catalog answers.
async function renderCategories(body) {
  const box = el("div");
  box.append(placeholder("page", 8));
  body.append(box);
  let cats;
  try {
    await catalog.ensure();
    cats = await catalog.categories();
  } catch (e) {
    box.replaceChildren(note(e.message));
    return;
  }
  const [lists, rest] = browseGroups(cats, { jailbroken: showsThemes(settings.deviceType()) });
  box.replaceChildren(grouped([rest, { ...lists, header: "Lists" }]));
}

// Home's Browse tile's second line.
export const BROWSE_SUBTITLE = "Featured, New, Top 25, Roulette";

// The groups of Browse's page for `cats` ([{ name, count }]): the lists (Free Tweaks and Themes only `jailbroken`),
// then the categories.
export function browseGroups(cats, { jailbroken = true } = {}) {
  const lists = { rows: browseListsFor(jailbroken).map((l) => ({ label: l.title, href: format({ tab: "home", path: ["browse", l.id] }) })),
    footer: `New and Recently Updated reach back ${FRESH_DAYS} days. Popular: what the most sources list.` };
  if (!cats.length) return [lists, { footer: "Add a source to browse its packages." }];
  return [lists, {
    header: "Categories",
    rows: cats.map((c) => ({ label: c.name, detail: String(c.count), href: format({ tab: "home", path: ["browse", `category:${c.name}`] }) })),
  }];
}

// F124: New and Recently Updated under a header per day, newest first (the Changes tab's day titles).
export function dayHeaders(rows, now = Date.now()) {
  const out = [];
  let day = null;
  for (const r of rows) {
    const d = dayOf(r.seen);
    if (d !== day) { day = d; out.push({ header: dayTitle(d, now) }); }
    out.push(r);
  }
  return out;
}

// F124, Featured: the sources' banners (sileo-featured.json), then the AltStore sources' featured apps.
async function featuredRows() {
  const [refs, sources] = await Promise.all([featuredRefs().catch(() => []), getBackend().sources().catch(() => [])]);
  const alts = await Promise.all(sources.filter((s) => isAltKey(s.key)).map((s) => catalog.altSource(s.key).catch(() => null)));
  const appRefs = alts.flatMap((a) => (a?.featured ?? []).map((r) => ({ key: r.key, id: r.id })));
  return catalog.featured([...refs, ...appRefs]);
}

// Each list's rows and how it reads (browse.js renderSearchableList).
const LIST_VIEW = {
  new: { rows: () => catalog.fresh("new"), headers: dayHeaders,
    empty: `Nothing new in the last ${FRESH_DAYS} days. Packages your sources add show up here after a refresh.` },
  updated: { rows: () => catalog.fresh("updated"), headers: dayHeaders,
    empty: `No updates in the last ${FRESH_DAYS} days. New versions show up here after a refresh.` },
  popular: { rows: () => catalog.popular() },
  featured: { rows: featuredRows, empty: "None of your sources features packages." },
  "free-apps": { rows: () => catalog.free("apps"), letters: true },
  "free-tweaks": { rows: () => catalog.free("tweaks"), letters: true },
  "free-themes": { rows: () => catalog.free("themes"), letters: true },
};

// Recommended Sources: one row per curated repo; a tap asks, checks the repo and adds it. Listed ones are ticked.
function renderSources(body, ctx) {
  const box = el("div");
  body.append(box);
  let busy = false;
  async function draw() {
    let have = new Set();
    try {
      have = new Set((await getBackend().sources()).map((s) => s.key));
    } catch {
      // no store: every source shows as addable
    }
    box.replaceChildren(grouped([{
      header: "Package Sources",
      rows: CURATED_SOURCES.map((s) => ({
        label: s.name,
        subtitle: s.blurb || s.uri,
        checked: have.has(s.key),
        icon: { text: s.name[0] },
        onClick: have.has(s.key) ? undefined : () => add(s),
      })),
      footer: "Tap a source to add it. Ticked sources are already in your list.",
    }]));
  }
  async function add(s) {
    if (busy) return;
    const { index } = await showAlert({ title: "Add Source", message: `${s.name}\n${s.uri}`, buttons: ["Cancel", "Add Source"], cancel: 0 });
    if (index !== 1) return;
    busy = true;
    const hide = ctx.showHUD("Verifying URL");
    let error = null;
    try {
      await getBackend().addSource(s.uri);
    } catch (e) {
      error = e;
    } finally {
      hide();
      busy = false;
    }
    if (error) await showAlert({ title: error.title || "Verification Error", message: error.message, buttons: ["OK"] });
    await draw();
  }
  draw();
}

export function render(el, route, ctx) {
  return homeRoute(route).render(el, route, ctx);
}

// I7: iFizBox's .deb for a jailbroken visitor's arch: the latest release's asset for it (GitHub's API, which answers
// browsers), else the rootless iFizBox.deb. Safari downloads it to Files, where Sileo or Filza installs it.
// "Jailbroken? Get iFizBox.deb": iFizBox's own APT repo (tools/release.sh: a flat repo beside each release's assets)
// added in Sileo or Zebra, which then keep iFizBox updated; or the URL to paste elsewhere; or the .deb itself.
// B17: <DOMAIN>/repo/ (the Worker serves the release assets itself): GitHub's latest/download redirect ends at a
// signed URL too long for Zebra's cache file name.
export const IFIZBOX_APT_REPO = APP_APT_REPO;
export const JAILBROKEN_SHEET = { title: `Install ${NAME} with your jailbreak's package manager: it keeps ${NAME} updated.`,
  buttons: ["Add to Sileo", "Add to Zebra", "Copy Repo URL", "Download .deb"] };
const IFIZBOX_PACKAGE = "com.ryha.ifizbox";
export const repoLinks = (repo = IFIZBOX_APT_REPO, id = IFIZBOX_PACKAGE) => ({
  sileo: `sileo://source/${repo}`, zebra: `zbra://sources/add/${repo}`,
  // their pages for a package, once the repo is there
  sileoPackage: `sileo://package/${id}`, zebraPackage: `zbra://packages/${id}` });

// Sileo and Zebra can't add a repo and open a package in one link: after Add to Sileo/Zebra, coming back here asks
// to open iFizBox's page there (the alert's tap opens it, as Safari requires), so Get is one tap away (user 2026-11-18).
function offerPackageOnReturn(name, link) {
  let away = false;
  const onVis = async () => {
    if (document.visibilityState === "hidden") { away = true; return; }
    if (!away) return;
    document.removeEventListener("visibilitychange", onVis);
    await showAlert({ title: `Open ${NAME} in ${name}?`, message: `${NAME}'s repo is in ${name} now. Its page there has Get.`,
      buttons: ["Not Now", `Open in ${name}`], cancel: 0, colors: { 1: "green" },
      onTap: (i) => { if (i === 1) location.href = link; } });
  };
  document.addEventListener("visibilitychange", onVis);
}
async function jailbrokenSheet() {
  const { showActionSheet } = await import("../nav/actionsheet.js");
  const i = await showActionSheet(JAILBROKEN_SHEET);
  const links = repoLinks();
  if (i === 0) { offerPackageOnReturn("Sileo", links.sileoPackage); location.href = links.sileo; }
  else if (i === 1) { offerPackageOnReturn("Zebra", links.zebraPackage); location.href = links.zebra; }
  else if (i === 2) {
    try { await navigator.clipboard.writeText(IFIZBOX_APT_REPO); } catch { /* shown below anyway */ }
    await showAlert({ title: "Repo URL Copied", message: IFIZBOX_APT_REPO, buttons: ["OK"] });
  } else if (i === 3) {
    const { showActionSheet: pick } = await import("../nav/actionsheet.js");
    const kinds = [["Rootless (Dopamine, palera1n)", "iphoneos-arm64"], ["Roothide", "iphoneos-arm64e"], ["Rootful (checkra1n, older)", "iphoneos-arm"]];
    const k = await pick({ title: "Which jailbreak?", buttons: kinds.map(([l]) => l) });
    if (k >= 0) installDeb(kinds[k][1]);
  }
}

async function installDeb(arch) {
  let release = null;
  try { release = await fetchRelease(); } catch { /* the plain rootless .deb below */ }
  const url = debUrl(arch, { release, debFor });
  const { index } = await showAlert(debAlert(arch, url));
  if (url && index === 1) { markiFizBoxInstalled(); location.href = url; } // F96: its download is as far as the website sees
}
