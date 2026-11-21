// B289: the Home Screen icon follows Theme > Mode (core/settings.js iconState): Light or Dark gives both slots that
// tone's icon, Automatic keeps the light/dark pair; App Icon picks still win per mode.
import test from "node:test";
import assert from "node:assert/strict";
import { createSettings, iconState } from "./settings.js";
import { tellIcon, resetTold } from "../appicon.js";

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const store = () => {
  const s = createSettings({ storage: memStorage(), mode: "jailbreak" });
  s.set("lightTheme", "sepia");
  s.set("darkTheme", "nord");
  return s;
};

test("Automatic keeps the light/dark pair", () => {
  const s = store();
  const get = (k) => s.get(k);
  assert.equal(s.get("appearance"), "auto");
  assert.deepEqual(iconState(get, "dark"), { light: "sepia", dark: "nord", onScreen: "nord" });
  assert.deepEqual(iconState(get, "light"), { light: "sepia", dark: "nord", onScreen: "sepia" });
});

test("Mode Light: the Light theme's icon in both slots, even on a dark Home Screen", () => {
  const s = store();
  const get = (k) => s.get(k);
  s.set("appearance", "light");
  assert.deepEqual(iconState(get, "light"), { light: "sepia", dark: "sepia", onScreen: "sepia" });
  assert.deepEqual(iconState(get, "dark"), { light: "sepia", dark: "sepia", onScreen: "sepia" });
  s.set("iconMatch", false); // the Light pick wins, the Dark one doesn't show
  s.set("lightIcon", "clear");
  s.set("darkIcon", "oled");
  assert.deepEqual(iconState(get, "light"), { light: "clear", dark: "clear", onScreen: "clear" });
});

test("Mode Dark: the Dark theme's icon in both slots", () => {
  const s = store();
  const get = (k) => s.get(k);
  s.set("appearance", "dark");
  assert.deepEqual(iconState(get, "dark"), { light: "nord", dark: "nord", onScreen: "nord" });
  s.set("iconMatch", false);
  s.set("lightIcon", "clear");
  s.set("darkIcon", "classic"); // any icon works in either mode
  assert.deepEqual(iconState(get, "dark"), { light: "classic", dark: "classic", onScreen: "classic" });
});

test("a Mode change sends app.icon again", () => {
  const s = store();
  const calls = [];
  const native = { call: (m, p) => { calls.push(p); return Promise.resolve({}); } };
  globalThis.ifizboxNative = native;
  try {
    resetTold();
    assert.equal(tellIcon("dark", s, native), true);
    s.set("appearance", "light");
    assert.equal(tellIcon("light", s, native), true);
    s.set("appearance", "auto");
    assert.equal(tellIcon("dark", s, native), true);
    assert.deepEqual(calls, [{ light: "sepia", dark: "nord", onScreen: "nord" },
      { light: "sepia", dark: "sepia", onScreen: "sepia" }, { light: "sepia", dark: "nord", onScreen: "nord" }]);
  } finally {
    resetTold();
    delete globalThis.ifizboxNative;
  }
});
