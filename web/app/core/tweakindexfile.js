// F398: the Tweak Index as one file: every source's verdicts, the same bytes for everyone, so a phone that reads it
// never says which sources it has. The app and the site carry a copy (web/app/tweak-index.json, written at each release
// by tools/tweak-index.mjs) and the Worker makes a current one from D1 (worker/src/tweakindex.js, GET /api/tweaks.json).
// Pure JS, shared by the app, the Worker and the release tool; what touches the network or storage is passed in.
//
//   { "v": 1, "at": <seconds: the newest read or check in it>, "why": ["…"],
//     "sources": { "<sourceId>": { "at": <Packages read>, "done": 1, "paid": ["<bundle id>"], "t": { "<pkg>@<version>": verdict } } } }
//
// `done`: every tweak of the source was checked (core/sources.js tweakIndexDone). `t`: the free tweaks' verdicts, keyed
// under their source, so a package in two sources can't clash. A verdict is its flags (1 ok, 2 any app, 4 iOS only, 8
// library), or [flags, index into `why` or -1, bundle IDs…]. `paid`: the bundle IDs the source's paid tweaks are
// guessed for (never downloaded), enough to keep that source listed; a paid tweak has no verdict of its own here.
//
//   FILE_PATH, FILE_URL, FILE_NAME, FILE_MAX    "/api/tweaks.json", its URL on brand.js DOMAIN, the bundled file, the size cap
//   sourceId(key)                               a source's name in the file: a hash of tweakindex.js indexSource's key,
//                                               so the published file lists no address anybody typed in
//   packIndexFile(sources, entries, { max })    the file's object from D1's rows ([{ key, refreshed, pending, error }],
//                                               [{ source, entry: JSON text, checked }]), or null when it holds no verdict
//   parseIndexFile(text, { now })               a checked file, or null: too big, not JSON, another shape, no verdicts,
//                                               or (with `now`, seconds) dated in the future
//   answerFromFile(file, source)                what GET /api/tweaks would say for a source: { enabled, known, refreshed,
//                                               pending, tweaks }, or null when the file doesn't have it
//   createIndexFile({ bundled, store, get, url, enabled, now })   the file a phone uses:
//     await f.read()     the newest good one of the bundled and the kept copy (null: neither), and a refresh started
//                        in the background (REFRESH_MS apart, RETRY_MS after a failed one; none when `enabled()` is false)
//     await f.refresh()  -> true when a newer file came (kept for the next launch too, f.onChange told); anything that
//                        can't be fetched, fails the check or is older leaves the one in use
//
// SPDX-License-Identifier: GPL-3.0-or-later
import { indexSource } from "./tweakindex.js";
import { sha256Hex } from "./sha256.js";
import { DOMAIN } from "../brand.js";

export const FILE_PATH = "/api/tweaks.json";
export const FILE_URL = `https://${DOMAIN}${FILE_PATH}`;
export const FILE_NAME = "tweak-index.json";
export const FILE_V = 1, FILE_MAX = 4 * 1024 * 1024;
export const REFRESH_MS = 6 * 3600 * 1000, RETRY_MS = 10 * 60 * 1000, FETCH_MS = 20 * 1000;
const FUTURE_S = 2 * 86400;

const OK = 1, ANY = 2, SYSTEM = 4, LIBRARY = 8;
const utf8 = new TextEncoder();

export const sourceId = (key) => sha256Hex(utf8.encode(String(key))).slice(0, 20);

const plain = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const count = (v) => Number.isSafeInteger(v) && v >= 0;
const bundleIds = (v) => (Array.isArray(v) ? v : []).filter((b) => typeof b === "string" && b && b.length <= 200);

export function packIndexFile(sources, entries, { max = FILE_MAX } = {}) {
  const why = [], whyAt = new Map(), bySource = new Map();
  let at = 0;
  for (const r of entries ?? []) {
    let e = null;
    try { e = JSON.parse(r.entry); } catch { continue; }
    if (!e?.package) continue;
    let list = bySource.get(r.source);
    if (!list) bySource.set(r.source, list = []);
    list.push(e);
    at = Math.max(at, Number(r.checked) || 0);
  }
  const whyIndex = (text) => {
    if (!text) return -1;
    if (!whyAt.has(text)) { whyAt.set(text, why.length); why.push(text); }
    return whyAt.get(text);
  };
  const out = {};
  let verdicts = 0, size = 0;
  for (const s of sources ?? []) {
    if (!s?.refreshed) continue;
    const list = bySource.get(s.key) ?? [];
    const done = !s.pending && !s.error;
    if (!list.length && !done) continue;
    const src = { at: Number(s.refreshed), ...(done ? { done: 1 } : {}) };
    const t = Object.create(null), paid = new Set();
    let n = 0;
    for (const e of list) {
      if (e.paid || e.unverified) { for (const b of bundleIds(e.bundles)) paid.add(b); continue; }
      const flags = (e.ok ? OK : 0) | (e.anyApp ? ANY : 0) | (e.systemOnly ? SYSTEM : 0) | (e.library ? LIBRARY : 0);
      const bundles = bundleIds(e.bundles);
      const w = whyIndex(e.why ? String(e.why).slice(0, 300) : "");
      t[`${e.package}@${e.version ?? ""}`] = w < 0 && !bundles.length ? flags : [flags, w, ...bundles];
      n++;
    }
    if (paid.size) src.paid = [...paid].sort();
    src.t = t;
    // a source the cap leaves no room for is left out whole: not known, so nothing of it is hidden
    size += utf8.encode(JSON.stringify(src)).length + 32;
    if (size + utf8.encode(JSON.stringify(why)).length + 256 > max) break;
    out[sourceId(s.key)] = src;
    verdicts += n;
    at = Math.max(at, src.at);
  }
  return verdicts ? { v: FILE_V, at, why, sources: out } : null;
}

function goodSource(s, whys) {
  if (!plain(s) || !count(s.at) || !plain(s.t)) return false;
  if (s.paid !== undefined && !(Array.isArray(s.paid) && s.paid.every((b) => typeof b === "string"))) return false;
  return Object.values(s.t).every((v) => (Array.isArray(v)
    ? v.length >= 2 && count(v[0]) && Number.isInteger(v[1]) && v[1] >= -1 && v[1] < whys && v.slice(2).every((b) => typeof b === "string")
    : count(v)));
}

export function parseIndexFile(text, { now = null } = {}) {
  if (typeof text !== "string" || text.length > FILE_MAX) return null;
  let f;
  try { f = JSON.parse(text); } catch { return null; }
  if (!plain(f) || f.v !== FILE_V || !count(f.at) || !f.at || !plain(f.sources)) return null;
  if (now !== null && f.at > now + FUTURE_S) return null;
  if (!Array.isArray(f.why) || !f.why.every((w) => typeof w === "string" && w.length <= 300)) return null;
  const list = Object.values(f.sources);
  if (!list.every((s) => goodSource(s, f.why.length)) || !list.some((s) => Object.keys(s.t).length)) return null;
  return f;
}

export function answerFromFile(file, source) {
  const src = indexSource(source, source?.arch);
  const id = src && sourceId(src.key);
  const s = id && Object.prototype.hasOwnProperty.call(file?.sources ?? {}, id) ? file.sources[id] : null;
  if (!s) return null;
  const tweaks = Object.entries(s.t).map(([k, v]) => {
    const [flags, w, ...bundles] = Array.isArray(v) ? v : [v, -1];
    const cut = k.lastIndexOf("@"); // a Debian version has no "@"
    return { package: k.slice(0, cut), version: k.slice(cut + 1), ok: Boolean(flags & OK), why: file.why[w] ?? null, bundles,
      anyApp: Boolean(flags & ANY), systemOnly: Boolean(flags & SYSTEM), ...(flags & LIBRARY ? { library: true } : {}) };
  });
  // the paid tweaks' guessed apps: no package, so it's no tweak's verdict (screens/tweaks.js skips it)
  if (s.paid?.length) tweaks.push({ ok: true, bundles: [...s.paid], anyApp: false, systemOnly: false, paid: true, unverified: true });
  return { enabled: true, known: true, refreshed: s.at, pending: s.done ? 0 : 1, tweaks };
}

// A response's text, FILE_MAX bytes at most, or throws.
async function cappedText(r) {
  if (Number(r.headers?.get?.("content-length") || 0) > FILE_MAX) throw new Error("too big");
  const reader = r.body?.getReader?.();
  if (!reader) return r.text();
  const dec = new TextDecoder();
  let out = "", n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out + dec.decode();
    n += value.byteLength;
    if (n > FILE_MAX) { reader.cancel().catch(() => {}); throw new Error("too big"); }
    out += dec.decode(value, { stream: true });
  }
}

const KEPT = "file"; // the store's one entry: { text, asked }: the last good fetched file, and when the server last gave one

export function createIndexFile({ bundled, store, get = (u, o) => globalThis.fetch(u, o), url = FILE_URL, enabled = () => true, now = Date.now } = {}) {
  let current = null, loading = null, refreshing = null, asked = 0, tried = -Infinity;
  const listeners = new Set();
  const kept = async () => { try { return await (await store())?.get(KEPT); } catch { return null; } };
  const keep = async (text) => { try { await (await store())?.put(KEPT, { text, asked }); } catch { /* no room: fetched again next launch */ } };

  function load() {
    return (loading ??= (async () => {
      const [own, k] = await Promise.all([
        Promise.resolve().then(() => bundled?.()).then((t) => parseIndexFile(t), () => null), kept()]);
      const last = parseIndexFile(k?.text);
      if (last && Number(k.asked) <= now()) asked = Number(k.asked) || 0;
      current = last && (!own || last.at > own.at) ? last : own;
    })());
  }

  async function fetchFile() {
    tried = now();
    const ac = typeof AbortController === "function" ? new AbortController() : null;
    const timer = setTimeout(() => ac?.abort(), FETCH_MS);
    timer?.unref?.();
    try {
      const r = await get(typeof url === "function" ? url() : url, { credentials: "omit", referrerPolicy: "no-referrer", ...(ac ? { signal: ac.signal } : {}) });
      if (!r?.ok) return false;
      const text = await cappedText(r);
      const f = parseIndexFile(text, { now: Math.floor(now() / 1000) });
      if (!f) return false;
      asked = now();
      const newer = !current || f.at > current.at;
      if (newer) current = f;
      await keep(newer ? text : JSON.stringify(current));
      if (newer) for (const l of [...listeners]) { try { l(f); } catch { /* one listener's error stops no other */ } }
      return newer;
    } catch { return false; } finally { clearTimeout(timer); }
  }

  // At most one request at a time; nothing is asked while the copy is fresh or a failed try is recent.
  async function refresh() {
    await load();
    if (!enabled()) return false;
    if (refreshing) return refreshing;
    if (now() - asked < REFRESH_MS || now() - tried < RETRY_MS) return false;
    return (refreshing ??= fetchFile().finally(() => { refreshing = null; }));
  }

  return {
    async read() {
      await load();
      refresh();
      return current;
    },
    refresh,
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
  };
}
