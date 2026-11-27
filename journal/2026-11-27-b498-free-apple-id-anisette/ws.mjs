// node ws.mjs <host> <relay|direct> <seconds>: open the provisioning socket, answer GiveIdentifier after <seconds>
// (no Apple call), and log what the socket does.
import { randomBytes } from "node:crypto";
const [host, mode, wait] = process.argv.slice(2);
const url = mode === "local" ? `ws://localhost:18498/apple/${host}/v3/provisioning_session` : mode === "relay" ?`wss://ifizbox.com/apple/${host}/v3/provisioning_session` : `wss://${host}/v3/provisioning_session`;
const t0 = Date.now();
const t = () => `${host} ${mode} ${((Date.now() - t0) / 1000).toFixed(1)}s`;
const ws = new WebSocket(url);
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  console.log(t(), m.result, m.message ?? "");
  if (m.result === "GiveIdentifier") ws.send(JSON.stringify({ identifier: randomBytes(16).toString("base64") }));
  if (m.result === "GiveStartProvisioningData") setTimeout(() => ws.send(JSON.stringify({ spim: "AAAA" })), wait * 1000);
};
ws.onerror = (e) => console.log(t(), "error", e.message ?? "");
ws.onclose = (e) => { console.log(t(), "close", e.code, e.reason); process.exit(0); };
setTimeout(() => { console.log(t(), "still open"); process.exit(0); }, 45000);
