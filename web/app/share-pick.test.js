// B334: an .ipa iOS opened from Files without giving iFizBox access (native/Sources/OpenRescue.swift hands the page
// ifizbox://shared?route=pick-ipa&name=…&dir=…): "Choose the IPA", the Files picker in that folder (library.pick),
// then the picked file's page in My IPAs. Cancel and an empty pick change nothing.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { parseShared } from "./core/share.js";
import { handleShared, PICK_TITLE } from "./share.js";
import { handleIncoming } from "./incoming.js";
import { format } from "./router.js";
import { NAME } from "./brand.js";

const LINK = "ifizbox://shared?route=pick-ipa&name=My%20App.ipa&dir=%2Fprivate%2Fvar%2Fmobile%2FDownloads";
const fake = (answers = {}) => {
  const calls = [];
  return { calls, call: async (method, params) => { calls.push([method, params]); const a = answers[method]; if (a instanceof Error) throw a; return a ?? null; } };
};
const alerts = (index) => { const seen = []; return { seen, alert: async (o) => { seen.push(o); return { index: typeof index === "function" ? index(o) : index }; } }; };

let saved;
beforeEach(() => { saved = globalThis.location; globalThis.location = { hash: "#/home" }; });
afterEach(() => { if (saved === undefined) delete globalThis.location; else globalThis.location = saved; });

test("parseShared reads pick-ipa: the name and the folder, nothing else", () => {
  assert.deepEqual(parseShared(LINK), { route: "pick-ipa", file: null, url: null, name: "My App.ipa", dir: "/private/var/mobile/Downloads", title: "", message: "" });
  assert.equal(parseShared("ifizbox://shared?route=pick-ipa&name=a.ipa&dir=relative/x").dir, null, "only an absolute folder");
  assert.equal(parseShared("ifizbox://shared?route=pick-ipa").name, "the IPA");
});

test("Choose opens the picker in the file's folder, one file, and goes to its page", async () => {
  const native = fake({ "library.pick": { files: ["My App 2.ipa"], ipas: [] } });
  const a = alerts(1);
  assert.equal(await handleShared(LINK, { native, alert: a.alert }), "pick-ipa");
  assert.equal(a.seen.length, 1);
  assert.equal(a.seen[0].title, PICK_TITLE);
  assert.deepEqual(a.seen[0].buttons, ["Cancel", "Choose"]);
  assert.match(a.seen[0].message, /My App\.ipa/);
  assert.ok(a.seen[0].message.includes(NAME));
  assert.deepEqual(native.calls, [["library.pick", { dir: "/private/var/mobile/Downloads", single: true }]]);
  assert.equal(`#${globalThis.location.hash.replace(/^#/, "")}`, format({ tab: "installed", path: ["myipas", "ipa:My App 2.ipa"] }));
});

test("Cancel asks nothing of the shell; an empty pick stays where it was", async () => {
  const native = fake({ "library.pick": { files: [], ipas: [] } });
  assert.equal(await handleShared(LINK, { native, alert: alerts(0).alert }), "pick-ipa");
  assert.deepEqual(native.calls, []);
  assert.equal(await handleShared(LINK, { native, alert: alerts(1).alert }), "pick-ipa");
  assert.equal(native.calls.length, 1);
  assert.equal(globalThis.location.hash, "#/home");
});

test("a picker that fails says so", async () => {
  const native = fake({ "library.pick": Object.assign(new Error("internal: no window to show the picker in"), { code: "internal" }) });
  const a = alerts((o) => (o.title === PICK_TITLE ? 1 : 0));
  await handleShared(LINK, { native, alert: a.alert });
  assert.deepEqual(a.seen.map((o) => o.title), [PICK_TITLE, "Couldn't Open"]);
  assert.equal(globalThis.location.hash, "#/home");
});

test("the hand-off reaches it through handleIncoming", async () => {
  const native = fake({ "library.pick": { files: ["X.ipa"] } });
  assert.equal(await handleIncoming(LINK, { native, alert: alerts(1).alert, hud: () => () => {} }), "shared");
  assert.equal(`#${globalThis.location.hash.replace(/^#/, "")}`, format({ tab: "installed", path: ["myipas", "ipa:X.ipa"] }));
});
