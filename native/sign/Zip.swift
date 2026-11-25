// ZIP reading and writing for the on-device signer (I6), over zlib. The reader streams one entry at a time from the
// file (an IPA can be bigger than the phone's free memory); the writer copies untouched entries' compressed bytes as
// they are and deflates only what signing changed. ZIP64 is read, and written once an offset or size needs it.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

#if !canImport(ObjectiveC)
// Linux (native/test_sign.py) has no autorelease pools: the body just runs.
@inline(__always) func autoreleasepool<T>(invoking body: () throws -> T) rethrows -> T { try body() }
#endif

struct ZipError: Error, CustomStringConvertible {
    let description: String
    init(_ s: String) { description = s }
}

struct ZipEntry {
    let name: String
    let method: UInt16
    let flags: UInt16
    let crc: UInt32
    let compressedSize: UInt64
    let size: UInt64
    let localOffset: UInt64
    let dosTime: UInt16
    let dosDate: UInt16
    let externalAttr: UInt32
    let madeBy: UInt16

    var isDirectory: Bool { name.hasSuffix("/") }
    var unixMode: UInt32 { madeBy >> 8 == 3 ? externalAttr >> 16 : (isDirectory ? 0o40755 : 0o100644) }
    var isSymlink: Bool { unixMode & 0o170000 == 0o120000 }
}

final class ZipReader {
    let entries: [ZipEntry]
    let url: URL
    private let fh: FileHandle

    // R41: another reader of the same file with its own file handle (the entries aren't read again), so threads can
    // read entries side by side.
    func clone() throws -> ZipReader { try ZipReader(url: url, entries: entries) }
    private init(url: URL, entries: [ZipEntry]) throws {
        self.url = url
        self.entries = entries
        fh = try FileHandle(forReadingFrom: url)
    }

    init(url: URL) throws {
        self.url = url
        fh = try FileHandle(forReadingFrom: url)
        let end = fh.seekToEndOfFile()
        let tailLen = min(end, 65_557)
        fh.seek(toFileOffset: end - tailLen)
        let tail = [UInt8](fh.readData(ofLength: Int(tailLen)))
        var eocd = -1
        var i = tail.count - 22
        while i >= 0 {
            if tail[i] == 0x50, tail[i + 1] == 0x4b, tail[i + 2] == 5, tail[i + 3] == 6 { eocd = i; break }
            i -= 1
        }
        guard eocd >= 0 else { throw ZipError("not a zip file") }
        var count = UInt64(le16(tail, eocd + 10))
        var cdSize = UInt64(le32(tail, eocd + 12))
        var cdOff = UInt64(le32(tail, eocd + 16))
        if count == 0xFFFF || cdSize == 0xFFFF_FFFF || cdOff == 0xFFFF_FFFF {
            // ZIP64: the locator sits right before the EOCD and points at the ZIP64 EOCD record.
            let loc = eocd - 20
            guard loc >= 0, le32(tail, loc) == 0x07064b50 else { throw ZipError("bad ZIP64 locator") }
            let recOff = le64(tail, loc + 8)
            fh.seek(toFileOffset: recOff)
            let rec = [UInt8](fh.readData(ofLength: 56))
            guard rec.count == 56, le32(rec, 0) == 0x06064b50 else { throw ZipError("bad ZIP64 record") }
            count = le64(rec, 32); cdSize = le64(rec, 40); cdOff = le64(rec, 48)
        }
        guard cdOff + cdSize <= end else { throw ZipError("central directory past the end") }
        fh.seek(toFileOffset: cdOff)
        let cd = [UInt8](fh.readData(ofLength: Int(cdSize)))
        var out = [ZipEntry]()
        var p = 0
        for _ in 0..<count {
            guard p + 46 <= cd.count, le32(cd, p) == 0x02014b50 else { throw ZipError("bad central directory") }
            let nlen = Int(le16(cd, p + 28)), xlen = Int(le16(cd, p + 30)), clen = Int(le16(cd, p + 32))
            guard p + 46 + nlen + xlen + clen <= cd.count else { throw ZipError("bad central directory") }
            let name = SealPath.short(String(decoding: cd[(p + 46)..<(p + 46 + nlen)], as: UTF8.self))
            var csize = UInt64(le32(cd, p + 20)), usize = UInt64(le32(cd, p + 24)), lho = UInt64(le32(cd, p + 42))
            var x = p + 46 + nlen
            let xend = x + xlen
            while x + 4 <= xend {
                let id = le16(cd, x), sz = Int(le16(cd, x + 2))
                if id == 1 {
                    var q = x + 4
                    if usize == 0xFFFF_FFFF, q + 8 <= x + 4 + sz { usize = le64(cd, q); q += 8 }
                    if csize == 0xFFFF_FFFF, q + 8 <= x + 4 + sz { csize = le64(cd, q); q += 8 }
                    if lho == 0xFFFF_FFFF, q + 8 <= x + 4 + sz { lho = le64(cd, q) }
                }
                x += 4 + sz
            }
            out.append(ZipEntry(name: name, method: le16(cd, p + 10), flags: le16(cd, p + 8), crc: le32(cd, p + 16),
                                compressedSize: csize, size: usize, localOffset: lho, dosTime: le16(cd, p + 12),
                                dosDate: le16(cd, p + 14), externalAttr: le32(cd, p + 38), madeBy: le16(cd, p + 4)))
            p += 46 + nlen + xlen + clen
        }
        entries = out
    }

    deinit { fh.closeFile() }

    private func dataOffset(_ e: ZipEntry) throws -> UInt64 {
        fh.seek(toFileOffset: e.localOffset)
        let h = autoreleasepool { [UInt8](fh.readData(ofLength: 30)) }
        guard h.count == 30, le32(h, 0) == 0x04034b50 else { throw ZipError("bad local header for \(e.name)") }
        return e.localOffset + 30 + UInt64(le16(h, 26)) + UInt64(le16(h, 28))
    }

    // The entry's compressed bytes, piece by piece (for copying it into another zip as it is).
    func raw(_ e: ZipEntry, _ chunk: (Data) throws -> Void) throws {
        var left = e.compressedSize
        let off = try dataOffset(e)
        fh.seek(toFileOffset: off)
        while left > 0 {
            let n = Int(min(left, 1 << 20))
            // R41: FileHandle's reads are autoreleased, and the signer runs as one long block that never drains a
            // pool: every piece of the IPA read stayed in memory until it ended (iOS killed it on a big app).
            try autoreleasepool {
                let d = fh.readData(ofLength: n)
                guard d.count == n else { throw ZipError("\(e.name) is cut short") }
                try chunk(d)
            }
            left -= UInt64(n)
        }
    }

    // The entry's contents, piece by piece, with its CRC and size checked at the end.
    func read(_ e: ZipEntry, limit: UInt64 = .max, _ chunk: (Data) throws -> Void) throws {
        guard e.flags & 1 == 0 else { throw ZipError("\(e.name) is encrypted") }
        guard e.size <= limit else { throw ZipError("\(e.name) is too big") }
        var crc: UInt = 0
        var total: UInt64 = 0
        func emit(_ d: Data) throws {
            crc = d.withUnsafeBytes { p in UInt(crc32(uLong(crc), p.bindMemory(to: Bytef.self).baseAddress, uInt(d.count))) }
            total += UInt64(d.count)
            guard total <= e.size else { throw ZipError("\(e.name) is bigger than it says") }
            try chunk(d)
        }
        switch e.method {
        case 0:
            try raw(e, emit)
        case 8:
            let inflater = try Inflater()
            try raw(e) { piece in try inflater.feed(piece, emit) }
            guard inflater.done else { throw ZipError("\(e.name) is cut short") }
        default:
            throw ZipError("\(e.name) uses compression method \(e.method)")
        }
        guard total == e.size, UInt32(truncatingIfNeeded: crc) == e.crc else { throw ZipError("\(e.name) is damaged (CRC)") }
    }

    // `spare`: room kept past the contents (a Mach-O's signature is appended to it without moving it).
    func data(_ e: ZipEntry, limit: UInt64 = 1 << 31, spare: Int = 0) throws -> Data {
        var d = Data(capacity: Int(min(e.size, limit)) + spare)
        try read(e, limit: limit) { d.append($0) }
        return d
    }
}

final class Inflater {
    private var s = z_stream()
    private(set) var done = false
    init() throws {
        guard inflateInit2_(&s, -15, zlibVersion(), Int32(MemoryLayout<z_stream>.size)) == Z_OK else {
            throw ZipError("zlib inflateInit failed")
        }
    }
    deinit { inflateEnd(&s) }

    private var buf = [UInt8](repeating: 0, count: 1 << 18)

    func feed(_ input: Data, _ out: (Data) throws -> Void) throws {
        let total = input.count
        var consumed = 0
        // R41: zlib reads the input where it lies (it was copied into an array first, a megabyte at a time)
        try input.withUnsafeBytes { (ib: UnsafeRawBufferPointer) in
            let base = ib.bindMemory(to: Bytef.self).baseAddress.map { UnsafeMutablePointer(mutating: $0) }
            while !done {
                var produced = 0
                var rc: Int32 = Z_OK
                buf.withUnsafeMutableBufferPointer { ob in
                    s.next_in = base.map { $0 + consumed }
                    s.avail_in = uInt(total - consumed)
                    s.next_out = ob.baseAddress
                    s.avail_out = uInt(ob.count)
                    rc = inflate(&s, Z_NO_FLUSH)
                    consumed = total - Int(s.avail_in)
                    produced = ob.count - Int(s.avail_out)
                }
                if produced > 0 { try out(Data(buf[0..<produced])) }
                if rc == Z_STREAM_END { done = true; break }
                guard rc == Z_OK || rc == Z_BUF_ERROR else { throw ZipError("bad deflate data") }
                if consumed == total && produced < buf.count { break }
            }
        }
    }
}

func deflateData(_ input: Data, level: Int32 = 6) throws -> Data {
    let d = try Deflater(level: level)
    var out = Data()
    try d.feed(input, finish: true) { out.append($0) }
    return out
}

// Raw deflate, piece by piece (R41: a signed binary is deflated from its file as it's written, never whole in memory).
final class Deflater {
    private var s = z_stream()
    private var buf = [UInt8](repeating: 0, count: 1 << 18)
    init(level: Int32) throws {
        guard deflateInit2_(&s, level, Z_DEFLATED, -15, 8, Z_DEFAULT_STRATEGY, zlibVersion(),
                            Int32(MemoryLayout<z_stream>.size)) == Z_OK else { throw ZipError("zlib deflateInit failed") }
    }
    deinit { deflateEnd(&s) }

    // `finish` on the last piece (it may be empty) ends the stream; `flush` (Z_FULL_FLUSH) ends a piece on a byte
    // boundary with no state carried over, so independently deflated pieces join into one stream (deflateBlocks).
    func feed(_ input: Data, finish: Bool, flush: Int32 = Z_NO_FLUSH, _ out: (Data) throws -> Void) throws {
        let mode = finish ? Z_FINISH : flush
        try input.withUnsafeBytes { (ib: UnsafeRawBufferPointer) in
            s.next_in = ib.bindMemory(to: Bytef.self).baseAddress.map { UnsafeMutablePointer(mutating: $0) }
            s.avail_in = uInt(ib.count)
            var rc: Int32 = Z_OK
            repeat {
                var produced = 0
                buf.withUnsafeMutableBufferPointer { ob in
                    s.next_out = ob.baseAddress
                    s.avail_out = uInt(ob.count)
                    rc = deflate(&s, mode)
                    produced = ob.count - Int(s.avail_out)
                }
                if produced > 0 { try out(Data(buf[0..<produced])) }
                if finish ? rc == Z_STREAM_END : s.avail_in == 0 && produced < buf.count { break }
            } while rc == Z_OK || rc == Z_BUF_ERROR
            guard finish ? rc == Z_STREAM_END : rc == Z_OK || rc == Z_BUF_ERROR else { throw ZipError("deflate failed") }
            s.next_in = nil
        }
    }
}

// R41: deflates `input` as one raw deflate stream made of `block`-sized pieces deflated side by side (as pigz does):
// each but the last ends with a full flush, so they join with no dictionary carried across. On the iPhone 7's two
// cores a big signed binary deflates in half the time, a few bytes a block bigger than one stream.
func deflateBlocks(_ input: Data, level: Int32, block: Int = 4 << 20) throws -> Data {
    let n = max(1, (input.count + block - 1) / block)
    if n == 1 { return try deflateData(input, level: level) }
    var parts = [Data?](repeating: nil, count: n)
    var failure: Error?
    let lock = NSLock()
    DispatchQueue.concurrentPerform(iterations: n) { i in
        let lo = input.startIndex + i * block, hi = min(lo + block, input.endIndex)
        do {
            let z = try Deflater(level: level)
            var out = Data()
            try z.feed(input[lo..<hi], finish: i == n - 1, flush: Z_FULL_FLUSH) { out.append($0) }
            lock.lock(); parts[i] = out; lock.unlock()
        } catch {
            lock.lock(); failure = failure ?? error; lock.unlock()
        }
    }
    if let f = failure { throw f }
    var out = Data(capacity: parts.reduce(0) { $0 + ($1?.count ?? 0) })
    for p in parts { out.append(p!) }
    return out
}

func crc32Of(_ d: Data) -> UInt32 {
    d.withUnsafeBytes { p in UInt32(truncatingIfNeeded: crc32(0, p.bindMemory(to: Bytef.self).baseAddress, uInt(d.count))) }
}

final class ZipWriter {
    private struct Central {
        let name: Data, method: UInt16, flags: UInt16, time: UInt16, date: UInt16, crc: UInt32
        let csize: UInt64, usize: UInt64, offset: UInt64, attr: UInt32
    }
    private let fh: FileHandle
    private var offset: UInt64 = 0
    private var central = [Central]()

    init(url: URL) throws {
        guard FileManager.default.createFile(atPath: url.path, contents: nil) else { throw ZipError("can't write \(url.path)") }
        fh = try FileHandle(forWritingTo: url)
        fh.truncateFile(atOffset: 0)
    }

    private func write(_ d: Data) { fh.write(d); offset += UInt64(d.count) }

    private func local(_ c: Central) {
        let big = c.csize >= 0xFFFF_FFFF || c.usize >= 0xFFFF_FFFF
        var h = Data()
        h.le32(0x04034b50); h.le16(big ? 45 : 20); h.le16(c.flags); h.le16(c.method); h.le16(c.time); h.le16(c.date)
        h.le32(c.crc)
        h.le32(big ? 0xFFFF_FFFF : UInt32(c.csize)); h.le32(big ? 0xFFFF_FFFF : UInt32(c.usize))
        h.le16(UInt16(c.name.count)); h.le16(big ? 20 : 0)
        h.append(c.name)
        if big { h.le16(1); h.le16(16); h.le64(c.usize); h.le64(c.csize) }
        write(h)
    }

    // An entry from another zip, its compressed bytes copied as they are, under its name or `name`.
    func copy(_ e: ZipEntry, as name: String? = nil, from r: ZipReader) throws {
        let c = Central(name: Data((name ?? e.name).utf8), method: e.method, flags: e.flags & 0x0800, time: e.dosTime,
                        date: e.dosDate, crc: e.crc, csize: e.compressedSize, usize: e.size, offset: offset,
                        attr: e.madeBy >> 8 == 3 ? e.externalAttr : e.unixMode << 16)
        local(c)
        try r.raw(e) { write($0) }
        central.append(c)
    }

    // `level` 0 stores it as it is (R41), 1-9 deflates it.
    func add(_ name: String, _ data: Data, mode: UInt32 = 0o100644, time: UInt16 = 0, date: UInt16 = 0x5B71, level: Int32 = 6) throws {
        let isDir = name.hasSuffix("/")
        let stored = isDir || data.isEmpty || level == 0
        let packed = stored ? Data() : try deflateData(data, level: level)
        let method: UInt16 = stored ? 0 : 8
        let c = Central(name: Data(name.utf8), method: method, flags: 0x0800, time: time, date: date,
                        crc: crc32Of(data), csize: UInt64(method == 0 ? data.count : packed.count),
                        usize: UInt64(data.count), offset: offset, attr: mode << 16)
        local(c)
        write(method == 0 ? data : packed)
        central.append(c)
    }

    // R41: a file's contents (`size` bytes, CRC `crc`), read from disk a piece at a time: stored as they are, or,
    // with `packed` (its size), the file holds them deflated already (deflateBlocks) and is copied as it is.
    func add(_ name: String, file: URL, size: UInt64, crc: UInt32, packed: UInt64? = nil, mode: UInt32 = 0o100755,
             time: UInt16 = 0, date: UInt16 = 0x5B71) throws {
        let csize = packed ?? size
        guard size < 0xFFFF_FFFF, csize < 0xFFFF_FFFF else { throw ZipError("\(name) is too big") }
        let src = try FileHandle(forReadingFrom: file)
        defer { src.closeFile() }
        let c = Central(name: Data(name.utf8), method: packed == nil ? 0 : 8, flags: 0x0800, time: time, date: date,
                        crc: crc, csize: csize, usize: size, offset: offset, attr: mode << 16)
        local(c)
        var left = csize
        while left > 0 {
            try autoreleasepool { // as ZipReader.raw
                let n = Int(min(left, 1 << 20))
                let d = src.readData(ofLength: n)
                guard d.count == n else { throw ZipError("\(name) is cut short") }
                write(d)
                left -= UInt64(n)
            }
        }
        central.append(c)
    }

    func close() {
        let cdStart = offset
        for c in central {
            let big = c.csize >= 0xFFFF_FFFF || c.usize >= 0xFFFF_FFFF || c.offset >= 0xFFFF_FFFF
            var h = Data()
            h.le32(0x02014b50); h.le16(0x0300 | (big ? 45 : 20)); h.le16(big ? 45 : 20); h.le16(c.flags)
            h.le16(c.method); h.le16(c.time); h.le16(c.date); h.le32(c.crc)
            h.le32(big ? 0xFFFF_FFFF : UInt32(c.csize)); h.le32(big ? 0xFFFF_FFFF : UInt32(c.usize))
            h.le16(UInt16(c.name.count)); h.le16(big ? 28 : 0); h.le16(0); h.le16(0); h.le16(0); h.le32(c.attr)
            h.le32(big ? 0xFFFF_FFFF : UInt32(c.offset))
            h.append(c.name)
            if big { h.le16(1); h.le16(24); h.le64(c.usize); h.le64(c.csize); h.le64(c.offset) }
            write(h)
        }
        let cdSize = offset - cdStart
        let big = central.count >= 0xFFFF || cdStart >= 0xFFFF_FFFF || cdSize >= 0xFFFF_FFFF
        if big {
            let recOff = offset
            var r = Data()
            r.le32(0x06064b50); r.le64(44); r.le16(0x032D); r.le16(45); r.le32(0); r.le32(0)
            r.le64(UInt64(central.count)); r.le64(UInt64(central.count)); r.le64(cdSize); r.le64(cdStart)
            r.le32(0x07064b50); r.le32(0); r.le64(recOff); r.le32(1)
            write(r)
        }
        var e = Data()
        e.le32(0x06054b50); e.le16(0); e.le16(0)
        e.le16(big ? 0xFFFF : UInt16(central.count)); e.le16(big ? 0xFFFF : UInt16(central.count))
        e.le32(big ? 0xFFFF_FFFF : UInt32(cdSize)); e.le32(big ? 0xFFFF_FFFF : UInt32(cdStart)); e.le16(0)
        write(e)
        fh.closeFile()
    }
}

// ---- little-endian helpers

@inline(__always) func le16(_ b: [UInt8], _ i: Int) -> UInt16 { UInt16(b[i]) | UInt16(b[i + 1]) << 8 }
@inline(__always) func le32(_ b: [UInt8], _ i: Int) -> UInt32 {
    UInt32(b[i]) | UInt32(b[i + 1]) << 8 | UInt32(b[i + 2]) << 16 | UInt32(b[i + 3]) << 24
}
@inline(__always) func le64(_ b: [UInt8], _ i: Int) -> UInt64 { UInt64(le32(b, i)) | UInt64(le32(b, i + 4)) << 32 }

extension Data {
    mutating func le16(_ v: UInt16) { append(contentsOf: [UInt8(v & 0xff), UInt8(v >> 8)]) }
    mutating func le32(_ v: UInt32) { for i in 0..<4 { append(UInt8(truncatingIfNeeded: v >> (8 * UInt32(i)))) } }
    mutating func le64(_ v: UInt64) { for i in 0..<8 { append(UInt8(truncatingIfNeeded: v >> (8 * UInt64(i)))) } }
    mutating func be32(_ v: UInt32) { for i in (0..<4).reversed() { append(UInt8(truncatingIfNeeded: v >> (8 * UInt32(i)))) } }
    mutating func be64(_ v: UInt64) { for i in (0..<8).reversed() { append(UInt8(truncatingIfNeeded: v >> (8 * UInt64(i)))) } }
}
