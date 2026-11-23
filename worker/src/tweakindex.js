// F344: the shared tweak index (web/app/core/tweakindex.js has the shapes). For each Tweak Source it knows, the Worker
// reads Packages, takes the newest version of every package the Packages fields let through, downloads each free
// tweak's .deb once per package and version, runs core/tweaks.js inspectTweakDeb on it (the app's own check: filter
// Bundles/Executables, any app, iOS only, dylibs) and keeps the verdict in D1 (binding TWEAKS; the tables are made on
// first use). Paid tweaks (cydia::commercial) are never downloaded: their entry carries the app guessed from the Name
// and Description, marked unverified.
//
//   GET /api/tweaks?source=<uri>&dist=<dist>[&components=a,b][&arch=iphoneos-arm][&bundle=<id>]
//     -> { enabled, source, known, refreshed, pending, tweaks: [entry] }   `bundle`: only entries whose filter names
//     that bundle ID, every-app ones and unverified paid guesses for it. A source not seen before is added (up to
//     MAX_SOURCES) and a first pass of ON_DEMAND .debs runs after the answer (ctx.waitUntil); the cron does the rest.
//     Without the TWEAKS binding: { enabled: false } and the app checks tweaks on the phone, as before.
//   GET /api/tweaks.json   F398: the whole index as one file (web/app/core/tweakindexfile.js), the same for everyone:
//     made from D1 at most every FILE_FRESH_S (env.LOOKUP_CACHE, else Cloudflare's cache). Without TWEAKS, or when D1
//     fails or holds nothing, the copy the site was deployed with (/tweak-index.json, ASSETS); a self-hosted server
//     (node.mjs) always serves its own copy. The apps of F398 on read only this; GET /api/tweaks is for older builds.
//   scheduled(): the cron (wrangler.toml [triggers]) seeds tweak-sources.json's "inject" sources (from ASSETS), then
//     works through the sources with the most left to check, PER_RUN .debs in all (TWEAK_INDEX_PER_RUN).
//
// Outgoing fetches: env.FETCH when given (node.mjs's SSRF-checked fetch), literal private hosts refused up front
// (src/ssrf.js), 30 s for headers, Packages up to PACKAGES_MAX unpacked, a .deb up to DEB_MAX (bigger ones are left
// to the phone's own check). A Packages list is read again after REFRESH_S; a .deb that fails to download is tried
// TRIES times.
// SPDX-License-Identifier: GPL-3.0-or-later
import { repoLayout, resolveFilename } from "../../web/app/core/apt.js";
import { inspectTweakDeb } from "../../web/app/core/tweaks.js";
import { decompress, UnpackError } from "../../web/app/core/unpack.js";
import { INDEX_PATH, sourceFromQuery, indexSource, indexTweaks, indexEntry, paidEntry, isPaidStanza } from "../../web/app/core/tweakindex.js";
import { FILE_PATH, FILE_NAME, packIndexFile, parseIndexFile } from "../../web/app/core/tweakindexfile.js"; // F398
import { blockedHost } from "./ssrf.js";

export const isTweakIndexPath = (p) => p === INDEX_PATH;
export const isTweakIndexFilePath = (p) => p === FILE_PATH; // F398
export const FILE_FRESH_S = 30 * 60;
export const PER_RUN = 20, ON_DEMAND = 4, MAX_SOURCES = 300, TRIES = 3, REFRESH_S = 6 * 3600, HEADERS_MS = 30000;
export const DEB_MAX = 16 * 1024 * 1024, PACKAGES_MAX = 48 * 1024 * 1024, PACKAGES_DOWNLOAD_MAX = 16 * 1024 * 1024;

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };
const json = (body, status = 200, cache = "no-store") => new Response(JSON.stringify(body), { status,
  headers: { "Content-Type": "application/json", "Cache-Control": cache, "X-Content-Type-Options": "nosniff", ...CORS } });

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS tweak_sources (key TEXT PRIMARY KEY, uri TEXT NOT NULL, dist TEXT NOT NULL,
    components TEXT NOT NULL DEFAULT '', arch TEXT NOT NULL, added INTEGER NOT NULL, refreshed INTEGER NOT NULL DEFAULT 0,
    pending INTEGER NOT NULL DEFAULT 0, error TEXT)`,
  `CREATE TABLE IF NOT EXISTS tweak_entries (source TEXT NOT NULL, package TEXT NOT NULL, version TEXT NOT NULL,
    deb TEXT, entry TEXT, tries INTEGER NOT NULL DEFAULT 0, checked INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (source, package, version))`,
  "CREATE INDEX IF NOT EXISTS tweak_entries_todo ON tweak_entries (source, entry, tries)",
];
const ready = new WeakMap();
function schema(db) {
  if (!ready.has(db)) ready.set(db, db.batch(SCHEMA.map((s) => db.prepare(s))).catch((e) => { ready.delete(db); throw e; }));
  return ready.get(db);
}

const now = () => Math.floor(Date.now() / 1000);

// A response's body, at most `max` bytes, or throws.
async function readCapped(r, max) {
  if (Number(r.headers.get("content-length") || 0) > max) { r.body?.cancel?.(); throw new Error("too big"); }
  const reader = r.body?.getReader?.();
  if (!reader) return new Uint8Array(await r.arrayBuffer());
  const parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { reader.cancel().catch(() => {}); throw new Error("too big"); }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out;
}

async function get(url, fetcher, max) {
  const target = new URL(url);
  if (target.protocol !== "https:" && target.protocol !== "http:") throw new Error("not http(s)");
  if (blockedHost(target.hostname)) throw new Error(`${target.hostname} is a private or local address`);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), HEADERS_MS);
  let r;
  try { r = await fetcher(target.href, { signal: ac.signal, redirect: "follow", headers: { "User-Agent": "Telesphoreo APT-HTTP/1.0.592" } }); }
  finally { clearTimeout(timer); }
  if (!r.ok) { r.body?.cancel?.(); const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
  return readCapped(r, max);
}

async function gunzipNative(data) {
  if (typeof DecompressionStream !== "function") return decompress("x.gz", data, PACKAGES_MAX);
  const s = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"));
  return readCapped(new Response(s), PACKAGES_MAX);
}

// A source's Packages text: Packages.gz, Packages, Packages.bz2, Packages.xz in that order, for each component.
export async function packagesText(src, fetcher) {
  const layout = repoLayout(src, src.arch);
  const texts = [];
  for (const base of layout.packages) {
    let text = null, last = null;
    for (const ext of [".gz", "", ".bz2", ".xz"]) {
      try {
        const data = await get(base + ext, fetcher, PACKAGES_DOWNLOAD_MAX);
        const raw = ext === ".gz" ? await gunzipNative(data) : ext ? decompress(`Packages${ext}`, data, PACKAGES_MAX) : data;
        text = new TextDecoder().decode(raw);
        break;
      } catch (e) { last = e; }
    }
    if (text == null) throw new Error(`no Packages file (${last?.message ?? "?"})`);
    texts.push(text);
  }
  return { text: texts.join("\n\n"), root: layout.root };
}

async function sourceRow(db, key) {
  return db.prepare("SELECT * FROM tweak_sources WHERE key = ?").bind(key).first();
}

// Adds a source to the index. -> its row, or null when the index is full.
export async function addSource(db, src) {
  await schema(db);
  const had = await sourceRow(db, src.key);
  if (had) return had;
  const n = (await db.prepare("SELECT COUNT(*) AS n FROM tweak_sources").first())?.n ?? 0;
  if (n >= MAX_SOURCES) return null;
  await db.prepare("INSERT OR IGNORE INTO tweak_sources (key, uri, dist, components, arch, added) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(src.key, src.uri, src.dist, src.components.join(","), src.arch, now()).run();
  return sourceRow(db, src.key);
}

// Packages read again: a row per newest tweak version (paid ones with their guessed entry), older versions dropped.
async function refresh(db, src, fetcher) {
  const { text, root } = await packagesText(src, fetcher);
  const list = indexTweaks(text);
  const keep = new Set(list.map((st) => `${st.package}\n${st.version}`));
  const had = (await db.prepare("SELECT package, version FROM tweak_entries WHERE source = ?").bind(src.key).all()).results ?? [];
  const writes = [];
  for (const h of had) if (!keep.has(`${h.package}\n${h.version}`)) {
    writes.push(db.prepare("DELETE FROM tweak_entries WHERE source = ? AND package = ? AND version = ?").bind(src.key, h.package, h.version));
  }
  const old = new Set(had.map((h) => `${h.package}\n${h.version}`));
  for (const st of list) {
    if (old.has(`${st.package}\n${st.version}`)) continue;
    if (isPaidStanza(st)) {
      writes.push(db.prepare("INSERT OR IGNORE INTO tweak_entries (source, package, version, deb, entry, checked) VALUES (?, ?, ?, NULL, ?, ?)")
        .bind(src.key, st.package, st.version, JSON.stringify(paidEntry(st)), now()));
      continue;
    }
    let deb = null;
    try { deb = resolveFilename(root, st.filename); } catch { deb = null; }
    writes.push(db.prepare("INSERT OR IGNORE INTO tweak_entries (source, package, version, deb, entry) VALUES (?, ?, ?, ?, ?)")
      .bind(src.key, st.package, st.version, deb, deb ? null : JSON.stringify(indexEntry(st, { ok: false, why: "This package has no .deb to download." }))));
  }
  // D1 caps a batch's size: in slices
  for (let i = 0; i < writes.length; i += 50) await db.batch(writes.slice(i, i + 50));
  return list.length;
}

// One pass over a source: Packages when stale, then up to `budget` .debs checked. -> { refreshed, checked, pending }.
// `budget`: .debs at most; `cap`: outgoing fetches at most, Packages included (the cron's subrequest budget).
export async function indexPass(env, src, { budget = ON_DEMAND, cap = Infinity, fetcher: plainFetch = env.FETCH ?? globalThis.fetch, force = false } = {}) {
  const db = env.TWEAKS;
  await schema(db);
  const row = (await sourceRow(db, src.key)) ?? (await addSource(db, src));
  if (!row) return { refreshed: false, checked: 0, tried: 0, fetches: 0, pending: 0 };
  let fetches = 0;
  const fetcher = (...a) => { fetches++; return plainFetch(...a); };
  let refreshed = false;
  if (force || !row.refreshed || now() - row.refreshed > REFRESH_S) {
    try {
      await refresh(db, src, fetcher);
      await db.prepare("UPDATE tweak_sources SET refreshed = ?, error = NULL WHERE key = ?").bind(now(), src.key).run();
      refreshed = true;
    } catch (e) {
      await db.prepare("UPDATE tweak_sources SET refreshed = ?, error = ? WHERE key = ?").bind(now(), String(e?.message ?? e).slice(0, 200), src.key).run();
    }
  }
  const todo = (await db.prepare("SELECT package, version, deb, tries FROM tweak_entries WHERE source = ? AND entry IS NULL AND tries < ? LIMIT ?")
    .bind(src.key, TRIES, Math.max(0, Math.min(budget, cap - fetches))).all()).results ?? [];
  let checked = 0;
  for (const t of todo) {
    let entry = null;
    try {
      const data = await get(t.deb, fetcher, DEB_MAX);
      let info;
      try { info = inspectTweakDeb(data); } catch (e) {
        if (!(e instanceof UnpackError)) throw e;
        info = { ok: false, why: String(e.message) };
      }
      entry = indexEntry({ package: t.package, version: t.version }, info);
    } catch (e) {
      // a failed or too big download: tried again later, then left to the phone's own check
      const tries = /too big/.test(String(e?.message)) ? TRIES : t.tries + 1;
      await db.prepare("UPDATE tweak_entries SET tries = ? WHERE source = ? AND package = ? AND version = ?")
        .bind(tries, src.key, t.package, t.version).run();
      continue;
    }
    await db.prepare("UPDATE tweak_entries SET entry = ?, checked = ? WHERE source = ? AND package = ? AND version = ?")
      .bind(JSON.stringify(entry), now(), src.key, t.package, t.version).run();
    checked++;
  }
  const pending = (await db.prepare("SELECT COUNT(*) AS n FROM tweak_entries WHERE source = ? AND entry IS NULL AND tries < ?")
    .bind(src.key, TRIES).first())?.n ?? 0;
  await db.prepare("UPDATE tweak_sources SET pending = ? WHERE key = ?").bind(pending, src.key).run();
  return { refreshed, checked, tried: todo.length, fetches, pending };
}

const sameId = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
export function forBundle(entry, bundle) {
  if (!bundle) return true;
  if (!entry?.ok || entry.systemOnly) return false;
  return Boolean(entry.anyApp && !entry.unverified) || (entry.bundles ?? []).some((b) => sameId(b, bundle));
}

// GET /api/tweaks
export async function tweakIndex(req, env, ctx = null, { fetcher } = {}) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET") return json({ code: "bad_method", error: "GET only." }, 405);
  const u = new URL(req.url);
  const src = sourceFromQuery(u.searchParams);
  if (!src) return json({ code: "bad_source", error: "Send a Tweak Source: source=<uri>&dist=<dist>[&components=…]." }, 400);
  if (blockedHost(new URL(src.uri).hostname)) return json({ code: "refused", error: "That source is a private or local address." }, 403);
  const db = env.TWEAKS;
  if (!db) return json({ enabled: false, source: src.key, tweaks: [] });
  await schema(db);
  let row = await sourceRow(db, src.key);
  if (!row) {
    row = await addSource(db, src);
    if (row) {
      const pass = indexPass(env, src, { budget: Number(env.TWEAK_INDEX_ON_DEMAND ?? ON_DEMAND) || 0, fetcher: fetcher ?? env.FETCH ?? globalThis.fetch })
        .catch((e) => console.log(`tweak index: ${src.uri}: ${e?.message ?? e}`));
      if (ctx?.waitUntil) ctx.waitUntil(pass); else await pass;
    }
  }
  const bundle = String(u.searchParams.get("bundle") ?? "").slice(0, 200);
  const rows = (await db.prepare("SELECT entry FROM tweak_entries WHERE source = ? AND entry IS NOT NULL").bind(src.key).all()).results ?? [];
  const tweaks = [];
  for (const r of rows) {
    let e = null;
    try { e = JSON.parse(r.entry); } catch { e = null; }
    if (e && forBundle(e, bundle)) tweaks.push(e);
  }
  const fresh = row ? await sourceRow(db, src.key) : null;
  return json({ enabled: true, source: src.key, known: Boolean(fresh), refreshed: fresh?.refreshed ?? 0, pending: fresh?.pending ?? 0,
    // still being read (a first answer, or .debs left): not cached, so the next ask sees what the pass found
    ...(fresh?.error ? { error: fresh.error } : {}), tweaks }, 200, !fresh?.refreshed || fresh?.pending ? "no-store" : "public, max-age=300");
}

// F398: GET /api/tweaks.json. -> the file's response, or a 404 when there is none.
async function indexFileText(env) {
  const db = env.TWEAKS;
  if (db) {
    try {
      await schema(db);
      const sources = (await db.prepare("SELECT key, refreshed, pending, error FROM tweak_sources ORDER BY added, key").all()).results ?? [];
      const entries = (await db.prepare("SELECT source, entry, checked FROM tweak_entries WHERE entry IS NOT NULL ORDER BY rowid").all()).results ?? [];
      const file = packIndexFile(sources, entries);
      if (file) return { text: JSON.stringify(file), live: true };
    } catch (e) { console.log(`tweak index file: ${e?.message ?? e}`); }
  }
  try {
    const r = env.ASSETS ? await env.ASSETS.fetch(new Request(`https://assets.local/${FILE_NAME}`)) : null;
    const text = r?.ok ? await r.text() : "";
    if (parseIndexFile(text)) return { text, live: false }; // the single-page fallback answers HTML
  } catch { /* no copy */ }
  return null;
}

export async function tweakIndexFile(req, env, ctx = null, { cache = env.LOOKUP_CACHE ?? globalThis.caches?.default ?? null } = {}) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET") return json({ code: "bad_method", error: "GET only." }, 405);
  const key = new Request(new URL(FILE_PATH, req.url).href); // no query: one entry whatever is appended
  const hit = env.TWEAKS ? await cache?.match(key).catch(() => null) : null;
  if (hit) return hit;
  const file = await indexFileText(env);
  if (!file) return json({ code: "no_index", error: "This server has no Tweak Index." }, 404);
  const res = new Response(file.text, { headers: { "Content-Type": "application/json", "X-Content-Type-Options": "nosniff",
    // the deployed copy only stands in while D1 fails: not kept long
    "Cache-Control": `public, max-age=${file.live || !env.TWEAKS ? FILE_FRESH_S : 60}`, ...CORS } });
  if (cache && file.live) {
    const put = Promise.resolve(cache.put(key, res.clone())).catch(() => {});
    if (ctx?.waitUntil) ctx.waitUntil(put); else await put;
  }
  return res;
}

// The cron: the bundled inject sources seeded, then the sources with the most left (or the stalest) worked through.
export async function scheduled(event, env, ctx, { fetcher = env.FETCH ?? globalThis.fetch } = {}) {
  const db = env.TWEAKS;
  if (!db) return { enabled: false };
  await schema(db);
  try {
    const r = env.ASSETS ? await env.ASSETS.fetch(new Request("https://assets.local/tweak-sources.json")) : null;
    const list = r?.ok ? await r.json() : [];
    for (const s of Array.isArray(list) ? list : []) {
      if (s?.inject !== true) continue;
      const src = indexSource(s);
      if (src) await addSource(db, src);
    }
  } catch { /* no bundled list: the sources the apps asked about */ }
  let budget = Math.max(0, Number(env.TWEAK_INDEX_PER_RUN ?? PER_RUN) || 0);
  const stale = now() - REFRESH_S;
  const rows = (await db.prepare("SELECT * FROM tweak_sources ORDER BY (pending > 0 OR refreshed < ?) DESC, refreshed ASC LIMIT 5")
    .bind(stale).all()).results ?? [];
  let checked = 0, sources = 0;
  for (const row of rows) {
    if (budget <= 0) break;
    const src = indexSource({ uri: row.uri, dist: row.dist, components: row.components }, row.arch);
    if (!src) continue;
    if (row.pending <= 0 && row.refreshed >= stale) continue;
    // a source's Packages (up to 4 tries a component) count against the run's fetches, as its .debs do
    if (budget < 4) break;
    const r = await indexPass(env, src, { budget, cap: budget, fetcher });
    budget -= Math.max(1, r.fetches ?? 0);
    checked += r.checked;
    sources++;
  }
  console.log(`tweak index: ${sources} sources, ${checked} .debs checked`);
  return { enabled: true, sources, checked };
}
