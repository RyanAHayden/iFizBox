// B211: signed apps keep their own app-group folders and keychain. A re-signed app asks for the app groups and keychain
// access groups of its original signature (Instagram: group.com.burbn.instagram), which the user's profile can't give,
// so iOS answers nil and errSecMissingEntitlement and the app loses its settings and sign-in. Both signers (this
// website's, websign-job.js, and the app's, native/sign/IPASigner.swift with the same rules) read the original
// executable's entitlements before signing and inject a small fix dylib (native/groupfix/groupfix.m, committed built
// at vendor/groupfix/) that maps those groups to a folder in the app's own container (B227: the same under every
// profile; an older sign's profile group is copied in once) and strips kSecAttrAccessGroup from keychain calls.
//
//   machoEntitlements(bin)                  the entitlements (XML slot) of a Mach-O's first slice, or null when unsigned
//   entitlementsRead(read)                  the same through read(pos, len), reading only the parts it needs
//   groupFixPlan(original, profileEnts, previous)  { groups, target, keychain, legacy?, lost? } to fix, or null when the app needs
//                                           nothing; previous: the config an earlier sign left in the app
//   readConfig(bytes)                       that config's { groups, keychain }, or null
//   groupFixTweaks(plan, dylib)             { files, inject } for the F288 tweak path (putTweaks / TweakSet)
//   withGroupFix(tweaks, plan, dylib)       a prepared tweak set (or null) with the fix added
//   GROUPFIX                                its file under web/app, and the paths in the app
// SPDX-License-Identifier: GPL-3.0-or-later
import { slices } from "./tweaks.js";
import { parsePlist } from "./signing.js";
import { plistXml } from "./websign.js";

export const GROUPFIX = Object.freeze({
  file: "vendor/groupfix/ifizbox-groupfix.dylib",
  dylib: "Frameworks/ifizbox-groupfix.dylib",
  config: "Frameworks/ifizbox-groupfix.plist",
  inject: "@rpath/ifizbox-groupfix.dylib",
});

const APP_GROUPS = "com.apple.security.application-groups";
const KEYCHAIN = "keychain-access-groups";
const strings = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === "string" && s) : []);

export function machoEntitlements(bin) {
  const b = bin instanceof Uint8Array ? bin : new Uint8Array(bin);
  return entitlementsRead((pos, len) => b.subarray(pos, pos + len));
}

// The same through read(pos, len) -> Uint8Array: only the header, the load commands and the signature are read (an
// app's executable can be 100 MB, and the website signs in the browser's memory).
export function entitlementsRead(read) {
  try {
    const dv = (pos, len) => { const u = read(pos, len); return u.length < len ? null : new DataView(u.buffer, u.byteOffset, len); };
    // the first 64-bit slice of a fat file (as Inspect.swift), the file itself when thin
    const head = read(0, 4096);
    const off = head.length < 8 ? 0 : slices(head).map(([o]) => o).find((o) => {
      const m = dv(o, 4);
      return m && m.getUint32(0, true) === 0xfeedfacf;
    }) ?? 0;
    const h = dv(off, 32);
    if (!h || h.getUint32(0, true) !== 0xfeedfacf) return null;
    const ncmds = h.getUint32(16, true), sizeofcmds = h.getUint32(20, true);
    const cmds = dv(off + 32, sizeofcmds);
    if (!cmds) return null;
    for (let i = 0, p = 0; i < ncmds && p + 8 <= sizeofcmds; i++) {
      const cmd = cmds.getUint32(p, true), cs = cmds.getUint32(p + 4, true);
      if (cmd === 0x1d) { // LC_CODE_SIGNATURE
        const so = off + cmds.getUint32(p + 8, true), ss = cmds.getUint32(p + 12, true);
        const sig = dv(so, ss);
        if (!sig || ss < 12 || sig.getUint32(0, false) !== 0xfade0cc0) return null;
        const count = sig.getUint32(8, false);
        for (let k = 0; k < count && 20 + 8 * k <= ss; k++) {
          const type = sig.getUint32(12 + 8 * k, false), bo = sig.getUint32(16 + 8 * k, false);
          if (type !== 5 || bo + 8 > ss || sig.getUint32(bo, false) !== 0xfade7171) continue;
          const len = sig.getUint32(bo + 4, false);
          if (len < 8 || bo + len > ss) return null;
          const xml = new TextDecoder().decode(new Uint8Array(sig.buffer, sig.byteOffset + bo + 8, len - 8));
          const e = parsePlist(xml);
          return e && typeof e === "object" && !Array.isArray(e) ? e : null;
        }
        return null;
      }
      if (cs < 8) return null;
      p += cs;
    }
  } catch { /* damaged: as unsigned */ }
  return null;
}

// The original's groups the profile doesn't have, mapped to a folder in the app's own container (target ""); keychain
// when the original names keychain access groups.
// `previous`: the config an earlier sign left in the app (an IPA signed again), whose groups still count: its
// executable now carries the profile's groups, not the original ones.
// B227: never the profile's own group for a new plan. Its first group changed whenever the profile was made again
// (groups added, or listed in another order), and the folder with it, so the app lost that data; and every app signed
// with the profile shared it. The app's own folder is the same under any profile, App ID or certificate. An app an
// earlier sign mapped to a profile group keeps it while the profile still has it; `lost` names it when it doesn't
// (iOS keeps that group's folder from the app: worth a warning before signing).
export function groupFixPlan(original, profileEnts = {}, previous = null) {
  const have = strings(profileEnts?.[APP_GROUPS]);
  const groups = [...new Set([...strings(original?.[APP_GROUPS]), ...strings(previous?.groups)])].filter((g) => !have.includes(g));
  const keychain = strings(original?.[KEYCHAIN]).length > 0 || previous?.keychain === true;
  if (!groups.length && !keychain) return null;
  const was = typeof previous?.target === "string" ? previous.target : "";
  const plan = { groups, target: was && have.includes(was) ? was : "", keychain };
  if (was && !have.includes(was)) plan.lost = was;
  // the group the older rule (the profile's first) would have picked: the dylib copies its folder and suite into the
  // app's own once, so an app signed that way, now signed again from its original IPA, keeps that data
  if (!plan.target && have.length && !(previous && was === "")) plan.legacy = have[0];
  return plan;
}

// B327: the sign log's line for the group fix a sign put in, every part of its config, or why none (the same words as
// native/sign/GroupFix.swift logLine).
export const GROUPFIX_NOT_NEEDED = "the original signature names no app groups or keychain groups";
export function groupFixLogLine(plan, none = GROUPFIX_NOT_NEEDED) {
  if (!plan) return `Group fix: none (${none})`;
  return `Group fix: ${plan.groups.length ? plan.groups.join(", ") : "no app groups"} -> ${plan.target || "the app's own folder"}`
    + (plan.keychain ? "; keychain groups stripped" : "") + (plan.legacy ? `; ${plan.legacy} copied in once if the app ran before` : "");
}

export function readConfig(bytes) {
  try {
    const c = parsePlist(new TextDecoder().decode(bytes));
    return c && typeof c === "object" && !Array.isArray(c) ? c : null;
  } catch { return null; }
}

export function groupFixTweaks(plan, dylib) {
  const data = dylib instanceof Uint8Array ? dylib : new Uint8Array(dylib);
  return {
    files: [{ path: GROUPFIX.dylib, data },
      { path: GROUPFIX.config, data: new TextEncoder().encode(plistXml({ groups: plan.groups, target: plan.target, keychain: plan.keychain,
        ...(plan.legacy ? { legacy: plan.legacy } : {}) })) }],
    inject: [GROUPFIX.inject],
  };
}

export function withGroupFix(tweaks, plan, dylib) {
  if (!plan || !dylib?.length) return tweaks;
  const fix = groupFixTweaks(plan, dylib);
  const files = (tweaks?.files ?? []).filter((f) => !fix.files.some((x) => x.path === f.path));
  return { ...(tweaks ?? {}), files: [...files, ...fix.files], inject: [...(tweaks?.inject ?? []).filter((i) => i !== GROUPFIX.inject), ...fix.inject] };
}
