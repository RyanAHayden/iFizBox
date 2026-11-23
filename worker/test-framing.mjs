// node worker/test-framing.mjs: F383, /api/fetch hands a page's framing headers on under names of its own, so the
// website (web/app/screens/browse.js proxiedFraming) can tell a depiction host that refuses framing.
import assert from "node:assert/strict";
import w, { upstreamFraming } from "./src/index.js";

const env = { FETCH_RATE: "0", HOST_RATE: "0", UPLOAD_RATE: "0" };
const realFetch = globalThis.fetch;
const proxied = async (headers) => {
  globalThis.fetch = async () => new Response("<p>depiction</p>", { headers: { "Content-Type": "text/html", ...headers } });
  try {
    const r = await w.fetch(new Request(`https://ifizbox.example/api/fetch?url=${encodeURIComponent("https://chariz.com/depiction/x")}`), env);
    assert.equal(r.status, 200);
    assert.equal(await r.text(), "<p>depiction</p>"); // read whole: cappedBody's overall timer ends with the body
    return r.headers;
  } finally { globalThis.fetch = realFetch; }
};

// Chariz: X-Frame-Options deny and CSP frame-ancestors cydia.saurik.com
let h = await proxied({ "X-Frame-Options": "DENY", "Content-Security-Policy": "default-src 'self'; frame-ancestors cydia.saurik.com" });
assert.equal(h.get("x-upstream-frame-options"), "DENY");
assert.equal(h.get("x-upstream-frame-ancestors"), "cydia.saurik.com");
assert.equal(h.get("content-security-policy"), "default-src 'none'; sandbox", "the answer's own CSP stays the proxy's");
assert.equal(h.get("x-frame-options"), null, "never under the page's own name");
assert.match(h.get("access-control-expose-headers"), /X-Upstream-Frame-Options, X-Upstream-Frame-Ancestors/);
assert.equal(h.get("content-type"), "application/octet-stream", "HTML still comes back inert");

// none: neither header
h = await proxied({ "Content-Security-Policy": "default-src 'self'" });
assert.equal(h.get("x-upstream-frame-options"), null);
assert.equal(h.get("x-upstream-frame-ancestors"), null);
assert.equal(h.get("access-control-expose-headers"), null);

// every policy's frame-ancestors (comma-joined headers), an empty list as 'none'
const one = (o) => upstreamFraming(new Headers(o));
assert.deepEqual(one({ "Content-Security-Policy": "frame-ancestors *, script-src 'self'; frame-ancestors 'self' https://a.example" }),
  { "X-Upstream-Frame-Ancestors": "*, 'self' https://a.example", "Access-Control-Expose-Headers": "X-Upstream-Frame-Options, X-Upstream-Frame-Ancestors" });
assert.equal(one({ "Content-Security-Policy": "frame-ancestors" })["X-Upstream-Frame-Ancestors"], "'none'");
assert.equal(one({ "Content-Security-Policy": "FRAME-ANCESTORS https:" })["X-Upstream-Frame-Ancestors"], "https:");
assert.deepEqual(one({}), {});
console.log("worker framing headers: ok");
