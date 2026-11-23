// F344: the tweak index: which app every tweak of a Tweak Source is for, known before anyone opens it. The Worker
// (worker/src/tweakindex.js) downloads each free tweak .deb of a source once per package and version, runs
// core/tweaks.js inspectTweakDeb on it and serves every source's verdicts as one file (core/tweakindexfile.js, F398),
// which the sideload app and the site carry and read (screens/tweaks.js loadTweakIndex) beside the device's own checks.
// GET /api/tweaks (one source's verdicts) stays for older builds. Pure JS, shared by both sides.
//
//   INDEX_PATH                                  "/api/tweaks"
//   indexSource({ uri, dist, components }, arch) -> { uri, dist, components, arch, key } | null   the canonical
//                                                source the index keys on (key: "uri|dist|comp,comp|arch")
//   indexQuery(source, { bundle })              the query string GET /api/tweaks takes for that source
//   sourceFromQuery(searchParams)               the Worker's side: the source a query names, or null
//   indexTweaks(packagesText)                   the stanzas worth indexing: the newest version of each package
//                                                injectableFromFields passes (paid ones included, flagged)
//   indexEntry(stanza, info)                    a verdict as the index keeps it: { package, version, ok, why,
//                                                bundles, executables, anyApp, systemOnly, dylibs, needs, library }
//   paidEntry(stanza)                           a paid tweak's entry: never downloaded, the target guessed from its
//                                                Name/Description (paidHint), `unverified: true`
//   paidHint(stanza, known)                     bundle IDs whose app name (KNOWN_APPS, the user's apps) appears in
//                                                the Name or Description, as words
//   entryInfo(entry)                            an entry in screens/tweaks.js tweakInfo's cached shape
//   liteTweaks(rows, bundleId, infoOf)          Add Tweaks for an app in the sideload build: { made, any }: tweaks
//                                                whose filter names that bundle ID, then the ones for every app
//                                                (UIKit/Foundation); nothing else (unchecked, system-only, others)
//   dropsFromCatalog(info)                      B377: the verdict says the tweak can't go into an app (systemOnly or
//                                                refused, not a paid guess): core/catalog.js setTweakVerdicts drops it
//   worksInLine(info, known)                   "Works in: YouTube", "Works in: Any App", "Works in: YouTube
//                                                (unverified)" for a paid tweak's guess; null when not known
//
// SPDX-License-Identifier: GPL-3.0-or-later
import { parseControl, parseRelations, compareVersions } from "./apt.js";
import { injectableFromFields, TWEAK_ARCHES } from "./tweakfields.js";

export const INDEX_PATH = "/api/tweaks";
export const INDEX_ARCH = "iphoneos-arm64";

const COMMERCIAL = "cydia::commercial";
const tagsOf = (st) => String(st?.tag ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
export const isPaidStanza = (st) => tagsOf(st).includes(COMMERCIAL);

export function indexSource(src, arch = INDEX_ARCH) {
  let uri;
  try {
    const u = new URL(String(src?.uri ?? ""));
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password || u.search || u.hash) return null;
    uri = u.href.replace(/\/*$/, "/");
  } catch { return null; }
  const dist = String(src?.dist ?? "").trim() || "./";
  if (dist.length > 64 || /[\s?#\\]/.test(dist) || dist.split("/").includes("..")) return null;
  const flat = dist.endsWith("/");
  const components = flat ? [] : (Array.isArray(src?.components) ? src.components : String(src?.components ?? "").split(","))
    .map((c) => String(c).trim()).filter(Boolean);
  if (components.length > 8 || components.some((c) => !/^[A-Za-z0-9._-]{1,32}$/.test(c))) return null;
  if (!flat && !components.length) return null;
  const a = TWEAK_ARCHES.has(arch) ? arch : INDEX_ARCH;
  return { uri, dist, components, arch: a, key: `${uri}|${dist}|${components.join(",")}|${a}` };
}

export function indexQuery(src, { bundle = "" } = {}) {
  const s = indexSource(src, src?.arch);
  if (!s) return null;
  const q = new URLSearchParams({ source: s.uri, dist: s.dist });
  if (s.components.length) q.set("components", s.components.join(","));
  if (s.arch !== INDEX_ARCH) q.set("arch", s.arch);
  if (bundle) q.set("bundle", String(bundle));
  return q.toString();
}

export function sourceFromQuery(q) {
  const get = (k) => (typeof q?.get === "function" ? q.get(k) : q?.[k]) ?? "";
  return indexSource({ uri: get("source"), dist: get("dist"), components: get("components") }, get("arch") || INDEX_ARCH);
}

// The newest version of each package the Packages fields let through (iphoneos-arm64 or iphoneos-arm).
export function indexTweaks(text) {
  const newest = new Map();
  for (const st of parseControl(String(text ?? ""))) {
    if (!st.package || !st.version) continue;
    if (!injectableFromFields(st).ok) continue;
    const had = newest.get(st.package);
    if (!had || compareVersions(st.version, had.version) > 0) newest.set(st.package, st);
  }
  return [...newest.values()];
}

// What a tweak depends on besides the hook library we bundle (PreferenceLoader and the like stay listed).
const needsOf = (st) => [...new Set([...parseRelations(st?.["pre-depends"]), ...parseRelations(st?.depends)]
  .map((g) => g[0]?.name).filter((n) => n && !/^(firmware|cy\+)/i.test(n)))];

const strings = (v, max = 64) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x && x.length <= 200).slice(0, max) : []);

export function indexEntry(st, info) {
  return {
    package: String(st.package), version: String(st.version ?? ""),
    ok: Boolean(info?.ok), why: info?.why ? String(info.why).slice(0, 300) : null,
    bundles: strings(info?.bundles), executables: strings(info?.executables), anyApp: Boolean(info?.anyApp),
    systemOnly: Boolean(info?.systemOnly), dylibs: strings(info?.dylibs, 32), needs: needsOf(st),
    ...(info?.library ? { library: true } : {}),
  };
}

// App names as they appear in tweak names and descriptions ("for YouTube", "Instagram tweak").
const HINT_NAMES = {
  "com.google.ios.youtube": ["YouTube"], "com.google.ios.youtubemusic": ["YouTube Music", "YTMusic"],
  "com.burbn.instagram": ["Instagram"], "com.zhiliaoapp.musically": ["TikTok"], "com.spotify.client": ["Spotify"],
  "net.whatsapp.WhatsApp": ["WhatsApp"], "ph.telegra.Telegraph": ["Telegram"], "com.reddit.Reddit": ["Reddit"],
  "com.toyopagroup.picaboo": ["Snapchat"], "com.facebook.Facebook": ["Facebook"], "com.facebook.Messenger": ["Messenger"],
  "com.hammerandchisel.discord": ["Discord"], "com.netflix.Netflix": ["Netflix"], "tv.twitch": ["Twitch"],
  "com.soundcloud.TouchApp": ["SoundCloud"], "com.atebits.Tweetie2": ["Twitter"],
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function paidHint(st, known = {}) {
  const text = `${st?.name ?? ""}\n${st?.description ?? ""}`;
  const names = new Map(Object.entries(HINT_NAMES));
  for (const [id, n] of Object.entries(known ?? {})) if (n && String(n).length >= 4) names.set(id, [...(names.get(id) ?? []), String(n)]);
  const out = [];
  for (const [id, list] of names) {
    if (list.some((n) => new RegExp(`(^|[^A-Za-z0-9])${esc(n)}($|[^A-Za-z0-9])`, "i").test(text))) out.push(id);
  }
  // "YouTube Music" also says "YouTube": the longer name wins
  if (out.includes("com.google.ios.youtubemusic") && !/youtube(?! ?music)/i.test(text.replace(/youtube ?music/gi, ""))) {
    return out.filter((id) => id !== "com.google.ios.youtube");
  }
  return out;
}

export function paidEntry(st) {
  return { package: String(st.package), version: String(st.version ?? ""), ok: true, why: null, bundles: paidHint(st),
    executables: [], anyApp: false, systemOnly: false, dylibs: [], needs: needsOf(st), paid: true, unverified: true };
}

export function entryInfo(e) {
  return { ok: Boolean(e?.ok), why: e?.why ?? null, bundles: strings(e?.bundles), anyApp: Boolean(e?.anyApp),
    systemOnly: Boolean(e?.systemOnly), ...(e?.library ? { library: true } : {}), ...(e?.unverified ? { unverified: true } : {}),
    ...(e?.paid ? { paid: true } : {}), indexed: true };
}

const sameId = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

export function liteTweaks(rows, bundleId, infoOf) {
  const made = [], any = [];
  if (!bundleId) return { made, any };
  for (const r of rows ?? []) {
    const info = infoOf(r);
    if (!info?.ok || info.systemOnly) continue;
    if ((info.bundles ?? []).some((b) => sameId(b, bundleId))) made.push(r);
    else if (info.anyApp && !info.unverified) any.push(r);
  }
  return { made, any };
}

// B377: whether a verdict takes the tweak out of the sideload catalog's lists (App Tweaks, Search, Sections): for iOS
// itself, or refused. A paid tweak's guess (unverified) is no verdict; no info (unchecked) keeps it.
export const dropsFromCatalog = (info) => Boolean(info) && !info.unverified && (!info.ok || Boolean(info.systemOnly));

export function worksInLine(info, known = {}, nameOf = (id) => id) {
  if (!info?.ok) return null;
  if (info.anyApp) return "Works in: Any App";
  const names = [...new Set((info.bundles ?? []).map((b) => nameOf(b, known)))];
  if (!names.length) return null;
  return `Works in: ${names.join(", ")}${info.unverified ? " (unverified)" : ""}`;
}

