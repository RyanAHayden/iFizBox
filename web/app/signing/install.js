// Install: signAndInstall, the one entry for an app's Install on the phone and on the website.
import { IFIZBOX_ID } from "../core/websign.js";
import { storedKeep, originalState, originalNote } from "../core/keepid.js";
import { showAlert } from "../nav/alert.js";
import { NAME } from "../brand.js";
import { listedOf } from "../core/appqueue.js"; // F400
import { browserSigning, localSigning } from "./common.js";
import { firstInstallCheck } from "./device.js";
import { installOnDevice } from "./route.js";
import { nativeBridge } from "../native.js";
// C32: the website's signer (signing/browser.js and its parts, ~650 lines) loads with import() where the site signs,
// never at startup.
import { isSelfIpa } from "./common.js";
export { isSelfIpa };

// F291: screens/safety.js installSafety for one app; a check that fails to load or throws never blocks an install.
async function safetyFirst({ url, name, bundleId, version, source = null }) {
  try {
    const { installSafety } = await import("../screens/safety.js");
    return await installSafety([{ id: bundleId || url, bundleId, name, version, url, source }]);
  } catch { return true; }
}

// Signs `url` (an IPA) on the phone and installs it. Resolves true once iOS was asked to install; false after an
// error, which it shows in an alert; false in the jailbreak app (its pages use the helper, so this is only a guard).
// F93: on the website, signs it in the browser (signInBrowser); `bring` (Install iFizBox App) carries the certificate.
// F257: `size` (the source's listed size) and `iconUrl` are the website's: an app over its cap opens the Too Big alert.
export async function signAndInstall({ url, name = "", onInstalled = () => {}, bring = false, bundleId = null, version = "", bytes = null, size = null, iconUrl = null, listed = null }) {
  // F291: Known Malware refuses, a reported version asks, the exploitable-iOS alert once (screens/safety.js)
  if (!isSelfIpa(url) && !(await safetyFirst({ url, name, bundleId, version }))) return false;
  if (browserSigning()) return (await import("./browser.js")).signInBrowser({ url, name, onInstalled, bring, bundleId, version, bytes, size, iconUrl });
  if (!localSigning()) {
    await showAlert({ title: "Can't Install Here", message: `Apps are signed in the ${NAME} app. Open this one in ${NAME}, AltStore, SideStore or Feather.`, buttons: ["OK"] });
    return false;
  }
  // iFizBox's own IPA: signed here on the phone like any app, then hosted on the Signing Server (host: true) since
  // iOS closes iFizBox, and its install server, while it installs over it. Straight to iOS's Install prompt.
  const l = listed ? { listed } : listedOf({ url, version, size }); // F400
  if (isSelfIpa(url)) return installOnDevice({ url, name: name || NAME, onInstalled, host: true, ...l });
  // F75: the first Install with something missing says so, then opens the Signing walkthrough at that step.
  const step = await firstInstallCheck();
  if (step === "cancel") return false;
  if (step) {
    // F177: Signing offers Install Now for this app once it's set up.
    (await import("../screens/signing.js")).rememberInstall({ name, run: () => signAndInstall({ url, name, onInstalled, bring, bundleId, version, bytes, size, listed }) });
    return false;
  }
  // F243: the original app (its own ID, not signed by iFizBox) is on the phone: say so once before iOS refuses.
  const choice = await originalWarning({ bundleId, name });
  if (choice === "cancel") return false;
  // F81: one tap: Install signs and installs straight away. The look-first sheet (F68, signing-sheet.js) is the app
  // page's Custom Install row (signing-sheet.js customInstall).
  if (choice === "copy") return installOnDevice({ url, name, onInstalled, params: { url, keepBundleId: false }, ...l });
  return installOnDevice({ url, name, onInstalled, ...l });
}

// ---- F243: the original app on the phone, before a plain Install ---------------------------------------------
//
//   await originalWarning({ bundleId, name }, { native, alert, storage, keep })   "install" | "copy" | "cancel"
//
// With Keep Bundle IDs on, a signed app replaces the app under its own ID, and iOS refuses to put it over the App
// Store copy. When that ID is on the phone and iFizBox didn't sign it (core/keepid.js originalState), an alert says
// so, once per app: Install (as asked; remembered, so the next Install of it goes straight on), Install a Copy (this
// time the old way, a separate copy under the profile's ID beside the original) or Cancel. Nothing to say without a
// bundle ID, with Keep Bundle IDs off (the old way replaces nothing), for iFizBox itself, or without a bridge.
export const ORIGINAL_WARNED_KEY = "ifizbox.originalWarned";

const warnedIds = (storage) => {
  try { const v = JSON.parse(storage?.getItem?.(ORIGINAL_WARNED_KEY) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
};

export async function originalWarning({ bundleId = null, name = "" } = {},
  { native = nativeBridge(), alert = showAlert, storage = globalThis.localStorage, keep = storedKeep() } = {}) {
  if (!bundleId || !keep || bundleId === IFIZBOX_ID || typeof native?.call !== "function") return "install";
  if (warnedIds(storage).includes(bundleId)) return "install";
  const state = await originalState(native, bundleId).catch(() => ({ installed: false, ours: false }));
  const note = originalNote(name, state);
  if (!note) return "install";
  const { index } = await alert({ title: "Delete the Original First?", message: `${note.text} Install a Copy puts a separate one beside it, under your ID.`,
    buttons: ["Cancel", "Install a Copy", "Install"], cancel: 0 });
  if (index === 2) {
    try { storage?.setItem?.(ORIGINAL_WARNED_KEY, JSON.stringify([...warnedIds(storage), bundleId].slice(-200))); } catch { /* private mode */ }
    return "install";
  }
  return index === 1 ? "copy" : "cancel";
}
