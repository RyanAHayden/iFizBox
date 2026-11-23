// node shot.mjs <base url> <outdir> — C64: This iPhone's page (installation/iphone) in headless Chromium (402x874 @3x)
// with a fake sideload ifizboxNative whose idevice.status answers after SLOW ms and nothing cached. Shoots the first
// frame (before the answer), the page after the answer with the built-in VPN, with a profile without Network
// Extensions, and with a failed idevice.status. Prints each page's rows and whether any text names Tailscale or
// LocalDevVPN. Serve web/app first: python3 -m http.server <port> -d web/app --bind 127.0.0.1
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

// idevice.status answers after SLOW ms with what localStorage "fake.status" holds ("fail": it rejects); the other
// calls answer at once.
const BRIDGE = `(() => {
  const SLOW = ${SLOW};
  const expires = new Date(Date.now() + 289.5 * 86400000).toISOString();
  globalThis.ifizboxApp = true;
  globalThis.ifizboxNative = { mode: "sideload", call(method) {
    if (method === "idevice.status") return new Promise((res, rej) => setTimeout(() => {
      const s = localStorage.getItem("fake.status");
      if (s === "fail") rej(new Error("no answer")); else res(JSON.parse(s || "{}"));
    }, SLOW));
    if (method === "signing.status") return Promise.resolve({ identity: { name: "Apple Distribution: Example", team: "ABCDE12345", expires, profile: { name: "Example", expires, devices: 3, appId: "*" } } });
    if (method === "signing.installed") return Promise.resolve({ apps: [] });
    if (method === "idevice.pairState") return Promise.resolve({ active: false });
    if (method === "route.kept") return Promise.resolve(null);
    return Promise.resolve(null);
  } };
})();`;
await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: 874, deviceScaleFactor: 3, mobile: true });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148" });
await send("Page.addScriptToEvaluateOnNewDocument", { source: BRIDGE });

const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: W, height: 874, scale: 1 } });
  await writeFile(join(outdir, `${name}.png`), Buffer.from(r.result.data, "base64"));
};
const page = () => ev(`(document.querySelector(".nav-item.is-top .nav-title")?.textContent || "?") + " :: " + [...document.querySelectorAll(".page.is-top .group-header, .page.is-top .cell-inner, .page.is-top .group-footer")].map((n) => n.classList.contains("group-header") ? "[" + n.textContent + "]" : n.classList.contains("group-footer") ? "{" + n.textContent + "}" : (n.querySelector(".cell-label")?.textContent || "") + (n.querySelector(".cell-detail")?.textContent ? "=" + n.querySelector(".cell-detail").textContent : "") + (n.querySelector(".loading-spinner") ? "(spin)" : "")).join(" / ")`);
const names = () => ev(`/tailscale|localdevvpn/i.test(document.body.innerText)`);
const open = async (status) => {
  await ev(`localStorage.setItem("fake.status", ${JSON.stringify(status)}); localStorage.setItem("ifizbox.installRoute", "iphone")`);
  await send("Page.navigate", { url: "about:blank" });
  await sleep(300);
  await send("Page.navigate", { url: `${base}#/home/settings/installation/iphone` });
};

await send("Page.navigate", { url: base });
await sleep(3000);
const BUILTIN = JSON.stringify({ paired: "rp", ios: "27.0", pairOnPhone: true, otherVPN: false, tunnels: [], vpn: { available: true, tested: true, cellular: false, wifi: true, shortcuts: {} } });
const NONE = JSON.stringify({ paired: "rp", ios: "27.0", pairOnPhone: true, otherVPN: false, tunnels: [] });
for (const [label, status] of [["built-in VPN", BUILTIN], ["no Network Extensions", NONE], ["failed status", "fail"]]) {
  await open(status);
  await sleep(700);
  const slug = label.replace(/\W+/g, "-");
  await shot(`${slug}-1-first-frame`);
  console.log(`${label}, first frame:`, await page(), "| names Tailscale/LocalDevVPN:", await names());
  await sleep(SLOW + 1200);
  await shot(`${slug}-2-answered`);
  console.log(`${label}, answered:   `, await page(), "| names Tailscale/LocalDevVPN:", await names());
}
done(0);
