// usage: node ev.mjs '<js expression>'   (pymobiledevice3 webinspector cdp --port ${CDP_PORT:-9351} running)
// WebKit ignores awaitPromise: start async work that writes window.__r, then read window.__r in a second call.
const expr = process.argv[2];
const port = process.env.CDP_PORT || "9351";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((p) => p.url.startsWith("ifizbox://"));
if (!page) { console.log("no ifizbox page", JSON.stringify(list)); process.exit(3); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
const t = setTimeout(() => { console.log("timeout"); process.exit(2); }, 15000);
ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true } }));
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id === 1) { clearTimeout(t); console.log(JSON.stringify(d.result?.result?.value ?? d.result ?? d, null, 1)); ws.close(); process.exit(0); }
};
