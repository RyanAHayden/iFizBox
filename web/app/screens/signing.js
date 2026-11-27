// F69, F75: Settings > Signing in the sideload build, as one walkthrough page (Home's Signing tile opens it too, and
// so does the first Install with something missing): numbered steps, each collapsible, a green tick once done.
//   1  Import your certificate: Select All Files (or the three rows' own Browse): settings.js certificateBlock
//   2  A Signing Server: brand.js SIGN_HOST unless the user runs their own; it hands iOS the manifest for the IPA iFizBox
//      serves at 127.0.0.1 (native/Sources/Sideload.swift). There is no install without one (F75: the old local
//      HTTPS mode is gone; iOS's installer ignores a hand-trusted certificate).
//
//   stepStates(status, { open, server })   pure: [{ id, n, title, done, current, open }] (signing.test.js)
//   missingStep(status, server)            the first step not done ("certificate" | "server") or null: Install opens
//                                          the page there (signing-client.js signAndInstall)
//   walkOpen / openAt(id)                  the expand/collapse state kept across redraws; openAt opens one step only
//   drawWalkthrough(el, opts)              the page; settings.js passes the certificate block, the server rows, …
//
//   picture()                              the certificate step's picture: the user's Files picker screenshot for
//                                          the current theme (F78), shotFor(theme) its address
//
// F177: Install sent the user here first (no certificate yet): once signing is ready, ask to go on with that install.
//   rememberInstall({ name, run })         Install's redirect to Signing: the app and the install it wanted (one trip)
//   pendingInstall()                       that, or null; leaving Signing (a route without "signing") forgets it
//   await offerInstall(ready, { alert })   the Signing page, each time it draws: when ready and one is pending, the
//                                          iOS 6 alert Install <name>? (Later | Install Now) once; Install Now runs it.
//                                          -> "install" | "later" | "back" | null (nothing asked)
//   rememberReturn(hash) / pendingReturn()  B39: the page that opened Signing (signing-client.js firstInstallCheck,
//                                          openSigning); once ready, offerInstall first goes back to it (the IPA's
//                                          page with its file), then asks Install Now there. Never Home.
//   siteReady(id)                          the website's saved certificate is ready (.p12, profile, password not wrong)
import { statusReady } from "../signing/device.js";
import { normalizeServer } from "../core/signing.js";
import { NAME, SIGN_HOST } from "../brand.js";
import { KEYS } from "../core/storagekeys.js";
import { loadStyle } from "../nav/motion.js";
import { go as navGo } from "../nav/go.js";
import { mod } from "../lazy.js";
import { nativeBridge } from "../native.js";
// F313: free-apple-id.js loads with Settings' pages (router.js lazyFor), the only place the walkthrough is drawn.
const freeRouteBlock = (...args) => mod("freeAppleId").freeRouteBlock(...args);

export const STEPS = [
  { id: "certificate", title: "Import Your Certificate" },
  { id: "server", title: "Signing Server" },
];

// A server installs can use: an https:// address (the shell takes no other for the manifest).
export const serverReady = (server) => /^https:\/\//.test(normalizeServer(server) ?? "");

// Each step's state from a signing.status answer (null: the signer didn't answer, nothing is known to be done) and
// the Signing Server. `open`: { [id]: true | false } the user's own expand/collapse taps, which win; otherwise only
// the first step not done yet is open.
export function stepStates(status, { open = {}, server = null } = {}) {
  const done = { certificate: statusReady(status), server: serverReady(server) };
  const current = STEPS.find((s) => !done[s.id])?.id ?? null;
  return STEPS.map((s, i) => ({
    id: s.id, n: i + 1, title: s.title, done: done[s.id], current: s.id === current,
    open: s.id in open ? Boolean(open[s.id]) : s.id === current,
  }));
}

export const missingStep = (status, server) => stepStates(status, { server }).find((s) => !s.done)?.id ?? null;

// Every step done: Install signs and installs straight away.
export const allDone = (states) => states.every((s) => s.done);

export const walkOpen = {};
export function openAt(id) {
  for (const k of Object.keys(walkOpen)) delete walkOpen[k];
  for (const s of STEPS) walkOpen[s.id] = s.id === id;
}

// ---- F177: the install that sent the user here --------------------------------------------------------------

let pending = null;
let watchingRoute = false;
const onSigning = (hash) => /(^|\/)signing(\/|$)/.test(String(hash ?? "").replace(/^#/, ""));

export function rememberInstall({ name = "", run } = {}) {
  if (typeof run !== "function") return;
  pending = { name: name || NAME, run };
  watchTrip();
}

export const pendingInstall = () => pending;
export function forgetInstall() { pending = null; returnTo = null; }
export const routeLeftSigning = (hash) => !onSigning(hash);

// B39: the page that opened Signing for a missing certificate or server (an IPA's page in My IPAs, an app's page,
// the incoming IPA's): once signing is ready, offerInstall goes back there, never Home. Kept for one trip like
// `pending`; a Signing route itself (or none) is no page to return to.
let returnTo = null;
export function rememberReturn(hash) {
  const h = String(hash ?? "").replace(/^#/, "");
  if (!h || h === "/" || onSigning(h)) return;
  returnTo = `#${h}`;
  watchTrip();
}
export const pendingReturn = () => returnTo;

function watchTrip() {
  if (watchingRoute || typeof addEventListener !== "function") return;
  watchingRoute = true;
  // A trip ends when the user leaves Signing (Back to Home, another tab): opening Signing again later is their own.
  addEventListener("hashchange", () => { if (!onSigning(globalThis.location?.hash)) forgetInstall(); });
}

// The website's certificate is ready to sign with: the .p12, the profile and a password not known to be wrong.
export const siteReady = (id) => Boolean(id?.p12 && id?.profile && id.password != null && id.passwordOk !== false);

export async function offerInstall(ready, { alert = null, go = navGo } = {}) {
  if (!ready) return null;
  const from = returnTo;
  returnTo = null;
  if (from) go(from); // B39: back to the page that sent the user here, before (and under) the alert
  if (!pending) return from ? "back" : null;
  const { name, run } = pending;
  pending = null; // once per trip, even when the page redraws while the alert is up
  const ask = alert ?? (await import("../nav/alert.js")).showAlert;
  const { index } = await ask({ title: `Install ${name}?`,
    message: `Signing is set up. ${name} can be signed and installed now.`,
    buttons: ["Later", "Install Now"], cancel: 0, colors: { 1: "green" } });
  if (index !== 1) return "later";
  run();
  return "install";
}

// ---- drawing --------------------------------------------------------------------------------------------------

const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// The stylesheet, once, from this module's own folder (no build step: the page links it when first drawn).
function style() { loadStyle("signing.css"); }
style();

// F78: the certificate step's picture is the user's own screenshot of the iOS Files picker with the three files
// selected, one per theme (600 px wide, no status bar): the one matching <html data-theme> shows, and it follows a
// theme change while the page is open (Automatic flips with iOS).
export const shotFor = (theme) => new URL(`../icons/steps/select-files-${theme === "dark" ? "dark" : "light"}.jpg`,
  import.meta.url).href;
const theme = () => (typeof document === "undefined" ? null : document.documentElement?.getAttribute("data-theme"));

let watching = false;
function watchTheme() {
  if (watching || typeof MutationObserver === "undefined") return;
  watching = true;
  new MutationObserver(() => {
    for (const img of document.querySelectorAll("img.step-shot")) img.src = shotFor(theme());
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

export function picture() {
  watchTheme();
  const fig = h("figure", "step-picture");
  const img = h("img", "step-shot");
  img.alt = "The iOS Files picker with your .p12, .mobileprovision and password file selected";
  img.width = 600;
  img.height = 517;
  img.decoding = "async";
  img.src = shotFor(theme());
  fig.append(img);
  return fig;
}

const TEXT = {
  certificate: "Tap Select All Files, select your .p12, .mobileprovision and password file (or their .zip), then tap Open.",
  server: `Keep ${SIGN_HOST}, or tap it to enter your own Signing Server.`,
};

// The page. opts: { status, failure (text when the signer didn't answer), certificate (element: Select All Files and
// the rows), server (element: the server rows), serverUrl, open (walkOpen), extra (elements under the steps: the
// Keychain's details, Remove Certificate) }.
export function drawWalkthrough(el, { status = null, failure = "", certificate = null, server = null, serverUrl = null,
  open = walkOpen, extra = [] } = {}) {
  style();
  const states = stepStates(status, { open, server: serverUrl });
  const page = h("div", "walkthrough");
  page.append(h("p", "group-footer walk-intro", allDone(states)
    ? `All set: Install signs apps with your certificate ${nativeBridge() ? "on this iPhone" : "in this browser"}.`
    : "Two steps before the first install."));
  if (failure) page.append(h("p", "group-footer walk-failure", `The signer didn't answer: ${failure}`));
  if (status?.identityProblem) page.append(h("p", "group-footer walk-failure", status.identityProblem));
  const list = h("ol", "walk-steps");
  for (const s of states) {
    const li = h("li", "walk-step" + (s.done ? " is-done" : "") + (s.current ? " is-current" : ""));
    li.dataset.step = s.id;
    const head = h("button", "walk-head");
    head.type = "button";
    head.setAttribute("aria-expanded", String(s.open));
    const badge = h("span", "walk-badge", s.done ? "" : String(s.n));
    badge.setAttribute("aria-label", s.done ? `Step ${s.n}, done` : `Step ${s.n}`);
    head.append(badge, h("span", "walk-title", s.title), h("span", "walk-disclosure"));
    const body = h("div", "walk-body");
    body.hidden = !s.open;
    body.append(h("p", "walk-text", TEXT[s.id]));
    if (s.id === "certificate") {
      if (certificate) body.append(certificate);
      body.append(picture());
    }
    if (s.id === "server" && server) body.append(server);
    head.addEventListener("click", () => {
      const now = body.hidden;
      body.hidden = !now;
      head.setAttribute("aria-expanded", String(now));
      open[s.id] = now; // the caller's object: the choice survives a redraw
    });
    li.append(head, body);
    list.append(li);
  }
  page.append(list, ...extra);
  // F254: the website's Use a Free Apple ID, under the certificate route (hidden unless the Apple relay is on)
  if (!nativeBridge()) page.append(freeRouteBlock());
  const top = el.scrollTop;
  el.replaceChildren(page);
  el.scrollTop = top;
  return states;
}

// ---- F236: "This iPhone is in the profile", under the Provisioning Profile's rows ------------------------------
// core/signing.js deviceCheckText's answer ({ ok, text, udid } or null: not checked) as its own group under the
// profile's status rows: In Profile; Not in Profile (red, with the UDID and Copy UDID when it is known); Unknown.
// F316 (AGENTS.md Hints): its footer is a short hint by state (deviceHint), the fix when it's off; the profile's
// status rows get none. `find`: the website's Find This iPhone's UDID group follows (udidFindRows), so Unknown's
// hint only says what's missing. Pure: settings.js draws it (Settings > Signing, the app's and the website's).
export const DEVICE_HINTS = {
  in: "This iPhone is in the profile.",
  outCopy: "Add this UDID to your developer account, then make the profile again.",
  out: "This iPhone isn't in the profile. Add its UDID to your developer account, then make the profile again.",
  unknownFind: "Not checked: this iPhone's UDID isn't known yet.",
  unknown: "Not checked: the UDID can't be read here. A Mac shows it in Finder, under the iPhone's name.",
};
export function deviceHint(device, { find = false } = {}) {
  if (!device?.text) return null;
  if (device.ok === true) return DEVICE_HINTS.in;
  if (device.ok === false) return device.udid ? DEVICE_HINTS.outCopy : DEVICE_HINTS.out;
  return find ? DEVICE_HINTS.unknownFind : DEVICE_HINTS.unknown;
}
export function deviceRows(device, { find = false } = {}) {
  if (!device?.text) return null;
  const state = device.ok === true ? "In Profile" : device.ok === false ? "Not in Profile" : "Unknown";
  const rows = [{ label: "This iPhone", detail: state }];
  if (device.ok === false && device.udid) {
    rows.push({ label: "UDID", subtitle: device.udid }, { label: "Copy UDID", copy: device.udid });
  }
  return { rows, footer: deviceHint(device, { find }), warn: device.ok === false };
}

// ---- F253: the website reads This iPhone's UDID through a configuration profile ----------------------------------
// The Worker (worker/src/udid.js) hands out a Profile Service configuration profile per visit; iOS sends it the UDID and
// opens a "go back" page in Safari. Safari and the Home Screen web app don't share storage, so the page that started
// it polls the Worker by the visit's challenge (the done page also writes Safari's own copy, UDID_KEY).
//
//   storedUdid(store)                  { udid, product, version } this browser has, or null
//   saveUdid(phone, store) / forgetUdid(store)
//   udidPending(store, now)            the visit being waited for { poll, expires }, or null (none, or it expired)
//   await startUdid({ origin, fetcher, store, now })   POST /sign/udid, keep the visit: -> its profile URL
//   await pollUdid({ fetcher, store, now })   one look: "done" (saved), "waiting", "expired" (forgotten) or null
//   watchUdid(onDone, opts)            polls every 2 s while a visit is pending (and at once when the page shows
//                                      again); calls onDone() once the UDID is saved. Idempotent across redraws
//   canFindUdid(nav)                   an iPhone or iPad (where iOS takes a profile), not a computer
//   udidPageSections({ pending, udid })   F316: the page Find This iPhone's UDID opens, one group per step
export const UDID_KEY = KEYS.udid;
const UDID_PENDING = KEYS.udidPending;
const local = (store) => {
  if (store !== undefined) return store;
  try { return globalThis.localStorage ?? null; } catch { return null; }
};
const readJson = (store, k) => { try { return JSON.parse(local(store)?.getItem(k) ?? "null"); } catch { return null; } };
const writeJson = (store, k, v) => { try { v == null ? local(store)?.removeItem(k) : local(store)?.setItem(k, JSON.stringify(v)); } catch { /* blocked */ } };

export function storedUdid(store) {
  const p = readJson(store, UDID_KEY);
  return p && typeof p.udid === "string" && /^[0-9A-Fa-f-]{20,64}$/.test(p.udid)
    ? { udid: p.udid, product: p.product ?? null, version: p.version ?? null } : null;
}
export const saveUdid = (phone, store) => writeJson(store, UDID_KEY, { udid: phone.udid, product: phone.product ?? null, version: phone.version ?? null });
export const forgetUdid = (store) => writeJson(store, UDID_KEY, null);

export function udidPending(store, now = Date.now()) {
  const p = readJson(store, UDID_PENDING);
  return p && typeof p.poll === "string" && Number(p.expires) > now ? p : null;
}

export async function startUdid({ origin = globalThis.location?.origin, fetcher = fetch, store, now = Date.now() } = {}) {
  const r = await fetcher(`${origin}/sign/udid`, { method: "POST" });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.challenge || !j?.profile || !j?.poll) throw new Error(j?.error || `The server answered ${r.status}.`);
  writeJson(store, UDID_PENDING, { poll: j.poll, expires: now + (Number(j.expiresIn) || 600) * 1000 });
  return j.profile;
}

export async function pollUdid({ fetcher = fetch, store, now = Date.now() } = {}) {
  const p = udidPending(store, now);
  if (!p) { writeJson(store, UDID_PENDING, null); return null; }
  let r, j;
  try { r = await fetcher(p.poll, { cache: "no-store" }); j = await r.json(); } catch { return "waiting"; } // offline a moment
  if (r.status === 404) { writeJson(store, UDID_PENDING, null); return "expired"; }
  if (j?.state === "done" && j.udid) {
    saveUdid(j, store);
    writeJson(store, UDID_PENDING, null);
    return "done";
  }
  return "waiting";
}

let udidTimer = null;
export function watchUdid(onDone, { fetcher = fetch, store, every = 2000 } = {}) {
  if (udidTimer || !udidPending(store)) return false;
  const tick = async () => {
    const s = await pollUdid({ fetcher, store });
    if (s === "waiting") return;
    stop();
    if (s === "done") onDone?.();
  };
  const seen = () => { if (globalThis.document?.visibilityState !== "hidden") tick(); };
  const stop = () => { clearInterval(udidTimer); udidTimer = null; globalThis.document?.removeEventListener?.("visibilitychange", seen); };
  udidTimer = setInterval(tick, every);
  globalThis.document?.addEventListener?.("visibilitychange", seen);
  return true;
}

export function canFindUdid(nav = globalThis.navigator) {
  const ua = String(nav?.userAgent ?? "");
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && Number(nav?.maxTouchPoints) > 1);
}

// F316: the page Find This iPhone's UDID opens (settings.js, #settings/signing/udid), one group per step, each with its
// own short footer; Download Profile starts the visit (settings.js wires `start: true`). Once the UDID is here the
// page says so. Pure.
export const UDID_PAGE = "udid";
export const UDID_PAGE_TITLE = "Find UDID";
export const DOWNLOAD_PROFILE = "Download Profile";
export const UDID_STEPS = [
  `Downloads a small profile from ${NAME}'s website. Tap Allow when Safari asks.`,
  `Open the Settings app > Profile Downloaded and tap Install. It says "Not Verified", which is fine.`,
  `iOS sends ${NAME} the UDID, model and iOS version, and keeps no profile. Come back here and This iPhone fills in.`,
];
export const UDID_WAITING = "Waiting for iOS: install the profile in Settings > Profile Downloaded.";
export const UDID_FOUND = "This iPhone's UDID is here. Go back to see it checked against the profile.";
export function udidPageSections({ pending = false, udid = null } = {}) {
  if (udid) return [{ header: "This iPhone", rows: [{ label: "UDID", subtitle: udid }], footer: UDID_FOUND }];
  return [
    { header: "Steps", rows: [{ label: DOWNLOAD_PROFILE, start: true, ...(pending ? { detail: "Waiting" } : {}) }],
      footer: pending ? UDID_WAITING : `1. ${UDID_STEPS[0]}` },
    { footer: `2. ${UDID_STEPS[1]}` }, // numbered step groups, as Pairing's (installroute.js setupGroups)
    { footer: `3. ${UDID_STEPS[2]}` },
  ];
}

// The website's Find This iPhone's UDID group under This iPhone's (`find: true`: settings.js makes it open the page
// above) while the check is "unknown" on an iPhone; "Waiting" once a visit is pending, and then its footer says what to
// do. Nothing when the UDID is known, the profile lists no devices, or this is a computer. Pure.
export const FIND_UDID = "Find This iPhone's UDID";
export function udidFindRows(check, { pending = false, can = true } = {}) {
  if (!can || check?.state !== "unknown") return null;
  if (pending) return { rows: [{ label: FIND_UDID, find: true, detail: "Waiting" }], footer: UDID_WAITING };
  return { rows: [{ label: FIND_UDID, find: true }] };
}
