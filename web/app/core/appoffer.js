// I7: the website offers the iFizBox app itself. Pure: no DOM, no network; screens/home.js draws what these answer,
// and core/appoffer.test.js covers every case.
//
// Where the offer shows (the website only: nothing inside the app, which is already installed):
//   Home, the Install iFizBox App tile
//     Not Jailbroken                      F93: iFizBox's IPA signed in the browser with the user's certificate and
//                                         installed (screens/home.js installApp), or Settings > Signing first
//     jailbroken (rootless, ...)          downloads the release's .deb for that architecture, to open in Sileo or
//                                         Filza; an architecture with no .deb yet is told so
//   iFizBox's own package page: its AltStore source (web/app/source.json, first in web/app/app-sources.json), in the
//   site and the sideload app only (F178 ownBuilds: the jailbreak app hides it).
import { NAME, GITHUB_REPO, DOMAIN, BUNDLE_ID } from "../brand.js";

// The GitHub | Discord pair (Cydia: Facebook | Twitter) on Home and the Not-an-iPhone page.
export const REPO_URL = `https://github.com/${GITHUB_REPO}`;
export const DISCORD_URL = "https://discord.gg/3XASvpjbgp";
// The release assets native/build.sh makes (tools/release.sh uploads them): latest/download always names the newest.
export const APP_IPA_URL = `${REPO_URL}/releases/latest/download/${NAME}.ipa`;
export const APP_DEB_URL = `${REPO_URL}/releases/latest/download/${NAME}.deb`; // rootless, iphoneos-arm64
// iFizBox's own AltStore source, kept current with native/VERSION by test_release.py. F178: at the site, beside the
// APT repo (https://<DOMAIN>/repo/): the Worker's /repo/source.json serves the latest release's source.json.
export const APP_SOURCE_URL = `https://${DOMAIN}/repo/source.json`;
export const APP_APT_REPO = `https://${DOMAIN}/repo/`;
export const APP_NAME = NAME;
export const APP_ID = BUNDLE_ID;

// F178: lite and full kept apart (user 2026-11-18: "not show one app the other's"). Which iFizBox a build shows:
//   sideload (lite)   the IPA only, from the AltStore source: no .deb, no Install Full iFizBox, no APT repo
//   jailbreak (full)  the .deb only, from its APT repo: the lite IPA in any AltStore source is hidden
//   site              both tiles (Install iFizBox App, Install Full iFizBox)
export function ownBuilds(mode = "site") {
  if (mode === "sideload") return { ipa: true, deb: false, aptRepo: false };
  if (mode === "jailbreak") return { ipa: false, deb: true, aptRepo: true };
  return { ipa: true, deb: true, aptRepo: true };
}

// The bundle IDs AltStore sources must not list in this build (core/catalog.js loadAlt `hide`): iFizBox's own IPA in
// the jailbreak app, which is the .deb from its APT repo.
export const hiddenAltApps = (mode = "site") => (ownBuilds(mode).ipa ? [] : [APP_ID]);

const NOT_JAILBROKEN = "none";

// Home's tile: null (no tile), or { action }:
//   "sideloaders"  Not Jailbroken: sign iFizBox in the browser and install it (F93; the name is F89's)
//   "deb"          download the .deb for `deviceType` (an APT arch): { action: "deb", arch }
// mode: core/settings.js detectMode(); deviceType: settings.deviceType() ("none" or an arch).
export function homeOffer({ mode = "site", deviceType = NOT_JAILBROKEN } = {}) {
  if (mode !== "site") return null;
  if (deviceType && deviceType !== NOT_JAILBROKEN) return { action: "deb", arch: deviceType };
  return { action: "sideloaders" };
}

// The .deb for an architecture: from the latest release (core/selfupdate.js parseRelease + debFor) when GitHub
// answered, else the plain iFizBox.deb, which is the rootless build. Null when no build fits the arch.
export function debUrl(arch, { release = null, debFor = null } = {}) {
  if (release && debFor) {
    const u = debFor(release, arch);
    if (u) return u;
  }
  return !arch || arch === "iphoneos-arm64" ? APP_DEB_URL : null;
}

const ARCH_NAMES = { "iphoneos-arm64": "rootless", "iphoneos-arm": "rootful", "iphoneos-arm64e": "roothide" };

// The alert before the .deb downloads (Cancel / Download), or the one saying there's no build for this arch (OK).
export function debAlert(arch, url) {
  const kind = ARCH_NAMES[arch] ?? arch;
  if (!url) {
    return { title: "No Build Yet", message: `${NAME} is built for rootless jailbreaks so far, not ${kind}. Set Settings > Device if your phone is rootless.`, buttons: ["OK"], cancel: 0 };
  }
  return {
    title: `Install ${NAME}`,
    message: `${NAME}'s ${kind} .deb downloads to Files. Open it there in Sileo or Filza to install it.`,
    buttons: ["Cancel", "Download"],
    cancel: 0,
  };
}
