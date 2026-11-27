# B493: revert F452 (install counts for Popular)

Ran `git revert -m 1 bd1eb80c`, then restored `plan/` and `journal/` to HEAD so the F452 journal and plan entries stay. Popular is back to the order before F452. `node --test web/app/core`: 1165 pass.

**Not verified**: the worker was not deployed, so the live worker still has the installs route until the next deploy.
