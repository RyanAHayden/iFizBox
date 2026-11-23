// F317: the remaining pages in the iOS 6 hint style (AGENTS.md, Hints): a footer explains only the group above it,
// one or two short sentences, split per step or row, never joined, status rows get none.
// SPDX-License-Identifier: GPL-3.0-or-later
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fakeDocument } from "../nav/fakedom.test-helper.js";
import { helpSections, softwareSections, HELP_NOT_JAILBROKEN_FOOTER, HELP_KINDS_FOOTER, HELP_CHANGES_FOOTER, HELP_REFRESH_FOOTER,
  ELLEKIT_FOOTER, CANISTER_FOOTER } from "./home.js";
import { readySections, FREE_ENTRY_FOOTER, FREE_FIELDS_FOOTER, FREE_PASSWORD_FOOTER, freeWaitFooter, FREE_ZIP_FOOTER,
  FREE_RENEW_FOOTER } from "./free-apple-id.js";
import { FOOTER as TWEAKS_FOOTER, WITH_ELLEKIT } from "./tweaks.js";
import { ROULETTE_INTRO } from "./roulette.js";
import { IMPORT_FOOTER } from "./manage.js";
import { setupGroups, IMPORT_PAIRING } from "./installroute.js";
import { PAIR_STEPS, NO_VPN } from "../core/installroute.js";
import { siteIpaSections, SITE_IPA_INSTALL_FOOTER, SITE_KEPT_FOOTER } from "./myipas.js";

let saved;
beforeEach(() => { saved = globalThis.document; globalThis.document = fakeDocument(); });
afterEach(() => { globalThis.document = saved; });

const labels = (s) => (s.rows ?? []).map((r) => r.label);
// one or two short sentences
const short = (f, max = 140) => {
  const n = f.split(/(?<=[.!?])\s+/).filter(Boolean).length;
  assert.ok(n >= 1 && n <= 2, `"${f}": ${n} sentences`);
  assert.ok(f.length <= max, `"${f}": ${f.length} characters`);
};

test("every new footer is one or two short sentences", () => {
  for (const f of [...Object.values(HELP_NOT_JAILBROKEN_FOOTER), ...Object.values(HELP_KINDS_FOOTER), HELP_CHANGES_FOOTER,
    HELP_REFRESH_FOOTER, ELLEKIT_FOOTER, CANISTER_FOOTER, FREE_ENTRY_FOOTER, FREE_FIELDS_FOOTER, FREE_PASSWORD_FOOTER,
    freeWaitFooter(new Date(2026, 10, 20, 14, 5)), FREE_ZIP_FOOTER, FREE_RENEW_FOOTER, TWEAKS_FOOTER, WITH_ELLEKIT,
    ROULETTE_INTRO, IMPORT_FOOTER, SITE_IPA_INSTALL_FOOTER, SITE_KEPT_FOOTER]) short(f);
  short(NO_VPN.message, 180); // two sentences naming the cause and both ways out
  for (const s of PAIR_STEPS.file) short(s);
});

test("Help: Not Jailbroken and the jailbreak kinds a group each, Check for Changes and Refresh Sources a group each", () => {
  const g = helpSections("site", { changes: "#/c", refresh: "#/r" });
  assert.deepEqual(g.map(labels), [["Not Jailbroken"], ["Rootless", "Rootful", "Roothide"], ["Check for Changes"], ["Refresh Sources"]]);
  assert.deepEqual(g.map((s) => s.header), ["Which Jailbreak", undefined, "Upgrading", undefined]);
  assert.match(g[1].footer, /Settings > Device/);
  assert.equal(g[2].rows[0].href, "#/c");
  assert.equal(g[3].rows[0].href, "#/r");
  for (const s of g) assert.ok(s.footer, `${labels(s)} has its footer`);
  // F144: the sideload build has no Settings > Device
  const side = helpSections("sideload");
  assert.doesNotMatch(side.map((s) => s.footer).join(" "), /Settings > Device/);
  assert.match(side[1].footer, /jailbreak app/);
});

test("Credits > Software: ElleKit and Canister each in their own group with their footer, the notices together", () => {
  const g = softwareSections();
  assert.deepEqual(g.map(labels), [["ElleKit"], ["Canister"], ["zsign", "OpenSSL", "zlib", "idevice"]]);
  assert.equal(g[0].header, "Software");
  assert.equal(g[0].footer, ELLEKIT_FOOTER);
  assert.match(g[0].footer, /Évelyne Bélanger/);
  assert.equal(g[1].footer, CANISTER_FOOTER);
  // one class per row (ui.js classList.add): "thanks-row canister-credit" threw and left Credits half drawn
  for (const s of g) for (const r of s.rows) assert.doesNotMatch(r.cls, /\s/);
  assert.equal(g[2].footer, undefined);
});

test("Free Apple ID ready: step summaries split under their own rows, never joined", () => {
  const rows = [{ label: "Team", detail: "Me" }, { label: "Certificate Until", detail: "2027-11-20" },
    { label: "App ID", subtitle: "x.y" }, { label: "Profile Until", detail: "2026-11-27" }];
  const steps = { device: { state: "done", summary: "Added to the account" }, certificate: { state: "done", summary: "Made a new certificate" },
    appId: { state: "done", summary: "x.y (already made)" }, profile: { state: "done", summary: "Good until 2026-11-27" } };
  const g = readySections(rows, steps);
  assert.deepEqual(g.map(labels), [["Team"], ["This iPhone"], ["Certificate Until"], ["App ID"], ["Profile Until"]]);
  assert.deepEqual(g.map((s) => s.footer), [undefined, "Added to the account.", "Made a new certificate.", "x.y (already made).", undefined]);
  // before this session's setup: the rows alone, no footers, no This iPhone row
  const quiet = readySections(rows, {});
  assert.deepEqual(quiet.map(labels), [["Team"], ["Certificate Until"], ["App ID"], ["Profile Until"]]);
  assert.ok(quiet.every((s) => !s.footer));
});

test("Pairing with a file: one group per numbered step, Import Pairing File in the last", () => {
  const g = setupGroups("file", null, null);
  const steps = g.slice(1);
  assert.equal(steps.length, PAIR_STEPS.file.length);
  steps.forEach((s, i) => assert.equal(s.footer, `${i + 1}. ${PAIR_STEPS.file[i]}`));
  assert.equal(steps[0].header, "Pair This iPhone");
  assert.deepEqual(labels(steps.at(-1)), [IMPORT_PAIRING]);
});

test("no Network Extensions: the status row and one footer under it", () => {
  const g = setupGroups("noVPN", null, null);
  assert.deepEqual(g.slice(1).map(labels), [["Network Extensions"]]);
  assert.equal(g[1].footer, NO_VPN.message);
});

test("My IPAs on the website: the Install hint under an Install row, Details with no footer", () => {
  const g = siteIpaSections([{ label: "Version", detail: "1" }]);
  assert.deepEqual(g.map(labels), [["Install"], ["Version"]]);
  assert.equal(g[0].footer, SITE_IPA_INSTALL_FOOTER);
  assert.equal(g[1].header, "Details");
  assert.equal(g[1].footer, undefined);
});
