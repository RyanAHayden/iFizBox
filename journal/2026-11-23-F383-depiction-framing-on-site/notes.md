# F383: depiction framing on the site (2026-11-23)

On the website, a depiction from a host that refuses framing (Chariz sends `X-Frame-Options: DENY` and a CSP
`frame-ancestors` that lets in only cydia.saurik.com) opened as a white sheet. The app already sees those headers
and shows Open in Safari. On the site they were lost: the `/api/fetch` proxy dropped the upstream headers, so
`framingRefused` in `browse.js` never saw them.

## What changed

- `worker/src/index.js`: `upstreamFraming(headers)`, used on the plain `/api/fetch` path. It sends
  `X-Upstream-Frame-Options` (the upstream `X-Frame-Options` as it came) and `X-Upstream-Frame-Ancestors` (each CSP
  policy's `frame-ancestors` source list, comma-separated, one per policy, `'none'` for an empty list), and lists
  both in `Access-Control-Expose-Headers`. The proxy's own CSP stays `default-src 'none'; sandbox`.
- `web/app/screens/browse.js`: `proxiedFraming(headers)` turns those headers back into `x-frame-options` and
  `content-security-policy` for `framingRefused`. `openHtmlDepiction` uses it when `backend.kind === "http"`.

## Checks

- `worker/test-framing.mjs` (new): proxy headers through `w.fetch` with a mocked fetch, plus `upstreamFraming` unit
  cases. Passes.
- `web/app/screens/browse.test.js`: F383 cases for `proxiedFraming`, and the sheet on an http backend shows Open in
  Safari for Chariz's headers while a live frame is shown without them. Passes.
- The first run of `test-framing.mjs` hung after its checks passed. `cappedBody`'s overall 120 s body timer stays
  alive while a proxied body is unread. The test now reads each body whole.

## Not verified

- The deployed site against the real chariz.com. Nothing was deployed from this task; the runner publishes after
  merge.
- A real browser in Chromium. The fake-DOM test covers the sheet path, and the framing decision is pure header logic.
