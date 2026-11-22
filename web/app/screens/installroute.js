// Settings > Installation & Signing's install side (sideload build, docs/settings.md): Install Apps With Signing Server /
// This iPhone, and the This iPhone route's pages (core/installroute.js holds the rules and texts):
//   installation       the merged page (screens/settings.js draws it from mainPage below: F284's status cell and
//                      rows, built once and filled in place)
//   installation/with  Install Apps With (F300): the choice (This iPhone / Signing Server, a checkmark), and under it
//                      the chosen route's groups sliding in: This iPhone's (below) or the Signing Server's (Server,
//                      Check Server, Run Your Own: screens/settings.js passes them as `server`)
//   installation/iphone This iPhone: Pairing, the VPN, Open LocalDevVPN (none of the three LocalDevVPN rows when
//                      Tailscale is the way in), Connect With, Tailscale
//   installation/pair  Pairing, one page that runs by itself (core setupState): one sentence on what it gives,
//                      drawn at once with a spinner while it checks, then the VPN: which way is decided from the VPN
//                      apps installed (core vpnRoute: LocalDevVPN's Open, Tailscale's Sign In and Open, a choice when
//                      both are, Install LocalDevVPN when neither is; rechecked when the app comes back), then
//                      pairing starts on its own: the 6-digit code big at the top and where to type it, a line and a
//                      screenshot a step; it keeps pairing while the page is open. Paired: a check, Check Connection
//                      (Pair Again when it fails) and Forget. Older iOS: Import Pairing File.
//   Connect With (Automatic, LocalDevVPN, Tailscale) and Tailscale's Sign In / Test Connection / Sign Out on
//   installation once paired.
// The idevice.* bridge calls are native/sideload/idevice/IDeviceBridge.swift's, tailscale.* native/sideload/tailscale's.
import { grouped, el } from "../nav/ui.js";
import { format, settingsRoute, mounted, parse } from "../router.js";
import { showAlert } from "../nav/alert.js";
import { copyText } from "../nav/menu.js";
import { toBase64 } from "../core/signing.js";
import { vpnRoute, connectAlert, LOCALDEVVPN_STORE } from "../core/installroute.js";
import { openTailscale } from "../core/installroute.js"; // B323
import { ROUTE_KEY, ROUTE_OPTIONS, VPNS, VPN_POLL, vpnList, vpnOn, IPHONE_INTRO, setupState, PAIR_GUIDE, pairEvent, pairFooter, pairFromNative, pinText, PAIR_STEPS, verifyFailure, verifyVPN,
  CONNECT_OPTIONS, connectFooter, tailscaleFooter, tailscaleTestResult } from "../core/installroute.js";
import { ringStyle, vpnWaitText } from "../core/installroute.js";
import { tailscaleRoute } from "../core/installroute.js";
import { leaveQuestion, LEAVE } from "../core/installroute.js";
import { tailscaleVPNOn, installStatus, CHECKING, CHECKING_SERVER, STATUS_ACTIONS } from "../core/installroute.js";
import { routeFailure, rememberRouteFailure, clearRouteFailure, routeFailureOf, NO_ANSWER_FAILURE } from "../core/installroute.js"; // B316
import { NAME, DOMAIN } from "../brand.js";
import { rowIcon } from "../icons/rowicons.js";
import { showHUD } from "../nav/hud.js";
import { slideChange } from "../nav/slide.js";
import { go as navGo, back as navBack } from "../nav/go.js";
import { nativeBridge } from "../native.js";

export const PAGE = "installation";
// F300: Installation & Signing's main page links to Install Apps With (`with`: the choice and the chosen route's
// groups); `iphone` still opens This iPhone's groups alone. The Pairing row opens the setup (`pair`).
export const SUB_TITLES = { pair: "Pairing", iphone: "This iPhone", with: "Install Apps With" };
const VPN = VPNS[0];

const route = (sub) => format(settingsRoute(sub ? [PAGE, sub] : [PAGE]));
const goTo = (sub) => navGo(route(sub));
const call = (native, m, p = {}, ev) => native?.call ? native.call(m, p, ev) : Promise.reject(new Error(`This needs the ${NAME} app.`));
// F301: every call the page waits on has a deadline. Past it the row (or the alert) says Not Responding instead of
// spinning on; a later answer is dropped. idevice.status answers in under a second (VPNCheck: no probe when no tunnel
// is up, both ports at once otherwise), tailscale.status at once (UserDefaults and getifaddrs); idevice.verify and
// tailscale.test talk to iOS or start Tailscale's node, so they get longer.
export const TIMEOUTS = { status: 5000, tailscale: 4000, verify: 20000, test: 25000 };
export const NOT_RESPONDING = "Not Responding";
export function within(p, ms) {
  let t = null;
  const late = new Promise((_, no) => {
    t = setTimeout(() => no(Object.assign(new Error(`not_responding: no answer in ${Math.round(ms / 1000)} s`), { code: "not_responding" })), ms);
    t?.unref?.(); // Node (tests): a deadline alone doesn't keep the process up
  });
  return Promise.race([Promise.resolve(p), late]).finally(() => clearTimeout(t));
}
const isLate = (e) => e?.code === "not_responding";
// idevice.status with its deadline: { st } (null when it failed) and `late` when it didn't answer in time.
async function readStatus(native) {
  try { return { st: (await within(call(native, "idevice.status"), TIMEOUTS.status)) ?? null, late: false }; } catch (e) { return { st: null, late: isLate(e) }; }
}
async function status(native) { return (await readStatus(native)).st; }
async function readTailscale(native) {
  try { return { ts: (await within(call(native, "tailscale.status"), TIMEOUTS.tailscale)) ?? null, late: false }; } catch (e) { return { ts: null, late: isLate(e) }; }
}

// F301: the last idevice.status answer, shown at once the next time a page draws (its rows spinning while it's read
// again). Kept for this run of the app only: after a relaunch the VPN may well be another, so the first read waits.
let lastStatus = null;
export function rememberStatus(st) { if (st && typeof st === "object") lastStatus = st; }
export function forgetStatus() { lastStatus = null; } // tests, and Forget Pairing
export const cachedStatus = () => lastStatus;

// B133: every step that waits on the phone, the network or the pairing shows iOS 6's activity indicator and what it
// does. A one-off action (Check Connection, Forget Pairing, Test Connection, Sign Out, a Connect With pick, importing
// a pairing file, opening another app) runs under the HUD (nav/hud.js: the large white spinner and a label, which
// also eats taps so it isn't started twice); it shows only once the call has taken `delay` ms, so a quick answer
// doesn't flash it. Waits inside a page (status being read, the code coming, the iPhone connecting, the VPN coming
// on, Tailscale signing in) draw the grey spinner in place: a row's `spin` or a group's `spinner` line.
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

// The VPN row's detail from idevice.status.
export function vpnDetail(st) {
  if (!st) return "Unknown";
  if (st.localDevVPN) return "On";
  if (tailscaleVPNOn(st)) return "Off"; // F284: Tailscale's VPN is the route, not another VPN
  return st.otherVPN ? "Another VPN" : "Off";
}

// Tailscale's sign-in while it runs: the step line ("Log in on the page"), or null.
let signingIn = null;
let signInVisit = null; // B143: the pair page's visit that started it (leaving that page stops it), null from the main page

// Install Apps With's groups (pure, for tests): the choice and, under it, the chosen route's groups. This iPhone: its
// state, Connect With and Tailscale; Signing Server: `server()`'s groups (Server, Check Server, Run Your Own).
// `st.tailscale` is tailscale.status's answer (idevice.status carries it).
// B133: `reading`: idevice.status hasn't answered yet: Pairing and the VPN say Checking…, Pairing with the spinner.
// F300: `picking`: the choice was just tapped: its row is checked at once and spins until idevice.status answers.
// `connectBusy`: a Connect With pick whose tailscale.setConnect hasn't answered: checked at once, with the spinner (and
// `connectPick` keeps it checked and spinning while the status read after it runs). `hint`: the last idevice.status
// read, so that while the page reads again the LocalDevVPN rows don't come and go (Tailscale the way in, or not).
// F300: no Developer Mode row (an app can't open without it; an install it stops says so in its alert).
// F301: the page reads idevice.status (Pairing, the VPN) and tailscale.status (Connect With, Tailscale) at once, and
// each part has its own state: `reading` the device part isn't known (`tsReading` the Tailscale part; it defaults to
// `reading`), `refreshing: {device, tailscale}` the rows show the last answer (`st`, cached) with their spinner while
// that part is read again, `late: {device, tailscale}` that part didn't answer in time: its rows say Not Responding.
export function installationGroups(choice, st, { pick = () => {}, openVPN = () => {}, connect = () => {}, signIn = () => {}, test = () => {}, signOut = () => {}, busy = null,
  reading = false, connectPick = null, picking = false, connectBusy = null, hint = null, server = () => [],
  tsReading = reading, refreshing = {}, late = {}, testing = false, failure = null, fix = () => {}, pairChecking = false } = {}) {
  const groups = [{
    header: "Install Apps With",
    rows: ROUTE_OPTIONS.map((o) => ({ label: o.label, subtitle: o.subtitle, cls: "route-row", icon: rowIcon(ROUTE_ROW[o.value].icon), checked: o.value === choice, onClick: () => pick(o.value),
      ...(picking && o.value === choice ? { spin: true } : {}) })),
    footer: choice === "iphone"
      ? `Signed apps go straight to iOS through ${vpnList()}. When it's off, installs use the Signing Server.`
      : "The Signing Server hands iOS each app's install link.",
  }];
  if (choice !== "iphone") return [...groups, ...(server() ?? [])];
  {
    const ts = st?.tailscale ?? null;
    // B167: while idevice.status (tailscale.status with it) hasn't answered, Tailscale's state is unknown, not signed
    // out: its row says Checking… with the spinner (one row, as Sign In is), and Connect With keeps the pick just made.
    const tsUnknown = (tsReading || !st) && !late.tailscale;
    const tsAgain = Boolean(refreshing.tailscale) && !tsUnknown; // F301: the last answer shown while it's read again
    const now = connectBusy ?? (tsUnknown || tsAgain ? connectPick : null) ?? ts?.connect ?? (tsUnknown ? hint?.tailscale?.connect : null) ?? "auto";
    const spinning = connectBusy ?? (tsUnknown || tsAgain ? connectPick : null);
    const viaTs = tailscaleRoute(tsUnknown ? hint : st, now); // F300: no LocalDevVPN rows then
    const devLate = Boolean(late.device), devAgain = Boolean(refreshing.device) && !reading && !devLate;
    // B316: Tailscale signed out with Tailscale's group already offering Sign In: the failure is said there (one
    // Sign In row); any other failure goes in This iPhone's group with its fix row
    const tsSignIn = !busy && !tsUnknown && !(late.tailscale && !ts) && !ts?.signedIn;
    const failTs = Boolean(failure && failure.fix === "signIn" && tsSignIn);
    const failHere = Boolean(failure) && !failTs;
    const failText = failure ? `${failure.title}. ${failure.short}` : "";
    groups.push({
      header: "This iPhone",
      rows: [
        devLate ? { label: "Pairing", detail: NOT_RESPONDING, href: route("pair") }
          : reading ? { label: "Pairing", detail: "Checking…", href: route("pair"), spin: true }
          // B320: `pairChecking`: the kept pairing is checked (recheckPairing): this row spins, no HUD
          : { label: "Pairing", detail: withDetail("iphone", st ?? {}, failure), href: route("pair"), ...(devAgain || pairChecking ? { spin: true } : {}) },
        ...(viaTs ? [] : [
          devLate ? { label: VPN, detail: NOT_RESPONDING }
            : { label: VPN, detail: reading ? "Checking…" : vpnDetail(st), ...(reading || devAgain ? { spin: true } : {}) },
          { label: `Open ${VPN}`, cls: "sign-import", onClick: openVPN },
        ]),
        // B316: the last check or install failed (core routeFailure): its fix row here, and the footer says what's wrong
        ...(failHere && failure.fix !== "openVPN" ? [{ label: failure.button, cls: "sign-import", onClick: fix }] : []),
      ],
      ...(failHere ? { footer: failText, warn: true }
        : viaTs ? {} : { footer: `${VPN} must be on while apps install.` }), // F317: no "(below)": Tailscale's group says its own
    });
    groups.push({
      header: "Connect With",
      rows: CONNECT_OPTIONS.map((o) => ({ label: o.label, checked: o.value === now, onClick: () => connect(o.value), ...(o.value === spinning ? { spin: true } : {}) })),
      footer: connectFooter(now),
    });
    const rows = busy
      ? [{ label: "Signing In…", detail: busy, spin: true }]
      : late.tailscale && !ts ? [{ label: "Tailscale", detail: NOT_RESPONDING }]
      : tsUnknown ? [{ label: "Tailscale", detail: "Checking…", spin: true }]
      : ts?.signedIn
        ? [{ label: "Device", detail: ts.name || NAME, ...(tsAgain ? { spin: true } : {}) },
          { label: "Test Connection", cls: "sign-import", onClick: test, ...(testing ? { detail: "Testing…", spin: true } : {}) },
          { label: "Sign Out", cls: "sign-import", onClick: signOut }]
        : [{ label: "Sign In", cls: "sign-import", onClick: signIn }];
    groups.push({ header: "Tailscale", rows, ...(failTs ? { footer: failText, warn: true } : { footer: tailscaleFooter(ts) }) });
  }
  return groups;
}

// `server`: the Signing Server's groups for Install Apps With's page (screens/settings.js serverSections).
export async function drawInstallation(el, sub, { store, native = nativeBridge(), alert = showAlert, server = () => [] } = {}) {
  const redraw = () => drawInstallation(el, sub, { store, native, alert, server });
  if (sub === "pair") return drawPair(el, { store, native, alert, redraw });
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
let connectBusy = null; // F300: the Connect With pick whose tailscale.setConnect hasn't answered
const painting = new WeakMap(); // page element → its latest paintInstallation (an older one stops painting)
let testing = false; // F301: Test Connection runs (its row spins; a second tap waits for it)
let pairChecking = false; // B320: Install Apps With's check of the kept pairing runs (the Pairing row spins)

async function paintInstallation(el, { store, native, alert, redraw, server = () => [], sub = null }) {
  const choice = sub === "iphone" ? "iphone" : store.get(ROUTE_KEY);
  const me = {};
  painting.set(el, me);
  const mine = () => painting.get(el) === me;
  // F301: what the rows show (the last answer at first, then each part as it answers) and each part's state
  let view = lastStatus;
  const cached = Boolean(view);
  const got = { device: false, tailscale: false }, late = { device: false, tailscale: false };
  // B320: recheckPairing's spinner here: the Pairing row, not the HUD
  const pairSpin = () => { pairChecking = true; paint(); return () => { pairChecking = false; redraw(); }; };
  const paint = () => {
    if (!mine()) return;
    const devWait = !got.device && !late.device, tsWait = !got.tailscale && !late.tailscale;
    const sections = installationGroups(choice, view, {
      reading: devWait && !cached, tsReading: tsWait && !view?.tailscale,
      refreshing: { device: devWait && cached, tailscale: tsWait && Boolean(view?.tailscale) }, late, testing, pairChecking,
      connectPick, connectBusy, hint: lastStatus, server, picking: devWait && picked === choice,
      failure: choice === "iphone" ? routeFailure() : null, // B316
      fix: () => {
        const f = routeFailure();
        if (f?.fix === "signIn") return tailscaleSignIn(native, alert, redraw);
        if (!f || f.fix === "check") return check(native, alert, redraw, store);
        return fixAction(f.fix, native, alert);
      },
      // the store's set redraws Settings' pages (this one too); a store that doesn't, redraws it here
      pick: (v) => {
        if (v === choice && !picked) return;
        picked = v; pickRoute(v, { set: (r) => store.set(ROUTE_KEY, r) }); if (mine()) redraw();
        if (v === "iphone" && v !== choice) recheckPairing(native, alert, redraw, { spin: pairSpin }); // B220: set up again, the kept pairing checked
      },
      openVPN: () => openVPN(native, alert),
      // F300: checked at once with the spinner in its row (no HUD), until setConnect and then the status answer.
      // F301: setConnect answers with tailscale.status, which fills the Tailscale part at once.
      connect: async (v) => {
        if (connectBusy) return;
        connectBusy = v;
        connectPick = v;
        paint();
        let ts = null;
        try { ts = await within(call(native, "tailscale.setConnect", { value: v }), TIMEOUTS.tailscale).catch(() => null); } finally { connectBusy = null; }
        if (ts && typeof ts === "object" && ts.connect && lastStatus) lastStatus = { ...lastStatus, tailscale: ts };
        redraw();
        if (ts) recheckPairing(native, alert, redraw, { spin: pairSpin }); // B220: a new way in, the kept pairing checked over it
      },
      signIn: () => tailscaleSignIn(native, alert, redraw),
      test: async () => {
        if (testing) return;
        testing = true;
        paint();
        try { await tailscaleTest(native, alert, () => { testing = false; paint(); }); } finally { if (testing) { testing = false; paint(); } }
      },
      signOut: async () => {
        const { index } = await alert({ title: "Sign Out of Tailscale?", message: `${NAME} leaves your tailnet. Installs use LocalDevVPN until you sign in again.`, buttons: ["Cancel", "Sign Out"], cancel: 0 });
        if (index !== 1) return;
        let err = null;
        await busy("Signing Out", () => call(native, "tailscale.signOut").catch((e) => { err = e; }));
        if (err) alert({ title: "Couldn't Sign Out", message: err?.message || "No answer.", buttons: ["OK"] });
        redraw();
      },
      busy: signingIn,
    });
    const shown = subGroups(sections, sub);
    patchGroups(el, shown, (s) => {
      const frag = spinRows(warnFooters(s), s);
      for (const d of frag.querySelectorAll?.(".cell-detail") ?? []) if (d.textContent === "Another VPN" || d.textContent === NOT_RESPONDING || d.textContent === FAILING) d.classList.add("install-red");
      return frag;
    });
  };
  paint();
  // F301: both reads at once; each part fills its rows as it answers. idevice.status is read for the Signing Server
  // choice too (the choice row's spinner waits on it); tailscale.status only feeds This iPhone's groups.
  const device = readStatus(native).then(({ st }) => {
    if (!mine()) return;
    got.device = Boolean(st);
    late.device = !st; // failed or too slow: Not Responding (a failure says no more than that)
    if (st) {
      rememberStatus(st);
      view = got.tailscale && view?.tailscale ? { ...st, tailscale: view.tailscale } : st;
      got.tailscale = true;
      connectPick = null; // the answer carries Connect With now
    }
    // B316: opened after a failure: the pairing is checked by itself; the page repaints when it passes or fails
    if (st?.paired && choice === "iphone") autoCheck(native, alert, () => { if (mine()) paint(); }, store);
    const wasPicked = picked === choice;
    if (wasPicked) picked = null;
    if (choice !== "iphone" && !wasPicked) return; // nothing on the page waited on the answer
    paint();
  });
  const tailscale = choice !== "iphone" ? null : readTailscale(native).then(({ ts }) => {
    if (!mine() || got.tailscale) return; // idevice.status brought it first
    if (!ts || typeof ts !== "object") { late.tailscale = true; paint(); return; } // idevice.status may still bring it
    got.tailscale = true;
    view = { ...(view ?? {}), tailscale: ts };
    connectPick = null;
    paint();
  });
  await Promise.all([device, tailscale]);
}

let connectPick = null; // B167: the Connect With pick just made, until idevice.status answers with it

// F301: a repaint of a page's groups changes only what changed, in place: a group whose rows are the same keeps its
// element and only the rows whose content changed are swapped (a detail, a spinner, a checkmark), a footer's text is
// set on the footer that's there, and only groups that come, go or change their rows are rebuilt. Moves slide
// (nav/slide.js's watcher, measured right around the change by slideChange). Rows kept from an earlier draw call the latest draw's handlers (each tap goes through a holder).
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
  const keyOf = (s) => s.header || s.rows?.[0]?.label || (s.spinner ? "spinner" : "");
  const frameOf = (s) => sigOf({ h: s.header, w: s.warn, f: Boolean(s.footer), rows: (s.rows ?? []).map((r) => [r.label, r.cls, Boolean(r.href), Boolean(r.onClick)]) });
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
    const next = fresh.map((g) => {
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
        if (changed) oul.replaceChildren(...keep);
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

// B219: a finished sign-in says nothing and waits for no tap: Settings checks the connection by itself
// (connectAfterSignIn) and only a failure gets an alert; This iPhone's setup page (`from`, its visit) has no pairing
// to test yet: its poll starts pairing once the Tailscale VPN is on, and its rows say what it waits for.
// `spin(label)`: B320, the page's own spinner for the check after it (Settings' main page: its status cell), returning
// its stop; without it the check spins Test Connection's row.
async function tailscaleSignIn(native, alert, redraw, from = null, { spin = null } = {}) {
  if (signingIn) return;
  signingIn = "Starting…";
  signInVisit = from;
  redraw();
  try {
    await call(native, "tailscale.signIn", {}, (ev) => {
      const e = Array.isArray(ev) ? ev[0] : ev;
      if (e?.step === "login") signingIn = "Log in on the page";
      if (e?.step === "approval") signingIn = "Waiting for approval";
      redraw();
    });
    signingIn = null;
    signInVisit = null;
    redraw();
    if (from) return;
    await connectAfterSignIn(native, alert, redraw, { spin });
  } catch (e) {
    signingIn = null;
    signInVisit = null;
    redraw();
    if (!/^cancel+ed/.test(e?.message || "") && e?.code !== "canceled") alert({ title: "Couldn't Sign In", message: e?.message || "No answer.", buttons: ["OK"] });
  }
}

// B219: right after a sign-in the tailnet is still coming up (the node's map without this iPhone yet, the Tailscale
// app's VPN reconnecting), so tailscale.test is tried again every `gapMs` while a failure may pass by itself, until
// `budgetMs` is spent; a failure only the user can fix (approve the device, sign in again, refused, ...) ends it at
// once. Answers { ok, code, ... } as tailscale.test does (not_responding when it didn't answer in TIMEOUTS.test).
export const AFTER_SIGN_IN = { budgetMs: 30000, gapMs: 2500 };
// "error": tailscale.test itself failed (not signed in, the bridge refused it): trying again changes nothing.
// B246: "not_paired": Tailscale reached iOS and iOS has no pairing; only pairing changes that.
const FINAL_CODES = new Set(["needs_approval", "expired", "needs_login", "refused", "not_paired", "error"]);
export async function testUntilConnected(native, now = () => Date.now()) {
  const t0 = now();
  for (;;) {
    let r;
    try { r = await within(call(native, "tailscale.test"), TIMEOUTS.test); } catch (e) { r = isLate(e) ? { ok: false, code: "not_responding" } : { ok: false, code: "error", detail: e?.message }; }
    if (r?.ok || FINAL_CODES.has(r?.code) || now() - t0 + AFTER_SIGN_IN.gapMs >= AFTER_SIGN_IN.budgetMs) return r ?? { ok: false };
    await new Promise((res) => setTimeout(res, AFTER_SIGN_IN.gapMs));
  }
}

// B219: Settings' check after a sign-in: Test Connection's spinner (or the HUD) while testUntilConnected runs, then
// the page redrawn on its connected state with no alert. A connection made, or refused, goes on to B220's check of the
// kept pairing (recheckPairing forgets a refused one and starts pairing again, with its own alert). Any other failure
// shows Test Connection's alert for it. Answers "ok", "repair" or the failing code.
// B320: `spin(label)` (returning its stop) is the page's spinner for both checks, no HUD (docs/settings.md): Settings'
// main page spins its status cell. Without it, Test Connection's row spins; `hud` (no row to spin, no spinner given)
// is the HUD.
export async function connectAfterSignIn(native, alert, redraw, { hud = false, spin = null } = {}) {
  const rowSpin = () => { testing = true; redraw(); return () => { testing = false; redraw(); }; };
  const s = spin ?? (hud ? null : rowSpin);
  let r;
  if (!s) r = await busy("Checking Connection", () => testUntilConnected(native));
  else {
    const stop = s("Checking Connection");
    try { r = await testUntilConnected(native); } finally { stop(); }
  }
  // B246: not_paired with a pairing kept here means the phone forgot it: the same check forgets it and pairs again
  if (r?.ok || r?.code === "refused" || (r?.code === "not_paired" && r.paired)) {
    const how = await recheckPairing(native, alert, redraw, { spin: s });
    if (r.ok) return "ok";
    if (how === "repair" || how === "ok") return how; // ok: the pairing answered after all
  }
  await testAlert(alert, r);
  return r?.code ?? "error";
}

// B220: setting Tailscale up again with a pairing kept used to skip the pairing, and every connect was then refused.
// After a sign-in the kept pairing is checked once (the VPN route on); when the phone no longer accepts it
// (verifyFailure's `unusable`: refused, or turned down) it is forgotten and the pair step runs again on Pairing. Other
// failures (the VPN off, no answer) say nothing here: Check Connection explains them.
// A refusal is tried again once after `retryMs` before the pairing is forgotten: remotepairingd restarting (the VPN
// just came back) refuses for a moment, and redoing the pair step costs the user the 6-digit code.
// B320: a pairing the phone answers and then drops (turnedDown, e.g. "connection invalidated" seen on the iPhone 15 Pro
// right after a Tailscale sign-in) is tried once more too, and still dropped it is forgotten and pairing starts by
// itself, as a refused one: the user was left to find Forget Pairing. `spin(label)` (returning its stop) spins the
// page's own row instead of the HUD.
export const recheckHooks = { goPair: () => goTo("pair"), retryMs: 3000 }; // tests
// B320: the phone itself turned the kept pairing down: refused everywhere (verifyFailure's `unusable`), or it answered
// and then dropped it (the shell's pair_again, an early EOF, the channel "invalidated"). A timeout or any other failure
// isn't the pairing's fault and never forgets it.
export function turnedDown(why, err) {
  if (!why || why.late) return false;
  if (why.unusable) return true;
  const raw = String(err?.message ?? err ?? "");
  const code = err?.code ?? raw.split(":")[0];
  return Boolean(why.again) && (code === "pair_again" || /invalidat|early eof|UnexpectedEof/i.test(raw));
}
export async function recheckPairing(native, alert, redraw, { spin = null } = {}) {
  const st = await status(native);
  if (!st?.paired || !vpnOn(st)) return "skipped";
  const verify = async () => {
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
  if (!turnedDown(why, lastErr)) { rememberRouteFailure(why.late ? NO_ANSWER_FAILURE : routeFailureOf(lastErr, st)); return "failed"; } // B316
  await busy("Forgetting Pairing", () => call(native, "idevice.forget").catch(() => {}));
  forgetStatus();
  if (visit) visit.started = false;
  const how = why.unusable ? ", so every connection was refused" : "";
  await alert({ title: why.title, message: `This iPhone no longer accepts ${NAME}'s pairing${how}. Pairing starts again now.`, buttons: ["OK"] });
  if (typeof location !== "undefined" && onPairPage()) redraw(); else recheckHooks.goPair();
  return "repair";
}

// F301: the test runs with the spinner in its own row (installationGroups' `testing`, no HUD), at most TIMEOUTS.test;
// `ended()` stops the row's spinner before the answer's alert.
// B274: with `verify`, tailscale.test also connects once with the kept pairing through Tailscale (idevice.verify), so
// Connected means an install would connect; its deadline adds idevice.verify's.
async function tailscaleTest(native, alert, ended = () => {}) {
  let r;
  const ms = TIMEOUTS.test + TIMEOUTS.verify;
  try { r = await within(call(native, "tailscale.test", { verify: true }), ms); } catch (e) { r = isLate(e) ? { ok: false, code: "not_responding" } : { ok: false, code: "error", detail: e?.message }; }
  ended();
  if (r?.ok && r.verified) clearRouteFailure(); // B316: the pairing answered through Tailscale
  else if (r?.code === "not_responding") rememberRouteFailure(NO_ANSWER_FAILURE);
  else if (r?.code === "verify_failed") rememberRouteFailure(routeFailureOf({ message: String(r.detail || "connect_failed: Tailscale") }));
  else if (["refused", "route_refused", "needs_login", "expired", "not_paired"].includes(r?.code)) rememberRouteFailure(routeFailureOf({ code: r.code, message: `${r.code}: ${r.detail || "Tailscale"}` }));
  return testAlert(alert, r, { native, ms });
}

// tailscale.test's answer `r` as an alert (core tailscaleTestResult; Copy Rule when the tailnet's rules block it).
// B274: Pair Again (`again`: the phone no longer accepts the kept pairing) forgets it and opens the pairing page.
async function testAlert(alert, r, { native = null, ms = TIMEOUTS.test } = {}) {
  const why = r?.code === "not_responding"
    ? { title: NOT_RESPONDING, message: `Tailscale didn't answer in ${Math.round(ms / 1000)} seconds. Check that the Tailscale app's VPN is on, then test again.` }
    : tailscaleTestResult(r);
  if (why.again) {
    const { index } = await alert({ title: why.title, message: why.message, buttons: ["Cancel", "Pair Again"], cancel: 0 }) || {};
    if (index !== 1) return;
    await busy("Forgetting Pairing", () => call(native, "idevice.forget").catch(() => {}));
    forgetStatus();
    if (visit) visit.started = false;
    recheckHooks.goPair();
    return;
  }
  if (why.pair) { // B246: the route works, the pairing is missing: Pair opens the pairing page
    const { index } = await alert({ title: why.title, message: why.message, buttons: ["Not Now", "Pair"], cancel: 0 });
    if (index === 1) recheckHooks.goPair();
    return;
  }
  if (!why.copy) return alert({ title: why.title, message: why.message, buttons: ["OK"] });
  const { index } = await alert({ title: why.title, message: why.message, buttons: ["OK", "Copy Rule"], cancel: 0 });
  if (index === 1) copyText(why.copy);
}

async function openVPN(native, alert) {
  let r = null;
  try { r = await busy(`Opening ${VPN}`, () => call(native, "idevice.openLocalDevVPN")); } catch { /* below */ }
  if (!r?.opened) await alert({ title: `${VPN} Isn't Installed`, message: `Get ${VPN} from the App Store, open it and turn it on.`, buttons: ["OK"] });
}

// ---- Installation & Signing's main page (F284, option B of the concept)
// Built once and updated in place: every row is there from the first frame, and an answer from the bridge only fills
// a slot (the grey spinner while it loads, then the value fades in: opacity only, settings.css .value-slot). Answers
// never add or remove rows or change footers; only a tap changes the layout (by opening another page).
//   (top)         the status cell (core installStatus: two lines, always two lines tall) and one action row whose
//                 label changes (Check Connection, Open LocalDevVPN, Start Pairing, Sign In to Tailscale…)
//   Installation  Install Apps With > (installation/with: the choice and its route's groups), its detail the route
//                 and, for This iPhone, the pairing: "This iPhone · Paired" (F300: one row for This iPhone and the
//                 Signing Server)
//   Signing       Certificate > (days left), Signed Apps > (count)
//   How Signing Works >
// `links` holds the hrefs, `signing()` resolves {certificate: {text, red}, ready} (`ready`: a certificate kept; false turns
// the status cell into Import Your Certificate, B250), `apps()` the Signed Apps count (text),
// `checkServer` is Settings' Check Server and `host()` the Signing Server's host.
export const MAIN_ROWS = ["status", "action", "with", "certificate", "apps", "help"];

// F300/F351: Install Apps With's detail on the main page: This iPhone's pairing once idevice.status said (`st`
// undefined: not answered yet; null: it failed). The route itself is the row's label, subtitle and icon (ROUTE_ROW).
// B316: paired, with the last check or install failed (`failure`, core routeFailure): "Failing", red, until a check
// passes (the user's page said a green Paired while every install was refused).
export const FAILING = "Failing";
export function withDetail(choice, st, failure = null) {
  if (choice !== "iphone" || !st) return "";
  return st.paired ? (failure ? FAILING : "Paired") : "Not Paired";
}
// F351: each route's row: its icon (icons/rowicons.js), its name and one line under it, on the main page and the
// Install Apps With page.
const ROUTE_ROW = {
  server: { icon: "signingServer", label: "Signing Server", sub: `iOS installs each app from ${DOMAIN}` },
  iphone: { icon: "installation", label: "This iPhone", sub: "Straight onto this iPhone, no popup" },
};

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
    try { await runAction(now.action); } finally { busyNow = false; }
  };
  const sections = [
    { rows: [{ label: "", subtitle: " ", cls: "install-status" }, { label: STATUS_ACTIONS.check, cls: "install-action", onClick: act }] },
    // F351: the chosen route is the row (its icon, its name, what it does), under the question as the header
    { header: "Install Apps With", rows: [{ label: ROUTE_ROW.server.label, subtitle: ROUTE_ROW.server.sub, detail: "", href: links.with, icon: rowIcon(ROUTE_ROW.server.icon) }],
      footer: "Tap to choose how signed apps reach iOS." },
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
  const cellSpin = checkMark(statusCell); // B320: the status cell's spinner while a sign-in's checks run (spinStatus)
  actionCell.classList.add("is-dim");
  actionCell.setAttribute("aria-disabled", "true");
  const withCell = cells[2];
  const showRoute = (c) => {
    const r = ROUTE_ROW[c === "iphone" ? "iphone" : "server"];
    withCell.querySelector(".cell-label").textContent = r.label;
    withCell.querySelector(".cell-subtitle").textContent = r.sub;
    withCell.querySelector(".cell-icon img").src = rowIcon(r.icon).src;
  };
  const slots = {};
  ["with", "certificate", "apps"].forEach((k, i) => { slots[k] = slotOf(cells[i + 2].querySelector(".cell-detail")); });

  let known; // idevice.status once read
  let certRead = false; // B250: signing() has answered once (or failed)
  let certificate; // B250: signing.status has an identity (signing()'s `ready`); undefined until read
  const paintStatus = (s, { force = false } = {}) => {
    if (cellSpin.spinning() && !force) return; // B320: a sign-in's checks hold the cell (spinStatus) until they end
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
  // B320: the checks after a Tailscale sign-in ("Checking Connection", "Checking Pairing") as the status cell's own
  // wait: Checking… with the step under it and the grey spinner in its row, the action row dimmed
  const spinStatus = (label) => {
    paintStatus({ ...CHECKING, subtitle: `${label}…` }, { force: true });
    return cellSpin.spinning() ? () => {} : cellSpin.spin(); // never two spinners in the cell
  };
  const runAction = async (a) => {
    if (a === "check") return check(native, alert, after, store, checkButton).then(after);
    if (a === "checkServer") return checkServer();
    if (a === "openVPN") return openVPN(native, alert).then(refresh);
    if (a === "pair") return goTo("pair");
    if (a === "certificate") return navGo(links.certificate); // B250: the Certificate page, as its row opens
    // B320: redrawn without its automatic check (it failed while signing in and drew an x on this row), and the check
    // after it spins the status cell instead of a HUD
    if (a === "signIn") return tailscaleSignIn(native, alert, after, null, { spin: spinStatus }).then(after);
    if (a === "openTailscale") return openTailscaleApp(native, alert);
    if (a === "useTailscale") { await busy("Switching", () => call(native, "tailscale.setConnect", { value: "auto" }).catch(() => {})); return refresh(); }
  };
  return { el: box, refresh, known: () => known, status: () => now };
}

// ---- This iPhone's page

let pairing = null; // { pin, text, error } while idevice.pair waits for the phone (core pairEvent)
let shown = null; // { native, redraw } of the page on screen, for the hooks below
let visit = null; // this visit of the page: { started, asked, failed, poll }; null once it's left

// The page's groups for `state` (core setupState) and the pairing `p` (pure, for tests). The code and the steps
// with their screenshots are drawn after the groups marked `pin` and `guide` (drawPair).
// "checking" is drawn at once while idevice.status answers, with a spinner (`spinner` marks the group). "connect"
// draws the way to connect `vpn` (core vpnRoute) with connectGroups.
export const IMPORT_PAIRING = "Import Pairing File";
export function setupGroups(state, st, p, { openVPN = () => {}, retry = () => {}, check = () => {}, forget = () => {}, failed = false,
  vpn = "localdevvpn", choose = () => {}, signIn = () => {}, openTailscale = () => {}, install = () => {}, installTailscale = () => {}, busy = null,
  importFile = () => {} } = {}) {
  const intro = { header: "Install on This iPhone", footer: IPHONE_INTRO };
  if (state === "paired") {
    return [intro,
      { rows: [{ label: "Paired", checked: true, cls: "pair-done" }] },
      { rows: [{ label: "Check Connection", cls: "sign-import", onClick: check }],
        footer: `Checks that ${NAME} can reach this iPhone through ${vpnList()}.` },
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
  if (state === "connect") {
    // B133: while the page polls for the VPN (its way known and nothing left to tap but the app), say so with a spinner
    const waitFor = vpn === "localdevvpn" ? VPN : vpn === "tailscale" && st?.tailscale?.signedIn && !busy ? "Tailscale" : null;
    return [intro, ...connectGroups(vpn, st, { openVPN, choose, signIn, openTailscale, install, installTailscale, busy }), ...(waitFor ? [{ spinner: vpnWaitText(waitFor) }] : [])];
  }
  const conn = { rows: [{ label: st ? verifyVPN(st) : VPN, detail: "On" }] }; // B277: the VPN that's on (Tailscale's too)
  const line = failed && !p ? `Pairing stopped.` : p ? pairFooter(p) : "Starting…";
  // B133: while idevice.pair runs, the code's place spins until the code comes, and the step line spins with it
  // (waiting for the iPhone to connect, pairing) unless a try failed (then it waits on a tap on the iPhone).
  const waiting = Boolean(p && !p.error);
  return [intro, conn,
    p && !p.pin ? { header: "Pairing Code", spinner: "Getting the Code…" } : { header: "Pairing Code", pin: true },
    { header: "Where to Type It", guide: true, ...(waiting ? { spinner: line } : { footer: line }) },
    ...(failed && !p ? [{ rows: [{ label: "Try Again", cls: "sign-import", onClick: retry }] }] : [])];
}

// The VPN is off: what to turn on, from the VPN apps installed (core vpnRoute's answer `vpn`).
//   localdevvpn  its state and Open LocalDevVPN
//   tailscale    Sign In (or its state once signed in) and Open Tailscale
//   ask          both installed: Connect With, LocalDevVPN or Tailscale; the answer is kept
//   none         neither: Install LocalDevVPN (its App Store page), Tailscale named as the other way
export const NO_VPN_FOOTER = `${NAME} pairs and installs through ${VPN}, a free app. This page checks again when you come back.`;
export const NO_VPN_TAILSCALE_FOOTER = "The other way in: install Tailscale and sign in to it.";
export const TAILSCALE_STORE = "https://apps.apple.com/app/tailscale/id1470499037";
export function connectGroups(vpn, st, { openVPN = () => {}, choose = () => {}, signIn = () => {}, openTailscale = () => {}, install = () => {},
  installTailscale = () => {}, busy = null } = {}) {
  const goesOn = "This page goes on by itself when it's on.";
  if (vpn === "ask") {
    return [{
      header: "Connect With",
      rows: VPNS.map((label) => ({ label, onClick: () => choose(label.toLowerCase()) })),
      footer: `${VPNS.join(" and ")} are both installed. Pick the one ${NAME} pairs and installs through; Connect With in Installation & Signing changes it later.`,
    }];
  }
  if (vpn === "tailscale") {
    const ts = st?.tailscale ?? null;
    const rows = busy
      ? [{ label: "Signing In…", detail: busy, spin: true }]
      : !st ? [{ label: "Tailscale", detail: "Checking…", spin: true }] // B167: no status yet is unknown, not signed out
      : ts?.signedIn ? [{ label: "Tailscale", detail: ts.address ? "On" : "Off" }] : [{ label: "Sign In", cls: "sign-import", onClick: signIn }];
    rows.push({ label: "Open Tailscale", cls: "sign-import", onClick: openTailscale });
    return [{
      header: "Tailscale",
      rows,
      footer: ts?.signedIn ? `Turn on the Tailscale app's VPN. ${goesOn}` : `Sign ${NAME} in to your tailnet, then turn on the Tailscale app's VPN. ${goesOn}`,
    }];
  }
  if (vpn === "none") {
    // F317: one group per way in (AGENTS.md, Hints): LocalDevVPN's with its hint, Tailscale's with its own
    return [{
      rows: [{ label: VPN, detail: "Not Installed" }, { label: `Install ${VPN}`, cls: "sign-import", onClick: install }],
      footer: NO_VPN_FOOTER,
    }, {
      rows: [{ label: "Install Tailscale", cls: "sign-import", onClick: installTailscale }],
      footer: NO_VPN_TAILSCALE_FOOTER,
    }];
  }
  return [{
    rows: [{ label: VPN, detail: vpnDetail(st) }, { label: `Open ${VPN}`, cls: "sign-import", onClick: openVPN }],
    footer: `Turn on ${VPN} to pair. ${goesOn}`,
  }];
}

// setupGroups' sections as DOM: the code after the `pin` group, the steps after the `guide` group's header, and the
// grey spinner with its line in the `spinner` group (packages.css .loading; settings.css .pair-wait when it sits in a
// group with a header), and the spinner on rows marked `spin`.
export function pairSections(sections) {
  const frag = spinRows(grouped(sections), sections);
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

// Opens another app or its App Store page; says so when iOS couldn't.
async function openApp(native, alert, url, name) {
  let opened = false;
  try { opened = (await busy(`Opening ${name}`, () => call(native, "app.openURL", { url })))?.opened === true; } catch { /* below */ }
  if (!opened) await alert({ title: `Couldn't Open ${name}`, message: "Try again.", buttons: ["OK"] });
}

// B323: Open Tailscale launches the app by its bundle ID (a tailscale: link shows Tailscale's "Could not sign
// device"); when iOS won't, it says plainly to open Tailscale.
export const OPEN_TAILSCALE_BY_HAND = "Open Tailscale from the Home Screen and turn it on. No Tailscale app? Get it from the App Store.";
async function openTailscaleApp(native, alert) {
  let opened = false;
  try { opened = await busy("Opening Tailscale", () => openTailscale((m, p) => call(native, m, p))); } catch { /* below */ }
  if (!opened) await alert({ title: "Couldn't Open Tailscale", message: OPEN_TAILSCALE_BY_HAND, buttons: ["OK"] });
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
// the page: coming back, it reads the pairing from native, or rechecks the VPN while it waits for one. Leaving the
// page ends the pairing.
// B300: by the page the hash shows, so the Pairing page opened on another page's stack (Install IPAs' Set Up Signing:
// #/home/~installed/myipas/~settings/installation/pair) is the Pairing page too. Pure (hash in), for the tests.
export const isPairHash = (hash) => format(mounted(parse(hash))) === format(mounted(parse(route("pair"))));
function onPairPage() { return isPairHash(location.hash); }
async function reread() {
  if (!shown || document.visibilityState !== "visible") return;
  const { native, redraw } = shown;
  if (!pairing) { if (visit) redraw(); return; } // the VPN may be on now
  let st = null;
  try { st = await call(native, "idevice.pairState"); } catch { return; }
  const now = pairFromNative(st);
  if (now && pairing) { pairing = now; redraw(); } // not active: idevice.pair's reply settles it
}
export function leave() { // also for tests: ends a visit (its VPN poll) without a hashchange
  const was = visit;
  if (visit?.poll) clearInterval(visit.poll);
  visit = null;
  if (was && pairing && shown) {
    call(shown.native, "idevice.pairCancel").catch(() => {}); // once, not again on the hashchange after Leave
    pairing = null; // B320: coming back starts (or rejoins: the shell keeps it a while) at once, not on this one's answer
  }
  if (was && signingIn && signInVisit === was && shown) { // B143: the sign-in this page started (an older shell has no such call)
    signInVisit = null;
    call(shown.native, "tailscale.signInCancel").catch(() => {});
  }
}

// B134: leaving the page while a step runs asks first (core leaveQuestion): "pairing" while idevice.pair waits (the
// code coming or being typed), "checking" while the page's spinner waits on idevice.status; null otherwise (paired,
// waiting for the VPN to come on, Try Again: nothing runs that leaving would stop). B143: "signingIn" while a Tailscale
// sign-in this visit started runs (Starting…, Waiting for approval; its login page covers the app in between), and Leave
// stops it with tailscale.signInCancel.
export function pendingStep(onPage = onPairPage()) {
  if (!visit || !onPage) return null;
  if (pairing) return "pairing";
  if (signingIn && signInVisit === visit) return "signingIn";
  return visit.checking ? "checking" : null;
}

// Asks "Stop Setting Up?"; true when the step is gone (it ended while asking, or Leave: the visit ends and the pairing
// or Tailscale sign-in is cancelled, as a plain leave() does). The page itself is left by the caller.
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

async function vpnApps(native) { try { return await call(native, "idevice.vpnApps"); } catch { return null; } }

async function drawPair(box, { store, native, alert, redraw }) {
  shown = { native, redraw };
  visit ??= { started: false, asked: false, failed: false, poll: null };
  const v = visit;
  // B120: the page draws at once, a spinner while idevice.status answers (a redraw keeps what is on screen).
  if (!pairing && !box.firstChild) { box.replaceChildren(pairSections(setupGroups("checking"))); v.checking = true; } // B134: asked before leaving
  // In pairing mode the page draws from `pairing` alone, without waiting on idevice.status.
  const [st, apps] = pairing ? [null, null] : await Promise.all([status(native), vpnApps(native)]);
  if (v !== visit) return; // left while idevice.status answered
  v.checking = false;
  rememberStatus(st);
  const state = setupState(st, pairing);
  if (state !== "connect" && v.poll) { clearInterval(v.poll); v.poll = null; }
  const connect = st?.tailscale?.connect ?? "auto";
  const vpn = vpnRoute(apps, connect);
  // Only Tailscale installed: acting on it makes Connect With Tailscale, as picking it does when both are.
  const useTailscale = () => connect === "tailscale" ? Promise.resolve() : call(native, "tailscale.setConnect", { value: "tailscale" }).catch(() => {});

  const start = async () => {
    if (pairing) return;
    v.started = true;
    v.failed = false;
    pairing = { pin: "", text: "", error: "" };
    redraw();
    // B320: this visit's events and answer only: an earlier visit's call answering late leaves this one's state alone
    const mine = () => visit === v && pairing !== null;
    try {
      // idevice.pair's first event is the code, before anything listens; it keeps listening until it pairs or the
      // page is left (no timeout)
      await call(native, "idevice.pair", {}, (ev) => { if (mine()) { pairing = pairEvent(pairing, ev); redraw(); } });
      if (visit === v) pairing = null;
      AUTO_CHECK.last = 0; // B316: paired again: the paired page checks at once and goes green on its own
      store.set(ROUTE_KEY, "iphone");
      if (visit === v) redraw();
    } catch (e) {
      if (visit !== v) return;
      pairing = null;
      v.failed = true;
      redraw();
      if (e?.code !== "canceled" && e?.code !== "cancelled" && !/^cancel+ed/.test(e?.message || "")) {
        alert({ title: "Couldn't Pair", message: e?.message || "No answer.", buttons: ["OK"] });
      }
    }
  };

  // B133: after an action that changes what the page is, it draws as Checking (the spinner) while it reads again,
  // instead of leaving the old page up with nothing moving.
  const recheck = () => { if (visit === v && !pairing) box.replaceChildren(); return redraw(); };
  let checkButton = null; // B135: the Check Connection button's answer, set once the rows are drawn
  let input = null; // the pairing file picker, made below for the "file" state
  // B321: in pairing mode st is null (not read again); the VPN row names the way in from the last answer (Tailscale too)
  const sections = setupGroups(state, st ?? (pairing ? cachedStatus() : null), pairing, {
    importFile: () => input?.click(),
    failed: v.failed,
    openVPN: () => openVPN(native, alert),
    retry: start,
    check: () => check(native, alert, recheck, store, checkButton),
    forget: async () => {
      await busy("Forgetting Pairing", () => call(native, "idevice.forget").catch(() => {}));
      forgetStatus(); // F301: the cached answer says Paired
      store.set(ROUTE_KEY, "server"); v.started = false; recheck();
    },
    vpn,
    busy: signingIn,
    choose: async (value) => { await busy("Switching", () => call(native, "tailscale.setConnect", { value }).catch(() => {})); recheck(); },
    signIn: async () => { await useTailscale(); tailscaleSignIn(native, alert, () => { if (visit === v) redraw(); }, v); }, // B143: once left, an ending sign-in mustn't draw the page (a new visit and its poll)
    openTailscale: async () => { await useTailscale(); openTailscaleApp(native, alert); },
    install: () => openApp(native, alert, LOCALDEVVPN_STORE, "App Store"),
    installTailscale: () => openApp(native, alert, TAILSCALE_STORE, "App Store"),
  });
  if (state === "paired" && store.get(ROUTE_KEY) !== "iphone") store.set(ROUTE_KEY, "iphone"); // picked This iPhone, already paired
  const frag = pairSections(sections);
  const ci = sections.findIndex((s) => s.rows?.some((r) => r.label === STATUS_ACTIONS.check));
  if (ci >= 0) {
    const ul = [...(frag.children[ci]?.children ?? [])].find((c) => c.classList?.contains("table"));
    const j = sections[ci].rows.findIndex((r) => r.label === STATUS_ACTIONS.check);
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
        store.set(ROUTE_KEY, "iphone");
        recheck();
      } catch (e) {
        alert({ title: "Not a Pairing File", message: e?.message || "That file isn't a pairing for this iPhone.", buttons: ["OK"] });
      }
    });
    frag.querySelector(".sign-import")?.append(input); // F317: the row is in step 2's group (setupGroups)
  }
  box.replaceChildren(frag);

  if (state === "connect") {
    // F301: one read at a time (a read slower than VPN_POLL used to start the next one on top of it)
    v.poll ??= setInterval(async () => {
      if (visit !== v || pairing || v.polling) return;
      v.polling = true;
      try { if (visit === v && !pairing && vpnOn(await status(native))) redraw(); } finally { v.polling = false; }
    }, VPN_POLL);
    const ask = connectAlert(vpn);
    if (ask && !v.asked) {
      v.asked = true;
      const { index } = await alert({ ...ask, cancel: 0 }) || {};
      if (index === ask.open) openVPN(native, alert);
    }
  } else if (state === "pairing" && !pairing && !v.started) {
    start();
  } else if (state === "paired") {
    autoCheck(native, alert, recheck, store, checkButton); // B316: opened after a failure, or just paired again: checks by itself
  }
}

// B135: Check Connection answers on its own button (`mark`, checkMark below): a success is a check and a green
// "Successful" in place of the label, no alert; a failure keeps the alert and puts an x on the button.
// F301: the check runs with the spinner on its own button (no HUD) and at most TIMEOUTS.verify. It reads
// idevice.status first (under a second): with neither LocalDevVPN nor Tailscale's route on, idevice.verify could only
// wait out its 30 s tunnel limit, so the answer (Turn On LocalDevVPN) comes at once instead.
// B316: a check that passes clears the remembered route failure (Installation & Signing and Home go green); one that
// fails to reach the phone remembers it (core routeFailureOf: Tailscale's state before the pairing). `quiet`: the
// automatic check when a page opens after a failure (autoCheck): no alert, the status and the button's x say it.
// A failure whose fix isn't Pair Again (Tailscale signed out or off, every connection refused) offers its fix button.
async function check(native, alert, redraw, store, mark = null, { quiet = false } = {}) {
  if (mark?.spinning() || checking) return; // a second tap while it checks
  checking = true;
  try { return await checkOnce(native, alert, redraw, store, mark, { quiet }); } finally { checking = false; }
}
let checking = false;
// B316: opening Installation & Signing, Pairing or Install Apps With after a failed check or install checks by itself,
// at most once every AUTO_CHECK.gapMs (moving between those pages doesn't check again at once).
export const AUTO_CHECK = { gapMs: 15000, last: 0 };
export function autoCheck(native, alert, redraw, store, mark = null, now = Date.now()) {
  // B320: not while Tailscale signs in: the sign-in checks by itself once it's in (connectAfterSignIn), and a check
  // run now fails (still signed out) and drew its x on the row just tapped
  if (!routeFailure() || store.get(ROUTE_KEY) !== "iphone" || checking || signingIn || now - AUTO_CHECK.last < AUTO_CHECK.gapMs) return null;
  AUTO_CHECK.last = now;
  // the gap counts from the end too: a slow check (up to TIMEOUTS.verify) isn't followed by another at once
  return check(native, alert, redraw, store, mark, { quiet: true }).finally(() => { AUTO_CHECK.last = Math.max(AUTO_CHECK.last, Date.now()); });
}
async function fixAction(fix, native, alert) {
  if (fix === "signIn") return goTo("with");
  if (fix === "openTailscale") return openTailscaleApp(native, alert);
  if (fix === "openVPN") return openVPN(native, alert);
  if (fix === "pair") return goTo("pair");
  return undefined;
}
async function checkOnce(native, alert, redraw, store, mark = null, { quiet = false } = {}) {
  mark?.reset();
  const stop = mark?.spin() ?? (() => {});
  let st = null; // B258: the failure names the VPN this check went through
  try {
    st = await status(native);
    rememberStatus(st);
    if (st && !vpnOn(st)) { stop(); throw Object.assign(new Error("connect_failed: neither LocalDevVPN nor Tailscale is on"), { code: "connect_failed" }); }
    try { await within(call(native, "idevice.verify"), TIMEOUTS.verify); } finally { stop(); }
    clearRouteFailure(); // B316
    if (store.get(ROUTE_KEY) !== "iphone") store.set(ROUTE_KEY, "iphone"); // a set redraws Settings' pages, and the mark with them
    mark?.show(true);
    if (quiet) redraw();
  } catch (e) {
    const why = isLate(e)
      ? { title: NOT_RESPONDING, message: `This iPhone didn't answer in ${TIMEOUTS.verify / 1000} seconds. Check that ${st ? verifyVPN(st) : `${VPN} (or Tailscale)`} is on, then check again.`, again: false }
      : verifyFailure(e, st);
    rememberRouteFailure(isLate(e) ? NO_ANSWER_FAILURE : routeFailureOf(e, st)); // B316
    mark?.show(false);
    if (quiet) { mark?.expire(); redraw(); return undefined; }
    try {
      if (why.fix && why.button) {
        const { index } = await alert({ title: why.title, message: why.message, buttons: ["OK", why.button], cancel: 0 }) || {};
        if (index === 1) await fixAction(why.fix, native, alert);
        return undefined;
      }
      if (!why.again) return await alert({ title: why.title, message: why.message, buttons: ["OK"] });
      const { index } = await alert({ title: why.title, message: why.message, buttons: ["Cancel", "Pair Again"], cancel: 0 }) || {};
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
export function checkMark(inner, text = STATUS_ACTIONS.check) {
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
    on = true;
    inner.setAttribute("data-check", ok ? "ok" : "fail");
    const mark = el("span", "check-mark", ok ? "✓" : "✕");
    mark.setAttribute("aria-hidden", "true");
    const words = el("span", "check-words", ok ? "Successful" : text);
    label.replaceChildren(mark, words);
    if (ok) expire();
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
  return { show, reset, expire, spin, active: () => on, spinning: () => spinning };
}

// B148: This iPhone's page (installation/iphone) shown again, Back from Pairing: idevice.status read again and each
// row's detail (Pairing: Paired / Not Paired, the VPN, Tailscale's Device) put on the row already drawn, in place.
// Rows the fresh answer would add or drop (Developer Mode once paired) wait for the page's next full draw.
export function installationRows(sub, st, { store } = {}) {
  const choice = sub === "iphone" ? "iphone" : store.get(ROUTE_KEY);
  return subGroups(installationGroups(choice, st), sub).flatMap((g) => g.rows);
}
export async function refreshInstallation(el, sub, { store, native = nativeBridge(), patch } = {}) {
  if (sub === "pair") return;
  const st = await status(native);
  patch(el, installationRows(SUB_TITLES[sub] ? sub : null, st, { store }));
}
