// Evaluate one expression in iFizBox's web view on the USB iPhone, through `pymobiledevice3 webinspector cdp
// --port 9333` (docs: memory phone-webview-js-debug). WebKit ignores awaitPromise: start async work that writes
// window.__r, read it with a second call.
//   node ev.mjs '<expression>'
const list = await (await fetch("http://127.0.0.1:9333/json")).json();
const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
const done = new Promise((r) => ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id === 1) r(m); }));
ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: process.argv[2], returnByValue: true } }));
const m = await Promise.race([done, new Promise((r) => setTimeout(() => r({ timeout: true }), 15000))]);
console.log(JSON.stringify(m.result?.result?.value ?? m.result ?? m));
ws.close();
process.exit(0);
