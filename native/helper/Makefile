# ifizbox-helper (docs/native.md, "3. Root"; README.md here).
#   make host   build/host/: the helper and test_driver for this machine (test_helper.py builds its own copies)
#   make ios    build/ios/ifizbox-helper: arm64, iOS 15+, ad hoc signed; needs IOS_SDK and ld64.lld like ../build.sh
.PHONY: host ios clean
CFLAGS ?= -O2
WARN = -std=c11 -Wall -Wextra -Werror
HOST_DEFS = -D_DEFAULT_SOURCE
LD64_LLD ?= $(shell p=$$(rustc --print sysroot 2>/dev/null)/lib/rustlib/x86_64-unknown-linux-gnu/bin/gcc-ld/ld64.lld; \
	[ -x "$$p" ] && echo "$$p" || command -v ld64.lld)

host:
	mkdir -p build/host
	$(CC) $(WARN) $(HOST_DEFS) $(CFLAGS) -o build/host/ifizbox-helper main.c policy.c ipa.c paid.c decrypt.c
	$(CC) $(WARN) $(HOST_DEFS) $(CFLAGS) -o build/host/test_driver test_driver.c policy.c spawn.c ipa.c paid.c

ios:
	@[ -n "$(IOS_SDK)" ] || { echo "set IOS_SDK"; exit 3; }
	mkdir -p build/ios
	clang -target arm64-apple-ios15.0 -isysroot "$(IOS_SDK)" $(WARN) $(CFLAGS) -fuse-ld=lld --ld-path="$(LD64_LLD)" \
		-Wl,-adhoc_codesign -o build/ios/ifizbox-helper main.c policy.c ipa.c paid.c decrypt.c \
		-framework CoreFoundation -lobjc
	clang -target arm64-apple-ios15.0 -isysroot "$(IOS_SDK)" $(WARN) $(CFLAGS) -c spawn.c -o build/ios/spawn.o

clean:
	rm -rf build
