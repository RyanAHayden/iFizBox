// node browser.mjs <profile-dir> <rounds> [server...]: the same count as measure.mjs, but each get() runs in a headless
// Chromium page on ifizbox.com with the deployed core/gsa.js and the browser's own WebSocket. No Apple ID is used.
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const [profile, rounds, ...only] = process.argv.slice(2);
const site = process.env.RELAY || "https://ifizbox.com";
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const chrome = spawn("chromium", ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
  "--no-first-run", `${site}/`], { stdio: "ignore" });
try {
  const portFile = `${profile}/DevToolsActivePort`;
  let page;
  for (let i = 0; i < 100 && !page; i++) {
    await sleep(200);
    if (!existsSync(portFile)) continue;
    const port = readFileSync(portFile, "utf8").split("\n")[0];
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json().catch(() => []);
    page = list.find((t) => t.type === "page" && t.url.startsWith(site));
  }
  if (!page) throw new Error("no page");
  await sleep(3000); // let the site finish loading
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done, bad) => { ws.onopen = done; ws.onerror = bad; });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); waiting.get(m.id)?.(m); };
  const evaluate = (expression) => new Promise((done) => {
    waiting.set(++id, (m) => done(m.result?.result?.value ?? JSON.stringify(m.result ?? m.error)));
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate",
      params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  const run = async (server) => {
    const g = await import("/core/gsa.js");
    const sockets = [];
    const log = [];
    class Watched extends WebSocket {
      constructor(url) {
        super(url);
        const s = { last: null, code: null, byUs: false };
        sockets.push(s);
        this.record = s;
        this.addEventListener("message", (e) => {
          try { s.last = JSON.parse(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data)).result; } catch { s.last = "?"; }
        });
        this.addEventListener("close", (e) => { s.code = e.code; });
      }
      close(...args) {
        if (this.readyState === WebSocket.OPEN) this.record.byUs = true;
        super.close(...args);
      }
    }
    // No storage is passed, so each round provisions a new machine and the site's own is left alone.
    const ani = g.anisetteV3({ transport: g.relayTransport(), servers: [server], WebSocketImpl: Watched, log: (m) => log.push(m) });
    let result = "OK";
    try { await ani.get(); } catch (e) { result = `FAIL ${e.message}`; }
    await new Promise((done) => setTimeout(done, 2000));
    return JSON.stringify({ result, sockets, log });
  };
  const servers = only.length ? only : JSON.parse(await evaluate(`import("/core/gsa.js").then((g) => JSON.stringify(g.ANISETTE_SERVERS))`));
  for (const server of servers) {
    const total = { sockets: 0, dropped: 0, stalled: 0, ok: 0, codes: {} };
    for (let i = 1; i <= Number(rounds); i++) {
      const raw = await Promise.race([evaluate(`(${run})(${JSON.stringify(server)})`), sleep(150000).then(() => null)]);
      let r;
      try { r = JSON.parse(raw); } catch { console.log(server, i, "no answer", raw); continue; }
      if (r.result === "OK") total.ok++;
      for (const s of r.sockets) {
        total.sockets++;
        if (s.last && s.last !== "ProvisioningSuccess" && !s.byUs) total.dropped++;
        total.codes[s.code] = (total.codes[s.code] ?? 0) + 1;
      }
      total.stalled += r.log.filter((m) => m.includes("provisioning timed out")).length;
      console.log(server, i, r.result, JSON.stringify(r.sockets));
      if (r.result !== "OK") for (const m of r.log) console.log("   ", m);
    }
    console.log("TOTAL", server, JSON.stringify(total));
  }
  ws.close();
} finally {
  chrome.kill();
}
process.exit(0);
