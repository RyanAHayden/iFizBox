// F83: other sideloaders' links, which the sideload build claims (native/Info-sideload.plist CFBundleURLTypes) and
// turns into iFizBox's own: add a source, or install an IPA. Pure JS, no DOM. Settings > Sideloading's "Open Other
// Apps' Links" (on by default) decides whether iFizBox takes them; screens/settings.js draws it, incoming.js acts.
//
//   OTHER_SCHEMES              the schemes claimed; the plist and App.swift's OtherLink.schemes hold the same list
//   parseOtherLink(link)       -> { app, scheme, action: "source" | "install" | "other", url } or null (not one)
//   otherLinksOn(storage)      the switch (on unless it was turned off)
//   setOtherLinks(on, storage)
//
// Link shapes, each read in that app's own source where it is public (checked 2026-11-17, journal/2026-11-17-f83-*):
//   AltStore   SceneDelegate.swift: host "source" / "install", queryItems["url"]   (altstore-classic: AltDirect's form)
//   SideStore  DeepLinks/URLHandler.swift: host "source" / "install", queryItems["url"]
//   Feather    FeatherApp.swift: validatedScheme(after: "/source/") and "/install/": the rest, raw, https only
//   Ksign      FeatherApp.swift (a Feather fork): the same, scheme ksign
//   TrollApps  SourcesView.swift: trollapps://add?url=
//   StikStore  stikstore://add-source?url= (AltDirect's form; no public source)
//   ESign      esign://addsource?url= (closed source: the form source sites send); esign://install?url= by the
//              generic rule below
//   Scarlet    scarlet://repo=<url>, scarlet://install=<url> (closed source: the forms sites send)
//   GBox       gbox://AddSource/<url> (closed source)
// Anything else on these schemes goes by its first word (host, or path for scarlet's "repo="): add / source / repo /
// addsource / add-source -> source, install / download -> install; a link with no such word whose URL ends in .ipa
// or .tipa -> install. The rest (Feather's import-certificate, SideStore's pairing, AltStore's backup callbacks)
// is "other": it was meant for that app, and iFizBox can only hand it back (incoming.js).
//
// Not claimed: livecontainer (LiveContainer launches its apps through it), apple-magnifier (the system Magnifier,
// which TrollStore borrows), altstore-pal (AltStore PAL's marketplace flows).
// SPDX-License-Identifier: GPL-3.0-or-later

import { KEYS } from "./storagekeys.js";

const OTHER_APPS = {
  altstore: "AltStore", "altstore-classic": "AltStore Classic", sidestore: "SideStore", feather: "Feather",
  ksign: "Ksign", esign: "ESign", scarlet: "Scarlet", gbox: "GBox", trollapps: "TrollApps", stikstore: "StikStore",
};
export const OTHER_SCHEMES = Object.keys(OTHER_APPS);

const SOURCE_WORDS = new Set(["add", "source", "sources", "repo", "addsource", "add-source", "addrepo"]);
const INSTALL_WORDS = new Set(["install", "download"]);
const MAX = 8192;

const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

// An http(s) URL with a host and no credentials, normalised; null for anything else.
function http(s) {
  const t = String(s ?? "").trim();
  if (!/^https?:\/\/[^\s/?#]+/i.test(t)) return null;
  try {
    const u = new URL(t);
    if (!/^https?:$/.test(u.protocol) || !u.hostname || u.username || u.password) return null;
    return u.href;
  } catch { return null; }
}

// The value of url= (or source=, repo=) in the link's query, as URLComponents' queryItems reads it.
function queryUrl(rest) {
  const q = rest.indexOf("?");
  if (q < 0) return null;
  const p = new URLSearchParams(rest.slice(q + 1).replace(/#.*$/, ""));
  for (const k of ["url", "source", "repo"]) {
    const v = p.get(k);
    if (v) return http(v) ?? http(decode(v));
  }
  return null;
}

// The rest of the link after "/<word>/" or "<word>=", raw as Feather's validatedScheme takes it (decoded once when
// it was sent encoded).
function afterWord(rest) {
  const m = rest.match(/^[^/?#=]*[/=](.*)$/s);
  if (!m) return null;
  const v = m[1];
  return http(v) ?? http(decode(v));
}

// The first http(s) URL written anywhere in the link.
function firstUrl(rest) {
  const at = rest.search(/https?(:|%3A)/i);
  if (at < 0) return null;
  const v = rest.slice(at);
  return /^https?:/i.test(v) ? http(v) : http(decode(v));
}

const isIpa = (u) => { try { return /\.t?ipa$/i.test(new URL(u).pathname); } catch { return false; } };

export function parseOtherLink(link) {
  const s = String(link ?? "").trim();
  if (!s || s.length > MAX) return null;
  const scheme = s.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (!scheme || !Object.hasOwn(OTHER_APPS, scheme)) return null;
  const app = OTHER_APPS[scheme];
  const rest = s.slice(scheme.length + 1).replace(/^\/\//, ""); // "source?url=…", "install/https://…", "repo=…"
  const word = (rest.match(/^[^/?#=]*/)?.[0] ?? "").toLowerCase();
  const path = rest[word.length] === "/" || rest[word.length] === "="; // feather://install/<url>, scarlet://repo=<url>
  const url = (path ? afterWord(rest) ?? queryUrl(rest) : queryUrl(rest)) ?? firstUrl(rest);
  let action = "other";
  if (SOURCE_WORDS.has(word)) action = "source";
  else if (INSTALL_WORDS.has(word)) action = "install";
  else if (url && isIpa(url)) action = "install";
  if (action !== "other" && !url) action = "other";
  return { app, scheme, action, url: action === "other" ? null : url };
}

const KEY = KEYS.otherLinks;
export function otherLinksOn(storage = globalThis.localStorage) {
  try { return storage?.getItem(KEY) !== "off"; } catch { return true; }
}
export function setOtherLinks(on, storage = globalThis.localStorage) {
  try { if (on) storage?.removeItem(KEY); else storage?.setItem(KEY, "off"); } catch { /* private mode: stays on */ }
}
