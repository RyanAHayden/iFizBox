// F265: the website's signer never holds the unpacked app (websign-stream.js): the zip it reads and writes, emscripten's
// files kept compressed, and a sign of a big app on the real zsign WebAssembly within a bound.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { deflateRawSync, crc32 } from "node:zlib";
import { ipaStream, zipEntries, zipPieces, editHead } from "./websign-stream.js";
import { runSignJob } from "./websign-job.js";
import { joinPieces } from "./core/pieces.js";
import { readZip } from "./core/unpack.js";

const WASM = new URL("./vendor/zsign/zsign.js", import.meta.url);
const skip = !existsSync(WASM) && "no vendor/zsign";
const fx = (n) => new Uint8Array(readFileSync(new URL(`./core/fixtures/signing/${n}`, import.meta.url)));
const bytes = (s) => new TextEncoder().encode(s);
const stored = (name, data) => ({ name, method: 0, size: data.length, crc: crc32(data), chunks: [data] });
const packed = (name, data) => ({ name, method: 8, size: data.length, crc: crc32(data), chunks: [new Uint8Array(deflateRawSync(data))] });
const zipOf = (...files) => joinPieces(zipPieces(files));
const noise = (n, seed = 1) => { let x = seed; return Uint8Array.from({ length: n }, () => (x = (x * 1103515245 + 12345) >>> 0) >>> 24); };
const real = async () => (await import(WASM)).default({ print() {}, printErr() {} });
async function opened(zip) {
  const zs = await real();
  const s = ipaStream(zs, "/w/app");
  zs.FS.mkdir("/w");
  s.open(zip);
  return { zs, s, FS: zs.FS };
}

test("the zip it writes reads back: names, stored and deflated files, folders", () => {
  const z = zipOf({ name: "a/", size: 0 }, stored("a/é.txt", bytes("hello")), packed("a/b", new Uint8Array(5000)));
  const e = zipEntries(z);
  assert.deepEqual(e.map((x) => [x.name, x.method, x.size]), [["a/", 0, 0], ["a/é.txt", 0, 5], ["a/b", 8, 5000]]);
  assert.deepEqual(readZip(z).find((x) => x.path === "a/é.txt").data, bytes("hello"));
  // bytes in front of the zip, and a comment after it
  const c = new Uint8Array([...bytes("front"), ...z, ...bytes("say")]);
  c[c.length - 5] = 3;
  assert.deepEqual(zipEntries(c)[1].data, bytes("hello"));
  assert.throws(() => zipEntries(z.subarray(0, z.length - 30)));
  assert.throws(() => zipEntries(new Uint8Array(10)));
});

test("more entries than a zip's old record counts", () => {
  const files = Array.from({ length: 70000 }, (_, i) => ({ name: `${i}/`, size: 0 }));
  const e = zipEntries(zipOf(...files));
  assert.equal(e.length, 70000);
  assert.equal(e.at(-1).name, "69999/");
});

test("files are read where they are asked for, forward and back", { skip }, async () => {
  const a = noise(300000), b = noise(200000, 7);
  const { FS, s } = await opened(zipOf(packed("a", a), stored("b", b), packed("none", new Uint8Array(0))));
  assert.equal(FS.stat("/w/app/a").size, a.length);
  assert.deepEqual(FS.readFile("/w/app/a"), a);
  assert.deepEqual(FS.readFile("/w/app/b"), b);
  assert.equal(FS.readFile("/w/app/none").length, 0);
  const sa = FS.open("/w/app/a", "r"), sb = FS.open("/w/app/b", "r"), got = new Uint8Array(100);
  for (const pos of [250000, 10, 10, 299990]) {
    const n = FS.read(sa, got, 0, 100, pos);
    assert.deepEqual(got.subarray(0, n), a.subarray(pos, pos + 100), `a ${pos}`);
    FS.read(sb, got, 0, 100, pos % 1000);
    assert.deepEqual(got, b.subarray(pos % 1000, pos % 1000 + 100), `b ${pos}`);
  }
  assert.equal(s.damaged, false);
});

test("written files: at the end in turns, over themselves, in the middle, renamed, removed", { skip }, async () => {
  const a = noise(100000);
  const { FS, s } = await opened(zipOf(packed("d/keep", a), packed("d/old", a), packed("d/gone", a)));
  const x = FS.open("/w/app/d/x", "w"), y = FS.open("/w/app/d/y", "w");
  for (let i = 0; i < 3; i++) { FS.write(x, a, 0, a.length); FS.write(y, a, 0, 10); assert.equal(FS.stat("/w/app/d/x").size, a.length * (i + 1)); }
  FS.write(x, bytes("MID"), 0, 3, 50);
  FS.close(x); FS.close(y);
  FS.writeFile("/w/app/d/old", "new");
  FS.unlink("/w/app/d/gone");
  FS.mkdir("/w/app/d/sub");
  FS.rename("/w/app/d/y", "/w/app/d/sub/y2");
  const want = new Uint8Array([...a, ...a, ...a]);
  want.set(bytes("MID"), 50);
  assert.deepEqual(FS.readFile("/w/app/d/x"), want);
  const before = FS.readFile("/w/app/d/sub/y2");
  const z = joinPieces(s.pack());
  const out = Object.fromEntries(readZip(z).filter((e) => !e.dir).map((e) => [e.path, e.data]));
  assert.deepEqual(Object.keys(out).sort(), ["d/keep", "d/old", "d/sub/y2", "d/x"]);
  assert.deepEqual(out["d/keep"], a);
  assert.deepEqual(out["d/x"], want);
  assert.deepEqual(out["d/old"], bytes("new"));
  assert.deepEqual(out["d/sub/y2"], before);
  assert.deepEqual([...before], [...a.subarray(0, 10), ...a.subarray(0, 10), ...a.subarray(0, 10)]);
  for (const e of zipEntries(z)) if (e.size) assert.equal(e.crc, crc32(out[e.name]), e.name);
});

test("an untouched file keeps its compressed bytes: a view of the IPA, not a copy; a wrong checksum is put right", { skip }, async () => {
  const a = noise(50000);
  const zip = zipOf({ ...packed("p/a", a), crc: 1 });
  const { FS, s } = await opened(zip);
  FS.readFile("/w/app/p/a");
  const pieces = s.pack();
  assert.ok(pieces.some((p) => p.buffer === zip.buffer && p.length > 1000));
  assert.equal(zipEntries(joinPieces(pieces)).at(-1).crc, crc32(a));
});

test("a path out of the app is left out, a later entry of a name wins; encrypted, unknown and broken ones are refused", { skip }, async () => {
  const { FS } = await opened(zipOf(stored("../evil", bytes("1")), stored("/root", bytes("1")), stored("c:x", bytes("1")),
    stored("p/a", bytes("1")), packed("p/a", bytes("22"))));
  assert.deepEqual(FS.readdir("/w/app").filter((n) => n[0] !== "."), ["p"]);
  assert.deepEqual(FS.readFile("/w/app/p/a"), bytes("22"));
  await assert.rejects(opened(zipOf({ ...stored("a", bytes("1")), method: 12 })));
  await assert.rejects(opened(zipOf(stored("a", bytes("1")), stored("a/b", bytes("1")))), "a file where a folder is");
  const locked = zipOf(stored("a", bytes("1")));
  locked[locked.length - 22 - 47 + 8] |= 1; // the directory entry's flags
  await assert.rejects(opened(locked));
  const long = await opened(zipOf({ ...packed("a", noise(5000)), size: 4000 }));
  assert.throws(() => long.FS.readFile("/w/app/a"));
  const short = await opened(zipOf({ ...packed("a", noise(5000)), size: 9000 }));
  assert.throws(() => short.FS.readFile("/w/app/a"));
  assert.equal(short.s.damaged, true);
});

test("the IPA's SHA-256, in pieces", { skip }, async () => {
  const b = noise(200001);
  const { s } = await opened(zipOf(stored("a", b)));
  assert.equal(s.sha256(b), createHash("sha256").update(b).digest("hex"));
});

// A tiny app (tiny-ifizbox.ipa's) with more files.
const tiny = () => readZip(fx("tiny-ifizbox.ipa")).filter((e) => !e.dir);
const job = (ipa) => ({ ipa, p12: fx("test.p12"), profile: fx("test.mobileprovision"), password: "hunter2" });

test("zsign WebAssembly signs an app whose files are many times its memory", { skip }, async () => {
  // 3 x 64 MB of zeros (64 KB each in the IPA): unpacked, they'd be 192 MB of files and 64 MB of zsign's memory
  const zeros = new Uint8Array(64 << 20), small = new Uint8Array(deflateRawSync(zeros)), crc = crc32(zeros);
  const ipa = zipOf(...tiny().map((e) => packed(e.path, e.data)),
    ...[1, 2, 3].map((i) => ({ name: `Payload/Tiny.app/z${i}`, method: 8, size: zeros.length, crc, chunks: [small] })));
  let zs = null, loose = 0;
  const create = async (o) => {
    zs = await (await import(WASM)).default(o);
    const main = zs.callMain;
    zs.callMain = (args) => {
      try { return main(args); } finally {
        for (const n of zs.FS.readdir("/w/app/Payload/Tiny.app")) loose += zs.FS.lookupPath(`/w/app/Payload/Tiny.app/${n}`).node.contents?.length ?? 0;
      }
    };
    return zs;
  };
  const r = await runSignJob(create, job(ipa));
  assert.ok(zs.HEAPU8.length < 32 << 20, `zsign's memory: ${zs.HEAPU8.length}`);
  assert.equal(loose, 0, "no file is held unpacked");
  const out = zipEntries(joinPieces(r.ipa));
  assert.deepEqual(out.find((e) => e.name.endsWith("/z2")).data, small);
  const seal = new TextDecoder().decode(readZip(joinPieces([...zipPieces(out.filter((e) => e.name.endsWith("/CodeResources"))
    .map((e) => ({ ...e, chunks: [e.data] })))])).at(-1).data);
  assert.ok(seal.includes(createHash("sha256").update(zeros).digest("base64")), "sealed by its unpacked bytes");
});

test("zsign WebAssembly: a file that doesn't inflate is an IPA that couldn't be unpacked, not an unsigned app", { skip }, async (t) => {
  const code = process.exitCode;
  t.after(() => { process.exitCode = code; });
  const ipa = zipOf(...tiny().map((e) => packed(e.path, e.data)), { ...packed("Payload/Tiny.app/data", noise(9000)), size: 12000 });
  await assert.rejects(runSignJob((await import(WASM)).default, job(ipa)), (e) => e.code === "bad_ipa" && /couldn't be unpacked/.test(e.message));
});

test("zsign's memory for the biggest executable is asked for first; none is Out of memory", { skip }, async () => {
  const create = async (o) => { const zs = await (await import(WASM)).default(o); zs._ifizbox_reserve = () => 0; return zs; };
  await assert.rejects(runSignJob(create, job(fx("tiny-ifizbox.ipa"))), (e) => e.code === "sign_failed" && /zsign stopped: Out of memory\./.test(e.message));
});

test("editHead: the head changes, the rest follows; nothing changed leaves the file", { skip }, async () => {
  const exe = tiny().find((e) => e.path.endsWith("/Tiny")).data;
  const big = new Uint8Array(exe.length + (3 << 20)).fill(7);
  big.set(exe);
  const { FS } = await opened(zipOf(packed("x", big), packed("t", bytes("not one"))));
  let len = 0;
  editHead(FS, "/w/app/x", (h) => { len = h.length; const c = h.slice(); c[40] ^= 255; return c; });
  assert.equal(len, 1 << 20, "not the whole file");
  const want = big.slice();
  want[40] ^= 255;
  assert.ok(Buffer.from(FS.readFile("/w/app/x")).equals(Buffer.from(want)));
  editHead(FS, "/w/app/x", (h) => h);
  assert.throws(() => editHead(FS, "/w/app/t", () => { throw new Error("no"); }), /no/);
  assert.deepEqual(FS.readdir("/w/app").filter((n) => n[0] !== ".").sort(), ["t", "x"], "nothing left beside them");
});
