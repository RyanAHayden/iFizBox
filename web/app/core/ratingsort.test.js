import { test } from "node:test";
import assert from "node:assert/strict";
import { rankByRating } from "./ratingsort.js";

const row = (id, name = id) => ({ id, name });

test("rated first by average, then count, then name; unrated last by name", () => {
  const rows = [row("z", "Zeta"), row("a", "Alpha"), row("b", "Beta"), row("c", "Gamma"), row("d", "Delta"), row("e", "Echo")];
  const ratings = { b: [4.5, 2], c: [4.5, 10], d: [5, 1], e: [3, 40], z: [4.5, 2] };
  assert.deepEqual(rankByRating(rows, ratings).map((r) => r.id), ["d", "c", "b", "z", "e", "a"]);
  assert.equal(rows[0].id, "z", "the rows given are left as they were");
});

test("no ratings: by name; bad entries count as unrated", () => {
  const rows = [row("b", "Beta"), row("a", "Alpha"), row("c", "Gamma")];
  assert.deepEqual(rankByRating(rows, {}).map((r) => r.id), ["a", "b", "c"]);
  assert.deepEqual(rankByRating(rows, null).map((r) => r.id), ["a", "b", "c"]);
  assert.deepEqual(rankByRating(rows, { a: "x", b: [null, 3], c: [2, 1], toString: [5, 5] }).map((r) => r.id), ["c", "a", "b"]);
});

test("reviewsApi().ratings(): one GET /reviews; {} when the server keeps none or fails", async () => {
  const { reviewsApi } = await import("./reviews.js");
  const asked = [];
  const answer = (body, ok = true) => async (u) => { asked.push(u); return { ok, json: async () => body }; };
  const api = (fetcher) => reviewsApi({ base: "https://x.example", fetcher, token: async () => "t".repeat(40) });
  assert.deepEqual(await api(answer({ enabled: true, ratings: { a: [4, 2] } })).ratings(), { a: [4, 2] });
  assert.deepEqual(asked, ["https://x.example/reviews"]);
  assert.deepEqual(await api(answer({ enabled: false, ratings: {} })).ratings(), {});
  assert.deepEqual(await api(answer({ code: "x" }, false)).ratings(), {});
  assert.deepEqual(await api(async () => { throw new Error("offline"); }).ratings(), {});
});

test("depiction stars fill in for packages with none here; ours win", async () => {
  const { depictionStars, withDepiction } = await import("./ratingsort.js");
  const json = { class: "DepictionStackView", views: [{ class: "DepictionRatingView", rating: 4.2 }] };
  assert.deepEqual(depictionStars(json), [4.2, 0]);
  assert.equal(depictionStars({ views: [] }), null);
  assert.equal(depictionStars(null), null);
  const ratings = withDepiction({ a: [3, 5] }, { a: [5, 1], b: [4.2, 0], c: null });
  assert.deepEqual(ratings, { a: [3, 5], b: [4.2, 0] });
  const rows = [row("n", "Nope"), row("b", "Bee"), row("a", "Ay")];
  assert.deepEqual(rankByRating(rows, ratings).map((r) => r.id), ["b", "a", "n"]);
});
