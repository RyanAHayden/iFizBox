// B434: the unpacked app as iOS sees it when it checks the seal, before zsign seals it: zsign seals names iOS skips or
// spells another way, and installd refuses that ("A signed resource has been added, modified, or deleted",
// 0xe8008017). The app's own signer has the same rules in native/sign/SealPath.swift and IPASigner.swift.
//
//   prepareSeal(FS, payload, { readPlist, removeTree })  everything under `payload` (the unpacked Payload folder), in place:
//     - a bundle's old _CodeSignature folder goes, as do CodeResources and _MASReceipt at the root of one zsign signs;
//     - files whose name ends in .DS_Store go (zsign leaves them out of the seal, iOS skips only that exact name);
//     - the composed and decomposed spellings of a name (é) become one: the first one's, with the last one's data;
//     - a bundle's executable with a non-ASCII name takes the decomposed spelling, its folders and Info.plist too.
//   Running it again changes nothing. readPlist(path) -> the plist as a value (null or a throw: not readable); removeTree is websign-job.js's (passed
//   in: importing it would be a cycle).
// SPDX-License-Identifier: GPL-3.0-or-later
import { parsePlist } from "./core/signing.js";

const SIGNED = /\.(app|appex|framework|xctest)$/; // the folders zsign looks for bundles in
const nfd = (s) => s.normalize("NFD");
const ascii = (s) => !/[^\x00-\x7f]/.test(s); // eslint-disable-line no-control-regex

function isFolder(FS, path) {
  try { return FS.isDir(FS.stat(path).mode); } catch { return false; }
}
const exists = (FS, path) => { try { FS.stat(path); return true; } catch { return false; } };
const list = (FS, dir) => FS.readdir(dir).filter((n) => n !== "." && n !== "..");

// `from` onto `to`, another spelling of its name: folders become one, a file takes `from`'s data (it came later).
function mergeInto(FS, from, to, removeTree) {
  if (isFolder(FS, from) && isFolder(FS, to)) {
    const have = new Map(list(FS, to).map((n) => [nfd(n), n]));
    for (const n of list(FS, from)) {
      const at = have.get(nfd(n));
      if (at === undefined) {
        FS.rename(`${from}/${n}`, `${to}/${n}`);
        have.set(nfd(n), n);
      } else mergeInto(FS, `${from}/${n}`, `${to}/${at}`, removeTree);
    }
    FS.rmdir(from);
  } else if (isFolder(FS, from) || isFolder(FS, to)) removeTree(FS, from);
  else {
    FS.unlink(to);
    FS.rename(from, to);
  }
}

export function prepareSeal(FS, payload, { readPlist, removeTree }) {
  const spelled = []; // bundles whose executable has a non-ASCII name: { parts (the folder's, under payload), exe }
  const walk = (dir, parts) => {
    const first = new Map();
    for (const n of list(FS, dir)) {
      const key = nfd(n), one = first.get(key);
      if (one === undefined) first.set(key, n);
      else mergeInto(FS, `${dir}/${n}`, `${dir}/${one}`, removeTree);
    }
    const bundle = parts.at(-1) ?? "";
    if (SIGNED.test(bundle) || bundle.endsWith(".bundle")) removeTree(FS, `${dir}/_CodeSignature`);
    if (SIGNED.test(bundle)) {
      let plist = null;
      try { plist = readPlist(`${dir}/Info.plist`); } catch { /* no bundle */ }
      const exe = typeof plist?.CFBundleExecutable === "string" ? plist.CFBundleExecutable : "";
      if (plist?.CFBundleIdentifier && exe && (!ascii(exe) || exists(FS, `${dir}/${exe}`))) {
        for (const n of ["CodeResources", "_MASReceipt"]) removeTree(FS, `${dir}/${n}`);
        if (!ascii(exe)) spelled.push({ parts, exe });
      }
    }
    for (const n of list(FS, dir)) {
      const at = `${dir}/${n}`;
      if (isFolder(FS, at)) walk(at, [...parts, n]);
      else if (n.endsWith(".DS_Store") && n !== ".DS_Store") FS.unlink(at);
    }
  };
  if (!isFolder(FS, payload)) return;
  walk(payload, []);
  for (const { parts, exe } of spelled) decomposeExecutable(FS, payload, parts, exe);
}

// iOS looks for an executable by its decomposed path and takes any other for an added file. zsign finds it by the
// Info.plist's spelling, so that changes too.
function decomposeExecutable(FS, payload, parts, exe) {
  const path = [...parts, ...exe.split("/").filter((p) => p && p !== ".")].map(nfd);
  if (path.includes("..")) return;
  const now = []; // the path as the folders spell it
  for (const p of path) {
    const n = isFolder(FS, [payload, ...now].join("/")) ? list(FS, [payload, ...now].join("/")).find((x) => nfd(x) === p) : undefined;
    if (n === undefined) return; // no executable: zsign says so, or seals the folder as files
    now.push(n);
  }
  const info = `${[payload, ...now.slice(0, parts.length)].join("/")}/Info.plist`;
  if (exe !== nfd(exe)) {
    const changed = withExecutable(FS.readFile(info), nfd(exe));
    if (!changed) return; // zsign needs the two to agree
    FS.writeFile(info, changed);
  }
  let at = payload;
  now.forEach((n, i) => {
    if (n !== path[i]) FS.rename(`${at}/${n}`, `${at}/${path[i]}`);
    at += `/${path[i]}`;
  });
}

// An Info.plist (XML or binary) whose CFBundleExecutable is `exe`, another spelling of the one it has. null when it can't be changed.
export function withExecutable(bytes, exe) {
  try {
    return String.fromCharCode(...bytes.subarray(0, 8)) === "bplist00" ? binaryExecutable(bytes, exe) : xmlExecutable(bytes, exe);
  } catch { return null; }
}

function xmlExecutable(bytes, exe) {
  const xml = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  const esc = exe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const out = xml.replace(/(<key>CFBundleExecutable<\/key>\s*)(<string>[^<]*<\/string>)/g,
    (all, key, value) => (nfd(parsePlist(`<plist>${value}</plist>`)) === nfd(exe) ? `${key}<string>${esc}</string>` : all));
  return parsePlist(out).CFBundleExecutable === exe ? new TextEncoder().encode(out) : null;
}

// The new string goes in after the objects, where the offset table was, as an object of its own: equal strings share one
// object, and CFBundleName is often the same. Only a plist with no reference left for it changes the shared one.
function binaryExecutable(b, exe) {
  const uint = (at, n) => { let x = 0; for (let i = 0; i < n; i++) x = x * 256 + b[at + i]; return x; };
  const t = b.length - 32, size = b[t + 6], refSize = b[t + 7];
  const count = uint(t + 8, 8), top = uint(t + 16, 8), table = uint(t + 24, 8);
  const offset = (ref) => uint(table + ref * size, size);
  const start = (at) => { // [how many, where they start]
    const low = b[at] & 0xf;
    if (low !== 0xf) return [low, at + 1];
    const w = 1 << (b[at + 1] & 0xf);
    return [uint(at + 2, w), at + 2 + w];
  };
  if (table + count * size > t || b[offset(top)] >> 4 !== 0xd) return null;
  const [pairs, refs] = start(offset(top));
  let value = -1, valueAt = -1;
  for (let i = 0; i < pairs && value < 0; i++) {
    const at = offset(uint(refs + i * refSize, refSize));
    if (b[at] >> 4 !== 5) continue;
    const [n, from] = start(at);
    if (new TextDecoder().decode(b.subarray(from, from + n)) === "CFBundleExecutable") {
      valueAt = refs + (pairs + i) * refSize;
      value = uint(valueAt, refSize);
    }
  }
  if (value < 0) return null;
  const be = (x, n) => Array.from({ length: n }, (_, i) => Math.floor(x / 256 ** (n - 1 - i)) % 256);
  const units = Array.from({ length: exe.length }, (_, i) => exe.charCodeAt(i));
  const object = [...(units.length < 15 ? [0x60 | units.length] : [0x6f, 0x11, ...be(units.length, 2)]), ...units.flatMap((u) => be(u, 2))];
  const own = count < 256 ** refSize, newCount = own ? count + 1 : count;
  const newTable = table + object.length;
  const newSize = Math.max(size, table < 0x10000 ? 2 : 4);
  const out = new Uint8Array(newTable + newCount * newSize + 32);
  out.set(b.subarray(0, table));
  out.set(object, table);
  if (own) out.set(be(count, refSize), valueAt);
  for (let i = 0; i < newCount; i++) out.set(be(i === (own ? count : value) ? table : offset(i), newSize), newTable + i * newSize);
  const end = out.length - 32;
  out.set(b.subarray(t), end);
  out[end + 6] = newSize;
  out.set(be(newCount, 8), end + 8);
  out.set(be(newTable, 8), end + 24);
  return out;
}
