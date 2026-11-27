// F160: compatibility for apps whose source gives no iOS range (AppTesters gives none for its 10,000 apps): the IPA's
// own Info.plist says it (MinimumOSVersion, UIDeviceFamily). Only an app page that is opened asks (never a list or a
// feed): the Worker's /api/ipainfo reads the IPA with Range requests and caches the answer at the edge; the result is
// kept on this device keyed by the IPA's downloadURL, and the catalog judges the row with it from then on (a green
// check or a red X instead of the grey outlined "not checked" mark). Pure JS, no DOM. SPDX-License-Identifier: GPL-3.0-or-later
//
//   needsCheck(version)          -> true when the version gives no minOSVersion and has an http(s) downloadURL
//   ipaInfoUrl(url, base)        -> "/api/ipainfo?url=…" (null: not an http(s) URL)
//   textMinOS(text)              -> "15.0" from "iOS 15+", "Requires iOS 15", "iOS 15.0 or later"…; null when none
//   withIpaInfo(target, info)    -> the stanza or version with the IPA's minOSVersion and deviceFamily filled in where
//                                   the source gives none (the source's fields win), and ipaChecked: true; `target`
//                                   itself when there is no info. B74: a minOSVersion read from the IPA (from: "ipa")
//                                   above the source's wins over it (ipaFrom: "ipa")
//   ipaRaises(target, info)      -> true when that happens: the IPA's own MinimumOSVersion is above the source's
//   savedInfo(store, url, now)   -> the info kept for that IPA, or null (none, or expired)
//   allSaved(store, now)         -> { url: info } for every kept IPA (the catalog gets these: catalog.setIpaInfo)
//   checkIpa(url, { get, store, fallback, text, now, queue }) -> Promise<info>, asked once per IPA on this device:
//                                   1) get(url) -> the Worker's answer ({ minOSVersion, deviceFamily, … } or { code })
//                                   2) the App Store's minimumOsVersion (fallback() -> Promise<string | null>, F161)
//                                   3) textMinOS(text) (the subtitle and descriptions)
//                                   The IPA's own value wins. Network failures are not kept (asked again next time)
//                                   unless 2 or 3 found something, which is kept a day.
//   createQueue(n)               -> run(fn): at most n checks at a time, the rest wait their turn
//
// info: { minOSVersion: "15.0" | null, deviceFamily: [1, 2] | null, from: "ipa" | "appstore" | "text" | null, at, until? }
// from null with ipaChecked means "checked, still unknown" (today's grey ?): the Range was refused, no Info.plist.

import { KEY_PREFIXES } from "./storagekeys.js";

const PREFIX = KEY_PREFIXES.ipaInfo;
const DAY = 86400000;
export const UNKNOWN_TTL = 30 * DAY; // the IPA couldn't be read for good (no Range, no Info.plist): ask again in a month
export const GUESS_TTL = DAY;         // the Worker didn't answer, a fallback did: try the IPA again tomorrow
// The Worker's codes for an IPA that won't read however often it's asked (worker/src/index.js PERMANENT).
const LASTING = new Set(["no_range", "not_zip", "no_plist", "bad_plist", "too_large", "not_found"]);

const str = (v) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const httpUrl = (u) => (/^https?:\/\/[^\s]+$/i.test(str(u)) ? str(u) : null);
const osVersion = (v) => {
  const m = /^(\d{1,2})(?:\.(\d{1,2}))?(?:\.(\d{1,2}))?$/.exec(str(v));
  if (!m || Number(m[1]) < 2 || Number(m[1]) > 40) return null;
  return [m[1], m[2] ?? "0", ...(m[3] ? [m[3]] : [])].join(".");
};
const families = (v) => {
  const list = (Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return list.length ? list : null;
};

export const needsCheck = (v) => Boolean(v && !str(v.minOSVersion) && httpUrl(v.downloadURL));

export function ipaInfoUrl(url, base = "") {
  const u = httpUrl(url);
  return u ? `${base}/api/ipainfo?${new URLSearchParams({ url: u })}` : null;
}

// The first "needs iOS N" a description states. A bare "iOS 17" (a feature list, "now on iOS 17") says nothing.
const TEXT = [
  /\biOS\s*(\d{1,2}(?:\.\d{1,2}){0,2})\s*\+/i,                                                      // iOS 15+
  /\brequires?\s+(?:at\s+least\s+)?iOS\s*(\d{1,2}(?:\.\d{1,2}){0,2})\b/i,                          // Requires iOS 14.0
  /\biOS\s*(\d{1,2}(?:\.\d{1,2}){0,2})\s*(?:or|and)\s*(?:later|newer|above|up|higher|greater)\b/i,  // iOS 15 or later
  /\b(?:minimum|min\.?)\s*(?:iOS|OS|system)?\s*(?:version)?\s*[:=-]?\s*(?:iOS\s*)?(\d{1,2}(?:\.\d{1,2}){0,2})\b/i, // Minimum iOS: 13
  /\biOS\s*(\d{1,2}(?:\.\d{1,2}){0,2})\s*(?:-|–|to)\s*(?:latest|now|current)\b/i,                   // iOS 14 - latest
];
export function textMinOS(text) {
  const t = str(text);
  if (!t) return null;
  for (const re of TEXT) {
    const v = osVersion(re.exec(t)?.[1]);
    if (v) return v;
  }
  return null;
}

// B74: the IPA's own MinimumOSVersion is above the source's (YouMod Repo says 14.0, its YouTube IPA needs 17.0).
// Only an answer read from the IPA counts (from: "ipa"); an App Store or description guess never beats the source.
const newer = (a, b) => {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
};
export function ipaRaises(target, info) {
  const src = osVersion(target?.minOSVersion), ipa = info?.from === "ipa" ? osVersion(info.minOSVersion) : null;
  return Boolean(src && ipa && newer(ipa, src));
}

export function withIpaInfo(target, info) {
  if (!target || !info) return target;
  if (ipaRaises(target, info)) {
    return { ...target, minOSVersion: osVersion(info.minOSVersion), deviceFamily: families(target.deviceFamily) ?? info.deviceFamily ?? undefined,
      ipaChecked: true, ipaFrom: "ipa" };
  }
  const min = str(target.minOSVersion) || info.minOSVersion || undefined;
  const fam = families(target.deviceFamily) ?? info.deviceFamily ?? undefined;
  return { ...target, minOSVersion: min, deviceFamily: fam, ipaChecked: true, ipaFrom: str(target.minOSVersion) ? "source" : info.from ?? null };
}

// ---- Kept on the device ----------------------------------------------------------------------------------------

function parse(raw, now) {
  try {
    const v = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== "object" || typeof v.at !== "number") return null;
    if (typeof v.until === "number" && v.until < now) return null;
    return { minOSVersion: osVersion(v.minOSVersion), deviceFamily: families(v.deviceFamily), from: v.from ?? null, at: v.at,
      ...(typeof v.until === "number" ? { until: v.until } : {}) };
  } catch { return null; }
}

export function savedInfo(store, url, now = Date.now()) {
  const u = httpUrl(url);
  if (!u || !store) return null;
  try { return parse(store.getItem(PREFIX + u), now); } catch { return null; }
}

export function allSaved(store, now = Date.now()) {
  const out = {};
  if (!store) return out;
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (!k?.startsWith(PREFIX)) continue;
      const v = parse(store.getItem(k), now);
      if (v) out[k.slice(PREFIX.length)] = v;
    }
  } catch { /* unreadable storage: nothing kept */ }
  return out;
}

function save(store, url, info) {
  try { store?.setItem(PREFIX + url, JSON.stringify(info)); } catch { /* full or private: this visit only */ }
}

// ---- Asking ----------------------------------------------------------------------------------------------------

export function createQueue(n = 2) {
  let running = 0;
  const waiting = [];
  const next = () => {
    if (running >= n || !waiting.length) return;
    const { fn, resolve, reject } = waiting.shift();
    running++;
    Promise.resolve().then(fn).then(resolve, reject).finally(() => { running--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { waiting.push({ fn, resolve, reject }); next(); });
}

const inflight = new Map();
const defaultQueue = createQueue(2);
export function clearIpaMemory() { inflight.clear(); }

export function checkIpa(url, { get, store = null, fallback = null, text = "", now = Date.now(), queue = defaultQueue } = {}) {
  const u = httpUrl(url);
  if (!u || typeof get !== "function") return Promise.resolve(null);
  const kept = savedInfo(store, u, now);
  if (kept) return Promise.resolve(kept);
  if (inflight.has(u)) return inflight.get(u);
  const p = queue(async () => {
    let ipa = null, lasting = false;
    try {
      const j = await get(u);
      if (j && typeof j === "object" && !j.code && !j.error) { ipa = j; lasting = true; }
      else if (LASTING.has(j?.code)) lasting = true;
    } catch { /* the Worker or the network: not kept */ }
    let min = osVersion(ipa?.minOSVersion), from = min ? "ipa" : null;
    if (!min && fallback) {
      min = osVersion(await Promise.resolve().then(fallback).catch(() => null));
      if (min) from = "appstore";
    }
    if (!min) { min = textMinOS(text); if (min) from = "text"; }
    const fam = families(ipa?.deviceFamily);
    const info = { minOSVersion: min, deviceFamily: fam, from: from ?? (fam ? "ipa" : null), at: now };
    if (lasting && !min && !fam) info.until = now + UNKNOWN_TTL;
    else if (!lasting) info.until = now + GUESS_TTL;
    if (lasting || min) save(store, u, info);
    return info;
  }).finally(() => inflight.delete(u));
  inflight.set(u, p);
  return p;
}

// ---- F197: an IPA picked on the website, read in the browser ------------------------------------------------------
//
//   readIpaFile(src)    -> Promise<{ bundleId, name, version, minimumOS, icon }> from a File/Blob, Uint8Array or
//                          ArrayBuffer: the app's Info.plist (XML or binary) and its largest plain-PNG icon (base64; null
//                          when the app has only CgBI PNGs or an asset catalog, which a browser can't draw). Only the
//                          zip's directory and those entries are read (Blob.slice), never the whole IPA. Throws
//                          { code: "bad_ipa" } for a file that isn't an IPA.
//   parseBplist(bytes)  -> the JS value of a binary plist (bplist00): dict, array, string, number, bool, Date, Uint8Array
// ponytail: no zip64 (a picked IPA is capped well under 4 GB, core/myipas.js SITE_FILE_MAX), no encrypted entries.

const badIpa = (message) => Object.assign(new Error(message), { code: "bad_ipa" });

function sourceOf(src) {
  if (src && typeof src.slice === "function" && typeof src.size === "number" && !(src instanceof Uint8Array) && !(src instanceof ArrayBuffer)) {
    return { size: src.size, read: async (a, b) => new Uint8Array(await src.slice(a, b).arrayBuffer()) };
  }
  const b = src instanceof Uint8Array ? src : src instanceof ArrayBuffer ? new Uint8Array(src) : null;
  if (!b) throw badIpa("That isn't a file.");
  return { size: b.length, read: async (a, c) => b.subarray(a, c) };
}

async function zipDirectory({ size, read }) {
  const tailLen = Math.min(size, 65557);
  const tail = await read(size - tailLen, size);
  // Safari can hand over a File it can't read in full (iCloud Drive, not downloaded yet): say so, not "not a zip".
  if (tail.length < tailLen) throw badIpa(`Safari read only part of that file (${tail.length} of ${tailLen} bytes at its end). If it's in iCloud Drive, download it in Files first (or move it to On My iPhone), then choose it again.`);
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw badIpa(`That file isn't a whole IPA: no zip directory at its end (${size} bytes). It may be cut short: download it again.`);
  const dirSize = tv.getUint32(eocd + 12, true), dirAt = tv.getUint32(eocd + 16, true);
  if (dirAt === 0xffffffff || dirAt + dirSize > size) throw badIpa("That IPA's zip directory can't be read.");
  const d = await read(dirAt, dirAt + dirSize);
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const out = [];
  for (let p = 0; p + 46 <= d.length && v.getUint32(p, true) === 0x02014b50;) {
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    out.push({ name: new TextDecoder().decode(d.subarray(p + 46, p + 46 + nameLen)), flags: v.getUint16(p + 8, true),
      method: v.getUint16(p + 10, true), csize: v.getUint32(p + 20, true), size: v.getUint32(p + 24, true), local: v.getUint32(p + 42, true) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function zipEntry({ read }, e, max = 8 * 1024 * 1024) {
  if (e.size > max || e.flags & 1) return null;
  const head = await read(e.local, e.local + 30);
  const hv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (head.length < 30 || hv.getUint32(0, true) !== 0x04034b50) return null;
  const start = e.local + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
  const raw = await read(start, start + e.csize);
  if (e.method === 0) return raw.slice();
  if (e.method !== 8) return null;
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function parseBplist(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 40 || new TextDecoder().decode(b.subarray(0, 6)) !== "bplist") throw new Error("bplist: no header");
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const t = b.length - 32;
  const offSize = b[t + 6], refSize = b[t + 7];
  const num = Number(v.getBigUint64(t + 8)), top = Number(v.getBigUint64(t + 16)), table = Number(v.getBigUint64(t + 24));
  const uint = (at, n) => { let x = 0; for (let i = 0; i < n; i++) x = x * 256 + b[at + i]; return x; };
  const offset = (i) => uint(table + i * offSize, offSize);
  const depth = new Set();
  const obj = (i) => {
    if (i >= num || depth.has(i)) throw new Error("bplist: bad reference");
    depth.add(i);
    try { return value(offset(i)); } finally { depth.delete(i); }
  };
  const length = (at, low) => {
    if (low !== 0xf) return { n: low, at: at + 1 };
    const m = b[at + 1] & 0xf, w = 1 << m;
    return { n: uint(at + 2, w), at: at + 2 + w };
  };
  function value(at) {
    const marker = b[at], hi = marker >> 4, low = marker & 0xf;
    switch (hi) {
      case 0x0: return low === 0x8 ? false : low === 0x9 ? true : null;
      case 0x1: { const w = 1 << low; return w === 8 ? Number(v.getBigInt64(at + 1)) : uint(at + 1, w); }
      case 0x2: return low === 2 ? v.getFloat32(at + 1) : v.getFloat64(at + 1);
      case 0x3: return new Date(Date.UTC(2001, 0, 1) + v.getFloat64(at + 1) * 1000);
      case 0x4: { const l = length(at, low); return b.slice(l.at, l.at + l.n); }
      case 0x5: { const l = length(at, low); return new TextDecoder("latin1").decode(b.subarray(l.at, l.at + l.n)); }
      case 0x6: {
        const l = length(at, low);
        let s = "";
        for (let i = 0; i < l.n; i++) s += String.fromCharCode(v.getUint16(l.at + i * 2));
        return s;
      }
      case 0x7: { const l = length(at, low); return new TextDecoder().decode(b.subarray(l.at, l.at + l.n)); }
      case 0x8: return { UID: uint(at + 1, low + 1) };
      case 0xa: { const l = length(at, low); return Array.from({ length: l.n }, (_, k) => obj(uint(l.at + k * refSize, refSize))); }
      case 0xd: {
        const l = length(at, low), o = {};
        for (let k = 0; k < l.n; k++) o[String(obj(uint(l.at + k * refSize, refSize)))] = obj(uint(l.at + (l.n + k) * refSize, refSize));
        return o;
      }
      default: throw new Error(`bplist: unknown object 0x${marker.toString(16)}`);
    }
  }
  return obj(top);
}

const pngBase64 = (bytes) => {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const isPng = (b) => b?.length > 16 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isCgBIPng = (b) => isPng(b) && b[12] === 0x43 && b[13] === 0x67 && b[14] === 0x42 && b[15] === 0x49;

function iconNames(p) {
  const names = [];
  for (const k of ["CFBundleIcons", "CFBundleIcons~ipad"]) names.push(...(p?.[k]?.CFBundlePrimaryIcon?.CFBundleIconFiles ?? []));
  names.push(...(p?.CFBundleIconFiles ?? []));
  if (p?.CFBundleIconFile) names.push(p.CFBundleIconFile);
  return [...new Set(names.filter((n) => typeof n === "string" && n).map((n) => n.replace(/\.png$/i, "")))];
}

export async function readIpaFile(src) {
  const s = sourceOf(src);
  const dir = await zipDirectory(s);
  const info = dir.find((e) => /^Payload\/[^/]+\.app\/Info\.plist$/.test(e.name));
  if (!info) throw badIpa("That file isn't an IPA: it has no Payload/<app>.app/Info.plist.");
  const raw = await zipEntry(s, info);
  if (!raw) throw badIpa("That IPA's Info.plist can't be read.");
  let p;
  try {
    p = new TextDecoder().decode(raw.subarray(0, 6)) === "bplist" ? parseBplist(raw)
      : (await import("./signing.js")).parsePlist(new TextDecoder().decode(raw));
  } catch { throw badIpa("That IPA's Info.plist can't be read."); }
  const bundleId = str(p?.CFBundleIdentifier);
  if (!bundleId) throw badIpa("That IPA's app has no bundle ID (CFBundleIdentifier).");
  const app = info.name.slice(0, -"Info.plist".length);
  const names = iconNames(p);
  const icons = dir.filter((e) => e.name.startsWith(app) && !e.name.slice(app.length).includes("/") && /\.png$/i.test(e.name) &&
    names.some((n) => e.name.slice(app.length).startsWith(n))).sort((a, c) => c.size - a.size);
  let icon = null;
  for (const e of icons.slice(0, 4)) {
    const png = await zipEntry(s, e, 2 * 1024 * 1024).catch(() => null);
    if (isPng(png) && !isCgBIPng(png)) { icon = pngBase64(png); break; }
  }
  return { bundleId, name: str(p.CFBundleDisplayName) || str(p.CFBundleName) || bundleId,
    version: str(p.CFBundleShortVersionString) || str(p.CFBundleVersion) || "", minimumOS: osVersion(p.MinimumOSVersion), icon };
}
