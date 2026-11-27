// F452: install counts (src/installs.js) against Node's SQLite with D1's API. The gate runs every worker/test*.mjs.
// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import { installs, isInstallsPath, INSTALL_WRITES, INSTALL_DAILY, INSTALL_DAILY_PER_PKG } from "./src/installs.js";
import { reviews } from "./src/reviews.js";
import { d1 } from "./src/d1-sqlite.js";
import w from "./src/index.js";

const env = { REVIEWS: d1() };
const tok = (c) => c.repeat(40);
let ipN = 0;
const call = (path, { method = "GET", token, ip = `198.51.100.${++ipN % 250}`, e = env } = {}) => {
  const headers = { "CF-Connecting-IP": ip };
  if (token) headers["X-Review-Token"] = token;
  return installs(new Request("https://ifizbox.example" + path, { method, headers }), e);
};

assert.ok(isInstallsPath("/installs") && isInstallsPath("/installs/com.x") && !isInstallsPath("/reviews"));

// no binding: off
assert.deepEqual(await (await call("/installs", { e: {} })).json(), { enabled: false, counts: {} });
assert.equal((await call("/installs/com.x", { method: "POST", token: tok("a"), e: {} })).status, 503);

// nothing yet; cached 5 minutes
let r = await call("/installs");
assert.deepEqual(await r.json(), { enabled: true, counts: {} });
assert.match(r.headers.get("Cache-Control"), /max-age=300/);

// needs a token
assert.equal((await call("/installs/com.x", { method: "POST" })).status, 400);
assert.equal((await call("/installs/com.x", { method: "POST", token: "short" })).status, 400);
assert.equal((await call("/installs/bad%20id", { method: "POST", token: tok("a") })).status, 404);

// one count per device per package: a reinstall doesn't inflate it
assert.deepEqual(await (await call("/installs/com.x", { method: "POST", token: tok("a") })).json(), { ok: true, counted: true });
assert.deepEqual(await (await call("/installs/com.x", { method: "POST", token: tok("a") })).json(), { ok: true, counted: false });
await call("/installs/com.x", { method: "POST", token: tok("b") });
await call("/installs/com.y", { method: "POST", token: tok("a") });
assert.deepEqual((await (await call("/installs")).json()).counts, { "com.x": 2, "com.y": 1 });

// the Worker routes it
const viaWorker = await w.fetch(new Request("https://ifizbox.example/installs"), env);
assert.equal((await viaWorker.json()).counts["com.x"], 2);

// B499: an Upgrade All of many packages from one device and address is all counted, and a review still goes through.
// `now` is fixed, so the minute's limit can't roll over mid-loop.
const now = Date.now();
const count = async (pkg, { token = tok("c"), ip = "203.0.113.9", at = now, e = env } = {}) => (await installs(
  new Request("https://ifizbox.example/installs/" + pkg, { method: "POST", headers: { "CF-Connecting-IP": ip, "X-Review-Token": token } }), e, { now: at })).status;
for (let i = 0; i < 120; i++) assert.equal(await count(`com.z${i}`), 200);
assert.equal(Object.keys((await (await call("/installs")).json()).counts).filter((k) => k.startsWith("com.z")).length, 120);
const review = await reviews(new Request("https://ifizbox.example/reviews/com.x", { method: "POST",
  headers: { "CF-Connecting-IP": "203.0.113.9", "X-Review-Token": tok("c"), "Content-Type": "application/json" },
  body: JSON.stringify({ stars: 5 }) }), env, { now });
assert.equal(review.status, 200);

// its own limits: a minute per address
for (let i = 120; i < INSTALL_WRITES; i++) assert.equal(await count(`com.z${i}`), 200);
assert.equal(await count("com.over"), 429);
assert.equal(await count("com.over", { at: now + 60000 }), 200);

// a day, one package from one address: new tokens add no more than INSTALL_DAILY_PER_PKG
const nth = (i) => String(i).padStart(32, "t");
for (let i = 0; i < INSTALL_DAILY_PER_PKG; i++) assert.equal(await count("com.pad", { token: nth(i), ip: "203.0.113.10", at: now + 120000 }), 200);
assert.equal(await count("com.pad", { token: nth(999), ip: "203.0.113.10", at: now + 180000 }), 429);
assert.equal(await count("com.other", { token: nth(999), ip: "203.0.113.10", at: now + 180000 }), 200);
assert.equal(await count("com.pad", { token: nth(999), ip: "203.0.113.10", at: now + 120000 + 86400000 }), 200);

// counts sent at once don't slip past the day's cap together
const together = await Promise.all(Array.from({ length: INSTALL_DAILY_PER_PKG + 5 },
  (_, i) => count("com.burst", { token: nth(i), ip: "203.0.113.12", at: now + 240000 })));
assert.equal(together.filter((s) => s === 200).length, INSTALL_DAILY_PER_PKG);

// a day per address, whatever the packages
const full = { REVIEWS: d1() };
let n = 0;
for (let i = 0; i <= INSTALL_DAILY; i++) if ((await count(`com.d${i}`, { ip: "203.0.113.11", at: now + Math.floor(i / 200) * 60000, e: full })) === 200) n++;
assert.equal(n, INSTALL_DAILY);
console.log("ok installs");
