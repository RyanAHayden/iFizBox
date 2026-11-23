// F380: an IPA downloaded for a custom install, kept in My IPAs without downloading it again. The install's calls
// (signing.prepare / signing.open in SignAhead.swift, the jailbreak app's ipa.install in Apt.swift) take
// keepInLibrary: true; the download gets a second name (`hold`) before the signer or the helper is done with it, and
// once the install has gone through that name moves into the library (`keep`) and the reply says {libraryFile}.
// web/app/core/myipas.js saveInstalledIpa then uses that file instead of library.add {url}.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

extension IPALibrary {
    // A second name for `download` in `dir`: a hard link (no copy; it outlives the first name's removal), else a copy.
    // nil when neither works (the install goes on; only the save in My IPAs is lost).
    static func hold(_ download: URL, in dir: URL, token: String = UUID().uuidString) -> URL? {
        let to = dir.appendingPathComponent("\(token)-mine.ipa")
        let fm = FileManager.default
        if (try? fm.linkItem(at: download, to: to)) != nil { return to }
        if (try? fm.copyItem(at: download, to: to)) != nil { return to }
        return nil
    }

    // The name a downloaded IPA gets in the library: the link's own file name when it ends in .ipa, else the app's
    // name and version ("Delta 1.5.ipa"), as library.add names one.
    static func downloadName(_ url: URL, details: AppDetails?) -> String {
        let name = url.lastPathComponent
        if name.lowercased().hasSuffix(".ipa") { return name }
        guard let d = details else { return name.isEmpty ? "App.ipa" : name + ".ipa" }
        let n = [d.name.isEmpty ? d.bundleID : d.name, d.version].filter { !$0.isEmpty }.joined(separator: " ")
        return (n.isEmpty ? "App" : n) + ".ipa"
    }

    // A held download moved into the library (no copy), named after `url` -> its file name. The held file must be an
    // IPA (Inspect.ipa reads it); anything else throws and stays where it is for the caller to delete.
    func keep(_ held: URL, url: URL) throws -> String {
        let d = try Inspect.ipa(held)
        return try add(held, name: IPALibrary.downloadName(url, details: d), move: true)
    }
}
