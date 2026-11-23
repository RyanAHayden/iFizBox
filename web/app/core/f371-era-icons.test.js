// F371: the eras' app icons. Under Theme > Style iOS 7, 13 and 26 the theme's icon ("Match Theme", or a "Theme" pick)
// is the era's, by mode; iOS 6 keeps its themes' icons. A pick of an era icon in either mode sends the era's pair
// (Icon-ios7 = ios7 + ios7dark) to the shell; a fixed Mode keeps the one icon.
import test from "node:test";
import assert from "node:assert/strict";
import { setPhoneIos, createSettings, iconFor, iconState, pairName, lightOnlyName, ERA_ICONS, APP_ICONS } from "./settings.js";
import { iconOf, iconSrc } from "../appicon.js";

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
setPhoneIos("26.0"); // C70: the iOS 26 style needs an iOS 26 phone
const store = () => createSettings({ storage: memStorage(), mode: "sideload" });

const want = { ios6: ["classic", "gunmetal"], ios7: ["ios7", "ios7dark"], ios13: ["ios13", "ios13dark"], ios26: ["glass", "glass"] };

for (const [style, [light, dark]] of Object.entries(want)) {
  test(`Match Theme under ${style}: ${light} in Light, ${dark} in Dark`, () => {
    const s = store();
    s.set("style", style);
    const get = (k) => s.get(k);
    assert.equal(iconFor("light", get), light);
    assert.equal(iconFor("dark", get), dark);
    // appicon.js's slots follow: "current" is the tone on screen's
    assert.equal(iconOf("current", get, "dark"), dark);
    assert.equal(iconOf("current", get, "light"), light);
  });

  test(`a "Theme" pick under ${style} is the era's icon too`, () => {
    const s = store();
    s.set("style", style);
    s.set("iconMatch", false);
    s.set("lightIcon", "theme");
    s.set("darkIcon", "nord"); // a real pick still wins
    const get = (k) => s.get(k);
    assert.equal(iconFor("light", get), light);
    assert.equal(iconFor("dark", get), "nord");
  });
}

test("the eras' Home Screen pair: Automatic sends the era's light name in both slots", () => {
  const s = store();
  s.set("style", "ios7");
  const get = (k) => s.get(k);
  assert.deepEqual(iconState(get, "light"), { light: "ios7", dark: "ios7", onScreen: "ios7" });
  assert.deepEqual(iconState(get, "dark"), { light: "ios7", dark: "ios7", onScreen: "ios7dark" });
  s.set("style", "ios13");
  assert.deepEqual(iconState(get, "dark"), { light: "ios13", dark: "ios13", onScreen: "ios13dark" });
  s.set("style", "ios26");
  assert.deepEqual(iconState(get, "dark"), { light: "glass", dark: "glass", onScreen: "glass" });
  s.set("style", "ios6");
  assert.deepEqual(iconState(get, "dark"), { light: "classic", dark: "gunmetal", onScreen: "gunmetal" });
});

test("a pick in either mode uses the pair", () => {
  const s = store();
  s.set("iconMatch", false);
  const get = (k) => s.get(k);
  s.set("darkIcon", "ios7dark"); // Dark only: Light, left on "Theme", takes iOS 7's light icon
  assert.equal(iconFor("light", get), "ios7");
  assert.deepEqual(iconState(get, "dark"), { light: "ios7", dark: "ios7", onScreen: "ios7dark" });
  s.set("darkIcon", "theme");
  s.set("lightIcon", "ios7"); // Light only: Dark takes iOS 7's dark icon
  assert.equal(iconFor("dark", get), "ios7dark");
  assert.deepEqual(iconState(get, "light"), { light: "ios7", dark: "ios7", onScreen: "ios7" });
  s.set("darkIcon", "nord"); // a real pick for the other mode still wins: no pair, the shell shows the one on screen
  assert.deepEqual(iconState(get, "dark"), { light: "ios7", dark: "nord", onScreen: "nord" });
  s.set("darkIcon", "theme");
  s.set("lightIcon", "glass"); // iOS 26: the Glass icon in both
  assert.equal(iconFor("dark", get), "glass");
  s.set("lightIcon", "ios13");
  s.set("darkIcon", "ios13dark");
  assert.deepEqual(iconState(get, "dark"), { light: "ios13", dark: "ios13", onScreen: "ios13dark" });
});

test("a fixed Mode keeps the one era icon (B289): Dark sends ios7dark, Light the light icon alone", () => {
  const s = store();
  s.set("style", "ios7");
  s.set("appearance", "dark");
  const get = (k) => s.get(k);
  assert.deepEqual(iconState(get, "light"), { light: "ios7dark", dark: "ios7dark", onScreen: "ios7dark" });
  s.set("appearance", "light"); // Icon-ios7light: no dark appearance, so a dark Home Screen keeps it
  assert.deepEqual(iconState(get, "dark"), { light: "ios7light", dark: "ios7light", onScreen: "ios7light" });
  s.set("style", "ios13");
  assert.deepEqual(iconState(get, "dark"), { light: "ios13light", dark: "ios13light", onScreen: "ios13light" });
  s.set("style", "ios26"); // the Glass icon has one set, Classic and Gunmetal, as before
  assert.deepEqual(iconState(get, "dark"), { light: "glass", dark: "glass", onScreen: "glass" });
  assert.equal(lightOnlyName("nord"), "nord");
  assert.equal(lightOnlyName("ios7dark"), "ios7dark");
});

test("pairName and the icon list agree", () => {
  assert.equal(pairName("ios7dark"), "ios7");
  assert.equal(pairName("ios13dark"), "ios13");
  assert.equal(pairName("ios7"), "ios7");
  assert.equal(pairName("glass"), "glass");
  assert.equal(pairName("nord"), "nord");
  for (const { light, dark } of Object.values(ERA_ICONS)) {
    assert.ok(APP_ICONS.some((i) => i.value === light), light);
    assert.ok(APP_ICONS.some((i) => i.value === dark), dark);
  }
  // the shell takes icon names of [a-z0-9] only (native/Sources/AppIcon.swift app.icon)
  for (const i of APP_ICONS) assert.match(i.value, /^[a-z0-9]{1,24}$/);
});

test("iOS 26's icon shows its dark picture in Dark", () => {
  const s = store();
  s.set("style", "ios26");
  const get = (k) => s.get(k);
  assert.equal(iconSrc(iconOf("dark", get), "dark"), "appicon/glass-dark.png");
  assert.equal(iconSrc(iconOf("light", get), "light"), "appicon/glass.png");
});
