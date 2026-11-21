# C63: stale comments about native bars

Four comments said the app draws its own UINavigationBar/UITabBar and that `html.native` hides the web bars.
Nothing sets `html.native` and the shell draws no UIKit bars (native/test_web_bars.py), so the app shows the web
bars in every era. Rewrote the comments:

- `web/app/ios26.css` header: the glass is the same in the app as on the website and the Home Screen app.
- `web/app/nav/tabbar.js` floating tab bar note: the app shows this same bar.
- `web/app/style.css` above the `html.native` rule: marks the rule unused and says why.
- `web/app/packages.css` sheet-bar rule: says what the rule would do and that nothing sets the class.

The `html.native` rules themselves stay: the task asked for the comments only; removing them would be a separate
cleanup.

Nothing tried that failed.

**Not verified**: none (comment-only change; the gate covers the rest).
