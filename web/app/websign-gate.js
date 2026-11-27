// F96: the website pushes iFizBox first (user 2026-11-18: "we push users toward installing ifizbox FIRST when the
// webpage is launched. all others should be disabled until they accept a delayed warning that the experience on web
// will not be good"). Website only: the app never asks.
//
//   First visit (until iFizBox is installed from the website, or Not Now): "Install iFizBox First" at launch
//   (promptFirstVisit, from screens/home.js init), Install iFizBox running Home's Install iFizBox App flow.
//   Other apps' pages: installRows (screens/altstore.js) gives "Install in iFizBox" (ifizbox://package?id=…, which the
//   app's incoming.js opens at that app's page), Download IPA, then "Install on the Website", greyed out until the
//   user accepts the warning once (acceptWebsiteInstalls: its I Understand counts down 5 seconds first). iFizBox's own
//   IPA always installs from the website. Settings > General > Website's switch turns website installs back off.
//
// State is in localStorage, per browser; every function takes `storage` for tests.
// SPDX-License-Identifier: GPL-3.0-or-later
import { showAlert } from "./nav/alert.js";
import { NAME } from "./brand.js";
import { KEYS } from "./core/storagekeys.js";

export const ACCEPT_KEY = KEYS.websiteInstalls; // "on" once the warning was accepted
export const FIRST_KEY = KEYS.firstVisit; //"later" (Not Now) | "installed" (iFizBox installed from here)

const store = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const read = (storage, key) => { try { return storage?.getItem(key) ?? null; } catch { return null; } };
const write = (storage, key, v) => {
  try { if (v == null) storage?.removeItem(key); else storage?.setItem(key, v); } catch { /* private mode: this page only */ }
};

// ---- Install on the Website ------------------------------------------------------------------------------------

export function websiteInstallsOn(storage = store()) { return read(storage, ACCEPT_KEY) === "on"; }
export function setWebsiteInstalls(on, storage = store()) { write(storage, ACCEPT_KEY, on ? "on" : null); }

export const WARNING_SECONDS = 5;
export const WARNING = {
  title: "Install on the Website?",
  message: "Installing here is slow: Safari downloads the app, signs it with your certificate, uploads it to this "
    + "site, and then iOS downloads it again. Big apps or a weak connection can make it fail, and the signed apps use "
    + `this site's limited storage.\n\nInstall in ${NAME} signs on the iPhone, so your apps never leave it: much `
    + "faster. (Our server only sends iOS the install prompt.)",
  buttons: ["Cancel", "I Understand"],
  cancel: 0,
};

// The warning, once: true when website installs are on (already, or the user just accepted).
export async function acceptWebsiteInstalls({ alert = showAlert, storage = store() } = {}) {
  if (websiteInstallsOn(storage)) return true;
  const { index } = await alert({ ...WARNING, countdown: { button: 1, seconds: WARNING_SECONDS } });
  if (index !== 1) return false;
  setWebsiteInstalls(true, storage);
  return true;
}

// ---- Install in iFizBox -----------------------------------------------------------------------------------------

export const packageLink = (id) => `ifizbox://package?id=${encodeURIComponent(String(id))}`;

// ifizbox://package?id=<id> -> the id, or null.
export function packageIdOf(link) {
  let id = null;
  try { id = new URL(String(link)).searchParams.get("id"); } catch { return null; }
  id = (id ?? "").trim();
  return id && id.length <= 300 && !/[/\s]/.test(id) ? id : null;
}

// The app's id from the page's hash when the caller doesn't know it: browse.js's package:<id> or versions:<id>.
export function idFromHash(hash = globalThis.location?.hash ?? "") {
  const parts = String(hash).replace(/^#\/?/, "").split("/").map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  for (let i = parts.length - 1; i >= 0; i--) {
    const m = /^(?:package|versions):(.+)$/.exec(parts[i]);
    if (m) return m[1];
  }
  return null;
}

const IN_IFIZBOX_SUBTITLE = "Signed and installed on the iPhone: faster";
export const WEBSITE_ON_SUBTITLE = "Signed in the browser with your certificate";
export const WEBSITE_OFF_SUBTITLE = "Slow, and can fail on big apps: tap to read why";

// The website's rows for an app that isn't iFizBox, in order: Install in iFizBox, Download IPA (`download`, the row
// installRows makes), Install on the Website (greyed out until accepted; once accepted it runs `install`).
export function siteGateRows({ id, install, download = null, open = (u) => { location.href = u; }, alert = showAlert, storage = store() }) {
  const on = websiteInstallsOn(storage);
  const rows = [{ label: `Install in ${NAME}`, subtitle: IN_IFIZBOX_SUBTITLE, onClick: () => open(packageLink(id ?? idFromHash() ?? "")) }];
  if (download) rows.push(download);
  rows.push({ label: "Install on the Website", subtitle: on ? WEBSITE_ON_SUBTITLE : WEBSITE_OFF_SUBTITLE, cls: on ? null : "websign-off",
    onClick: async (e) => {
      const li = e?.currentTarget?.closest?.("li");
      if (!(await acceptWebsiteInstalls({ alert, storage }))) return;
      if (li) {
        li.classList.remove("websign-off");
        const sub = li.querySelector(".cell-subtitle");
        if (sub) sub.textContent = WEBSITE_ON_SUBTITLE;
      }
      return install();
    } });
  return rows;
}

// ---- First visit -----------------------------------------------------------------------------------------------

// "ask" | "later" | "installed"
export function firstVisitState(storage = store()) {
  const v = read(storage, FIRST_KEY);
  return v === "later" || v === "installed" ? v : "ask";
}
export function setFirstVisit(state, storage = store()) {
  write(storage, FIRST_KEY, state === "ask" ? null : state);
  // the tab bar and Home follow (app.js, screens/home.js)
  globalThis.dispatchEvent?.(new Event("ifizbox:browse-lock"));
}
export const markiFizBoxInstalled = (storage = store()) => setFirstVisit("installed", storage);

export const shouldAskFirst = ({ mode = "site", storage = store() } = {}) => mode === "site" && firstVisitState(storage) === "ask";

export const FIRST_VISIT = {
  title: `Install ${NAME} First`,
  message: `The ${NAME} app signs your IPAs on the iPhone, so your apps never leave it: much faster than this `
    + `website. (Our server only sends iOS the install prompt.)\n\nInstall ${NAME} now, then install your IPAs from it.`,
  buttons: ["Not Now", `Install ${NAME}`],
  cancel: 0,
};

// Asks once per launch while the state is "ask". Install iFizBox runs `install` (Home's Install iFizBox App flow);
// Not Now is remembered, and Home's green Install iFizBox App tile stays as the reminder. -> "install" | "later" | null
let asked = false;
export async function promptFirstVisit({ mode, install, alert = showAlert, storage = store(), once = true } = {}) {
  if (!shouldAskFirst({ mode, storage }) || (once && asked)) return null;
  if (once) asked = true;
  const { index } = await alert(FIRST_VISIT);
  if (index !== 1) { setFirstVisit("later", storage); return "later"; }
  await install?.();
  return "install";
}

// Home on the website while iFizBox isn't installed (user 2026-11-18): nothing pops up at launch; everything below the
// iFizBox App card is locked (greyed, a lock in place of the chevron). A tap on a locked row asks: Install iFizBox, or
// Ignore, which counts down from 5 before it can be tapped and then unlocks browsing for good in this browser.
// Only Browse Anyway unlocks it ("later"): installing iFizBox from here doesn't (user 2026-11-18: someone who installs
// through the website likely never comes back, so the website keeps pointing at the app).
export const browsingLocked = ({ mode = "site", storage = store() } = {}) => mode === "site" && firstVisitState(storage) !== "later";
const BROWSE_GATE = {
  title: `Install ${NAME} First`,
  message: `The ${NAME} app signs your IPAs on the iPhone, so your apps never leave it: much faster than this `
    + "website. (Our server only sends iOS the install prompt.)\n\nYou can browse the website anyway, but installing here is slow and can fail on big apps.",
  // stacked, as iOS 6 stacks three: Cancel closes it and Home stays locked (user 2026-11-18). Install iFizBox green,
  // Browse Anyway red (the one we'd rather nobody pressed), and it counts down first.
  buttons: [`Install ${NAME}`, "Browse Anyway", "Cancel"],
  cancel: 2,
  colors: { 0: "green", 1: "red" },
};
// -> "browse" (Ignore: unlocked from now on; Settings > General > Website locks it again) | "install" | null (Cancel)
// F250: Browse Anyway also starts a source refresh at once (`refresh`, not awaited): the site never refreshes them
// by itself.
export async function askToBrowse({ install, alert = showAlert, storage = store(), refresh = refreshSourcesNow } = {}) {
  const { index } = await alert({ ...BROWSE_GATE, countdown: { button: 1, seconds: WARNING_SECONDS } });
  if (index === 1) {
    setFirstVisit("later", storage);
    Promise.resolve().then(refresh).catch(() => {});
    return "browse";
  }
  if (index === 0) { await install?.(); return "install"; }
  return null;
}

// ---- Source refresh (F250) -------------------------------------------------------------------------------------

// The website's source refresh: Changes' Refresh job (screens/changes.js reloadSources: refresh, Reloading Data HUD,
// reload the lists), loaded on demand so this module stays light.
export const refreshSourcesNow = () => import("./screens/changes.js").then((c) => c.reloadSources());

// At launch, website only and only once browsing is unlocked (Browse Anyway: "later"): a locked Home, the app and
// the native shells never refresh here (the app has its own update path). -> true when it started one
export function refreshOnLaunch({ mode = "site", storage = store(), win = globalThis, refresh = refreshSourcesNow } = {}) {
  if (!siteRefreshesItself({ mode, win })) return false;
  if (browsingLocked({ mode, storage })) return false;
  Promise.resolve().then(refresh).catch(() => {});
  return true;
}

// The plain website (not the app, not a native shell) owns its launch refresh: refreshOnLaunch above.
export const siteRefreshesItself = ({ mode = "site", win = globalThis } = {}) =>
  mode === "site" && !win?.ifizboxApp && !win?.ifizboxNative;

// One launch refresh, never two: on the website refreshOnLaunch (F250: every unlocked launch, Reloading Data HUD);
// everywhere else Settings > Refresh Sources on Launch (`settingOn()`) runs `background` (the Sources tab's quiet
// refresh). Called at launch and on a fresh open back from the background. -> "site" | "setting" | null
export function launchRefresh({ mode = "site", win = globalThis, storage = store(), settingOn = () => false,
  background = () => {}, refresh = refreshSourcesNow } = {}) {
  if (siteRefreshesItself({ mode, win })) return refreshOnLaunch({ mode, storage, win, refresh }) ? "site" : null;
  if (!settingOn()) return null;
  background();
  return "setting";
}

// ---- ?install (F184) -------------------------------------------------------------------------------------------

// fizl0.github.io/apps' Add to iFizBox button tries ifizbox://add and, when the app isn't there, opens the site at
// /?install (user 2026-11-18). Website only: on launch, Home, the param gone from the URL, then the plain first-visit
// popup (FIRST_VISIT: Not Now / Install iFizBox), whatever firstVisitState is (they came because the app isn't
// installed). F217: not the browse gate a locked row shows: no Browse Anyway, no countdown (user 2026-11-18: "thats
// the wrong popup"), and Not Now changes nothing, so Home's lock stays as it was.

// Before the router starts: true when the URL carries ?install in site mode; then it's replaced (history, no reload)
// by the same URL without the param, on Home. The app and native shells never take it.
export function takeInstallParam(win = globalThis, { mode = "site" } = {}) {
  if (mode !== "site" || win.ifizboxApp || win.ifizboxNative) return false;
  const { pathname = "/", search = "" } = win.location ?? {};
  const params = new URLSearchParams(search);
  if (!params.has("install")) return false;
  params.delete("install");
  const rest = params.toString();
  try { win.history?.replaceState(null, "", pathname + (rest ? "?" + rest : "") + "#/home"); } catch { /* keeps the URL */ }
  return true;
}

// After the router started: asks when takeInstallParam took the param. Install iFizBox runs `install` (Home's
// installiFizBox); Not Now writes nothing. -> "install" | null (Not Now, or no param)
export async function askFromInstallLink(took, { install, alert = showAlert } = {}) {
  if (!took) return null;
  const { index } = await alert(FIRST_VISIT);
  if (index !== 1) return null;
  await install?.();
  return "install";
}
