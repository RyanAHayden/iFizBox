// F265: for tests of the website's sign job: the ipaStream (websign-stream.js) a fake zsign carries, and one that wraps
// the real one.
import { createHash } from "node:crypto";
import { ipaStream } from "./websign-stream.js";

// open(bytes) throws when `unzip` isn't 0; pack() answers the smallest signed IPA.
export const fakeStream = ({ open = () => {}, unzip = 0 } = {}) => ({
  sha256: (b) => createHash("sha256").update(b).digest("hex"),
  open: (b) => { open(b); if (unzip) throw new Error("no"); },
  reserve() {},
  pack: () => [new Uint8Array([0x50, 0x4b]), new Uint8Array([9, 9])],
  damaged: false,
});

// The real module with `after()` run once the IPA's files are there.
export function afterOpen(zs, after) {
  const stream = ipaStream(zs, "/w/app"), { open } = stream;
  stream.open = (b) => { open(b); after(); };
  zs.ipaStream = stream;
}

// The calls editHead makes, on a Map of path -> bytes.
export const fileCalls = (files) => {
  const get = (p) => { if (!files.has(p)) throw new Error("ENOENT"); return files.get(p); };
  return {
    stat: (p) => ({ size: get(p).length }),
    open: (p, mode) => { if (mode === "w") files.set(p, new Uint8Array(0)); return { path: p, data: get(p) }; },
    close() {},
    read: (s, buf, o, len, pos) => { const part = s.data.subarray(pos, pos + len); buf.set(part, o); return part.length; },
    write: (s, buf, o, len) => {
      s.data = new Uint8Array(Buffer.concat([s.data, buf.subarray(o, o + len)]));
      files.set(s.path, s.data);
      return len;
    },
    unlink: (p) => { files.delete(p); },
    rename: (a, b) => { files.set(b, get(a)); files.delete(a); },
  };
};
