// node shot.mjs <base url> <outdir> — B436: Pairing in headless Chromium (402x874) with a fake sideload bridge: the
// code, then the expired answer, then Get New Code. Serve web/app first: python3 -m http.server <port> -d web/app
import { spawn } from "node:child_process";
import { writeFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";

const [base, outdir] = process.argv.slice(2);
const W = 402, SLOW = 4000;
const prof = await mkdtemp(join(outdir, "prof-"));
const port = 9333 + Math.floor(Math.random() * 500);
const chrome = spawn("chromium", ["--headless", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const done = (c) => { try { chrome.kill(); } catch {} process.exit(c); };
setTimeout(() => { console.error("timeout"); done(2); }, 120000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = l.find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
  if (!ws) await sleep(200);
}
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method === "Runtime.exceptionThrown") console.error("page exception:", m.params.exceptionDetails?.exception?.description); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };

const BRIDGE = `(() => {
  let pairs = 0;
  globalThis.ifizboxApp = true;
  globalThis.ifizboxNative = { mode: "sideload", call(method, params, ev) {
    if (method === "idevice.status") return Promise.resolve({ paired: null, ios: "27.0", pairOnPhone: true, otherVPN: false, tunnels: [], vpn: { available: true, tested: false, cellular: false, wifi: true, shortcuts: {} } });
    if (method === "idevice.pair") return new Promise((_, no) => {
      ev([{ pin: "12345" + ++pairs }]); ev([{ step: "advertised", text: "Waiting for the iPhone to connect (port 50123)." }]);
      globalThis.expire = () => no(Object.assign(new Error("the pairing code expired"), { code: "expired" }));
    });
    if (method === "idevice.pairState") return Promise.resolve({ active: false });
    return Promise.resolve(null);
  } };
})();`;
await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: 874, deviceScaleFactor: 1, mobile: true });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148" });
await send("Page.addScriptToEvaluateOnNewDocument", { source: BRIDGE });

const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: W, height: 874, scale: 1 } });
  await writeFile(join(outdir, `${name}.png`), Buffer.from(r.result.data, "base64"));
};
const page = () => ev(`(document.querySelector(".nav-item.is-top .nav-title")?.textContent || "?") + " :: " + [...document.querySelectorAll(".page.is-top .group-header, .page.is-top .cell-inner, .page.is-top .group-footer")].map((n) => n.classList.contains("group-header") ? "[" + n.textContent + "]" : n.classList.contains("group-footer") ? "{" + n.textContent + "}" : (n.querySelector(".cell-label")?.textContent || "") + (n.querySelector(".cell-detail")?.textContent ? "=" + n.querySelector(".cell-detail").textContent : "") + (n.querySelector(".loading-spinner") ? "(spin)" : "")).join(" / ")`);
await send("Page.navigate", { url: base });
await sleep(3000);
await ev(`localStorage.setItem("ifizbox.installRoute", "iphone"); localStorage.setItem("ifizbox.firstVisit", "later")`);
await send("Page.navigate", { url: "about:blank" });
await sleep(300);
await send("Page.navigate", { url: `${base}#/home/settings/installation/pair` });
await sleep(3500);
await shot("1-code"); console.log(await page());
await ev("expire()"); await sleep(800);
await shot("2-expired"); console.log(await page());
await ev(`document.dispatchEvent(new Event("visibilitychange"))`); await sleep(800);
console.log("back in front:", await page());
await ev(`[...document.querySelectorAll(".page.is-top .sign-import")].find((n) => n.textContent === "Get New Code").querySelector(".cell-inner").click()`); await sleep(800);
await shot("3-new-code"); console.log(await page());
done(0);
