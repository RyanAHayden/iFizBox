// F454: install counts for Popular (backend.installs.count) from the jailbreak app's apt runs: the queue run's
// queueInstall and apply, over a stand-in bridge.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createNativeBackend } from "./backend-native.js";
import { createQueue } from "./core/queue.js";
import { fakeIndexedDB } from "./fakes.test-helper.js";

// codes: the exit code of every apt run and .deb install.
function setup(code = 0) {
  const counted = [];
  const native = {
    async call(method) {
      if (method === "helper.run" || method === "share.debInstall") return { code, stdout: "", stderr: "" };
      return null;
    },
  };
  const installs = { counts: async () => ({}), count: async (id) => { counted.push(id); return true; } };
  const backend = createNativeBackend({ native, sourceOptions: { indexedDB: fakeIndexedDB(), mode: "jailbreak", queue: createQueue(), installs } });
  return { backend, counted };
}

test("apply: each installed package counted once the run succeeds, removals not", async () => {
  const { backend, counted } = setup();
  await backend.apply([{ op: "install", id: "com.a", version: "1.0" }, { op: "remove", id: "com.gone" }, { op: "install", id: "com.b", version: null }]);
  assert.deepEqual(counted, ["com.a", "com.b"]);
});

test("queueInstall: a fetched .deb and an apt download are counted, a removal not", async () => {
  const { backend, counted } = setup();
  await backend.queueInstall({ id: "com.a", op: "install", to: "1.0" }, { file: "x.deb" });
  await backend.queueInstall({ id: "com.b", op: "install", to: "2.0" });
  await backend.queueInstall({ id: "com.c", op: "remove" });
  assert.deepEqual(counted, ["com.a", "com.b"]);
});

test("a failed or cancelled run counts nothing", async () => {
  for (const code of [100, 130]) {
    const { backend, counted } = setup(code);
    await backend.apply([{ op: "install", id: "com.a", version: "1.0" }]);
    await backend.queueInstall({ id: "com.a", op: "install", to: "1.0" }, { file: "x.deb" });
    await backend.queueInstall({ id: "com.a", op: "install", to: "1.0" });
    assert.deepEqual(counted, []);
  }
});
