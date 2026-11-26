# T87a: free Apple ID computer setup on the iPhone 15 Pro

## What I did
- Read docs/sideload.md (computer setup section, Not verified list) and ~/.claude/ACCESS.md.
- Looked for a free Apple ID login on this machine: ACCESS.md lists the App Store Connect key (paid team S8NFX3A2LT) and
  Apple Development signing only; ~/sync/default/signing holds no free Apple ID credentials.
- Nothing was run on the phone; ui-15.sh lock was not taken.

## Result
Blocked: the test needs a free Apple ID (one with no paid membership), which this machine does not have.
The paid team's account would not test the free route (explicit 7-day profiles).

## Steps that worked
none yet

## Not verified
- Everything in the task: website sign-in, checklist, code, setup.sh, Home Screen app, re-sign on the phone. Reason: no free Apple ID.
