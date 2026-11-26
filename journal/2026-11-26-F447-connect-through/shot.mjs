// node shot.mjs <base url> <outdir> <profile>: F447: This iPhone's Connect Through in Chromium with a fake bridge.
//   profile "paid": Network Extensions, not paired: the built-in VPN checked, then a tap on LocalDevVPN
//   profile "free": a free Apple ID (no Network Extensions), paired, not tested: LocalDevVPN only
// Serve web/app first (python3 -m http.server).
import { spawn } from "node:child_process";
import { writeFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";

const [base, outdir, profile = "paid"] = process.argv.slice(2);
const W = 402, H = 874;
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
  const free = ${JSON.stringify(profile === "free")};
  let via = free ? "app" : "builtin";
  const vpn = () => ({ available: !free, tested: false, on: false, cellular: false, wifi: true, otherVPN: false, restore: false, remembered: false, restoreNever: false, via });
  const st = () => ({ paired: free ? "rp" : null, ios: "27.0", pairOnPhone: true, otherVPN: false, tunnels: [], vpn: vpn() });
  globalThis.ifizboxApp = true;
  globalThis.ifizboxNative = { mode: "sideload", call(method, params) {
    if (method === "idevice.status") return new Promise((r) => setTimeout(() => r(st()), 300));
    if (method === "vpn.setVia") { via = params.via; return new Promise((r) => setTimeout(() => r(vpn()), 600)); }
    return Promise.resolve(null);
  } };
})();`;
await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: true });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148" });
await send("Page.addScriptToEvaluateOnNewDocument", { source: BRIDGE });

const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
  await writeFile(join(outdir, `${name}.png`), Buffer.from(r.result.data, "base64"));
};
const page = () => ev(`(document.querySelector(".nav-item.is-top .nav-title")?.textContent || "?") + " :: " + [...document.querySelectorAll(".page.is-top .group-header, .page.is-top .cell-inner, .page.is-top .group-footer")].map((n) => n.classList.contains("group-header") ? "[" + n.textContent + "]" : n.classList.contains("group-footer") ? "{" + n.textContent + "}" : (n.querySelector(".cell-label")?.textContent || "") + (n.querySelector(".cell-detail")?.textContent ? "=" + n.querySelector(".cell-detail").textContent : "") + (n.querySelector(".loading-spinner") ? "(spin)" : "") + (n.closest(".is-checked, .checked") || n.querySelector(".checkmark, .cell-check") ? "(✓)" : "")).join(" / ")`);
await send("Page.navigate", { url: base });
await sleep(3000);
await ev(`localStorage.setItem("ifizbox.installRoute", "iphone"); localStorage.setItem("ifizbox.firstVisit", "later")`);
await send("Page.navigate", { url: "about:blank" });
await sleep(300);
await send("Page.navigate", { url: `${base}#/home/settings/installation/iphone` });
await sleep(3500);
await ev(`document.querySelector(".banner")?.remove()`);
await shot(`${profile}-1`); console.log(await page());
if (profile === "paid") {
  // a CDP mouse tap on the LocalDevVPN row (the page's taps are pointer events)
  const at = await ev(`(() => { const c = [...document.querySelectorAll(".page.is-top .cell-inner")].find((n) => n.querySelector(".cell-label")?.textContent === "LocalDevVPN"); const r = c.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: at[0], y: at[1], button: "left", clickCount: 1 });
  await sleep(200);
  await shot(`${profile}-2-tapped`); console.log("tapped:", await page());
  await sleep(1500);
  await shot(`${profile}-3-after`); console.log("after:", await page());
}
done(0);
