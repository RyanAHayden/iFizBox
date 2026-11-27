// node check.mjs <repo> <local relay origin> [server...]: anisetteV3 with relayTransport. Anisette hosts (HTTP and
// WebSocket) go through the local `wrangler dev` relay; gsa.apple.com through the deployed ifizbox.com relay, because
// local workerd doesn't trust Apple's root CA. No Apple ID is used.
const [repo, local, ...only] = process.argv.slice(2);
const g = await import(`${repo}/web/app/core/gsa.js`);
const viaLocal = g.relayTransport({ base: `${local}/apple` });
const viaDeployed = g.relayTransport({ base: "https://ifizbox.com/apple" });
const transport = (req) => (new URL(req.url).host === "gsa.apple.com" ? viaDeployed : viaLocal)(req);
class Watched extends WebSocket {
  constructor(url) {
    super(url);
    this.addEventListener("close", (e) => console.log("  socket close", e.code, e.wasClean ? "clean" : "unclean"));
    this.addEventListener("error", () => console.log("  socket error"));
  }
}
for (const server of only.length ? only : g.ANISETTE_SERVERS) {
  const ani = g.anisetteV3({ transport, servers: [server], wsUrl: (s) => g.relayWsUrl(s, local), WebSocketImpl: Watched,
    log: (m) => console.log("  " + m) });
  try {
    const h = await ani.get();
    console.log(server, "OK", Object.keys(h.headers).join(" "));
  } catch (e) { console.log(server, "FAIL", e.message); }
  await new Promise((done) => setTimeout(done, 1000));
}
process.exit(0);
