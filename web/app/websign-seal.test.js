// B434: what the website's job does to an unpacked app before zsign seals it (websign-seal.js), checked on the real
// zsign WebAssembly with iOS's scan of a signed bundle (as native/test_sign.py seal_problems models it).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { runSignJob } from "./websign-job.js";
import { withExecutable } from "./websign-seal.js";
import { parseBplist } from "./core/ipainfo.js";
import { parsePlist } from "./core/signing.js";

const WASM = new URL("./vendor/zsign/zsign.js", import.meta.url);
const skip = !existsSync(WASM) && "no vendor/zsign";
const fx = (n) => new Uint8Array(readFileSync(new URL(`./core/fixtures/signing/${n}`, import.meta.url)));
const text = (b) => new TextDecoder().decode(b);
const b64 = (b) => Buffer.from(b).toString("base64");
const NFC = "Procé", NFD = "Procé";
const PAYLOAD = "/w/app/Payload";

const xmlPlist = (id, exe) => `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key>`
  + `<string>${id}</string><key>CFBundleExecutable</key><string>${exe}</string></dict></plist>`;

// Signs tiny-ifizbox.ipa; `edit(FS, app, write)` changes the unpacked app first. -> { path under Payload: bytes } after zsign.
async function signed(edit, over = {}) {
  const { default: real } = await import(WASM);
  const tree = {};
  const createZsign = async (o) => {
    const zs = await real(o), { FS } = zs, { ccall, callMain } = zs;
    const write = (path, data) => {
      let at = "";
      for (const p of path.split("/").filter(Boolean).slice(0, -1)) {
        at += `/${p}`;
        try { FS.mkdir(at); } catch { /* there */ }
      }
      FS.writeFile(path, data);
    };
    zs.ccall = (name, ...rest) => {
      const r = ccall(name, ...rest);
      if (name === "ifizbox_unzip") edit(FS, `${PAYLOAD}/Tiny.app`, write);
      return r;
    };
    zs.callMain = (args) => {
      try { return callMain(args); } finally {
        const walk = (p) => {
          for (const n of FS.readdir(p).filter((x) => x !== "." && x !== "..")) {
            const at = `${p}/${n}`;
            if (FS.isDir(FS.stat(at).mode)) walk(at);
            else tree[at.slice(PAYLOAD.length + 1)] = FS.readFile(at);
          }
        };
        walk(PAYLOAD);
      }
    };
    return zs;
  };
  await runSignJob(createZsign, { ipa: fx("tiny-ifizbox.ipa"), p12: fx("test.p12"), profile: fx("test.mobileprovision"), password: "hunter2", ...over });
  return tree;
}

// iOS's check of one bundle: what is on disk and not sealed, sealed and not on disk, or different.
function sealProblems(tree, bundle) {
  const here = Object.fromEntries(Object.entries(tree).filter(([p]) => p.startsWith(bundle)).map(([p, d]) => [p.slice(bundle.length), d]));
  const info = here["Info.plist"];
  const exe = (text(info.subarray(0, 6)) === "bplist" ? parseBplist(info) : parsePlist(text(info))).CFBundleExecutable.normalize("NFD");
  const seal = parsePlist(text(here["_CodeSignature/CodeResources"])).files2;
  const skipped = (p) => [exe, "Info.plist", "PkgInfo"].includes(p) || p.split("/").at(-1) === ".DS_Store"
    || ["_CodeSignature", "CodeResources", "_MASReceipt"].includes(p.split("/")[0]);
  const out = [];
  for (const [p, d] of Object.entries(here)) {
    if (skipped(p)) continue;
    if (!seal[p]) out.push(`added ${p}`);
    else if (b64(seal[p].hash2) !== createHash("sha256").update(d).digest("base64")) out.push(`modified ${p}`);
  }
  for (const p of Object.keys(seal)) if (!here[p] || skipped(p)) out.push(`deleted ${p}`);
  const names = new Map(); // what the phone takes as one name
  for (const p of Object.keys(here)) {
    if (names.has(p.normalize("NFD"))) out.push(`two spellings ${p}`);
    names.set(p.normalize("NFD"), p);
  }
  for (const p of Object.keys(here)) if (/^_CodeSignature\/(?!CodeResources$)/.test(p)) out.push(`refused ${p}`);
  if (!here[exe]) out.push(`no executable ${exe}`);
  return out;
}

const leftovers = (app, write) => {
  for (const d of ["", "Frameworks/Kit.framework/"]) {
    for (const n of ["_CodeSignature/CodeDirectory", "_CodeSignature/sub/x", "CodeResources", "_MASReceipt/receipt", "foo.DS_Store",
      "deep/a.DS_Store", ".DS_Store", "SC_Info/a.sinf", "CodeResources2", "sub/CodeResources"]) write(`${app}/${d}${n}`, "left over");
  }
};
const addKit = (FS, app, write, exe = "Kit") => {
  write(`${app}/Frameworks/Kit.framework/Info.plist`, xmlPlist("com.example.kit", exe));
  write(`${app}/Frameworks/Kit.framework/${exe}`, FS.readFile(`${app}/Tiny`));
};

test("leftovers of an old signature and names ending in .DS_Store go, in the app and its frameworks; the rest stays sealed", { skip }, async () => {
  const tree = await signed((FS, app, write) => {
    addKit(FS, app, write);
    leftovers(app, write);
    write(`${app}/Res.bundle/_CodeSignature/x`, "left over");
    write(`${app}/Res.bundle/CodeResources`, "a resource");
  });
  for (const d of ["Tiny.app/", "Tiny.app/Frameworks/Kit.framework/"]) {
    assert.deepEqual(sealProblems(tree, d), [], d);
    for (const n of ["CodeResources", "_MASReceipt/receipt", "foo.DS_Store", "deep/a.DS_Store", "_CodeSignature/sub/x"]) assert.ok(!(d + n in tree), d + n);
    for (const n of ["SC_Info/a.sinf", "CodeResources2", "sub/CodeResources"]) assert.ok(d + n in tree, d + n);
  }
  assert.ok(!("Tiny.app/Res.bundle/_CodeSignature/x" in tree));
  assert.ok("Tiny.app/Res.bundle/CodeResources" in tree);
});

test("two spellings of a name become the first, with the last one's data; folders become one", { skip }, async () => {
  const tree = await signed((FS, app, write) => {
    write(`${app}/café.txt`, "one");
    write(`${app}/café.txt`, "two");
    write(`${app}/dé/a.txt`, "a");
    write(`${app}/dé/b.txt`, "b");
    write(`${app}/dé/ü/c.txt`, "c");
    write(`${app}/dé/ü/d.txt`, "d");
  });
  assert.deepEqual(sealProblems(tree, "Tiny.app/"), []);
  assert.equal(text(tree["Tiny.app/café.txt"]), "two");
  for (const n of ["a.txt", "b.txt", "ü/c.txt", "ü/d.txt"]) assert.ok(`Tiny.app/dé/${n}` in tree, n);
});

test("a composed executable name is decomposed, in the app (its folder too) and a framework", { skip }, async () => {
  const tree = await signed((FS, app, write) => {
    addKit(FS, app, write, "Ké");
    write(`${app}/Info.plist`, xmlPlist("com.ryha.ifizbox", NFC));
    FS.rename(`${app}/Tiny`, `${app}/${NFC}`);
    FS.rename(app, `${PAYLOAD}/${NFC}.app`);
  });
  const app = `${NFD}.app/`;
  assert.deepEqual(sealProblems(tree, app), []);
  assert.deepEqual(sealProblems(tree, `${app}Frameworks/Kit.framework/`), []);
  assert.equal(parsePlist(text(tree[`${app}Info.plist`])).CFBundleExecutable, NFD);
  assert.ok(Object.keys(tree).every((p) => p.startsWith(app)));
});

test("a composed name in a binary Info.plist, the file spelled the other way", { skip }, async () => {
  let was = null;
  const tree = await signed((FS, app) => {
    was = parseBplist(FS.readFile(`${app}/Info.plist`));
    FS.writeFile(`${app}/Info.plist`, withExecutable(FS.readFile(`${app}/Info.plist`), NFC));
    FS.rename(`${app}/Tiny`, `${app}/${NFD}`);
  });
  assert.deepEqual(sealProblems(tree, "Tiny.app/"), []);
  assert.deepEqual(parseBplist(tree["Tiny.app/Info.plist"]), { ...was, CFBundleExecutable: NFD }, "nothing else changed");
});

test("what a tweak brings is prepared too", { skip }, async () => {
  const data = new TextEncoder().encode("x");
  const tree = await signed((FS, app, write) => write(`${app}/café.txt`, "one"), { tweaks: { inject: [], files: [
    { path: "T.bundle/_CodeSignature/x", data }, { path: "T.bundle/x.DS_Store", data }, { path: "café.txt", data }] } });
  assert.deepEqual(sealProblems(tree, "Tiny.app/"), []);
  assert.equal(text(tree["Tiny.app/café.txt"]), "x");
  assert.ok(!Object.keys(tree).some((p) => p.startsWith("Tiny.app/T.bundle/")));
});

test("withExecutable: an XML plist with entities, a long name, and ones it can't change", () => {
  const enc = (s) => new TextEncoder().encode(s);
  const nested = `<plist version="1.0"><dict><key>X</key><dict><key>CFBundleExecutable</key><string>Other</string></dict>`
    + `<key>CFBundleExecutable</key>\n<string>Proc&#233;&amp;</string></dict></plist>`;
  const p = parsePlist(text(withExecutable(enc(nested), `${NFD}&`)));
  assert.equal(p.CFBundleExecutable, `${NFD}&`);
  assert.equal(p.X.CFBundleExecutable, "Other");
  const odd = `<plist version="1.0"><dict><key>CFBundleExecutable</key><!-- x --><string><![CDATA[${NFC}]]></string></dict></plist>`;
  assert.equal(parsePlist(text(withExecutable(enc(odd), NFD))).CFBundleExecutable, NFD);
  assert.equal(withExecutable(enc("not a plist"), NFD), null);
  assert.equal(withExecutable(enc("bplist00"), NFD), null);
});
