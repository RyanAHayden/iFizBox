// F323: the app icon, in the native builds: the shell's Home Screen icon follows the theme (Settings > Theme >
// App Icon), and the page shows the icon the app has now (Home's header, Theme > Light / Dark's preview).
//
//   tellIcon("dark")          after the theme changes: app.icon {light, dark, onScreen} to the shell (once per change)
//   iconImage(img, "current") keeps an <img> on an icon: "current" (the tone on screen), "light" or "dark"
//   refreshIcons()            repaints every such <img> (screens/settings.js applyTheme calls it)
//
// The icons themselves are the shell's: ifizbox://app/appicon/<icon>.png (native/build.sh AppIconThumbs, Bridge.swift
// AppScheme), the Lite build's with its sash. On the website none of this runs: it keeps its WEB icon.
import { settings } from "./settings-store.js";
import { iconFor, iconState } from "./core/settings.js";
import { nativeBridge, hasNativeCall } from "./native.js";
import { iosFromUserAgent } from "./core/compat.js";
import { clearOffered, isOwnIcon } from "./core/settings.js";

// Whether Theme > App Icon's grid offers Clear on this phone (iOS 18+; the web view's user agent carries iOS's version).
export const clearHere = (ua = globalThis.navigator?.userAgent) => clearOffered(iosFromUserAgent(ua));

export const nativeIcons = (s = settings) => Boolean(nativeBridge()) && s.isShown("iconMatch");
// F371: `tone` "dark" shows the Glass (iOS 26) icon's dark look, appicon/glass-dark.png (native/icon/glass.py thumb).
export const iconSrc = (name, tone) => `appicon/${name === "glass" && tone === "dark" ? "glass-dark" : name}.png`;
const toneOf = (slot, onScreen = toneOnScreen()) => (slot === "light" || slot === "dark" ? slot : onScreen);

const toneOnScreen = () => (globalThis.document?.documentElement?.dataset.theme === "dark" ? "dark" : "light");
// A Clear pick doesn't count where Clear isn't offered (below iOS 18): that mode shows its theme's icon.
export const readIcons = (read, clear = clearHere()) => (k) => {
  const v = read(k);
  return !clear && (k === "lightIcon" || k === "darkIcon") && v === "clear" ? "theme" : v;
};
const get = (k) => readIcons((key) => settings.get(key))(k);

// The icon a slot shows: "current" the tone on screen's, "light" / "dark" that tone's.
export function iconOf(slot, read = get, onScreen = toneOnScreen()) {
  return iconFor(slot === "light" || slot === "dark" ? slot : onScreen, read);
}

export function iconImage(img, slot = "current") {
  img.dataset.appicon = slot;
  img.src = iconSrc(iconOf(slot), toneOf(slot));
  img.removeAttribute("srcset");
  return img;
}

export function refreshIcons(doc = globalThis.document) {
  for (const img of doc?.querySelectorAll?.("img[data-appicon]") ?? []) {
    if (!img.dataset?.appicon) continue;
    const src = iconSrc(iconOf(img.dataset.appicon), toneOf(img.dataset.appicon));
    if (img.getAttribute("src") !== src) img.src = src;
  }
}

// The message app.icon takes, for the tests and tellIcon.
export const iconMessage = (read, onScreen) => ({ method: "app.icon", params: iconState(read, onScreen) });

// B243: a switch the shell answers "failed: …" (iOS refused it) is sent again, after each of these waits in turn; a
// newer change cancels the retry (it sends its own). Other refusals (an older shell, bad_params, resign_needed) aren't.
export const RETRY_MS = [1000, 3000, 10000];
// native/bridge.js turns "failed: <text>" into an Error with code "failed" and message <text>.
export const retryable = (e) => e?.code === "failed" || /^failed\b/.test(String(e?.message ?? e ?? ""));

// B240: Lite answers "resign_needed: …" for a picked own icon that isn't in its bundle: an update from the AltStore
// source (or any fresh IPA) put the own sets' placeholders back, or the self re-sign's install never finished. The
// page then offers the re-sign again or the theme's icon (screens/appicon.js offerResign).
export const resignNeeded = (e) => e?.code === "resign_needed" || /^resign_needed\b/.test(String(e?.message ?? e ?? ""));
let onResign = (name, s) => { import("./screens/appicon.js").then((m) => m.offerResign(name, s)).catch(() => {}); };
export const setResignHandler = (f) => { onResign = f; };

let lastSent = "";
let sends = 0; // a reply counts only while no newer app.icon went out
let retry = null;
export function tellIcon(onScreen, s = settings, native = nativeBridge(), attempt = 0) {
  if (!nativeIcons(s) || !hasNativeCall(native)) return false;
  const { method, params } = iconMessage(readIcons((k) => s.get(k)), onScreen);
  const key = JSON.stringify(params);
  if (key === lastSent) return false;
  lastSent = key;
  const n = ++sends;
  clearTimeout(retry);
  retry = null;
  Promise.resolve(native.call(method, params)).catch((e) => {
    if (n !== sends) return; // a newer change went out after it
    lastSent = ""; // so the next change, or the retry, sends it again
    if (resignNeeded(e) && isOwnIcon(params.onScreen)) return onResign(params.onScreen, s);
    if (!retryable(e) || attempt >= RETRY_MS.length) return;
    retry = setTimeout(() => { retry = null; if (n === sends) tellIcon(onScreen, s, native, attempt + 1); }, RETRY_MS[attempt]);
  });
  return true;
}
export const resetTold = () => { lastSent = ""; clearTimeout(retry); retry = null; };
