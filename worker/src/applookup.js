// F455: App Store ratings for many apps at once (Popular's third tier). Apple's iTunes lookup takes a comma-separated
// bundleId list; this answers { resultCount, results: [{ bundleId, trackName, averageUserRating, userRatingCount }] } for the ones
// it knows, the whole list's answer cached at the edge a day like /api/applookup. One cache read and one write a
// request, not one an app: the Cache API's calls per request are limited (50 on the free plan).
// SPDX-License-Identifier: GPL-3.0-or-later

export const LOOKUP_TTL_S = 86400;
export const MAX_BATCH = 50;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status,
  headers: { "Content-Type": "application/json", "X-Content-Type-Options": "nosniff", ...CORS, ...extra } });
const fail = (code, error, status = 400) => json({ code, error }, status, { "Cache-Control": "no-store" });

// F457: trackName, so Popular can tell the App Store's app from a modded one under its bundle ID.
const slimOf = (r) => ({ bundleId: r.bundleId, trackName: typeof r.trackName === "string" ? r.trackName.slice(0, 200) : "", averageUserRating: Number(r.averageUserRating) || 0, userRatingCount: Number(r.userRatingCount) || 0 });

export async function appLookupBatch(u, env = {}, { fetcher = fetch, cache = env.LOOKUP_CACHE ?? globalThis.caches?.default ?? null } = {}) {
  const ids = [...new Set((u.searchParams.get("bundleIds") ?? "").toLowerCase().split(",").filter(Boolean))].sort();
  const country = (u.searchParams.get("country") || "us").toLowerCase();
  if (!ids.length || ids.length > MAX_BATCH || !ids.every((x) => /^[a-z0-9.-]{1,155}$/.test(x)) || !/^[a-z]{2}$/.test(country)) {
    return fail("bad_request", `Send 1 to ${MAX_BATCH} bundleIds and a two-letter country.`);
  }
  const bundleId = ids.join(",");
  const key = new Request(`https://applookup-batch.ifizbox.internal/v2/${country}?${new URLSearchParams({ bundleIds: bundleId })}`);
  const hit = cache ? await cache.match(key).catch(() => null) : null;
  if (hit) return hit;
  let body;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    try {
      const r = await fetcher(`https://itunes.apple.com/lookup?${new URLSearchParams({ bundleId, country })}`,
        { headers: { Accept: "application/json" }, cf: { cacheEverything: true, cacheTtl: LOOKUP_TTL_S }, signal: ctl.signal });
      if (!r.ok) return fail("upstream", `The App Store answered HTTP ${r.status}.`, 502);
      body = JSON.parse(await r.text());
    } finally { clearTimeout(timer); }
  } catch { return fail("upstream", "The App Store didn't answer.", 502); }
  if (!Array.isArray(body?.results)) return fail("upstream", "The App Store's answer wasn't a lookup.", 502);
  const results = body.results.filter((r) => typeof r?.bundleId === "string").map(slimOf);
  const res = json({ resultCount: results.length, results }, 200, { "Cache-Control": `public, max-age=${LOOKUP_TTL_S}` });
  if (cache) await cache.put(key, res.clone()).catch(() => {});
  return res;
}
