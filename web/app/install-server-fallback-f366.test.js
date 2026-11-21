// F366: an install through This iPhone that can't reach the phone (refused, the pairing lost, Tailscale or LocalDevVPN
// down, not paired) offers Use the Signing Server besides the fix: in the single install's alert (and its log), and on
// the IPA queue run's Log and bottom. Picking it runs the same install, or the same failed rows, again through the
// default Signing Server for that install or run only; Install Apps With stays This iPhone.
import test from "node:test";
import assert from "node:assert/strict";

const store = new Map([["ifizbox.installRoute", "iphone"]]);
Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true,
  value: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } });

const { installOnDevice, openPrepared, forgetRoute, defaultServer } = await import("./signing-client.js");
const { serverFallback, storedRoute, USE_SERVER, USE_SERVER_LINE } = await import("./core/installroute.js");
const { runAppRun, phoneLanes } = await import("./screens/apprun.js");
const { createAppQueue } = await import("./core/appqueue.js");
const { progressHUD } = await import("./nav/progress.js");
const { fakeDocument } = await import("./fakes.test-helper.js");

const settle = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const refused = () => Object.assign(new Error("refused: this iPhone refused the connection"), { code: "refused" });
const PAIRED = { paired: "rp", localDevVPN: true };

test("serverFallback: only a This iPhone failure to reach the phone offers the Signing Server", () => {
  const f = serverFallback(refused(), { route: "idevice" });
  assert.ok(f, "a refusal on This iPhone offers it");
  assert.ok(f.button && f.fix, "with the fix beside it");
  assert.ok(serverFallback(Object.assign(new Error("not_paired: none"), { code: "not_paired" })));
  assert.ok(serverFallback(Object.assign(new Error("tailscale_signed_out: x"), { code: "tailscale_signed_out" })));
  assert.equal(serverFallback(refused(), {}), null, "the Signing Server route itself: nothing to fall back to");
  assert.equal(serverFallback(Object.assign(new Error("offline: no internet"), { code: "offline" })), null);
  assert.equal(serverFallback(Object.assign(new Error("developer_mode: off"), { code: "developer_mode" })), null);
  assert.equal(serverFallback(Object.assign(new Error("Cancelled"), { code: "cancelled" })), null);
});

test("installOnDevice: the failure alert offers Use the Signing Server; picking it installs through the default server", async () => {
  forgetRoute();
  const installs = [];
  const native = {
    call: async (m, p) => {
      if (m === "idevice.status") return PAIRED;
      if (m === "signing.install") {
        installs.push(p);
        if (p.route === "idevice") throw refused();
        return { bundleId: "com.example.x", version: "1.0" };
      }
      return null;
    },
  };
  const helps = [];
  const page = { line() {}, step() {}, error() {}, status() {}, progress() {}, reopen() {}, onClose() {}, finish() {},
    stoppable() {}, close() {}, help: (text, o) => helps.push({ text, ...o }) };
  const alerts = [];
  const alert = async (a) => { alerts.push(a); return { index: a.buttons.indexOf(USE_SERVER) }; };
  let after = 0;
  const ok = await installOnDevice({ url: "https://a.example/x.ipa", name: "X", after: () => { after++; } },
    { native, alert, hud: (t) => progressHUD(t, { open: () => page }), later: () => {} });
  assert.equal(alerts.length, 1);
  assert.ok(alerts[0].buttons.includes(USE_SERVER), "the alert offers the Signing Server");
  assert.ok(alerts[0].buttons.length === 3, "besides OK and the fix");
  assert.deepEqual(helps.map((h) => [h.text, h.label]), [[USE_SERVER_LINE, USE_SERVER]], "the log's line offers it too");
  assert.equal(installs.length, 2);
  assert.equal(installs[1].route, undefined, "the second try goes the Signing Server route");
  assert.equal(installs[1].manifestServer, defaultServer());
  assert.equal(ok, true);
  assert.equal(after, 1);
  assert.equal(storedRoute(), "iphone", "Install Apps With stays This iPhone");
  // the log line's button can't run it a second time
  await helps[0].action();
  assert.equal(installs.length, 2);
});

test("installOnDevice: a failure on the Signing Server route offers no fallback", async () => {
  forgetRoute();
  store.set("ifizbox.installRoute", "server");
  try {
    const native = { call: async (m) => { if (m === "signing.install") throw refused(); return null; } };
    const alerts = [];
    const page = { line() {}, step() {}, error() {}, status() {}, progress() {}, reopen() {}, onClose() {}, finish() {}, stoppable() {}, close() {}, help() {} };
    await installOnDevice({ url: "https://a.example/x.ipa", name: "X" },
      { native, alert: async (a) => { alerts.push(a); return { index: 0 }; }, hud: (t) => progressHUD(t, { open: () => page }), later: () => {} });
    assert.ok(!alerts[0].buttons.includes(USE_SERVER));
  } finally { store.set("ifizbox.installRoute", "iphone"); }
});

test("openPrepared: a This iPhone failure carries the fallback; `server` skips the route and uses the default server", async () => {
  forgetRoute();
  const opens = [];
  const native = {
    call: async (m, p) => {
      if (m === "idevice.status") return PAIRED;
      if (m === "signing.open") { opens.push(p); if (p.route === "idevice") throw refused(); return { bundleId: "a" }; }
      if (m === "signing.progress") return { installed: true };
      return null;
    },
  };
  const row = { id: "a", name: "Alpha", token: "t", bundleId: "a" };
  const err = await openPrepared(row, { tag: "a#1", native }).then(() => null, (e) => e);
  assert.ok(err?.fallback?.button, "the row's error says This iPhone couldn't be reached, with its fix");
  const r = await openPrepared(row, { tag: "a#2", native, server: true });
  assert.equal(r.installed, true);
  assert.equal(opens[1].route, undefined);
  assert.equal(opens[1].manifestServer, defaultServer());
  forgetRoute();
});

// The run page as runAppRun sees it, with page.help's lines.
function fakePage() {
  const p = {
    lines: [], helps: [], bars: [], closers: [], panes: [], finished: null, closed: false,
    line(kind, text, id) { p.lines.push({ kind, text, id }); },
    help(text, o) { p.helps.push({ text, ...o }); },
    flush() {}, out: { replaceChildren() {} }, clear() { p.lines.length = 0; p.helps.length = 0; },
    status() {}, progress() {}, pane(n) { p.panes.push(n); return n; }, view() {},
    segmented() { return { select() {} }; }, filter() {}, bar(b) { p.bars.push(b); },
    reopen() { p.finished = null; }, finish(f) { p.finished = f; },
    onClose(f) { p.closers.push(f); },
    close() { p.closed = true; for (const f of p.closers.splice(0)) f(); return Promise.resolve(); },
  };
  return p;
}

test("the queue run: a This iPhone failure offers its fix and Use the Signing Server; picking it reruns those rows via the server", async () => {
  const saved = globalThis.document;
  globalThis.document = fakeDocument();
  try {
    const opened = [];
    const fixes = [];
    const sc = {
      prepareOnDevice: async (job) => ({ token: `t-${job.id}`, bundleId: job.id }),
      openPrepared: async (r, o) => {
        opened.push({ id: r.id, server: Boolean(o.server) });
        if (!o.server) {
          const fallback = serverFallback(refused());
          throw Object.assign(new Error("refused"), { fallback });
        }
        return { installed: true };
      },
      discardPrepared() {},
      runFix: (fix) => fixes.push(fix),
    };
    const lanes = phoneLanes(sc, { native: { call: async () => null } });
    const queue = createAppQueue();
    queue.add({ id: "com.example.a", name: "A", mode: "install", url: "https://x/a.ipa", version: "1" });
    queue.add({ id: "com.example.b", name: "B", mode: "install", url: "https://x/b.ipa", version: "1" });
    const page = fakePage();
    const r = await runAppRun(queue.list(), { queue, lanes: { ...lanes, local: () => !lanes.serverRoute() }, open: () => page });
    assert.equal(r.ok, false);
    assert.equal(page.finished.also?.label, USE_SERVER, "the bottom offers it above Return");
    const labels = page.helps.map((h) => h.label);
    assert.equal(labels.filter((l) => l === "Pair Again").length, 2, "each failed app's fix");
    assert.equal(labels.at(-1), USE_SERVER, "the Log's row offers it");
    page.helps.find((h) => h.label === "Pair Again").action();
    assert.deepEqual(fixes, ["pair"]);

    page.finished.also.action();
    await settle();
    assert.deepEqual(opened.filter((o) => o.server).map((o) => o.id).sort(), ["com.example.a", "com.example.b"]);
    assert.equal(queue.size, 0, "both installed through the Signing Server and left the queue");
    assert.ok(page.lines.some((l) => l.text === "Installing A through the Signing Server"));
    assert.equal(page.finished?.also, undefined, "nothing failed: no offer again");
    assert.equal(storedRoute(), "iphone", "Install Apps With stays This iPhone");
  } finally { globalThis.document = saved; }
});
