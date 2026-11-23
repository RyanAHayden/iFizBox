// Tweak injection (F288): the user adds .dylib, .deb and zipped .framework tweaks to an IPA before it is signed, as
// Feather's TweakHandler does (GPL-3.0, khcrysalis/Feather, Feather/Utilities/Handlers/TweakHandler.swift). This file
// does everything but the signing, the same for both signers:
//
//   prepareTweaks([{ name, data }]) -> { files: [{ path, data }], inject: [loadPath], names, ignored, missing }
//     unpacks each .deb (data.tar.* -> Library/MobileSubstrate/DynamicLibraries/*.dylib and usr/lib/TweakInject/*.dylib
//     injected; Library/Frameworks/*.framework and usr/lib/*.dylib copied as what they link; Library/Application
//     Support/*.bundle into the app's top folder), takes .dylibs and .frameworks as they are, and points every load
//     command between them at @rpath (CydiaSubstrate and libsubstrate at the bundled CydiaSubstrate.framework, or at
//     ElleKit's libellekit.dylib). `files` go into the app (paths under it: Frameworks/…, X.bundle/…); `inject`
//     is what the main executable gets as LC_LOAD_WEAK_DYLIB. `missing` names what a tweak links that nobody added
//     (["CydiaSubstrate"]: add ElleKit's .deb); a sign with something missing is refused (tweakProblem).
//   withElleKit(items, ellekitDeb) -> prepared   prepareTweaks, and when CydiaSubstrate is missing, again with the
//     bundled ElleKit (ELLEKIT: a pinned .deb in vendor/ellekit, SHA-256 checked by checkElleKit) put first, so its
//     libellekit.dylib stands in; `bundled` names it ("ElleKit 1.2"), `names` stay the user's.
//   injectInto(executable, inject) -> executable   adds the weak load commands (and LC_RPATH @executable_path/Frameworks
//     when the binary lacks it) to every slice, in the room after its load commands; the website's signer does this
//     before zsign signs, the app's in Swift (native/sign/Tweaks.swift) on the same rules.
//   tweakParams(prepared) -> { files: [{ path, data: base64 }], inject, names }   for signing.install / library.options
//   loadCommands(bin), dylibsOf(bin)   reading a Mach-O's load commands (the tests' otool -L)
//   F302 (APT tweaks in the sideload build): injectableFromFields, countInjectable, inspectTweakDeb, filterBundles,
//   targetsApp, worksInText: see the section at the end of the file.
//   F302a (the app side): debOf, tweakTitle, tweakCountText, withTweaksText, tweakSteps, madeFor, tweakUpdates,
//   machoEncrypted, ipaEncrypted: the last section.
//
// SPDX-License-Identifier: GPL-3.0-or-later
import { readAr, readTar, readZip, decompress, UnpackError } from "./unpack.js";
import { sha256Hex } from "./sha256.js";
import { compareVersions } from "./apt.js"; // F302a
import { LIBRARY_WHY } from "./tweakfields.js"; // C32

export { UnpackError };
// The file picker's accept: iOS turns each extension into a file type and greys out what matches none; it knows
// no type for .dylib (nor .deb), so application/octet-stream (any data) keeps them pickable there, as the IPA
// picker does. prepareTweaks checks the name after picking.
export const TWEAK_ACCEPT = ".dylib,.deb,.zip,.framework,application/octet-stream";
export const TWEAK_LIMIT = 64 << 20; // all of an app's tweaks, unpacked
export const SUBSTRATE = "@rpath/CydiaSubstrate.framework/CydiaSubstrate";
export const RPATH = "@executable_path/Frameworks";

const fail = (m) => { throw new UnpackError(m); };

// ---- Mach-O ------------------------------------------------------------------------------------------------------

const MH_MAGIC_64 = 0xfeedfacf, MH_MAGIC = 0xfeedface, FAT = 0xcafebabe, FAT64 = 0xcafebabf;
export const LC = { ID_DYLIB: 0xd, LOAD_DYLIB: 0xc, LOAD_WEAK_DYLIB: 0x80000018, REEXPORT_DYLIB: 0x8000001f,
  LAZY_LOAD_DYLIB: 0x20, LOAD_UPWARD_DYLIB: 0x80000023, RPATH: 0x8000001c, SEGMENT_64: 0x19, SEGMENT: 0x1 };
const DYLIB_CMDS = new Set([LC.ID_DYLIB, LC.LOAD_DYLIB, LC.LOAD_WEAK_DYLIB, LC.REEXPORT_DYLIB, LC.LAZY_LOAD_DYLIB, LC.LOAD_UPWARD_DYLIB]);

const view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const cstr = (b, s, e) => {
  let r = [];
  for (let i = s; i < e && b[i]; i++) r.push(b[i]);
  return new TextDecoder().decode(new Uint8Array(r));
};

export function isMachO(b) {
  if (!b || b.length < 8) return false;
  const le = view(b).getUint32(0, true), be = view(b).getUint32(0, false);
  if (le === MH_MAGIC_64 || le === MH_MAGIC) return true;
  // fat: a small arch count tells it from a Java class file (same magic)
  return (be === FAT || be === FAT64) && view(b).getUint32(4, false) > 0 && view(b).getUint32(4, false) < 20;
}

// The slices as [offset, size]: the file itself when thin.
export function slices(b) {
  const dv = view(b);
  const be = dv.getUint32(0, false);
  if (be !== FAT && be !== FAT64) return [[0, b.length]];
  const n = dv.getUint32(4, false), out = [];
  for (let i = 0; i < n; i++) {
    if (be === FAT) { const o = 8 + i * 20; out.push([dv.getUint32(o + 8, false), dv.getUint32(o + 12, false)]); }
    else { const o = 8 + i * 32; out.push([Number(dv.getBigUint64(o + 8, false)), Number(dv.getBigUint64(o + 16, false))]); }
  }
  return out;
}

// One slice's header: whether 64-bit, the header size, ncmds, sizeofcmds.
function header(b, off) {
  const dv = view(b), m = dv.getUint32(off, true);
  if (m !== MH_MAGIC_64 && m !== MH_MAGIC) fail("A tweak or the app has a binary this can't read (not a Mach-O).");
  const is64 = m === MH_MAGIC_64;
  return { is64, size: is64 ? 32 : 28, ncmds: dv.getUint32(off + 16, true), sizeofcmds: dv.getUint32(off + 20, true) };
}

// A slice's load commands: [{ cmd, offset (in the file), size, name (dylib or rpath path) }].
function commandsAt(b, off) {
  const dv = view(b), h = header(b, off), out = [];
  let p = off + h.size;
  for (let i = 0; i < h.ncmds; i++) {
    const cmd = dv.getUint32(p, true), size = dv.getUint32(p + 4, true);
    if (size < 8 || p + size > b.length) fail("A binary's load commands are damaged.");
    let name = null;
    if (DYLIB_CMDS.has(cmd)) name = cstr(b, p + dv.getUint32(p + 8, true), p + size);
    else if (cmd === LC.RPATH) name = cstr(b, p + dv.getUint32(p + 8, true), p + size);
    out.push({ cmd, offset: p, size, name });
    p += size;
  }
  return out;
}

export function loadCommands(b) { return commandsAt(b, slices(b)[0][0]); }
// What the first slice links (otool -L), its own ID left out.
export function dylibsOf(b) {
  return loadCommands(b).filter((c) => DYLIB_CMDS.has(c.cmd) && c.cmd !== LC.ID_DYLIB).map((c) => c.name);
}
export function idOf(b) { return loadCommands(b).find((c) => c.cmd === LC.ID_DYLIB)?.name ?? null; }

// Where a slice's load commands must end: the first section's data (or a later segment's), relative to the slice.
function roomEnd(b, off, size) {
  const dv = view(b), h = header(b, off);
  let end = size;
  for (const c of commandsAt(b, off)) {
    if (c.cmd !== LC.SEGMENT_64 && c.cmd !== LC.SEGMENT) continue;
    const is64 = c.cmd === LC.SEGMENT_64;
    const fileoff = is64 ? Number(dv.getBigUint64(c.offset + 40, true)) : dv.getUint32(c.offset + 32, true);
    const filesize = is64 ? Number(dv.getBigUint64(c.offset + 48, true)) : dv.getUint32(c.offset + 36, true);
    if (fileoff > 0 && filesize > 0) end = Math.min(end, fileoff);
    const nsects = dv.getUint32(c.offset + (is64 ? 64 : 48), true);
    for (let s = 0; s < nsects; s++) {
      const so = c.offset + (is64 ? 72 + s * 80 : 56 + s * 68);
      const ssize = is64 ? Number(dv.getBigUint64(so + 40, true)) : dv.getUint32(so + 36, true);
      const sOff = dv.getUint32(so + (is64 ? 48 : 40), true);
      const type = dv.getUint32(so + (is64 ? 64 : 56), true) & 0xff;
      if (sOff > 0 && ssize > 0 && type !== 1 && type !== 0x0c && type !== 0x12) end = Math.min(end, sOff);
    }
  }
  return Math.max(end, h.size + h.sizeofcmds);
}

const align = (n, a) => Math.ceil(n / a) * a;

function dylibCommand(cmd, name, { timestamp = 2, current = 0, compat = 0 } = {}) {
  const s = new TextEncoder().encode(name);
  const size = align(24 + s.length + 1, 8);
  const c = new Uint8Array(size), dv = view(c);
  dv.setUint32(0, cmd, true); dv.setUint32(4, size, true); dv.setUint32(8, 24, true);
  dv.setUint32(12, timestamp, true); dv.setUint32(16, current, true); dv.setUint32(20, compat, true);
  c.set(s, 24);
  return c;
}

function rpathCommand(path) {
  const s = new TextEncoder().encode(path);
  const size = align(12 + s.length + 1, 8);
  const c = new Uint8Array(size), dv = view(c);
  dv.setUint32(0, LC.RPATH, true); dv.setUint32(4, size, true); dv.setUint32(8, 12, true);
  c.set(s, 12);
  return c;
}

// Rewrites every slice's load commands with `edit(list)` -> list, where list is [{ cmd, name, bytes }] (bytes: the
// command as it is; a changed one gets new bytes). Fails when the new commands don't fit before the first section.
export function editCommands(bin, edit, what = "the binary") {
  const b = bin.slice();
  for (const [off, size] of slices(b)) {
    const h = header(b, off);
    const list = commandsAt(b, off).map((c) => ({ ...c, bytes: b.slice(c.offset, c.offset + c.size) }));
    const next = edit(list, { is64: h.is64 });
    if (next === list) continue;
    const total = next.reduce((n, c) => n + c.bytes.length, 0);
    // section and segment offsets are the slice's own, so the room is too; an unsigned binary keeps 16 bytes for the
    // LC_CODE_SIGNATURE the signer adds
    const reserve = next.some((c) => c.cmd === 0x1d) ? 0 : 16;
    if (total > h.sizeofcmds && h.size + total + reserve > roomEnd(b, off, size)) fail(`There's no room in ${what} for more load commands.`);
    let p = off + h.size;
    for (const c of next) { b.set(c.bytes, p); p += c.bytes.length; }
    b.fill(0, p, Math.max(p, off + h.size + h.sizeofcmds));
    view(b).setUint32(off + 16, next.length, true);
    view(b).setUint32(off + 20, total, true);
  }
  return b;
}

// Each dylib command's path through `map(path) -> path | null` (null keeps it), and the ID set to `id` when given.
export function rewriteDylibs(bin, map, { id = null, what } = {}) {
  return editCommands(bin, (list) => {
    let changed = false;
    const out = list.map((c) => {
      if (!DYLIB_CMDS.has(c.cmd)) return c;
      const to = c.cmd === LC.ID_DYLIB ? id : map(c.name);
      if (!to || to === c.name) return c;
      changed = true;
      const dv = view(c.bytes);
      return { ...c, name: to, bytes: dylibCommand(c.cmd, to, { timestamp: dv.getUint32(12, true), current: dv.getUint32(16, true), compat: dv.getUint32(20, true) }) };
    });
    return changed ? out : list;
  }, what);
}

// The weak load commands (and the Frameworks rpath) added to the main executable, skipping any it already has.
export function injectInto(bin, inject, { rpath = RPATH, what = "the app's executable" } = {}) {
  if (!inject?.length) return bin;
  return editCommands(bin, (list) => {
    const have = new Set(list.filter((c) => DYLIB_CMDS.has(c.cmd)).map((c) => c.name));
    const rp = new Set(list.filter((c) => c.cmd === LC.RPATH).map((c) => c.name));
    const add = [];
    if (!rp.has(rpath)) add.push({ cmd: LC.RPATH, name: rpath, bytes: rpathCommand(rpath) });
    for (const p of inject) if (!have.has(p)) { have.add(p); add.push({ cmd: LC.LOAD_WEAK_DYLIB, name: p, bytes: dylibCommand(LC.LOAD_WEAK_DYLIB, p) }); }
    return add.length ? [...list, ...add] : list;
  }, what);
}

// ---- .deb and the plan ---------------------------------------------------------------------------------------------

const base = (p) => p.split("/").pop();
const clean = (p) => p.replace(/^\.?\/+/, "").replace(/^(\.\/)+/, "").replace(/^var\/jb\//, "").replace(/^private\/preboot\/[^/]+\/[^/]+\/procursus\//, "");
const safe = (p) => p && !p.startsWith("/") && !p.split("/").some((s) => s === ".." || s === "." || s === "");

function controlField(text, key) {
  const m = new RegExp(`^${key}:\\s*(.+)$`, "mi").exec(text);
  return m ? m[1].trim() : null;
}

// A .deb's files, sorted into the app: [{ path, data, inject }], with its package name and what was left out.
export function unpackDeb(data, name = "tweak.deb") {
  const members = readAr(data);
  if (!members.some((m) => m.name === "debian-binary")) fail(`${name} isn't a .deb (no debian-binary).`);
  const dataTar = members.find((m) => /^data\.tar(\.|$)/.test(m.name));
  if (!dataTar) fail(`${name} has no data.tar.`);
  let pkg = null;
  const control = members.find((m) => /^control\.tar(\.|$)/.test(m.name));
  if (control) {
    try {
      const c = readTar(decompress(control.name, control.data, 1 << 20)).find((e) => base(e.path) === "control" && e.type === "file");
      if (c) pkg = controlField(new TextDecoder().decode(c.data), "Name") || controlField(new TextDecoder().decode(c.data), "Package");
    } catch { /* the name is a nicety */ }
  }
  const entries = readTar(decompress(dataTar.name, dataTar.data, TWEAK_LIMIT));
  return { pkg, ...sortFiles(entries.filter((e) => e.type === "file").map((e) => ({ path: clean(e.path), data: e.data })), name) };
}

// Files from a package's tree (paths as installed, rootless prefix gone) -> what goes into the app.
function sortFiles(list, name) {
  const files = [], ignored = new Set();
  let m;
  for (const f of list) {
    const p = f.path;
    if ((m = /^(?:Library\/MobileSubstrate\/DynamicLibraries|usr\/lib\/TweakInject)\/([^/]+\.dylib)$/.exec(p))) {
      files.push({ path: `Frameworks/${m[1]}`, data: f.data, inject: true });
    } else if ((m = /^(?:Library\/Frameworks|usr\/lib)\/([^/]+\.framework\/.+)$/.exec(p))) {
      files.push({ path: `Frameworks/${m[1]}`, data: f.data, inject: false });
    } else if ((m = /^usr\/lib\/([^/]+\.dylib)$/.exec(p))) {
      files.push({ path: `Frameworks/${m[1]}`, data: f.data, inject: false });
    } else if ((m = /^Library\/Application Support\/([^/]+\.bundle\/.+)$/.exec(p))) {
      files.push({ path: m[1], data: f.data, inject: false });
    } else if (!/\.plist$/.test(p) || !/^Library\/MobileSubstrate\/DynamicLibraries\//.test(p)) {
      const top = p.split("/").slice(0, 3).join("/");
      if (!/^(DEBIAN|usr\/share\/doc)/.test(top)) ignored.add(top);
    }
  }
  if (!files.some((f) => f.inject || /\.framework\//.test(f.path) || /\.dylib$/.test(f.path))) {
    fail(`${name} has nothing to inject (no .dylib in Library/MobileSubstrate/DynamicLibraries).`);
  }
  return { files, ignored: [...ignored].sort() };
}

// A zipped .framework (or a zip holding .dylibs and frameworks) -> files.
function unpackZip(data, name) {
  const files = [];
  for (const e of readZip(data, TWEAK_LIMIT)) {
    if (e.dir || e.symlink || e.path.startsWith("__MACOSX/") || base(e.path).startsWith("._")) continue;
    const parts = e.path.split("/");
    const fw = parts.findIndex((s) => s.endsWith(".framework"));
    if (fw >= 0 && fw < parts.length - 1) files.push({ path: `Frameworks/${parts.slice(fw).join("/")}`, data: e.data, frameworkRoot: parts[fw] });
    else if (e.path.endsWith(".dylib")) files.push({ path: `Frameworks/${base(e.path)}`, data: e.data, inject: true });
    else if (e.path.endsWith(".deb")) files.push(...unpackDeb(e.data, base(e.path)).files);
  }
  if (!files.length) fail(`${name} holds no .framework, .dylib or .deb.`);
  // a framework the user added (not one a .deb brought) is injected, by its executable
  for (const fwName of new Set(files.map((f) => f.frameworkRoot).filter(Boolean))) {
    const stem = fwName.replace(/\.framework$/, "");
    const exe = files.find((f) => f.path === `Frameworks/${fwName}/${stem}`)
      ?? files.find((f) => f.path.startsWith(`Frameworks/${fwName}/`) && f.path.split("/").length === 3 && isMachO(f.data));
    if (exe && stem !== "CydiaSubstrate") exe.inject = true;
  }
  return files.map(({ frameworkRoot, ...f }) => f);
}

const SUBSTRATE_RE = /(^|\/)(CydiaSubstrate\.framework\/CydiaSubstrate|libsubstrate\.dylib|libellekit\.dylib|libhooker\.dylib|libblackjack\.dylib)$/;

// What problem stops a sign, in words; null when there's none.
export function tweakProblem(prepared) {
  if (!prepared?.missing?.length) return null;
  const who = prepared.missingBy?.length ? prepared.missingBy.join(", ") : "A tweak";
  return `${who} needs CydiaSubstrate, which isn't among the tweaks. Add ElleKit's .deb (or a CydiaSubstrate.framework) too.`;
}

// The user's files -> the plan. Later files win over earlier ones at the same path.
export function prepareTweaks(items) {
  const byPath = new Map(), ignored = [], names = [];
  let total = 0;
  for (const it of items ?? []) {
    const data = it.data instanceof Uint8Array ? it.data : new Uint8Array(it.data);
    const n = String(it.name ?? "tweak");
    const lower = n.toLowerCase();
    let files;
    if (lower.endsWith(".deb")) { const d = unpackDeb(data, n); files = d.files; ignored.push(...d.ignored.map((p) => `${n}: ${p}`)); }
    else if (lower.endsWith(".dylib")) {
      if (!isMachO(data)) fail(`${n} isn't a dylib.`);
      files = [{ path: `Frameworks/${base(n)}`, data, inject: true }];
    } else if (lower.endsWith(".zip") || lower.endsWith(".framework")) files = unpackZip(data, n);
    else fail(`${n}: add a .dylib, a .deb or a zipped .framework.`);
    names.push(n);
    for (const f of files) {
      if (!safe(f.path)) fail(`${n} has a file outside its folder (${f.path}).`);
      total += f.data.length;
      if (total > TWEAK_LIMIT) fail("The tweaks are too big (64 MB in all at most).");
      const had = byPath.get(f.path);
      byPath.set(f.path, { ...f, inject: Boolean(f.inject || had?.inject), from: n });
    }
  }
  const all = [...byPath.values()];
  const frameworks = new Set(all.map((f) => /^Frameworks\/([^/]+)\.framework\//.exec(f.path)?.[1]).filter(Boolean));
  const dylibs = new Set(all.filter((f) => /^Frameworks\/[^/]+\.dylib$/.test(f.path)).map((f) => base(f.path)));
  const hasSubstrate = all.some((f) => f.path === "Frameworks/CydiaSubstrate.framework/CydiaSubstrate");
  const substrate = hasSubstrate ? SUBSTRATE : dylibs.has("libellekit.dylib") ? "@rpath/libellekit.dylib" : null;
  const missingBy = new Set();
  // where a load command should point, or null to leave it
  const target = (p) => {
    const fw = /([^/]+)\.framework\/([^/]+)$/.exec(p);
    if (fw && frameworks.has(fw[1])) return `@rpath/${fw[1]}.framework/${fw[2]}`;
    if (!fw && dylibs.has(base(p))) return `@rpath/${base(p)}`;
    if (SUBSTRATE_RE.test(p)) return substrate ?? false;
    return null;
  };
  for (const f of all) {
    if (!isMachO(f.data)) continue;
    const rel = f.path.replace(/^Frameworks\//, "");
    const own = f.path.startsWith("Frameworks/") ? `@rpath/${rel}` : null;
    let lacks = false;
    f.data = rewriteDylibs(f.data, (p) => {
      const t = target(p);
      if (t === false) { lacks = true; return null; }
      return t === own ? null : t;
    }, { id: idOf(f.data) !== null && own ? own : null, what: base(f.path) });
    if (lacks) missingBy.add(f.from);
  }
  const inject = all.filter((f) => f.inject && isMachO(f.data)).map((f) => `@rpath/${f.path.replace(/^Frameworks\//, "")}`);
  if (items?.length && !inject.length) fail("None of these has a .dylib to inject.");
  return {
    files: all.map((f) => ({ path: f.path, data: f.data })),
    inject,
    names,
    ignored,
    missing: missingBy.size ? ["CydiaSubstrate"] : [],
    missingBy: [...missingBy],
  };
}

// ---- the bundled ElleKit ---------------------------------------------------------------------------------------------

// ElleKit 1.2, rootless, as https://ellekit.space serves it (BSD-3-Clause; source, hash and licence in
// vendor/ellekit/README.md). `file` is under web/app.
export const ELLEKIT = Object.freeze({
  name: "ElleKit",
  version: "1.2",
  file: "vendor/ellekit/ellekit_1.2_iphoneos-arm64.deb",
  source: "https://ellekit.space/pool/ellekit_1.2_iphoneos-arm64.deb",
  sha256: "e21dc91bdc1be193dc915daecfff45256239b4fe583a36861e662ab1f43906dc",
  size: 331444,
  licence: "BSD-3-Clause",
});
const ELLEKIT_ITEM = "ellekit_1.2_iphoneos-arm64.deb";

// The bundled .deb's bytes, or a throw with words when they aren't the pinned file.
export function checkElleKit(data) {
  const b = data instanceof Uint8Array ? data : new Uint8Array(data ?? []);
  if (b.length !== ELLEKIT.size || sha256Hex(b) !== ELLEKIT.sha256) {
    fail(`The bundled ${ELLEKIT.name} isn't the expected file. Add ElleKit's .deb to the tweaks yourself.`);
  }
  return b;
}

export function needsElleKit(prepared) { return Boolean(prepared?.missing?.length); }

// prepareTweaks, with the bundled ElleKit added when a tweak needs CydiaSubstrate and nobody added it. `ellekit` is
// the checked .deb (checkElleKit), or null to only prepare (missing then stays as it is).
export function withElleKit(items, ellekit) {
  const p = prepareTweaks(items);
  if (!needsElleKit(p) || !ellekit) return { ...p, bundled: [] };
  // first, so a file of the user's at the same path wins
  const q = prepareTweaks([{ name: ELLEKIT_ITEM, data: ellekit }, ...(items ?? [])]);
  return {
    ...q,
    names: p.names,
    ignored: q.ignored.filter((s) => !s.startsWith(`${ELLEKIT_ITEM}: `)),
    bundled: needsElleKit(q) ? [] : [`${ELLEKIT.name} ${ELLEKIT.version}`],
  };
}

// For the app's bridge (signing.install, library.options): base64 file contents.
export function tweakParams(prepared, toBase64) {
  if (!prepared?.files?.length) return null;
  return { files: prepared.files.map((f) => ({ path: f.path, data: toBase64(f.data) })), inject: [...prepared.inject], names: [...prepared.names] };
}

// A short line for a row: "Tweak (.deb)", "Dynamic Library", "Framework".
export function tweakKind(name) {
  const n = String(name).toLowerCase();
  if (n.endsWith(".deb")) return "Package (.deb)";
  if (n.endsWith(".dylib")) return "Dynamic Library";
  return "Framework (.zip)";
}

// ---- F302: APT tweaks in the sideload build ----------------------------------------------------------------------
// The sideload app reads APT repos again, for tweaks it can inject into an app only. Two passes:
//
//   injectableFromFields(stanza) -> { ok, why }   the Packages fields alone (Architecture, Section, Tag, Depends):
//     iphoneos-arm64 or iphoneos-arm, no theme/app/daemon/CLI/jailbreak-utility section or purpose, and every Depends
//     group satisfiable by a hook library we provide or can drop (HOOK_DEPS: substrate/ElleKit -> the bundled
//     ElleKit, PreferenceLoader, firmware, cy+ feature names). Anything depending on another package is left out.
//   isLibraryStanza(stanza) -> bool                  B185: a library for other tweaks (Comet), by Section, purpose::library
//     or a Description that is about a library/framework; injectableFromFields then answers { library: true,
//     why: LIBRARY_WHY }, and inspectTweakDeb does too for a .deb that only carries frameworks or loose .dylibs
//   countInjectable(packagesText) -> n               the Sources tab's count for a Tweak Source
//   inspectTweakDeb(debBytes) -> { ok, why, dylibs, bundles, executables, anyApp, systemOnly }   the real check, on
//     first open of a package page: a .dylib under Library/MobileSubstrate/DynamicLibraries (rootless: var/jb/…) or
//     usr/lib/TweakInject with its filter .plist, no Applications/, LaunchDaemons, CLI tools or themes. Cached per
//     package and version by the UI (screens/tweaks.js tweakInfo).
//   filterBundles(plistBytes) -> { bundles, executables }   a filter plist's Filter.Bundles / Executables (XML,
//     OpenStep text or binary plist)
//   targetsApp(info, bundleId) -> bool               whether a checked tweak's filter names that app (or every app)
//   appNameOf(bundleId, known) -> name               "Works in" names: the user's own apps first, then KNOWN_APPS

// C32: the Packages-fields check lives in core/tweakfields.js (startup loads it without this file); its names are
// re-exported here.
export { TWEAK_ARCHES, HOOK_DEPS, LIBRARY_WHY, isLibraryStanza, injectableFromFields,
  countInjectable } from "./tweakfields.js";

// Bundle IDs that mean "every app": a tweak filtered on UIKit or Foundation loads into anything.
const ANY_APP = new Set(["com.apple.uikit", "com.apple.foundation", "com.apple.corefoundation"]);
const isSystem = (id) => /^com\.apple\./i.test(id) && !ANY_APP.has(id.toLowerCase());

// The real check, on the .deb's bytes. Throws UnpackError when it isn't a readable .deb.
export function inspectTweakDeb(data) {
  const members = readAr(data instanceof Uint8Array ? data : new Uint8Array(data));
  if (!members.some((m) => m.name === "debian-binary")) fail("This isn't a .deb (no debian-binary).");
  const dataTar = members.find((m) => /^data\.tar(\.|$)/.test(m.name));
  if (!dataTar) fail("This .deb has no data.tar.");
  const entries = readTar(decompress(dataTar.name, dataTar.data, TWEAK_LIMIT));
  const dylibs = [], plists = new Map(), bad = new Set(), other = new Set();
  for (const e of entries) {
    if (e.type !== "file" && e.type !== "symlink") continue;
    const p = clean(e.path);
    let m;
    if ((m = /^(?:Library\/MobileSubstrate\/DynamicLibraries|usr\/lib\/TweakInject)\/([^/]+)\.dylib$/.exec(p))) dylibs.push(m[1]);
    else if ((m = /^(?:Library\/MobileSubstrate\/DynamicLibraries|usr\/lib\/TweakInject)\/([^/]+)\.plist$/.exec(p))) plists.set(m[1], e.data);
    else if (/^Applications\//.test(p)) bad.add("an app");
    else if (/^(System\/)?Library\/Launch(Daemons|Agents)\//.test(p)) bad.add("a daemon");
    else if (/^(usr\/(local\/)?)?s?bin\//.test(p)) bad.add("command-line tools");
    else if (/^Library\/Themes\//.test(p)) bad.add("a theme");
    // B185: what a package with nothing to inject is instead, for a plain reason (LIBRARY_WHY and the two below)
    else if (/^Library\/PreferenceBundles\//.test(p)) other.add("settings");
    else if (/^Library\/ControlCenter\/Bundles\//.test(p)) other.add("control center");
    else if (/\.(dylib|framework)(\/|$)/.test(p)) other.add("library");
  }
  const bundles = new Set(), executables = new Set();
  for (const d of dylibs) {
    const f = plists.has(d) ? filterBundles(plists.get(d)) : { bundles: [], executables: [] };
    f.bundles.forEach((b) => bundles.add(b));
    f.executables.forEach((x) => executables.add(x));
  }
  const ids = [...bundles];
  const anyApp = ids.some((b) => ANY_APP.has(b.toLowerCase()));
  const apps = ids.filter((b) => !isSystem(b) && !ANY_APP.has(b.toLowerCase()));
  const systemOnly = !anyApp && !apps.length;
  let why = null;
  if (!dylibs.length) why = other.has("library") ? LIBRARY_WHY
    : other.has("control center") ? "This adds to Control Center, which is part of iOS, not something to add to an app."
      : other.has("settings") ? "This only adds a page to Settings, not something to add to an app."
        : "There's nothing in it that can go into an app.";
  else if (![...dylibs].some((d) => plists.has(d))) why = "It doesn't say which apps it's for, so it can't be added to one.";
  else if (bad.size) why = `It also installs ${[...bad].join(", ")}, which can't go into an app.`;
  else if (systemOnly) why = "It's for iOS itself (SpringBoard or a system app), not an app you can sign.";
  return { ok: !why, why, dylibs, bundles: apps, anyApp, systemOnly, executables: [...executables],
    library: !dylibs.length && other.has("library") };
}

export function targetsApp(info, bundleId) {
  if (!info?.ok || !bundleId) return false;
  return Boolean(info.anyApp) || (info.bundles ?? []).some((b) => b.toLowerCase() === String(bundleId).toLowerCase());
}

// Popular targets by bundle ID, for "Works in" before the user has the app.
export const KNOWN_APPS = Object.freeze({
  "com.atebits.Tweetie2": "X (Twitter)", "com.google.ios.youtube": "YouTube", "com.google.ios.youtubemusic": "YouTube Music",
  "com.burbn.instagram": "Instagram", "com.zhiliaoapp.musically": "TikTok", "com.ss.iphone.ugc.Ame": "TikTok",
  "com.spotify.client": "Spotify", "net.whatsapp.WhatsApp": "WhatsApp", "ph.telegra.Telegraph": "Telegram",
  "com.reddit.Reddit": "Reddit", "com.toyopagroup.picaboo": "Snapchat", "com.facebook.Facebook": "Facebook",
  "com.facebook.Messenger": "Messenger", "com.hammerandchisel.discord": "Discord", "com.netflix.Netflix": "Netflix",
  "tv.twitch": "Twitch", "com.soundcloud.TouchApp": "SoundCloud", "com.apple.mobilesafari": "Safari",
});

export function appNameOf(bundleId, known = {}) {
  const k = String(bundleId ?? "");
  const lower = k.toLowerCase();
  for (const [id, name] of Object.entries(known ?? {})) if (id.toLowerCase() === lower && name) return name;
  for (const [id, name] of Object.entries(KNOWN_APPS)) if (id.toLowerCase() === lower) return name;
  return k;
}

// "Works in" text for a checked tweak: "Any App", or the app names (the user's own first), or null.
export function worksInText(info, known = {}) {
  if (!info?.ok) return null;
  if (info.anyApp) return "Any App";
  const names = [...new Set((info.bundles ?? []).map((b) => appNameOf(b, known)))];
  return names.length ? names.join(", ") : null;
}

// ---- filter plists --------------------------------------------------------------------------------------------

// { bundles, executables } from a MobileSubstrate filter plist, whatever its format.
export function filterBundles(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  let root = null;
  try {
    if (b.length > 8 && new TextDecoder().decode(b.subarray(0, 6)) === "bplist") root = readBplist(b);
    else root = readTextPlist(new TextDecoder().decode(b));
  } catch { root = null; }
  const filter = root && typeof root === "object" ? root.Filter ?? root.filter ?? null : null;
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x) : []);
  return { bundles: list(filter?.Bundles), executables: list(filter?.Executables) };
}

// XML plists and OpenStep text plists ({ Filter = { Bundles = ( "a", b ); }; }) to plain values.
export function readTextPlist(text) {
  const s = String(text ?? "").replace(/^﻿/, "").trim();
  if (s.startsWith("<")) return readXmlPlist(s);
  let i = 0;
  const ws = () => {
    for (;;) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (s.startsWith("//", i)) { while (i < s.length && s[i] !== "\n") i++; continue; }
      if (s.startsWith("/*", i)) { const e = s.indexOf("*/", i + 2); i = e < 0 ? s.length : e + 2; continue; }
      return;
    }
  };
  const value = () => {
    ws();
    const c = s[i];
    if (c === "{") {
      i++;
      const o = {};
      for (;;) {
        ws();
        if (s[i] === "}") { i++; return o; }
        const k = value();
        ws();
        if (s[i] !== "=") throw new Error("plist: = expected");
        i++;
        o[String(k)] = value();
        ws();
        if (s[i] === ";") i++;
      }
    }
    if (c === "(") {
      i++;
      const a = [];
      for (;;) {
        ws();
        if (s[i] === ")") { i++; return a; }
        a.push(value());
        ws();
        if (s[i] === ",") i++;
      }
    }
    if (c === '"') {
      let out = "";
      i++;
      while (i < s.length && s[i] !== '"') { if (s[i] === "\\") i++; out += s[i++]; }
      i++;
      return out;
    }
    const m = /^[A-Za-z0-9_.$:\/+-]+/.exec(s.slice(i));
    if (!m) throw new Error("plist: value expected");
    i += m[0].length;
    return m[0];
  };
  return value();
}

const xmlText = (t) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function readXmlPlist(s) {
  const tokens = [...s.replace(/<\?[^>]*\?>|<!DOCTYPE[^>]*>|<!--[\s\S]*?-->/g, "")
    .matchAll(/<(\/?)(\w+)(?:\s[^>]*?)?\s*(\/?)>|([^<]+)/g)];
  let i = 0;
  const next = () => tokens[i++];
  const skipText = () => { while (i < tokens.length && tokens[i][4] !== undefined && !tokens[i][4].trim()) i++; };
  const value = () => {
    skipText();
    const t = next();
    if (!t) throw new Error("plist: end");
    const [, close, tag, self] = t;
    if (close) throw new Error("plist: unexpected close");
    if (self) return tag === "true" ? true : tag === "false" ? false : tag === "dict" ? {} : tag === "array" ? [] : "";
    if (tag === "plist") { const v = value(); skipText(); next(); return v; }
    if (tag === "dict") {
      const o = {};
      for (;;) {
        skipText();
        if (tokens[i]?.[1] && tokens[i][2] === "dict") { i++; return o; }
        const k = next();
        if (!k || k[2] !== "key") throw new Error("plist: key expected");
        let key = "";
        if (tokens[i]?.[4] !== undefined) key = xmlText(next()[4]);
        next(); // </key>
        o[key.trim()] = value();
      }
    }
    if (tag === "array") {
      const a = [];
      for (;;) {
        skipText();
        if (tokens[i]?.[1] && tokens[i][2] === "array") { i++; return a; }
        a.push(value());
      }
    }
    let txt = "";
    if (tokens[i]?.[4] !== undefined) txt = xmlText(next()[4]);
    next(); // the close tag
    if (tag === "integer" || tag === "real") return Number(txt);
    return txt.trim();
  };
  return value();
}

// A binary plist (bplist00) to plain values: dicts, arrays, strings, numbers, booleans (what filter plists hold).
export function readBplist(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const t = b.length - 32;
  if (t < 8) throw new Error("bplist: too short");
  const offSize = b[t + 6], refSize = b[t + 7];
  const num = (o, n) => { let v = 0; for (let k = 0; k < n; k++) v = v * 256 + b[o + k]; return v; };
  const count = num(t + 8, 8), top = num(t + 16, 8), table = num(t + 24, 8);
  const offsetOf = (ref) => num(table + ref * offSize, offSize);
  let depth = 0;
  const obj = (ref) => {
    if (ref >= count || ++depth > 64) throw new Error("bplist: bad object");
    try {
      let o = offsetOf(ref);
      const m = b[o], hi = m >> 4, lo = m & 15;
      const len = () => {
        if (lo !== 15) return [lo, o + 1];
        const n = 1 << (b[o + 1] & 15);
        return [num(o + 2, n), o + 2 + n];
      };
      if (m === 0x08) return false;
      if (m === 0x09) return true;
      if (hi === 1) return num(o + 1, 1 << lo);
      if (hi === 2) return lo === 3 ? dv.getFloat64(o + 1) : dv.getFloat32(o + 1);
      if (hi === 5) { const [n, s] = len(); return new TextDecoder("latin1").decode(b.subarray(s, s + n)); }
      if (hi === 6) {
        const [n, s] = len();
        let out = "";
        for (let k = 0; k < n; k++) out += String.fromCharCode(dv.getUint16(s + k * 2));
        return out;
      }
      if (hi === 0xa) { const [n, s] = len(); return Array.from({ length: n }, (_, k) => obj(num(s + k * refSize, refSize))); }
      if (hi === 0xd) {
        const [n, s] = len();
        const out = {};
        for (let k = 0; k < n; k++) out[String(obj(num(s + k * refSize, refSize)))] = obj(num(s + (n + k) * refSize, refSize));
        return out;
      }
      return null;
    } finally { depth--; }
  };
  return obj(top);
}

// ---- F302a: tweaks on the app side ---------------------------------------------------------------------------------
// The words and rules of the app-side flow (screens/tweaks.js draws them):
//
//   debOf(name) -> { package, version } | null       a kept tweak's file name as addDebTo writes it (pkg_version.deb)
//   tweakTitle(item) -> "YTLite"                      a kept tweak's name for people: its title, else the file's
//   tweakCountText(n) -> "2 Tweaks"                   Installed's pill, the install popup's row
//   withTweaksText(titles) -> "with A, B and C"       the install popup's line under the app's name
//   tweakSteps(prepared) -> ["Adding A", …, "Adding ElleKit 1.2"]   one progress line per tweak, then ElleKit's
//   madeFor(rows, bundleId, infoOf) -> rows           the source tweaks whose checked filter names that app
//   tweakUpdates(kept, rows) -> [{ package, title, from, to, row }]   kept .debs a Tweak Source has a newer version of
//   machoEncrypted(bytes) -> true | false | null      the App Store's encryption (LC_ENCRYPTION_INFO cryptid) on the
//                                                     first slice; null when the bytes aren't a Mach-O header
//   await ipaEncrypted(src) -> { encrypted, bundleId, name } | null   an IPA (File/Blob/bytes): the main executable's
//                                                     head only is read and inflated; null when it can't be read
//   ENCRYPTED_ALERT(name), HOW_TO_GET_ONE              the "<App> Is Locked" alert's words

export function debOf(name) {
  const m = /^(.+?)_([^_]+)\.deb$/i.exec(String(name ?? ""));
  return m ? { package: m[1], version: m[2] } : null;
}

export function tweakTitle(item) {
  if (item?.title) return String(item.title);
  const n = String(item?.name ?? "");
  const d = debOf(n);
  if (d) return d.package.split(".").pop() || d.package;
  return n.replace(/\.(deb|dylib|zip|framework)$/i, "").replace(/\.framework$/i, "") || n;
}

export const tweakCountText = (n) => `${n} ${n === 1 ? "Tweak" : "Tweaks"}`;

export function withTweaksText(titles) {
  const t = [...new Set((titles ?? []).filter(Boolean).map(String))];
  if (!t.length) return "";
  if (t.length === 1) return `with ${t[0]}`;
  return `with ${t.slice(0, -1).join(", ")} and ${t.at(-1)}`;
}

// prepared: prepareTweaks / withElleKit's; `titles` the kept items' titles in the same order as prepared.names.
export function tweakSteps(prepared, titles = null) {
  if (!prepared) return [];
  const names = (prepared.names ?? []).map((n, i) => titles?.[i] || tweakTitle({ name: n }));
  return [...names.map((n) => `Adding ${n}`), ...(prepared.bundled ?? []).map((b) => `Adding ${b}`)];
}

// rows: [{ id (the package), version, … }]; infoOf(row) -> the cached check or null.
export function madeFor(rows, bundleId, infoOf) {
  if (!bundleId) return [];
  return (rows ?? []).filter((r) => targetsApp(infoOf(r), bundleId));
}

export function tweakUpdates(kept, rows) {
  const newest = new Map();
  for (const r of rows ?? []) {
    const id = r?.id ?? r?.package;
    if (!id || !r.version) continue;
    const had = newest.get(id);
    if (!had || compareVersions(r.version, had.version) > 0) newest.set(id, r);
  }
  const out = [];
  for (const it of kept ?? []) {
    const d = debOf(it?.name);
    const r = d && newest.get(d.package);
    if (r && compareVersions(r.version, d.version) > 0) {
      out.push({ package: d.package, title: it.title || r.name || tweakTitle(it), from: d.version, to: r.version, row: r });
    }
  }
  return out;
}

const LC_ENCRYPTION_INFO = 0x21, LC_ENCRYPTION_INFO_64 = 0x2c;
export function machoEncrypted(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  if (!isMachO(b)) return null;
  let off;
  try { off = slices(b)[0][0]; } catch { return null; }
  if (off + 32 > b.length) return null;
  const dv = view(b), m = dv.getUint32(off, true);
  if (m !== MH_MAGIC_64 && m !== MH_MAGIC) return null;
  const ncmds = dv.getUint32(off + 16, true);
  let p = off + (m === MH_MAGIC_64 ? 32 : 28);
  for (let i = 0; i < ncmds; i++) {
    if (p + 8 > b.length) return null; // the head read wasn't long enough
    const cmd = dv.getUint32(p, true), size = dv.getUint32(p + 4, true);
    if (size < 8) return null;
    if (cmd === LC_ENCRYPTION_INFO || cmd === LC_ENCRYPTION_INFO_64) {
      if (p + 20 > b.length) return null;
      return dv.getUint32(p + 16, true) !== 0;
    }
    p += size;
  }
  return false;
}

function ipaSource(src) {
  if (src && typeof src.slice === "function" && typeof src.size === "number" && !(src instanceof Uint8Array) && !(src instanceof ArrayBuffer)) {
    return { size: src.size, read: async (a, b) => new Uint8Array(await src.slice(a, b).arrayBuffer()) };
  }
  const b = src instanceof Uint8Array ? src : src instanceof ArrayBuffer ? new Uint8Array(src) : null;
  return b ? { size: b.length, read: async (a, c) => b.subarray(a, c) } : null;
}

async function ipaDirectory({ size, read }) {
  const tailLen = Math.min(size, 65557);
  const tail = await read(size - tailLen, size);
  const tv = view(tail);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const dirSize = tv.getUint32(eocd + 12, true), dirAt = tv.getUint32(eocd + 16, true);
  if (dirAt + dirSize > size) return null;
  const d = await read(dirAt, dirAt + dirSize);
  const v = view(d), out = [];
  for (let p = 0; p + 46 <= d.length && v.getUint32(p, true) === 0x02014b50;) {
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    out.push({ name: new TextDecoder().decode(d.subarray(p + 46, p + 46 + nameLen)), flags: v.getUint16(p + 8, true),
      method: v.getUint16(p + 10, true), csize: v.getUint32(p + 20, true), size: v.getUint32(p + 24, true), local: v.getUint32(p + 42, true) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// The first `want` bytes of a zip entry (stored or deflated), or null.
async function ipaEntryHead({ read }, e, want) {
  if (e.flags & 1) return null;
  const head = await read(e.local, e.local + 30);
  if (head.length < 30 || view(head).getUint32(0, true) !== 0x04034b50) return null;
  const start = e.local + 30 + view(head).getUint16(26, true) + view(head).getUint16(28, true);
  if (e.method === 0) return (await read(start, start + Math.min(e.csize, want))).slice();
  if (e.method !== 8 || typeof DecompressionStream !== "function") return null;
  // compressed bytes in steps until enough comes out: a big executable is never read whole
  const out = [];
  let got = 0;
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  const pump = (async () => {
    for (let at = 0; at < e.csize && got < want; at += 256 * 1024) {
      await writer.ready;
      await writer.write(await read(start + at, start + Math.min(e.csize, at + 256 * 1024)));
    }
  })().catch(() => {});
  while (got < want) {
    const { value, done } = await reader.read().catch(() => ({ done: true }));
    if (done) break;
    out.push(value);
    got += value.length;
  }
  reader.cancel().catch(() => {});
  writer.abort().catch(() => {});
  await pump;
  const all = new Uint8Array(Math.min(got, want));
  let p = 0;
  for (const c of out) { if (p >= all.length) break; all.set(c.subarray(0, all.length - p), p); p += Math.min(c.length, all.length - p); }
  return all;
}

export async function ipaEncrypted(src) {
  try {
    const s = ipaSource(src);
    if (!s) return null;
    const dir = await ipaDirectory(s);
    const info = dir?.find((e) => /^Payload\/[^/]+\.app\/Info\.plist$/.test(e.name));
    if (!info || info.size > 4 << 20) return null;
    const raw = await ipaEntryHead(s, info, info.size);
    if (!raw) return null;
    const p = new TextDecoder().decode(raw.subarray(0, 6)) === "bplist" ? readBplist(raw) : readTextPlist(new TextDecoder().decode(raw));
    const app = info.name.slice(0, -"Info.plist".length);
    const exeName = typeof p?.CFBundleExecutable === "string" && p.CFBundleExecutable ? p.CFBundleExecutable : app.slice(8, -5);
    const exe = dir.find((e) => e.name === app + exeName);
    if (!exe) return null;
    // a fat binary's first slice starts at 16 KB or so; its load commands follow its header
    let head = await ipaEntryHead(s, exe, 64 * 1024);
    let enc = machoEncrypted(head);
    if (enc === null && head && isMachO(head)) {
      const off = slices(head)[0]?.[0] ?? 0;
      if (off > 0 && off < 8 << 20) { head = await ipaEntryHead(s, exe, off + 64 * 1024); enc = machoEncrypted(head); }
    }
    if (enc === null) return null;
    const bundleId = typeof p?.CFBundleIdentifier === "string" ? p.CFBundleIdentifier : "";
    const name = String(p?.CFBundleDisplayName || p?.CFBundleName || bundleId || exeName);
    return { encrypted: enc, bundleId, name };
  } catch { return null; }
}

export const HOW_TO_GET_ONE = "How to Get One";
export const ENCRYPTED_ALERT = (name) => ({
  title: `${name || "This App"} Is Locked`,
  message: "This IPA came from the App Store and is still encrypted, so tweaks can't go in and it can't be signed. A decrypted copy works.",
  buttons: [HOW_TO_GET_ONE, "OK"], cancel: 1,
});
// What "How to Get One" says (the concept's list; sites that hand out other people's decrypted App Store apps left out).
export const HOW_TO_TEXT = "Decrypt your own copy: TrollDecrypt on a TrollStore phone, or bagbak / frida-ios-dump from a "
  + "computer to a jailbroken phone. Free and open-source apps on AltStore sources aren't encrypted in the first place.";
