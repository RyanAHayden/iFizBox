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
// idevice.status's `vpn` ({available, tested, cellular, wifi, otherVPN}) says the app can run it: its
// profile has Network Extensions. The shell turns it on for each connect and off after. Without it (an older shell,
// or a profile without the capability) This iPhone can't be used: noVPN says so.
export const BUILTIN_VPN = `${NAME} VPN`;
export const builtinVPN = (st) => Boolean(st?.vpn?.available);
// F409: the fix button of every route failure: the status cell's action row, the install run, the alerts.
export const FIX = "Fix";
// A profile without Network Extensions (or a shell that doesn't know the VPN): said plainly where the VPN's rows would be.
export const NO_VPN = {
  title: "No Network Extensions", again: false, fix: "check", button: FIX,
  message: "This profile has no Network Extensions, so it can't connect. Sign with one that has them, or use the Signing Server.",
  short: "This profile has no Network Extensions.",
};
// ---- F447: Connect Through: the built-in VPN, or LocalDevVPN (free on the App Store), whose own loopback VPN reaches
// this iPhone the same way. The shell keeps the choice (vpn.setVia) and says the one in use as vpn.via ("builtin" or
// "app"); a profile without Network Extensions (a free Apple ID) has LocalDevVPN only. An older shell says no `via`.
export const VPN_APP = "LocalDevVPN";
export const VPN_APP_LINK = "https://apps.apple.com/app/id6755608044";
export const viaApp = (st) => st?.vpn?.via === "app";
// This iPhone can connect at all: through the built-in VPN or through LocalDevVPN
export const canConnect = (st) => builtinVPN(st) || viaApp(st);
// The built-in VPN is the way in: its own branches (another VPN taken off, Restore My VPN, On Cellular's wait)
export const ownVPN = (st) => builtinVPN(st) && !viaApp(st);
// The way in by name, for the texts
export const routeVPN = (st) => (viaApp(st) ? VPN_APP : BUILTIN_VPN);
export const setVia = (native, via) => native.call("vpn.setVia", { via: via === "app" ? "app" : "builtin" });
// LocalDevVPN is off when a connect needs it (the shell's vpn_app_off): Fix checks again once it's on
export const APP_OFF = { title: `Turn On ${VPN_APP}`, again: false, fix: "check", button: FIX,
  message: `${VPN_APP} is off, so nothing can reach this iPhone. Open it, tap Connect, then try again.`,
  short: `${VPN_APP} is off. Turn it on first.` };
export function connectFooter(st) {
  return viaApp(st) ? `Turn ${VPN_APP} on before each install. Works with a free Apple ID.` : `${NAME} turns its VPN on for each install and off after.`;
}
// This iPhone is set up: paired, and the way in tested once (vpn.test). Using it waits for that.
export const iphoneSetUp = (st) => Boolean(st?.paired) && canConnect(st) && Boolean(st.vpn.tested);
// F368: on cellular iOS refuses the connects an install needs, so the install waits for Wi-Fi or Airplane Mode (LocalVPN.swift
// waitOffCellular). AIRPLANE_ON: the wait; AIRPLANE_OFF: the connection is open; CELL_LINE: a failed check there.
export const AIRPLANE_ON = "Waiting to leave cellular data";
export const AIRPLANE_ASK = "Join Wi-Fi or turn on Airplane Mode"; // F417: where no popup says it (Re-sign's own page)
// B423: a wait paused because the app is in the background (LocalVPN.swift pause)
export const APP_WAIT = `Waiting for ${NAME}`;
// opened again with no network (Airplane Mode went on meanwhile): iOS starts no VPN without one
export const NETWORK_WAIT = "Turn Airplane Mode off for a moment";
export const AIRPLANE_OFF = "You can turn Airplane Mode off";
export const CELL_LINE = "On cellular, check on Wi-Fi.";
// B428a: a check can't connect there, so it doesn't try (and one that was refused and ends there says the same): no
// Fix, no Pair Again, not kept as a Route Failure. Not set up yet: the test that finishes it is named.
export const onCellular = (st) => canConnect(st) && Boolean(st.vpn.cellular); // F447: through LocalDevVPN too
export function cellularCheck(st = null) {
  return { title: "Can't Check on Cellular", buttons: ["OK"],
    message: `Join Wi-Fi, then check again.${st?.vpn && !st.vpn.tested ? ` ${STATUS_ACTIONS.test} finishes setting up.` : ""}` };
}
// Refused: what iOS answers on cellular. A pairing it read and turned down isn't.
export function connectRefused(err) {
  const raw = String(err?.message ?? err ?? "");
  const code = err?.code ?? raw.split(":")[0];
  return code === "route_refused" || code === "refused" || (code === "connect_failed" && /connection refused/i.test(raw));
}
// The wait ran out: not a broken route, so it isn't remembered as one; the Signing Server works on cellular.
export const AIRPLANE_TIMEOUT = { title: "Airplane Mode Not On", message: "Airplane Mode wasn't turned on, so nothing was installed. Try again.",
  short: "Airplane Mode wasn't turned on." };
export const airplaneTimeout = (err) => (err?.code ?? String(err?.message ?? err ?? "").split(":")[0]) === "airplane_timeout";
// C73: another VPN is up (or chosen in Settings > VPN): iOS runs one at a time, so an install turns it off.
// F447: through LocalDevVPN, the other VPN is the way in, so nothing is taken off.
export const otherVPNOn = (st) => ownVPN(st) && Boolean(st.vpn.otherVPN || st.vpn.otherVPNSelected);
export const OTHER_VPN_LINE = "Your VPN goes off during installs. Turn it back on after.";
// F414: the status group's footer once This iPhone is set up: one hint, or none. F412: with Restore My VPN on, its own footer says what becomes of the other VPN.
export function setupFooter(st) {
  if (!iphoneSetUp(st)) return "";
  if (otherVPNOn(st) && !st.vpn.restore) return OTHER_VPN_LINE;
  return ""; // F417: On Cellular's own footer says what happens there
}
// F414: setting up, as rows: what each is and whether it's done (`next`: a tap does it). The test is when iOS asks to
// allow the VPN (B357), so those two are done together.
export const SET_UP = "Set Up This iPhone";
export const SETUP_FOOTER = "Once is enough. It stays set up after updates and re-signing.";
// F447: through LocalDevVPN, step 2 turns it on (`app`: a tap opens its App Store page) and step 3 tests with it on.
export function setupSteps(st) {
  const paired = Boolean(st?.paired), tested = Boolean(st?.vpn?.tested);
  const test = { done: paired && tested, next: paired && !tested };
  if (viaApp(st)) return [
    { key: "pair", label: "1. Pair This iPhone", subtitle: pairState(st) === "file" ? "Import a pairing file from a computer" : "Type a 6-digit code in Settings", done: paired, next: !paired },
    { key: "app", label: `2. Turn On ${VPN_APP}`, subtitle: "Free on the App Store. Open it, tap Connect.", done: paired && tested, next: !(paired && tested), app: true },
    { key: "test", label: "3. Test Connection", subtitle: `With ${VPN_APP} on`, ...test },
  ];
  return [
    { key: "pair", label: "1. Pair This iPhone", subtitle: pairState(st) === "file" ? "Import a pairing file from a computer" : "Type a 6-digit code in Settings", done: paired, next: !paired },
    { key: "allow", label: `2. Allow ${BUILTIN_VPN}`, subtitle: "iOS asks once, right after pairing", ...test },
    { key: "test", label: "3. Test Connection", subtitle: "Runs by itself", ...test },
  ];
}
// F414: This iPhone's own page: its status cell and action ({ state, title, subtitle, tone, red, action, busy }). `failure`
// (routeFailure) counts only while paired; `running`: a check, test or Fix runs; `late`: idevice.status didn't answer.
export function iphoneStatus(st, { reading = false, running = false, late = false, failure = null } = {}) {
  const action = !st ? "check" : !st.paired ? "start" : failure ? "fix" : !st.vpn?.tested ? "test" : "check";
  if (running) return { state: "checking", title: CHECKING.title, subtitle: viaApp(st) ? `Reaching this iPhone through ${VPN_APP}.` : "Turning on the VPN and reaching this iPhone.", tone: "wait", action, busy: true };
  if (late) return { state: "late", title: "Not Responding", subtitle: "This iPhone didn't answer.", tone: "warn", red: true, action: "check" };
  if (reading || !st) return { state: "checking", title: CHECKING.title, subtitle: CHECKING.subtitle, tone: "wait", action: "check", dim: true };
  if (!st.paired) return { state: "setup", title: "Not Set Up", subtitle: "Installs straight onto this iPhone, with no server and no popups.", tone: "warn", action };
  if (failure) { const f = failureStatus(failure); return { state: "failed", title: f.title, subtitle: f.subtitle, tone: f.tone, red: true, action }; }
  if (!st.vpn?.tested) return { state: "finish", title: "Almost Done", subtitle: FINISH_LINE, tone: "warn", action };
  return { state: "ready", title: "Ready to Install", subtitle: `Straight onto this iPhone, through ${routeVPN(st)}.`, tone: "ok", action };
}
const FINISH_LINE = "Paired. Test the connection once to finish.";
// F414: a failed check asks to fix: { title, message, buttons, cancel: 0 }. `why` is verifyFailure's (or Not Responding).
export function fixQuestion(why, st = null) {
  const q = { title: why.title, message: why.message, buttons: ["Not Now", FIX], cancel: 0 };
  if (why.again) return { ...q, title: PAIRING_LOST, message: `This iPhone isn't paired with ${NAME} any more, so nothing can install. Fix it now?` };
  if (why.title === "Couldn't Connect") q.message = `${routeVPN(st)} ${viaApp(st) ? "was on" : "came on"}, but this iPhone didn't answer. Fix tries again from the start.${st?.vpn?.cellular ? ` ${CELL_LINE}` : ""}`;
  return q;
}
// How It Works: the steps of one install, a row each.
export const HOW_STEPS = [
  { label: "1. Download", subtitle: "The app downloads over Wi-Fi or cellular." },
  { label: "2. Sign", subtitle: "Signed on this iPhone with your certificate." },
  { label: `3. ${BUILTIN_VPN} On`, subtitle: "iOS runs one VPN at a time, so yours pauses." },
  { label: "4. Install", subtitle: "Copied straight to iOS. On cellular, as On Cellular says." },
  { label: `5. ${BUILTIN_VPN} Off`, subtitle: "Turn yours back on after." },
];
// F447: through LocalDevVPN nothing turns on or off: the person keeps it on.
export const HOW_STEPS_APP = [
  HOW_STEPS[0], HOW_STEPS[1],
  { label: `3. ${VPN_APP} On`, subtitle: "Turn it on first: open it and tap Connect." },
  { label: "4. Install", subtitle: `Copied straight to iOS through ${VPN_APP}.` },
];
export const howSteps = (st) => (viaApp(st) ? HOW_STEPS_APP : HOW_STEPS);
// vpn.test's answer, or its error, as the alert's words. F447: `r.via` "app": the test went through LocalDevVPN.
export function vpnTestResult(r, err = null) {
  if (r?.ok && r.via === "app") return { title: "Connected", message: `${NAME} reached this iPhone through ${VPN_APP}${r.ms ? ` in ${r.ms} ms` : ""}.` };
  if (r?.ok) return { title: "Connected", message: `${BUILTIN_VPN} reached this iPhone${r.ms ? ` in ${r.ms} ms` : ""}, then turned off again.` };
  const raw = String(err?.message ?? err ?? "");
  if (/^vpn_app_off:/.test(raw) || err?.code === "vpn_app_off") return { title: APP_OFF.title, message: APP_OFF.message };
  if (/^vpn_failed:/.test(raw)) return { title: `${BUILTIN_VPN} Didn't Start`, message: `${raw.replace(/^vpn_failed:\s*/, "")}.` };
  const why = verifyFailure(err, { paired: true, vpn: { available: true } });
  return { title: why.title, message: why.message, again: why.again };
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
// F417: `cellular` (core/cellular.js): "server" goes through the Signing Server while the phone is on cellular.
export function decideRoute(choice, status, cellular = "ask") {
  if (choice !== "iphone") return { route: "server" };
  if (!status) return { route: "server", alert: "noStatus" };
  if (!status.paired) return { route: "server", alert: "notPaired" };
  if (!canConnect(status)) return { route: "server", alert: "noVPN" };
  // F447: On Cellular is the built-in VPN's (hidden through LocalDevVPN), so its choice counts only there
  if (cellular === "server" && ownVPN(status) && onCellular(status)) return { route: "server", cellular: true };
  return { route: "idevice" };
}

// buttons: the first is the server fallback.
export const ALERTS = {
  noStatus: { title: "Can't Reach This iPhone", message: "This install goes through the Signing Server.", buttons: ["OK"] },
  notPaired: { title: "Not Paired", message: `${NAME} isn't paired with this iPhone yet, so this install goes through the Signing Server. Pair in Settings > Installation.`, buttons: ["OK"] },
  noVPN: { title: NO_VPN.title, message: `This install goes through the Signing Server. ${NO_VPN.message}`, buttons: ["OK"] },
};

// ---- Installation & Signing's top cell (F284, option B of the concept): one two-line status and one action row
// whose label changes. `choice` is Install Apps With; `st` idevice.status (null: it failed; undefined: not answered
// yet); `host` the Signing Server's host. Returns
//   { state, title, subtitle, action, tone: "ok"|"warn"|"wait", local }
// `local`: installs go straight onto this iPhone now (the Signing Server row then says This iPhone).
// `action` is a key of STATUS_ACTIONS. Every subtitle fits two lines at 320pt (the cell keeps two lines' height).
export const STATUS_ACTIONS = {
  check: "Check Connection", fix: FIX, checkServer: "Check Server", setup: SET_UP, start: "Start Setup", test: "Test Connection",
  certificate: "Import Certificate",
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
  return failure && (s.state === "ready" || s.state === "finish") ? failureStatus(failure) : s;
}
function routeStatus(choice, st, { host = DOMAIN, certificate } = {}) {
  if (certificate === false) return NO_CERTIFICATE;
  if (choice !== "iphone") return { state: "server", title: "Ready to Install", subtitle: `Through the Signing Server, ${host}.`, action: "checkServer", tone: "ok", local: false };
  if (st === undefined) return CHECKING;
  const later = `Installs use ${host} for now.`;
  if (!st) return { state: "noStatus", title: "Can't Reach This iPhone", subtitle: later, action: "fix", tone: "warn", local: false };
  if (!canConnect(st)) return { state: "noVPN", title: NO_VPN.title, subtitle: `This profile can't connect. ${later}`, action: "fix", tone: "warn", local: false };
  if (!st.paired) return { state: "pair", title: SET_UP, subtitle: "Takes about a minute, once. Until then installs use the Signing Server.", action: "setup", tone: "warn", local: false };
  if (!st.vpn.tested) return { state: "finish", title: "Finish Setting Up", subtitle: FINISH_LINE, action: "setup", tone: "warn", local: true }; // F414
  return { state: "ready", via: routeVPN(st), title: "Ready to Install", subtitle: `Straight onto this iPhone, through ${routeVPN(st)}.`, action: "check", tone: "ok", local: true };
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
  return canConnect(status) ? "pairing" : "noVPN";
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

// B436: idevice.pair's answer when nothing paired within the shell's 10 minutes (pairLimit): the page says so and
// offers a new code.
export const codeExpired = (e) => e?.code === "expired" || /^expired:/.test(e?.message || "");
export const CODE_EXPIRED = "The code expired after 10 minutes.";
export const NEW_CODE = "Get New Code";

// The code as it shows: "123 456".
export const pinText = (pin) => (/^\d{6}$/.test(pin || "") ? `${pin.slice(0, 3)} ${pin.slice(3)}` : pin || "");

// The step or error line under Cancel while pairing waits.
export function pairFooter(p) {
  if (p.error) return `That try didn't pair: ${plainSocket(p.error)} Tap Pair on the iPhone to try again.`;
  return p.text || "Starting…";
}

// B258: the phone took the connection, then reset the RemotePairing tunnel before it was up (idevice's
// Socket(UnexpectedEof "early eof") from tunnel_create_rppairing): a pairing it no longer accepts while Pairing still
// says Paired (R54, iPhone 15 Pro). Unlike a refusal it isn't certain (a tunnel reset for another
// reason reads the same), so it offers Pair Again without forgetting the pairing by itself (no `unusable`).
export const earlyEOF = (raw) => /UnexpectedEof|early eof/i.test(raw);
// B416: the same with a reset: no host paired, remotepairingd takes the TCP connection, then resets it (B246).
export const connectReset = (raw) => /ConnectionReset|connection reset by peer/i.test(raw);
// A first connect the phone answered and then dropped: the pairing is gone. Only the connect's own code: a drop
// mid-install has the code of its step.
export const droppedPairing = (code, raw) => code === "pair_again" || (code === "connect_failed" && (earlyEOF(raw) || connectReset(raw)));
export const PAIR_AGAIN_LINE = `This iPhone isn't paired with ${NAME} any more. Pair again.`;

// B416: idevice's own socket text (Rust debug: Socket(Os { code: 54, … }), Socket(Kind(TimedOut)), InternalError("…"))
// never shows in a red line or an alert: the grey log lines keep it. plainSocket(text) is `text` without it: a
// parenthesis around it goes ("lost the connection … (Socket(…) (1)). iOS may …"); nothing but it becomes LOST_LINE.
export const LOST_LINE = "The connection to this iPhone was lost. Try again.";
const SOCKET = /\b(?:Socket|InternalError|RemotePairing|CdTunnel)\(|\bOs \{|\bKind\(|UnexpectedEof|\bearly eof\b|\bos error \d+|connection (?:reset|refused|closed|aborted)\b|broken pipe|no route to host|network is (?:unreachable|down)|operation timed? ?out/i;
export const hasSocketText = (text) => SOCKET.test(String(text ?? ""));
export function plainSocket(text) {
  const t = String(text ?? "");
  if (!hasSocketText(t)) return t;
  let out = "";
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "(" && (i === 0 || /\s/.test(t[i - 1]))) {
      let end = i, depth = 0;
      for (; end < t.length; end++) { if (t[end] === "(") depth++; else if (t[end] === ")" && --depth === 0) break; }
      if (hasSocketText(t.slice(i + 1, end))) { out = out.trimEnd(); i = end; continue; }
    }
    out += t[i];
  }
  return hasSocketText(out) || !out.trim() ? LOST_LINE : out.trim();
}

// ---- B316: a broken route, said for what it is and kept until a check passes
// The codes a connect to this iPhone fails with (IDevice.swift).
const CONNECT_CODES = new Set(["refused", "pairing_rejected", "pair_again", "connect_failed", "bad_pairing"]);

// The alerts' words ({title, message}), the install log's and the status cell's (`short`: two lines at 320pt), and
// `fix`: what the Fix row or button does ("pair": Pairing; "check": the
// connection checked at once).
// The phone refused every connection through the VPN, lockdown's port too (the shell's route_refused): not the
// pairing. On cellular, iOS takes RemotePairing (49152) and lockdownd (62078) only while data is off (R72).
export function routeRefused(st = null) {
  const cell = Boolean(st?.vpn?.cellular);
  return { title: "iPhone Refused", again: false, fix: "check", button: FIX,
    message: `This iPhone refused every connection through ${routeVPN(st)}, so it isn't the pairing. ${cell ? CELL_LINE : "Try again."}`,
    short: cell ? `Refused. ${CELL_LINE}` : "Every connection was refused. Try again." };
}

// A failed connect (idevice.verify, an install on this iPhone, vpn.test) as a remembered failure
// { title, message, short, fix, button }, or null when the error isn't about reaching this iPhone (Developer Mode,
// signing, a download): those don't make the route broken.
// B378: vpn_failed: the built-in VPN didn't start (the shell says why, e.g. no network)
// F447: vpn_app_off: LocalDevVPN is the way in and it's off
const ROUTE_CODES = new Set([...CONNECT_CODES, "route_refused", "not_paired", "vpn_failed", "vpn_app_off"]);
export function routeFailureOf(err, st = null) {
  const raw = String(err?.message ?? err ?? "");
  const code = err?.code ?? raw.split(":")[0];
  if (!ROUTE_CODES.has(code)) return null;
  if (developerModeFailure(err)) return null;
  const why = verifyFailure(err, st);
  const fix = why.fix ?? (why.again ? "pair" : "check");
  const short = why.short ?? (droppedPairing(code, raw) && why.again ? "Not paired any more. Pair again." : why.again ? "Installs are refused. Pair again." : "Installs can't reach this iPhone.");
  return { title: why.title, message: why.message, short, fix, button: FIX };
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

// A check that got no answer in time (screens' Not Responding): kept too, with the check as its fix.
export const NO_ANSWER_FAILURE = { title: "Not Responding", message: "This iPhone didn't answer the last check. Check that the VPN is on, then check again.",
  short: "This iPhone didn't answer the last check.", fix: "check", button: FIX };

export const PAIRING_LOST = "Pairing Lost";
// F410a: This iPhone is chosen and idevice.status answered that it isn't paired (no VPN needed to know).
export const needsPairing = (choice, st) => choice === "iphone" && Boolean(st) && !st.paired;
// The status cell for a remembered failure: red, with Fix as its action row (`fix`: what it does).
export function failureStatus(f) {
  const lost = f.fix === "pair"; // F414
  return { state: "failed", title: lost ? PAIRING_LOST : f.title, subtitle: lost ? "This iPhone isn't paired any more. Nothing can install until it's fixed." : f.short, action: "fix", fix: f.fix, tone: "warn", red: true, local: false };
}

// F409: Fix tapped outside Installation & Signing (an install's alert, the run's Log): the page runs the check when it
// draws; "ifizbox:route-fix" tells one already on screen. The tap holds FIX_HOLD ms.
export const FIX_HOLD = 10_000;
let fixAsked = 0;
export function askFix(now = Date.now()) { fixAsked = now; }
export function takeFix(now = Date.now()) { const on = fixAsked > 0 && now - fixAsked < FIX_HOLD; fixAsked = 0; return on; }
export function tellFix() { try { globalThis.dispatchEvent?.(new CustomEvent("ifizbox:route-fix")); } catch { /* no events here */ } }

// B378: the built-in VPN didn't start for an install, so the shell said the VPN's own error (e.g. "can't start without
// a network").
export function vpnFailed(raw) {
  const why = String(raw ?? "").replace(/^vpn_failed:\s*/, "").trim();
  const noNetwork = /without a network|no network/i.test(why);
  const first = why.startsWith(NAME) ? why : `${why.charAt(0).toUpperCase()}${why.slice(1)}`; // the name keeps its own case
  return { title: `${BUILTIN_VPN} Didn't Start`, message: `${first || `${BUILTIN_VPN} didn't start`}.`,
    short: noNetwork ? `${BUILTIN_VPN} needs Wi-Fi or cellular data to start.` : `${BUILTIN_VPN} didn't start.`, fix: "check", button: FIX, again: false };
}
// What a failed idevice.verify means: { title, message, again } (`again`: offer Pair Again). `st` is the
// idevice.status read for the check (null or left out: not known).
export function verifyFailure(err, st = null) {
  const raw = String(err?.message ?? err ?? "");
  const code = err?.code ?? raw.split(":")[0];
  if (st && !canConnect(st)) return NO_VPN; // a profile without Network Extensions on an older shell can't connect, whatever the error says
  if (code === "vpn_app_off") return APP_OFF; // F447
  if (code === "vpn_failed") return vpnFailed(raw); // B378
  if (code === "route_refused") return routeRefused(st);
  // B220: refused on every port RemotePairing is advertised on, or turned down: the phone no longer has the pairing
  if (code === "refused" || code === "pairing_rejected" || (code === "connect_failed" && /connection refused/i.test(raw))) {
    return { title: "Pair Again", message: `This iPhone no longer accepts ${NAME}'s pairing, so every connection is refused. Pair again.`, again: true, unusable: true };
  }
  if (droppedPairing(code, raw)) {
    // (an EOF or a reset comes on a socket that was open: the TCP connect to RemotePairing had worked, so the route did too)
    return { title: "Pair Again", message: PAIR_AGAIN_LINE, again: true };
  }
  // B416: a timeout, or a socket that failed any other way, isn't the pairing's fault
  if (code === "connect_failed" || code === "timeout" || (code !== "bad_pairing" && hasSocketText(raw))) { // F372: the shell had its own VPN on; nothing to turn on
    return { title: "Couldn't Connect", message: `${routeVPN(st)} was on, but ${NAME} couldn't reach this iPhone through it. Try again.${st?.vpn?.cellular ? ` ${CELL_LINE}` : ""}`, again: false };
  }
  return { title: "Pairing Didn't Work", message: `This iPhone didn't accept the pairing (${hasSocketText(raw) ? "the connection was lost" : raw || "no answer"}). Pair again.`, again: true };
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
export const serverStep = (name) => `Trying ${name || "the app"} through the Signing Server`;
export function serverFallback(err, route = { route: "idevice" }, st = null) {
  if (route?.route !== "idevice" || err?.code === "cancelled") return null;
  if (airplaneTimeout(err)) return AIRPLANE_TIMEOUT; // F368
  return routeFailureOf(err, st);
}

// ---- F410b: the Quiet Pairing Check ----------------------------------------------------------------------------
// With This iPhone chosen and paired, the pairing is checked in the background (idevice.verify), so Home's tile says
// Pair Again before an install fails: at most once a day, at launch or on coming back, and at each launch while a
// failure is kept. A verify turns the built-in VPN on, which takes another VPN off and may not bring it back, so it
// runs only where that can't hurt (quietCheckAllowed). screens/installroute.js quietPairingCheck runs it.
export const QUIET_KEY = "ifizbox.quietPairingCheck"; // when the last one ran (ms)
export const QUIET_EVERY = 24 * 60 * 60 * 1000;
export function quietCheckDue({ launch = false, storage = globalThis.localStorage, now = Date.now() } = {}) {
  if (launch && routeFailure(storage)) return true;
  let last;
  try { last = Number(storage?.getItem(QUIET_KEY) ?? 0); } catch { return false; } // not known: no check rather than one at every return
  return !(last > 0) || now - last >= QUIET_EVERY || last > now; // `last` ahead: the clock was set back
}
// Kept as the check starts; false when it can't be kept.
export function markQuietCheck({ storage = globalThis.localStorage, now = Date.now() } = {}) {
  try { storage.setItem(QUIET_KEY, String(now)); return true; } catch { return false; }
}
// `st` is idevice.status. Set up (a VPN not tested yet would make iOS ask to allow it), no other VPN up, not on
// cellular, on Wi-Fi (with no network the VPN can't start), and the built-in VPN not on already (an install or a test
// holds it; `again`: the check's own second try, seconds after its first, whose VPN may still be on).
// F447: through LocalDevVPN nothing of ours starts, so the VPN's branches are skipped: it runs only while LocalDevVPN is
// up (vpn.otherVPN), on Wi-Fi.
export function quietCheckAllowed(choice, st, { again = false } = {}) {
  if (choice !== "iphone" || !iphoneSetUp(st)) return false;
  if (viaApp(st)) return Boolean(st.vpn.otherVPN) && !st.vpn.cellular && Boolean(st.vpn.wifi);
  if (st.vpn.restore) return false; // F419: each check would need a trip to Shortcuts to bring the other VPN back
  if (otherVPNOn(st) || st.otherVPN || st.vpn.cellular || !st.vpn.wifi) return false;
  return again || !st.vpn.on;
}

// Restore My VPN (sideload, built-in VPN): the kept setting, read as idevice.status's vpn.restore. Answers that vpn status.
export const RESTORE_VPN = "Restore My VPN";
// F412: shown when the shell can run the built-in VPN and knows the setting
export const restoreShown = (st) => ownVPN(st) && typeof st.vpn.restore === "boolean"; // F447: not through LocalDevVPN
// F420: what is left to do before the Shortcut can bring the VPN back. Shortcuts never says whether it was added, so the
// page keeps it (`kept`): "0" a run didn't find it, "1" added since the last store run that passed, "2" that run passed;
// null: never kept, so vpn.remembered alone says. "" once nothing is left, or the shell doesn't say `remembered`.
export const RESTORE_KEY = "ifizbox.restoreShortcut";
export function restoreKept(storage = globalThis.localStorage) {
  try { const v = storage?.getItem(RESTORE_KEY); return ["0", "1", "2"].includes(v) ? v : null; } catch { return null; }
}
export function keepRestore(v, storage = globalThis.localStorage) {
  try { storage?.setItem(RESTORE_KEY, v); } catch { /* storage off */ }
}
export function restoreLeft(st, kept = restoreKept()) {
  if (typeof st?.vpn?.remembered !== "boolean") return "";
  if (kept === "0" || (kept === null && !st.vpn.remembered)) return "add";
  return !st.vpn.remembered || kept === "1" ? "remember" : "";
}
export const REMEMBER_VPN = "Remember My VPN";
export const REMEMBER_AGAIN = "Remember VPN Again";
export const REMEMBER_AGAIN_FOOTER = "Only if you changed VPN apps.";
export const RESTORE_FIX = { add: "Add Shortcut", remember: REMEMBER_VPN }; // the group's fix row
export const RESTORE_NEVER_FOOTER = "You chose Don't Ask Again. To be asked again, turn this switch off and on."; // F428a: off clears it
export function restoreFooter(st, left = restoreLeft(st)) {
  if (!st?.vpn?.restore) return "Your own VPN stays off after installs.";
  if (left === "add") return "Add its Shortcut to finish.";
  if (left === "remember") return st.vpn.otherVPN ? "Let the Shortcut remember your VPN to finish." : "Turn your VPN on, then remember it here.";
  if (st.vpn.restoreNever === true) return RESTORE_NEVER_FOOTER;
  return "After installs, Shortcuts opens for a moment and turns your VPN back on.";
}
// A store run that failed (native RestoreShortcut): the alert. `again`: its Try Again; `add`: its Add Shortcut Again.
export function rememberFailed(code) {
  if (code === "no_vpn") return { title: "Turn Your VPN On", message: "Turn on the VPN you use, then try again." };
  const q = `“${RESTORE_VPN}”`;
  return { title: "VPN Not Remembered", again: true, add: code === "not_run",
    message: { not_run: `The Shortcut ${q} wasn't found or wasn't allowed to run.`, no_end: `The Shortcut ${q} didn't finish.`,
      no_return: `The Shortcut ${q} didn't answer.`, not_opened: "Shortcuts didn't open.", busy: `The Shortcut ${q} was still running.`,
      vpn_on: `${BUILTIN_VPN} was still on.` }[code] ?? `The Shortcut ${q} didn't run.` };
}
export const setRestoreVPN = (native, on) => native.call("vpn.setRestore", { on: Boolean(on) });

// F415: iOS checks a new or regenerated provisioning profile online on an app's first launch; with no network then (or
// one changing) it shows "Unable to Verify App" (R96). No app can run that check ahead, so every signed install's end
// says what to do, as a grey line with no button (nav/progress.js page.help). An app run's: core/apprun.js firstLaunchHint.
export const FIRST_LAUNCH_HINT = "If the first launch says Unable to Verify App, turn Airplane Mode off, make sure you're online, tap Cancel and open the app again.";
export function sayFirstLaunch(page, text = FIRST_LAUNCH_HINT) {
  if (text) page?.help?.(text, { label: "" });
}
