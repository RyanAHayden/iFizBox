// F161: an IPA app's App Store details, looked up by bundle ID on Apple's public iTunes Search API, and the app
// page's Links group. Pure JS, no DOM: screens/altstore.js renderApp draws them. Full details are looked up only for an
// app page that is opened; a list (Popular, F455) asks for stars alone, in batches. SPDX-License-Identifier: GPL-3.0-or-later
//
//   lookupUrl(bundleId, country)          -> https://itunes.apple.com/lookup?bundleId=…&country=… (null: bad input)
//   workerLookupUrl(bundleId, country)    -> /api/applookup?… (the website asks the Worker: cached at the edge a day)
//   batchLookupUrl(ids, country, { direct }) / parseBatch(json | text) / storeRatingsLoader(...): F455, see below
//   regionOf(locale)                      -> "gb" from "en-GB", else "us"
//   parseLookup(json | text)              -> { trackViewUrl, developer, category, rating, ratingCount, screenshots,
//                                              description, version, minimumOs, trackName } or null (not found)
//   lookupNeed(app, ownLinks)             -> "none" | "link" | "full": "none" when the source gives screenshots,
//                                              developer and the app's own page; "link" when it gives screenshots and
//                                              developer (only the App Store link is used); else "full"
//   mergeDetails(app, store, need)        -> what the page shows from the App Store; the source's fields win
//   pageLinks({ ownLinks, store, source, sourceWebsite, appUrls })
//                                         -> [{ kind, label, detail, url? }] never two rows to one page:
//                                              1) the app's own page (its GitHub/website, else the App Store page)
//                                              2) the source (kind "source": opens its page in iFizBox)
//                                              3) the source's website, only when it isn't a page already listed
//   ownPageLinks(app, links)              -> appLinks(app) without a GitHub repo found only through the IPA's download
//                                              URL and not named for the app (a source's many-app repo: AppTesters_Repo)
//   shortText(text, max)                  -> the first paragraphs up to about `max` characters, or null when it all fits
//   lookupApp(bundleId, { country, get, store, now }) -> Promise<parsed | null>, cached per bundle ID for a week
//                                              in `store` (localStorage-like); a failed fetch is not cached
//   storeTrackId(store)                   -> parseLookup's trackId, else the id in its trackViewUrl, else null (B37)
//   reviewsFeedUrl(id, country)           -> Apple's customer-reviews RSS (JSON), newest first (null: bad input)
//   workerReviewsUrl(id, country)         -> /api/appreviews?… (the website asks the Worker: cached at the edge a day)
//   parseStoreReviews(json | text, now)   -> [{ appStore: true, title, author, rating, version, date, text }] plain
//                                              text, newest first, at most 50; [] when it isn't the feed
//   storeReviews(id, { country, get, now }) -> Promise<[review]>, kept in memory a day per id; [] when it fails

import { KEY_PREFIXES } from "./storagekeys.js";

const str = (v) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const httpsUrl = (u) => (/^https?:\/\//i.test(str(u)) ? str(u).replace(/^http:/i, "https:") : null);
const BUNDLE = /^[A-Za-z0-9.-]{1,155}$/;

export const LOOKUP_TTL = 7 * 24 * 3600 * 1000;
const PREFIX = KEY_PREFIXES.appLookup;

const country = (c) => (/^[a-z]{2}$/.test(str(c).toLowerCase()) ? str(c).toLowerCase() : "us");

export function lookupUrl(bundleId, c = "us") {
  if (!BUNDLE.test(str(bundleId))) return null;
  return `https://itunes.apple.com/lookup?${new URLSearchParams({ bundleId: str(bundleId), country: country(c) })}`;
}

export function workerLookupUrl(bundleId, c = "us", base = "") {
  if (!BUNDLE.test(str(bundleId))) return null;
  return `${base}/api/applookup?${new URLSearchParams({ bundleId: str(bundleId), country: country(c) })}`;
}

// F455: many apps' App Store stars at once (Popular's third tier). The Worker's /api/applookup-batch on the site, Apple
// directly (the same comma-separated bundleId list) in the app; at most BATCH ids a request (Apple sends ~10 KB an app).
export const BATCH = 50;
export function batchLookupUrl(ids, c = "us", { base = "", direct = false } = {}) {
  const list = [...new Set((ids ?? []).map(str))].filter((x) => BUNDLE.test(x)).sort().slice(0, BATCH);
  if (!list.length) return null;
  return direct ? `https://itunes.apple.com/lookup?${new URLSearchParams({ bundleId: list.join(","), country: country(c) })}`
    : `${base}/api/applookup-batch?${new URLSearchParams({ bundleIds: list.join(","), country: country(c) })}`;
}
// A batch answer (JSON or text) -> { <bundle id, lower case>: [average, count] }, the rated apps only; null when it
// isn't a lookup answer.
export function parseBatch(input) {
  let json = input;
  if (typeof input === "string") { try { json = JSON.parse(input); } catch { return null; } }
  if (!Array.isArray(json?.results)) return null;
  const out = {};
  for (const r of json.results) {
    const avg = Number(r?.averageUserRating);
    if (typeof r?.bundleId === "string" && Number.isFinite(avg) && avg > 0) out[r.bundleId.toLowerCase()] = [Math.min(5, avg), Number(r.userRatingCount) || 0];
  }
  return out;
}

export const STORE_RATINGS_TTL = 24 * 3600 * 1000;
// -> load(bundleIds, wait ms) -> Promise<{ <bundle id, lower case>: [average, count] }>. get(url) -> Promise<text>.
// An answer (an app with no stars too) is kept a day, in `store` (localStorage-like) across launches; a failed request
// isn't kept. After `wait` it answers with what it has; the requests go on and are there next time.
export function storeRatingsLoader({ get, country: c = "us", direct = false, store = null, now = () => Date.now() }) {
  const key = `ifizbox.storeratings.${country(c)}`;
  const kept = new Map(); // id -> [asked at, [average, count] | null]
  const busy = new Map(); // id -> the request asking for it
  const fresh = (id) => kept.has(id) && now() - kept.get(id)[0] < STORE_RATINGS_TTL;
  try {
    for (const [id, v] of Object.entries(JSON.parse(store?.getItem(key) ?? "{}"))) if (Array.isArray(v)) kept.set(id, v);
  } catch { /* unreadable: ask again */ }
  const save = () => {
    try { store?.setItem(key, JSON.stringify(Object.fromEntries([...kept.keys()].filter(fresh).map((id) => [id, kept.get(id)])))); } catch { /* full or private: memory only */ }
  };
  async function ask(part) {
    try {
      const got = parseBatch(await get(batchLookupUrl(part, c, { direct })));
      if (!got) return;
      for (const id of part) kept.set(id, [now(), got[id] ?? null]);
      save();
    } catch { /* asked again next time */ } finally { for (const id of part) busy.delete(id); }
  }
  return async function load(bundleIds, wait = 3000) {
    const ids = [...new Set(bundleIds.map((i) => str(i).toLowerCase()))].filter((i) => BUNDLE.test(i));
    const want = ids.filter((i) => !fresh(i) && !busy.has(i)).sort();
    for (let n = 0; n < want.length; n += BATCH) {
      const part = want.slice(n, n + BATCH);
      const work = ask(part);
      for (const id of part) busy.set(id, work);
    }
    const waiting = [...new Set(ids.map((i) => busy.get(i)).filter(Boolean))];
    let timer;
    if (waiting.length) await Promise.race([Promise.all(waiting), new Promise((done) => { timer = setTimeout(done, wait); })]);
    clearTimeout(timer);
    return Object.fromEntries(ids.filter((i) => fresh(i) && kept.get(i)[1]).map((i) => [i, kept.get(i)[1]]));
  };
}

// The device's region from its locale ("en-GB" -> "gb", "zh-Hant-TW" -> "tw"); "us" when it names none.
export function regionOf(locale) {
  const parts = str(locale).replace(/_/g, "-").split("-").slice(1);
  const r = parts.find((p) => /^[A-Za-z]{2}$/.test(p));
  return r ? r.toLowerCase() : "us";
}

export function parseLookup(input) {
  let json = input;
  if (typeof input === "string") { try { json = JSON.parse(input); } catch { return null; } }
  const r = Array.isArray(json?.results) ? json.results.find((x) => x && (x.trackViewUrl || x.bundleId)) : null;
  if (!r) return null;
  const rating = Number(r.averageUserRating);
  return {
    trackName: str(r.trackName),
    trackId: /^\d{1,15}$/.test(str(r.trackId)) ? str(r.trackId) : null,
    trackViewUrl: httpsUrl(r.trackViewUrl),
    developer: str(r.artistName) || str(r.sellerName),
    category: str(r.primaryGenreName),
    rating: Number.isFinite(rating) && rating > 0 ? Math.min(5, rating) : null,
    ratingCount: Number.isFinite(Number(r.userRatingCount)) && Number(r.userRatingCount) > 0 ? Number(r.userRatingCount) : null,
    screenshots: (Array.isArray(r.screenshotUrls) ? r.screenshotUrls : []).map(httpsUrl).filter(Boolean),
    description: str(r.description),
    version: str(r.version),
    minimumOs: str(r.minimumOsVersion),
  };
}

const hasShots = (app) => (Array.isArray(app?.screenshots) && app.screenshots.length > 0)
  || (Array.isArray(app?.screenshotURLs) && app.screenshotURLs.length > 0);

export function lookupNeed(app, ownLinks = []) {
  const full = hasShots(app) && Boolean(str(app?.developerName));
  if (!full) return "full";
  return ownLinks.length ? "none" : "link";
}

// AltStore's category ids as the source gives them ("photo-video"), else null.
const sourceCategory = (app) => str(app?.category) || null;
const sameText = (a, b) => str(a).replace(/\s+/g, " ").toLowerCase() === str(b).replace(/\s+/g, " ").toLowerCase();

// What the page adds from the App Store, each only where the source has nothing of its own:
//   developer (source developerName wins), category (source category wins), rating (the App Store's own),
//   screenshots (only when the source lists none), description (under the source's, unless it's the same text),
//   version and minimumOs (facts: the App Store's, beside the source's own version).
// need "link": the App Store link and its rating only (the source gave screenshots and developer). B37: the rating is
// the App Store's whatever `need` is (a source never has one of its own).
export function mergeDetails(app, store, need = "full") {
  const out = { developer: null, category: null, rating: null, ratingCount: null, screenshots: [], description: null,
    version: null, minimumOs: null, trackViewUrl: store?.trackViewUrl ?? null };
  if (!store) return out;
  if (store.rating != null) { out.rating = store.rating; out.ratingCount = store.ratingCount ?? null; }
  if (need !== "full") return out;
  if (!str(app?.developerName) && store.developer) out.developer = store.developer;
  if (!sourceCategory(app) && store.category) out.category = store.category;
  if (!hasShots(app)) out.screenshots = store.screenshots;
  if (store.description && !sameText(store.description, app?.localizedDescription)) out.description = store.description;
  out.version = store.version || null;
  out.minimumOs = store.minimumOs || null;
  return out;
}

// One page, however it is spelled: http/https, www., trailing slash, case, and a query only Apple's links carry.
export function pageKey(url) {
  try {
    const u = new URL(str(url));
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    // github.com/o/r and github.com/o/r/releases/… are one repo's page for this purpose
    if (host === "github.com" || host === "raw.githubusercontent.com") {
      const [o, r] = path.split("/").filter(Boolean);
      if (o && r) return `github.com/${o}/${r.replace(/\.git$/, "")}`;
    }
    if (host === "apps.apple.com" || host === "itunes.apple.com") {
      const id = /\/id(\d+)/.exec(path);
      if (id) return `apps.apple.com/id${id[1]}`;
    }
    return host + path;
  } catch { return null; }
}

// ownLinks: core/previews.js appLinks(app) ({ kind, label, detail, url }); store: parseLookup's; source:
// { label, subtitle, href } (href null when the page came from that source's page); sourceWebsite: the source's
// website (its JSON's website); appUrls: other URLs that are the source's, never the app's (its JSON's URL).
export function pageLinks({ ownLinks = [], store = null, source = null, sourceWebsite = null, appUrls = [] } = {}) {
  const out = [];
  const seen = new Set();
  const sourceKeys = new Set([sourceWebsite, ...appUrls].map(pageKey).filter(Boolean));
  const add = (row, url) => {
    const k = url ? pageKey(url) : null;
    if (url && (!k || seen.has(k))) return false;
    if (k) seen.add(k);
    out.push(row);
    return true;
  };
  // 1) the app's own page: a link of its own that isn't the source's page; else the App Store page.
  let own = 0;
  for (const l of ownLinks) {
    const k = pageKey(l.url);
    if (!k || sourceKeys.has(k)) continue;
    if (add({ kind: l.kind, label: l.label, detail: l.detail || l.url, url: l.url }, l.url)) own++;
  }
  if (!own && store?.trackViewUrl) add({ kind: "appstore", label: "App Store", detail: store.developer || "apps.apple.com", url: store.trackViewUrl }, store.trackViewUrl);
  // 2) the source, as a page in iFizBox (its other apps)
  if (source) out.push({ kind: "source", label: source.label, detail: source.subtitle || null, href: source.href ?? null });
  // 3) its website, only when it is a page not listed yet
  const site = httpsUrl(sourceWebsite);
  if (site) add({ kind: "website", label: "Source Website", detail: hostOf(site), url: site }, site);
  return out;
}

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; }
}

const squash = (v) => str(v).toLowerCase().replace(/[^a-z0-9]/g, "");
const repoOf = (url) => /^https:\/\/github\.com\/([^/]+)\/([^/?#]+)/i.exec(str(url));

export function ownPageLinks(app, links = []) {
  const x = app?.extra ?? {};
  // the app's link fields only: not its icon, pictures or download (they live in the source's repo), nor sourceUrl
  // (the source's own JSON; sourceURL, a code link, does count)
  const linkField = ([k, v]) => typeof v === "string" && k !== "sourceUrl" && !/icon|image|header|screenshot|download/i.test(k);
  const named = [...Object.entries(x), ...Object.entries(app ?? {})].filter(linkField).map(([, v]) => v.toLowerCase());
  return links.filter((l) => {
    if (l.kind !== "github") return true;
    const m = repoOf(l.url);
    if (!m) return true;
    const path = `github.com/${m[1]}/${m[2]}`.toLowerCase();
    // the app's own fields link the repo page (not a file in it: a release download, a raw icon, ESign's `down`)
    if (named.some((v) => v.includes(path) && !/\/(releases\/download|raw|blob)\//.test(v))) return true;
    const r = squash(m[2]), n = squash(app?.name);
    return r.length > 2 && n.length > 2 && (r.includes(n) || n.includes(r)); // a release repo named for the app
  });
}

export function shortText(text, max = 320) {
  const t = str(text);
  if (t.length <= max * 1.3) return null;
  const paras = t.split(/\n+/);
  let out = "";
  for (const p of paras) {
    if (out && out.length + p.length > max) break;
    out = out ? `${out}\n\n${p}` : p;
  }
  if (out.length > max * 1.3) out = `${out.slice(0, max).replace(/\s+\S*$/, "")}…`;
  return out.length < t.length ? out : null;
}

// ---- Loading (cached per bundle ID for a week) -----------------------------------------------------------------

const memory = new Map();
export function clearLookupMemory() { memory.clear(); }

// get(bundleId, country) -> Promise<text>: the Worker's /api/applookup on the site, Apple directly in the app.
export async function lookupApp(bundleId, { country: c = "us", get, store = null, now = Date.now() } = {}) {
  if (!BUNDLE.test(str(bundleId)) || typeof get !== "function") return null;
  const key = `${PREFIX}${country(c)}.${str(bundleId)}`;
  const m = memory.get(key);
  if (m && now - m.at < LOOKUP_TTL) return m.app;
  try {
    const raw = store?.getItem(key);
    const v = raw ? JSON.parse(raw) : null;
    if (v && typeof v.at === "number" && now - v.at < LOOKUP_TTL && "app" in v) { memory.set(key, v); return v.app; }
  } catch { /* unreadable: look it up again */ }
  const app = parseLookup(await get(str(bundleId), country(c)));
  const v = { at: now, app };
  memory.set(key, v);
  try { store?.setItem(key, JSON.stringify(v)); } catch { /* full or private: memory only */ }
  return app;
}

// ---- B37: the App Store's written reviews (Apple's customer-reviews RSS, JSON) ----------------------------------

const TRACK = /^\d{1,15}$/;

export function storeTrackId(store) {
  if (TRACK.test(str(store?.trackId))) return str(store.trackId);
  const m = /\/id(\d{1,15})(?:[/?#]|$)/.exec(str(store?.trackViewUrl));
  return m ? m[1] : null;
}

export function reviewsFeedUrl(id, c = "us") {
  if (!TRACK.test(str(id))) return null;
  return `https://itunes.apple.com/${country(c)}/rss/customerreviews/id=${str(id)}/sortby=mostrecent/json`;
}

export function workerReviewsUrl(id, c = "us", base = "") {
  if (!TRACK.test(str(id))) return null;
  return `${base}/api/appreviews?${new URLSearchParams({ id: str(id), country: country(c) })}`;
}

// Every field is { label: "…" } in Apple's feed; one entry alone comes as an object, not a list. An older feed puts
// the app itself first (no im:rating): skipped. Text stays plain (the tab draws it with textContent).
const label = (v) => str(v?.label);
export function parseStoreReviews(input) {
  let json = input;
  if (typeof input === "string") { try { json = JSON.parse(input); } catch { return []; } }
  let entries = json?.feed?.entry;
  if (entries && !Array.isArray(entries)) entries = [entries];
  if (!Array.isArray(entries)) return [];
  const out = [];
  for (const e of entries) {
    const rating = Number(label(e?.["im:rating"]));
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) continue;
    const at = Date.parse(label(e?.updated));
    out.push({ appStore: true, title: label(e?.title).slice(0, 200), author: label(e?.author?.name).slice(0, 100) || null, rating,
      version: label(e?.["im:version"]).slice(0, 64) || null, at: Number.isFinite(at) ? at : null, text: label(e?.content).slice(0, 6000) });
    if (out.length >= 50) break;
  }
  return out.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

const reviewMemory = new Map();
export const STORE_REVIEWS_TTL = 24 * 3600 * 1000;
// get(id, country) -> Promise<text>: the Worker's /api/appreviews on the site, Apple directly in the app.
export async function storeReviews(id, { country: c = "us", get, now = Date.now() } = {}) {
  if (!TRACK.test(str(id)) || typeof get !== "function") return [];
  const key = `${country(c)}.${str(id)}`;
  const m = reviewMemory.get(key);
  if (m && now - m.at < STORE_REVIEWS_TTL) return m.reviews;
  let reviews;
  try { reviews = parseStoreReviews(await get(str(id), country(c))); } catch { return []; }
  reviewMemory.set(key, { at: now, reviews });
  return reviews;
}
export function clearStoreReviewsMemory() { reviewMemory.clear(); }
