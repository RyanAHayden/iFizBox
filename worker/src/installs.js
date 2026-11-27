// F452: install counts for Popular, kept in the same D1 database as the reviews (binding REVIEWS). A client sends one
// count after a successful install (app, sideload, .deb, the website's install); the device is the reviews' anonymous
// token (X-Review-Token), kept only as a salted hash, so one device counts once per package: a reinstall changes
// nothing.
// B499: counts have limits of their own, never the reviews': an Upgrade All sends one for each package at once. Each
// address gets INSTALL_WRITES a minute (this isolate's memory) and, counted in D1, INSTALL_DAILY a day, of which
// INSTALL_DAILY_PER_PKG for any one package (a new token costs nothing, so this bounds what one address can add).
//
//   GET  /installs               {enabled, counts: {<package id>: n}}: every counted package at once; cached 5 minutes
//   POST /installs/<package id>  X-Review-Token -> {ok, counted}: counted is false when this device had counted it already
//
// Without the REVIEWS binding (worker/node.mjs, a deploy without D1) GET answers {enabled: false} and POST 503.
// SPDX-License-Identifier: GPL-3.0-or-later

import { hashOf } from "./reviews.js";
import { rateLimiter } from "./account.js";

export const INSTALL_WRITES = 300, INSTALL_DAILY = 1000, INSTALL_DAILY_PER_PKG = 40;
const PKG = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/;
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const PATH = /^\/installs\/([^/]+)\/?$/;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Review-Token" };
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...CORS, ...extra } });
const fail = (code, error, status = 400) => json({ code, error }, status);

export const isInstallsPath = (pathname) => pathname === "/installs" || pathname.startsWith("/installs/");

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS installs (pkg TEXT NOT NULL, device TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (pkg, device))",
  "CREATE TABLE IF NOT EXISTS install_writes (ip TEXT NOT NULL, pkg TEXT NOT NULL, at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS install_writes_ip ON install_writes (ip, at)",
  "CREATE INDEX IF NOT EXISTS install_writes_at ON install_writes (at)", // the day-old rows' cleanup
];
const ready = new WeakMap();
function schema(db) {
  if (!ready.has(db)) ready.set(db, db.batch(SCHEMA.map((s) => db.prepare(s))).catch((e) => { ready.delete(db); throw e; }));
  return ready.get(db);
}

const memory = rateLimiter({ rate: INSTALL_WRITES, writes: INSTALL_WRITES });
// One count: false when the address has had its minute's or its day's worth.
async function allowCount(db, ip, pkg, now) {
  if (!memory.allow(ip, true, now)) return false;
  const day = now - 86400000;
  // checked and written in one statement: an Upgrade All's counts arrive together and must not all pass one old total
  const [added] = await db.batch([db.prepare(`INSERT INTO install_writes (ip, pkg, at) SELECT ?, ?, ?
    WHERE (SELECT COUNT(*) FROM install_writes WHERE ip = ? AND at > ?) < ?
    AND (SELECT COUNT(*) FROM install_writes WHERE ip = ? AND at > ? AND pkg = ?) < ?`)
    .bind(ip, pkg, now, ip, day, INSTALL_DAILY, ip, day, pkg, INSTALL_DAILY_PER_PKG),
    db.prepare("DELETE FROM install_writes WHERE at <= ?").bind(day)]);
  return Boolean(added.meta?.changes);
}

export async function installs(req, env = {}, { now = Date.now() } = {}) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const u = new URL(req.url);
  const db = env.REVIEWS;
  if (req.method === "GET" && /^\/installs\/?$/.test(u.pathname)) {
    if (!db?.prepare) return json({ enabled: false, counts: {} });
    await schema(db);
    const { results = [] } = await db.prepare("SELECT pkg, COUNT(*) AS n FROM installs GROUP BY pkg").all();
    const counts = {};
    for (const r of results) counts[r.pkg] = Number(r.n);
    return json({ enabled: true, counts }, 200, { "Cache-Control": "public, max-age=300" });
  }
  const m = PATH.exec(u.pathname);
  let pkg = "";
  try { pkg = m ? decodeURIComponent(m[1]) : ""; } catch { /* bad escape */ }
  if (!m || !PKG.test(pkg)) return fail("bad_request", "Send /installs/<package id>.", 404);
  if (req.method !== "POST") return fail("bad_request", "Not an installs route.", 405);
  if (!db?.prepare) return fail("unavailable", "This server keeps no install counts.", 503);
  await schema(db);
  const raw = req.headers.get("X-Review-Token");
  if (!raw || !TOKEN.test(raw)) return fail("bad_token", "Send this device's X-Review-Token (32 to 128 letters, digits, - or _).");
  const salt = env.REVIEWS_SALT ?? "";
  const device = await hashOf("device", raw, salt);
  const ip = await hashOf("ip", req.headers.get("CF-Connecting-IP") ?? req.headers.get("X-Forwarded-For")?.split(",")[0].trim() ?? "unknown", salt);
  // a device that counted this package already spends no limit budget: its repeat is just not counted
  if (await db.prepare("SELECT 1 AS n FROM installs WHERE pkg = ? AND device = ?").bind(pkg, device).first()) return json({ ok: true, counted: false });
  if (!(await allowCount(db, ip, pkg, now))) return fail("rate_limited", "Too many installs counted from here. Try again later.", 429);
  const r = await db.prepare("INSERT OR IGNORE INTO installs (pkg, device, at) VALUES (?, ?, ?)").bind(pkg, device, now).run();
  return json({ ok: true, counted: Boolean(r.meta?.changes) });
}
