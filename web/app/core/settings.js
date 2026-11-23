// Settings: what each one is, which mode shows it, its default, and where it lives on the device. Pure JS, no DOM:
// the Settings tab (screens/settings.js) draws what `visible()` returns, and the rest of the app reads values with
// `get()`. Both modes and the site run this same file, so a setting means the same everywhere.
//
//   const s = createSettings({ mode: detectMode() });
//   s.get("appearance");            // "auto" | "light" | "dark" (Automatic unless chosen: follows the iPhone)
//   s.set("appearance", "dark");    // stored at localStorage["ifizbox.appearance"], listeners told
//   s.onChange((key, value) => …);  // returns an unsubscribe function
//   s.sections();                   // [{ id, page, title, footer, settings: [def…] }], only the rows this mode shows
//   s.pages();                      // [{ id, title, sections }]: Settings' root rows (General, Theme, Updates…)
//   s.holds.set("com.example.tweak", true);  // Ignore upgrades, kept on the device (jailbreak: also a dpkg hold)
//   await s.holds.sync();                    // jailbreak: take dpkg's holds (apt-mark showhold) as the list
//   s.hiddenSections.set("Themes", true);    // Section Visibility (F24): listeners hear ("hiddenSections", list)
//   s.hiddenAuthors.set("Jane Doe", true);  // Hide by Author (F104): listeners hear ("hiddenAuthors", list)
//   s.sourceFilters.set(key, "paid", true);  // Source Filters (F382): listeners hear ("sourceFilters", object)
//   await s.blocked.set("com.example.tweak", true, { name, installed }); // Block (F226): out of every list; jailbreak: held too
//   s.ignoredVersions.set("com.example.tweak", "1.2"); // Ignore This Version (F281): only 1.2 hidden; null undoes
//   s.autoMarked.set("com.example.tweak", true); // Update Automatically, for Only Packages I Mark (F70)
//   s.recentSearches.add("snowboard");      // Search's Recent table (F100): last 5, newest first
//   s.daemonPrefs();                         // { "ifizbox.autoInstall": "marked", … } for N7's daemon (F70)
//
// Every value is stored as a string under `ifizbox.<key>`, so backend.js getArch() keeps reading `ifizbox.arch`.
// A stored value that is not one of the setting's options reads as the default (a hand-edited or older value
// never breaks the app).
//
// A row only shows once the feature it controls exists (user 2026-11-17). FEATURES lists the ones that do; the task
// that builds a feature adds its name here, and its row appears. Each def names its `feature`.

import { ARCHES, DEFAULT_ARCH } from "./apt.js";
import { IOS_VERSIONS, JAILBREAK_ARCH } from "./compat.js";
import { NAME } from "../brand.js";
import { OLD_WAY_ALERT } from "./keepid.js";
import { ROUTE_OPTIONS } from "./installroute.js";
import { normalizeFilters, filterOn, isCustom as isCustomFilter, ALL_SOURCES } from "./sourcefilters.js"; // F382

export const MODES = ["site", "jailbreak", "sideload"];

// Features that exist today. "appearance": this task's theme. "sources": the source list and its refresh (F4).
// "holds": Ignored Upgrades (F7's upgrades list leaves them out; the helper's apt-mark side is F22's).
// "compat": Works on My Phone (F17). "device": Device type (F37).
// "resign": Re-sign Reminder, which F68 turns on (signing.remind, F14).
// "upgrade-notifications": Upgrade Notifications, N5's daemon's "n Upgrades" in the jailbreak app (F65).
// "auto-install", "rollback": N7's Automatic Installs rows, which F70 hands to the daemon (daemonPrefs below).
export const FEATURES = new Set(["appearance", "sources", "holds", "compat", "device", "resign", "upgrade-notifications",
  "auto-install", "rollback", "keep-id", "expiry-warning", "install-route", "self-alerts", "app-icon"]); // "keep-id": Keep Bundle IDs (F237); "expiry-warning": F244; "self-alerts": F285; "app-icon": F323

const BOTH = ["jailbreak", "sideload"];
const ALL = ["site", ...BOTH];
const onOff = [{ value: false, label: "Off" }, { value: true, label: "On" }];

// F128: laid out like iOS 6's Settings app. The root is one list of short rows, one per page (General, Theme,
// Updates); each page holds its groups (SECTIONS, in order), a group's footer says in a line what its rows do. The
// "signing" page has no root row of its own: its group goes on Settings > Signing (screens/settings.js).
export const PAGES = [
  { id: "general", title: "General" },
  { id: "theme", title: "Theme" }, // F205: was Display (route "display"); Compatibility Marks moved to General
  { id: "updates", title: "Updates" },
  { id: "installation", title: "Installation" }, // sideload: Install Apps With (screens/installroute.js draws it)
  { id: "signing", title: "Signing" },
];

export const SECTIONS = [
  { id: "device", page: "general" },
  { id: "compat", page: "general" },
  { id: "sources", page: "general" },
  { id: "style", page: "theme", title: "Style" }, // F201: iOS 6 (the default) or iOS 7, html[data-style]
  { id: "appearance", page: "theme", title: "Mode" }, // F199: Theme's Mode, a segmented Automatic / Light / Dark
  { id: "themes", page: "theme", title: "Themes" }, // F199: Light and Dark, each pushing its checklist of themes
  { id: "updates", page: "updates" },
  { id: "notifications", page: "updates" },
  { id: "automatic", page: "updates", title: "Automatic Installs" },
  { id: "installation", page: "installation", title: "Install Apps With" },
  { id: "signing", page: "signing" },
  { id: "expiry", page: "signing" }, // F244: Show Expiry Warning and Expiry Warning, Home's certificate tile
];

// F134: Settings > Signing's groups, top to bottom, like an iOS 6 settings page: the certificate (its name, team and
// expiry, with Import or Replace), the provisioning profile, the options (SECTIONS' "signing": Show Expiry Dates,
// Re-sign Reminder), then the rest, and How Signing Works (the walkthrough) as a link at the bottom.
// screens/settings.js signingLayout() picks the ones a build shows, in this order.
// F254j: `free` is the website's Use a Free Apple ID group (screens/free-apple-id.js freeRouteBlock), shown while no
// certificate is set, the same group How Signing Works ends with.
export const SIGNING_GROUPS = ["certificate", "files", "profile", "account", "options", "server", "status", "app", "other", "free", "help"];

// F128: settings that went (docs/settings.md says why). Nothing reads them; createSettings() drops their stored
// values, and a full daemonPrefs() sends the daemon's two as null so the shell removes them there too.
// F134: allowZoom (Display > Zoom) went too: zoom is always off (screens/settings.js applyZoom).
export const RETIRED = ["sideloader", "checkUpdates", "cellular", "notifications", "badge", "allowZoom"];
export const RETIRED_DAEMON_KEYS = ["checkUpdates", "cellular"];

// kind: "choice" (one row per option, the chosen one checked), "segmented" (an iOS 6 segmented control, F199), "toggle" (a switch), "list" (pushes a page that
// picks one option; its footer shows there), "holds" (pushes the held packages). `default` is a value, or a function of the mode.
// F315: `hint` is the footer under the row's group on the Settings page when it differs from `footer` (true: the
// footer, for a list); `with` names the row whose group it joins (sections()).
export const SETTINGS = [
  {
    // F201: the iOS era the whole app is drawn in, put on <html data-style> (theme-boot.js before first paint,
    // screens/settings.js applyTheme after). iOS 6 is the base look (ios6.css); iOS 7 is ios7.css over it, with its
    // own two themes (STYLE_PALETTES), so the Themes rows (`style: "ios6"`) hide while it is on.
    // C69: the eras are the two apps' only; the website is iOS 6 and has no Style rows (createSettings drops a stored one).
    key: "style", section: "style", kind: "choice", feature: "appearance", modes: BOTH, default: "ios6",
    label: "Style",
    // F202: iOS 13 (ios13.css), inset grouped with large titles and card sheets (STYLE_HOOKS)
    options: [{ value: "ios6", label: "iOS 6" }, { value: "ios7", label: "iOS 7" }, { value: "ios13", label: "iOS 13" },
      { value: "ios26", label: "iOS 26" }], // F203: Liquid Glass (ios26.css), large titles, card sheets, floating tab bar
    footer: "iOS 7, iOS 13 and iOS 26 have two themes of their own: White, and OLED Black in Dark mode.",
  },
  {
    // F199: Theme's Mode, drawn as an iOS 6 segmented control. Kept under its old key (ifizbox.appearance) so a
    // stored choice, the transfer to the app (TRAVELS) and the shell's app.theme read the same value.
    key: "appearance", section: "appearance", kind: "segmented", feature: "appearance", modes: ALL, default: "auto",
    label: "Mode",
    options: [{ value: "auto", label: "Automatic" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }],
    footer: "Automatic switches between your Light and Dark themes with the iPhone's own setting.",
  },
  {
    // F199: the theme Light mode paints (one today: the kit's own). `swatch`: the theme list's little tile (bar
    // colour over ground colour), from ios6.css's palette blocks. Stored at ifizbox.lightTheme.
    key: "lightTheme", section: "themes", kind: "list", feature: "appearance", modes: ALL, default: "classic",
    label: "Light", tone: "light", style: "ios6", // F201: iOS 6's themes; iOS 7 has its own (STYLE_PALETTES)
    // F200: Sepia and Solarized Light (palettes.css).
    options: [{ value: "classic", label: "Classic", swatch: ["#6f88a8", "#c5ccd4"] },
      { value: "sepia", label: "Sepia", swatch: ["#a5865a", "#ebdfc5"] },
      { value: "solarized", label: "Solarized Light", swatch: ["#4b93c8", "#eee8d5"] },
      // F325: palettes.css's textured light ones.
      { value: "legalpad", label: "Legal Pad", swatch: ["#7a4826", "#f9eba0"] },
      { value: "metal", label: "Brushed Metal", swatch: ["#dfe2e6", "#b9bec6"] }],
    footer: "The theme in Light mode, and in Automatic while the iPhone is light.",
  },
  {
    // F198/F199: the dark palette, stored at ifizbox.darkTheme (DARK_THEME_KEY, which theme-boot.js reads raw).
    key: "darkTheme", section: "themes", kind: "list", feature: "appearance", modes: ALL, default: "gunmetal",
    label: "Dark", tone: "dark", style: "ios6", // F201
    options: [{ value: "oled", label: "OLED Black", swatch: ["#000", "#0e0e0f"] },
      { value: "gunmetal", label: "Gunmetal", swatch: ["#5f656f", "#3b3f46"] },
      // F200: palettes.css.
      { value: "midnight", label: "Midnight", swatch: ["#18253e", "#121d31"] },
      { value: "linen", label: "Linen", swatch: ["#262626", "#36383d"] },
      { value: "nord", label: "Nord", swatch: ["#3b4252", "#2e3440"] },
      { value: "dracula", label: "Dracula", swatch: ["#383b4c", "#282a36"] },
      // F325: palettes.css's textured dark ones.
      { value: "leather", label: "Leather", swatch: ["#6e4a2c", "#3b2819"] },
      { value: "felt", label: "Felt", swatch: ["#6a4220", "#2c6834"] },
      { value: "wood", label: "Wood", swatch: ["#4e2f15", "#66401f"] }],
    footer: "The theme in Dark mode, and in Automatic while the iPhone is dark.",
  },
  {
    // F323: the Home Screen icon follows the themes: in Light the light theme's icon, on a dark Home Screen the dark
    // theme's (native/Sources/AppIcon.swift). The apps only: the website's apple-touch-icon can't switch. Drawn by
    // screens/settings.js appIconGroups (Theme > App Icon), so its section is no SECTIONS group. Off, Light and Dark
    // below pick each mode's icon. The sideload build's switch shows iOS's alert (the jailbreak app's goes quietly).
    key: "iconMatch", section: "appicon", kind: "toggle", feature: "app-icon", modes: BOTH, default: true,
    label: "Match Theme", options: onOff,
    footer: (mode) => "The icon changes with your theme." + (mode === "sideload" ? " iOS shows an alert each time." : ""),
  },
  {
    // F323: Light's and Dark's icon while Match Theme is off: "theme" (the theme's own, where they start) or an icon
    // of APP_ICONS. Each pushes theme/<key>, a grid of icons (screens/settings.js iconPage).
    key: "lightIcon", section: "appicon", kind: "icon", feature: "app-icon", modes: BOTH, default: "theme",
    label: "Light", iconTone: "light", options: [{ value: "theme", label: "Theme" }], accepts: (v) => isOwnIcon(v), // F329
    footer: (mode) => "Pick an icon for each mode." + (mode === "sideload" ? " iOS shows an alert when it changes." : ""),
  },
  {
    key: "darkIcon", section: "appicon", kind: "icon", feature: "app-icon", modes: BOTH, default: "theme",
    label: "Dark", iconTone: "dark", options: [{ value: "theme", label: "Theme" }], accepts: (v) => isOwnIcon(v), // F329
  },
  {
    // F37: what kind of iPhone this is. The site only: the jailbreak app takes it from the bridge (deviceType) and
    // the sideload build is always Not Jailbroken. Not Jailbroken hides APT sources, tweaks and themes everywhere
    // and lists AltStore-style apps (F9); an arch here is also written to `arch`, where backend.js getArch() reads it.
    key: "device", section: "device", kind: "list", feature: "device", modes: ["site"], default: "none",
    label: "Device",
    options: [
      { value: "none", label: "Not Jailbroken", subtitle: "Apps from AltStore-style sources" },
      { value: "iphoneos-arm64", label: "Jailbroken (Rootless)", subtitle: "iphoneos-arm64: Dopamine, palera1n rootless" },
      { value: "iphoneos-arm", label: "Jailbroken (Rootful)", subtitle: "iphoneos-arm: palera1n rootful, older jailbreaks" },
      { value: "iphoneos-arm64e", label: "Jailbroken (Roothide)", subtitle: "iphoneos-arm64e: Dopamine roothide, Bootstrap" },
    ],
    footer: "Jailbroken also lists tweaks and themes from APT sources, built for its architecture.",
  },
  {
    // The architecture APT packages are listed for, kept for backend.js getArch() (`ifizbox.arch`). No row of its
    // own since F37: Device sets it on the site, the bridge in the jailbreak app.
    key: "arch", section: "sources", kind: "list", feature: "sources", modes: [], default: DEFAULT_ARCH,
    label: "Architecture",
    options: [
      { value: "iphoneos-arm64", label: "Rootless", subtitle: "iphoneos-arm64: Dopamine, palera1n rootless" },
      { value: "iphoneos-arm", label: "Rootful", subtitle: "iphoneos-arm: palera1n rootful, older jailbreaks" },
      { value: "iphoneos-arm64e", label: "Roothide", subtitle: "iphoneos-arm64e: Dopamine roothide, Bootstrap" },
    ],
  },
  {
    key: "worksOnMyPhone", section: "compat", kind: "toggle", feature: "compat", modes: ALL, default: true,
    label: "Works on My Phone", options: onOff,
    footer: (mode) => "Hides packages that say they don't work on " + (mode === "site" ? "the iPhone set above." : "this iPhone."),
  },
  {
    // F35: the check, X or ? beside every package in lists, Search and the package page.
    key: "compatMarks", section: "compat", kind: "toggle", feature: "compat", modes: ALL, default: true,
    label: "Compatibility Marks", options: onOff,
    // F315: its own group and footer now, below Works on My Phone's.
    footer: "Puts a check, an X or a ? by each package.",
  },
  {
    // The site's picker (F17): the app knows its iOS version from the bridge.
    key: "iosVersion", section: "device", kind: "list", feature: "compat", modes: ["site"], default: "auto",
    label: "iOS Version",
    options: [{ value: "auto", label: "Automatic", subtitle: "From this browser" },
      ...IOS_VERSIONS.map((v) => ({ value: v, label: `iOS ${v}` }))],
    footer: "Packages are checked against this version. Automatic reads it from this browser.",
  },
  {
    // The apps only: the website refreshes on every unlocked launch by itself (websign-gate.js refreshOnLaunch),
    // so a toggle there would do nothing.
    key: "refreshOnLaunch", section: "sources", kind: "toggle", feature: "sources", modes: BOTH,
    default: (mode) => mode !== "site",
    label: "Refresh Sources on Launch", options: onOff,
    footer: `Looks for new packages in every source each time ${NAME} opens.`,
  },
  {
    // Back from the background after this long counts as a fresh open: Home's root, and Refresh on Launch again
    // (app.js). Was a fixed 2 minutes in the app (user 2026-11-18: a setting for it).
    key: "returnHome", section: "sources", kind: "list", feature: "sources", modes: ALL, default: 2,
    label: "Return to Home After",
    options: [{ value: 0, label: "Never" }, { value: 1, label: "1 Minute" }, { value: 2, label: "2 Minutes" },
      { value: 5, label: "5 Minutes" }, { value: 15, label: "15 Minutes" }, { value: 60, label: "1 Hour" }],
    footer: `Back after this long, ${NAME} opens on Home as if just launched, unless a popup or an install is still up.`,
  },
  {
    key: "holds", section: "updates", kind: "holds", feature: "holds", modes: ALL, label: "Ignored Upgrades",
    footer: (mode) => mode === "jailbreak"
      ? "Held with dpkg, so other package managers leave them alone too."
      : `Kept on this device, and synced by a ${NAME} Account.`,
  },
  {
    // F285: the sideload app's alerts (background check, push) about iFizBox's own update. Off: app-updates.js leaves
    // iFizBox out of updates.watch and the push registration; Changes still lists it. Drawn in the Update Alerts group
    // (screens/settings.js notifySection), so its section is no SECTIONS group.
    key: "selfUpdateAlerts", section: "alerts", kind: "toggle", feature: "self-alerts", modes: ["sideload"], default: true,
    label: `${NAME} Updates`, options: onOff,
    footer: `Off, only your apps' updates alert you; ${NAME}'s own update still shows in Changes.`,
  },
  {
    // F65: N5's background check (native/daemon/) posts "3 Upgrades". Off: `ifizbox-helper notifications off` writes
    // /var/jb/var/lib/ifizbox/upgrades.off and the daemon only updates the icon's count (daemon/quiet.h).
    key: "upgradeNotifications", section: "notifications", kind: "toggle", feature: "upgrade-notifications",
    modes: ["jailbreak"], default: true, label: "Upgrade Notifications", options: onOff,
    footer: `Off, ${NAME}'s icon still shows how many upgrades there are.`,
  },
  {
    key: "autoInstall", section: "automatic", kind: "list", feature: "auto-install", modes: ["jailbreak"], default: "off",
    label: "Install Updates Automatically",
    options: [{ value: "off", label: "Off" }, { value: "marked", label: "Only Packages I Mark" }, { value: "all", label: "Everything" }],
  },
  { key: "autoInstallIdle", section: "automatic", kind: "toggle", feature: "auto-install", modes: ["jailbreak"], default: true,
    label: "When Charging and Locked", options: onOff,
    footer: "Automatic installs wait until this iPhone is charging and locked." }, // F315: its own group
  {
    key: "respring", section: "automatic", kind: "list", feature: "auto-install", modes: ["jailbreak"], default: "notify",
    label: "After a Respring Update", with: "autoInstall", // F315: up with Install Updates Automatically, no hint
    options: [{ value: "notify", label: "Just Notify Me" }, { value: "locked", label: "Respring When Locked" }],
  },
  {
    key: "keepVersions", section: "automatic", kind: "list", feature: "rollback", modes: ["jailbreak"], default: 1,
    label: "Keep Previous Versions",
    options: [{ value: 0, label: "None" }, { value: 1, label: "1" }, { value: 2, label: "2" }],
    // F315: a list, but its own group, its footer shown under it on Updates too (hint) and on its page.
    footer: "Older versions kept on this iPhone, to go back to.", hint: true,
  },
  {
    // F134: the days left on signed apps (Installed's pills, an app page's Signature row, Signed Apps' days). Off
    // hides the dates only: Expired still shows, and the Re-sign Reminder and Changes' re-sign rows carry on. The
    // sideload build only: the website signs apps too but keeps no record of them, so it draws no dates to hide.
    key: "showExpiry", section: "signing", kind: "toggle", feature: "resign", modes: ["sideload"], default: true,
    label: "Show Expiry Dates", options: onOff,
    footer: "Shows how many days each signed app has left.",
    // F315: the group's one footer, for Re-sign Reminder too (`with` below)
    hint: "Shows how many days each signed app has left, and reminds you before it runs out.",
  },
  {
    key: "resignReminder", section: "signing", kind: "list", feature: "resign", modes: ["sideload"], default: 2,
    label: "Re-sign Reminder", with: "showExpiry",
    options: [
      { value: 0, label: "Off" }, { value: 1, label: "1 Day Before" }, { value: 2, label: "2 Days Before" },
      { value: 3, label: "3 Days Before" }, { value: 7, label: "7 Days Before" },
    ],
    footer: "Reminds you before an app's signature expires.",
  },
  {
    // F237 (core/keepid.js): a signed app keeps its own bundle ID (the profile's App ID goes in its entitlements only).
    // Both builds that sign; Custom Install has the same switch per app. Turning it off asks first (confirmOff,
    // screens/settings.js makeSwitch).
    key: "keepBundleId", section: "signing", kind: "toggle", feature: "keep-id", modes: ["site", "sideload"], default: true,
    label: "Keep Bundle IDs", options: onOff, confirmOff: OLD_WAY_ALERT,
    // F315: its own group; screens/settings.js keepHint swaps in what's wrong (off, or the profile can't notify).
    footer: "Apps keep their own IDs and notifications.",
  },
  {
    // F244: Home's certificate-expiry tile (core/signing.js expiryWarning). Off (people with auto-renew): no amber or
    // red tile, and Expiry Warning's row hides (`needs`); the solid red Expired tile still shows. Sideload build only.
    key: "showExpiryWarning", section: "expiry", kind: "toggle", feature: "expiry-warning", modes: ["sideload"], default: true,
    label: "Show Expiry Warning", options: onOff,
    footer: "Warns on Home before your certificate or profile expires.",
  },
  {
    key: "expiryWarning", section: "expiry", kind: "list", feature: "expiry-warning", modes: ["sideload"], default: 7,
    needs: "showExpiryWarning", with: "showExpiryWarning", label: "Expiry Warning",
    options: [
      { value: 3, label: "3 Days" }, { value: 7, label: "1 Week" }, { value: 14, label: "2 Weeks" },
      { value: 30, label: "1 Month" }, { value: 60, label: "2 Months" },
    ],
    footer: "How far ahead Home shows the warning.",
  },
  {
    // Settings > Installation (core/installroute.js): the Signing Server's install link, or This iPhone's own installd
    // over LocalDevVPN (native/sideload/idevice). screens/installroute.js draws the page (This iPhone needs pairing).
    key: "installRoute", section: "installation", kind: "choice", feature: "install-route", modes: ["sideload"], default: "server",
    label: "Install Apps With", options: ROUTE_OPTIONS,
  },
];

const PREFIX = "ifizbox.";
// F285: selfUpdateAlerts as get() reads it, for app-updates.js, which has no settings store of its own.
export function selfUpdateAlertsOn(storage = globalThis.localStorage) {
  try { return storage?.getItem?.(PREFIX + "selfUpdateAlerts") !== "false"; } catch { return true; }
}
const HOLDS_KEY = PREFIX + "holds";
const HIDDEN_SECTIONS_KEY = PREFIX + "hiddenSections";
const AUTO_MARKED_KEY = PREFIX + "autoMarked";
const RECENT_SEARCHES_KEY = PREFIX + "recentSearches";
const HIDDEN_AUTHORS_KEY = PREFIX + "hiddenAuthors";
const BLOCKED_KEY = PREFIX + "blockedPackages";
const BLOCK_HOLDS_KEY = PREFIX + "blockHolds";
const APP_HOLDS_KEY = PREFIX + "appHolds"; // B69: apps' Ignore Upgrades in the jailbreak app (no dpkg hold)
const LAST_REFRESH_KEY = PREFIX + "lastRefresh"; // F270: pull to refresh's Last Updated
const QUEUE_HINT_KEY = PREFIX + "queueHintHeld"; // F272: the Installed tab was held once; the queue's hint stops
const IGNORED_VERSIONS_KEY = PREFIX + "ignoredVersions"; // F281: Ignore This Version, { id: version }
const SOURCE_FILTERS_KEY = PREFIX + "sourceFilters"; // F382: Source Filters, core/sourcefilters.js

// F100: Search's Recent table (from Zebra): the last RECENT_MAX queries, newest first, no duplicates (a query
// already there moves to the top; case and surrounding spaces don't make a new one). Pure, for the tests.
export const RECENT_MAX = 5;
export function addRecent(list, query, max = RECENT_MAX) {
  const q = String(query ?? "").trim();
  const old = (Array.isArray(list) ? list : []).filter((s) => typeof s === "string" && s.trim());
  if (!q) return old.slice(0, max);
  return [q, ...old.filter((s) => s.trim().toLowerCase() !== q.toLowerCase())].slice(0, max);
}

// F70: what N7's daemon (native/daemon/README.md "Automatic updates (N7)") reads from the app's preferences
// (com.ryha.ifizbox), by the same `ifizbox.<key>` names: these settings, and the lists in DAEMON_LISTS.
// F75: the settings that move with the user from the website to the app (Open in iFizBox App, core/transfer.js):
// appearance, device, the compat options; Ignored Upgrades (holds) and the Signing Server travel beside them. The
// app takes only those it shows itself (settings.isShown).
export const TRAVELS = ["style", "appearance", "lightTheme", "darkTheme", "device", "worksOnMyPhone", "compatMarks", "iosVersion"];
export const DAEMON_KEYS = ["autoInstall", "autoInstallIdle", "respring", "keepVersions"];
// F282: "ignoredVersions" (Ignore This Version) goes as its { id: version } object, so the daemon's count and
// automatic installs skip that version too.
export const DAEMON_LISTS = ["holds", "autoMarked", "ignoredVersions"];
const byKey = new Map(SETTINGS.map((d) => [d.key, d]));

// The architecture list in core/apt.js is the source of truth; the options above must cover it.
for (const a of ARCHES) if (!byKey.get("arch").options.some((o) => o.value === a)) throw new Error(`arch ${a} has no option`);
for (const a of ARCHES) if (!byKey.get("device").options.some((o) => o.value === a)) throw new Error(`arch ${a} has no device type`);

// F323: the app icons: every theme's (native/icon/themes/<theme>/, the light themes first, as the shell's sets are
// named) and Clear (native/icon/clear/). Light's and Dark's icon picks take any of them, or "theme".
export const APP_ICONS = [
  ...byKey.get("lightTheme").options.map((o) => ({ value: o.value, label: o.label, tone: "light" })),
  ...byKey.get("darkTheme").options.map((o) => ({ value: o.value, label: o.label, tone: "dark" })),
  { value: "clear", label: "Clear", tone: null },
  // F324: the Glass icon (native/icon/glass.py): Classic in Light, Gunmetal in Dark, in iOS 26's Liquid Glass; older
  // iOS show a flat copy of it. Offered on every iOS (user 2026-11-21).
  // F371: renamed iOS 26 and shown under Eras: it is that era's icon.
  { value: "glass", label: "iOS 26", tone: null },
  // F371: the eras' icons (native/icon/era/), each era's light and dark; native/icon/alternates.py ERAS
  { value: "ios7", label: "iOS 7", era: "light" }, { value: "ios13", label: "iOS 13", era: "light" },
  { value: "ios7dark", label: "iOS 7", era: "dark" }, { value: "ios13dark", label: "iOS 13", era: "dark" },
];
// F371: each Theme > Style's own icon, by the mode on screen: what Match Theme (or a "Theme" pick) gives under that
// era. iOS 6 has none: its themes' icons. iOS 26's is the Glass icon, which has its own dark (Gunmetal) look.
export const ERA_ICONS = { ios7: { light: "ios7", dark: "ios7dark" }, ios13: { light: "ios13", dark: "ios13dark" },
  ios26: { light: "glass", dark: "glass" } };
// F371: the name the shell's sets know an icon's pair by: an era's dark icon is in its light icon's set
// (Icon-ios7 = ios7 + ios7dark, native/icon/alternates.py), so a pick in either mode sends the pair.
export const pairName = (name) => Object.values(ERA_ICONS).find((p) => p.dark === name)?.light ?? name;
// F371: the name of an era's light icon alone, in both appearances (Icon-ios7light), for Theme > Mode Light: B289
// keeps a Light Mode's icon on a dark Home Screen, which the pair set would turn dark.
export const lightOnlyName = (name) => (Object.values(ERA_ICONS).some((p) => p.light === name && p.dark !== name) ? `${name}light` : name);
for (const k of ["lightIcon", "darkIcon"]) byKey.get(k).options.push(...APP_ICONS.map(({ value, label }) => ({ value, label })));

// F37: the device types. "none" is an iPhone without a jailbreak; the others are the APT architecture it installs.
export const NOT_JAILBROKEN = "none";

// The jailbreak app's type from its bridge: `ifizboxNative.arch` (one of ARCHES) or `ifizboxNative.jailbreak`
// ("rootless" | "rootful" | "roothide", also what Bridge.swift app.info reports, F38), whichever the shell
// detected; null when it says neither (or "none").
export function bridgeArch(native) {
  if (ARCHES.includes(native?.arch)) return native.arch;
  return JAILBREAK_ARCH[native?.jailbreak] ?? null;
}

// The mode: the app's bridge says which build is running (I2 sets `ifizboxNative.mode`); a bridge without one is
// the N1 jailbreak shell; no bridge is the site.
export function detectMode(g = globalThis) {
  const n = g.ifizboxNative;
  if (!n) return "site";
  return MODES.includes(n.mode) && n.mode !== "site" ? n.mode : "jailbreak";
}

const resolve = (v, mode) => (typeof v === "function" ? v(mode) : v);

// Storage that never throws: Safari's private mode and a full quota both throw on setItem; settings then live
// for this session only.
function safeStorage(storage) {
  const mem = new Map();
  return {
    get(k) {
      try { const v = storage?.getItem(k); if (v != null) return v; } catch { /* unavailable */ }
      return mem.has(k) ? mem.get(k) : null;
    },
    set(k, v) {
      mem.set(k, v);
      try { storage?.setItem(k, v); } catch { /* unavailable: the memory copy stands */ }
    },
    remove(k) {
      mem.delete(k);
      try { storage?.removeItem?.(k); } catch { /* unavailable */ }
    },
  };
}

// F128: drops the stored values of the settings that went (RETIRED). Runs with every createSettings(); a value
// that isn't there costs one lookup. Returns the keys it removed, for the tests.
export function dropRetired(storage = globalThis.localStorage) {
  const store = storage?.remove ? storage : safeStorage(storage);
  const gone = [];
  for (const k of RETIRED) {
    if (store.get(PREFIX + k) == null) continue;
    store.remove(PREFIX + k);
    gone.push(k);
  }
  return gone;
}

// `helper` (jailbreak mode only): runs ifizbox-helper with the given words and resolves to { code, stdout }, e.g.
// helper(["hold", "com.foo"]). The app's bridge provides it as `ifizboxNative.helper` (N3); without one the holds
// stay a list on the device, as in the other modes.
// `native` (jailbreak mode): the bridge, for the detected jailbreak type (bridgeArch).
export function createSettings({ storage = globalThis.localStorage, mode = "site", features = FEATURES, helper, native = null } = {}) {
  if (!MODES.includes(mode)) throw new Error(`unknown mode ${mode}`);
  const store = safeStorage(storage);
  dropRetired(store);
  if (mode === "site") store.remove(PREFIX + "style"); // C69: the website is iOS 6; an era stored there is cleared
  // F37: a site visitor who picked an Architecture before Device existed keeps it as their device type; the app's
  // detected type becomes `arch` for getArch().
  const detected = mode === "jailbreak" ? bridgeArch(native) : null;
  if (detected) store.set(PREFIX + "arch", detected);
  if (mode === "site" && store.get(PREFIX + "device") == null && ARCHES.includes(store.get(PREFIX + "arch"))) {
    store.set(PREFIX + "device", store.get(PREFIX + "arch"));
  }
  const listeners = new Set();

  function def(key) {
    const d = byKey.get(key);
    if (!d || !d.options) throw new Error(`unknown setting ${key}`);
    return d;
  }
  const defaultOf = (d) => resolve(d.default, mode);
  const shown = (d) => d.modes.includes(mode) && features.has(d.feature);
  const notify = (key, value) => { for (const f of listeners) f(key, value); };

  function get(key) {
    const d = def(key);
    if (key === "style" && mode === "site") return defaultOf(d); // C69
    const raw = store.get(PREFIX + key);
    const hit = raw == null ? null : d.options.find((o) => String(o.value) === raw);
    if (!hit && raw != null && d.accepts?.(raw)) return raw; // F329: a value outside the list the setting takes
    return hit ? hit.value : defaultOf(d);
  }

  function set(key, value) {
    const d = def(key);
    const hit = d.options.find((o) => o.value === value) ?? (d.accepts?.(value) ? { value } : null); // F329
    if (!hit) throw new Error(`${key}: ${JSON.stringify(value)} is not one of its options`);
    if (key === "style" && mode === "site") return; // C69: the website is iOS 6; nothing stored
    const was = key === "upgradeNotifications" ? get(key) : undefined;
    store.set(PREFIX + key, String(value));
    notify(key, value);
    if (key === "upgradeNotifications" && was !== value) upgradeNotifications.pending = upgradeNotifications.sync(was);
    // Device (F37) carries the architecture: getArch() and everything listening for "arch" follow it.
    if (key === "device" && ARCHES.includes(value) && get("arch") !== value) set("arch", value);
  }

  // F37: "none" (no jailbreak) or the architecture APT packages are listed for. Site: the Device setting. Jailbreak
  // app: what the bridge detected, else the stored architecture. Sideload build: always "none".
  function deviceType() {
    if (mode === "sideload") return NOT_JAILBROKEN;
    if (mode === "jailbreak") return detected ?? get("arch");
    return get("device");
  }

  function readHolds() {
    try {
      const list = JSON.parse(store.get(HOLDS_KEY) || "[]");
      return Array.isArray(list) ? list.filter((p) => typeof p === "string") : [];
    } catch {
      return [];
    }
  }

  function writeHolds(list) {
    store.set(HOLDS_KEY, JSON.stringify(list));
    notify("holds", holds.list());
  }
  const dpkg = mode === "jailbreak" && typeof helper === "function" ? helper : null;
  async function run(words) {
    const r = await dpkg(words);
    if (!r || r.code !== 0) throw new Error(`ifizbox-helper ${words[0]} failed (exit ${r?.code})`);
    return r;
  }

  // Ignore upgrades, per package, on the device. In jailbreak mode with a helper the real hold is dpkg's
  // (apt-mark hold/unhold through ifizbox-helper, F22); this list is then the cache the row shows, set at once and
  // put right by `sync()` (apt-mark showhold) when the helper fails or something else changed the holds.
  // B69: an app's Ignore Upgrades (no dpkg package to hold: { dpkg: false }) is kept on the device beside dpkg's list,
  // which sync() never touches; list() and has() see both.
  const readAppHolds = () => {
    try { const l = JSON.parse(store.get(APP_HOLDS_KEY) || "[]"); return Array.isArray(l) ? l.filter((p) => typeof p === "string") : []; } catch { return []; }
  };
  const holds = {
    list: () => [...new Set([...readHolds(), ...readAppHolds()])].sort(),
    has: (pkg) => readHolds().includes(pkg) || readAppHolds().includes(pkg),
    // Resolves to true once the hold is in place (at once without a helper), false when dpkg refused it; the list
    // then shows dpkg's holds again (or the old list if showhold failed too).
    async set(pkg, on, { dpkg: viaDpkg = true } = {}) {
      const app = readAppHolds();
      if (!viaDpkg || (!on && app.includes(pkg) && !readHolds().includes(pkg))) {
        const next = new Set(app);
        if (on) next.add(pkg); else next.delete(pkg);
        if (next.size) store.set(APP_HOLDS_KEY, JSON.stringify([...next].sort())); else store.remove(APP_HOLDS_KEY);
        notify("holds", holds.list());
        return true;
      }
      const before = readHolds().sort();
      const list = new Set(before);
      if (on) list.add(pkg); else list.delete(pkg);
      writeHolds([...list].sort());
      if (!dpkg) return true;
      try {
        await run([on ? "hold" : "unhold", pkg]);
        return true;
      } catch {
        try { await holds.sync(); } catch { writeHolds(before); }
        return false;
      }
    },
    replace(pkgs) {
      writeHolds([...new Set(pkgs.filter((p) => typeof p === "string"))].sort());
    },
    // Jailbreak with a helper: dpkg's holds become the list (told to listeners only when it changed). Elsewhere a
    // no-op. Resolves to the list; rejects when the helper fails, leaving the list as it was.
    async sync() {
      if (!dpkg) return holds.list();
      const { stdout = "" } = await run(["showhold"]);
      const held = [...new Set(String(stdout).split("\n").map((l) => l.trim()).filter((l) => l))].sort();
      if (JSON.stringify(held) !== JSON.stringify(readHolds().sort())) writeHolds(held);
      return held;
    },
  };

  // F65: Upgrade Notifications reaches N5's daemon as a file only root can write: `ifizbox-helper notifications
  // on|off`. set() runs it on every change; sync() also runs it at launch (web/app/settings.js) when the switch is
  // off, so a phone whose file went missing (a reinstall of the .deb) is quiet again. Resolves to true once the
  // helper has done it (at once, without a helper); when it fails, the switch goes back to `undo` (listeners told)
  // and it resolves to false. `pending`: the last change's promise.
  const upgradeNotifications = {
    pending: Promise.resolve(true),
    async sync(undo) {
      if (!dpkg) return true;
      const on = get("upgradeNotifications");
      try {
        await run(["notifications", on ? "on" : "off"]);
        return true;
      } catch {
        if (typeof undo === "boolean" && get("upgradeNotifications") === on) {
          store.set(PREFIX + "upgradeNotifications", String(undo));
          notify("upgradeNotifications", undo);
        }
        return false;
      }
    },
  };

  // Section Visibility (Cydia's Sections edit mode, F24): section names whose packages drop out of every list,
  // Search and Changes. Kept on this device only, as a sorted JSON list; core/catalog.js setHidden does the filtering.
  function readHidden() {
    try {
      const list = JSON.parse(store.get(HIDDEN_SECTIONS_KEY) || "[]");
      return Array.isArray(list) ? [...new Set(list.filter((n) => typeof n === "string"))].sort() : [];
    } catch {
      return [];
    }
  }
  function writeHidden(list) {
    const sorted = [...new Set(list)].sort();
    if (JSON.stringify(sorted) === JSON.stringify(readHidden())) return;
    store.set(HIDDEN_SECTIONS_KEY, JSON.stringify(sorted));
    notify("hiddenSections", sorted);
  }
  const hiddenSections = {
    list: readHidden,
    has: (name) => readHidden().includes(name),
    set(name, hide) {
      const list = new Set(readHidden());
      if (hide) list.add(name); else list.delete(name);
      writeHidden([...list]);
    },
    replace: (names) => writeHidden((Array.isArray(names) ? names : []).filter((n) => typeof n === "string")),
  };

  // Hide by Author (F104, Zebra's filters): author names whose packages drop out like hidden sections'. Kept on
  // this device as a sorted JSON list; one name per author whatever its case (core/catalog.js compares lower-cased).
  function readHiddenAuthors() {
    try {
      const list = JSON.parse(store.get(HIDDEN_AUTHORS_KEY) || "[]");
      return Array.isArray(list) ? [...new Set(list.filter((n) => typeof n === "string" && n.trim()))].sort() : [];
    } catch {
      return [];
    }
  }
  const hiddenAuthors = {
    list: readHiddenAuthors,
    has: (name) => readHiddenAuthors().some((n) => n.toLowerCase() === String(name ?? "").trim().toLowerCase()),
    set(name, hide) {
      const n = String(name ?? "").trim();
      if (!n) return;
      const list = readHiddenAuthors().filter((x) => x.toLowerCase() !== n.toLowerCase());
      if (hide) list.push(n);
      const sorted = [...new Set(list)].sort();
      if (JSON.stringify(sorted) === JSON.stringify(readHiddenAuthors())) return;
      store.set(HIDDEN_AUTHORS_KEY, JSON.stringify(sorted));
      notify("hiddenAuthors", sorted);
    },
  };

  // F382: Source Filters (core/sourcefilters.js): { all: { id: bool }, "<source key>": { id: bool } }, only the
  // switches someone changed, kept on this device; core/catalog.js setFilters does the filtering. All Sources' Works
  // on My Phone is the worksOnMyPhone setting itself. Listeners hear ("sourceFilters", object) on a change.
  function readSourceFilters() {
    try {
      return normalizeFilters(JSON.parse(store.get(SOURCE_FILTERS_KEY) || "{}"));
    } catch {
      return {};
    }
  }
  function writeSourceFilters(next) {
    const clean = normalizeFilters(next);
    if (JSON.stringify(clean) === JSON.stringify(readSourceFilters())) return;
    if (Object.keys(clean).length) store.set(SOURCE_FILTERS_KEY, JSON.stringify(clean));
    else store.remove(SOURCE_FILTERS_KEY);
    notify("sourceFilters", clean);
  }
  const sourceFilters = {
    all: readSourceFilters,
    isOn: (key, id) => filterOn(readSourceFilters(), key, id, { fit: get("worksOnMyPhone") }),
    isCustom: (key) => isCustomFilter(readSourceFilters(), key, { lite: mode === "sideload", fit: get("worksOnMyPhone") }),
    set(key, id, on) {
      if (key === ALL_SOURCES && id === "fit") { set("worksOnMyPhone", Boolean(on)); return; }
      const all = readSourceFilters();
      all[key] = { ...all[key], [id]: Boolean(on) };
      writeSourceFilters(all);
    },
    // A source back to Same as All Sources; All Sources back to the defaults (Works on My Phone stays as it is).
    reset(key) {
      const all = readSourceFilters();
      delete all[key];
      writeSourceFilters(all);
    },
  };

  // F226: Block (Zebra #1037, #998): packages blocked from the package page, kept on this device as a JSON object
  // { id: name } (the name is for Settings > Blocked's rows), and the authors, which are F104's hidden authors (one
  // list: Block on a package page and Hide Packages by on the author page are the same switch). core/catalog.js
  // setBlocked leaves the packages out of Browse, Search, Sections and Changes. In jailbreak mode with a helper,
  // blocking an installed package also holds it with dpkg (holds.set, F22), so N7 and other managers leave it
  // alone; the ids whose hold the block made are kept apart (ifizbox.blockHolds), so Unblock lifts that hold and
  // never one the user set with Ignore Upgrades. Listeners hear ("blockedPackages", ids) on a change.
  function readBlocked() {
    try {
      const o = JSON.parse(store.get(BLOCKED_KEY) || "{}");
      if (!o || typeof o !== "object" || Array.isArray(o)) return {};
      const out = {};
      for (const [id, name] of Object.entries(o)) if (id.trim()) out[id] = typeof name === "string" && name.trim() ? name : id;
      return out;
    } catch {
      return {};
    }
  }
  function readBlockHolds() {
    try {
      const list = JSON.parse(store.get(BLOCK_HOLDS_KEY) || "[]");
      return Array.isArray(list) ? [...new Set(list.filter((p) => typeof p === "string"))].sort() : [];
    } catch {
      return [];
    }
  }
  function writeBlockHolds(list) {
    const sorted = [...new Set(list)].sort();
    if (sorted.length) store.set(BLOCK_HOLDS_KEY, JSON.stringify(sorted));
    else store.remove(BLOCK_HOLDS_KEY);
  }
  const blocked = {
    list: () => Object.keys(readBlocked()).sort(),
    has: (pkg) => Object.hasOwn(readBlocked(), pkg),
    name: (pkg) => readBlocked()[pkg] ?? pkg,
    // [{ id, name }] sorted by name, for Settings > Blocked.
    entries: () => Object.entries(readBlocked()).map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || (a.id < b.id ? -1 : 1)),
    heldByBlock: (pkg) => readBlockHolds().includes(pkg),
    // `installed`: whether dpkg has it, so a jailbreak block holds it too. Resolves to { held } once done: true when
    // this block put a dpkg hold on it, false otherwise (not installed, not jailbreak, already held, dpkg refused).
    async set(pkg, on, { name = null, installed = false } = {}) {
      const id = String(pkg ?? "").trim();
      if (!id) return { held: false };
      const all = readBlocked();
      const was = Object.hasOwn(all, id);
      if (on) all[id] = typeof name === "string" && name.trim() ? name.trim() : all[id] ?? id;
      else delete all[id];
      if (on || was) store.set(BLOCKED_KEY, JSON.stringify(all));
      if (on !== was) notify("blockedPackages", Object.keys(all).sort());
      if (on) {
        if (!dpkg || !installed || holds.has(id) || readBlockHolds().includes(id)) return { held: false };
        const ok = await holds.set(id, true);
        if (ok) writeBlockHolds([...readBlockHolds(), id]);
        return { held: ok };
      }
      if (readBlockHolds().includes(id)) {
        writeBlockHolds(readBlockHolds().filter((p) => p !== id));
        if (holds.has(id)) await holds.set(id, false);
      }
      return { held: false };
    },
    authors: () => hiddenAuthors.list(),
    hasAuthor: (name) => hiddenAuthors.has(name),
    setAuthor: (name, on) => hiddenAuthors.set(name, on),
  };

  // F281: Ignore This Version: the one version on offer now hidden for a package or app ({ id: version }), so an item
  // that is up to date already (updated outside iFizBox, a version the source writes differently) stops showing
  // as an upgrade until a newer one comes (core/appupdates.js splitIgnoredVersions, settleIgnoredVersions). Kept on
  // this device and synced like holds (core/account.js, core/transfer.js as "id version" lines, lines() below).
  // Listeners hear ("ignoredVersions", { id: version }) on a change.
  function readIgnoredVersions() {
    try {
      const o = JSON.parse(store.get(IGNORED_VERSIONS_KEY) || "{}");
      if (!o || typeof o !== "object" || Array.isArray(o)) return {};
      const out = {};
      for (const k of Object.keys(o).sort()) if (k.trim() && typeof o[k] === "string" && o[k].trim()) out[k] = o[k].trim();
      return out;
    } catch {
      return {};
    }
  }
  function writeIgnoredVersions(map) {
    const clean = {};
    for (const k of Object.keys(map ?? {}).sort()) {
      const v = map[k];
      if (String(k).trim() && typeof v === "string" && v.trim() && !/\s/.test(k) && !/\s/.test(v.trim())) clean[k] = v.trim();
    }
    if (JSON.stringify(clean) === JSON.stringify(readIgnoredVersions())) return;
    if (Object.keys(clean).length) store.set(IGNORED_VERSIONS_KEY, JSON.stringify(clean)); else store.remove(IGNORED_VERSIONS_KEY);
    notify("ignoredVersions", clean);
  }
  const ignoredVersions = {
    all: readIgnoredVersions,
    get: (id) => readIgnoredVersions()[id] ?? null,
    // `version`: the version to hide; null (or "") takes the item's back.
    set(id, version) {
      const map = readIgnoredVersions();
      if (typeof version === "string" && version.trim()) map[id] = version.trim(); else delete map[id];
      writeIgnoredVersions(map);
    },
    replace: (map) => writeIgnoredVersions(map && typeof map === "object" && !Array.isArray(map) ? map : {}),
    // ["<id> <version>"]: the form account sync and Open in App links carry (a set, merged like holds).
    lines: () => Object.entries(readIgnoredVersions()).map(([id, v]) => `${id} ${v}`),
  };

  // F70: Only Packages I Mark's marks (the package page's Update Automatically), package ids kept on the device as
  // a sorted JSON list like holds; listeners hear ("autoMarked", list) on a change.
  function readMarked() {
    try {
      const list = JSON.parse(store.get(AUTO_MARKED_KEY) || "[]");
      return Array.isArray(list) ? [...new Set(list.filter((p) => typeof p === "string"))].sort() : [];
    } catch {
      return [];
    }
  }
  const autoMarked = {
    list: readMarked,
    has: (pkg) => readMarked().includes(pkg),
    set(pkg, on) {
      const list = new Set(readMarked());
      if (on) list.add(pkg); else list.delete(pkg);
      const sorted = [...list].sort();
      if (JSON.stringify(sorted) === JSON.stringify(readMarked())) return;
      store.set(AUTO_MARKED_KEY, JSON.stringify(sorted));
      notify("autoMarked", sorted);
    },
  };

  // F100: Search's recent queries, kept on this device as a JSON list, newest first; listeners hear
  // ("recentSearches", list) on a change.
  function readRecent() {
    try {
      return addRecent(JSON.parse(store.get(RECENT_SEARCHES_KEY) || "[]"), "");
    } catch {
      return [];
    }
  }
  function writeRecent(list) {
    if (JSON.stringify(list) === JSON.stringify(readRecent())) return;
    store.set(RECENT_SEARCHES_KEY, JSON.stringify(list));
    notify("recentSearches", list);
  }
  const recentSearches = {
    list: readRecent,
    add: (query) => writeRecent(addRecent(readRecent(), query)),
    clear: () => writeRecent([]),
  };

  // F270: when the last refresh of the sources finished (ms since 1970), for pull to refresh's "Last Updated" line.
  // null until one has. Listeners hear ("lastRefresh", ms).
  const lastRefresh = {
    get() { const n = Number(store.get(LAST_REFRESH_KEY)); return Number.isFinite(n) && n > 0 ? n : null; },
    set(ms = Date.now()) { store.set(LAST_REFRESH_KEY, String(ms)); notify("lastRefresh", ms); },
  };

  // F272: whether the user has held the Installed tab to open the queue (nav/queuehint.js); once they have, the
  // "Hold Installed to see the queue" hint never shows again. Listeners hear ("queueHintHeld", true).
  const queueHint = {
    held: () => store.get(QUEUE_HINT_KEY) === "true",
    markHeld() { if (queueHint.held()) return; store.set(QUEUE_HINT_KEY, "true"); notify("queueHintHeld", true); },
  };

  // F70: the daemon's preferences, { "ifizbox.<key>": value }: string, bool or number as get() gives them, the lists
  // as arrays of package ids, ignoredVersions as its { id: version } object (F282). A setting nobody has picked is null (the shell removes the key), so the daemon keeps
  // its own default.
  // `keys`: only these (a setting's key or a list's name), for one change.
  // F128: the full set also sends RETIRED_DAEMON_KEYS as null, so a value an older app left there goes and the
  // daemon keeps its own default (Check for Updates Daily, cellular data on).
  function daemonPrefs(keys = [...DAEMON_KEYS, ...DAEMON_LISTS, ...RETIRED_DAEMON_KEYS]) {
    const out = {};
    for (const k of keys) {
      if (RETIRED_DAEMON_KEYS.includes(k)) out[PREFIX + k] = null;
      else if (k === "holds") out[HOLDS_KEY] = readHolds().sort();
      else if (k === "autoMarked") out[AUTO_MARKED_KEY] = readMarked();
      else if (k === "ignoredVersions") out[IGNORED_VERSIONS_KEY] = readIgnoredVersions(); // F282
      else if (DAEMON_KEYS.includes(k)) {
        const raw = store.get(PREFIX + k);
        out[PREFIX + k] = raw != null && def(k).options.some((o) => String(o.value) === raw) ? get(k) : null;
      }
    }
    return out;
  }

  // F315: iOS 6 hint style (AGENTS.md Hints): a footer explains only the group above it, so a section's rows are
  // split into groups and footers are never joined. A row with a hint of its own (hintOf) starts a group whose
  // footer it is; a row with `with: <key>` joins that row's group (Re-sign Reminder under Show Expiry Dates, Expiry
  // Warning under its switch); any other row joins the group before it while that group has no footer, else starts
  // a bare one. Only the section's first group carries its title; later groups are named by their first row's key.
  function sections() {
    const out = [];
    for (const s of SECTIONS) {
      const groups = [];
      // F201: a row with `style` shows only in that style (the Themes rows: iOS 6's themes only)
      for (const d of SETTINGS.filter((x) => x.section === s.id && shown(x) && (!x.style || get("style") === x.style))) {
        const hint = hintOf(d);
        const host = d.with ? groups.find((g) => g.settings.some((x) => x.key === d.with)) : null;
        const last = groups[groups.length - 1];
        if (host) host.settings.push(d);
        else if (!hint && last && !last.footer) last.settings.push(d);
        else groups.push({ settings: [d], footer: hint || undefined });
      }
      groups.forEach((g, i) => {
        const { title, ...rest } = s;
        out.push(i === 0 ? { ...s, section: s.id, ...g } : { ...rest, id: g.settings[0].key, section: s.id, ...g });
      });
    }
    return out;
  }
  // The footer a row puts under its group on the Settings page: `hint` (true: its footer), else a footer of its own
  // unless it is a list (a list's footer shows on the page it pushes).
  function hintOf(d) {
    if (d.hint === true) return resolve(d.footer, mode) || null;
    if (d.hint != null) return resolve(d.hint, mode) || null;
    return d.kind === "list" ? null : resolve(d.footer, mode) || null;
  }

  return {
    mode,
    get,
    set,
    holds,
    autoMarked,
    recentSearches,
    lastRefresh, // F270
    queueHint, // F272
    daemonPrefs,
    hiddenSections,
    hiddenAuthors,
    sourceFilters, // F382
    blocked, // F226
    ignoredVersions, // F281
    upgradeNotifications,
    deviceType,
    jailbroken: () => deviceType() !== NOT_JAILBROKEN,
    defaultOf: (key) => defaultOf(def(key)),
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
    isShown: (key) => { const d = byKey.get(key); return Boolean(d && shown(d)); },
    visible: () => SETTINGS.filter(shown),
    sections,
    footerOf: (key) => resolve(byKey.get(key)?.footer, mode),
    // F128: Settings' pages, each with the groups this mode shows; pages left empty are dropped.
    pages() {
      const all = sections();
      return PAGES.map((p) => ({ ...p, sections: all.filter((s) => s.page === p.id) })).filter((p) => p.sections.length);
    },
    pageOf: (id) => PAGES.find((p) => p.id === id) ?? null,
  };
}

// The theme Appearance asks for, given whether the system is dark right now.
export function themeFor(appearance, systemDark) {
  if (appearance === "light" || appearance === "dark") return appearance;
  return systemDark ? "dark" : "light";
}

// F198: the palette inside a tone, for <html data-palette> beside data-theme. Light has one (classic, the kit's);
// dark has Gunmetal (F13's, the default) and OLED Black among others. The dark one is stored at
// localStorage["ifizbox.darkTheme"]; Theme > Dark (F199) sets it (anything else reads as the default, Gunmetal).
// theme-boot.js keeps the same rule.
// F199: the lists come from the lightTheme and darkTheme settings' options, the defaults from their `default`, and
// lightTheme is stored at LIGHT_THEME_KEY the same way.
export const DARK_PALETTES = byKey.get("darkTheme").options.map((o) => o.value);
export const LIGHT_PALETTES = byKey.get("lightTheme").options.map((o) => o.value);
export const DARK_DEFAULT = byKey.get("darkTheme").default;
export const LIGHT_DEFAULT = byKey.get("lightTheme").default;
export const DARK_THEME_KEY = "ifizbox.darkTheme";
export const LIGHT_THEME_KEY = "ifizbox.lightTheme";
export function paletteFor(theme, darkTheme, lightTheme) {
  if (theme !== "dark") return LIGHT_PALETTES.includes(lightTheme) ? lightTheme : LIGHT_DEFAULT;
  return DARK_PALETTES.includes(darkTheme) ? darkTheme : DARK_DEFAULT;
}

// F199: everything Theme's page decides, in one call (theme-boot.js keeps the same rule before first paint): Mode
// picks the tone (Automatic: the system's), and the tone's chosen theme is the palette. `preview` ("light" or
// "dark") is the tone of the theme list on screen: the page shows that list's theme while it is open.
// F201: `style` is the era (<html data-style>): iOS 6's themes are the lightTheme and darkTheme picks; another era has
// its own pair (STYLE_PALETTES) and no picks, so neither the picks nor a preview change it.
export function themeState({ style = "ios6", appearance, lightTheme, darkTheme, preview = null }, systemDark) {
  const era = STYLES.includes(style) ? style : STYLE_DEFAULT;
  const own = STYLE_PALETTES[era];
  const theme = !own && (preview === "light" || preview === "dark") ? preview : themeFor(appearance, systemDark);
  return { theme, palette: own ? own[theme] : paletteFor(theme, darkTheme, lightTheme), style: era };
}

// F201: the eras Theme > Style offers (the style setting's options), iOS 6 first and the default. An era that is not
// iOS 6 paints only its own two themes, one per tone: iOS 7's White (no palette block: ios6.css's light tokens, then
// ios7.css's) and OLED Black (ios6.css's dark block, then ios7.css's). theme-boot.js keeps the same table.
export const STYLES = byKey.get("style").options.map((o) => o.value);
export const STYLE_DEFAULT = byKey.get("style").default;
export const STYLE_KEY = "ifizbox.style";
export const STYLE_PALETTES = { ios7: { light: "white", dark: "oled" }, ios13: { light: "white", dark: "oled" },
  ios26: { light: "white", dark: "oled" } };

// B235: the launch set (native/launch/make.py THEMES) an era's own theme opens on, where the iOS 6 set of the same
// name draws other bars: iOS 7's and iOS 13's OLED Black have flat #000 bars with a hairline (#262626, #38383a), not
// iOS 6's glossed ones. The page keeps data-palette "oled" (ios7.css and ios13.css draw it by data-style); only the
// shell's app.theme (screens/settings.js) carries the launch key, for its ground and its next splash.
// B237: iOS 13's White likewise (#f2f2f7 ground, #f9f9f9 bars; iOS 7's White set has #efeff4 and #f7f7f7).
// F203: iOS 26 opens on iOS 13's sets: the same #f2f2f7 / #000 grounds (its bars have no hairline, a 1pt difference).
export const STYLE_LAUNCH = { ios7: { oled: "oled7" }, ios13: { oled: "oled13", white: "white13" },
  ios26: { oled: "oled13", white: "white13" } };
export const launchKey = (style, palette) => STYLE_LAUNCH[style]?.[palette] ?? palette;

// F202: the nav hooks an era turns on (docs/eras.md, "Nav hooks"): `nav: "large"` puts <html data-nav="large"> (large
// titles, nav/navbar.js setLargeTitles), `sheet: "card"` puts <html data-sheet="card"> (card sheets, nav/sheet.js).
// iOS 6 and iOS 7 turn none on. screens/settings.js applyTheme sets them with the style.
// F203: `tabbar: "float"` puts <html data-tabbar="float"> (the floating tab bar, nav/tabbar.js setFloatingTabbar).
export const STYLE_HOOKS = { ios13: { nav: "large", sheet: "card" }, ios26: { nav: "large", sheet: "card", tabbar: "float" } };
export const hooksOf = (style) => ({ nav: null, sheet: null, tabbar: null, ...STYLE_HOOKS[style] });

// F323: the app icon a tone ("light" or "dark") gets: with Match Theme on, that tone's theme's icon; off, the tone's
// pick (lightIcon, darkIcon), its theme's own while that is "theme". `get` reads a setting (settings.get).
// F371: under iOS 7, 13 and 26 (Theme > Style) the theme's own icon is the era's (ERA_ICONS).
// F371: a "Theme" pick beside an era icon picked for the other mode takes that era's icon for this mode, so a pick in
// either mode gives the era's pair (Icon-ios7 = ios7 + ios7dark).
export function iconFor(tone, get) {
  const t = tone === "dark" ? "dark" : "light";
  const own = ERA_ICONS[get("style")]?.[t] ?? paletteFor(tone, get("darkTheme"), get("lightTheme"));
  if (get("iconMatch") !== false) return own;
  const known = (v) => APP_ICONS.some((i) => i.value === v) || isOwnIcon(v);
  const pick = get(t === "dark" ? "darkIcon" : "lightIcon");
  if (known(pick)) return pick;
  const other = get(t === "dark" ? "lightIcon" : "darkIcon");
  return Object.values(ERA_ICONS).find((p) => p.light === other || p.dark === other)?.[t] ?? own;
}

// F329: one of your own icons (screens/appicon.js), kept by the shell as <name>.png: "own" and a few [a-z0-9]. A pick
// of one is shown like any icon (appicon/<name>.png); the shell's app.icon applies it.
export const OWN_ICON = /^own[a-z0-9]{1,16}$/;
export const isOwnIcon = (v) => typeof v === "string" && OWN_ICON.test(v);

// F323: what the shell's app.icon takes: the icon for a light and for a dark Home Screen, and the one of the tone on
// screen now (iOS 15-17 show only that one; native/Sources/AppIcon.swift picks the set).
// B289 (user 2026-11-21): the Home Screen follows Theme > Mode, not only the iPhone's: Mode Light or Dark gives both
// slots that tone's icon (its App Icon pick when Match Theme is off), so a dark Home Screen keeps a Light Mode's
// icon; Automatic keeps the light/dark pair.
export function iconState(get, onScreen) {
  const mode = get("appearance");
  const fixed = mode === "light" || mode === "dark" ? lightOnlyName(iconFor(mode, get)) : null;
  // F371: Automatic sends an era icon as its pair's name (ios7dark as ios7), so ios7 with ios7dark is Icon-ios7;
  // a fixed Mode keeps the one icon (Icon-ios7dark in Dark, Icon-ios7light in Light), as B289 wants.
  return {
    light: fixed ?? pairName(iconFor("light", get)),
    dark: fixed ?? pairName(iconFor("dark", get)),
    onScreen: fixed ?? iconFor(onScreen === "dark" ? "dark" : "light", get),
  };
}

// F323: Theme > App Icon > Light / Dark's grid: "Themes", that tone's themes; "Eras" (F371), iOS 7's and iOS 13's
// icon for that tone and iOS 26's (the Glass icon); "Special", Clear and the other tone's themes (any icon works in
// either mode). Each group's cells are APP_ICONS entries.
// `clear`: whether Clear is offered (clearOffered: not below iOS 18, user 2026-11-20).
export function iconGroups(tone, { clear = true } = {}) {
  const t = tone === "dark" ? "dark" : "light";
  return [
    { header: "Themes", icons: APP_ICONS.filter((i) => i.tone === t) },
    { header: "Eras", icons: [...APP_ICONS.filter((i) => i.era === t), APP_ICONS.find((i) => i.value === "glass")] },
    { header: "Special", icons: [...(clear ? [APP_ICONS.find((i) => i.value === "clear")] : []), ...APP_ICONS.filter((i) => i.tone && i.tone !== t)] },
  ];
}

// F323 (user 2026-11-20): Clear, like iOS's own clear and tinted icons, is for iOS 18 and later; phones below that
// (the iPhone 7 on iOS 15) aren't offered it. `ios`: "15.8.8"; unknown (null) offers it.
export function clearOffered(ios) {
  const major = parseInt(String(ios ?? ""), 10);
  return !Number.isFinite(major) || major >= 18;
}
