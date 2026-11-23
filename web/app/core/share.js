// N9: the share sheet and Open in iFizBox, the pure part (share.js draws it). The shell (native/share/) has already
// classified what was shared and picked its route (native/share/Share.swift ShareRouter); it hands the page
// ifizbox://shared?route=…, or N8's ifizbox://add?url=… for an APT repo or AltStore source (incoming.js).
//
//   parseShared(url)          -> { route, file, url, name, title, message } | null for a link that isn't one
//       route  "helper-ipa"   jailbreak: install the IPA through ifizbox-helper (file: staged by the shell, or url)
//              "sign-ipa"     sideload: the IPA in My IPAs (file) or a link to add there (url), signed on the phone
//              "deb"          jailbreak: Confirm sheet (simulate-deb), console (install-deb); file, or url to fetch
//              "refuse"       an alert: title, message (a .deb in the sideload app, no AppSync, unknown things)
//              "pick-ipa"     sideload, B334: iOS opened an .ipa (name) from Files without letting iFizBox read it
//                             (native/Sources/OpenRescue.swift); dir: its folder, where the Files picker opens
//   sharedRecord(result, name) -> I3's record ({ id, name, version, source: null, sourceName: "Shared" }) | null
// SPDX-License-Identifier: GPL-3.0-or-later

const ROUTES = ["helper-ipa", "sign-ipa", "deb", "refuse", "pick-ipa"];

const FILE = /^[A-Za-z0-9][^/\\\0]{0,250}\.(ipa|deb)$/i;

export function parseShared(url) {
  let u;
  try { u = new URL(String(url ?? "")); } catch { return null; }
  if (u.protocol !== "ifizbox:" || u.hostname !== "shared") return null;
  const q = u.searchParams;
  const route = q.get("route");
  if (!ROUTES.includes(route)) return null;
  const name = (q.get("name") ?? "").slice(0, 200);
  if (route === "refuse") {
    return { route, file: null, url: null, name, title: q.get("title") || "Can't Open This", message: q.get("message") || "" };
  }
  if (route === "pick-ipa") {
    // B334: dir only says where the Files picker opens; an absolute folder, nothing else
    const dir = q.get("dir") ?? "";
    return { route, file: null, url: null, name: name || "the IPA", dir: dir.startsWith("/") && !dir.includes("\0") ? dir.slice(0, 1024) : null,
      title: "", message: "" };
  }
  let file = q.get("file");
  if (file != null && (!FILE.test(file) || file.includes("..") || /\.ipa$/i.test(file) === (route === "deb"))) file = null;
  let link = q.get("url");
  if (link != null && !/^https?:\/\/[^\s]+$/i.test(link)) link = null;
  if (!file && !link) return null;
  return { route, file, url: file ? null : link, name: name || file || (link ? lastPart(link) : ""), title: "", message: "" };
}

function lastPart(link) {
  try { return decodeURIComponent(new URL(link).pathname.split("/").pop() || "") || link; } catch { return link; }
}

export function sharedRecord(result, name = "") {
  const id = result?.bundleId || result?.bundleID;
  if (!id) return null;
  return { id, name: result.name || name.replace(/\.t?ipa$/i, "") || id, version: result.version || "", source: null, sourceName: "Shared" };
}
