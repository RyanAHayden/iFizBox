// F323: the app icon follows the theme (core/settings.js iconFor/iconState/iconGroups, appicon.js tellIcon).
import test from "node:test";
import assert from "node:assert/strict";
import { createSettings, iconFor, iconState, iconGroups, clearOffered, APP_ICONS, LIGHT_PALETTES, DARK_PALETTES } from "./core/settings.js";
import { iconMessage, tellIcon, resetTold, iconSrc, clearHere, readIcons, retryable, resignNeeded, setResignHandler } from "./appicon.js";

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const store = (mode = "jailbreak") => createSettings({ storage: memStorage(), mode });

test("every theme has an icon, and Clear is one more", () => {
  assert.deepEqual(APP_ICONS.map((i) => i.value), [...LIGHT_PALETTES, ...DARK_PALETTES, "clear", "glass"]);
});

test("Match Theme (the default) gives each tone its theme's icon", () => {
  const s = store();
  const get = (k) => s.get(k);
  assert.equal(s.get("iconMatch"), true);
  assert.equal(iconFor("light", get), "classic");
  assert.equal(iconFor("dark", get), "gunmetal");
  s.set("darkTheme", "nord");
  s.set("lightTheme", "sepia");
  assert.deepEqual(iconState(get, "dark"), { light: "sepia", dark: "nord", onScreen: "nord" });
  assert.deepEqual(iconState(get, "light"), { light: "sepia", dark: "nord", onScreen: "sepia" });
  s.set("darkIcon", "clear"); // a pick does nothing while Match Theme is on
  assert.equal(iconFor("dark", get), "nord");
});

test("off, the picks start on the themes' own icons and apply to their mode only", () => {
  const s = store("sideload");
  const get = (k) => s.get(k);
  s.set("iconMatch", false);
  assert.deepEqual(iconState(get, "light"), { light: "classic", dark: "gunmetal", onScreen: "classic" });
  s.set("darkIcon", "clear");
  assert.deepEqual(iconState(get, "dark"), { light: "classic", dark: "clear", onScreen: "clear" });
  s.set("lightIcon", "oled"); // any icon in either mode
  assert.deepEqual(iconState(get, "light"), { light: "oled", dark: "clear", onScreen: "oled" });
  s.set("lightIcon", "theme");
  s.set("lightTheme", "metal");
  assert.equal(iconFor("light", get), "metal");
});

test("the website has no App Icon rows", () => {
  const s = store("site");
  assert.equal(s.isShown("iconMatch"), false);
  assert.equal(s.isShown("lightIcon"), false);
  assert.equal(store("jailbreak").isShown("darkIcon"), true);
  assert.equal(store("sideload").isShown("iconMatch"), true);
});

test("the sideload build's footers say iOS shows an alert; the jailbreak app's switch is quiet", () => {
  assert.match(store("sideload").footerOf("iconMatch"), /alert/);
  assert.match(store("sideload").footerOf("lightIcon"), /alert/);
  assert.equal(store("jailbreak").footerOf("iconMatch"), "The icon changes with your theme.");
  assert.equal(store("jailbreak").footerOf("lightIcon"), "Pick an icon for each mode.");
});

test("the grid: this mode's themes, then Clear, Glass and the other mode's", () => {
  const [themes, special] = iconGroups("dark");
  assert.equal(themes.header, "Themes");
  assert.deepEqual(themes.icons.map((i) => i.value), DARK_PALETTES);
  assert.equal(special.header, "Special");
  assert.deepEqual(special.icons.map((i) => i.value), ["clear", "glass", ...LIGHT_PALETTES]);
  assert.deepEqual(iconGroups("light")[1].icons.map((i) => i.value), ["clear", "glass", ...DARK_PALETTES]);
  // every icon is in one of each mode's groups exactly once
  for (const tone of ["light", "dark"]) {
    assert.deepEqual(iconGroups(tone).flatMap((g) => g.icons.map((i) => i.value)).sort(), APP_ICONS.map((i) => i.value).sort());
  }
});

test("Clear is offered from iOS 18 on only (user 2026-11-20: not on the iPhone 7's iOS 15)", () => {
  assert.equal(clearOffered("15.8.8"), false);
  assert.equal(clearOffered("17.6"), false);
  assert.equal(clearOffered("18.0"), true);
  assert.equal(clearOffered("26.1"), true);
  assert.equal(clearOffered(null), true);
  assert.ok(!iconGroups("dark", { clear: false })[1].icons.some((i) => i.value === "clear"));
  // F324: Glass stays on every iOS (older ones show actool's flat copy of it, user 2026-11-21)
  assert.deepEqual(iconGroups("light", { clear: false })[1].icons.map((i) => i.value), ["glass", ...DARK_PALETTES]);
  const ua = (v) => `Mozilla/5.0 (iPhone; CPU iPhone OS ${v} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148`;
  assert.equal(clearHere(ua("15_8_8")), false);
  assert.equal(clearHere(ua("18_1")), true);
});

test("tellIcon sends app.icon once per change, only in the apps", () => {
  const s = store();
  const calls = [];
  const native = { call: (m, p) => { calls.push([m, p]); return Promise.resolve({}); } };
  globalThis.ifizboxNative = native;
  try {
    resetTold();
    assert.equal(tellIcon("light", s, native), true);
    assert.equal(tellIcon("light", s, native), false); // nothing changed
    s.set("darkTheme", "oled");
    assert.equal(tellIcon("light", s, native), true);
    assert.deepEqual(calls, [["app.icon", { light: "classic", dark: "gunmetal", onScreen: "classic" }],
      ["app.icon", { light: "classic", dark: "oled", onScreen: "classic" }]]);
    resetTold();
    assert.equal(tellIcon("dark", store("site"), native), false);
  } finally {
    delete globalThis.ifizboxNative;
  }
  assert.deepEqual(iconMessage((k) => s.get(k), "dark").params.onScreen, "oled");
  assert.equal(iconSrc("clear"), "appicon/clear.png");
  assert.equal(iconSrc("glass"), "appicon/glass.png");
});

test("a Clear pick saved earlier counts as the theme's icon where Clear isn't offered", () => {
  const s = store();
  s.set("iconMatch", false);
  s.set("darkIcon", "clear");
  const raw = (k) => s.get(k);
  assert.equal(iconFor("dark", readIcons(raw, true)), "clear");
  assert.equal(iconFor("dark", readIcons(raw, false)), "gunmetal");
  assert.deepEqual(iconState(readIcons(raw, false), "dark"), { light: "classic", dark: "gunmetal", onScreen: "gunmetal" });
});

// B243: Light = Clear with Match Theme off, then Match Theme back on: the switch back to the themes' icons is sent,
// and sent again when iOS refuses it, until it goes through; a newer change or another kind of refusal stops it.
test("turning Match Theme back on after a Clear pick switches back, and a refused switch is retried", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const flush = () => new Promise((r) => setImmediate(r));
  const s = store("sideload");
  const calls = [];
  let refuse = 0;
  const native = { call: (m, p) => {
    calls.push(p);
    // as native/bridge.js's withCode hands the shell's "failed: <text>" on
    const e = Object.assign(new Error("The operation couldn’t be completed. (NSPOSIXErrorDomain error 35.)"), { code: "failed" });
    return refuse-- > 0 ? Promise.reject(e) : Promise.resolve({});
  } };
  globalThis.ifizboxNative = native;
  try {
    resetTold();
    s.set("iconMatch", false);
    s.set("lightIcon", "clear");
    assert.equal(tellIcon("light", s, native, 0), true);
    await flush();
    assert.deepEqual(calls.at(-1), { light: "clear", dark: "gunmetal", onScreen: "clear" });
    s.set("iconMatch", true);
    refuse = 2;
    assert.equal(tellIcon("light", s, native), true);
    const back = { light: "classic", dark: "gunmetal", onScreen: "classic" };
    assert.deepEqual(calls.at(-1), back);
    await flush();
    t.mock.timers.tick(1000);
    await flush();
    assert.equal(calls.length, 3);
    t.mock.timers.tick(3000);
    await flush();
    assert.equal(calls.length, 4); // the third try goes through
    assert.deepEqual(calls.at(-1), back);
    t.mock.timers.tick(20000);
    await flush();
    assert.equal(calls.length, 4);
    assert.equal(tellIcon("light", s, native), false); // sent: nothing to repeat

    // A newer change while a retry waits: only the newer one goes out
    s.set("darkTheme", "oled");
    refuse = 1;
    tellIcon("light", s, native);
    await flush();
    s.set("darkTheme", "gunmetal");
    tellIcon("light", s, native);
    await flush();
    t.mock.timers.tick(20000);
    await flush();
    assert.equal(calls.length, 6);
    assert.deepEqual(calls.at(-1), back);

    // Not an iOS refusal (an older shell): no retry, but the next change sends again
    native.call = (m, p) => { calls.push(p); return Promise.reject(new Error("unknown method app.icon")); };
    assert.equal(retryable(new Error("failed: from a mock without the bridge")), true);
    s.set("darkTheme", "oled");
    tellIcon("light", s, native);
    await flush();
    t.mock.timers.tick(20000);
    await flush();
    assert.equal(calls.length, 7);
    assert.equal(tellIcon("light", s, native), true);
  } finally {
    resetTold();
    delete globalThis.ifizboxNative;
  }
});

// B240: Lite answers resign_needed for a picked own icon its bundle no longer holds (an update put the placeholders
// back): tellIcon hands it to the offer (screens/appicon.js offerResign), once per answer, and doesn't retry it.
test("a resign_needed answer for an own icon goes to the re-sign offer, not the retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const flush = () => new Promise((r) => setImmediate(r));
  const s = store("sideload");
  const calls = [], offers = [];
  const native = { call: (m, p) => {
    calls.push(p);
    return Promise.reject(Object.assign(new Error("the app puts your icon in by re-signing itself first"), { code: "resign_needed" }));
  } };
  setResignHandler((name, st) => offers.push([name, st]));
  globalThis.ifizboxNative = native;
  try {
    resetTold();
    s.set("iconMatch", false);
    s.set("lightIcon", "owna1");
    assert.equal(tellIcon("light", s, native), true);
    await flush();
    assert.deepEqual(offers, [["owna1", s]]);
    t.mock.timers.tick(20000);
    await flush();
    assert.equal(calls.length, 1, "not retried");
    assert.equal(resignNeeded(new Error("resign_needed: from a mock")), true);
    assert.equal(resignNeeded(Object.assign(new Error("x"), { code: "failed" })), false);
  } finally {
    resetTold();
    setResignHandler(() => {});
    delete globalThis.ifizboxNative;
  }
});
