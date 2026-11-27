// F182: the client side of user reviews (core/reviews.js): the draft's caps, the device token, the API calls and
// how ours merge with a depiction's and the App Store's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { memStorage as memStore } from "../fakes.test-helper.js";
import { checkDraft, deviceToken, reviewsApi, mergeReviews, reviewDate, ourReview, reviewsBase, TOKEN_KEY, LIMITS,
  buildRating, storeRating, pageRating, compactCount } from "./reviews.js";


test("a draft: stars 1-5, the caps, a written review wants a title, stars alone are fine", () => {
  assert.equal(checkDraft({}).field, "stars");
  assert.equal(checkDraft({ stars: 6 }).ok, false);
  assert.deepEqual(checkDraft({ stars: 4 }), { ok: true, draft: { stars: 4, title: "", name: "", text: "", version: "" } });
  assert.equal(checkDraft({ stars: 5, text: "Good" }).field, "title");
  assert.equal(checkDraft({ stars: 5, title: "x".repeat(LIMITS.title + 1) }).field, "title");
  assert.equal(checkDraft({ stars: 5, title: "T", name: "n".repeat(31) }).field, "name");
  assert.equal(checkDraft({ stars: 5, title: "T", text: "t".repeat(2001) }).error, "Review is at most 2,000 characters.");
  assert.equal(checkDraft({ stars: 5, title: "😀".repeat(80) }).ok, true, "characters, not UTF-16 units");
  assert.deepEqual(checkDraft({ stars: "3", title: " Hi ", name: " Ann ", text: " ok ", version: "2.1" }).draft, { stars: 3, title: "Hi", name: "Ann", text: "ok", version: "2.1" });
});

test("the device token: made once, kept in localStorage; the app's Keychain when the shell has it", async () => {
  const storage = memStore();
  const rand = (n) => new Uint8Array(n).fill(7);
  const t = await deviceToken({ storage, native: null, rand });
  assert.match(t, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(storage.getItem(TOKEN_KEY), t);
  assert.equal(await deviceToken({ storage, native: null, rand: () => new Uint8Array(32).fill(9) }), t, "the same one next time");
  // a shell with reviews.token.*: it keeps it
  const kept = {};
  const native = { call: async (m, p) => { if (m === "reviews.token.get") return kept.token ?? null; if (m === "reviews.token.set") kept.token = p.token; return true; } };
  const s2 = memStore();
  const t2 = await deviceToken({ storage: s2, native, rand });
  assert.equal(kept.token, t2);
  s2.m.clear();
  assert.equal(await deviceToken({ storage: s2, native, rand: () => new Uint8Array(32).fill(1) }), t2, "the Keychain outlives web storage");
  // a shell without them: localStorage
  const old = { call: async () => { throw new Error("unknown method"); } };
  const s3 = memStore();
  const t3 = await deviceToken({ storage: s3, native: old, rand });
  assert.equal(s3.getItem(TOKEN_KEY), t3);
});

test("the API: list, post, report with the token; anything that isn't the server's JSON reads as off", async () => {
  const calls = [];
  const answer = (status, body, type = "application/json") => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": type } });
  let next = () => answer(200, { enabled: true, average: 4, count: 2, histogram: [1, 1, 0, 0, 0], reviews: [{ id: "a", stars: 5 }], more: false, mine: null });
  const fetcher = async (url, init = {}) => { calls.push({ url, init }); return next(); };
  const api = reviewsApi({ base: "https://ifizbox.example", fetcher, token: async () => "t".repeat(40) });
  const l = await api.list("com.example.a b");
  assert.equal(calls[0].url, "https://ifizbox.example/reviews/com.example.a%20b?page=0");
  assert.equal(calls[0].init.headers["X-Review-Token"], "t".repeat(40));
  assert.deepEqual([l.enabled, l.count, l.reviews.length], [true, 2, 1]);
  next = () => answer(200, "<!doctype html><title>app</title>", "text/html");
  assert.equal((await api.list("x")).enabled, false, "the website's index.html (no reviews route there)");
  next = () => { throw new TypeError("offline"); };
  const off = await api.list("x");
  assert.deepEqual([off.enabled, off.error], [false, "network"]);
  next = () => answer(200, { ok: true, review: { id: "r" } });
  assert.equal((await api.post("x", { stars: 5 })).review.id, "r");
  const post = calls.at(-1);
  assert.equal(post.init.method, "POST");
  assert.equal(post.init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(post.init.body), { stars: 5 });
  next = () => answer(429, { code: "rate_limited", error: "Too many reviews from here. Try again in a minute." });
  await assert.rejects(api.post("x", { stars: 5 }), { code: "rate_limited", message: /Too many/ });
  next = () => answer(200, { ok: true, hidden: true });
  assert.equal((await api.report("x", "0123456789abcdef")).hidden, true);
  assert.equal(calls.at(-1).url, "https://ifizbox.example/reviews/x/0123456789abcdef/report");
  next = () => { throw new TypeError("offline"); };
  await assert.rejects(api.report("x", "0123456789abcdef"), { code: "network" });
  assert.equal(reviewsBase("site"), "");
  assert.match(reviewsBase("jailbreak"), /^https:\/\//);
});

test("F207: remove() deletes this token's own review, by package or by review id", async () => {
  const calls = [];
  let next = () => new Response(JSON.stringify({ ok: true, id: "0123456789abcdef" }), { status: 200, headers: { "Content-Type": "application/json" } });
  const api = reviewsApi({ base: "https://ifizbox.example", fetcher: async (url, init = {}) => { calls.push({ url, init }); return next(); }, token: async () => "t".repeat(40) });
  assert.deepEqual(await api.remove("com.example.a"), { ok: true, id: "0123456789abcdef" });
  assert.deepEqual([calls[0].url, calls[0].init.method, calls[0].init.headers["X-Review-Token"]], ["https://ifizbox.example/reviews/com.example.a", "DELETE", "t".repeat(40)]);
  await api.remove("com.example.a", "0123456789abcdef");
  assert.equal(calls[1].url, "https://ifizbox.example/reviews/com.example.a/0123456789abcdef");
  next = () => new Response(JSON.stringify({ code: "forbidden", error: "Only the review's writer deletes it." }), { status: 403, headers: { "Content-Type": "application/json" } });
  await assert.rejects(api.remove("com.example.a", "0123456789abcdef"), { code: "forbidden" });
  next = () => { throw new TypeError("offline"); };
  await assert.rejects(api.remove("com.example.a"), { code: "network" });
});

test("merging: ours alone keep the bar chart; with others, a count-weighted average and where each comes from", () => {
  const now = Date.UTC(2026, 10, 18);
  const ours = { enabled: true, average: 4, count: 2, histogram: [1, 1, 0, 0, 0], more: false,
    reviews: [{ id: "a1", stars: 5, title: "Great", name: "Ann", text: "<b>x</b>", version: "2.1.3", date: Date.UTC(2026, 10, 14, 12), updated: Date.UTC(2026, 10, 14, 12) }] };
  let m = mergeReviews({ ours, now });
  assert.deepEqual(m.rating, { average: 4, count: 2, noun: "Ratings", histogram: [1, 1, 0, 0, 0] });
  assert.deepEqual(m.reviews[0], { ours: true, id: "a1", title: "Great", author: "Ann", rating: 5, version: "2.1.3", date: "Nov 14", text: "<b>x</b>" });
  assert.equal(m.footer, "Ratings and reviews from reviews written here.");

  const depiction = { average: 3, count: 2, noun: "Reviews", reviews: [{ title: "Meh", author: "dev", rating: 3, text: "**bold**", raw: false }] };
  m = mergeReviews({ ours, depiction, now });
  assert.equal(m.rating.average, Math.round(((4 * 2 + 3 * 2) / 4) * 10) / 10);
  assert.equal(m.rating.count, 4);
  assert.equal(m.rating.histogram, undefined, "no bars when only some sources have them");
  assert.equal(m.rating.from, "2 from users here, 2 in the depiction.");
  assert.deepEqual(m.reviews.map((r) => r.title), ["Great", "Meh"], "ours first, then the depiction's");
  assert.equal(m.reviews[1].ours, undefined);
  assert.equal(m.footer, "Ratings and reviews from reviews written here and the package's depiction.");

  // B82: an App Store rating passed in is never merged (it rates the original app)
  const appStore = { average: 1, count: 50123456, noun: "Ratings", reviews: [{ title: "x", rating: 1, text: "y" }] };
  assert.deepEqual(mergeReviews({ ours, appStore, now }).rating, { average: 4, count: 2, noun: "Ratings", histogram: [1, 1, 0, 0, 0] });
  assert.equal(mergeReviews({ ours: { enabled: false, count: 0, reviews: [] }, appStore, now }).rating, null);
  assert.equal(mergeReviews({ appStore }).footer, "No ratings or reviews yet.");
  assert.equal(mergeReviews({}).rating, null);
  assert.equal(mergeReviews({}).footer, "No ratings or reviews yet.");
  assert.equal(mergeReviews({ ours: { enabled: true, count: 0, reviews: [] } }).rating, null);
});

test("B82: an app page's two ratings stay apart: a 50M App Store count never moves ours; the page falls back to Apple's", () => {
  const ours = { enabled: true, average: 4.5, count: 12, histogram: [8, 3, 1, 0, 0], reviews: [] };
  const appStore = { average: 2.1, count: 50123456, noun: "Ratings" };
  assert.deepEqual(buildRating(ours), { average: 4.5, count: 12, noun: "Ratings", histogram: [8, 3, 1, 0, 0] });
  assert.deepEqual(storeRating(appStore), { average: 2.1, count: 50123456, noun: "Ratings", onAppStore: true });
  assert.deepEqual(pageRating({ ours, appStore }), buildRating(ours), "rated here: ours alone, the App Store's 50M ignored");
  const none = { enabled: true, average: null, count: 0, histogram: [0, 0, 0, 0, 0], reviews: [] };
  assert.equal(buildRating(none), null);
  assert.equal(buildRating({ ...ours, enabled: false }), null, "the server off: nothing of ours");
  assert.deepEqual(pageRating({ ours: none, appStore }), storeRating(appStore), "nobody rated here: the App Store's, marked as such");
  assert.equal(pageRating({ ours: none, appStore: null }), null);
  assert.equal(storeRating({ average: null, count: 3 }), null);
  assert.equal(storeRating({ average: 4, count: null }).count, null, "a lookup without a count");
});

test("B82: the toggle's compact counts", () => {
  assert.deepEqual([0, 7, 980, 1000, 1250, 9999, 12345, 999999, 1200000, 50123456, 2.5e9].map(compactCount),
    ["0", "7", "980", "1K", "1.2K", "9.9K", "12K", "999K", "1.2M", "50M", "2.5B"]);
});

test("dates and our review's cell: 'by name – Version – date', Anonymous without a name", () => {
  const now = Date.UTC(2026, 10, 18);
  assert.equal(reviewDate(Date.UTC(2026, 0, 3, 12), now), "Jan 3");
  assert.equal(reviewDate(Date.UTC(2025, 11, 31, 12), now), "Dec 31, 2025");
  assert.equal(reviewDate(0, now), null);
  assert.equal(ourReview({ id: "x", stars: 2, title: "", name: "", text: "", version: "" }, now).author, "Anonymous");
});

test("F452 installsApi: counts() reads the server's counts, count() posts once with the device token and never throws", async () => {
  const { installsApi } = await import("./reviews.js");
  const seen = [];
  const api = installsApi({ base: "https://x", token: async () => "t".repeat(40), fetcher: async (u, init) => {
    seen.push([u, init?.method, init?.headers?.["X-Review-Token"]]);
    return { ok: true, json: async () => ({ enabled: true, counts: { "com.a": 7 } }) };
  } });
  assert.deepEqual(await api.counts(), { "com.a": 7 });
  assert.equal(await api.count("com.a b"), true);
  assert.deepEqual(seen[1], ["https://x/installs/com.a%20b", "POST", "t".repeat(40)]);
  const down = installsApi({ token: async () => "t".repeat(40), fetcher: async () => { throw new Error("offline"); } });
  assert.deepEqual(await down.counts(), {});
  assert.equal(await down.count("com.a"), false);
});
