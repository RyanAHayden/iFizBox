// F374: Installed Apps, the jailbreak app's list of the apps on this iPhone (App Store and other user apps), each with
// Decrypt and Inject Tweaks. The words and rules here; the page is screens/userapps.js, the list ifizbox-helper's
// user-apps (backend-native.js userApps), the decrypt and the tweaked copy the shell's (native/Sources/InstalledApps.swift).
//
//   parseUserApps(text)                  helper lines -> [{ bundleId, name, version, build, path, encrypted, store }]
//   userAppSections(apps, { query, ipas })   the page's groups: App Store, then Other Apps, A-Z, each row's line
//   copiesOf(bundleId, ipas)             { decrypted, tweaked }: the library files made from this app (newest name last)
//   decryptLine(line)                    a decrypt stream line -> { kind, text } for the progress page, or null
// SPDX-License-Identifier: GPL-3.0-or-later
import { NAME } from "../brand.js";

export const USERAPPS = "userapps"; // the page's path segment under Install IPAs
export const PAGE_TITLE = "Installed Apps";
export const userAppToken = (bundleId) => `userapp:${bundleId}`;
export const bundleIdOfToken = (t) => (typeof t === "string" && t.startsWith("userapp:") && ID.test(t.slice(8)) ? t.slice(8) : null);

const ID = /^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$/;

// The names seen in the last list, for an app page's title (the nav bar is drawn before the list answers again).
const names = new Map();
export function rememberNames(apps) { for (const a of apps ?? []) if (a?.bundleId) names.set(a.bundleId, a.name); }
export const userAppTitle = (bundleId) => names.get(bundleId) || bundleId;

// Install IPAs' row to the page (jailbreak app only).
export const listRow = (href) => ({ label: PAGE_TITLE, subtitle: "Decrypt the apps on this iPhone and inject tweaks", href });

// ifizbox-helper user-apps: "<id>\t<name>\t<version>\t<build>\t<path>\t<encrypted 1|0|>\t<store 1|0>" per line.
// A line with a bad bundle ID or too few fields is left out; encrypted is true, false or null (couldn't be read).
export function parseUserApps(text) {
  const out = [];
  const seen = new Set();
  for (const line of String(text ?? "").split("\n")) {
    const f = line.split("\t");
    if (f.length < 7 || !ID.test(f[0]) || seen.has(f[0])) continue;
    seen.add(f[0]);
    out.push({ bundleId: f[0], name: f[1] || f[0], version: f[2] || "", build: f[3] || "", path: f[4] || "",
      encrypted: f[5] === "1" ? true : f[5] === "0" ? false : null, store: f[6] === "1" });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.bundleId.localeCompare(b.bundleId));
}

// The library IPAs made from an app: the decrypted copy ("<App> <version> (decrypted).ipa") and the copy with tweaks
// ("... (tweaks).ipa"), matched by bundle ID; the last one listed of each when there are several.
export function copiesOf(bundleId, ipas) {
  let decrypted = null, tweaked = null;
  for (const e of ipas ?? []) {
    if (!e || e.error || e.bundleId !== bundleId) continue;
    const f = String(e.file ?? "");
    if (/\(decrypted\)( \d+)?\.ipa$/i.test(f)) decrypted = e;
    else if (/\(tweaks\)( \d+)?\.ipa$/i.test(f)) tweaked = e;
  }
  return { decrypted, tweaked };
}

// The grey line under an app's name: its version, then what it is: still encrypted (an App Store copy), decrypted
// copy in My IPAs, or nothing more for an app that isn't encrypted.
export function userAppLine(app, ipas) {
  const v = app.version || app.build;
  const { decrypted } = copiesOf(app.bundleId, ipas);
  const state = decrypted ? "Decrypted copy in My IPAs" : app.encrypted === true ? "Encrypted" : app.encrypted === false && app.store ? "Not encrypted" : "";
  return [v, state].filter(Boolean).join(" · ");
}

// The page's groups: App Store apps, then the others (Apple's own and sideloaded apps), A-Z; filtered by a query on
// the name or bundle ID. Each row: { bundleId, label, subtitle }.
export function userAppSections(apps, { query = "", ipas = [] } = {}) {
  const q = String(query).trim().toLowerCase();
  const shown = (apps ?? []).filter((a) => !q || a.name.toLowerCase().includes(q) || a.bundleId.toLowerCase().includes(q));
  const row = (a) => ({ bundleId: a.bundleId, label: a.name, subtitle: userAppLine(a, ipas) });
  return [
    { key: "store", header: "App Store", rows: shown.filter((a) => a.store).map(row) },
    { key: "other", header: "Other Apps", rows: shown.filter((a) => !a.store).map(row) },
  ].filter((s) => s.rows.length);
}

export const LIST_FOOTER = "Decrypt makes an IPA of an App Store app in My IPAs, which tweaks can go into.";
export const EMPTY_TEXT = "No apps found.";
export const DECRYPT_FOOTER = "The app on this iPhone isn't changed. The decrypted IPA goes to My IPAs, ready for tweaks, to install or to share.";
export const NOT_ENCRYPTED_FOOTER = "This app isn't encrypted. Decrypt still packs it into an IPA in My IPAs, ready for tweaks.";
export const TWEAKS_FOOTER = "The tweaks go into a copy of the decrypted IPA in My IPAs. The app on this iPhone stays as it is until you install the copy.";
export const decryptLabel = (decrypted) => (decrypted ? "Decrypt Again" : "Decrypt");

// One line of library.decrypt's stream ({ fd, line }) -> { kind, text } for nav/progress.js, or null to skip:
// the helper's pmstatus lines go to the bar instead (decryptStatus).
export function decryptLine(ev) {
  const line = String(ev?.line ?? "");
  if (!line || ev?.fd === "status") return null;
  if (/^(Still encrypted|Left out) /.test(line)) return { kind: "warning", text: line };
  if (ev?.fd === "err") return { kind: line.startsWith("ifizbox-helper: ") ? "error" : "raw", text: line.replace(/^ifizbox-helper: /, "") };
  if (/^(Decrypted \d+ of|Added )/.test(line)) return { kind: "step", text: line };
  return { kind: "raw", text: line };
}

// pmstatus:<id>:<percent>:<text> -> { percent, text }, or null.
export function decryptStatus(ev) {
  const m = ev?.fd === "status" ? /^pmstatus:[^:]*:(\d+(?:\.\d+)?):(.*)$/.exec(String(ev.line ?? "")) : null;
  return m ? { percent: Math.min(100, Number(m[1])), text: m[2] } : null;
}

// The sentence for a failed decrypt (the shell's "<code>: <message>" error).
export function decryptError(e, name) {
  const msg = String(e?.message ?? e ?? "").replace(/^(decrypt|helper|internal|bad_ipa):\s*/, "");
  if (/unknown verb|not a verb|usage/i.test(msg)) return `This version of ${NAME}'s helper can't decrypt apps. Update ${NAME}, then try again.`;
  return msg || `${name || "The app"} couldn't be decrypted.`;
}
