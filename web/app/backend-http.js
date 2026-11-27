// Site backend: fetches go through the Worker's proxy, /api/fetch (worker/src/index.js; private addresses refused:
// Cloudflare's fetch on the site, worker/src/ssrf-node.js on a self-hosted node.mjs), because most repos
// send no CORS headers. The app build swaps this for backend-native.js, which fetches directly.
//
//   const backend = createHttpBackend();
//   const { text, source, cached } = await backend.packages("https://repo.example.com/");
//   const res = await backend.fetch("https://repo.example.com/CydiaIcon.png");  // a Response
//
//   await backend.sources();  backend.addSource(url);  backend.removeSource(key);  backend.refreshSources(onEach)
//
// Failures throw BackendError with the proxy's `code` (bad_url, refused, too_large, timeout, upstream,
// not_found, network, rate_limited) and, for code "upstream", the repo's HTTP `status`.

import { freshUrl } from "./core/sources.js";
import { sourceCalls, sortSources, loadAppSources } from "./core/sources.js";
import { withAltSources } from "./core/altstore.js";
import { validatorCache } from "./core/health.js";
import { reviewsApi } from "./core/reviews.js";
import { createKeepAwake, wakeLockScreen } from "./core/keepawake.js";

export class BackendError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "BackendError";
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

// `sourceOptions` go to core/sources.js sourceCalls (indexedDB, arch, count): the source list lives in this
// browser's IndexedDB, the same code the app runs.
export function createHttpBackend({ base = "", fetchFn = globalThis.fetch.bind(globalThis), sourceOptions = {},
  screen = wakeLockScreen() } = {}) {
  const endpoint = (params) => `${base}/api/fetch?${new URLSearchParams(params.url ? { ...params, url: freshUrl(params.url) } : params)}`;

  // F19: the proxy answers with an ETag (and the repo's Last-Modified); text() sends them back, and a 304 reuses
  // the text kept here, so a Release that hasn't changed costs no transfer.
  const validators = validatorCache();

  async function call(params, headers = null) {
    let res;
    try {
      res = await (headers ? fetchFn(endpoint(params), { headers }) : fetchFn(endpoint(params)));
    } catch (e) {
      throw new BackendError("network", `cannot reach the server: ${e.message}`);
    }
    if (res.status === 304 && headers) return res;
    if (!res.ok) {
      let body = {};
      try {
        body = await res.json();
      } catch {
        // not JSON: a proxy in front of us answered
      }
      throw new BackendError(body.code || (res.status === 429 ? "rate_limited" : "network"),
        body.error || `server answered HTTP ${res.status}`, body.status);
    }
    return res;
  }

  const backend = {
    kind: "http",
    // The raw Response for any http(s) URL. HTML and other active types come back as application/octet-stream.
    fetch: (url) => call({ url }),
    // A URL an <img> can load the remote image through (repo icons): the proxy, since it's on our origin.
    assetUrl: (url) => endpoint({ url }),
    async text(url) {
      const cond = validators.headers(url);
      const res = await call({ url }, Object.keys(cond).length ? cond : null);
      if (res.status === 304) {
        const kept = validators.reuse(url);
        if (kept !== undefined) return kept;
        return (await call({ url })).text(); // forgotten meanwhile: ask again in full
      }
      const text = await res.text();
      validators.store(url, res.headers, text);
      return text;
    },
    // A repo's Packages index as plain text: the server tries Packages.xz, .bz2, .gz, then plain in `repoDir`
    // (a flat repo's URL, or a dists/<suite>/<component>/binary-<arch>/ directory) and caches it 30 minutes.
    // B177: the Worker reads Packages.gz and plain Packages only. BigBoss has Packages.bz2 alone, and its plain
    // Packages redirects to an HTML page the proxy passes on as the index (0 packages): an HTML answer, or none,
    // falls back to .bz2 (then .zst) fetched raw through the proxy and unpacked here (core/unpack.js).
    async packages(repoDir) {
      let res = null, first = null;
      try { res = await call({ url: repoDir, kind: "packages" }); } catch (e) {
        if (e?.code !== "not_found") throw e;
        first = e;
      }
      const text = res ? await res.text() : null;
      if (text != null && !/^\s*</.test(text.slice(0, 512))) {
        return { text, source: res.headers.get("X-Source-URL") || repoDir, cached: res.headers.get("X-Cache") === "HIT" };
      }
      const { decompress } = await import("./core/unpack.js");
      for (const name of ["Packages.bz2", "Packages.zst"]) {
        let bytes;
        try { bytes = new Uint8Array(await (await call({ url: repoDir + name })).arrayBuffer()); } catch (e) {
          if (e?.code === "upstream" || e?.code === "not_found") continue;
          throw e;
        }
        if (!bytes.length || bytes[0] === 0x3c) continue;
        try { return { text: new TextDecoder().decode(decompress(name, bytes)), source: repoDir + name, cached: false }; } catch { continue; }
      }
      throw first ?? new BackendError("not_found", `no Packages index in ${repoDir} (the repo answered with a web page)`);
    },
  };
  // F182: user reviews, on the same server as the proxy (core/reviews.js; worker/src/reviews.js).
  backend.reviews = reviewsApi({ base, fetcher: fetchFn });
  // F287: keepAwake(on) from a job runner (core/apprun.js): the screen stays on (Screen Wake Lock, where the browser
  // has it) from the first job's true to the last one's false. Counted, so overlapping runs share it.
  const awake = createKeepAwake(screen);
  backend.keepAwake = (on) => awake.set(on);
  backend.awake = awake;
  // AltStore sources (F9) sit beside the APT list, in their own store (core/altstore.js withAltSources). Both lists
  // seed from the site's own tweak-sources.json / app-sources.json (core/sources.js loadTweakSources, loadAppSources).
  return Object.assign(backend, withAltSources(sourceCalls(backend, sourceOptions), backend, { altDefaults: () => loadAppSources(), ...sourceOptions, sort: sortSources }));
}
