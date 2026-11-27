// Not-an-iPhone page (screens/notiphone.js): the site installs onto iPhones only, so a visitor on a Mac, a Windows or
// Linux PC or an Android phone is told to open it on their iPhone instead of landing in a store that can't install
// anything for them. Pure JS, no DOM, so it runs under `node --test` (platform.test.js).
//
// Decided by user agent, before the app draws anything, so an iPhone never sees the page flash:
//   the native app (its bridge: ifizboxNative / ifizboxApp)  -> the app
//   iPhone, iPod, iPad                                         -> the app
//   iPadOS's desktop user agent (Macintosh + maxTouchPoints > 1) -> the app
//   Android                                                    -> "android"
//   Macintosh                                                  -> "mac"
//   Windows, Linux, ChromeOS, other X11                        -> "pc"
//   anything else (crawlers, link previews, unknown)           -> the app: never lock out what we can't name
//
// "Look Around Anyway" dismisses the page for good: DISMISS_KEY in localStorage.

import { KEYS } from "./storagekeys.js";

export const DISMISS_KEY = KEYS.notIphoneDismissed;

// The kind of device that can't install, or null when the normal app should run.
// nav: navigator-like ({ userAgent, maxTouchPoints }); native: true inside the app's shell.
export function notIphoneKind(nav = {}, { native = false } = {}) {
  if (native) return null;
  const ua = String(nav.userAgent || "");
  if (/iPhone|iPod|iPad/.test(ua)) return null;
  if (/Macintosh/.test(ua) && Number(nav.maxTouchPoints) > 1) return null; // iPadOS asks for the desktop site
  if (/Android/.test(ua)) return "android";
  if (/Macintosh|Mac OS X/.test(ua)) return "mac";
  if (/Windows|Linux|CrOS|X11/.test(ua)) return "pc";
  return null;
}

// Whether to show the page on this window: its kind, or null. win: window-like ({ navigator, localStorage,
// ifizboxNative, ifizboxApp }).
export function notIphonePage(win) {
  const kind = notIphoneKind(win.navigator, { native: Boolean(win.ifizboxNative || win.ifizboxApp) });
  if (!kind) return null;
  let dismissed = null;
  try { dismissed = win.localStorage?.getItem(DISMISS_KEY); } catch { /* private mode: show it */ }
  return dismissed ? null : kind;
}

export function dismissNotIphone(win) {
  try { win.localStorage?.setItem(DISMISS_KEY, "1"); } catch { /* private mode: shows again next visit */ }
}

// The page's words for each kind. name: brand.js NAME.
export function notIphoneText(kind, name) {
  const why = {
    mac: `${name} is an iPhone app: this Mac can't run it.`,
    pc: `${name} is an iPhone app: this PC can't run it.`,
    android: `${name} is an iPhone app: Android phones can't run it.`,
  }[kind] ?? `${name} is an iPhone app.`;
  return { title: `Open ${name} on Your iPhone`, why };
}
