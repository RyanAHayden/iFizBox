// Signing in the sideload build (F58, I6): the phone signs every app itself, through the shell's signing.* bridge
// calls; the Signing Server (worker/, brand.js SIGN_HOST unless the user runs their own) only hands iOS the install
// manifest and holds iFizBox's own update. F93: the website signs in the browser again, zsign as WebAssembly in a Web
// Worker (signInBrowser, at the end), and the Worker only hosts the signed IPA for iOS. docs/signing.md has the picture.
//
//   await loadIdentity()         the picks on Settings > Signing ({ p12, p12Name, password, profile, profileName }),
//                                in memory until signing.import puts them into the Keychain (the app), or kept in
//                                this browser's IndexedDB (the website, F93), or null
//   await saveIdentity(patch)    merges into them;  await clearIdentity()
//   await signingReady()         true when the Keychain holds an identity (statusReady(signing.status), as Settings
//                                shows it), or on the website when a .p12 and a profile are saved; false in the
//                                jailbreak app
//   getBring() / setBring(on)    the website's Bring My Certificate switch (on unless turned off): Install iFizBox
//                                App puts the certificate inside iFizBox's IPA
//   getServer() / setServer(s)   Settings > Signing's server, https://${SIGN_HOST} unless the user set another
//   await serverStatus()         what GET <server>/sign/status says
//   await signAndInstall({ url, name, onInstalled, bring })   signs on the phone and installs (installOnDevice), or
//                                on the website signs in the browser (signInBrowser)
//
// The code lives in signing/, one module a part; this file re-exports their public names, for callers that take the
// whole set as one object (screens/queue.js and screens/installed.js pass it around as `sc`) and for the tests.
export { askInsecure, KNOWN_MALWARE, refusing, keepIpaHash, untilCancel, localSigning,
  browserSigning } from "./signing/common.js";
export { loadIdentity, saveIdentity, clearIdentity, signingReady, getBring, setBring, defaultServer, getServer,
  setServer, serverStatus } from "./signing/identity.js";
export { isSelfIpa, signAndInstall, ORIGINAL_WARNED_KEY, originalWarning } from "./signing/install.js";
export { deviceStatus, statusReady, importToDevice, removeFromDevice, firstInstallCheck,
  openSigning } from "./signing/device.js";
export { ROUTE_HOLD, chooseRoute, forgetRoute, waitForVPN, installOnDevice } from "./signing/route.js";
export { SELF_UPDATE_LINES, SELF_UPDATE_FAILED, followSelfUpdate, HERE_CLOSING_LINE, followHereSelf,
  watchSelfUpdate } from "./signing/selfupdate.js";
export { ASK_WAIT, prepareParams, prepareOnDevice, openPrepared, hereLabel, shownName, finishHere, herePhase,
  repromptPrepared, discardPrepared } from "./signing/queue.js";
export { HOLD_IDLE, heldLanes } from "./signing/queue.js"; // B257
export { holdApp } from "./signing/route.js"; // B257
export { runFix } from "./signing/route.js"; // F366: the run's fix line
export { libraryCall, serverReachable, offlineText, installFromLibrary } from "./signing/library.js";
export { runInWorker, CUT_TEXT, CUT_TRIES, downloadIpa, reconnectText, droppedText, grayIconText, uploadSigned,
  signInBrowser } from "./signing/browser.js";
export { EARLY_WINDOW, expectedBundleId, earlyLink, reserveUpload, dropEarly, iconLeftText, siteCause, siteRefusal,
  siteUdid } from "./signing/early.js";
export { TOO_BIG_TITLE, TOO_BIG_BUTTONS, tooBigText, tooBigNote, TOO_BIG_FOOTER, MEMORY_TITLE, MEMORY_BUTTONS,
  memoryText, memoryNote, sideloaderLinks, handOffIpa, whenBack, tooBigAlert } from "./signing/toobig.js";
export { STATUS_EVERY, STATUS_MIN_SHOW, STATUS_ASK_WITHIN, installSteps, installStage, notAskedText,
  watchInstall } from "./signing/watch.js";
export { PROMPT_EVERY, PROMPT_GRACE, PROMPT_CAP, IOS_CANCELLED_TITLE, IOS_CANCELLED_TEXT,
  watchPrompt } from "./signing/prompt.js";
export { PASSWORD_EVENT, needsConfirm, checkPasswordInWorker, confirmPassword, confirmSoon,
  identityCert } from "./signing/password.js";
