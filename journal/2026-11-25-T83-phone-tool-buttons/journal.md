# T83 Tools page: phone remotes and buttons

Installed agent-runner is 0.72.0; its docs/REFERENCE.md has `[run.tools]` page, start and buttons.

## Done
- runner.toml: each phone tool got `page` (the remote's port: 15 `:8098`, 7 `:8099`, 4S `:8101`) and `start`
  (`tools/remote-15.py 15|7|4s`).
- Buttons, each `lock USER`, one action, `unlock USER` (tidy off, so the screen is left as the button made it), and the
  action's exit status kept: 15: Home, Wake, Reboot (with a confirm); 7: Home, Lock; 4S: Home.
- 4S has no wake or lock script action, and the 7 has no wake or reboot, so those are not offered.
- tools/test_ui_state.py needed no change.

## Not verified
- Start, Use and the buttons on a free phone: runner.toml is read by the run from the main checkout, so they only exist
  after this lands. The file parses (tomllib) and `run status` still loads.
