# T82b: phone tools in runner.toml

- Added [run.tools.iphone15], [run.tools.iphone7], [run.tools.iphone4s] with `tools/ui-*.sh state` as check.
- AGENTS.md, docs/iphone7.md, docs/iphone15.md: "try later" replaced by `run wait-for <tool>`, no polling.
- `ui-7.sh state` and `ui-4s.sh state` exit 0 (free); `ui-15.sh state` exit 75 (held by B435), as designed.
- `run plan` still loads with the new tables.

**Not verified**: `run wait-for iphone7` itself (would end this session); `run settings` only prints defaults and does not validate the file.
