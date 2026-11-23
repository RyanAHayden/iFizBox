// Cross-repo discovery through Canister (F20): packages from sources the user hasn't added, each with its source so
// Search can offer Add Source. Pure JS, no DOM; the caller hands in `getJson` (the site: through the F3 proxy; the
// app: the shell's fetch).
//
//   searchUrl(q, { limit, page })      -> https://api.canister.me/v2/jailbreak/package/search?… (null under 2 chars)
//   askable(q)                         -> is q worth asking Canister about (2+ characters, counted as code points)
//   lookupUrl(id)                      -> …/v2/jailbreak/package/<id>  (every repo's copy of one package)
//   mapResults(json, { have, arch })   -> [{ id, name, description, author, version, section, price, paid, icon,
//                                         depiction, arch, archOk, tag, repo: { uri, name, slug, flat, dist,
//                                         components, added, key, tier, bootstrap } }]
//   priceFor(json, repoUri)            -> the price Canister lists for that repo's copy ("$1.99"), or null
//   normalRepo(uri)                    -> how two repo URIs are compared (scheme, case and trailing / ignored)
//   createCanister({ getJson, ttl, now, max })  .search(q) / .lookup(id), cached, one request per key at a time
//
// The API (github.com/cnstr/api, crates/api/src/routes/package/search.rs): q at least 2 characters, limit 1-250
// (default 100), page from 1; answers { status, refs: { nextPage }, count, data: [...] }. On 2026-11-17
// api.canister.me answers 308 to api.tale.me/v4/canister-services/…, which both fetchers follow, and sends
// Access-Control-Allow-Origin: *. Canister publishes no terms or rate limits (checked: the API's source has no
// limiter, docs.canister.me states none); be gentle anyway: Search asks only after typing stops, only for 2+
// characters, at most 50 results, and every answer is kept 10 minutes.
//
// One character (F106, checked live 2026-11-18): local search takes it (core/catalog.js searchable()), but
// Canister doesn't. Its 2-character check counts UTF-8 bytes, so "微" passes with 200, yet it finds
// nothing: 微, 中, 汉, 化 and é all answered count 0 while 微信 found 5 packages and 中文 1. Asking would cost a
// request per pause for an empty answer, so Canister keeps the 2-character rule, counted in characters (an emoji
// or a CJK Extension B character is one character but two UTF-16 units).

import { plainText } from "./plaintext.js";

export const CANISTER = "https://api.canister.me/v2/jailbreak";
const SEARCH_LIMIT = 50;
const TTL = 10 * 60 * 1000;
const PKG = /^[a-z0-9][a-z0-9+._-]*$/i;

export function askable(q) {
  return [...String(q ?? "").trim()].length >= 2;
}

export function searchUrl(q, { limit = SEARCH_LIMIT, page = 1 } = {}) {
  const query = String(q ?? "").trim();
  if (!askable(query)) return null;
  const l = Math.min(250, Math.max(1, Math.floor(limit) || SEARCH_LIMIT));
  const p = Math.max(1, Math.floor(page) || 1);
  return `${CANISTER}/package/search?${new URLSearchParams({ q: query.slice(0, 100), limit: String(l), ...(p > 1 ? { page: String(p) } : {}) })}`;
}

export function lookupUrl(id) {
  if (!PKG.test(String(id ?? ""))) return null;
  return `${CANISTER}/package/${encodeURIComponent(id)}`;
}

export function normalRepo(uri) {
  const s = String(uri ?? "").trim();
  let u;
  try { u = new URL(s); } catch { return s.toLowerCase(); }
  return (u.host + u.pathname).toLowerCase().replace(/\/+$/, "");
}

const http = (u) => (typeof u === "string" && /^https?:\/\//i.test(u.trim()) ? u.trim() : null);
const str = (v, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
// "Name <mail@example.com>" -> "Name"
const person = (v) => str(v).replace(/\s*<[^>]*>\s*/g, " ").trim();
const isFree = (p) => !p || /^(free|0|\$?0(\.00)?)$/i.test(String(p).trim());

function repoOf(r, haveSet) {
  const uri = http(r?.uri);
  if (!uri) return null;
  const suite = str(r.suite) || "./";
  const flat = suite.endsWith("/");
  const components = typeof r.component === "string" && r.component ? r.component.split(/\s+/) : [];
  const n = normalRepo(uri);
  return { uri: uri.replace(/\/*$/, "/"), name: str(r.name, 80) || new URL(uri).host, slug: str(r.slug || r.id, 80),
    flat, dist: flat ? "./" : suite, components, added: haveSet.has(n), key: `deb:${uri.replace(/\/*$/, "/")}:${flat ? "./" : suite}`,
    ...trustFields(r) };
}

// F305: what Canister says of a repo that the trust label needs: its tier (1 best; the ranking's `quality`) and
// whether a jailbreak's package manager ships it (bootstrap / isbootstrap / isBootstrap).
function trustFields(r) {
  const tier = Number.isInteger(r?.tier) ? r.tier : Number.isInteger(r?.quality) ? r.quality : null;
  return { tier, bootstrap: r?.bootstrap === true || r?.isbootstrap === true || r?.isBootstrap === true };
}

function versionNewer(a, b) {
  // Canister marks the newest copy latest_version; fall back to a plain compare only to pick between two copies.
  return String(a ?? "").localeCompare(String(b ?? ""), "en", { numeric: true }) > 0;
}

// `have`: the user's sources ([{ uri }]) or their URIs; results from those repos are marked added (Search shows
// them elsewhere already and keeps them out). `arch`: the device's architecture; results built for another one
// keep archOk false and sort last.
export function mapResults(json, { have = [], arch = null } = {}) {
  const rows = Array.isArray(json?.data) ? json.data : [];
  const haveSet = new Set(have.map((h) => normalRepo(typeof h === "string" ? h : h?.uri)));
  const best = new Map();
  for (const x of rows) {
    if (!x || typeof x !== "object" || x.visible === false) continue;
    const id = str(x.package_id || x.package, 255);
    if (!PKG.test(id)) continue;
    const repo = repoOf(x.repository, haveSet);
    if (!repo) continue;
    const price = str(x.price, 20);
    const icon = http(x.icon_url);
    const item = {
      id, name: str(x.name, 120) || id, description: str(x.description, 300), author: person(x.author) || person(x.maintainer),
      version: str(x.version, 80), section: str(x.section, 80), tag: str(Array.isArray(x.tags) ? x.tags.join(", ") : (x.tags ?? x.tag), 300), price: isFree(price) ? null : price, paid: !isFree(price),
      icon, depiction: http(x.sileo_depiction) || http(x.native_depiction) || http(x.depiction),
      arch: str(x.architecture, 40), archOk: !arch || !x.architecture || x.architecture === arch || x.architecture === "all",
      latest: x.latest_version !== false, repo,
    };
    const k = id + "\n" + normalRepo(repo.uri);
    const cur = best.get(k);
    if (!cur || (item.archOk && !cur.archOk) || (item.archOk === cur.archOk && ((item.latest && !cur.latest)
      || (item.latest === cur.latest && versionNewer(item.version, cur.version))))) best.set(k, item);
  }
  // Canister's own order is by rank; keep it, but put packages for another architecture after the rest.
  const out = [...best.values()];
  return out.filter((r) => r.archOk).concat(out.filter((r) => !r.archOk)).map(({ latest, ...r }) => r);
}

// The lookup endpoint can leave repository.uri out (Havoc's copies on 2026-11-17 had only repository_id "havoc"):
// then a repository id/slug/name equal to `name` (the source's name, or its host's first label) counts too.
export function priceFor(json, repoUri, name = null) {
  const want = normalRepo(repoUri);
  let host = "";
  try { host = new URL(repoUri).hostname.replace(/^(www|repo|apt)\./, "").split(".")[0]; } catch { /* not a URL */ }
  const names = new Set([name, host].filter(Boolean).map((n) => String(n).toLowerCase()));
  const rows = Array.isArray(json?.data) ? json.data : [];
  const byUri = rows.filter((x) => normalRepo(x?.repository?.uri) === want);
  const byName = rows.filter((x) => !x?.repository?.uri
    && [x?.repository_id, x?.repository?.id, x?.repository?.slug, x?.repository?.name].some((v) => v && names.has(String(v).toLowerCase())));
  for (const x of byUri.length ? byUri : byName) {
    const p = str(x.price, 20);
    if (p) return isFree(p) ? "Free" : p;
  }
  return null;
}

// ---- F305: Canister's repository index (Find More Sources) ------------------------------------------------------
//
//   repoSearchUrl(q)                  -> …/repository/search?q=… (null under 2 characters). A word search: "chariz",
//                                        a host ("repo.chariz.com") or a word of the description; "poom" finds nothing
//   rankingUrl(rank)                  -> …/repository/ranking?rank=<1-5>: every repo of that tier (1: Procursus, Havoc,
//                                        Chariz on 2026-11-20; 2: 18 repos, BigBoss and ElleKit among them; 3: 321)
//   repoUrl(slug) / repoPackagesUrl(slug)  one repo / every package it has (the whole list: limit and page are
//                                        ignored, Chariz's is 1.5 MB)
//   repoFrom(r, { have })             -> a repo row: repoOf's fields plus count, description, https, gpg, payment
//   mapRepos(json, { have, blocked }) -> repo rows, piracy-listed ones left out (never offered), one per source key
//   popularRepos([json…], opts)       -> the Popular list: tiers 1 and 2 merged, empty repos out, most packages first
//   notForLite(uri)                   -> a repo the sideload build doesn't recommend (B389: Chariz)
//   liteRepos(rows, query)            -> rows without those, unless the query names one (its name, host or URL)
//   canisterSafe(repo)                -> { safe, why }: tier 1 or bootstrap (shipped by a jailbreak's package manager)
//   repoLabel(repo, { trusted })      -> { kind, label, why }: blocked | safe (our list) | canister | trusted | unknown
//   repoMatch(json, uri)              -> the search answer's repo at that URI (the safest one when several), or null
//   injectableResult(row)             -> core/tweaks.js injectableFromFields on a package result's Architecture,
//                                        Section and tags (Canister's results carry no Depends)
//   createRepoCache({ storage, now }) -> .get(uri) undefined (not asked) | null (not in Canister) | facts; .put(uri, r)
//
// The ranking's `quality` is the search's `tier` (Chariz: tier 1, quality 1); bootstrap repos answer bootstrap and
// isbootstrap true (Procursus, Elucubratus, ElleKit, palera1n…).

const SLUG = /^[a-z0-9][a-z0-9._-]*$/i;
export const POPULAR_RANKS = [1, 2];
export const CANISTER_SAFE_LABEL = "Known Safe · Canister";

export function repoSearchUrl(q, { limit = SEARCH_LIMIT } = {}) {
  const query = String(q ?? "").trim();
  if (!askable(query)) return null;
  const l = Math.min(250, Math.max(1, Math.floor(limit) || SEARCH_LIMIT));
  return `${CANISTER}/repository/search?${new URLSearchParams({ q: query.slice(0, 100), limit: String(l) })}`;
}

export function rankingUrl(rank) {
  const r = Math.floor(Number(rank));
  return r >= 1 && r <= 5 ? `${CANISTER}/repository/ranking?rank=${r}` : null;
}

export const repoUrl = (slug) => (SLUG.test(String(slug ?? "")) ? `${CANISTER}/repository/${encodeURIComponent(slug)}` : null);
export const repoPackagesUrl = (slug) => (SLUG.test(String(slug ?? "")) ? `${CANISTER}/repository/${encodeURIComponent(slug)}/packages` : null);

const haveSetOf = (have) => new Set((have ?? []).map((h) => normalRepo(typeof h === "string" ? h : h?.uri)));

export function repoFrom(r, { have = [] } = {}) {
  if (!r || typeof r !== "object" || r.visible === false) return null;
  const repo = repoOf(r, have instanceof Set ? have : haveSetOf(have));
  if (!repo) return null;
  const count = Number.isFinite(r.package_count) ? r.package_count : null;
  // B272: a repo's own emoji (NSCake 🧁) stay out of its name and description, as in every other row.
  return { ...repo, name: plainText(repo.name), slug: repo.slug || str(r.id, 80), count, description: plainText(str(r.description, 300)),
    https: typeof r.origin_uses_https === "boolean" ? r.origin_uses_https : /^https:/i.test(repo.uri),
    gpg: typeof r.origin_has_release_gpg === "boolean" ? r.origin_has_release_gpg : null,
    payment: r.origin_supports_payment_v1 === true || r.origin_supports_payment_v2 === true || Boolean(r.sileo_endpoint) };
}

const rank = (r) => (canisterSafe(r).safe ? 0 : 1) * 10 + (r.tier ?? 9);

export function mapRepos(json, { have = [], blocked = () => false } = {}) {
  const rows = Array.isArray(json?.data) ? json.data : json?.data && typeof json.data === "object" ? [json.data] : [];
  const haveSet = haveSetOf(have);
  const best = new Map();
  for (const x of rows) {
    const r = repoFrom(x, { have: haveSet });
    if (!r || blocked(r.uri)) continue;
    const cur = best.get(r.key);
    if (!cur || rank(r) < rank(cur)) best.set(r.key, r);
  }
  return [...best.values()];
}

export function popularRepos(jsons, opts = {}) {
  const seen = new Map();
  for (const j of jsons ?? []) for (const r of mapRepos(j, opts)) if (r.count && !seen.has(r.key)) seen.set(r.key, r);
  return [...seen.values()].sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.name.localeCompare(b.name));
}

// B389 (user 2026-11-23): almost nothing on Chariz works without a jailbreak, so the sideload build never recommends it.
// It stays in the jailbreak build, and Lite still finds it by name or URL; an added one is never touched.
const NOT_FOR_LITE = [{ domain: "chariz.com", name: "chariz" }];
const notForLiteEntry = (uri) => {
  let host;
  try { host = new URL(uri).hostname.toLowerCase(); } catch { return null; }
  return NOT_FOR_LITE.find((e) => host === e.domain || host.endsWith(`.${e.domain}`)) ?? null;
};
export const notForLite = (uri) => Boolean(notForLiteEntry(uri));
export function liteRepos(rows, query = "") {
  const q = String(query ?? "").toLowerCase();
  return rows.filter((r) => { const e = notForLiteEntry(r.uri); return !e || q.includes(e.name); });
}

export function canisterSafe(repo) {
  if (!repo) return { safe: false, why: null };
  if (repo.tier === 1) return { safe: true, why: "Canister Tier 1: one of the repos Canister ranks highest." };
  if (repo.bootstrap) return { safe: true, why: "A bootstrap repo: a jailbreak's package manager ships with it." };
  return { safe: false, why: null };
}

// `blocked(uri)`, `safe(uri)` (our known-safe list's entry or null) and `trusted(uri)` come from the caller
// (core/warnings.js sourceWarning, core/safe-sources.js knownSafe, core/trust.js), so this file stays free of them.
export function repoLabel(repo, { blocked = () => null, safe = () => null, trusted = () => false } = {}) {
  const uri = repo?.uri ?? "";
  if (blocked(uri)) return { kind: "blocked", label: "Blocked", why: "On the piracy list: never offered." };
  const own = safe(uri);
  if (own) return { kind: "safe", label: "Known Safe", why: own.reason || "On the known-safe list." };
  const c = canisterSafe(repo);
  if (c.safe) return { kind: "canister", label: CANISTER_SAFE_LABEL, why: c.why };
  if (trusted(uri)) return { kind: "trusted", label: "Trusted", why: "You marked it as Trusted." };
  return { kind: "unknown", label: "Unknown", why: repo?.tier ? `Canister Tier ${repo.tier}: not checked by anyone we know of.`
    : "Not on the known-safe list, and Canister doesn't rank it." };
}

export function repoMatch(json, uri) {
  const want = normalRepo(uri);
  const all = mapRepos(json).filter((r) => normalRepo(r.uri) === want);
  return all.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

// repoPackagesUrl's answer as mapResults rows of `repo` (a repoFrom row): its entries carry only repository_id.
export function mapRepoPackages(json, repo, opts = {}) {
  if (!repo?.uri) return [];
  const raw = { uri: repo.uri, suite: repo.flat ? "./" : repo.dist, component: (repo.components ?? []).join(" "), name: repo.name,
    slug: repo.slug, tier: repo.tier, bootstrap: repo.bootstrap };
  const rows = Array.isArray(json?.data) ? json.data : [];
  return mapResults({ data: rows.map((x) => (x && typeof x === "object" ? { ...x, repository: raw } : x)) }, opts);
}

// The host a repo is searched by (Canister's search finds a repo by its host name).
export function trustQuery(uri) {
  try { return new URL(String(uri ?? "").trim()).hostname.toLowerCase().replace(/^www\./, "") || null; } catch { return null; }
}

// Lazy import: core/tweaks.js is pure too, but big; only the sideload build's Search and repo page ask.
let tweaksMod = null;
export async function loadInjectable() {
  tweaksMod ??= await import("./tweaks.js");
  return (row) => injectableWith(tweaksMod.injectableFromFields, row);
}
export function injectableWith(check, row) {
  return check({ package: row?.id, architecture: row?.arch, section: row?.section, tag: row?.tag, description: row?.description }); // B185: libraries
}

export const REPO_CACHE_KEY = "ifizbox.canisterRepos";
export const REPO_TTL = 7 * 24 * 3600 * 1000;
const MISS_TTL = 24 * 3600 * 1000;
const REPO_CACHE_MAX = 300;
const FACTS = ["slug", "name", "uri", "tier", "bootstrap", "https", "gpg", "count"];

export function createRepoCache({ storage = null, now = () => Date.now() } = {}) {
  const read = () => {
    try { const v = JSON.parse(storage?.getItem(REPO_CACHE_KEY) ?? "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; }
  };
  let mem = read();
  return {
    get(uri) {
      const e = mem[normalRepo(uri)];
      if (!e || typeof e.at !== "number") return undefined;
      if (now() - e.at > (e.r ? REPO_TTL : MISS_TTL)) return undefined;
      return e.r ?? null;
    },
    put(uri, r) {
      const k = normalRepo(uri);
      if (!k) return;
      const facts = r ? Object.fromEntries(FACTS.map((f) => [f, r[f] ?? null])) : null;
      delete mem[k];
      mem[k] = { at: now(), r: facts };
      const keys = Object.keys(mem);
      for (const old of keys.slice(0, Math.max(0, keys.length - REPO_CACHE_MAX))) delete mem[old];
      try { storage?.setItem(REPO_CACHE_KEY, JSON.stringify(mem)); } catch { /* full or private: kept for the session */ }
    },
    reload() { mem = read(); },
  };
}

export function createCanister({ getJson, ttl = TTL, now = () => Date.now(), max = 50 } = {}) {
  const cache = new Map(); // url -> { at, data }, oldest first
  const inflight = new Map();
  async function get(url) {
    if (!url) return null;
    const hit = cache.get(url);
    if (hit && now() - hit.at < ttl) return hit.data;
    if (inflight.has(url)) return inflight.get(url);
    const p = Promise.resolve().then(() => getJson(url)).then((data) => {
      cache.delete(url);
      cache.set(url, { at: now(), data });
      while (cache.size > max) cache.delete(cache.keys().next().value);
      return data;
    }).finally(() => inflight.delete(url));
    inflight.set(url, p);
    return p;
  }
  return {
    search: (q, opts) => get(searchUrl(q, opts)),
    lookup: (id) => get(lookupUrl(id)),
    // F305: the repository index
    repos: (q) => get(repoSearchUrl(q)),
    ranking: (r) => get(rankingUrl(r)),
    repo: (slug) => get(repoUrl(slug)),
    packages: (slug) => get(repoPackagesUrl(slug)),
    size: () => cache.size,
  };
}
