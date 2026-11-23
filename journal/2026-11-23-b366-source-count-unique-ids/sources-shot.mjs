// B366 check: the website (served by worker/node.mjs at BASE) in Jailbroken (Rootless), Havoc added, Sources tab shot.
//   node sources-shot.mjs <base url> <out.png>
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [base, out] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prof = await mkdtemp(join(tmpdir(), "b366-shot-"));
const port = 9400 + Math.floor(Math.random() * 500);
const chrome = spawn(process.env.CHROMIUM ?? "chromium", ["--headless", "--hide-scrollbars", "--no-first-run",
  `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const done = async (code) => { try { chrome.kill(); } catch {} await rm(prof, { recursive: true, force: true }).catch(() => {}); process.exit(code); };
setTimeout(() => { console.error("timeout"); done(3); }, 90000);

let ws;
for (let i = 0; i < 75 && !ws; i++) {
  try {
    const p = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
    if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); }
  } catch { ws = null; }
  if (!ws) await sleep(200);
}
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  return r.result?.result?.value;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", platform: "iPhone" });
await send("Page.addScriptToEvaluateOnNewDocument", { source:
  `try { localStorage.setItem("ifizbox.firstVisit", "later"); localStorage.setItem("ifizbox.device", "iphoneos-arm64"); localStorage.setItem("ifizbox.arch", "iphoneos-arm64"); } catch {}` });
await send("Page.navigate", { url: base + "#/home" });
await sleep(3000);
const added = await ev(`import("/backend.js").then((m) => m.getBackend().addSource("https://havoc.app/")).then((s) => JSON.stringify({ name: s.origin, count: s.count, countBy: s.countBy }))`);
console.log("added", added);
await send("Page.navigate", { url: base + "#/sources" });
await sleep(1500);
await send("Page.reload");
await sleep(4000);
console.log("havoc row:", await ev(`[...document.querySelectorAll("li, a, .row")].map((e) => e.innerText).filter((t) => /havoc/i.test(t)).slice(-1)[0] ?? "(none)"`));
const shot = await send("Page.captureScreenshot", { format: "png" });
await writeFile(out, Buffer.from(shot.result.data, "base64"));
console.log("wrote", out);
await done(0);
