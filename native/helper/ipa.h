/* F59: install-ipa's work (ipa.c), kept apart from main() so the parts that aren't installd build and are tested on
 * Linux (test_helper.py). SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef IFIZBOX_HELPER_IPA_H
#define IFIZBOX_HELPER_IPA_H

#include <stddef.h>
#include <stdio.h>

/* Where install-ipa makes its root-owned work directory (ifizbox-ipa.XXXXXX, removed at the end). Tests build with
 * their own -DHELPER_IPA_WORK. */
#ifndef HELPER_IPA_WORK
#define HELPER_IPA_WORK "/var/tmp"
#endif

/* Install the IPA at ipa (already checked by helper_plan: HELPER_IPA_DIR/<name>.ipa). Children (unzip, ldid) get
 * env. fd3 >= 0 gets pmstatus lines. Returns 0, or an exit code (HELPER_EX_USAGE: not an IPA or not the app's
 * file; HELPER_EX_IOERR: couldn't copy or unpack; HELPER_EX_ADHOC: can't install ad hoc; 1: installd refused it)
 * with *err set. */
int helper_install_ipa(const char *prefix, const char *ipa, int fd3, char *const env[], const char **err);

/* 1 if AppSync Unified's installd tweak is in the prefix (ElleKit's or Substrate's tweak directory). */
int helper_ipa_appsync(const char *prefix);

/* 1 if s is a bundle identifier the helper passes to installd: [A-Za-z0-9.-], not starting with "." or "-", at
 * most 255 bytes. */
int helper_ipa_bundle_id_ok(const char *s);

/* CFBundleIdentifier of an Info.plist (data, len) into out; 0, or -1 when it's missing or not a good id. iOS reads
 * any plist format, other systems the XML one only. */
int helper_ipa_plist_id(const char *data, size_t len, char *out, size_t size);

/* B400: a zip's central directory (fd): 0 with the bytes everything in it unpacks to and whether every entry was made
 * on Unix or macOS; -1 (and 0, 0) when it can't be read (not a zip, zip64). */
int helper_ipa_zip(int fd, long long *total, int *on_unix);

/* B59: 1 if s is a team id the fakesign reuses (10 of [A-Z0-9]); 1 if s is a CFBundleExecutable the helper signs
 * (a plain name: no "/", not "." or "..", helper_app_value_ok). */
int helper_ipa_team_ok(const char *s);
int helper_ipa_exe_ok(const char *s);

/* B72: compare two iOS versions ("15.8.8", "17.0"; at most 3 numeric parts): -1, 0 or 1 like strcmp, or 2 when either
 * isn't a version. install-ipa refuses an app whose MinimumOSVersion is above this iPhone's ProductVersion
 * (SystemVersion.plist) before installd sees it, saying both. */
int helper_ipa_os_cmp(const char *a, const char *b);

/* B72: installd's localizedDescription made one console line in place: newlines become spaces and its staging paths
 * ("/var/installd/Library/Caches/com.apple.mobile.installd.staging/temp.X/extracted/") are cut down to what follows. */
void helper_ipa_why_clean(char *s);

/* I4: app-versions. Every app installd put under dir (HELPER_APPS_DIR: <dir>/<UUID>/<Name>.app, plus App Store
 * apps' <dir>/<UUID>/iTunesMetadata.plist) as one line each, "<id>\t<short>\t<build>\t<store>\n": the bundle id
 * (helper_ipa_bundle_id_ok), Info.plist's CFBundleShortVersionString and CFBundleVersion, and iTunesMetadata's
 * bundleShortVersionString; a missing or odd value (helper_app_value_ok) is an empty field. Folders and files are
 * taken only as real directories and regular files (lstat, O_NOFOLLOW), at most HELPER_APPS_MAX apps, in readdir's
 * order. Returns how many lines went to out, 0 for a missing dir, or -1 + *err. */
#define HELPER_APPS_MAX 4096
int helper_app_versions(const char *dir, FILE *out, const char **err);
/* The string under key in a plist (data, len) into out; 0, or -1 when it's missing, not a string or too long. iOS
 * reads any plist format, other systems the XML one only (enough for the tests' fake container tree). */
int helper_plist_string(const char *data, size_t len, const char *key, char *out, size_t size);
/* 1 if s is a value app-versions prints: 1-255 bytes, no control characters (so no tab or newline). */
int helper_app_value_ok(const char *s);

/* B46: the container under dir (HELPER_APPS_DIR) whose one .app has CFBundleIdentifier id, read as app-versions reads
 * them, into box; 0, 1 when no app there has that id, or -1 + *err when dir can't be read. */
int helper_app_find(const char *dir, const char *id, char *box, size_t size, const char **err);
/* B46: uninstall-app. The app must be in dir (helper_app_find: only apps installd put in the containers, never a
 * system app or one in the jailbreak's /Applications); then installd uninstalls it (LSApplicationWorkspace
 * uninstallApplication:withOptions:; off iOS a stand-in prints "uninstall <id>", and an id ending in ".refused"
 * fails). fd3 >= 0 gets pmstatus:<id>:<percent>:<text> lines. Returns 0 ("Uninstalled <id>" on stdout), or an exit
 * code with *err: HELPER_EX_USAGE not an installed app, HELPER_EX_IOERR dir unreadable, 1 installd refused. */
int helper_uninstall_app(const char *dir, const char *id, int fd3, const char **err);

#endif
