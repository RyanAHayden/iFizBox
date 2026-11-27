// The one backend the screens use. On the site that's backend-http.js; in the app it's
// backend-native.js (docs/native.md), and nothing above this file changes.
import { createHttpBackend } from "./backend-http.js";
import { createNativeBackend } from "./backend-native.js";
import { createParser } from "./core/parser.js";
import { DEFAULT_ARCH, ARCHES } from "./core/apt.js";
import { applyBuiltins, builtinSources } from "./core/essential.js";
import { detectMode } from "./core/settings.js";
import { KEYS } from "./core/storagekeys.js";

// The architecture packages are listed for: rootless unless set to "iphoneos-arm" (rootful/palera1n rootful).
// There is no settings screen yet; `localStorage["ifizbox.arch"]` holds it.
export function getArch() {
  try {
    const a = globalThis.localStorage?.getItem(KEYS.arch);
    return ARCHES.includes(a) ? a : DEFAULT_ARCH;
  } catch {
    return DEFAULT_ARCH;
  }
}

// F144: the website keeps APT sources only while Settings > Device (`ifizbox.device`, Not Jailbroken unless set)
// says jailbroken; Not Jailbroken refuses adding one and leaves stored ones out (core/altstore.js aptAllowed).
export function siteJailbroken(store = globalThis.localStorage) {
  try {
    const d = store?.getItem(KEYS.device);
    return Boolean(d) && d !== "none";
  } catch {
    return false;
  }
}

let backend = null;
let parser = null;

export function getParser() {
  return (parser ??= createParser());
}

// In the app the shell has put `ifizboxNative` in place before any module ran (native/bridge.js).
export function getBackend() {
  const sourceOptions = { arch: getArch, count: (t, a) => getParser().count(t, a) };
  // F72: iFizBox's own source is always in the list and can't be removed (core/essential.js builtinSources).
  return (backend ??= applyBuiltins(globalThis.ifizboxNative?.call
    ? createNativeBackend({ sourceOptions })
    : createHttpBackend({ sourceOptions: { ...sourceOptions, aptAllowed: () => siteJailbroken() } }),
  () => builtinSources(detectMode())));
}
