// The iOS 26 style's native controls (F345a, C70, docs/eras.md "Native controls"): the iOS 26 style is offered only on
// a phone running iOS 26 or later (core/settings.js ios26Here), so wherever <html data-style="ios26"> is on, the web
// view draws iOS 26's own form controls and the shell draws its bars, menus, alerts and glass. The page leaves a control
// to WebKit (ios26.css: the search field's capsule and magnifier, the switch, <select>, <progress>, the cell fields)
// and has no look-alike to fall back on.
//
//   nativeControls(doc)         whether the iOS 26 style is on now (nav/switch.js asks when it draws a switch)
//   initNativeControls()        in the app, hands the shell's app.info `ios` to the settings (which then show or drop
//                               the style, screens/settings.js applyTheme) and redraws the switches when the style flips
//
// theme-boot.js decides the style before first paint with the same feature test (CSS anchor positioning, WebKit 26's)
// until app.info answers.
import { redrawSwitches } from "./nav/switch.js";
import { nativeBridge, hasNativeCall } from "./native.js";
import { setPhoneIos } from "./core/settings.js";

export const nativeControls = (doc = globalThis.document) => doc?.documentElement?.getAttribute?.("data-style") === "ios26";

let wired = false;
export function initNativeControls(doc = globalThis.document) {
  if (wired || !doc?.documentElement) return;
  wired = true;
  // A change after first paint (Theme > Style, its preview, the app's own answer) redraws the switches already on
  // screen in the other kind, so a page drawn before it never mixes the two.
  if (typeof globalThis.MutationObserver === "function") {
    new MutationObserver(() => redrawSwitches(doc)).observe(doc.documentElement, { attributes: true, attributeFilter: ["data-style"] });
  }
  const n = nativeBridge();
  if (hasNativeCall(n)) {
    n.call("app.info", {}).then((info) => {
      const ios = info?.ios; // Bridge.swift sends UIDevice's systemVersion string; a number counts too
      if ((typeof ios === "string" && ios) || typeof ios === "number") setPhoneIos(ios);
    }).catch(() => {});
  }
}
