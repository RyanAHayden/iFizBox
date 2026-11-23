// Web Worker that parses repo indexes off the UI thread. Start it as a module worker:
// `new Worker(new URL("./core/worker.js", import.meta.url), { type: "module" })`, or use core/parser.js.
// Messages in: {id, type: "packages" | "release" | "control" | "count", text | bytes, root, arch}. `bytes` (an ArrayBuffer, best
// transferred) is decoded here as UTF-8, with U+FFFD for bad bytes (BigBoss's list has some), so the decode is
// off the UI thread too. Messages out: {id, ok: true, result} or {id, ok: false, error}.
import { parseControl, parsePackages, parseRelease, countPackages } from "./apt.js";
import { createCatalog, runCatalog } from "./catalog.js";

// The package catalog (core/catalog.js) lives here, so sections, lists and search never run on the UI thread.
// {type: "catalog", op, args}; for op "load" the Packages file (for "loadAlt" an AltStore source's JSON) comes as text or bytes and goes in as args[1], for
// "setInstalled" dpkg's status file goes in as args[0].
const catalog = createCatalog();

export function handle(msg) {
  if (msg.type === "catalog") {
    const args = msg.args ?? [];
    if ((msg.op === "load" || msg.op === "loadAlt") && (msg.bytes != null || msg.text != null)) {
      args[1] = msg.bytes != null ? new TextDecoder("utf-8").decode(msg.bytes) : msg.text;
    }
    // dpkg's status file (F7) rides the same way, as args[0].
    if (msg.op === "setInstalled" && (msg.bytes != null || msg.text != null)) {
      args[0] = msg.bytes != null ? new TextDecoder("utf-8").decode(msg.bytes) : msg.text;
    }
    return runCatalog(catalog, msg.op, args);
  }
  const text = msg.bytes != null ? new TextDecoder("utf-8").decode(msg.bytes) : msg.text;
  switch (msg.type) {
    case "packages": return parsePackages(text, msg.root);
    case "release": return parseRelease(text);
    case "control": return parseControl(text);
    // How many packages install on msg.arch: the Sources tab's count, without shipping every stanza back.
    case "count": return countPackages(text, msg.arch); // unique package ids, not stanzas (B366)
    default: throw new Error(`unknown parse type ${msg.type}`);
  }
}

export function reply(msg) {
  try {
    return { id: msg.id, ok: true, result: handle(msg) };
  } catch (err) {
    return { id: msg.id, ok: false, error: String(err?.message ?? err) };
  }
}

// Only wire up the message loop inside a worker; importing this file elsewhere (node --test, the inline
// fallback in parser.js) just gets the functions.
if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) {
  globalThis.onmessage = (e) => globalThis.postMessage(reply(e.data));
}
