// B370: tap Installed > Manage's Select… fast, many times, in headless Chromium as the sideload app (a fake
// `ifizboxNative`: every call answers null, except app.info and ui.* below) under Theme > Style iOS 26, where the
// sheet is the anchored menu growing out of the button. After each tap it logs the button's label and the labels of
// every menu on screen.
//
//   node probe.mjs <base url> [gap ms] [taps]
//
// Taps are CDP mouse events at the button's centre (nav/tapguard.js ignores el.click()). Three apps are recorded
// in the install store first (core/installed.js recordInstall), so the presets have rows to count.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const [base, gapArg, tapsArg] = process.argv.slice(2);
const gap = Number(gapArg ?? 120), taps = Number(tapsArg ?? 12);
const prof = await mkdtemp(join(process.env.TMPDIR || tmpdir(), "b370-prof-"));
const port = 9400 + Math.floor(Math.random() * 500);
const chrome = spawn(process.env.CHROMIUM || "chromium", ["--headless", "--hide-scrollbars", "--no-first-run", `--remote-debugging-port=${port}`,
  `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const done = async (code) => { try { chrome.kill(); } catch {} await sleep(300); await rm(prof, { recursive: true, force: true }); process.exit(code); };
setTimeout(() => { console.log("timeout"); done(2); }, 60000);
let ws;
for (let i = 0; i < 150 && !ws; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = l.find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch (e) { if (i % 20 === 19) console.log("cdp:", e.cause?.code ?? e.message); }
  if (!ws) await sleep(200);
}
if (!ws) { console.log("no chromium"); await done(2); }
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map(); const handlers = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) for (const h of handlers) h(m);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description ?? r.result?.exceptionDetails?.text; };

const BRIDGE = `(() => {
  const waiting = new Map(); let next = 1;
  globalThis.__natReply = (id, ok, value) => { const w = waiting.get(id); if (!w) return; waiting.delete(id); if (ok) w.res(value); else w.rej(new Error(value)); };
  const call = (method, params) => new Promise((res, rej) => { const id = next++; waiting.set(id, { res, rej }); globalThis.__nat(JSON.stringify({ id, method, params: params || {} })); });
  globalThis.ifizboxApp = true;
  globalThis.ifizboxNative = { call, jailbreak: null, mode: "sideload", emit() {}, helper: () => Promise.reject(new Error("no helper")), dpkgStatus: () => call("apt.dpkgStatus") };
})();`;
handlers.push(async (m) => {
  if (m.method !== "Runtime.bindingCalled" || m.params.name !== "__nat") return;
  const { id: cid, method } = JSON.parse(m.params.payload);
  let ok = true, value = null;
  if (method === "app.info") value = { version: "0.9.8", build: "", ios: "18.1", jailbreak: null, mode: "sideload", machine: "iPhone17,1", markers: [] };
  else if (method.startsWith("ui.")) { ok = false; value = "unknown method " + method; } // the CSS sheet and menu
  await send("Runtime.evaluate", { expression: `__natReply(${cid}, ${ok}, ${JSON.stringify(value)})` });
});
handlers.push((m) => { if (m.method === "Runtime.exceptionThrown") console.log("page exception:", m.params.exceptionDetails?.exception?.description?.split("\n")[0]); });

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 402, height: 874, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", platform: "iPhone" });
await send("Runtime.addBinding", { name: "__nat" });
await send("Page.addScriptToEvaluateOnNewDocument", { source: BRIDGE });
await send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("ifizbox.style", "ios26"); localStorage.setItem("ifizbox.firstVisit", "later"); } catch {}` });
await send("Page.navigate", { url: base });
await sleep(2500);
console.log("record:", await ev(`import("./core/installed.js").then(async (m) => { const s = await m.apps();
  for (const [id, name] of [["com.example.alpha", "Alpha"], ["com.example.beta", "Beta"], ["com.example.gamma", "Gamma"]])
    await m.recordInstall(s, { id, name, version: "1.0" });
  return "ok " + document.documentElement.dataset.style; })`));
await ev(`location.hash = "#/installed"`);
await sleep(2500);
const tapAt = async (sel) => {
  const r = await ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.offsetParent !== null); if (!e) return null;
    const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()`);
  if (!r) return false;
  const [x, y] = r;
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  return [Math.round(x), Math.round(y)];
};
console.log("manage:", await tapAt(".manage-button"));
await sleep(800);
console.log("rows:", await ev(`document.querySelectorAll(".manage-row").length`));
const state = () => ev(`JSON.stringify({ button: [...document.querySelectorAll(".wish-button")].find((x) => x.offsetParent !== null)?.textContent,
  menus: [...document.querySelectorAll(".action-menu")].map((m) => [...m.querySelectorAll(".action-button")].map((b) => b.textContent).join(" | ")),
  picked: document.querySelectorAll(".manage-row.picked").length })`);
const at = await tapAt(".wish-button");
console.log("tap 1 at", at, await state());
for (let i = 2; i <= taps; i++) {
  await sleep(gap);
  // the same spot each time, as a finger tapping the button fast
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: at[0], y: at[1], button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: at[0], y: at[1], button: "left", clickCount: 1 });
  console.log("tap", i, await state());
}
await sleep(1000);
console.log("end", await state());
// one deliberate tap after the pause: on the menu's first item (All Apps) when a menu is open
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: at[0], y: at[1], button: "left", clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: at[0], y: at[1], button: "left", clickCount: 1 });
await sleep(600);
console.log("after a slow tap", await state());
await done(0);
