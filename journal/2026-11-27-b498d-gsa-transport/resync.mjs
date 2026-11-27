// NODE_EXTRA_CA_CERTS=<Apple root PEM> node resync.mjs <repo> server...
// SRP init (made-up address, no password) on a freshly provisioned machine: prints whether Apple asked for the hsc 434
// resync, and what it answered after it. -20970 = Apple took the machine and the client.
const [repo, ...hosts] = process.argv.slice(2);
const g = await import(`${repo}/web/app/core/gsa.js`);
const wsUrl = (s) => `wss://${new URL(s).host}/v3/provisioning_session`;
for (const host of hosts) {
  const seen = [];
  const transport = async ({ url, method = "GET", headers = {}, body }) => {
    const r = await fetch(url, { method, headers: { ...headers, Connection: "close" }, body, signal: AbortSignal.timeout(20000) });
    const bytes = new Uint8Array(await r.arrayBuffer()), path = new URL(url).pathname;
    if (path === "/v3/get_headers" && body && JSON.parse(new TextDecoder().decode(body)).sim) seen.push(`get_headers with sim: HTTP ${r.status}`);
    if (path === "/grandslam/GsService2") {
      const st = r.status === 200 ? (g.decodePlist(bytes).Response?.Status ?? {}) : {};
      seen.push(`init: HTTP ${r.status} ec ${st.ec} hsc ${st.hsc}`);
    }
    return { status: r.status, headers: {}, body: bytes };
  };
  try {
    const ani = g.anisetteV3({ transport, servers: [`https://${host}`], wsUrl, provisionTimeout: 30000 });
    await ani.use(`https://${host}`);
    await new g.AppleIdSession({ transport, anisette: ani }).init(`nobody-${crypto.randomUUID().slice(0, 12)}@example.invalid`);
  } catch (e) { seen.push(`FAIL ${e.message} ${e.cause?.message ?? ""}`); }
  console.log(host, "->", seen.join("; "));
}
process.exit(0);
