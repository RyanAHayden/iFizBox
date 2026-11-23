// F75: ifizbox:// links the shell hands over (native/Sources/App.swift, Incoming): it keeps the latest, sends
// "ifizbox:url" on window, and the page takes it with app.takeURL (also once at start, for a link that launched the
// app before the page was there).
//   ifizbox://import?d=<gzipped JSON>   Open in iFizBox App on the website: the review alert (screens/importlink.js)
//   ifizbox://install?url=<ipa>[&name=…]  F89: the Install IPA alert, then Install (signAndInstall). The website's app
//                                      page sent it (Open in iFizBox) until F92/F95 dropped the hand-offs; kept for
//                                      links already out there and anyone's own pages
//   ifizbox://myipas?file=<name>        F77: an .ipa another app sent, already in My IPAs (MyIPAs.swift): its page
//   ifizbox://add?url=<url>[&suite=…]   N8: the Add Source intent: the Sources tab, Add Source's alert filled in over
//                                      it (core/handoff.js); N9: also an APT repo or AltStore source shared with iFizBox
//   ifizbox://shared?route=…            N9: an .ipa or .deb shared with iFizBox, or why not (share.js)
//   ifizbox://package?id=<id>           F96: the website's Install in iFizBox: that app's page (Search's package:<id>)
//   ifizbox://account?k=<key>           F97: a iFizBox Account's link or QR code: Sign In With Key, filled in
//   ifizbox://<tab>                     B14: home, sources, changes, installed, search, settings: that tab, at its root
//   altstore://source?url=…, feather://install/<ipa>, …   F83: other sideloaders' links (core/otherlinks.js), when
//                                      Settings > Sideloading > Open Other Apps' Links is on: a source goes to the Sources
//                                      tab, Add Source filled in over it; an IPA to Install IPAs, then Install (signAndInstall).
//                                      Off, or a link iFizBox has no use for: handed back (handBack below)
//
//   B175: the app run's log (screens/apprun.js) still up with its run over closes when iFizBox comes back to the
//   front and before any link opens; a run still going asks first (clearRunPage)
//
//   startIncoming({ native })          once, in the app
//   await handleIncoming(url, deps)    -> "import" | "install" | "myipas" | "add" | "shared" | "package" | "account" | "tab" | "other-source" |
//                                         "other-install" | "other-app" | null (not one of ours)
// SPDX-License-Identifier: GPL-3.0-or-later
import { showAlert } from "./nav/alert.js";
import { showHUD, liveHUD } from "./nav/hud.js";
import { format, ALL_TABS } from "./router.js";
import { parseAddLink } from "./core/handoff.js";
import { parseOtherLink, otherLinksOn } from "./core/otherlinks.js";
import { packageIdOf } from "./websign-gate.js";
import { NAME } from "./brand.js";
import { markHandoff } from "./handoffclock.js";
import { nativeBridge } from "./native.js";
import { leftOffAlert } from "./core/installroute.js"; // B395

// B395: the shell's word that cellular data or the user's VPN stayed off after an install (vpn.leftOff answers once
// something did, however long that takes), as an alert; then it waits for the next. Ends on a shell without the call.
export async function watchLeftOff({ native = nativeBridge(), alert = showAlert } = {}) {
  if (!native?.call) return;
  for (;;) {
    let off = null;
    try { off = await native.call("vpn.leftOff", {}); } catch { return; }
    const a = leftOffAlert(off);
    if (!a) return;
    await alert(a);
  }
}

export function startIncoming({ native = nativeBridge(), events = globalThis, doc = globalThis.document,
  runPage = defaultRunPage, alert = showAlert } = {}) {
  if (!native?.call) return;
  // B175: back in front (reopened, or a link or file brought it up) with the app run's log still up and its run over:
  // that page closes. A link's take does the same before it opens anything (clearRunPage).
  doc?.addEventListener?.("visibilitychange", () => {
    if (doc.visibilityState === "hidden") return;
    Promise.resolve(runPage()).then((p) => { if (p && !p.busy && !p.aside) return p.dismiss(); }).catch(() => {});
  });
  let busy = false;
  let again = false; // B174: an "ifizbox:url" while a take ran: take once more after it
  const take = async () => {
    if (busy) { again = true; return; }
    busy = true;
    try {
      do {
        again = false;
        for (;;) {
          let r = null;
          // B174: a link the shell kept after this call's empty answer left (a cold launch's IPA, still being copied
          // as the page started) comes with its own "ifizbox:url": `again` takes it, where it used to be dropped.
          try { r = await native.call("app.takeURL", {}); } catch { return; } // an older shell
          if (!r?.url) break;
          markHandoff();
          await clearRunPage(r.url, { runPage, alert }); // B175: the finished run's log closes first
          markHandoff();
          await handleIncoming(r.url, { native });
          markHandoff(); // its page just opened: Return Home After leaves it there (handoffclock.js)
        }
      } while (again);
    } finally { busy = false; trail(); }
  };
  const trail = () => { takeOpenLog({ native }).catch(() => {}); };
  events.addEventListener("ifizbox:openlog", trail);
  events.addEventListener("ifizbox:url", () => { markHandoff(); return take(); });
  const receiving = onReceiving();
  events.addEventListener("ifizbox:receiving", (e) => { markHandoff(); receiving(e.detail); });
  return take();
}

// B175: the app run's page (screens/apprun.js runPage), loaded only once a link comes.
const defaultRunPage = () => import("./screens/apprun.js").then((m) => m.runPage()).catch(() => null);

// B175: before a link opens anything, the app run's log (Apps/Log) gets out of its way. Over: it closes and the link
// opens once it has gone. Still running: an alert asks; Wait (the default) opens the link once the run ends (its page
// closed first), Open Now puts the page aside (it comes back with its result when the run ends) and opens the link on
// top. A page already put aside stays so.
//   await clearRunPage(url, { runPage, alert }) -> "none" | "closed" | "waited" | "on-top"
export const RUNNING_TITLE = "Install Running";
export async function clearRunPage(url, { runPage = defaultRunPage, alert = showAlert } = {}) {
  const page = await Promise.resolve(runPage()).catch(() => null);
  if (!page) return "none";
  if (!page.busy) { await page.dismiss(); return "closed"; }
  if (page.aside) return "on-top";
  const { index } = await alert({ title: RUNNING_TITLE, message: runningText(url), buttons: ["Open Now", "Wait"], cancel: 1 });
  if (page.busy && index === 0) { page.putAside(); return "on-top"; }
  const waited = page.busy;
  await page.ended();
  await page.dismiss();
  return waited ? "waited" : "closed";
}

export function runningText(url) {
  const u = String(url ?? "");
  let what = "";
  if (/^ifizbox:\/\/myipas\b/i.test(u)) what = myIpasPath(u)[1]?.slice(4) ?? "";
  else if (/^ifizbox:\/\/install\b/i.test(u)) { const a = installAsk(u); what = a ? a.name || ipaFileName(a.url) : ""; }
  const it = what ? what.slice(0, 80) : "What you opened";
  return `${it} opens once the apps being installed are done. Open it now, on top of the install?`;
}

// B166: the shell's trail of a hand-off (native/share/App/ShareBridge.swift OpenLog: every hop from iOS's scene
// callbacks to the page, "error: …" where one failed) into Settings > Console Logs, one entry per take, so a report
// of "nothing happened" shows where it stopped. Taken at start, after each link and on "ifizbox:openlog".
//   await takeOpenLog({ native, logs }) -> the entry added, or null (no lines, an older shell)
export async function takeOpenLog({ native = nativeBridge(), logs = null } = {}) {
  let r = null;
  try { r = await native.call("app.takeOpenLog", {}); } catch { return null; } // an older shell
  const lines = Array.isArray(r?.lines) ? r.lines.map(String) : [];
  if (!lines.length) return null;
  const store = logs ?? (await import("./queue.js")).runLogs;
  return store.add({ title: openLogTitle(lines), code: lines.some((l) => /\berror: /.test(l)) ? 1 : 0, text: lines.join("\n") });
}

// "Open in iFizBox: <file>" from the first "took <file>" line, else "Open in iFizBox".
export function openLogTitle(lines) {
  for (const l of lines) {
    const m = /(?:SharedInbox|MyIPAs): took (.+?)(?: \(|$)/.exec(l);
    if (m) return `Open in ${NAME}: ${m[1].slice(0, 80)}`;
  }
  return `Open in ${NAME}`;
}

// B163: a file another app handed over is being copied in (a 185 MB IPA from Safari takes a while): the shell sends
// "ifizbox:receiving" with {name, progress} (0...1), then progress null once done or failed (native/Sources/App.swift
// Incoming.receiving). A live HUD "Copying <name>… 42%" until then; the link that follows opens its page or an alert.
//   onReceiving({ hud }) -> (detail) => void   (hud: liveHUD's shape, for tests)
export function onReceiving({ hud = liveHUD } = {}) {
  let live = null;
  return (detail) => {
    const p = detail?.progress;
    if (typeof p !== "number" || !Number.isFinite(p)) {
      live?.hide();
      live = null;
      return;
    }
    const text = `Copying ${String(detail?.name ?? "the file").slice(0, 60)}… ${Math.round(Math.min(1, Math.max(0, p)) * 100)}%`;
    if (live) live.set(text);
    else live = hud(text);
  };
}

export async function handleIncoming(url, { native = nativeBridge(), alert = showAlert, hud = showHUD,
  review = null, add = null, shared = null, install = null, signIn = null, on = otherLinksOn, open = goHash, now = Date.now, reload = reloadInstalled, drop = dropMyIpas } = {}) {
  const u = String(url ?? "");
  if (/^ifizbox:\/\/install\b/i.test(u)) {
    const ask = installAsk(u);
    if (ask) await confirmInstall(ask.url, ask.name, `${ask.name || ipaFileName(ask.url)}\n${ask.url}`, { alert, install, open, reload, drop });
    return "install";
  }
  if (/^ifizbox:\/\/myipas\b/i.test(u)) {
    const path = myIpasPath(u);
    const hash = format({ tab: "installed", path }).replace(/^#/, "");
    if (typeof location !== "undefined") location.hash = hash;
    return "myipas";
  }
  if (/^ifizbox:\/\/add\b/i.test(u)) {
    const prefill = addPrefill(u);
    if (!prefill) return "add";
    await addFromLink(prefill, { add, hud, open });
    return "add";
  }
  if (/^ifizbox:\/\/shared\b/i.test(u)) {
    const run = shared ?? (await import("./share.js")).handleShared;
    await run(u, { native, alert, hud });
    return "shared";
  }
  if (/^ifizbox:\/\/package\b/i.test(u)) {
    const id = packageIdOf(u);
    if (id) open(format({ tab: "search", path: [`package:${id}`] }));
    return "package";
  }
  if (/^ifizbox:\/\/account\b/i.test(u)) {
    const run = signIn ?? (await import("./screens/account.js")).signInFromLink;
    await run(u, { open });
    return "account";
  }
  if (/^ifizbox:\/\/import\b/i.test(u)) {
    const run = review ?? (await import("./screens/importlink.js")).reviewAndImport;
    await run(u, { native });
    return "import";
  }
  const tab = tabOf(u);
  if (tab) {
    open(format({ tab, path: [] })); // a tab this build leaves out lands on Home (router.parse)
    return "tab";
  }
  const other = parseOtherLink(u);
  if (other) return handleOtherLink(u, other, { native, alert, hud, add, install, on, open, now, reload, drop });
  return null;
}

// B14: ifizbox://sources, ifizbox://changes/, … -> "sources", or null (not a bare tab link).
export function tabOf(link) {
  const m = /^ifizbox:\/\/([a-z]+)\/?(?:[?#].*)?$/i.exec(String(link ?? ""));
  const t = m?.[1].toLowerCase();
  return t && ALL_TABS.includes(t) ? t : null;
}

const goHash = (hash) => { if (typeof location !== "undefined") location.hash = hash.replace(/^#/, ""); };

// F83: another sideloader's link. On: iFizBox does what that app would have (a source, an IPA). Off, or a link only
// that app understands (a certificate export, a pairing callback): handed back.
async function handleOtherLink(u, other, { native, alert, hud, add, install, on, open, now, reload, drop }) {
  if (!on() || other.action === "other") return handBack(u, other, { native, alert, now, off: !on() });
  if (other.action === "source") {
    await addFromLink({ url: other.url }, { add, hud, open });
    return "other-source";
  }
  await confirmInstall(other.url, "", `${other.app} link: ${ipaFileName(other.url)}\n${other.url}`, { alert, install, open, reload, drop });
  return "other-install";
}

// B306: a source from a link (another app's, ifizbox://add): the Sources tab at its root (a plain tab switch, so the
// tab bar selects Sources), Add Source's alert filled in over it; once added, the new source shows in that list
// loading (sources.js onSourcesChanged, with the tab's own ctx: fromLink). No Manage page.
async function addFromLink(prefill, { add, hud, open }) {
  open(SOURCES_ROOT);
  const run = add ?? (await import("./screens/manage.js")).addSource;
  return run({ showHUD: hud, fromLink: true }, prefill);
}
export const SOURCES_ROOT = format({ tab: "sources" });

// Install IPAs opens under the alert; Install signs and installs (the sideload build's signAndInstall).
// B50: the jailbreak build has no signer (signAndInstall only says "Can't Install Here" there): Install downloads the
// IPA and installs it through the helper (ipa.install, screens/ipa-install.js's progress page), as Settings > Install
// IPA and a tapped .ipa link do, and remembers it for Installed's Apps.
// B281: once the run ends, Installed loads the signed records again (screens/installed.js reloadSigned): this install
// writes no record of its own, so its list row and the app's page would keep the record from before.
// B283: when the install lands, the app's My IPAs record goes (screens/installed.js dropMyIpasRecord), from the
// install's own answer, so a run that waits for a connection (rememberInstall) drops it too when it ends. The
// jailbreak build keeps no signed record, so there the drop does nothing: rememberIpa replaces the record instead.
async function confirmInstall(url, name, message, { alert, install, open, reload = reloadInstalled, drop = dropMyIpas }) {
  open(format({ tab: "installed", path: ["myipas"] }));
  const { index } = await alert({ title: "Install IPA", message, buttons: ["Cancel", "Install"], cancel: 0 });
  if (index !== 1) return false;
  const run = install ?? (await defaultInstall());
  let dropping = null;
  let ended = false;
  const again = () => Promise.resolve().then(() => reload()).catch(() => {});
  // A run that ends after confirmInstall has (rememberInstall) reloads Installed itself once its drop is done.
  const onInstalled = (r) => { dropping = Promise.resolve().then(() => drop(r)).catch(() => {}).then(() => (ended ? again() : null)); };
  try {
    await run({ url, name, onInstalled });
  } finally {
    await dropping;
    ended = true;
    await again();
  }
  return true;
}

// Installed's dropMyIpasRecord, loaded only once an install lands (never under node --test).
const dropMyIpas = async (answer) => {
  if (typeof document === "undefined") return false;
  return (await import("./screens/installed.js")).dropMyIpasRecord(answer);
};

// Installed's reloadSigned, loaded only once an install ends (and never under node --test, where no page runs).
const reloadInstalled = async () => {
  if (typeof document === "undefined") return;
  (await import("./screens/installed.js")).reloadSigned();
};

// What Install runs: the helper's ipa.install in the jailbreak build (`jailbreak`), else signAndInstall.
// `ipaInstall` and `remember` stand in for screens/ipa-install.js's openIpaInstall and rememberIpa (tests).
export async function defaultInstall({ jailbreak = null, ipaInstall = null, remember = null } = {}) {
  const { ipaInstallAvailable } = await import("./ipa-install.js");
  if (jailbreak ?? ipaInstallAvailable()) {
    const screen = ipaInstall && remember ? null : await import("./screens/ipa-install.js");
    const { ipaName } = await import("./core/ipainstall.js");
    const openIt = ipaInstall ?? screen.openIpaInstall;
    const keep = remember ?? screen.rememberIpa;
    return ({ url, name }) => openIt({ url, name, keep: true, onInstalled: (r) => keep(r, name || ipaName(url)) }); // F380
  }
  return (await import("./signing/install.js")).signAndInstall;
}

// F89: ifizbox://install?url=<https IPA>[&name=…] -> { url, name }, or null (no http(s) URL in it).
export function installAsk(link) {
  let q;
  try { q = new URL(String(link)).searchParams; } catch { return null; }
  const url = (q.get("url") ?? "").trim();
  if (!/^https?:\/\/[^\s/?#]+/i.test(url)) return null;
  return { url, name: (q.get("name") ?? "").trim().slice(0, 100) };
}

// iOS fixes URL schemes at install time and gives a scheme to one app when several claim it, so iFizBox can't pass a
// link on to the app it was for: it can only open it again, which reaches another app only where iOS picks that one
// (UIApplication.open says false when nothing answers). Where iOS picked iFizBox, opening it again comes straight
// back here: the same link within LOOP_MS is that echo, and gets the alert instead of a second try.
const LOOP_MS = 10_000;
let lastHandBack = { url: null, at: 0 };

async function handBack(u, other, { native, alert, now, off }) {
  const t = now();
  const echo = lastHandBack.url === u && t - lastHandBack.at < LOOP_MS;
  lastHandBack = echo ? { url: null, at: 0 } : { url: u, at: t };
  let opened = false;
  if (!echo && native?.call) {
    try { opened = (await native.call("app.openURL", { url: u }))?.opened === true; } catch { /* an older shell */ }
  }
  if (opened) return "other-app";
  await alert({ title: `${other.app} Link`, message: handBackText(other, off), buttons: ["OK"] });
  return "other-app";
}

export function handBackText(other, off) {
  const why = `This link was for ${other.app}, and iOS sent it to ${NAME}: iOS gives each kind of link to one app, so ${NAME} can't pass it on.`;
  if (off) return `${why} Turn on Settings > Sideloading > Open Other Apps' Links to open links like it in ${NAME}.`;
  return `${why} Only ${other.app} can do what this link asks.`;
}

const ipaFileName = (url) => {
  try { return decodeURIComponent(new URL(url).pathname.split("/").pop() || "") || new URL(url).host; } catch { return url; }
};

// N8: ifizbox://add?url=…[&suite=…&component=…] -> Add Source's prefill ({ url, dist?, components? }), or null.
export function addPrefill(url) {
  let search = "";
  try { search = new URL(String(url)).search; } catch { return null; }
  return parseAddLink(search);
}

// F77: the Installed path for ifizbox://myipas?file=<name>: the IPA's page, or the library when the name is missing.
export function myIpasPath(url) {
  let file = null;
  try { file = new URL(String(url)).searchParams.get("file"); } catch { /* none */ }
  return file && /\.ipa$/i.test(file) && !file.includes("/") ? ["myipas", `ipa:${file}`] : ["myipas"];
}
