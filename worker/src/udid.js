// This iPhone's UDID for the website, through a configuration profile (Apple's "Profile Service"). A website can't
// read the UDID, but iOS hands it to a profile that asks:
//
//   POST /sign/udid                    { challenge, profile, poll, expiresIn }: a new visit, its challenge kept in KV
//   GET  /sign/udid/<c>/udid.mobileconfig   the Profile Service profile (DeviceAttributes UDID, PRODUCT, VERSION;
//                                      Challenge <c>; URL the answer route below). Unsigned: iOS shows "Not Verified"
//   POST /sign/udid/<c>/answer         where iOS sends its CMS-signed plist. The plist is read straight out of the CMS
//                                      (<?xml … </plist>, no signature check), {udid, product, version} kept under the
//                                      challenge for the TTL, and iOS gets a 301 to the done page
//   GET  /sign/udid/<c>/done           "go back" (Safari opens it, not the Home Screen web app)
//   GET  /sign/udid/<c>                { state: "waiting" } or { state: "done", udid, product, version }: polled by the
//                                      page that started it (Safari and the Home Screen web app don't share storage)
//
// Everything lives in the HOSTED KV namespace under "udid:<c>" and expires with the TTL. The answer is only taken
// for a challenge this Worker gave out, so a stranger can't fill KV.
import { NAME, BUNDLE_ID } from "../../web/app/brand.js";
import { KEYS } from "../../web/app/core/storagekeys.js";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS } });
const fail = (code, error, status = 400) => json({ code, error }, status);
export const MAX_ANSWER = 64 * 1024; // iOS's signed plist is a few KB
const key = (c) => `udid:${c}`;
const ROUTE = /^\/sign\/udid(?:\/([0-9a-f]{32})(?:\/(udid\.mobileconfig|answer|done))?)?$/;

export const isUdidPath = (pathname) => pathname === "/sign/udid" || pathname.startsWith("/sign/udid/");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unesc = (s) => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
const uuid = () => { const h = hex(16).toUpperCase(); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };

// The Profile Service profile for challenge `c`, answering at `url`.
export function udidProfile({ url, challenge }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <dict>
    <key>URL</key>
    <string>${esc(url)}</string>
    <key>DeviceAttributes</key>
    <array>
      <string>UDID</string>
      <string>PRODUCT</string>
      <string>VERSION</string>
    </array>
    <key>Challenge</key>
    <string>${esc(challenge)}</string>
  </dict>
  <key>PayloadOrganization</key>
  <string>${esc(NAME)}</string>
  <key>PayloadDisplayName</key>
  <string>${esc(NAME)}: This iPhone's UDID</string>
  <key>PayloadDescription</key>
  <string>Sends this iPhone's UDID, model and iOS version to ${esc(NAME)}'s website once, so Settings &gt; Signing can check it against your provisioning profile. Nothing is installed: iOS keeps no profile afterwards.</string>
  <key>PayloadIdentifier</key>
  <string>${esc(BUNDLE_ID)}.udid</string>
  <key>PayloadUUID</key>
  <string>${uuid()}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
  <key>PayloadType</key>
  <string>Profile Service</string>
</dict>
</plist>
`;
}

// The plist inside iOS's CMS-signed answer (or a bare plist): { udid, product, version, challenge }, or null when
// there's no plist or no usable UDID. The CMS isn't verified: the challenge is what ties the answer to a visit.
export function readAnswer(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text = "";
  for (let i = 0; i < b.length; i += 8192) text += String.fromCharCode(...b.subarray(i, i + 8192)); // latin1: byte for byte
  const start = text.indexOf("<?xml"), end = text.indexOf("</plist>", start);
  if (start < 0 || end < 0) return null;
  const xml = text.slice(start, end + 8);
  const get = (k) => {
    const m = new RegExp(`<key>\\s*${k}\\s*</key>\\s*<string>([^<]*)</string>`).exec(xml);
    return m ? unesc(m[1]).trim() : null;
  };
  const udid = get("UDID");
  // 40 hex digits (older iPhones), or 8-16 with a dash (iPhone XS and later): letters, digits and dashes only
  if (!udid || !/^[0-9A-Fa-f-]{20,64}$/.test(udid)) return null;
  const clip = (s) => (s && /^[\w.,() -]{1,64}$/.test(s) ? s : null);
  return { udid, product: clip(get("PRODUCT")), version: clip(get("VERSION")), challenge: get("CHALLENGE") };
}

const page = (title, body) => new Response(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>body{font:17px -apple-system,"Helvetica Neue",Helvetica,sans-serif;margin:0;padding:40px 24px;text-align:center;
color:#4c566c;background:#c5ccd4}h1{font-size:20px;color:#222}p{line-height:1.4}a{color:#2a5ca8}</style></head>
<body>${body}</body></html>
`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

export async function udid(req, env, { ttl = Math.max(60, Number(env.TTL) || 600) } = {}) {
  const u = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const m = ROUTE.exec(u.pathname);
  if (!m) return fail("not_found", "No such UDID route.", 404);
  const [, c, part] = m;
  if (!env.HOSTED) return fail("no_storage", "This server has no KV storage (HOSTED).", 501);

  if (!c) {
    if (req.method !== "POST") return fail("method", "POST to start.", 405);
    const challenge = hex(16);
    await env.HOSTED.put(key(challenge), JSON.stringify({ state: "waiting" }), { expirationTtl: ttl });
    const base = `${u.origin}/sign/udid/${challenge}`;
    return json({ challenge, profile: `${base}/udid.mobileconfig`, poll: base, expiresIn: ttl });
  }

  const read = async () => { try { return JSON.parse((await env.HOSTED.get(key(c))) ?? "null"); } catch { return null; } };
  const gone = () => fail("expired", "That UDID request has expired: start again.", 404);

  if (!part) {
    if (req.method !== "GET" && req.method !== "HEAD") return fail("method", "GET to poll.", 405);
    const s = await read();
    return s ? json(s) : gone();
  }

  if (part === "udid.mobileconfig") {
    if (req.method !== "GET" && req.method !== "HEAD") return fail("method", "GET the profile.", 405);
    if (!(await read())) return gone();
    return new Response(udidProfile({ url: `${u.origin}/sign/udid/${c}/answer`, challenge: c }), { headers: {
      "Content-Type": "application/x-apple-aspen-config", "Content-Disposition": 'attachment; filename="udid.mobileconfig"',
      "Cache-Control": "no-store" } });
  }

  if (part === "answer") {
    if (req.method !== "POST") return fail("method", "iOS POSTs here.", 405);
    const s = await read();
    if (!s) return gone();
    const size = Number(req.headers.get("Content-Length") || 0);
    if (size > MAX_ANSWER) return fail("too_large", "That's not iOS's answer.", 413);
    const body = new Uint8Array(await req.arrayBuffer());
    if (body.byteLength > MAX_ANSWER) return fail("too_large", "That's not iOS's answer.", 413);
    const a = readAnswer(body);
    if (!a || (a.challenge !== null && a.challenge !== c)) return fail("bad_answer", "No UDID in that answer.");
    await env.HOSTED.put(key(c), JSON.stringify({ state: "done", udid: a.udid, product: a.product, version: a.version }), { expirationTtl: ttl });
    // 301: iOS's Profile Service follows it to a page (in Safari) once the profile step closes
    return new Response(null, { status: 301, headers: { Location: `${u.origin}/sign/udid/${c}/done`, "Cache-Control": "no-store" } });
  }

  // done
  const s = await read();
  if (s?.state !== "done") return page("UDID", `<h1>No UDID yet</h1><p>This request has expired or iOS didn't send the UDID. Go back to ${esc(NAME)} and tap Find This iPhone's UDID again.</p>`);
  // Safari's own copy too (this page is the website's origin): Settings > Signing opened here has it at once
  const saved = JSON.stringify({ udid: s.udid, product: s.product ?? null, version: s.version ?? null }).replace(/</g, "\\u003c");
  return page("UDID Sent", `<h1>UDID Sent</h1><p>${esc(NAME)} has this iPhone's UDID${s.product ? ` (${esc(s.product)})` : ""}.</p>
<p>Go back to where you started (${esc(NAME)}'s website in Safari, or its Home Screen icon): Settings &gt; Signing fills in This iPhone by itself.</p>
<p><a href="${esc(u.origin)}/#/home/settings/signing">Open Settings &gt; Signing here</a></p>
<script>try { localStorage.setItem(${JSON.stringify(UDID_KEY)}, ${JSON.stringify(saved)}); } catch (e) {}</script>`);
}

export const UDID_KEY = KEYS.udid; // the website's localStorage key (web/app/screens/signing.js reads it)
