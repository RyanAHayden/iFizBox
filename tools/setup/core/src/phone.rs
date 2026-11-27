//! Phone Setup (F465): the same command run on the iPhone itself, in the Open Minis app, so no computer is needed
//! (iOS 27). The order and the words live here; the device side (Open Minis's commands, pairing, the tunnel through
//! LocalDevVPN, installing) is ../../cli/src/minis.rs, behind `Phone`.
//!
//! Steps: Open Minis and LocalDevVPN are there → the code → download the signed IPA (checked, as on a computer) →
//! pair (Settings > Developer Mode > Pair with <name>) → install → give the app the pairing → forget it here.
//! The download comes before pairing: pairing waits on the person, and the code expires. The pairing is only ever in
//! memory: it can install apps, and Open Minis has an agent that reads files.

use super::*;

pub trait Phone {
    /// Open Minis's commands are here and LocalDevVPN is connected; else what to do about it.
    fn ready(&mut self) -> Result<(), String>;
    /// Offer this program for pairing and wait for Settings to take it: the pairing (plist bytes).
    fn pair(&mut self, ui: &mut dyn Ui) -> Result<Vec<u8>, String>;
    fn install(&mut self, ipa: &Path, ui: &mut dyn Ui) -> Result<(), String>;
    /// Make the folders and write `bytes` at `path` in the app's container.
    fn write_file(&mut self, bundle_id: &str, dirs: &[String], path: &str, bytes: &[u8]) -> Result<(), String>;
}

pub fn run(args: &Args, brand: &Brand, ui: &mut dyn Ui, net: &mut dyn Net, phone: &mut dyn Phone) -> Result<(), Failure> {
    phone.ready().map_err(|m| fail(EXIT_DEVICE, m))?;

    let l = get_lookup(args, brand, ui, net)?;
    ui.say(&format!("Code OK: {} {} ({:.1} MB).", l.name, l.version, l.size as f64 / 1e6));
    let got = fetch_ipa(&l, ui, net)?;

    let pairing = phone.pair(ui).map_err(|m| fail(EXIT_PAIRING, format!("Couldn't pair: {m}")))?;
    ui.say("Paired.");

    ui.say(&format!("Installing {}…", l.name));
    phone.install(&got.path, ui).map_err(|m| fail(EXIT_INSTALL, format!("Install failed: {m}")))?;
    ui.say(&format!("Installed {}.", l.name));

    // The app is installed either way: it can pair by itself if this fails.
    if let Some(p) = &l.pairing {
        match phone.write_file(&p.bundle_id, &parent_dirs(&p.path), &p.path, &pairing) {
            Ok(()) => ui.say("Gave the app its pairing."),
            Err(m) => ui.say(&format!("Couldn't give the app its pairing ({m}): pair again in the app.")),
        }
    }

    ui.say(&format!(
        "Done. Turn on Developer Mode if it's off (Settings > Privacy & Security), trust your Apple ID under Settings > \
         General > VPN & Device Management, then open {}. You can delete Open Minis now.",
        l.name
    ));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Fake {
        log: Vec<String>,
        not_ready: bool,
        no_pair: bool,
        no_write: bool,
        said: Vec<String>,
    }

    struct Say<'a>(&'a mut Vec<String>);
    impl Ui for Say<'_> {
        fn say(&mut self, line: &str) {
            self.0.push(line.into());
        }
        fn ask(&mut self, _: &str) -> Option<String> {
            None
        }
        fn progress(&mut self, _: &str, _: u64, _: u64) {}
    }

    impl Phone for Fake {
        fn ready(&mut self) -> Result<(), String> {
            self.log.push("ready".into());
            if self.not_ready {
                Err("Connect LocalDevVPN.".into())
            } else {
                Ok(())
            }
        }
        fn pair(&mut self, _: &mut dyn Ui) -> Result<Vec<u8>, String> {
            self.log.push("pair".into());
            if self.no_pair {
                Err("nobody typed the code".into())
            } else {
                Ok(b"key".to_vec())
            }
        }
        fn install(&mut self, ipa: &Path, _: &mut dyn Ui) -> Result<(), String> {
            self.log.push(format!("install {}", ipa.display()));
            Ok(())
        }
        fn write_file(&mut self, b: &str, dirs: &[String], path: &str, bytes: &[u8]) -> Result<(), String> {
            self.log.push(format!("write {b} {} {path} {}", dirs.join(","), bytes.len()));
            if self.no_write {
                Err("no container".into())
            } else {
                Ok(())
            }
        }
    }

    struct Web;
    impl Net for Web {
        fn lookup(&mut self, server: &str, _: &str) -> Result<Lookup, NetError> {
            Ok(Lookup {
                ipa: format!("{server}/sign/up/t/app.ipa"),
                size: 3,
                sha256: None,
                bundle_id: "a.b".into(),
                name: "Boxy".into(),
                version: "1".into(),
                pairing: Some(PairingTarget { bundle_id: "a.b".into(), path: "Documents/p.plist".into() }),
                expires_in: 60,
            })
        }
        fn download(&mut self, _: &Lookup, _: &mut dyn Ui) -> Result<Downloaded, String> {
            Ok(Downloaded { path: "x.ipa".into(), size: 3, sha256: String::new() })
        }
        fn discard(&mut self, _: &Path) {}
    }

    fn go(mut f: Fake) -> (Result<(), Failure>, Fake) {
        let brand = Brand { name: "Boxy".into(), domain: "boxy.example".into() };
        let Ok(Cmd::Run(args)) = parse_args(&["ABCD-2345".to_string()], &brand) else { panic!("args") };
        let mut said = vec![];
        let r = run(&args, &brand, &mut Say(&mut said), &mut Web, &mut f);
        f.said = said;
        (r, f)
    }

    #[test]
    fn downloads_pairs_installs_and_hands_over_the_pairing() {
        let (r, f) = go(Fake::default());
        assert_eq!(r, Ok(()));
        assert_eq!(f.log, ["ready", "pair", "install x.ipa", "write a.b Documents Documents/p.plist 3"]);
        assert!(f.said.last().unwrap().contains("delete Open Minis"));
    }

    #[test]
    fn stops_before_the_code_when_not_ready() {
        let (r, f) = go(Fake { not_ready: true, ..Default::default() });
        assert_eq!(r.unwrap_err(), Failure { message: "Connect LocalDevVPN.".into(), exit: EXIT_DEVICE });
        assert_eq!(f.log, ["ready"]);
        assert!(f.said.is_empty());
    }

    #[test]
    fn no_pairing_installs_nothing() {
        let (r, f) = go(Fake { no_pair: true, ..Default::default() });
        assert_eq!(r.unwrap_err().exit, EXIT_PAIRING);
        assert_eq!(f.log, ["ready", "pair"]);
    }

    #[test]
    fn an_app_that_cannot_take_the_pairing_is_still_installed() {
        let (r, f) = go(Fake { no_write: true, ..Default::default() });
        assert_eq!(r, Ok(()));
        assert!(f.said.iter().any(|s| s.contains("pair again in the app")));
    }
}
