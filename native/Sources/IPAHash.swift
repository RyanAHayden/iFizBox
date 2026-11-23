// F292: the IPA's SHA-256, taken before signing changes it, for Report as Malicious (web/app/core/malicious.js
// rememberIpaHash) and the known-malware list (MALWARE_IPAS): signing.install and signing.prepare answer it as
// `sha256`, and refuse an IPA whose hash is in the call's `refuseSha256` (the page's malwareHashes) with code "malware".
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation // SHA256: the signer's own (native/sign/Hash.swift, CommonCrypto)

enum IPAHash {
    static let refused = "malware: That IPA is on the known-malware list. It won't be signed."

    // Lowercase hex, read 1 MB at a time (an IPA can be hundreds of MB); nil when the file can't be read.
    static func of(_ file: URL) -> String? {
        guard let h = try? FileHandle(forReadingFrom: file) else { return nil }
        defer { try? h.close() }
        var sha = SHA256()
        var failed = false
        while !failed {
            // each chunk freed as it goes (a background queue has no pool of its own to drain)
            let more: Bool = autoreleasepool {
                let read: Data?
                do { read = try h.read(upToCount: 1 << 20) } catch { failed = true; return false }
                guard let chunk = read, !chunk.isEmpty else { return false } // nil or empty: the end of the file
                sha.update(chunk)
                return true
            }
            if !more { break }
        }
        if failed { return nil }
        return sha.final().map { String(format: "%02x", $0) }.joined()
    }

    // The call's refuseSha256, lowercased.
    static func refuse(_ params: [String: Any]) -> Set<String> {
        Set((params["refuseSha256"] as? [Any] ?? []).compactMap { ($0 as? String)?.lowercased() })
    }

    // Hashes `file` and throws the refusal when it is listed. -> the hash (nil: unreadable, which signing then names).
    static func check(_ file: URL, refuse: Set<String>, log: ((String) -> Void)? = nil) throws -> String? {
        guard let sha = of(file) else { return nil }
        log?("IPA SHA-256: \(sha)")
        if refuse.contains(sha) { WaitingIPA.remove(sha256: sha); throw Sideload.Failed(text: refused) }
        return sha
    }
}
