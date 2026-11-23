// F302: which APT packages the sideload build offers as tweaks (core/tweaks.js injectableFromFields, the .deb check
// inspectTweakDeb, filter plists in every format, Works In).
import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { injectableFromFields, countInjectable, inspectTweakDeb, filterBundles, readTextPlist, readBplist, targetsApp,
  worksInText, appNameOf } from "./tweaks.js";
import { isLibraryStanza, LIBRARY_WHY } from "./tweaks.js"; // B185

const st = (o) => ({ package: "com.x.tweak", architecture: "iphoneos-arm64", section: "Tweaks", ...o });

test("fields: arm64 and arm tweaks pass; other arches, themes, apps, CLI and jailbreak tools don't", () => {
  assert.equal(injectableFromFields(st({})).ok, true);
  assert.equal(injectableFromFields(st({ architecture: "iphoneos-arm" })).ok, true);
  assert.equal(injectableFromFields(st({ architecture: "darwin-arm64" })).ok, false);
  for (const section of ["Themes", "Themes (SpringBoard)", "Applications", "Terminal_Support", "Development", "Repositories",
    "System", "Utilities", "Ringtones", "Wallpaper"]) {
    assert.equal(injectableFromFields(st({ section })).ok, false, section);
  }
  for (const section of ["Tweaks", "Tweaks (YouTube)", "Social", "Multimedia", undefined]) {
    assert.equal(injectableFromFields(st({ section })).ok, true, String(section));
  }
  assert.equal(injectableFromFields(st({ tag: "purpose::console, role::hacker" })).ok, false);
  assert.equal(injectableFromFields(st({ tag: "purpose::extension, compatible::ios" })).ok, true);
});

test("fields: Depends only on hook libraries we provide or can drop", () => {
  assert.equal(injectableFromFields(st({ depends: "mobilesubstrate, preferenceloader, firmware (>= 14.0)" })).ok, true);
  assert.equal(injectableFromFields(st({ depends: "ellekit | cydia-substrate, cy+cpu.arm64" })).ok, true);
  assert.equal(injectableFromFields(st({ "pre-depends": "cydia-substrate" })).ok, true);
  const lib = injectableFromFields(st({ depends: "mobilesubstrate, libcolorpicker" }));
  assert.equal(lib.ok, false);
  assert.match(lib.why, /libcolorpicker/);
  assert.equal(injectableFromFields(st({ depends: "com.anemonetheming.anemone" })).ok, false, "a theme");
  assert.equal(injectableFromFields(st({ depends: "winterboard | mobilesubstrate" })).ok, false, "a theme by its deps");
});

test("countInjectable counts each injectable package once across arches and versions", () => {
  const text = [
    "Package: a\nArchitecture: iphoneos-arm64\nSection: Tweaks\nVersion: 1\n",
    "Package: a\nArchitecture: iphoneos-arm64\nSection: Tweaks\nVersion: 2\n",
    "Package: a\nArchitecture: iphoneos-arm\nSection: Tweaks\nVersion: 1\n",
    "Package: b\nArchitecture: iphoneos-arm64\nSection: Themes\n",
    "Package: c\nArchitecture: iphoneos-arm64\nSection: Tweaks\nDepends: libfoo\n",
    "Package: d\nArchitecture: iphoneos-arm\nSection: Tweaks\nDepends: mobilesubstrate\n",
  ].join("\n");
  assert.equal(countInjectable(text), 2);
});

// ---- a tiny .deb maker: ar of debian-binary, control.tar.gz, data.tar.gz ----
const enc = (s) => new TextEncoder().encode(s);
function tar(files) {
  const blocks = [];
  for (const [path, data] of files) {
    const body = typeof data === "string" ? enc(data) : data;
    const h = new Uint8Array(512);
    h.set(enc(path).subarray(0, 100), 0);
    h.set(enc("0000644\0"), 100);
    h.set(enc("0000000\0"), 108);
    h.set(enc("0000000\0"), 116);
    h.set(enc(body.length.toString(8).padStart(11, "0") + "\0"), 124);
    h.set(enc("00000000000\0"), 136);
    h.set(enc("        "), 148);
    h[156] = 0x30;
    h.set(enc("ustar\x0000"), 257);
    let sum = 0;
    for (const b of h) sum += b;
    h.set(enc(sum.toString(8).padStart(6, "0") + "\0 "), 148);
    blocks.push(h, body, new Uint8Array((512 - (body.length % 512)) % 512));
  }
  blocks.push(new Uint8Array(1024));
  return Buffer.concat(blocks);
}
function ar(members) {
  const parts = [enc("!<arch>\n")];
  for (const [name, data] of members) {
    const head = `${name}/`.padEnd(16) + "0".padEnd(12) + "0".padEnd(6) + "0".padEnd(6) + "100644".padEnd(8) + String(data.length).padEnd(10) + "`\n";
    parts.push(enc(head), data, data.length % 2 ? enc("\n") : new Uint8Array(0));
  }
  return new Uint8Array(Buffer.concat(parts));
}
const deb = (files) => ar([["debian-binary", enc("2.0\n")], ["control.tar.gz", gzipSync(tar([["./control", "Package: x\n"]]))],
  ["data.tar.gz", gzipSync(tar(files))]]);
const xmlFilter = (ids) => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "x">\n`
  + `<plist version="1.0"><dict><key>Filter</key><dict><key>Bundles</key><array>${ids.map((i) => `<string>${i}</string>`).join("")}</array></dict></dict></plist>`;

test("the .deb check: a rootless tweak with its filter targets the apps it names", () => {
  const info = inspectTweakDeb(deb([["./var/jb/Library/MobileSubstrate/DynamicLibraries/YTLite.dylib", "\xcf\xfa\xed\xfe"],
    ["./var/jb/Library/MobileSubstrate/DynamicLibraries/YTLite.plist", xmlFilter(["com.google.ios.youtube"])]]));
  assert.equal(info.ok, true, info.why);
  assert.deepEqual(info.bundles, ["com.google.ios.youtube"]);
  assert.equal(targetsApp(info, "com.google.ios.youtube"), true);
  assert.equal(targetsApp(info, "com.burbn.instagram"), false);
  assert.equal(worksInText(info), "YouTube");
  assert.equal(worksInText(info, { "com.google.ios.youtube": "YouTube (mine)" }), "YouTube (mine)");
});

test("the .deb check: rootful paths and OpenStep filters; UIKit means any app", () => {
  const info = inspectTweakDeb(deb([["./Library/MobileSubstrate/DynamicLibraries/All.dylib", "x"],
    ["./Library/MobileSubstrate/DynamicLibraries/All.plist", '{ Filter = { Bundles = ( "com.apple.UIKit" ); }; }']]));
  assert.equal(info.ok, true);
  assert.equal(info.anyApp, true);
  assert.equal(targetsApp(info, "anything.at.all"), true);
  assert.equal(worksInText(info), "Any App");
});

test("the .deb check refuses SpringBoard-only tweaks, missing filters, apps, daemons and CLI tools", () => {
  const sb = inspectTweakDeb(deb([["./Library/MobileSubstrate/DynamicLibraries/SB.dylib", "x"],
    ["./Library/MobileSubstrate/DynamicLibraries/SB.plist", xmlFilter(["com.apple.springboard"])]]));
  assert.equal(sb.ok, false);
  assert.match(sb.why, /SpringBoard/);
  assert.match(inspectTweakDeb(deb([["./Library/MobileSubstrate/DynamicLibraries/N.dylib", "x"]])).why, /which apps it's for/);
  assert.equal(inspectTweakDeb(deb([["./usr/lib/libfoo.dylib", "x"]])).why, LIBRARY_WHY);
  const withApp = inspectTweakDeb(deb([["./Library/MobileSubstrate/DynamicLibraries/T.dylib", "x"],
    ["./Library/MobileSubstrate/DynamicLibraries/T.plist", xmlFilter(["com.x.app"])], ["./Applications/X.app/X", "x"],
    ["./var/jb/usr/bin/tool", "x"], ["./Library/LaunchDaemons/com.x.plist", "x"]]));
  assert.equal(withApp.ok, false);
  assert.match(withApp.why, /an app, command-line tools, a daemon|an app/);
  assert.throws(() => inspectTweakDeb(enc("not a deb")));
});

test("filter plists: XML, OpenStep text with comments, and binary", () => {
  assert.deepEqual(filterBundles(enc(xmlFilter(["a.b", "c.d"]))).bundles, ["a.b", "c.d"]);
  assert.deepEqual(readTextPlist('// c\n{ Filter = { Bundles = ( a.b, "c d" ); Executables = (X); }; /* x */ }'),
    { Filter: { Bundles: ["a.b", "c d"], Executables: ["X"] } });
  // bplist00: { Filter = { Bundles = ( "com.x" ) } }, objects: 0 dict, 1 "Filter", 2 dict, 3 "Bundles", 4 array, 5 "com.x"
  const objs = [
    [0xd1, 1, 2],            // dict(1): key ref 1, value ref 2
    [0x56, ...enc("Filter")],
    [0xd1, 3, 4],
    [0x57, ...enc("Bundles")],
    [0xa1, 5],
    [0x55, ...enc("com.x")],
  ];
  const head = [...enc("bplist00")];
  const offsets = [];
  let body = [];
  for (const o of objs) { offsets.push(head.length + body.length); body = body.concat(o); }
  const table = head.length + body.length;
  const trailer = new Uint8Array(32);
  trailer[6] = 1; trailer[7] = 1;
  trailer[15] = objs.length; trailer[23] = 0; trailer[31] = table;
  const bytes = new Uint8Array([...head, ...body, ...offsets, ...trailer]);
  assert.deepEqual(readBplist(bytes), { Filter: { Bundles: ["com.x"] } });
  assert.deepEqual(filterBundles(bytes).bundles, ["com.x"]);
  assert.deepEqual(filterBundles(enc("garbage {")).bundles, []);
});

test("appNameOf: the user's names, then known apps, then the bundle ID", () => {
  assert.equal(appNameOf("com.atebits.Tweetie2"), "X (Twitter)");
  assert.equal(appNameOf("com.atebits.tweetie2", { "com.atebits.Tweetie2": "Twitter" }), "Twitter");
  assert.equal(appNameOf("org.unknown.app"), "org.unknown.app");
});

test("catalog: a Tweak Source keeps injectable tweaks only, counts on its own page, and stays out of All Sources", async () => {
  const { createCatalog, ALL } = await import("./catalog.js");
  const c = createCatalog();
  c.setDevice({ ios: "17.0", jailbreak: "none" });
  const text = [
    "Package: com.x.yt\nName: YTLite\nArchitecture: iphoneos-arm64\nSection: Tweaks\nVersion: 1\nDepends: mobilesubstrate\n",
    "Package: com.x.theme\nArchitecture: iphoneos-arm64\nSection: Themes\nVersion: 1\n",
    "Package: com.x.old\nName: Old\nArchitecture: iphoneos-arm\nSection: Tweaks\nVersion: 1\n",
  ].join("\n");
  c.setTweakVerdicts({ "com.x.yt@1": false, "com.x.old@1": false }); // B391: checked, they work
  assert.equal(c.load("deb:https://repo.x/:./", text, "https://repo.x/", "iphoneos-arm64", { tweaks: true }), 2);
  assert.deepEqual(c.list("deb:https://repo.x/:./").map((r) => r.id).sort(), ["com.x.old", "com.x.yt"]);
  assert.equal(c.list("deb:https://repo.x/:./")[0].compat, null, "no Jailbreak only mark");
  assert.equal(c.list(ALL).length, 0, "not in All Sources");
  const p = c.package("com.x.yt", "deb:https://repo.x/:./");
  assert.equal(p.stanza.injectable, true);
  // a plain APT load (no tweaks flag) on a phone without a jailbreak still counts for nothing
  c.load("deb:https://plain/:./", text, "https://plain/", "iphoneos-arm64");
  assert.equal(c.list("deb:https://plain/:./").length, 0);
});

// ---- B185: libraries for other tweaks (Comet and the like) are never offered as something to add to an app ----
// The stanzas are Chariz's and Havoc's own (Packages, 2026-11-20); `canister` is the row Search gets from Canister for
// the same package, which has no Depends, so only Section, tags and Description can tell.
const canister = (o) => ({ package: o.package, architecture: o.architecture, section: o.section, tag: o.tag, description: o.description });
const COMET = { package: "com.ginsu.comet", architecture: "iphoneos-arm64", section: "Tweaks", depends: "dev.theos.orion14, firmware (>= 14.0)",
  description: "A SwiftUI Prefs Framework", tag: "compatible_min::ios14.0" };

test("fields: Comet and other libraries are libraries, from the Packages stanza and from Canister's row alike", () => {
  for (const s of [COMET, canister(COMET)]) {
    const r = injectableFromFields(s);
    assert.equal(r.ok, false);
    assert.equal(r.library, true);
    assert.equal(r.why, LIBRARY_WHY);
  }
  for (const [package_, section, description] of [
    ["com.muirey03.libimagepicker", "Development", "A simple library for choosing images in preference bundles."],
    ["com.foxfort.libfoxfortutils", "Development", "library for Foxfort tweaks"],
    ["ws.hbang.alderis", "Development", "Color picker support library for tweaks"],
    ["com.tapsharp.support", "Development", "Support Framework for Tapsharp Tweaks."],
    ["com.tr1fecta.magmaapi", "Tweaks", "An API for Magma (Evo) for developers"],
    ["com.squ1dd13.inky", "System", "Inky is a colour picker library that can be used to provide colour options in tweak preference bundles."],
    ["com.x.libs", "Libraries", "Shared code"],
  ]) assert.equal(isLibraryStanza({ package: package_, section, description }), true, package_);
  assert.equal(isLibraryStanza({ package: "com.x.y", section: "Tweaks", tag: "purpose::library" }), true);
});

test("fields: real tweaks that only mention a library or developers are still tweaks", () => {
  for (const [package_, description] of [
    ["com.irepo.vinculum2", "Made on stream! twitch.tv/billbuildsyt. Vinculum 2 is the great successor to Vinculum. Completely reworked from the ground up! Vinculum 2 moves the app library from the last page to under the dock for quick and easy access."],
    ["org.hahalosah.nofreeapplimit", "Removes the 3 app limit for free developer accounts"],
    ["com.lacertosusrepo.libellum", "Notes on your lockscreen and notification center..."],
    ["weeb.lillie.youtubedislikesreturn", "Bring Back Dislikes On YouTube"],
    ["com.x.photos", "Adds a photo library button to Instagram"],
  ]) {
    const s = { package: package_, architecture: "iphoneos-arm", section: "Tweaks", description };
    assert.equal(isLibraryStanza(s), false, package_);
    assert.equal(injectableFromFields(s).ok, true, package_);
  }
});

test("the .deb check: Comet's files (a framework, nothing to inject) say it's a library, in plain words", () => {
  // Comet 2.0.1 rootless: Theos FRAMEWORK_NAME = Comet, Comet_INSTALL_PATH = /Library/Frameworks
  const info = inspectTweakDeb(deb([
    ["./var/jb/Library/Frameworks/Comet.framework/Comet", "\xcf\xfa\xed\xfe"],
    ["./var/jb/Library/Frameworks/Comet.framework/Info.plist", "x"],
    ["./var/jb/Library/Frameworks/Comet.framework/Modules/Comet.swiftmodule/arm64-apple-ios.swiftmodule", "x"],
    ["./var/jb/Library/Frameworks/Comet.framework/Modules/module.modulemap", "x"],
  ]));
  assert.equal(info.ok, false);
  assert.equal(info.library, true);
  assert.equal(info.why, LIBRARY_WHY);
  assert.doesNotMatch(info.why, /\/|\.dylib|\.plist|inject/i, "no paths or jargon");
});

test("the .deb check: a Control Center module or a Settings page only gets its own plain reason", () => {
  // com.muirey03.powermodule (Havoc), its data.tar as served
  const power = inspectTweakDeb(deb([
    ["./Library/ControlCenter/Bundles/PowerModule.bundle/Info.plist", "x"],
    ["./Library/ControlCenter/Bundles/PowerModule.bundle/PowerModule", "x"],
    ["./Library/ControlCenter/Bundles/PowerModule.bundle/Power@3x.png", "x"],
    ["./Library/PreferenceBundles/PowerModulePrefs.bundle/Info.plist", "x"],
    ["./Library/PreferenceBundles/PowerModulePrefs.bundle/PowerModulePrefs", "x"],
    ["./Library/PreferenceBundles/PowerModulePrefs.bundle/Root.plist", "x"],
    ["./Library/PreferenceLoader/Preferences/PowerModulePrefs.plist", "x"],
    ["./usr/bin/mobileldrestart", "x"],
  ]));
  assert.equal(power.ok, false);
  assert.equal(power.library, false);
  assert.match(power.why, /Control Center/);
  const prefs = inspectTweakDeb(deb([["./var/jb/Library/PreferenceBundles/X.bundle/X", "x"], ["./var/jb/Library/PreferenceLoader/Preferences/X.plist", "x"]]));
  assert.match(prefs.why, /Settings/);
  for (const why of [power.why, prefs.why]) assert.doesNotMatch(why, /\/|\.dylib|\.plist|inject/i);
  assert.equal(inspectTweakDeb(deb([["./var/jb/usr/share/x/readme.txt", "x"]])).why, "There's nothing in it that can go into an app.");
});

test("the .deb check: a real app tweak beside a framework of its own still goes in", () => {
  const info = inspectTweakDeb(deb([["./var/jb/Library/MobileSubstrate/DynamicLibraries/YTLite.dylib", "\xcf\xfa\xed\xfe"],
    ["./var/jb/Library/MobileSubstrate/DynamicLibraries/YTLite.plist", xmlFilter(["com.google.ios.youtube"])],
    ["./var/jb/Library/Frameworks/Helper.framework/Helper", "x"]]));
  assert.equal(info.ok, true, info.why);
  assert.equal(info.library, false);
});
