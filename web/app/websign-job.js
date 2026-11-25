// F93: one signing job on the website, inside the Web Worker (signing-worker.js): zsign (vendor/zsign, WebAssembly)
// signs an IPA with the user's certificate, all in the worker's memory. Nothing here touches the network.
//
//   await runSignJob(createZsign, { ipa, p12, password, profile, bring, appBundleId, keepBundleId, tweaks, groupFix, refuseSha256 }, { progress })
//     -> { ipa: Uint8Array (signed), bundleId (signed as), originalId, name, version, sha256 (of the IPA as it came),
//          injected?, warnings? (B227: data iOS keeps from the app after this signature, in words),
//          signer (F342: core/websign.js webSignerStamp), expires? (F342: ISO, core/websign.js signatureEnd),
//          signLog (B327: the keychain groups and group fix config it signed with, in the app's sign log's words) }
//   Throws Error with .code: bad_ipa (not an IPA, no app inside), bad_profile, sign_failed (zsign's own reason),
//   malware (F292: the IPA's SHA-256 is in refuseSha256, core/malicious.js malwareHashes).
//
// `createZsign` is the module factory (vendor/zsign/zsign.js; a fake in the tests): it takes { print, printErr }
// and resolves a module with FS, ccall and callMain. A fresh module per job: zsign's main() keeps globals.
// bring (iFizBox's own IPA only, com.ryha.ifizbox): { identity: true } puts the .p12, password and profile inside the
// app as ifizbox-identity.plist (the app imports it on first launch, native BundledIdentity) and { transfer: link }
// writes the website's ifizbox://import link as web/transfer.link (app.js imports it once); both before zsign seals
// the bundle, as the old server signer did.
// groupFix (B211): the fix dylib's bytes (vendor/groupfix, signing-worker.js loads it); an app whose original
// signature names app groups or keychain groups gets it injected (core/groupfix.js), iFizBox's own IPA never.
// SPDX-License-Identifier: GPL-3.0-or-later
import { isZip, profileInfo, signingIds, appEntitlements, originalDataProtection, plistXml, identityPlist, zsignArgs, zsignError, appInfo,
  IFIZBOX_ID, IDENTITY_FILE, TRANSFER_FILE } from "./core/websign.js";
import { webSignerStamp, groupFixHash, signatureEnd } from "./core/websign.js"; // F342
import { injectInto } from "./core/tweaks.js";
import { entitlementsRead, groupFixPlan, withGroupFix, readConfig, GROUPFIX, groupFixLogLine, isNotificationExtension } from "./core/groupfix.js";
import { keychainLogLine } from "./core/websign.js"; // B327
import { NAME } from "./brand.js";
import { MALWARE_REFUSED } from "./core/malicious.js";
import { prepareSeal } from "./websign-seal.js"; // B434

const fail = (code, message) => Object.assign(new Error(message), { code });

// What zsign threw when main() didn't exit, in words. The browser's memory running out shows as a RangeError (an
// ArrayBuffer that couldn't grow), a WebAssembly.RuntimeError or an emscripten abort, and sometimes as a bare object
// with no message (seen on an iPhone 7, a second 100 MB IPA in one tab): all "Out of memory", never [object Object].
export function zsignCrash(e) {
  const msg = typeof e === "string" ? e : typeof e?.message === "string" ? e.message : "";
  const name = typeof e?.name === "string" ? e.name : "";
  const wasmError = typeof WebAssembly !== "undefined" && WebAssembly.RuntimeError && e instanceof WebAssembly.RuntimeError;
  if (e instanceof RangeError || name === "RangeError" || wasmError || name === "RuntimeError"
    || /abort|out of memory|memory|alloc/i.test(msg) || !msg.trim()) return "Out of memory";
  return msg.trim();
}

// rm -r inside emscripten's FS; nothing there is fine.
export function removeTree(FS, path) {
  let st;
  try { st = FS.stat(path); } catch { return; }
  if (FS.isDir(st.mode)) {
    for (const n of FS.readdir(path)) if (n !== "." && n !== "..") removeTree(FS, `${path}/${n}`);
    FS.rmdir(path);
  } else FS.unlink(path);
}

// F245: the profile into each top-level app extension, over any the IPA came with; zsign seals it.
export function profileExtensions(FS, appDir, profile) {
  for (const dir of ["PlugIns", "Extensions"]) {
    let names;
    try { names = FS.readdir(`${appDir}/${dir}`); } catch { continue; }
    for (const n of names) if (n.endsWith(".appex")) FS.writeFile(`${appDir}/${dir}/${n}/embedded.mobileprovision`, profile);
  }
}

// F292: the IPA's SHA-256 (lowercase hex) as it came, before anything changes it; null where the browser has no
// crypto.subtle (an http page), which only leaves the report and the hash check without it.
export async function ipaSha256(bytes) {
  try {
    const d = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
    return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch { return null; }
}

export async function runSignJob(createZsign, { ipa, p12, password = "", profile, bring = null, appBundleId = null, keepBundleId = true, tweaks = null, groupFix = null, refuseSha256 = [] }, { progress = () => {} } = {}) {
  const bytes = ipa instanceof Uint8Array ? ipa : new Uint8Array(ipa);
  if (!isZip(bytes)) throw fail("bad_ipa", "That file isn't an IPA (a zip archive).");
  // F292: hashed before signing; one on the known-malware list (core/malicious.js MALWARE_IPAS) goes no further
  const sha256 = await ipaSha256(bytes);
  if (sha256 && (refuseSha256 ?? []).some((h) => String(h).toLowerCase() === sha256)) throw fail("malware", MALWARE_REFUSED);
  let prof;
  try { prof = profileInfo(profile); } catch (e) { throw fail("bad_profile", e.message); }
  const log = [];
  const zs = await createZsign({ print: (s) => log.push(s), printErr: (s) => log.push(s) });
  const { FS } = zs;
  progress("Signing");
  FS.mkdir("/w");
  FS.writeFile("/w/in.ipa", bytes);
  if (zs.ccall("ifizbox_unzip", "number", ["string", "string"], ["/w/in.ipa", "/w/app"]) !== 0) {
    throw fail("bad_ipa", "That IPA couldn't be unpacked.");
  }
  FS.unlink("/w/in.ipa"); // the browser's memory is the limit: the zip goes once it's unpacked
  const readPlist = (path) => JSON.parse(zs.ccall("ifizbox_plist_json", "string", ["string"], [path]) || "null");
  prepareSeal(FS, "/w/app/Payload", { readPlist, removeTree }); // B434: before anything is looked up by name (it can rename the app's folder)
  let apps = [];
  try { apps = FS.readdir("/w/app/Payload").filter((n) => n.endsWith(".app")); } catch { /* no Payload */ }
  if (apps.length !== 1) throw fail("bad_ipa", "That file is not an IPA: it has no Payload/<App>.app.");
  const appDir = `/w/app/Payload/${apps[0]}`;
  let plist = null;
  try { plist = JSON.parse(zs.ccall("ifizbox_plist_json", "string", ["string"], [`${appDir}/Info.plist`]) || "null"); } catch { /* below */ }
  if (!plist) throw fail("bad_ipa", "That IPA's app has no readable Info.plist.");
  const info = appInfo(plist);
  // appBundleId: the app's own ID as the website knows it (iFizBox's, or the source's), over the IPA's: the early
  // install link was opened for it, and an IPA under an older ID (0.9.3's) left iOS waiting on a link
  // nothing filled, then a second prompt from Ready to Install (user 2026-11-18).
  const own = appBundleId || info.bundleId;
  // F237: Keep Bundle IDs (keepBundleId, on unless the user turned it off). F280: iFizBox's own IPA keeps its ID too:
  // APNs delivers by the Info.plist ID, so only a copy that kept it gets push notifications. One installed earlier
  // under the profile's ID stays beside it (the app says so once, core/push.js renamedUpdateNotice).
  const { bundleId, entitlementsId } = signingIds(prof.appId, own, { keep: keepBundleId !== false });
  // App extensions (F245): with the app's ID kept (Keep Bundle IDs on, and zsign changes no ID) they stay, each with
  // the app's profile inside, as the app's own signer does: zsign with one profile writes none into an extension
  // itself. With the ID changed they come out (iOS refused such an app, "its integrity could not be verified", user
  // 2026-11-18). A Watch app always comes out.
  const keepExtensions = keepBundleId !== false && bundleId === info.bundleId;
  for (const dir of keepExtensions ? ["Watch"] : ["PlugIns", "Extensions", "Watch"]) removeTree(FS, `${appDir}/${dir}`);
  if (keepExtensions) profileExtensions(FS, appDir, new Uint8Array(profile));

  FS.writeFile("/w/key.p12", new Uint8Array(p12));
  FS.writeFile("/w/app.mobileprovision", new Uint8Array(profile));
  let previous = null, signedBefore = false;
  try { const c = FS.readFile(`${appDir}/${GROUPFIX.config}`); signedBefore = true; previous = readConfig(c); } catch { /* first sign */ }
  const original = fileEntitlements(FS, `${appDir}/${plist.CFBundleExecutable || ""}`);
  const ents = appEntitlements(prof, entitlementsId, bundleId, originalDataProtection(original, prof, signedBefore)); // B413
  FS.writeFile("/w/ents.plist", plistXml(ents));
  if (bring && own === IFIZBOX_ID) {
    if (bring.identity) FS.writeFile(`${appDir}/${IDENTITY_FILE}`, identityPlist({ p12, password, profile }));
    if (typeof bring.transfer === "string" && bring.transfer.startsWith("ifizbox://import?")) {
      try { FS.mkdir(`${appDir}/web`); } catch { /* there already */ }
      FS.writeFile(`${appDir}/${TRANSFER_FILE}`, bring.transfer);
    }
  }
  // B211: the original signature's app groups and keychain groups, read before signing, decide whether the app gets
  // the group fix (core/groupfix.js); never iFizBox's own IPA.
  const plan = groupFix?.length && own !== IFIZBOX_ID
    ? groupFixPlan(original, prof.entitlements, previous, ents["keychain-access-groups"]) : null;
  const all = withGroupFix(tweaks, plan, groupFix);
  // B327: the keychain groups and the group fix this sign used (or why none), the app's signer's words
  // (a plan made without the dylib only to tell "nothing to fix" from "left unmapped", as the app's signer does)
  const wanted = plan ?? (own !== IFIZBOX_ID && !groupFix?.length
    ? groupFixPlan(original, prof.entitlements, previous, ents["keychain-access-groups"]) : null);
  const signLog = [keychainLogLine(ents), groupFixLogLine(plan,
    own === IFIZBOX_ID ? `${NAME}'s own IPA` : wanted ? "no fix dylib was loaded, the app's groups go unmapped" : undefined)];
  // F288: tweaks (core/tweaks.js prepareTweaks, done on the page): their files into the app, and the weak load commands
  // into the main executable, before zsign signs it all (it signs Frameworks/' dylibs and frameworks as any other).
  const injected = all?.files?.length ? putTweaks(FS, appDir, plist, all) : [];
  if (all?.files?.length) prepareSeal(FS, "/w/app/Payload", { readPlist, removeTree }); // B434: what the tweaks brought
  if (plan?.shared && injected.includes(GROUPFIX.inject)) { // B425
    signLog.push(...fixExtensions(FS, appDir, (path) => JSON.parse(zs.ccall("ifizbox_plist_json", "string", ["string"], [path]) || "null")));
  }
  FS.mkdir("/w/tmp");
  const args = zsignArgs({ p12: "/w/key.p12", password, profile: "/w/app.mobileprovision", entitlements: "/w/ents.plist",
    bundleId: bundleId !== info.bundleId ? bundleId : null, input: appDir, output: "/w/out.ipa", temp: "/w/tmp" });
  let code;
  try { code = zs.callMain(args); } catch (e) {
    if (typeof e?.status !== "number") throw fail("sign_failed", `zsign stopped: ${zsignCrash(e)}. The app may be too big for this browser.`);
    code = e.status; // exit(): emscripten's ExitStatus
  }
  let out = null;
  try { out = code === 0 ? FS.readFile("/w/out.ipa") : null; } catch { /* no output */ }
  if (!out?.length) throw fail("sign_failed", zsignError(log));
  // B227: what iOS will keep from the app after this signature (the group folder an earlier sign used, gone from this profile)
  const warnings = plan?.lost ? [`This profile has no ${plan.lost}, where ${info.name} kept its shared data until now: iOS keeps that folder from it.`] : [];
  // F342: the signer stamp (the group fix dylib's hash when the app got it) and the signature's end, for the install record
  const signer = webSignerStamp(injected.includes(GROUPFIX.inject) ? await groupFixHash(groupFix) : null);
  const expires = signatureEnd(profile);
  return { ipa: out, bundleId, originalId: info.bundleId, name: info.name, version: info.version, ...(sha256 ? { sha256 } : {}),
    signer, signLog, ...(expires ? { expires } : {}),
    ...(injected.length ? { injected } : {}), ...(warnings.length ? { warnings } : {}) };
}

// B211: a file's entitlements (core/groupfix.js entitlementsRead), read in pieces; null when there's none or no file.
export function fileEntitlements(FS, path) {
  let stream;
  try { stream = FS.open(path, "r"); } catch { return null; }
  try {
    return entitlementsRead((pos, len) => {
      const buf = new Uint8Array(len);
      return buf.subarray(0, FS.read(stream, buf, 0, len, pos));
    });
  } finally { FS.close(stream); }
}

// mkdir -p inside emscripten's FS.
function mkdirs(FS, path) {
  let at = "";
  for (const part of path.split("/").filter(Boolean)) {
    at += `/${part}`;
    try { FS.mkdir(at); } catch { /* there already */ }
  }
}

// F288: { files: [{ path, data }], inject: [loadPath] } into the unpacked app; returns what the executable now loads.
export function putTweaks(FS, appDir, plist, { files, inject = [] }) {
  for (const f of files) {
    if (!f?.path || f.path.startsWith("/") || f.path.split("/").includes("..")) throw fail("bad_tweak", `A tweak has a file outside the app (${f?.path}).`);
    const at = `${appDir}/${f.path}`;
    mkdirs(FS, at.slice(0, at.lastIndexOf("/")));
    FS.writeFile(at, f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data));
  }
  if (!inject.length) return [];
  const exe = `${appDir}/${plist.CFBundleExecutable || ""}`;
  let bin;
  try { bin = FS.readFile(exe); } catch { throw fail("bad_ipa", "That IPA's app has no executable to inject the tweaks into."); }
  try { FS.writeFile(exe, injectInto(bin, inject)); } catch (e) { throw fail(e?.code ?? "bad_tweak", e?.message ?? String(e)); }
  return [...inject];
}

// B425: the group fix into the app's notification extensions (PlugIns/ and Extensions/), from the app's Frameworks/;
// one with no room for the load command is left as it was. Returns the sign log's lines (the app's signer's words).
export function fixExtensions(FS, appDir, readPlist) {
  const lines = [];
  for (const dir of ["PlugIns", "Extensions"]) {
    let names;
    try { names = FS.readdir(`${appDir}/${dir}`); } catch { continue; }
    for (const n of names.filter((x) => x.endsWith(".appex"))) {
      let plist = null;
      try { plist = readPlist(`${appDir}/${dir}/${n}/Info.plist`); } catch { /* not readable: not one */ }
      if (!isNotificationExtension(plist) || !plist.CFBundleExecutable) continue;
      const exe = `${appDir}/${dir}/${n}/${plist.CFBundleExecutable}`;
      try {
        FS.writeFile(exe, injectInto(FS.readFile(exe), [GROUPFIX.inject], { rpath: GROUPFIX.extensionRpath }));
        lines.push(`Group fix in ${dir}/${n}`);
      } catch { lines.push(`No group fix in ${dir}/${n}: its executable couldn't take it`); }
    }
  }
  return lines;
}

// F260: whether `password` opens the .p12, as zsign itself loads it (OpenSSL with the legacy provider: any .p12 the
// signer takes, also the ones core/signing.js checkP12Password can't read and answers null for). zsign reads the
// profile and then the certificate before it looks at the app, so it runs on an empty folder: "Can't find app folder"
// means both loaded (true), OpenSSL's "mac verify failure" a wrong password (false); anything else is unknown (null:
// a damaged .p12 or profile, which the sign itself then names). A fresh module, like a sign; it takes milliseconds.
export async function runPasswordCheck(createZsign, { p12, password = "", profile }) {
  if (!p12 || !profile) return null;
  const log = [];
  const zs = await createZsign({ print: (s) => log.push(s), printErr: (s) => log.push(s) });
  const { FS } = zs;
  FS.mkdir("/w");
  FS.mkdir("/w/tmp");
  FS.mkdir("/w/none");
  FS.writeFile("/w/key.p12", new Uint8Array(p12));
  FS.writeFile("/w/app.mobileprovision", new Uint8Array(profile));
  try { zs.callMain(["-k", "/w/key.p12", "-p", password ?? "", "-m", "/w/app.mobileprovision", "-t", "/w/tmp", "/w/none"]); } catch (e) {
    if (typeof e?.status !== "number") return null; // a crash says nothing about the password
  }
  return passwordVerdict(log);
}

// zsign's output on the empty folder, as runPasswordCheck answers it.
export function passwordVerdict(lines) {
  const text = lines.map((l) => String(l)).join("\n");
  if (/Can't find app folder/i.test(text)) return true;
  if (/Can't load p12/i.test(text) && /mac verify failure/i.test(text)) return false;
  return null;
}
