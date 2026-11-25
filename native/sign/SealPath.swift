// The paths of a signed bundle as iOS sees them when it checks the seal (B432). Every rule here was measured on
// installd (iPhone 15 Pro, iOS 27): a bundle sealed any other way is refused with 0xe8008017, "A signed resource has
// been added, modified, or deleted".
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum SealPath {
    // What iOS skips at a bundle's root, so a CodeResources that lists one of these names a file that isn't found:
    // the rest of an old signature and the Mac's store receipt.
    static func unsealed(_ rel: String) -> Bool {
        ["_CodeSignature", "CodeResources", "_MASReceipt"].contains { rel == $0 || rel.hasPrefix($0 + "/") }
    }

    // A zip entry's name with no empty or "." parts: installd extracts "a/./b" and "a//b" as "a/b". A leading "/" and
    // ".." stay (they are refused).
    static func short(_ name: String) -> String {
        guard name.utf8.contains(UInt8(ascii: ".")) || name.utf8.contains(UInt8(ascii: "/")) else { return name }
        let parts = name.unicodeScalars.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.dropLast().contains(where: { $0.isEmpty || $0.elementsEqual(["."]) }) else { return name }
        var kept = [String]()
        for (i, p) in parts.enumerated() {
            if i < parts.count - 1 && (p.elementsEqual(["."]) || (p.isEmpty && i > 0)) { continue }
            kept.append(String(p))
        }
        let s = kept.joined(separator: "/")
        return s.isEmpty ? name : s
    }

    // Is `path` in the folder `dir` ("…/")? Swift compares whole characters, and a name that starts with a combining
    // mark or a joiner makes one character with the "/" before it.
    static func inside(_ path: String, _ dir: String) -> Bool {
        path.hasPrefix(dir) || path.unicodeScalars.starts(with: dir.unicodeScalars)
    }

    // `path`, in `dir`, from there.
    static func relative(_ path: String, to dir: String) -> String {
        path.unicodeScalars.starts(with: dir.unicodeScalars)
            ? String(path.unicodeScalars.dropFirst(dir.unicodeScalars.count)) : String(path.dropFirst(dir.count))
    }
}

// APFS takes the composed and decomposed spellings of a name (é) as one, and keeps the first it was given; the
// CodeResources must spell it that way too. Swift's String equality already takes them as one.
struct Spelling {
    private var first = [String: String]() // a path -> the spelling of its last part

    mutating func add(_ path: String, decomposed: Bool = false) {
        guard path.utf8.contains(where: { $0 >= 0x80 }) else { return }
        var prefix = ""
        for p in Spelling.parts(path) where !p.isEmpty {
            prefix += "/" + p
            if first[prefix] == nil { first[prefix] = decomposed ? p.decomposedStringWithCanonicalMapping : p }
        }
    }

    func of(_ path: String) -> String {
        guard path.utf8.contains(where: { $0 >= 0x80 }) else { return path }
        var prefix = ""
        return Spelling.parts(path).map { p in
            if p.isEmpty { return p }
            prefix += "/" + p
            return first[prefix] ?? p
        }.joined(separator: "/")
    }

    private static func parts(_ path: String) -> [String] {
        path.unicodeScalars.split(separator: "/", omittingEmptySubsequences: false).map { String($0) }
    }
}
