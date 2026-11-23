# B389: Lite stops recommending Chariz

The sideload (Lite) build recommended Chariz in Find More, on the Sources page and in its Why page. Almost nothing
from Chariz works without a jailbreak, so Lite no longer recommends it. Searching for it still finds it.

## What changed

- `web/app/core/canister.js`: `notForLite(uri)` matches chariz.com and its subdomains. `liteRepos(rows, query)`
  drops those rows unless the query contains "chariz".
- `web/app/screens/findmore.js` `renderFind`: in the sideload build, Popular and search results go through
  `liteRepos`. So Add All, which adds the listed rows, never adds Chariz from Popular or from a broad search such
  as "free". Typing Chariz, repo.chariz.com or the full URL shows it, with ADD.
- `web/app/screens/home.js`: `curatedSources(mode)` filters the old `#/home/sources` page in sideload mode.
- `web/app/screens/why.js`: the "Tweaks in Sideloaded Apps" line no longer names Chariz. The Why page shows in Lite.
  The README's pitch still names it: not a Lite surface, filed as D30.

## Already without it, unchanged

- More Sources' Recommended and Add All: APT entries show only when jailbroken.
- Lite's default sources: only the GitHub "inject" ones.
- The dependency "Add Chariz" action: sideload tweaks get no dependency report (B325).

## Left as is on purpose

- Search's "Other Sources · Canister" and Add Tweaks' "Search All Repos" list single tweaks that passed the
  injectable filter for what was searched. They show how a tweak is found, not a repo recommendation.
- The Known Safe label, and the source lists, so an added Chariz is never removed.
- The Why page's Sources screenshot and its alt text still show Chariz among added sources.

## Checks

- Live check on 2026-11-23 with curl: Canister's repository search finds Chariz for all three forms (name, host
  and full URL).
- `node --test` in `web/app/screens/findmore-addall.test.js` and `web/app/screens/home.test.js`.

## Not verified

- Not looked at on the iPhone 15 Pro or in Chromium. The change is a data filter only, with no layout change, and
  the node tests cover the rendered page.
