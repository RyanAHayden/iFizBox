// Featured banners (F20): a repo's `sileo-featured.json`, Sileo's format (https://developer.getsileo.app/sileo-featured),
// drawn on the source's page and, a few from each source, on Home. Pure JS, no DOM.
//
//   featuredUrl(source)              -> "<repo>/sileo-featured.json" (the repo's URI, as Sileo asks it)
//   parseFeatured(text|json, base)   -> { itemSize: { width, height }, radius, banners: [{ url, title, package,
//                                        hideShadow, displayText }] } or null when it isn't a banner list
//   createFeaturedStore({ getText, storage, ttl, now })
//     .get(source)                   -> the parsed banners (cached; a repo without the file caches as null)
//     .forHome(sources, perSource)   -> [{ ...banner, key, source }] a few from each source, in list order
//   bannersInCatalog(banners, has)   -> the banners whose package `has(id)` (async ok) finds, in order (B182)
//
// Chariz and Havoc (both default sources) serve this exact shape on 2026-11-17: class FeaturedBannersView,
// itemSize "{263, 148}", itemCornerRadius 10, banners [{ url, title, package }] (Chariz adds displayText: false,
// its titles are in the image). Every field from the repo is checked: images http(s) only, package names as dpkg
// allows them, titles plain text (screens set them with textContent).

const FEATURED_FILE = "sileo-featured.json";
export const DEFAULT_ITEM_SIZE = { width: 263, height: 148 };
const DEFAULT_RADIUS = 10;
export const MAX_BANNERS = 20;
const TTL = 6 * 60 * 60 * 1000; // banners change rarely; Home asks every source, so keep them a few hours
const PKG = /^[a-z0-9][a-z0-9+._-]*$/i;

export function featuredUrl(source) {
  const uri = String(source?.uri ?? "");
  if (!/^https?:\/\//i.test(uri)) return null;
  return uri.replace(/\/*$/, "/") + FEATURED_FILE;
}

// "{263, 148}" (Sileo's CGSize string), [263, 148] or { width, height }; anything else (or absurd) -> default.
export function parseSize(v) {
  let w, h;
  if (typeof v === "string") {
    const m = v.match(/^\s*\{\s*([\d.]+)\s*,\s*([\d.]+)\s*\}\s*$/);
    if (m) [w, h] = [Number(m[1]), Number(m[2])];
  } else if (Array.isArray(v)) [w, h] = v.map(Number);
  else if (v && typeof v === "object") [w, h] = [Number(v.width), Number(v.height)];
  if (w > 0 && h > 0 && w <= 1000 && h <= 1000) return { width: w, height: h };
  return { ...DEFAULT_ITEM_SIZE };
}

function imageUrl(u, base) {
  if (typeof u !== "string" || !u.trim()) return null;
  let url;
  try { url = new URL(u.trim(), base || undefined); } catch { return null; }
  return /^https?:$/.test(url.protocol) ? url.href : null;
}

const text = (v, max = 120) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export function parseFeatured(input, base = null) {
  let j = input;
  if (typeof input === "string") {
    try { j = JSON.parse(input); } catch { return null; }
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  // Sileo's own class is FeaturedBannersView; a missing class with a banners array is read the same way.
  if (j.class != null && j.class !== "FeaturedBannersView") return null;
  if (!Array.isArray(j.banners)) return null;
  const banners = [];
  for (const b of j.banners) {
    if (!b || typeof b !== "object") continue;
    const url = imageUrl(b.url, base);
    const pkg = typeof b.package === "string" ? b.package.trim() : "";
    if (!url || !PKG.test(pkg)) continue;
    banners.push({ url, title: text(b.title) || pkg, package: pkg, hideShadow: b.hideShadow === true,
      displayText: b.displayText !== false });
    if (banners.length >= MAX_BANNERS) break;
  }
  const r = Number(j.itemCornerRadius);
  return { itemSize: parseSize(j.itemSize), radius: r >= 0 && r <= 100 ? r : DEFAULT_RADIUS, banners };
}

// B182: the banners whose package `has(id)` finds in the source's loaded catalog, in order. A repo's banners can name
// packages this build never loads: the sideload app keeps only a Tweak Source's injectable tweaks (Chariz's
// SpringBoard tweaks drop out), and the jailbreak app only this arch's. Those tiles would open "Package not found",
// so they are left out, and so is a tweak its lists hide (B391, core/catalog.js shows). `has` may be async; each id is asked once; a lookup that throws counts as missing.
export async function bannersInCatalog(banners, has) {
  const list = Array.isArray(banners) ? banners : [];
  const asked = new Map();
  const found = (id) => {
    if (!asked.has(id)) asked.set(id, Promise.resolve().then(() => has(id)).then(Boolean, () => false));
    return asked.get(id);
  };
  const keep = await Promise.all(list.map((b) => found(b?.package)));
  return list.filter((_, i) => keep[i]);
}

// `getText(url)` fetches (backend.text); a failure (404, not JSON) is remembered as "none" for the same `ttl`, so
// sources without banners cost one request every few hours. `storage` (localStorage) keeps them across launches.
export function createFeaturedStore({ getText, storage = globalThis.localStorage, ttl = TTL, now = () => Date.now() } = {}) {
  const mem = new Map();
  const inflight = new Map();
  const skey = (url) => "ifizbox.featured:" + url;

  function cached(url) {
    let e = mem.get(url);
    if (!e && storage) {
      try { e = JSON.parse(storage.getItem(skey(url)) || "null"); } catch { e = null; }
      if (e) mem.set(url, e);
    }
    return e && now() - e.at < ttl ? e : null;
  }

  function keep(url, data) {
    const e = { at: now(), data };
    mem.set(url, e);
    try { storage?.setItem(skey(url), JSON.stringify(e)); } catch { /* full or private mode: memory only */ }
  }

  async function get(source) {
    const url = featuredUrl(source);
    if (!url) return null;
    const hit = cached(url);
    if (hit) return hit.data;
    if (inflight.has(url)) return inflight.get(url);
    const p = (async () => {
      let data = null;
      try { data = parseFeatured(await getText(url), url); } catch { data = null; }
      if (data && !data.banners.length) data = null;
      keep(url, data);
      return data;
    })().finally(() => inflight.delete(url));
    inflight.set(url, p);
    return p;
  }

  async function forHome(sources, perSource = 2, max = 12) {
    const apt = (sources ?? []).filter((s) => s && !s.error && featuredUrl(s) && s.kind !== "altstore");
    const all = await Promise.all(apt.map((s) => get(s).catch(() => null)));
    const out = [];
    // Round-robin: every source's first banner before anyone's second, so one big repo can't fill Home.
    for (let i = 0; i < perSource && out.length < max; i++) {
      apt.forEach((s, n) => {
        const b = all[n]?.banners[i];
        if (b && out.length < max) out.push({ ...b, key: s.key, source: s });
      });
    }
    return out;
  }

  return { get, forHome, clear: () => mem.clear() };
}
