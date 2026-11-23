// B384: the Not-an-iPhone page as mac, pc and android, light and dark, 1280 and 390 wide; headless Chromium over CDP.
//   node capture.mjs <base url of web/app> <outdir> <profile dir>
// Then clicks both tiles (mouse events) on the mac page and prints whether the page is still up and the tabs opened.
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
const [base, outdir, prof] = process.argv.slice(2);
const port = 9900 + Math.floor(Math.random() * 400);
const chrome = spawn("chromium", ["--headless", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
process.on("exit", () => chrome.kill());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try { const p = (await list()).find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
  if (!ws) await sleep(200);
}
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); pend.get(m.id)?.(m); pend.delete(m.id); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
const UA = {
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  pc: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36",
};
await send("Page.enable");
for (const [kind, userAgent] of Object.entries(UA)) for (const theme of ["light", "dark"]) for (const width of [1280, 390]) {
  await send("Emulation.setUserAgentOverride", { userAgent });
  await send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 2, mobile: width < 600 });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
  await send("Page.navigate", { url: base });
  await sleep(500);
  await ev(`localStorage.setItem("ifizbox.appearance", "${theme}")`);
  await send("Page.reload");
  await sleep(1500);
  const r = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(outdir, `${kind}-${width}-${theme}.png`), Buffer.from(r.result.data, "base64"));
  console.log(kind, width, theme, await ev(`JSON.stringify({ kind: document.querySelector(".notiphone")?.dataset.kind, theme: document.documentElement.dataset.theme, sideways: document.documentElement.scrollWidth > innerWidth, tiles: [...document.querySelectorAll(".notiphone .home-tile")].map(a => { const b = a.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(Math.round); }), table: (b => [b.x, b.width])(document.querySelector(".notiphone .table.grouped").getBoundingClientRect()) })`));
  if (kind === "mac" && theme === "light") for (const i of [0, 1]) {
    const [x, y] = JSON.parse(await ev(`(() => { const b = document.querySelectorAll(".notiphone .home-tile")[${i}].getBoundingClientRect(); return JSON.stringify([b.x + b.width / 2, b.y + b.height / 2]); })()`));
    for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
    await sleep(1500);
    console.log("click", i, "page up:", await ev(`!!document.querySelector(".notiphone")`), (await list()).filter((t) => t.type === "page").map((t) => t.url));
    for (const t of (await list()).filter((t) => t.type === "page" && !t.url.startsWith(base))) await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`);
  }
}
process.exit(0);
