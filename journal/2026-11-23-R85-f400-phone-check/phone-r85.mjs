import { execFileSync as X } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const S = process.argv[2], U = "00008130-0018450C3661001C", BID = "com.ryha.ifizbox";
const R = (n) => `https://github.com/RyanAHayden/iFizBox/releases/download/${n}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ui = (...a) => X("tools/ui-15.sh", ["R85", ...a], { encoding: "utf8", timeout: 180000 });
async function ev(expression) {
  for (let i = 0; i < 20; i++) {
    try {
      const list = await (await fetch("http://127.0.0.1:9342/json")).json();
      const p = list.find((x) => x.url.startsWith("ifizbox://"));
      if (!p) { await sleep(1000); continue; }
      return await new Promise((res, rej) => {
        const ws = new WebSocket(p.webSocketDebuggerUrl);
        const t = setTimeout(() => { ws.close(); rej(new Error("timeout")); }, 8000);
        ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
        ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) { clearTimeout(t); ws.close(); res(d.result?.result?.value); } };
        ws.onerror = () => rej(new Error("ws"));
      });
    } catch (e) { await sleep(1000); }
  }
  throw new Error("no page");
}
async function call(m, p, ms = 90000, stop) {
  await ev(`window.__l=[];window.__r=null;ifizboxNative.call(${JSON.stringify(m)},${JSON.stringify(p)},(e)=>__l.push(e.log||(e.phase+" "+e.progress))).then(r=>{__r={ok:r}},e=>{__r={err:String(e&&e.message||e)}});1`);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = JSON.parse(await ev(`JSON.stringify({l:__l,r:__r})`) ?? "{}");
    if (stop && s.l?.some((x) => stop.test(x))) return { ...s, stopped: true };
    if (s.r) return s;
    await sleep(300);
  }
  return { r: "timeout" };
}
const show = (name, s) => { const l = (s.l ?? []).filter((x) => !/^(signing|downloading|reading) [01]\.?\d+$/.test(x)); console.log(`\n== ${name}\n` + l.slice(0, 14).join("\n") + "\nPHASES " + [...new Set((s.l ?? []).map((x) => x.split(" ")[0]).filter((x) => /^(downloading|reading|signing|here|installing)$/.test(x)))].join(",") + "\n-> " + JSON.stringify(s.r ?? null).slice(0, 300)); };
const afc = (...a) => { try { return X("afcclient", ["-u", U, "--container", BID, "--", ...a], { encoding: "utf8", timeout: 60000 }); } catch (e) { return "afc: " + e.message.slice(0, 200) + (e.stdout ?? ""); } };
const D = "Library/Caches/com.ryha.ifizbox/waiting";
const ls = () => console.log("waiting:", afc("ls", D).trim().split(/\s+/).join(" "));
const inst = (url, extra = {}) => call("signing.install", { url, manifestServer: "https://f400.invalid", listed: { version: "1.1.0" }, ...extra });
const A = R("test-fixtures/alpha-1.1.0.ipa"), BIG = R("v0.20.0/iFizBox.ipa");
await ev("1");
console.log("version", await ev("navigator.userAgent.slice(-60)"));
const f = afc("ls", D).split(/\s+/).find((x) => x.endsWith(".ipa"));
const b = readFileSync(`${S}/kept.ipa`); b[b.length >> 1] ^= 0xff; writeFileSync(`${S}/bad.ipa`, b);
console.log(afc("rm", `${D}/${f}`), afc("put", `${S}/bad.ipa`, `${D}/${f}`)); ls();
show("3 retry with corrupt file", await inst(A));
show("4 retry after that", await inst(A));
show("5 source lists 1.2", await inst(A, { listed: { version: "1.2.0" } }));
const s6 = await call("signing.prepare", { url: BIG, tag: "k" + Date.now() }, 120000, /^Downloaded .* in /);
show("6 killed after the download", s6);
await sleep(500);
try { console.log(X("ios", ["kill", BID, "--udid=" + U], { encoding: "utf8", cwd: process.env.HOME + "/.local/share/ifizbox-rig" })); } catch (e) { console.log("kill:", e.message); }
await sleep(1500); ls(); ui("launch"); await sleep(6000);
show("6b retry after the kill", await call("signing.prepare", { url: BIG, tag: "k" + Date.now() }, 120000)); ls();
show("7 idevice route, Alpha", await inst(A, { route: "idevice" })); ls();
