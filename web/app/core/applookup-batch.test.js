// F455: Popular's App Store stars, asked for many apps at once (core/applookup.js).
// SPDX-License-Identifier: GPL-3.0-or-later
import test from "node:test";
import assert from "node:assert/strict";
import { BATCH, batchLookupUrl, parseBatch, storeRatingsLoader, STORE_RATINGS_TTL } from "./applookup.js";

const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const idsOf = (url) => { const q = new URL(url, "https://site.test").searchParams; return (q.get("bundleIds") ?? q.get("bundleId")).split(","); };
// Rates every app 4 stars except "none.*".
const answer = (url) => JSON.stringify({ results: idsOf(url).filter((i) => !i.startsWith("none."))
  .map((bundleId) => ({ bundleId, averageUserRating: 4, userRatingCount: 7 })) });

test("batch URL: the Worker on the site, Apple's comma list in the app", () => {
  assert.equal(batchLookupUrl(["b.b", "a.a", "bad id"], "GB"), "/api/applookup-batch?bundleIds=a.a%2Cb.b&country=gb");
  assert.equal(batchLookupUrl(["a.a"], "us", { direct: true }), "https://itunes.apple.com/lookup?bundleId=a.a&country=us");
  assert.equal(batchLookupUrl(["bad id"]), null);
  assert.equal(parseBatch("<html>"), null);
  assert.deepEqual(parseBatch({ results: [{ bundleId: "A.B", averageUserRating: 0 }] }), {});
});

test("loader: batches, keeps answers a day across launches, asks a failed batch again", async () => {
  const store = memStore(), asked = [];
  let fail = true, at = 1000;
  const get = async (url) => { asked.push(idsOf(url)); if (fail) throw new Error("offline"); return answer(url); };
  const ids = ["None.x", ...Array.from({ length: BATCH }, (_, i) => `app.n${i}`)];
  const load = storeRatingsLoader({ get, store, now: () => at });
  assert.deepEqual(await load(ids), {});
  assert.equal(asked.length, 2);
  fail = false;
  const got = await load(ids);
  assert.deepEqual(got["app.n0"], [4, 7]);
  assert.equal(Object.keys(got).length, BATCH);
  assert.equal(asked.length, 4);
  const next = storeRatingsLoader({ get, store, now: () => at }); // the next launch
  assert.equal(Object.keys(await next(ids)).length, BATCH);
  assert.equal(asked.length, 4, "an app without stars isn't asked again either");
  at += STORE_RATINGS_TTL;
  await next(ids);
  assert.equal(asked.length, 6);
});

test("loader: a slow answer doesn't hold the list; it is there next time", async () => {
  let release, calls = 0;
  const load = storeRatingsLoader({ get: (url) => { calls++; return new Promise((done) => { release = () => done(answer(url)); }); } });
  assert.deepEqual(await load(["a.a"], 5), {});
  assert.deepEqual(await load(["a.a"], 5), {});
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await load(["a.a"], 1000), { "a.a": [4, 7] });
});
