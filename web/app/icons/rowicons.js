// F205: the 29pt row icons of iOS 6's Settings app, redrawn as SVG (no Apple artwork): a flat rounded square tile in
// one colour per row and a white glyph, the same simple style as Home's tiles (home.css .home-glyph; user
// 2026-11-18: no gloss, keep the colours).
//
//   rowIcon("general")  -> { cls: "row-icon", src: "data:image/svg+xml,…" }   a grouped()/plain() row's `icon`
//   tileSvg("general")  -> the SVG text
//   SETTING_ICONS       core/settings.js keys -> icon names (screens/settings.js draws them)
//   ICON_SETS           the per-style icon map: these tiles and every other SVG the screens draw (below, C51)
//
// Measured off the 4S (Preferences.app's Settings icons, 58x58 @2x, and a screenshot of Settings' root):
//   tile      29 x 29pt, corners ~5pt (the first opaque pixel 9px in on the top row @2x)
//   glyph     white, ~19pt, centred
//   spacing   the tile 7pt in from the cell's left edge, the label 11pt after it (ios6.css .cell-icon.row-icon)
// Tiles look the same in both themes, as iOS 6's did.

const SIZE = 29;
const R = 6; // home.css / ios6.css .cell-icon's corners

// Tile colours.
const C = {
  grey: "#8c9097", blue: "#3f80e0", sky: "#3ea2e8", green: "#40ae4c", red: "#e2382f", orange: "#f08b1d",
  purple: "#7650cc", indigo: "#4650b4", dark: "#55595f", teal: "#22a6b5", gold: "#e8ad1a", brown: "#a6763f",
  pink: "#e04a86",
};

// Glyphs on a 24-unit square. Parts: ["f", d] filled, ["e", d] filled even-odd (holes), ["s", d, width] stroked.
const disc = "M12 2.5a9.5 9.5 0 1 1 0 19a9.5 9.5 0 0 1 0-19z";
function gear() {
  const pts = [];
  const teeth = 8, ro = 10.5, ri = 7.9;
  for (let i = 0; i < teeth * 4; i++) {
    const a = (i / (teeth * 4)) * Math.PI * 2 - Math.PI / 2 + Math.PI / (teeth * 4);
    const r = i % 4 < 2 ? ro : ri;
    pts.push(`${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join("L")}zM12 8.4a3.6 3.6 0 1 0 0 7.2a3.6 3.6 0 0 0 0-7.2z`;
}
function star() {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? 4.3 : 10;
    pts.push(`${(12 + r * Math.cos(a)).toFixed(2)} ${(12.8 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join("L")}z`;
}
const person = "M12 2.8a4.7 4.7 0 1 1 0 9.4a4.7 4.7 0 0 1 0-9.4zM2.8 21.5c.4-5 4.3-7.8 9.2-7.8s8.8 2.8 9.2 7.8z";
const arrows = [["s", "M19.2 9.2A7.6 7.6 0 0 0 5.2 8.6", 2.6], ["f", "M3.2 4.2v7h7z"],
  ["s", "M4.8 14.8a7.6 7.6 0 0 0 14 .6", 2.6], ["f", "M20.8 19.8v-7h-7z"]];
const eye = [["s", "M2.2 12s3.6-6.3 9.8-6.3S21.8 12 21.8 12s-3.6 6.3-9.8 6.3S2.2 12 2.2 12z", 2.2],
  ["f", "M12 8.8a3.2 3.2 0 1 1 0 6.4a3.2 3.2 0 0 1 0-6.4z"]];

export const GLYPHS = {
  person: [["f", person]],
  personPlus: [["f", "M9.5 3.5a4.3 4.3 0 1 1 0 8.6a4.3 4.3 0 0 1 0-8.6zM1.5 21c.4-4.6 3.8-7.2 8-7.2s7.6 2.6 8 7.2z"],
    ["f", "M18 4.5h2.4v3.1h3.1V10h-3.1v3.1H18V10h-3.1V7.6H18z"]],
  gear: [["e", gear()]],
  contrast: [["e", `${disc}M12 4.8a7.2 7.2 0 0 0 0 14.4z`]],
  download: [["e", `${disc}M10.6 6.2h2.8v6.2h3.2L12 17.4l-4.6-5h3.2z`]],
  refresh: [["s", "M19.4 12a7.4 7.4 0 1 1-2.3-5.4", 2.8], ["f", "M21 3v7.4h-7.4z"]],
  arrows,
  pen: [["f", "M15.6 3.4a1.8 1.8 0 0 1 2.6 0l2.4 2.4a1.8 1.8 0 0 1 0 2.6L9.3 19.7 2.8 21.2l1.5-6.5z"]],
  terminal: [["s", "M4.5 7l5.5 5-5.5 5", 3], ["s", "M12 18h7.5", 3]],
  install: [["f", "M10.5 2.5h3v9.7l3.4-3.4 2.1 2.1L12 17.9l-7-7 2.1-2.1 3.4 3.4zM3.5 19h17v2.8h-17z"]],
  list: [["f", "M3.3 5.5a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0-3.8 0zM9.3 4.2h11.6v2.6H9.3z"
    + "M3.3 12a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0-3.8 0zM9.3 10.7h11.6v2.6H9.3z"
    + "M3.3 18.5a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0-3.8 0zM9.3 17.2h11.6v2.6H9.3z"]],
  transfer: [["f", "M7.5 2.5l5.3 5.8H9.2v6H5.8v-6H2.2zM16.5 21.5l-5.3-5.8h3.6v-6h3.4v6h3.6z"]],
  eyeSlash: [...eye, ["s", "M4 20.5L20 3.5", 2.4]],
  eye,
  star: [["f", star()]],
  phone: [["e", "M7.6 1.5h8.8a2.1 2.1 0 0 1 2.1 2.1v16.8a2.1 2.1 0 0 1-2.1 2.1H7.6a2.1 2.1 0 0 1-2.1-2.1V3.6a2.1 2.1 0 0 1 2.1-2.1z"
    + "M7.7 4.3v13.6h8.6V4.3zM12 18.9a1.2 1.2 0 1 0 0 2.4a1.2 1.2 0 0 0 0-2.4z"]],
  info: [["e", `${disc}M10.6 10.2h2.8v8h-2.8zM12 5.4a1.7 1.7 0 1 0 0 3.4a1.7 1.7 0 0 0 0-3.4z`]],
  check: [["s", "M4 12.6l5.2 5.2L20 6.6", 3.4]],
  checkCircle: [["s", "M12 3a9 9 0 1 1 0 18a9 9 0 0 1 0-18z", 2], ["s", "M7.2 12.4l3.3 3.3 6.3-6.6", 2.6]],
  home: [["f", "M12 2.6l10.2 9.2H19v9.4h-5.2v-6.4h-3.6v6.4H5v-9.4H1.8z"]],
  minusCircle: [["e", `${disc}M6.5 10.6h11v2.8h-11z`]],
  bell: [["f", "M12 2.4c.9 0 1.6.7 1.6 1.6v.6c2.9.7 4.8 3.3 4.8 6.4v4.4l2.1 2.6v1.1H3.5V18l2.1-2.6V11c0-3.1 1.9-5.7 4.8-6.4V4c0-.9.7-1.6 1.6-1.6zM9.5 20h5a2.5 2.5 0 0 1-5 0z"]],
  bolt: [["f", "M14 1.8L4.8 13.6h6.1L9.6 22.2l9.6-12.1h-6.2z"]],
  battery: [["e", "M3.2 6.8h15.6a1.6 1.6 0 0 1 1.6 1.6v7.2a1.6 1.6 0 0 1-1.6 1.6H3.2a1.6 1.6 0 0 1-1.6-1.6V8.4a1.6 1.6 0 0 1 1.6-1.6zM3.9 9v6h14.2V9z"],
    ["f", "M21.2 10h1.3v4h-1.3zM12.2 9.8l-4 3.2h2.8l-1 2.3 4-3.3h-2.8z"]],
  lock: [["e", "M6.8 10.4V8a5.2 5.2 0 0 1 10.4 0v2.4h1.6v11.2H5.2V10.4zM9.5 10.4h5V8a2.5 2.5 0 0 0-5 0z"]],
  clock: [["e", `${disc}M10.8 5.8h2.4v5.6l3.9 2.6-1.3 2-5-3.4z`]],
  calendar: [["e", "M3 4.6h18V21H3zM5.2 9.2v9.6h13.6V9.2z"], ["f", "M6.8 2.4h2.4v4.4H6.8zM14.8 2.4h2.4v4.4h-2.4zM7.2 11.2h3.4v3.2H7.2z"]],
  hourglass: [["f", "M5.5 2.2h13v2.2h-1.1c0 3.4-2.4 5.6-4 7.6 1.6 2 4 4.2 4 7.6h1.1v2.2h-13v-2.2h1.1c0-3.4 2.4-5.6 4-7.6-1.6-2-4-4.2-4-7.6H5.5z"]],
  link: [["s", "M10.2 13.8a4 4 0 0 0 5.7 0l3.6-3.6a4 4 0 0 0-5.7-5.7l-1.3 1.3", 2.6],
    ["s", "M13.8 10.2a4 4 0 0 0-5.7 0l-3.6 3.6a4 4 0 0 0 5.7 5.7l1.3-1.3", 2.6]],
  question: [["s", "M8.4 8.8a3.6 3.6 0 1 1 5.2 3.3c-1.1.6-1.6 1.4-1.6 2.6v.8", 3], ["f", "M12 17.4a1.9 1.9 0 1 0 0 3.8a1.9 1.9 0 0 0 0-3.8z"]],
  globe: [["s", "M12 2.9a9.1 9.1 0 1 0 0 18.2a9.1 9.1 0 0 0 0-18.2z", 1.9],
    ["s", "M12 2.9c-2.6 2.5-3.9 5.6-3.9 9.1s1.3 6.6 3.9 9.1c2.6-2.5 3.9-5.6 3.9-9.1S14.6 5.4 12 2.9z", 1.9], ["s", "M3 12h18", 1.9]],
  cloud: [["f", "M6.8 19.6a4.6 4.6 0 0 1-.5-9.2 6 6 0 0 1 11.5-.9 5.1 5.1 0 0 1 .3 10.1z"]],
  pulse: [["s", "M2 12.5h4.2l2.6-6.2 4.2 12 2.6-5.8H22", 2.6]],
  share: [["s", "M8.2 9.6H5.8v11h12.4v-11h-2.4", 2.4], ["s", "M12 15V5", 2.6], ["f", "M12 1.8l4.6 4.8H7.4z"]],
  copy: [["e", "M8.5 7.5h11.5v14H8.5zM10.8 9.8v9.4h6.9V9.8z"], ["f", "M4 2.5h11.5v3H6.4V17H4z"]],
  save: [["e", "M5 2.5h9.2L19 7.3v14.2H5zM7.4 4.9v14.2h9.2V8.3h-3.4V4.9z"], ["f", "M10.8 9.5h2.4v4.4h2.3L12 17.6l-3.5-3.7h2.3z"]],
  qr: [["e", "M2.5 2.5h8v8h-8zM4.7 4.7v3.6h3.6V4.7zM13.5 2.5h8v8h-8zM15.7 4.7v3.6h3.6V4.7zM2.5 13.5h8v8h-8zM4.7 15.7v3.6h3.6v-3.6z"],
    ["f", "M13.5 13.5h3v3h-3zM18.5 13.5h3v3h-3zM16 16.2h2.6v2.6H16zM13.5 18.5h3v3h-3zM18.5 18.5h3v3h-3z"]],
  file: [["e", "M5 2.5h9.2L19 7.3v14.2H5zM13.2 4.2v4.1h4.1z"]],
  clipboard: [["e", "M5 4.4h3V3.6A1.6 1.6 0 0 1 9.6 2h4.8A1.6 1.6 0 0 1 16 3.6v.8h3v17.1H5zM7.4 6.8v12.3h9.2V6.8h-.6v1.8H8v-1.8z"]],
  key: [["e", "M14.6 2.6a6.2 6.2 0 1 1-2.2 12l-1.6 1.6H8.4v2.4H6v2.4H2.6v-3.6l6.9-6.9a6.2 6.2 0 0 1 5.1-7.9zM16 6.2a1.8 1.8 0 1 0 0 3.6a1.8 1.8 0 0 0 0-3.6z"]],
  seal: [["f", "M7.8 13.6 5.4 22l3.3-1.5 2.2 2.3 1.2-7.1zM16.2 13.6l2.4 8.4-3.3-1.5-2.2 2.3-1.2-7.1z"],
    ["e", "M12 1.6a7 7 0 1 1 0 14a7 7 0 0 1 0-14zM12 4.6a4 4 0 1 0 0 8a4 4 0 0 0 0-8z"]],
  power: [["s", "M7.4 6.4a8 8 0 1 0 9.2 0", 2.8], ["s", "M12 2.4v9", 2.8]],
  apps: [["f", "M3 3h7.5v7.5H3zM13.5 3H21v7.5h-7.5zM3 13.5h7.5V21H3zM13.5 13.5H21V21h-7.5z"]],
  plus: [["f", "M10.2 3h3.6v7.2H21v3.6h-7.2V21h-3.6v-7.2H3v-3.6h7.2z"]], // F327: More Sources
  // F350: the Details page's rows (Maintainer, More Information, Version, Filesystem Content)
  envelope: [["e", "M2.5 5.5h19v13h-19zM4.6 7.4v9.2h14.8V7.4z"], ["s", "M3.4 6.4 12 13.2l8.6-6.8", 1.7],
    ["s", "M3.6 17.6 9.6 11.6M20.4 17.6l-6-6", 1.4]],
  laptop: [["e", "M5 5h14v10H5zM6.8 6.8v6.4h10.4V6.8z"], ["f", "M2 16.2h20l-1.6 2.8H3.6z"]],
  badge: [["e", "M5.5 3.5h13v18h-13zM7.3 5.3v14.4h9.4V5.3z"], ["f", "M10 2h4v3h-4z"],
    ["f", "M12 8.2a2 2 0 1 1 0 4a2 2 0 0 1 0-4zM8.8 16.6c.2-2 1.5-3.2 3.2-3.2s3 1.2 3.2 3.2z"]],
  folder: [["f", "M2.5 5h7l2 2.2h10v11.8h-19z"]],
};

// Icon name -> tile colour and glyph. One name per thing a row is about, so the same thing looks the same everywhere.
export const ROW_ICONS = {
  pairPhone: [C.blue, "link"], testConnection: [C.green, "checkCircle"], cellular: [C.orange, "bolt"], // F372: This iPhone's Set Up
  account: [C.sky, "person"], createAccount: [C.green, "personPlus"], signInKey: [C.gold, "key"],
  syncNow: [C.blue, "arrows"], lastSynced: [C.grey, "clock"], syncCert: [C.orange, "seal"], showKey: [C.dark, "eye"],
  general: [C.grey, "gear"], theme: [C.indigo, "contrast"], updates: [C.green, "download"], signing: [C.orange, "pen"],
  logs: [C.dark, "terminal"], ipa: [C.blue, "install"], openInApp: [C.pink, "share"],
  device: [C.grey, "phone"], iosVersion: [C.blue, "info"], worksOnMyPhone: [C.green, "check"], compatMarks: [C.teal, "checkCircle"],
  refresh: [C.sky, "refresh"], returnHome: [C.blue, "home"],
  holds: [C.red, "minusCircle"], notifications: [C.red, "bell"], autoInstall: [C.purple, "bolt"], idle: [C.green, "battery"],
  respring: [C.dark, "power"], keepVersions: [C.brown, "clock"], showExpiry: [C.red, "calendar"], resignReminder: [C.orange, "hourglass"],
  keepBundleId: [C.indigo, "copy"], // F237: Keep Bundle IDs (no duplicate copies)
  showExpiryWarning: [C.gold, "seal"], expiryWarning: [C.gold, "clock"], // F244: Home's certificate warning
  otherLinks: [C.purple, "link"], lockHome: [C.dark, "lock"], websiteApps: [C.blue, "apps"],
  // F350: the Details page (screens/details.js)
  pkgSettings: [C.dark, "gear"], pkgAuthor: [C.dark, "envelope"], pkgMore: [C.purple, "laptop"],
  pkgVersion: [C.grey, "badge"], pkgBundle: [C.indigo, "badge"], pkgFiles: [C.orange, "folder"],
  pkgSection: [C.brown, "apps"], pkgBlock: [C.red, "minusCircle"], pkgTweaks: [C.green, "bolt"], pkgWish: [C.pink, "plus"],
  pkgSize: [C.teal, "download"], pkgDepends: [C.purple, "link"], pkgConflicts: [C.red, "bolt"], pkgLink: [C.blue, "globe"],
  help: [C.blue, "question"], server: [C.teal, "globe"], checkServer: [C.green, "pulse"], runYourOwn: [C.orange, "cloud"],
  shareCert: [C.green, "personPlus"], // Share Your Certificate (SideDrop)
  sources: [C.blue, "list"], transfer: [C.green, "transfer"], hidden: [C.grey, "eyeSlash"], recommended: [C.gold, "star"],
  findMore: [C.purple, "globe"], // Manage > Find More Sources (Canister's repo index)
  moreSources: [C.blue, "plus"], // F327: More Sources (Sources tab, Home, Manage): a white plus, no badge
  share: [C.blue, "share"], copy: [C.grey, "copy"], saveFile: [C.teal, "save"], qr: [C.dark, "qr"],
  fromFile: [C.teal, "file"], fromClipboard: [C.brown, "clipboard"],
  installation: [C.blue, "phone"], // Settings > Installation (Signing Server / This iPhone)
  signingServer: [C.purple, "cloud"], // Installation & Signing: Install Apps With > Signing Server
  // F384: a source page's Information group (screens/sourcepage.js)
  srcTrust: [C.green, "seal"], srcWebsite: [C.blue, "globe"], srcStatus: [C.red, "pulse"], srcUpdated: [C.sky, "refresh"],
  srcRelease: [C.indigo, "calendar"], srcHttps: [C.dark, "lock"], srcSigned: [C.gold, "key"],
};

// core/settings.js's setting keys -> their row's icon. A key not here is a row with no icon (Appearance's choices).
export const SETTING_ICONS = {
  device: "device", iosVersion: "iosVersion", worksOnMyPhone: "worksOnMyPhone", compatMarks: "compatMarks",
  refreshOnLaunch: "refresh", tweakIndexRefresh: "pkgTweaks", returnHome: "returnHome", holds: "holds", upgradeNotifications: "notifications",
  autoInstall: "autoInstall", autoInstallIdle: "idle", respring: "respring", keepVersions: "keepVersions",
  showExpiry: "showExpiry", resignReminder: "resignReminder", keepBundleId: "keepBundleId",
  showExpiryWarning: "showExpiryWarning", expiryWarning: "expiryWarning", // F244
};

// Settings' pages (core/settings.js PAGES) -> their root row's icon.
export const PAGE_ICONS = { general: "general", theme: "theme", updates: "updates", installation: "installation", signing: "signing" };


// F176: Copying Files' app and system tiles (screens/guides.js): our own glyphs on a 58-unit tile, never Apple's,
// Microsoft's or LocalSend's artwork (AGENTS.md): a folder, radio waves, swap arrows, a monitor, a window, a penguin
// of our own. Name -> [light colour, tile colour, the white glyph's SVG body].
const GUIDE_TILES = {
  files: ["#7cc0fb", "#1a6fd8", "<path d='M11 18h13l4 4h19v22H11z'/><path d='M11 25h36' stroke='#1a6fd8' stroke-width='2' fill='none' opacity='.35'/>"],
  airdrop: ["#7fd0f7", "#1f8fd6", "<circle cx='29' cy='38' r='4.5'/><g fill='none' stroke='#fff' stroke-width='4' stroke-linecap='round'><path d='M20 31a12 12 0 0 1 18 0'/><path d='M14 25a20 20 0 0 1 30 0'/><path d='M9 19a28 28 0 0 1 40 0'/></g>"],
  localsend: ["#6fe0bf", "#14916f", "<g fill='none' stroke='#fff' stroke-width='4.5' stroke-linecap='round' stroke-linejoin='round'><path d='M21 44V15m-8 8 8-8 8 8'/><path d='M37 14v29m-8-8 8 8 8-8'/></g>"],
  pairdrop: ["#b9a3f7", "#5b3fc9", "<rect x='9' y='15' width='16' height='28' rx='3'/><rect x='33' y='15' width='16' height='28' rx='3'/><g fill='none' stroke='#5b3fc9' stroke-width='3' stroke-linecap='round'><path d='M17 37h0M41 37h0'/></g><path d='M27 29h4' stroke='#fff' stroke-width='3.5' stroke-linecap='round'/>"],
  mac: ["#d9dde3", "#7c8592", "<rect x='9' y='12' width='40' height='27' rx='3'/><rect x='12' y='15' width='34' height='21' fill='#5e7fa8'/><path d='M24 39h10l2 7H22z'/><rect x='18' y='45' width='22' height='3' rx='1.5'/>"],
  windows: ["#74b6f2", "#1d5fc0", "<rect x='9' y='13' width='40' height='32' rx='3'/><rect x='12' y='20' width='34' height='22' fill='#2f74d0'/><g fill='#1d5fc0'><circle cx='14' cy='16.5' r='1.5'/><circle cx='19' cy='16.5' r='1.5'/></g><path d='M15 24h12v7H15zM30 24h13v15H30zM15 34h12v5H15z' fill='#bcd8f6'/>"],
  linux: ["#5d5d5d", "#1d1d1d", "<ellipse cx='29' cy='34' rx='13' ry='15'/><ellipse cx='29' cy='35' rx='8.5' ry='11' fill='#1d1d1d'/><circle cx='29' cy='19' r='9'/><g fill='#1d1d1d'><circle cx='25.5' cy='18' r='1.6'/><circle cx='32.5' cy='18' r='1.6'/></g><path d='M25 22h8l-4 4z' fill='#f6b73c'/><path d='M17 48h9l-2-4h-6zM32 48h9l-1-4h-6z' fill='#f6b73c'/>"],
  filza: ["#ffc66b", "#e07e14", "<path d='M11 16h12l4 4h20v24H11z'/><g fill='none' stroke='#e07e14' stroke-width='3' stroke-linecap='round'><path d='M19 27v11h8M19 32h8'/></g><rect x='29' y='25' width='10' height='5' rx='1' fill='#e07e14'/><rect x='29' y='35' width='10' height='5' rx='1' fill='#e07e14'/>"],
};

// Home's tiles (home.css .home-glyph, .glyph-<name>): the tile's colour, its gradient (optional), the glyph SVG on
// 24 units, drawn 21px on the 29px tile. No colour: the row gives it (the green row's --tile-glyph-green, the
// certificate tile's ink). home.css holds every one but Why as homeGlyphRules("ios6") prints them (rowicons.test.js);
// screens/why.js writes the Why tile's itself (homeTileCss).
const HOME_SVG = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'";
const HOME_TILES = {
  why: { colour: "#d8820f", gradient: ["#f4b03f", "#d8820f"], // screens/why.js: the Why tile's star
    svg: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='#fff' d='M12 3.2l2.6 5.5 6 .7-4.4 4.1 1.2 5.9L12 16.5l-5.4 2.9 1.2-5.9-4.4-4.1 6-.7z'/></svg>" },
  github: { colour: "#333", svg: `${HOME_SVG} fill='none' stroke='#fff' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'><path d='M8 6 2 12l6 6M16 6l6 6-6 6M14 4l-4 16'/></svg>` },
  sources: { colour: "#5c7aa3", svg: `${HOME_SVG} fill='#fff'><path d='M3 4h18v4H3zM4 9h16v11H4zm5 3v2h6v-2z' fill-rule='evenodd'/></svg>` },
  // the old blurple and Clyde
  discord: { colour: "#7289da", svg: `${HOME_SVG}><path fill='#fff' d='M19.3 5.4A16.6 16.6 0 0 0 15.2 4l-.5 1a15.3 15.3 0 0 0-5.4 0l-.5-1a16.5 16.5 0 0 0-4.1 1.4C2.1 9.3 1.4 13.2 1.8 17a16.7 16.7 0 0 0 5 2.5l1.1-1.7a10.8 10.8 0 0 1-1.7-.8l.4-.3a11.9 11.9 0 0 0 10.8 0l.4.3a10.8 10.8 0 0 1-1.7.8l1.1 1.7a16.6 16.6 0 0 0 5-2.5c.5-4.4-.7-8.3-2.9-11.6zM8.5 14.6c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm7 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z'/></svg>` },
  featured: { colour: "#fc0", svg: `${HOME_SVG} fill='#fff'><path d='m12 1.5 3.2 6.9 7.3.8-5.4 5 1.5 7.3L12 17.8l-6.6 3.7 1.5-7.3-5.4-5 7.3-.8z'/></svg>` },
  themes: { colour: "#1a82fb", svg: `${HOME_SVG} fill='#fff'><path d='M2 4h20v13H2zm2 2v9h16V6zM9 18h6l1 3H8z' fill-rule='evenodd'/></svg>` },
  browse: { colour: "#f39c12", svg: `${HOME_SVG} fill='#fff'><path d='M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z'/></svg>` },
  signing: { colour: "#8e44ad", svg: `${HOME_SVG} fill='#fff'><path d='M4 3h12l4 4v8.5a5 5 0 0 0-2-1.2V8h-3V5H6v14h6.6a5 5 0 0 0 .7 2H4zm14 13a3.5 3.5 0 1 1-1.5 6.7L15 24v-3.4A3.5 3.5 0 0 1 18 16zM8 9h7v2H8zm0 4h5v2H8z'/></svg>` },
  install: { colour: "#2c9b3c", svg: `${HOME_SVG} fill='#fff'><path d='M11 3h2v9.6l3.3-3.3 1.4 1.4L12 16.4l-5.7-5.7 1.4-1.4 3.3 3.3zM4 18h16v2H4z'/></svg>` },
  // the certificate tile (screens/home.js): no colour of its own, the row's stage ink colours it
  failed: { svg: `${HOME_SVG} fill='#fff'><path d='M10 3h4l-.6 12h-2.8zm0 15h4v3h-4z'/></svg>` },
  // B266: More Sources in the green row's slot: its row tile's blue and white plus (ROW_ICONS moreSources), which
  // home.css keeps over the green row's glyph colour
  more: { colour: C.blue, svg: `${HOME_SVG} fill='#fff'><path d='M10.2 3h3.6v7.2H21v3.6h-7.2V21h-3.6v-7.2H3v-3.6h7.2z'/></svg>` },
  // an open padlock (jailbreak's usual sign; not anyone's artwork) on a purple gradient
  jailbreak: { colour: "#5b2fa3", gradient: ["#8a5cd0", "#5b2fa3"], svg: `${HOME_SVG}><path fill='none' stroke='#fff' stroke-width='2.2' stroke-linecap='round' d='M8 10.5V7.5a4 4 0 0 1 7.6-1.7'/><rect x='5' y='10.5' width='14' height='10' rx='2' fill='#fff'/><circle cx='12' cy='15' r='1.6' fill='#6f43b9'/><path d='M12 15.5v2.3' stroke='#6f43b9' stroke-width='1.4' stroke-linecap='round'/></svg>` },
  // Home's Theme half (screens/home.js THEME_ICON): Settings > Theme's colour and contrast disc
  theme: { colour: "#4650b4", svg: `${HOME_SVG}><path fill='#fff' fill-rule='evenodd' d='M12 2.5a9.5 9.5 0 1 1 0 19a9.5 9.5 0 0 1 0-19zM12 4.8a7.2 7.2 0 0 0 0 14.4z'/></svg>` },
};

// The tab bar's glyphs: masks over the tab's fill (ios6.css .tab-icon::before), reaching CSS as the `--glyph` token
// of `.tab[data-tab="<tab>"]`. ios6.css holds them as tabGlyphTokens("ios6") prints them (rowicons.test.js).
const TAB_GLYPHS = {
  home: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28'><path d='M14 3 1.5 14H5v11h7v-7h4v7h7V14h3.5z'/></svg>",
  sources: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28'><rect x='3' y='3' width='22' height='6' rx='2'/><rect x='3' y='11' width='22' height='6' rx='2'/><rect x='3' y='19' width='22' height='6' rx='2'/></svg>",
  changes: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28'><path fill-rule='evenodd' d='M14 2a12 12 0 1 0 0 24 12 12 0 1 0 0-24zm0 3a9 9 0 1 1 0 18 9 9 0 1 1 0-18z'/><path d='M12.6 7h2.8v6.3l4.4 3.1-1.6 2.3-5.6-4z'/></svg>",
  installed: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28'><path d='M11 2h6v8h5l-8 8-8-8h5z'/><path d='M2 17h6l2 3h8l2-3h6v9H2z'/></svg>",
  search: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28'><path fill-rule='evenodd' d='M11.5 2a9.5 9.5 0 1 0 0 19 9.5 9.5 0 1 0 0-19zm0 3a6.5 6.5 0 1 1 0 13 6.5 6.5 0 1 1 0-13z'/><path d='m17.6 19.7 2.1-2.1 6.6 6.6-2.1 2.1z'/></svg>",
  // our gear: a ring and eight teeth
  settings: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28' fill='none' stroke='#000'><circle cx='14' cy='14' r='7.4' stroke-width='5.2'/><circle cx='14' cy='14' r='10.9' stroke-width='3.4' stroke-dasharray='4.28 4.28'/></svg>",
};

// F332: iOS 7's icons, after the Teehan+Lax iOS 7 kit (ref/teehanlax/ios7/sheet.svg, its Settings table "Table View
// 1"): flat tiles 58px @2x with 13px corners (29pt, 6.5pt), the system colours, and white line glyphs ~20pt across.
// Our own drawings, never Apple's glyphs. Row names, glyph names and tab names are iOS 6's; only the art changes.
const C7 = {
  grey: "#8e8e93", blue: "#007aff", sky: "#34aadc", green: "#4cd964", red: "#ff3b30", orange: "#ff9500",
  purple: "#c86edf", indigo: "#5856d6", dark: "#4a4a4f", teal: "#5ac8fa", gold: "#ffcc00", brown: "#a2845e",
  pink: "#ff2d55",
};
// Keyed by iOS 6's hex, which is unique per name (rowicons.test.js), so no two iOS 6 colours collide here.
export const TO_C7 = Object.fromEntries(Object.keys(C).map((k) => [C[k], C7[k]]));
// Every row keeps its glyph and takes the iOS 7 colour of its iOS 6 colour.
const ROW_ICONS_7 = Object.fromEntries(Object.entries(ROW_ICONS).map(([name, [colour, glyph]]) => [name, [TO_C7[colour], glyph]]));

const W7 = 1.9; // the line, in 24ths of the glyph: ~1.6pt
const ln = (d, w = W7) => ["s", d, w];
const ring = (cx, cy, r) => `M${cx} ${cy - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0 ${-2 * r}z`;
const dot = (cx, cy, r) => ["f", ring(cx, cy, r)];
function gear7() {
  const pts = [];
  const teeth = 8, ro = 10, ri = 7.7;
  for (let i = 0; i < teeth * 4; i++) {
    const a = (i / (teeth * 4)) * Math.PI * 2 - Math.PI / 2 + Math.PI / (teeth * 4);
    const r = i % 4 < 2 ? ro : ri;
    pts.push(`${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join("L")}z`;
}
const STAR_7 = ["s", star(), 1.7];
const eye7 = [ln("M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12z"), ln(ring(12, 12, 3))];
const fileOutline = ln("M5.5 3h8.5l4.5 4.5V21h-13z");
const GLYPHS_7 = {
  person: [ln(ring(12, 8, 4)), ln("M4 20.5c.6-4.2 3.8-6.6 8-6.6s7.4 2.4 8 6.6")],
  personPlus: [ln(ring(9.5, 8, 3.8)), ln("M2.5 20.5c.5-3.9 3.3-6.2 7-6.2s6.5 2.3 7 6.2"), ln("M19 6v6M16 9h6")],
  gear: [ln(gear7(), 1.6), ln(ring(12, 12, 3.2), 1.6)],
  contrast: [ln(ring(12, 12, 9)), ["f", "M12 3a9 9 0 0 0 0 18z"]],
  download: [ln(ring(12, 12, 9)), ln("M12 7v9M8 12.5l4 4 4-4")],
  refresh: [ln("M19 12a7 7 0 1 1-2.05-4.95"), ln("M14 8.4h4.4V4")],
  arrows: [ln("M19.2 9.2A7.6 7.6 0 0 0 5.2 8.6"), ln("M4.4 4.8v4.6H9"), ln("M4.8 14.8a7.6 7.6 0 0 0 14 .6"), ln("M19.6 19.2v-4.6H15")],
  pen: [ln("M15.4 4.6l4 4L9 19l-5 1 1-5z"), ln("M13.2 6.8l4 4")],
  terminal: [ln("M5 7.5l4.5 4.5L5 16.5"), ln("M12 17h7")],
  install: [ln("M12 3.5v11M7.5 10.5l4.5 4.5 4.5-4.5"), ln("M4 19.5h16")],
  list: [dot(5, 6, 1.4), dot(5, 12, 1.4), dot(5, 18, 1.4), ln("M9.5 6h11M9.5 12h11M9.5 18h11")],
  transfer: [ln("M8 20V4.5M4 8.5l4-4 4 4"), ln("M16 4v15.5M12 15.5l4 4 4-4")],
  eyeSlash: [...eye7, ln("M4.5 19.5l15-15")],
  eye: eye7,
  star: [STAR_7],
  phone: [ln("M8 2.5h8a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2z"), dot(12, 18.4, 1.1)],
  info: [ln(ring(12, 12, 9)), ln("M12 10.5v6.5"), dot(12, 7.4, 1.2)],
  check: [ln("M4.5 12.5l4.8 4.8L19.5 7", 2.2)],
  checkCircle: [ln(ring(12, 12, 9)), ln("M7.5 12.3l3 3 6-6.3")],
  home: [ln("M3 11.5l9-8 9 8"), ln("M5.5 9.5v11h4.5v-6h4v6h4.5v-11")],
  minusCircle: [ln(ring(12, 12, 9)), ln("M7 12h10")],
  bell: [ln("M12 3.2c3.4 0 5.8 2.6 5.8 6v4.6l2 2.6v1.1H4.2v-1.1l2-2.6V9.2c0-3.4 2.4-6 5.8-6z"), ln("M9.8 20.2a2.3 2.3 0 0 0 4.4 0")],
  bolt: [ln("M13.5 2.5L5 13.5h6l-1 8 8.5-11h-6z", 1.7)],
  battery: [ln("M3.5 7.5h14a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 2 15V9a1.5 1.5 0 0 1 1.5-1.5z"),
    ln("M21.5 10.5v3"), ["f", "M11.6 9.2l-3.6 3.4h2.7l-1 2.2 3.6-3.4h-2.7z"]],
  lock: [ln("M5.5 10.5h13v10h-13z"), ln("M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7")],
  clock: [ln(ring(12, 12, 9)), ln("M12 6.5V12l3.6 2.4")],
  calendar: [ln("M3.5 5h17v15.5h-17z"), ln("M3.5 9.5h17"), ln("M8 2.8v4M16 2.8v4"), ["f", "M7 12h3v3H7z"]],
  hourglass: [ln("M6 3h12M6 21h12"), ln("M7.5 3c0 4.4 4.5 6.4 4.5 9s-4.5 4.6-4.5 9M16.5 3c0 4.4-4.5 6.4-4.5 9s4.5 4.6 4.5 9")],
  link: [ln("M10.2 13.8a4 4 0 0 0 5.7 0l3.6-3.6a4 4 0 0 0-5.7-5.7l-1.3 1.3"), ln("M13.8 10.2a4 4 0 0 0-5.7 0l-3.6 3.6a4 4 0 0 0 5.7 5.7l1.3-1.3")],
  question: [ln("M8.8 8.8a3.3 3.3 0 1 1 4.8 2.9c-1 .6-1.6 1.3-1.6 2.5v.8"), dot(12, 18.6, 1.3)],
  globe: [ln(ring(12, 12, 9), 1.6), ln("M12 3c-2.6 2.5-3.9 5.5-3.9 9s1.3 6.5 3.9 9c2.6-2.5 3.9-5.5 3.9-9S14.6 5.5 12 3z", 1.6),
    ln("M3 12h18", 1.6)],
  cloud: [ln("M7 18.8a4.3 4.3 0 0 1-.4-8.6 5.6 5.6 0 0 1 10.8-.9 4.8 4.8 0 0 1 .3 9.5z")],
  pulse: [ln("M2 12.5h4.2l2.6-6.2 4.2 12 2.6-5.8H22")],
  share: [ln("M8.5 9.5H6v11h12v-11h-2.5"), ln("M12 15V3.5"), ln("M8.5 7l3.5-3.5L15.5 7")],
  copy: [ln("M9 8h10v13H9z"), ln("M15 5V3H5v13h2")],
  save: [fileOutline, ln("M12 10v7M9 14l3 3 3-3")],
  qr: [ln("M3.5 3.5h6.5v6.5H3.5zM14 3.5h6.5v6.5H14zM3.5 14h6.5v6.5H3.5z", 1.6),
    ["f", "M5.8 5.8h2v2h-2zM16.2 5.8h2v2h-2zM5.8 16.2h2v2h-2zM14 14h2.4v2.4H14zM18 14h2.5v2.4H18zM16 16.2h2.2v2.2H16zM14 18.2h2.4v2.4H14zM18 18.2h2.5v2.4H18z"]],
  file: [fileOutline, ln("M14 3v4.5h4.5")],
  clipboard: [ln("M8 4.5H5.5v16.5h13V4.5H16"), ln("M9 3h6v3H9z")],
  key: [ln(ring(15, 9, 5.2)), dot(16.4, 7.6, 1.2), ln("M11.3 12.7 3.5 20.5"), ln("M6.2 17.8l2 2"), ln("M8.4 15.6l1.6 1.6")],
  seal: [ln(ring(12, 9, 6)), ln("M8.6 14.2 7 21l3-1.3 2 2.1 2-2.1 3 1.3-1.6-6.8")],
  power: [ln("M7.6 6.6a7.6 7.6 0 1 0 8.8 0"), ln("M12 3v8")],
  apps: [ln("M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z", 1.6)],
  plus: [ln("M12 4.5v15M4.5 12h15", 2)],
  envelope: [ln("M3 5.5h18v13H3z"), ln("M3.5 6.5 12 13l8.5-6.5")],
  laptop: [ln("M5.5 5h13v9.5h-13z"), ln("M2.5 18.5h19l-1.5-2.5H4z")],
  badge: [ln("M6 3.5h12v17.5H6z"), ln("M10 3.5h4"), ln(ring(12, 10, 2.2)), ln("M8.6 17c.4-2 1.7-3 3.4-3s3 1 3.4 3")],
  folder: [ln("M3 5.5h6.5l2 2.2H21v11.8H3z")],
};

// Copying Files' tiles in iOS 7's colours, the glyphs drawn as 2.6-unit lines.
const G7 = "<g fill='none' stroke='#fff' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'>";
const GUIDE_TILES_7 = {
  files: ["#5ac8fa", "#007aff", `${G7}<path d='M12 18h12l4 4h18v22H12z'/><path d='M12 26h34'/></g>`],
  airdrop: ["#5ac8fa", "#34aadc", `<circle cx='29' cy='38' r='3.5'/>${G7}<path d='M20 31a12 12 0 0 1 18 0'/><path d='M14 25a20 20 0 0 1 30 0'/><path d='M9 19a28 28 0 0 1 40 0'/></g>`],
  localsend: ["#a4eab4", "#4cd964", `${G7}<path d='M21 44V15m-7 7 7-7 7 7'/><path d='M37 14v29m-7-7 7 7 7-7'/></g>`],
  pairdrop: ["#b9b8f0", "#5856d6", `${G7}<rect x='10' y='15' width='14' height='28' rx='3'/><rect x='34' y='15' width='14' height='28' rx='3'/><path d='M27 29h4'/></g><circle cx='17' cy='38' r='1.6'/><circle cx='41' cy='38' r='1.6'/>`],
  mac: ["#e5e5ea", "#8e8e93", `${G7}<rect x='9' y='12' width='40' height='27' rx='3'/><path d='M24 39l-2 7h14l-2-7M18 46.5h22'/></g>`],
  windows: ["#5ac8fa", "#007aff", `${G7}<rect x='9' y='13' width='40' height='32' rx='3'/><path d='M9 20h40M29 24v17M13 32.5h32'/></g>`],
  linux: ["#8e8e93", "#48484a", `${G7}<ellipse cx='29' cy='35' rx='12' ry='13.5'/><circle cx='29' cy='19' r='8'/><path d='M17 48h9M32 48h9'/></g><circle cx='26' cy='18' r='1.5'/><circle cx='32' cy='18' r='1.5'/><path d='M26 22h6l-3 3z'/>`],
  filza: ["#ffe066", "#ff9500", `${G7}<path d='M11 16h12l4 4h20v24H11z'/><path d='M23 26v12'/><path d='M23 30h4M23 34h4'/></g>`],
};

// Home's tiles: iOS 7's flat colours (no gradients) and line glyphs, the row glyphs' 1.9-unit line. A tile with no
// colour takes the row's (the green row's state glyphs).
const home7 = (colour, parts) => ({ ...(colour ? { colour } : {}),
  svg: `${HOME_SVG}>${glyphSvg(parts).replace(/"/g, "'")}</svg>` });
const CLYDE = "M19.3 5.4A16.6 16.6 0 0 0 15.2 4l-.5 1a15.3 15.3 0 0 0-5.4 0l-.5-1a16.5 16.5 0 0 0-4.1 1.4C2.1 9.3 1.4 13.2 1.8 17a16.7 16.7 0 0 0 5 2.5l1.1-1.7a10.8 10.8 0 0 1-1.7-.8l.4-.3a11.9 11.9 0 0 0 10.8 0l.4.3a10.8 10.8 0 0 1-1.7.8l1.1 1.7a16.6 16.6 0 0 0 5-2.5c.5-4.4-.7-8.3-2.9-11.6z";
const HOME_TILES_7 = {
  // The Why tile: iOS 7's flat orange, the line star.
  why: { colour: "#ff9500", gradient: ["#ff9500", "#ff9500"],
    svg: `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='${star()}' fill='none' stroke='#fff' stroke-width='1.6' stroke-linejoin='round'/></svg>` },
  github: home7(C7.dark, [ln("M8 6 2 12l6 6M16 6l6 6-6 6M14 4l-4 16")]),
  sources: home7(C7.blue, GLYPHS_7.list),
  discord: home7(C7.indigo, [ln(CLYDE, 1.6), dot(8.5, 12.6, 1.5), dot(15.5, 12.6, 1.5)]),
  featured: home7(C7.gold, [STAR_7]),
  themes: home7(C7.blue, [ln("M3 4.5h18v12H3z"), ln("M12 16.5v3.5M8 20.5h8")]),
  browse: home7(C7.orange, GLYPHS_7.apps),
  signing: home7(C7.purple, [ln("M13 21H5.5V3h8.5l4.5 4.5v3"), ln("M8.5 9h6M8.5 12.5h3.5"), ln(ring(17, 15.5, 2.8)),
    ln("M15.4 17.8 14.8 22l2.2-1.1 2.2 1.1-.6-4.2")]),
  install: home7(C7.green, GLYPHS_7.install),
  failed: home7(null, [ln("M12 4v10", 2.2), dot(12, 19, 1.4)]),
  more: home7(C7.blue, GLYPHS_7.plus), // B266: More Sources in the green row's slot, its row tile's blue plus
  jailbreak: home7(C7.purple, [ln("M5.5 11h13v9.5h-13z"), ln("M8.5 11V7.8a3.5 3.5 0 0 1 6.8-1.2"), ln("M12 14.5v2.5")]),
  theme: home7(C7.indigo, GLYPHS_7.contrast),
};

// The tab bar: thin outline glyphs (tabs), the same shapes filled on the chosen tab (tabsSelected), as the kit's
// Phone tab bar ("Tab Bar": Favorites, Recents, Contacts).
const T7 = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28'";
const TAB_GLYPHS_7 = {
  home: `${T7} fill='none' stroke='#000' stroke-width='1.6' stroke-linejoin='round'><path d='M3.5 13.5 14 4l10.5 9.5'/><path d='M6.5 11v14h5.5v-7h4v7h5.5V11'/></svg>`,
  sources: `${T7} fill='none' stroke='#000' stroke-width='1.6'><rect x='3.8' y='3.8' width='20.4' height='4.9' rx='1.6'/><rect x='3.8' y='11.55' width='20.4' height='4.9' rx='1.6'/><rect x='3.8' y='19.3' width='20.4' height='4.9' rx='1.6'/></svg>`,
  changes: `${T7} fill='none' stroke='#000' stroke-width='1.6'><circle cx='14' cy='14' r='11.2'/><path d='M14 7.5V14l4.6 3.3'/></svg>`,
  installed: `${T7} fill='none' stroke='#000' stroke-width='1.6' stroke-linejoin='round'><path d='M14 2.5v13M9 10.5l5 5 5-5'/><path d='M2.8 17.8h5.4l2 3h7.6l2-3h5.4v7.4H2.8z'/></svg>`,
  search: `${T7} fill='none' stroke='#000'><circle cx='11.5' cy='11.5' r='8.2' stroke-width='1.6'/><path d='m17.4 17.4 7.6 7.6' stroke-width='2.2'/></svg>`,
  settings: `${T7} fill='none' stroke='#000'><circle cx='14' cy='14' r='4.2' stroke-width='1.6'/><circle cx='14' cy='14' r='9' stroke-width='1.6'/><circle cx='14' cy='14' r='11.3' stroke-width='2.6' stroke-dasharray='3.6 5.27'/></svg>`,
};
// Filled: the outline's shapes painted solid; lines inside a solid shape (the clock's hands, the gear's hole) cut
// out with an even-odd path (no SVG <mask>: WebKit's support for one inside a CSS mask image is unchecked), since
// the tab paints only where the glyph is opaque.
const TAB_GLYPHS_SELECTED_7 = {
  home: `${T7} stroke='#000' stroke-width='1.6' stroke-linejoin='round'><path d='M3.5 13.5 14 4l10.5 9.5z'/><path d='M6.5 11v14h5.5v-7h4v7h5.5V11z'/></svg>`,
  sources: `${T7} stroke='#000' stroke-width='1.6'><rect x='3.8' y='3.8' width='20.4' height='4.9' rx='1.6'/><rect x='3.8' y='11.55' width='20.4' height='4.9' rx='1.6'/><rect x='3.8' y='19.3' width='20.4' height='4.9' rx='1.6'/></svg>`,
  changes: `${T7}><path fill-rule='evenodd' d='M14 2a12 12 0 1 1 0 24a12 12 0 0 1 0-24zM13.1 7.5h1.8v6.04l4.22 3.03-1.05 1.46-4.97-3.57z'/></svg>`,
  installed: `${T7} stroke='#000' stroke-width='1.6' stroke-linejoin='round'><path d='M12.6 2.5h2.8v8.6h3.9L14 16.6l-5.3-5.5h3.9z'/><path d='M2.8 17.8h5.4l2 3h7.6l2-3h5.4v7.4H2.8z'/></svg>`,
  search: `${T7}><circle cx='11.5' cy='11.5' r='9'/><path d='m17.4 17.4 7.6 7.6' stroke='#000' stroke-width='3' stroke-linecap='round'/></svg>`,
  settings: `${T7}><path fill-rule='evenodd' d='M14 3.8a10.2 10.2 0 1 1 0 20.4a10.2 10.2 0 0 1 0-20.4zM14 9.8a4.2 4.2 0 1 0 0 8.4a4.2 4.2 0 0 0 0-8.4z'/><circle cx='14' cy='14' r='11.3' fill='none' stroke='#000' stroke-width='2.6' stroke-dasharray='3.6 5.27'/></svg>`,
};

// F370: iOS 13's and iOS 26's sets, drawn from iOS 7's (the approved concept): each era's system colours, its line
// weight (iOS 13 a regular weight, iOS 26 a touch heavier and rounder), its tile corners and glyph size, and a tab bar
// of filled glyphs (both eras draw their tab bars filled; the chosen tab takes the tint, style.css's --tab-icon-active).
// Our own drawings, never Apple's glyphs or SF Symbols (AGENTS.md).
const C13 = { grey: "#8e8e93", blue: "#007aff", sky: "#32ade6", green: "#34c759", red: "#ff3b30", orange: "#ff9500",
  purple: "#af52de", indigo: "#5856d6", dark: "#3a3a3c", teal: "#5ac8fa", gold: "#ffcc00", brown: "#a2845e", pink: "#ff2d55" };
const C26 = { grey: "#8e8e93", blue: "#0088ff", sky: "#00c0e8", green: "#34c759", red: "#ff383c", orange: "#ff8d28",
  purple: "#cb30e0", indigo: "#6155f5", dark: "#2c2c2e", teal: "#00c3d0", gold: "#ffcc00", brown: "#ac7f5e", pink: "#ff2d55" };
// One era's set: `colours` keyed as C, `line` the row glyphs' stroke in 24ths (iOS 7's is W7), `tile` its row tile,
// `tabLine` the filled tab glyphs' outline stroke on 28 units.
function eraSet(colours, line, tile, tabLine) {
  const k = line / W7;
  const heavier = (w) => +(w * k).toFixed(2);
  const of7 = Object.fromEntries(Object.keys(C7).map((key) => [C7[key], colours[key]]));
  const recolour = (hex) => of7[hex] ?? hex;
  const weigh = (svg) => svg.replace(/stroke-width='([\d.]+)'/g, (_, w) => `stroke-width='${heavier(+w)}'`);
  const of6 = Object.fromEntries(Object.keys(C).map((key) => [C[key], colours[key]]));
  const map = (o, f) => Object.fromEntries(Object.entries(o).map(([n, v]) => [n, f(v)]));
  return {
    rows: map(ROW_ICONS, ([colour, glyph]) => [of6[colour], glyph]),
    glyphs: map(GLYPHS_7, (parts) => parts.map(([t, d, w]) => (t === "s" ? [t, d, heavier(w)] : [t, d]))),
    guides: map(GUIDE_TILES_7, ([light, colour, body]) => [recolour(light), recolour(colour), weigh(body)]),
    home: map(HOME_TILES_7, (t) => ({ ...t, ...(t.colour ? { colour: recolour(t.colour) } : {}),
      ...(t.gradient ? { gradient: t.gradient.map(recolour) } : {}), svg: weigh(t.svg) })),
    tabs: map(TAB_GLYPHS_SELECTED_7, (svg) => svg.replace(/stroke-width='1.6'/g, `stroke-width='${tabLine}'`)
      .replace(/stroke-linejoin='round'/g, "stroke-linejoin='round' stroke-linecap='round'")),
    // F369: the glass bars' unselected tab glyphs: iOS 7's outlines at the era's tab weight, round caps and joins
    tabsOutline: map(TAB_GLYPHS_7, (svg) => svg
      .replace(/stroke-width='([\d.]+)'/g, (_, w) => `stroke-width='${+(w * tabLine / 1.6).toFixed(2)}'`)
      .replace(/ stroke-linejoin='round'/g, "")
      .replace(/fill='none' stroke='#000'/, "fill='none' stroke='#000' stroke-linejoin='round' stroke-linecap='round'")),
    tile,
  };
}
const SET_13 = eraSet(C13, 2.2, { size: SIZE, radius: 6.8, glyph: 19 }, 1.6);
const SET_26 = eraSet(C26, 2.4, { size: SIZE, radius: 7.8, glyph: 18 }, 2.2);

// C51: the per-style icon map (docs/eras.md, "Icon map"). Every inline SVG the screens draw from JS comes from here,
// keyed by kind and icon name, so an era (outline or filled icons) ships its own set beside iOS 6's:
//   rows    name -> [tile colour, glyph name]   29pt row tiles (tileSvg, rowIcon)
//   glyphs  glyph name -> parts                 the white glyphs on row tiles, 24 units
//   guides  name -> [light, colour, body]       Copying Files' 58-unit tiles (guideSvg)
//   home    name -> { colour, gradient, svg }   Home tiles drawn by a screen's own CSS (homeTileCss)
//   tabs    tab -> SVG                          the tab bar's --glyph tokens (tabGlyphTokens)
//   tabsSelected  tab -> SVG                    the chosen tab's glyph, when an era draws it apart (iOS 7: filled)
//   tabsOutline   tab -> SVG                    iOS 13/26: outline glyphs for the glass bars' unselected tabs
//   tile    the row tile's size, corners and glyph size
// An era's set names only what it redraws: anything it leaves out falls back to iOS 6's entry.
export const ICON_SETS = {
  ios6: { rows: ROW_ICONS, glyphs: GLYPHS, guides: GUIDE_TILES, home: HOME_TILES, tabs: TAB_GLYPHS,
    tile: { size: SIZE, radius: R, glyph: 19 } },
  ios7: { rows: ROW_ICONS_7, glyphs: GLYPHS_7, guides: GUIDE_TILES_7, home: HOME_TILES_7, tabs: TAB_GLYPHS_7,
    tabsSelected: TAB_GLYPHS_SELECTED_7, tile: { size: SIZE, radius: 6.5, glyph: 20 } },
  // the chosen tab is the same filled glyph in the tint; tabsSelected names it for the native tab bar (F369)
  ios13: { ...SET_13, tabsSelected: SET_13.tabs },
  ios26: { ...SET_26, tabsSelected: SET_26.tabs },
};

// The style the page shows: <html data-style="ios7"> (docs/eras.md), iOS 6 when none is set.
export function iconStyle(doc = globalThis.document) {
  return doc?.documentElement?.dataset?.style || "ios6";
}

// One entry of the map: `kind` ("rows", "guides", …), `name`, for `style` (the page's by default).
export function icon(kind, name, style = iconStyle()) {
  const own = ICON_SETS[style]?.[kind];
  // hasOwnProperty, not Object.hasOwn: that needs iOS 15.4 and the app runs on 15.0
  return own && Object.prototype.hasOwnProperty.call(own, name) ? own[name] : ICON_SETS.ios6[kind]?.[name];
}

// An SVG as a CSS url() the way ios6.css writes them: only <, > and # escaped, the SVG's quotes single.
export const cssSvgUrl = (svg) => `url("data:image/svg+xml,${svg.replace(/</g, "%3C").replace(/>/g, "%3E").replace(/#/g, "%23")}")`;

// The tab bar's glyph tokens for `style`, one rule per tab: what ios6.css holds for iOS 6 and an era's stylesheet
// carries for its own set. `kind` "tabsSelected" prints the chosen tab's (`.tab[data-tab].active`) for a style that
// draws it apart; iOS 6 has none (its chosen tab is the same glyph, coloured).
export function tabGlyphTokens(style = "ios6", kind = "tabs") {
  const sel = kind === "tabsSelected" ? ".active" : "";
  if (sel && !ICON_SETS[style]?.tabsSelected) throw new Error(`${style} draws no selected tabs`);
  return Object.keys(TAB_GLYPHS).map((tab) => `.tab[data-tab="${tab}"]${sel} { --glyph: ${cssSvgUrl(icon(kind, tab, style))}; }`).join("\n");
}

// A Home tile's paint (home.css .home-glyph): its colour, then the glyph over its gradient.
export function homeTileCss(name, style = iconStyle()) {
  const t = icon("home", name, style);
  if (!t) throw new Error(`no home tile ${name}`);
  const colour = t.colour ? `background-color: ${t.colour}; ` : "";
  const gradient = t.gradient ? `, linear-gradient(${t.gradient.join(", ")})` : "";
  return `${colour}background-image: ${cssSvgUrl(t.svg)}${gradient};`;
}

// Home's tile glyph rules for `style`, one `.glyph-<name>` rule per tile that style draws itself (Why apart: why.js
// writes it): what home.css holds for iOS 6 and an era's stylesheet carries, under its html[data-style], for its own.
export function homeGlyphRules(style = "ios6") {
  const own = ICON_SETS[style]?.home;
  if (!own) throw new Error(`no home tiles for ${style}`);
  return Object.keys(own).filter((name) => name !== "why").map((name) => {
    const size = own[name].gradient ? " background-size: 21px 21px, 100% 100%;" : "";
    return `.glyph-${name} { ${homeTileCss(name, style)}${size} }`;
  }).join("\n");
}

// The names of Copying Files' tiles, and one tile as a whole SVG: flat like Home's tiles (no gloss), the tile's
// colour, the white glyph.
export const GUIDE_TILE_NAMES = Object.keys(GUIDE_TILES);
export function guideSvg(name, style = iconStyle()) {
  const t = icon("guides", name, style);
  if (!t) throw new Error(`no guide tile ${name}`);
  const [, colour, body] = t;
  return "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 58 58'>"
    + `<rect width='58' height='58' fill='${colour}'/><g fill='#fff'>${body}</g></svg>`;
}

function glyphSvg(parts) {
  return parts.map(([kind, d, w]) => kind === "s"
    ? `<path d="${d}" fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="${d}" fill="#fff"${kind === "e" ? ' fill-rule="evenodd"' : ""}/>`).join("");
}

export function tileSvg(name, style = iconStyle()) {
  const entry = icon("rows", name, style);
  if (!entry) throw new Error(`no row icon ${name}`);
  const [colour, glyph] = entry;
  const { size, radius, glyph: across } = { ...ICON_SETS.ios6.tile, ...ICON_SETS[style]?.tile };
  const g = across / 24; // the glyph's 24 units drawn `tile.glyph` across (19pt in iOS 6)
  const off = (size - 24 * g) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
    + `<rect width="${size}" height="${size}" rx="${radius}" fill="${colour}"/>`
    + `<g transform="translate(${off} ${off}) scale(${g})">${glyphSvg(icon("glyphs", glyph, style))}</g></svg>`;
}

const cache = new Map();
const nameOf = new Map(); // a tile picture's src -> its row icon name, for restyleRowIcons
// A row's `icon` for nav/ui.js grouped()/plain(): the tile as a picture in the .cell-icon (ios6.css .row-icon).
export function rowIcon(name, style = iconStyle()) {
  const key = `${style}:${name}`;
  if (!cache.has(key)) {
    const src = "data:image/svg+xml," + encodeURIComponent(tileSvg(name, style));
    cache.set(key, src);
    nameOf.set(src, name);
  }
  return { cls: "row-icon", src: cache.get(key) };
}

// F370: a Theme > Style change redraws the row tiles already on screen (the pages under Theme, Home's links) in the new
// era's set, so going back doesn't show the old era's tiles. Returns how many it changed.
export function restyleRowIcons(root, style = iconStyle()) {
  let n = 0;
  for (const img of root?.querySelectorAll?.(".row-icon img") ?? []) {
    const name = nameOf.get(img.getAttribute("src"));
    if (!name) continue;
    const src = rowIcon(name, style).src;
    if (img.getAttribute("src") !== src) { img.setAttribute("src", src); n++; }
  }
  return n;
}

// Follows <html data-style> for the page's lifetime (started once, below, wherever a document exists).
export function followRowIconStyle(doc = globalThis.document, Observer = globalThis.MutationObserver) {
  const root = doc?.documentElement;
  if (!root || typeof Observer !== "function") return null;
  let last = iconStyle(doc);
  const mo = new Observer(() => {
    const now = iconStyle(doc);
    if (now === last) return;
    last = now;
    restyleRowIcons(doc, now);
  });
  mo.observe(root, { attributes: true, attributeFilter: ["data-style"] });
  return mo;
}
followRowIconStyle();
