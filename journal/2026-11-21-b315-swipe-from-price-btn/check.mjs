// B315 Chromium check: the app's own My IPAs list (screens/myipas.js libraryGroup, with the app's CSS) in headless
// Chromium; a left drag that starts on a row's SIGN button (real CDP mouse events, so the browser makes the pointer
// and click events) must show Delete and not reach on.price; a plain click on the button must reach it.
//
//   node check.mjs <base url of web/app/> <out dir>
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const [base, out] = process.argv.slice(2);
const prof = await mkdtemp(join(out ?? tmpdir(), "prof-"));
const port = 9333 + Math.floor(Math.random() * 500);
const chrome = spawn("chromium", ["--headless", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = l.find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
  if (!ws) await sleep(200);
}
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const mouse = (type, x, y) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); await writeFile(join(out, name + ".png"), Buffer.from(r.result.data, "base64")); };

let fail = 0;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) fail++; };
try {
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 402, height: 500, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: base });
  await sleep(3000);
  console.log(await ev(`(async () => {
    const m = await import("./screens/myipas.js");
    window.__prices = [];
    const draw = () => {
      const g = m.libraryGroup([{ file: "Delta.ipa", name: "Delta", bundleId: "com.x.delta", version: "1.5", size: 1048576, signed: null },
        { file: "Alpha.ipa", name: "Alpha", bundleId: "com.x.alpha", version: "2.0", size: 2097152, signed: null }],
        { site: false, jailbreak: false, on: { price: (r) => window.__prices.push(r.file) } });
      document.body.replaceChildren(g.el);
      window.__g = g;
    };
    window.__draw = draw; draw();
    return "drawn " + document.querySelectorAll(".myipa-row").length + " rows";
  })()`));
  const box = async () => JSON.parse(await ev(`JSON.stringify((() => { const r = __g.price("Delta.ipa").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })())`));
  let b = await box();
  // a plain click on SIGN
  await mouse("mousePressed", b.x, b.y); await mouse("mouseReleased", b.x, b.y); await sleep(200);
  check(JSON.parse(await ev("JSON.stringify(__prices)")).join() === "Delta.ipa", "a click on SIGN reaches on.price");
  await ev("__prices = []; __draw()");
  await sleep(200);
  b = await box();
  // a left drag that starts on SIGN
  await mouse("mousePressed", b.x, b.y);
  for (let dx = 10; dx <= 80; dx += 10) { await mouse("mouseMoved", b.x - dx, b.y + 1); await sleep(16); }
  await mouse("mouseReleased", b.x - 80, b.y + 1);
  await sleep(500);
  check(await ev(`__g.cellOf("Delta.ipa").classList.contains("armed")`) === true, "a drag from SIGN shows Delete");
  check(JSON.parse(await ev("JSON.stringify(__prices)")).length === 0, "the drag's lift doesn't reach on.price");
  check(await ev(`getComputedStyle(__g.cellOf("Delta.ipa").querySelector(".del-confirm")).visibility`) !== "hidden", "Delete is visible");
  if (out) await shot("swiped-from-sign");
} finally {
  chrome.kill();
  await sleep(300);
  await rm(prof, { recursive: true, force: true });
}
process.exit(fail ? 1 : 0);
