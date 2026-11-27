// F182: user reviews, kept in Cloudflare D1 (binding REVIEWS; free on the Workers Free plan: 5 GB, 100,000 rows
// written a day). No accounts: a device makes a random token once (localStorage on the website, the app's own store)
// and sends it as X-Review-Token; only its salted SHA-256 is kept, so one device has one review per package, and a
// second POST replaces the first.
//
//   GET    /reviews                              {enabled, ratings: {<package id>: [average, count]}}: every rated
//                                                package at once (a list's Rating sort); cached 5 minutes
//   GET    /reviews/<package id>?page=0&per=20  {enabled, average, count, histogram: [n5..n1], reviews: [review],
//                                                page, per, more, mine}: hidden reviews never count; `reviews` are
//                                                the ones with a title or text, newest first; `mine` (this token's
//                                                own, hidden or not) only with X-Review-Token
//   POST   /reviews/<package id>                 {stars 1-5, title <= 80, name <= 30, text <= 2000, version <= 64}
//                                                -> {ok, review}. Stars alone is Tap to Rate
//   POST   /reviews/<package id>/<review id>/report   one count per reporter (token, else address); REPORT_HIDE
//                                                reports (3) hide it -> {ok, hidden}
//   DELETE /reviews/<package id>/<review id>     Authorization: Bearer <REVIEWS_ADMIN> (a Worker secret: `npx wrangler
//                                                secret put REVIEWS_ADMIN`); without the secret set, nobody can.
//                                                F207: or X-Review-Token of the device that wrote it (else 403)
//   DELETE /reviews/<package id>                 X-Review-Token: this device's own review there -> {ok, id}; 404
//                                                when it has none. Token deletes count as writes (rate limits)
//
// review: { id, stars, title, name, text, version, date (ms), updated (ms) }. Everything is plain text: control
// characters go, the length caps hold, and the clients draw it as text (textContent), never as HTML.
// Abuse: each address gets REVIEW_WRITES writes (posts and reports) a minute and each token 4 (Cloudflare's Rate
// Limiting binding REVIEW_RATE_LIMIT across isolates, else this isolate's memory), and REVIEW_DAILY (40) a day per
// address, counted in D1. Addresses are kept only as salted hashes, for a day.
// Without the REVIEWS binding (worker/node.mjs, a deploy without D1) GET answers {enabled: false} and writes 503.
// SPDX-License-Identifier: GPL-3.0-or-later

import { rateLimiter } from "./account.js";

export const LIMITS = { title: 80, name: 30, text: 2000, version: 64 };
export const REPORT_HIDE = 3, REVIEW_WRITES = 6, TOKEN_WRITES = 4, REVIEW_DAILY = 40, PER_PAGE = 20, MAX_PER = 50;
const PKG = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/;
const RID = /^[0-9a-f]{16}$/;
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const PATH = /^\/reviews\/([^/]+)(?:\/([^/]+)(?:\/(report))?)?\/?$/;

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Review-Token, Authorization" };
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...CORS, ...extra } });
const fail = (code, error, status = 400) => json({ code, error }, status);

export const isReviewsPath = (pathname) => pathname === "/reviews" || pathname.startsWith("/reviews/");

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, pkg TEXT NOT NULL, device TEXT NOT NULL, stars INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', version TEXT NOT NULL DEFAULT '',
    created INTEGER NOT NULL, updated INTEGER NOT NULL, reports INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0,
    UNIQUE (pkg, device))`,
  "CREATE INDEX IF NOT EXISTS reviews_pkg ON reviews (pkg, hidden, updated)",
  "CREATE TABLE IF NOT EXISTS review_reports (review TEXT NOT NULL, reporter TEXT NOT NULL, PRIMARY KEY (review, reporter))",
  "CREATE TABLE IF NOT EXISTS review_writes (ip TEXT NOT NULL, at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS review_writes_ip ON review_writes (ip, at)",
];
// The tables are made the first time an isolate touches the database (no migration step to forget on deploy).
const ready = new WeakMap();
function schema(db) {
  if (!ready.has(db)) ready.set(db, db.batch(SCHEMA.map((s) => db.prepare(s))).catch((e) => { ready.delete(db); throw e; }));
  return ready.get(db);
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export async function hashOf(kind, value, salt = "") {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${kind}:${salt}:${value}`)));
}

// Plain text: no control characters but newlines in the review (and none at all in one-line fields), trimmed, capped.
export function clean(v, max, multiline = false) {
  if (v == null) return "";
  if (typeof v !== "string" && typeof v !== "number") return null;
  let s = String(v).normalize("NFC").replace(/\r\n?/g, "\n");
  s = multiline ? s.replace(/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/g, "").replace(/\n{3,}/g, "\n\n")
    : s.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ");
  s = s.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim(); // no bidi overrides flipping the page
  return [...s].length > max ? null : s;
}

// A POST body -> { ok: true, review } or { ok: false, error }.
export function parseReview(b) {
  if (!b || typeof b !== "object") return { ok: false, error: "Send JSON: {stars, title, name, text, version}." };
  const stars = Number(b.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return { ok: false, error: "Stars are 1 to 5." };
  const out = { stars };
  for (const [k, max, multi] of [["title", LIMITS.title], ["name", LIMITS.name], ["text", LIMITS.text, true], ["version", LIMITS.version]]) {
    const v = clean(b[k], max, multi);
    if (v === null) return { ok: false, error: `${k[0].toUpperCase() + k.slice(1)} is at most ${max} characters.` };
    out[k] = v;
  }
  return { ok: true, review: out };
}

const view = (r) => ({ id: r.id, stars: r.stars, title: r.title, name: r.name, text: r.body, version: r.version,
  date: r.created, updated: r.updated });

const memory = rateLimiter({ rate: REVIEW_WRITES, writes: REVIEW_WRITES });
const tokenMemory = rateLimiter({ rate: TOKEN_WRITES, writes: TOKEN_WRITES });
// One write: false when the address or the token has had its minute's worth.
async function allowWrite(env, ipKey, tokenKey) {
  const bound = env.REVIEW_RATE_LIMIT?.limit ? env.REVIEW_RATE_LIMIT : null;
  if (bound) {
    try {
      if (!(await bound.limit({ key: "ip:" + ipKey })).success) return false;
      return tokenKey ? tokenMemory.allow(tokenKey, true) : true;
    } catch { /* the binding is down: count here */ }
  }
  if (!memory.allow(ipKey, true)) return false;
  return tokenKey ? tokenMemory.allow(tokenKey, true) : true;
}
// The day's count per address, in D1 (the minute limits above reset with each isolate).
async function allowToday(db, ipKey, now, daily) {
  const day = now - 86400000;
  const n = (await db.prepare("SELECT COUNT(*) AS n FROM review_writes WHERE ip = ? AND at > ?").bind(ipKey, day).first())?.n ?? 0;
  if (n >= daily) return false;
  await db.batch([db.prepare("INSERT INTO review_writes (ip, at) VALUES (?, ?)").bind(ipKey, now),
    db.prepare("DELETE FROM review_writes WHERE at <= ?").bind(day)]);
  return true;
}

// F291: Report as Malicious (src/reports.js) counts against the same limits: true, or the reason it can't.
export async function allowReviewWrite(env, db, ipKey, tokenKey, now = Date.now()) {
  await schema(db);
  if (!(await allowWrite(env, ipKey, tokenKey))) return "Too many reports from here. Try again in a minute.";
  if (!(await allowToday(db, ipKey, now, Number(env.REVIEW_DAILY) || REVIEW_DAILY))) return "That's enough reports from here for today.";
  return true;
}

function sameSecret(a, b) {
  const x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b));
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i % (x.length || 1)] ?? 0) ^ (y[i % (y.length || 1)] ?? 0);
  return d === 0 && x.length > 0;
}

const randomId = () => hex(crypto.getRandomValues(new Uint8Array(8)));

// F450: GET /reviews -> {enabled, ratings: {<package id>: [average, count]}}: every rated package's stars in one
// answer (hidden reviews never count), for a list's Rating sort. Kept 5 minutes by browsers and caches.
async function allRatings(db) {
  if (!db?.prepare) return json({ enabled: false, ratings: {} });
  await schema(db);
  const { results = [] } = await db.prepare("SELECT pkg, COUNT(*) AS n, AVG(stars) AS a FROM reviews WHERE hidden = 0 GROUP BY pkg").all();
  const ratings = {};
  for (const r of results) ratings[r.pkg] = [Math.round(Number(r.a) * 10) / 10, Number(r.n)];
  return json({ enabled: true, ratings }, 200, { "Cache-Control": "public, max-age=300" });
}

export async function reviews(req, env = {}, { now = Date.now() } = {}) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const u = new URL(req.url);
  if (req.method === "GET" && /^\/reviews\/?$/.test(u.pathname)) return allRatings(env.REVIEWS);
  const m = PATH.exec(u.pathname);
  let pkg = "";
  try { pkg = m ? decodeURIComponent(m[1]) : ""; } catch { /* bad escape */ }
  if (!m || !PKG.test(pkg)) return fail("bad_request", "Send /reviews/<package id>.", 404);
  const rid = m[2] ?? null, report = Boolean(m[3]);
  if (rid !== null && !RID.test(rid)) return fail("bad_request", "No such review.", 404);
  const db = env.REVIEWS;
  if (!db?.prepare) {
    if (req.method === "GET" && rid === null) return json({ enabled: false, average: null, count: 0, histogram: [0, 0, 0, 0, 0], reviews: [], page: 0, per: PER_PAGE, more: false, mine: null });
    return fail("unavailable", "This server keeps no reviews.", 503);
  }
  await schema(db);
  const salt = env.REVIEWS_SALT ?? "";
  const rawToken = req.headers.get("X-Review-Token");
  if (rawToken !== null && !TOKEN.test(rawToken)) return fail("bad_token", "X-Review-Token is 32 to 128 letters, digits, - or _.");
  const device = rawToken ? await hashOf("device", rawToken, salt) : null;
  const ip = await hashOf("ip", req.headers.get("CF-Connecting-IP") ?? req.headers.get("X-Forwarded-For")?.split(",")[0].trim() ?? "unknown", salt);

  if (req.method === "GET" && rid === null) {
    const per = Math.max(1, Math.min(MAX_PER, Number(u.searchParams.get("per")) || PER_PAGE));
    const page = Math.max(0, Math.min(10000, Math.floor(Number(u.searchParams.get("page")) || 0)));
    const [stats, list, mine] = await db.batch([
      db.prepare("SELECT stars, COUNT(*) AS n FROM reviews WHERE pkg = ? AND hidden = 0 GROUP BY stars").bind(pkg),
      db.prepare("SELECT * FROM reviews WHERE pkg = ? AND hidden = 0 AND (title <> '' OR body <> '') ORDER BY updated DESC, id LIMIT ? OFFSET ?")
        .bind(pkg, per + 1, page * per),
      db.prepare("SELECT * FROM reviews WHERE pkg = ? AND device = ?").bind(pkg, device ?? ""),
    ]);
    const histogram = [0, 0, 0, 0, 0];
    for (const r of stats.results ?? []) if (r.stars >= 1 && r.stars <= 5) histogram[5 - r.stars] = Number(r.n);
    const count = histogram.reduce((a, b) => a + b, 0);
    const average = count ? Math.round((histogram.reduce((a, n, i) => a + n * (5 - i), 0) / count) * 10) / 10 : null;
    const rows = list.results ?? [];
    const own = device ? mine.results?.[0] : null;
    return json({ enabled: true, average, count, histogram, reviews: rows.slice(0, per).map(view), page, per, more: rows.length > per,
      mine: own ? { ...view(own), hidden: Boolean(own.hidden) } : null });
  }

  if (req.method === "DELETE" && !report) {
    const auth = /^Bearer (.+)$/.exec(req.headers.get("Authorization") ?? "")?.[1] ?? "";
    const admin = Boolean(env.REVIEWS_ADMIN) && auth !== "" && sameSecret(auth, env.REVIEWS_ADMIN);
    if (admin && rid !== null) {
      const r = await db.prepare("DELETE FROM reviews WHERE id = ? AND pkg = ?").bind(rid, pkg).run();
      await db.prepare("DELETE FROM review_reports WHERE review = ?").bind(rid).run();
      return (r.meta?.changes ?? 0) ? json({ ok: true }) : fail("not_found", "No such review.", 404);
    }
    // F207: a device deletes its own review, by id or (no id) the one it wrote on this package.
    if (!device) return fail("forbidden", "Only the review's writer deletes it.", 403);
    if (!(await allowWrite(env, ip, device))) return fail("rate_limited", "Too many changes from here. Try again in a minute.", 429);
    if (!(await allowToday(db, ip, now, Number(env.REVIEW_DAILY) || REVIEW_DAILY))) return fail("rate_limited", "That's enough changes from here for today.", 429);
    const row = rid !== null
      ? await db.prepare("SELECT id, device FROM reviews WHERE id = ? AND pkg = ?").bind(rid, pkg).first()
      : await db.prepare("SELECT id, device FROM reviews WHERE pkg = ? AND device = ?").bind(pkg, device).first();
    if (!row) return fail("not_found", "No such review.", 404);
    if (row.device !== device) return fail("forbidden", "Only the review's writer deletes it.", 403);
    await db.prepare("DELETE FROM reviews WHERE id = ? AND device = ?").bind(row.id, device).run();
    await db.prepare("DELETE FROM review_reports WHERE review = ?").bind(row.id).run();
    return json({ ok: true, id: row.id });
  }

  if (req.method !== "POST" || (rid !== null && !report)) return fail("bad_request", "Not a reviews route.", 405);
  if (!(await allowWrite(env, ip, device))) return fail("rate_limited", "Too many reviews from here. Try again in a minute.", 429);
  if (!(await allowToday(db, ip, now, Number(env.REVIEW_DAILY) || REVIEW_DAILY))) return fail("rate_limited", "That's enough reviews from here for today.", 429);

  if (report) {
    const r = await db.prepare("SELECT id, device, hidden FROM reviews WHERE id = ? AND pkg = ?").bind(rid, pkg).first();
    if (!r) return fail("not_found", "No such review.", 404);
    if (device && r.device === device) return fail("bad_request", "That's your own review.");
    const by = device ?? "ip:" + ip;
    const added = await db.prepare("INSERT OR IGNORE INTO review_reports (review, reporter) VALUES (?, ?)").bind(rid, by).run();
    const hide = Math.max(1, Number(env.REPORT_HIDE) || REPORT_HIDE);
    if (added.meta?.changes) await db.prepare("UPDATE reviews SET reports = reports + 1, hidden = CASE WHEN reports + 1 >= ? THEN 1 ELSE hidden END WHERE id = ?").bind(hide, rid).run();
    const after = await db.prepare("SELECT hidden FROM reviews WHERE id = ?").bind(rid).first();
    return json({ ok: true, hidden: Boolean(after?.hidden) });
  }

  if (!device) return fail("bad_token", "Send this device's X-Review-Token.");
  if (Number(req.headers.get("Content-Length") || 0) > 16384) return fail("too_large", "A review is at most 2,000 characters.", 413);
  let body;
  try {
    const text = await req.text();
    if (text.length > 16384) return fail("too_large", "A review is at most 2,000 characters.", 413);
    body = JSON.parse(text);
  } catch { return fail("bad_request", "Send JSON: {stars, title, name, text, version}."); }
  const p = parseReview(body);
  if (!p.ok) return fail("bad_request", p.error);
  const v = p.review;
  // A second review from this device replaces the first: same id and first date, new everything else, and the
  // reports start again (it is new text; a token costs nothing to make, so keeping them would stop nobody).
  await db.prepare(`INSERT INTO reviews (id, pkg, device, stars, title, name, body, version, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (pkg, device) DO UPDATE SET stars = excluded.stars, title = excluded.title, name = excluded.name, body = excluded.body,
    version = excluded.version, updated = excluded.updated, reports = 0, hidden = 0`)
    .bind(randomId(), pkg, device, v.stars, v.title, v.name, v.text, v.version, now, now).run();
  const row = await db.prepare("SELECT * FROM reviews WHERE pkg = ? AND device = ?").bind(pkg, device).first();
  await db.prepare("DELETE FROM review_reports WHERE review = ?").bind(row.id).run();
  return json({ ok: true, review: view(row) });
}
