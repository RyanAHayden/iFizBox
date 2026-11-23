// Evaluate one expression in the app's web view on the USB iPhone (pymobiledevice3 webinspector cdp on PORT).
//   node phone-eval.mjs <port> '<js>'
// WebKit ignores awaitPromise: start async work that writes window.__r, read it with a second call.
const [port, expr] = process.argv.slice(2);
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id === 1) { console.log(JSON.stringify(m.result?.result?.value ?? m.result ?? m.error)); ws.close(); process.exit(0); }
});
ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true } }));
setTimeout(() => { console.log("timeout"); process.exit(1); }, 20000);
