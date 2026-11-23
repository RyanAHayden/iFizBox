/* F374: Installed Apps (decrypt.c). The phone's App Store and user apps, and a decrypted copy of one.
 *
 *   ifizbox-helper user-apps            one line per app installd put in HELPER_APPS_DIR (helper_user_apps)
 *   ifizbox-helper decrypt-app <id>     the app's encrypted Mach-O files, decrypted, under HELPER_DECRYPT_DIR/<id>/
 *                                       (helper_decrypt_app); the app zips them with the rest into an IPA
 *
 * Kept apart from main() and policy.c so the Mach-O reading and the tree walk build and are tested on Linux
 * (test_decrypt.py); only the decryption itself (mremap_encrypted) is iOS's. SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef IFIZBOX_HELPER_DECRYPT_H
#define IFIZBOX_HELPER_DECRYPT_H

#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <sys/types.h>

/* Where decrypt-app puts its files: the app's own Caches (it is no-container, so mobile's), beside install-ipa's
 * HELPER_IPA_DIR. The folder must exist, be a real directory and not be root's; what the helper writes there is
 * given to the folder's owner. Tests build with their own -DHELPER_DECRYPT_DIR. */
#ifndef HELPER_DECRYPT_DIR
#define HELPER_DECRYPT_DIR "/var/mobile/Library/Caches/com.ryha.ifizbox/decrypt"
#endif

#define HELPER_CRYPT_MAX 8 /* slices of one Mach-O looked at */

/* One slice's LC_ENCRYPTION_INFO(_64): where the slice starts in the file, its CPU, the encrypted range (from the
 * slice's start), the cryptid and the file offset of the cryptid field (patched to 0 once decrypted). */
struct helper_crypt {
    uint64_t slice_off, slice_size, cryptid_at;
    uint32_t cputype, cpusubtype, cryptoff, cryptsize, cryptid;
};

/* The encryption info of every slice of the Mach-O in fd (size bytes), read with pread: a thin 32/64-bit Mach-O or a
 * fat one (FAT_MAGIC / FAT_MAGIC_64). Returns how many slices carry one (0: a Mach-O without; cryptid 0 or not), or -1
 * when fd isn't a Mach-O (or a broken one: a command past the header's end, an encrypted range past the slice). */
int helper_macho_crypt(int fd, uint64_t size, struct helper_crypt *out, int max);

/* 1 when one of the n slices is still encrypted (cryptid != 0). */
int helper_crypt_encrypted(const struct helper_crypt *c, int n);

/* user-apps: every app under dir (HELPER_APPS_DIR: <dir>/<UUID>/<Name>.app) as one line,
 * "<id>\t<name>\t<version>\t<build>\t<app path>\t<encrypted>\t<store>\n": CFBundleIdentifier, the name on the Home
 * Screen (CFBundleDisplayName, else CFBundleName, else the folder's name without .app), CFBundleShortVersionString,
 * CFBundleVersion, the .app's path, "1" when the main executable (CFBundleExecutable) is still encrypted, "0" when not
 * and "" when it can't be read, and "1" for an App Store app (iTunesMetadata.plist in the container) else "0". Values
 * as app-versions prints them (helper_app_value_ok, else empty). Returns the count, 0 for a missing dir, -1 + *err. */
int helper_user_apps(const char *dir, FILE *out, const char **err);

/* decrypt-app: the app with CFBundleIdentifier id under apps (helper_app_find), every Mach-O in its .app (frameworks,
 * plug-ins and extensions too) that is still encrypted written decrypted, cryptid 0, at drop/<id>/<its path in the
 * .app>, owned by drop's owner. drop/<id> must not exist yet (the app removes an earlier one). Lines on out:
 * "App: <.app path>" first, then "Decrypted <path> (<n> KB)" per file, "Still encrypted <path>: <why>" for one
 * FairPlay refused (it isn't written: the original stays), then "Decrypted <n> of <m> Mach-O files[, <k> still
 * encrypted]"; fd3 >= 0 gets pmstatus:<id>:<percent>:<text>. Returns 0, or an exit code with *err: HELPER_EX_USAGE
 * not an installed app (or a bad id), HELPER_EX_IOERR the folders can't be read or written, 1 the main executable
 * (CFBundleExecutable) couldn't be decrypted (*err says why). */
int helper_decrypt_app(const char *apps, const char *drop, const char *id, int fd3, FILE *out, const char **err);

/* The decryption of one slice's encrypted range of fd, written over the same range of outfd (a copy of the file):
 * on iOS mremap_encrypted over a private mapping of the file, as the kernel decrypts a FairPlay binary it loads. Off
 * iOS (the tests) a stand-in: every byte inverted, and cryptid 99 fails with EPERM. 0, or -1 with errno. */
int helper_decrypt_range(int fd, const struct helper_crypt *c, int outfd);

#endif
