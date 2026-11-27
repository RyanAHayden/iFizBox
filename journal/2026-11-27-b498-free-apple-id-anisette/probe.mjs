// node probe.mjs <repo> <direct|relayBase> server...
const [repo, mode, ...servers] = process.argv.slice(2);
const g = await import(`${repo}/web/app/core/gsa.js`);
const direct = async ({ url, method = "GET", headers = {}, body }) => {
  const r = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(20000) });
  return { status: r.status, headers: {}, body: new Uint8Array(await r.arrayBuffer()) };
};
const isDirect = mode === "direct";
const transport = isDirect ? direct : g.relayTransport({ base: `${mode}/apple` });
const wsUrl = isDirect ? (s) => `wss://${new URL(s).host}/v3/provisioning_session` : (s) => g.relayWsUrl(s, mode);
class LoggedWs extends WebSocket {
  constructor(u) {
    super(u);
    this.addEventListener("error", (e) => console.log("  ws error:", e.message || e.error?.message, e.error?.cause?.message || ""));
    this.addEventListener("close", (e) => console.log("  ws close:", e.code, e.reason));
  }
}
for (const s of servers) {
  const t0 = Date.now();
  const logged = async (req) => {
    const r = await transport(req);
    if (/Provisioning|get_headers|client_info/.test(req.url)) console.log("  ", new URL(req.url).pathname, r.status);
    return r;
  };
  const ani = g.anisetteV3({ transport: logged, servers: [`https://${s}`], wsUrl, WebSocketImpl: LoggedWs, provisionTimeout: 30000,
    log: (m) => console.log("  ", m) });
  try {
    const h = await ani.get();
    console.log(s, "OK", Object.keys(h.headers).length, "headers", Date.now() - t0, "ms");
  } catch (e) { console.log(s, "FAIL", e.message); }
}
process.exit(0);
