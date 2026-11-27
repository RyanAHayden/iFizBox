# B499 Install counts get their own write limit

- Install counts (POST /installs/<pkg>, worker/src/installs.js) shared the reviews' write limits: per token 4 a minute, per address 6 a minute and 40 a day. An Upgrade All sends one count per package at once, so most counts were dropped and a review post from the same device could be refused.
- Installs now have their own limits, never the reviews': 300 a minute per address (kept in this isolate's memory, as the reviews' minute is), and 1000 a day per address in a new D1 table install_writes (ip, pkg, at). Of the daily 1000, 40 a day may go to any one package, which keeps the old bound on how much one address can inflate a package with fresh tokens.
- No per-token limit, no new Cloudflare Rate Limiting binding, no client change, no batching. reviews.js is unchanged.
- worker/test-installs.mjs: 120 and more counts from one address are all counted, then a review post gets 200. Also checks the minute limit (429 at the 301st, 200 a minute later), the per-package day limit (429 for a 41st new token on one package, other packages still count, 200 a day later) and the address day limit (429 at 1001).
- Ran worker/test-installs.mjs, worker/test.mjs and worker/test-reports.mjs: pass.

**Not verified**: not run against deployed Cloudflare D1 or workerd (only Node SQLite with D1's API). No on-device Upgrade All.
