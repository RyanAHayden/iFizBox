# B440: iFizBox's own update finishes with no swipe

(in progress) Read so far: R102, B433, B394, B159, B173, B439. Own update on This iPhone goes plain (NonInteractive);
R102: installd never asks a second time after a refusal, goes on when the app exits; but when the client's
connection drops first, installcoordinationd cancels the update. Is exit a race between those two? To measure.
Plan: native/build/iFizBox.ipa (0.32.0, this branch) on the 15 Pro; loop own updates (signing.install selfIcon, or a
served copy over tailscale serve as in B439), syslog runningboardd/installcoordinationd/installd/iFizBox.
