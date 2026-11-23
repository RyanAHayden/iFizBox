import { test } from "node:test";
import assert from "node:assert/strict";
import { memStorage } from "../fakes.test-helper.js";
import { createSettings, detectMode, themeFor, SETTINGS, FEATURES, bridgeArch, DAEMON_KEYS, DAEMON_LISTS, RETIRED,
  RETIRED_DAEMON_KEYS, dropRetired, PAGES, SECTIONS } from "./settings.js";
import { autoMarkShown } from "./automark.js";
import { DEFAULT_ARCH } from "./apt.js";

const everything = new Set(SETTINGS.map((d) => d.feature));
const keysOf = (s) => s.visible().map((d) => d.key);

test("defaults with nothing stored", () => {
  const s = createSettings({ storage: memStorage(), mode: "site" });
  assert.equal(s.get("appearance"), "auto"); // F320: Automatic unless chosen, so it follows the iPhone
  assert.equal(s.get("lightTheme"), "classic");
  assert.equal(s.get("darkTheme"), "gunmetal"); // F320: Gunmetal, not OLED Black
  assert.equal(s.get("arch"), DEFAULT_ARCH);
  assert.equal(s.get("device"), "none");
  assert.equal(s.get("worksOnMyPhone"), true);
  assert.equal(s.get("compatMarks"), true);
  assert.equal(s.get("iosVersion"), "auto");
  assert.equal(s.get("upgradeNotifications"), true);
  assert.equal(s.get("autoInstall"), "off");
  assert.equal(s.get("autoInstallIdle"), true);
  assert.equal(s.get("respring"), "notify");
  assert.equal(s.get("keepVersions"), 1);
  assert.equal(s.get("resignReminder"), 2);
  assert.deepEqual(s.holds.list(), []);
});

// F128: the settings audit. What's left, and the ones that went (docs/settings.md).
test("F128: exactly these settings remain, and the retired ones are gone", () => {
  assert.deepEqual(SETTINGS.map((d) => d.key), ["style", "appearance", "lightTheme", "darkTheme", "iconMatch", "lightIcon", "darkIcon", "device", "arch", "worksOnMyPhone", "compatMarks",
    "iosVersion", "refreshOnLaunch", "returnHome", "holds", "selfUpdateAlerts", "upgradeNotifications", "autoInstall", "autoInstallIdle", "respring",
    "keepVersions", "showExpiry", "resignReminder", "keepBundleId", "showExpiryWarning", "expiryWarning", "installRoute"]);
  assert.deepEqual(RETIRED, ["sideloader", "checkUpdates", "cellular", "notifications", "badge", "allowZoom"]);
  const s = createSettings({ storage: memStorage(), mode: "jailbreak" });
  for (const k of RETIRED) {
    assert.throws(() => s.get(k), new RegExp(k));
    assert.equal(s.isShown(k), false);
  }
  for (const k of RETIRED_DAEMON_KEYS) assert.ok(RETIRED.includes(k) && !DAEMON_KEYS.includes(k), k);
  // every section is on a page, every setting in a section
  for (const sec of SECTIONS) assert.ok(PAGES.some((p) => p.id === sec.page), sec.id);
  // (F285: "alerts", selfUpdateAlerts, is drawn by screens/settings.js notifySection among iOS's rows, not as a section)
  // (F323: "appicon", Theme > App Icon, is drawn by screens/settings.js appIconGroups, not as a section)
  for (const d of SETTINGS) if (d.modes.length && d.section !== "alerts" && d.section !== "appicon") assert.ok(SECTIONS.some((x) => x.id === d.section), d.key);
});

test("F128: the migration drops the retired settings' stored values and keeps everything else", () => {
  const old = { "ifizbox.sideloader": "altstore", "ifizbox.checkUpdates": "6h", "ifizbox.cellular": "false",
    "ifizbox.notifications": "each", "ifizbox.badge": "false", "ifizbox.appearance": "dark", "ifizbox.allowZoom": "true", "ifizbox.showExpiry": "false",
    "ifizbox.holds": '["com.a"]', "ifizbox.keepVersions": "2", "other.key": "x" };
  const storage = memStorage(old);
  const s = createSettings({ storage, mode: "jailbreak" });
  for (const k of RETIRED) assert.equal(storage.map.has("ifizbox." + k), false, k);
  assert.deepEqual([...storage.map.keys()].sort(),
    ["ifizbox.appearance", "ifizbox.holds", "ifizbox.keepVersions", "ifizbox.showExpiry", "other.key"]);
  assert.equal(s.get("appearance"), "dark");
  assert.equal(s.get("showExpiry"), false);
  assert.equal(s.get("keepVersions"), 2);
  assert.deepEqual(s.holds.list(), ["com.a"]);
  // run again: nothing left to drop; storage without removeItem or that throws doesn't break it
  assert.deepEqual(dropRetired(storage), []);
  assert.deepEqual(dropRetired(memStorage({ "ifizbox.badge": "true" })), ["badge"]);
  const plain = { getItem: (k) => (k === "ifizbox.badge" ? "true" : null), setItem() {} };
  assert.doesNotThrow(() => createSettings({ storage: plain }));
  const broken = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("quota"); }, removeItem() { throw new Error("no"); } };
  assert.doesNotThrow(() => createSettings({ storage: broken }));
});

// F205: Display became Theme (Appearance only); Compatibility Marks moved to General, beside Works on My Phone.
test("F128: pages like iOS 6's Settings: General, Theme, Updates (Signing in the sideload build), by mode", () => {
  const layout = (mode) => createSettings({ storage: memStorage(), mode }).pages()
    .map((p) => [p.id, p.title, p.sections.map((x) => x.settings.map((d) => d.key))]);
  const theme = ["theme", "Theme", [["style"], ["appearance"], ["lightTheme", "darkTheme"]]]; // F201 Style, F199 Mode, then Themes
  // F315: a row with its own hint has its own group (Works on My Phone, Compatibility Marks; Refresh Sources on
  // Launch, then Return to Home After bare)
  const compat = [["worksOnMyPhone"], ["compatMarks"]];
  assert.deepEqual(layout("site"), [
    ["general", "General", [["device", "iosVersion"], ...compat, ["returnHome"]]], // C14: the site refreshes by itself
    ["theme", "Theme", theme[2].slice(1)], // C69: no Style on the website (iOS 6 only)
    ["updates", "Updates", [["holds"]]],
    ["signing", "Signing", [["keepBundleId"]]], // F237: the website signs too
  ]);
  assert.deepEqual(layout("jailbreak"), [
    ["general", "General", [...compat, ["refreshOnLaunch"], ["returnHome"]]],
    theme,
    ["updates", "Updates", [["holds"], ["upgradeNotifications"], ["autoInstall", "respring"], ["autoInstallIdle"], ["keepVersions"]]],
  ]);
  assert.deepEqual(layout("sideload"), [
    ["general", "General", [...compat, ["refreshOnLaunch"], ["returnHome"]]],
    theme,
    ["updates", "Updates", [["holds"]]],
    ["installation", "Installation", [["installRoute"]]],
    ["signing", "Signing", [["showExpiry", "resignReminder"], ["keepBundleId"], ["showExpiryWarning", "expiryWarning"]]], // F244
  ]);
  const s = createSettings({ storage: memStorage(), mode: "jailbreak" });
  assert.equal(s.pageOf("theme").title, "Theme");
  assert.equal(s.pageOf("display"), null); // the old id is the screen's alias (screens/settings.js OLD_PAGES)
  assert.equal(s.sections().find((x) => x.id === "compat").footer, "Hides packages that say they don't work on this iPhone.");
  assert.equal(s.sections().find((x) => x.id === "compatMarks").footer, "Puts a check, an X or a ? by each package.");
  assert.equal(s.pageOf("appearance"), null); // a section, not a page
  // every group's footer is one or two short sentences
  for (const mode of ["site", "jailbreak", "sideload"]) {
    for (const sec of createSettings({ storage: memStorage(), mode }).sections()) {
      if (sec.footer) assert.ok(sec.footer.length <= 120, `${mode} ${sec.id}: ${sec.footer}`);
      // F315: never two hints joined: at most two sentences, and no row's own footer glued to another's
      if (sec.footer) assert.ok((sec.footer.match(/[.!?](\s|$)/g) ?? []).length <= 2, `${mode} ${sec.id}: ${sec.footer}`);
    }
  }
  // no page key collides with a setting's key or the Settings routes (screens/settings.js draw)
  for (const p of PAGES) assert.equal(SETTINGS.some((d) => d.key === p.id && p.id !== "signing"), false, p.id);
});

test("refresh on launch: on in the apps; the site hides the toggle (it refreshes each unlocked launch itself)", () => {
  const site = createSettings({ storage: memStorage(), mode: "site" });
  assert.equal(site.isShown("refreshOnLaunch"), false);
  assert.equal(site.get("refreshOnLaunch"), false);
  assert.equal(createSettings({ storage: memStorage(), mode: "jailbreak" }).isShown("refreshOnLaunch"), true);
  assert.equal(createSettings({ storage: memStorage(), mode: "sideload" }).isShown("refreshOnLaunch"), true);
  assert.equal(createSettings({ storage: memStorage(), mode: "jailbreak" }).get("refreshOnLaunch"), true);
  assert.equal(createSettings({ storage: memStorage(), mode: "sideload" }).get("refreshOnLaunch"), true);
});

test("values persist in storage under ifizbox.<key> and a new store reads them back", () => {
  const storage = memStorage();
  const a = createSettings({ storage, mode: "jailbreak" });
  a.set("appearance", "dark");
  a.set("arch", "iphoneos-arm");
  a.set("refreshOnLaunch", false);
  a.set("keepVersions", 2);
  assert.equal(storage.map.get("ifizbox.appearance"), "dark");
  assert.equal(storage.map.get("ifizbox.arch"), "iphoneos-arm"); // where backend.js getArch() reads it
  const b = createSettings({ storage, mode: "jailbreak" });
  assert.equal(b.get("appearance"), "dark");
  assert.equal(b.get("arch"), "iphoneos-arm");
  assert.equal(b.get("refreshOnLaunch"), false);
  assert.equal(b.get("keepVersions"), 2); // a number again, not "2"
});

test("a stored value that is not an option reads as the default", () => {
  const s = createSettings({ storage: memStorage({ "ifizbox.appearance": "purple", "ifizbox.arch": "x86" }) });
  assert.equal(s.get("appearance"), "auto");
  assert.equal(s.get("arch"), DEFAULT_ARCH);
});

test("set refuses values outside the options and unknown keys", () => {
  const s = createSettings({ storage: memStorage() });
  assert.throws(() => s.set("appearance", "purple"));
  assert.throws(() => s.set("keepVersions", "2"));
  assert.throws(() => s.get("nope"));
});

test("listeners hear changes and can unsubscribe", () => {
  const s = createSettings({ storage: memStorage() });
  const heard = [];
  const off = s.onChange((k, v) => heard.push([k, v]));
  s.set("appearance", "light");
  off();
  s.set("appearance", "dark");
  assert.deepEqual(heard, [["appearance", "light"]]);
});

test("storage that throws (private mode) keeps values for the session", () => {
  const broken = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("quota"); } };
  const s = createSettings({ storage: broken });
  s.set("appearance", "dark");
  assert.equal(s.get("appearance"), "dark");
});

test("holds: per package, sorted, stored on the device", () => {
  const storage = memStorage();
  const s = createSettings({ storage, mode: "site" });
  s.holds.set("com.b", true);
  s.holds.set("com.a", true);
  s.holds.set("com.b", false);
  assert.deepEqual(s.holds.list(), ["com.a"]);
  assert.equal(s.holds.has("com.a"), true);
  assert.deepEqual(createSettings({ storage }).holds.list(), ["com.a"]);
  s.holds.replace(["z", "y", "y"]); // what apt-mark showhold reports, in jailbreak mode
  assert.deepEqual(s.holds.list(), ["y", "z"]);
  assert.deepEqual(createSettings({ storage: memStorage({ "ifizbox.holds": "{bad" }) }).holds.list(), []);
});

// A stand-in for the bridge's ifizboxNative.helper: records the words, answers like ifizbox-helper and apt-mark.
function fakeHelper({ held = [], fail = new Set() } = {}) {
  const calls = [];
  const dpkg = new Set(held);
  const helper = async (words) => {
    calls.push(words.join(" "));
    const [verb, ...pkgs] = words;
    if (fail.has(verb)) return { code: 100, stdout: "" };
    if (verb === "hold") pkgs.forEach((p) => dpkg.add(p));
    else if (verb === "unhold") pkgs.forEach((p) => dpkg.delete(p));
    else if (verb === "showhold") return { code: 0, stdout: [...dpkg].map((p) => p + "\n").join("") };
    else return { code: 64, stdout: "" };
    return { code: 0, stdout: "" };
  };
  return { helper, calls, dpkg };
}

test("holds in jailbreak mode: apt-mark hold/unhold through the helper", async () => {
  const f = fakeHelper();
  const s = createSettings({ storage: memStorage(), mode: "jailbreak", helper: f.helper });
  const pending = s.holds.set("com.b", true);
  assert.deepEqual(s.holds.list(), ["com.b"]); // the row changes at once
  assert.equal(await pending, true);
  assert.equal(await s.holds.set("com.a", true), true);
  assert.equal(await s.holds.set("com.b", false), true);
  assert.deepEqual(f.calls, ["hold com.b", "hold com.a", "unhold com.b"]);
  assert.deepEqual([...f.dpkg], ["com.a"]);
  assert.deepEqual(s.holds.list(), ["com.a"]);
});

test("holds in jailbreak mode: a refused hold puts dpkg's list back", async () => {
  const f = fakeHelper({ held: ["com.x"], fail: new Set(["hold"]) });
  const s = createSettings({ storage: memStorage(), mode: "jailbreak", helper: f.helper });
  assert.equal(await s.holds.set("com.a", true), false);
  assert.deepEqual(s.holds.list(), ["com.x"]);
  assert.deepEqual(f.calls, ["hold com.a", "showhold"]);

  const g = fakeHelper({ fail: new Set(["unhold", "showhold"]) });
  const t = createSettings({ storage: memStorage({ "ifizbox.holds": '["com.a"]' }), mode: "jailbreak", helper: g.helper });
  assert.equal(await t.holds.set("com.a", false), false);
  assert.deepEqual(t.holds.list(), ["com.a"]); // showhold failed too: the list as it was
});

test("holds.sync takes apt-mark showhold's list, and tells listeners only of a change", async () => {
  const f = fakeHelper({ held: ["z.pkg", "a.pkg"] });
  const s = createSettings({ storage: memStorage({ "ifizbox.holds": '["old.pkg"]' }), mode: "jailbreak", helper: f.helper });
  const heard = [];
  s.onChange((k, v) => heard.push([k, v]));
  assert.deepEqual(await s.holds.sync(), ["a.pkg", "z.pkg"]);
  assert.deepEqual(await s.holds.sync(), ["a.pkg", "z.pkg"]);
  assert.deepEqual(heard, [["holds", ["a.pkg", "z.pkg"]]]);
  const broken = createSettings({ storage: memStorage({ "ifizbox.holds": '["k"]' }), mode: "jailbreak",
    helper: fakeHelper({ fail: new Set(["showhold"]) }).helper });
  await assert.rejects(broken.holds.sync());
  assert.deepEqual(broken.holds.list(), ["k"]);
});

test("holds: the helper is only used in jailbreak mode", async () => {
  for (const mode of ["site", "sideload"]) {
    const f = fakeHelper({ held: ["dpkg.one"] });
    const s = createSettings({ storage: memStorage(), mode, helper: f.helper });
    assert.equal(await s.holds.set("com.a", true), true);
    assert.deepEqual(await s.holds.sync(), ["com.a"]);
    assert.deepEqual(f.calls, []);
  }
  const s = createSettings({ storage: memStorage(), mode: "jailbreak" }); // no bridge helper yet: a local list
  assert.equal(await s.holds.set("com.a", true), true);
  assert.deepEqual(await s.holds.sync(), ["com.a"]);
});

test("rows each mode shows once every feature exists", () => {
  const show = (mode) => keysOf(createSettings({ storage: memStorage(), mode, features: everything }));
  assert.deepEqual(show("site"),
    ["appearance", "lightTheme", "darkTheme", "device", "worksOnMyPhone", "compatMarks", "iosVersion", "returnHome", "holds", "keepBundleId"]);
  assert.deepEqual(show("jailbreak"),
    ["style", "appearance", "lightTheme", "darkTheme", "iconMatch", "lightIcon", "darkIcon", "worksOnMyPhone", "compatMarks", "refreshOnLaunch", "returnHome", "holds",
      "upgradeNotifications", "autoInstall", "autoInstallIdle", "respring", "keepVersions"]);
  assert.deepEqual(show("sideload"),
    ["style", "appearance", "lightTheme", "darkTheme", "iconMatch", "lightIcon", "darkIcon", "worksOnMyPhone", "compatMarks", "refreshOnLaunch", "returnHome", "holds", "selfUpdateAlerts", "showExpiry", "resignReminder", "keepBundleId",
      "showExpiryWarning", "expiryWarning", "installRoute"]);
});

test("rows wait for their feature: today Appearance, the sources settings, Works on My Phone, Ignored Upgrades and Automatic Installs", () => {
  const s = createSettings({ storage: memStorage(), mode: "jailbreak" });
  assert.deepEqual(keysOf(s), ["style", "appearance", "lightTheme", "darkTheme", "iconMatch", "lightIcon", "darkIcon", "worksOnMyPhone", "compatMarks", "refreshOnLaunch", "returnHome", "holds", "upgradeNotifications",
    "autoInstall", "autoInstallIdle", "respring", "keepVersions"]);
  assert.equal(s.isShown("autoInstall"), true);
  assert.equal(createSettings({ storage: memStorage(), mode: "jailbreak", features: new Set(["appearance"]) }).isShown("autoInstall"), false);
  assert.ok(FEATURES.has("appearance"));
  assert.deepEqual(createSettings({ storage: memStorage(), mode: "site", features: new Set(["appearance"]) })
    .sections().map((x) => x.id), ["appearance", "themes"]); // C69: no Style on the website
  assert.deepEqual(createSettings({ storage: memStorage(), mode: "sideload", features: new Set(["appearance"]) })
    .sections().map((x) => x.id), ["style", "appearance", "themes"]);
});

test("C69: the website is iOS 6: a stored era is cleared and reads as iOS 6; the apps keep it", () => {
  const st = memStorage();
  st.setItem("ifizbox.style", "ios26");
  const site = createSettings({ storage: st, mode: "site" });
  assert.equal(site.get("style"), "ios6");
  assert.equal(st.getItem("ifizbox.style"), null);
  for (const mode of ["jailbreak", "sideload"]) {
    const s2 = memStorage();
    s2.setItem("ifizbox.style", "ios13");
    assert.equal(createSettings({ storage: s2, mode }).get("style"), "ios13", mode);
  }
});

test("sections come in page order, empty ones dropped", () => {
  const s = createSettings({ storage: memStorage(), mode: "sideload", features: everything });
  // F315: a section's later groups are named by their first row; `section` keeps the section's id, only the first
  // group carries its title
  assert.deepEqual(s.sections().map((x) => x.id), ["compat", "compatMarks", "sources", "returnHome", "style", "appearance", "themes", "updates",
    "installation", "signing", "keepBundleId", "expiry"]);
  assert.deepEqual([...new Set(s.sections().map((x) => x.section))], ["compat", "sources", "style", "appearance", "themes", "updates", "installation", "signing", "expiry"]);
  assert.equal(s.sections().find((x) => x.id === "appearance").settings[0].key, "appearance");
});

test("mode-dependent footers", () => {
  const f = (mode, key) => createSettings({ storage: memStorage(), mode, features: everything }).footerOf(key);
  assert.match(f("site", "worksOnMyPhone"), /set above/);
  assert.doesNotMatch(f("jailbreak", "worksOnMyPhone"), /set above/);
  assert.match(f("jailbreak", "holds"), /dpkg/);
  assert.doesNotMatch(f("sideload", "holds"), /dpkg/);
});

test("detectMode: the bridge says, otherwise the site", () => {
  assert.equal(detectMode({}), "site");
  assert.equal(detectMode({ ifizboxNative: {} }), "jailbreak");
  assert.equal(detectMode({ ifizboxNative: { mode: "sideload" } }), "sideload");
  assert.equal(detectMode({ ifizboxNative: { mode: "jailbreak" } }), "jailbreak");
  assert.equal(detectMode({ ifizboxNative: { mode: "weird" } }), "jailbreak");
  assert.throws(() => createSettings({ mode: "weird" }));
});

test("themeFor: Automatic follows the system", () => {
  assert.equal(themeFor("auto", true), "dark");
  assert.equal(themeFor("auto", false), "light");
  assert.equal(themeFor("dark", false), "dark");
  assert.equal(themeFor("light", true), "light");
});

test("hidden sections: sorted, stored on the device, listeners told only on a change", () => {
  const storage = memStorage();
  const s = createSettings({ storage, mode: "site" });
  const heard = [];
  s.onChange((k, v) => heard.push([k, v]));
  s.hiddenSections.set("Themes", true);
  s.hiddenSections.set("Addons", true);
  s.hiddenSections.set("Themes", true); // already hidden: no news
  assert.deepEqual(s.hiddenSections.list(), ["Addons", "Themes"]);
  assert.equal(s.hiddenSections.has("Themes"), true);
  assert.deepEqual(heard, [["hiddenSections", ["Themes"]], ["hiddenSections", ["Addons", "Themes"]]]);
  assert.deepEqual(createSettings({ storage }).hiddenSections.list(), ["Addons", "Themes"]);
  s.hiddenSections.set("Themes", false);
  assert.deepEqual(s.hiddenSections.list(), ["Addons"]);
  s.hiddenSections.replace(["b", "a", "a", 3]);
  assert.deepEqual(s.hiddenSections.list(), ["a", "b"]);
  assert.deepEqual(createSettings({ storage: memStorage({ "ifizbox.hiddenSections": "{bad" }) }).hiddenSections.list(), []);
});

test("Works on My Phone (F17): on by default everywhere; the site picks an iOS version, Automatic by default", () => {
  for (const mode of ["site", "jailbreak", "sideload"]) {
    assert.equal(createSettings({ storage: memStorage(), mode }).get("worksOnMyPhone"), true);
    assert.equal(createSettings({ storage: memStorage(), mode }).get("compatMarks"), true); // F35
  }
  const site = createSettings({ storage: memStorage(), mode: "site" });
  assert.equal(site.get("iosVersion"), "auto");
  site.set("iosVersion", "16.5");
  assert.equal(site.get("iosVersion"), "16.5");
  assert.throws(() => site.set("iosVersion", "99.9"));
  assert.equal(createSettings({ storage: memStorage(), mode: "jailbreak" }).isShown("iosVersion"), false); // the bridge says
});

// ---- F37: Device type ----

test("device type defaults: Not Jailbroken on the site and in the sideload build, the bridge's in the jailbreak app", () => {
  assert.equal(createSettings({ storage: memStorage(), mode: "site" }).deviceType(), "none");
  assert.equal(createSettings({ storage: memStorage(), mode: "site" }).jailbroken(), false);
  assert.equal(createSettings({ storage: memStorage(), mode: "sideload" }).deviceType(), "none");
  assert.equal(createSettings({ storage: memStorage({ "ifizbox.device": "iphoneos-arm" }), mode: "sideload" }).deviceType(), "none");
  // jailbreak app: the detected type, never the site's choice
  const storage = memStorage({ "ifizbox.device": "none" });
  const jb = createSettings({ storage, mode: "jailbreak", native: { jailbreak: "rootful" } });
  assert.equal(jb.deviceType(), "iphoneos-arm");
  assert.equal(jb.jailbroken(), true);
  assert.equal(storage.map.get("ifizbox.arch"), "iphoneos-arm", "the detected type is where getArch() reads it");
  assert.equal(createSettings({ storage: memStorage(), mode: "jailbreak", native: { arch: "iphoneos-arm64" } }).deviceType(), "iphoneos-arm64");
  // a shell that doesn't say: the stored architecture, else rootless
  assert.equal(createSettings({ storage: memStorage(), mode: "jailbreak", native: {} }).deviceType(), DEFAULT_ARCH);
  assert.equal(createSettings({ storage: memStorage({ "ifizbox.arch": "iphoneos-arm" }), mode: "jailbreak" }).deviceType(), "iphoneos-arm");
});

test("the Device row shows on the site only; the app hides the choice", () => {
  const shown = (mode) => createSettings({ storage: memStorage(), mode }).isShown("device");
  assert.equal(shown("site"), true);
  assert.equal(shown("jailbreak"), false);
  assert.equal(shown("sideload"), false);
  assert.equal(createSettings({ storage: memStorage(), mode: "site" }).isShown("arch"), false);
  const site = createSettings({ storage: memStorage(), mode: "site" });
  assert.deepEqual(site.sections().map((x) => x.id)[0], "device"); // General's first group
  assert.deepEqual(site.sections()[0].settings.map((d) => d.key), ["device", "iosVersion"]);
  assert.deepEqual(SETTINGS.find((d) => d.key === "device").options.map((o) => o.label),
    ["Not Jailbroken", "Jailbroken (Rootless)", "Jailbroken (Rootful)", "Jailbroken (Roothide)"]);
});

test("picking a jailbroken type on the site sets the architecture too, and listeners hear both", () => {
  const storage = memStorage();
  const s = createSettings({ storage, mode: "site" });
  const heard = [];
  s.onChange((k, v) => heard.push([k, v]));
  s.set("device", "iphoneos-arm");
  assert.equal(s.deviceType(), "iphoneos-arm");
  assert.equal(storage.map.get("ifizbox.arch"), "iphoneos-arm");
  assert.deepEqual(heard, [["device", "iphoneos-arm"], ["arch", "iphoneos-arm"]]);
  heard.length = 0;
  s.set("device", "none");
  assert.equal(s.deviceType(), "none");
  assert.equal(storage.map.get("ifizbox.arch"), "iphoneos-arm", "Not Jailbroken leaves the architecture alone");
  assert.deepEqual(heard, [["device", "none"]]);
  assert.throws(() => s.set("device", "iphoneos-armv7"));
});

test("a site visitor who had picked an Architecture keeps it as their device type", () => {
  assert.equal(createSettings({ storage: memStorage({ "ifizbox.arch": "iphoneos-arm" }), mode: "site" }).deviceType(), "iphoneos-arm");
  assert.equal(createSettings({ storage: memStorage({ "ifizbox.arch": "iphoneos-arm", "ifizbox.device": "none" }), mode: "site" }).deviceType(), "none");
  assert.equal(createSettings({ storage: memStorage({ "ifizbox.arch": "x86" }), mode: "site" }).deviceType(), "none");
});

test("F38: Roothide is a device type on the site and a bridge type in the app (iphoneos-arm64e)", () => {
  const storage = memStorage();
  const s = createSettings({ storage, mode: "site" });
  s.set("device", "iphoneos-arm64e");
  assert.equal(s.deviceType(), "iphoneos-arm64e");
  assert.equal(storage.map.get("ifizbox.arch"), "iphoneos-arm64e");
  assert.equal(bridgeArch({ jailbreak: "roothide" }), "iphoneos-arm64e");
  assert.equal(bridgeArch({ jailbreak: "none" }), null);
  assert.equal(createSettings({ storage: memStorage(), mode: "jailbreak", native: { jailbreak: "roothide" } }).deviceType(), "iphoneos-arm64e");
});

test("F70: the Automatic Installs rows show in the jailbreak app only, in their own section", () => {
  const jb = createSettings({ storage: memStorage(), mode: "jailbreak" });
  const auto = jb.sections().filter((x) => x.section === "automatic");
  // F315: the two lists under the header with no hint; When Charging and Locked and Keep Previous Versions each
  // their own group and hint (a list's footer is no longer dropped when it has `hint`)
  assert.deepEqual(auto.map((g) => [g.title, g.settings.map((d) => d.key), g.footer]), [
    ["Automatic Installs", ["autoInstall", "respring"], undefined],
    [undefined, ["autoInstallIdle"], "Automatic installs wait until this iPhone is charging and locked."],
    [undefined, ["keepVersions"], "Older versions kept on this iPhone, to go back to."],
  ]);
  for (const mode of ["site", "sideload"]) {
    assert.equal(createSettings({ storage: memStorage(), mode }).sections().some((x) => x.section === "automatic"), false);
  }
});

// F315: Settings > Installation & Signing's options: Show Expiry Dates and Re-sign Reminder one group with one
// footer; Keep Bundle IDs its own (screens/settings.js keepHint gives its footer by state); Expiry Warning stays
// with its switch.
test("F315: Signing's groups, one hint each", () => {
  const groups = createSettings({ storage: memStorage(), mode: "sideload" }).sections().filter((x) => x.page === "signing");
  assert.deepEqual(groups.map((g) => [g.settings.map((d) => d.key), g.footer]), [
    [["showExpiry", "resignReminder"], "Shows how many days each signed app has left, and reminds you before it runs out."],
    [["keepBundleId"], "Apps keep their own IDs and notifications."],
    [["showExpiryWarning", "expiryWarning"], "Warns on Home before your certificate or profile expires."],
  ]);
  // the site has Keep Bundle IDs only
  assert.deepEqual(createSettings({ storage: memStorage(), mode: "site" }).sections().filter((x) => x.page === "signing")
    .map((g) => g.settings.map((d) => d.key)), [["keepBundleId"]]);
  // a list's own page footer stays its own (Re-sign Reminder's page), not the group's
  const s = createSettings({ storage: memStorage(), mode: "sideload" });
  assert.equal(s.footerOf("resignReminder"), "Reminds you before an app's signature expires.");
  assert.equal(s.footerOf("showExpiry"), "Shows how many days each signed app has left.");
});

test("F70: Update Automatically marks: sorted, unique, stored on the device, listeners told only on a change", () => {
  const storage = memStorage();
  const s = createSettings({ storage, mode: "jailbreak" });
  const heard = [];
  s.onChange((k, v) => heard.push([k, v]));
  s.autoMarked.set("b.pkg", true);
  s.autoMarked.set("a.pkg", true);
  s.autoMarked.set("a.pkg", true); // no change
  assert.deepEqual(s.autoMarked.list(), ["a.pkg", "b.pkg"]);
  assert.equal(s.autoMarked.has("b.pkg"), true);
  assert.equal(storage.map.get("ifizbox.autoMarked"), JSON.stringify(["a.pkg", "b.pkg"]));
  s.autoMarked.set("b.pkg", false);
  assert.deepEqual(heard, [["autoMarked", ["b.pkg"]], ["autoMarked", ["a.pkg", "b.pkg"]], ["autoMarked", ["a.pkg"]]]);
  storage.map.set("ifizbox.autoMarked", "not json");
  assert.deepEqual(s.autoMarked.list(), []);
});

test("F70: the mark's switch shows only for Only Packages I Mark, in the jailbreak app", () => {
  const s = createSettings({ storage: memStorage(), mode: "jailbreak" });
  assert.equal(autoMarkShown(s), false); // Off by default
  s.set("autoInstall", "marked");
  assert.equal(autoMarkShown(s), true);
  s.set("autoInstall", "all");
  assert.equal(autoMarkShown(s), false);
  const site = createSettings({ storage: memStorage({ "ifizbox.autoInstall": "marked" }), mode: "site" });
  assert.equal(autoMarkShown(site), false);
  assert.equal(autoMarkShown(null), false);
});

test("F70: daemonPrefs: the daemon's keys with their typed values, unpicked ones null, the lists as arrays", () => {
  const storage = memStorage({ "ifizbox.keepVersions": "bogus" });
  const s = createSettings({ storage, mode: "jailbreak" });
  const keys = [...DAEMON_KEYS, ...DAEMON_LISTS, ...RETIRED_DAEMON_KEYS].map((k) => "ifizbox." + k);
  const first = s.daemonPrefs();
  assert.deepEqual(Object.keys(first).sort(), keys.sort());
  // Nothing picked: null everywhere (the daemon's defaults), empty lists; the retired ones always null (F128).
  for (const k of [...DAEMON_KEYS, ...RETIRED_DAEMON_KEYS]) assert.equal(first["ifizbox." + k], null, k);
  assert.deepEqual(first["ifizbox.holds"], []);
  assert.deepEqual(first["ifizbox.autoMarked"], []);
  assert.deepEqual(first["ifizbox.ignoredVersions"], {}); // F282
  s.set("autoInstall", "marked");
  s.set("autoInstallIdle", false);
  s.set("keepVersions", 2);
  s.set("respring", "locked");
  s.autoMarked.set("com.a", true);
  s.holds.replace(["com.z", "com.h"]);
  assert.deepEqual(s.daemonPrefs(), {
    "ifizbox.autoInstall": "marked", "ifizbox.autoInstallIdle": false,
    "ifizbox.respring": "locked", "ifizbox.keepVersions": 2, "ifizbox.holds": ["com.h", "com.z"], "ifizbox.autoMarked": ["com.a"],
    "ifizbox.ignoredVersions": {}, "ifizbox.checkUpdates": null, "ifizbox.cellular": null,
  });
  // F282: Ignore This Version travels as its { id: version } object, on its own after a change.
  s.ignoredVersions.set("com.t", "1.2");
  assert.deepEqual(s.daemonPrefs(["ignoredVersions"]), { "ifizbox.ignoredVersions": { "com.t": "1.2" } });
  assert.deepEqual(s.daemonPrefs(["keepVersions"]), { "ifizbox.keepVersions": 2 });
  assert.deepEqual(s.daemonPrefs(["holds", "appearance"]), { "ifizbox.holds": ["com.h", "com.z"] }); // not the daemon's: left out
});

// F134: Display > Zoom went (zoom stays off), and Settings > Signing has Show Expiry Dates, a switch, on by default.
test("F134: allowZoom is retired: its stored value is dropped and nothing shows or travels it", async () => {
  assert.ok(RETIRED.includes("allowZoom"));
  const storage = memStorage({ "ifizbox.allowZoom": "true", "ifizbox.appearance": "dark" });
  const s = createSettings({ storage, mode: "site" });
  assert.equal(storage.map.has("ifizbox.allowZoom"), false);
  assert.equal(storage.map.get("ifizbox.appearance"), "dark");
  assert.equal(s.isShown("allowZoom"), false);
  assert.throws(() => s.get("allowZoom"), /allowZoom/);
  const { TRAVELS } = await import("./settings.js");
  assert.equal(TRAVELS.includes("allowZoom"), false);
  assert.equal(SECTIONS.some((x) => x.id === "zoom"), false);
});

test("F134: Show Expiry Dates is a switch on Settings > Signing, on by default, in the sideload build", () => {
  const d = SETTINGS.find((x) => x.key === "showExpiry");
  assert.equal(d.kind, "toggle"); // createSwitch, never On/Off text
  assert.equal(d.label, "Show Expiry Dates");
  const s = createSettings({ storage: memStorage(), mode: "sideload" });
  assert.equal(s.get("showExpiry"), true);
  assert.deepEqual(s.sections().find((x) => x.page === "signing").settings.map((x) => x.key), ["showExpiry", "resignReminder"]);
  s.set("showExpiry", false);
  assert.equal(s.get("showExpiry"), false);
  for (const mode of ["site", "jailbreak"]) assert.equal(createSettings({ storage: memStorage(), mode }).isShown("showExpiry"), false, mode);
});

test("Return to Home After: 2 minutes unless changed, Never is 0, in every mode", () => {
  for (const mode of ["site", "jailbreak", "sideload"]) {
    const s = createSettings({ storage: memStorage(), mode });
    assert.equal(s.get("returnHome"), 2);
    s.set("returnHome", 0);
    assert.equal(s.get("returnHome"), 0);
  }
});
