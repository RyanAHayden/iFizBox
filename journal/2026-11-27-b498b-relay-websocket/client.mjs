// node client.mjs: 20 sockets per way of leaving, through the old pass-through and the new forwarding.
const one = (url) => new Promise((resolve) => {
  const ws = new WebSocket(url);
  let got = 0, error = false;
  const timer = setTimeout(() => { resolve(`got ${got}, still open`); ws.close(); }, 5000);
  ws.onmessage = (ev) => { got += ev.data.length === 4096 ? 1 : 0; };
  ws.onerror = () => { error = true; };
  ws.onclose = (ev) => { clearTimeout(timer); resolve(`got ${got}, close ${ev.code}${error ? ", error" : ""}`); };
});
for (const way of ["old", "apple"]) {
  for (const how of ["close", "end", "reset"]) {
    const seen = {};
    for (let i = 0; i < 20; i++) {
      const r = await one(`ws://localhost:28715/${way}/new.ani.sidestore.io/v3/provisioning_session?how=${how}`);
      seen[r] = (seen[r] ?? 0) + 1;
    }
    console.log(way === "old" ? "pass-through" : "forwarding", how, JSON.stringify(seen));
  }
}
process.exit(0);
