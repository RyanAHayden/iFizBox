// F455: the batch App Store lookup (src/applookup.js) with a fake Apple and cache.
// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import { appLookupBatch } from "./src/applookup.js";

const mem = new Map();
const cache = { match: async (k) => (mem.has(k.url) ? mem.get(k.url).clone() : undefined), put: async (k, r) => { mem.set(k.url, r); } };
const asked = [];
const apple = async (url) => {
  asked.push(new URL(url).searchParams.get("bundleId"));
  return new Response(JSON.stringify({ resultCount: 2, results: [
    { bundleId: "com.a.one", averageUserRating: 4.5, userRatingCount: 120, trackName: "One", description: "long" },
    { bundleId: "com.b.two", averageUserRating: 3, userRatingCount: 8 }] }));
};
const call = (q, o = {}) => appLookupBatch(new URL("https://ifizbox.example/api/applookup-batch?" + q), {}, { fetcher: apple, cache, ...o });

let r = await call("bundleIds=com.a.one,com.b.two,com.c.none&country=us");
assert.equal(r.status, 200);
assert.deepEqual((await r.json()).results, [
  { bundleId: "com.a.one", averageUserRating: 4.5, userRatingCount: 120 }, { bundleId: "com.b.two", averageUserRating: 3, userRatingCount: 8 }]);
assert.deepEqual(asked, ["com.a.one,com.b.two,com.c.none"]); // one Apple request for the whole list
assert.match(r.headers.get("Cache-Control"), /max-age=86400/);

// a day's cache: the same list, in any order or case, costs Apple nothing; another list is asked in one request
r = await call("bundleIds=com.C.none,com.b.two,com.a.one&country=us");
assert.equal((await r.json()).resultCount, 2);
assert.equal(asked.length, 1);
assert.equal(mem.size, 1, "one cache entry for the list, not one per app");
await call("bundleIds=com.a.one,com.d.new&country=us");
assert.equal(asked[1], "com.a.one,com.d.new");

// bad input and a failing Apple
for (const q of ["", "bundleIds=bad%20id", "bundleIds=com.x&country=usa", "bundleIds=" + Array.from({ length: 51 }, (_, i) => "a.b" + i).join(",")]) {
  assert.equal((await call(q)).status, 400, q);
}
assert.equal((await call("bundleIds=com.z.z", { fetcher: async () => new Response("no", { status: 500 }), cache: null })).status, 502);
// the Worker routes it
const w = (await import("./src/index.js")).default;
const routed = await w.fetch(new Request("https://ifizbox.example/api/applookup-batch?bundleIds=com.a.one,com.d.new"), { LOOKUP_CACHE: cache, FETCH: apple });
assert.equal(routed.status, 200);
console.log("worker applookup batch: ok");
