# T81 remote-15.py: holder gate and clean Stop

- SIGTERM/SIGINT: frees the lock only when held as USER, exits 0.
- Page shows the holder; a task's lock refuses actions until "Use it anyway" for that holder (new holder asks again).
- Second start on the same port prints "already serving" and exits 0.
- Test env overrides: IFIZBOX_UI_SCRIPT, IFIZBOX_UI_LOCK, IFIZBOX_REMOTE_IP. tools/test_remote_15.py passes.

**Not verified**: the page in a real browser (button layout) and a real phone; no phone needed by the task.
