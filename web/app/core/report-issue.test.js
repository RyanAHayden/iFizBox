import { test } from "node:test";
import assert from "node:assert/strict";
import { issueUrl, issueBody, issueTitle, reportLog, buildName, URL_CAP } from "./report-issue.js";
import { GITHUB_REPO, NAME } from "../brand.js";

const info = { version: "1.2.0", build: "345", mode: "jailbreak", ios: "15.8.8", machine: "iPhone9,3" };
const entry = (text, extra = {}) => ({ id: "a1", at: Date.UTC(2026, 10, 21, 9, 30), title: "Install Foo", code: 100,
  ok: false, state: "failed", text, ...extra });
const parse = (url) => { const u = new URL(url); return { u, title: u.searchParams.get("title"), body: u.searchParams.get("body") }; };

test("report-issue: the URL opens a new issue on brand.js GITHUB_REPO with every field", () => {
  const { url, trimmed } = issueUrl(info, entry("Reading package lists...\nE: Sub-process /usr/bin/dpkg returned an error code (1)"));
  const { u, title, body } = parse(url);
  assert.equal(`${u.origin}${u.pathname}`, `https://github.com/${GITHUB_REPO}/issues/new`);
  assert.equal(trimmed, false);
  assert.match(title, /Install Foo: Failed \(100\)/);
  assert.match(title, new RegExp(`${NAME} 1\\.2\\.0, jailbreak, iOS 15\\.8\\.8`));
  assert.match(body, /1\.2\.0 \(345\), jailbreak/);
  assert.match(body, /\*\*iOS:\*\* 15\.8\.8/);
  assert.match(body, /\*\*Device:\*\* iPhone9,3/);
  assert.match(body, /```\nReading package lists...\nE: Sub-process \/usr\/bin\/dpkg returned an error code \(1\)\n```/);
  assert.doesNotMatch(body, /trimmed|clipboard/);
});

test("report-issue: the build names", () => {
  assert.equal(buildName("jailbreak"), "jailbreak");
  assert.equal(buildName("sideload"), "Lite");
  assert.equal(buildName("site"), "website");
  assert.match(issueBody({ ...info, mode: "sideload" }, null), /, Lite\n/);
});

test("report-issue: a long log keeps its last lines under the cap and says (trimmed)", () => {
  const lines = Array.from({ length: 2000 }, (_, i) => `line ${i} Unpacking something & 100% done #${i}`);
  const { url, trimmed, full } = issueUrl(info, entry(lines.join("\n")));
  assert.ok(url.length <= URL_CAP, `${url.length} > ${URL_CAP}`);
  assert.equal(trimmed, true);
  assert.equal(full, lines.join("\n")); // the whole log, for the clipboard
  const { body } = parse(url);
  assert.match(body, /\(trimmed: the last \d+ of 2000 lines\)/);
  assert.match(body, /on your clipboard: paste it here/);
  assert.ok(body.includes(`${lines[1999]}\n\`\`\``), "ends with the log's last line");
  assert.ok(!body.includes(`${lines[0]}\n`), "the first line is cut");
  // the most that fit: one more line goes over
  const kept = Number(body.match(/the last (\d+) of/)[1]);
  assert.ok(issueUrl(info, entry(lines.join("\n")), { cap: url.length + 10 }).url.length <= url.length + 10);
  const more = issueBody(info, entry(lines.join("\n")), { lines: kept + 1 });
  const longer = `https://github.com/${GITHUB_REPO}/issues/new?title=${encodeURIComponent(issueTitle(info, entry("")))}&body=${encodeURIComponent(more)}`;
  assert.ok(longer.length > URL_CAP);
});

test("report-issue: one line longer than the cap keeps its end", () => {
  const big = "x".repeat(20000) + "THE END";
  const { url, trimmed } = issueUrl(info, entry(big));
  assert.ok(url.length <= URL_CAP);
  assert.equal(trimmed, true);
  assert.match(parse(url).body, /THE END\n```/);
  assert.match(parse(url).body, /\(trimmed: the end of the last of 1 lines\)/);
});

test("report-issue: characters that need encoding survive the round trip", () => {
  const text = "a&b=c?d#e+f%20 ü 😀\n``` not a fence\ttab";
  const { url } = issueUrl(info, entry(text));
  assert.doesNotMatch(url.split("?")[1], /[ #\n]/);
  const { body } = parse(url);
  assert.ok(body.includes(`\`\`\`\`\n${text}\n\`\`\`\``), "a longer fence than the log's own backticks");
});

test("report-issue: the log sent is the open one, else the newest failed, else the newest", () => {
  const list = [entry("", { id: "n", state: "done", code: 0, ok: true }), entry("", { id: "f" }), entry("", { id: "g" })];
  assert.equal(reportLog(list, "g").id, "g");
  assert.equal(reportLog(list).id, "f");
  assert.equal(reportLog([list[0]]).id, "n");
  assert.equal(reportLog([]), null);
  assert.equal(reportLog(list, "gone"), null);
});

test("report-issue: no log and no app info still make an issue", () => {
  const { url, trimmed } = issueUrl({ mode: "site" }, null);
  const { title, body } = parse(url);
  assert.equal(trimmed, false);
  assert.match(title, /website, iOS \?/);
  assert.match(body, /No Console Log yet/);
  assert.match(body, /\*\*Device:\*\* unknown/);
});
