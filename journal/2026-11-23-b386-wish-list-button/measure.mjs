// B386: Installed's bar as the sideload app and the site draw it, iOS 26 style, per width and Wish List count.
//   node measure.mjs <base url of web/app> <outdir> <profile dir>
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
const [base, out, prof] = process.argv.slice(2);
const port = 9900 + Math.floor(Math.random() * 400);
const chrome = spawn("chromium", ["--headless", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
process.on("exit", () => chrome.kill());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try { const p = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
  if (!ws) await sleep(200);
}
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); pend.get(m.id)?.(m); pend.delete(m.id); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => { const r = (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result; return r?.result?.value ?? r?.exceptionDetails?.exception?.description; };
await send("Page.enable");
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
await send("Emulation.setDeviceMetricsOverride", { width: 393, height: 852, deviceScaleFactor: 2, mobile: true });
await send("Page.navigate", { url: base });
await sleep(1500);
await ev(`localStorage.setItem("ifizbox.firstVisit","later");localStorage.setItem("ifizbox.style","ios26");localStorage.setItem("ifizbox.appearance","light")`);
for (const mode of ["site", "sideload", "jailbreak"]) {
  let sid;
  if (mode !== "site") sid = (await send("Page.addScriptToEvaluateOnNewDocument", { source: `globalThis.ifizboxApp=true;globalThis.ifizboxNative={call:async()=>null,jailbreak:${mode === "jailbreak" ? '"rootless"' : "null"},mode:"${mode}",emit(){},helper:async()=>null,dpkgStatus:async()=>null};` })).result.identifier;
  for (const width of [375, 393, 402]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 852, deviceScaleFactor: 2, mobile: true });
    await send("Page.navigate", { url: base + "#/installed" });
    await send("Page.reload");
    await sleep(2500);
    for (const n of [0, 1, 12]) {
      console.log(mode, width, n, await ev(`(() => {
        document.querySelectorAll(".banner").forEach((b) => b.remove());
        const b = [...document.querySelectorAll(".wish-button")].find((x) => x.getBoundingClientRect().width);
        if (!b) return "no button: " + location.hash;
        b.querySelector(".wish-count")?.remove();
        if (${n}) b.append(Object.assign(document.createElement("span"), { className: "wish-count", textContent: " (${n})" }));
        const name = b.querySelector(".wish-name"), seg = b.closest(".nav-item").querySelector(".nav-segments");
        const c = document.createElement("canvas").getContext("2d"), cs = getComputedStyle(b);
        c.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
        return JSON.stringify({ button: b.getBoundingClientRect().width, glassNeeds: c.measureText(b.textContent).width + 24, nameCut: name.scrollWidth > name.clientWidth,
          seg: seg?.getBoundingClientRect().width, segX: seg && seg.getBoundingClientRect().x + seg.getBoundingClientRect().width / 2, segs: seg && [...seg.querySelectorAll("button")].map((s) => s.textContent + (s.scrollWidth > s.clientWidth ? " CUT" : "")), right: [...b.closest(".nav-item").querySelectorAll(".nav-right .bar-button")].map((x) => x.textContent + " " + x.getBoundingClientRect().left) });
      })()`));
      if (n !== 12) await writeFile(`${out}/${mode}-${width}-${n}.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width, height: 110, scale: 1 } })).result.data, "base64"));
    }
  }
  if (sid) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: sid });
}
process.exit(0);
