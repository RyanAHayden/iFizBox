#!/usr/bin/env bash
# zsign as WebAssembly for the website's in-browser signing (F93): web/app/vendor/zsign/zsign.js + zsign.wasm.
#
#   tools/build-zsign-wasm.sh            build into web/app/vendor/zsign/ (needs emcc: emsdk activated, or ~/emsdk)
#   tools/build-zsign-wasm.sh --probe    exit 0 when emcc is there, else print why and exit 1
#   tools/build-zsign-wasm.sh --out DIR  build into DIR instead (tools/check.sh builds into a temp dir and compares)
# Exit 3: a source couldn't be downloaded (no network, and not in the cache): the gate skips then.
#
# zsign is github.com/zhlynn/zsign at the commit (and tarball hash) the old signer's Dockerfile pinned; OpenSSL is the
# 3.5 LTS release below, built static for wasm32 (no asm, no threads, no sockets in use: zsign's OCSP check -C is
# never called), with the legacy provider built in (no-module) so older .p12 files (RC2) still open. Both sources are
# downloaded, checked against their SHA-256 and built in a temp dir; the cache (~/.cache/ifizbox-zsign-wasm) keeps the
# OpenSSL build between runs. vendor/zsign/SOURCE records what was built; the licences sit beside it.
set -euo pipefail
cd "$(dirname "$0")/.."

ZSIGN_COMMIT=9299685bab7ef99827e06e5dfda93af747386590
ZSIGN_SHA256=97bcc2dbbc0dc5f092dc4a33cbe1f9fdbd5c83bdc291da23db45044d4396270e
OPENSSL_VERSION=3.5.9
OPENSSL_SHA256=603f5602e2eef00d77fbd429d34dcd5822bb301757a1bc9cdb24c670f1eb859a

OUT=web/app/vendor/zsign
PROBE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --probe) PROBE=1 ;;
    --out) OUT=$2; shift ;;
    *) echo "usage: $0 [--probe] [--out DIR]" >&2; exit 2 ;;
  esac
  shift
done

if ! command -v emcc >/dev/null 2>&1; then
  for env in "${EMSDK:-}/emsdk_env.sh" "$HOME/emsdk/emsdk_env.sh"; do
    if [ -f "$env" ]; then
      # shellcheck disable=SC1090
      EMSDK_QUIET=1 source "$env" >/dev/null 2>&1 || true
      break
    fi
  done
fi
if ! command -v emcc >/dev/null 2>&1; then
  echo "no emcc (install emsdk: https://emscripten.org/docs/getting_started/downloads.html)"
  exit 1
fi
[ "$PROBE" = 1 ] && exit 0

EMCC_VERSION=$(emcc --version | head -n1)
CACHE=${XDG_CACHE_HOME:-$HOME/.cache}/ifizbox-zsign-wasm
mkdir -p "$CACHE"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

fetch() { # url sha256 dest
  if [ ! -f "$3" ] || ! echo "$2  $3" | sha256sum -c --status -; then
    curl -fsSL --max-time 300 -o "$3.$$.part" "$1" || { rm -f "$3.$$.part"; echo "download failed: $1"; exit 3; }
    echo "$2  $3.$$.part" | sha256sum -c --status - || { rm -f "$3.$$.part"; echo "SHA-256 mismatch: $1" >&2; exit 1; }
    mv "$3.$$.part" "$3"
  fi
}

# ---- OpenSSL (cached by version and emcc) -------------------------------------------------------------------------
# Reproducible: OpenSSL compiles its prefix and build date in, so the prefix is a fixed /openssl (installed under
# the cache with DESTDIR) and the date SOURCE_DATE_EPOCH; it compiles with relative paths (zsign maps its away).
export SOURCE_DATE_EPOCH=1794960000 # 2026-11-18
SSL_DEST=$CACHE/openssl-$OPENSSL_VERSION-$(echo "$EMCC_VERSION" | sha256sum | cut -c1-12)
SSL_PREFIX=$SSL_DEST/openssl
# One OpenSSL build at a time (gates run side by side in other worktrees); the others wait for it, then use it.
exec 9>"$CACHE/openssl.lock"
command -v flock >/dev/null && flock 9
if [ ! -f "$SSL_PREFIX/lib/libcrypto.a" ]; then
  rm -rf "$SSL_DEST"
  fetch "https://github.com/openssl/openssl/releases/download/openssl-$OPENSSL_VERSION/openssl-$OPENSSL_VERSION.tar.gz" \
    "$OPENSSL_SHA256" "$CACHE/openssl-$OPENSSL_VERSION.tar.gz"
  tar xzf "$CACHE/openssl-$OPENSSL_VERSION.tar.gz" -C "$WORK"
  (
    cd "$WORK/openssl-$OPENSSL_VERSION"
    # CROSS_COMPILE empty: emconfigure already points CC/AR/RANLIB at emscripten's tools.
    emconfigure ./Configure linux-generic32 --prefix=/openssl --openssldir=/openssl/ssl --libdir=lib \
      no-asm no-threads no-shared no-dso no-module no-engine no-async no-sock no-ui-console no-tests no-apps \
      no-docs -DOPENSSL_NO_SECURE_MEMORY CROSS_COMPILE= >"$WORK/openssl-config.log" 2>&1 ||
      { tail -n 30 "$WORK/openssl-config.log"; exit 1; }
    emmake make -j"$(nproc)" build_libs >"$WORK/openssl-build.log" 2>&1 || { tail -n 30 "$WORK/openssl-build.log"; exit 1; }
    emmake make install_dev DESTDIR="$SSL_DEST" >"$WORK/openssl-install.log" 2>&1 || { tail -n 30 "$WORK/openssl-install.log"; exit 1; }
  )
fi
exec 9>&-

# ---- zsign -------------------------------------------------------------------------------------------------------
fetch "https://github.com/zhlynn/zsign/archive/$ZSIGN_COMMIT.tar.gz" "$ZSIGN_SHA256" "$CACHE/zsign-$ZSIGN_COMMIT.tar.gz"
tar xzf "$CACHE/zsign-$ZSIGN_COMMIT.tar.gz" -C "$WORK"
SRC=$WORK/zsign-$ZSIGN_COMMIT/src
# Patches for the WebAssembly build (tools/zsign-wasm/*.patch, in name order): skip-missing-exe seals a nested bundle
# without its executable as files; stream-files hashes files in pieces and maps executables into one reserved buffer (F265).
for p in tools/zsign-wasm/*.patch; do patch -s -d "$WORK/zsign-$ZSIGN_COMMIT" -p1 <"$p"; done
OBJ=$WORK/obj
mkdir -p "$OBJ"
CFLAGS=(-O2 -Wno-unused-result -Wno-deprecated-declarations -ffile-prefix-map="$WORK"=/src -ffile-prefix-map="$PWD"=/ifizbox)
INC=(-I"$SRC" -I"$SRC/common" -I"$SRC/third-party/zlib" -I"$SSL_PREFIX/include")
objs=()
for f in "$SRC"/third-party/zlib/*.c "$SRC"/third-party/minizip/{ioapi,zip,unzip}.c; do
  o=$OBJ/$(basename "$(dirname "$f")")-$(basename "$f" .c).o
  emcc "${CFLAGS[@]}" "${INC[@]}" -c "$f" -o "$o"
  objs+=("$o")
done
for f in "$SRC"/*.cpp "$SRC"/common/*.cpp tools/zsign-wasm/ifizbox.cpp; do
  o=$OBJ/$(basename "$(dirname "$f")")-$(basename "$f" .cpp).o
  em++ -std=c++11 "${CFLAGS[@]}" "${INC[@]}" -DZSIGN_VERSION="${ZSIGN_COMMIT:0:7}-wasm" -c "$f" -o "$o"
  objs+=("$o")
done

EXPORTS=(_main _ifizbox_{plist_json,buffer,reserve,inflate_start,inflate,inflate_left,deflate_start,deflate,crc}
  _ifizbox_sha256_{start,add,end})
mkdir -p "$OUT"
# One module per signing job (signing-worker.js makes a fresh one each time: main() keeps globals), files in MEMFS,
# memory that grows up to what the browser allows. ES module so a module Web Worker imports it.
em++ "${objs[@]}" "$SSL_PREFIX/lib/libcrypto.a" -o "$OUT/zsign.js" \
  -O2 -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createZsign -sENVIRONMENT=worker,node \
  -sINVOKE_RUN=0 -sEXIT_RUNTIME=1 -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4GB -sSTACK_SIZE=4MB \
  -sFORCE_FILESYSTEM=1 -sEXPORTED_RUNTIME_METHODS=callMain,FS,ccall,HEAPU8 -sNO_DISABLE_EXCEPTION_CATCHING \
  -sEXPORTED_FUNCTIONS="$(IFS=,; echo "${EXPORTS[*]}")"

chmod 644 "$OUT/zsign.wasm" "$OUT/zsign.js"
cp "$WORK/zsign-$ZSIGN_COMMIT/LICENSE" "$OUT/LICENSE.zsign"
tar xzf "$CACHE/openssl-$OPENSSL_VERSION.tar.gz" -C "$WORK" "openssl-$OPENSSL_VERSION/LICENSE.txt" 2>/dev/null &&
  cp "$WORK/openssl-$OPENSSL_VERSION/LICENSE.txt" "$OUT/LICENSE.openssl" || true
sed -n '/Copyright/,/jloup/p' "$SRC/third-party/zlib/zlib.h" | head -n 25 >"$OUT/LICENSE.zlib"
cat >"$OUT/SOURCE" <<EOF
zsign (MIT, LICENSE.zsign)   https://github.com/zhlynn/zsign  commit $ZSIGN_COMMIT  tarball sha256 $ZSIGN_SHA256
OpenSSL (Apache-2.0, LICENSE.openssl)  $OPENSSL_VERSION  sha256 $OPENSSL_SHA256
zlib + minizip (zlib licence, LICENSE.zlib)  as vendored in zsign's src/third-party
Built by tools/build-zsign-wasm.sh with $EMCC_VERSION
EOF
echo "built $OUT/zsign.js ($(wc -c <"$OUT/zsign.js") B) and zsign.wasm ($(wc -c <"$OUT/zsign.wasm") B)"
