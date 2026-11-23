// F374: the native backend's Installed Apps calls: userApps() runs ifizbox-helper user-apps and parses its lines;
// decryptApp / addTweaksTo go to the shell's library.decrypt / library.addTweaks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createNativeBackend as make, longCall } from "./backend-native.js";
import { createQueue } from "./core/queue.js";
import { fakeIndexedDB } from "./fakes.test-helper.js";

// the jailbreak app's backend (its apt and helper calls), as backend-native-appversions.test.js makes it
const createNativeBackend = ({ native }) => make({ native, sourceOptions: { indexedDB: fakeIndexedDB(), mode: "jailbreak", queue: createQueue() } });

function shell(answers) {
  const calls = [];
  return { calls, native: { call: async (method, params) => {
    calls.push([method, params]);
    const a = answers[method];
    if (a instanceof Error) throw a;
    return typeof a === "function" ? a(params) : a;
  } } };
}

test("userApps: the helper's user-apps lines, parsed; a refusal is a helper error with its reason", async () => {
  const s = shell({ "helper.run": { code: 0, stdout: "com.x.tube\tTube\t2.1\t210\t/x/Tube.app\t1\t1\n", stderr: "" } });
  const b = createNativeBackend({ native: s.native });
  const apps = await b.userApps();
  assert.deepEqual(s.calls.find(([m]) => m === "helper.run")[1].words, ["user-apps"]);
  assert.equal(apps.length, 1);
  assert.equal(apps[0].encrypted, true);
  const bad = createNativeBackend({ native: shell({ "helper.run": { code: 64, stdout: "", stderr: "ifizbox-helper: unknown verb (update)\n" } }).native });
  await assert.rejects(bad.userApps(), (e) => e.code === "helper" && /unknown verb/.test(e.message));
});

test("decryptApp and addTweaksTo reach the shell, and keep the screen on", async () => {
  const s = shell({ "library.decrypt": { file: "Tube 2.1 (decrypted).ipa" }, "library.addTweaks": { file: "Tube 2.1 (tweaks).ipa" },
    "app.keepAwake": true });
  const b = createNativeBackend({ native: s.native });
  assert.equal((await b.decryptApp("com.x.tube", () => {})).file, "Tube 2.1 (decrypted).ipa");
  assert.deepEqual(s.calls.find(([m]) => m === "library.decrypt")[1], { bundleId: "com.x.tube", stream: true });
  assert.equal((await b.addTweaksTo("Tube 2.1 (decrypted).ipa", { files: [] })).file, "Tube 2.1 (tweaks).ipa");
  assert.ok(longCall("library.decrypt", {}) && longCall("library.addTweaks", {}));
});
