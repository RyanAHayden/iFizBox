// anisette hosts (HTTP and WebSocket) through the local `wrangler dev` relay (this branch's allow-list), gsa.apple.com
// through the deployed ifizbox.com relay. An earlier run with rounds [1, 2] provisioned the same identifier twice.
const repo = "/home/ryha/runs/iFizBox/s1";
const g = await import(`${repo}/web/app/core/gsa.js`);
const local = "http://localhost:28611";
const viaLocal = g.relayTransport({ base: `${local}/apple` });
const viaDeployed = g.relayTransport({ base: "https://ifizbox.com/apple" });
const transport = (req) => (new URL(req.url).host === "gsa.apple.com" ? viaDeployed : viaLocal)(req);
for (const server of g.ANISETTE_SERVERS) {
  let saved = null;
  for (const round of [1]) {
    const ani = g.anisetteV3({ transport, servers: [server], wsUrl: (s) => g.relayWsUrl(s, local),
      storage: { load: () => saved && { identifier: saved.identifier }, save: (s) => { saved = s; } } });
    try {
      const h = await ani.get();
      console.log(server, "round", round, "OK", Object.keys(h.headers).join(" "));
    } catch (e) { console.log(server, "round", round, "FAIL", e.message); }
  }
}
process.exit(0);
