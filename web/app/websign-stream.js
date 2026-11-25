// F265: the app the website signs, never unpacked as a whole: zsign sees the files of the IPA in emscripten's in-memory
// file system, but each stays compressed in the IPA's own bytes and is inflated as it's read; what is written there
// (a signed executable, a seal, a tweak) is deflated as it comes. The signed IPA is then put together from those:
// a file nothing changed keeps its compressed bytes, as a view of the IPA that came. So a sign holds the IPA, the
// biggest executable (zsign signs it in one piece) and what it changed, not the unpacked app and a second copy.
//
//   ipaStream(zs, root = "/w/app") -> {
//     sha256(bytes) -> hex            hashed in pieces
//     open(bytes)                     the IPA's files under root; throws Error when it isn't a zip it can read
//     reserve()                       zsign's memory for the biggest executable, before it runs; RangeError: not enough
//     pack() -> [Uint8Array]          the signed IPA, in pieces (core/pieces.js)
//     damaged                         true once a file's data didn't inflate (the read then failed)
//   }
//   A module that carries its own `ipaStream` (the tests' fakes) is asked for that one instead.
//
// The same rules as zsign's own unzip and zip: an unsafe path is left out, a later entry of a name wins, names carry
// no flag, files no mode.
// SPDX-License-Identifier: GPL-3.0-or-later
import { slices, isMachO } from "./core/tweaks.js";

const BUF = 64 * 1024;
const EIO = 29; // emscripten's errno
const IN = 0, OUT = 1, DEF_IN = 2, DEF_OUT = 3; // zsign-wasm/ifizbox.cpp ifizbox_buffer
const END = new Uint8Array([3, 0]); // an empty last block: what the deflater wrote ends on a whole byte, unfinished
const bad = () => new Error("That IPA couldn't be unpacked.");

// ---- zip ---------------------------------------------------------------------------------------------------------

// The central directory: [{ name, method, size, crc, data: the compressed bytes (a view of the file) }].
export function zipEntries(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u64 = (at) => Number(dv.getBigUint64(at, true));
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff) && end < 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) end = i;
  }
  if (end < 0) throw bad();
  let count = dv.getUint16(end + 10, true), size = dv.getUint32(end + 12, true), start = dv.getUint32(end + 16, true);
  let tail = end;
  if (end >= 20 && dv.getUint32(end - 20, true) === 0x07064b50) {
    let z = u64(end - 12);
    if (z + 56 > b.length || dv.getUint32(z, true) !== 0x06064b50) z = end - 76; // something was put in front of the zip
    if (z >= 0 && dv.getUint32(z, true) === 0x06064b50) {
      count = u64(z + 32); size = u64(z + 40); start = u64(z + 48);
      tail = z;
    }
  }
  const shift = tail - size - start; // bytes in front of the zip
  if (!(shift >= 0)) throw bad();
  const out = [];
  let p = start + shift;
  for (let i = 0; i < count; i++) {
    if (p + 46 > b.length || dv.getUint32(p, true) !== 0x02014b50) throw bad();
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true);
    let csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true), at = dv.getUint32(p + 42, true);
    const extraEnd = p + 46 + nameLen + extraLen;
    if (extraEnd > b.length) throw bad();
    for (let x = p + 46 + nameLen; x + 4 <= extraEnd;) {
      const id = dv.getUint16(x, true), len = dv.getUint16(x + 2, true);
      if (id === 1) {
        let q = x + 4;
        const next = () => { if (q + 8 > Math.min(x + 4 + len, extraEnd)) throw bad(); q += 8; return u64(q - 8); };
        if (usize === 0xffffffff) usize = next();
        if (csize === 0xffffffff) csize = next();
        if (at === 0xffffffff) at = next();
      }
      x += 4 + len;
    }
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));
    const e = { name, method: dv.getUint16(p + 10, true), flags: dv.getUint16(p + 8, true), crc: dv.getUint32(p + 16, true), size: usize, data: null };
    at += shift;
    if (at + 30 > b.length || dv.getUint32(at, true) !== 0x04034b50) throw bad();
    const from = at + 30 + dv.getUint16(at + 26, true) + dv.getUint16(at + 28, true);
    if (from + csize > b.length) throw bad();
    e.data = b.subarray(from, from + csize);
    out.push(e);
    p = extraEnd + dv.getUint16(p + 32, true);
  }
  return out;
}

// zsign's own rule (archive.cpp _IsPathSafe)
const safePath = (p) => !/^[\\/]/.test(p) && !p.includes(":") && !p.split(/[\\/]/).includes("..");

// files: [{ name, method, crc, size, chunks }] ({ dir: true } a folder, its name with a / at the end) -> pieces.
export function zipPieces(files, when = new Date()) {
  const enc = new TextEncoder();
  const time = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
  const date = ((Math.max(1980, when.getFullYear()) - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  const list = files.map((f) => ({ ...f, bytes: enc.encode(f.name), csize: (f.chunks ?? []).reduce((n, c) => n + c.length, 0) }));
  const names = list.reduce((n, f) => n + f.bytes.length, 0);
  const heads = new Uint8Array(list.length * 30 + names), hv = new DataView(heads.buffer);
  const dir = new Uint8Array(list.length * 46 + names + 98), cv = new DataView(dir.buffer);
  const out = [];
  let h = 0, c = 0, at = 0;
  for (const f of list) {
    if (f.csize >= 0xffffffff || f.size >= 0xffffffff || at >= 0xffffffff) throw new RangeError("The signed app is over 4 GB.");
    const common = (dv, p) => {
      dv.setUint16(p, 20, true); dv.setUint16(p + 4, f.method ?? 0, true);
      dv.setUint16(p + 6, time, true); dv.setUint16(p + 8, date, true); dv.setUint32(p + 10, f.crc ?? 0, true);
      dv.setUint32(p + 14, f.csize, true); dv.setUint32(p + 18, f.size ?? 0, true); dv.setUint16(p + 22, f.bytes.length, true);
    };
    hv.setUint32(h, 0x04034b50, true);
    common(hv, h + 4);
    heads.set(f.bytes, h + 30);
    out.push(heads.subarray(h, h + 30 + f.bytes.length), ...(f.chunks ?? []));
    cv.setUint32(c, 0x02014b50, true);
    common(cv, c + 6);
    cv.setUint32(c + 42, at, true);
    dir.set(f.bytes, c + 46);
    h += 30 + f.bytes.length;
    c += 46 + f.bytes.length;
    at += 30 + f.bytes.length + f.csize;
  }
  if (at >= 0xffffffff) throw new RangeError("The signed app is over 4 GB.");
  const size = c;
  if (list.length >= 0xffff) { // zip64: more entries than the old record counts
    cv.setUint32(c, 0x06064b50, true); cv.setBigUint64(c + 4, 44n, true);
    cv.setUint16(c + 12, 45, true); cv.setUint16(c + 14, 45, true);
    cv.setBigUint64(c + 24, BigInt(list.length), true); cv.setBigUint64(c + 32, BigInt(list.length), true);
    cv.setBigUint64(c + 40, BigInt(size), true); cv.setBigUint64(c + 48, BigInt(at), true);
    cv.setUint32(c + 56, 0x07064b50, true); cv.setBigUint64(c + 64, BigInt(at + size), true); cv.setUint32(c + 72, 1, true);
    c += 76;
  }
  cv.setUint32(c, 0x06054b50, true);
  cv.setUint16(c + 8, Math.min(list.length, 0xffff), true); cv.setUint16(c + 10, Math.min(list.length, 0xffff), true);
  cv.setUint32(c + 12, size, true); cv.setUint32(c + 16, at, true);
  out.push(dir.subarray(0, c + 22));
  return out;
}

// ---- the file system -----------------------------------------------------------------------------------------------

export function ipaStream(zs, root = "/w/app") {
  if (zs.ipaStream) return zs.ipaStream;
  const { FS } = zs;
  const at = [IN, OUT, DEF_IN, DEF_OUT].map((n) => zs._ifizbox_buffer(n));
  const put = (which, bytes) => zs.HEAPU8.set(bytes, at[which]);
  const view = (which, n) => zs.HEAPU8.subarray(at[which], at[which] + n);
  const state = { damaged: false };

  // A file's `packed`: { method, chunks, csize, size, crc, whole }, its data deflated (8) or as it is (0), in chunks.
  // whole: the data ends where the zip's entry does (else END is still to come).

  // -- reading: one inflater, at one place in one file
  let reader = null; // { p: packed, pos, chunk, off (in chunk), crc }
  const damaged = () => { state.damaged = true; reader = null; return new FS.ErrnoError(EIO); };
  const startReader = (p) => {
    if (p.method === 8 && zs._ifizbox_inflate_start() !== 0) throw damaged();
    reader = { p, pos: 0, chunk: 0, off: 0, crc: 0 };
  };
  // The next bytes (up to `want`) into the OUT buffer; how many.
  const step = (want) => {
    const r = reader, p = r.p, ask = Math.min(want, BUF, p.size - r.pos);
    const nextInput = () => {
      while (r.chunk < p.chunks.length && r.off >= p.chunks[r.chunk].length) { r.chunk++; r.off = 0; }
      if (r.chunk >= p.chunks.length) return null;
      const part = p.chunks[r.chunk].subarray(r.off, r.off + (p.method === 8 ? BUF : ask));
      r.off += part.length;
      return part;
    };
    let got = 0;
    if (p.method !== 8) {
      const part = nextInput();
      if (!part) throw damaged();
      put(OUT, part);
      got = part.length;
    } else {
      while (got === 0) {
        let len = 0;
        if (zs._ifizbox_inflate_left() === 0) {
          const part = nextInput();
          if (part) { put(IN, part); len = part.length; }
          else {
            // nothing more comes in: what the inflater still holds, or the data ends before the file does
            got = zs._ifizbox_inflate(0, ask);
            if (got <= 0) throw damaged();
            break;
          }
        }
        got = zs._ifizbox_inflate(len, ask);
        if (got < 0) throw damaged();
      }
    }
    r.crc = zs._ifizbox_crc(r.crc, OUT, got) >>> 0;
    r.pos += got;
    // read to its end: the checksum the signed IPA carries is this data's own (a wrong one in the IPA was never an error)
    if (r.pos === p.size) p.crc = r.crc;
    return got;
  };
  const readAt = (p, buffer, offset, length, position) => {
    suspend(p);
    if (position >= p.size) return 0;
    const total = Math.min(length, p.size - position);
    if (reader?.p !== p || reader.pos > position) startReader(p);
    while (reader.pos < position) step(position - reader.pos);
    for (let n = 0; n < total;) {
      const got = step(total - n);
      buffer.set(view(OUT, got), offset + n);
      n += got;
    }
    return total;
  };

  // -- writing: one deflater, at the end of one file; another file's turn ends the first one's on a whole byte, where
  // it can go on later
  let writing = null;
  const drain = (p, len, flush) => {
    for (let n = zs._ifizbox_deflate(len, flush); ; n = zs._ifizbox_deflate(0, flush)) {
      if (n < 0) throw new FS.ErrnoError(EIO);
      if (n > 0) { p.chunks.push(view(DEF_OUT, n).slice()); p.csize += n; }
      if (n < BUF) return;
    }
  };
  function suspend(p) {
    if (writing !== p) return;
    drain(p, 0, 1);
    writing = null;
  }
  const newPacked = () => ({ method: 8, chunks: [], csize: 0, size: 0, crc: 0, whole: false });
  const append = (p, bytes) => {
    if (reader?.p === p) reader = null;
    if (writing !== p) {
      if (writing) suspend(writing);
      if (zs._ifizbox_deflate_start() !== 0) throw new FS.ErrnoError(EIO);
      writing = p;
    }
    for (let i = 0; i < bytes.length; i += BUF) {
      const part = bytes.subarray(i, i + BUF);
      put(DEF_IN, part);
      p.crc = zs._ifizbox_crc(p.crc, DEF_IN, part.length) >>> 0;
      drain(p, part.length, 0);
      p.size += part.length;
    }
  };

  // -- nodes: emscripten's own (MEMFS) with their data packed; one written anywhere but at its end turns into a plain one
  let fileOps = null, dirOps = null, streamOps = null;
  const setPacked = (node, p) => {
    if (writing && writing === node.packed) writing = null;
    if (reader?.p === node.packed) reader = null;
    node.packed = p;
    node.usedBytes = p.size;
    node.contents = new Uint8Array(0);
  };
  const plain = (node) => {
    const p = node.packed, data = new Uint8Array(p.size);
    readAt(p, data, 0, data.length, 0);
    setPacked(node, newPacked());
    node.packed = null;
    node.contents = data;
    node.usedBytes = data.length;
  };
  const adopt = (node) => {
    if (FS.isDir(node.mode)) {
      dirOps ??= { ...node.node_ops, mknod: (...a) => adopt(dirOps.base(...a)), base: node.node_ops.mknod };
      node.node_ops = dirOps;
    } else if (FS.isFile(node.mode)) {
      const ops = node.node_ops, sops = node.stream_ops;
      fileOps ??= { ...ops, setattr: (n, attr) => {
        if (attr.size === undefined || !n.packed) { ops.setattr(n, attr); if (attr.size === 0) setPacked(n, newPacked()); return; }
        const { size, ...rest } = attr;
        ops.setattr(n, rest);
        if (size === 0) setPacked(n, newPacked());
        else if (size !== n.packed.size) { plain(n); ops.setattr(n, { size }); }
      } };
      streamOps ??= { ...sops,
        read: (s, buffer, offset, length, position) => (s.node.packed ? readAt(s.node.packed, buffer, offset, length, position)
          : sops.read(s, buffer, offset, length, position)),
        write: (s, buffer, offset, length, position, canOwn) => {
          const n = s.node, p = n.packed;
          if (!length) return 0;
          if (p && !p.whole && position === p.size) {
            append(p, buffer.subarray(offset, offset + length));
            n.usedBytes = p.size;
            n.mtime = n.ctime = Date.now();
            return length;
          }
          if (p) plain(n);
          return sops.write(s, buffer, offset, length, position, canOwn);
        },
        mmap: (s, ...a) => { if (s.node.packed) plain(s.node); return sops.mmap(s, ...a); } };
      node.node_ops = fileOps;
      node.stream_ops = streamOps;
      setPacked(node, newPacked());
    }
    return node;
  };

  const made = new Set();
  const mkdirs = (dir) => {
    if (made.has(dir)) return;
    let path = "";
    for (const part of dir.split("/").filter(Boolean)) {
      path += `/${part}`;
      if (made.has(path)) continue;
      try { FS.mkdir(path); } catch { if (!FS.isDir(FS.stat(path).mode)) throw bad(); }
      made.add(path);
    }
    made.add(dir);
  };
  const children = (dir) => FS.readdir(dir).filter((n) => n !== "." && n !== "..");
  const walk = (dir, seen) => {
    for (const n of children(dir)) {
      const path = `${dir}/${n}`, { node } = FS.lookupPath(path);
      const folder = FS.isDir(node.mode);
      seen(path, node, folder);
      if (folder) walk(path, seen);
    }
  };

  return Object.assign(state, {
    sha256(bytes) {
      zs._ifizbox_sha256_start();
      for (let i = 0; i < bytes.length; i += BUF) {
        const part = bytes.subarray(i, i + BUF);
        put(IN, part);
        zs._ifizbox_sha256_add(part.length);
      }
      const d = zs._ifizbox_sha256_end();
      reader = null; // its buffer was used
      return Array.from(zs.HEAPU8.subarray(d, d + 32), (x) => x.toString(16).padStart(2, "0")).join("");
    },
    open(bytes) {
      mkdirs(root);
      adopt(FS.lookupPath(root).node);
      for (const e of zipEntries(bytes)) {
        let name = e.name.split("\0")[0].replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
        const folder = name.endsWith("/");
        if (folder) name = name.slice(0, -1);
        if (!name || !safePath(name)) continue;
        try {
          if (folder) { mkdirs(`${root}/${name}`); continue; }
          if ((e.method !== 0 && e.method !== 8) || e.flags & 1) throw bad();
          const path = `${root}/${name}`;
          mkdirs(path.slice(0, path.lastIndexOf("/")));
          FS.writeFile(path, "");
          const size = e.method === 0 ? e.data.length : e.size;
          setPacked(FS.lookupPath(path).node, { method: e.method, chunks: [e.data], csize: e.data.length, size, crc: e.crc, whole: true });
        } catch (x) { throw x instanceof FS.ErrnoError ? bad() : x; } // a file where a folder is, a name too long
      }
    },
    reserve() {
      let most = 0;
      const head = new Uint8Array(8);
      walk(root, (path, node, folder) => {
        if (folder || node.usedBytes <= most || node.usedBytes < 8) return;
        const s = FS.open(path, "r");
        try { if (FS.read(s, head, 0, 8, 0) === 8 && isMachO(head)) most = node.usedBytes; } catch { /* zsign meets it too */ } finally { FS.close(s); }
      });
      // and what it grows by when its signature needs more room (ZArchO::ReallocCodeSignSpace: 52 bytes a 4 KB page)
      if (most && zs._ifizbox_reserve(most + Math.ceil(most / 64) + 256 * 1024) !== 1) throw new RangeError("Out of memory");
    },
    pack() {
      const files = [];
      walk(root, (path, node, folder) => {
        const name = path.slice(root.length + 1);
        if (folder) { files.push({ name: `${name}/`, size: 0 }); return; }
        let p = node.packed;
        if (!p) {
          p = newPacked();
          append(p, node.contents.subarray(0, node.usedBytes));
        }
        suspend(p);
        files.push({ name, method: p.method, crc: p.crc, size: p.size, chunks: p.whole ? p.chunks : [...p.chunks, END] });
      });
      return zipPieces(files);
    },
  });
}

// ---- an executable's load commands -----------------------------------------------------------------------------------

// The file at `path` with its first bytes changed by edit(head) -> head (same length), the rest copied in pieces. Only
// for a Mach-O of one slice: `head` is its load commands and the room after them. A file of several is edited whole.
export function editHead(FS, path, edit) {
  const size = FS.stat(path).size;
  const s = FS.open(path, "r");
  let head;
  const read = (pos, len) => {
    const b = new Uint8Array(Math.max(0, Math.min(len, size - pos)));
    for (let n = 0; n < b.length;) {
      const got = FS.read(s, b, n, b.length - n, pos + n);
      if (got <= 0) throw new Error(`${path} ended early`);
      n += got;
    }
    return b;
  };
  const tmp = `${path}.ifizbox-edit`;
  try {
    head = read(0, 4096);
    if (head.length >= 32 && isMachO(head) && slices(head).length === 1 && slices(head)[0][0] === 0 && new DataView(head.buffer).getUint32(0, true) >>> 8 === 0xfeedfa) {
      head = read(0, Math.max(1 << 20, 32 + new DataView(head.buffer).getUint32(20, true) + 65536));
    } else head = read(0, size);
    const next = edit(head);
    if (next === head) return;
    const out = FS.open(tmp, "w");
    try {
      const write = (b) => { if (b.length) FS.write(out, b, 0, b.length); };
      write(next);
      for (let rest = head.length; rest < size; rest += 1 << 20) write(read(rest, 1 << 20));
    } catch (e) { try { FS.unlink(tmp); } catch { /* not there */ } throw e; } finally { FS.close(out); }
  } finally { FS.close(s); }
  FS.unlink(path);
  FS.rename(tmp, path);
}
