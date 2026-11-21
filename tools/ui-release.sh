#!/bin/sh
# Give back every phone UI lock (iPhone 15, iPhone 7, 4S) a task holds, so a task that ends or is dropped never
# leaves a phone locked until the 30-minute stale timeout.
#   tools/ui-release.sh [ID]   ID defaults to this worktree's branch, task/<ID>
# The runner calls it when a slot's session ends (runner.toml `[run] on_exit`, run in the slot's worktree with
# AGENT_SLOT set). A lock whose `slot` file names this AGENT_SLOT is freed whoever owns it: the runner may already
# have switched the worktree's branch by the time this runs. In your own scripts, keep a trap beside the lock:
#   trap 'tools/ui-15.sh unlock T99' EXIT
# Any other lock is left alone (each ui-*.sh unlock only removes a lock its ID owns).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
locks=${XDG_RUNTIME_DIR:-/tmp}
if [ -z "${1:-}" ] && [ -n "${AGENT_SLOT:-}" ]; then
  for phone in 15 7 4s; do
    d=$locks/ifizbox-$phone-ui.lock
    if [ "$(cat "$d/slot" 2>/dev/null || true)" = "$AGENT_SLOT" ]; then rm -rf "$d"; fi
  done
fi
id=${1:-$(git -C "$here" rev-parse --abbrev-ref HEAD 2>/dev/null || true)}
id=${id#task/}
case $id in ''|HEAD|main|merge) exit 0 ;; esac  # not a task's worktree: nothing of ours to give back
for phone in 15 7 4s; do
  sh "$here/ui-$phone.sh" unlock "$id" || true
done
