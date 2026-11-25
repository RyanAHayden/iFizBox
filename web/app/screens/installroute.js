// Settings > Installation & Signing's install side (sideload build, docs/settings.md): Install Apps With Signing Server /
// This iPhone, and the This iPhone route's pages (core/installroute.js holds the rules and texts):
//   installation       the merged page (screens/settings.js draws it from mainPage below: F284's status cell and
//                      rows, built once and filled in place)
//   installation/with  Install Apps With (F300): the choice (This iPhone / Signing Server, a checkmark), and under it
//                      the chosen route's groups sliding in: This iPhone's (below) or the Signing Server's (Server,
//                      Check Server, Run Your Own: screens/settings.js passes them as `server`)
//   installation/iphone This iPhone (F414): its status with one action, the Set Up steps until done, Restore My VPN
//                      (F412), Forget Pairing, How It Works
//   installation/pair  Pairing, one page that runs by itself (core setupState): one sentence on what it gives,
//                      drawn at once with a spinner while it checks, then pairing starts on its own: the 6-digit code
//                      big at the top and where to type it, a line and a screenshot a step; it keeps pairing while
//                      the page is open, at most 10 minutes (B436: then Get New Code). Paired: a check, Check Connection (Fix after a failure) and Forget.
//                      Older iOS: Import Pairing File. A profile without Network Extensions: NO_VPN says so.
// The idevice.* bridge calls are native/sideload/idevice/IDeviceBridge.swift's, vpn.* native/sideload/vpn's.
import { grouped, el } from "../nav/ui.js";
import { format, settingsRoute, mounted, parse } from "../router.js";
import { showAlert } from "../nav/alert.js";
import { toBase64 } from "../core/signing.js";
import { ROUTE_KEY, ROUTE_OPTIONS, IPHONE_INTRO, setupState, droppedPairing, plainSocket, PAIR_GUIDE, pairEvent, pairFooter, pairFromNative, codeExpired, CODE_EXPIRED, NEW_CODE, pinText, PAIR_STEPS, verifyFailure } from "../core/installroute.js";
import { ringStyle } from "../core/installroute.js";
import { leaveQuestion, LEAVE } from "../core/installroute.js";
import { installStatus, CHECKING, CHECKING_SERVER, STATUS_ACTIONS } from "../core/installroute.js";
import { routeFailure, rememberRouteFailure, clearRouteFailure, routeFailureOf, NO_ANSWER_FAILURE, FIX, takeFix } from "../core/installroute.js"; // B316, F409
import { SETUP_FOOTER, setupSteps, iphoneStatus, fixQuestion } from "../core/installroute.js"; // F414
import { builtinVPN, setupFooter, iphoneSetUp, HOW_STEPS, vpnTestResult, NO_VPN, BUILTIN_VPN } from "../core/installroute.js"; // F372
import { quietCheckDue, quietCheckAllowed, markQuietCheck } from "../core/installroute.js"; // F410b
import { onCellular, cellularCheck, connectRefused } from "../core/installroute.js"; // B428a
import { RESTORE_VPN, restoreShown, restoreFooter, setRestoreVPN } from "../core/installroute.js"; // F412
import { restoreLeft, RESTORE_FIX, REMEMBER_AGAIN, REMEMBER_AGAIN_FOOTER } from "../core/installroute.js"; // F420
import { ON_CELLULAR, cellularOptions, cellularFooter, onCellularChoice, setOnCellular, ADD_AGAIN, ADD_AGAIN_FOOTER } from "../core/cellular.js"; // F417
import { createSwitch } from "../nav/switch.js";
import { NAME } from "../brand.js";
import { rowIcon } from "../icons/rowicons.js";
import { showHUD } from "../nav/hud.js";
import { slideChange } from "../nav/slide.js";
import { go as navGo, back as navBack } from "../nav/go.js";
import { nativeBridge } from "../native.js";

export const PAGE = "installation";
// F300: Installation & Signing's main page links to Install Apps With (`with`: the choice and the chosen route's
// groups); `iphone` still opens This iPhone's groups alone. The Pairing row opens the setup (`pair`).
// F372: This iPhone's own page (How It Works) and the Signing Server's page, each pushed with the
// slide from Installation & Signing's rows.
export const SUB_TITLES = { pair: "Pairing", iphone: "This iPhone", with: "Install Apps With", how: "How It Works", server: "Signing Server" };
const route =(sub) => format(settingsRoute(sub ? [PAGE, sub] : [PAGE]));
const goTo = (sub) => navGo(route(sub));
const call = (native, m, p = {}, ev) => native?.call ? native.call(m, p, ev) : Promise.reject(new Error(`This needs the ${NAME} app.`));
// F301: every call the page waits on has a deadline. Past it the row (or the alert) says Not Responding instead of
// spinning on; a later answer is dropped. idevice.status answers in under a second; idevice.verify talks to iOS, so
// it gets longer.
export const TIMEOUTS = { status: 5000, verify: 20000 };
export const NOT_RESPONDING = "Not Responding";
export function within(p, ms) {
  let t = null;
  const late = new Promise((_, no) => {
    t = setTimeout(() => no(Object.assign(new Error(`not_responding: no answer in ${Math.round(ms / 1000)} s`), { code: "not_responding" })), ms);
    t?.unref?.(); // Node (tests): a deadline alone doesn't keep the process up
  });
  return Promise.race([Promise.resolve(p), late]).finally(() => clearTimeout(t));
}
// F417b: Cellular Installs, adding and checking it; the last cellular.status (null: not read), and while it's being added
const shortcutSetup = () => import("../signing/cellularsetup.js");
let lastShortcut = null, addingShortcut = false;
// F420: the Restore My VPN Shortcut, adding it and its store run, and while that goes on (a row spins, a second tap waits)
const restoreSetup = () => import("../signing/restoresetup.js");
let settingRestore = false;
const isLate = (e) => e?.code === "not_responding";
// idevice.status with its deadline: { st } (null when it failed) and `late` when it didn't answer in time.
async function readStatus(native) {
  try { return { st: (await within(call(native, "idevice.status"), TIMEOUTS.status)) ?? null, late: false }; } catch (e) { return { st: null, late: isLate(e) }; }
}
async function status(native) { return (await readStatus(native)).st; }
// B428a: a check that was refused, read again: the status when the phone is on cellular now, else null.
async function refusedOnCellular(native, err) {
  if (!err || !connectRefused(err)) return null;
  const st = await status(native);
  return onCellular(st) ? st : null;
}

// F301: the last idevice.status answer, shown at once the next time a page draws (its rows spinning while it's read
// again). Kept for this run of the app only: after a relaunch the VPN may well be another, so the first read waits.
let lastStatus = null;
// F412: a status read that began before a tap on Restore My VPN doesn't bring the old setting back (a read ends within TIMEOUTS.status)
let restoreTap = null; // { on, at, was, sending }: the last tap; was = the setting before it, as last confirmed
export function rememberStatus(st) {
  if (!st || typeof st !== "object") return;
  if (restoreTap && !restoreTap.sending && Date.now() - restoreTap.at > TIMEOUTS.status) restoreTap = null;
  lastStatus = restoreTap && restoreShown(st) ? { ...st, vpn: { ...st.vpn, restore: restoreTap.on, restoreNever: false } } : st; // F428a: off clears Don't Ask Again
}
export function forgetStatus() { lastStatus = null; restoreTap = null; } // tests, and Forget Pairing
export const cachedStatus = () => lastStatus;

// B133: every step that waits on the phone, the network or the pairing shows iOS 6's activity indicator and what it
// does. A one-off action (Check Connection, Forget Pairing, Test Connection, importing
// a pairing file) runs under the HUD (nav/hud.js: the large white spinner and a label, which
// also eats taps so it isn't started twice); it shows only once the call has taken `delay` ms, so a quick answer
// doesn't flash it. Waits inside a page (status being read, the code coming, the iPhone connecting, the VPN coming
// on) draw the grey spinner in place: a row's `spin` or a group's `spinner` line.
export const hudHooks = { show: (text) => { try { return showHUD(text); } catch { return () => {}; } }, delay: 250 };
export async function busy(label, work) {
  let hide = null;
  const t = setTimeout(() => { hide = hudHooks.show(label); }, hudHooks.delay);
  try { return await work(); } finally { clearTimeout(t); hide?.(); }
}

// grouped() rows marked `spin` get the grey spinner at their right end (packages.css .loading-spinner; the cell's
// flex gap spaces it).
function spinRows(frag, sections) {
  const groups = [...frag.children];
  sections.forEach((s, i) => {
    const ul = [...(groups[i]?.children ?? [])].find((c) => c.classList?.contains("table"));
    if (!ul) return;
    (s.rows ?? []).forEach((r, j) => {
      if (!r?.spin) return;
      const inner = ul.children[j]?.children?.[0];
      if (!inner) return;
      const sp = el("span", "loading-spinner");
      sp.setAttribute("aria-hidden", "true");
      inner.append(sp);
      inner.setAttribute("aria-busy", "true");
    });
  });
  return frag;
}

// Install Apps With's groups (pure, for tests): the choice and, under it, the chosen route's groups. This iPhone: Set
// Up and How It Works (localGroups); Signing Server: `server()`'s groups (Server, Check Server, Run Your Own).
// B133: `reading`: idevice.status hasn't answered yet: the rows say Checking… from the first frame, with the spinner.
// F300: `picking`: the choice was just tapped: its row is checked at once and spins until idevice.status answers.
// `hint`: the last idevice.status read, drawn while the page reads again.
// F300: no Developer Mode row (an app can't open without it; an install it stops says so in its alert).
// F301: `late: {device}` idevice.status didn't answer in time: the status says Not Responding.
export function installationGroups(choice, st, { pick = () => {}, test = () => {},
  reading = false, picking = false, hint = null, server = () => [],
  late = {}, testing = false, failure = null, fix = () => {}, fixing = false, pairChecking = false, checkNow, forget, setUp, cellular, setCellular, shortcut, adding, addAgain, remember, remembering } = {}) {
  const groups = [{
    header: "Install Apps With",
    rows: ROUTE_OPTIONS.map((o) => ({ label: o.label, subtitle: o.subtitle, cls: "route-row", icon: rowIcon(ROUTE_ICON[o.value]), checked: o.value === choice, onClick: () => pick(o.value),
      ...(picking && o.value === choice ? { spin: true } : {}) })),
    footer: choice === "iphone"
      ? `Signed apps go straight to iOS through ${BUILTIN_VPN}.`
      : "The Signing Server hands iOS each app's install link.",
  }];
  if (choice !== "iphone") return [...groups, ...(server() ?? [])];
  // F372: the built-in VPN is the way in: This iPhone's page is Set Up and How It Works, drawn from the first frame
  // (rows Checking… until idevice.status answers). A profile without Network Extensions says so there (core NO_VPN).
  return [...groups, ...localGroups(st ?? hint, { reading: reading && !hint && !st, pairChecking, test, testing, failure, fix, fixing, checkNow, forget, setUp, cellular, setCellular, shortcut, adding, addAgain, remember, remembering, late: Boolean(late.device) })];
}

// ---- F372: This iPhone with the built-in VPN (core BUILTIN_VPN; native/sideload/vpn)
// F414 (concept K8, option A): the page (installation/iphone) is a status cell with one action (core iphoneStatus), the
// Set Up steps until they're done (core setupSteps: done ones checked, the next one opens), Forget Pairing and How It
// Works. `st` is idevice.status (its `vpn`), `reading` while the first answer is out, `late` when it didn't answer,
// `testing`/`fixing`/`pairChecking` while a test, a check or Fix runs. A failed check or install (B316's `failure`) is
// the status, red, and its action is Fix.
export function localGroups(st, { reading = false, pairChecking = false, test = () => {}, testing = false, failure = null, fix = () => {}, fixing = false, late = false,
  checkNow = () => {}, forget = () => {}, setUp = () => goTo("pair"), cellular = "ask", setCellular = () => {}, shortcut = false, adding = false, addAgain = () => {}, remember = () => {}, remembering = false } = {}) {
  const howGroup = { rows: [{ label: "How It Works", icon: rowIcon("help"), href: route("how") }] };
  // A profile without Network Extensions: nothing to set up, and the page says so instead of the VPN's rows
  if (st && !reading && !late && !builtinVPN(st)) {
    return [{ header: "Set Up", rows: [{ label: "Network Extensions", detail: "Missing" }], footer: NO_VPN.message, warn: true }, howGroup];
  }
  const s = iphoneStatus(st, { reading, running: testing || fixing || pairChecking, late, failure });
  const acts = { check: checkNow, fix, start: setUp, test };
  const groups = [{ key: "status", rows: [
    { label: s.title, subtitle: s.subtitle, cls: "install-status", tone: s.tone, red: Boolean(s.red) },
    { label: STATUS_ACTIONS[s.action], cls: "install-action", dim: Boolean(s.dim), onClick: s.busy || s.dim ? () => {} : acts[s.action], ...(s.busy || s.dim ? { spin: true } : {}) },
  ], ...(s.state === "ready" && setupFooter(st) ? { footer: setupFooter(st) } : {}) }];
  if (st && !iphoneSetUp(st)) {
    groups.push({ header: "Set Up", rows: setupSteps(st).map((p) => ({ label: p.label, subtitle: p.subtitle, icon: rowIcon(STEP_ICON[p.key]),
      ...(p.done ? { checked: true } : p.next ? { onClick: p.key === "pair" ? setUp : test, chevron: true } : {}) })), footer: SETUP_FOOTER });
  }
  // F412: not in the row's content: a repaint keeps the row, so the knob slides (syncRestore sets it)
  // F420: what is left to do, with its row; nothing left: remembering again, a group of its own
  if (restoreShown(st)) {
    const left = restoreLeft(st), act = (label) => ({ label, cls: "sign-import", onClick: remember, ...(remembering ? { spin: true } : {}) });
    const on = st.vpn.restore;
    groups.push({ key: "restore", grow: true, footer: restoreFooter(st, left),
      rows: [{ label: RESTORE_VPN, cls: "restore-vpn", icon: rowIcon("syncNow") }, ...(on && left ? [act(RESTORE_FIX[left])] : [])] });
    if (on && !left && typeof st.vpn.remembered === "boolean") groups.push({ key: "remember", rows: [act(REMEMBER_AGAIN)], footer: REMEMBER_AGAIN_FOOTER });
  }
  // F417: what an install does on cellular data. F417b: `shortcut`: Cellular Installs can run here; `adding`: it's being added
  const onCell = cellular === "shortcut" && !shortcut ? "ask" : cellular;
  if (st?.paired) groups.push({ key: "cellular", header: ON_CELLULAR, footer: cellularFooter(onCell), rows: cellularOptions(shortcut).map((o) => ({
    label: o.label, subtitle: o.subtitle, cls: "route-row", icon: rowIcon(o.icon), checked: o.value === onCell, onClick: () => setCellular(o.value),
    ...(adding && o.value === "shortcut" && onCell !== "shortcut" ? { spin: true } : {}) })) });
  if (st?.paired && onCell === "shortcut") groups.push({ key: "cellshortcut", rows: [{ label: ADD_AGAIN, cls: "sign-import", onClick: addAgain, ...(adding ? { spin: true } : {}) }], footer: ADD_AGAIN_FOOTER });
  if (st?.paired) groups.push({ rows: [{ label: "Forget Pairing", cls: "sign-import", onClick: forget }] });
  return [...groups, howGroup];
}
// F412: the drawn Restore My VPN row's switch. `toggles` holds each page's latest handler (the row outlives a repaint).
const restoreToggles = new WeakMap(); // page element → (on) => …
function dressRestore(frag, page, on) {
  const inner = frag.querySelector?.(".restore-vpn .cell-inner") ?? frag.querySelector?.(".restore-vpn")?.children?.[0];
  if (!inner) return frag;
  inner.append(createSwitch({ label: RESTORE_VPN, checked: on, onToggle: (v) => restoreToggles.get(page)?.(v) }));
  inner.classList.add("has-switch");
  return frag;
}
function syncRestore(page, on) {
  const sw = page.querySelector?.(".restore-vpn .switch");
  if (sw && sw.getAttribute("aria-checked") !== String(on)) sw.setAttribute("aria-checked", String(on));
}
const STEP_ICON = { pair: "pairPhone", allow: "cellular", test: "testConnection" };
// The status cell's tile and the action's dimming on the drawn rows (as mainPage's).
function dressStatus(frag, sections) {
  const groups = [...frag.children];
  sections.forEach((s, i) => {
    if (s.key !== "status") return;
    const ul = [...groups[i].children].find((c) => c.classList?.contains("table"));
    s.rows.forEach((r, j) => {
      const inner = ul?.children?.[j]?.children?.[0];
      if (!inner) return;
      if (r.tone) {
        const tile = el("span", `status-icon tone-${r.tone}`);
        tile.setAttribute("aria-hidden", "true");
        inner.prepend(tile);
        if (r.red) inner.querySelector(".cell-label")?.classList.add("install-red");
      }
      if (r.dim) { inner.classList.add("is-dim"); inner.setAttribute("aria-disabled", "true"); }
    });
  });
  return frag;
}

// How It Works (installation/how): the steps of one install, a row each (core HOW_STEPS).
export function howGroups() {
  return [
    { header: "Each Install", rows: HOW_STEPS.map((s) => ({ ...s })), footer: "Takes a few seconds more than an install over Wi-Fi." },
    { header: "Without Wi-Fi or Data", rows: [{ label: "Offline", detail: "Works" }],
      footer: "Apps you already downloaded install with no connection at all." },
  ];
}

// F372: a tap on This iPhone's row before it was set up opened its setup; the test that finishes it uses This iPhone
// (F392: the first test that passes does so either way; this covers pairing again, a later test).
// It holds for USE_HOLD ms: a test long after the user backed out of the setup doesn't switch the way in.
let useAfterSetup = 0;
export const USE_HOLD = 10 * 60 * 1000;
export const setUseAfterSetup = (v, now = Date.now()) => { useAfterSetup = v ? now : 0; };
const takeUseAfterSetup = (now = Date.now()) => { const on = useAfterSetup > 0 && now - useAfterSetup < USE_HOLD; useAfterSetup = 0; return on; };
export const TEST_MS = 120000; // vpn.test: the first one waits for the user's Allow on iOS's Add VPN Configurations

// Test Connection with the built-in VPN: vpn.test (on, one connect with the pairing, off). A pass clears a remembered
// failure and marks This iPhone set up. F392: the first pass uses This iPhone; a later one keeps the pick (unless its
// row was just tapped).
export async function vpnTest(native, alert, store, { ended = () => {}, onPass = () => {} } = {}) {
  let r = null, err = null;
  let usedNow = false;
  const read = await status(native); // B428a: the network as it is now
  if (read) rememberStatus(read);
  const before = lastStatus;
  if (onCellular(read)) {
    ended();
    await alert(cellularCheck(read));
    return null;
  }
  const first = Boolean(before) && !before.vpn?.tested; // not known: a later test, the pick stays
  await quietRun; // F410b
  try { r = await within(call(native, "vpn.test"), TEST_MS); } catch (e) { err = e; }
  const cell = await refusedOnCellular(native, err);
  if (cell) {
    rememberStatus(cell);
    ended();
    await alert(cellularCheck(cell));
    return r;
  }
  // the row says Connected under the alert: the status is marked tested before the row repaints (ended)
  if (r?.ok && lastStatus) lastStatus = { ...lastStatus, vpn: { ...(lastStatus.vpn ?? {}), tested: true } };
  ended();
  if (r?.ok) {
    clearRouteFailure();
    if ((takeUseAfterSetup() || first) && store?.get(ROUTE_KEY) !== "iphone") { store?.set(ROUTE_KEY, "iphone"); usedNow = true; }
    onPass();
  } else if (isLate(err)) rememberRouteFailure(NO_ANSWER_FAILURE);
  else { const f = routeFailureOf(err, lastStatus); if (f) rememberRouteFailure(f); }
  const why = isLate(err) ? { title: NOT_RESPONDING, message: `This iPhone didn't answer in ${Math.round(TEST_MS / 1000)} seconds. Try again.` } : vpnTestResult(r, err);
  if (usedNow) why.message = "Set up. Apps now install straight onto this iPhone.";
  if (why.again) {
    const { index } = await alert(fixQuestion(why, lastStatus)) || {};
    if (index === 1) recheckHooks.goPair();
    return r;
  }
  await alert({ title: why.title, message: why.message, buttons: ["OK"] });
  return r;
}

// `server`: the Signing Server's groups for Install Apps With's page (screens/settings.js serverSections).
export async function drawInstallation(el, sub, { store, native = nativeBridge(), alert = showAlert, server = () => [] } = {}) {
  const redraw = () => drawInstallation(el, sub, { store, native, alert, server });
  if (sub === "pair") return drawPair(el, { store, native, alert, redraw });
  if (sub === "server") { el.replaceChildren(grouped(server() ?? [])); return; } // F372: the Signing Server's own page
  if (sub === "how") { el.replaceChildren(grouped(howGroups())); return; }
  return paintInstallation(el, { store, native, alert, redraw, server, sub: SUB_TITLES[sub] ? sub : null });
}

// F271: the choice and This iPhone's groups as a box of their own, for the top of Settings > Installation & Signing
// (screens/settings.js puts it above the Certificate and Provisioning Profile groups). It repaints only itself.
export function installationBlock({ store, native = nativeBridge(), alert = showAlert } = {}) {
  const box = document.createElement("div");
  box.className = "install-route";
  const redraw = () => paintInstallation(box, { store, native, alert, redraw });
  redraw();
  return box;
}

// F300: a tap on Install Apps With's choice is checked at once, whatever the pairing (this page shows Pairing right
// under it, and Installation & Signing's status says Pair This iPhone until it's paired); nothing waits on a call.
export function pickRoute(v, { set }) {
  return set(v === "iphone" ? "iphone" : "server");
}

// F284: `sub` "iphone" draws only This iPhone's groups (whatever the choice); F300: "with" draws them all (the choice
// and the chosen route's groups).
export const subGroups = (sections, sub) => (sub === "iphone" ? sections.slice(1) : sections);

let picked = null; // F300: the choice just tapped, until idevice.status answers on the page it redrew
const painting = new WeakMap(); // page element → its latest paintInstallation (an older one stops painting)
const redraws = new WeakMap(); // F414: page element → its redraw, for refreshInstallation
let testing = false; // F301: Test Connection runs (its row spins; a second tap waits for it)
let fixing = false; // F409: the Fix row's check runs (its row spins)
let pairChecking = false; // B320: Install Apps With's check of the kept pairing runs (the Pairing row spins)

async function paintInstallation(el, { store, native, alert, redraw, server = () => [], sub = null }) {
  const choice = sub === "iphone" ? "iphone" : store.get(ROUTE_KEY);
  const me = {};
  painting.set(el, me);
  const mine = () => painting.get(el) === me;
  redraws.set(el, redraw);
  // F301: what the rows show (the last answer at first, then each part as it answers) and each part's state
  let view = lastStatus;
  const cached = Boolean(view);
  const got = { device: false }, late = { device: false };
  // B320: recheckPairing's spinner here: the Pairing row, not the HUD
  const pairSpin = () => { pairChecking = true; paint(); return () => { pairChecking = false; redraw(); }; };
  // F414: the page's check: a failure paints before its question; Check Connection here keeps the pick (F392)
  const asPicked = { get: () => "iphone", set: () => {} };
  // Drawn again once the answer is kept, under its alert and after it; no automatic check right behind this one
  const settled = () => { fixing = testing = false; AUTO_CHECK.last = Date.now(); redraw(); };
  const ask = async (q) => {
    settled();
    const r = await alert(q);
    if (r?.index === 1 && q.buttons?.[1] === FIX) { fixing = true; redraw(); } // Fix goes on: Checking… again
    return r;
  };
  const runCheck = async (how = {}) => {
    if (fixing || testing) return;
    fixing = true;
    paint();
    try { await check(native, ask, redraw, sub === "iphone" ? asPicked : store, null, how); } finally { settled(); }
  };
  const runTest = async () => {
    if (testing || fixing) return;
    // F372: the built-in VPN's test (on, one connect with the pairing, off); not paired yet: Pairing first
    if (!(view ?? lastStatus)?.paired) return goTo("pair");
    testing = true;
    paint();
    try { await vpnTest(native, ask, store); } finally { settled(); }
  };
  // F417b: Use Shortcut adds the Shortcut first, unless it's added already
  const repaint = () => { if (mine()) paint(); else redraws.get(el)?.(); }; // drawn again meanwhile
  const addShortcut = async () => {
    if (addingShortcut) return false;
    addingShortcut = true;
    paint();
    try { return await (await shortcutSetup()).setUpShortcut(native, { alert }); } finally { addingShortcut = false; await readShortcut(); repaint(); }
  };
  let cellTap = 0;
  const pickCellular = async (v) => {
    const tap = ++cellTap;
    if (v === "shortcut" && v !== onCellularChoice() && !lastShortcut?.added && !(await addShortcut())) return;
    if (tap !== cellTap) return; // another tapped meanwhile
    setOnCellular(v);
    repaint();
  };
  const readShortcut = async () => {
    if (native?.call) lastShortcut = await (await shortcutSetup()).readShortcut(native) ?? { available: false, added: false };
  };
  // F420: adds the Shortcut unless it's added, then its store run remembers the VPN that is on
  const setUpRestore = async (turnedOn = false) => {
    if (settingRestore || typeof (lastStatus ?? view)?.vpn?.remembered !== "boolean") return; // an older shell
    settingRestore = true;
    repaint();
    let can = true;
    try {
      const fresh = async () => {
        const { st } = await readStatus(native);
        if (st) rememberStatus(st);
        return lastStatus;
      };
      can = await (await restoreSetup()).setUpRestore(native, { alert, status: fresh, turnedOn });
      await fresh();
    } finally { settingRestore = false; redraws.get(el)?.(); }
    if (!can) await restoreToggles.get(el)?.(false); // it can't run here
  };
  // F412: shown at once; a call that fails reads the setting again (no answer: as it was)
  restoreToggles.set(el, async (on) => {
    const st = lastStatus ?? view;
    if (!st) return;
    const tap = restoreTap = { on, at: Date.now(), was: restoreTap?.sending ? restoreTap.was : Boolean(st.vpn?.restore), sending: true };
    rememberStatus(st);
    view = lastStatus;
    paint();
    try { await within(setRestoreVPN(native, on), TIMEOUTS.status); tap.sending = false; } catch {
      const read = (await readStatus(native)).st;
      if (restoreTap !== tap) return; // tapped again meanwhile
      restoreTap = null;
      if (read) rememberStatus(read);
      else if (lastStatus) rememberStatus({ ...lastStatus, vpn: { ...lastStatus.vpn, restore: tap.was } });
      redraw();
      return;
    }
    if (on && restoreTap === tap) await setUpRestore(true);
  });
  const paint = () => {
    if (!mine()) return;
    const devWait = !got.device && !late.device;
    const sections = installationGroups(choice, view, {
      reading: devWait && !cached,
      late, testing, fixing, pairChecking,
      hint: lastStatus, server, picking: devWait && picked === choice,
      failure: choice === "iphone" ? routeFailure() : null, // B316
      fix: () => {
        const f = routeFailure();
        if (f?.fix === "pair" && !checking) return goTo("pair");
        if (!(view ?? lastStatus)?.vpn?.tested) return runTest(); // F414: setting up: the test again, which finishes it
        return runCheck({ fix: true });
      },
      checkNow: () => runCheck(),
      forget: async () => {
        await busy("Forgetting Pairing", () => call(native, "idevice.forget").catch(() => {}));
        forgetStatus();
        clearRouteFailure(); // the forgotten pairing's
        store.set(ROUTE_KEY, "server");
        redraw();
      },
      // the store's set redraws Settings' pages (this one too); a store that doesn't, redraws it here
      pick: (v) => {
        if (v === choice && !picked) return;
        picked = v; pickRoute(v, { set: (r) => store.set(ROUTE_KEY, r) }); if (mine()) redraw();
        if (v === "iphone" && v !== choice) recheckPairing(native, alert, redraw, { spin: pairSpin }); // B220: set up again, the kept pairing checked
      },
      test: () => runTest(),
      cellular: onCellularChoice(),
      setCellular: (v) => pickCellular(v),
      shortcut: lastShortcut ? lastShortcut.available : onCellularChoice() === "shortcut",
      adding: addingShortcut, addAgain: () => addShortcut(),
      remembering: settingRestore, remember: () => setUpRestore(),
    });
    const shown = subGroups(sections, sub);
    const restore = Boolean((view ?? lastStatus)?.vpn?.restore);
    patchGroups(el, shown, (s) => {
      const frag = dressRestore(dressStatus(spinRows(warnFooters(s), s), s), el, restore);
      for (const d of frag.querySelectorAll?.(".cell-detail") ?? []) if (d.textContent === "Another VPN" || d.textContent === NOT_RESPONDING || d.textContent === FAILING) d.classList.add("install-red");
      return frag;
    });
    syncRestore(el, restore);
  };
  paint();
  // F301: idevice.status is read for the Signing Server choice too (the choice row's spinner waits on it)
  await readStatus(native).then(({ st }) => {
    if (!mine()) return;
    got.device = Boolean(st);
    late.device = !st; // failed or too slow: Not Responding (a failure says no more than that)
    if (st) {
      rememberStatus(st);
      view = lastStatus;
    }
    // B316: opened after a failure: the pairing is checked by itself; the page repaints when it passes or fails
    if (st?.paired && choice === "iphone") autoCheck(native, alert, () => { if (mine()) paint(); }, store);
    if (st?.paired && builtinVPN(st)) readShortcut().then(() => { if (mine()) paint(); }).catch(() => {}); // F417b: after the page is painted
    const wasPicked = picked === choice;
    if (wasPicked) picked = null;
    if (choice !== "iphone" && !wasPicked) return; // nothing on the page waited on the answer
    paint();
  });
}

// F301: a repaint of a page's groups changes only what changed, in place: a group whose rows are the same keeps its
// element and only the rows whose content changed are swapped (a detail, a spinner, a checkmark), a footer's text is
// set on the footer that's there, and only groups that come, go or change their rows are rebuilt. Moves slide
// (nav/slide.js's watcher, measured right around the change by slideChange). Rows kept from an earlier draw call the latest draw's handlers (each tap goes through a holder).
// `grow`: a keyed group whose rows come and go at its end keeps its element, so the rows before them (a switch) stay.
// `build(sections)` makes the groups' DOM (grouped() and what the page adds to it).
const sigOf = (r) => JSON.stringify(r, (k, v) => (typeof v === "function" ? "ƒ" : v));
export function patchGroups(box, sections, build) {
  const holders = sections.map((s) => (s.rows ?? []).map((r) => {
    if (!r?.onClick) return null;
    const h = { f: r.onClick };
    r.onClick = (e) => h.f(e);
    return h;
  }));
  const fresh = [...build(sections).children];
  const keyOf = (s) => s.key || s.header || s.rows?.[0]?.label || (s.spinner ? "spinner" : "");
  const frameOf = (s) => sigOf({ h: s.header, w: s.warn, f: Boolean(s.footer), rows: s.grow ? null : s.key ? s.rows.length : (s.rows ?? []).map((r) => [r.label, r.cls, Boolean(r.href), Boolean(r.onClick)]) });
  fresh.forEach((g, i) => {
    const s = sections[i];
    g.__key = keyOf(s);
    g.__frame = frameOf(s);
    g.__footer = s.footer ?? "";
    const ul = [...g.children].find((c) => c.classList?.contains("table"));
    [...(ul?.children ?? [])].forEach((li, j) => { li.__sig = sigOf(s.rows[j]); li.__h = holders[i][j]; });
  });
  slideChange(box, () => {
    const old = [...box.children];
    const used = new Set();
    const next = fresh.map((g, gi) => {
      const s = sections[gi];
      const o = old.find((x) => !used.has(x) && x.__key === g.__key && x.__frame === g.__frame);
      if (!o) return g;
      used.add(o);
      const oul = [...o.children].find((c) => c.classList?.contains("table"));
      const nul = [...g.children].find((c) => c.classList?.contains("table"));
      if (oul && nul) {
        const lis = [...oul.children], nlis = [...nul.children];
        let changed = false;
        const keep = nlis.map((n, j) => {
          const k = lis[j];
          if (k && k.__sig === n.__sig) { if (k.__h && n.__h) k.__h.f = n.__h.f; return k; }
          changed = true;
          return n;
        });
        if (s.grow) { // the kept ones aren't moved: that would end a knob's slide
          keep.forEach((n, j) => { if (n !== lis[j]) { if (lis[j]) lis[j].replaceWith(n); else oul.append(n); } });
          for (const k of lis.slice(keep.length)) k.remove();
        } else if (changed) oul.replaceChildren(...keep);
      }
      if (o.__footer !== g.__footer) {
        const f = o.querySelector?.(".group-footer");
        if (f) f.textContent = g.__footer;
        o.__footer = g.__footer;
      }
      return o;
    });
    if (next.length !== old.length || next.some((g, i) => g !== old[i])) box.replaceChildren(...next);
  });
}

// grouped() with the footers of groups marked `warn` in red (ios6.css .sign-warning, as Settings > Signing's).
function warnFooters(sections) {
  const frag = grouped(sections);
  [...frag.children].forEach((g, i) => { if (sections[i]?.warn) g.querySelector?.(".group-footer")?.classList.add("sign-warning"); });
  return frag;
}

// B220: choosing This iPhone again with a pairing kept used to skip the pairing, and every connect was then refused.
// The kept pairing is checked once (the VPN route on); when the phone no longer accepts it
// (verifyFailure's `unusable`: refused, or turned down) it is forgotten and the pair step runs again on Pairing. Other
// failures (the VPN off, no answer) say nothing here: Check Connection explains them.
// A refusal is tried again once after `retryMs` before the pairing is forgotten: remotepairingd restarting (the VPN
// just came back) refuses for a moment, and redoing the pair step costs the user the 6-digit code.
// B320: a pairing the phone answers and then drops (turnedDown, e.g. "connection invalidated" seen on the iPhone 15 Pro)
// is tried once more too, and still dropped it is forgotten and pairing starts by
// itself, as a refused one: the user was left to find Forget Pairing. `spin(label)` (returning its stop) spins the
// page's own row instead of the HUD.
export const recheckHooks = { goPair: () => goTo("pair"), retryMs: 3000 }; // tests
// B320: the phone itself turned the kept pairing down: refused everywhere (verifyFailure's `unusable`), or it answered
// and then dropped it (the shell's pair_again, an early EOF, B416: a reset, the channel "invalidated"), or (F409) the kept pairing can't be read or is missing. A timeout or any other failure
// isn't the pairing's fault and never forgets it.
export function turnedDown(why, err) {
  if (!why || why.late) return false;
  if (why.unusable) return true;
  const raw = String(err?.message ?? err ?? "");
  const code = err?.code ?? raw.split(":")[0];
  return Boolean(why.again) && (code === "bad_pairing" || code === "not_paired" || droppedPairing(code, raw) || /invalidat|early eof|UnexpectedEof/i.test(raw));
}
// B428a: on cellular it can't tell: nothing is checked, kept or forgotten; `tell`: Fix or Pair Again asked for it, so it says so.
export async function recheckPairing(native, alert, redraw, { spin = null, tell = false } = {}) {
  const st = await status(native);
  if (!st?.paired || !builtinVPN(st)) return "skipped";
  const sayCellular = async (s) => { if (tell) await alert(cellularCheck(s)); return "cellular"; };
  if (onCellular(st)) return sayCellular(st);
  const verify = async () => {
    await quietRun; // F410b
    try { await within(call(native, "idevice.verify"), TIMEOUTS.verify); return null; } catch (e) { lastErr = e; return isLate(e) ? { late: true } : verifyFailure(e, st); }
  };
  let lastErr = null; // B316: what the failed check is kept as
  const work = async () => {
    const first = await verify();
    if (!turnedDown(first, lastErr)) return first;
    await new Promise((r) => setTimeout(r, recheckHooks.retryMs));
    return verify();
  };
  let why;
  if (spin) { const stop = spin("Checking Pairing"); try { why = await work(); } finally { stop(); } } else why = await busy("Checking Pairing", work);
  if (!why) { clearRouteFailure(); return "ok"; } // B316: after a sign-in or a new way in, the pairing answered: green again
  const cell = why.late ? null : await refusedOnCellular(native, lastErr);
  if (cell) return sayCellular(cell);
  if (!turnedDown(why, lastErr)) { rememberRouteFailure(why.late ? NO_ANSWER_FAILURE : routeFailureOf(lastErr, st)); return "failed"; } // B316
  await busy("Forgetting Pairing", () => call(native, "idevice.forget").catch(() => {}));
  forgetStatus();
  if (visit) visit.started = false;
  const how = why.unusable ? ", so every connection was refused" : "";
  await alert({ title: why.title, message: `This iPhone no longer accepts ${NAME}'s pairing${how}. Pairing starts again now.`, buttons: ["OK"] });
  if (typeof location !== "undefined" && onPairPage()) redraw(); else recheckHooks.goPair();
  return "repair";
}

// ---- Installation & Signing's main page (F284, option B of the concept)
// Built once and updated in place: every row is there from the first frame, and an answer from the bridge only fills
// a slot (the grey spinner while it loads, then the value fades in: opacity only, settings.css .value-slot). Answers
// never add or remove rows or change footers; only a tap changes the layout (by opening another page).
//   (top)         the status cell (core installStatus: two lines, always two lines tall) and one action row whose
//                 label changes (Check Connection, Fix, Start Pairing…)
//   Install Apps With  F372/F392: This iPhone and Signing Server: a tap uses that way (a checkmark on the one in use),
//                 the detail disclosure opens its page (installation/iphone: Set Up, How It Works; installation/server)
//   Signing       Certificate > (days left), Signed Apps > (count)
//   How Signing Works >
// `links` holds the hrefs, `signing()` resolves {certificate: {text, red}, ready} (`ready`: a certificate kept; false turns
// the status cell into Import Your Certificate, B250), `apps()` the Signed Apps count (text),
// `checkServer` is Settings' Check Server and `host()` the Signing Server's host.
export const MAIN_ROWS = ["status", "action", "iphone", "server", "certificate", "apps", "help"]; // F372: both ways

// F300/F351: Install Apps With's detail on the main page: This iPhone's pairing once idevice.status said (`st`
// undefined: not answered yet; null: it failed). The route itself is the row's label, subtitle and icon (ROUTE_ICON).
// B316: paired, with the last check or install failed (`failure`, core routeFailure): "Failing", red, until a check
// passes (the user's page said a green Paired while every install was refused).
export const FAILING = "Failing";
export function withDetail(choice, st, failure = null) {
  if (choice !== "iphone" || !st) return "";
  return st.paired ? (failure ? FAILING : "Paired") : "Not Paired";
}
// F351: each route's row icon (icons/rowicons.js), on the main page and the Install Apps With page.
const ROUTE_ICON = { server: "signingServer", iphone: "installation" };

function slotOf(node, waitText = null) {
  const value = el("span", "slot-value");
  const wait = el("span", "slot-wait", waitText);
  if (waitText == null) { wait.className = "slot-wait loading-spinner"; wait.setAttribute("aria-hidden", "true"); }
  node.classList.add("value-slot", "is-loading");
  node.replaceChildren(value, wait);
  return { node, value,
    set(text, { red = false } = {}) { value.textContent = text ?? ""; value.classList.toggle?.("install-red", red); node.classList.remove("is-loading"); },
    wait() { node.classList.add("is-loading"); } };
}

export function mainPage({ store, native = nativeBridge(), alert = showAlert, links, signing = async () => null, apps = async () => "",
  checkServer = () => {}, host = () => "" } = {}) {
  const box = el("div", "signing-page install-main");
  let now = CHECKING; // the status cell's answer (core installStatus)
  let busyNow = false;
  const act = async () => {
    if (now.state === "checking" || busyNow) return;
    busyNow = true;
    try { await runAction(now.action, now.fix); } finally { busyNow = false; }
  };
  const sections = [
    { rows: [{ label: "", subtitle: " ", cls: "install-status" }, { label: STATUS_ACTIONS.check, cls: "install-action", onClick: act }] },
    // F372/F392: both ways, a row each (its icon, name and one line). A tap on the row uses it (This iPhone not set up
    // yet: its setup opens, and finishing it uses it) and its disclosure opens its page.
    { header: "Install Apps With", rows: ROUTE_OPTIONS.map((o) => ({ label: o.label, subtitle: o.subtitle, icon: rowIcon(ROUTE_ICON[o.value]),
      onClick: () => use(o.value), cls: "route-pick" })),
      footer: "Tap one to install that way." },
    { header: "Signing", rows: [{ label: "Certificate", detail: "", href: links.certificate, icon: rowIcon("signing") },
      { label: "Signed Apps", detail: "", href: links.apps, icon: rowIcon("websiteApps") }] },
    { rows: [{ label: "How Signing Works", href: links.help, icon: rowIcon("help") }] },
  ];
  box.append(grouped(sections));
  const cells = [...box.querySelectorAll(".cell-inner")];
  const [statusCell, actionCell] = cells;
  const icon = el("span", "status-icon tone-wait");
  icon.setAttribute("aria-hidden", "true");
  statusCell.prepend(icon);
  const title = slotOf(statusCell.querySelector(".cell-label"), CHECKING.title);
  const subtitle = slotOf(statusCell.querySelector(".cell-subtitle"), CHECKING.subtitle);
  const actionLabel = actionCell.querySelector(".cell-label");
  const checkButton = checkMark(actionCell); // B135: Check Connection's answer on the action row
  actionCell.classList.add("is-dim");
  actionCell.setAttribute("aria-disabled", "true");
  // F392: the checkmark on the way in use (both rows have one, shown by opacity: settings.css .route-pick) and, beside
  // the row's button, iOS's detail disclosure, the link to that way's page.
  const routeCells = { iphone: cells[2], server: cells[3] };
  for (const o of ROUTE_OPTIONS) {
    const c = routeCells[o.value];
    const tick = el("span", "cell-check");
    tick.setAttribute("aria-hidden", "true");
    c.append(tick);
    const acc = el("a", "cell-accessory");
    acc.href = route(o.value);
    acc.setAttribute("aria-label", `${o.label} Settings`);
    c.parentElement.append(acc);
  }
  const showRoute = (choice) => {
    for (const [v, c] of Object.entries(routeCells)) {
      const on = v === (choice === "iphone" ? "iphone" : "server");
      c.parentElement?.classList.toggle("route-on", on);
      c.setAttribute("aria-pressed", String(on));
    }
  };
  const use = (v) => {
    if (v === "iphone" && !iphoneSetUp(known ?? lastStatus)) { setUseAfterSetup(true); return goTo("iphone"); } // not set up: its setup
    showRoute(v);
    // the store's change redraws the page; it waits for the checkmarks to fade
    if (store.get(ROUTE_KEY) !== v) setTimeout(() => {
      store.set(ROUTE_KEY, v); refresh();
    }, 260);
  };
  const slots = { with: slotOf(el("span", "cell-detail")) }; // This iPhone's pairing is said on its own page now
  ["certificate", "apps"].forEach((k, i) => { slots[k] = slotOf(cells[i + 4].querySelector(".cell-detail")); });

  let known; // idevice.status once read
  let certRead = false; // B250: signing() has answered once (or failed)
  let certificate; // B250: signing.status has an identity (signing()'s `ready`); undefined until read
  const paintStatus = (s) => {
    now = s;
    icon.className = `status-icon tone-${s.tone}`;
    title.set(s.title, { red: Boolean(s.red) });
    subtitle.set(s.subtitle);
    if (checkButton.active() && s.action !== "check") checkButton.reset();
    if (!checkButton.active()) actionLabel.textContent = STATUS_ACTIONS[s.action];
    const dim = s.state === "checking"; // CHECKING, or CHECKING_SERVER (B250)
    actionCell.classList.toggle("is-dim", dim);
    if (dim) actionCell.setAttribute("aria-disabled", "true"); else actionCell.removeAttribute?.("aria-disabled");
  };
  // Each source's answers land in order: an older read never paints over a newer one.
  let asked = 0, statusShown = 0, signingShown = 0, appsShown = 0, lastChoice = null;
  // B316: the remembered failure set or cleared (an install, a check on another page): the cell repaints at once
  let cellOf = null;
  const showWith = (c, st) => { const f = routeFailure(); const t = withDetail(c, st, f); slots.with.set(t, { red: t === FAILING }); };
  const onFailure = () => {
    if (box.isConnected === false && cellOf) { globalThis.removeEventListener?.("ifizbox:route-failure", onFailure); return; }
    if (cellOf && statusShown && now.state !== "checking") { const c = store.get(ROUTE_KEY); paintStatus(cellOf(c, known)); if (c === "iphone") showWith(c, known); }
  };
  globalThis.addEventListener?.("ifizbox:route-failure", onFailure);
  // F409: Fix tapped in an install's alert or Log: the check starts here at once, spinning on the action row
  const onFix = () => {
    if (box.isConnected === false) { if (cellOf) globalThis.removeEventListener?.("ifizbox:route-fix", onFix); return; }
    if (box.getClientRects?.().length === 0) return; // a page under another one
    if (store.get(ROUTE_KEY) === "iphone" && takeFix()) fixCheck();
  };
  globalThis.addEventListener?.("ifizbox:route-fix", onFix);
  // B316: `auto` false: the redraw after a check (a tap's, or the automatic one) never starts another automatic check
  const refresh = async ({ auto = true } = {}) => {
    const n = ++asked;
    const choice = store.get(ROUTE_KEY);
    showRoute(choice);
    const h = host();
    // B250: the Signing Server route says nothing until signing.status first answers (no Ready without a certificate)
    const cell = (c, st) => (c !== "iphone" ? (certRead ? installStatus(c, undefined, { host: h, certificate }) : CHECKING_SERVER)
      : installStatus(c, st, { host: h, certificate, failure: routeFailure() })); // B316: a failed check or install shows until one passes
    cellOf = cell;
    if (choice !== "iphone") { paintStatus(cell(choice)); slots.with.set(withDetail(choice)); }
    else if (lastChoice && lastChoice !== choice) { paintStatus(CHECKING); title.wait(); subtitle.wait(); slots.with.wait(); } // just picked
    else if (!lastChoice && lastStatus) { paintStatus(cell(choice, lastStatus)); showWith(choice, lastStatus); } // F301: the last answer at once
    lastChoice = choice;
    onFix();
    const reads = [
      status(native).then((st) => {
        if (n < statusShown) return;
        statusShown = n;
        known = st;
        rememberStatus(st);
        const c = store.get(ROUTE_KEY);
        paintStatus(cell(c, st));
        showWith(c, st);
        // B316: opened after a failure: Check Connection runs by itself (its button spins), quietly
        if (auto && c === "iphone" && st?.paired && box.isConnected !== false) autoCheck(native, alert, after, store, checkButton);
      }),
      Promise.resolve().then(signing).catch(() => null).then((v) => {
        if (n < signingShown) return;
        signingShown = n;
        // B250: no certificate kept: the status cell says Import Your Certificate (and back once one is)
        const had = certificate, first = !certRead;
        certificate = typeof v?.ready === "boolean" ? v.ready : undefined;
        certRead = true;
        const c = store.get(ROUTE_KEY);
        if (certificate !== had || (first && c !== "iphone")) {
          // This iPhone with this refresh's idevice.status still out: Checking… until it answers
          const st = c !== "iphone" ? undefined : statusShown === n ? known : undefined;
          paintStatus(cell(c, st));
        }
        slots.certificate.set(v?.certificate?.text ?? "Unknown", { red: Boolean(v?.certificate?.red) });
      }),
      Promise.resolve().then(apps).catch(() => "").then((v) => {
        if (n < appsShown) return;
        appsShown = n;
        slots.apps.set(v ?? "");
      }),
    ];
    await Promise.all(reads);
  };
  const after = () => refresh({ auto: false });
  const fixCheck = () => check(native, alert, after, store, checkButton, { fix: true }).then(after);
  const runAction = async (a, fix) => {
    if (a === "fix") return fix === "pair" && !checking ? goTo("pair") : fixCheck(); // F409
    if (a === "check") return check(native, alert, after, store, checkButton).then(after);
    if (a === "checkServer") return checkServer();
    if (a === "setup") return goTo("iphone"); // F414
    if (a === "certificate") return navGo(links.certificate); // B250: the Certificate page, as its row opens
  };
  return { el: box, refresh, known: () => known, status: () => now };
}

// ---- This iPhone's page

let pairing = null; // { pin, text, error } while idevice.pair waits for the phone (core pairEvent)
let shown = null; // { native, redraw } of the page on screen, for the hooks below
let visit = null; // this visit of the page: { started, asked, failed, expired, run, poll }; null once it's left

// The page's groups for `state` (core setupState) and the pairing `p` (pure, for tests). The code and the steps
// with their screenshots are drawn after the groups marked `pin` and `guide` (drawPair).
// "checking" is drawn at once while idevice.status answers, with a spinner (`spinner` marks the group). "noVPN"
// says the profile has no Network Extensions (core NO_VPN).
export const IMPORT_PAIRING = "Import Pairing File";
export const TESTING_AFTER_PAIRING = "Testing the Connection…";
export function setupGroups(state, st, p, { retry = () => {}, check = () => {}, forget = () => {}, failed = false, expired = false, failing = false,
  importFile = () => {} } = {}) {
  const intro = { header: "Install on This iPhone", footer: IPHONE_INTRO };
  if (state === "paired") {
    return [intro,
      { rows: [{ label: "Paired", checked: true, cls: "pair-done" }] },
      { rows: [{ label: failing ? FIX : STATUS_ACTIONS.check, cls: "sign-import", onClick: check }],
        footer: `Checks that ${NAME} can reach this iPhone through ${BUILTIN_VPN}.` },
      { rows: [{ label: "Forget Pairing", cls: "sign-import", onClick: forget }] }];
  }
  // F317: one group per numbered step (AGENTS.md, Hints), never the steps joined into one footer; the last step's
  // group holds Import Pairing File, the row its footer names
  if (state === "file") {
    const last = PAIR_STEPS.file.length - 1;
    return [intro, ...PAIR_STEPS.file.map((s, i) => ({ ...(i ? {} : { header: "Pair This iPhone" }),
      ...(i === last ? { rows: [{ label: IMPORT_PAIRING, cls: "sign-import", onClick: importFile }] } : {}), footer: `${i + 1}. ${s}` }))];
  }
  if (state === "checking") return [intro, { spinner: "Checking…" }];
  if (state === "testing") return [intro, { spinner: TESTING_AFTER_PAIRING }]; // B357: pairing's last step (finishSetup)
  if (state === "noVPN") return [intro, { rows: [{ label: "Network Extensions", detail: "Missing" }], footer: NO_VPN.message, warn: true }];
  const conn = { rows: [{ label: BUILTIN_VPN, detail: "On" }] }; // B277: the VPN that's on
  // B436: where the code was, the code's end and a new one (the code pairs nothing any more)
  if (expired && !p) return [intro, conn, { header: "Pairing Code", rows: [{ label: NEW_CODE, cls: "sign-import", onClick: retry }], footer: CODE_EXPIRED },
    { header: "Where to Type It", guide: true }];
  const line = failed && !p ? `Pairing stopped.` : p ? pairFooter(p) : "Starting…";
  // B133: while idevice.pair runs, the code's place spins until the code comes, and the step line spins with it
  // (waiting for the iPhone to connect, pairing) unless a try failed (then it waits on a tap on the iPhone).
  const waiting = Boolean(p && !p.error);
  return [intro, conn,
    p && !p.pin ? { header: "Pairing Code", spinner: "Getting the Code…" } : { header: "Pairing Code", pin: true },
    { header: "Where to Type It", guide: true, ...(waiting ? { spinner: line } : { footer: line }) },
    ...(failed && !p ? [{ rows: [{ label: "Try Again", cls: "sign-import", onClick: retry }] }] : [])];
}

// setupGroups' sections as DOM: the code after the `pin` group, the steps after the `guide` group's header, and the
// grey spinner with its line in the `spinner` group (packages.css .loading; settings.css .pair-wait when it sits in a
// group with a header), and the spinner on rows marked `spin`.
export function pairSections(sections) {
  const frag = spinRows(warnFooters(sections), sections);
  const groups = [...frag.children];
  sections.forEach((s, i) => {
    if (s.pin) groups[i].append(el("p", "pair-code", pinText(pairing?.pin) || "––– –––"));
    if (s.guide) groups[i].querySelector(".group-header").after(pairGuide());
    if (s.spinner) {
      const wait = el("div", s.header ? "loading pair-wait" : "loading");
      wait.setAttribute("aria-busy", "true");
      wait.append(el("span", "loading-spinner"), el("span", null, s.spinner));
      groups[i].append(wait);
    }
  });
  return frag;
}

// The steps: a short line each, and the screenshot of the Settings row to tap, ringed.
export function pairGuide(guide = PAIR_GUIDE) {
  const ol = el("ol", "pair-steps");
  for (const s of guide) {
    const li = el("li", "pair-step");
    li.append(el("span", "pair-step-text", s.text));
    if (s.img) {
      const shot = el("div", "pair-shot");
      const img = el("img", "pair-shot-img");
      img.src = s.img;
      img.alt = `${s.text} in Settings`;
      img.decoding = "async";
      if (s.size) { img.width = s.size[0]; img.height = s.size[1]; } // keeps its height before it loads
      shot.append(img);
      if (s.box) {
        const ring = el("div", "pair-ring");
        Object.assign(ring.style, ringStyle(s.box));
        shot.append(ring);
      }
      li.append(shot);
    }
    ol.append(li);
  }
  return ol;
}

// While pairing, the app is in the background (the code is typed in Settings) and events sent then may never reach
// the page: coming back, it reads the pairing from native, or reads idevice.status again. Leaving the page ends the
// pairing.
// B300: by the page the hash shows, so the Pairing page opened on another page's stack (Install IPAs' Set Up Signing:
// #/home/~installed/myipas/~settings/installation/pair) is the Pairing page too. Pure (hash in), for the tests.
export const isPairHash = (hash) => format(mounted(parse(hash))) === format(mounted(parse(route("pair"))));
function onPairPage() { return isPairHash(location.hash); }
async function reread() {
  if (!shown || document.visibilityState !== "visible") return;
  const { native, redraw } = shown;
  if (!pairing) { if (visit) redraw(); return; }
  let st = null;
  const v = visit, run = v?.run;
  try { st = await call(native, "idevice.pairState"); } catch { return; }
  if (v !== visit || run !== v?.run) return; // another pairing started meanwhile
  const now = pairFromNative(st);
  // B436: expired in the background; idevice.pair's reply may not have reached the page, and is dropped if it comes late
  if (v && pairing && !now && st?.expired) { pairing = null; v.run++; v.failed = v.expired = true; redraw(); return; }
  if (now && pairing) { pairing = now; redraw(); } // not active: idevice.pair's reply settles it
}
export { reread }; // tests
export function leave() { // also for tests: ends a visit without a hashchange
  const was = visit;
  visit = null;
  if (was && pairing && shown) {
    call(shown.native, "idevice.pairCancel").catch(() => {}); // once, not again on the hashchange after Leave
    pairing = null; // B320: coming back starts (or rejoins: the shell keeps it a while) at once, not on this one's answer
  }
}

// B134: leaving the page while a step runs asks first (core leaveQuestion): "pairing" while idevice.pair waits (the
// code coming or being typed), "checking" while the page's spinner waits on idevice.status; null otherwise (paired,
// Try Again: nothing runs that leaving would stop).
export function pendingStep(onPage = onPairPage()) {
  if (!visit || !onPage) return null;
  if (pairing) return "pairing";
  return visit.checking ? "checking" : null;
}

// Asks "Stop Setting Up?"; true when the step is gone (it ended while asking, or Leave: the visit ends and the pairing
// is cancelled, as a plain leave() does). The page itself is left by the caller.
let asking = null;
export function askLeave(alert = showAlert, onPage) {
  const q = leaveQuestion(pendingStep(onPage));
  if (!q) return Promise.resolve(true);
  asking ??= Promise.resolve(alert(q)).then((r) => {
    asking = null;
    if ((r?.index ?? q.cancel) !== LEAVE) return false;
    leave();
    return true;
  }, () => { asking = null; return false; });
  return asking;
}

// The guard sits in the capture phase on the document, ahead of app.js's own handlers: a tap on the nav bar's Back or
// on a tab bar item is held back while asking and replayed (the same element clicked again) after Leave; an edge
// swipe never starts (its pointerdown stops here) and asks once the finger has moved right as a swipe would, then
// Leave goes Back as the nav bar's Back does (nav/go.js back). Any other way off the page (a link from a notification, another app opening a URL)
// still ends the visit and cancels the pairing through the hashchange below.
export const guardHooks = { alert: (q) => showAlert(q) };
let replaying = false;
const EDGE = 24, SLOP = 10; // nav/swipe.js's
export function guardTap(e) {
  if (replaying || !pendingStep()) return;
  const t = e.target?.closest?.(".bar-button.back, #tabbar a.tab");
  if (!t) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  askLeave(guardHooks.alert).then((go) => {
    if (!go || !t.isConnected) return;
    replaying = true;
    try { t.click(); } finally { replaying = false; }
  });
}
let edge = null; // { id, x0, y0 } of a held-back edge swipe
export function guardSwipe(e, back = navBack) {
  if (e.type === "pointerdown") {
    edge = null;
    if (!pendingStep() || !e.target?.closest?.(".edge-swipe") || e.clientX > EDGE) return;
    e.stopImmediatePropagation();
    edge = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
    return;
  }
  if (!edge || e.pointerId !== edge.id) return;
  e.stopImmediatePropagation();
  if (e.type !== "pointermove") { edge = null; return; }
  const dx = e.clientX - edge.x0, dy = e.clientY - edge.y0;
  if (Math.abs(dy) > SLOP && Math.abs(dy) > Math.abs(dx)) { edge = null; return; } // a scroll
  if (dx <= SLOP || dx <= Math.abs(dy)) return;
  edge = null;
  askLeave(guardHooks.alert).then((go) => { if (go) back(); });
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  document.addEventListener("visibilitychange", reread);
  window.addEventListener("pageshow", reread);
  window.addEventListener("hashchange", () => { if (!onPairPage()) leave(); });
  document.addEventListener("click", (e) => guardTap(e), true);
  for (const t of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) document.addEventListener(t, (e) => guardSwipe(e), true);
}

// B357: with the built-in VPN, setting up ends with its test (vpn.test, as Test Connection runs it), right after
// pairing, before the page says Paired: the first test is when iOS asks to add the VPN configuration (the one Allow),
// so setup isn't Done until that's answered. `st` is the idevice.status from before pairing (it has `vpn`).
export const needsTestAfterPairing = (st) => builtinVPN(st) && !st.vpn.tested;
async function finishSetup(v, native, alert, store, redraw) {
  if (visit === v) redraw(); // Testing the Connection…, with the spinner
  const done = () => { if (!v.testing) return; v.testing = false; if (visit === v) redraw(); };
  try { await vpnTest(native, alert, store, { ended: done }); } finally { done(); }
}

// B416: whether this visit (`v`) of Pairing checks the kept pairing first: the last failure was the pairing's (fix
// "pair"), once a visit, and not when this visit paired already.
export const rechecksPairing = (v, failure = routeFailure()) => failure?.fix === "pair" && !v.rechecked && !v.started && !checking;

async function drawPair(box, { store, native, alert, redraw }) {
  shown = { native, redraw };
  visit ??= { started: false, failed: false };
  const v = visit;
  if (v.testing) { box.replaceChildren(pairSections(setupGroups("testing"))); return; } // B357: the test after pairing runs
  // B120: the page draws at once, a spinner while idevice.status answers (a redraw keeps what is on screen).
  if (!pairing && !box.firstChild) { box.replaceChildren(pairSections(setupGroups("checking"))); v.checking = true; } // B134: asked before leaving
  // In pairing mode the page draws from `pairing` alone, without waiting on idevice.status.
  const st = pairing ? null : await status(native);
  if (v !== visit) return; // left while idevice.status answered
  v.checking = false;
  rememberStatus(st);
  const state = setupState(st, pairing);

  const start = async () => {
    if (pairing) return;
    v.started = true;
    v.failed = v.expired = false;
    const run = v.run = (v.run ?? 0) + 1;
    pairing = { pin: "", text: "", error: "" };
    redraw();
    // B320: this visit's events and answer only: an earlier visit's call answering late leaves this one's state alone
    const mine = () => visit === v && v.run === run && pairing !== null;
    try {
      // idevice.pair's first event is the code, before anything listens; it keeps listening until it pairs, the
      // page is left or the code expires (B436)
      await call(native, "idevice.pair", {}, (ev) => { if (mine()) { pairing = pairEvent(pairing, ev); redraw(); } });
      if (visit === v) pairing = null;
      AUTO_CHECK.last = 0; // B316: paired again: the paired page checks at once and goes green on its own
      const test = visit === v && needsTestAfterPairing(lastStatus ?? await status(native)); // no remembered answer: read it
      if (test) v.testing = true; // before the store's set redraws the page
      const used = store.get(ROUTE_KEY) !== "iphone";
      store.set(ROUTE_KEY, "iphone");
      if (test) return finishSetup(v, native, alert, store, redraw);
      if (visit === v) redraw();
    } catch (e) {
      if (visit !== v || v.run !== run) return;
      pairing = null;
      v.failed = true;
      v.expired = codeExpired(e);
      redraw();
      if (!v.expired && e?.code !== "canceled" && e?.code !== "cancelled" && !/^cancel+ed/.test(e?.message || "")) {
        alert({ title: "Couldn't Pair", message: plainSocket(e?.message) || "No answer.", buttons: ["OK"] });
      }
    }
  };

  // B133: after an action that changes what the page is, it draws as Checking (the spinner) while it reads again,
  // instead of leaving the old page up with nothing moving.
  const recheck = () => { if (visit === v && !pairing) box.replaceChildren(); return redraw(); };
  let checkButton = null; // B135: the Check Connection button's answer, set once the rows are drawn
  let input = null; // the pairing file picker, made below for the "file" state
  // B321: in pairing mode st is null (not read again)
  const sections = setupGroups(state, st ?? (pairing ? cachedStatus() : null), pairing, {
    importFile: () => input?.click(),
    failed: v.failed,
    expired: v.expired,
    failing: Boolean(routeFailure()), // F409: the row says Fix
    retry: start,
    check: () => check(native, alert, recheck, store, checkButton, { fix: Boolean(routeFailure()) }),
    forget: async () => {
      await busy("Forgetting Pairing", () => call(native, "idevice.forget").catch(() => {}));
      forgetStatus(); // F301: the cached answer says Paired
      store.set(ROUTE_KEY, "server"); v.started = false; recheck();
    },
  });
  if (state === "paired" && store.get(ROUTE_KEY) !== "iphone") { store.set(ROUTE_KEY, "iphone"); } // picked This iPhone, already paired
  const frag = pairSections(sections);
  const isCheckRow = (r) => r.label === STATUS_ACTIONS.check || r.label === FIX;
  const ci = sections.findIndex((s) => s.rows?.some(isCheckRow));
  if (ci >= 0) {
    const ul = [...(frag.children[ci]?.children ?? [])].find((c) => c.classList?.contains("table"));
    const j = sections[ci].rows.findIndex(isCheckRow);
    checkButton = checkMark(ul?.children[j]?.children?.[0]);
  }
  if (state === "file") {
    input = Object.assign(document.createElement("input"), { type: "file", className: "visually-hidden" });
    input.addEventListener("change", async () => {
      const f = input.files?.[0];
      input.value = "";
      if (!f) return;
      try {
        const data = toBase64(new Uint8Array(await f.arrayBuffer()));
        await busy("Importing", () => call(native, "idevice.import", { data }));
        const test = visit === v && needsTestAfterPairing(lastStatus ?? await status(native));
        if (test) v.testing = true;
        const used = store.get(ROUTE_KEY) !== "iphone";
        store.set(ROUTE_KEY, "iphone");
        if (test) return finishSetup(v, native, alert, store, recheck);
        recheck();
      } catch (e) {
        alert({ title: "Not a Pairing File", message: plainSocket(e?.message) || "That file isn't a pairing for this iPhone.", buttons: ["OK"] });
      }
    });
    frag.querySelector(".sign-import")?.append(input); // F317: the row is in step 2's group (setupGroups)
  }
  box.replaceChildren(frag);

  if (state === "pairing" && !pairing && !v.started) {
    start();
  } else if (state === "paired" && rechecksPairing(v)) {
    // B416: Pair Again after an install: the kept pairing is checked once more, then forgotten and pairing starts
    v.rechecked = true;
    recheckPairing(native, alert, recheck, { tell: true }).then((r) => { if (visit === v && r !== "repair") recheck(); });
  } else if (state === "paired") {
    autoCheck(native, alert, recheck, store, checkButton); // B316: opened after a failure, or just paired again: checks by itself
  }
}

// B135: Check Connection answers on its own button (`mark`, checkMark below): a success is a check and a green
// "Successful" in place of the label, no alert; a failure keeps the alert and puts an x on the button,
// or (F409) Fix, with no x, when the failure is kept.
// F301: the check runs with the spinner on its own button (no HUD) and at most TIMEOUTS.verify. It reads
// idevice.status first (under a second): without the built-in VPN (no Network Extensions) idevice.verify can't
// connect, so the answer (core NO_VPN) comes at once instead.
// B316: a check that passes clears the remembered route failure (Installation & Signing and Home go green); one that
// fails to reach the phone remembers it (core routeFailureOf). `quiet`: the
// automatic check when a page opens after a failure (autoCheck): no alert, the status and the button's x say it.
// A failure's alert offers Fix. F409: `fix`: Fix was tapped: a pairing the phone turned down opens Pairing (which checks
// it once more, then pairs), any other failure says its reason. Fix tapped while a check runs makes that one Fix's.
// checkOnce answers "fix" (Fix tapped in the alert of a plain check) or "pair" (open Pairing), done here once it ended.
async function check(native, alert, redraw, store, mark = null, { quiet = false, fix = false } = {}) {
  if (checking) { // a second tap while it checks
    if (!fix) return;
    Object.assign(checking.how, { quiet: false, fix: true });
    return checking.done;
  }
  const how = { quiet, fix };
  const run = async () => {
    let next;
    try { next = await checkOnce(native, alert, redraw, store, mark, how); } finally { checking = null; }
    if (next === "fix") return check(native, alert, redraw, store, mark, { fix: true });
    if (next !== "pair") return next;
    if (visit) { visit.started = false; visit.rechecked = false; }
    if (typeof location !== "undefined" && onPairPage()) (shown?.redraw ?? redraw)(); else recheckHooks.goPair();
  };
  checking = { how, done: null };
  const done = run();
  if (checking?.how === how) checking.done = done;
  return done;
}
let checking = null; // the check that runs: { how: {quiet, fix}, done }
// B316: opening Installation & Signing, Pairing or Install Apps With after a failed check or install checks by itself,
// at most once every AUTO_CHECK.gapMs (moving between those pages doesn't check again at once).
export const AUTO_CHECK = { gapMs: 15000, last: 0 };
export function autoCheck(native, alert, redraw, store, mark = null, now = Date.now()) {
  if (!routeFailure() || store.get(ROUTE_KEY) !== "iphone" || checking || now - AUTO_CHECK.last < AUTO_CHECK.gapMs) return null;
  AUTO_CHECK.last = now;
  // the gap counts from the end too: a slow check (up to TIMEOUTS.verify) isn't followed by another at once
  return check(native, alert, redraw, store, mark, { quiet: true }).finally(() => { AUTO_CHECK.last = Math.max(AUTO_CHECK.last, Date.now()); });
}

// F410b: the Quiet Pairing Check (core quietCheckDue, quietCheckAllowed): app.js runs it a moment after launch
// (`launch`) and after coming back. Keeps or clears the Route Failure and nothing else: no alert, no spinner, it never
// opens Pairing and never forgets a pairing. Only an answer about the pairing, or every connection refused, is kept,
// and only when a second try says it too (remotepairingd restarting refuses for a moment); a timeout or a VPN that
// didn't start shows no warning. Not while an install runs (`installing()`), the app is away (`visible()`), or a
// check, a test or pairing runs here, the Pairing page included; a check the user starts meanwhile waits for it.
// Answers what it did (tests): "off", "ok", "failed" or "unknown".
let quietRun = null; // the one that runs; a promise that never rejects
export async function quietPairingCheck(native, store, opts = {}) {
  if (quietRun) return "off";
  const run = runQuietCheck(native, store, opts).catch(() => "unknown");
  quietRun = run;
  try { return await run; } finally { quietRun = null; }
}
async function runQuietCheck(native, store, { launch = false, installing = () => false, visible = () => true, storage = globalThis.localStorage, now = Date.now } = {}) {
  const clear = () => visible() && !installing() && !checking && !pairing && !visit && !testing && !fixing && !pairChecking;
  const choice = () => store.get(ROUTE_KEY);
  if (choice() !== "iphone" || !quietCheckDue({ launch, storage, now: now() }) || !clear()) return "off";
  // Status, then the conditions, then the verify: nothing waits in between
  const st = await status(native);
  if (!quietCheckAllowed(choice(), st) || !clear() || !markQuietCheck({ storage, now: now() })) return "off";
  const verify = async () => { try { await within(call(native, "idevice.verify", { quiet: true }), TIMEOUTS.verify); return null; } catch (e) { return e; } };
  const broken = (e) => !isLate(e) && (e?.code === "route_refused" || /^route_refused:/.test(e?.message ?? "") || turnedDown(verifyFailure(e, st), e));
  let err = await verify();
  if (err && broken(err)) {
    await new Promise((r) => setTimeout(r, recheckHooks.retryMs));
    if (!clear()) return "unknown";
    const again = await status(native);
    if (!quietCheckAllowed(choice(), again, { again: true }) || !clear()) return "unknown";
    err = await verify();
  }
  if (choice() !== "iphone" || !clear()) return "unknown"; // changed or left meanwhile: not the pairing's answer
  if (!err) { clearRouteFailure(storage); return "ok"; }
  const f = broken(err) && !(await refusedOnCellular(native, err)) ? routeFailureOf(err, st) : null;
  if (!f || choice() !== "iphone" || !clear()) return "unknown";
  rememberRouteFailure(f, { storage, now: now() });
  return "failed";
}

// F417b: what the check of Cellular Installs failed with; null: it passed, or can't run here.
async function failedShortcut(native) {
  const s = await shortcutSetup();
  return (await s.readShortcut(native))?.available ? s.checkFailed(native) : null;
}

// `how` is read again once the check answers: a Fix tap may have joined it (check)
async function checkOnce(native, alert, redraw, store, mark, how) {
  mark?.reset();
  const stop = mark?.spin() ?? (() => {});
  let st = null;
  // B428a: nothing is kept and no Fix is offered; the button keeps its label
  const cellular = async (s) => {
    const bad = await cellularInstalls(); // F417b: touches no cellular data, so there too
    stop();
    rememberStatus(s);
    if (how.quiet) return redraw();
    await alert(cellularCheck(s));
    await repair(bad);
  };
  // F417b: Use Shortcut chosen: what its Shortcut's check failed with, under the same spinner (it opens Shortcuts: never by itself)
  const cellularInstalls = async () => (how.quiet || onCellularChoice() !== "shortcut" ? null : failedShortcut(native).catch(() => null));
  const repair = async (code, lead) => {
    if (!code) return;
    try { await (await shortcutSetup()).repairShortcut(native, code, { alert }, lead); } catch { /* not the connection's failure */ }
  };
  try {
    st = await status(native);
    rememberStatus(st);
    if (onCellular(st)) return await cellular(st);
    if (st && !builtinVPN(st)) { stop(); throw Object.assign(new Error("connect_failed: no Network Extensions"), { code: "connect_failed" }); }
    await quietRun; // F410b: one at a time with the phone; this one's deadline starts after it
    await within(call(native, "idevice.verify", ...(how.quiet ? [{ quiet: true }] : [])), TIMEOUTS.verify);
    const noShortcut = await cellularInstalls();
    stop();
    clearRouteFailure(); // B316
    const used = store.get(ROUTE_KEY) !== "iphone";
    if (used) store.set(ROUTE_KEY, "iphone"); // a set redraws Settings' pages, and the mark with them
    mark?.show(!noShortcut);
    if (how.quiet) redraw();
    if (noShortcut) {
      await repair(noShortcut, "This iPhone answered, but the Shortcut for cellular data failed. ");
      mark?.expire();
    }
  } catch (e) {
    const cell = await refusedOnCellular(native, e); // still spinning while it's read
    if (cell) return await cellular(cell);
    stop();
    const why = isLate(e)
      ? { title: NOT_RESPONDING, message: `This iPhone didn't answer in ${TIMEOUTS.verify / 1000} seconds. Check that the VPN is on, then check again.`, again: false }
      : verifyFailure(e, st);
    rememberRouteFailure(isLate(e) ? NO_ANSWER_FAILURE : routeFailureOf(e, st)); // B316
    if (routeFailure()) mark?.fix(); else mark?.show(false); // F409: Fix, with no x
    if (how.quiet) { mark?.expire(); redraw(); return undefined; }
    try {
      if (how.fix && turnedDown(why, e)) return "pair";
      // F414: a failed check asks to fix; Fix checks again from the start, or pairs again
      if (!why.again) {
        if (how.fix) return await alert({ title: why.title, message: why.message, buttons: ["OK"] });
        const { index } = await alert(fixQuestion(why, st)) || {};
        return index === 1 ? "fix" : undefined;
      }
      const { index } = await alert(fixQuestion(why, st)) || {};
      if (index === 1) {
        await busy("Forgetting Pairing", () => call(native, "idevice.forget").catch(() => {}));
        forgetStatus();
        if (visit) visit.started = false;
        // B320: pairing starts by itself on the Pairing page: from Installation & Signing's main page, go there
        if (typeof location !== "undefined" && onPairPage()) redraw(); else recheckHooks.goPair();
      }
    } finally { mark?.expire(); } // the x stays while the alert is up, then the same few seconds
  }
}

// B135: a Check Connection button's answer, drawn on the button (`inner`, its .cell-inner) and gone after
// CHECK_RESET.ms or on the next tap (check() resets it first). show(true): a check and "Successful" in green (settings.css
// .check-mark, [data-check]); show(false): an x beside the label, kept until expire() (after the alert). `active()` is
// true while an answer shows, so the main page's status repaint doesn't write over it.
export const CHECK_RESET = { ms: 3000 };
export function checkMark(inner) {
  let text = STATUS_ACTIONS.check;
  const label = inner?.querySelector?.(".cell-label");
  let timer = null, on = false;
  const reset = () => {
    clearTimeout(timer);
    timer = null;
    if (!on) return;
    on = false;
    inner.setAttribute("data-check", "");
    label.textContent = text;
  };
  const expire = () => { clearTimeout(timer); if (on) timer = setTimeout(reset, CHECK_RESET.ms); };
  const show = (ok) => {
    if (!label) return;
    reset();
    text = STATUS_ACTIONS.check;
    on = true;
    inner.setAttribute("data-check", ok ? "ok" : "fail");
    const mark = el("span", "check-mark", ok ? "✓" : "✕");
    mark.setAttribute("aria-hidden", "true");
    const words = el("span", "check-words", ok ? "Successful" : text);
    label.replaceChildren(mark, words);
    if (ok) expire();
  };
  // F409: the check failed and the failure is kept: Fix, with no mark, until a check passes
  const fix = () => {
    if (!label) return;
    reset();
    text = FIX;
    label.textContent = text;
  };
  // F301: the grey spinner at the button's right end while the check runs; returns its stop
  let spinning = false;
  const spin = () => {
    if (!inner?.append) return () => {};
    const sp = el("span", "loading-spinner");
    sp.setAttribute("aria-hidden", "true");
    inner.append(sp);
    inner.setAttribute("aria-busy", "true");
    spinning = true;
    return () => {
      if (!spinning) return;
      spinning = false;
      if (sp.remove) sp.remove(); else if (Array.isArray(inner.children)) inner.children = inner.children.filter((c) => c !== sp); // tests' small DOM
      inner.setAttribute("aria-busy", "false");
    };
  };
  return { show, fix, reset, expire, spin, active: () => on, spinning: () => spinning };
}

// B148/F414: This iPhone's page (installation/iphone) shown again, Back from Pairing: idevice.status is read again and
// the page painted in place (patchGroups: only what changed).
export async function refreshInstallation(el, sub) {
  if (sub === "pair" || sub === "how" || sub === "server") return; // F372: nothing read there to patch
  return redraws.get(el)?.();
}
