# T82c: tag phone tasks with --needs

Read every open task (`run plan`, then `run plan <ID>`).

## Tagged
- R51: `--needs iphone15` (it runs on the iPhone 15 Pro through tools/ui-15.sh; shelved, so it only starts once a person reopens it).

## Left, with why
- B437: native Swift change with a Python test; found by reading code, no phone named.
- R37: needs the user at their own iPhone 15 (iOS 27); not a phone an agent drives.
- R38: needs the user, a Mac and Windows machines; the 15 only as part of a manual setup run.
- R36: needs a person with a newer iPhone; the 15 is read-only for agents.
- R52: needs a jailbroken iOS 16+ phone, none here (not the iPhone 7).
- F254f: build work; the iPhone 15 check is "with the user".
- F107, F227, F259, F265, F293, C31, T82, B210: web/worker/doc work, no phone.

**Not verified**: none beyond `run plan R51` showing `needs: iphone15`.
