// This iPhone, for "Works on my phone" (F17; the rules are core/compat.js). The iOS version comes from the bridge in
// the app (Bridge.swift app.info `ios`) and on the site from the user agent, unless Settings > iOS Version picks one;
// the jailbreak type is Settings > Device's (F37: core/settings.js deviceType(), "none" when not jailbroken). Both stay on the device (core/settings.js). The worker's catalog
// hears every change (catalog.setDevice), so lists, Search and Changes follow the Works on My Phone switch, and the
// Source Filters (F382, catalog.setFilters).
//
//   currentDevice()          -> { ios: "16.5" | null, jailbreak: "rootless" | "rootful" | "roothide" | "none" (sideload build) }
//   compatFilterOn()         -> whether rows that can't work are hidden (on by default)
//   filterRow(onChange)      -> the "Works on My Phone" switch row for the Sections page and Search
//   compatBadge(code)        -> a row badge's text, or "" when the row was not judged
//   applyNativeJailbreak(info, s) -> the app.info jailbreak type (F38) written to `arch`, in the jailbreak app only
import { plain } from "./nav/ui.js";
import { getArch } from "./backend.js";
import { catalog } from "./catalog.js";
import { settings } from "./settings-store.js";
import { createSwitch } from "./nav/switch.js";
import { bridgeArch } from "./core/settings.js";
import { iosFromUserAgent, jailbreakOfArch, badge, normalizeDevice } from "./core/compat.js";

// The settings that change who the rows are judged for (F37 adds Device, which also sets "arch").
const DEVICE_KEYS = ["worksOnMyPhone", "iosVersion", "arch", "device"];

let nativeIos = null; // the app's own answer, once app.info came back

// The sideload build runs on phones without a jailbreak: debs never fit there, apps do (core/compat.js).
// `type` (F37): the device type, "none" or an architecture; without one, `arch` decides (always jailbroken).
export function deviceFrom({ setting = "auto", nativeIos: fromBridge = null, userAgent = "", arch, type, mode = "site" } = {}) {
  const ios = setting && setting !== "auto" ? setting : fromBridge || iosFromUserAgent(userAgent);
  const none = mode === "sideload" || type === "none";
  return normalizeDevice({ ios, jailbreak: none ? "none" : jailbreakOfArch(type ?? arch) });
}

export function currentDevice() {
  return deviceFrom({
    setting: settings.isShown("iosVersion") ? settings.get("iosVersion") : "auto",
    nativeIos,
    userAgent: globalThis.navigator?.userAgent ?? "",
    arch: getArch(),
    type: settings.deviceType(),
    mode: settings.mode,
  });
}

export const compatFilterOn = () => settings.get("worksOnMyPhone") === true;

export const compatBadge = (code) => (code ? badge(code, currentDevice()) : "");

// "iOS 16.5 · Rootless", or "iOS unknown · Rootless".
export function deviceLabel(d = currentDevice()) {
  const jb = d.jailbreak === "none" ? "Not Jailbroken" : d.jailbreak.charAt(0).toUpperCase() + d.jailbreak.slice(1);
  return `${d.ios ? `iOS ${d.ios}` : "iOS unknown"} · ${jb}`;
}

const send = () => catalog.setDevice(currentDevice(), { filter: compatFilterOn() });
// F382: Source Filters reach the worker's catalog the same way (core/sourcefilters.js, Sources > Manage > Filters).
const sendFilters = () => catalog.setFilters(settings.sourceFilters.all(), { lite: settings.mode === "sideload" });
// F382: in the app, the first send waits for app.info (the iOS 26+ web view's user agent says 18.6), at most this long.
const APP_INFO_WAIT_MS = 2500;

// The switch row: a one-row plain table with the device under the label, above the Sections list and Search's
// results. `onChange()` runs after the setting changed and the catalog heard it, for the page to redraw its list.
// The version and jailbreak type are changed in Settings (Works on My Phone, Device).
export function filterRow(onChange = () => {}) {
  const ul = document.createElement("ul");
  ul.className = "table plain compat-filter";
  ul.append(plain([{ rows: [{ label: "Works on My Phone", subtitle: deviceLabel() }] }]).firstChild);
  const cell = ul.querySelector(".cell-inner");
  cell.classList.add("has-switch");
  const makeSwitch = () => createSwitch({
    label: "Works on My Phone", checked: compatFilterOn(),
    onToggle: (on) => { if (compatFilterOn() !== on) settings.set("worksOnMyPhone", on); },
  });
  let sw = makeSwitch();
  cell.append(sw);
  // Any change (this switch, Settings, the Architecture) redraws the page; a row left behind unsubscribes.
  const off = settings.onChange((key) => {
    if (!DEVICE_KEYS.includes(key)) return;
    if (!ul.isConnected) { off(); return; }
    ul.querySelector(".cell-subtitle").textContent = deviceLabel();
    if ((sw.getAttribute("aria-checked") === "true") !== compatFilterOn()) { const next = makeSwitch(); sw.replaceWith(next); sw = next; }
    onChange();
  });
  return ul;
}

// F38: Bridge.swift app.info says which jailbreak the app runs on ("roothide" | "rootless" | "rootful" | "none").
// In the jailbreak build its architecture becomes `arch`, which deviceType() and getArch() read, so packages are
// listed and judged for this phone. The site keeps the visitor's Device choice and the sideload build stays Not
// Jailbroken. Returns whether `arch` changed.
export function applyNativeJailbreak(info, s = settings) {
  if (s.mode !== "jailbreak") return false;
  const arch = bridgeArch({ jailbreak: info?.jailbreak });
  if (!arch || s.get("arch") === arch) return false;
  s.set("arch", arch);
  return true;
}

let wired = false;
export function initDevice() {
  if (wired) return;
  wired = true;
  sendFilters();
  settings.onChange((key) => { if (key === "sourceFilters") sendFilters(); });
  const n = globalThis.ifizboxNative;
  // F382: the catalog answers nothing until the device is sent (catalog.js deviceReady), so lists show their loading
  // state rather than rows judged for the user agent's iOS.
  let sent = false;
  const first = () => { if (!sent) { sent = true; send(); } };
  settings.onChange((key) => { if (DEVICE_KEYS.includes(key) && sent) send(); });
  if (n?.call) {
    setTimeout(first, APP_INFO_WAIT_MS);
    n.call("app.info", {}).then((info) => {
      applyNativeJailbreak(info); // a changed arch tells the catalog through settings.onChange
      if (typeof info?.ios === "string" && info.ios) { nativeIos = info.ios; if (sent) send(); }
    }).catch(() => {}).finally(first);
  } else first();
}
