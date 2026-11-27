// Free Apple ID sign-in in the browser (the website's free route: screens/free-apple-id.js, core/freeroute.js). Pure
// JS: BigInt SRP and WebCrypto, no storage or network of its own.
//
//   Apple's sign-in (GrandSlam, gsa.apple.com): SRP-6a (s2k / s2k_fo password keys), the session data (spd), two-factor
//   (a push to trusted devices or an SMS code), and the o=apptokens call for com.apple.gs.xcode.auth (Xcode's token).
//   Anisette v3 from a public anisette server (a machine of our own; the server never sees the Apple ID).
//   Developer services (developerservices2.apple.com, Xcode's QH65B2 protocol): listTeams, the setup calls (devices,
//   development certificates and CSRs, App IDs, the team profile) and call() for anything else.
//
// The HTTP goes through `transport({ url, method, headers, body }) -> { status, headers, body: Uint8Array }`. On the
// website that's relayTransport(): the Worker's /apple/<host>/<path> relay (worker/src/apple-relay.js), because Apple
// and the anisette servers send no CORS headers. The password stays in the AppleIdSession until sign-in finishes;
// SRP runs here, so it never leaves the browser. The relay does carry the app token and developer-portal replies.
//
// Protocol details checked against isideload (MIT) and pysrp's RFC 5054 mode; written fresh. A scratch test site
// running this same code under node signed a real free Apple ID in and called the developer portal (R32).
//
//   const transport = relayTransport();
//   const anisette = anisetteV3({ transport, storage, wsUrl: relayWsUrl });
//   const s = new AppleIdSession({ transport, anisette });
//   await s.login(email, password)           -> { step: "device" | "sms" | "done" | "other", au }
//   await s.requestDeviceCode(); await s.verifyDeviceCode(code)       (trusted devices)
//   await s.trustedPhones(); await s.requestSmsCode(id); await s.verifySmsCode(id, code)
//   const { token } = await s.appToken();
//   const teams = await new DevPortal({ transport, anisette, token, adsid: s.adsid }).listTeams();
// SPDX-License-Identifier: GPL-3.0-or-later

const te = new TextEncoder(), td = new TextDecoder();
export const utf8 = (s) => te.encode(s);
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

export function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ---- base64 and property lists (XML both ways, binary read only) ----

export function b64encode(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64decode(str) {
  const bin = atob(String(str).replace(/[^A-Za-z0-9+/=]/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unesc = (s) => s.replace(/&(lt|gt|quot|apos|amp|#x[0-9a-f]+|#\d+);/gi, (m, e) => {
  const l = e.toLowerCase();
  if (l === "lt") return "<";
  if (l === "gt") return ">";
  if (l === "quot") return '"';
  if (l === "apos") return "'";
  if (l === "amp") return "&";
  return String.fromCodePoint(l[1] === "x" ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10));
});

// Values: string, integer (number or BigInt), boolean, Date, Uint8Array (<data>), Array, plain object (<dict>).
function plistValue(v, ind) {
  const pad = "\t".repeat(ind);
  if (v instanceof Uint8Array) return `${pad}<data>${b64encode(v)}</data>`;
  if (v instanceof Date) return `${pad}<date>${v.toISOString().replace(/\.\d{3}Z$/, "Z")}</date>`;
  if (Array.isArray(v)) return v.length ? `${pad}<array>\n${v.map((x) => plistValue(x, ind + 1)).join("\n")}\n${pad}</array>` : `${pad}<array/>`;
  if (typeof v === "boolean") return `${pad}<${v}/>`;
  if (typeof v === "number" || typeof v === "bigint") return `${pad}<integer>${v}</integer>`;
  if (typeof v === "string") return `${pad}<string>${esc(v)}</string>`;
  if (v && typeof v === "object") {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined);
    if (!keys.length) return `${pad}<dict/>`;
    return `${pad}<dict>\n${keys.map((k) => `${pad}\t<key>${esc(k)}</key>\n${plistValue(v[k], ind + 1)}`).join("\n")}\n${pad}</dict>`;
  }
  throw new Error(`plist: can't encode ${typeof v}`);
}

export function encodePlist(v) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${plistValue(v, 0)}\n</plist>\n`;
}

export function decodePlist(input) {
  const xml = typeof input === "string" ? input : td.decode(input);
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z]+)[^>]*?(\/?)>|([^<]+)/g;
  const toks = [];
  let m;
  while ((m = re.exec(xml))) {
    if (m[2]) toks.push({ close: !!m[1], name: m[2], empty: !!m[3] });
    else if (m[4] !== undefined) toks.push({ text: m[4] });
  }
  let i = 0;
  const skipWs = () => { while (i < toks.length && toks[i].text !== undefined && !toks[i].text.trim()) i++; };
  const textUntil = (name) => {
    let s = "";
    while (i < toks.length && !(toks[i].close && toks[i].name === name)) { if (toks[i].text !== undefined) s += toks[i].text; i++; }
    i++;
    return unesc(s);
  };
  const need = () => { if (i >= toks.length) throw new Error("plist: truncated"); return toks[i]; };
  function value(depth = 0) {
    if (depth > 64) throw new Error("plist: too deep");
    skipWs();
    const t = toks[i++];
    if (!t || t.text !== undefined || t.close) throw new Error("plist: unexpected token");
    switch (t.name) {
      case "true": if (!t.empty) i++; return true;
      case "false": if (!t.empty) i++; return false;
      case "string": return t.empty ? "" : textUntil("string");
      case "integer": { const s = textUntil("integer").trim(); const n = Number(s); return Number.isSafeInteger(n) ? n : BigInt(s); }
      case "real": return Number(textUntil("real").trim());
      case "date": return new Date(textUntil("date").trim());
      case "data": return t.empty ? new Uint8Array(0) : b64decode(textUntil("data"));
      case "array": {
        const a = [];
        if (t.empty) return a;
        for (;;) { skipWs(); if (need().close && toks[i].name === "array") { i++; return a; } a.push(value(depth + 1)); }
      }
      case "dict": {
        const d = {};
        if (t.empty) return d;
        for (;;) {
          skipWs();
          const k = need();
          if (k.close && k.name === "dict") { i++; return d; }
          if (k.name !== "key") throw new Error("plist: expected <key>");
          i++;
          d[k.empty ? "" : textUntil("key")] = value(depth + 1);
        }
      }
      case "plist": return value(depth + 1);
      default: throw new Error(`plist: unknown tag <${t.name}>`);
    }
  }
  while (i < toks.length && !(toks[i].name && !toks[i].close)) i++;
  return value();
}

export function decodeBinaryPlist(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 40 || td.decode(b.subarray(0, 8)) !== "bplist00") throw new Error("plist: not bplist00");
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const t = b.length - 32, offSize = b[t + 6], refSize = b[t + 7];
  const num = Number(dv.getBigUint64(t + 8)), top = Number(dv.getBigUint64(t + 16)), tableOff = Number(dv.getBigUint64(t + 24));
  const uint = (o, n) => { let v = 0; for (let k = 0; k < n; k++) v = v * 256 + b[o + k]; return v; };
  const offsets = Array.from({ length: num }, (_, k) => uint(tableOff + k * offSize, offSize));
  const lenAt = (o, info) => {
    if (info !== 15) return [info, o + 1];
    const n = 1 << (b[o + 1] & 15);
    return [uint(o + 2, n), o + 2 + n];
  };
  function obj(k, depth = 0) {
    if (depth > 64) throw new Error("plist: too deep");
    const o = offsets[k], m = b[o], type = m >> 4, info = m & 15;
    switch (type) {
      case 0: return info === 8 ? false : info === 9 ? true : null;
      case 1: { const n = 1 << info; if (n === 8) { const v = dv.getBigInt64(o + 1); return Number.isSafeInteger(Number(v)) ? Number(v) : v; } return uint(o + 1, n); }
      case 2: return info === 2 ? dv.getFloat32(o + 1) : dv.getFloat64(o + 1);
      case 3: return new Date(Date.UTC(2001, 0, 1) + dv.getFloat64(o + 1) * 1000);
      case 4: { const [n, s] = lenAt(o, info); return b.slice(s, s + n); }
      case 5: { const [n, s] = lenAt(o, info); return new TextDecoder("latin1").decode(b.subarray(s, s + n)); }
      case 6: { const [n, s] = lenAt(o, info); let r = ""; for (let q = 0; q < n; q++) r += String.fromCharCode(dv.getUint16(s + 2 * q)); return r; }
      case 8: return uint(o + 1, info + 1);
      case 10: { const [n, s] = lenAt(o, info); return Array.from({ length: n }, (_, q) => obj(uint(s + q * refSize, refSize), depth + 1)); }
      case 13: {
        const [n, s] = lenAt(o, info), d = {};
        for (let q = 0; q < n; q++) d[obj(uint(s + q * refSize, refSize), depth + 1)] = obj(uint(s + (n + q) * refSize, refSize), depth + 1);
        return d;
      }
      default: throw new Error(`plist: binary type ${type}`);
    }
  }
  return obj(top);
}

// Any reply body (binary plist, XML plist or JSON) -> { value, format }.
export function decodeAny(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const head = td.decode(b.subarray(0, 64)).replace(/^﻿/, "").trimStart();
  if (head.startsWith("bplist00")) return { value: decodeBinaryPlist(b), format: "bplist" };
  if (head.startsWith("{") || head.startsWith("[")) return { value: JSON.parse(td.decode(b)), format: "json" };
  return { value: decodePlist(b), format: "xml" };
}

// ---- SRP-6a, as GrandSlam runs it ----
// RFC 5054 style: k = H(N | PAD(g)), u = H(PAD(A) | PAD(B)), x = H(s | H(":" | P)) (no username in x; P is the PBKDF2
// key), S = (B - k g^x)^(a + u x), K = H(S), M1 = H(H(N) xor H(PAD(g)) | H(I) | s | A | B | K), M2 = H(A | M1 | K).
// 2048-bit group, SHA-256. Byte strings are minimal big-endian except where PAD() says otherwise.

export const N2048 = BigInt("0x" +
  "AC6BDB41324A9A9BF166DE5E1389582FAF72B6651987EE07FC3192943DB56050A37329CBB4A099ED8193E0757767A13DD52312AB4B03310D" +
  "CD7F48A9DA04FD50E8083969EDB767B0CF6095179A163AB3661A05FBD5FAAAE82918A9962F0B93B855F97993EC975EEAA80D740ADBF4FF" +
  "747359D041D5C33EA71D281E446B14773BCA97B43A23FB801676BD207A436C6481F1D2B9078717461A5B9D32E688F87748544523B524B0D5" +
  "7D5EA77A2775D2ECFA032CFBDBF52FB3786160279004E57AE6AF874E7303CE53299CCC041C7BC308D82A5698F3A8D0C38271AE35F8E9DB" +
  "FBB694B5C803D89F7AE435DE236D525F54759B65E372FCD68EF20FA7111F9E4AFF73");
export const GSA_GROUP = { N: N2048, g: 2n, hash: "SHA-256" };

export const bytesToBig = (b) => (b.length ? BigInt("0x" + hex(b)) : 0n);
export function bigToBytes(n, len = 0) {
  let h = n.toString(16);
  if (h.length % 2) h = "0" + h;
  const raw = new Uint8Array(h.length / 2);
  for (let i = 0; i < raw.length; i++) raw[i] = parseInt(h.substr(i * 2, 2), 16);
  if (len <= raw.length) return raw;
  const out = new Uint8Array(len);
  out.set(raw, len - raw.length);
  return out;
}
export function modPow(base, exp, mod) {
  let r = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) r = (r * base) % mod;
    base = (base * base) % mod;
    exp >>= 1n;
  }
  return r;
}
const digest = async (hash, ...parts) => new Uint8Array(await crypto.subtle.digest(hash, concat(...parts)));

export function newEphemeral(group = GSA_GROUP, aBytes = crypto.getRandomValues(new Uint8Array(32))) {
  const a = bytesToBig(aBytes);
  return { a, A: bigToBytes(modPow(group.g, a, group.N)) };
}

// -> { M1, M2, S (premaster, minimal bytes), K = H(S), x, u, k }. Throws on a bad B.
export async function processReply({ group = GSA_GROUP, a, username, password, salt, B, usernameInX = false }) {
  const { N, g, hash } = group;
  const nLen = bigToBytes(N).length;
  const H = (...p) => digest(hash, ...p);
  const Bn = bytesToBig(B);
  if (Bn % N === 0n) throw new Error("SRP: illegal B");
  const A = bigToBytes(modPow(g, a, N));
  const u = bytesToBig(await H(bigToBytes(bytesToBig(A), nLen), bigToBytes(Bn, nLen)));
  if (u === 0n) throw new Error("SRP: u is zero");
  const k = bytesToBig(await H(bigToBytes(N), bigToBytes(g, nLen)));
  const user = typeof username === "string" ? utf8(username) : username;
  const x = bytesToBig(await H(salt, await H(usernameInX ? user : new Uint8Array(0), utf8(":"), password)));
  let base = (Bn - ((k * modPow(g, x, N)) % N)) % N;
  if (base < 0n) base += N;
  const S = bigToBytes(modPow(base, a + u * x, N));
  const K = await H(S);
  const hN = await H(bigToBytes(N)), hg = await H(bigToBytes(g, nLen));
  const M1 = await H(hN.map((v, i) => v ^ hg[i]), await H(user), salt, A, B, K);
  const M2 = await H(A, M1, K);
  return { M1, M2, S, K, x, u, k };
}

// GrandSlam's password key: PBKDF2-HMAC-SHA256 over SHA-256(password) (s2k) or its lowercase hex (s2k_fo).
export async function gsaPasswordKey(password, salt, iterations, protocol) {
  let p = await digest("SHA-256", utf8(password));
  if (protocol === "s2k_fo") p = utf8(hex(p));
  else if (protocol !== "s2k") throw new Error(`Unsupported password protocol ${protocol}`);
  const key = await crypto.subtle.importKey("raw", p, "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

export function equalBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

async function hmac(key, ...parts) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, concat(...parts)));
}
// spd: AES-256-CBC, key HMAC(sessionKey, "extra data key:"), iv HMAC(sessionKey, "extra data iv:")[:16].
export async function decryptSpd(sessionKey, data) {
  const key = await crypto.subtle.importKey("raw", await hmac(sessionKey, utf8("extra data key:")), "AES-CBC", false, ["decrypt"]);
  const iv = (await hmac(sessionKey, utf8("extra data iv:"))).slice(0, 16);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv }, key, data));
}
// et: "XYZ" + 16-byte IV + AES-256-GCM ciphertext and tag, the "XYZ" header as AAD, keyed by spd's sk.
export async function decryptAppToken(sk, et) {
  if (et.length < 35 || td.decode(et.slice(0, 3)) !== "XYZ") throw new AppleIdError("App token in an unknown format");
  const k = await crypto.subtle.importKey("raw", sk, "AES-GCM", false, ["decrypt"]);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: et.slice(3, 19), additionalData: et.slice(0, 3), tagLength: 128 }, k, et.slice(19)));
}

// ---- the transport: the Worker relay ----

// https://<host>/<path> -> <base>/<host>/<path>. Apple's status comes back as the relay's; a reply without
// X-Relay-Status is the relay's own refusal (not on the list, too big, timed out) and throws.
export function relayTransport({ base = "/apple", fetcher = (...a) => globalThis.fetch(...a) } = {}) {
  return async ({ url, method = "GET", headers = {}, body }) => {
    const t = new URL(url);
    const h = {};
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === "user-agent") h["X-Relay-User-Agent"] = v; // browsers won't set User-Agent
      else h[k] = v;
    }
    const r = await fetcher(`${base}/${t.host}${t.pathname}${t.search}`, { method, headers: h, body, credentials: "omit", cache: "no-store" });
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (!r.headers.get("X-Relay-Status")) {
      let msg = `relay HTTP ${r.status}`;
      try { msg = JSON.parse(td.decode(bytes)).error || msg; } catch { /* not JSON */ }
      throw Object.assign(new Error(msg), { relay: true, status: r.status });
    }
    return { status: r.status, headers: { "content-type": r.headers.get("Content-Type") ?? "" }, body: bytes };
  };
}
// The anisette provisioning WebSocket through the same relay (wss://<this site>/apple/<host>/v3/provisioning_session).
export function relayWsUrl(server, origin = globalThis.location?.origin) {
  const s = new URL(server);
  return `${String(origin).replace(/^http/, "ws")}/apple/${s.host}/v3/provisioning_session`;
}

// ---- anisette v3 ----
// A machine of our own: a random 16-byte identifier and the adi.pb that provisioning returns, kept by the caller. One
// per (server, client info): the current one at the top of the stored state, the rest under `others`.
// A claim is the client Apple is told it talks to: "advertised" (the server's own client_info and user_agent) or "mac"
// (a current Mac, only through a server that names a Mac).
// Provisioning (once, no Apple ID): WebSocket <server>/v3/provisioning_session: GiveIdentifier -> {identifier};
// GiveStartProvisioningData -> POST gsa MidService startMachineProvisioning, send {spim}; GiveEndProvisioningData
// {cpim} -> POST finishMachineProvisioning, send {ptm, tk}; ProvisioningSuccess {adi_pb}.
// Then each request: POST <server>/v3/get_headers {identifier, adi_pb}. X-Mme-Device-Id is the identifier as a UUID,
// X-Apple-I-MD-LU hex SHA-256(identifier). (v1's one shared machine got -36607 and a locked Apple ID in R32: not used.)

// In the order to try them, all on Apple's macOS or Windows library.
export const ANISETTE_SERVERS = ["https://new.ani.sidestore.io", "https://mac-ani.jkcoxson.com", "https://ani.iloader.app",
  "https://ani3.stikstore.app", "https://ani.jkcoxson.com", "https://ani2.stikstore.app", "https://win.ani.sidestore.io",
  "https://anisette.lillq.me"];
// A server on Apple's Android library still advertises one of these stock clients (or says Android); Apple refuses it
// (-80046 at the token, 401 at finishMachineProvisioning), so it's never used.
const ANDROID_CLIENT = /^\s*<MacBookPro13,2> <macOS;13\.1;22C65>|^\s*<MacBookPro15,1> <Mac OS X;10\.15\.2;19C57>|<Android;/;
const BAG_URL = "https://gsa.apple.com/grandslam/GsService2/lookup";
const MID_START = "https://gsa.apple.com/grandslam/MidService/startMachineProvisioning";
const MID_FINISH = "https://gsa.apple.com/grandslam/MidService/finishMachineProvisioning";
export const XCODE_APP = "com.apple.gs.xcode.auth";
export const USER_AGENT = "akd/1.0 CFNetwork/978.0.7 Darwin/18.7.0";
export const XCODE_VERSION = "27.0 (27A5218g)";
const AKD_USER_AGENT = "akd/1.0 CFNetwork/808.1.4"; // for a server that advertises no user_agent
// Spelled "Mac OS X": Apple's front end answers "<macOS;26.6;…>" with a 503.
const CURRENT_MAC = { client_info: "<MacBookPro18,3> <Mac OS X;26.6;25F84> <com.apple.AuthKit/1 (com.apple.akd/1.0)>",
  user_agent: "AuthKit/1 (Macintosh; OS X 26.6) (com.apple.akd/1.0)" };
const NAMES_A_MAC = /<(macOS|Mac OS X);\d/;
const identityKey = (server, clientInfo) => `${server}\n${clientInfo}`;
const nowTime = () =>new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const uuidOf = (b) => { const h = hex(b); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };
const cpdOf = (h) => ({ bootstrap: true, icscrec: true, loc: "en_US", pbe: false, prkgen: true, svct: "iCloud", ...h });

// storage: { load() -> state | null, save(state) }: the caller keeps it private (IndexedDB).
export function anisetteV3({ transport, servers = ANISETTE_SERVERS, storage, wsUrl = relayWsUrl, log = () => {},
  WebSocketImpl = globalThis.WebSocket, provisionTimeout = 60000 }) {
  let state = storage?.load?.() ?? {};
  let info = null; // { client_info, user_agent } claimed on the current server
  let urls = null;
  const ident = () => b64decode(state.identifier);
  const deviceId = () => uuidOf(ident());
  const mdLu = async () => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", ident())));

  async function json(url, body) {
    const r = await transport({ url, method: body ? "POST" : "GET", body: body ? utf8(JSON.stringify(body)) : undefined,
      headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) } });
    if (r.status !== 200) throw new Error(`${new URL(url).host} answered HTTP ${r.status}`);
    return JSON.parse(td.decode(r.body));
  }
  async function clientInfo(server) {
    const j = await json(`${server}/v3/client_info`);
    if (!j.client_info) throw new Error(`${server}: no client_info`);
    if (ANDROID_CLIENT.test(j.client_info)) throw new Error(`${server} runs Apple's Android library, which Apple refuses`);
    return { client_info: j.client_info, user_agent: j.user_agent || AKD_USER_AGENT };
  }
  async function midUrls() {
    if (urls) return urls;
    urls = { start: MID_START, finish: MID_FINISH };
    try {
      const r = await transport({ url: BAG_URL, method: "GET", headers: { Accept: "text/x-xml-plist", "User-Agent": info.user_agent, "X-MMe-Client-Info": info.client_info } });
      const u = decodePlist(r.body)?.urls || {};
      urls = { start: u.midStartProvisioning || MID_START, finish: u.midFinishProvisioning || MID_FINISH };
    } catch (e) { log(`anisette: url bag failed (${e.message}), default MidService URLs`); }
    return urls;
  }
  async function midCall(url, request) {
    const r = await transport({ url, method: "POST", body: utf8(encodePlist({ Header: {}, Request: request })), headers: {
      "Content-Type": "text/x-xml-plist", Accept: "text/x-xml-plist", "User-Agent": info.user_agent, "X-MMe-Client-Info": info.client_info,
      "X-Xcode-Version": XCODE_VERSION, "X-Apple-App-Info": XCODE_APP, "X-Apple-I-MD-LU": await mdLu(), "X-Mme-Device-Id": deviceId(),
      "X-Apple-I-Client-Time": nowTime(), "X-Apple-Locale": "en_US", "X-Apple-I-TimeZone": "UTC" } });
    if (r.status !== 200) throw new Error(`${new URL(url).pathname} HTTP ${r.status}`);
    const p = decodePlist(r.body), resp = p.Response ?? p, st = resp.Status ?? {};
    if (st.ec) throw new Error(`${new URL(url).pathname}: ${st.em || "error"} [${st.ec}]`);
    return resp;
  }
  async function provision(server) {
    const { start, finish } = await midUrls();
    const url = wsUrl(server);
    log(`anisette: provisioning a new machine on ${server}`);
    return new Promise((resolve, reject) => {
      const ws = new WebSocketImpl(url);
      let done = false, talked = false;
      const fail = (e) => { if (!done) { done = true; clearTimeout(timer); try { ws.close(); } catch { /* closed */ } reject(e); } };
      const timer = setTimeout(() => fail(new Error(`provisioning timed out (${provisionTimeout / 1000} s)`)), provisionTimeout);
      // dropped: the socket worked and then broke, so the same server is worth another go (a dead one isn't).
      const lost = (message) => fail(Object.assign(new Error(message), { dropped: talked }));
      ws.onerror = () => lost(`WebSocket error on ${url}`);
      ws.onclose = () => lost("provisioning socket closed early");
      ws.onmessage = async (ev) => {
        talked = true;
        try {
          const m = JSON.parse(typeof ev.data === "string" ? ev.data : td.decode(ev.data));
          log(`anisette: ${m.result}`);
          switch (m.result) {
            case "GiveIdentifier": ws.send(JSON.stringify({ identifier: state.identifier })); break;
            case "GiveStartProvisioningData": {
              const r = await midCall(start, {});
              if (!r.spim) throw new Error("startMachineProvisioning gave no spim");
              ws.send(JSON.stringify({ spim: r.spim })); break;
            }
            case "GiveEndProvisioningData": {
              const r = await midCall(finish, { cpim: m.cpim });
              if (!r.ptm || !r.tk) throw new Error("finishMachineProvisioning gave no ptm/tk");
              ws.send(JSON.stringify({ ptm: r.ptm, tk: r.tk })); break;
            }
            case "ProvisioningSuccess":
              done = true; clearTimeout(timer);
              state = { ...state, adi_pb: m.adi_pb, provisionedAt: new Date().toISOString() };
              storage?.save?.(state);
              try { ws.close(); } catch { /* closed */ }
              resolve(); break;
            default: throw new Error(`provisioning: ${m.result}${m.message ? ` (${m.message})` : ""}`);
          }
        } catch (e) { fail(e); }
      };
    });
  }
  // Switches to (server, claim) with that pair's own identity, provisioning it first when it has none. A failure
  // leaves the current one as it was.
  async function use(server, claim = "advertised") {
    const advertised = await clientInfo(server).catch((e) => { throw Object.assign(e, { noServer: true }); });
    const next = claim !== "mac" ? advertised : NAMES_A_MAC.test(advertised.client_info) ? CURRENT_MAC : null;
    if (!next) throw new Error(`${server} names no Mac, so it can't claim a current one`);
    const prev = state, prevInfo = info, others = { ...state.others };
    let { identifier, adi_pb, provisionedAt } = state;
    // A state saved without clientInfo was provisioned as its server advertised.
    const was = state.clientInfo ?? (state.server === server ? advertised.client_info : "");
    if (state.server !== server || was !== next.client_info) {
      if (adi_pb) others[identityKey(state.server, was)] = { identifier, adi_pb, provisionedAt };
      const keys = [identityKey(server, next.client_info), ...(claim === "mac" ? [] : [identityKey(server, "")])];
      ({ identifier, adi_pb, provisionedAt } = others[keys.find((k) => others[k])] ?? {});
      for (const k of keys) delete others[k];
    }
    state = { identifier: identifier || b64encode(crypto.getRandomValues(new Uint8Array(16))), adi_pb: adi_pb ?? null, provisionedAt,
      server, claim, clientInfo: next.client_info, others };
    info = next;
    try {
      if (state.adi_pb) return void storage?.save?.(state);
      await provision(server).catch((e) => {
        if (!e.dropped) throw e;
        log(`anisette: ${e.message}, trying ${server} once more`);
        return provision(server);
      });
    } catch (e) { state = prev; info = prevInfo; throw e; }
  }
  const candidates = () => [state.server, ...servers].filter((s, i, a) => s && a.indexOf(s) === i);
  async function ensure(force = false) {
    if (force) { state = { ...state, identifier: null, adi_pb: null }; info = null; }
    if (state.adi_pb && info) return;
    let last;
    for (const s of candidates()) {
      try { return await use(s, s === state.server ? state.claim : "advertised"); }
      catch (e) { last = e; log(`anisette: ${s} failed: ${e.message}`); }
    }
    throw new Error(`No anisette server could provision a machine (${last?.message})`);
  }
  async function headers(sim = null) {
    await ensure();
    const body = { identifier: state.identifier, adi_pb: state.adi_pb };
    if (sim) Object.assign(body, { sim, device_id: deviceId(), md_lu: await mdLu() });
    let j = await json(`${state.server}/v3/get_headers`, body);
    if (j.result !== "Headers" && String(j.message || "").includes("-45061")) { // not provisioned (any more): start over
      log("anisette: machine not provisioned (-45061), provisioning again");
      await ensure(true);
      j = await json(`${state.server}/v3/get_headers`, { identifier: state.identifier, adi_pb: state.adi_pb });
    }
    if (j.result !== "Headers") throw new Error(`get_headers: ${j.message || j.result}`);
    const h = {
      "X-Apple-I-Client-Time": nowTime(), "X-Apple-I-MD": j["X-Apple-I-MD"], "X-Apple-I-MD-M": j["X-Apple-I-MD-M"],
      "X-Apple-I-MD-RINFO": String(j["X-Apple-I-MD-RINFO"] ?? "17106176"), "X-Apple-I-MD-LU": await mdLu(),
      "X-Apple-I-SRL-NO": "0", "X-Mme-Device-Id": deviceId(), "X-Apple-I-TimeZone": "UTC", "X-Apple-Locale": "en_US",
    };
    return { server: state.server, headers: h, cpd: cpdOf(h), clientInfo: info.client_info, userAgent: info.user_agent };
  }
  return {
    get machine() { return state?.identifier ? { deviceId: deviceId(), server: state.server, provisioned: !!state.adi_pb } : null; },
    ensure, get: () => headers(), resync: (sim) => headers(sim), reset: () => ensure(true),
    use, get servers() { return candidates(); }, get current() { return { server: state.server ?? null, claim: state.claim ?? "advertised" }; },
  };
}

// ---- Apple ID sign-in (GrandSlam) ----

export class AppleIdError extends Error {
  constructor(message, { code = null, status = null, step = null } = {}) { super(message); Object.assign(this, { code, status, step }); }
}
const GS_URLS = {
  gsService: "https://gsa.apple.com/grandslam/GsService2",
  trustedDeviceSecondaryAuth: "https://gsa.apple.com/auth/verify/trusteddevice",
  validateCode: "https://gsa.apple.com/grandslam/GsService2/validate",
};
const CLIENT_INFO = "<MacBookPro13,3> <Mac OS X;10.12.6;16G29> <com.apple.AuthKit/1 (com.apple.akd/1.0)>";
// Apple turned the claim down: its front end's 503, which comes before the password check, or -23782 (macOS 10.13
// required). Anything else, credential errors (-20101, -20970, -22406) first of all, ends the sign-in.
const claimRefused = (e) => e instanceof AppleIdError && (e.status === 503 || e.code === -23782);
function gsStatus(resp, step = null) {
  const st = resp?.Status ?? resp ?? {};
  if (st.ec && st.ec !== 0) throw new AppleIdError(st.em || `Apple error ${st.ec}`, { code: st.ec, step });
  return st;
}
function serviceError(r, step) {
  try {
    const e = JSON.parse(td.decode(r.body)).serviceErrors?.[0];
    if (e) return new AppleIdError(`${e.title || ""} ${e.message || ""}`.trim() || `Apple error ${e.code}`, { code: e.code, status: r.status, step });
  } catch { /* not JSON */ }
  return new AppleIdError(`HTTP ${r.status}`, { status: r.status, step });
}

export class AppleIdSession {
  constructor({ transport, anisette, log = () => {} }) {
    Object.assign(this, { transport, anisette, log });
    this.urls = null; this.email = null; this.password = null; this.spd = null; this.ani = null; this.spdKeyVariant = null;
  }

  baseHeaders(json = false) {
    const type = json ? "application/json" : "text/x-xml-plist";
    return { "Content-Type": type, Accept: type, "User-Agent": this.ani?.userAgent || USER_AGENT,
      "X-MMe-Client-Info": this.ani?.clientInfo || CLIENT_INFO, "X-Xcode-Version": XCODE_VERSION, "X-Apple-App-Info": XCODE_APP };
  }
  async freshAnisette() { this.ani = await this.anisette.get(); return this.ani; }

  async loadUrls() {
    if (this.urls) return this.urls;
    try {
      await this.freshAnisette();
      const r = await this.transport({ url: BAG_URL, method: "GET", headers: this.baseHeaders() });
      this.urls = { ...GS_URLS, ...(decodePlist(r.body)?.urls || {}) };
    } catch (e) {
      this.log(`url bag failed (${e.message}); using defaults`);
      this.urls = { ...GS_URLS };
    }
    return this.urls;
  }

  async gsRequest(request) {
    const urls = await this.loadUrls();
    const r = await this.transport({ url: urls.gsService, method: "POST", headers: this.baseHeaders(),
      body: utf8(encodePlist({ Header: { Version: "1.0.1" }, Request: request })) });
    if (r.status !== 200) throw new AppleIdError(`gsa.apple.com answered HTTP ${r.status}`, { status: r.status });
    const p = decodePlist(r.body);
    return p.Response ?? p;
  }

  // SRP init. Also the no-account probe: a made-up address answers ec -20970, which proves the relay reaches Apple.
  async init(email) {
    let ani = await this.freshAnisette();
    const eph = newEphemeral();
    const req = (cpd) => ({ A2k: eph.A, cpd, o: "init", ps: ["s2k", "s2k_fo"], u: email });
    let resp = await this.gsRequest(req(ani.cpd));
    const st = resp.Status ?? {};
    if (st.hsc === 434 && st["X-Apple-I-MD-DATA"] && this.anisette.resync) { // Apple wants the machine resynced
      const d = st["X-Apple-I-MD-DATA"];
      ani = this.ani = await this.anisette.resync(d instanceof Uint8Array ? b64encode(d) : String(d));
      resp = await this.gsRequest(req(ani.cpd));
    }
    return { resp, eph, cpd: ani.cpd };
  }

  // Signs in through each server x claim in turn, the current server first (and its claim first on it), moving on
  // when a server can't serve or Apple refuses the claim; never the same pair twice.
  async login(email, password) {
    if (email) this.email = String(email).trim().toLowerCase();
    if (password) this.password = password;
    if (!this.email || !this.password) throw new AppleIdError("Apple ID and password needed");
    const ani = this.anisette;
    if (!ani.use) return this.signInOnce(); // a fixed anisette source: nothing to rotate
    const current = ani.current;
    let refused = null, down = null;
    for (const server of ani.servers) {
      const claims = server === current.server && current.claim === "mac" ? ["mac", "advertised"] : ["advertised", "mac"];
      for (const claim of claims) {
        try {
          await ani.use(server, claim);
          await this.freshAnisette();
        } catch (e) {
          down = e;
          this.log(`sign-in: ${server} (${claim}) unusable: ${e.message}`);
          if (e.noServer) break;
          continue;
        }
        try { return await this.signInOnce(); } catch (e) {
          if (!claimRefused(e)) throw e;
          refused = e;
          this.log(`sign-in: ${server} (${claim}) refused: ${e.message}`);
        }
      }
    }
    throw refused ?? new Error(`No anisette server could provision a machine (${down?.message})`);
  }

  async signInOnce() {
    const { resp, eph, cpd } = await this.init(this.email);
    gsStatus(resp, "SRP init");
    const { s: salt, B, i: iterations, c, sp } = resp;
    if (sp !== "s2k" && sp !== "s2k_fo") throw new AppleIdError(`Apple asked for an unknown password protocol (${sp})`, { step: "SRP init" });
    const P = await gsaPasswordKey(this.password, salt, Number(iterations), sp);
    const srp = await processReply({ a: eph.a, username: this.email, password: P, salt, B });
    const step = "SRP complete (password check)";
    const resp2 = await this.gsRequest({ M1: srp.M1, c, cpd, o: "complete", u: this.email });
    const st = gsStatus(resp2, step);
    if (!equalBytes(resp2.M2, srp.M2)) throw new AppleIdError("Apple's server proof didn't match", { step });
    // gms.py keys spd with K = H(S), isideload with the premaster S: try K, then S.
    this.spdKeyVariant = null;
    for (const [name, key] of [["K", srp.K], ["S", srp.S]]) {
      try { this.spd = decodePlist(await decryptSpd(key, resp2.spd)); this.spdKeyVariant = name; break; } catch { /* next */ }
    }
    if (!this.spdKeyVariant) throw new AppleIdError("Couldn't decrypt Apple's session data (spd)", { step: "spd decryption" });
    if (st.au === "trustedDeviceSecondaryAuth") return { step: "device", au: st.au };
    if (st.au === "secondaryAuth") return { step: "sms", au: st.au };
    if (st.au && st.au !== "repair") return { step: "other", au: st.au };
    this.password = null; // signed in: the password isn't needed any more
    return { step: "done", au: st.au ?? null };
  }

  identityHeaders(json = false) {
    if (!this.spd) throw new AppleIdError("Not signed in");
    return { ...this.baseHeaders(json), ...this.ani.headers,
      "X-Apple-Identity-Token": b64encode(utf8(`${this.spd.adsid}:${this.spd.GsIdmsToken}`)) };
  }

  async requestDeviceCode() {
    const urls = await this.loadUrls();
    await this.freshAnisette();
    const r = await this.transport({ url: urls.trustedDeviceSecondaryAuth, method: "GET", headers: this.identityHeaders() });
    if (r.status >= 400) throw new AppleIdError(`Asking for a code failed: HTTP ${r.status}`, { status: r.status, step: "2FA code request" });
    return true;
  }

  async verifyDeviceCode(code) {
    const urls = await this.loadUrls();
    await this.freshAnisette();
    const step = "2FA code check (trusted device)";
    const r = await this.transport({ url: urls.validateCode, method: "GET", headers: { ...this.identityHeaders(), "security-code": String(code).trim() } });
    let p = null;
    try { p = decodePlist(r.body); } catch { /* below */ }
    if (p) gsStatus(p, step);
    if (r.status >= 400 || !p) throw new AppleIdError(`Code check failed: HTTP ${r.status}`, { status: r.status, step });
    return this.login();
  }

  async trustedPhones() {
    await this.freshAnisette();
    const r = await this.transport({ url: "https://gsa.apple.com/auth", method: "GET", headers: this.identityHeaders(true) });
    let j = {};
    try { j = JSON.parse(td.decode(r.body)); } catch { /* no list */ }
    return (j.trustedPhoneNumbers || []).map((n) => ({ id: n.id, number: n.numberWithDialCode || n.obfuscatedNumber || String(n.id) }));
  }

  async requestSmsCode(id) {
    await this.freshAnisette();
    const r = await this.transport({ url: "https://gsa.apple.com/auth/verify/phone", method: "PUT", headers: this.identityHeaders(true),
      body: utf8(JSON.stringify({ phoneNumber: { id: Number(id) }, mode: "sms" })) });
    if ((r.status >= 200 && r.status < 300) || r.status === 412) return true; // 412: a code is already out and still works
    const e = serviceError(r, "SMS code request");
    if (["-22979", "-22981"].includes(String(e.code))) return true; // Apple won't resend yet; the last code works
    throw e;
  }

  async verifySmsCode(id, code) {
    await this.freshAnisette();
    const r = await this.transport({ url: "https://gsa.apple.com/auth/verify/phone/securitycode", method: "POST", headers: this.identityHeaders(true),
      body: utf8(JSON.stringify({ securityCode: { code: String(code).trim() }, phoneNumber: { id: Number(id) }, mode: "sms" })) });
    if (!(r.status >= 200 && r.status < 300)) throw serviceError(r, "2FA code check (SMS)");
    return this.login();
  }

  async appToken(app = XCODE_APP) {
    const spd = this.spd, step = "Xcode app token (o=apptokens)";
    if (!spd?.sk || !spd?.c) throw new AppleIdError("Not signed in (no session key)", { step });
    const ani = await this.freshAnisette();
    const checksum = await hmac(spd.sk, utf8("apptokens"), utf8(spd.adsid), utf8(app));
    const resp = await this.gsRequest({ app: [app], c: spd.c, checksum, cpd: ani.cpd, o: "apptokens", u: spd.adsid, t: spd.GsIdmsToken });
    gsStatus(resp, step);
    if (!resp.et) throw new AppleIdError("Apple returned no app token", { step });
    const tok = decodePlist(await decryptAppToken(spd.sk, resp.et));
    if (tok["status-code"] !== undefined && tok["status-code"] !== 200) throw new AppleIdError(`App token status ${tok["status-code"]}`, { step });
    const t = tok.t?.[app];
    if (!t?.token) throw new AppleIdError("App token missing in Apple's reply", { step });
    return { token: t.token, expiry: t.expiry, duration: t.duration };
  }

  get adsid() { return this.spd?.adsid ?? null; }
  get displayName() { return this.spd ? [this.spd.fn, this.spd.ln].filter(Boolean).join(" ") : null; }
  forget() { this.password = null; this.spd = null; }
}

// ---- developer services (Xcode's QH65B2) ----

const DEV_BASE = "https://developerservices2.apple.com/services/QH65B2/";
const DEV_CLIENT = "XABBG36SBA";
export class DevPortalError extends Error {
  constructor(message, { code = null, step = null, kind = null } = {}) { super(message); Object.assign(this, { code, step, kind }); }
}

export class DevPortal {
  constructor({ transport, anisette, token, adsid }) { Object.assign(this, { transport, anisette, token, adsid }); }

  async call(action, params = {}, { platform = "ios/" } = {}) {
    const ani = await this.anisette.get();
    const body = { clientId: DEV_CLIENT, protocolVersion: "QH65B2", requestId: crypto.randomUUID().toUpperCase(), userLocale: ["en_US"], ...params };
    const r = await this.transport({ url: `${DEV_BASE}${platform}${action}.action?clientId=${DEV_CLIENT}`, method: "POST",
      headers: { "Content-Type": "text/x-xml-plist", Accept: "text/x-xml-plist", "Accept-Language": "en-us",
        "User-Agent": ani.userAgent || USER_AGENT, "X-MMe-Client-Info": ani.clientInfo || CLIENT_INFO,
        "X-Xcode-Version": XCODE_VERSION, "X-Apple-App-Info": XCODE_APP, ...ani.headers,
        "X-Apple-I-Identity-Id": this.adsid, "X-Apple-GS-Token": this.token },
      body: utf8(encodePlist(body)) });
    let p;
    try { p = decodeAny(r.body).value; } catch {
      throw new DevPortalError(`${action}: Apple answered HTTP ${r.status} with something that isn't a plist or JSON`, { step: action });
    }
    const code = Number(p?.resultCode ?? 0);
    if (code !== 0 || r.status !== 200) {
      const text = `${p?.userString ?? ""} ${p?.resultString ?? ""}`;
      const kind = /agreement|terms|license/i.test(text) ? "agreement" : code === 1100 ? "session" : null;
      throw new DevPortalError(p?.userString || p?.resultString || `HTTP ${r.status}`, { code, step: action, kind });
    }
    return p;
  }

  // -> [{ teamId, name, type, memberships: [...] }]; a free account has one team ("Individual", a Personal Team).
  async listTeams() { return (await this.call("listTeams", {}, { platform: "" })).teams || []; }

  // F254: the free route's setup calls (as the R32 test site ran them on a real free account, iOS 27.0.1).
  async listDevices(teamId) { return (await this.call("listDevices", { teamId })).devices || []; }
  async addDevice(teamId, udid, name) { return (await this.call("addDevice", { teamId, deviceNumber: udid, name })).device; }
  // -> [{ serialNumber, status, expirationDate, certContent (DER bytes), machineName, ... }]
  async listCerts(teamId) { return (await this.call("listAllDevelopmentCerts", { teamId })).certificates || []; }
  async submitCsr(teamId, csrPem, machineName) {
    return (await this.call("submitDevelopmentCSR", { teamId, csrContent: csrPem, machineName,
      machineId: crypto.randomUUID().toUpperCase() })).certRequest;
  }
  async revokeCert(teamId, serialNumber) { return this.call("revokeDevelopmentCert", { teamId, serialNumber }); }
  async listAppIds(teamId) {
    const p = await this.call("listAppIds", { teamId });
    return { appIds: p.appIds || [], maxQuantity: p.maxQuantity ?? null, availableQuantity: p.availableQuantity ?? null };
  }
  async addAppId(teamId, identifier, name) { return (await this.call("addAppId", { teamId, identifier, name: appIdName(name) })).appId; }
  // -> { encodedProfile (bytes), provisioningProfileId, ... }: the team's 7-day development profile for that App ID
  async downloadProfile(teamId, appIdId) {
    return (await this.call("downloadTeamProvisioningProfile", { teamId, appIdId })).provisioningProfile;
  }
}

// Apple takes only letters and digits in an App ID's name.
export const appIdName = (s) => String(s ?? "").replace(/[^A-Za-z0-9]/g, "") || "App";

// ---- what to tell the user (iOS-style alert: { kind, title, message, code }) ----
// -20101 / -22406 wrong Apple ID or password; -20970 no such account; -36607 Apple refusing the machine (anisette, R32);
// -21669 wrong 2FA code; -20209 / -20283 / -20751 locked or disabled.
export const WAIT_MINUTES = 15;
export function signInAlert(e, { now = new Date() } = {}) {
  const code = e?.code != null && e.code !== "" ? Number(e.code) : null;
  const apple = e?.message || String(e);
  if (code === -20101 || code === -22406) return { kind: "wrong-password", title: "Incorrect Password", code, message: "The Apple ID or password is incorrect. Check them and try again." };
  if (code === -20970) return { kind: "no-account", title: "Apple ID Not Found", code, message: "Apple doesn't know this Apple ID. Check the address and try again." };
  if (code === -21669) return { kind: "wrong-code", title: "Incorrect Code", code, message: "That verification code is wrong. Check it and try again." };
  if ([-20209, -20283, -20751].includes(code)) return { kind: "locked", title: "This Apple ID Is Locked", code, message: `Apple said "${apple}" [${code}]. Unlock it at iforgot.apple.com, then try again.` };
  if (code === -36607) {
    const until = new Date(now.getTime() + WAIT_MINUTES * 60000);
    return { kind: "rejected", title: "Apple Refused the Sign-In", code, waitUntil: until.toISOString(),
      message: `Apple said "${apple}" [${code}]. Wait ${WAIT_MINUTES} minutes (until ${until.toISOString().slice(11, 16)} UTC) before trying again: retrying sooner can lock the Apple ID.` };
  }
  return { kind: "other", title: "Sign-In Failed", code, message: `Step: ${e?.step || "sign-in"}. ${code != null ? `Apple error ${code}: ` : ""}${apple}` };
}
