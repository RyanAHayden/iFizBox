import { test } from "node:test";
import assert from "node:assert/strict";
import { themeMessage, applyTheme, settings } from "./settings.js";
import { keepHint } from "./settings.js";
import { fakeDocument } from "../fakes.test-helper.js";

// F230: a localStorage that records what the pages write and remove (before any test opens a theme list, which drops
// F215's old split key once). The settings store above was made at import, on its own storage.
const lsLog = [];
const lsData = new Map([["ifizbox.themePreviewSplit", "0.4"]]);
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (k) => lsData.get(k) ?? null,
  setItem: (k, v) => { lsLog.push(["set", k]); lsData.set(k, String(v)); },
  removeItem: (k) => { lsLog.push(["remove", k]); lsData.delete(k); },
} });

test("the shell gets the fixed theme, or auto while Appearance is Automatic (F23)", () => {
  assert.deepEqual(themeMessage("dark", "dark").params, { style: "dark", theme: "dark", darkPalette: "gunmetal", lightPalette: "classic" });
  assert.deepEqual(themeMessage("light", "light", "gunmetal", "sepia").params,
    { style: "light", theme: "light", darkPalette: "gunmetal", lightPalette: "sepia" });
  assert.deepEqual(themeMessage("auto", "dark").params, { style: "auto", theme: "dark", darkPalette: "gunmetal", lightPalette: "classic" });
  assert.equal(themeMessage("auto", "light").method, "app.theme");
});

test("applyTheme posts app.theme to the bridge once per change", () => {
  const sent = [];
  const win = {
    matchMedia: () => ({ matches: true }),
    webkit: { messageHandlers: { ifizbox: { postMessage: (m) => { sent.push(m); return Promise.resolve(null); } } } },
  };
  const doc = { documentElement: { dataset: {} }, querySelectorAll: () => [] };
  settings.set("appearance", "dark");
  applyTheme(doc, win);
  applyTheme(doc, win);
  assert.equal(doc.documentElement.dataset.theme, "dark");
  assert.equal(doc.documentElement.dataset.palette, "gunmetal"); // F320: Gunmetal unless another is chosen
  assert.deepEqual(sent.map((m) => m.params), [{ style: "dark", theme: "dark", darkPalette: "gunmetal", lightPalette: "classic" }]);
  settings.set("appearance", "auto");
  applyTheme(doc, win);
  assert.deepEqual(sent.at(-1).params, { style: "auto", theme: "dark", darkPalette: "gunmetal", lightPalette: "classic" });
  // F214: the light theme travels too, in dark as well, for the next launch's ground
  settings.set("lightTheme", "solarized");
  applyTheme(doc, win);
  assert.deepEqual(sent.at(-1).params, { style: "auto", theme: "dark", darkPalette: "gunmetal", lightPalette: "solarized" });
  settings.set("lightTheme", "classic");
  // B221: iOS 7 sends its White for the light launch ground, and dark status-bar text on White's bar
  // B231: and its OLED Black for the dark one, whatever the iOS 6 dark pick (Gunmetal here)
  settings.set("style", "ios7");
  settings.set("appearance", "light");
  applyTheme(doc, win);
  // B235: iOS 7's OLED Black opens on its own launch set (oled7: flat bars), the page still data-palette "oled"
  assert.deepEqual(sent.at(-1).params, { style: "light", theme: "light", darkPalette: "oled7", lightPalette: "white", statusBar: "dark" });
  settings.set("appearance", "dark");
  applyTheme(doc, win);
  assert.deepEqual(sent.at(-1).params, { style: "dark", theme: "dark", darkPalette: "oled7", lightPalette: "white" });
  assert.equal(doc.documentElement.dataset.palette, "oled");
  settings.set("style", "ios13"); // B235: iOS 13's, its #38383a hairline; B237: and its White (white13: #f2f2f7)
  applyTheme(doc, win);
  assert.deepEqual(sent.at(-1).params, { style: "dark", theme: "dark", darkPalette: "oled13", lightPalette: "white13" });
  settings.set("style", "ios6");
  applyTheme(doc, win); // back in iOS 6, the pick again
  assert.deepEqual(sent.at(-1).params, { style: "dark", theme: "dark", darkPalette: "gunmetal", lightPalette: "classic" });
  settings.set("appearance", "auto");
  // the site: no handler, no throw
  applyTheme(doc, { matchMedia: () => ({ matches: false }) });
});

test("Update Alerts: what iOS allows, the last background check, and a way to Settings when something is off", async () => {
  const { notifyRows } = await import("./settings.js");
  const { NAME } = await import("../brand.js");
  const now = Date.parse("2026-11-18T12:00:00Z");
  const rows = (g) => g.rows.map((r) => [r.label, r.detail ?? ""]);
  // B207: Icon Badge off in iOS: Update Alerts says so with the fix row; NAME Updates gets its own group and footer
  const [offAlerts, offSelf, offCheck, offExtra] = notifyRows({ status: "authorized", badges: false, alerts: true, backgroundRefresh: true, lastCheck: null }, now);
  assert.equal(offExtra, undefined, "no push: three groups");
  assert.equal(offAlerts.header, "Update Alerts");
  assert.deepEqual(rows(offAlerts), [["Notifications", "On"], ["Icon Badge", "Off"], ["Turn On in Settings", ""]]);
  assert.equal(offAlerts.rows[1].toggle, "ios");
  assert.equal(offAlerts.rows[2].open, true);
  assert.equal(offAlerts.footer, "Icon Badge is off in iOS, so update alerts can't show a count on the icon.");
  assert.equal(offSelf.header, undefined);
  assert.deepEqual(rows(offSelf), [[`${NAME} Updates`, "On"]]);
  assert.match(offSelf.footer, new RegExp(`^Off, only your apps' updates alert you`));
  assert.equal(offCheck.header, "Checking for Updates");
  // not asked yet (iOS answers no badges then): nothing to fix in Settings, the group as when on
  const [asked] = notifyRows({ status: "notDetermined", badges: false, alerts: false, backgroundRefresh: true, lastCheck: null }, now);
  assert.deepEqual(rows(asked).map(([l]) => l), ["Notifications", "Icon Badge", `${NAME} Updates`]);
  // notifications off altogether: the check's group carries the one fix row, not a second one here
  const denied = notifyRows({ status: "denied", badges: false, alerts: false, backgroundRefresh: true, lastCheck: null }, now);
  assert.equal(denied.length, 2);
  assert.equal(denied.flatMap((g) => g.rows).filter((r) => r.label === "Turn On in Settings").length, 1);
  // ...unless the check is turned off here, when only this group can say it
  const deniedOff = notifyRows({ status: "denied", backgroundOn: false, badges: false, alerts: false, backgroundRefresh: true }, now);
  assert.equal(deniedOff[0].rows.at(-1).label, "Turn On in Settings");
  const [alerts, check, extra] = notifyRows({ badges: true, alerts: true, backgroundRefresh: true, lastCheck: null }, now);
  assert.equal(extra, undefined, "no push: two groups");
  assert.equal(alerts.header, "Update Alerts");
  assert.deepEqual(rows(alerts), [["Notifications", "On"], ["Icon Badge", "On"], [`${NAME} Updates`, "On"]]);
  assert.deepEqual(alerts.rows.map((r) => r.toggle), ["ios", "ios", "self"]);
  assert.match(alerts.footer, new RegExp(`^Off, only your apps' updates alert you; ${NAME}'s own update still shows in Changes\\.$`));
  assert.equal(check.header, "Checking for Updates");
  assert.deepEqual(rows(check), [["Background Check", "On"], ["Last Check", "Not yet"]]);
  assert.equal(check.rows[0].toggle, "ours");
  assert.equal(check.footer, "iOS decides when this runs, usually every few hours.");
  const [, on] = notifyRows({ badges: true, alerts: true, backgroundRefresh: true, lastCheck: "2026-11-18T09:00:00Z" }, now);
  assert.deepEqual(rows(on), [["Background Check", "On"], ["Last Check", "3 h ago"]]);
  assert.ok(on.rows.every((r) => !("check" in r)), "no internal flags leak to the page");
  // iOS has something off: its row (Off) and the fix in this group, the footer says what's off
  const [, noRefresh] = notifyRows({ badges: true, alerts: true, backgroundRefresh: false, lastCheck: null }, now);
  assert.deepEqual(rows(noRefresh), [["Background Check", "On"], ["Background App Refresh", "Off"], ["Last Check", "Not yet"],
    ["Turn On in Settings", ""]]);
  assert.equal(noRefresh.rows[1].toggle, "ios");
  assert.equal(noRefresh.rows[3].open, true);
  assert.equal(noRefresh.footer, "Background App Refresh is off in iOS, so this check can't run.");
  const [, noAlerts] = notifyRows({ badges: true, alerts: false, backgroundRefresh: true, lastCheck: null }, now);
  assert.deepEqual(rows(noAlerts).map(([l]) => l), ["Background Check", "Notifications", "Last Check", "Turn On in Settings"]);
  assert.equal(noAlerts.footer, "Notifications are off in iOS, so this check can't alert you.");
  const [, both] = notifyRows({ badges: true, alerts: false, backgroundRefresh: false, lastCheck: null }, now);
  assert.deepEqual(rows(both).map(([l]) => l), ["Background Check", "Background App Refresh", "Notifications", "Last Check", "Turn On in Settings"]);
  assert.match(both.footer, /^Background App Refresh and Notifications are off in iOS/);
  // turned off here: no nudge to Settings, the footer says it's off
  const [quietAlerts, quiet] = notifyRows({ backgroundOn: false, badges: true, alerts: false, backgroundRefresh: false }, now, { selfAlerts: false });
  assert.deepEqual(rows(quiet), [["Background Check", "Off"], ["Last Check", "Not yet"]]);
  assert.match(quiet.footer, new RegExp(`^Off, updates are found only while ${NAME} is open\\.$`));
  assert.deepEqual(quietAlerts.rows[2], { label: `${NAME} Updates`, detail: "Off", on: false, toggle: "self" });
  assert.equal(notifyRows(null), null);
});

// F311: iOS 6 hints, as the 4S's Mail > Fetch New Data: Push gets a group of its own with its own footer, the
// background check another with its own; never two hints joined in one footer.
test("Checking for Updates: a Push group and a Background Check group, one footer each", async () => {
  const { notifyRows } = await import("./settings.js");
  const { pushRows } = await import("../core/push.js");
  const now = Date.parse("2026-11-19T12:00:00Z");
  const st = { badges: true, alerts: true, backgroundRefresh: true, lastCheck: "2026-11-19T11:00:00Z" };
  const rows = (g) => g.rows.map((r) => [r.label, r.detail ?? ""]);
  const live = pushRows({ state: { on: true }, status: { registered: true, lastPush: "2026-11-19T11:50:00Z" }, reason: null }, now);
  const [, pushGroup, check] = notifyRows(st, now, { push: live });
  assert.equal(pushGroup.header, "Checking for Updates");
  assert.deepEqual(rows(pushGroup), [["Push", ""], ["Last Push", "10 min ago"]]);
  assert.equal(pushGroup.rows[0].toggle, "push");
  assert.equal(pushGroup.rows[0].on, true);
  assert.equal(pushGroup.footer, "Alerts arrive within half an hour of an update.");
  assert.equal(check.header, undefined, "one header over the two groups");
  assert.deepEqual(rows(check), [["Background Check", "On"], ["Last Check", "1 h ago"]]);
  assert.equal(check.footer, "Used when Push can't reach this iPhone. iOS decides when it runs, usually every few hours.");
  // Push off: its own footer says what it does; the check's no longer calls itself the fallback
  const off = pushRows({ state: { on: false }, status: null, reason: null }, now);
  const [, offGroup, offCheck] = notifyRows(st, now, { push: off });
  assert.deepEqual(rows(offGroup), [["Push", ""]]);
  assert.match(offGroup.footer, /^Push sends this iPhone's push token and the apps you follow/);
  assert.equal(offCheck.footer, "iOS decides when this runs, usually every few hours.");
  // a Push error replaces only Push's footer
  const broken = pushRows({ state: { on: true }, status: { registered: false }, reason: null }, now);
  const [, brokenGroup, brokenCheck] = notifyRows(st, now, { push: broken });
  assert.equal(brokenGroup.footer, "The server no longer knows this iPhone. Turn Push off and on again.");
  assert.match(brokenCheck.footer, /^Used when Push can't reach/);
  // push can't work: no Push group, the Background Check group takes the header
  const why = pushRows({ state: { on: false }, reason: { code: "no_key", text: "sign.example has no APNs key." } }, now);
  const groups = notifyRows({ ...st, badges: true }, now, { push: why });
  assert.equal(groups.length, 2);
  assert.equal(groups[1].header, "Checking for Updates");
  assert.deepEqual(groups[1].rows.map((r) => r.label), ["Background Check", "Last Check"]);
  // no footer anywhere is two hints glued together: at most two sentences
  for (const g of [pushGroup, check, offGroup, offCheck, brokenGroup, brokenCheck, ...groups]) {
    assert.ok((g.footer.match(/[.!?](\s|$)/g) ?? []).length <= 2, g.footer);
  }
});

// F128: Settings' pages and their titles, like iOS 6's (the root, General, Theme, Updates, a list page under one),
// and the older one-segment routes other screens still link to.
test("F128: page titles for the iOS 6-style routes and the old ones", async () => {
  const { nav } = await import("./settings.js");
  const t = (...path) => nav({ tab: "home", path }).title;
  assert.equal(t(), "Settings");
  assert.equal(t("general"), "General");
  assert.equal(t("theme"), "Theme"); // F205: was Display
  assert.equal(t("display"), "Theme"); // the old route still opens it
  assert.equal(t("updates"), "Updates");
  assert.notEqual(t("about"), "About"); // F183: no About page
  assert.equal(t("general", "device"), "Device");
  assert.equal(t("updates", "holds"), "Ignored Upgrades");
  assert.equal(t("signing"), "Signing");
  assert.equal(t("signing", "resignReminder"), "Re-sign Reminder");
  assert.equal(t("device"), "Device"); // Home's hint
  assert.equal(t("iosVersion"), "iOS Version"); // a package page's link
  assert.equal(t("holds"), "Ignored Upgrades");
  assert.equal(t("account"), "iFizBox Account");
});

// F134: Settings > Signing like an iOS 6 settings page: the certificate first, then its profile, the options, and How
// Signing Works as a link at the bottom.
test("F134: the Signing page's groups, in order, for each build and state", async () => {
  const { signingLayout, splitSummary, HELP } = await import("./settings.js");
  const { SIGNING_GROUPS } = await import("../core/settings.js");
  assert.deepEqual(SIGNING_GROUPS.slice(0, 5), ["certificate", "files", "profile", "account", "options"]);
  assert.equal(SIGNING_GROUPS.at(-1), "help");
  // the sideload app, set up
  assert.deepEqual(signingLayout({ mode: "sideload", certificate: true, profile: true, options: true }),
    ["certificate", "profile", "account", "options", "server", "status", "help"]);
  // nothing yet: the certificate's Import row, the options, the server, then the walkthrough's link
  assert.deepEqual(signingLayout({ mode: "sideload", options: true }), ["certificate", "account", "options", "server", "status", "help"]);
  // a file picked, one still missing: the Files group under the certificate
  assert.deepEqual(signingLayout({ mode: "sideload", staged: true, options: true }), ["certificate", "files", "account", "options", "server", "status", "help"]);
  // the website: no options, server or Signed Apps; Install iFizBox App once the certificate works
  assert.deepEqual(signingLayout({ mode: "site", certificate: true, profile: true, ready: true }), ["certificate", "profile", "account", "app", "other", "help"]);
  // F254j: no certificate on the website: Use a Free Apple ID before the walkthrough's link; never in the app builds
  assert.deepEqual(signingLayout({ mode: "site" }), ["certificate", "account", "other", "free", "help"]);
  assert.ok(signingLayout({ mode: "site", staged: true }).includes("free"));
  assert.ok(!signingLayout({ mode: "sideload" }).includes("free"));
  assert.ok(!signingLayout({ mode: "jailbreak" }).includes("free"));
  // B118a: Apple Developer Account with or without a certificate, on sideload and the website; never jailbreak
  for (const mode of ["sideload", "site"]) {
    for (const certificate of [true, false]) {
      assert.ok(signingLayout({ mode, certificate, profile: certificate, options: true, ready: certificate }).includes("account"), `${mode} ${certificate}`);
    }
  }
  assert.ok(!signingLayout({ mode: "jailbreak", certificate: true }).includes("account"));
  // each layout is in SIGNING_GROUPS order with no group twice
  for (const l of [signingLayout({ mode: "sideload", certificate: true, staged: true, profile: true, options: true }), signingLayout({ mode: "site", staged: true })]) {
    assert.deepEqual(l, SIGNING_GROUPS.filter((g) => l.includes(g)));
    assert.equal(new Set(l).size, l.length);
  }
  // the summary's rows split into the two groups, no row in both
  const rows = [{ label: "Certificate", detail: "iPhone Distribution: Jane Doe" }, { label: "Team", detail: "Jane" },
    { label: "Certificate Expires", detail: "1/1/27" }, { label: "Profile", detail: "Wild" }, { label: "Profile Expires", detail: "2/2/27" },
    { label: "Devices", detail: "3" }, { label: "App ID", detail: "ABC.*" }];
  const split = splitSummary(rows);
  assert.deepEqual(split.certificate.map((r) => [r.label, r.detail ?? r.subtitle]), [["Name", "iPhone Distribution: Jane Doe"], ["Team", "Jane"], ["Expires", "1/1/27"]]);
  assert.equal(split.certificate[0].subtitle, "iPhone Distribution: Jane Doe"); // long: under the label
  assert.deepEqual(split.profile.map((r) => r.label), ["Name", "Expires", "Devices", "App ID"]);
  assert.equal(HELP, "help");
});

// B118: Remove Certificate is no group of its own at the bottom: it sits beside Import/Replace Certificate in the
// Certificate group (two buttons in one row), on both builds and the website.
test("B118: Remove Certificate is beside Replace Certificate, in the Certificate group", async () => {
  const { signingLayout, certificateActions } = await import("./settings.js");
  const { SIGNING_GROUPS } = await import("../core/settings.js");
  assert.ok(!SIGNING_GROUPS.includes("remove"));
  for (const mode of ["sideload", "site", "jailbreak"]) {
    assert.ok(!signingLayout({ mode, certificate: true, staged: true, profile: true, ready: true }).includes("remove"), mode);
  }
  assert.deepEqual(certificateActions({ has: true }), ["Replace Certificate", "Remove Certificate"]);
  assert.deepEqual(certificateActions({ staged: true }), ["Import Certificate", "Remove Certificate"]); // files picked
  assert.deepEqual(certificateActions({}), ["Import Certificate"]); // nothing to remove: the Import row alone
  // the website: a stored identity whose profile can't be read can still be removed
  assert.deepEqual(certificateActions({ has: false, staged: false, removable: true }), ["Import Certificate", "Remove Certificate"]);
});

test("F134: the walkthrough is How Signing Works, a page below Signing", async () => {
  const { nav } = await import("./settings.js");
  assert.equal(nav({ path: ["signing", "help"] }).title, "How Signing Works");
  assert.equal(nav({ path: ["signing", "showExpiry"] }).title, "Show Expiry Dates");
});

// F149: the certificate's Password row reads as a field: a "Required" hint, not the file rows' "None", and a tap
// anywhere on the row (not its Browse button) puts the caret in it.
test("F149: Password row placeholder and tap-to-focus", async () => {
  const { passwordPlaceholder, focusOnRowTap } = await import("./settings.js");
  assert.equal(passwordPlaceholder(null, null), "Required");
  assert.equal(passwordPlaceholder({ profile: {} }, new Uint8Array(1)), "Required");
  assert.equal(passwordPlaceholder({ profile: {} }, null), "Not Kept");
  assert.notEqual(passwordPlaceholder(null, null), "None");

  let onClick = null, focused = 0;
  const li = { addEventListener: (type, fn) => { if (type === "click") onClick = fn; } };
  const input = { focus: () => { focused++; } };
  assert.equal(focusOnRowTap(li, input), li);
  onClick({ target: { closest: () => null } }); // the row's label or padding
  assert.equal(focused, 1);
  onClick({ target: { closest: (sel) => (sel === ".sign-browse" ? {} : null) } }); // Browse: its picker, not the field
  assert.equal(focused, 1);
  onClick({ target: input }); // the field itself focuses on its own
  assert.equal(focused, 1);
});

// B20: Settings > Signing > Signing Server's row opens an alert with a text field for your own server; Save stores
// the URL and checks it. Empty Save means the default.
test("B20: tapping the Signing Server row opens the alert with a field, Save stores the URL and runs the check", async () => {
  const { serverRow, askServer } = await import("./settings.js");
  const def = "https://sign.example.dev";
  let server = def, specs = [], checks = 0, redraws = 0, answer = { index: 1, value: "  https://my.worker.dev  " };
  const deps = { alert: async (spec) => { specs.push(spec); return answer; }, current: () => server, def: () => def,
    save: (s) => { server = s; }, check: async () => { checks++; }, redraw: () => { redraws++; } };
  let asked = null;
  const row = serverRow({ server, fallback: def, ask: () => { asked = askServer(null, deps); } });
  assert.equal(typeof row.onClick, "function");
  assert.equal(row.chevron, true);
  assert.equal(row.cls, "server-field-default"); // the default's host in the hint grey
  assert.equal(row.detail, "sign.example.dev");
  row.onClick();
  assert.equal(await asked, true);
  assert.equal(specs.length, 1);
  assert.equal(specs[0].input.type, "url");
  assert.equal(specs[0].input.value, ""); // the default shows as an empty field, its URL the placeholder
  assert.equal(specs[0].input.placeholder, def);
  assert.deepEqual(specs[0].buttons, ["Cancel", "Save"]);
  assert.equal(server, "https://my.worker.dev");
  assert.equal(checks, 1);
  assert.equal(redraws, 1);
  // your own server: in the field colour, and the field opens with it
  const own = serverRow({ server, fallback: def, ask: () => {} });
  assert.equal(own.cls, "server-field");
  assert.equal(own.detail, "my.worker.dev");
  answer = { index: 1, value: "" };
  await askServer(null, deps);
  assert.equal(specs[1].input.value, "https://my.worker.dev");
  assert.equal(server, def); // empty: back to the default
  // Cancel: nothing saved, no check
  answer = { index: 0, value: "https://other.dev" };
  assert.equal(await askServer(null, deps), false);
  assert.equal(server, def);
  assert.equal(checks, 2);
});

// B20: the web view's window focus comes back on an ordinary tap; a full redraw then swapped the rows under the finger
// and iOS dropped the click. Focus only re-reads signing.status; coming back from hidden still redraws.
test("B20: window focus doesn't redraw the Signing page unless the certificate changed", async () => {
  const { returnWatcher } = await import("./settings.js");
  const on = {};
  const target = () => ({ addEventListener: (t, fn) => { on[t] = fn; } });
  const doc = Object.assign(target(), { visibilityState: "visible", querySelector: () => ({}) });
  const win = target();
  let redraws = 0, ready = false;
  const check = returnWatcher({ doc, win, redraw: () => { redraws++; }, status: async () => (ready ? { identity: { profile: {} } } : { identity: null }),
    interval: () => {} });
  await check(); // the first look
  await on.focus();
  await on.focus();
  assert.equal(redraws, 0);
  ready = true; // a certificate landed while away
  await on.focus();
  assert.equal(redraws, 1);
  on.visibilitychange();
  assert.equal(redraws, 2);
});

// F183: no About page (no Check for Updates, no Skip This Version); the root ends with Home's version line.
// The shared fake DOM, without a <head> (the pages' styles stay out).
const settingsDoc = () => Object.assign(fakeDocument(), { head: null });
const fakeElement = (tag) => settingsDoc().createElement(tag);
// Each node's own text, in tree order.
const texts = (n, out = []) => { if (n._text) out.push(n._text); for (const c of n.children) texts(c, out); return out; };

test("F183: the about route is gone and Settings' root ends with the version line", async () => {
  // The root's sections fill in later (certificate, signer status) against this fake DOM: it stays (each test file
  // runs in its own process).
  globalThis.document = settingsDoc();
  const { render, nav } = await import("./settings.js");
  const { footLine } = await import("./home.js");
  assert.equal(nav({ path: ["about"] }).title, "Settings");
  const root = fakeElement("div");
  render(root, { tab: "home", path: [] });
  const [foot, commit] = root.children.slice(-2);
  assert.equal(foot.className, "home-version");
  assert.equal(commit.className, "home-version home-commit");
  assert.match(foot.textContent, /^iPhone, (iOS [^,]+, )?iFizBox Web \(/); // the website's line, as Home's
  assert.equal(foot.textContent.replace(/iOS [^,]+, /, ""), footLine({ web: true }));
  for (const t of texts(root)) assert.doesNotMatch(t, /^About$|Check for Updates|Skip This Version/);
});

test("F183: settings.js has no About page or update check left", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("./settings.js", import.meta.url), "utf8");
  for (const gone of ["aboutPage", "aboutRow", "checkUpdates", "setSkip", "Check for Updates", "Skip This Version", '"about"']) {
    assert.equal(src.includes(gone), false, gone);
  }
});

// F205: iOS 6 Settings' row tiles. The root's page rows and General's settings carry one; Theme's Appearance choices
// (Automatic / Light / Dark) stay bare, as iOS 6 leaves option rows. Compatibility Marks is on General now.
test("F205: Settings root, General and Theme rows carry iOS 6 tiles where iOS 6 would", async () => {
  globalThis.document = settingsDoc(); // the pages put switches in by querySelector(".group"), (".cell-inner")
  const { render } = await import("./settings.js");
  const cells = (n, out = []) => {
    if (n.className === "cell") out.push(n);
    for (const c of n.children ?? []) cells(c, out);
    return out;
  };
  const rows = (path) => {
    const root = fakeElement("div");
    render(root, { tab: "home", path });
    return cells(root).map((li) => {
      const inner = li.children[0];
      const icon = inner.children.find((c) => String(c.className).startsWith("cell-icon"));
      const label = texts(inner.children.find((c) => c.className === "cell-text"))[0];
      return [label, icon ? icon.className : null, icon?.children[0]?.src?.slice(0, 19) ?? null];
    });
  };
  const root = rows([]);
  for (const name of ["General", "Theme", "Updates"]) {
    assert.deepEqual(root.find((r) => r[0] === name), [name, "cell-icon row-icon", "data:image/svg+xml,"], name);
  }
  assert.equal(root.some((r) => r[0] === "Display"), false);
  const general = rows(["general"]);
  const at = (label) => general.findIndex((r) => r[0] === label);
  assert.equal(at("Compatibility Marks"), at("Works on My Phone") + 1);
  for (const r of general) assert.equal(r[1], "cell-icon row-icon", r[0]);
  // F199: Theme is Mode (a segmented control, no rows) and Themes' two push rows, bare like iOS 6's.
  // F201: Style's choice rows come first (F202: iOS 13 the third, F203: iOS 26 the fourth).
  const theme = rows(["theme"]);
  assert.deepEqual(theme.map((r) => r[0]), ["iOS 6", "iOS 7", "iOS 13", "iOS 26", "Light", "Dark"]);
  for (const r of theme) assert.equal(r[1], null, r[0]);
  assert.deepEqual(rows(["display"]).map((r) => r[0]), ["iOS 6", "iOS 7", "iOS 13", "iOS 26", "Light", "Dark"]); // the old route
  // each theme list: a checked row per theme, each with its swatch
  // (then the preview's sample rows, which start at Sources)
  const list = (k) => { const r = rows(["theme", k]); return r.slice(0, r.findIndex((x) => x[0] === "Sources")).map((x) => [x[0], x[1]]); };
  assert.deepEqual(list("darkTheme"),
    ["OLED Black", "Gunmetal", "Midnight", "Linen", "Nord", "Dracula", "Leather", "Felt", "Wood"].map((t) => [t, "cell-icon theme-swatch"]));
  assert.deepEqual(list("lightTheme"),
    ["Classic", "Sepia", "Solarized Light", "Legal Pad", "Brushed Metal"].map((t) => [t, "cell-icon theme-swatch"]));
});

// F199: Settings > Theme: Mode (segmented Automatic / Light / Dark) under its header, then Themes with Light and Dark
// rows whose detail is the theme chosen; the segments set Mode.
test("F199: Theme page: Mode's segmented control, then Light > Classic and Dark > OLED Black", async () => {
  const { render, settings } = await import("./settings.js");
  const find = (n, pred, out = []) => { for (const c of n.children ?? []) { if (pred(c)) out.push(c); find(c, pred, out); } return out; };
  const was = [settings.get("appearance"), settings.get("darkTheme")];
  try {
    settings.set("appearance", "dark");
    settings.set("darkTheme", "oled");
    const root = fakeElement("div");
    render(root, { tab: "home", path: ["theme"] });
    const [style, mode, themes] = root.children; // F201: Style first
    assert.equal(style.children[0].textContent, "Style");
    assert.deepEqual(mode.children.map((c) => String(c.className).split(" ")[0]), ["group-header", "store-segmented", "group-footer"]);
    assert.equal(mode.children[0].textContent, "Mode");
    const bar = mode.children[1];
    assert.equal(bar.attrs.role, "radiogroup");
    assert.deepEqual(bar.children.map((b) => [b.textContent, b.attrs.role, b.attrs["aria-selected"]]),
      [["Automatic", "radio", "false"], ["Light", "radio", "false"], ["Dark", "radio", "true"]]);
    assert.equal(themes.children[0].textContent, "Themes");
    const details = find(themes, (c) => c.className === "cell-detail").map((c) => c.textContent);
    assert.deepEqual(details, ["Classic", "OLED Black"]);
    settings.set("darkTheme", "gunmetal");
    assert.equal(settings.get("darkTheme"), "gunmetal");
  } finally { settings.set("appearance", was[0]); settings.set("darkTheme", was[1]); }
});

// F201: Theme > Style: iOS 6 checked by default; picking iOS 7 checks it, hides iOS 6's Themes rows and puts
// data-style="ios7" on <html> with its own two themes.
test("F201: Theme > Style picks iOS 7, which hides the Themes rows and sets data-style", async () => {
  const { render, settings, applyTheme } = await import("./settings.js");
  const labels = (root) => {
    const out = [];
    const walk = (n) => { for (const c of n.children ?? []) { if (c.className === "cell-label") out.push(c.textContent); walk(c); } };
    walk(root);
    return out;
  };
  const was = [settings.get("style"), settings.get("appearance")];
  try {
    assert.equal(settings.defaultOf("style"), "ios6");
    settings.set("style", "ios7");
    const root = fakeElement("div");
    render(root, { tab: "home", path: ["theme"] });
    assert.deepEqual(labels(root).slice(0, 2), ["iOS 6", "iOS 7"]);
    assert.equal(labels(root).includes("Light"), false);
    assert.equal(labels(root).includes("Dark"), false);
    const html = { dataset: {} };
    const doc = { documentElement: html, querySelectorAll: () => [] };
    settings.set("appearance", "light");
    applyTheme(doc, { matchMedia: () => ({ matches: false }), location: { hash: "" } });
    assert.deepEqual([html.dataset.style, html.dataset.theme, html.dataset.palette], ["ios7", "light", "white"]);
    settings.set("appearance", "dark");
    applyTheme(doc, { matchMedia: () => ({ matches: false }), location: { hash: "" } });
    assert.deepEqual([html.dataset.style, html.dataset.theme, html.dataset.palette], ["ios7", "dark", "oled"]);
    settings.set("style", "ios6");
    applyTheme(doc, { matchMedia: () => ({ matches: false }), location: { hash: "" } });
    assert.equal(html.dataset.style, "ios6");
  } finally { settings.set("style", was[0]); settings.set("appearance", was[1]); }
});

// F202: iOS 13 is the third Style: its own White / OLED Black like iOS 7, plus its two nav hooks, card sheets
// (<html data-sheet="card">) and large titles (<html data-nav="large">, nav/navbar.js), both gone again in iOS 6.
test("F202: Theme > Style picks iOS 13: data-style, its two themes, card sheets and large titles", async () => {
  // an import glued onto a comment line drops its names silently (showAlert once did)
  const src = await (await import("node:fs/promises")).readFile(new URL("./settings.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\/\/[^\n]*\bimport \{[^\n]*\} from "/);
  const { render, settings, applyTheme } = await import("./settings.js");
  const was = [settings.get("style"), settings.get("appearance")];
  const attrs = {};
  const html = { dataset: {}, getAttribute: (k) => attrs[k] ?? null,
    setAttribute: (k, v) => { attrs[k] = String(v); }, removeAttribute: (k) => { delete attrs[k]; } };
  const doc = { documentElement: html, querySelectorAll: () => [], getElementById: () => null };
  const win = { matchMedia: () => ({ matches: false }), location: { hash: "" } };
  try {
    settings.set("style", "ios13");
    const root = fakeElement("div");
    render(root, { tab: "home", path: ["theme"] });
    const labels = [];
    const walk = (n) => { for (const c of n.children ?? []) { if (c.className === "cell-label") labels.push(c.textContent); walk(c); } };
    walk(root);
    assert.deepEqual(labels.slice(0, 3), ["iOS 6", "iOS 7", "iOS 13"]);
    assert.equal(labels.includes("Light"), false); // iOS 6's Themes rows hide, as under iOS 7
    settings.set("appearance", "light");
    applyTheme(doc, win);
    assert.deepEqual([html.dataset.style, html.dataset.theme, html.dataset.palette], ["ios13", "light", "white"]);
    assert.equal(attrs["data-sheet"], "card");
    const { applyStyleHooks } = await import("./settings.js");
    await applyStyleHooks("ios13", doc);
    assert.equal(attrs["data-nav"], "large");
    settings.set("appearance", "dark");
    applyTheme(doc, win);
    assert.deepEqual([html.dataset.style, html.dataset.theme, html.dataset.palette], ["ios13", "dark", "oled"]);
    settings.set("style", "ios6");
    applyTheme(doc, win);
    await applyStyleHooks("ios6", doc);
    assert.equal(html.dataset.style, "ios6");
    assert.equal(attrs["data-sheet"], undefined);
    assert.equal(attrs["data-nav"], undefined);
  } finally {
    settings.set("style", was[0]); settings.set("appearance", was[1]);
    (await import("../nav/navbar.js")).setLargeTitles(false, doc);
  }
});

// F203: iOS 26 is the fourth Style: its own White / OLED Black, card sheets, large titles and the floating tab bar
// (<html data-tabbar="float">, nav/tabbar.js setFloatingTabbar), all three gone again in iOS 6 and iOS 13 drops
// only the tab bar.
test("F203: Theme > Style picks iOS 26: data-style, its two themes, card sheets, large titles, floating tab bar", async () => {
  const { render, settings, applyTheme, applyStyleHooks } = await import("./settings.js");
  const was = [settings.get("style"), settings.get("appearance")];
  const attrs = {};
  const html = { dataset: {}, getAttribute: (k) => attrs[k] ?? null,
    setAttribute: (k, v) => { attrs[k] = String(v); }, removeAttribute: (k) => { delete attrs[k]; } };
  const doc = { documentElement: html, querySelectorAll: () => [], getElementById: () => null };
  const win = { matchMedia: () => ({ matches: false }), location: { hash: "" } };
  try {
    settings.set("style", "ios26");
    const root = fakeElement("div");
    render(root, { tab: "home", path: ["theme"] });
    const labels = [];
    const walk = (n) => { for (const c of n.children ?? []) { if (c.className === "cell-label") labels.push(c.textContent); walk(c); } };
    walk(root);
    assert.deepEqual(labels.slice(0, 4), ["iOS 6", "iOS 7", "iOS 13", "iOS 26"]);
    assert.equal(labels.includes("Light"), false); // iOS 6's Themes rows hide, as under iOS 7 and iOS 13
    settings.set("appearance", "light");
    applyTheme(doc, win);
    assert.deepEqual([html.dataset.style, html.dataset.theme, html.dataset.palette], ["ios26", "light", "white"]);
    assert.equal(attrs["data-sheet"], "card");
    assert.equal(attrs["data-tabbar"], "float");
    await applyStyleHooks("ios26", doc);
    assert.equal(attrs["data-nav"], "large");
    settings.set("appearance", "dark");
    applyTheme(doc, win);
    assert.deepEqual([html.dataset.style, html.dataset.theme, html.dataset.palette], ["ios26", "dark", "oled"]);
    settings.set("style", "ios13");
    applyTheme(doc, win);
    await applyStyleHooks("ios13", doc);
    assert.deepEqual([attrs["data-sheet"], attrs["data-nav"], attrs["data-tabbar"]], ["card", "large", undefined]);
    settings.set("style", "ios6");
    applyTheme(doc, win);
    await applyStyleHooks("ios6", doc);
    assert.deepEqual([attrs["data-sheet"], attrs["data-nav"], attrs["data-tabbar"]], [undefined, undefined, undefined]);
  } finally {
    settings.set("style", was[0]); settings.set("appearance", was[1]);
    (await import("../nav/navbar.js")).setLargeTitles(false, doc);
  }
});

test("F199: the theme lists preview their tone; other routes don't", async () => {
  const { previewOf } = await import("./settings.js");
  const r = (...path) => ({ tab: "home", path: ["settings", ...path] });
  assert.equal(previewOf(r("theme", "darkTheme")), "dark");
  assert.equal(previewOf(r("theme", "lightTheme")), "light");
  assert.equal(previewOf(r("display", "darkTheme")), "dark"); // Theme's old id
  assert.equal(previewOf(r("darkTheme")), "dark"); // the one-segment form
  assert.equal(previewOf(r("theme")), null);
  assert.equal(previewOf(r("general", "darkTheme")), null);
  assert.equal(previewOf({ tab: "sources", path: ["darkTheme"] }), null);
  assert.equal(previewOf(null), null);
});

test("picking a theme in Theme > Light / Dark switches Mode to that tone", async () => {
  const { pick } = await import("./settings.js");
  const { SETTINGS } = await import("../core/settings.js");
  const d = (k) => SETTINGS.find((s) => s.key === k);
  settings.set("appearance", "auto");
  pick(d("lightTheme"), "sepia");
  assert.equal(settings.get("lightTheme"), "sepia");
  assert.equal(settings.get("appearance"), "light");
  pick(d("darkTheme"), "nord");
  assert.equal(settings.get("appearance"), "dark");
  pick(d("device"), "none"); // not a theme list: Mode stays
  assert.equal(settings.get("appearance"), "dark");
});

test("F231: opening Theme > Light or Dark switches Mode to that tone, without picking a theme", async () => {
  const { render } = await import("./settings.js");
  const was = [settings.get("appearance"), settings.get("lightTheme"), settings.get("darkTheme")];
  try {
    settings.set("appearance", "light");
    render(fakeElement("div"), { tab: "home", path: ["theme", "darkTheme"] });
    assert.equal(settings.get("appearance"), "dark");
    assert.deepEqual([settings.get("lightTheme"), settings.get("darkTheme")], was.slice(1), "no theme picked");
    settings.set("appearance", "auto");
    render(fakeElement("div"), { tab: "home", path: ["theme", "lightTheme"] });
    assert.equal(settings.get("appearance"), "light");
    render(fakeElement("div"), { tab: "home", path: ["theme"] }); // Theme itself, and other pages: Mode stays
    render(fakeElement("div"), { tab: "home", path: ["general"] });
    assert.equal(settings.get("appearance"), "light");
  } finally { settings.set("appearance", was[0]); }
});

// F215/F230: Theme > Light / Dark's preview is a movable split. Geometry in page px (an iPhone 7 web app: 647 tall, nav
// to 64, tab bar from 598); rows 44px from y 74 (a group's 10px margin), the footer 40px under the last.
const rowsFrom = (n) => [...Array.from({ length: n }, (_, i) => 74 + 44 * (i + 1)), 74 + 44 * n + 40 + 10];
const splitGeo = (n) => ({ top: 64, bottom: 598, screen: 647, edges: rowsFrom(n) });

test("F230: the preview's split: a 100px peek on entry (snapped to a row edge), half after a tap, a drag wins", async () => {
  const { entrySplit, splitHeight, clampSplit, SPLIT_PEEK, SPLIT_MIN } = await import("./settings.js");
  const geo = splitGeo;
  assert.equal(SPLIT_PEEK, 100);
  assert.ok(SPLIT_PEEK >= SPLIT_MIN);
  // Dark's six themes end at 388 (footer and gap): far above the peek's line (498), so the preview is just the peek
  assert.equal(entrySplit(geo(6)), 100);
  assert.equal(entrySplit(geo(3)), 100); // Light's three
  // twelve rows reach past the line: the divider snaps up to the row edge above it (row 9 ends at 470), never cutting one
  const twelve = entrySplit(geo(12));
  assert.equal(twelve, 598 - 470);
  assert.ok(geo(12).edges.includes(598 - twelve), "the divider sits on a row's bottom edge");
  assert.ok(twelve >= SPLIT_PEEK && twelve < SPLIT_PEEK + 44);
  // an edge exactly on the line is used as is
  assert.equal(entrySplit({ top: 64, bottom: 598, screen: 647, edges: [498, 542] }), 100);
  // a tap: half the screen
  assert.equal(splitHeight(geo(12), { tapped: true }), Math.round(647 / 2));
  assert.equal(splitHeight(geo(6), { tapped: true }), Math.round(647 / 2));
  assert.equal(splitHeight(geo(12), {}), twelve);
  // a dragged height (px, this visit) wins over both, and stays inside the page
  assert.equal(splitHeight(geo(12), { dragged: 259 }), 259);
  assert.equal(splitHeight(geo(12), { dragged: 259, tapped: true }), 259);
  assert.equal(splitHeight(geo(12), { dragged: 10, tapped: true }), SPLIT_MIN);
  assert.equal(clampSplit(10, geo(1)), 64);
  assert.equal(clampSplit(900, geo(1)), 598 - 64 - 44);
});

test("F230: the split lasts one visit: leave and re-enter -> the peek; nothing stored, F215's key removed once", async () => {
  const { render, splitTapped, splitDropped, splitNow, SPLIT_KEY } = await import("./settings.js");
  const dark = { tab: "home", path: ["theme", "darkTheme"] };
  const geo = splitGeo(12);
  const peek = 598 - 470;
  render(fakeElement("div"), dark);
  assert.equal(splitNow(geo), peek);
  splitTapped(); // the first theme tap: half
  assert.equal(splitNow(geo), Math.round(647 / 2));
  splitTapped(); // later taps keep it
  assert.equal(splitNow(geo), Math.round(647 / 2));
  splitDropped(200); // the divider let go at 200
  splitTapped(); // a tap after a drag keeps the drag
  assert.equal(splitNow(geo), 200);
  render(fakeElement("div"), { tab: "home", path: ["theme"] }); // Back to Theme: no reset there...
  assert.equal(splitNow(geo), 200);
  render(fakeElement("div"), dark); // ...re-entering a theme list starts fresh
  assert.equal(splitNow(geo), peek);
  splitDropped(300); // a drag before any tap: the tap then keeps it
  splitTapped();
  assert.equal(splitNow(geo), 300);
  render(fakeElement("div"), { tab: "home", path: ["theme", "lightTheme"] });
  assert.equal(splitNow(geo), peek);
  // localStorage: the old key went, once, and nothing was written for the split
  assert.equal(SPLIT_KEY, "ifizbox.themePreviewSplit");
  assert.equal(lsData.has(SPLIT_KEY), false);
  assert.equal(lsLog.filter(([op, k]) => op === "remove" && k === SPLIT_KEY).length, 1);
  assert.deepEqual(lsLog.filter(([op]) => op === "set"), []);
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("./settings.js", import.meta.url), "utf8");
  for (const gone of ["savedSplit", "saveSplit", "SPLIT_FLOOR", "setItem(SPLIT_KEY"]) assert.equal(src.includes(gone), false, gone);
});

// F315: Keep Bundle IDs' group footer by state, one short sentence: what it does while nothing is wrong, the one
// thing that's wrong otherwise (never two notes joined), with How to Get Notifications in the group only while the
// ID is kept and the profile can't notify.
test("F315: Keep Bundle IDs' footer by state, one sentence, the guide row only when it helps", () => {
  const ADHOC_PUSH = { appId: "com.you.youtube", push: "production", kind: "Ad Hoc", wildcard: false };
  const ADHOC = { appId: "com.you.youtube", push: null, kind: "Ad Hoc", wildcard: false };
  const DEV = { appId: "com.you.youtube", push: "development", kind: "Development", wildcard: false };
  const WILD = { appId: "com.you.*", push: null, kind: "Ad Hoc", wildcard: true };
  assert.deepEqual(keepHint(null, true), { footer: "Apps keep their own IDs and notifications.", guide: false });
  assert.deepEqual(keepHint(ADHOC_PUSH, true), { footer: "Apps keep their own IDs and notifications.", guide: false });
  assert.deepEqual(keepHint(ADHOC, true), { footer: "Your profile has no Push, so kept IDs get no notifications.", guide: true });
  assert.deepEqual(keepHint(DEV, true), { footer: "Your development profile gets only Apple's test notifications, which apps don't use.", guide: true });
  assert.deepEqual(keepHint(WILD, true), { footer: "Your wildcard profile can't get notifications for kept IDs.", guide: true });
  for (const p of [null, ADHOC_PUSH, DEV, WILD]) {
    assert.deepEqual(keepHint(p, false), { footer: "Off, each app becomes a copy under your ID, without its notifications.", guide: false });
  }
  for (const p of [null, ADHOC_PUSH, ADHOC, DEV, WILD]) {
    for (const keep of [true, false]) {
      const { footer } = keepHint(p, keep);
      assert.equal((footer.match(/[.!?](\s|$)/g) ?? []).length, 1, footer);
      assert.ok(footer.length <= 100, footer);
    }
  }
});

// F347: Theme > Light / Dark's preview: a top bar (the divider, the sample's nav bar and its search bar) is the handle
// over a sample that scrolls on its own and works; a Remove / Install / Done row; the green button's tokens.
test("F347: the preview's top bar is the handle; the sample under it works and has Remove, Install and Done", async () => {
  globalThis.document = settingsDoc();
  const { render, toggleCheck } = await import("./settings.js");
  const all = (n, pred, out = []) => { for (const c of n.children ?? []) { if (pred(c)) out.push(c); all(c, pred, out); } return out; };
  const has = (n, cls) => String(n.className).split(" ").includes(cls);
  const root = fakeElement("div");
  render(root, { tab: "home", path: ["theme", "lightTheme"] });
  const [pane] = all(root, (n) => has(n, "theme-preview"));
  const [top, body] = pane.children;
  assert.ok(has(top, "theme-preview-top"));
  assert.ok(has(body, "theme-preview-body"));
  assert.deepEqual(top.children.map((c) => c.className), ["theme-preview-grip", "navbar theme-preview-bar", "search-bar"]);
  const inputs = all(top, (n) => n.type === "search");
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].readOnly, true);
  assert.equal(body.inert, undefined); // not inert any more
  assert.equal(all(body, (n) => has(n, "navbar") || has(n, "search-bar")).length, 0);
  const [colours] = all(body, (n) => has(n, "theme-preview-colours"));
  assert.deepEqual(colours.children.map((c) => [c.className, c.textContent]),
    [["bar-button red", "Remove"], ["bar-button green", "Install"], ["bar-button done", "Done"]]);
  // the Checked row toggles its mark
  const inner = fakeElement("button");
  inner.append(Object.assign(fakeElement("span"), { className: "cell-check" }));
  assert.equal(toggleCheck(inner), false);
  assert.equal(inner.children.length, 0);
  assert.equal(toggleCheck(inner), true);
  assert.equal(inner.children[0].className, "cell-check");
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("./settings.js", import.meta.url), "utf8");
  assert.match(src, /querySelector\("\.theme-preview-top"\)\?\.addEventListener\?\.\("pointerdown"/);
  assert.match(src, /loadStyle\("sources\.css"\)/);
});

test("F347: the green bar button's tokens in ios6.css, each era's own, Metal's white text, no strip over the sample bar", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = async (f) => readFile(new URL(`../${f}`, import.meta.url), "utf8");
  const ios6 = await css("ios6.css");
  assert.match(ios6, /--lt-green-edge: #1d6a1c; --lt-green-edge-top: #30363e;/);
  assert.match(ios6, /--lt-green: linear-gradient\(#8fd68d, #51b14f 49%, #3ba739 51%, #3ca83a\);/);
  assert.match(ios6, /--lt-green-pressed: linear-gradient\(#72b870, #3d9a3b 49%, #2a8a28 51%, #2b8b29\);/);
  for (const rule of [".bar-button.green:not(.back):not(.done), html[data-theme] .bar-button.green:not(.back):not(.done) {",
    "html[data-theme] .bar-button.green:not(.back):not(.done):is(:active, .is-pressed) {"]) {
    const at = ios6.indexOf(rule);
    assert.ok(at >= 0, rule);
    assert.match(ios6.slice(at, ios6.indexOf("}", at)), /background-origin: border-box/);
  }
  for (const [era, green] of [["ios7", "--i7-green"], ["ios13", "--i13-green"], ["ios26", "--i26-green"]]) {
    const src = await css(`${era}.css`);
    assert.match(src, new RegExp(`html\\[data-style="${era}"\\] \\{\\s*--lt-green-edge: [^;]+; --lt-green-edge-top: [^;]+; --lt-green: `), era);
    assert.ok(src.includes(`html[data-style="${era}"] .bar-button.green:not(.back):not(.done) { color: var(${green}); }`), era);
  }
  assert.match(await css("palettes.css"), /\.bar-button:not\(\.done\):not\(\.red\):not\(\.green\):not\(\.manage-delete\)/);
  const settingsCss = await css("settings.css");
  assert.ok(settingsCss.includes('html[data-shell] .theme-preview .navbar.theme-preview-bar::before'));
  assert.match(settingsCss, /\.theme-preview-grip \{ background: linear-gradient\(#5a5b5d, #333435 2px\) #333435; box-shadow: inset 0 -1px #121212; \}/);
});
