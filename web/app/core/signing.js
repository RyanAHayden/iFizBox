// Signing with your own certificate (I5, F58): what Settings > Signing reads out of the files the user picks in the
// sideload app, and what its signing.* calls answer. Pure JS, no DOM: the browser parts (the bridge, the HUD) are
// signing-client.js. docs/signing.md has the whole picture.
//
//   const p = parseProfile(bytes);    // { name, teamId, teamName, appId, expires, devices, allDevices, certs: [cert…] }
//   parseCert(der);                   // { name, team, org, notBefore, notAfter }
//   await checkP12Password(bytes, pw) // true / false, or null when the file has no MAC to check against
//   summary({ profile, now })         // the rows the page shows: certificate, team, expiry, devices, problems
//
// Everything here reads bytes (Uint8Array or ArrayBuffer) and never leaves the phone.

import { DOMAIN, SIGN_HOST, NAME, BUNDLE_ID } from "../brand.js";
import { isAts, ATS_TITLE, atsText, INSECURE_IPA_ALERT, insecureText } from "./insecureipa.js"; // B104
import { signingPage } from "./signingpage.js"; // C15: the sideload build's page is Installation & Signing
import { developerModeFailure } from "./installroute.js"; // F300

const bytesOf = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));

// ---- DER ------------------------------------------------------------------------------------------------------

// One TLV at `at`: { tag, start (of the value), end, next }. Definite lengths only (DER); throws on anything else.
export function der(buf, at = 0) {
  const b = bytesOf(buf);
  if (at + 2 > b.length) throw new Error("truncated DER");
  const tag = b[at];
  if ((tag & 0x1f) === 0x1f) throw new Error("long-form DER tags are not supported");
  let len = b[at + 1];
  let start = at + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error("indefinite or huge DER length");
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + b[start + i];
    start += n;
  }
  const end = start + len;
  if (end > b.length) throw new Error("truncated DER");
  return { tag, start, end, next: end };
}

// The children of a constructed TLV.
export function children(buf, node) {
  const out = [];
  for (let at = node.start; at < node.end;) {
    const c = der(buf, at);
    out.push(c);
    at = c.next;
  }
  return out;
}

const OID = {
  cn: "2.5.4.3", ou: "2.5.4.11", o: "2.5.4.10",
  data: "1.2.840.113549.1.7.1",
  sha1: "1.3.14.3.2.26", sha256: "2.16.840.1.101.3.4.2.1", sha384: "2.16.840.1.101.3.4.2.2", sha512: "2.16.840.1.101.3.4.2.3",
};

export function oidString(buf, node) {
  const b = bytesOf(buf).subarray(node.start, node.end);
  const parts = [Math.floor(b[0] / 40), b[0] % 40];
  let v = 0;
  for (let i = 1; i < b.length; i++) {
    v = v * 128 + (b[i] & 0x7f);
    if (!(b[i] & 0x80)) { parts.push(v); v = 0; }
  }
  return parts.join(".");
}

const utf8 = (b) => new TextDecoder("utf-8").decode(b);

function derString(buf, node) {
  const b = bytesOf(buf).subarray(node.start, node.end);
  if (node.tag === 0x1e) { // BMPString
    let s = "";
    for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]);
    return s;
  }
  return utf8(b);
}

function derTime(buf, node) {
  const s = utf8(bytesOf(buf).subarray(node.start, node.end));
  const m = node.tag === 0x17 ? /^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?Z$/.exec(s) : /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?(?:\.\d+)?Z$/.exec(s);
  if (!m) return null;
  let year = Number(m[1]);
  if (node.tag === 0x17) year += year < 50 ? 2000 : 1900; // RFC 5280: UTCTime YY >= 50 is 19YY
  return new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0)));
}

function nameAttrs(buf, node) {
  const out = {};
  for (const set of children(buf, node)) {
    for (const atv of children(buf, set)) {
      const [oid, value] = children(buf, atv);
      const key = oidString(buf, oid);
      if (!(key in out)) out[key] = derString(buf, value);
    }
  }
  return out;
}

// An X.509 certificate (DER): the subject's name, team (OU) and organisation, and its validity.
export function parseCert(buf) {
  const b = bytesOf(buf);
  const cert = der(b, 0);
  const [tbs] = children(b, cert);
  let f = children(b, tbs);
  if (f[0].tag === 0xa0) f = f.slice(1); // [0] version
  const [, , , validity, subject] = f;   // serial, signature, issuer, validity, subject
  const [nb, na] = children(b, validity);
  const s = nameAttrs(b, subject);
  return { name: s[OID.cn] ?? null, team: s[OID.ou] ?? null, org: s[OID.o] ?? null, notBefore: derTime(b, nb), notAfter: derTime(b, na) };
}

// ---- plist (XML) ----------------------------------------------------------------------------------------------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescape = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e] ?? m);

function base64Bytes(s) {
  const clean = s.replace(/\s+/g, "");
  if (typeof atob === "function") return Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
  return new Uint8Array(Buffer.from(clean, "base64"));
}

// A plist's XML (Apple's DTD: dict, array, key, string, data, date, integer, real, true, false) as JS values:
// <data> as Uint8Array, <date> as Date.
export function parsePlist(xml) {
  const re = /<(\/?)([a-zA-Z]+)(?:\s[^>]*?)?\s*(\/?)>|<\?[^>]*\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>/g;
  const tokens = [];
  let last = 0;
  for (let m; (m = re.exec(xml));) {
    if (m[2]) tokens.push({ close: !!m[1], name: m[2], empty: !!m[3], text: xml.slice(last, m.index) });
    last = re.lastIndex;
  }
  let i = 0;
  const expectClose = (name) => {
    const t = tokens[i++];
    if (!t || !t.close || t.name !== name) throw new Error(`plist: expected </${name}>`);
    return t.text;
  };
  const value = () => {
    const t = tokens[i++];
    if (!t || t.close) throw new Error("plist: unexpected end");
    switch (t.name) {
      case "dict": {
        const o = {};
        if (t.empty) return o;
        while (tokens[i] && !(tokens[i].close && tokens[i].name === "dict")) {
          const k = tokens[i++];
          if (k.name !== "key") throw new Error("plist: dict without key");
          const key = unescape(k.empty ? "" : expectClose("key"));
          o[key] = value();
        }
        expectClose("dict");
        return o;
      }
      case "array": {
        const a = [];
        if (t.empty) return a;
        while (tokens[i] && !(tokens[i].close && tokens[i].name === "array")) a.push(value());
        expectClose("array");
        return a;
      }
      case "true": case "false":
        if (!t.empty) expectClose(t.name);
        return t.name === "true";
      case "string": return t.empty ? "" : unescape(expectClose("string"));
      case "integer": return Number(expectClose("integer").trim());
      case "real": return Number(expectClose("real").trim());
      case "date": return new Date(expectClose("date").trim());
      case "data": return t.empty ? new Uint8Array(0) : base64Bytes(expectClose("data"));
      case "plist": {
        const v = value();
        expectClose("plist");
        return v;
      }
      default: throw new Error(`plist: unknown <${t.name}>`);
    }
  };
  while (tokens[i] && tokens[i].name !== "plist") i++;
  if (!tokens[i]) throw new Error("plist: no <plist>");
  return value();
}

// ---- the provisioning profile ---------------------------------------------------------------------------------

function indexOf(b, needle, from = 0, back = false) {
  const n = new TextEncoder().encode(needle);
  const step = back ? -1 : 1;
  for (let i = back ? b.length - n.length : from; back ? i >= 0 : i <= b.length - n.length; i += step) {
    let ok = true;
    for (let j = 0; j < n.length && ok; j++) ok = b[i + j] === n[j];
    if (ok) return i;
  }
  return -1;
}

// A .mobileprovision is a CMS-signed XML plist; the plist sits in it as plain bytes.
export function parseProfile(buf) {
  const b = bytesOf(buf);
  const start = indexOf(b, "<?xml");
  const end = indexOf(b, "</plist>", 0, true);
  if (start < 0 || end < start) throw new Error("That file is not a provisioning profile (.mobileprovision).");
  const p = parsePlist(utf8(b.subarray(start, end + "</plist>".length)));
  const ent = p.Entitlements && typeof p.Entitlements === "object" ? p.Entitlements : {};
  const teamId = (p.TeamIdentifier ?? [])[0] ?? ent["com.apple.developer.team-identifier"] ?? null;
  const full = String(ent["application-identifier"] ?? "");
  const prefix = [...(p.ApplicationIdentifierPrefix ?? []), teamId].find((x) => x && full.startsWith(x + "."));
  const certs = [];
  for (const d of p.DeveloperCertificates ?? []) {
    try { certs.push(parseCert(d)); } catch { /* a certificate we can't read: the server still checks it */ }
  }
  return {
    name: p.Name ?? null,
    teamId,
    teamName: p.TeamName ?? null,
    appId: prefix ? full.slice(prefix.length + 1) : full,
    created: p.CreationDate instanceof Date ? p.CreationDate : null,
    expires: p.ExpirationDate instanceof Date ? p.ExpirationDate : null,
    devices: (p.ProvisionedDevices ?? []).length,
    udids: Array.isArray(p.ProvisionedDevices) ? p.ProvisionedDevices.map(String) : [], // F236
    allDevices: p.ProvisionsAllDevices === true,
    getTaskAllow: ent["get-task-allow"] === true,
    push: typeof ent["aps-environment"] === "string" && ent["aps-environment"] ? ent["aps-environment"] : null, // F237
    certs,
  };
}

// What kind of profile: Development (get-task-allow), Ad Hoc (a device list), Enterprise (every device).
export function profileKind(p) {
  if (p.allDevices) return "Enterprise";
  if (p.getTaskAllow) return "Development";
  return p.devices ? "Ad Hoc" : "Distribution";
}

// ---- the .p12's password --------------------------------------------------------------------------------------

const HASHES = {
  [OID.sha1]: { name: "SHA-1", u: 20, v: 64 }, [OID.sha256]: { name: "SHA-256", u: 32, v: 64 },
  [OID.sha384]: { name: "SHA-384", u: 48, v: 128 }, [OID.sha512]: { name: "SHA-512", u: 64, v: 128 },
};

// RFC 7292 B.1: the password as a BMPString with its two-byte terminator; no password is no bytes at all.
export function bmpPassword(pw) {
  if (pw == null) return new Uint8Array(0);
  const out = new Uint8Array((pw.length + 1) * 2);
  for (let i = 0; i < pw.length; i++) { out[2 * i] = pw.charCodeAt(i) >> 8; out[2 * i + 1] = pw.charCodeAt(i) & 0xff; }
  return out;
}

// RFC 7292 B.2: PKCS#12's own key derivation (id 3: the MAC key), with WebCrypto's digest.
export async function pkcs12Kdf(subtle, hash, password, salt, iterations, id, n) {
  const { name, u, v } = hash;
  const fill = (src, len) => { const o = new Uint8Array(len); for (let i = 0; i < len; i++) o[i] = src[i % src.length]; return o; };
  const S = salt.length ? fill(salt, v * Math.ceil(salt.length / v)) : new Uint8Array(0);
  const P = password.length ? fill(password, v * Math.ceil(password.length / v)) : new Uint8Array(0);
  const I = new Uint8Array(S.length + P.length);
  I.set(S); I.set(P, S.length);
  const D = new Uint8Array(v).fill(id);
  const out = new Uint8Array(n);
  for (let done = 0; done < n;) {
    let A = new Uint8Array(D.length + I.length);
    A.set(D); A.set(I, D.length);
    for (let r = 0; r < iterations; r++) A = new Uint8Array(await subtle.digest(name, A));
    out.set(A.subarray(0, Math.min(u, n - done)), done);
    done += u;
    if (done >= n) break;
    const B = fill(A, v);
    for (let j = 0; j < I.length; j += v) { // I_j = (I_j + B + 1) mod 2^(8v)
      let carry = 1;
      for (let k = v - 1; k >= 0; k--) {
        const x = I[j + k] + B[k] + carry;
        I[j + k] = x & 0xff;
        carry = x >> 8;
      }
    }
  }
  return out;
}

// Does `password` open this .p12? Checks the file's MAC (every PKCS#12 that has a password has one), so it works
// whatever the file encrypts with. True or false; null when the file has no MAC or can't be read here.
export async function checkP12Password(buf, password, subtle = globalThis.crypto?.subtle) {
  const b = bytesOf(buf);
  let pfx, authSafe, mac;
  try {
    pfx = children(b, der(b, 0));
    [, authSafe, mac] = pfx;
  } catch { return null; }
  if (!mac || !subtle) return null;
  try {
    const [ctype, wrapped] = children(b, authSafe);
    if (oidString(b, ctype) !== OID.data) return null; // public-key integrity mode: nothing to check here
    const octets = children(b, wrapped)[0];
    if (octets.tag !== 0x04) return null; // a constructed (BER) OCTET STRING: leave it to the server
    const content = b.subarray(octets.start, octets.end);
    const [digestInfo, saltNode, iterNode] = children(b, mac);
    const [algId, digest] = children(b, digestInfo);
    const hash = HASHES[oidString(b, children(b, algId)[0])];
    if (!hash) return null;
    const salt = b.slice(saltNode.start, saltNode.end);
    let iterations = 1;
    if (iterNode) { iterations = 0; for (let i = iterNode.start; i < iterNode.end; i++) iterations = iterations * 256 + b[i]; }
    if (iterations < 1 || iterations > 10_000_000) return null;
    const expected = b.subarray(digest.start, digest.end);
    // An empty password is ambiguous (no bytes, or just the terminator): either opening it counts.
    for (const pw of password ? [bmpPassword(password)] : [bmpPassword(""), new Uint8Array(0)]) {
      const key = await pkcs12Kdf(subtle, hash, pw, salt, iterations, 3, hash.u);
      const k = await subtle.importKey("raw", key, { name: "HMAC", hash: hash.name }, false, ["sign"]);
      const got = new Uint8Array(await subtle.sign("HMAC", k, content));
      if (got.length === expected.length && got.every((x, i) => x === expected[i])) return true;
    }
    return false;
  } catch { return null; }
}

// ---- what the page shows --------------------------------------------------------------------------------------

// The app signs on the phone and needs only manifests and iFizBox's update hand-off: the Cloudflare Worker (worker/).
// B22: from brand.js (the old domain's sign host no longer resolves).
export const APP_SERVER = `https://${SIGN_HOST}`;
// The website itself (its own signer before F89, gone with its server): a saved one means the default now.
export const LEGACY_SERVER = `https://${DOMAIN}`;

// A typed server address as a base URL: "sign.example.org" -> "https://sign.example.org". Null when unusable.
export function normalizeServer(s) {
  let t = String(s ?? "").trim();
  if (!t) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) t = "https://" + t;
  try {
    const u = new URL(t);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password || u.search || u.hash) return null;
    return (u.origin + u.pathname).replace(/\/+$/, "");
  } catch { return null; }
}

const fmtDate = (d, locale, timeZone) => (d ? d.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric", timeZone }) : "Unknown");

// The profile's certificate: the one whose team is the profile's, first. A profile can list several (a team's
// developers); the server checks the .p12's is among them.
export function profileCert(p) {
  return p.certs.find((c) => c.team && c.team === p.teamId) ?? p.certs[0] ?? null;
}

// The Signing page's facts and problems for a saved identity: { rows: [{label, detail}], problems: [text] }.
// `password`: the one typed or read, when the caller has it. A .p12 checked with no password ("" or null) isn't
// called wrong: the Password group's footer asks for one instead.
export function summary({ profile, passwordOk = null, password, now = new Date(), locale, timeZone } = {}) {
  const rows = [];
  const problems = [];
  if (!profile) return { rows, problems };
  const cert = profileCert(profile);
  rows.push({ label: "Certificate", detail: cert?.name ?? "Unknown" });
  rows.push({ label: "Team", detail: [profile.teamName, profile.teamId && `(${profile.teamId})`].filter(Boolean).join(" ") || "Unknown" });
  if (cert?.notAfter) rows.push({ label: "Certificate Expires", detail: fmtDate(cert.notAfter, locale, timeZone) });
  rows.push({ label: "Profile Expires", detail: fmtDate(profile.expires, locale, timeZone) });
  rows.push({ label: "Devices", detail: profile.allDevices ? "All" : String(profile.devices) });
  rows.push({ label: "App ID", detail: profile.appId || "Unknown" });
  if (profile.certs.length > 1) rows.push({ label: "Certificates in Profile", detail: String(profile.certs.length) });
  if (cert?.notAfter && cert.notAfter < now) problems.push(`The certificate expired on ${fmtDate(cert.notAfter, locale, timeZone)}.`);
  if (profile.expires && profile.expires < now) problems.push(`The provisioning profile expired on ${fmtDate(profile.expires, locale, timeZone)}.`);
  if (passwordOk === false && (password === undefined || password)) problems.push("The certificate's password is wrong.");
  return { rows, problems };
}

// ---- bytes for the bridge ---------------------------------------------------------------------------------------

export function toBase64(buf) {
  const b = bytesOf(buf);
  if (typeof btoa !== "function") return Buffer.from(b).toString("base64");
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---- on the phone (F58: the sideload build's Settings > Signing and Install, through I6's signing.* calls) -------

const isoDate = (s) => { const d = s ? new Date(s) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };

// signing.status's identity as the Signing page's rows and problems, in the shape summary() answers:
// { rows: [{label, detail}], problems: [text] }. `identity` is { name, team, expires, profile: { name, team, appId,
// devices, wildcard, expires, problem } } or null (nothing in the Keychain: no rows).
export function deviceSummary(identity, { now = new Date(), locale, timeZone } = {}) {
  const rows = [];
  const problems = [];
  if (!identity) return { rows, problems };
  const certExpires = isoDate(identity.expires);
  const p = identity.profile ?? null;
  const profExpires = isoDate(p?.expires);
  rows.push({ label: "Certificate", detail: identity.name || "Unknown" });
  rows.push({ label: "Team", detail: identity.team || p?.team || "Unknown" });
  if (certExpires) rows.push({ label: "Certificate Expires", detail: fmtDate(certExpires, locale, timeZone) });
  if (p) {
    if (p.name) rows.push({ label: "Profile", detail: p.name });
    rows.push({ label: "Profile Expires", detail: fmtDate(profExpires, locale, timeZone) });
    // Bridge.swift sends the device count, or -1 / a string for a profile that lists none (enterprise: all).
    const all = p.devices === "all" || p.devices === -1 || p.devices == null;
    rows.push({ label: "Devices", detail: all ? "All" : String(p.devices) });
    rows.push({ label: "App ID", detail: p.appId || "Unknown" });
  } else {
    problems.push("No provisioning profile: choose its .mobileprovision.");
  }
  if (p?.problem) problems.push(p.problem);
  else {
    if (certExpires && certExpires < now) problems.push(`The certificate expired on ${fmtDate(certExpires, locale, timeZone)}.`);
    if (profExpires && profExpires < now) problems.push(`The provisioning profile expired on ${fmtDate(profExpires, locale, timeZone)}.`);
  }
  // F236: signing.status's profile.device (DeviceCheck.swift): whether this iPhone is in the profile, for the page.
  return { rows, problems, device: deviceCheckText(p?.device) };
}

// The HUD's text for a signing.install progress event { phase, progress }. "here": This iPhone's own install (AFC
// upload, then installd through LocalDevVPN, Sideload.swift installHere), with its percentage, so a page waiting
// offline at Downloading can't be taken for one waiting on the phone.
const PHASES = { downloading: "Downloading", reading: "Reading", signing: "Signing", installing: "Installing",
  here: "Installing on this iPhone" };
export function phaseLabel(ev) {
  const name = PHASES[ev?.phase];
  if (!name) return null;
  const pct = Math.round(Number(ev.progress) * 100);
  return ev.phase !== "installing" && pct > 0 && pct < 100 ? `${name} ${pct}%` : name;
}

// B262: a download's speed, bytes a second -> "21.4 MB/s" (core/downloadmeter.js's lines, the row's and the labels')
export const rateText = (rate) => `${(Math.max(0, Number(rate) || 0) / 1048576).toFixed(1)} MB/s`;

// What a failed signing call leads to, by its error code (native/Sources/SignBridge.swift): an alert's
// { title, message } and where it sends the user next ("signing": Settings > Signing's walkthrough; null: nowhere).
export function deviceError(err, name = "") {
  const code = err?.code ?? "";
  const raw = String(err?.message ?? err ?? "").trim();
  const message = raw ? raw[0].toUpperCase() + raw.slice(1) : "Something went wrong.";
  if (code === "no_server") {
    return { title: "No Signing Server", open: "signing", message: `Installing needs a Signing Server: set one in ${signingPage()}.` };
  }
  if (code === "no_identity") {
    return { title: "No Certificate", open: "signing", message: `Add your certificate and provisioning profile in ${signingPage()}.` };
  }
  if (code === "device_not_in_profile") {
    // F236: the shell checked the profile against this phone before signing (DeviceCheck.swift): its own sentence.
    return { title: "iPhone Not in Profile", open: "signing", message };
  }
  if (code === "offline") {
    // The download needs the internet (Airplane Mode, no Wi-Fi): the native text says so and what to do.
    return { title: "No Internet Connection", open: null, message };
  }
  if (code === "no_manifest") {
    // B30: the app fetched the install manifest itself before handing iOS the link (iOS shows nothing when it can't).
    // The native text names the host and why; a Signing Server set by hand may be the cause, so say where it is.
    return { title: name ? `Couldn't Install ${name}` : "Couldn't Install", open: null,
      message: `${message} Check the connection, or the Signing Server in ${signingPage()}.` };
  }
  // B104: an http link nothing asked about, and any other ATS refusal: our words, never iOS's raw sentence
  if (code === "insecure") return { title: INSECURE_IPA_ALERT.title, open: null, message: insecureText(name) };
  if (isAts(err)) return { title: ATS_TITLE, open: null, message: atsText(name) };
  const dm = developerModeFailure(err); // F300: Developer Mode has no Settings row: the failure itself says what to do
  if (dm) return { ...dm, open: null };
  return { title: name ? `Couldn't Install ${name}` : "Couldn't Install", open: null, message };
}

// ---- Before and around signing, the page's side (F68) -----------------------------------------------------------
// F14's bridge calls (native/Sources/Sideload.swift, docs/signing.md "Before and around signing (F14)") turned into
// what the sideload build's pages show and send. Pure: signing-sheet.js and screens/signed-apps.js draw them.
//
//   isCgBI(bytes)                        the IPA's icon is Apple's CgBI PNG, which a browser can't draw
//   inspectGroups(info)                  the look-first sheet's read-only groups from a signing.inspect answer
//   installParams(info, edits)           signing.install's params: the token and only the edits that change something
//   certificateWarnings(identity, now)   the red lines under Check Certificate (revoked; signature ends within 7 days)
//   resignLabel(ev)                      Re-sign All's HUD text for one progress event
//   callWithStall(native, m, p, onEvent) B65: a re-sign's bridge call that fails (and cancels) when a phase goes quiet
//   signedAppRows(installed, now)        Signed Apps' rows from signing.installed
//   syncReminder(get, call)              signing.remind {days} with Re-sign Reminder's value

// Base64 to bytes (the bridge hands the IPA's icon over as base64).
export function fromBase64(b64) {
  const bin = atob(String(b64 ?? ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// A PNG whose first chunk is CgBI (Xcode's "optimised" PNG: byte-swapped, premultiplied, no zlib header).
export function isCgBI(buf) {
  const b = bytesOf(buf);
  return b.length > 16 && b[0] === 0x89 && b[1] === 0x50 && b[12] === 0x43 && b[13] === 0x67 && b[14] === 0x42 && b[15] === 0x49;
}

const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const isoDay = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null);

// Groups for nav/ui.js grouped(): what the app is, what it asks for, what it won't get. Extensions get their own
// group (with switches) in the sheet, so they're not here; `extensions` is the list it draws them from.
export function inspectGroups(info) {
  const app = info?.app ?? {};
  const groups = [];
  const about = [
    { label: "Version", detail: String(app.version ?? "") || "Unknown" },
    { label: "Size", detail: app.size ? formatBytes(app.size) : "Unknown" },
  ];
  if (app.minimumOS) about.push({ label: "Needs iOS", detail: `${app.minimumOS} or later` });
  if (info?.profileKind) about.push({ label: "Profile", detail: info.profileKind });
  groups.push({ header: "App", rows: about });

  const perms = Array.isArray(app.permissions) ? app.permissions : [];
  groups.push({ header: "Permissions",
    rows: perms.length ? perms.map((p) => ({ label: p.label || p.key, subtitle: p.text || null })) : [{ label: "None" }],
    footer: perms.length ? "iOS asks you before the app can use these." : "The app asks for nothing iOS guards." });

  const ents = Object.keys(app.entitlements ?? {}).sort();
  const missing = new Set(Array.isArray(info?.missing) ? info.missing : []);
  groups.push({ header: "Entitlements",
    rows: ents.length ? ents.map((k) => ({ label: entitlementName(k), subtitle: k === entitlementName(k) ? null : k,
      detail: missing.has(k) ? "Missing" : null })) : [{ label: "None" }],
    footer: ents.length ? "What the app's own signature asks of iOS." : "The app isn't signed, or asks for nothing." });

  if (missing.size) {
    groups.push({ header: "Your Profile Can't Give It",
      rows: [...missing].sort().map((k) => ({ label: entitlementName(k), subtitle: k === entitlementName(k) ? null : k })),
      footer: `Signed with your profile, the app goes without ${missing.size === 1 ? "this" : "these"}: what needs ${missing.size === 1 ? "it" : "them"} (push, iCloud, app groups…) may not work.` });
  }
  return groups;
}

// Short names for the entitlements people meet most; anything else shows as its key.
const ENTITLEMENT_NAMES = {
  "aps-environment": "Push Notifications",
  "com.apple.developer.icloud-container-identifiers": "iCloud Containers",
  "com.apple.developer.icloud-services": "iCloud",
  "com.apple.developer.ubiquity-kvstore-identifier": "iCloud Key-Value Store",
  "com.apple.developer.ubiquity-container-identifiers": "iCloud Documents",
  "com.apple.security.application-groups": "App Groups",
  "com.apple.developer.associated-domains": "Associated Domains",
  "com.apple.developer.healthkit": "HealthKit",
  "com.apple.developer.homekit": "HomeKit",
  "com.apple.developer.siri": "Siri",
  "com.apple.developer.networking.networkextension": "Network Extensions",
  "com.apple.developer.networking.wifi-info": "Wi-Fi Info",
  "com.apple.developer.applesignin": "Sign in with Apple",
  "com.apple.developer.in-app-payments": "Apple Pay",
  "com.apple.developer.game-center": "Game Center",
  "com.apple.developer.kernel.increased-memory-limit": "Increased Memory Limit",
  "com.apple.developer.kernel.extended-virtual-addressing": "Extended Virtual Addressing",
  "keychain-access-groups": "Keychain Sharing",
  "get-task-allow": "Debugging",
  "application-identifier": "App ID",
  "com.apple.developer.team-identifier": "Team ID",
};
export const entitlementName = (k) => ENTITLEMENT_NAMES[k] ?? k;

function formatBytes(n) {
  const v = Number(n);
  if (!(v > 0)) return "Unknown";
  if (v < 1024 * 1024) return `${Math.max(1, Math.round(v / 1024))} KB`;
  return `${(v / 1024 / 1024).toFixed(v < 100 * 1024 * 1024 ? 1 : 0)} MB`;
}

// signing.install's params from the inspect answer and the sheet's edits { name, bundleId, icon (base64 PNG),
// removeExtensions: [path] }. Only what differs goes: a name or ID left as it was is not sent, so the signer keeps
// I5's own rules for the ID (an explicit profile still signs as its own). Throws a message for an ID the signer
// would refuse anyway (SignOptions.validBundleID), so the sheet can say so before anything is signed.
export function installParams(info, edits = {}) {
  if (!info?.token) throw new Error("The app wasn't looked at first.");
  const app = info.app ?? {};
  const p = { token: info.token };
  const name = String(edits.name ?? "").trim();
  if (name && name !== app.name) p.name = name;
  const id = String(edits.bundleId ?? "").trim();
  // F237: the sheet's Keep Bundle ID switch always goes (it wins over the global setting); the ID it compares with
  // is what that choice signs as.
  if (typeof edits.keepBundleId === "boolean") p.keepBundleId = edits.keepBundleId;
  if (id && id !== signsAsFor(info, p.keepBundleId)) {
    if (!validBundleId(id)) throw new Error(`"${id}" isn't a bundle ID (letters, digits, - and ., like com.you.app).`);
    p.bundleId = id;
  }
  if (typeof edits.icon === "string" && edits.icon) p.icon = edits.icon;
  const known = new Set((app.extensions ?? []).map((e) => e.path));
  const drop = [...new Set(edits.removeExtensions ?? [])].filter((x) => known.has(x)).sort();
  if (drop.length) p.removeExtensions = drop;
  // F288: tweaks, already prepared on the page (core/tweaks.js tweakParams: { files, inject, names })
  if (edits.tweaks?.files?.length) p.tweaks = edits.tweaks;
  return p;
}

// The signer's rule (native/sign/SignOptions.swift validBundleID).
export function validBundleId(s) {
  const v = String(s ?? "");
  return v.length > 0 && v.length <= 155 && !v.startsWith(".") && !v.endsWith(".") && !v.includes("..") && /^[A-Za-z0-9.-]+$/.test(v);
}

// The bundle ID iOS will know the app by, for signing.progress: what signing.install answered, else what was asked
// or what inspect said it would sign as.
export const installedId = (result, params, info) => result?.bundleId || params?.bundleId || signsAsFor(info, params?.keepBundleId) || "";

// F237: what signing.inspect's app signs as with Keep Bundle IDs `keep` (undefined: as inspect answered, signsAs).
// Kept: its own ID. Not: the profile's (appIdAs; an older shell's signsAs was always that).
export function signsAsFor(info, keep) {
  const own = info?.app?.bundleId;
  if (keep === true) return own || info?.signsAs || "";
  if (keep === false) return info?.appIdAs || info?.signsAs || own || "";
  return info?.signsAs || own || "";
}

const DAY = 24 * 60 * 60 * 1000;

// The red warnings Settings > Signing shows under Check Certificate, from signing.status's identity:
// revocation { status, revokedAt? } (the last OCSP answer) and signatureExpires (ISO; the earlier of the
// certificate's and the profile's end). [] when nothing is wrong (or nothing is known).
export function certificateWarnings(identity, now = new Date()) {
  const out = [];
  const rev = identity?.revocation;
  if (rev?.status === "revoked") {
    const day = isoDay(new Date(rev.revokedAt ?? ""));
    out.push(`Apple has revoked this certificate${day ? ` (${day})` : ""}. Apps signed with it won't open; you need a new certificate.`);
  }
  const ends = identity?.signatureExpires ? new Date(identity.signatureExpires) : null;
  if (ends && !Number.isNaN(ends.getTime())) {
    const left = ends.getTime() - now.getTime();
    if (left <= 0) out.push(`Signatures made now are already expired (${isoDay(ends)}): renew the certificate or profile.`);
    else if (left < 7 * DAY) {
      const days = Math.floor(left / DAY);
      out.push(`Signatures end ${days < 1 ? "within a day" : `in ${plural(days, "day")}`} (${isoDay(ends)}), when the certificate or profile does. Renew it soon.`);
    }
  }
  return out;
}

// The Check Certificate row's detail.
export function revocationLabel(rev) {
  return { good: "Good", revoked: "Revoked", unknown: "Unknown" }[rev?.status] ?? "Not Checked";
}

// Re-sign All's HUD text for a stream event { index, count, name, phase, progress }.
export function resignLabel(ev) {
  if (!ev || ev.count == null) return null;
  const which = `${ev.name || "App"} (${Number(ev.index) + 1} of ${ev.count})`;
  return `${phaseLabel(ev) ?? "Re-signing"} ${which}`;
}

// B65: a re-sign's phases before iOS's install (downloading, reading, signing) each send progress as they go (the
// signer at least once per bundle and per loose Mach-O). One that sends nothing for STALL_LIMIT has stopped: the call
// is cancelled (signing.cancel) and fails with where it stopped, instead of a page left at "Signing 50%" for ever.
// iOS's own install ("installing") has the shell's 15-minute limit (Sideload.swift serveChecked), so it isn't timed here.
export const STALL_LIMIT = 180_000;

// The failure's text for the last progress event seen (null: none came).
export function stallMessage(ev, limit = STALL_LIMIT) {
  const mins = Math.round(limit / 60_000);
  const span = mins >= 1 ? `${mins} minute${mins === 1 ? "" : "s"}` : `${Math.round(limit / 1000)} seconds`;
  const where = phaseLabel(ev) ?? "the start";
  const who = ev?.name ? `${ev.name} stopped` : "Re-signing stopped";
  return `${who} at ${where}: nothing moved for ${span}, so it was cancelled.`;
}

// native.call(method, params, onEvent) with the stall limit: resolves or rejects as the call does, or rejects with
// { code: "stalled", message: stallMessage(...) } once a phase before "installing" goes quiet for `limit` ms (then
// native.call("signing.cancel") stops the shell's job). Events after that are dropped.
export function callWithStall(native, method, params, onEvent = () => {}, { limit = STALL_LIMIT, later = setTimeout, clear = clearTimeout } = {}) {
  native = loggedBridge(native); // F361: the re-sign's lines in Console Logs
  return new Promise((resolve, reject) => {
    let over = false;
    let timer = null;
    let last = null;
    const stop = () => { if (timer != null) clear(timer); timer = null; };
    const arm = () => {
      stop();
      timer = later(() => {
        if (over) return;
        over = true;
        timer = null;
        Promise.resolve().then(() => native.call("signing.cancel", {})).catch(() => {});
        const e = new Error(stallMessage(last, limit));
        e.code = "stalled";
        reject(e);
      }, limit);
    };
    arm();
    Promise.resolve().then(() => native.call(method, params, (ev) => {
      if (over) return;
      if (ev?.phase) {
        last = ev;
        if (ev.phase === "installing") stop(); else arm();
      }
      onEvent(ev);
    })).then((r) => { if (!over) { over = true; stop(); resolve(r); } },
      (e) => { if (!over) { over = true; stop(); reject(e); } });
  });
}

// ---- F361: sideload runs in Settings > Console Logs ---------------------------------------------------------
//
// Every bridge call that signs or installs an app is kept as a console log from its first event: the shell's log
// lines ({ log }, Sideload.swift / MyIPAs.swift / SignAhead.swift log?) and each new phase ({ phase }, step?) as it
// comes, then Completed, Failed or Cancelled when the call ends. A call cut off (the app killed mid-run) is left
// running and reads Stopped after the next launch (core/queue.js runState).
//   logSideloadRuns(store)        the run log the calls go to (queue.js runLogs, set as it loads)
//   loggedBridge(native, store)   `native` with call() keeping those calls; any other call, or no store, as it was
//   sideloadRunTitle(method, params, result)   "Install Delta", "Sign Delta", "Re-sign Delta", "Re-sign All"
export const SIDELOAD_RUNS = { "signing.install": "Install", "signing.open": "Install", "library.install": "Install",
  "signing.prepare": "Sign", "library.sign": "Sign", "signing.resign": "Re-sign", "signing.resignAll": "Re-sign" };
let sideloadLogs = null;
export function logSideloadRuns(store) { sideloadLogs = store ?? null; }
const preparedNames = new Map(); // signing.prepare's token -> the app's name, for signing.open's title

const fileTitle = (s) => String(s ?? "").split(/[?#]/)[0].split("/").pop().replace(/\.ipa$/i, "");
export function sideloadRunTitle(method, params = {}, result = null) {
  const verb = SIDELOAD_RUNS[method] ?? "Run";
  if (method === "signing.resignAll") return "Re-sign All";
  const name = result?.name || params?.name || (params?.token && preparedNames.get(params.token)) || params?.bundleId ||
    result?.bundleId || fileTitle(params?.file) || fileTitle(params?.url) || "App";
  return `${verb} ${String(name).replace(/\.ipa$/i, "")}`;
}

// The line a phase event adds: its name once per phase (and per app in Re-sign All), not each percent.
function phaseLine(ev, seen) {
  const name = PHASES[ev?.phase];
  if (!name) return null;
  const key = `${ev.phase}|${ev.name ?? ""}|${ev.index ?? ""}`;
  if (seen.key === key) return null;
  seen.key = key;
  return ev.count != null ? `${name} ${ev.name || "App"} (${Number(ev.index) + 1} of ${ev.count})` : name;
}

const LOGGED = Symbol("ifizbox.loggedBridge");
export function loggedBridge(native, store = sideloadLogs) {
  if (!native || typeof native.call !== "function" || native[LOGGED] || !store?.start) return native;
  const wrapped = Object.create(native);
  wrapped[LOGGED] = true;
  wrapped.call = (method, params, onEvent) => {
    if (!SIDELOAD_RUNS[method]) return native.call(method, params, onEvent);
    let run = null;
    try { run = store.start({ title: sideloadRunTitle(method, params), jobs: [{ op: "install", id: params?.bundleId || params?.file || params?.url || method, version: null, mode: "ipa" }] }); } catch { run = null; }
    const seen = {};
    const forward = (ev) => {
      try {
        if (ev?.log) run?.line(ev.log);
        const p = phaseLine(ev, seen);
        if (p) run?.line(p);
      } catch { /* the log is a nicety */ }
      onEvent?.(ev);
    };
    let p;
    try { p = Promise.resolve(native.call(method, params, forward)); } catch (e) { p = Promise.reject(e); }
    return p.then((r) => {
      try {
        if (method === "signing.prepare" && r?.token && r?.name) preparedNames.set(r.token, r.name);
        if (r?.name || r?.bundleId) run?.set({ title: sideloadRunTitle(method, params, r) });
        run?.line(r?.cancelled ? "Cancelled" : "Done");
        run?.end(r?.cancelled ? { cancelled: true } : { code: 0 });
      } catch { /* the log is a nicety */ }
      return r;
    }, (e) => {
      try {
        const cancelled = e?.code === "cancelled";
        run?.line(cancelled ? "Cancelled" : `Error: ${e?.message || String(e)}`);
        run?.end(cancelled ? { cancelled: true } : { code: -1 });
      } catch { /* the log is a nicety */ }
      throw e;
    });
  };
  return wrapped;
}

// Signed Apps' rows from signing.installed's { apps: [{ bundleId, originalBundleId, name, version, expires }] },
// soonest to expire first.
export function signedAppRows(installed, now = new Date()) {
  const apps = Array.isArray(installed?.apps) ? installed.apps : [];
  const at = (a) => { const t = Date.parse(a.expires ?? ""); return Number.isNaN(t) ? Infinity : t; };
  return [...apps].sort((a, b) => at(a) - at(b) || String(a.name).localeCompare(String(b.name))).map((a) => {
    const t = at(a);
    const days = Math.floor((t - now.getTime()) / DAY);
    const detail = t === Infinity ? "" : t <= now.getTime() ? "Expired" : days < 1 ? "Today" : plural(days, "day");
    const sub = [a.version ? `Version ${a.version}` : null, a.bundleId].filter(Boolean).join(" · ");
    return { bundleId: a.bundleId, label: a.name || a.bundleId, subtitle: sub || null, detail, expiring: t !== Infinity && t - now.getTime() < 7 * DAY,
      name: a.name || a.bundleId, version: a.version || null }; // F91: Re-sign All queues each row (core/appqueue.js resignJob)
  });
}

// signing.remind {days} with Re-sign Reminder's value (`get` reads a setting). Resolves the bridge's answer, or null
// when there is no bridge or the call fails (an older shell without the call): the reminder is a nicety.
export async function syncReminder(get, call) {
  if (typeof call !== "function") return null;
  const days = Number(get("resignReminder"));
  try {
    return await call("signing.remind", { days: Number.isFinite(days) && days > 0 ? Math.round(days) : 0 });
  } catch {
    return null;
  }
}

// ---- Signature status and re-signs through the queue (F91) ------------------------------------------------------
//
//   resignWindow(get)                    Re-sign Reminder's days (the "resignReminder" setting; default 2, Off is 0)
//   signatureState(expires, { now, window })
//        -> { state: "ok" | "soon" | "expired", text, long, days } or null (no date): Installed's pill and the app
//           page's row. ok: outside the window (green), soon: inside it (amber), expired (red).
//   needsResign(installed, { now, window, skip })
//        -> Changes' Needs Re-sign rows from signing.installed: every app inside the window or expired, soonest first,
//           leaving out the ids in `skip` (apps with an upgrade, which re-signs them anyway); B259: also every app an
//           older signer signed (olderSigner, below; the row says so and carries olderSigner: true)
//   signedIndex(installed)               a Map from bundle ID (installed and original) to its signing.installed record

export const RESIGN_WINDOW = 2;

export function resignWindow(get) {
  let v;
  try { v = typeof get === "function" ? get("resignReminder") : undefined; } catch { v = undefined; }
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) && n >= 0 ? n : RESIGN_WINDOW;
}

export function signatureState(expires, { now = new Date(), window = RESIGN_WINDOW } = {}) {
  const t = expires instanceof Date ? expires.getTime() : Date.parse(expires ?? "");
  if (!Number.isFinite(t)) return null;
  const left = t - now.getTime();
  const days = Math.floor(left / DAY);
  if (left <= 0) return { state: "expired", text: "Expired", long: "Expired", days };
  const text = days < 1 ? "Today" : plural(days, "day");
  const long = days < 1 ? "Expires today" : `${plural(days, "day")} left`;
  return { state: left <= Math.max(0, Number(window) || 0) * DAY ? "soon" : "ok", text, long, days };
}

export function signedIndex(installed) {
  const out = new Map();
  for (const a of Array.isArray(installed?.apps) ? installed.apps : []) {
    if (!a?.bundleId) continue;
    out.set(a.bundleId, a);
    if (a.originalBundleId && !out.has(a.originalBundleId)) out.set(a.originalBundleId, a);
  }
  return out;
}

export function needsResign(installed, { now = new Date(), window = RESIGN_WINDOW, skip = new Set() } = {}) {
  const apps = Array.isArray(installed?.apps) ? installed.apps : [];
  const out = [];
  for (const a of apps) {
    if (!a?.bundleId || skip.has(a.bundleId) || (a.originalBundleId && skip.has(a.originalBundleId))) continue;
    const sig = signatureState(a.expires, { now, window });
    const old = olderSigner(a, installed?.signer);
    if (!old && (!sig || sig.state === "ok")) continue;
    const ends = sig?.state === "expired" ? "Signature expired: re-sign it to open it again"
      : sig?.state === "soon" ? `Signature ends ${sig.days < 1 ? "today" : `in ${plural(sig.days, "day")}`}` : null;
    const short = ends && old ? `${ends} · signed by an older ${NAME}` : ends ?? OLDER_SIGNER_TEXT;
    out.push({ id: a.bundleId, name: a.name || a.bundleId, version: sig?.text ?? "", installed: a.version || null, sig: sig?.state ?? null,
      short, expires: a.expires, change: "resign", ...(old ? { olderSigner: true } : {}) });
  }
  const at = (r) => { const t = Date.parse(r.expires ?? ""); return Number.isNaN(t) ? Infinity : t; };
  return out.sort((a, b) => at(a) - at(b) || String(a.name).localeCompare(String(b.name)));
}

// B259: an app signed before the signer's output last changed (B227's own keychain group, B233's group fix) keeps that
// signature until it nears its end, so Needs Re-sign also lists it. Each signing.installed record carries the stamp it
// was signed with (`signer`: { version, groupFix }, native/sign/SignerStamp.swift) and signing.installed the current
// one: a record is older when it has no stamp (signed before stamps), an earlier version, or a group fix dylib other
// than the current one. No current stamp (an older shell, the website): never. iFizBox's own record never counts: its
// re-sign is an update of the app itself, offered on its own.
//   olderSigner(record, current)   true when that record's signer is older than `current`
//   OLDER_SIGNER_TEXT              the row's line under its name
export const OLDER_SIGNER_TEXT = `Signed by an older ${NAME}: re-sign it so its data stays its own`;
export function olderSigner(record, current) {
  const cur = Number(current?.version);
  if (!Number.isFinite(cur) || !record) return false;
  if (record.bundleId === BUNDLE_ID || record.originalBundleId === BUNDLE_ID) return false;
  const s = record.signer;
  const v = Number(s?.version);
  if (!Number.isFinite(v) || v < cur) return true;
  return Boolean(s.groupFix && current.groupFix && s.groupFix !== current.groupFix);
}

// ---- F236: is this iPhone in the profile? -----------------------------------------------------------------------
// A development or ad hoc profile installs only on the devices it lists (ProvisionedDevices, by UDID); on any other
// iPhone iOS refuses the app with "integrity could not be verified", which says nothing useful. So the profile is
// checked against this phone first. The phone's UDID comes from the jailbreak build's root helper (MobileGestalt), or
// from the sideload build's own embedded.mobileprovision: one device there is this phone; several are a set it is in.
// The website can't read it at all. native/sign/DeviceCheck.swift answers the same check (and the same sentences)
// for signing.status's profile.device and before signing.
//
//   phoneFromDevices(udids)          { udid } (one), { candidates } (several) or null (none: unknown)
//   deviceCheck(profile, phone)      { state: "in" | "out" | "unknown" | "skip", udid, count, shared }
//                                    profile: parseProfile's { udids, allDevices } or { udids, devices } (-1: all)
//   deviceCheckText(check)           { ok: true | false | null, text, udid } for Settings > Signing; null for "skip"
//   notInProfileText(udid)           the sentence an install fails with when this phone isn't in the profile
//   notLandedText(app, check)        the grey help line under an IPA install's last step, when the check couldn't run

export const UDID_HOW = "To find the UDID, plug the iPhone into a Mac and click the line under its name in Finder, "
  + "or run idevice_id -l on a computer it's plugged into.";
export const IN_PROFILE_TEXT = "This iPhone is in the profile.";
export const notInProfileText = (udid) => (udid
  ? `This iPhone isn't in the profile: add its UDID ${udid} to the developer account, then make the profile again.`
  : `This iPhone isn't in the profile: add its UDID to the developer account, then make the profile again. ${UDID_HOW}`);
export const unknownDeviceText = (count) => `This iPhone's UDID can't be read here, so it can't be checked against the `
  + `profile's ${plural(count, "device")}. If installs fail with "integrity could not be verified", add the UDID to the `
  + `developer account, then make the profile again. ${UDID_HOW}`;
// UDIDs compare without case or spaces: the 40-hex ones are often written in capitals, the newer 8-16 ones in either.
export const normalUdid = (s) => String(s ?? "").trim().toUpperCase();

export function phoneFromDevices(udids) {
  const list = [...new Set((Array.isArray(udids) ? udids : []).map(normalUdid).filter(Boolean))];
  if (list.length === 1) return { udid: list[0] };
  return list.length ? { candidates: list } : null;
}

export function deviceCheck(profile, phone) {
  const udids = [...new Set((Array.isArray(profile?.udids) ? profile.udids : []).map(normalUdid).filter(Boolean))];
  const count = udids.length;
  // Enterprise (every device) and a profile with no list (App Store distribution) aren't limited by device.
  if (profile?.allDevices === true || profile?.devices === -1 || profile?.devices === "all" || !count) {
    return { state: "skip", udid: null, count, shared: 0 };
  }
  const has = new Set(udids);
  const one = phone?.udid ? normalUdid(phone.udid) : null;
  // the UDID as the phone gave it (the developer account takes it as written); compared without case
  if (one) return { state: has.has(one) ? "in" : "out", udid: String(phone.udid).trim(), count, shared: has.has(one) ? 1 : 0 };
  const set = phoneFromDevices(phone?.candidates);
  const cands = set?.udid ? [set.udid] : set?.candidates ?? [];
  if (!cands.length) return { state: "unknown", udid: null, count, shared: 0 };
  const shared = cands.filter((u) => has.has(u));
  // This phone is one of `cands`: a profile with all of them has it, one with none of them can't.
  if (shared.length === cands.length) return { state: "in", udid: cands.length === 1 ? cands[0] : null, count, shared: shared.length };
  if (!shared.length) return { state: "out", udid: null, count, shared: 0 };
  return { state: "unknown", udid: null, count, shared: shared.length };
}

export function deviceCheckText(check) {
  const c = check && typeof check === "object" ? check : null;
  if (!c || c.state === "skip") return null;
  if (c.state === "in") return { ok: true, text: IN_PROFILE_TEXT, udid: c.udid ?? null };
  if (c.state === "out") return { ok: false, text: notInProfileText(c.udid ?? null), udid: c.udid ?? null };
  return { ok: null, text: unknownDeviceText(Number(c.count) || 0), udid: null };
}

// An IPA install handed to iOS (F252): the last step says so, short; whether it lands is on the Home Screen.
export const SENT_TO_IOS = "Sent to iOS. Press Home to watch it install.";
// Where an install whose landing nobody could check (the website, where no UDID can be read; the app when its check
// came out "unknown", or "out") ends: one grey line under the last step with a Help button (nav/progress.js
// page.help) that opens Guides > FAQ > "An app won't install" (screens/guides.js APP_HELP), which explains the UDID in
// the profile. null when the profile isn't limited by device or the phone is known to be in it. `app` is unused (kept
// for the callers' shape).
export const NOT_LANDED_TEXT = "Not on the Home Screen?";
export function notLandedText(_app, check) {
  if (!check || check.state === "skip" || check.state === "in") return null;
  return NOT_LANDED_TEXT;
}

// ---- F244: Home's certificate-expiry warning (sideload build) -----------------------------------------------------
// The tile under Home's welcome while the signing certificate or the provisioning profile nears its end, whichever
// ends first (apps signed with it stop opening then).
//
//   expiryWarning(identity, { now, warn, resign, show })
//        -> null (no identity, no date, or outside the warning window) or
//           { stage: "soon" | "close" | "gone", what: "Certificate" | "Profile", days, expires, title, subtitle }
//   soon: amber, inside Expiry Warning's `warn` days; close: red tint, inside Re-sign Reminder's `resign` days (Off,
//   0, uses RESIGN_WINDOW so the tile still turns red near the end); gone: expired, solid red. `show` false (Show
//   Expiry Warning off, for people with auto-renew) hides soon and close; gone shows whatever it says.
//   expiryWarningDays(get)  Expiry Warning's days (the "expiryWarning" setting), EXPIRY_WARNING (7) when unset

export const EXPIRY_WARNING = 7;

export function expiryWarningDays(get) {
  let v;
  try { v = typeof get === "function" ? get("expiryWarning") : undefined; } catch { v = undefined; }
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) && n > 0 ? n : EXPIRY_WARNING;
}

export function expiryWarning(identity, { now = new Date(), warn = EXPIRY_WARNING, resign = RESIGN_WINDOW, show = true } = {}) {
  if (!identity || typeof identity !== "object") return null;
  const cert = isoDate(identity.expires);
  const prof = isoDate(identity.profile?.expires);
  if (!cert && !prof) return null;
  const what = prof && (!cert || prof < cert) ? "Profile" : "Certificate";
  const expires = what === "Profile" ? prof : cert;
  const left = expires.getTime() - now.getTime();
  const days = Math.floor(left / DAY);
  if (left <= 0) {
    return { stage: "gone", what, days, expires, title: `${what} Expired`, subtitle: "Apps won't open · Renew in Signing" };
  }
  if (!show) return null;
  const warnDays = Number(warn) > 0 ? Number(warn) : EXPIRY_WARNING;
  if (left > warnDays * DAY) return null;
  const red = Number(resign) > 0 ? Number(resign) : RESIGN_WINDOW;
  const stage = left <= red * DAY ? "close" : "soon";
  const when = days < 1 ? "Today" : days === 1 ? "Tomorrow" : `in ${days} Days`;
  const title = stage === "soon" ? `${what} Expires Soon` : `${what} Expires ${when}`;
  const subtitle = `${days < 1 ? "Expires today" : `Expires in ${plural(days, "day")}`} · Renew in Signing`;
  return { stage, what, days, expires, title, subtitle };
}

// F307 (concept K3, option C): Home's one signing tile, in the certificate-expiry tile's place (screens/home.js
// certRow), solid red (the expiry tile's "gone" look) for anything that stops installs:
//   signingTile({ setUp, serverUp, server, warning })  -> { stage, kind, title, subtitle } | null
// `setUp` false (no certificate or login, a half-done walkthrough included): Signing Needs Setup. Then an expired
// certificate or profile (`warning`, expiryWarning's answer). Then `serverUp` false (a Signing Server set but down
// or unreachable): Signing Server Down, naming its host. Last the amber/red expiry warning itself. null: no tile.
export const SETUP_TILE = Object.freeze({ stage: "gone", kind: "setup", title: "Signing Needs Setup", subtitle: "Nothing can be installed yet" });
export function serverDownTile(server) {
  let host = "";
  try { host = new URL(server).host; } catch { host = ""; }
  return { stage: "gone", kind: "server", title: "Signing Server Down", subtitle: host ? `Can't reach ${host} · Check in Signing` : "Can't reach it · Check in Signing" };
}
export function signingTile({ setUp = true, serverUp = true, server = null, warning = null } = {}) {
  if (!setUp) return { ...SETUP_TILE };
  if (warning?.stage === "gone") return { kind: "expiry", ...warning };
  if (serverUp === false) return serverDownTile(server);
  return warning ? { kind: "expiry", ...warning } : null;
}
