// A local-only Worker: /old/* hands the mock server's 101 straight through (the relay before B498b), anything else
// goes through this branch's appleRelay. Both talk to mock.mjs instead of the anisette server.
import { appleRelay } from "../../worker/src/apple-relay.js";
export default {
  fetch(req) {
    const u = new URL(req.url);
    const fetcher = (url, init) => fetch(`http://127.0.0.1:28714/${u.searchParams.get("how")}`, init);
    if (u.pathname.startsWith("/old/")) return fetcher("", { headers: { Upgrade: "websocket" } });
    return appleRelay(req, { APPLE_RELAY: "1" }, { fetcher });
  },
};
