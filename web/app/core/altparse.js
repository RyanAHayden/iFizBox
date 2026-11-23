// AltStore's source format read into apps (the parse half of core/altstore.js, which re-exports all of this):
// parseAltSource, appStanza, runsOn and the field readers str/httpUrl. Pure JS, imports nothing of the source list,
// so core/sources/ipa.js (which core/altstore.js parseSource calls) can build on it without an import cycle.
// Shapes: core/altstore.js's header.
import { encodeUrl } from "./urlencode.js";

// A JSON field as trimmed text (strings and numbers), and an http(s) URL field or null (core/sources/ipa.js too).
export const str = (v) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
// B149: a raw space (or other character a URL can't hold) after the host is percent-encoded, not refused.
export const httpUrl = (v) => { const s = encodeUrl(str(v)); return /^https?:\/\/[^\s]+$/i.test(s) ? s : null; };
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

// "#8A28F7", "8A28F7", "#abc" -> "#8a28f7"; anything else null (it goes into CSS, so only hex gets through).
export function tintOf(v) {
  const s = str(v).replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{6}$/.test(s)) return "#" + s;
  if (/^[0-9a-f]{3}$/.test(s)) return "#" + [...s].map((c) => c + c).join("");
  return null;
}

// A date as epoch ms, or null. AltStore writes ISO 8601 ("2023-03-30T13:20:00-05:00" or "2023-03-30"). A bare
// date is that day on the phone (local midnight), not UTC midnight, which shows as the day before west of UTC.
export function dateOf(v) {
  const s = str(v);
  if (!s) return null;
  const day = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])).getTime();
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

// "16.4.1" vs "16.4": by number, part by part; missing parts are 0.
export function compareOS(a, b) {
  const pa = str(a).split(".").map((x) => parseInt(x, 10) || 0);
  const pb = str(b).split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function runsOn(version, ios) {
  if (!ios) return true;
  if (version.minOSVersion && compareOS(ios, version.minOSVersion) < 0) return false;
  // maxOSVersion "16" means any 16.x (as core/compat.js reads it): compare on as many parts as the bound has.
  const max = version.maxOSVersion;
  if (max && compareOS(str(ios).split(".").slice(0, str(max).split(".").length).join("."), max) > 0) return false;
  return true;
}

const runnableVersions = (app, ios) => app.versions.filter((v) => runsOn(v, ios));

function parseVersion(v, legacy = false) {
  if (!v || typeof v !== "object") return null;
  const version = str(v.version) || str(v.marketingVersion);
  const downloadURL = encodeUrl(str(v.downloadURL)); // B149: a raw space in it fails URL(string:) before iOS 17
  if (!version && !downloadURL) return null;
  return {
    version: version || "0", buildVersion: str(v.buildVersion) || null,
    date: dateOf(v.date ?? v.versionDate), localizedDescription: str(legacy ? v.versionDescription : v.localizedDescription ?? v.versionDescription),
    downloadURL: downloadURL || null, size: num(v.size),
    minOSVersion: str(v.minOSVersion) || null, maxOSVersion: str(v.maxOSVersion) || null,
    // Not AltStore's: a signed install manifest some sources add (see installOptions).
    manifestURL: httpUrl(v.manifestURL ?? v.installURL ?? v.itmsManifestURL),
  };
}

// screenshots: [url], [{ imageURL, width, height }], or { iphone: [...], ipad: [...] } (iPhone ones first);
// 1.x: screenshotURLs.
function parseScreenshots(app) {
  let list = app.screenshots ?? app.screenshotURLs;
  // F122: each keeps which device it is for (`device`), when the source split them.
  if (list && !Array.isArray(list) && typeof list === "object") {
    const of = (l, device) => (Array.isArray(l) ? l : []).map((s) => ({ s, device }));
    list = [...of(list.iphone, "iphone"), ...of(list.ipad, "ipad")];
  } else if (Array.isArray(list)) list = list.map((s) => ({ s, device: null }));
  if (!Array.isArray(list)) return [];
  return list.map(({ s, device }) => {
    const d = device ? { device } : {};
    if (typeof s === "string") return httpUrl(s) ? { url: httpUrl(s), width: null, height: null, ...d } : null;
    const url = httpUrl(s?.imageURL ?? s?.url);
    return url ? { url, width: num(s.width), height: num(s.height), ...d } : null;
  }).filter(Boolean);
}

// The usage-description keys AltStore shows by name (NSCameraUsageDescription -> Camera).
const PRIVACY_NAMES = {
  NSCameraUsageDescription: "Camera", NSMicrophoneUsageDescription: "Microphone",
  NSPhotoLibraryUsageDescription: "Photos", NSPhotoLibraryAddUsageDescription: "Add to Photos",
  NSLocationWhenInUseUsageDescription: "Location", NSLocationAlwaysAndWhenInUseUsageDescription: "Location (Always)",
  NSLocationAlwaysUsageDescription: "Location (Always)", NSContactsUsageDescription: "Contacts",
  NSCalendarsUsageDescription: "Calendars", NSRemindersUsageDescription: "Reminders",
  NSBluetoothAlwaysUsageDescription: "Bluetooth", NSBluetoothPeripheralUsageDescription: "Bluetooth",
  NSLocalNetworkUsageDescription: "Local Network", NSFaceIDUsageDescription: "Face ID",
  NSMotionUsageDescription: "Motion", NSSpeechRecognitionUsageDescription: "Speech Recognition",
  NSAppleMusicUsageDescription: "Media Library", NSHealthShareUsageDescription: "Health",
  NSHealthUpdateUsageDescription: "Health (Write)", NSHomeKitUsageDescription: "Home",
  NSUserTrackingUsageDescription: "Tracking", NSSiriUsageDescription: "Siri",
};
const privacyName = (key) => PRIVACY_NAMES[key] ?? str(key).replace(/^NS/, "").replace(/UsageDescription$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");

// appPermissions (2.0): { entitlements: ["com.apple..."] | [{ name }], privacy: { NSKey: text } | [{ name, usageDescription }] }.
// 1.x: permissions: [{ type: "photos", usageDescription }].
function parsePermissions(app) {
  const out = { entitlements: [], privacy: [] };
  const ap = app.appPermissions;
  if (ap && typeof ap === "object") {
    for (const e of Array.isArray(ap.entitlements) ? ap.entitlements : []) {
      const name = typeof e === "string" ? e.trim() : str(e?.name);
      if (name) out.entitlements.push({ name, description: typeof e === "object" ? str(e.usageDescription) : "" });
    }
    const pv = ap.privacy;
    if (Array.isArray(pv)) {
      for (const p of pv) if (str(p?.name)) out.privacy.push({ name: privacyName(str(p.name)), key: str(p.name), description: str(p.usageDescription) });
    } else if (pv && typeof pv === "object") {
      for (const [k, d] of Object.entries(pv)) out.privacy.push({ name: privacyName(k), key: k, description: str(d) });
    }
  }
  for (const p of Array.isArray(app.permissions) ? app.permissions : []) {
    const t = str(p?.type);
    if (t) out.privacy.push({ name: t.charAt(0).toUpperCase() + t.slice(1).replace(/-/g, " "), key: t, description: str(p.usageDescription) });
  }
  // Sources often list one permission twice (2.0's NSCameraUsageDescription and 1.x's type "camera", or a key
  // repeated): one row per name, keeping a description where either has one.
  const once = (list) => {
    const seen = new Map();
    for (const x of list) {
      const k = x.name.toLowerCase();
      const had = seen.get(k);
      if (!had) seen.set(k, x);
      else if (!had.description && x.description) seen.set(k, { ...had, description: x.description });
    }
    return [...seen.values()];
  };
  // Every signed app has these (its own ID, its team, debugging): not something it asks for.
  const plumbing = /^(application-identifier|com\.apple\.developer\.team-identifier|team-identifier|get-task-allow|keychain-access-groups|com\.apple\.security\.application-groups)$/;
  return { entitlements: once(out.entitlements.filter((e) => !plumbing.test(e.name))), privacy: once(out.privacy) };
}

function parseApp(a) {
  if (!a || typeof a !== "object") return null;
  const bundleIdentifier = str(a.bundleIdentifier);
  if (!bundleIdentifier) return null;
  let versions = (Array.isArray(a.versions) ? a.versions : []).map((v) => parseVersion(v)).filter(Boolean);
  if (!versions.length) {
    const legacy = parseVersion(a, true); // 1.x: the one version on the app itself
    if (legacy) versions = [legacy];
  }
  if (!versions.length) return null;
  return {
    bundleIdentifier, name: str(a.name) || bundleIdentifier, developerName: str(a.developerName),
    subtitle: str(a.subtitle), localizedDescription: str(a.localizedDescription), iconURL: httpUrl(a.iconURL),
    tintColor: tintOf(a.tintColor), category: str(a.category).toLowerCase() || null, beta: a.beta === true,
    screenshots: parseScreenshots(a), permissions: parsePermissions(a), versions,
  };
}

function parseNews(n) {
  if (!n || typeof n !== "object") return null;
  const title = str(n.title);
  if (!title) return null;
  return {
    identifier: str(n.identifier) || `${title}|${str(n.date)}`, title, caption: str(n.caption), date: dateOf(n.date),
    tintColor: tintOf(n.tintColor), imageURL: httpUrl(n.imageURL), url: httpUrl(n.url), appID: str(n.appID) || null,
    notify: n.notify === true,
  };
}

// F42: sources that list a bundle id more than once. AppTesters (ESign-style) lists one entry per version under
// the same name (10,279 entries for 789 ids): those merge into one app, the versions in the order the source
// lists them (newest first), sorted by date when every one has a date. RyukSign lists variants of one app under
// one bundle id with different names ("RyukGram (Duplicate)", "... (Duplicate, iOS 15)"): each stays its own app
// and row. The first keeps the bundle id as its `id` (the catalog key); a later variant gets
// `<bundle id>~<name slug>` (~2, ~3 if that is taken too). `bundleIdentifier` stays the real one on every app.
const nameSlug = (s) => str(s).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "app";
const entryKey = (app) => `${app.bundleIdentifier}\n${app.name.toLowerCase()}`;

function variantId(app, seen) {
  if (!seen.has(app.bundleIdentifier)) return app.bundleIdentifier;
  const base = `${app.bundleIdentifier}~${nameSlug(app.name)}`;
  let id = base;
  for (let n = 2; seen.has(id); n++) id = `${base}~${n}`;
  return id;
}

// Adds the versions an app doesn't have yet (same version and IPA: the same build listed twice).
function mergeVersions(app, versions) {
  const have = new Set(app.versions.map((v) => `${v.version}\n${v.downloadURL}`));
  for (const v of versions) {
    const k = `${v.version}\n${v.downloadURL}`;
    if (have.has(k)) continue;
    have.add(k);
    app.versions.push(v);
    app.merged = true;
  }
}

// Newest first by date, only when every version has one (an undated entry has no place in the order); stable.
function sortByDate(versions) {
  if (versions.every((v) => v.date != null)) versions.sort((a, b) => b.date - a.date);
}

// Does this parsed JSON look like an AltStore source? An object with an apps array (empty counts: a new source).
export const looksLikeAltSource = (json) => Boolean(json && typeof json === "object" && !Array.isArray(json) && Array.isArray(json.apps));

export function parseAltSource(input) {
  let json = input;
  if (typeof input === "string") {
    try { json = JSON.parse(input.replace(/^﻿/, "")); } catch { throw new Error("The source is not valid JSON."); }
  }
  if (!looksLikeAltSource(json)) throw new Error("This JSON is not an AltStore source (it has no apps list).");
  const apps = [];
  const seen = new Set(); // app ids (catalog keys): the bundle id, or a variant's bundleid~name
  const byName = new Map(); // bundle id + name -> app, for repeated entries (F42)
  for (const a of json.apps) {
    const app = parseApp(a);
    if (!app) continue;
    const same = byName.get(entryKey(app));
    if (same) { mergeVersions(same, app.versions); continue; }
    app.id = variantId(app, seen);
    seen.add(app.id);
    byName.set(entryKey(app), app);
    apps.push(app);
  }
  for (const app of apps) if (app.merged) { sortByDate(app.versions); delete app.merged; }
  // B336: what core/previews.js appGithub needs to tell a source's own repo from one carrying other people's IPAs:
  // the source's website and how many apps it lists. appStanza carries both onto the ipa next to sourceUrl.
  const website = httpUrl(json.website);
  for (const app of apps) { app.sourceWebsite = website; app.sourceApps = apps.length; }
  const news = (Array.isArray(json.news) ? json.news : []).map(parseNews).filter(Boolean)
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
  return {
    name: str(json.name), identifier: str(json.identifier), subtitle: str(json.subtitle), description: str(json.description),
    iconURL: httpUrl(json.iconURL), headerURL: httpUrl(json.headerURL), website: httpUrl(json.website),
    tintColor: tintOf(json.tintColor),
    featuredApps: (Array.isArray(json.featuredApps) ? json.featuredApps : []).map(str).filter((id) => seen.has(id)),
    news, apps,
  };
}

// AltStore's categories -> iFizBox sections, under "Apps" so Search's Apps scope finds them (core/catalog.js
// SECTION_GROUPS): "Apps (Games)", "Apps (Photo & Video)"; none: "Apps".
const CATEGORY = { developer: "Developer", entertainment: "Entertainment", games: "Games", lifestyle: "Lifestyle",
  other: "Other", "photo-video": "Photo & Video", social: "Social", utilities: "Utilities" };
export function appSection(category) {
  if (!category) return "Apps";
  const c = CATEGORY[category] ?? category.charAt(0).toUpperCase() + category.slice(1);
  return `Apps (${c})`;
}

// The catalog's record for an app: shaped like a control stanza where the catalog reads one (package, name,
// version, section, description, author, size, iconUrl) plus `ipa`, the whole app with only the versions this
// phone runs. The newest of those is the candidate. Null when no version runs on `ios` (hidden everywhere, and
// never filed in Changes or notified).
export function appStanza(app, source, ios = null) {
  const versions = runnableVersions(app, ios);
  if (!versions.length) return null;
  const v = versions[0];
  const short = app.subtitle || app.localizedDescription.split("\n")[0].slice(0, 120);
  const long = app.localizedDescription || app.subtitle;
  return {
    package: app.id ?? app.bundleIdentifier, name: app.name, version: v.version, section: appSection(app.category),
    // "Description: short\n long" is how core/apt.js description() splits it.
    description: long && long !== short ? `${short}\n ${long.replace(/\n/g, "\n ")}` : short,
    author: app.developerName, size: v.size ?? undefined, iconUrl: app.iconURL,
    minOSVersion: v.minOSVersion ?? undefined, maxOSVersion: v.maxOSVersion ?? undefined,
    downloadURL: v.downloadURL ?? undefined, // F160: the IPA core/ipainfo.js reads when the source gives no iOS range
    kind: "ipa",
    ipa: { ...app, versions, sourceUrl: source?.url ?? null, sourceName: source?.name ?? "" },
  };
}
