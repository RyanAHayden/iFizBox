#!/bin/sh
# Give back every phone UI lock (iPhone 15, iPhone 7, 4S) a task holds, so a task that ends or is dropped never
# leaves a phone locked until the 30-minute stale timeout.
#   tools/ui-release.sh [ID]   ID defaults to this worktree's branch, task/<ID>
# The runner calls it when a slot's session ends (runner.toml `[run] on_exit`, run in the slot's worktree). In your
# own scripts, keep a trap beside the lock:  trap 'tools/ui-15.sh unlock T99' EXIT
# A lock held by anyone else is left alone (each ui-*.sh unlock only removes a lock its ID owns).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
id=${1:-$(git -C "$here" rev-parse --abbrev-ref HEAD 2>/dev/null || true)}
id=${id#task/}
case $id in ''|HEAD|main) exit 0 ;; esac  # not a task's worktree: nothing of ours to give back
for phone in 15 7 4s; do
  sh "$here/ui-$phone.sh" unlock "$id" || true
done
