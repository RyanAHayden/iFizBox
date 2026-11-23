// Settings > Installation's route (docs/sideload.md, "This iPhone"): how the sideload app hands a signed IPA to iOS.
//   "server"  the Signing Server's manifest and iOS's Install prompt (the default)
//   "iphone"  this phone's own installd through the app's built-in VPN (native/sideload/idevice, native/sideload/vpn):
//             no server, iFizBox updates itself
// Pure: the decision for one install from the idevice.status answer, the texts, and the pairing page's state.
import { NAME, DOMAIN } from "../brand.js";

export const ROUTE_KEY = "installRoute";
export const STORAGE_KEY = "ifizbox." + ROUTE_KEY;

// F300: This iPhone first, then the Signing Server (still the default). F372: one line each, as Installation &
// Signing's rows show them beside the checkmark and the disclosure.
export const ROUTE_OPTIONS = [
  { value: "iphone", label: "This iPhone", subtitle: "Works offline" },
  { value: "server", label: "Signing Server", subtitle: `Default - Uses ${DOMAIN}` },
];

// ---- The built-in VPN (native/sideload/vpn): This iPhone's only way in
// idevice.status's `vpn` ({available, tested, cellular, wifi, shortcuts: {off, on}}) says the app can run it: its
// profile has Network Extensions. The shell turns it on for each connect and off after. Without it (an older shell,
// or a profile without the capability) This iPhone can't be used: noVPN says so.
export const BUILTIN_VPN = `${NAME} VPN`;
export const builtinVPN = (st) => Boolean(st?.vpn?.available);
// A profile without Network Extensions (or a shell that doesn't know the VPN): said plainly where the VPN's rows would be.
export const NO_VPN = {
  title: "No Network Extensions", again: false, fix: "check", button: "Check Again",
  message: "This profile has no Network Extensions, so it can't connect. Sign with one that has them, or use the Signing Server.",
  short: "This profile has no Network Extensions.",
};
// Our Shortcuts, named as the user names them in Shortcuts. F386: `switch`, the Install Switch, is the one This
// iPhone's Set Up adds: before a queue of installs it turns Cellular Data off (on cellular) and connects the built-in
// VPN, after it turns data back on and connects the VPN that was on before. `off`/`on`, the two Cellular
// Shortcuts it replaces, still work on phones that added them before.
export const SHORTCUT_NAMES = { off: "Cellular Data Off", on: "Cellular Data On", switch: "Install Switch" };
export const switchAdded = (st) => Boolean(st?.vpn?.shortcuts?.switch);
// F394: an Install Switch added before the one-trip one, on an app that can use it (`trips`): it works as before, and
// its page offers Update. F389: or one that can't bring an idle On Demand VPN back (`idle`). `vpn` is vpn.status.
export const switchOld = (vpn) => Boolean(vpn?.trips && vpn.shortcuts?.switch && !(vpn.shortcuts?.trip && vpn.shortcuts?.idle));
// Installs on cellular are covered: the Install Switch, or both Cellular Shortcuts.
export const shortcutsAdded = (st) => switchAdded(st) || Boolean(st?.vpn?.shortcuts?.off && st?.vpn?.shortcuts?.on);
// B359: our signed Shortcut on the site (web/app/shortcuts/, signed by tools/shortcuts/sign.sh). The app shares its
// own copy; this link is the fallback it opens in Safari. Shortcuts names an imported Shortcut after its file.
export const shortcutFileURL = (k) => `https://${DOMAIN}/shortcuts/${encodeURIComponent(SHORTCUT_NAMES[k])}.shortcut`;
// F392: our Shortcut's iCloud link (Shortcuts > Share > Copy iCloud Link, made once by hand by the Apple ID that owns
// it): the only link Shortcuts' own Add Shortcut opens from (shortcuts://import-shortcut refuses any other). null:
// Add shares the file instead.
export const SHORTCUT_LINKS = { switch: null };
// B359: a group footer for a Shortcut whose check run (vpn.checkShortcut) didn't pass: it isn't marked added.
export const shortcutDidntRun = (k, err) => `"${SHORTCUT_NAMES[k]}" didn't run: ${err || "Shortcuts didn't say why"}. ${/could not find/i.test(err ?? "") ? "If Shortcuts has two of it, delete both, then tap Add." : "Tap Add to try again."}`; // F394: Replace can leave two (iOS 27), and neither runs by name
// ... and for an Add whose share sheet never opened (nothing was imported, so nothing ran either).
export const shortcutDidntOpen = (k, err) => `"${SHORTCUT_NAMES[k]}" couldn't be shared to Shortcuts: ${err || "no reason given"}. Tap Add to try again.`;
// This iPhone is set up: paired, and with the built-in VPN tested once (vpn.test). Using it waits for that.
export const iphoneSetUp = (st) => Boolean(st?.paired) && builtinVPN(st) && Boolean(st.vpn.tested);
// F394 (user 2026-11-23): the app asks for the Install Switch only when a connect now would need it and it isn't there:
// LocalVPN.switchNeeded, on cellular or with another VPN up or (F389) selected in Settings > VPN. The old two Cellular Shortcuts cover cellular, not the VPN.
export const switchWanted = (st) => builtinVPN(st) && ((Boolean(st.vpn.cellular) && !shortcutsAdded(st)) || (Boolean(st.vpn.otherVPN || st.vpn.otherVPNSelected) && !switchAdded(st)));
// Set Up's footer: the next step, or what is set up.
export function setupFooter(st) {
  if (st && !builtinVPN(st)) return NO_VPN.message;
  if (!st?.paired) return "Pair this iPhone once to install straight onto it.";
  if (!st.vpn.tested) return "Test the connection to finish setting up.";
  if (shortcutsAdded(st)) return "Set up. Apps install straight onto this iPhone, on Wi-Fi, cellular or offline.";
  if (!switchWanted(st)) return "Set up. Apps install straight onto this iPhone, on Wi-Fi or offline.";
  return "Set up for Wi-Fi and offline. Add the Install Switch to install on cellular and get your VPN back after.";
}
// B381: a connect now would run the Install Switch (LocalVPN.switchNeeded: on cellular, or with another VPN up), so
// iOS would flip to Shortcuts. The checks nobody tapped (autoCheck) stay away then.
export const switchWouldRun = (st) => builtinVPN(st) && Boolean(st.vpn.shortcuts?.switch) && Boolean(st.vpn.cellular || st.otherVPN || st.vpn.otherVPNSelected || (!st.vpn.on && st.tunnels?.length)); // otherVPN is false when another VPN routes 10.7.0.1
// User 2026-11-22: This iPhone in use, the phone on cellular (no Wi-Fi), and the Install Switch not added: iOS
// refuses the connection, so Home, Installation & Signing's status and an install that starts say so, with a button
// to the Install Switch's page.
export const cellularWarning = (choice, st) => choice === "iphone" && builtinVPN(st) && Boolean(st.vpn.cellular) && !shortcutsAdded(st);
export const CELLULAR = {
  title: "Add the Install Switch",
  message: `On cellular, iOS refuses installs straight onto this iPhone while cellular data is on. Add the Install Switch Shortcut, and ${NAME} turns data off while installs connect.`,
  short: "On cellular, installs need them.",
  button: "Set Up",
};
// How It Works: the steps of one install, a row each.
export const HOW_STEPS = [
  { label: "1. Download", subtitle: "The app downloads over Wi-Fi or cellular." },
  { label: "2. Sign", subtitle: "Signed on this iPhone with your certificate." },
  { label: `3. ${BUILTIN_VPN} On`, subtitle: "iOS runs one VPN at a time, so yours pauses." },
  { label: "4. Cellular Data Off", subtitle: "On cellular only: the Install Switch turns it off." },
  { label: "5. Install", subtitle: "Copied straight to iOS. No internet needed." },
  { label: "6. All Back On", subtitle: "Data back on, VPN off, yours reconnects." },
];
// vpn.test's answer, or its error, as the alert's words.
export function vpnTestResult(r, err = null) {
  if (r?.ok) return { title: "Connected", message: `${BUILTIN_VPN} reached this iPhone${r.ms ? ` in ${r.ms} ms` : ""}, then turned off again.` };
  const raw = String(err?.message ?? err ?? "");
  if (/^switch_failed:/.test(raw)) { const f = switchFailed(raw); return { title: f.title, message: f.message }; } // B395
  if (/^vpn_failed:/.test(raw)) return { title: `${BUILTIN_VPN} Didn't Start`, message: `${raw.replace(/^vpn_failed:\s*/, "")}.` };
  const why = verifyFailure(err, { paired: true, vpn: { available: true } });
  return { title: why.title, message: why.message, again: why.again };
}
// F386: vpn.testSwitch's answer as the alert's words: the start and the end ran, and what the start did.
export function switchTestResult(r) {
  const name = SHORTCUT_NAMES.switch;
  if (!r?.start?.ok || !r?.end?.ok) {
    const err = (!r?.start?.ok ? r?.start?.error : r?.end?.error) || "it didn't run";
    return { title: "Shortcut Didn't Run", message: `"${name}": ${err}. Check that it's in Shortcuts with exactly that name.` };
  }
  if (!r.vpnOn) return { title: "Shortcut Ran", message: `It ran, but ${BUILTIN_VPN} didn't connect. Installs still work: ${NAME} connects it itself, and your VPN may stay off after.` };
  if (r.cellular && !r.wentOff) return { title: "Shortcut Ran", message: "It ran, but cellular stayed in use. Check that Cellular Data can be turned off in Settings." };
  return { title: "Install Switch Works", message: `${BUILTIN_VPN} came on${r.cellular ? " with Cellular Data off" : ""}, then your VPN came back.` };
}

// This iPhone's page says what it gives in one sentence under its title. Installs through installation_proxy never
// show iOS's install prompt, so that is one of the points.
export const IPHONE_INTRO = `Installs straight onto this iPhone: no server, no install popup, and ${NAME} can update itself.`;

export function storedRoute(storage = globalThis.localStorage) {
  try { return storage?.getItem(STORAGE_KEY) === "iphone" ? "iphone" : "server"; } catch { return "server"; }
}

// One install's route: { route: "idevice" } or { route: "server" }, with `alert` (a key of ALERTS) when This iPhone
// is chosen but can't be used now: the alert says the install goes through the Signing Server instead.
// `status` is idevice.status ({paired, vpn, otherVPN}), null when the call failed.
export function decideRoute(choice, status) {
  if (choice !== "iphone") return { route: "server" };
  if (!status) return { route: "server", alert: "noStatus" };
  if (!status.paired) return { route: "server", alert: "notPaired" };
  if (!builtinVPN(status)) return { route: "server", alert: "noVPN" };
  if (cellularWarning(choice, status)) return { route: "idevice", alert: "cellular" }; // F372
  if (!switchWanted(status)) return { route: "idevice" };
  return { route: "idevice", alert: status.vpn.otherVPN ? "vpnStaysOff" : "vpnIdle" }; // F394: another VPN is on; F389: or selected
}

// buttons: the first is the server fallback.
export const ALERTS = {
  noStatus: { title: "Can't Reach This iPhone", message: "This install goes through the Signing Server.", buttons: ["OK"] },
  notPaired: { title: "Not Paired", message: `${NAME} isn't paired with this iPhone yet, so this install goes through the Signing Server. Pair in Settings > Installation.`, buttons: ["OK"] },
  noVPN: { title: NO_VPN.title, message: `This install goes through the Signing Server. ${NO_VPN.message}`, buttons: ["OK"] },
  // F372 (user 2026-11-22): on cellular without the Cellular Shortcuts. `setup` opens their page (the install stops);
  // the other button installs through the Signing Server. No Try Anyway: the user found This iPhone always fails there.
  cellular: { title: CELLULAR.title, message: CELLULAR.message, buttons: ["Use Server", CELLULAR.button], setup: 1 },
  // F394: another VPN is on and nothing would bring it back; the first button goes on through This iPhone without it
  vpnStaysOff: { title: "Your VPN Stays Off", message: `This install turns your VPN off, and it stays off after. Add the Install Switch, and ${NAME} brings it back.`, buttons: ["Install", CELLULAR.button], setup: 1, goes: true },
  // F389: selected, not connected: iOS tells an app nothing of its On Demand, so the words say "if"
  vpnIdle: { title: "Your VPN May Stay Off", message: `If your VPN connects on demand, it stays off after this install. Add the Install Switch, and ${NAME} brings it back.`, buttons: ["Install", CELLULAR.button], setup: 1, goes: true },
};

// ---- Installation & Signing's top cell (F284, option B of the concept): one two-line status and one action row
// whose label changes. `choice` is Install Apps With; `st` idevice.status (null: it failed; undefined: not answered
// yet); `host` the Signing Server's host. Returns
//   { state, title, subtitle, action, tone: "ok"|"warn"|"wait", local }
// `local`: installs go straight onto this iPhone now (the Signing Server row then says This iPhone).
// `action` is a key of STATUS_ACTIONS. Every subtitle fits two lines at 320pt (the cell keeps two lines' height).
export const STATUS_ACTIONS = {
  check: "Check Connection", checkServer: "Check Server", pair: "Start Pairing",
  certificate: "Import Certificate", shortcuts: "Add Install Switch",
};
export const CHECKING = { state: "checking", title: "Checking…", subtitle: "Pairing and the VPN.", action: "check", tone: "wait", local: false };
// B250: `certificate` is whether signing.status has an identity (signing/device.js statusReady): false says Import Your
// Certificate on either route, since every install stops at Set Up Signing without one (signing/device.js
// firstInstallCheck); undefined (not read yet, or the read failed) leaves the route's own answer.
export const NO_CERTIFICATE = { state: "certificate", title: "Import Your Certificate", subtitle: "Installs need your certificate and its profile first.", action: "certificate", tone: "warn", local: false };
// The Signing Server route before signing.status first answers: no Ready to Install until the certificate is known.
export const CHECKING_SERVER = { ...CHECKING, subtitle: "Your certificate." };
// B316: `failure` (routeFailure: the last check or install on this iPhone failed, and no check has passed since) turns
// Ready to Install into that failure, red with its fix, until a check passes; any other answer stands as it is.
export function installStatus(choice, st, { host = DOMAIN, certificate, failure = null } = {}) {
  const s = routeStatus(choice, st, { host, certificate });
  return failure && s.state === "ready" ? failureStatus(failure) : s;
}
function routeStatus(choice, st, { host = DOMAIN, certificate } = {}) {
  if (certificate === false) return NO_CERTIFICATE;
  if (choice !== "iphone") return { state: "server", title: "Ready to Install", subtitle: `Through the Signing Server, ${host}.`, action: "checkServer", tone: "ok", local: false };
  if (st === undefined) return CHECKING;
  const later = `Installs use ${host} for now.`;
  if (!st) return { state: "noStatus", title: "Can't Reach This iPhone", subtitle: later, action: "check", tone: "warn", local: false };
  if (!builtinVPN(st)) return { state: "noVPN", title: NO_VPN.title, subtitle: `This profile can't connect. ${later}`, action: "check", tone: "warn", local: false };
  if (!st.paired) return { state: "pair", title: "Pair This iPhone", subtitle: `Installs use ${host} until it's paired.`, action: "pair", tone: "warn", local: false };
  // F372: the shell turns the built-in VPN on for each install; only cellular can stop it
  if (cellularWarning(choice, st)) return { state: "cellular", title: CELLULAR.title, subtitle: CELLULAR.short, action: "shortcuts", tone: "warn", local: true };
  return { state: "ready", via: BUILTIN_VPN, title: "Ready to Install", subtitle: `Straight onto this iPhone, through ${BUILTIN_VPN}.`, action: "check", tone: "ok", local: true };
}

// The Signing Server row's detail: This iPhone while installs go straight here, the server's host when they fall back.
export const serverDetail = (status, host = DOMAIN) => (status?.local ? "This iPhone" : host);

// The Certificate row's detail from signing.status's identity (`kept`, null for none) and whether files are picked.
export function certificateDetail(kept, { staged = false, now = Date.now() } = {}) {
  if (!kept) return { text: staged ? "Incomplete" : "None" };
  const t = Date.parse(kept.expires || "");
  if (!Number.isFinite(t)) return { text: "In Keychain" };
  const days = Math.floor((t - now) / 86400000);
  if (days < 0) return { text: "Expired", red: true };
  return { text: `${days} day${days === 1 ? "" : "s"} left`, red: days <= 7 };
}

// The bridge's params for a decision: route "idevice" sends no server (nothing reaches it) and no host.
export const routeParams = (decision) => (decision?.route === "idevice" ? { route: "idevice" } : {});

// The pairing page's state from idevice.status: "paired", "phone" (iOS 27: pair on the phone with a code) or "file"
// (older iOS: import a pairing file made on a computer).
export function pairState(status) {
  if (status?.paired) return "paired";
  return status?.pairOnPhone ? "phone" : "file";
}

// This iPhone's page (screens/installroute.js drawPair), what it shows from idevice.status and the pairing under way:
//   "paired"   Paired with a check, Check Connection, Forget Pairing
//   "file"     older iOS: Import Pairing File
//   "checking" nothing known yet: drawn at once, with a spinner, while idevice.status answers
//   "noVPN"    iOS 27, no built-in VPN (a profile without Network Extensions): NO_VPN says so
//   "pairing"  iOS 27: pairing runs by itself, the code big at the top, then PAIR_GUIDE
export function setupState(status, pairing = null) {
  if (pairing) return "pairing";
  if (status === undefined) return "checking";
  const s = pairState(status);
  if (s !== "phone") return s;
  return builtinVPN(status) ? "pairing" : "noVPN";
}

// ---- Developer Mode (F300: no row of its own: an app this route installs can't open without it, iFizBox included)
// An install that fails because Developer Mode is off says so in its alert (core/signing.js deviceError).
export const DEV_MODE_STEPS = "Open Settings > Privacy & Security > Developer Mode, turn it on and tap Restart. "
  + "After the restart, unlock the iPhone and tap Turn On.";
// The failure's alert ({title, message}), or null when the error isn't about Developer Mode: the shell's code
// "developer_mode", or installd's words naming it (DeveloperMode, Developer Mode).
export function developerModeFailure(err) {
  const words = `${err?.code ?? ""} ${err?.message ?? (typeof err === "string" ? err : "")}`;
  if (!/developer[ _]?mode/i.test(words)) return null;
  return { title: "Turn On Developer Mode", message: `iOS won't install or open the apps you sign until Developer Mode is on. ${DEV_MODE_STEPS}` };
}

// Where to type the code, one short line a step; `img` is the user's own screenshot of that Settings screen (iPhone 15,
// iOS 27, dark), cropped to the row and its neighbours. `size` is the image's pixels; `box` is the row to tap,
// measured from its separator lines and group edges, as percentages of the image ({x, y, w, h}); the page rings it.
export const PAIR_GUIDE = [
  { text: "Open Settings" },
  { text: "Privacy & Security", img: "img/pair/1-privacy-security.jpg", size: [1206, 509],
    box: { x: 3.98, y: 63.75, w: 92.04, h: 29.17 } },
  { text: "Developer Mode", img: "img/pair/2-developer-mode.jpg", size: [1206, 602],
    box: { x: 3.98, y: 51.66, w: 92.04, h: 24.17 } },
  { text: `Pair with ${NAME}`, img: "img/pair/3-pair-with-ifizbox.jpg", size: [1206, 320],
    box: { x: 3.98, y: 38.75, w: 92.04, h: 45.94 } },
  { text: "Type the code above" },
];

// The ring over a step's row: absolute-position styles for an element laid over the image, `pad` CSS px outside the
// row on every side so the outline sits around it with even margins.
export function ringStyle(box, pad = 3) {
  const at = (pct, d) => `calc(${pct}% ${d < 0 ? "-" : "+"} ${Math.abs(d)}px)`;
  return { left: at(box.x, -pad), top: at(box.y, -pad), width: at(box.w, 2 * pad), height: at(box.h, 2 * pad) };
}

export const PAIR_STEPS = {
  file: [
    "Make a pairing file for this iPhone on a computer (idevice_pair or JitterbugPair).",
    "Save it to Files, then tap Import Pairing File.",
  ],
};

// idevice.pair's events folded into the page's state: { pin, text, error }. The code comes first, before the phone
// connects, and stays for every try. A failed try keeps the pairing open (the phone can tap Pair again), so its error
// stays shown until the next step.
export function pairEvent(state, ev) {
  const e = Array.isArray(ev) ? ev[0] : ev;
  if (!e) return state;
  if (e.pin) return { ...state, pin: e.pin };
  if (e.step === "failed") return { ...state, error: e.error || "The pairing failed." };
  if (e.text) return { ...state, text: e.text, error: "" };
  return state;
}

// idevice.pairState ({active, pin, step, text, error}, read when the app comes back to the foreground) as the page's
// state, or null when no pairing is waiting.
export function pairFromNative(st) {
  if (!st?.active) return null;
  return { pin: st.pin || "", text: st.text || "", error: st.error || "" };
}

// The code as it shows: "123 456".
export const pinText = (pin) => (/^\d{6}$/.test(pin || "") ? `${pin.slice(0, 3)} ${pin.slice(3)}` : pin || "");

// The step or error line under Cancel while pairing waits.
export function pairFooter(p) {
  if (p.error) return `That try didn't pair: ${p.error} Tap Pair on the iPhone to try again.`;
  return p.text || "Starting…";
}

// B258: the phone took the connection, then reset the RemotePairing tunnel before it was up (idevice's
// Socket(UnexpectedEof "early eof") from tunnel_create_rppairing): a pairing it no longer accepts while Pairing still
// says Paired (R54, iPhone 15 Pro). Unlike a refusal it isn't certain (a tunnel reset for another
// reason reads the same), so it offers Pair Again without forgetting the pairing by itself (no `unusable`).
export const earlyEOF = (raw) => /UnexpectedEof|early eof/i.test(raw);

// ---- B316: a broken route, said for what it is and kept until a check passes
// The codes a connect to this iPhone fails with (IDevice.swift).
const CONNECT_CODES = new Set(["refused", "pairing_rejected", "pair_again", "connect_failed", "bad_pairing"]);

// The alerts' words ({title, message}), the install log's and the status cell's (`short`: two lines at 320pt), and
// `fix`: what the fix row or button does ("pair": Pairing; "shortcuts": the Install Switch's page; "check": Check
// Connection again).
// The phone refused every connection through the VPN, lockdown's port too (the shell's route_refused): not the
// pairing. On cellular, iOS takes RemotePairing (49152) and lockdownd (62078) only while data is off (R72).
export function routeRefused(st = null) {
  if (!(st?.vpn?.cellular && !shortcutsAdded(st))) { // F394: no Install Switch asked for off cellular
    return { title: "iPhone Refused", again: false, fix: "check", button: "Check Again",
      message: `This iPhone refused every connection through ${BUILTIN_VPN}, so it isn't the pairing. ${st?.vpn?.cellular ? "Join Wi-Fi and try" : "Try"} again.`,
      short: "Every connection was refused. Try again." };
  }
  return { title: "iPhone Refused", again: false, fix: "shortcuts", button: CELLULAR.button,
    message: `This iPhone refused every connection through ${BUILTIN_VPN}, so it isn't the pairing. On cellular, add the Install Switch, or join Wi-Fi.`,
    short: "Every connection was refused. On cellular, add the Install Switch." };
}

// A failed connect (idevice.verify, an install on this iPhone, vpn.test) as a remembered failure
// { title, message, short, fix, button }, or null when the error isn't about reaching this iPhone (Developer Mode,
// signing, a download): those don't make the route broken.
// B378: vpn_failed: the built-in VPN didn't start (the shell says why, e.g. no network)
const ROUTE_CODES = new Set([...CONNECT_CODES, "route_refused", "not_paired", "vpn_failed", "switch_failed"]);
export function routeFailureOf(err, st = null) {
  const raw = String(err?.message ?? err ?? "");
  const code = err?.code ?? raw.split(":")[0];
  if (!ROUTE_CODES.has(code)) return null;
  if (developerModeFailure(err)) return null;
  const why = verifyFailure(err, st);
  const fix = why.fix ?? (why.again ? "pair" : "check");
  const short = why.short ?? (why.again ? "Installs are refused. Pair again." : "Installs can't reach this iPhone.");
  const button = why.button ?? (fix === "pair" ? "Pair Again" : "Check Again");
  return { title: why.title, message: why.message, short, fix, button, ...(code === "switch_failed" ? { code } : {}) };
}

// Kept in this browser's storage (it outlives a relaunch: the route stays broken until a check passes), and told to
// the pages on screen with the "ifizbox:route-failure" event.
export const FAILURE_KEY = "ifizbox.routeFailure";
const tell = () => { try { globalThis.dispatchEvent?.(new CustomEvent("ifizbox:route-failure")); } catch { /* no events here */ } };
export function routeFailure(storage = globalThis.localStorage) {
  try {
    const f = JSON.parse(storage?.getItem(FAILURE_KEY) || "null");
    return f && typeof f.title === "string" ? f : null;
  } catch { return null; }
}
export function rememberRouteFailure(f, { storage = globalThis.localStorage, now = Date.now() } = {}) {
  if (!f) return;
  try { storage?.setItem(FAILURE_KEY, JSON.stringify({ title: f.title, message: f.message, short: f.short, fix: f.fix, button: f.button, at: now })); } catch { /* storage off */ }
  tell();
}
export function clearRouteFailure(storage = globalThis.localStorage) {
  let had = false;
  try { had = storage?.getItem(FAILURE_KEY) != null; storage?.removeItem(FAILURE_KEY); } catch { /* storage off */ }
  if (had) tell();
}

// A check that got no answer in time (screens' Not Responding): kept too, with Check Again as its fix.
export const NO_ANSWER_FAILURE = { title: "Not Responding", message: "This iPhone didn't answer the last check. Check that the VPN is on, then check again.",
  short: "This iPhone didn't answer the last check.", fix: "check", button: "Check Again" };

// The status cell for a remembered failure: red, with the fix as its action row.
const FIX_ACTIONS = { pair: "pair", check: "check", shortcuts: "shortcuts" };
export function failureStatus(f) {
  return { state: "failed", title: f.title, subtitle: f.short, action: FIX_ACTIONS[f.fix] ?? "check", tone: "warn", red: true, local: false };
}

// B378: the built-in VPN didn't start for an install, so the shell said the VPN's own error (e.g. "can't start without
// a network").
export function vpnFailed(raw) {
  const why = String(raw ?? "").replace(/^vpn_failed:\s*/, "").trim();
  const noNetwork = /without a network|no network/i.test(why);
  const first = why.startsWith(NAME) ? why : `${why.charAt(0).toUpperCase()}${why.slice(1)}`; // the name keeps its own case
  return { title: `${BUILTIN_VPN} Didn't Start`, message: `${first || `${BUILTIN_VPN} didn't start`}.`,
    short: noNetwork ? `${BUILTIN_VPN} needs Wi-Fi or cellular data to start.` : `${BUILTIN_VPN} didn't start.`, fix: "check", button: "Check Again", again: false };
}
// B395: the Install Switch didn't run and the install couldn't go on without it (on cellular, or the VPN didn't start
// either). The shell ran it once and stopped.
export function switchFailed(raw) {
  const why = String(raw ?? "").replace(/^switch_failed:\s*/, "").trim().replace(/[.\s]+$/, "");
  return { title: "Install Switch Didn't Run", again: false, fix: "shortcuts", button: "Update",
    message: `The install stopped${why ? `: ${why}` : ""}. Delete Install Switch in Shortcuts and tap Update, or install through the Signing Server this time.`,
    short: "Update the Install Switch, or use the Signing Server." };
}
// One alert for it: Update (the Install Switch's page) and Use Server, Cancel always there.
export const switchFailedAlert = (f) => ({ title: f.title, message: f.message, buttons: ["Cancel", f.button, "Use Server"], cancel: 0 });
// B395: what stayed off after a queue (vpn.leftOff's {vpn, cellular}) as an alert, or null when nothing did.
export function leftOffAlert(off) {
  if (!off?.vpn && !off?.cellular) return null;
  const what = off.vpn && off.cellular ? "cellular data and your VPN" : off.vpn ? "your VPN" : "cellular data";
  const title = off.vpn && off.cellular ? "Data and VPN Are Off" : off.vpn ? "Your VPN Is Off" : "Cellular Data Is Off";
  return { title, message: `${NAME} couldn't turn ${what} back on after installing. ${off.cellular ? "Turn cellular data on in Settings. " : ""}${off.vpn ? "Choose your VPN in Settings > VPN and turn it on." : ""}`.trim(), buttons: ["OK"] };
}
// What a failed idevice.verify means: { title, message, again } (`again`: offer Pair Again). `st` is the
// idevice.status read for the check (null or left out: not known).
export function verifyFailure(err, st = null) {
  const raw = String(err?.message ?? err ?? "");
  const code = err?.code ?? raw.split(":")[0];
  if (st && !builtinVPN(st)) return NO_VPN; // a profile without Network Extensions can't connect, whatever the error says
  if (code === "vpn_failed") return vpnFailed(raw); // B378
  if (code === "switch_failed") return switchFailed(raw); // B395
  if (code === "route_refused") return routeRefused(st);
  // B220: refused on every port RemotePairing is advertised on, or turned down: the phone no longer has the pairing
  if (code === "refused" || code === "pairing_rejected" || (code === "connect_failed" && /connection refused/i.test(raw))) {
    return { title: "Pair Again", message: `This iPhone no longer accepts ${NAME}'s pairing, so every connection is refused. Pair again.`, again: true, unusable: true };
  }
  if (code === "connect_failed" && earlyEOF(raw)) {
    // (an EOF is read on a socket that was open: the TCP connect to RemotePairing had worked, so the route did too)
    return { title: "Pair Again", message: `This iPhone answered through ${BUILTIN_VPN}, then closed the connection: it no longer accepts ${NAME}'s pairing. Pair again.`, again: true };
  }
  if (code === "connect_failed") { // F372: the shell had its own VPN on; nothing to turn on
    return { title: "Couldn't Connect", message: `${BUILTIN_VPN} was on, but ${NAME} couldn't reach this iPhone through it. Try again.${st?.vpn?.cellular && !shortcutsAdded(st) ? " On cellular, add the Install Switch first." : ""}`, again: false };
  }
  return { title: "Pairing Didn't Work", message: `This iPhone didn't accept the pairing (${raw || "no answer"}). Pair again.`, again: true };
}

// Leaving This iPhone's page while a step runs asks first (screens/installroute.js guards Back, the tab bar and the
// edge swipe): `step` is what runs ("pairing": idevice.pair waiting for the code to be typed; "checking": the page's
// first idevice.status read), or null when nothing does and leaving needs no question. Cancel stays (index 0),
// Leave stops the step (index 1).
export const LEAVE = 1;
export function leaveQuestion(step) {
  const messages = {
    pairing: "Leaving stops pairing. It starts again when you come back to This iPhone.",
    checking: "Leaving stops checking this iPhone. It checks again when you come back.",
  };
  const message = messages[step];
  if (!message) return null;
  return { title: "Stop Setting Up?", message, buttons: ["Cancel", "Leave"], cancel: 0 };
}

// B218: Install Apps With kept in the shell's Keychain (route.keep / route.kept), so a reinstall or a re-sign (a fresh container: localStorage gone), and an account sign-in
// after one, comes back on the route it had. At launch, with nothing stored here, the kept route is taken; otherwise
// what is stored is kept (a build from before this kept nothing); then every change is kept. Sideload app only (the
// setting shows nowhere else). Returns true when it started.
//   keepRoute({ settings, native: nativeBridge(), storage: globalThis.localStorage })   (native.js; none: no start)
export function keepRoute({ settings, native = null, storage = globalThis.localStorage } = {}) {
  if (!settings || typeof native?.call !== "function" || !settings.isShown?.(ROUTE_KEY)) return false;
  const call = (name, params) => Promise.resolve().then(() => native.call(name, params));
  const stored = () => { try { return storage?.getItem(STORAGE_KEY) ?? null; } catch { return null; } };
  const keep = (value) => call("route.keep", { value }).catch(() => {});
  settings.onChange((key, value) => { if (key === ROUTE_KEY) keep(value); });
  if (stored() !== null) { keep(settings.get(ROUTE_KEY)); return true; }
  call("route.kept").then((v) => {
    // a pick made while the shell answered stands
    if ((v === "iphone" || v === "server") && stored() === null) settings.set(ROUTE_KEY, v);
  }).catch(() => {});
  return true;
}

// ---- F366: the Signing Server for one run, when This iPhone fails ----------------------------------------------
// An install through This iPhone that couldn't reach the phone (refused, the pairing lost, the VPN down, not paired:
// routeFailureOf) offers the Signing Server at once, besides the fix: the same apps again through the
// default Signing Server for that install or run only. Install Apps With stays This iPhone.
//   serverFallback(err, route, st)  the failure's { title, message, short, fix, button } when it offers the Signing
//                                Server (`route`: the install's params, { route: "idevice" } on This iPhone), else null;
//                                `st`: idevice.status read after the failure
export const USE_SERVER = "Use the Signing Server";
export const USE_SERVER_LINE = `${DOMAIN} can install it instead, this time only.`;
export const serverStep = (name) => `Installing ${name || "the app"} through the Signing Server`;
export function serverFallback(err, route = { route: "idevice" }, st = null) {
  if (route?.route !== "idevice" || err?.code === "cancelled") return null;
  return routeFailureOf(err, st);
}
