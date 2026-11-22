// Settings > Installation's route (docs/sideload.md, "This iPhone"): how the sideload app hands a signed IPA to iOS.
//   "server"  the Signing Server's manifest and iOS's Install prompt (the default)
//   "iphone"  this phone's own installd over LocalDevVPN or Tailscale (native/sideload/idevice, native/sideload/tailscale):
//             no server, iFizBox updates itself
// Pure: the decision for one install from the idevice.status answer, the texts, and the pairing page's state.
import { NAME, DOMAIN } from "../brand.js";

export const ROUTE_KEY = "installRoute";
export const STORAGE_KEY = "ifizbox." + ROUTE_KEY;

// The VPN apps This iPhone connects through: LocalDevVPN (the phone at 10.7.0.1) or Tailscale (the app's own
// tailnet node reaching the phone's own Tailscale address). Every text says them from this list.
export const VPNS = ["LocalDevVPN", "Tailscale"];
export const vpnList = (vpns = VPNS) => vpns.length < 2 ? vpns.join("") : `${vpns.slice(0, -1).join(", ")} or ${vpns.at(-1)}`;

// Subtitles: one short point per line (the rows wrap them, settings.css .route-row).
// F300: This iPhone first, then the Signing Server (still the default).
export const ROUTE_OPTIONS = [
  { value: "iphone", label: "This iPhone", subtitle: `${vpnList()}\nNo server, no install popup\nUpdates itself` },
  { value: "server", label: "Signing Server", subtitle: `Default\nUses ${DOMAIN}` },
];

// This iPhone's page says what it gives in one sentence under its title. Installs through installation_proxy never
// show iOS's install prompt, so that is one of the points.
export const IPHONE_INTRO = `Installs straight onto this iPhone: no server, no install popup, and ${NAME} can update itself.`;

export function storedRoute(storage = globalThis.localStorage) {
  try { return storage?.getItem(STORAGE_KEY) === "iphone" ? "iphone" : "server"; } catch { return "server"; }
}

// One install's route: { route: "idevice" } or { route: "server" }, with `alert` (a key of ALERTS) when This iPhone
// is chosen but can't be used now; "otherVPN" asks first (Use Server or Open LocalDevVPN), the rest fall back.
// `status` is idevice.status ({paired, localDevVPN, otherVPN, tailscale}), null when the call failed.
// `tailscale.use` is the shell's own rule (Connect With: Tailscale, or Automatic with the Tailscale VPN on, and
// signed in): then it connects through Tailscale, with no LocalDevVPN alert.
export function decideRoute(choice, status) {
  if (choice !== "iphone") return { route: "server" };
  if (!status) return { route: "server", alert: "noStatus" };
  if (!status.paired) return { route: "server", alert: "notPaired" };
  const ts = status.tailscale;
  if (ts?.use) return { route: "idevice" };
  if (ts?.connect === "tailscale") {
    if (ts.signedIn && status.otherVPN && !tailscaleVPNOn(status)) return { route: "server", alert: "otherVPNTailscale" }; // F284
    return { route: "server", alert: ts.signedIn ? "tailscaleOff" : "tailscaleSignIn" };
  }
  if (status.localDevVPN) return { route: "idevice" };
  // F284: Tailscale's own VPN on is never "another VPN": it is the route, once iFizBox is signed in to it (and
  // Connect With isn't LocalDevVPN).
  if (tailscaleVPNOn(status)) return { route: "server", alert: ts.signedIn ? "tailscaleConnect" : "tailscaleSignIn" };
  if (status.otherVPN) return { route: "server", alert: setUpWithTailscale(ts) ? "otherVPNTailscale" : "otherVPN" };
  return { route: "server", alert: "vpnOff" };
}

const VPN = VPNS[0];
// buttons: the first is the server fallback; `open` is the index of Open LocalDevVPN (the install waits for it).
export const ALERTS = {
  noStatus: { title: "Can't Reach This iPhone", message: "This install goes through the Signing Server.", buttons: ["OK"] },
  notPaired: { title: "Not Paired", message: `${NAME} isn't paired with this iPhone yet, so this install goes through the Signing Server. Pair in Settings > Installation.`, buttons: ["OK"] },
  otherVPN: {
    title: "Another VPN Is On",
    message: `Installing on this iPhone needs ${VPN}, and iOS runs one VPN at a time. Turn ${VPN} on, or install through the Signing Server.`,
    buttons: ["Use Server", `Open ${VPN}`], open: 1,
  },
  vpnOff: {
    title: `${VPN} Is Off`,
    message: `This install goes through the Signing Server. Turn ${VPN} on to install on this iPhone.`,
    buttons: ["OK", `Open ${VPN}`], open: 1,
  },
  tailscaleOff: { title: "Tailscale Is Off", message: "This install goes through the Signing Server. Turn Tailscale on in the Tailscale app to install on this iPhone.", buttons: ["OK"] },
  tailscaleSignIn: { title: "Sign In to Tailscale", message: `This install goes through the Signing Server. Sign ${NAME} in to Tailscale in Settings > Installation.`, buttons: ["OK"] },
  // F284: set up with Tailscale and a VPN that isn't Tailscale's is on (no Open: the shell's open is LocalDevVPN's)
  otherVPNTailscale: { title: "Another VPN Is On", message: "Installing on this iPhone needs the Tailscale app's VPN, and iOS runs one VPN at a time. Turn Tailscale on, or install through the Signing Server.", buttons: ["OK"] },
  tailscaleConnect: { title: "Tailscale Is On", message: "This install goes through the Signing Server because Connect With is LocalDevVPN. Pick Automatic in Settings > Installation & Signing > This iPhone to install through Tailscale.", buttons: ["OK"] },
};

// F284: the Tailscale app's VPN is on: idevice.status's tailscale.address is this phone's own tailnet address, there
// only while that VPN is up (Tailscale.swift ownAddress), whether or not iFizBox is signed in.
export const tailscaleVPNOn = (status) => Boolean(status?.tailscale?.address);

// F284 (user 2026-11-20): the VPN follows what the user set up, never which apps are installed. Set up with Tailscale:
// Connect With is Tailscale, or iFizBox is signed in to Tailscale (setup's Sign In) and Connect With isn't
// LocalDevVPN. Otherwise (LocalDevVPN, or nothing chosen yet) LocalDevVPN, the default. `ts`: idevice.status.tailscale.
export const setUpWithTailscale = (ts) => ts?.connect === "tailscale" || Boolean(ts?.signedIn && ts?.connect !== "localdevvpn");

// ---- Installation & Signing's top cell (F284, option B of the concept): one two-line status and one action row
// whose label changes. `choice` is Install Apps With; `st` idevice.status (null: it failed; undefined: not answered
// yet); `host` the Signing Server's host. Which VPN an action opens follows setUpWithTailscale. Returns
//   { state, title, subtitle, action, tone: "ok"|"warn"|"wait", local }
// `local`: installs go straight onto this iPhone now (the Signing Server row then says This iPhone).
// `action` is a key of STATUS_ACTIONS. Every subtitle fits two lines at 320pt (the cell keeps two lines' height).
export const STATUS_ACTIONS = {
  check: "Check Connection", checkServer: "Check Server", openVPN: `Open ${VPNS[0]}`, pair: "Start Pairing",
  signIn: "Sign In to Tailscale", openTailscale: "Open Tailscale", useTailscale: "Use Tailscale",
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
  return failure && s.state === "ready" ? failureStatus(failure) : s;
}
function routeStatus(choice, st, { host = DOMAIN, certificate } = {}) {
  if (certificate === false) return NO_CERTIFICATE;
  if (choice !== "iphone") return { state: "server", title: "Ready to Install", subtitle: `Through the Signing Server, ${host}.`, action: "checkServer", tone: "ok", local: false };
  if (st === undefined) return CHECKING;
  const later = `Installs use ${host} for now.`;
  if (!st) return { state: "noStatus", title: "Can't Reach This iPhone", subtitle: later, action: "check", tone: "warn", local: false };
  if (!st.paired) return { state: "pair", title: "Pair This iPhone", subtitle: `Installs use ${host} until it's paired.`, action: "pair", tone: "warn", local: false };
  const ts = st.tailscale ?? {};
  const ready = (via) => ({ state: "ready", via, title: "Ready to Install", subtitle: `Straight onto this iPhone, through ${via}.`, action: "check", tone: "ok", local: true });
  if (ts.use) return ready("Tailscale");
  const signIn = { state: "signIn", title: "Sign In to Tailscale", subtitle: `Tailscale is the way in. ${later}`, action: "signIn", tone: "warn", local: false };
  const otherOn = st.otherVPN && !st.localDevVPN && !tailscaleVPNOn(st);
  if (ts.connect === "tailscale") {
    if (ts.signedIn && otherOn) return { state: "otherVPN", title: "Another VPN Is On", subtitle: `iOS runs one VPN at a time. ${later}`, action: "openTailscale", tone: "warn", red: true, local: false };
    return ts.signedIn ? { state: "tailscaleOff", title: "Tailscale Is Off", subtitle: `Turn on the Tailscale app's VPN. ${later}`, action: "openTailscale", tone: "warn", local: false } : signIn;
  }
  if (st.localDevVPN) return ready(VPNS[0]);
  if (tailscaleVPNOn(st)) {
    return ts.signedIn ? { state: "tailscaleConnect", title: "Tailscale Is On", subtitle: `Connect With is ${VPNS[0]}. ${later}`, action: "useTailscale", tone: "warn", local: false } : signIn;
  }
  // Another VPN (not Tailscale's), or nothing on: the action opens the VPN the user set up (setUpWithTailscale)
  const viaTs = setUpWithTailscale(ts);
  if (st.otherVPN) return { state: "otherVPN", title: "Another VPN Is On", subtitle: `iOS runs one VPN at a time. ${later}`, action: viaTs ? "openTailscale" : "openVPN", tone: "warn", red: true, local: false };
  if (viaTs) {
    return ts.signedIn ? { state: "tailscaleOff", title: "Tailscale Is Off", subtitle: `Turn on the Tailscale app's VPN. ${later}`, action: "openTailscale", tone: "warn", local: false } : signIn;
  }
  return { state: "vpnOff", title: `${VPNS[0]} Is Off`, subtitle: `Turn it on to install here. ${later}`, action: "openVPN", tone: "warn", local: false };
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

// After Open LocalDevVPN the install waits (signing-client.js waitForVPN): idevice.status is asked every VPN_POLL ms
// and when the app comes back to the foreground, and the install goes on once this is true. Only Cancel stops it.
export const VPN_POLL = 2000;
export const vpnWaitText = (vpn = VPN) => `Waiting for ${vpn}…`;
export const VPN_WAIT = vpnWaitText();
export const VPN_CONNECTED = `${VPN} is on`;
export const vpnReady = (status) => Boolean(status?.paired && vpnOn(status));

// ---- Tailscale (Settings > Installation > This iPhone)

export const CONNECT_OPTIONS = [
  { value: "auto", label: "Automatic" },
  { value: "localdevvpn", label: "LocalDevVPN" },
  { value: "tailscale", label: "Tailscale" },
];

export function connectFooter(connect) {
  if (connect === "tailscale") return `Installs go through Tailscale. Keep the Tailscale app's VPN on; ${NAME} joins your tailnet only while it installs.`;
  if (connect === "localdevvpn") return "Installs go through LocalDevVPN, which works without the internet.";
  return `Tailscale when its VPN is on and ${NAME} is signed in, otherwise LocalDevVPN.`;
}

// Days until the node key expires (keyExpiry: RFC 3339), null when it doesn't expire.
export function keyDaysLeft(keyExpiry, now = Date.now()) {
  const t = Date.parse(keyExpiry || "");
  return Number.isFinite(t) ? Math.floor((t - now) / 86400000) : null;
}

// The Tailscale group's footer from tailscale.status. Signed out, it names the device the app will join as
// (status.hostname, e.g. "iFizBox on iPhone 15 Pro"); an older shell without it gets no name.
export function tailscaleFooter(ts, now = Date.now()) {
  if (!ts?.signedIn) {
    const host = typeof ts?.hostname === "string" && ts.hostname.trim() ? ` ("${ts.hostname.trim()}")` : "";
    return `${NAME} joins your tailnet as its own device${host} and reaches this iPhone through it, so Tailscale can stay on.`;
  }
  const days = keyDaysLeft(ts.keyExpiry, now);
  if (days != null && days < 0) return "This device's key expired. Sign out and sign in again.";
  if (days != null && days <= 14) return `This device's key expires in ${days} day${days === 1 ? "" : "s"}. Sign in again, or turn off key expiry for it in the admin console.`;
  if (!ts.address) return "The Tailscale app's VPN is off.";
  return `This iPhone is ${ts.address} on your tailnet.`;
}

// A copyable tailnet policy rule letting the node reach this phone's node on every port (RemotePairing's tunnel
// uses a second, changing port).
export const aclRule = (from, to) => JSON.stringify({ action: "accept", src: [from || "<this device>"], dst: [`${to || "<this iPhone>"}:*`] });

// tailscale.test's answer ({ok, code, detail, peer, name, address, ms}) as an alert: { title, message, copy? }.
export function tailscaleTestResult(r) {
  if (r?.ok) return { title: "Connected", message: `${NAME} reached this iPhone through Tailscale${r.ms ? ` in ${r.ms} ms` : ""}. Apps install over Tailscale now.` };
  const d = r?.detail ? ` (${r.detail})` : "";
  switch (r?.code) {
    case "no_interface": return { title: "Tailscale Is Off", message: "Turn on the Tailscale app's VPN, then test again." };
    case "needs_approval": return { title: "Approve This Device", message: `Your tailnet needs new devices approved. Approve "${r.name || NAME}" in the Tailscale admin console (Machines), then test again.` };
    // B316: the shell marks the node signed out, so the page shows Sign In; the alert says it as installs do
    case "expired": case "needs_login": return { title: TAILSCALE_SIGNED_OUT.title, message: `${NAME} is signed out of Tailscale (its device key expired or was removed). Sign in again; to avoid it, turn off key expiry for this device in the admin console.` };
    case "route_refused": { const f = routeRefused(VPNS[1]); return { title: f.title, message: f.message }; }
    case "acl": {
      const rule = aclRule(r.name, r.address);
      return { title: "Blocked by Your Tailnet", message: `Your tailnet's access rules don't let ${r.name || NAME} reach this iPhone${r.peer ? ` (${r.peer})` : ""}${d}. Add this rule to the policy file in the admin console: ${rule}`, copy: rule };
    }
    case "refused": return { title: "iPhone Refused", message: `This iPhone refused the connection${d}. It no longer has ${NAME}'s pairing: pair again in Pairing.` }; // B220
    // B246: Tailscale reached iOS, which turned the connection down because it has no pairing for any app
    case "not_paired": return r.paired
      ? { title: "Pair Again", message: `Tailscale reached this iPhone, but it no longer has ${NAME}'s pairing. Pair again, then apps install over Tailscale.`, pair: true }
      : { title: "Not Paired Yet", message: `Tailscale reached this iPhone. Pair ${NAME} with it once, then apps install over Tailscale.`, pair: true };
    // B274: Tailscale reached iOS, then connecting with the kept pairing (idevice.verify through Tailscale) failed.
    // A pairing the phone no longer accepts (refused, turned down, the channel reset during pair-verify) is Pair Again
    // (`again`: forget it and pair); anything else says the connection didn't go through.
    case "verify_failed": {
      // (only those: verifyFailure's catch-all Pairing Didn't Work also offers it for a timeout, which isn't proof)
      const raw = String(r.detail || "");
      const pair = verifyFailure({ message: raw }).unusable || /^bad_pairing:/.test(raw) || (/^connect_failed:/.test(raw) && earlyEOF(raw));
      if (pair) return { title: "Pair Again", message: `Tailscale reached this iPhone, but it no longer accepts ${NAME}'s pairing. Pair again, then apps install over Tailscale.`, again: true };
      return { title: "Couldn't Connect", message: `Tailscale reached this iPhone, but connecting with ${NAME}'s pairing didn't work${d}. Try again.` };
    }
    case "no_answer": return { title: "No Answer", message: `This iPhone didn't answer through Tailscale${d}. Try again.` };
    default: return { title: "Couldn't Connect", message: `Tailscale didn't connect${d}. Check the internet connection and try again.` };
  }
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
//   "connect"  iOS 27, the VPN is off: the way to connect (vpnRoute), rechecked when the app comes back
//   "pairing"  iOS 27, the VPN is on: pairing runs by itself, the code big at the top, then PAIR_GUIDE
export function setupState(status, pairing = null) {
  if (pairing) return "pairing";
  if (status === undefined) return "checking";
  const s = pairState(status);
  if (s !== "phone") return s;
  return vpnOn(status) ? "pairing" : "connect";
}

// A way to reach this iPhone: LocalDevVPN (10.7.0.1 reachable, idevice.status localDevVPN) or Tailscale (the shell's
// tailscale.use: its VPN on and signed in, or Connect With: Tailscale).
export function vpnOn(status) { return Boolean(status?.localDevVPN || status?.tailscale?.use); }

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

// F300: Tailscale is the way in (Connect With: Tailscale, or Automatic with iFizBox signed in and the Tailscale app's
// VPN on, the shell's tailscale.use): This iPhone's group then has no LocalDevVPN row, Open LocalDevVPN or its footer.
// `connect` is Connect With as shown (a pick may be ahead of `st`).
export function tailscaleRoute(st, connect = st?.tailscale?.connect ?? "auto") {
  if (connect === "tailscale") return true;
  if (connect !== "auto") return false;
  const ts = st?.tailscale;
  return Boolean(ts?.use || (ts?.signedIn && tailscaleVPNOn(st)));
}

// ---- Which VPN app to pair and install through, decided before sending anyone to an app

// LocalDevVPN's App Store page (App Store ID 6755608044, com.jkcoxson.LocalDevVPN), offered when no VPN app is
// installed, and the Tailscale app's URL scheme (Tailscale's own deep links, tailscale/tailscale tka/deeplink.go).
// TAILSCALE_URL only tells whether Tailscale is installed (idevice.vpnApps' canOpenURL); never open it: Tailscale
// 1.104.7 takes every tailscale: link as a Tailnet Lock signing request and shows "Could not sign device ... Unable
// to verify deeplink" (B323, iPhone 15 Pro; bare, //open, //app, //login and /// all do). It registers no other
// scheme and no universal links, so Open Tailscale launches it by its bundle ID instead (openTailscale).
export const LOCALDEVVPN_STORE = "https://apps.apple.com/app/localdevvpn/id6755608044";
export const TAILSCALE_URL = "tailscale://";
export const TAILSCALE_ID = "io.tailscale.ipn.ios";

// B323: Open Tailscale. `call` is the bridge's call(method, params); true once iOS opened the app (signing.openApp,
// the sideload shell's LSApplicationWorkspace openApplicationWithBundleID:), false when it couldn't or the call
// failed: the caller then says to open Tailscale from the Home Screen.
export const OPEN_TAILSCALE_BY_HAND = "Open Tailscale from the Home Screen and turn it on. No Tailscale app? Get it from the App Store.";
export async function openTailscale(call) {
  try { return (await call("signing.openApp", { bundleId: TAILSCALE_ID }))?.opened === true; } catch { return false; }
}

// The way to connect from idevice.vpnApps ({localdevvpn, tailscale}: installed or not) and Connect With:
//   "localdevvpn"  only LocalDevVPN (or both, with Connect With: LocalDevVPN), or an older shell with no answer
//   "tailscale"    only Tailscale (or both, with Connect With: Tailscale): its Sign In and Open Tailscale
//   "ask"          both, nothing chosen yet: the page asks, and the answer is kept as Connect With
//   "none"         neither: LocalDevVPN is needed (Install LocalDevVPN), Tailscale named as the other way
// (F284, user 2026-11-20: the VPN follows what the user set up; Tailscale being installed doesn't switch to it.)
export function vpnRoute(apps, connect = "auto") {
  if (!apps || typeof apps !== "object") return "localdevvpn";
  const ldv = Boolean(apps.localdevvpn), ts = Boolean(apps.tailscale);
  if (ldv && ts) return connect === "localdevvpn" || connect === "tailscale" ? connect : "ask";
  if (ts) return "tailscale";
  return ldv ? "localdevvpn" : "none";
}

// The Turn On alert shown once a visit for the LocalDevVPN way (null for the others: their page says what to do).
export function connectAlert(route) {
  if (route !== "localdevvpn") return null;
  return {
    title: `Turn On ${VPN}`,
    message: `${NAME} pairs with this iPhone and installs through ${VPN}. Turn it on, then come back here.`,
    buttons: ["Cancel", `Open ${VPN}`], open: 1,
  };
}

export const CONNECT_ALERT = {
  title: `Turn On ${vpnList()}`,
  message: `${NAME} pairs with this iPhone and installs through ${vpnList()}. Turn it on, then come back here.`,
  buttons: ["Cancel", `Open ${VPN}`], open: 1,
};

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

// B258: the VPN a check went through, from idevice.status (`st`) and the error's words: "Tailscale" when the shell's
// route is Tailscale (tailscale.use), LocalDevVPN when it is on; with neither on, the one the user set up
// (setUpWithTailscale); with no status, Tailscale when the shell's error names it (Tailscale.swift, IDevice.swift).
// (Both on: the shell connects through Tailscale whenever tailscale.use is set; see decideRoute.)
export function verifyVPN(st, raw = "") {
  if (st) {
    if (st.tailscale?.use) return VPNS[1];
    if (st.localDevVPN) return VPNS[0];
    return setUpWithTailscale(st.tailscale) ? VPNS[1] : VPNS[0];
  }
  return /^connect_failed: Tailscale/i.test(raw) ? VPNS[1] : VPNS[0];
}

// B258: the phone took the connection, then reset the RemotePairing tunnel before it was up (idevice's
// Socket(UnexpectedEof "early eof") from tunnel_create_rppairing): a pairing it no longer accepts while Pairing still
// says Paired (R54, iPhone 15 Pro, over Tailscale). Unlike a refusal it isn't certain (a tunnel reset for another
// reason reads the same), so it offers Pair Again without forgetting the pairing by itself (no `unusable`).
export const earlyEOF = (raw) => /UnexpectedEof|early eof/i.test(raw);

// ---- B316: a broken route, said for what it is and kept until a check passes
// The user's phone: an install failed "refused … it no longer has this pairing. Pair again" while the real cause was
// Tailscale (iFizBox's node logged out; then the phone refusing every connection from the tailnet). Tailscale is
// checked first, and the pairing is blamed only when Tailscale is fine.

// The codes a connect to this iPhone fails with (IDevice.swift): the ones that may be Tailscale's doing.
const CONNECT_CODES = new Set(["refused", "pairing_rejected", "pair_again", "connect_failed", "bad_pairing"]);

// What's wrong with Tailscale for a connect that failed, from idevice.status (`st`), or null when Tailscale isn't the
// way in or is fine: "signedOut" (Tailscale is the way in, Connect With: Tailscale or its VPN on with Automatic, and
// iFizBox isn't signed in to it) or "off" (Connect With: Tailscale and its VPN is off).
export function tailscaleProblem(st) {
  const ts = st?.tailscale;
  if (!ts || ts.connect === "localdevvpn") return null;
  if (ts.connect !== "tailscale" && !tailscaleVPNOn(st)) return null;
  // Automatic with LocalDevVPN really on (VPNCheck counts a refusal only through a tunnel): the connect went to
  // 10.7.0.1, so a refusal there is the pairing's, not Tailscale's
  if (ts.connect !== "tailscale" && st.localDevVPN && !ts.use) return null;
  if (!ts.signedIn) return "signedOut";
  if (!tailscaleVPNOn(st)) return "off";
  return null;
}

// The alerts' words ({title, message}), the install log's and the status cell's (`short`: two lines at 320pt), and
// `fix`: what the fix row or button does ("signIn": Install Apps With, where Tailscale's Sign In is; "openTailscale";
// "openVPN": LocalDevVPN; "pair": Pairing; "check": Check Connection again).
export const TAILSCALE_SIGNED_OUT = {
  title: "Tailscale Is Signed Out", again: false, fix: "signIn", button: "Sign In",
  message: `${NAME} is signed out of Tailscale, so it can't reach this iPhone. Sign in again in Settings > Installation & Signing > Install Apps With.`,
  short: "Installs can't reach this iPhone. Sign in again.",
};
export const TAILSCALE_VPN_OFF = {
  title: "Tailscale Is Off", again: false, fix: "openTailscale", button: "Open Tailscale",
  message: `Installs go through Tailscale, and the Tailscale app's VPN is off. Turn it on, then try again.`,
  short: "Turn on the Tailscale app's VPN.",
};
// The phone refused every connection through the route, lockdown's port too (the shell's route_refused): not the
// pairing. Over Tailscale it is the phone on cellular: iOS takes RemotePairing (49152) and lockdownd (62078) from
// the network only on Wi-Fi, and on cellular refuses every port; over LocalDevVPN a stale tunnel.
export function routeRefused(vpn = VPNS[0]) {
  if (vpn === VPNS[1]) {
    return { title: "Tailscale Refused", again: false, fix: "openTailscale", button: "Open Tailscale",
      message: `This iPhone takes installs through Tailscale only on Wi-Fi: on cellular, iOS refuses every connection, so it isn't the pairing. Join Wi-Fi, or use the Signing Server.`,
      short: "Tailscale installs need Wi-Fi. Join Wi-Fi, or use the Signing Server." };
  }
  return { title: `${VPNS[0]} Refused`, again: false, fix: "openVPN", button: `Open ${VPNS[0]}`,
    message: `This iPhone refused every connection through ${VPNS[0]}, so it isn't the pairing. Turn ${VPNS[0]} off and on, then try again.`,
    short: `Every connection was refused. Turn ${VPNS[0]} off and on.` };
}

// A failed connect (idevice.verify, an install on this iPhone, tailscale.test's verify) as a remembered failure
// { title, message, short, fix, button }, or null when the error isn't about reaching this iPhone (Developer Mode,
// signing, a download): those don't make the route broken.
const ROUTE_CODES = new Set([...CONNECT_CODES, "route_refused", "tailscale_signed_out", "needs_login", "expired", "not_paired"]);
export function routeFailureOf(err, st = null) {
  const raw = String(err?.message ?? err ?? "");
  const code = err?.code ?? raw.split(":")[0];
  if (!ROUTE_CODES.has(code)) return null;
  if (developerModeFailure(err)) return null;
  const why = verifyFailure(err, st);
  const fix = why.fix ?? (why.again ? "pair" : /^Turn On/.test(why.title) ? (why.title.includes(VPNS[1]) ? "openTailscale" : "openVPN") : "check");
  const short = why.short ?? (why.again ? "Installs are refused. Pair again." : "Installs can't reach this iPhone.");
  const button = why.button ?? (fix === "pair" ? "Pair Again" : fix === "openVPN" ? `Open ${VPNS[0]}` : fix === "openTailscale" ? "Open Tailscale" : "Check Again");
  return { title: why.title, message: why.message, short, fix, button };
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
const FIX_ACTIONS = { signIn: "signIn", openTailscale: "openTailscale", openVPN: "openVPN", pair: "pair", check: "check" };
export function failureStatus(f) {
  return { state: "failed", title: f.title, subtitle: f.short, action: FIX_ACTIONS[f.fix] ?? "check", tone: "warn", red: true, local: false };
}

// What a failed idevice.verify means: { title, message, again } (`again`: offer Pair Again). `st` is the
// idevice.status read for the check (null or left out: not known), which names the VPN the check went through.
export function verifyFailure(err, st = null) {
  const raw = String(err?.message ?? err ?? "");
  const code = err?.code ?? raw.split(":")[0];
  // B316: Tailscale's own state before the pairing. The shell found iFizBox's node logged out, or a connect failed
  // while Tailscale is the way in and iFizBox isn't signed in to it (or its VPN is off): the fix is Tailscale's.
  if (code === "tailscale_signed_out" || code === "needs_login" || code === "expired") return TAILSCALE_SIGNED_OUT;
  if (code === "route_refused") return routeRefused(/Tailscale/i.test(raw) ? VPNS[1] : VPNS[0]);
  if (CONNECT_CODES.has(code)) {
    const t = tailscaleProblem(st);
    if (t === "signedOut") return TAILSCALE_SIGNED_OUT;
    if (t === "off" && code !== "connect_failed") return TAILSCALE_VPN_OFF; // a plain connect failure says Turn On Tailscale below
  }
  // B220: refused on every port RemotePairing is advertised on, or turned down: the phone no longer has the pairing
  if (code === "refused" || code === "pairing_rejected" || (code === "connect_failed" && /connection refused/i.test(raw))) {
    return { title: "Pair Again", message: `This iPhone no longer accepts ${NAME}'s pairing, so every connection is refused. Pair again.`, again: true, unusable: true };
  }
  if (code === "connect_failed" && earlyEOF(raw)) {
    // (an EOF is read on a socket that was open: the TCP connect to RemotePairing had worked, so the route did too)
    const through = st || /Tailscale/i.test(raw) ? ` through ${verifyVPN(st, raw)}` : "";
    return { title: "Pair Again", message: `This iPhone answered${through}, then closed the connection: it no longer accepts ${NAME}'s pairing. Pair again.`, again: true };
  }
  if (code === "connect_failed") {
    const vpn = verifyVPN(st, raw);
    // Tailscale's route was on and still didn't connect: turning it on isn't the answer (LocalDevVPN keeps its Turn
    // On: idevice.status sees it on when 10.7.0.1 answers, and turning it off and on is what fixes a stale tunnel)
    if (vpn === VPNS[1] && st?.tailscale?.use) {
      return { title: "Couldn't Connect", message: `Tailscale is on, but ${NAME} couldn't reach this iPhone through it. Try again; if it keeps failing, turn the Tailscale app's VPN off and on.`, again: false };
    }
    return { title: `Turn On ${vpn}`, message: `${NAME} couldn't reach this iPhone. Turn ${vpn} on and try again.`, again: false };
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
    signingIn: "Leaving stops signing in to Tailscale. Tap Sign In again when you come back to This iPhone.", // B143
  };
  const message = messages[step];
  if (!message) return null;
  return { title: "Stop Setting Up?", message, buttons: ["Cancel", "Leave"], cancel: 0 };
}

// B218: Install Apps With kept in the shell's Keychain beside the Tailscale node (Tailscale.swift tailscale.keepRoute /
// tailscale.keptRoute), so a reinstall or a re-sign (a fresh container: localStorage gone), and an account sign-in
// after one, comes back on the route it had. At launch, with nothing stored here, the kept route is taken; otherwise
// what is stored is kept (a build from before this kept nothing); then every change is kept. Sideload app only (the
// setting shows nowhere else). Returns true when it started.
//   keepRoute({ settings, native: nativeBridge(), storage: globalThis.localStorage })   (native.js; none: no start)
export function keepRoute({ settings, native = null, storage = globalThis.localStorage } = {}) {
  if (!settings || typeof native?.call !== "function" || !settings.isShown?.(ROUTE_KEY)) return false;
  const call = (name, params) => Promise.resolve().then(() => native.call(name, params));
  const stored = () => { try { return storage?.getItem(STORAGE_KEY) ?? null; } catch { return null; } };
  const keep = (value) => call("tailscale.keepRoute", { value }).catch(() => {});
  settings.onChange((key, value) => { if (key === ROUTE_KEY) keep(value); });
  if (stored() !== null) { keep(settings.get(ROUTE_KEY)); return true; }
  call("tailscale.keptRoute").then((v) => {
    // a pick made while the shell answered stands
    if ((v === "iphone" || v === "server") && stored() === null) settings.set(ROUTE_KEY, v);
  }).catch(() => {});
  return true;
}

// ---- F366: the Signing Server for one run, when This iPhone fails ----------------------------------------------
// An install through This iPhone that couldn't reach the phone (refused, the pairing lost, Tailscale or LocalDevVPN
// down, not paired: routeFailureOf) offers the Signing Server at once, besides the fix: the same apps again through the
// default Signing Server for that install or run only. Install Apps With stays This iPhone.
//   serverFallback(err, route)   the failure's { title, message, short, fix, button } when it offers the Signing
//                                Server (`route`: the install's params, { route: "idevice" } on This iPhone), else null
export const USE_SERVER = "Use the Signing Server";
export const USE_SERVER_LINE = `${DOMAIN} can install it instead, this time only.`;
export const serverStep = (name) => `Installing ${name || "the app"} through the Signing Server`;
export function serverFallback(err, route = { route: "idevice" }) {
  if (route?.route !== "idevice" || err?.code === "cancelled") return null;
  return routeFailureOf(err);
}
