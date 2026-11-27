// F452: install counts (src/installs.js) against Node's SQLite with D1's API. The gate runs every worker/test*.mjs.
// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import { installs, isInstallsPath } from "./src/installs.js";
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

// rate limit: one token, a minute
let limited = 0;
for (let i = 0; i < 8; i++) if ((await call(`/installs/com.z${i}`, { method: "POST", token: tok("c"), ip: "203.0.113.9" })).status === 429) limited++;
assert.ok(limited > 0, "rate limited like reviews");
console.log("ok installs");
