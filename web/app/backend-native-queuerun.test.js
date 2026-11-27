// F234: the queue run's backend calls (backend-native.js queueFetch / queueInstall / markAuto) over a stand-in bridge:
// the shell downloads each package (share.debFetch with its stanza's hash, progress and a tag share.debCancel stops),
// a bad hash fails that row, other download failures hand it to apt, and each row installs on its own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createNativeBackend, queueFetch } from "./backend-native.js";
import { createQueue } from "./core/queue.js";
import { fakeIndexedDB } from "./fakes.test-helper.js";

// call(method, params, onEvent) answering from `answers` (method -> fn(params, onEvent)), recording every call.
function bridge(answers = {}) {
  const calls = [];
  const call = async (method, params = {}, onEvent) => {
    calls.push([method, params]);
    const f = answers[method];
    if (!f) return null;
    return f(params, onEvent);
  };
  return { calls, call };
}
const signal = () => {
  const s = { aborted: false, fns: [], abort() { s.aborted = true; s.fns.forEach((f) => f()); }, onabort(f) { s.fns.push(f); } };
  return s;
};
const row = { id: "com.a", debUrl: "https://r.example/debs/a.deb", sha256: "a".repeat(64), md5sum: null, size: 100 };

test("queueFetch: the stanza's link and hash to share.debFetch, its progress to the row", async () => {
  const b = bridge({ "share.debFetch": (p, on) => { on({ progress: 0.25 }); on({ progress: 1 }); return { file: "x.deb" }; } });
  const seen = [];
  assert.deepEqual(await queueFetch(b.call, row, { signal: signal(), progress: (f) => seen.push(f) }), { file: "x.deb" });
  const [, p] = b.calls[0];
  assert.equal(p.url, row.debUrl);
  assert.equal(p.sha256, row.sha256);
  assert.equal(p.stream, true);
  assert.match(p.tag, /^q/);
  assert.deepEqual(seen, [0.25, 1]);
});

test("queueFetch: a bad hash fails the row; a network failure hands it to apt (but not a full-URL Filename)", async () => {
  const bad = bridge({ "share.debFetch": () => { throw new Error("bad_hash: the download's SHA256 is 00, not the aa its source lists"); } });
  await assert.rejects(queueFetch(bad.call, row), (e) => {
    assert.equal(e.message, "the download isn't the file its source lists (its SHA256 doesn't match)");
    assert.match(e.detail, /the download's SHA256 is 00, not the aa/);
    return true;
  });
  const net = bridge({ "share.debFetch": () => { throw new Error("network: the server answered 403"); } });
  assert.deepEqual(await queueFetch(net.call, row), { viaApt: true });
  await assert.rejects(queueFetch(net.call, { ...row, linked: true }), /couldn't download it from https:\/\/r\.example/);
  assert.deepEqual(await queueFetch(net.call, { ...row, debUrl: null }), { viaApt: true });
  assert.equal(net.calls.length, 2, "no link: nothing fetched");
});

test("backend.queueFetch: the bridge's split error (code + message, as bridge.js makes it) still reads as a bad hash", async () => {
  const native = {
    async call(method) {
      if (method !== "share.debFetch") return null;
      throw Object.assign(new Error("the download's SHA256 is 11, not the 00 its source lists"), { code: "bad_hash" });
    },
  };
  const backend = createNativeBackend({ native, sourceOptions: { indexedDB: fakeIndexedDB(), mode: "jailbreak", queue: createQueue() } });
  await assert.rejects(backend.queueFetch(row, {}), (e) => /its SHA256 doesn't match/.test(e.message) && /SHA256 is 11/.test(e.detail));
});

test("queueFetch: the row's stop cancels the shell's download by its tag", async () => {
  let release;
  const b = bridge({ "share.debFetch": () => new Promise((_, reject) => { release = reject; }) });
  const s = signal();
  const p = queueFetch(b.call, row, { signal: s });
  await new Promise((r) => setImmediate(r));
  s.abort();
  const cancel = b.calls.find(([m]) => m === "share.debCancel");
  assert.equal(cancel[1].tag, b.calls[0][1].tag);
  release(new Error("cancelled: Cancelled"));
  await assert.rejects(p, /Cancelled/);
});

test("queueInstall: a fetched file through install-deb, a removal or an apt download through apply-ask; markAuto", async () => {
  const words = [];
  const asks = [];
  const native = {
    async call(method, params, onEvent) {
      if (method === "share.debInstall") { asks.push(params.ask); onEvent?.({ fd: "status", line: "pmstatus:com.a:50:Installing com.a" }); return { code: 0, stdout: "ok", stderr: "" }; }
      if (method === "helper.run") { words.push(params.words); return { code: 0, stdout: "", stderr: "" }; }
      return null;
    },
  };
  const installs = { count: async () => true }; // F454: no install counts sent to the real server
  const backend = createNativeBackend({ native, sourceOptions: { indexedDB: fakeIndexedDB(), mode: "jailbreak", queue: createQueue(), installs } });
  const lines = [];
  assert.equal((await backend.queueInstall({ id: "com.a", op: "install", to: "1.0" }, { file: "x.deb", onEvent: (e) => lines.push(e.line) })).code, 0);
  assert.deepEqual(lines, ["pmstatus:com.a:50:Installing com.a"]);
  await backend.queueInstall({ id: "com.a", op: "install", to: "1.0" }, { file: "y.deb" });
  assert.deepEqual(asks, [true, false]); // F239: install-deb-ask only when someone can answer
  await backend.queueInstall({ id: "com.b", op: "install", to: "2.0" }, { onEvent: () => {} });
  await backend.queueInstall({ id: "com.c", op: "remove" }, { onEvent: () => {} });
  assert.equal(await backend.markAuto(["com.lib"]), true);
  assert.equal(await backend.markAuto([]), false);
  assert.deepEqual(words, [["apply-ask", "com.b=2.0"], ["apply-ask", "-com.c"], ["auto", "com.lib"]]);
});
