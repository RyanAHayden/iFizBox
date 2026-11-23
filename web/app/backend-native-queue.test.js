// N4: the install queue's backend calls against the fake helper (native/fake/ifizbox-helper simulate | apply |
// respring): what apt would change, apt's refusal explained in F18's words, the console's streamed lines, dpkg's
// status after the run, and a downgrade by version.
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { chmodSync, existsSync, mkdtempSync, rmSync } from "node:fs"; // T63
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNativeBackend } from "./backend-native.js";
import { createCatalog, ALL } from "./core/catalog.js";
import { repoLayout } from "./core/apt.js";
import { createQueue, parseStatusLine, finishOf } from "./core/queue.js";
import { createFakeNative, makeFixture } from "../../native/fake/fake-native.mjs";
import { fakeIndexedDB } from "./fakes.test-helper.js";

// apt-get update already ran: the remote lists are in apt's lists directory (plus an older Example Tweak).
function setup(t, { env = {}, mode = "jailbreak" } = {}) {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const lists = join(fx.prefix, "var/lib/apt/lists");
  for (const f of readdirSync(join(fx.remote, "lists"))) copyFileSync(join(fx.remote, "lists", f), join(lists, f));
  writeFileSync(join(lists, "old.example_._Packages"), "Package: com.example.tweak\nVersion: 0.9\nArchitecture: iphoneos-arm64\n" +
    "Name: Example Tweak\nDepends: mobilesubstrate\nFilename: debs/t_0.9.deb\nSize: 90\nDescription: an example tweak\n");
  const native = createFakeNative({ prefix: fx.prefix, remote: fx.remote, net: null, env });
  const queue = createQueue();
  const backend = createNativeBackend({ native, sourceOptions: { indexedDB: fakeIndexedDB(), mode, queue } });
  return { fx, native, backend, queue };
}

test("queue() exists in the jailbreak build only, and marks the package in the shared queue", async (t) => {
  const { backend, queue } = setup(t);
  const seen = [];
  queue.subscribe((e) => seen.push(e.type));
  backend.queue({ op: "install", id: "bash", version: "5.2" });
  assert.equal(queue.get("bash").mode, "install");
  assert.deepEqual(seen, ["add"]);
  const side = setup(t, { mode: "sideload" }).backend;
  assert.equal(typeof side.queue, "undefined");
  assert.equal(typeof side.apply, "undefined");
});

test("simulate: apt-get -s over the queue, as the Confirm sheet's five lists", async (t) => {
  const { backend, native } = setup(t);
  const jobs = [
    { op: "install", id: "bash", version: null },
    { op: "install", id: "com.example.tweak", version: "0.9" },
    { op: "install", id: "apt", version: "2.7.0" },
    { op: "remove", id: "com.example.held" },
  ];
  const r = await backend.simulate(jobs);
  assert.deepEqual(native.calls.at(-1).params.words, ["simulate", "bash", "com.example.tweak=0.9", "apt=2.7.0", "-com.example.held"]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.plan.installs, [{ id: "bash", from: null, to: "5.2" }]);
  assert.deepEqual(r.plan.downgrades, [{ id: "com.example.tweak", from: "1.0", to: "0.9" }]);
  assert.deepEqual(r.plan.upgrades.map((e) => e.id), ["apt"]);
  assert.deepEqual(r.plan.removes, [{ id: "com.example.held", from: "1.0", to: null }]);
  assert.match(r.output, /NOTE: This is only a simulation!/);
});

test("simulate: apt's refusal comes back with its output, and F18 explains it above", async (t) => {
  const { backend } = setup(t, { env: { FAKE_FAIL: "simulate", FAKE_MISSING: "mobilesubstrate" } });
  const r = await backend.simulate([{ op: "install", id: "com.example.tweak", version: null }]);
  assert.equal(r.ok, false);
  assert.equal(r.code, 100);
  assert.match(r.output, /unmet dependencies/);
  assert.match(r.output, /E: Unable to correct problems/);
  const catalog = await loaded(backend);
  const problems = catalog.aptProblems(r.output);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].kind, "missing");
  assert.match(problems[0].sentence, /Example Tweak needs mobilesubstrate/);
  assert.deepEqual(problems[0].action, { kind: "add-source", name: "ElleKit", url: "https://ellekit.space/", label: "Add ElleKit" });
});

test("B405: names with capitals: helper words, the plan's ids are the queue's own, plain words for the rest", async (t) => {
  const { backend, fx, native } = setup(t);
  writeFileSync(join(fx.prefix, "var/lib/apt/lists", "caps.example_._Packages"),
    "Package: OreoDark\nVersion: 1.4\nArchitecture: iphoneos-arm64\nFilename: o.deb\nSize: 9\nDescription: a theme\n");
  const job = (id, version = null, op = "install") => ({ op, id, version, name: id === "OreoDark" ? "Oreo Dark" : null });
  const r = await backend.simulate([job("OreoDark", "1.4"), job("bash")]);
  assert.deepEqual([r.ok, r.plan.installs.map((e) => e.id)], [true, ["OreoDark", "bash"]]);
  assert.deepEqual(native.calls.at(-1).params.words, ["simulate", "OreoDark=1.4", "bash"]);

  const calls = native.calls.length;
  const refused = async (...jobs) => { const x = await backend.simulate(jobs); assert.equal(x.ok, false); return x.issues.join("\n"); };
  assert.match(await refused(job("OreoDark", "beta1")), /Oreo Dark can't be installed.*version dpkg doesn't take \(beta1\)/);
  assert.match(await refused(job("bash", "1.0-")), /version/);
  for (const id of ["-y", "a b", "a/b", "ab-"]) assert.match(await refused(job(id)), /name dpkg doesn't take/);
  assert.match(await refused(job("OreoDark"), job("oreodark")), /queued twice/);
  assert.equal(native.calls.length, calls); // the helper was never asked
  assert.match(await refused(job("Not.There")), /apt doesn't know Not\.There yet/);
});

test("a refused item (unknown package) is an error with the helper's words, never silent", async (t) => {
  const { backend } = setup(t);
  await assert.rejects(backend.simulate([{ op: "remove", id: "bash" }]), (e) => e.code === "helper" && /unknown package: bash/.test(e.message));
});

test("apply: the console streams apt's lines and status, then dpkg's status shows the new state", async (t) => {
  const { backend } = setup(t, { env: { FAKE_FINISH: "restart" } });
  const events = [];
  const r = await backend.apply([{ op: "install", id: "com.example.tweak", version: "0.9" }, { op: "remove", id: "com.example.held" }],
    (e) => events.push(e));
  assert.equal(r.code, 0);
  const out = events.filter((e) => e.fd === "out").map((e) => e.line);
  assert.ok(out.includes("Unpacking com.example.tweak (0.9) over (1.0) ..."));
  assert.ok(out.includes("Removing com.example.held (1.0) ..."));
  const status = events.filter((e) => e.fd === "status").map((e) => parseStatusLine(e.line));
  assert.deepEqual(status.find((s) => s.type === "status" && s.percent === 100), { type: "status", pkg: "com.example.tweak", percent: 100, text: "Installed com.example.tweak" });
  assert.equal(finishOf(...status.filter((s) => s.type === "finish").map((s) => s.finish)), "restart");
  const catalog = await loaded(backend);
  assert.deepEqual(catalog.installed().map((p) => [p.id, p.version]).sort(), [["apt", "2.6.0"], ["com.example.tweak", "0.9"]]);
  assert.deepEqual(catalog.queueInfo(["com.example.tweak", "bash"]), {
    "com.example.tweak": { name: "Example Tweak", restart: true, kind: "tweak" }, // the 0.9 build depends on mobilesubstrate
    bash: { name: "bash", restart: false, kind: "package" }, // F151: the console's finish button by kind
  });
});

test("apply: a failing run resolves with apt's exit code and its error on stderr", async (t) => {
  const { backend } = setup(t, { env: { FAKE_FAIL: "apply" } });
  const events = [];
  const r = await backend.apply([{ op: "install", id: "bash", version: null }], (e) => events.push(e));
  assert.equal(r.code, 100);
  assert.ok(events.some((e) => e.fd === "err" && /returned an error code/.test(e.line)));
});

test("F63 apply asks about a conffile both sides changed, and waits for the console's answer", async (t) => {
  for (const [answer, kept] of [["new", "new /etc/example.conf"], ["keep", "keep /etc/example.conf"]]) {
    const { backend, native, fx } = setup(t, { env: { FAKE_CONFFILE: "/etc/example.conf" } });
    const events = [];
    const asked = [];
    const r = await backend.apply([{ op: "install", id: "com.example.tweak", version: "0.9" }], (e) => {
      events.push(e);
      const s = e.fd === "status" ? parseStatusLine(e.line) : null;
      if (s?.type === "conffile") { asked.push(s); backend.answerConffile(answer); }
    });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(native.calls.find((c) => c.method === "helper.run").params.words, ["apply-ask", "com.example.tweak=0.9"]);
    assert.deepEqual(asked.map((s) => s.file), ["/etc/example.conf"]);
    assert.equal(readFileSync(join(fx.prefix, "var/fake-conffiles"), "utf8"), `${kept}\n`);
    assert.equal(events.some((e) => /Installing new version of config file/.test(e.line)), answer === "new");
  }
});

test("F63 answerConffile: only keep or new, and only while an apply waits", async (t) => {
  const { backend } = setup(t);
  await assert.rejects(backend.answerConffile("keep"), (e) => e.code === "helper" && /no install is waiting/.test(e.message));
  await assert.rejects(backend.answerConffile("Z"), (e) => e.code === "helper" && /keep or new/.test(e.message));
});

test("F63 apply without a console keeps the old conffile (plain apply, --force-confold)", async (t) => {
  const { backend, native, fx } = setup(t, { env: { FAKE_CONFFILE: "/etc/example.conf" } });
  const r = await backend.apply([{ op: "install", id: "com.example.tweak", version: "0.9" }]);
  assert.equal(r.code, 0);
  assert.equal(native.calls.at(-1).params.words[0], "apply");
  assert.equal(readFileSync(join(fx.prefix, "var/fake-conffiles"), "utf8"), "keep /etc/example.conf\n");
});

test("F64 cancelApply while apt downloads stops the run before dpkg: nothing changes", async (t) => {
  // Under load Cancel's signal once missed the fake's `sleep`, which then held the helper's pipes for the whole 20 s.
  // The helper's `sleep` here always ignores SIGTERM, so that case runs every time: the run must end anyway.
  const bin = mkdtempSync(join(tmpdir(), "cancel-sleep-"));
  const pidFile = join(bin, "pid");
  t.after(() => {
    try { process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL"); } catch { /* not started, or gone */ }
    rmSync(bin, { recursive: true, force: true });
  });
  writeFileSync(join(bin, "sleep"), `#!/bin/sh\ntrap '' TERM\necho $$ > '${pidFile}.new'\nmv '${pidFile}.new' '${pidFile}'\nPATH=\${PATH#*:}\nexec sleep "$@"\n`);
  chmodSync(join(bin, "sleep"), 0o755);
  const { backend, fx } = setup(t, { env: { FAKE_DLWAIT: "20", PATH: `${bin}:${process.env.PATH}` } });
  const before = readFileSync(join(fx.prefix, "var/lib/dpkg/status"), "utf8");
  const events = [];
  let cancelling = null;
  const started = Date.now();
  const r = await backend.apply([{ op: "install", id: "com.example.tweak", version: "0.9" }], (e) => {
    events.push(e);
    // Cancel once that sleep runs (its pid is written), not on the line before it: the window the gate hit.
    if (e.fd === "status" && e.line.startsWith("dlstatus:") && !cancelling) {
      cancelling = untilFile(pidFile).then(() => backend.cancelApply());
      cancelling.catch(() => {}); // reported by `await cancelling` below, not as an unhandled rejection meanwhile
    }
  });
  await cancelling;
  assert.equal(r.code, 130); // 128 + SIGINT
  assert.ok(Date.now() - started < 15000, "Cancel ends the wait, not the fake's 20 s download");
  assert.equal(events.some((e) => e.fd === "status" && e.line.startsWith("pmstatus:")), false);
  assert.equal(readFileSync(join(fx.prefix, "var/lib/dpkg/status"), "utf8"), before);
});

// T62: under load the gate once saw Cancel's SIGTERM end the fake's shell but not its sleep, which held the pipes for
// the whole wait. Here the wait ignores SIGTERM and SIGINT outright: Cancel still has to end the run at once.
test("F64 cancelApply ends the run even when the download wait ignores SIGTERM", async (t) => {
  const { backend } = setup(t, { env: { FAKE_DLWAIT: "20", FAKE_DLWAIT_STUBBORN: "1" } });
  let cancelling = null;
  const started = Date.now();
  const r = await backend.apply([{ op: "install", id: "com.example.tweak", version: "0.9" }], (e) => {
    // Only once the wait ignores SIGTERM: an earlier Cancel would kill the shell before the stubborn part exists.
    if (e.fd === "out" && e.line.startsWith("Waiting, deaf") && !cancelling) cancelling = backend.cancelApply();
  });
  await cancelling;
  assert.ok(cancelling, "the fake's stubborn wait started");
  assert.equal(r.code, 130);
  assert.ok(Date.now() - started < 15000, "Cancel ends the wait, not the fake's 20 s download");
});

test("F64 cancelApply: refused once dpkg runs, and when nothing runs", async (t) => {
  const { backend } = setup(t);
  await assert.rejects(backend.cancelApply(), (e) => e.code === "helper" && /no install is running/.test(e.message));
  const refusals = [];
  const r = await backend.apply([{ op: "install", id: "com.example.tweak", version: "0.9" }], (e) => {
    if (e.fd === "status" && e.line.startsWith("pmstatus:") && !refusals.length) refusals.push(backend.cancelApply().then(() => null, (err) => err));
  });
  assert.equal(r.code, 0);
  const [err] = await Promise.all(refusals);
  assert.ok(err?.code === "helper" && /already installing/.test(err.message), String(err));
});

test("respring runs the helper's respring verb", async (t) => {
  const { backend, native } = setup(t);
  await backend.respring();
  assert.deepEqual(native.calls.at(-1).params.words, ["respring"]);
});

// T63: resolves once `file` exists; rejects after 10 s, so a helper that never gets there fails instead of hanging.
async function untilFile(file) {
  for (const end = Date.now() + 10000; !existsSync(file); await new Promise((r) => setTimeout(r, 10))) {
    if (Date.now() > end) throw new Error(`${file} never appeared`);
  }
}

async function loaded(backend) {
  const catalog = createCatalog();
  for (const s of await backend.sources()) {
    const layout = repoLayout(s);
    const texts = await Promise.all(layout.packages.map(async (f) => (await backend.packages(f.slice(0, -8))).text));
    catalog.load(s.key, texts.join("\n\n"), layout.root);
  }
  catalog.load("deb:https://old.example/:./", (await backend.packages("https://old.example/")).text, "https://old.example/");
  catalog.setInstalled(await backend.dpkgStatus());
  return catalog;
}
