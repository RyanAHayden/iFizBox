// Entry point: the tab bar, one navigation stack per tab (nav/stack.js), push/pop slides and the edge swipe back.
//
// DOM: #screens holds a .tab-stack per tab, and each holds its stack's .page elements, root first. A page is a
// fixed frame (.page, moved by transforms) around its own scroller (.page-body), so switching tabs or popping
// keeps every screen's scroll position. The nav bar holds a matching .nav-stack of .nav-items per tab. Only the
// top page of the active tab is visible; the one below shows during a slide or swipe.
//
// Screens (screens/*.js) export `title`, `render(body, route, ctx, page)` (page: its nav item, nav/go.js pageHandle) and optionally `nav(route, ctx)` returning
// { title, back (the back button's label above it; else the title), style: "grouped" | "plain", left: { label, onClick }, right: { label, onClick } | [several] } and `init(ctx)`,
// run once at start (e.g. to set the tab's badge). ctx: { go, back, setBadge, showHUD }.
import { detectMode } from "./core/settings.js";
import { TABS, BAR_TABS, createRouter, format, parent, mounted, parse, mountLink, lazyFor, LAZY_TABS, TAB_TITLES } from "./router.js";
import { load, loaded, mod, missing, loadAll, NotLoaded } from "./lazy.js";
import { grouped, placeholder } from "./nav/ui.js";
import { createStacks, swipeCommits } from "./nav/stack.js";
import { animate, setProgress, clear, DURATION, EASE_OUT } from "./nav/transition.js";
import { attachEdgeSwipe } from "./nav/swipe.js";
import { keepRow, ghostFor } from "./nav/selection.js";
import { createTabbar, tapTab, scrollToTop, isSliding } from "./nav/tabbar.js";
import { scrollerOf } from "./nav/searchbar.js";
import { showHUD } from "./nav/hud.js";
import { showAlert } from "./nav/alert.js";
import { initScroller } from "./nav/scroller.js";
import { makeScrollToTop } from "./nav/statusbar.js";
import { pageOpened, pageShown } from "./nav/pagestate.js";
import { createHomeTop, homeRootOf } from "./nav/hometop.js";
import * as home from "./screens/home.js";
import * as settingsScreen from "./screens/settings.js";
import { sourceFilter } from "./core/sources.js";
import { getBackend } from "./backend.js";
import { appSchemeFor, openOutside } from "./core/applinks.js";
import { launchURL } from "./launch.js";
import { isAddPath, parseAddLink } from "./core/handoff.js";
import { lookForUpdates, appVersion } from "./essential-ui.js";
import { showReloadBar } from "./nav/reloadbar.js";
import { catalog } from "./catalog.js";
import { createUpgradeNotices } from "./settings.js";
import { createPrefsMirror } from "./settings.js";
import { keepRoute } from "./core/installroute.js"; // B218
import { nativeBridge } from "./native.js";
import { NAME } from "./brand.js";
import { takeInstallParam, askFromInstallLink, launchRefresh } from "./websign-gate.js";
import { notIphonePage } from "./core/platform.js";
import { showNotIphone } from "./screens/notiphone.js";
import { handoffRecent } from "./handoffclock.js";
import { navButtons, MOVED_CLASS } from "./nav/navbuttons.js";
import { holdButton } from "./nav/menu.js"; // F346
import { setNavigator, pageHandle, backFollowsTitle } from "./nav/go.js";

// F266: a Mac, PC or Android phone gets the Not-an-iPhone page first, and the app only starts once it's left (Look
// Around Anyway, or What Is …? onto the FAQ). Decided by user agent before anything is drawn, so an iPhone, an iPad
// and the native app go straight on and never see it.
const notIphone = notIphonePage(window);
if (notIphone) {
  document.getElementById("boot")?.remove();
  const route = await showNotIphone(notIphone);
  if (route) history.replaceState(null, "", location.pathname + location.search + route);
}

// F313: Home and Settings come with app.js; the other tabs' screens load after the first page is up, or at their
// routes (lazy.js, router.js lazyFor). screenOf throws lazy.js NotLoaded for one not in yet (drawPage draws it later);
// loadedScreen gives null instead.
const STATIC_SCREENS = { home, settings: settingsScreen };
const screenOf = (tab) => STATIC_SCREENS[tab] ?? mod(tab);
const loadedScreen = (tab) => STATIC_SCREENS[tab] ?? loaded(tab);
// A lazy tab's init(ctx) (Changes' badge, Installed's queue chrome) and Sources' context run once its module is in,
// before any of its pages is drawn.
const inited = new Set();
function initLoadedTabs() {
  for (const tab of LAZY_TABS) {
    const screen = !inited.has(tab) && loaded(tab);
    if (!screen) continue;
    inited.add(tab);
    screen.init?.(ctx);
    if (tab === "sources") screen.useContext?.(ctx); // B141: loads started outside a screen (the website's import) get the reload bar
  }
}
const loadTabs = (tabs = LAZY_TABS) => loadAll(tabs).then(() => initLoadedTabs());

const screensEl = document.getElementById("screens");
const navbarEl = document.getElementById("navbar");
const tabStacks = {};
const navStacks = {};
// F123: one stack per tab-bar tab; Settings' pages live on Home's (router.js settingsRoute).
for (const tab of BAR_TABS) {
  tabStacks[tab] = Object.assign(document.createElement("div"), { className: "tab-stack" });
  tabStacks[tab].dataset.tab = tab;
  screensEl.append(tabStacks[tab]);
  navStacks[tab] = Object.assign(document.createElement("div"), { className: "nav-stack" });
  navStacks[tab].dataset.tab = tab;
  navbarEl.append(navStacks[tab]);
}

// F65: the icon badge N5's daemon sets goes once the Changes tab shows no upgrades (jailbreak app only).
const upgradeNotices = createUpgradeNotices({ settings: settingsScreen.settings, current: () => router.current() }); // called only once the screens init, after router exists
const tabbar = createTabbar(document.getElementById("tabbar"), BAR_TABS, (t) => TAB_TITLES[t]);
const ctx = {
  go: (route) => router.go(route),
  back: () => goBack(),
  setBadge: (tab, n) => { tabbar.setBadge(tab, n); upgradeNotices.badge(tab, n); },
  showHUD,
  showAlert,
  // F150: Sources' refreshes drop the reload bar; its last two steps load the new package lists into the catalog
  // ("Loading Data") and build All Sources, the merged index Search reads, by asking for its sections ("Building
  // Searcher Cache"). A failure there shows where it is used (the source's Sections page, Search), not as the
  // refresh's error.
  reloadBar: showReloadBar,
  loadData: () => catalog.ensure().catch(() => {}),
  buildCache: () => catalog.sections().catch(() => {}),
};

const stacks = createStacks({ tabs: BAR_TABS, create: makePage });

function button(spec, cls) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = spec.label;
  if (spec.onClick) b.addEventListener("click", spec.onClick);
  if (spec.onPress) b.addEventListener("pointerdown", spec.onPress); // touch-down (Sources' Add: Type before the Paste bubble)
  if (spec.onHold) holdButton(b, spec.onHold); // F346: a package page's Install held opens Install Which Version?
  if (spec.ref) spec.ref(b); // F147: the screen keeps the button to change its label later (Installed's Wish List count)
  return b;
}

// Called by stacks.sync while it builds a stack, root first: the parent is already the stack's last entry.
function makePage(tab, path) {
  const route = mounted({ tab, path }); // another tab's page opened here (router.js mounted): that screen draws it
  pageOpened(route); // B43: a page built here starts on its default segment, filter or pane (nav/pagestate.js)
  const below = stacks.stack(tab).at(-1);

  const page = document.createElement("section");
  page.className = "page";
  const body = document.createElement("div");
  const shade = document.createElement("div");
  shade.className = "page-shade";
  page.append(body, shade);
  tabStacks[tab].append(page);

  const item = document.createElement("div");
  item.className = "nav-item";
  navStacks[tab].append(item);

  // back: the label pages above it show; handle: the page's own nav item for its screen (nav/go.js pageHandle)
  const entry = { el: page, body, shade, item, title: "", back: "", handle: pageHandle(item, body) };
  backFollowsTitle(entry); // a name the screen learns later is also the back label above (nav/go.js)
  drawPage(entry, route, below);
  return entry;
}

// The page's nav bar and body, from its screen. F313: a screen or part not loaded yet (lazy.js NotLoaded: a route
// router.js lazyFor doesn't list, or a load that failed) leaves the loading placeholder under its tab's title, and
// draws the page again once the module is in.
function drawPage(entry, route, below) {
  try {
    const screen = screenOf(route.tab);
    const info = (screen.nav && screen.nav(route, ctx)) || {};
    const title = info.title ?? screen.title;
    entry.title = title;
    entry.back = info.back ?? title;
    entry.body.className = "page-body " + (info.style === "plain" ? "plain" : "grouped");
    entry.body.replaceChildren();
    entry.item.replaceChildren(...navParts(info, below, title));
    screen.render(entry.body, route, ctx, entry.handle);
  } catch (e) {
    if (!(e instanceof NotLoaded)) throw e;
    entry.title ||= TAB_TITLES[route.tab];
    entry.back ||= entry.title;
    entry.body.className = "page-body grouped";
    entry.body.replaceChildren(placeholder());
    entry.item.replaceChildren(...navParts({ title: entry.title }, below, entry.title));
    load(e.module).then(() => {
      initLoadedTabs();
      if (!entry.el.isConnected) return;
      drawPage(entry, route, below);
      if (stacks.top()?.page === entry) document.title = entry.title === NAME ? NAME : `${entry.title} · ${NAME}`;
    }, () => {
      // The browser keeps a failed module fetch for the rest of the session: only a reload tries again.
      if (entry.el.isConnected) entry.body.replaceChildren(grouped([{ footer: `This page didn't load. Check the connection, then reload ${NAME}.` }]));
    });
  }
}

function navParts(info, below, title) {
  const left = document.createElement("div");
  left.className = "nav-left";
  const bar = navButtons(info, !!below); // B176: a pushed root keeps its Refresh, on the right (nav/navbuttons.js)
  if (bar.back) {
    const back = button({ label: below.page.back, onClick: () => goBack() }, "bar-button back");
    back.setAttribute("aria-label", "Back to " + below.page.back);
    left.append(back);
  } else if (bar.left) left.append(button(bar.left, "bar-button"));
  const h1 = document.createElement("h1");
  h1.className = "nav-title";
  h1.textContent = title;
  if (info.titleView) { h1.classList.add("nav-title-view"); h1.replaceChildren(info.titleView); } // a control in the title's place (F127)
  const right = document.createElement("div");
  right.className = "nav-right";
  // `right` may be one button or several side by side (Sources: Add and Manage).
  for (const b of bar.right) right.append(button(b, b.moved ? "bar-button " + MOVED_CLASS : "bar-button"));
  return [left, h1, right];
}

// withSelect (F163): a pop, so the row that opened `top` (below.selected, nav/selection.js) fades with it. Its
// copy may be laid again here (the list re-rendered while hidden): that is the one layout a pop's start costs.
const pairOf = (top, below, withSelect = false) => ({
  top: { page: top.page.el, shade: top.page.shade, item: top.page.item },
  below: { page: below.page.el, shade: below.page.shade, item: below.page.item,
    select: withSelect ? ghostFor(below.selected, below.page.el) : null },
});

// F163: the row tapped to push a page stays blue on the page below until that page comes back. lastPress is the
// last row a finger went down on (the press handler below); a push that follows it within PRESS_MS opened it.
const PRESS_MS = 1500;
let lastPress = null; // { el, at }
function keepSelected(entry) {
  const press = lastPress;
  lastPress = null;
  if (!press || performance.now() - press.at > PRESS_MS || !press.el.matches(".cell-inner")) return;
  if (!press.el.isConnected || !entry.page.el.contains(press.el)) return;
  unselect(entry);
  entry.selected = keepRow(press.el);
}
function unselect(entry) {
  if (!entry?.selected) return;
  entry.selected.mark?.remove();
  entry.selected = null;
}

function setTop(entry, on) {
  entry.page.el.classList.toggle("is-top", on);
  entry.page.item.classList.toggle("is-top", on);
}
// block: no taps while a slide runs. Not during the swipe: the finger's own pointer stream must keep coming.
function setMoving(pair, on, block = on) {
  for (const who of ["top", "below"]) {
    pair[who].page.classList.toggle("is-moving", on);
    pair[who].item.classList.toggle("is-moving", on);
  }
  document.documentElement.classList.toggle("nav-moving", block);
}
// Popped pages are already hidden; taking them out of the DOM costs a layout, so it waits until the screen is
// still (the next idle moment, at most 500 ms) instead of landing on the slide's last frame.
const idle = window.requestIdleCallback || ((f) => setTimeout(f, 50));
function drop(entries) {
  if (!entries.length) return;
  for (const e of entries) setTop(e, false);
  idle(() => { for (const e of entries) { e.page.el.remove(); e.page.item.remove(); } }, { timeout: 500 });
}

let running = null;      // the slide in progress: { finish() }
let swipedBack = false;  // the swipe already slid the pop; the route change that follows only cleans up

function slide(top, below, p0, p1, cleanup, { withSelect = false, ...opts } = {}) {
  const pair = pairOf(top, below, withSelect);
  setMoving(pair, true);
  setProgress(pair, p0);
  running = animate(pair, p0, p1, {
    ...opts,
    onEnd() {
      running = null;
      setMoving(pair, false);
      clear(pair);
      cleanup();
    },
  });
}

// F313: a route whose pages draw with modules not loaded yet (router.js lazyFor) shows once they're in, so a push
// still slides in drawn; a newer route meanwhile wins. A failed load shows it anyway (drawPage draws what it can).
let routeSeq = 0;
let firstShown = false;
function onRoute(route) {
  const seq = ++routeSeq;
  const need = missing(lazyFor(route));
  if (!need.length) return showRoute(route);
  const show = () => { initLoadedTabs(); if (seq === routeSeq) showRoute(router.current()); };
  loadAll(need).then(show, show);
}

const router = createRouter({ win: window, onRoute });
// Screens' go()/back() (nav/go.js): the router's go and the nav bar's Back.
setNavigator({ go: (hash) => router.go(parse(hash)), back: () => goBack() });

function showRoute(route) {
  initLoadedTabs(); // a tab a press or the background load brought in starts before its pages draw
  { // (the body router.onRoute had before F313, kept as it was)
    if (running) running.finish();
    const r = stacks.sync(route);
    const all = stacks.stack(r.tab);
    // B148: a kept page on top again (Back, a tab switch) refreshes its state-made details in place; one just built is
    // fresh. A swipe already did it when it began.
    if (r.to && r.kind !== "none" && !r.added.includes(r.to) && r.to !== shownBySwipe) showAgain(r.to);
    shownBySwipe = null;
    if (r.kind === "tab") {
      for (const t of BAR_TABS) {
        tabStacks[t].classList.toggle("is-active", t === r.tab);
        navStacks[t].classList.toggle("is-active", t === r.tab);
      }
      tabbar.select(r.tab);
    }
    if (r.kind === "push" && r.from) {
      setTop(r.to, true);
      keepSelected(r.from);
      slide(r.to, r.from, 0, 1, () => setTop(r.from, false));
    } else if (r.kind === "pop" && !swipedBack && !(webBack && !ownBack)) {
      const [old, ...deeper] = r.removed;
      drop(deeper);
      setTop(r.to, true);
      slide(old, r.to, 1, 0, () => { drop([old]); unselect(r.to); }, { withSelect: true });
    } else {
      drop(r.removed);
      unselect(r.to); // back on top without a slide (a swipe already faded it, a web back, a tab): no blue left
      for (const e of all) setTop(e, e === r.to);
    }
    swipedBack = false;
    ownBack = false;
    updateEdge();
    document.title = r.to.page.title === NAME ? NAME : `${r.to.page.title} · ${NAME}`;
  }
  // The loading screen goes once the first page is drawn: at start, or once a deep link's modules are in.
  if (!firstShown) { firstShown = true; document.getElementById("boot")?.remove(); }
}

// Back: history.back() when the parent is right behind us in history (we pushed here), so the browser's back and
// forward stay in step; on a deep link there is nothing behind, so replace the route with the parent instead.
// Outside the native app, iOS has its own edge swipe back: Safari's in a tab, and the system's in an iOS 26 home-screen
// web app. Both walk the browser history with their own animation. Ours on top made one swipe go back twice (theirs,
// then ours finishing and calling history.back() again), landing somewhere else. So on the web our edge strip stays
// off and a pop we didn't start isn't animated; we just show the page history lands on. The native app's WKWebView
// has no such gesture (N1 turns it off), so it keeps ours.
const webBack = !(globalThis.ifizboxApp || nativeBridge());
let ownBack = false; // the pop under way came from our back button or our swipe

function goBack() {
  ownBack = true;
  const top = stacks.top();
  const below = stacks.below();
  const up = below ? { tab: below.tab, path: below.path } : top && parent({ tab: top.tab, path: top.path });
  if (!up) return;
  if (top.pushed) history.back();
  else router.replace(up);
}

// The swipe starts on a thin strip along the left edge that takes touches for itself (touch-action: none), so the
// browser never turns the drag into its own back gesture or a scroll and cancels our pointer stream. It is only
// there while there is something to go back to.
const edgeEl = document.createElement("div");
edgeEl.className = "edge-swipe";
screensEl.append(edgeEl);
function updateEdge() {
  // pointer-events, not display: switching it costs no layout.
  edgeEl.classList.toggle("off", webBack || stacks.stack(stacks.activeTab()).length < 2);
}

// B148 (nav/pagestate.js pageShown): an existing page shown again refreshes what it read from state.
let shownBySwipe = null; // the page a swipe already refreshed as it began to reveal it
function showAgain(entry) {
  pageShown(mounted({ tab: entry.tab, path: entry.path }), entry.page.body).catch(() => {});
}

let gesture = null; // the edge swipe in progress: { pair, top, below, width }
attachEdgeSwipe(edgeEl, {
  canStart: () => !webBack && !running && !gesture && stacks.stack(stacks.activeTab()).length > 1,
  begin() {
    const all = stacks.stack(stacks.activeTab());
    const [top, below] = [all.at(-1), all.at(-2)];
    gesture = { pair: pairOf(top, below, true), top, below, width: screensEl.clientWidth };
    setMoving(gesture.pair, true, false);
    if (shownBySwipe !== below) { shownBySwipe = below; showAgain(below); } // B148: right as it is revealed
    return gesture.width;
  },
  move(dx) {
    if (gesture) setProgress(gesture.pair, 1 - Math.min(1, dx / gesture.width));
  },
  end(dx, vx) {
    const { top, below, width, pair } = gesture;
    gesture = null;
    const p = 1 - Math.min(1, dx / width);
    const commit = swipeCommits(dx, vx, width);
    setMoving(pair, false);
    // Keep the slide's speed close to the finger's: a fast flick finishes fast.
    const rest = commit ? p : 1 - p;
    const speed = Math.abs(vx) * DURATION / width; // full slides per DURATION at the finger's speed
    const duration = Math.max(120, Math.min(DURATION, rest * DURATION / Math.max(1, speed)));
    slide(top, below, p, commit ? 0 : 1, () => {
      if (!commit) { shownBySwipe = null; return; } // B148: a later Back to it refreshes again
      swipedBack = true;
      unselect(below); // faded out with the swipe
      setTop(below, true);
      setTop(top, false); // hidden until the route change drops it
      goBack();
    }, { duration, easing: EASE_OUT, withSelect: true });
  },
});

// Tab taps go through selectTab so each tab keeps its place; the href is there for no-JS fallbacks and a11y.
for (const tab of BAR_TABS) tabbar.items[tab].href = format({ tab });
// The website before iFizBox is installed (websign-gate.js browsingLocked): only Home in the tab bar (Settings is on
// Home's stack since F123, so it stays reachable); the others are dimmed with a lock, and a tap asks Install iFizBox
// First (user 2026-11-18). Ignore unlocks them all.
const OPEN_TABS = new Set(["home"]);
let gate = null;
const lockTabs = async () => {
  gate ??= await import("./websign-gate.js");
  const locked = gate.browsingLocked({ mode: detectMode() });
  for (const t of BAR_TABS) tabbar.items[t].classList.toggle("tab-locked", locked && !OPEN_TABS.has(t));
};
if (!(globalThis.ifizboxApp || nativeBridge())) { lockTabs(); addEventListener("ifizbox:browse-lock", lockTabs); }

document.getElementById("tabbar").addEventListener("click", (e) => {
  const a = e.target.closest("a.tab");
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  if (a.classList.contains("tab-locked")) {
    import("./screens/home.js").then((h) => gate.askToBrowse({ install: () => h.installiFizBox() })).catch(() => {});
    return;
  }
  // A second tap at the root scrolls the page to the top (F148), then runs the screen's reselect() (Search focuses
  // its field), in this handler (F36).
  const tab = a.dataset.tab;
  homeTop.tabTapped(tab); // F211: Home shows at its top when its tab is tapped from elsewhere (nav/hometop.js)
  // Back to the root of the tab you are on is our own pop, so it slides like Back (not a jump).
  tapTab(tab, router.current(), { selectTab: (t) => { ownBack = true; router.selectTab(t); }, reselect: loadedScreen(tab)?.reselect,
    // C10: a page with the pinned search bar scrolls its results (nav/searchbar.js), not its body.
    scrollTop: () => scrollToTop(scrollerOf(stacks.top()?.page.body)), sliding: () => isSliding(scrollerOf(stacks.top()?.page.body)) });
});

// Pressed look while a finger is down, like Cydia's: .is-pressed on the bar button or row under it, off when the
// finger lifts, leaves, or the touch turns into a scroll (pointercancel). :active alone is unreliable on iOS.
const PRESSABLE = ".bar-button, a.cell-inner, button.cell-inner, .alert-button, .del-confirm, a.browse-hero";
let pressed = null, pressedAt = 0;
// A quick tap still shows the held look for a moment, as UIKit does: otherwise a button that opens something (Browse's
// file picker) never visibly goes down.
const unpress = () => {
  const el = pressed;
  if (!el) return;
  pressed = null;
  setTimeout(() => { if (pressed !== el) el.classList.remove("is-pressed"); }, Math.max(0, 140 - (performance.now() - pressedAt)));
};
document.addEventListener("pointerdown", (e) => {
  unpress();
  const el = e.target.closest?.(PRESSABLE);
  if (!e.isPrimary) return; // one finger's button at a time, as UIKit does
  lastPress = null;
  // A new press clears any other still showing (a quick tap's lingering 140 ms included): one held look at a time.
  for (const other of document.querySelectorAll(".is-pressed")) if (other !== el && !other.classList.contains("sel-ghost")) other.classList.remove("is-pressed");
  // While a row shows its Delete (a swipe), a tap on a row only puts the Delete away: no blue, as Cydia.
  const delShown = el?.closest("ul")?.querySelector(":scope > .armed") && !el.matches(".del-confirm");
  if (el && !el.disabled && !delShown) { pressed = el; pressedAt = performance.now(); el.classList.add("is-pressed"); lastPress = { el, at: pressedAt }; }
}, { passive: true });
for (const type of ["pointerup", "pointercancel", "pointerleave"]) document.addEventListener(type, unpress, { passive: true });
document.addEventListener("pointermove", (e) => {
  if (pressed && !pressed.contains(document.elementFromPoint(e.clientX, e.clientY))) unpress();
}, { passive: true });
// A held row lets go the moment its list scrolls (UIKit cancels the cell's highlight when the pan starts); iOS's
// pointercancel alone can come late or not at all after a long hold.
document.addEventListener("scroll", () => { if (pressed) { pressed.classList.remove("is-pressed"); pressed = null; lastPress = null; } }, { capture: true, passive: true });
// The search fields' clear button (packages.css .search-field::after): a tap at the field's right end, while it has
// text, empties it and searches again (the field's own input listener), keeping the keyboard up.
document.addEventListener("click", (e) => {
  const f = e.target;
  if (!(f instanceof Element) || !f.classList.contains("search-field")) return;
  const input = f.querySelector("input");
  if (!input?.value || e.clientX < f.getBoundingClientRect().right - 32) return;
  e.preventDefault();
  input.value = "";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
}, true);
// iOS only applies :active to elements when a touch listener exists somewhere on the page.
document.addEventListener("touchstart", () => {}, { passive: true });

initScroller(document.getElementById("screens"));
// The other tabs' init runs once their screens load (initLoadedTabs: after the first page, below).
for (const tab of TABS) if (STATIC_SCREENS[tab]?.init) STATIC_SCREENS[tab].init(ctx);
// N4: the install queue (jailbreak build: the backend has one): Confirm opens when a package is queued. F313: queue.js
// and ipa-install.js load after the first page.
const afterFirstPage = [];
if (typeof getBackend().queue === "function") afterFirstPage.push(() => load("queue").then((q) => q.initQueue(ctx)));
afterFirstPage.push(() => load("ipaInstall").then((m) => m.initIpaLinks())); // F67: a tapped .ipa link offers Install IPA (jailbreak build only)
// Home Screen launches open on Home (F32, launch.js); a return from the background runs none of this.
const startAt = launchURL(window);
if (startAt) history.replaceState(null, "", startAt);
// F184: ifizbox.com/?install (a site's Add to iFizBox button, when the app isn't installed) opens Home without the
// param, then asks Install iFizBox First, Not Now / Install iFizBox (F217: not the browse gate; below, once the
// router started). Website only.
const installLink = takeInstallParam(window, { mode: detectMode() });
// F8: a /add?url=… link (core/handoff.js) opens Sources > Manage > Sources with Add Source's alert filled in.
const addFrom = isAddPath(location.pathname) ? parseAddLink(location.search) : null;
if (isAddPath(location.pathname)) {
  history.replaceState(null, "", location.pathname.replace(/add\/?$/, "") + format({ tab: "sources", path: ["manage", "sources"] }));
}
// The Home Screen web app opens outside links in a sheet over itself, address bar on top. x-safari-https://… makes
// iOS hand them to Safari instead, and from there to their own apps (Discord, GitHub). The app's shell sends them
// out natively already (LinkOut); a Safari tab opens them as usual.
const standalone = !nativeBridge() && (navigator.standalone || matchMedia?.("(display-mode: standalone)").matches);
if (standalone) {
  const outside = (u) => { try { const x = new URL(u, location.href); return /^https?:$/.test(x.protocol) && x.origin !== location.origin ? x.href : null; } catch { return null; } };
  // A site with its own app's scheme (core/applinks.js: X, YouTube) opens that app; Safari only if it didn't come up.
  const viaSafari = (href) => openOutside(href, { go: (u) => { location.href = u; } });
  const open = window.open.bind(window);
  window.open = (u, ...rest) => { const href = outside(u); if (href) { viaSafari(href); return null; } return open(u, ...rest); };
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.("a[href]");
    const href = a && outside(a.getAttribute("href"));
    if (href && (a.target === "_blank" || a.rel.includes("noopener"))) { e.preventDefault(); viaSafari(href); }
  }, true);
}
// The app's shell: LinkOut asks iOS for the universal link, which only reaches the app signed by its own team. A
// re-signed sideload (Unbound for Discord, though it drops the invite, so Discord stays https) still claims the scheme, so try that first; else the https link as before.
if (nativeBridge()) {
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.("a[href]");
    const app = a && a.target === "_blank" && appSchemeFor(a.href);
    if (!app) return;
    e.preventDefault();
    const out = (url) => nativeBridge().call("app.openURL", { url }).then((r) => r?.opened === true, () => false);
    out(app).then((ok) => ok || out(a.href));
  }, true);
}
router.start();
askFromInstallLink(installLink, { install: () => home.installiFizBox() }).catch(() => {});
// F93 (as before F89): first launch of a iFizBox installed from the website: its signed copy carries the website's
// sources and settings as web/transfer.link (signed in the browser, websign-job.js); import them once, no question.
// Only on the very first launch (user 2026-11-17: the website is rarely used after that).
if (nativeBridge()) {
  let done = null;
  try { done = localStorage.getItem("ifizbox.transferDone"); } catch { /* private */ }
  if (!done) fetch("transfer.link", { cache: "no-store" }).then((r) => (r.ok ? r.text() : null)).then(async (link) => {
    link = link?.trim();
    if (!link || !link.startsWith("ifizbox://import?")) return;
    try { localStorage.setItem("ifizbox.transferDone", "1"); } catch { /* imports again next launch */ }
    const { handleIncoming } = await import("./incoming.js");
    await handleIncoming(link);
  }).catch(() => {});
}
upgradeNotices.start();
createPrefsMirror({ settings: settingsScreen.settings }).start(); // F70: N7's settings to the daemon
keepRoute({ settings: settingsScreen.settings, native: nativeBridge() }); // B218: Install Apps With kept in the Keychain (sideload)
if (addFrom) requestAnimationFrame(() => load("manage").then((m) => m.addSource(ctx, addFrom)).catch(() => {}));

// Refresh Sources on Launch (Settings): in the background, no HUD; the Sources tab shows the result when it next loads.
// Refresh on Launch: in the background, with the Sources tab's spinning red badge (screens/sources.js).
// The website instead refreshes each launch once browsing is unlocked (F250), whatever the setting says: one path each
// (websign-gate.js launchRefresh).
const refreshSetting = () => settingsScreen.settings.isShown("refreshOnLaunch") && settingsScreen.settings.get("refreshOnLaunch");
// F313: Sources' screen loads for it (its context, B141, set by initLoadedTabs first).
const refreshAtOpen = () => launchRefresh({ mode: detectMode(), settingOn: refreshSetting,
  background: () => loadTabs(["sources"]).then(() => loaded("sources").refreshInBackground?.(ctx)).catch(() => {}) });
refreshAtOpen();

// F313: once the first page is up, the other tabs (their init: Changes' badge), queue.js and ipa-install.js's
// listeners, then every other lazily loaded module, in the background, so a later tap never waits for one. After a
// frame, or half a second when no frame comes (a launch in the background).
{
  let started = false;
  const rest = () => {
    if (started) return;
    started = true;
    loadTabs().catch(() => {}).then(() => {
      for (const f of afterFirstPage) f().catch(() => {});
      return loadAll();
    }).catch(() => {});
  };
  requestAnimationFrame(() => setTimeout(rest, 0));
  setTimeout(rest, 500);
}
// F313: a press on a link starts loading what its route draws with, ahead of the click (router.js lazyFor).
document.addEventListener("pointerdown", (e) => {
  const a = e.target.closest?.("a[href^='#/']");
  if (!a) return;
  const to = parse(a.getAttribute("href"));
  const need = missing(lazyFor(mountLink(router.current(), to) ?? to));
  if (need.length) loadAll(need).catch(() => {});
}, { passive: true, capture: true });

// Back from the background after Settings' Return to Home After (2 minutes unless changed; Never: 0) counts as a
// fresh open (user 2026-11-18): Home's root, and the launch refresh again. iOS rarely cold-launches the app or a
// Home Screen web app, so without this it opens wherever it was left.
// Never while something is up (user 2026-11-18): an alert, action sheet, HUD, share sheet or any sheet (Confirm,
// the install console and progress page, signing), so a popup or an install in progress is where the user left it.
const OVERLAYS = ".alert-scrim, .action-scrim, .hud-scrim, .share-scrim, .sheet, .filter-drop, .menu";
{
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
    const after = Number(settingsScreen.settings.get("returnHome")) * 60 * 1000;
    if (!hiddenAt || !after || Date.now() - hiddenAt < after) return;
    if (document.querySelector(OVERLAYS)) { hiddenAt = 0; return; }
    // B174: nor when another app brought iFizBox forward with a file or link (an .ipa from Files): its page wins.
    if (handoffRecent()) { hiddenAt = 0; return; }
    hiddenAt = 0;
    // Home's root at its top, not where it was scrolled (user 2026-11-18). go's hashchange is async: scroll after it.
    const toTop = () => { const b = stacks.top()?.page.body; if (b) b.scrollTop = 0; };
    if (location.hash === format({ tab: "home", path: [] })) toTop();
    else addEventListener("hashchange", toTop, { once: true });
    router.go({ tab: "home", path: [] });
    refreshAtOpen();
  });
}

// F211: the app opening on Home (launch, back from the background at any time, a Home Screen web app out of the
// back/forward cache) shows Home at its top; the tab bar's click handler calls tabTapped (nav/hometop.js).
const homeTop = createHomeTop({ homeRoot: homeRootOf(stacks), current: () => router.current(),
  overlayUp: () => !!document.querySelector(OVERLAYS) });
homeTop.opened();
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") homeTop.opened(); });
addEventListener("pageshow", (e) => { if (e.persisted) homeTop.opened(); });

// F75: ifizbox:// links from the website (Send Settings, Home's Open in iFizBox App) and elsewhere (incoming.js).
// ifizbox://install (F89) is no longer sent by the website since F92/F95: only for links already out there.
if (nativeBridge()) import("./incoming.js").then((m) => m.startIncoming()).catch(() => {});

// The Home Screen icon's long-press Upgrade All (native Shortcut.perform): Changes, every upgrade queued, Confirm.
// F167: the native shell calls this on a status bar tap (App.swift scrollViewShouldScrollToTop).
globalThis.ifizboxScrollToTop = makeScrollToTop(document, () => stacks.top()?.page.body);

globalThis.ifizboxShortcut = async (type) => {
  if (type !== "upgrade") return;
  location.hash = "#/changes";
  (await import("./screens/changes.js")).upgradeEverything().catch(() => {});
};
if (globalThis.ifizboxPendingShortcut) { globalThis.ifizboxShortcut(globalThis.ifizboxPendingShortcut); globalThis.ifizboxPendingShortcut = null; }

if (nativeBridge()) {
  // F183: every launch, Home's Reload and every return check iFizBox's own source and GitHub's latest release, with
  // no wait between checks and never a popup: a newer iFizBox is a row in Changes and its badge (essential-ui.js).
  const lookForSelf = () => lookForUpdates().catch(() => {});
  setTimeout(lookForSelf, 2000);
  // F291: the jailbreak build offers a listed security patch for this iOS at launch (Install Patch / Later), like
  // Cydia's Essential upgrade; once dpkg's status is in (screens/safety.js lookForPatch), never installing by itself.
  if (detectMode() === "jailbreak") {
    const lookForPatch = () => import("./screens/safety.js").then((m) => m.lookForPatch()).catch(() => {});
    setTimeout(lookForPatch, 6000);
    globalThis.addEventListener("ifizbox:reloaded", lookForPatch); // asked once a launch; this catches a late dpkg read
  }
  globalThis.addEventListener("ifizbox:reloaded", lookForSelf); // Home's Reload (screens/home.js reloadHome)
  // Push is on by default in the sideload app, once the signing server can push and nothing blocks it, unless the
  // user turned it off (core/push.js autoEnablePush). iOS's permission prompt shows here the first time; each launch
  // tries until it's on.
  if (detectMode() === "sideload") {
    setTimeout(() => Promise.all([import("./core/push.js"), import("./signing/identity.js")])
      .then(([p, s]) => p.autoEnablePush({ server: s.getServer() })).catch(() => {}), 3000);
  }
  // The first launch after iFizBox updated itself (iOS closed the old one as it installed this one). F183: no note
  // pops up (the banner went with the update popups); the version line at the bottom of Home and Settings shows it.
  appVersion().then((v) => {
    if (!v) return;
    let last = null;
    try { last = localStorage.getItem("ifizbox.lastVersion"); localStorage.setItem("ifizbox.lastVersion", v); } catch { return; }
    if (last && last !== v) {
      // The icon badge counted this very update: clear it; Changes sets it again with what's still waiting (user 2026-11-18).
      // B158: through upgradeNotices, so a count Changes already took goes straight back on instead of staying 0.
      upgradeNotices.updated();
    }
  }).catch(() => {});
  // Back in the foreground after a while: look again (an essential update can come out while iFizBox sits in the
  // background, and iOS rarely cold-launches it).
  let lastEssential = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || Date.now() - lastEssential < 60 * 1000) return; // every return, once a minute at most
    lastEssential = Date.now();
    lookForSelf();
  });
}

// F89: Web Push went with the website's server. A browser that registered the old push service worker (sw.js,
// F10) drops it, so iOS stops waking it for pushes that no longer come.
if (!nativeBridge()) {
  // A new build on the site: get every file again and reload (screens/home.js refreshIfNewBuild), on open and on
  // each return to the foreground (a Home Screen web app rarely cold-launches), once a minute at most.
  let lastBuildCheck = 0;
  const checkBuild = () => {
    if (document.visibilityState === "hidden" || Date.now() - lastBuildCheck < 60 * 1000) return;
    lastBuildCheck = Date.now();
    home.refreshIfNewBuild().catch(() => {});
  };
  checkBuild();
  document.addEventListener("visibilitychange", checkBuild);
  setTimeout(() => navigator.serviceWorker?.getRegistrations?.()
    .then((all) => Promise.all(all.map((r) => r.unregister()))).catch(() => {}), 3000);
}
