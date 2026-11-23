// The native controls hook (F345a, docs/eras.md "Native controls"): <html data-controls="native"> under the iOS 26
// style, only where the web view draws iOS 26's own form controls. Under it the page leaves a control to WebKit
// (ios26.css: the search field's capsule and magnifier, the switch, <select>, <progress>, the cell fields) instead of
// drawing its look-alike; without it (the iPhone 7's iOS 15 WebKit, desktop browsers, every other style) the same
// markup gets the look-alikes.
//
//   controlsFor({ style, nativeIos, userAgent, supports }) -> "native" | null
//   applyControls(doc, opts)    puts the answer on <html data-controls> (or takes it off); true when it changed
//   initNativeControls()        follows Theme > Style live and, in the app, the shell's app.info `ios`
//   nativeControls(doc)         whether the hook is on now (nav/switch.js asks when it draws a switch)
//
// theme-boot.js runs the same rule before first paint (it can't import this); native-controls.test.js keeps the two
// in step.
import { redrawSwitches } from "./nav/switch.js";
import { nativeBridge, hasNativeCall } from "./native.js";

// iOS 26's controls came with WebKit 26. In a web view the user agent's OS version is frozen (the 15 Pro on iOS 27
// says "iPhone OS 18_7") and there is no Version/, so:
// - in the app the shell's app.info `ios` decides (once it has answered);
// - before it answers, on an iPhone or iPad, by a feature WebKit first shipped in 26: CSS anchor positioning (true on
//   the 15 Pro's web view, absent from iOS 15's WebKit on the iPhone 7 and from iOS 18's).
// (C69: the website has no eras, so no Safari path.)
export const FEATURE_26 = "anchor-name: --a";

const IOS_DEVICE = /\b(iPhone|iPad|iPod)\b/;
const major = (v) => parseInt(String(v ?? ""), 10);

export function drawsIos26Controls({ nativeIos = null, userAgent = "", supports = () => false } = {}) {
  if (nativeIos) return major(nativeIos) >= 26;
  if (!IOS_DEVICE.test(userAgent)) return false;
  try { return Boolean(supports(FEATURE_26)); } catch { return false; }
}

export function controlsFor({ style, ...env } = {}) {
  return style === "ios26" && drawsIos26Controls(env) ? "native" : null;
}

let nativeIos = null; // the shell's app.info `ios`, once it answered

const envOf = () => ({
  nativeIos,
  userAgent: globalThis.navigator?.userAgent ?? "",
  supports: (q) => Boolean(globalThis.CSS?.supports?.(q)),
});

export function applyControls(doc = globalThis.document, env = envOf()) {
  const root = doc?.documentElement;
  if (!root) return false;
  const want = controlsFor({ style: root.getAttribute("data-style"), ...env });
  const had = root.getAttribute("data-controls");
  if (want === had) return false;
  if (want) root.setAttribute("data-controls", want);
  else root.removeAttribute("data-controls");
  return true;
}

export const nativeControls = (doc = globalThis.document) => doc?.documentElement?.getAttribute?.("data-controls") === "native";

// A change after first paint (Theme > Style, its preview, the app's own answer) redraws the switches already on
// screen in the other kind, so a page drawn before it never mixes the two.
function update(doc) {
  if (applyControls(doc)) redrawSwitches(doc);
}

let wired = false;
export function initNativeControls(doc = globalThis.document) {
  if (wired || !doc?.documentElement) return;
  wired = true;
  update(doc);
  if (typeof globalThis.MutationObserver === "function") {
    new MutationObserver(() => update(doc)).observe(doc.documentElement, { attributes: true, attributeFilter: ["data-style"] });
  }
  const n = nativeBridge();
  if (hasNativeCall(n)) {
    n.call("app.info", {}).then((info) => {
      const ios = info?.ios; // Bridge.swift sends UIDevice's systemVersion string; a number counts too
      if ((typeof ios === "string" && ios) || typeof ios === "number") { nativeIos = String(ios); update(doc); }
    }).catch(() => {});
  }
}
