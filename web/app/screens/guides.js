// Home's User Guides, as Cydia's Home had them below Recommended Sources (cydia.saurik.com/ui/ios~iphone/1.1/home/:
// Frequently Asked Questions, Copying Files to/from Device, OpenSSH Access How-To, Root Password How-To), rewritten
// for today's rootless jailbreaks. F157 (user 2026-11-18, the approved concept): each guide is an iOS 6 app page
// built from ios6.css's grouped tables (styles in guides.css):
//   faq          question rows grouped Getting Started / Problems / Sources; each opens faq/<id> on Home's stack: a
//                bold question, the answer in a white cell (or numbered steps) and a Next group to the places it names
//   copying      a segmented control (nav/ui.js segmented, ios6.css .store-segmented): On iPhone (Filza) / Computer (SFTP) / No Jailbreak
//   openssh      numbered steps whose blue badges tick green when tapped (kept per guide in localStorage), the
//                OpenSSH package's Install row, the ssh command in a terminal panel with Copy (F151's log look)
//   password     a yellow warning row, the whole session as a terminal transcript, then the steps with Copy
// Lite (Not Jailbroken: the sideload IPA, and the website while Settings > Device says so, as F144): no OpenSSH or
// Root Password guide, an FAQ about apps, signing and sources only, and Copying Files as the no-jailbreak page
// (Files, AirDrop, LocalSend; From a Computer per system, F176). Nothing jailbreak-only is named there (guides.test.js).
// Cydia's Storage Information and Developers Only are left out: there's no storage page to show.
import { el, grouped, row, segmented } from "../nav/ui.js";
import { go as navGo } from "../nav/go.js";
import { format, settingsRoute, rootOn } from "../router.js";
import { KEY_PREFIXES } from "../core/storagekeys.js";
import { NAME } from "../brand.js";
import { GUIDE_ID as KEEP_GUIDE } from "../core/keepid.js";
import { UDID_HOW } from "../core/signing.js";
import { pageName } from "../core/signingpage.js";
import { icon, guideSvg, GUIDE_TILE_NAMES } from "../icons/rowicons.js";

// C32: the guide list, isLite and the guide links are in guide-index.js, which Home's root loads without this file.
import { shows, GUIDES, guideIds, guideRows, ASC_GUIDE } from "./guide-index.js";
export { JAILBREAK_INFO_URL, isLite, GUIDES, guideIds, guideRows, keepGuideHref, ascGuideHref,
  ASC_GUIDE } from "./guide-index.js";

// ---- the places answers point at (their Next rows) ----------------------------------------------------------
export const PACKAGES = { openssh: "openssh", filza: "com.tigisoftware.filza" };
const packageHref = (id) => format({ tab: "search", path: [`package:${id}`] });
export const LINKS = {
  device: { label: "Settings > Device", href: () => format(settingsRoute(["device"])) },
  signing: { label: "Settings > Signing", href: () => format(settingsRoute(["signing"])) },
  // B172: from a page (`on`, the route the row sits on) these push that tab's root above it (router.js rootOn), so
  // it slides in and Back returns; without one, a plain link to the tab.
  refresh: { label: "Refresh Sources", href: (on) => format(on ? rootOn("sources", on) : { tab: "sources" }) },
  installed: { label: "Installed", href: (on) => format(on ? rootOn("installed", on) : { tab: "installed" }) },
  ipas: { label: "Install IPAs", href: () => format({ tab: "installed", path: ["myipas"] }) },
  add: { label: "Add a Source", href: () => format({ tab: "sources", path: ["manage", "sources"] }) },
  more: { label: "More Sources", href: () => format({ tab: "sources", path: ["more"] }) },
  help: { label: "Upgrading & Jailbreaking Help", href: () => format({ tab: "home", path: ["help"] }) },
  openssh: { label: "OpenSSH Access How-To", href: () => format({ tab: "home", path: ["guides", "openssh"] }) },
  password: { label: "Root Password How-To", href: () => format({ tab: "home", path: ["guides", "password"] }) },
};
// C15: labels and texts name the signing page the build's way (Installation & Signing in the sideload build)
export const linkRow = (id, mode, on) => ({ label: pageName(LINKS[id].label, mode), href: LINKS[id].href(on) });

// ---- FAQ ----------------------------------------------------------------------------------------------------
// Each answer: { q, a } (one paragraph) or { q, steps: [...] }, `next`: LINKS ids, `group`, and where it shows:
// `only: "full"` (jailbroken), `only: "lite"`, or both. `liteA` swaps the answer text in lite.
export const FAQ_GROUPS = ["Getting Started", "Problems", "Sources"];
export const FAQ = [
  {
    id: "what", group: "Getting Started", q: `What is ${NAME}?`,
    a: "A package manager with the iOS 6 look, for modern iPhones. Jailbroken, it lists tweaks, themes and tools "
      + "from APT sources and installs them with apt. Not jailbroken, it lists apps from AltStore-style sources, "
      + "signed and installed on the phone.",
    liteA: "An app store with the iOS 6 look, for modern iPhones. It lists apps from AltStore-style sources, then "
      + "signs them with your certificate and installs them on the phone.",
    next: ["more"], liteNext: ["add", "signing"],
  },
  {
    id: "need", group: "Getting Started", only: "full", q: "Do I need a jailbreak?",
    a: "Only for tweaks and themes. Apps from AltStore-style sources work on any iPhone. Upgrading & Jailbreaking "
      + `Help says which jailbreak kinds ${NAME} supports.`,
    next: ["help", "device"],
  },
  {
    id: "kind", group: "Getting Started", only: "full", q: "Rootful or rootless?",
    a: "Dopamine and palera1n's default are rootless: packages live under /var/jb and are built for iphoneos-arm64. "
      + `checkra1n and older jailbreaks are rootful (iphoneos-arm). Settings > Device picks which packages ${NAME} `
      + "lists, so it must match your jailbreak.",
    next: ["device", "help"],
  },
  {
    id: "signing", group: "Getting Started", only: "lite", q: "What do I need to install apps?",
    steps: [
      "A signing certificate (.p12) and its password, with a provisioning profile that names this iPhone.",
      "Settings > Signing: add the certificate and profile.",
      "Install IPAs, or any app's page from a source: tap Install.",
    ],
    next: ["signing", "ipas"],
  },
  {
    id: "package", group: "Problems", only: "full", q: "A package won't install",
    steps: [
      "Check that Settings > Device matches your jailbreak: a package built for rootful won't install on rootless, "
        + "and the other way round.",
      "Refresh Sources, then try again.",
      "Still failing? The error apt shows names the package or dependency it couldn't get.",
    ],
    next: ["device", "refresh"],
  },
  {
    id: "tweak", group: "Problems", only: "full", q: "A tweak broke something",
    steps: [
      "Remove the last package you installed (Installed tab), then respring.",
      "If SpringBoard won't come up, reboot: a rootless jailbreak starts out unjailbroken after a reboot.",
      "Jailbreak again with tweaks turned off (Dopamine: Tweak Injection in its settings), then remove the package.",
    ],
    next: ["installed"],
  },
  {
    id: "app", group: "Problems", q: "An app won't install",
    steps: [
      "Settings > Signing: check the certificate and profile are there and the password is right.",
      "The profile must list this iPhone's UDID, unless it's an enterprise one. If it doesn't, the app never appears "
        + "on the Home Screen, or iOS says its integrity could not be verified: add the UDID to the developer "
        + "account, make the profile again and import it in Settings > Signing.",
      UDID_HOW,
      "Free developer accounts sign at most three apps at a time: remove one you don't use.",
      "Try again from Install IPAs or the app's page.",
    ],
    next: ["signing", "ipas"],
  },
  {
    id: "expired", group: "Problems", q: "My certificate expired",
    a: "Apps signed with it stop opening. Get a new certificate and profile, add them in Settings > Signing, then "
      + "install the apps again: their data stays as long as you don't delete them first.",
    next: ["signing", "installed"],
  },
  {
    id: "addsource", group: "Sources", q: "Adding a source",
    a: "Sources > Manage > Sources > Add, then type the source's address. More Sources lists a few to start "
      + "with: one tap adds one.",
    next: ["add", "more"],
  },
  {
    id: "failed", group: "Sources", q: "A source won't load",
    a: "Check the address in a browser: it should answer, not show an error page. Then Refresh Sources. A source "
      + "that still fails says why on its row in the Sources tab.",
    next: ["refresh"],
  },
  {
    id: "moresources", group: "Sources", q: "Where do I find more sources?",
    a: "More Sources lists ones we checked. Developers often post their source's address on their site.",
    next: ["more", "add"],
  },
];

export const faqFor = (lite) => FAQ.filter((f) => shows(f, lite)).map((f) => ({
  ...f, a: lite && f.liteA ? f.liteA : f.a, next: lite && f.liteNext ? f.liteNext : f.next,
}));
export const answerFor = (id, lite) => faqFor(lite).find((f) => f.id === id) ?? null;
// F252: the answer an IPA install's Complete page opens from its "Not on the Home Screen?" Help button
export const APP_HELP = "app";
export const appHelpHref = (fmt = format) => fmt({ tab: "home", path: ["guides", "faq", APP_HELP] });
// The Help button's tap: the progress page goes, Home shows the answer.
export function openAppHelp(page, { go = navGo } = {}) {
  try { page?.close?.(); } catch { /* the answer opens anyway */ }
  go(appHelpHref());
}

// The FAQ page: its question rows, grouped.
export function faqSections(lite) {
  const list = faqFor(lite);
  return FAQ_GROUPS.map((g) => ({
    header: g,
    rows: list.filter((f) => f.group === g).map((f) => ({ label: f.q, href: format({ tab: "home", path: ["guides", "faq", f.id] }) })),
  })).filter((s) => s.rows.length);
}

// ---- Copying Files --------------------------------------------------------------------------------------------
// F176: every app and system row has a 29px icon: our own glyphs (a folder, radio waves, swap arrows, a monitor, a
// window, a penguin), drawn as SVG tiles from the icon map (icons/rowicons.js "guides", C51).
export const glyphSvg = (id) => guideSvg(id);
// A row's icon: the glyph as a picture over its tile colour and letter (shown if the picture can't load).
export const glyph = (id, text) => ({
  text, color: icon("guides", id)[1], cls: "guide-glyph", src: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(glyphSvg(id)),
});
export const GLYPH_IDS = GUIDE_TILE_NAMES;

export const FILZA_CAN = ["Browse the whole file system", "Unzip and zip archives", "Edit plists and text files",
  "Open files shared from other apps", "Install .deb files"];
export const SFTP_ROWS = [["Protocol", "SFTP"], ["Server", "iPhone's IP"], ["User", "mobile"], ["Port", "22"]];
// One row per computer: [system, its SFTP apps].
export const SFTP_APPS = [
  ["Mac", "Cyberduck, or FileZilla"],
  ["Windows", "WinSCP, or FileZilla"],
  ["Linux", "The file manager's sftp:// address, or FileZilla"],
];
const systemGlyph = (s) => glyph(s.toLowerCase(), s[0]);
export const COPYING_SEGMENTS = ["On iPhone", "Computer", "No Jailbreak"];
export const IFUSE_EXAMPLE = "ifuse --documents <bundle id> <dir>";
export const PAIRDROP_URL = "pairdrop.net";

// The no-jailbreak page: the whole Copying Files in lite, and its third segment otherwise. F176 (user 2026-11-18):
// Windows lost iTunes' sharing tab to the Apple Devices app, so From a Computer has one row per system, as of 2026.
export function noJailbreakSections() {
  const wrap = "guide-wrap-row";
  return [
    {
      header: "On iPhone",
      rows: [
        { label: "Files", subtitle: "Browse, unzip and share files", icon: glyph("files", "F") },
        { label: "AirDrop", subtitle: "To and from nearby Apple devices", icon: glyph("airdrop", "A") },
        { label: "LocalSend", subtitle: "To any phone or computer on Wi-Fi", icon: glyph("localsend", "L") },
      ],
      footer: "Files reaches the documents of apps that share them. Share > Save to Files keeps anything you're sent.",
    },
    {
      header: "From a Computer",
      rows: [
        { label: "Mac", subtitle: "Finder: the iPhone in the sidebar, then its Files tab (macOS 10.15 or later)",
          icon: systemGlyph("Mac"), cls: wrap },
        { label: "Windows", subtitle: "Apple Devices app from the Microsoft Store, then Files: it replaced iTunes on "
          + "Windows 10 and 11. Or LocalSend.", icon: systemGlyph("Windows"), cls: wrap },
        { label: "Linux", subtitle: `LocalSend, or PairDrop in a browser. App documents over USB: libimobiledevice's `
          + `${IFUSE_EXAMPLE}`, icon: systemGlyph("Linux"), cls: wrap },
      ],
      footer: `Finder, Apple Devices and ifuse need a cable, and reach only apps that share their documents (apps you `
        + `installed with ${NAME} too, if they do).`,
    },
    {
      header: "On Every System",
      rows: [
        { label: "LocalSend", subtitle: "Free app for iPhone, Mac, Windows, Linux and Android", icon: glyph("localsend", "L"),
          cls: wrap },
        { label: "PairDrop", subtitle: `${PAIRDROP_URL} in any browser, both on the same Wi-Fi: nothing to install`,
          icon: glyph("pairdrop", "P"), cls: wrap },
      ],
      footer: "Both send straight from one device to the other over your Wi-Fi.",
    },
  ];
}

export function onIphoneSections() {
  return [
    {
      rows: [{ label: "Filza File Manager", subtitle: "Install it from your sources", icon: glyph("filza", "F"),
        href: packageHref(PACKAGES.filza), cls: "guide-icon-row" }],
    },
    { header: "Filza Can", rows: FILZA_CAN.map((label) => ({ label, cls: "guide-plain-row" })),
      footer: "Install the build for your jailbreak." },
  ];
}

export function computerSections() {
  return [
    { header: "Connect With", rows: SFTP_ROWS.map(([label, detail]) => ({ label, detail })),
      footer: "OpenSSH must be installed first. Find the IP in Settings > Wi-Fi, ⓘ beside your network." },
    { rows: [linkRow("openssh")] },
    { header: "Apps", rows: SFTP_APPS.map(([label, subtitle]) => ({ label, subtitle, icon: systemGlyph(label), cls: "guide-wrap-row" })),
      footer: "Linux: type sftp://mobile@ and the IP in Files' Other Locations (or Dolphin's address bar)." },
  ];
}

// Terminal prompts: the phone's (the Root Password session) and a computer's (ssh to the phone runs there).
const PROMPT = "iPhone:~ mobile$ ";
const COMPUTER_PROMPT = "$ ";

// ---- step guides (OpenSSH, Root Password) ---------------------------------------------------------------------
// A step: { title, text, rows (link rows under it), term: { lines, copy } }.
export const SSH_EXAMPLE = "ssh mobile@192.168.1.20";
export const STEPS = {
  openssh: [
    { title: "Install OpenSSH", text: "It starts on its own once installed.",
      rows: [{ label: "OpenSSH", subtitle: "Install", icon: { text: ">_", color: "#4a4a4a" }, href: packageHref(PACKAGES.openssh) }] },
    { title: "Find the IP Address", text: "Settings > Wi-Fi, tap ⓘ beside your network: IP Address." },
    { title: "Connect", text: "On a computer on the same Wi-Fi, open Terminal (PowerShell on Windows) and type ssh "
      + "mobile@ followed by the address. Accept the host key the first time.",
      term: { lines: [{ cmd: SSH_EXAMPLE, prompt: COMPUTER_PROMPT }], copy: SSH_EXAMPLE } },
    { title: "Log In", text: "Use the password you set for mobile when you jailbroke (Dopamine and palera1n ask for "
      + "one). Use sudo for commands that need root.",
      rows: [{ label: "Still alpine?", subtitle: "Change it now", href: LINKS.password.href() }] },
  ],
  password: [
    { title: "mobile's Password", text: "Type your current password, then the new one twice.",
      term: { lines: [{ cmd: "passwd" }], copy: "passwd" } },
    { title: "root's Password", text: "Type mobile's password, then root's new one twice. On a rootless jailbreak "
      + "root can't log in over SSH: you log in as mobile and use sudo.",
      term: { lines: [{ cmd: "sudo passwd root" }], copy: "sudo passwd root" } },
    { title: "Done", text: "Close the session.", term: { lines: [{ cmd: "exit" }], copy: "exit" } },
  ],
};
export const PASSWORD_WARNING = "Anyone on your Wi-Fi can log in with alpine once OpenSSH is installed. Change both "
  + "passwords, over SSH or in a terminal app on the phone such as NewTerm.";
export const PASSWORD_TRANSCRIPT = [
  { cmd: "passwd" }, { out: "Changing password for mobile." }, { out: "Old Password:" }, { out: "New Password:" },
  { out: "Retype New Password:" }, { cmd: "sudo passwd root" }, { out: "[sudo] password for mobile:" },
  { out: "Changing password for root." }, { out: "New Password:" }, { out: "Retype New Password:" }, { cmd: "exit" },
];

// Ticked steps, per guide: localStorage["ifizbox.guideSteps.<id>"] = JSON list of step numbers (from 1).
const STEP_KEY = (id) => KEY_PREFIXES.guideSteps + id;
export function doneSteps(id, store = globalThis.localStorage) {
  try {
    const v = JSON.parse(store?.getItem(STEP_KEY(id)) || "[]");
    return new Set(Array.isArray(v) ? v.filter(Number.isInteger) : []);
  } catch {
    return new Set();
  }
}
// Flips step n's tick; returns whether it's ticked now.
export function toggleStep(id, n, store = globalThis.localStorage) {
  const done = doneSteps(id, store);
  const on = !done.has(n);
  if (on) done.add(n); else done.delete(n);
  try { store?.setItem(STEP_KEY(id), JSON.stringify([...done].sort((a, b) => a - b))); } catch { /* not kept */ }
  return on;
}

// ---- the guides, routes and Home's rows ---------------------------------------------------------------------
// GUIDES, guideIds, guideRows and the guide links live in guide-index.js (Home's root draws with them; C32).
const opens = (id, lite) => guideIds(lite).includes(id) || Boolean(GUIDES[id]?.linked);

// ---- F237: Notifications for Signed Apps (core/keepid.js, Keep Bundle IDs) ----------------------------------
// R25's steps made simple (journal/2026-11-18-r25-keep-bundle-id): with Keep Bundle IDs on, an app signed with an Ad
// Hoc profile whose explicit App ID has Push keeps its own ID and gets its own notifications. The push goes to the
// Info.plist bundle ID, so the signing team doesn't matter, and one such App ID covers every app.
export const KEEP_INTRO = "A signed app keeps its own bundle ID, so it replaces the original and gets its own "
  + "server's notifications: they go to the ID in the app, whoever signed it. Your profile needs Push, App Groups "
  + "and two notification capabilities, which Apple gives to an explicit App ID (not a wildcard like com.you.*) in an "
  + "Ad Hoc profile; a development profile gets test pushes only. One such App ID covers every app. You need a paid Apple Developer account and its Apple "
  + "Distribution certificate, or a signing service's .p12 and Push profile (then skip to Import It). With Keep Bundle "
  + "IDs off, an app becomes a renamed copy and gets no notifications.";
export const DEVELOPER_URL = "https://developer.apple.com/account/resources/identifiers/list";
STEPS[KEEP_GUIDE] = [
  // D15: docs/developer-account.md step 3, confirmed with Unbound (2026-11-20): an app that hands notifications to an
  // extension gets none with Push alone; it needs groups assigned and both notification capabilities.
  { title: "Make an App ID with Push", text: "On developer.apple.com, Certificates, IDs & Profiles > Identifiers > +: "
    + "App IDs, App. Choose Explicit and type an ID of your own, such as com.yourname.apps. Tick Push Notifications, "
    + "App Groups, Communication Notifications and Time Sensitive Notifications (Associated Domains is worth ticking "
    + "too), then Continue, Register. For a signing service's coverage, also tick App Attest, Fonts, Extended Virtual "
    + "Addressing, Increased Memory Limit, Increased Debugging Memory Limit and, on the App Services tab, WeatherKit. "
    + "This one App ID is enough for every app's notifications. An App ID per app only keeps apps' "
    + "keychains and App Groups apart, so their sign-ins don't mix. With an API key (Settings > Signing > Apple "
    + `Developer Account), ${NAME} makes that per-app App ID and its Ad Hoc profile itself, for every app it signs, `
    + "but Apple's API can't make groups or turn on the two notification capabilities: tick those on the website.",
    rows: [{ label: "Identifiers", subtitle: "developer.apple.com", chevron: true,
      onClick: () => globalThis.open?.(DEVELOPER_URL, "_blank", "noopener") }] },
  { title: "Give It App Groups", text: "Ticking App Groups isn't enough: with no groups assigned, the profile's group "
    + "list is empty, and an app that hands notifications to an extension (a modded Discord, for one) gets none. "
    + "Identifiers > +: App Groups, a description and an ID such as group.com.yourname.apps.1. Make five (.1 to .5). "
    + "Then open the App ID > App Groups > Configure, select them all and Save." },
  { title: "Register Your iPhones", text: "Devices > +: a name and the iPhone's UDID. A Mac's Finder shows it: click "
    + "the line under the iPhone's name. Settings > Signing says whether this iPhone is in your profile." },
  { title: "Make an Ad Hoc Profile", text: "Profiles > +: Ad Hoc. Pick the App ID, your Apple Distribution "
    + "certificate and your iPhones, name it, then Download the .mobileprovision." },
  { title: "Import It", text: "Settings > Signing: Replace Certificate with your .p12 and the new profile.",
    rows: [{ label: "Settings > Signing", href: format(settingsRoute(["signing"])) }] },
  { title: "Install the App", text: "Keep Bundle IDs on (Settings > Signing, or Custom Install per app). If the App "
    + "Store copy is on the iPhone, delete it first: iOS won't put a signed app over it, and its data goes with it." },
  { title: "When the App ID Changes", text: "Any change to the App ID's capabilities or groups makes every profile "
    + "made from it invalid. Make the Ad Hoc profile again, import the new one into Settings > Signing (the old one "
    + "stays in use until you do) and re-sign the apps with it." },
];

// ---- F277: Use an App Store Connect API Key (screens/devaccount.js, the Apple Developer Account group) -------
// Opened only from that group's footer (`only: "link"`: listed nowhere). The Issuer ID isn't in the .p8 and no Apple
// call returns it without it, so the guide says to copy it (or keep it in a .txt picked with the key).
export const ASC_GUIDE_LINK = "How to make an API key";
export const ASC_URL = "https://appstoreconnect.apple.com/access/integrations/api";
export const ASC_INTRO = `With an App Store Connect API key, ${NAME} makes each app's App ID and Ad Hoc profile (with `
  + "Push) itself and adds this iPhone to your account, so you never download a profile again. You need a paid Apple "
  + "Developer account; only its Account Holder or an Admin can make a key.";
STEPS[ASC_GUIDE] = [
  { title: "Open the API Keys", text: "On appstoreconnect.apple.com: Users and Access > Integrations > App Store "
    + "Connect API > Team Keys. The first time, the Account Holder taps Request Access and agrees.",
  rows: [{ label: "App Store Connect", subtitle: "appstoreconnect.apple.com", chevron: true,
    onClick: () => globalThis.open?.(ASC_URL, "_blank", "noopener") }] },
  { title: "Make a Key", text: "Tap +, give it a name (such as the app's name) and pick Access: Admin, then Generate." },
  { title: "Download It", text: "Download beside the new key saves AuthKey_<Key ID>.p8, the Key ID in its name. "
    + "Apple lets you download it only once: keep it in Files. Lost, you revoke it and make another." },
  { title: "Copy the Issuer ID", text: "It's shown above the keys: tap Copy. It isn't in the .p8, so either keep it "
    + "on the clipboard or paste it into a .txt saved beside the .p8." },
  { title: "Add It", text: "Settings > Signing > Apple Developer Account > Add API Key: pick the .p8 (and the .txt, "
    + "if you made one). The Issuer ID fills in from the .txt or the clipboard; tap Save.",
  rows: [{ label: "Settings > Signing", href: format(settingsRoute(["signing"])) }] },
  // F279: what a real call with a paid team's key got (2026-11-19); core/asc.js APP_ID_CAPS
  { title: "What Each App Gets", text: `Every App ID ${NAME} makes asks Apple for Push Notifications, App Groups, `
    + "Associated Domains, iCloud (CloudKit), Game Center, HealthKit, HomeKit, Siri, Network Extensions, Personal VPN, "
    + "Multipath, Hotspot, NFC Tag Reading, ClassKit, AutoFill Credential Provider, Access Wi-Fi Information, "
    + "Low-Latency HLS, Sign in with Apple, Wallet, Apple Pay, In-App Purchase, Inter-App Audio, Wireless Accessory "
    + "Configuration and Data Protection. Apple's API can't turn on Communication or Time Sensitive Notifications, "
    + "WeatherKit, App Attest, Fonts, Extended Virtual Addressing, Increased Memory Limit or Multitasking Camera "
    + "Access: the Account Holder or an Admin ticks those per App ID on developer.apple.com. One Apple refuses is skipped and not "
    + "asked for again for a month. App Groups come out empty, because the API can't make group IDs: an app that "
    + "shares data through a group may not find it." },
];

// What a guides/ route shows: { page: "list" | "guide" | "answer", id, answer }. A guide lite doesn't have, or an
// unknown one, shows the list.
export function guidePage(path, lite) {
  const id = path[1];
  if (!id || !opens(id, lite)) return { page: "list" };
  if (id === "faq" && path[2]) {
    const answer = answerFor(path[2], lite);
    return answer ? { page: "answer", id, answer } : { page: "guide", id };
  }
  return { page: "guide", id };
}

export function nav(route, lite) {
  const p = guidePage(route.path, lite);
  if (p.page === "list") return { title: "User Guides" };
  if (p.page === "answer") return { title: "FAQ" };
  return { title: GUIDES[p.id].title };
}

// ---- DOM ----------------------------------------------------------------------------------------------------
// opts: { lite, store (localStorage), copy (text -> promise), segment (Copying Files' first segment) }
export function render(body, route, opts = {}) {
  const lite = Boolean(opts.lite);
  const p = guidePage(route.path, lite);
  const page = el("div", "guide");
  if (p.page === "list") page.append(grouped([{ rows: guideRows(format, lite) }]));
  else if (p.page === "answer") page.append(answerView(p.answer, route));
  else if (p.id === "faq") page.append(grouped(faqSections(lite)));
  else if (p.id === "copying") page.append(lite ? grouped(noJailbreakSections()) : copyingView(opts.segment ?? 0));
  else if (p.id === "openssh") page.append(stepsView("openssh", opts));
  else if (p.id === "password") page.append(passwordView(opts));
  else if (p.id === KEEP_GUIDE) page.append(grouped([{ footer: KEEP_INTRO }]), stepsView(KEEP_GUIDE, opts));
  else if (p.id === ASC_GUIDE) page.append(grouped([{ footer: pageName(ASC_INTRO) }]), stepsView(ASC_GUIDE, opts));
  body.append(page);
  return page;
}

function answerView(f, route = null) {
  const frag = document.createDocumentFragment();
  const g = el("div", "group");
  g.append(el("h1", "guide-q", f.q));
  const ul = el("ul", "table grouped guide-answer");
  if (f.steps) {
    f.steps.forEach((s, i) => {
      const li = el("li", "cell");
      const inner = el("div", "cell-inner guide-step");
      inner.append(el("span", "guide-num", String(i + 1)), el("span", "guide-text", pageName(s)));
      li.append(inner);
      ul.append(li);
    });
  } else {
    const li = el("li", "cell");
    const inner = el("div", "cell-inner");
    inner.append(el("p", "guide-text", pageName(f.a)));
    li.append(inner);
    ul.append(li);
  }
  g.append(ul);
  frag.append(g);
  if (f.next?.length) frag.append(grouped([{ header: "Next", rows: f.next.map((id) => linkRow(id, undefined, route)) }]));
  return frag;
}

function copyingView(first) {
  const wrap = el("div", "guide-copying");
  const panes = [onIphoneSections(), computerSections(), noJailbreakSections()].map((s) => {
    const pane = el("div", "guide-pane");
    pane.append(grouped(s));
    return pane;
  });
  const pick = (i) => {
    seg.mark(i);
    panes.forEach((p, j) => { p.hidden = i !== j; });
  };
  const seg = segmented(COPYING_SEGMENTS, { selected: first, onSelect: pick });
  seg.bar.classList.add("guide-segmented");
  wrap.append(seg.bar, ...panes);
  pick(first);
  return wrap;
}

// A terminal panel (F151's log look): `lines` as prompt + command or output; Copy puts `copy` on the clipboard.
export function terminal(lines, copyText = null, copy = defaultCopy) {
  const box = el("div", "guide-term");
  const out = el("div", "guide-term-out");
  for (const l of lines) {
    const line = el("div", l.cmd != null ? "pl pl-raw guide-cmd" : "pl pl-raw");
    if (l.cmd != null) { line.append(el("span", "guide-prompt", l.prompt ?? PROMPT), el("span", "guide-cmd-text", l.cmd)); }
    else line.textContent = l.out;
    out.append(line);
  }
  box.append(out);
  if (copyText != null) {
    const b = el("button", "guide-copy", "Copy");
    b.type = "button";
    b.addEventListener("click", async () => {
      try { await copy(copyText); } catch { return; }
      b.textContent = "Copied";
      b.classList.add("is-copied");
      setTimeout(() => { b.textContent = "Copy"; b.classList.remove("is-copied"); }, 1500);
    });
    box.append(b);
  }
  return box;
}

async function defaultCopy(text) {
  const { copyText } = await import("../nav/menu.js");
  return copyText(text);
}

function stepsView(id, { store = globalThis.localStorage, copy = defaultCopy } = {}) {
  const frag = document.createDocumentFragment();
  const done = doneSteps(id, store);
  STEPS[id].forEach((s, i) => {
    const n = i + 1;
    const g = el("div", "group guide-step-group");
    const ul = el("ul", "table grouped");
    const li = el("li", "cell");
    const inner = el("div", "cell-inner guide-step");
    const badge = el("button", "guide-num guide-tick", String(n));
    badge.type = "button";
    badge.dataset.step = String(n);
    const mark = (on) => {
      badge.classList.toggle("is-done", on);
      badge.setAttribute("aria-pressed", String(on));
      badge.setAttribute("aria-label", `Step ${n}${on ? ", done" : ""}`);
    };
    mark(done.has(n));
    badge.addEventListener("click", () => mark(toggleStep(id, n, store)));
    const text = el("span", "guide-step-text");
    text.append(el("span", "guide-step-title", s.title), el("span", "guide-text", pageName(s.text)));
    inner.append(badge, text);
    li.append(inner);
    ul.append(li);
    if (s.term) {
      const tli = el("li", "cell guide-term-cell");
      tli.append(terminal(s.term.lines, s.term.copy, copy));
      ul.append(tli);
    }
    // the rows (Install, Still alpine?) as cells of the same table, below the step
    for (const r of s.rows ?? []) ul.append(row({ ...r, label: pageName(r.label) }));
    g.append(ul);
    frag.append(g);
  });
  return frag;
}

function passwordView(opts) {
  const frag = document.createDocumentFragment();
  const g = el("div", "group");
  const ul = el("ul", "table grouped guide-warning");
  const li = el("li", "cell");
  const inner = el("div", "cell-inner");
  inner.append(el("span", "guide-warning-icon"), el("span", "guide-text", PASSWORD_WARNING));
  li.append(inner);
  ul.append(li);
  g.append(ul);
  const t = el("div", "group");
  t.append(el("h2", "group-header", "The Whole Session"), terminal(PASSWORD_TRANSCRIPT, null));
  frag.append(g, t, stepsView("password", opts));
  return frag;
}
