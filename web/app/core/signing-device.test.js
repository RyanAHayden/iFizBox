// F58: the sideload build's Signing rows from signing.status (I6), the HUD's phase labels
// and what each error code leads to.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceSummary, phaseLabel, deviceError } from "./signing.js";

const fmt = { locale: "en-US", timeZone: "UTC", now: new Date("2026-11-17T00:00:00Z") };
const identity = {
  name: "Apple Development: Jo Doe (ABCDE12345)", team: "TEAM123456", expires: "2027-03-01T00:00:00Z",
  profile: { name: "iFizBox Dev", team: "TEAM123456", appId: "TEAM123456.*", devices: 3, wildcard: true, expires: "2027-01-05T00:00:00Z" },
};

test("no identity: no rows", () => {
  assert.deepEqual(deviceSummary(null), { rows: [], problems: [] });
});

test("the identity and its profile as rows", () => {
  const { rows, problems } = deviceSummary(identity, fmt);
  assert.deepEqual(rows, [
    { label: "Certificate", detail: "Apple Development: Jo Doe (ABCDE12345)" },
    { label: "Team", detail: "TEAM123456" },
    { label: "Certificate Expires", detail: "Mar 1, 2027" },
    { label: "Profile", detail: "iFizBox Dev" },
    { label: "Profile Expires", detail: "Jan 5, 2027" },
    { label: "Devices", detail: "3" },
    { label: "App ID", detail: "TEAM123456.*" },
  ]);
  assert.deepEqual(problems, []);
});

test("an enterprise profile lists all devices; the signer's problem is shown as it says it", () => {
  const { rows, problems } = deviceSummary({ ...identity, profile: { ...identity.profile, devices: -1, problem: "The provisioning profile doesn't list this certificate." } }, fmt);
  assert.equal(rows.find((r) => r.label === "Devices").detail, "All");
  assert.deepEqual(problems, ["The provisioning profile doesn't list this certificate."]);
});

test("expired dates are problems; a missing profile is one too", () => {
  const old = { ...identity, expires: "2026-01-01T00:00:00Z", profile: { ...identity.profile, expires: "2026-02-01T00:00:00Z" } };
  assert.deepEqual(deviceSummary(old, fmt).problems, ["The certificate expired on Jan 1, 2026.", "The provisioning profile expired on Feb 1, 2026."]);
  const bare = deviceSummary({ name: "X", team: "T" }, fmt);
  assert.deepEqual(bare.rows.map((r) => r.label), ["Certificate", "Team"]);
  assert.match(bare.problems[0], /No provisioning profile/);
});

test("phase labels for the HUD", () => {
  assert.equal(phaseLabel({ phase: "downloading", progress: 0 }), "Downloading");
  assert.equal(phaseLabel({ phase: "downloading", progress: 0.423 }), "Downloading 42%");
  assert.equal(phaseLabel({ phase: "reading", progress: 1 }), "Reading");
  assert.equal(phaseLabel({ phase: "signing", progress: 0.5 }), "Signing 50%");
  assert.equal(phaseLabel({ phase: "installing", progress: 0.5 }), "Installing");
  assert.equal(phaseLabel({ phase: "handoff", progress: 0 }), "Handing to iOS"); // B424
  assert.equal(phaseLabel({ phase: "uploading", progress: 0 }), "Uploading");
  // This iPhone's own install says so, with its percentage, apart from Downloading (an offline download is obvious)
  // R91: "here"'s one number is three steps (connected 0.02, copy up to 0.3, installd from 0.301): each named, with its own percent
  assert.equal(phaseLabel({ phase: "here", progress: 0 }), "Connecting to this iPhone");
  assert.equal(phaseLabel({ phase: "here", progress: 0.02 + 0.28 * 0.5 }), "Copying to this iPhone 50%");
  assert.equal(phaseLabel({ phase: "here", progress: 0.02 + 0.28 }), "Copied to this iPhone, waiting for iOS");
  assert.equal(phaseLabel({ phase: "here", progress: 0.301 }), "Installing");
  assert.equal(phaseLabel({ phase: "here", progress: 0.301 + 0.699 * 0.5 }), "Installing 50%");
  assert.equal(phaseLabel({ phase: "what" }), null);
  assert.equal(phaseLabel(null), null);
});

test("error codes: no_server and no_identity lead to Settings > Signing, the rest say the signer's words", () => {
  const err = (code, message) => Object.assign(new Error(message), { code });
  assert.deepEqual([deviceError(err("no_server", "x")).open, deviceError(err("no_server", "x")).title], ["signing", "No Signing Server"]);
  assert.deepEqual([deviceError(err("no_identity", "x")).open, deviceError(err("no_identity", "x")).title], ["signing", "No Certificate"]);
  const net = deviceError(err("network", "the server answered 404"), "Delta");
  assert.deepEqual(net, { title: "Couldn't Install Delta", open: null, message: "The server answered 404" });
  assert.equal(deviceError(err("bad_ipa", "")).message, "Something went wrong.");
});

test("no_manifest (B30): the native text naming the host, and where the Signing Server is set", () => {
  const e = Object.assign(new Error("Couldn't reach sign.ifizbox.com: The request timed out. iOS can't show Install without it."),
    { code: "no_manifest" });
  assert.deepEqual(deviceError(e, "Delta"), {
    title: "Couldn't Install Delta", open: null,
    message: "Couldn't reach sign.ifizbox.com: The request timed out. iOS can't show Install without it. "
      + "Check the connection, or the Signing Server in Settings > Signing.",
  });
});

test("offline: a download without internet says No Internet Connection with the shell's words", () => {
  const e = Object.assign(new Error("No internet connection: downloading the IPA from example.com needs one. Turn off Airplane Mode or join Wi-Fi, then try again"), { code: "offline" });
  const why = deviceError(e, "Delta");
  assert.equal(why.title, "No Internet Connection");
  assert.equal(why.open, null);
  assert.match(why.message, /^No internet connection/);
  // This iPhone's time limits: the step that stopped, as the native text has it
  const t = deviceError(Object.assign(new Error("copying the IPA to iOS (AFC): no answer from iOS for 30 s (14.0 MB of 20.0 MB copied)"), { code: "timeout" }), "Delta");
  assert.equal(t.title, "Couldn't Install Delta");
  assert.match(t.message, /^Copying the IPA to iOS/);
});
