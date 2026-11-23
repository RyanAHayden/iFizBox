// One launch refresh per open (websign-gate.js launchRefresh): the website runs F250's refreshOnLaunch only, never
// also Settings > Refresh Sources on Launch; the app and native shells run only the setting's background refresh.
import { test } from "node:test";
import assert from "node:assert/strict";
import { memStorage as memory } from "./fakes.test-helper.js";
import { readFileSync } from "node:fs";
import { launchRefresh, FIRST_KEY } from "./websign-gate.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
const counter = () => { const f = () => { f.n++; }; f.n = 0; return f; };

test("website, unlocked, setting on: one refresh (F250's), not the setting's too", async () => {
  const refresh = counter(), background = counter();
  const r = launchRefresh({ mode: "site", win: {}, storage: memory({ [FIRST_KEY]: "later" }),
    settingOn: () => true, background, refresh });
  await tick();
  assert.equal(r, "site");
  assert.equal(refresh.n, 1);
  assert.equal(background.n, 0);
});

test("website, unlocked, setting off: F250 still refreshes", async () => {
  const refresh = counter(), background = counter();
  const r = launchRefresh({ mode: "site", win: {}, storage: memory({ [FIRST_KEY]: "later" }),
    settingOn: () => false, background, refresh });
  await tick();
  assert.equal(r, "site");
  assert.equal(refresh.n, 1);
  assert.equal(background.n, 0);
});

test("website, Home locked: no refresh at all, even with the setting on", async () => {
  const refresh = counter(), background = counter();
  const r = launchRefresh({ mode: "site", win: {}, storage: memory(), settingOn: () => true, background, refresh });
  await tick();
  assert.equal(r, null);
  assert.equal(refresh.n + background.n, 0);
});

test("app and native shells: only the setting's background refresh", async () => {
  const cases = [
    { mode: "jailbreak", win: {} },
    { mode: "sideload", win: {} },
    { mode: "site", win: { ifizboxNative: {} } },
    { mode: "site", win: { ifizboxApp: {} } },
  ];
  for (const c of cases) {
    for (const on of [true, false]) {
      const refresh = counter(), background = counter();
      const r = launchRefresh({ ...c, storage: memory({ [FIRST_KEY]: "later" }), settingOn: () => on, background, refresh });
      await tick();
      assert.equal(r, on ? "setting" : null, JSON.stringify({ ...c, on }));
      assert.equal(background.n, on ? 1 : 0);
      assert.equal(refresh.n, 0);
    }
  }
});

test("app.js starts launch refreshes only through launchRefresh", () => {
  const src = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.ok(!/refreshOnLaunch\(/.test(src), "app.js calls refreshOnLaunch directly");
  // B399: a tapped update alert is no launch refresh; its one listener may refresh
  const direct = src.split("\n").filter((l) => l.includes("refreshInBackground") && !l.includes("background: ()") &&
    !l.startsWith('addEventListener("ifizbox:update-alert"'));
  assert.deepEqual(direct, [], "app.js calls refreshInBackground outside launchRefresh");
  assert.equal(src.match(/refreshAtOpen\(\)/g)?.length, 2, "launch and back-from-background");
});
