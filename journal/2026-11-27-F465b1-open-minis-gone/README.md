# F465b1: Open Minis is gone from the App Store

## Did

- Re-checked on 2026-11-27, about 20:36 UTC. Open Minis (id 6759188481) is still gone.
- Uncached lookups return 0 results: `itunes.apple.com/lookup` with country=us or gb and a throwaway `cb=` parameter, and by bundle ID.
- `apps.apple.com` pages for it return 404 (us, gb, no country). LocalDevVPN's page returns 200.
- A US store search for "open minis" does not list it.
- Trap: the plain `https://itunes.apple.com/lookup?id=6759188481` still returns the full record. That is a stale Akamai cache copy (`x-cache: TCP_MEM_HIT`, 14429 bytes, against 42 bytes uncached). Add a throwaway query parameter when re-checking.
- Put the choice to the person:
  - Hide the Install Without a Computer section until Open Minis is back (recommended).
  - Or send people to its TestFlight link, `https://testflight.apple.com/join/3BdkA5c3`.
  - Or keep the App Store link, as the removal may be temporary.
- No product code changed yet. The answer reopens the task.
- `tools/setup/release.sh --dry-run` built all five targets into the session scratchpad. Rebuild next time. Nothing was published.

## Next

- Build the answer once the person chooses.
- Phone check on the iPhone 15 Pro: dry-run build, served from inside Open Minis. Keep 1.16 installed.
- `install.sh` downloads binaries from `IFIZBOX_SETUP_BASE` when it is set, otherwise from ifizbox.com. Set it for a stand-in run. Open Minis needs the linux-arm64 build.

## Not verified

- The line `wget -qO- URL | sh -s -- CODE` through `install.sh` on the iPhone 15 Pro: not run. The phone was locked by another task (T89), and the choice was filed first.
- Whether Apple's removal is temporary, and why it happened: unknown.
- The TestFlight link was not re-opened today in this task.
- The App Store alert on the phone was not checked again. It was last seen in the earlier journal, `journal/2026-11-27-f465b-website-phone-setup`.
