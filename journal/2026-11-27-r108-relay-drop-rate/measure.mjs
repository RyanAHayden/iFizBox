// node measure.mjs <repo> <rounds> [server...]: each round is one get() with a new machine, every leg (anisette HTTP,
// WebSocket, gsa.apple.com) through the deployed ifizbox.com relay. No Apple ID is used. A socket counts as dropped
// when it talked and the other end closed it without ProvisioningSuccess, whatever the close code (the forwarding relay
// sends 1011 where the pass-through gave 1006). RELAY=<origin> measures another relay.
const [repo, rounds, ...only] = process.argv.slice(2);
const relay = process.env.RELAY || "https://ifizbox.com";
const g = await import(`${repo}/web/app/core/gsa.js`);
const transport = g.relayTransport({ base: `${relay}/apple` });
let sockets = [];
class Watched extends WebSocket {
  constructor(url) {
    super(url);
    const s = { last: null, code: null, error: false, byUs: false };
    sockets.push(s);
    this.record = s;
    this.addEventListener("message", (e) => {
      try { s.last = JSON.parse(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data)).result; } catch { s.last = "?"; }
    });
    this.addEventListener("error", () => { s.error = true; });
    this.addEventListener("close", (e) => { s.code = e.code; });
  }
  // gsa.js gives up on an open socket when Apple's call or the server's reply fails: that isn't a drop. After a drop it
  // calls close() too, but the socket is no longer open by then.
  close(...args) {
    if (this.readyState === WebSocket.OPEN) this.record.byUs = true;
    super.close(...args);
  }
}
for (const server of only.length ? only : g.ANISETTE_SERVERS) {
  const total = { sockets: 0, dropped: 0, stalled: 0, ok: 0, codes: {} };
  for (let i = 1; i <= Number(rounds); i++) {
    sockets = [];
    const log = [];
    const ani = g.anisetteV3({ transport, servers: [server], wsUrl: (s) => g.relayWsUrl(s, relay), WebSocketImpl: Watched,
      log: (m) => log.push(m) });
    let result = "OK";
    try { await ani.get(); total.ok++; } catch (e) { result = `FAIL ${e.message}`; }
    await new Promise((done) => setTimeout(done, 2000)); // let the close arrive; don't hurry Apple's MidService
    for (const s of sockets) {
      total.sockets++;
      if (s.last && s.last !== "ProvisioningSuccess" && !s.byUs) total.dropped++;
      total.codes[s.code] = (total.codes[s.code] ?? 0) + 1;
    }
    // A socket left open until gsa.js's time limit is closed by us, so it isn't in `dropped`: count it on its own.
    // gsa.js logs each failure once per attempt it gives up on ("trying ... once more" or "... failed").
    total.stalled += log.filter((m) => m.includes("provisioning timed out")).length;
    console.log(server, i, result, JSON.stringify(sockets));
    if (result !== "OK") for (const m of log) console.log("   ", m);
  }
  console.log("TOTAL", server, JSON.stringify(total));
}
process.exit(0);
