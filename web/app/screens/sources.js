// Sources tab, after Cydia's (docs/cydia.md "Sources tab"): one row per source, sorted by name, with its
// CydiaIcon.png, name, URL and (iFizBox's own addition) how many packages it has for this device's architecture.
// Nav bar: Refresh (F150 reload bar, refetch every source) and Manage (F45, screens/manage.js: the edit list with Add, delete
// and reorder, Import & Export). A left swipe on a row shows Delete. Rows keep the order set there. The list lives on the
// device and comes through the backend (core/sources.js sourceCalls), so the app runs this file unchanged.
// Above the sources, Cydia's "All Sources" row, then More Sources (F327, screens/moresources.js: Recommended and the
// Find pages); the sources in Tweak Sources and App Sources (sourceGroups). A source (or All Sources) opens its
// Sections, and everything below that is screens/browse.js.
import { plain, collapse, note } from "../nav/ui.js";
import * as browse from "./browse.js";
import { showAlert } from "../nav/alert.js";
import { showMenu, longPress, copyText, nativeHasUrl } from "../nav/menu.js";
import { format } from "../router.js";
import { getBackend } from "../backend.js";
import { displayName, sourceIcons, sourceSubtitle, sourcesFor, sourceFilter, loadNeverLoaded } from "../core/sources.js";
import { tweakSourcesFor, tweakSourcesOn } from "../core/sources.js"; // F302
import { askTweakIndex, tweakSourceVerdict, shownTweakSources } from "../core/sources.js"; // F344a
import { detectMode } from "../core/settings.js"; // F302

// F302: the sideload app's group of APT sources (injectable tweaks only), under App Sources. F327: the list's groups
// are named by what they hold, Tweak Sources (APT repos) and App Sources (AltStore sources).
export const TWEAK_SOURCES = "Tweak Sources";
export const APP_SOURCES = "App Sources";
// Refresh's filter: in the sideload app the Tweak Sources are refreshed too.
const refreshFilter = () => sourceFilter(settings.deviceType(), { tweaks: tweakSourcesOn(settings.deviceType(), detectMode()) });
import { sourceIconImage } from "../source-icon.js";
import { settings } from "../settings-store.js";
import * as manage from "./manage.js";
import { orderSources, loadOrder, filterSources } from "../core/sourcelist.js";
import { healthOf } from "../core/health.js";
import { builtinFirst, isBuiltin } from "../core/essential.js";
import { lockMark } from "../nav/lock.js";
import { searchBar, pinned } from "../nav/searchbar.js";
import { pullToRefresh } from "../nav/pullrefresh.js";
import { reloadSteps } from "../core/reloadsteps.js";
import { showBanner } from "../nav/banner.js";
import { go as navGo } from "../nav/go.js";
import { failedBanner, FAILED_BANNER_MS } from "../core/aptupdate.js";
import { refreshRows, tabBadge, coalesce, ROW } from "../core/refreshrows.js";
import { labelSource, toggleTrust, trustMenuLabel } from "./safety.js"; // F291
import { labelCanister } from "./findmore.js"; // F305
import * as more from "./moresources.js"; // F327: #/sources/more, More Sources
import { pageViews } from "../nav/pageviews.js"; // C25
import { setSourceErrorHooks } from "./sourceerror.js"; // B177
import { nativeBridge } from "../native.js";
import { attachRowSwipe, fullSwipeEra } from "../nav/rowswipe.js"; // B356

export const title = "Sources";

// F233: while a refresh runs, every row shows where its source is (core/refreshrows.js): grey Waiting, the spinner,
// then its package count, or a red badge with the reason in red under its name. A tap on a failed row refreshes that
// source alone (retry). The reload bar (nav/reloadbar.js) says what is happening, the Sources tab's badge spins and
// then counts the failures, and the page can be left while it runs. No count strip over the list: Cydia has none.
// Each source's packages go to the catalog (Changes, Search) as soon as it has landed, not after the last one.

export const TWEAK_HIDDEN_KEY = "ifizbox.hiddenTweakSources"; // F344a: kept, so a hidden source never shows first

const state = {
  sources: null,   // the list as last loaded, sorted
  busy: false,     // a refresh is running
  tried: new Set(), // F43: keys first-loaded this session (core/sources.js loadNeverLoaded)
  loading: new Set(), // keys being refreshed right now: their rows spin, the Sources badge spins (Cydia)
  rows: null,       // F233: the last refresh's rows (core/refreshrows.js), kept after it ends for the failed ones
  running: false,   // F233: a refresh (or a row's retry) is under way
  tweakHidden: null, // F344a: keys of the sideload app's Tweak Sources with nothing for the user's apps (tweakJudge)
};
state.tweakHidden = loadTweakHidden();

// C25: the root page can be on screen twice, its own tab and pushed on Home (Home's Loading Sources / Sources Failed
// tile, Help's and the guides' Refresh Sources: router.js rootOn). Each copy has its own view; the list's data above is
// shared, and whatever reloads it draws every copy.
const views = pageViews(() => ({
  query: "",  // F19: the search box's text
  bar: null,  // F19: the search box, kept across redraws so typing keeps its focus
  box: null,  // F19: where the list goes, under the search box
}));
const drawAll = () => { for (const v of views.all()) draw(v); };

const byKey = (key) => state.sources?.find((s) => s.key === key);

// iOS keeps a button in :active after its Paste bubble took the touch, and no class can win over that in every theme:
// taking the button out and putting it back (listeners kept) drops it from WebKit's active chain.
function reset(button) {
  button.classList.remove("is-pressed");
  const parent = button.parentNode, next = button.nextSibling;
  if (!parent) return;
  button.remove();
  parent.insertBefore(button, next);
}

// Add opens the Enter APT URL alert inside the tap. Neither build reads the clipboard on its own: the alert's Paste
// button reads it when tapped (nav/alert.js), so there is no Paste bubble or Allow Paste on Add and no blue Type
// state. The app shows that Paste only when a URL was copied (addFromPasteboard, below).
// `native` and `open` are for tests (screens/addsource.test.js): the bridge, and addSourceNow.
export async function addFromClipboard(ctx, button, { native = nativeBridge(), open = addSourceNow } = {}) {
  if (native) return addFromPasteboard(ctx, button, native, open);
  reset(button);
  return open(ctx, null);
}

// B335: Sources' Add alert (manage.addSource) whose Paste adds the pasted URL at once, with no Add Source tap after it.
// Manage's Add, Edit Source and the other paste alerts keep Paste filling the field only. `alert` is for tests.
export const addSourceNow = (ctx, prefill = null, alert = undefined) =>
  manage.addSource(ctx, prefill, null, { pasteSubmits: true, ...(alert ? { alert } : {}) });

// The app (F105): no Paste bubble, so no Type. Enter APT URL opens inside the tap, the field "https://" with the
// keyboard up. Opened after a bridge round trip (as ffaf27e did) the alert came outside the tap: WKWebView raised no
// keyboard and the button kept its pressed look.
// B171: Add never reads the clipboard: a read of another app's copy shows iOS's Allow Paste and held the alert up.
// The bridge only says whether a URL was copied (clipboard.peek: hasURLs/detectPatterns, no prompt); the alert's
// Paste button fades in when one was, and the text is read only when the user taps it (nav/alert.js). No URL copied:
// no Paste offered (the field's own edit menu still pastes). A shell without clipboard.peek keeps Paste showing.
// Never navigator.clipboard here: after an await it would bring back WebKit's bubble without Type.
async function addFromPasteboard(ctx, button, native, open) {
  button.textContent = "Add";
  button.classList.remove("done");
  reset(button);
  const shown = open(ctx, null); // showAlert builds the alert before its first await
  const paste = [...(document.querySelectorAll(".alert-paste") ?? [])].pop();
  if (paste?.style) {
    paste.style.opacity = "0"; // its room stays kept, so nothing in the alert moves when it shows
    paste.style.pointerEvents = "none";
    paste.setAttribute?.("aria-hidden", "true");
  }
  const url = await nativeHasUrl(native);
  if (paste?.style && url !== false) {
    paste.style.transition = "opacity 0.2s";
    paste.style.opacity = "";
    paste.style.pointerEvents = "";
    paste.removeAttribute?.("aria-hidden");
  }
  return shown;
}

export function nav(route, ctx) {
  if (more.isMore(route)) return more.nav(route, ctx); // F327 (and the old manage/recommended)
  if (manage.isManage(route)) return manage.nav(route, ctx);
  if (route.path.length) {
    return browse.nav(route, (key) => { const s = byKey(key); return s ? displayName(s) : null; });
  }
  return {
    title: "Sources", style: "plain",
    // B176: pushed on Home (green tile, Help's Refresh Sources) Back takes the left: Refresh goes right, and Add
    // stays out of that copy's bar so the three fit (Manage has its own Add).
    left: { label: "Refresh", onClick: () => refresh(ctx), pushed: "right" },
    right: [
      // Add: the Enter APT URL alert at once; its Paste button fills it (in the app, offered only for a copied URL).
      { label: "Add", onClick: (e) => addFromClipboard(ctx, e.currentTarget), pushed: false },
      { label: "Manage", onClick: () => ctx.go({ tab: "sources", path: [manage.SEGMENT] }) },
    ],
  };
}

// Device (F37) changes which sources show: redraw the list if it is on screen.
settings.onChange((key) => { if (key === "device") drawAll(); });

// F45: an add, delete or reorder in Manage reloads the list, so it is right when the user goes back.
// B75: and a source just added starts loading at once, under the reload bar (`ctx` from Manage's Add paths), even
// when the Sources list was never drawn, so Search finds its packages without a visit here.
// B141: and a source that came in already read (Add's IPA record, the website's Open in App import) goes into the
// catalog at once (feedCatalog: ctx.loadData), so Search finds its apps without a Refresh.
manage.onSourcesChanged((ctx) => {
  if (views.all().length) load(ctx ?? state.ctx); else loadNew(ctx);
  feedCatalog(ctx ?? state.ctx);
});
// F355: Manage > Sources' grey line counts each source as its row here does (paintRow's badge and red badge).
manage.setSourceRowState((key) => {
  const r = state.rows?.get(key);
  return r ? { count: r.state === ROW.done ? r.count : null, failed: r.state === ROW.failed } : null;
});

// B177: what a failed source's page (screens/sourceerror.js) needs from here: its live reason, Refresh Source (the
// row's retry, then the catalog load so the page redraws from fresh data), Edit Source (Manage's Enter URL alert
// filled with its URL) and the list kept in step after a remove.
setSourceErrorHooks({
  reason: (key) => { const r = state.rows?.get(key); return r?.state === ROW.failed ? r.reason : null; },
  async refresh(key) {
    const ok = await retrySource(state.ctx, key);
    if (ok) await state.ctx?.loadData?.();
    return ok;
  },
  edit: (ctx, s) => manage.addSource(ctx ?? state.ctx, { url: s.uri, dist: s.dist && s.dist !== "./" ? s.dist : null,
    components: s.components }, { title: "Edit Source", button: "Save", replaces: s.key }),
  removed(ctx, key) {
    if (state.sources) state.sources = state.sources.filter((s) => s.key !== key);
    state.rows?.retry?.(key); // no stale failure count for a source that is gone...
    state.rows?.land?.({ key, count: null }); // ...it lands as done, out of the badge's count
    manage.sourcesChanged(ctx ?? state.ctx);
    (ctx ?? state.ctx)?.setBadge?.("sources", tabBadge(state.rows?.counts(), false));
  },
});

// B141: the app's ctx, for loads started where no screen hands one (the website's import at first launch): the
// reload bar, the badge and catalog loads. A screen's own ctx, once given, stays.
export function useContext(ctx) { state.ctx ??= ctx; }

export function render(el, route, ctx) {
  if (more.isMore(route)) {
    more.render(el, route, ctx); // F327
    return;
  }
  if (manage.isManage(route)) {
    manage.render(el, route, ctx);
    return;
  }
  if (route.path.length) {
    browse.render(el, route, ctx);
    return;
  }
  state.ctx = ctx; // F233: a failed row's retry, from the list's click handler
  draw(views.open(el));
  load(ctx);
}

async function load(ctx) {
  if (ctx) state.ctx = ctx;
  try {
    state.sources = await getBackend().sources();
  } catch (e) {
    state.sources = [];
    state.loadError = e.message;
  }
  drawAll();
  if (!state.loadError) firstLoad(ctx);
}

// F43: sources seeded by default (F28) hold only their URL until something reads them: refresh those once, with
// the reload bar, so a first visit shows names, icons and counts without a tap.
// B75: `fresh` reads the list first (a source just added, Search), inside the busy section so two callers never
// start two runs; a call while another run is busy marks `again` and gets that run's promise (null for a Refresh).
// Resolves to the refreshed records, or null when nothing needed loading.
function firstLoad(ctx, { fresh = false, backend = getBackend(), retry = null } = {}) {
  if (state.busy) { state.again = true; if (retry) state.againRetry = retry; return state.current ?? Promise.resolve(null); }
  state.busy = true;
  let run = null;
  const job = (async () => {
    let done = null;
    try {
      if (fresh) state.sources = await backend.sources();
      // F150: the reload bar instead of a HUD, so the list stays usable while the new sources load.
      done = await loadNeverLoaded(backend, state.sources, settings.deviceType(), {
        tried: state.tried,
        retry, // B141: Search's per-visit second try of failed sources
        // the bar ends in the finally below; begin hands back a no-op `end` (B75: none made end() throw, so the
        // list was never read again after a first load)
        begin: (keys) => { run = startRun(ctx, [...(keys ?? [])]); return () => {}; },
        onEach: (d) => run?.onEach(d),
        onRow: (k, st, why) => run?.onRow(k, st, why),
      });
      if (done && !run?.cancelled) {
        state.sources = await backend.sources();
        drawAll();
      }
    } catch {
      // a failed first load leaves the rows as they were; Refresh shows the error
    } finally {
      if (run && !run.cancelled) { clearLoading(ctx); run.end(); }
      state.busy = false;
      state.current = null;
      runAgain(ctx, run?.cancelled);
      settle();
    }
    return done;
  })();
  state.current = job;
  return job;
}

// ---- B75: sources just added load at once, wherever the user is ----------------------------------------------

// Sources the device has never loaded (one just added by Add, Add All, Import, or Search's Recommended Add) start
// loading now: firstLoad's one run under the reload bar, with the words, rows, badge and Cancel of Refresh, whichever
// tab is open. Search calls it on opening and as a query is typed; Manage's adds through onSourcesChanged. Each
// source is tried once per session (state.tried, shared by every caller). `backend` is for the tests.
// B141: `retry` (a Set Search keeps per visit, core/sources.js loadNeverLoaded) also loads failed or empty sources
// once more.
export function loadNew(ctx = state.ctx, { backend, retry } = {}) {
  if (ctx) state.ctx = ctx;
  return firstLoad(ctx ?? state.ctx, { fresh: true, ...(backend ? { backend } : {}), ...(retry ? { retry } : {}) });
}

// B141: a run (Refresh at launch, a first load, a row's retry) is under way: Search says sources are still loading
// instead of No Results. onSettled(f) is told each time one ends with no other started; returns unsubscribe.
export const isLoading = () => state.busy;
const settledListeners = new Set();
export function onSettled(f) { settledListeners.add(f); return () => settledListeners.delete(f); }
function settle() {
  if (state.busy) return;
  for (const f of [...settledListeners]) { try { f(); } catch { /* one listener's error stops no other */ } }
}

// Called with no arguments each time a landed source's packages are in the catalog (after ctx.loadData), for a
// Refresh, a retry or loadNew alike: Search runs its query again. Returns unsubscribe.
const landedListeners = new Set();
export function onLanded(f) { landedListeners.add(f); return () => landedListeners.delete(f); }
function fireLanded() {
  for (const f of [...landedListeners]) { try { f(); } catch { /* one listener's error stops no other */ } }
}

// A loadNew asked for while another run held the busy flag (a source added during a Refresh): run it once that ends,
// unless that run was cancelled (Cancel means stop, not start the next bar).
function runAgain(ctx, cancelled = false) {
  if (!state.again) return;
  state.again = false;
  const retry = state.againRetry;
  state.againRetry = null;
  if (cancelled) return;
  loadNew(ctx ?? state.ctx, retry ? { retry } : {});
}

// Loading marks: the rows of `keys` spin and the Sources tab's badge spins until each answers (onEach), as
// Cydia does. Returns onEach for refreshSources.
// globalThis.ifizboxRefreshing: how many sources are refreshing now, for Home's tile (with the ifizbox:refreshing event).
function announce() {
  globalThis.ifizboxRefreshing = state.loading.size;
  globalThis.dispatchEvent?.(new Event("ifizbox:refreshing"));
}
function markLoading(ctx, keys) {
  for (const k of keys) state.loading.add(k);
  state.rows = refreshRows(keys);
  state.running = true;
  announce();
  ctx?.setBadge?.("sources", state.loading.size ? "spinner" : null);
  paintAll();
  return (done) => {
    state.loading.delete(done?.key);
    const i = state.sources?.findIndex((s) => s.key === done?.key) ?? -1;
    if (i >= 0) state.sources[i] = done;
    state.rows?.land(done);
    paintKey(done?.key);
    feedCatalog(ctx);
    // every source has answered: the badge stops spinning and counts the failures (the catalog load may go on)
    if (!state.loading.size) { ctx?.setBadge?.("sources", tabBadge(state.rows?.counts(), false)); announce(); }
  };
}
function clearLoading(ctx) {
  state.loading.clear();
  announce();
  state.rows?.finish();
  state.running = false;
  ctx?.setBadge?.("sources", tabBadge(state.rows?.counts(), false));
  paintAll();
}

// F233: apt's live lines (backend-native) and the pools (core/sources.js, core/altstore.js) say when a source starts,
// and apt when one fails, before its record lands.
function rowEvent(key, rowState, reason) {
  if (!state.rows?.has(key)) return;
  if (rowState === ROW.failed) state.rows.fail(key, reason);
  else state.rows.set(key, rowState);
  paintKey(key);
}

// F233: a landed source's packages into the catalog at once (ctx.loadData: catalog.ensure, which reads only the
// sources whose refresh time changed), one load at a time however fast they land.
let feeding = null;
function feedCatalog(ctx) {
  if (!ctx?.loadData) return;
  // B75: onLanded's listeners hang off the same promise, so the load's own timing is as it was
  feeding ??= coalesce(() => {
    const p = ctx.loadData();
    Promise.resolve(p).then(fireLanded, () => {});
    return p;
  });
  feeding();
}

// ---- F233: the rows' states and the retry --------------------------------------------------------------------

// The source's row in every copy of the page (C25).
const rowsOf = (key) => views.all().flatMap((v) => [...(v.body.querySelectorAll?.(
  `.source-row[data-key="${CSS.escape(String(key))}"]`) ?? [])]);
function paintKey(key) { if (key != null) for (const li of rowsOf(key)) paintRow(li); }
function paintAll() { for (const li of document.querySelectorAll(".source-row")) paintRow(li); }

// One row as its refresh state says. Rows outside a refresh (state.rows null, or a key it doesn't hold) keep what
// draw() gave them: the stored count, and "Not Responding" for a source whose last refresh failed.
function paintRow(li) {
  const r = state.rows?.get(li.dataset.key) ?? null;
  const st = r?.state ?? null;
  li.classList.toggle("is-waiting", st === ROW.waiting);
  li.classList.toggle("is-loading", st === ROW.loading);
  li.classList.toggle("is-failed", st === ROW.failed);
  const inner = li.querySelector(".cell-inner");
  if (!inner) return;
  const text = inner.querySelector(".cell-text");
  let count = inner.querySelector(".cell-count");
  let waiting = inner.querySelector(".row-waiting");
  if (st === ROW.waiting && !waiting) {
    waiting = Object.assign(document.createElement("span"), { className: "row-waiting", textContent: "Waiting" });
    text?.after(waiting);
  } else if (st !== ROW.waiting) waiting?.remove();
  if ((st === ROW.done && r.count != null) || st === ROW.failed) {
    if (!count) { count = Object.assign(document.createElement("span"), { className: "cell-count" }); inner.append(count); }
    count.classList.toggle("row-failed-badge", st === ROW.failed);
    count.textContent = st === ROW.failed ? "!" : r.count.toLocaleString();
  } else count?.classList.remove("row-failed-badge");
  const sub = inner.querySelector(".cell-subtitle");
  if (sub) {
    sub.dataset.plain ??= sub.textContent;
    const was = sub.dataset.error === "1";
    if (st === ROW.failed) {
      if (!was) sub.dataset.wasError = sub.classList.contains("cell-error") ? "1" : "";
      sub.textContent = r.reason || "Failed";
      sub.classList.add("cell-error");
      sub.dataset.error = "1";
    } else if (was) {
      sub.textContent = sub.dataset.plain;
      delete sub.dataset.error;
      // landed fine this time: no red; no refresh state any more (cancelled): as draw() had it
      sub.classList.toggle("cell-error", !st && sub.dataset.wasError === "1");
    }
  }
  li.setAttribute("aria-busy", String(st === ROW.waiting || st === ROW.loading));
  if (st === ROW.failed) inner.setAttribute("aria-description", "Failed to refresh: tap for the error and what to do");
  else inner.removeAttribute("aria-description");
}

// F233: a tap on a failed row: that source alone refreshes (the app runs apt-get update for its list only, through
// refreshSources' `retry`), its row spinning; afterwards the badge counts the failures again.
// B177: also from a source's page (Refresh Source), where no run this session may have rows: one is started for it.
export async function retrySource(ctx, key) {
  if (state.busy || key == null) return false;
  state.rows ??= refreshRows([]);
  state.busy = true;
  state.running = true;
  state.rows.retry(key);
  state.loading.add(key);
  announce();
  ctx?.setBadge?.("sources", "spinner");
  paintKey(key);
  let landed = false;
  try {
    await getBackend().refreshSources((d) => {
      if (d?.key !== key) return;
      landed = true;
      const i = state.sources?.findIndex((s) => s.key === key) ?? -1;
      if (i >= 0) state.sources[i] = d;
      state.rows?.land(d);
      feedCatalog(ctx);
    }, { filter: (s) => s?.key === key, retry: true, onRow: (k, st, why) => { if (k === key) rowEvent(k, st, why); } });
    if (!landed) state.rows?.fail(key, "No answer");
  } catch (e) {
    state.rows?.fail(key, e?.message || String(e));
  } finally {
    state.loading.delete(key);
    state.running = false;
    state.busy = false;
    runAgain(ctx); // B75
    settle();
    state.rows?.finish();
    announce();
    ctx?.setBadge?.("sources", tabBadge(state.rows?.counts(), false));
    paintKey(key);
  }
  return true;
}

// At launch (app.js, Settings > Refresh on Launch): every source the device type shows, behind whatever page is
// open, with the Sources tab's red spinning badge and the rows spinning if Sources is on screen. The reload bar (F150) says what is happening.
// F150: with the reload bar, whose Cancel stops it: resolves to "cancelled" then (Home's Reload stops there too).
export async function refreshInBackground(ctx) {
  if (state.busy) return;
  state.busy = true;
  let run = null;
  try {
    state.sources = await getBackend().sources();
    const filter = refreshFilter(); // F302: Tweak Sources too, in the sideload app
    run = startRun(ctx, state.sources.filter(filter ?? (() => true)).map((x) => x.key));
    const job = getBackend().refreshSources(run.onEach, { filter, signal: run.signal, onRow: run.onRow });
    if (await run.until(job)) return "cancelled";
    bannerFailed(await job);
    state.sources = await getBackend().sources();
    drawAll();
    if (await run.until(run.data())) return "cancelled";
  } catch {
    // a failed refresh shows per source (its row) once it has failed
  } finally {
    if (!run?.cancelled) { clearLoading(ctx); run?.end(); }
    state.busy = false;
    runAgain(ctx, run?.cancelled); // B75
    settle();
  }
}

// B23: the sources apt-get update failed on (refreshSources' `failed`, the jailbreak app) in a banner that goes by
// itself and opens Sources when tapped, never an alert: their rows are marked (Not Responding) for Edit to remove.
export function bannerFailed(rows, { banner = showBanner, go = navGo } = {}) {
  const words = failedBanner(rows?.failed);
  if (!words) return false;
  banner({ ...words, duration: FAILED_BANNER_MS, onTap: () => go(format({ tab: "sources", path: [] })) });
  return true;
}

// ---- F150: one refresh under the reload bar -----------------------------------------------------------------

// Marks `keys` loading (rows and badge, markLoading) and drops the reload bar (ctx.reloadBar, nav/reloadbar.js;
// none where ctx has no reloadBar, as in the tests that don't ask for it), its words following the refresh
// (core/reloadsteps.js). The bar's Cancel ends the run at once: the marks go, the bar goes, `until` resolves true,
// `signal` aborts (the backend starts no more sources) and the answers still on their way change nothing.
//   onEach(record)  until(promise) -> true when cancelled first   data()  end()   cancelled   signal
export function startRun(ctx, keys) {
  const ac = typeof AbortController === "function" ? new AbortController() : { signal: { aborted: false }, abort() { this.signal.aborted = true; } };
  const each = markLoading(ctx, keys);
  const byKey = new Map((state.sources ?? []).map((s) => [s.key, s]));
  let bar = null;
  let stop = () => {};
  const stopped = new Promise((resolve) => { stop = resolve; });
  const run = {
    signal: ac.signal,
    get cancelled() { return ac.signal.aborted; },
    onEach(d) { if (ac.signal.aborted) return; each(d); steps.each(d); },
    // F233: a source started (or, from apt's live lines, failed) before its record lands.
    onRow(key, rowState, reason) { if (!ac.signal.aborted) rowEvent(key, rowState, reason); },
    until: (p) => Promise.race([Promise.resolve(p).then(() => false), stopped.then(() => true)]),
    // Cydia's last steps: the package lists into the catalog ("Loading Data"), then what is worked out from
    // them ("Building Searcher Cache"): ctx.loadData and ctx.buildCache (app.js), skipped where ctx has none.
    async data() {
      if (ac.signal.aborted) return;
      steps.load();
      await ctx?.loadData?.();
      if (ac.signal.aborted) return;
      steps.cache();
      await ctx?.buildCache?.();
    },
    end() { bar?.hide(); },
  };
  const cancel = () => {
    if (ac.signal.aborted) return;
    ac.abort();
    state.rows = null; // F233: cancelled: no rows or failure count from a run that didn't finish
    clearLoading(ctx);
    bar?.hide();
    stop();
  };
  const steps = reloadSteps(keys.map((k) => byKey.get(k) ?? { key: k }), {
    apt: Boolean(nativeBridge()) && settings.deviceType() !== "none",
    name: (s) => (s?.uri || s?.name ? displayName(s) : ""),
    onText: (t) => bar?.set(t),
  });
  bar = ctx?.reloadBar?.(steps.text(), { onCancel: cancel }) ?? null;
  return run;
}


// ---- the list --------------------------------------------------------------------------------------------

// F19: the search box above the list, the iOS 6 grey search bar Search uses (packages.css .search-bar). It filters
// the rows as you type (core/sourcelist.js filterSources); All Sources steps aside while a search is on.
// C10: the shared bar (nav/searchbar.js), with Cancel.
function sourcesSearchBar(view) {
  if (view.bar) return view.bar;
  return (view.bar = searchBar({ placeholder: "Search Sources", ariaLabel: "Search sources: name or URL", value: view.query,
    className: "sources-search", onQuery: (q) => { if (q !== view.query) { view.query = q; draw(view); } } }));
}

// F327: More Sources (screens/moresources.js) under All Sources, its badge the recommended sources not added yet.
const moreSourcesRow = () => more.moreRow();

function draw(view) {
  const el = view?.body;
  if (!el) return;
  if (!state.sources) { el.classList.remove("search-root"); el.replaceChildren(); return; }
  if (state.loadError) {
    el.classList.remove("search-root");
    el.replaceChildren(note(state.loadError));
    return;
  }
  const bar = sourcesSearchBar(view);
  // C10: the bar stays put; the list scrolls under it (nav/searchbar.js pinned).
  const results = view.box?.parentNode;
  if (!view.box || results?.parentNode !== el || bar.parentNode !== el) {
    view.box = document.createElement("div");
    el.replaceChildren();
    pinned(el, bar).append(view.box);
  }
  // F270: pull the list down past its top: Refresh, as the nav button.
  pullToRefresh(view.box.parentNode, { onRefresh: () => refresh(state.ctx), busy: () => state.busy || state.running, settings });
  const box = view.box;
  const backend = getBackend();
  // F37: Not Jailbroken shows AltStore sources only. F144: and says nothing of APT ones (no count, no hint).
  // F45: in the order set in Manage > Sources (none set: by name).
  // F72: iFizBox's own source (built in) stays first whatever the order.
  const ordered = builtinFirst(orderSources(state.sources, loadOrder()));
  const { shown } = sourcesFor(ordered, settings.deviceType());
  const searching = Boolean(view.query.trim());
  const list = filterSources(shown, view.query, displayName);
  // F302: the sideload app's APT sources, in their own group under the AltStore ones, counting injectable tweaks.
  // F344a: minus the ones the Tweak Index found nothing in for the user's apps (searching finds those too).
  const tweakAll = tweakSourcesFor(ordered, settings.deviceType(), detectMode());
  const tweakShown = searching ? tweakAll : shownTweakSources(tweakAll, state.tweakHidden);
  const tweakList = filterSources(tweakShown, view.query, displayName);
  if (tweakAll.length) judgeTweakSources(tweakAll);
  const top = searching ? [] : [{
    label: "All Sources",
    subtitle: "combined package list for the sources below",
    href: format({ tab: "sources", path: ["*"] }),
  }, moreSourcesRow()];
  const sourceRow = (s) => {
    const health = healthOf(s);
    return {
      label: displayName(s),
      // F44: github.com/<user>/<repo> for GitHub-hosted sources. F19: a source whose last refresh failed says so.
      subtitle: health.state === "down" ? `Not Responding · ${sourceSubtitle(s)}` : sourceSubtitle(s),
      icon: { text: displayName(s)[0]?.toUpperCase() ?? "?" },
      badge: typeof s.count === "number" ? s.count.toLocaleString() : undefined,
      href: format({ tab: "sources", path: [s.key] }),
    };
  };
  // F327: the groups by what they hold (sourceGroups): jailbroken, Tweak Sources then App Sources; the sideload app,
  // App Sources then its Tweak Sources (F302); a group with nothing in it (searching: nothing to search) is left out.
  const groups = sourceGroups({ shown, list, tweakShown, tweakList, searching, sideload: tweakSourcesOn(settings.deviceType(), detectMode()) });
  const ul = plain([...(top.length ? [{ rows: top }] : []), ...groups.map((g) => ({ header: g.header, rows: g.list.map(sourceRow) }))]);
  ul.classList.add("sources-list"); // B253: packages.css lines every row's icon up on the source rows' 29pt column
  const cells = ul.querySelectorAll(":scope > .cell");
  if (top.length) {
    cells[0].classList.add("all-sources-row");
    cells[0].querySelector(".cell-inner").prepend(Object.assign(document.createElement("span"), { className: "folder" }));
    moreBadge(cells[1]);
  }
  let at = top.length;
  for (const g of groups) {
    g.list.forEach((s, i) => {
      const li = cells[at + i];
      decorate(li, s, backend);
      if (g.tweak) li.classList.add("tweak-source-row");
    });
    at += g.list.length;
  }
  attachRowGestures(ul);
  attachDeleteSwipe(ul); // B356
  box.replaceChildren(ul);
  if (!list.length && !tweakList.length) {
    box.append(note(searching ? "No sources match." : "No sources. Tap Manage, then Sources."));
  }
}

// ---- F344a: Tweak Sources with nothing for the user's apps leave the list -------------------------------------
//
// In the sideload app a Tweak Source the Tweak Index has fully checked, with no tweak that works in one of the user's
// apps (My IPAs and the apps it signed, screens/tweaks.js signableApps) or in any app, is left out of the Tweak
// Sources group (core/sources.js tweakSourceVerdict). Searching still finds it, and Manage still lists it (delete,
// reorder). Unknown (no index, still being read, GitHub sources) shows it. A row that goes collapses (nav/ui.js), its
// header with it when it was the group's last; one that comes back redraws the list. The index is asked once per ten
// minutes a source, the user's apps re-read every 15 s at most; the hidden keys are kept on the device so the next launch draws without them.
//   tweakJudge.enabled   false under node (tests switch it on with their own ask/apps), so tests never fetch
export const tweakJudge = {
  enabled: typeof globalThis.process?.versions?.node !== "string",
  ask: (s) => import("./tweaks.js").then((m) => askTweakIndex(s, { base: m.indexBase() })),
  apps: async () => (await (await import("./tweaks.js")).signableApps()).map((a) => a.bundleId),
  every: 10 * 60 * 1000, // an index answer is kept this long
  again: 15 * 1000,      // the user's apps are read again after this long
};
const judged = { at: 0, keys: "", p: null, answers: new Map() }; // answers: key -> { at, a }, the index's, `every` ms

function loadTweakHidden(storage = globalThis.localStorage) {
  try {
    const v = JSON.parse(storage?.getItem(TWEAK_HIDDEN_KEY) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((k) => typeof k === "string") : []);
  } catch { return new Set(); }
}
function saveTweakHidden(set, storage = globalThis.localStorage) {
  try { storage?.setItem(TWEAK_HIDDEN_KEY, JSON.stringify([...set])); } catch { /* not kept: judged again next launch */ }
}

// -> the judging promise (null when nothing was started: off, under way, or judged lately for these sources).
// The user's apps are read again on a draw `again` ms after the last judging (an app just signed brings its
// sources back); each source's index answer is kept `every` ms.
export function judgeTweakSources(list, { now = Date.now() } = {}) {
  if (!tweakJudge.enabled || judged.p) return null;
  const keys = list.map((s) => s.key).join("\n");
  if (keys === judged.keys && now - judged.at < tweakJudge.again) return null;
  Object.assign(judged, { at: now, keys });
  const answerOf = async (s) => {
    const had = judged.answers.get(s.key);
    if (had && now - had.at < tweakJudge.every) return had.a;
    const a = await tweakJudge.ask(s).catch(() => null);
    if (a) judged.answers.set(s.key, { at: now, a }); // nothing: asked again next time
    return a;
  };
  judged.p = (async () => {
    const ids = await tweakJudge.apps().catch(() => []);
    const verdicts = await Promise.all(list.map(async (s) => [s.key, tweakSourceVerdict(await answerOf(s), ids)]));
    const had = state.tweakHidden ?? new Set();
    const next = new Set();
    // null (not known this time): what was known before stands, so a slow answer doesn't bring a row back for a moment
    for (const [k, v] of verdicts) if (v === false || (v === null && had.has(k))) next.add(k);
    applyTweakHidden(next);
    return next;
  })().finally(() => { judged.p = null; });
  return judged.p;
}

export function applyTweakHidden(next) {
  const had = state.tweakHidden ?? new Set();
  state.tweakHidden = next;
  saveTweakHidden(next);
  if ([...had].some((k) => !next.has(k))) { drawAll(); return; }
  const gone = [...next].filter((k) => !had.has(k));
  if (!gone.length) return;
  for (const v of views.all()) {
    if (v.query.trim() || !v.body) continue; // searching lists them all
    const rows = [...v.body.querySelectorAll(".tweak-source-row")];
    const going = rows.filter((li) => gone.includes(li.dataset.key));
    if (!going.length) continue;
    if (going.length === rows.length) {
      // the group's last rows: its header goes too
      let h = rows[0].previousElementSibling;
      while (h && !h.classList.contains("section-header")) h = h.previousElementSibling;
      if (h) collapse(h);
    }
    for (const li of going) collapse(li);
  }
}

// F327: the list's groups, named by what they hold (never "AltStore"):
//   shown/list          the sources this device type shows, and those the search keeps (jailbroken: APT and AltStore
//                       mixed, split here; Not Jailbroken: AltStore only)
//   tweakShown/tweakList  the sideload app's Tweak Sources (F302), and those the search keeps
// -> [{ header, list, tweak }], tweak: the sideload app's APT group (its rows get .tweak-source-row). The jailbroken
// list leads with Tweak Sources, the sideload app with App Sources (as before). Searching, each header counts:
// "Tweak Sources: 2 of 5".
export function sourceGroups({ shown = [], list = [], tweakShown = [], tweakList = [], searching = false, sideload = false } = {}) {
  const isApt = (s) => !String(s?.key ?? "").startsWith("alt:");
  const kinds = [
    { header: TWEAK_SOURCES, all: shown.filter(isApt), list: list.filter(isApt), tweak: false },
    { header: APP_SOURCES, all: shown.filter((s) => !isApt(s)), list: list.filter((s) => !isApt(s)), tweak: false },
  ];
  if (sideload) kinds.push({ header: TWEAK_SOURCES, all: tweakShown, list: tweakList, tweak: true });
  const order = sideload ? [kinds[1], kinds[2], kinds[0]] : kinds;
  return order.filter((g) => g.all.length)
    .map((g) => ({ header: searching ? `${g.header}: ${g.list.length} of ${g.all.length}` : g.header, list: g.list, tweak: g.tweak }));
}

// The More Sources row's badge: the recommended sources not added yet, once that is known.
function moreBadge(li) {
  const inner = li?.querySelector(".cell-inner");
  if (!inner) return;
  more.notAddedCount().then((n) => {
    if (n && !inner.querySelector(".cell-count")) inner.append(Object.assign(document.createElement("span"), { className: "cell-count", textContent: String(n) }));
  }).catch(() => {});
}

function decorate(li, source, backend) {
  li.classList.add("source-row");
  li.dataset.key = source.key;
  const loading = state.loading.has(source.key);
  // a source shows as failed only once a load has actually failed, not while one is under way
  if (source.error && !loading) li.querySelector(".cell-subtitle")?.classList.add("cell-error");
  // F16a: a source only its own app can read (an encrypted GBox one) says so under its name; its page says why.
  if (source.unsupported && !source.error) li.querySelector(".cell-subtitle")?.classList.add("cell-error");
  paintRow(li); // F233: Waiting / spinner / count / red badge, while and after a refresh
  // CydiaIcon.png loads behind the letter and replaces it once it's there (Cydia: unknown.png, then the icon).
  // Cydia's <base>CydiaIcon.png first, then the repo's top level for dist repos (sourceIconUrls).
  // An AltStore source (F9) names its icon in its JSON. A GitHub-hosted source without one gets its owner's
  // avatar (F44, core/sources.js sourceIcons). B58: in the app, from the device's icon cache (source-icon.js).
  li.querySelector(".cell-icon").append(sourceIconImage(source.key, sourceIcons(source), backend));
  li.dataset.url = source.uri; // Copy URL (hold the row)
  labelSource(li, source); // F291: Known Safe / Trusted / Unknown under its name
  labelCanister(li, source); // F305: an Unknown APT repo Canister ranks Tier 1 (or a bootstrap one): Known Safe · Canister
  // F72: iFizBox's own source is built in: a lock after its name, and no Delete (a swipe arms nothing).
  if (isBuiltin(source)) {
    li.dataset.builtin = "1";
    li.querySelector(".cell-label")?.append(lockMark("name-lock"));
    return;
  }

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "del-toggle";
  toggle.setAttribute("aria-label", "Delete " + displayName(source));
  toggle.addEventListener("click", () => arm(li, !li.classList.contains("armed")));
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "del-confirm";
  confirm.textContent = "Delete";
  confirm.addEventListener("click", () => remove(li, source));
  li.append(toggle, confirm);
  li.dataset.url = source.uri; // Copy URL (hold the row)
}

function arm(li, on) {
  if (li.dataset.builtin) return; // F72: built in, nothing to delete
  for (const other of li.parentNode.querySelectorAll(".source-row.armed")) if (other !== li) other.classList.remove("armed");
  li.classList.toggle("armed", on);
}

// While a row shows Delete, a tap on a row doesn't open it: it only puts the Delete away.
// A left swipe on a row shows its Delete; a right swipe hides it.
function attachRowGestures(ul) {
  // Hold a source: iOS 6's black menu with Copy URL.
  longPress(ul, ".source-row", (li, e) => {
    if (state.editing || li.classList.contains("armed") || !li.dataset.url) return;
    // B177: a failed row's tap opens its page; the menu keeps the quick way to try it again
    const open = li.classList.contains("is-failed")
      ? [{ label: "Refresh", onClick: () => { if (!state.busy) retrySource(state.ctx, li.dataset.key); } }] : [];
    // F291: Trust Source / Stop Trusting for a source not on the known-safe list
    const src = byKey(li.dataset.key);
    const trust = src && li.dataset.trust !== "safe"
      ? [{ label: trustMenuLabel(src), onClick: () => { toggleTrust(src); drawAll(); } }] : [];
    showMenu(li, [...open, { label: "Copy URL", onClick: () => copyText(li.dataset.url) }, ...trust], { x: e.clientX });
  });
  let start = null;   // the pointer that may become a swipe
  let swiped = false; // the click that ends a swipe opens nothing
  ul.addEventListener("click", (e) => {
    // B315: a swipe that starts on the minus ends in its click, which would undo the swipe's arm
    if (swiped && e.target.closest(".del-toggle")) { swiped = false; e.preventDefault(); e.stopPropagation(); return; }
    if (e.target.closest(".del-toggle, .del-confirm")) return;
    const armed = ul.querySelector(".source-row.armed");
    // B177: a row whose refresh failed opens its page like any other (the error and Refresh Source are there,
    // screens/sourceerror.js); F233's tap-to-retry did nothing visible when it failed again.
    if (!armed && !swiped) return;
    e.preventDefault();
    e.stopPropagation();
    if (armed && !swiped) armed.classList.remove("armed");
    swiped = false;
  }, true);

  ul.addEventListener("pointerdown", (e) => {
    const li = e.target.closest(".source-row");
    swiped = false;
    start = li && !e.target.closest(".del-confirm") && !fullSwipeEra()
      ? { li, x: e.clientX, y: e.clientY } : null; // B356: iOS 7 and later swipe the row off instead (attachDeleteSwipe)
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

// B356: under iOS 7, 13 and 26 (fullSwipeEra) a source's Delete is a full-row swipe, as Installed's apps list
// (B332): drag the row off its left edge and the source goes, red behind it; a failed removal brings the row back.
// iOS 6 keeps the swipe that shows the red Delete (attachRowGestures). The built-in source has no Delete.
function attachDeleteSwipe(ul) {
  return attachRowSwipe(ul, {
    rowSelector: ".source-row",
    canStart: (li) => fullSwipeEra() && !state.editing && !li.dataset.builtin && !li.classList.contains("armed")
      && !ul.querySelector(".source-row.armed"),
    prepare: (li) => { const source = byKey(li.dataset.key); return source && !isBuiltin(source) ? { source } : null; },
    kindOf: () => "remove",
    full: () => true,
    commit: (li, a) => remove(li, a.source),
  });
}

// -> false when the source stays (the backend refused it; the alert says why).
async function remove(li, source) {
  li.classList.add("removing");
  try {
    await getBackend().removeSource(source.key);
  } catch (e) {
    li.classList.remove("removing");
    await showAlert({ title: "Error", message: e.message, buttons: ["OK"] });
    return false;
  }
  state.sources = state.sources.filter((s) => s.key !== source.key);
  setTimeout(() => {
    if (!state.sources.length) { li.remove(); drawAll(); return; }
    collapse(li);
    for (const v of views.all()) if (!v.body.contains?.(li)) draw(v); // C25: the other copy of the page
  }, 200);
  return true;
}


// ---- Refresh and Add -------------------------------------------------------------------------------------

// F150: under the reload bar (startRun), not a HUD: nothing is blocked while it runs, and its Cancel stops it.
async function refresh(ctx) {
  if (state.busy) return;
  state.busy = true;
  let run = null;
  try {
    const filter = refreshFilter(); // F302: Tweak Sources too, in the sideload app
    run = startRun(ctx, (state.sources ?? []).filter(filter ?? (() => true)).map((x) => x.key));
    const job = getBackend().refreshSources(run.onEach, { filter, signal: run.signal, onRow: run.onRow });
    if (await run.until(job)) return; // F41: only what's shown
    bannerFailed(await job);
    state.sources = await getBackend().sources();
    drawAll();
    await run.until(run.data());
  } catch (e) {
    if (run?.cancelled) return;
    run?.end();
    await showAlert({ title: "Error", message: e.message, buttons: ["OK"] });
  } finally {
    if (!run?.cancelled) { clearLoading(ctx); run?.end(); }
    state.busy = false;
    runAgain(ctx, run?.cancelled); // B75
    settle();
  }
}
