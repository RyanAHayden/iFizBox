// B289: the app's own path for a Mode change: screens/settings.js init's settings.onChange runs applyTheme on
// "appearance", and applyTheme sends app.icon through the bridge. Its own file: the settings store reads the bridge
// (detectMode) when first imported, so the bridge is set before any app module loads.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("a Mode change reaches the shell through applyTheme", async () => {
  const calls = [];
  globalThis.ifizboxNative = { mode: "jailbreak", call: (m, p) => { if (m === "app.icon") calls.push(p); return Promise.resolve({}); } };
  try {
    const { applyTheme, settings } = await import("../screens/settings.js");
    const { resetTold } = await import("../appicon.js");
    resetTold();
    const doc = { documentElement: { dataset: {} }, querySelectorAll: () => [] };
    const win = { matchMedia: () => ({ matches: true }), location: { hash: "" } }; // the iPhone in Dark mode
    settings.set("appearance", "auto");
    applyTheme(doc, win);
    settings.set("appearance", "light");
    applyTheme(doc, win);
    assert.deepEqual(calls, [{ light: "classic", dark: "gunmetal", onScreen: "gunmetal" },
      { light: "classic", dark: "classic", onScreen: "classic" }]);
    resetTold();
    const src = readFileSync(new URL("../screens/settings.js", import.meta.url), "utf8");
    assert.match(src, /settings\.onChange\(\(key\) => \{\s*if \([^\n]*key === "appearance"[^\n]*\) applyTheme\(\);/);
  } finally {
    delete globalThis.ifizboxNative;
  }
});
