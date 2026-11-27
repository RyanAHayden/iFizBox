// F455: App Store ratings for many apps at once (Popular's third tier). Apple's iTunes lookup takes a comma-separated
// bundleId list; this answers { results: [{ bundleId, averageUserRating, userRatingCount }] } for the ones it knows,
// each bundle ID cached at the edge a day like /api/applookup (one Apple request for all that are not cached).
// SPDX-License-Identifier: GPL-3.0-or-later

export const LOOKUP_TTL_S = 86400;
export const MAX_BATCH = 100;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status,
  headers: { "Content-Type": "application/json", "X-Content-Type-Options": "nosniff", ...CORS, ...extra } });
const fail = (code, error, status = 400) => json({ code, error }, status, { "Cache-Control": "no-store" });

const slimOf = (r) => ({ bundleId: r.bundleId, averageUserRating: Number(r.averageUserRating) || 0, userRatingCount: Number(r.userRatingCount) || 0 });

export async function appLookupBatch(u, env = {}, { fetcher = fetch, cache = env.LOOKUP_CACHE ?? globalThis.caches?.default ?? null } = {}) {
  const ids = [...new Set((u.searchParams.get("bundleIds") ?? "").split(",").filter(Boolean))];
  const country = (u.searchParams.get("country") || "us").toLowerCase();
  if (!ids.length || ids.length > MAX_BATCH || !ids.every((x) => /^[A-Za-z0-9.-]{1,155}$/.test(x)) || !/^[a-z]{2}$/.test(country)) {
    return fail("bad_request", `Send 1 to ${MAX_BATCH} bundleIds and a two-letter country.`);
  }
  const keyOf = (id) => new Request(`https://applookup-batch.ifizbox.internal/${country}/${encodeURIComponent(id)}`);
  const found = new Map(); // id -> slim | null (Apple has no such app)
  const missing = [];
  for (const id of ids) {
    const hit = cache ? await cache.match(keyOf(id)).catch(() => null) : null;
    const v = hit ? await hit.json().catch(() => undefined) : undefined;
    if (v === undefined) missing.push(id); else found.set(id, v);
  }
  if (missing.length) {
    let body;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 10000);
      try {
        const r = await fetcher(`https://itunes.apple.com/lookup?${new URLSearchParams({ bundleId: missing.join(","), country })}`,
          { headers: { Accept: "application/json" }, cf: { cacheEverything: true, cacheTtl: LOOKUP_TTL_S }, signal: ctl.signal });
        if (!r.ok) return fail("upstream", `The App Store answered HTTP ${r.status}.`, 502);
        body = JSON.parse(await r.text());
      } finally { clearTimeout(timer); }
    } catch { return fail("upstream", "The App Store didn't answer.", 502); }
    const byId = new Map();
    for (const r of Array.isArray(body?.results) ? body.results : []) {
      if (r && typeof r.bundleId === "string") byId.set(r.bundleId.toLowerCase(), slimOf(r));
    }
    for (const id of missing) {
      const v = byId.get(id.toLowerCase()) ?? null;
      found.set(id, v);
      if (cache) await cache.put(keyOf(id), json(v, 200, { "Cache-Control": `public, max-age=${LOOKUP_TTL_S}` })).catch(() => {});
    }
  }
  const results = ids.map((id) => found.get(id)).filter(Boolean);
  return json({ resultCount: results.length, results }, 200, { "Cache-Control": `public, max-age=${LOOKUP_TTL_S}` });
}
