// F463d: the Free Apple ID page's App IDs list, and forgetting apps deleted from the phone (screens/app-ids.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { appIdRows, appIdsSection, forgetDeletedApps, APP_IDS_FOOTER, APP_IDS_SIGNED_OUT } from "./app-ids.js";

const now = new Date("2026-11-27T12:00:00Z");

// the shell: its records, the phone's app list, and signing.forget taking a record out
function shell({ records, phone }) {
  const state = { records: records.map((bundleId) => ({ bundleId })), calls: [] };
  state.call = async (name, params) => {
    state.calls.push(name);
    if (name === "signing.installed") return { apps: [...state.records] };
    if (name === "signing.phoneApps") return { apps: phone };
    if (name === "signing.forget") {
      state.records = state.records.filter((r) => r.bundleId !== params.bundleId);
      return { apps: state.records };
    }
    throw new Error(`unexpected ${name}`);
  };
  return state;
}
const idle = () => false;
const left = (s) => s.records.map((r) => r.bundleId);

test("an app deleted from the phone is gone from the list", async () => {
  const s = shell({ records: ["com.a.T1", "com.b.T1"], phone: ["com.b.T1", "com.other"] });
  assert.deepEqual(await forgetDeletedApps({ native: s, busy: idle }), ["com.a.T1"]);
  assert.deepEqual(left(s), ["com.b.T1"]);
});

test("with the app's own busy check (no queue, no run page) it is forgotten too", async () => {
  const s = shell({ records: ["com.a.T1"], phone: ["com.b"] });
  assert.deepEqual(await forgetDeletedApps({ native: s }), ["com.a.T1"]);
});

test("nothing is forgotten while a task runs, or on an empty or unknown list", async () => {
  for (const [phone, busy] of [[["com.b"], () => true], [[], idle], [null, idle]]) {
    const s = shell({ records: ["com.a.T1"], phone });
    assert.deepEqual(await forgetDeletedApps({ native: s, busy }), []);
    assert.deepEqual(left(s), ["com.a.T1"]);
  }
});

test("a task that starts while the phone is asked keeps every app", async () => {
  const s = shell({ records: ["com.a.T1"], phone: ["com.b"] });
  const busy = () => s.calls.includes("signing.phoneApps");
  assert.deepEqual(await forgetDeletedApps({ native: s, busy }), []);
  assert.deepEqual(left(s), ["com.a.T1"]);
});

test("no records: the phone isn't asked; a shell that refuses is quiet", async () => {
  const s = shell({ records: [], phone: ["com.b"] });
  await forgetDeletedApps({ native: s, busy: idle });
  assert.deepEqual(s.calls, ["signing.installed"]);
  const refused = { call: async () => { throw new Error("jailbreak"); } };
  assert.deepEqual(await forgetDeletedApps({ native: refused, busy: idle }), []);
});

test("the rows: first to expire first, an expired one says so", () => {
  const rows = appIdRows([
    { identifier: "com.b.T1", name: "Beta", expirationDate: new Date("2026-12-03T10:00:00Z") },
    { identifier: "com.a.T1", name: "Alpha", expirationDate: "2026-11-20T10:00:00Z" },
    { identifier: "com.c.T1" },
  ], now);
  assert.deepEqual(rows, [
    { label: "Alpha", subtitle: "com.a.T1", detail: "Expired" },
    { label: "Beta", subtitle: "com.b.T1", detail: "2026-12-03" },
    { label: "com.c.T1", subtitle: "com.c.T1", detail: "?" },
  ]);
});

test("the group: signed out, loading, empty, failed and listed", () => {
  assert.equal(appIdsSection({ signedOut: true }).footer, APP_IDS_SIGNED_OUT);
  assert.equal(appIdsSection({}).rows[0].label, "Loading…");
  assert.equal(appIdsSection({ appIds: [] }).rows[0].label, "None Yet");
  assert.equal(appIdsSection({ error: "Offline" }).footer, "Offline");
  const listed = appIdsSection({ appIds: [{ identifier: "com.a.T1" }] }, now);
  assert.deepEqual([listed.header, listed.footer, listed.rows.length], ["App IDs", APP_IDS_FOOTER, 1]);
});
