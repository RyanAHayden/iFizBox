// F67: the jailbreak build's IPA install over F59's bridge call (native/Sources/Apt.swift IPAInstall):
//
//   ipaInstallAvailable()            -> true in the jailbreak build (the sideload build keeps signing.install)
//   await installIpa(url, onEvent)   -> { code: 0, stdout, stderr, bundleId }; onEvent({ fd, line }) streams the
//                                       helper's lines; rejects with Error("<code>: <message>") and err.code
//                                       (core/ipainstall.js ipaError explains them)
//
// It talks to ifizboxNative directly (as signing-client.js does), not through backend-native.js, whose error mapping
// would fold no_adhoc and bad_ipa into "network".
// SPDX-License-Identifier: GPL-3.0-or-later
import { detectMode } from "./core/settings.js";
import { ipaStatus, ipaError } from "./core/ipainstall.js";
import { INSECURE_IPA_ALERT, INSTALL_ANYWAY, isInsecure } from "./core/insecureipa.js";
import { nativeBridge } from "./native.js";

// B113: an http:// IPA link (ifizbox://install, Settings > Install IPA, an app page from an http source). The shell
// (Apt.swift IPAInstall.fetchHTTP) downloads its https twin; when there is none, ipa.install answers code "insecure"
// and askInsecureIpa puts INSECURE_IPA_ALERT up: Install Anyway -> true (the call goes again with insecure: true, a
// plain http download), Cancel -> false. Links let through stay let through for the session (allowedHttp), so Try
// Again after AppSync's fallback, or a second install of the same link, doesn't ask again.
const allowedHttp = new Set();
export async function askInsecureIpa({ alert } = {}) {
  const show = alert ?? (await import("./nav/alert.js")).showAlert;
  return (await show(INSECURE_IPA_ALERT))?.index === INSTALL_ANYWAY;
}
export function forgetAllowedHttp() { allowedHttp.clear(); } // tests

export const ipaInstallAvailable = (mode = detectMode()) => mode === "jailbreak" && Boolean(nativeBridge()?.call);

// F380: `keep` (an install whose IPA is saved in My IPAs after it) sends keepInLibrary: the shell moves its download
// into My IPAs once installed and the answer adds { libraryFile }.
// F400: `listed` ({ version, size }, core/appqueue.js listedOf): what the source lists for `url`.
export async function installIpa(url, onEvent = null, { native = nativeBridge(), insecure = false, keep = false, listed = null } = {}) {
  if (!native?.call) throw Object.assign(new Error("sideload: no native bridge"), { code: "sideload" });
  try {
    return await native.call("ipa.install", { url, stream: Boolean(onEvent), ...(insecure ? { insecure: true } : {}),
      ...(listed ? { listed } : {}), ...(keep ? { keepInLibrary: true } : {}) }, onEvent ?? undefined);
  } catch (e) {
    const msg = e?.message || String(e);
    const m = msg.match(/^([a-z_]+): /);
    throw Object.assign(e instanceof Error ? e : new Error(msg), { code: e?.code || m?.[1] || "install" });
  }
}

// The console's run, without the DOM (screens/ipa-install.js draws `view`; the tests bring their own):
//   view.line(type, text)   type "info" | "status" | "error" | "warning": one console line
//   view.status(text)       the white line over the bar
//   view.progress(percent)  0..100
// Resolves { ok, bundleId, error: core/ipainstall.js ipaError's answer or null, log: the console's text, cancelled }.
// F188: `signal` (the page's Cancel) ends the run at once: it resolves { ok: false, cancelled: true } without waiting
// for ipa.install and nothing more is drawn (F196: the page also asks the shell's ipa.cancel to stop it,
// screens/ipa-install.js stopIpaInstall).
// B113: `ask` puts up This Download Is Not Secure for an http link with no https twin (askInsecureIpa); its Cancel
// resolves { ok: false, cancelled: true, declined: true } (the page closes, as for its own Cancel).
// F380: `keep` goes to installIpa; the result carries the shell's libraryFile (null when none was kept).
export async function runIpaInstall({ url, name = "", keep = false, listed = null }, view, { native = nativeBridge(), signal = null,
  ask = askInsecureIpa } = {}) {
  const log = [];
  const line = (type, text) => {
    log.push(type === "error" ? `E: ${text}` : type === "status" ? `» ${text}` : text);
    view.line(type, text);
  };
  view.progress(0);
  view.status("Preparing");
  line("info", url);
  let result = null;
  let error = null;
  let lastStatus = "";
  const said = new Set(); // the helper's own "ifizbox-helper: " lines, not repeated at the end
  const stopped = () => Boolean(signal?.aborted);
  const cancelled = () => {
    log.push("» Cancelled");
    return { ok: false, bundleId: "", error: null, log: log.join("\n"), cancelled: true };
  };
  if (stopped()) return cancelled();
  const aborted = new Promise((resolve) => signal?.addEventListener?.("abort", () => resolve(true), { once: true }));
  let declined = false;
  try {
    const onEvent = ({ fd, line: raw }) => {
      if (stopped()) return;
      const text = String(raw ?? "").replace(/\s+$/, "");
      if (!text) return;
      if (fd === "status") {
        const s = ipaStatus(text);
        if (!s) { line("info", text); return; }
        if (s.error) { line("error", s.text); return; }
        if (s.percent != null) view.progress(s.percent);
        view.status(s.text);
        if (s.text !== lastStatus) line("status", s.text); // installd repeats "Installing" with each percent
        lastStatus = s.text;
        return;
      }
      if (fd === "err" && /^ifizbox-helper: /.test(text)) said.add(text.slice(16));
      line(fd === "err" && /^ifizbox-helper: /.test(text) ? "error" : fd === "err" && /^(W:|warning)/i.test(text) ? "warning" : "info", text);
    };
    // B113: an http link with no https twin asks (askInsecureIpa); Install Anyway sends it again over plain http.
    const job = (async () => {
      let insecure = allowedHttp.has(url);
      for (;;) {
        try {
          return await installIpa(url, onEvent, { native, insecure, ...(listed ? { listed } : {}), ...(keep ? { keep: true } : {}) });
        } catch (e) {
          if (insecure || !isInsecure(e) || stopped()) throw e;
          line("warning", `No https copy of the IPA: ${String(e?.message ?? e).replace(/^insecure: /, "")}`);
          view.status(INSECURE_IPA_ALERT.title);
          if (!(await ask())) { declined = true; return null; }
          if (stopped()) return null;
          allowedHttp.add(url);
          insecure = true;
          line("info", "Downloading over plain http (Install Anyway)");
        }
      }
    })();
    job.catch(() => {}); // after Cancel no one waits for it
    result = await (signal ? Promise.race([job, aborted.then(() => null)]) : job);
  } catch (e) {
    if (!stopped()) error = ipaError(e, name);
  }
  if (stopped()) return cancelled();
  if (declined) return { ...cancelled(), declined: true };
  if (error) {
    const first = error.code === "no_adhoc" ? error.detail || error.title : error.message;
    // B72: not again when it is the helper's own line, word for word (no_adhoc, os_version)
    if (!(first === error.detail && said.has(error.detail))) line("error", first);
    for (const l of error.lines) line(error.code === "no_adhoc" ? "warning" : "info", l);
    view.status(error.title);
  } else {
    const id = result?.bundleId || "";
    line("status", id ? `Installed ${name || id} (${id})` : `Installed ${name || "the app"}`);
    view.status("Done");
  }
  view.progress(100);
  return { ok: !error, bundleId: result?.bundleId || "", error, log: log.join("\n"), cancelled: false,
    ...(result?.libraryFile ? { libraryFile: result.libraryFile } : {}) }; // F380
}
