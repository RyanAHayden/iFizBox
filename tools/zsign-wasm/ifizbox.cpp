// What the website's signing worker (web/app/websign-stream.js) calls in zsign's module besides main(): a plist (binary
// or XML) as JSON, and the pieces that keep the app out of memory (F265): an inflater, a deflater, CRC-32 and SHA-256
// fed 64 KB at a time through fixed buffers, and the one buffer zsign maps executables into. Built by
// tools/build-zsign-wasm.sh.
#include <emscripten.h>
#include <openssl/sha.h>
#include "third-party/zlib/zlib.h"
#include "common.h"
#include "json.h"

namespace {

const uint32_t kBuf = 64 * 1024;
uint8_t s_buf[4][kBuf]; // inflate in, inflate out, deflate in, deflate out

// zlib's memory, fixed: the calls come while emscripten holds a view of the heap (a file read or write), which growing
// the heap would detach.
template <size_t N> struct Pool {
	alignas(16) uint8_t data[N];
	size_t used;
	static voidpf Alloc(voidpf self, uInt items, uInt size)
	{
		Pool* p = (Pool*)self;
		size_t n = ((size_t)items * size + 15) & ~(size_t)15;
		if (p->used + n > N) return Z_NULL;
		void* at = p->data + p->used;
		p->used += n;
		return at;
	}
	static void Free(voidpf, voidpf) {}
};
Pool<64 * 1024> s_inPool;
Pool<320 * 1024> s_outPool;
z_stream s_in;
z_stream s_out;
SHA256_CTX s_sha;
uint8_t s_digest[32];

}

extern "C" {

// The plist at `path` as JSON text, or "" when it doesn't read. The buffer lives until the next call.
EMSCRIPTEN_KEEPALIVE const char* ifizbox_plist_json(const char* path)
{
	static string out;
	out.clear();
	jvalue v;
	if (!v.read_plist_from_file("%s", path)) return "";
	v.write(out);
	return out.c_str();
}

// The fixed buffers: 0 inflate in, 1 inflate out, 2 deflate in, 3 deflate out (64 KB each).
EMSCRIPTEN_KEEPALIVE uint8_t* ifizbox_buffer(int which) { return s_buf[which]; }

// Memory for the biggest file zsign maps, in one piece and before it needs any: 1, or 0 when there isn't enough.
EMSCRIPTEN_KEEPALIVE int ifizbox_reserve(uint32_t size) { return ZFile::ReserveMap(size) ? 1 : 0; }

EMSCRIPTEN_KEEPALIVE int ifizbox_inflate_start()
{
	memset(&s_in, 0, sizeof(s_in));
	s_inPool.used = 0;
	s_in.zalloc = s_inPool.Alloc;
	s_in.zfree = s_inPool.Free;
	s_in.opaque = &s_inPool;
	return inflateInit2(&s_in, -MAX_WBITS);
}
// `len` new bytes in buffer 0 (0: go on with what's there) -> how many came out in buffer 1; -1 damaged, -2 at its end.
EMSCRIPTEN_KEEPALIVE int ifizbox_inflate(uint32_t len, uint32_t want)
{
	if (len > 0) {
		s_in.next_in = s_buf[0];
		s_in.avail_in = len;
	}
	s_in.next_out = s_buf[1];
	s_in.avail_out = want < kBuf ? want : kBuf;
	int rc = inflate(&s_in, Z_NO_FLUSH);
	int got = (int)(s_in.next_out - s_buf[1]);
	if (Z_OK != rc && Z_STREAM_END != rc && Z_BUF_ERROR != rc) return -1;
	return 0 == got && Z_STREAM_END == rc ? -2 : got;
}
EMSCRIPTEN_KEEPALIVE uint32_t ifizbox_inflate_left() { return s_in.avail_in; }

EMSCRIPTEN_KEEPALIVE int ifizbox_deflate_start()
{
	memset(&s_out, 0, sizeof(s_out));
	s_outPool.used = 0;
	s_out.zalloc = s_outPool.Alloc;
	s_out.zfree = s_outPool.Free;
	s_out.opaque = &s_outPool;
	// level 1: level 6 took most of the time for a 40 MB app in WebAssembly on a phone (user 2026-11-18)
	return deflateInit2(&s_out, 1, Z_DEFLATED, -MAX_WBITS, 8, Z_DEFAULT_STRATEGY);
}
// `len` new bytes in buffer 2 (0: the rest of the last call's) -> how many came out in buffer 3; call again with 0 while
// it fills the buffer. flush ends what's written so far on a whole byte, not the stream: more can follow.
EMSCRIPTEN_KEEPALIVE int ifizbox_deflate(uint32_t len, int flush)
{
	if (len > 0) {
		s_out.next_in = s_buf[2];
		s_out.avail_in = len;
	}
	s_out.next_out = s_buf[3];
	s_out.avail_out = kBuf;
	int rc = deflate(&s_out, flush ? Z_SYNC_FLUSH : Z_NO_FLUSH);
	if (Z_OK != rc && Z_BUF_ERROR != rc) return -1;
	return (int)(s_out.next_out - s_buf[3]);
}

// CRC-32 of `len` bytes of a buffer, going on from `crc`.
EMSCRIPTEN_KEEPALIVE uint32_t ifizbox_crc(uint32_t crc, int which, uint32_t len) { return (uint32_t)crc32(crc, s_buf[which], len); }

EMSCRIPTEN_KEEPALIVE void ifizbox_sha256_start() { SHA256_Init(&s_sha); }
EMSCRIPTEN_KEEPALIVE void ifizbox_sha256_add(uint32_t len) { SHA256_Update(&s_sha, s_buf[0], len); }
EMSCRIPTEN_KEEPALIVE uint8_t* ifizbox_sha256_end()
{
	SHA256_Final(s_digest, &s_sha);
	return s_digest;
}

}
