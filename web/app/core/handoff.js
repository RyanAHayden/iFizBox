// Handoff to a real package manager (F8): the "Open in" links on a source's page and a package's page, one per app
// that takes that source's format, and iFizBox's own /add?url= link (plus its QR code) for adding from another
// device. Pure JS, no DOM. Every scheme here was checked in that app's own source (journal/2026-11-17-f8-handoff):
//
//   sourceLinks(source)        -> [{ app, url }]  APT ({ uri, dist, components }) or AltStore ({ key: "alt:…" })
//   packageLinks(id, source)   -> [{ app, url }]  an APT package, or an AltStore app (its source's add links)
//   formatOf(source)           -> "apt" | "altstore" | "esign" | "scarlet" | "gbox" (F50: an alt: record's `format`)
//   isIpaFormat(format)        -> true for every alt: (IPA) format
//   addLink(source, origin)    -> "<origin>/add?url=…[&suite=…&component=…]"
//   parseAddLink(search)       -> { url, dist?, components? } or null, from /add's query string
//   appLink(id, origin)        -> "<origin>/app?id=…" (F451: an app's page; Share iFizBox link)
//   parseAppLink(search)       -> the app's id or null, from /app's query string; isAppPath(pathname)
//
// In the jailbreak app these rows give way to the real install queue (N4).
import { isAltKey } from "./altstore.js";
import { DOMAIN } from "../brand.js";

const enc = encodeURIComponent;
const isFlat = (dist) => !dist || String(dist).endsWith("/");
const isHttp = (u) => /^https?:\/\/[^\s/?#]+/i.test(String(u ?? ""));

// Cydia's share page reads `#?source=` (and `package=`) with its own query parser. Keep the URL as it is, as
// saurik's own share links do, and escape only what would end the value early.
const fragmentValue = (u) => String(u).replace(/[%&#+ ]/g, (c) => enc(c));
const CYDIA_SHARE = "https://cydia.saurik.com/api/share#?source=";

// F50: alt: records keep their detected format (F16a, core/sources/detect.js FORMATS); one from before F16a has none
// and is AltStore.
const IPA_FORMATS = ["altstore", "esign", "scarlet", "gbox", "github"]; // github: F304
export const isIpaFormat = (format) => IPA_FORMATS.includes(format);
export function formatOf(source) {
  if (!(source?.kind === "altstore" || isAltKey(source?.key))) return "apt";
  return isIpaFormat(source.format) ? source.format : "altstore";
}
const altUrl = (source) => source?.uri || String(source?.key ?? "").replace(/^alt:/, "");

// APT managers. Only Irisin's link carries a suite and components; Cydia's share page, Sileo and Zebra add a flat
// repo from a URL, so a dist repo (Telesphoreo, Procursus) gets Irisin alone.
//   Cydia   MobileCydia.mm pageForURL: cydia://url/<page> opens <page> in its web view; the share page then calls
//           cydia.addSource(url, "./") (it builds the key deb:<url>:./, so flat repos only).
//   Sileo   AppDelegate.swift: host "source" -> presentAddSourceEntryField, which strips "sileo://source/" from the
//           absolute string, so the URL goes in raw.
//   Zebra   ZBAppDelegate.m / ZBSourceListTableViewController handleURL: zbra://sources/add/<url>, raw.
//   Irisin  IrisinLink.swift: irisin://repository/add?url=…&suite=…&component=… (query items, encoded).
const APT_MANAGERS = [
  { app: "Cydia", source: (s) => (isFlat(s.dist) ? cydiaShare(s.uri) : null) },
  { app: "Sileo", source: (s) => (isFlat(s.dist) ? `sileo://source/${s.uri}` : null) },
  { app: "Zebra", source: (s) => (isFlat(s.dist) ? `zbra://sources/add/${s.uri}` : null) },
  { app: "Irisin", source: (s) => irisinAdd(s) },
];

function cydiaShare(uri, pkg) {
  return `cydia://url/${CYDIA_SHARE}${fragmentValue(uri)}${pkg ? `&package=${fragmentValue(pkg)}` : ""}`;
}

function irisinAdd({ uri, dist, components }) {
  let q = `url=${enc(uri)}`;
  if (!isFlat(dist)) {
    q += `&suite=${enc(dist)}`;
    for (const c of components ?? []) q += `&component=${enc(c)}`;
  }
  return `irisin://repository/add?${q}`;
}

// AltStore-format managers (the list from StikDebug/altdirect's redirect.js, checked in each app where its source
// is public). Those that read a query item get the URL encoded; Feather takes it raw after /source/ and only https.
//   AltStore           SceneDelegate.swift case "source": queryItems["url"] (schemes altstore, altstore-pal)
//   AltStore Classic   altstore-classic:// as AltDirect sends it (not in AltStore's public Info.plist; see journal)
//   SideStore          DeepLinks/URLHandler.swift case "source": queryItems["url"]
//   Feather            FeatherApp.swift validatedScheme(after: "/source/"), which requires "https://"
//   LiveContainer      LCAltStoreSourcesView.swift handleURL: host "source", queryItems "url"
//   StikStore          stikstore://add-source?url=<encoded>, as AltDirect sends it (no public source found)
//   TrollApps          SourcesView.swift onOpenURL: hasPrefix("trollapps://add?url=") then queryItems["url"]
const query = (prefix) => (u) => `${prefix}${enc(u)}`;
const ALT_MANAGERS = [
  { app: "AltStore Classic", source: query("altstore-classic://source?url=") },
  { app: "AltStore", source: query("altstore://source?url=") },
  { app: "SideStore", source: query("sidestore://source?url=") },
  { app: "Feather", source: (u) => (/^https:\/\//i.test(u) ? `feather://source/${u}` : null) },
  { app: "LiveContainer", source: query("livecontainer://source?url=") },
  { app: "StikStore", source: query("stikstore://add-source?url=") },
  { app: "TrollApps", source: query("trollapps://add?url=") },
];

// F50: IPA source formats other than AltStore's, each to its own app (checked 2026-11-17; journal/2026-11-17-f50-open-in-by-format).
// None of the three is open source: the forms are the ones source sites send (fwuf.in's redirector, repo pages).
//   Scarlet  scarlet://repo=<url>, raw (core/sources/detect.js unwrapLink reads the same form back)
//   ESign    esign://addsource?url=<url>, raw as the sites send it; & and # escaped so they stay in the value
//   GBox     gbox://AddSource/<url>, raw
// ESign's JSON is AltStore 1.x plus its own fields, so the AltStore-format sideloaders follow ESign's own row.
// Scarlet's and GBox's JSON is their own, so only that app. A record with `unsupported` (an encrypted GBox source)
// gets only its own app, whatever the format.
const queryValue = (u) => String(u).replace(/[&# ]/g, (c) => enc(c));
const OWN_APP = {
  scarlet: { app: "Scarlet", source: (u) => `scarlet://repo=${u}` },
  esign: { app: "ESign", source: (u) => `esign://addsource?url=${queryValue(u)}` },
  gbox: { app: "GBox", source: (u) => `gbox://AddSource/${u}` },
};
const ALT_READABLE = new Set(["altstore", "esign"]);

const keep = (list) => list.filter((l) => l.url);

function ipaLinks(source) {
  const url = altUrl(source);
  if (!isHttp(url)) return [];
  const fmt = formatOf(source);
  const own = OWN_APP[fmt];
  const managers = [...(own ? [own] : []), ...(ALT_READABLE.has(fmt) && !source.unsupported ? ALT_MANAGERS : [])];
  return keep(managers.map((m) => ({ app: m.app, url: m.source(url) })));
}

// F304: a GitHub repo read through its releases (core/github.js) is a source only this app reads: no other app's link.
const githubOnly = (source) => Boolean(source?.github) || source?.format === "github";

export function sourceLinks(source) {
  if (!source || githubOnly(source)) return [];
  if (isIpaFormat(formatOf(source))) return ipaLinks(source);
  if (!isHttp(source.uri)) return [];
  return keep(APT_MANAGERS.map((m) => ({ app: m.app, url: m.source(source) })));
}

// An APT package: a link that opens the package's page there. Where the app can add the source on the way (Cydia's
// share page with package=, Zebra's ?source=), the link carries it; otherwise the source has to be there already.
//   Cydia   share page `&package=` (flat repos), else cydia://package/<id> (pageForURL, allowed from outside)
//   Sileo   URLManager.swift: sileo://package/<id> (newestPackage in any added source)
//   Zebra   ZBAppDelegate.m: zbra://packages/<id>?source=<url>, which adds the source first when it's missing; it
//           splits the query on "source=", so the URL goes in raw
//   Irisin  IrisinLink.swift: irisin://package/<identity>
// An AltStore app has no per-app link in those apps: its row adds the app's source.
export function packageLinks(id, source) {
  if (!id || !source || githubOnly(source)) return [];
  if (isIpaFormat(formatOf(source))) return sourceLinks(source);
  if (!isHttp(source.uri)) return [];
  const flat = isFlat(source.dist);
  const p = enc(id);
  return [
    { app: "Cydia", url: flat ? cydiaShare(source.uri, id) : `cydia://package/${p}` },
    { app: "Sileo", url: `sileo://package/${p}` },
    { app: "Zebra", url: flat ? `zbra://packages/${p}?source=${source.uri}` : `zbra://packages/${p}` },
    { app: "Irisin", url: `irisin://package/${p}` },
  ];
}

// iFizBox's own link: opens iFizBox with Add Source's alert filled in. The site's origin where iFizBox runs on the
// web; the app (file:// or its own scheme) links to the public site.
export const PUBLIC_SITE = `https://${DOMAIN}`;
export function siteOrigin(location) {
  const o = location?.origin;
  return typeof o === "string" && /^https?:\/\//.test(o) ? o : PUBLIC_SITE;
}

export function addLink(source, origin = PUBLIC_SITE) {
  if (githubOnly(source)) return githubAddLink(source, origin);
  const alt = isIpaFormat(formatOf(source));
  const url = alt ? altUrl(source) : source?.uri;
  if (!isHttp(url)) return null;
  let q = `url=${enc(url)}`;
  if (!alt && !isFlat(source.dist)) {
    q += `&suite=${enc(source.dist)}`;
    for (const c of source.components ?? []) q += `&component=${enc(c)}`;
  }
  return `${String(origin).replace(/\/+$/, "")}/add?${q}`;
}

// F304: a GitHub source is shared as its repo's page, which Add Source reads again (core/github.js githubRepoPage).
function githubAddLink(source, origin) {
  const m = /^https:\/\/(?:github\.com|api\.github\.com\/repos)\/([^/]+)\/([^/?#]+)/i.exec(String(source?.uri ?? ""));
  return m ? `${String(origin).replace(/\/+$/, "")}/add?url=${enc(`https://github.com/${m[1]}/${m[2]}`)}` : null;
}

// /add's query string -> what Add Source should hold, or null when there is no http(s) url in it.
export function parseAddLink(search) {
  const p = new URLSearchParams(String(search ?? "").replace(/^\?/, ""));
  const url = (p.get("url") ?? "").trim();
  if (!isHttp(url)) return null;
  const suite = (p.get("suite") ?? "").trim();
  if (!suite || isFlat(suite)) return { url };
  return { url, dist: suite, components: p.getAll("component").map((c) => c.trim()).filter(Boolean) };
}

// True on the /add page (any base path): app.js then opens Add Source instead of the start page.
export const isAddPath = (pathname) => /(^|\/)add\/?$/.test(String(pathname ?? ""));

// F451: Share iFizBox link on an app's page: /app?id=<id> opens iFizBox on that app's page (Search's package:<id>).
export function appLink(id, origin = PUBLIC_SITE) {
  const v = String(id ?? "").trim();
  return v && v.length <= 300 && !/[/\s]/.test(v) ? `${String(origin).replace(/\/+$/, "")}/app?id=${enc(v)}` : null;
}

// /app's query string -> the app's id, or null.
export function parseAppLink(search) {
  const v = (new URLSearchParams(String(search ?? "").replace(/^\?/, "")).get("id") ?? "").trim();
  return v && v.length <= 300 && !/[/\s]/.test(v) ? v : null;
}

// True on the /app page (any base path): app.js then opens that app's page.
export const isAppPath = (pathname) => /(^|\/)app\/?$/.test(String(pathname ?? ""));
