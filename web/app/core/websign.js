// F93: signing on the website, in the browser: the rules the old server signer (web/signer/, gone in 9905b05) went
// by, as pure JS for websign-job.js, which runs zsign (web/app/vendor/zsign, WebAssembly) in a Web Worker.
//
//   profileInfo(bytes)                      { appId, teamId, entitlements } from a .mobileprovision
//   targetBundleId(appId, bundleId)         the ID the app is signed as (a com.you.* profile signs any app)
//   signingIds(appId, bundleId, { keep })   F237: Info.plist's ID and the entitlements' (Keep Bundle IDs)
//   appEntitlements(info, bundleId, keptId) the profile's entitlements narrowed to that app (Xcode's way), its
//                                           keychain group named after its own ID (keychainGroups)
//   plistXml(value)                         an XML plist (dict, array, string, integer, real, bool, data, date)
//   identityPlist({ p12, password, profile })   iFizBox's own IPA's ifizbox-identity.plist (native BundledIdentity)
//   zsignArgs({ ... })                      zsign's command line in the worker's in-memory files
//   zsignError(lines)                       the line of zsign's output that says what went wrong
//   appInfo(plist)                          { bundleId, name, version } from an app's Info.plist (as JSON)
//   isZip(bytes)                            starts with PK (an IPA is a zip)
//   WEB_SIGNER_VERSION, webSignerStamp, groupFixHash, signatureEnd   F342: the signer stamp and end a record keeps
// SPDX-License-Identifier: GPL-3.0-or-later
import { parsePlist, parseProfile } from "./signing.js";

export const IPA_MAX = 512 * 1024 * 1024; // the Worker's own cap (worker/src/index.js MAX_UPLOAD)

// F257: the biggest app the website signs, and the words every message uses for it. core/myipas.js SITE_FILE_MAX is
// the same number. An app's listed size (AltStore versions[].size) is checked against it before anything downloads.
//   siteMB(bytes)            whole MB, as the messages show them
//   overSiteLimit(size)      true for a listed size past IPA_MAX (false when unknown)
//   SITE_LIMIT_TEXT          "The website signs apps up to 512 MB."
export const siteMB = (n) => Math.round(Number(n) / 1048576);
export const SITE_LIMIT_TEXT = `The website signs apps up to ${siteMB(IPA_MAX)} MB.`;
export const overSiteLimit = (size, max = IPA_MAX) => Number.isFinite(Number(size)) && Number(size) > max;

// F261: what this browser learnt about its own memory. zsign holds the IPA, the unpacked app and the signed output at
// once, so how big an app a phone can sign depends on its RAM (an iPhone 7, 2 GB: 70 MB signs, 100 MB mostly runs out;
// an 8 GB phone far more), and Safari has no navigator.deviceMemory and the same screen and UA for 2-4 GB models. So
// IPA_MAX stays the one global cap, and each browser remembers the smallest IPA that ran zsign out of memory: an app
// listed at that size or more opens the Too Big alert (with Try Anyway) instead of failing again. An IPA that size or
// bigger that then signs forgets it (the failure was the phone's memory at that moment).
//   memoryLimit(storage)                 bytes of the smallest IPA that ran out of memory here, or null
//   noteOutOfMemory(storage, bytes)      remember one (keeps the smaller)
//   noteSigned(storage, bytes)           an IPA that signed: forget a limit at or under its size
//   overMemoryLimit(size, storage)       a listed size at or past that limit (false when unknown or none)
//   isOutOfMemory(message)               zsign's error was memory (websign-job.js zsignCrash)
export const MEMORY_KEY = "ifizbox.signMemory";
const positive = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Math.round(Number(n)) : null);
export function memoryLimit(storage) {
  try { return positive(JSON.parse(storage?.getItem?.(MEMORY_KEY) ?? "null")?.failed); } catch { return null; }
}
export function noteOutOfMemory(storage, bytes) {
  const n = positive(bytes);
  if (!n) return memoryLimit(storage);
  const was = memoryLimit(storage);
  const failed = was ? Math.min(was, n) : n;
  try { storage?.setItem?.(MEMORY_KEY, JSON.stringify({ failed })); } catch { /* private mode */ }
  return memoryLimit(storage);
}
export function noteSigned(storage, bytes) {
  const n = positive(bytes), was = memoryLimit(storage);
  if (n && was && n >= was) { try { storage?.removeItem?.(MEMORY_KEY); } catch { /* private mode */ } return null; }
  return was;
}
export function overMemoryLimit(size, storage) {
  const n = positive(size), lim = memoryLimit(storage);
  return Boolean(n && lim && n >= lim);
}
export const isOutOfMemory = (message) => /out of memory/i.test(String(message ?? ""));
export const IFIZBOX_ID = "com.ryha.ifizbox";
export const IDENTITY_FILE = "ifizbox-identity.plist";
export const TRANSFER_FILE = "web/transfer.link";

const utf8 = (b) => new TextDecoder().decode(b);

function find(b, text, from = 0, back = false) {
  const n = new TextEncoder().encode(text);
  for (let i = back ? b.length - n.length : from; back ? i >= 0 : i <= b.length - n.length; i += back ? -1 : 1) {
    let j = 0;
    while (j < n.length && b[i + j] === n[j]) j++;
    if (j === n.length) return i;
  }
  return -1;
}

export function profileInfo(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const start = find(b, "<?xml"), end = find(b, "</plist>", 0, true);
  if (start < 0 || end < start) throw new Error("That file is not a provisioning profile (.mobileprovision).");
  const p = parsePlist(utf8(b.subarray(start, end + 8)));
  const ent = p.Entitlements && typeof p.Entitlements === "object" ? p.Entitlements : {};
  const teamId = (p.TeamIdentifier ?? [])[0] ?? ent["com.apple.developer.team-identifier"] ?? null;
  const full = String(ent["application-identifier"] ?? "");
  const prefix = [...(p.ApplicationIdentifierPrefix ?? []), teamId].find((x) => x && full.startsWith(x + "."));
  const push = typeof ent["aps-environment"] === "string" && ent["aps-environment"] ? ent["aps-environment"] : null;
  return { appId: prefix ? full.slice(prefix.length + 1) : full, teamId, entitlements: ent, push };
}

// F237 (R25): the IDs an app is signed with. keep (Keep Bundle IDs, the default): Info.plist and the code signature
// keep the app's own ID, so zsign gets no -b, and only the entitlements carry the profile's App ID (explicit, or the
// wildcard narrowed: targetBundleId). Off: the old way, the app becomes a copy under the profile's ID.
//   -> { bundleId (Info.plist), entitlementsId (appEntitlements' ID) }
export function signingIds(appId, bundleId, { keep = true } = {}) {
  const entitlementsId = targetBundleId(appId, bundleId);
  return { bundleId: keep ? bundleId : entitlementsId, entitlementsId };
}

// A full wildcard ("*") keeps the app's own ID. A prefix wildcard (com.you.*) keeps it if it fits, and otherwise
// signs the app under the profile's prefix with the last part of its own ID (io.github.fizl0.openmx ->
// com.you.openmx), so a personal profile signs any app; the same app always gets the same ID, so updates replace
// it. An explicit profile signs it as the profile's ID.
export function targetBundleId(appId, bundleId) {
  if (appId === "*") return bundleId;
  if (appId.endsWith(".*")) {
    const prefix = appId.slice(0, -1);
    return bundleId.startsWith(prefix) ? bundleId : prefix + bundleId.split(".").pop();
  }
  if (!appId) throw Object.assign(new Error("The provisioning profile has no app ID."), { code: "bad_profile" });
  return appId;
}

// zsign would otherwise copy a wildcard profile's application-identifier (TEAM.com.you.*) and keychain group into
// the app verbatim, and iOS then refuses it ("Unable to Install"). Never debuggable (get-task-allow false).
// The keychain group comes first from the app's own ID (keptId, Info.plist's: TEAM.com.burbn.instagram), when the
// profile's keychain groups allow it (TEAM.* does): an explicit profile signs every app under one App ID, and a
// group named after that ID was one keychain shared by all of them (one app clearing its items cleared the others').
// Keychain items go to the first group, the app's alone, under any profile or certificate of the same team.
// TEAM.<App ID> stays second, so items an earlier signature put there are still the app's.
export function appEntitlements({ entitlements = {}, teamId = null }, bundleId, keptId = bundleId) {
  const ents = { ...entitlements };
  const team = ents["com.apple.developer.team-identifier"] || teamId;
  if (team) {
    ents["application-identifier"] = `${team}.${bundleId}`;
    if ("keychain-access-groups" in ents) ents["keychain-access-groups"] = keychainGroups(ents["keychain-access-groups"], team, bundleId, keptId);
  }
  ents["get-task-allow"] = false;
  return ents;
}

// [TEAM.keptId, TEAM.bundleId] (once when they're the same), the first only when the profile's groups allow it.
export function keychainGroups(allowed, team, bundleId, keptId = bundleId) {
  const ok = (g) => (Array.isArray(allowed) ? allowed : []).some((p) => typeof p === "string" && (p === g || (p.endsWith("*") && g.startsWith(p.slice(0, -1)))));
  const own = `${team}.${keptId}`, app = `${team}.${bundleId}`;
  return own !== app && ok(own) ? [own, app] : [app];
}

// B327: the sign log's keychain line for appEntitlements' result: the groups in order (new items go to the first) and
// the application-identifier. The same words as the app's signer (native/sign/Profile.swift keychainLine).
export function keychainLogLine(ents = {}) {
  const groups = (Array.isArray(ents["keychain-access-groups"]) ? ents["keychain-access-groups"] : []).filter((g) => typeof g === "string");
  return `Keychain: ${groups.length ? groups.join(", ") : "no keychain groups"} (application-identifier ${ents["application-identifier"] || "none"})`;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function b64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function plistValue(v) {
  if (v instanceof Uint8Array) return `<data>${b64(v)}</data>`;
  if (v instanceof Date) return `<date>${v.toISOString().replace(/\.\d{3}Z$/, "Z")}</date>`;
  if (Array.isArray(v)) return `<array>${v.map(plistValue).join("")}</array>`;
  if (v === true || v === false) return `<${v}/>`;
  if (typeof v === "number") return Number.isInteger(v) ? `<integer>${v}</integer>` : `<real>${v}</real>`;
  if (v && typeof v === "object") return `<dict>${Object.entries(v).map(([k, x]) => `<key>${esc(k)}</key>${plistValue(x)}`).join("")}</dict>`;
  return `<string>${esc(v ?? "")}</string>`;
}
export function plistXml(value) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">${plistValue(value)}</plist>\n`;
}

export const identityPlist = ({ p12, password, profile }) => plistXml({ p12: new Uint8Array(p12), password: password ?? "", profile: new Uint8Array(profile) });

export function zsignArgs({ p12, password, profile, entitlements, bundleId = null, input, output, temp }) {
  // -z 1: fast deflate. Level 6 took most of the time for a 40 MB app in WebAssembly on a phone (user 2026-11-18).
  const a = ["-f", "-k", p12, "-p", password ?? "", "-m", profile, "-t", temp, "-z", "1", "-o", output];
  if (bundleId) a.push("-b", bundleId);
  if (entitlements) a.push("-e", entitlements);
  a.push(input);
  return a;
}

// zsign prints ">>> ..." lines (not with -q, which hides its errors too) (red ones on failure) and OpenSSL's error queue: the last ">>>" line with a failure in
// it, without colours, is the one to show.
const ANSI = /\x1b\[[0-9;]*m/g; // eslint-disable-line no-control-regex
export function zsignError(lines) {
  const clean = lines.map((l) => String(l).replace(ANSI, "").trim()).filter(Boolean);
  const said = clean.filter((l) => l.startsWith(">>>")).map((l) => l.replace(/^>+\s*/, ""));
  const why = [...said].reverse().find((l) => /fail|invalid|can't|cannot|error|not /i.test(l)) ?? said.at(-1) ?? clean.at(-1) ?? "";
  if (/Can't load p12/i.test(why)) {
    // OpenSSL's queue says which: a MAC that doesn't verify is the wrong password (the file itself read fine).
    return clean.some((l) => /mac verify failure/i.test(l)) ? "The certificate's password is wrong: it doesn't open this .p12."
      : "The certificate's password doesn't open it, or the .p12 is damaged.";
  }
  return why ? `zsign: ${why.replace(/[.!]+$/, "")}.` : "zsign stopped without saying why.";
}

export function appInfo(plist) {
  const p = plist && typeof plist === "object" ? plist : {};
  const bundleId = String(p.CFBundleIdentifier ?? "");
  if (!bundleId) throw Object.assign(new Error("That IPA's app has no bundle ID (CFBundleIdentifier)."), { code: "bad_ipa" });
  return { bundleId, name: String(p.CFBundleDisplayName || p.CFBundleName || bundleId), version: String(p.CFBundleShortVersionString || p.CFBundleVersion || "1.0") };
}

export const isZip = (b) => b?.length >= 4 && b[0] === 0x50 && b[1] === 0x4b;

// F342: which website signer made a signed app, and when its signature ends, kept on the install record
// (core/installed.js appRecord) so Installed shows its days left and Changes lists it under Needs Re-sign
// (core/signing.js needsResign, olderSigner) as the app does with native/sign/SignerStamp.swift.
//   WEB_SIGNER_VERSION        bump it by hand whenever websign-job.js's output changes in a way installed apps should get
//   groupFixHash(bytes)       the group fix dylib's hash: the first 16 hex digits of its SHA-256 (null without crypto.subtle)
//   webSignerStamp(groupFix)  { version, groupFix }: groupFix the hash when the app got the dylib, else null
//   signatureEnd(profile)     ISO date the signature ends: the profile's expiry, or its certificates' latest end when
//                             that is earlier (the signing certificate is one of them); null when unknown
// 1: own keychain group first and the group fix's own folders (B227, B211), as the app's SignerStamp 1.
export const WEB_SIGNER_VERSION = 1;
export async function groupFixHash(bytes) {
  if (!bytes?.length) return null;
  try {
    const d = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)));
    return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  } catch { return null; }
}
export const webSignerStamp = (groupFix = null) => ({ version: WEB_SIGNER_VERSION, groupFix: groupFix || null });
export function signatureEnd(profile) {
  let p;
  try { p = parseProfile(profile instanceof Uint8Array ? profile : new Uint8Array(profile)); } catch { return null; }
  const ends = (p.certs ?? []).map((c) => c?.notAfter).filter((d) => d instanceof Date && Number.isFinite(d.getTime()));
  const cert = ends.length ? new Date(Math.max(...ends.map((d) => d.getTime()))) : null;
  const prof = p.expires instanceof Date && Number.isFinite(p.expires.getTime()) ? p.expires : null;
  const end = prof && cert ? (cert < prof ? cert : prof) : prof ?? cert;
  return end ? end.toISOString() : null;
}
