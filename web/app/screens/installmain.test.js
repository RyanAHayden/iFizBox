// F284: Installation & Signing's main page links to sub-pages: Install Apps With and This iPhone under installation/,
// Certificate, Signing Server and Signed Apps under signing/ (How Signing Works stays signing/help).
import test from "node:test";
import assert from "node:assert/strict";
import { opensSigningSub, opensMerged, SIGNING_SUBS } from "./settings.js";
import { subGroups, installationGroups, MAIN_ROWS } from "./installroute.js";

test("the Signing rows open their own pages, only in the sideload build", () => {
  assert.deepEqual(Object.values(SIGNING_SUBS), ["Certificate", "Signing Server", "Signed Apps"]);
  for (const s of ["certificate", "server", "apps"]) {
    assert.equal(opensSigningSub(["signing", s]), true);
    assert.equal(opensSigningSub(["signing", s], false), false);
    assert.equal(opensMerged(["signing", s]), false);
  }
  assert.equal(opensSigningSub(["signing", "help"]), false);
  assert.equal(opensSigningSub(["signing", "showExpiry"]), false); // a list page
  assert.equal(opensSigningSub(["signing"]), false);
});

test("F300: Install Apps With's page holds the choice and the chosen route's groups; This iPhone's holds its own", () => {
  const all = installationGroups("iphone", { paired: "rp", localDevVPN: true });
  assert.deepEqual(subGroups(all, "with").map((g) => g.header), ["Install Apps With", "This iPhone", "Connect With", "Tailscale"]);
  assert.deepEqual(subGroups(all, "iphone").map((g) => g.header), ["This iPhone", "Connect With", "Tailscale"]);
  assert.equal(subGroups(all, null), all);
  const server = installationGroups("server", null, { server: () => [{ header: "Signing Server", rows: [{ label: "Server" }, { label: "Check Server" }, { label: "Run Your Own" }] }] });
  assert.deepEqual(subGroups(server, "with").map((g) => g.header), ["Install Apps With", "Signing Server"]);
  assert.deepEqual(server[1].rows.map((r) => r.label), ["Server", "Check Server", "Run Your Own"]);
});

test("F372: the main page's rows are fixed: status, its action, both ways, two Signing rows, How Signing Works", () => {
  assert.deepEqual(MAIN_ROWS, ["status", "action", "iphone", "server", "certificate", "apps", "help"]);
});
