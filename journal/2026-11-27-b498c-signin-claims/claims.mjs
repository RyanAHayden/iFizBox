// NODE_EXTRA_CA_CERTS=<Apple root PEM> node claims.mjs <repo> server...
// Asks GrandSlam's SRP init (made-up address, no password) through each server as each claim. -20970 = Apple took it.
const [repo, ...hosts] = process.argv.slice(2);
const g = await import(`${repo}/web/app/core/gsa.js`);
const direct = (spell) => async ({ url, method = "GET", headers = {}, body }) => {
  const h = { ...headers };
  if (spell && h["X-MMe-Client-Info"]) h["X-MMe-Client-Info"] = h["X-MMe-Client-Info"].replace("<macOS;26.6;", "<Mac OS X;26.6;");
  const r = await fetch(url, { method, headers: h, body, signal: AbortSignal.timeout(20000) });
  return { status: r.status, headers: {}, body: new Uint8Array(await r.arrayBuffer()) };
};
const wsUrl = (s) => `wss://${new URL(s).host}/v3/provisioning_session`;
for (const host of hosts) {
  for (const [label, claim, spell] of [["advertised", "advertised", false], ["mac <macOS;", "mac", false], ["mac <Mac OS X;", "mac", true]]) {
    const transport = direct(spell);
    try {
      const ani = g.anisetteV3({ transport, servers: [`https://${host}`], wsUrl, provisionTimeout: 30000 });
      await ani.use(`https://${host}`, claim);
      const s = new g.AppleIdSession({ transport, anisette: ani });
      const { resp } = await s.init(`nobody-${crypto.randomUUID().slice(0, 12)}@example.invalid`);
      console.log(host, label, "->", JSON.stringify(resp.Status ?? {}));
    } catch (e) { console.log(host, label, "-> FAIL", e.message, e.cause?.message ?? ""); }
  }
}
process.exit(0);
