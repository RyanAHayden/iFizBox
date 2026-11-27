# F451 Share iFizBox link

- Both share popups (screens/handoff.js shareItems) list "Share iFizBox link": a source's is its `/add?url=` link
  (the site and app offer to add the source); an app's is the new `/app?id=<id>` link (core/handoff.js appLink /
  parseAppLink / isAppPath), which app.js turns into Search's `package:<id>` page. Tapping shares through the
  system sheet, or copies where there is none.
- Holding a source row opens the share popup; a failed or untrusted row keeps its menu (Refresh, Trust) with
  "Share…" added before Copy URL.
- node --test web/app: all pass (core/applink.test.js, handoff.test.js).

## Not verified
- Chromium: long-press and opening /app?id= were not run in a browser (no browser run in this session).
- The app (shell) opening /app links: only the site route exists; the shell hands over ifizbox:// links.
