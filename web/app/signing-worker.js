// F93: the website's signer, a module Web Worker (signing-client.js signInBrowser starts one per Install): zsign as
// WebAssembly (vendor/zsign) signs the IPA in this worker's memory, its files still compressed (F265: websign-stream.js). In: { ipa, p12, password, profile, bring }
// (ArrayBuffers, transferred). Out: { progress } while it works, then { ok: true, ipa (pieces: core/pieces.js), bundleId, name, version, sha256 }
// or { ok: false, error, code } (F292: code "malware" for an IPA whose hash is in the job's refuseSha256).
// F260: { check: "password", p12, password, profile } asks only whether the password opens the .p12 (signing-client.js
// checkPasswordInWorker): { ok: true, passwordOk: true | false | null }.
// SPDX-License-Identifier: GPL-3.0-or-later
import { runSignJob, runPasswordCheck } from "./websign-job.js";
import { pieceBuffers } from "./core/pieces.js";
import { GROUPFIX } from "./core/groupfix.js";

// B211: the app-group fix dylib next to this file, or null when it can't be had (the app then signs without it).
async function loadGroupFix() {
  try {
    const r = await fetch(new URL(GROUPFIX.file, import.meta.url));
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  } catch { return null; }
}

self.onmessage = async (e) => {
  try {
    const { default: createZsign } = await import("./vendor/zsign/zsign.js");
    if (e.data?.check === "password") {
      self.postMessage({ ok: true, passwordOk: await runPasswordCheck(createZsign, e.data) });
      return;
    }
    const r = await runSignJob(createZsign, { ...e.data, groupFix: await loadGroupFix() }, { progress: (p) => self.postMessage({ progress: p }) });
    self.postMessage({ ok: true, ...r }, pieceBuffers(r.ipa));
  } catch (err) {
    self.postMessage({ ok: false, error: String(err?.message ?? err), code: err?.code ?? "sign_failed" });
  }
};
