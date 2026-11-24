// ---- My IPAs (F77): the user's own IPAs, signed on the phone (native/Sources/MyIPAs.swift, library.*) ----------
//
//   await libraryCall(method, params, onEvent, native)   one library.* call ("list", "add", "pick", "options",
//                                      "sign", "install", "export", "delete")
//   await serverReachable(server)      true when <server>/sign/status answers within a few seconds
//   await installFromLibrary({ file, name, signed, onInstalled })   signed: the library already has a signed copy
//                                      Install on an IPA's page: signs if needed (offline is fine), then, with the
//                                      Signing Server reachable, installs; offline it says so and keeps the signed copy.
//                                      Resolves "installed" | "offline" | false (an error, shown) | null (walkthrough)
//                                      F241: with the Signing Server reachable the IPA page queues the file instead
//                                      (screens/myipas.js queueLibraryInstall, prepareParams's `library` above); this
//                                      stays the offline path (Sign (n)'s too, F416).
import { phaseLabel, deviceError, HANDOFF } from "../core/signing.js";
import { withKeep } from "../core/keepid.js";
import { progressHUD } from "../nav/progress.js";
import { showAlert } from "../nav/alert.js";
import { askInsecure, bridge, failed, stopNative, untilCancel } from "./common.js";
import { getServer } from "./identity.js";
import { firstInstallCheck, lastDevice, openRoute } from "./device.js";
import { chooseRoute } from "./route.js";

// F243: every call but options carries Keep Bundle IDs off (withKeep), so an IPA without Sign Options of its own signs,
// and counts as signed, the way Settings > Signing says; options sends the Sign Options page's own switch.
export async function libraryCall(method, params = {}, onEvent, native, { alert = showAlert } = {}) {
  const send = (extra = {}) => bridge(native).call(`library.${method}`, method === "options" ? params : withKeep({ ...params, ...extra }), onEvent);
  return method === "add" ? askInsecure(send, { alert, url: params?.url ?? null }) : send(); // B104: an http link with no https twin asks first
}

export async function serverReachable(server = getServer(), { timeout = 6000, fetcher = globalThis.fetch } = {}) {
  if (globalThis.navigator && navigator.onLine === false) return false;
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeout) : null;
  try {
    const r = await fetcher(`${server}/sign/status`, { cache: "no-store", signal: ctl?.signal });
    return Boolean(r?.ok);
  } catch { return false; } finally { if (timer) clearTimeout(timer); }
}

export const offlineText = (name, server) => `${name || "The app"} is signed and kept in My IPAs. Installing needs a connection ` +
  `to the Signing Server (${hostOf(server)}), which hands iOS the install manifest. Install it again once you're online.`;

const hostOf = (server) => { try { return new URL(server).host; } catch { return String(server ?? ""); } };

export async function installFromLibrary({ file, name = "", signed = false, onInstalled = () => {} },
  { native, hud = progressHUD, alert = showAlert, go = openRoute, check = firstInstallCheck, reachable = serverReachable,
    follow = null, later = setTimeout } = {}) {
  const step = await check({ native, alert });
  if (step === "cancel") return false;
  if (step) {
    // B39 (F177's Install Now): once Signing is ready it goes back to this IPA's page and offers this install there.
    const deps = { native, hud, alert, go, check, reachable, follow, later };
    (await import("../screens/signing.js")).rememberInstall({ name, run: () => installFromLibrary({ file, name, signed, onInstalled }, deps) });
    return null;
  }
  const server = getServer();
  // The first step the shell will report: a placeholder "Signing" put Signing, Reading, Signing on the log (user 2026-11-18).
  const h = hud(signed ? "Preparing" : "Reading");
  h.onCancel?.(() => stopNative(native));
  const onEvent = (ev) => {
    if (ev?.log) h.page?.raw?.(ev.log); // B29: the shell's console lines (MyIPAs.swift install's log)
    const t = phaseLabel(ev);
    if (t) h.set(t);
  };
  const fail = async (e) => {
    if (h.cancelled) return false;
    const why = deviceError(e, name);
    failed(h, why.message);
    await alert({ title: why.title, message: why.message, buttons: ["OK"] });
    if (why.open === "signing") go(["signing"]);
    return false;
  };
  // Sign first: nothing here needs the network, so an offline phone still ends with a signed copy.
  try { await untilCancel(h, libraryCall("sign", { file }, onEvent, native)); } catch (e) { return fail(e); }
  const route = await chooseRoute({ native, alert });
  if (!route) { h.hide(); return false; }
  // This iPhone needs no Signing Server, so no connection either.
  if (!route.route && !(await untilCancel(h, reachable(server)).catch(() => false)) && !h.cancelled) {
    h.hide();
    await alert({ title: "No Connection", message: offlineText(name, server), buttons: ["OK"] });
    return "offline";
  }
  if (h.cancelled) return false;
  h.set(route.route ? "Connecting to this iPhone" : HANDOFF); // B424: nothing installs yet
  let result;
  try { result = await untilCancel(h, libraryCall("install", { file, manifestServer: server, ...route }, onEvent, native)); } catch (e) { return fail(e); }
  if (h.cancelled) return false;
  onInstalled(result);
  const followInstall = follow ?? (await import("../signing-sheet.js")).followInstall;
  if (result?.bundleId) followInstall(bridge(native), result.bundleId, h, { later, name: result.name || name, device: result.device ?? lastDevice });
  else later(() => (h.done ? h.done("Done") : h.hide()), 1200);
  return "installed";
}
