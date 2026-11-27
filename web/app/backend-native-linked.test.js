// F131: a package whose Filename is a full URL (ios.jjolano.me's https://github.com/.../hookkit-rootless.deb). The
// native backend downloads it through the shell (share.debFetch) and hands it to ifizbox-helper simulate-deb /
// install-deb, beside apt's simulate / apply for the rest of the queue. The shell's share.* calls are stood in for
// here over the fake helper (native/fake/ifizbox-helper), as ShareBridge.swift runs the real one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createNativeBackend } from "./backend-native.js";
import { createHash } from "node:crypto";
import { createQueue, debUrlOf, debLinkOf } from "./core/queue.js";
import { aptVersionList } from "./core/catalog.js";
import { createFakeNative, makeFixture } from "../../native/fake/fake-native.mjs";
import { fakeIndexedDB } from "./fakes.test-helper.js";

const URL_DEB = "https://github.com/example/hookkit/releases/download/1.0/hookkit-rootless.deb";
const DEB = "!<arch>\nPackage: com.example.linked\nVersion: 1.0\nArchitecture: iphoneos-arm64\nDepends: bash\nName: Linked\n";

// `served`: URL -> the "deb" share.debFetch downloads (a fake .deb: a control stanza, native/fake/ifizbox-helper).
function setup(t, { served = { [URL_DEB]: DEB }, env = {} } = {}) {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const lists = join(fx.prefix, "var/lib/apt/lists");
  for (const f of readdirSync(join(fx.remote, "lists"))) copyFileSync(join(fx.remote, "lists", f), join(lists, f));
  const debDir = join(fx.dir, "deb-cache");
  mkdirSync(debDir);
  const fake = createFakeNative({ prefix: fx.prefix, remote: fx.remote, net: null, env: { IFIZBOX_DEB_DIR: debDir, ...env } });
  let n = 0;
  const share = {
    "share.debFetch"({ url, sha256, md5 }) {
      if (!(url in served)) throw new Error(`network: ${url} answered 404`);
      // F133: as ShareBridge.swift (Share.swift DebChecksum): SHA256 first, else MD5; a mismatch removes the file
      const [kind, want] = sha256 ? ["sha256", sha256] : md5 ? ["md5", md5] : [];
      if (kind) {
        const got = createHash(kind).update(served[url]).digest("hex");
        if (got !== want.toLowerCase()) throw new Error(`bad_hash: the download's ${kind.toUpperCase()} is ${got}, not the ${want} its source lists`);
      }
      const file = `f${++n}.deb`;
      writeFileSync(join(debDir, file), served[url]);
      return { file, name: url.split("/").pop(), checked: kind ? kind.toUpperCase() : null };
    },
    async "share.debSimulate"({ file }) {
      if (!existsSync(join(debDir, file))) throw new Error("gone: that shared file isn't there any more; share it again");
      const r = await fake.call("helper.run", { words: ["simulate-deb", join(debDir, file)] });
      const pkg = r.stdout.match(/Note, selecting '([^']+)'/)?.[1];
      return { ok: r.code === 0, code: r.code, output: r.stdout + r.stderr, stdout: r.stdout, ...(pkg ? { package: pkg } : {}) };
    },
    async "share.debInstall"({ file, stream }, onEvent) {
      if (!existsSync(join(debDir, file))) throw new Error("gone: that shared file isn't there any more; share it again");
      try { return await fake.call("helper.run", { words: ["install-deb", join(debDir, file)], stream }, onEvent); }
      finally { rmSync(join(debDir, file), { force: true }); }
    },
    "share.discard"({ file }) { rmSync(join(debDir, file), { force: true }); return null; },
  };
  const calls = [];
  const native = {
    calls,
    async call(method, params = {}, onEvent) {
      if (method !== "app.keepAwake") calls.push({ method, params }); // F287: the screen switch isn't the run's work
      if (share[method]) return (await share[method](params, onEvent)) ?? null;
      return fake.call(method, params, onEvent);
    },
  };
  const queue = createQueue();
  const installs = { count: async () => true }; // F454: no install counts sent to the real server
  const backend = createNativeBackend({ native, sourceOptions: { indexedDB: fakeIndexedDB(), mode: "jailbreak", queue, installs } });
  return { fx, backend, queue, calls, debDir };
}

const linked = { op: "install", id: "com.example.linked", version: "1.0", name: "Linked", debUrl: URL_DEB };
const methods = (calls) => calls.map((c) => (c.method === "helper.run" ? `helper ${c.params.words[0]}` : c.method));

test("debUrlOf: only an absolute http(s) Filename of the version asked (or the candidate) is fetched by the shell", () => {
  const offers = [
    { key: "j", stanza: { version: "1.0", filename: URL_DEB, debUrl: URL_DEB } },
    { key: "j", stanza: { version: "0.9", filename: "debs/x_0.9.deb", debUrl: "https://ios.jjolano.me/debs/x_0.9.deb" } },
  ];
  const history = { kind: "apt", versions: aptVersionList(offers, { candidate: "1.0" }) };
  assert.equal(debUrlOf(history, null), URL_DEB);
  assert.equal(debUrlOf(history, "1.0"), URL_DEB);
  assert.equal(debUrlOf(history, "0.9"), null);
  assert.equal(debUrlOf(history, "2.0"), null);
  const ftp = { kind: "apt", versions: aptVersionList([{ key: "j", stanza: { version: "1", filename: "ftp://h/x.deb", debUrl: "ftp://h/x.deb" } }], { candidate: "1" }) };
  assert.equal(debUrlOf(ftp, null), null);
  assert.equal(debUrlOf({ kind: "ipa", versions: [] }, null), null);
  assert.equal(debUrlOf(null, null), null);
});

test("simulate: the linked job through simulate-deb, the rest through apt's simulate, as one plan", async (t) => {
  const { backend, calls } = setup(t);
  const r = await backend.simulate([linked, { op: "install", id: "bash", version: null }]);
  assert.equal(r.ok, true, r.output);
  assert.deepEqual(methods(calls), ["share.debFetch", "share.debSimulate", "helper.run"].map((m, i) => (i === 2 ? "helper simulate" : m)));
  assert.equal(calls[0].params.url, URL_DEB);
  assert.deepEqual(calls[2].params.words, ["simulate", "bash"]); // never com.example.linked: apt would 404 on it
  assert.deepEqual(r.plan.installs.map((e) => e.id).sort(), ["bash", "com.example.linked"]); // bash once
});

test("simulate then apply: downloaded once, install-deb first, then apt's apply; dpkg has both", async (t) => {
  const { backend, calls, fx } = setup(t);
  const jobs = [{ op: "install", id: "com.example.tweak", version: null }, linked];
  assert.equal((await backend.simulate(jobs)).ok, true);
  calls.length = 0;
  const events = [];
  const r = await backend.apply(jobs, (e) => events.push(e));
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(methods(calls), ["share.debInstall", "helper apply-ask"]);
  assert.deepEqual(calls[1].params.words, ["apply-ask", "com.example.tweak"]);
  assert.ok(events.some((e) => e.fd === "status" && e.line === `dlstatus:com.example.linked:0:Downloading ${URL_DEB}`));
  assert.ok(events.some((e) => e.fd === "status" && /^pmstatus:com\.example\.linked:100:/.test(e.line)));
  const status = readFileSync(join(fx.prefix, "var/lib/dpkg/status"), "utf8");
  assert.match(status, /Package: com\.example\.linked\nStatus: install ok installed/);
});

test("apply without a simulate downloads first; a failing install-deb ends the run before apt's apply", async (t) => {
  const { backend, calls } = setup(t, { env: { FAKE_FAIL: "install-deb" } });
  const r = await backend.apply([linked, { op: "install", id: "bash", version: null }]);
  assert.equal(r.code, 100);
  assert.match(r.stderr, /returned an error code/);
  assert.deepEqual(methods(calls), ["share.debFetch", "share.debInstall"]);
});

test("a link that doesn't download is a sentence for Cannot Comply, not a helper error", async (t) => {
  const { backend } = setup(t, { served: {} });
  const r = await backend.simulate([linked]);
  assert.equal(r.ok, false);
  assert.equal(r.issues.length, 1);
  assert.match(r.issues[0], /Couldn't download Linked from https:\/\/github\.com\/.*: https:\/\/github\.com\/.* answered 404/);
});

test("a link that gives another package is refused", async (t) => {
  const { backend, debDir } = setup(t, { served: { [URL_DEB]: DEB.replace("com.example.linked", "com.example.other") } });
  const r = await backend.simulate([linked]);
  assert.equal(r.ok, false);
  assert.match(r.issues[0], /gave com\.example\.other, not Linked/);
  assert.deepEqual(readdirSync(debDir), []); // discarded
});

test("a staged file that went is fetched again; clearing the queue discards what was downloaded", async (t) => {
  const { backend, queue, calls, debDir } = setup(t);
  queue.add(linked);
  assert.equal((await backend.simulate([linked])).ok, true);
  for (const f of readdirSync(debDir)) rmSync(join(debDir, f)); // a day's sweep
  assert.equal((await backend.simulate([linked])).ok, true);
  assert.equal(calls.filter((c) => c.method === "share.debFetch").length, 2);
  assert.equal(readdirSync(debDir).length, 1);
  queue.clearAll();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(readdirSync(debDir), []);
});

test("without linked jobs nothing goes through the shell's downloads", async (t) => {
  const { backend, calls } = setup(t);
  await backend.simulate([{ op: "install", id: "bash", version: null }]);
  assert.deepEqual(methods(calls), ["helper simulate"]);
});

// ---- F133: the download checked against its Packages stanza's SHA256 (or MD5sum)

const sha = (t) => createHash("sha256").update(t).digest("hex");
const md5 = (t) => createHash("md5").update(t).digest("hex");

test("F133 debLinkOf: the link with the version's stanza hashes, from catalog.history", () => {
  const offers = [
    { key: "j", stanza: { version: "1.0", filename: URL_DEB, debUrl: URL_DEB, sha256: sha(DEB).toUpperCase(), md5sum: md5(DEB) } },
    { key: "k", stanza: { version: "0.9", filename: URL_DEB, debUrl: URL_DEB, md5sum: "not hex" } },
  ];
  const history = { kind: "apt", versions: aptVersionList(offers, { candidate: "1.0" }) };
  assert.equal(history.versions[0].sha256, sha(DEB)); // lowercased
  assert.equal(history.versions[1].sha256, null);
  assert.equal(history.versions[1].md5sum, null);     // garbage dropped
  assert.deepEqual(debLinkOf(history, null), { debUrl: URL_DEB, debSha256: sha(DEB), debMd5: md5(DEB) });
  assert.deepEqual(debLinkOf(history, "0.9"), { debUrl: URL_DEB });
  const rel = { kind: "apt", versions: aptVersionList([{ key: "j", stanza: { version: "1", filename: "debs/x.deb", debUrl: "https://r/debs/x.deb", sha256: sha(DEB) } }], { candidate: "1" }) };
  assert.equal(debLinkOf(rel, null), null); // apt fetches (and checks) that one
});

test("F133: the stanza's SHA256 goes to share.debFetch; a matching download installs", async (t) => {
  const { backend, calls } = setup(t);
  const job = { ...linked, debSha256: sha(DEB), debMd5: md5(DEB) };
  assert.equal((await backend.simulate([job])).ok, true);
  assert.deepEqual(calls[0].params, { url: URL_DEB, sha256: sha(DEB), md5: md5(DEB) });
  calls.length = 0;
  assert.equal((await backend.apply([job])).code, 0);
  assert.deepEqual(methods(calls), ["share.debInstall"]); // the checked file, not fetched again
});

test("F133: a download that doesn't match its stanza is refused on Cannot Comply, nothing staged", async (t) => {
  const { backend, debDir } = setup(t);
  const r = await backend.simulate([{ ...linked, debSha256: sha("something else") }]);
  assert.equal(r.ok, false);
  assert.equal(r.issues.length, 1);
  assert.match(r.issues[0], /^Linked from https:\/\/github\.com\/.* isn't the file its source lists \(the download's SHA256 is [0-9a-f]{64}, not .*\), so iFizBox won't install it\.$/);
  assert.deepEqual(readdirSync(debDir), []);
  const m = await backend.simulate([{ ...linked, debMd5: md5("other") }]);
  assert.match(m.issues[0], /MD5 is/);
});

test("F133: a job whose hash changed (the source updated) is fetched again", async (t) => {
  const { backend, calls } = setup(t);
  assert.equal((await backend.simulate([linked])).ok, true);
  assert.equal((await backend.simulate([{ ...linked, debSha256: sha(DEB) }])).ok, true);
  assert.equal(calls.filter((c) => c.method === "share.debFetch").length, 2);
});
