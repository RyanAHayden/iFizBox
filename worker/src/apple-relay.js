// The Apple relay for the website's free Apple ID sign-in (web/app/core/gsa.js). Apple's sign-in (gsa.apple.com), its
// developer services and the public anisette servers send no CORS headers, so the browser can't call them itself.
// This forwards a request to a fixed allow-list of hosts and paths and nothing else:
//
//   <METHOD> /apple/<host>/<path>?<query>   ->  <METHOD> https://<host>/<path>?<query>
//   GET /apple/<anisette host>/v3/provisioning_session with Upgrade: websocket  ->  the server's WebSocket, forwarded
//   GET /apple/status   ->  {"on":true} (F254: the Signing page shows Use a Free Apple ID only then; off it's a 404)
//
// Rules: only https to the hosts in ALLOW and their path patterns; GET, POST and PUT; the request body up to
// MAX_REQUEST and the reply up to MAX_REPLY; TIMEOUT_MS per request; redirects aren't followed (an Apple redirect
// could point anywhere); only the headers in PASS_HEADERS go out (no cookies, no client IP), and only Content-Type
// comes back. Browsers can't set User-Agent, so the page sends it as X-Relay-User-Agent. No CORS headers: only pages
// on this origin can read the replies, and a cross-site page (Origin or Sec-Fetch-Site says so) gets 403.
//
// App Store Connect (own provisioning profiles, web/app/core/asc.js): api.appstoreconnect.apple.com sends no CORS
// headers either (checked 2026-11-19: the preflight gets a bare 401), so the website's calls with the user's API key
// come through here too. Only for that host: the Authorization header (the user's JWT) goes out, and DELETE (an old
// profile, before its new one) is allowed. It stays on with APPLE_RELAY off: it's the paid-account route, not the
// free Apple ID spike. The JWT is never logged or kept, like everything else here.
//
// Privacy: bodies carry SRP proofs, 2FA codes, the Xcode app token and developer-portal replies. Nothing here logs,
// stores or caches a request or reply: they go straight through, and errors name only the host and path.
const TIMEOUT_MS = 20000;
export const MAX_REQUEST = 64 * 1024; // GrandSlam plists and a CSR are a few KB
export const MAX_REPLY = 2 * 1024 * 1024; // a provisioning profile is ~15 KB, a device or App ID list more

// Public anisette servers from SideStore's list that speak v3: gsa.js ANISETTE_SERVERS, in its order.
export const ANISETTE_HOSTS = ["new.ani.sidestore.io", "mac-ani.jkcoxson.com", "ani.iloader.app", "ani3.stikstore.app",
  "ani.jkcoxson.com", "ani2.stikstore.app", "win.ani.sidestore.io", "anisette.lillq.me"];
const ANISETTE_PATHS = [/^\/v3\/client_info$/, /^\/v3\/get_headers$/, /^\/$/];

export const ASC_HOST = "api.appstoreconnect.apple.com";
export const ALLOW = {
  "gsa.apple.com": [
    /^\/grandslam\/GsService2(\/(lookup|validate))?$/, // SRP init/complete, apptokens, the URL bag, 2FA validate
    /^\/grandslam\/MidService\/(start|finish)MachineProvisioning$/, // anisette v3 provisions a machine through these
    /^\/auth$/, // trusted phone numbers (JSON)
    /^\/auth\/verify\/(trusteddevice|phone|phone\/securitycode)$/, // 2FA: push to devices, SMS and its code
  ],
  "developerservices2.apple.com": [/^\/services\/QH65B2\/(ios\/)?[A-Za-z]+\.action$/],
  [ASC_HOST]: [/^\/v1\/(devices|certificates|bundleIds|bundleIdCapabilities|profiles)(\/[A-Za-z0-9-]+(\/bundleIdCapabilities)?)?$/],
  ...Object.fromEntries(ANISETTE_HOSTS.map((h) => [h, ANISETTE_PATHS])),
};
const WS_PATH = /^\/v3\/provisioning_session$/;

// Request headers that go out (lower case). Apple's sign-in reads its X-Apple-*/X-Mme-* headers and the 2FA code.
const PASS_HEADERS = new Set(["content-type", "accept", "accept-language", "x-mme-client-info", "x-mme-device-id",
  "x-xcode-version", "x-apple-app-info", "x-apple-i-client-time", "x-apple-i-md", "x-apple-i-md-m", "x-apple-i-md-rinfo",
  "x-apple-i-md-lu", "x-apple-i-srl-no", "x-apple-i-timezone", "x-apple-locale", "x-apple-identity-token",
  "x-apple-i-identity-id", "x-apple-gs-token", "security-code"]);

export const isApplePath = (pathname) => pathname.startsWith("/apple/");

const fail = (code, error, status) => new Response(JSON.stringify({ code, error }), { status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// "/apple/<host>/<path>" -> the target URL, or null when the host or path isn't on the allow-list.
export function relayTarget(u, { ws = false } = {}) {
  const m = /^\/apple\/([a-z0-9.-]+)(\/.*)$/.exec(u.pathname);
  if (!m) return null;
  const [, host, path] = m;
  if (!Object.hasOwn(ALLOW, host)) return null;
  if (path.includes("..") || path.includes("//")) return null;
  const ok = ws ? ANISETTE_HOSTS.includes(host) && WS_PATH.test(path) : ALLOW[host].some((re) => re.test(path));
  return ok ? new URL(`https://${host}${path}${u.search}`) : null;
}

function crossSite(req, u) {
  const site = req.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin" && site !== "none") return true;
  const origin = req.headers.get("Origin");
  if (!origin) return false;
  try { return new URL(origin).host !== u.host; } catch { return true; }
}

async function readCapped(stream, cap) {
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) { reader.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out;
}

// Off unless the deploy sets APPLE_RELAY = "1": ifizbox.com (wrangler.ifizbox.toml) and the preview do; a
// self-hosted Worker stays off until its owner opts in.
export const relayOn = (env) => String(env?.APPLE_RELAY ?? "") === "1";
export const STATUS_PATH = "/apple/status";

// B498b: the provisioning WebSocket. The Worker holds both sockets and forwards each message itself. Handing the
// server's 101 straight to the browser dropped the connection (close 1006) as the server sent its last message and
// closed; here a message is sent on before the close that follows it, and the browser gets a proper close frame even
// when the server drops without one.
// A close code close() accepts: 1005 (none given) and 1006 (dropped) only ever describe a close, they can't be sent.
const closeCode = (c) => (c === 1005 ? 1000 : (c >= 1000 && c <= 1003) || (c >= 1007 && c <= 1014) || (c >= 3000 && c <= 4999) ? c : 1011);
function close(socket, code, reason) {
  try { socket.close(closeCode(code), reason); } catch { /* closed already */ }
}
function pipe(from, to) {
  from.addEventListener("message", (e) => { try { to.send(e.data); } catch { close(from, 1011); } });
  from.addEventListener("close", (e) => { close(to, e.code, e.reason); close(from, e.code); }); // pass it on, and answer it
  from.addEventListener("error", () => close(to, 1011));
}
// The 101 that hands `client` to the browser (a Worker's Response; Node's has no status 101, so the tests pass their own).
const switching = (client) => new Response(null, { status: 101, webSocket: client });

async function relaySocket(target, { fetcher, Pair, upgrade }) {
  const where = `${target.host}${target.pathname}`;
  let r;
  try {
    r = await fetcher(target.href, { headers: { Upgrade: "websocket" } });
  } catch (e) {
    return fail("upstream", `Couldn't reach ${where}${e?.message ? ` (${e.message})` : ""}.`, 502);
  }
  const server = r.webSocket;
  if (!server) {
    r.body?.cancel().catch(() => {});
    return fail("upstream", `${where} didn't open a WebSocket (HTTP ${r.status}).`, 502);
  }
  const [client, browser] = Object.values(new Pair());
  for (const s of [server, browser]) s.binaryType = "arraybuffer"; // newer compatibility dates hand out Blobs, which send() refuses
  pipe(server, browser);
  pipe(browser, server);
  server.accept(); // after the listeners: the server's first message is already on its way
  browser.accept();
  return upgrade(client);
}

export async function appleRelay(req, env = {}, { fetcher = fetch, timeout = TIMEOUT_MS, Pair = globalThis.WebSocketPair,
  upgrade = switching } = {}) {
  const u = new URL(req.url);
  const asc = u.pathname.startsWith(`/apple/${ASC_HOST}/`);
  if (!relayOn(env) && !asc) return fail("not_found", "The Apple relay is off on this server (APPLE_RELAY).", 404);
  if (crossSite(req, u)) return fail("cross_site", "This relay is only for this website's own pages.", 403);
  // F254: the website asks this before it offers Use a Free Apple ID (off: the 404 above).
  if (u.pathname === STATUS_PATH && req.method === "GET") {
    return new Response(JSON.stringify({ on: true }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
  const ws = (req.headers.get("Upgrade") || "").toLowerCase() === "websocket";
  const target = relayTarget(u, { ws });
  if (!target) return fail("not_allowed", "That host or path isn't on the relay's list.", 403);

  if (ws) {
    if (req.method !== "GET") return fail("bad_method", "A WebSocket starts with GET.", 405);
    return relaySocket(target, { fetcher, Pair, upgrade });
  }
  if (!["GET", "POST", "PUT", ...(asc ? ["DELETE"] : [])].includes(req.method)) return fail("bad_method", "GET, POST or PUT only.", 405);

  const headers = new Headers();
  for (const [k, v] of req.headers) if (PASS_HEADERS.has(k.toLowerCase())) headers.set(k, v);
  if (asc && req.headers.get("Authorization")) headers.set("Authorization", req.headers.get("Authorization"));
  const ua = req.headers.get("X-Relay-User-Agent");
  if (ua) headers.set("User-Agent", ua);
  // GrandSlam answers a reused connection with 5xx: a fresh one per request. Node's fetch (node.mjs) does as told;
  // Cloudflare's drops the header and pools as it likes.
  if (target.host === "gsa.apple.com") headers.set("Connection", "close");

  let body;
  if (req.method !== "GET" && req.method !== "DELETE") {
    if (Number(req.headers.get("Content-Length") || 0) > MAX_REQUEST) return fail("too_large", `Requests are capped at ${MAX_REQUEST} bytes.`, 413);
    body = await readCapped(req.body, MAX_REQUEST);
    if (!body) return fail("too_large", `Requests are capped at ${MAX_REQUEST} bytes.`, 413);
  }

  const where = `${target.host}${target.pathname}`;
  const signal = AbortSignal.timeout(timeout);
  let r;
  try {
    r = await fetcher(target.href, { method: req.method, headers, body, redirect: "manual", signal });
  } catch (e) {
    const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError";
    return fail(timedOut ? "timeout" : "upstream", timedOut ? `${where} didn't answer in ${timeout / 1000} s.`
      : `Couldn't reach ${where}${e?.message ? ` (${e.message})` : ""}.`, timedOut ? 504 : 502);
  }
  if (r.status >= 300 && r.status < 400) {
    r.body?.cancel().catch(() => {});
    return fail("redirect", `${where} answered with a redirect (HTTP ${r.status}), which the relay doesn't follow.`, 502);
  }
  if (Number(r.headers.get("Content-Length") || 0) > MAX_REPLY) {
    r.body?.cancel().catch(() => {});
    return fail("reply_too_large", `${where}'s reply is over ${MAX_REPLY} bytes.`, 502);
  }
  let reply;
  try {
    reply = await readCapped(r.body, MAX_REPLY);
  } catch {
    return fail("timeout", `${where} didn't finish its reply in ${timeout / 1000} s.`, 504);
  }
  if (!reply) return fail("reply_too_large", `${where}'s reply is over ${MAX_REPLY} bytes.`, 502);
  const out = { "Cache-Control": "no-store", "X-Relay-Status": String(r.status) };
  const ct = r.headers.get("Content-Type");
  if (ct) out["Content-Type"] = ct;
  // Apple's status goes through as is (200..599); a 1xx or odd value can't be a Response status, so it's reported.
  const status = r.status >= 200 && r.status <= 599 ? r.status : 502;
  return new Response(reply, { status, headers: out });
}
