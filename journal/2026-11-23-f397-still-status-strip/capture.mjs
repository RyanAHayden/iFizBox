// F397: every kind of sheet (the console, Add Tweaks, Confirm) mid-slide up, settled and mid-slide down, at the iPhone
// 18 Pro's screen (402x874 CSS px at DPR 3, safe areas 62 top / 34 bottom) in headless Chromium over CDP. Adapted from
// B379's capture.mjs.
//
//   node capture.mjs <base url of web/app> <outdir> [eras, comma-separated]
//
// Shells: "site" (no bridge), "app" (a fake ifizboxNative in sideload mode, data-shell="app").
import { spawn } from "node:child_process";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

const [base, outdir] = process.argv.slice(2);
const prof = await mkdtemp(join(process.cwd(), "prof-"));
const port = 9900 + Math.floor(Math.random() * 400);
const chrome = spawn("chromium", ["--headless", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const cleanup = () => { try { chrome.kill(); } catch {} };
process.on("exit", cleanup);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = l.find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
  if (!ws) await sleep(200);
}
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map(); const handlers = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) for (const h of handlers) h(m);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); await writeFile(join(outdir, name + ".png"), Buffer.from(r.result.data, "base64")); };

const BRIDGE = `(() => {
  const waiting = new Map(); let next = 1;
  globalThis.__natReply = (id, ok, value) => { const w = waiting.get(id); if (!w) return; waiting.delete(id); ok ? w.res(value) : w.rej(new Error(value)); };
  const call = (method, params) => new Promise((res, rej) => { const id = next++; waiting.set(id, { res, rej }); globalThis.__nat(JSON.stringify({ id, method, params: params || {} })); });
  globalThis.ifizboxApp = true;
  globalThis.ifizboxNative = { call, jailbreak: null, mode: "sideload", emit() {}, helper: () => Promise.reject(new Error("no helper")) };
  document.documentElement.setAttribute("data-shell", "app");
  document.documentElement.style.setProperty("--status-bar-bottom", "54px");
})();`;
handlers.push(async (m) => {
  if (m.method !== "Runtime.bindingCalled" || m.params.name !== "__nat") return;
  const { id: cid, method } = JSON.parse(m.params.payload);
  const value = method === "app.info" ? { version: "0.21.0", build: "", ios: "18.1", jailbreak: null, mode: "sideload", machine: "iPhone18,1", markers: [] } : null;
  await send("Runtime.evaluate", { expression: `__natReply(${cid}, true, ${JSON.stringify(value)})` });
});

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 402, height: 874, deviceScaleFactor: 3, mobile: true });
const sa = await send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 62, bottom: 34, left: 0, right: 0 } });
if (sa.error) console.log("safe area override:", sa.error.message);
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", platform: "iPhone" });
await send("Runtime.addBinding", { name: "__nat" });
let bridgeId = null;

const OPEN = (kind) => `(async () => {
  if (${JSON.stringify(kind)} === "console") {
    const { openProgress } = await import("./nav/progress.js");
    const h = openProgress({ title: "Running" });
    globalThis.__close = () => h.close();
    h.step("Downloading Packages"); h.raw("Get:1 https://repo.example/ ./ com.example.tweak 1.0"); h.step("Installing com.example.tweak");
    h.status("Installing com.example.tweak"); h.set?.(0.4);
  } else {
    const { showSheet } = await import("./nav/sheet.js");
    const body = document.createElement("div"); body.className = "sheet-scroll";
    const confirm = ${JSON.stringify(kind)} === "confirm";
    globalThis.__close = showSheet({ title: confirm ? "Confirm" : "Add Tweaks", body, cls: confirm ? "confirm-sheet" : "" });
  }
  await new Promise((r) => requestAnimationFrame(r));
  for (const a of document.getAnimations()) { a.pause(); a.currentTime = 140; }
  return "ok";
})()`;
const PROBE = `(() => { const b = document.querySelector(".sheet .sheet-bar"); const s = getComputedStyle(b, "::before");
  const r = b.getBoundingClientRect(); return { cls: b.parentElement.className, barTop: Math.round(r.top), barH: Math.round(r.height), beforeH: s.height, beforeBg: s.backgroundImage.slice(0, 90), beforeColor: s.backgroundColor }; })()`;

const ERAS = (process.argv[4] ?? "ios6,ios7,ios13,ios26").split(",");
for (const shell of ["site", "app"]) {
  if (shell === "app" && !bridgeId) bridgeId = (await send("Page.addScriptToEvaluateOnNewDocument", { source: BRIDGE })).result.identifier;
  for (const era of ERAS) for (const tone of ["light", "dark"]) for (const kind of ["console", "sheet", "confirm"]) {
    await send("Page.navigate", { url: base });
    await sleep(1500);
    await ev(`localStorage.setItem("ifizbox.style", ${JSON.stringify(era)}); localStorage.setItem("ifizbox.appearance", ${JSON.stringify(tone)}); localStorage.setItem("ifizbox.firstVisit", "later"); 1`);
    await send("Page.navigate", { url: base + "?r=" + (++id) + "#/sources" });
    await sleep(2500);
    const name = `${shell}-${era}-${tone}-${kind}`;
    console.log(name, await ev(OPEN(kind)));
    await sleep(200); await shot(name + "-mid");
    console.log(name, "mid", JSON.stringify(await ev(PROBE)));
    await ev(`(() => { for (const a of document.getAnimations()) { try { a.finish(); } catch (e) { a.cancel(); } } return 1; })()`);
    await sleep(300); await shot(name + "-settled");
    console.log(name, "settled", JSON.stringify(await ev(PROBE)));
    await ev(`(async () => { __close(); await new Promise((r) => requestAnimationFrame(r)); for (const a of document.getAnimations()) { a.pause(); a.currentTime = 140; } return 1; })()`);
    await sleep(200); await shot(name + "-down");
    console.log(name, "down", JSON.stringify(await ev(PROBE)));
  }
}
ws.close(); cleanup();
await sleep(500);
await rm(prof, { recursive: true, force: true });
process.exit(0);
