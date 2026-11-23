// B218: Install Apps With kept in the shell's Keychain (keepRoute), so a fresh container comes back on This iPhone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { keepRoute, STORAGE_KEY } from "./installroute.js";
import { createSettings } from "./settings.js";

const mem = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const shell = (kept) => {
  const calls = [];
  return {
    calls,
    kept,
    call(name, params) {
      calls.push([name, params]);
      if (name === "route.kept") return Promise.resolve(this.kept);
      if (name === "route.keep") { this.kept = params.value; return Promise.resolve(true); }
      return Promise.reject(new Error("unknown"));
    },
  };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

test("fresh container: the kept route comes back", async () => {
  const storage = mem();
  const settings = createSettings({ storage, mode: "sideload" });
  const native = shell("iphone");
  assert.equal(keepRoute({ settings, native, storage }), true);
  await tick();
  assert.equal(settings.get("installRoute"), "iphone");
  assert.equal(storage.getItem(STORAGE_KEY), "iphone");
});

test("a stored route is kept as it is, and every change after", async () => {
  const storage = mem({ [STORAGE_KEY]: "iphone" });
  const settings = createSettings({ storage, mode: "sideload" });
  const native = shell("server");
  keepRoute({ settings, native, storage });
  await tick();
  assert.equal(settings.get("installRoute"), "iphone", "what this container has wins");
  assert.equal(native.kept, "iphone");
  assert.ok(!native.calls.some(([n]) => n === "route.kept"));
  settings.set("installRoute", "server");
  await tick();
  assert.equal(native.kept, "server");
});

test("nothing kept, a shell without the call, or a pick made meanwhile: nothing changes", async () => {
  for (const native of [shell(null), { call: () => Promise.reject(new Error("unknown call")) }]) {
    const storage = mem();
    const settings = createSettings({ storage, mode: "sideload" });
    keepRoute({ settings, native, storage });
    await tick();
    assert.equal(storage.getItem(STORAGE_KEY), null);
    assert.equal(settings.get("installRoute"), "server");
  }
  const storage = mem();
  const settings = createSettings({ storage, mode: "sideload" });
  let answer;
  const native = { calls: [], call(name, p) { this.calls.push([name, p]); return name === "route.kept" ? new Promise((r) => { answer = r; }) : Promise.resolve(true); } };
  keepRoute({ settings, native, storage });
  await tick();
  settings.set("installRoute", "server");
  answer("iphone");
  await tick();
  assert.equal(settings.get("installRoute"), "server");
});

test("only the sideload app, only with a shell", () => {
  assert.equal(keepRoute({ settings: createSettings({ storage: mem(), mode: "site" }), native: shell("iphone"), storage: mem() }), false);
  assert.equal(keepRoute({ settings: createSettings({ storage: mem(), mode: "sideload" }), native: null, storage: mem() }), false);
});
