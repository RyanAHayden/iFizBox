/* ifizbox-helper's checks, kept apart from main() so they build and are tested on Linux (test_helper.py).
 * SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef IFIZBOX_HELPER_POLICY_H
#define IFIZBOX_HELPER_POLICY_H

#include <limits.h>
#include <sys/types.h>

#define HELPER_MAX_PACKAGES 256
#define HELPER_NAME_MAX 255

/* Exit codes of the helper itself (sysexits.h values); anything else is apt's or dpkg's own. */
#define HELPER_EX_USAGE 64  /* refused: verb, package name or unknown package */
#define HELPER_EX_NOPERM 77 /* refused: caller isn't iFizBox running as root */
#define HELPER_EX_EXEC 126  /* apt-get or dpkg couldn't be run */
#define HELPER_EX_IOERR 74  /* F33: ifizbox.sources couldn't be read or written */

enum helper_verb { HV_UPDATE, HV_INSTALL, HV_REMOVE, HV_UPGRADE, HV_CONFIGURE, HV_HOLD, HV_UNHOLD, HV_SHOWHOLD,
                   HV_ADDSOURCE, HV_REMOVESOURCE, HV_SIMULATE, HV_APPLY, HV_RESPRING, HV_INSTALL_IPA,
                   HV_ROLLBACKS, HV_ROLLBACK, HV_APPLY_ASK, HV_INSTALL_PAID, HV_NOTIFICATIONS,
                   HV_USERSPACE_REBOOT, HV_SIMULATE_DEB, HV_INSTALL_DEB,
                   HV_APP_VERSIONS, HV_UICACHE, HV_UNINSTALL_APP, HV_UPDATE_SOURCE, HV_AUTO, HV_INSTALL_DEB_ASK };
#define HELPER_VERBS "update, install, remove, upgrade, configure, hold, unhold, showhold, addsource, removesource, " \
                     "simulate, apply, apply-ask, respring, install-ipa, rollbacks, rollback, install-paid, " \
                     "notifications, userspace-reboot, simulate-deb, install-deb, app-versions, uicache, uninstall-app, " \
                     "update-source, auto, install-deb-ask"
/* F234: auto <pkg>... is apt-mark auto: the queue run installs one package at a time (apt-get install ./file.deb or
 * name=version), which marks each one manual; the packages apt only pulled in for another get their mark back. Names
 * as hold's (installed ones only). */

/* N4: the install queue. simulate and apply take items: "name" or "name=version" installs (an exact version is how
 * Downgrade and Reinstall pick theirs), "-name" removes. apt gets "name", "name=version" and "name-" in one
 * apt-get install, so one run does the whole queue, as Cydia's does. */
/* F63: apply-ask is apply without --force-confdef/--force-confold, so dpkg asks about a conffile changed by both the
 * user and the package (Cydia's Configuration Upgrade alert). It needs the status fd (the question arrives there as
 * apt's pmconffile: line). main.c runs apt-get as a child with a pipe on its stdin and copies over only the lines
 * "Y" (accept the new copy) and "N" (keep the old one) from the helper's own stdin, so the caller can't answer
 * dpkg's D (diff) or Z (a root shell). helper_answer_ok says which lines those are. */
int helper_answer_ok(const char *line, size_t len);
/* F64: the console's Cancel on apply-ask's stdin: the line "C" (\r allowed), which the helper turns into SIGINT for
 * apt-get instead of passing it on. */
int helper_cancel_ok(const char *line, size_t len);
/* F239: install-deb-ask <path.deb> is install-deb as apply-ask is apply: no --force-confdef/--force-confold, the
 * status fd required, and the answers relayed by main.c the same way (the queue run's shell-fetched .debs, so the
 * Configuration Upgrade alert comes for them too). */
#define HELPER_VERSION_MAX 255
#define HELPER_ITEM_MAX (HELPER_NAME_MAX + 1 + HELPER_VERSION_MAX)

/* F59: install-ipa <path> takes one IPA, and only from the one directory the app downloads into (Apt.swift's
 * ipa.install): <HELPER_IPA_DIR>/<name>.ipa, name [A-Za-z0-9][A-Za-z0-9._-]*. The app is no-container, so this is
 * mobile's own Caches. Tests build with their own -DHELPER_IPA_DIR; the shipped build keeps this one. */
#ifndef HELPER_IPA_DIR
#define HELPER_IPA_DIR "/var/mobile/Library/Caches/com.ryha.ifizbox/ipa"
#endif
#define HELPER_IPA_NAME_MAX 255
/* F59: install-ipa's own refusal: no AppSync Unified and no ldid to sign ad hoc, or installd refused the ad hoc
 * signed app (the jailbreak can't run ad hoc apps without AppSync). EX_UNAVAILABLE. */
#define HELPER_EX_ADHOC 69

/* F33: the one file addsource/removesource edit, under the prefix. Nothing else in apt's sources is touched. */
#define HELPER_SOURCES_FILE "/etc/apt/sources.list.d/ifizbox.sources"
#define HELPER_URI_MAX 1024
#define HELPER_SUITE_MAX 255
#define HELPER_COMPONENT_MAX 64
#define HELPER_MAX_COMPONENTS 16

/* B329: the option every apt-get and apt-mark run gets right after the tool's name (policy.c skip_translations):
 * apt reads no Translation files, so a bad one a repo left in apt's lists can't stop every apt command. */
#define HELPER_APT_NO_TRANSLATIONS "Acquire::Languages=none"

struct helper_plan {
    enum helper_verb verb;
    char path[PATH_MAX];  /* executable to execve: <prefix>/usr/bin/apt-get, apt-mark or dpkg; for addsource and
                             removesource, the file they edit (<prefix>HELPER_SOURCES_FILE), and argv is the verb,
                             URI, suite and components as given (nothing is executed); for install-ipa, the IPA
                             (argv is the verb and the path; ipa.c does the work) */
    const char *argv[HELPER_MAX_PACKAGES + 24]; /* NULL-terminated */
    int argc;
    const char *const *packages; /* the caller's package names, inside argv (simulate/apply: inside names[]) */
    int npackages;
    /* simulate/apply: each item's package name, whether it is a removal, and apt's spelling of it */
    const char *names[HELPER_MAX_PACKAGES];
    char removing[HELPER_MAX_PACKAGES];
    char name_buf[HELPER_MAX_PACKAGES][HELPER_NAME_MAX + 1];
    char item_buf[HELPER_MAX_PACKAGES][HELPER_ITEM_MAX + 2];
    char deb[PATH_MAX]; /* F71 rollback: the stored .deb apt-get installs (also in argv) */
    /* F233a update-source: the temp sources file (a mkstemp template until helper_update_source_file makes it), the
     * "Dir::Etc::SourceList=<it>" option in argv, and the one-line "deb <uri> <suite> [component...]" it holds */
    char source_tmp[PATH_MAX];
    char source_opt[PATH_MAX + 32];
    char source_line[HELPER_URI_MAX + HELPER_SUITE_MAX + HELPER_MAX_COMPONENTS * (HELPER_COMPONENT_MAX + 1) + 16];
};

/* F233a: update-source <uri> <suite> [component...]: apt-get update for that one source, as Sources' Retry on a
 * failed row asks. The words are checked as addsource checks them (the source needn't be in ifizbox.sources).
 * main.c writes the source to a temp file (helper_update_source_file), runs
 *   apt-get -o Acquire::AllowInsecureRepositories=true -o Dir::Etc::SourceList=<temp> -o Dir::Etc::SourceParts=/dev/null
 *           -o APT::Get::List-Cleanup=0 [-o APT::Status-Fd=3] update
 * as a child (List-Cleanup off: the other sources' lists stay), waits for it and deletes the file. The temp file is
 * <prefix>HELPER_UPDATE_SOURCE_TMP with mkstemp's six characters in place of the X's. */
#define HELPER_UPDATE_SOURCE_TMP "/etc/apt/ifizbox-update-source.XXXXXX"
/* Make plan's temp sources file (mkstemp, 0600) holding its source line, and point the plan's option at it.
 * 0, or -1 + *err (errno set); on failure nothing is left behind. */
int helper_update_source_file(struct helper_plan *plan, const char **err);

/* F71: Roll Back. N7's daemon keeps .debs in <prefix>HELPER_ROLLBACK_DIR/<id>/, named as apt's archive cache
 * names them: <id>_<version>_<arch>.deb, the epoch's ':' as "%3a".
 *   rollbacks <id>            runs nothing: prints "<version> <file>" for each stored .deb of id the helper would
 *                             install (a missing folder prints nothing)
 *   rollback <id> <version>   apt-get -y (conffile options) --allow-downgrades [-o APT::Keep-Fds::=3 -o
 *                             APT::Status-Fd=3] install <the stored .deb's absolute path>
 * The folder and <id>/ must be real directories (no links) owned by root and not group/other writable, the file
 * a regular root-owned file, not group/other writable, with one link; then (main.c, before the exec)
 * helper_rollback_verify reads its control through dpkg-deb: Package must be id and Version the version asked. */
#ifndef HELPER_ROLLBACK_DIR
#define HELPER_ROLLBACK_DIR "/var/cache/ifizbox/rollback"
#endif
#define HELPER_ROLLBACK_MAX 64 /* stored .debs listed per package, at most */
/* The version in a stored .deb's name for id ("%3a" back to ':'), into ver; 1, or 0 when the name isn't
 * <id>_<version>_<arch>.deb with a version helper_version_ok takes and an arch of [a-z0-9-]. */
int helper_deb_name_version(const char *file, const char *id, char *ver, size_t size);
/* The stored .deb of id at version under dir (<prefix>HELPER_ROLLBACK_DIR), checked as above (root_uid owns it),
 * as an absolute path into out. 0, or -1 + *err. */
int helper_rollback_file(const char *dir, const char *id, const char *version, uid_t root_uid, char *out, size_t size,
                         const char **err);
/* Every stored .deb of id under dir that helper_rollback_file would take, "<version> <file>\n" each, into out.
 * Returns how many (0 for a missing folder), or -1 + *err (bad id, or a folder that fails the checks). */
int helper_rollback_list(const char *dir, const char *id, uid_t root_uid, char *out, size_t size, const char **err);
/* 1 if dpkg-deb's "Package: ...\nVersion: ...\n" output names exactly id and version. */
int helper_control_matches(const char *text, const char *id, const char *version);
/* Run <prefix>/usr/bin/dpkg-deb -f <deb> Package Version (stdin /dev/null, stderr dropped, an environment of our
 * own) and check it with helper_control_matches. 0, or -1 + *err. */
int helper_rollback_verify(const char *prefix, const char *deb, const char *id, const char *version, const char **err);

/* F57: install-paid <path> <id> <version>: a paid package's .deb, downloaded by the app from the vendor's one-time
 * authorize_download URL (Paid.swift paid.install). Only from <HELPER_PAID_DIR>/<name>.deb, name
 * [A-Za-z0-9][A-Za-z0-9._-]* (mobile's own Caches: the app is no-container). paid.c copies it into a root-owned work
 * directory, checks its control through dpkg-deb (Package must be id, Version the version asked, as rollback does),
 * then runs apt-get -y (conffile options) [-o APT::Keep-Fds::=3 -o APT::Status-Fd=3] install <the copy>, so apt
 * pulls in its dependencies. Tests build with their own -DHELPER_PAID_DIR. */
#ifndef HELPER_PAID_DIR
#define HELPER_PAID_DIR "/var/mobile/Library/Caches/com.ryha.ifizbox/paid"
#endif
/* 1 if path is <dir>/<name> with name [A-Za-z0-9][A-Za-z0-9._-]* ending in ".deb", at most HELPER_IPA_NAME_MAX
 * bytes, no "..". */
int helper_paid_path_ok(const char *dir, const char *path);

/* N9: simulate-deb <path> | install-deb <path>: a .deb another app handed iFizBox (Open in iFizBox, the share sheet),
 * which the app copied into <HELPER_DEB_DIR>/<name>.deb (name as helper_paid_path_ok). paid.c copies it into a
 * root-owned work directory as install-paid does, then runs apt-get on the copy, so apt resolves its dependencies
 * from the sources (`apt install ./file.deb`):
 *   simulate-deb  apt-get -s --reinstall --allow-downgrades install <copy>       (the Confirm sheet's plan)
 *   install-deb   apt-get -y (conffile options) --reinstall --allow-downgrades [-o APT::Keep-Fds::=3 -o
 *                 APT::Status-Fd=3] install <copy>, CYDIA=3 1 as for apply           (the console)
 * No control check: any .deb is accepted; the caller check is the boundary. Tests build with
 * their own -DHELPER_DEB_DIR. */
#ifndef HELPER_DEB_DIR
#define HELPER_DEB_DIR "/var/mobile/Library/Caches/com.ryha.ifizbox/deb"
#endif

/* I4: app-versions (no arguments) runs nothing: ipa.c helper_app_versions lists the version of every app installd
 * put in HELPER_APPS_DIR, for the jailbreak app's Installed apps (the real version, not the one iFizBox remembers).
 * path is the folder, argv the verb. Tests build with their own -DHELPER_APPS_DIR. */
#ifndef HELPER_APPS_DIR
#define HELPER_APPS_DIR "/var/containers/Bundle/Application"
#endif

/* B46: uninstall-app <bundle id> runs nothing: ipa.c helper_uninstall_app finds the app among installd's containers
 * (HELPER_APPS_DIR, so only apps the user installed: never a system app, nor iFizBox or anything else in the
 * jailbreak's /Applications) and asks installd to uninstall it (LSApplicationWorkspace uninstallApplication:
 * withOptions:). path is the folder, argv the verb and the id (helper_ipa_bundle_id_ok). */

/* 1 if s is a package name the helper passes on: [a-z0-9][a-z0-9.+-]+, at most HELPER_NAME_MAX bytes. */
int helper_name_ok(const char *s);

/* N4: 1 if s is a Debian version apt can be asked for: a digit first, then [A-Za-z0-9.+~:-], at most
 * HELPER_VERSION_MAX bytes (an epoch "1:2.0" included). */
int helper_version_ok(const char *s);

/* Turn the caller's words (argv[0] is the verb: one of HELPER_VERBS) into the one command the helper may run.
 * status_fd >= 0 adds apt-get's/dpkg's status-fd option on it (apt-mark gets none). Returns 0, or -1 with *err set. */
int helper_plan(int argc, char *const argv[], const char *prefix, int status_fd, struct helper_plan *plan,
                const char **err);

/* F59: 1 if path is <dir>/<name> with name [A-Za-z0-9][A-Za-z0-9._-]* ending in ".ipa", at most
 * HELPER_IPA_NAME_MAX bytes: no other directory, no "..", no hidden file. */
int helper_ipa_path_ok(const char *dir, const char *path);

/* F33: 1 if s is a URI addsource writes: http:// or https:// (lower case), a host of [A-Za-z0-9.-] with an
 * optional :port, then a path that starts and ends with "/" of [A-Za-z0-9._~%+/:=,-] with no "." or ".." segment.
 * No user:password (the file is world-readable), whitespace, "#", quotes or brackets; at most HELPER_URI_MAX bytes. */
int helper_uri_ok(const char *s);
/* 1 if s is a suite: a flat path ending in "/" ("./", "sub/") or a distribution name. [A-Za-z0-9._+/-], not
 * starting with "-" or "/", no ".." segment, at most HELPER_SUITE_MAX bytes. */
int helper_suite_ok(const char *s);
/* 1 if s is a component: [A-Za-z0-9][A-Za-z0-9._+/-]*, no ".." and not ending in "/", at most HELPER_COMPONENT_MAX. */
int helper_component_ok(const char *s);

/* F33: do an addsource or removesource plan on <prefix>HELPER_SOURCES_FILE: read it (a missing file is empty),
 * drop every stanza naming exactly this URI and suite, append the new one (addsource), and write the result to a
 * temp file in the same directory, renamed over the old one (mode 0644). *changed says whether anything changed
 * (an add of a source that is there as is, or a remove of one that isn't, leaves the file alone). 0, or -1 + *err. */
int helper_sources_apply(const struct helper_plan *plan, int *changed, const char **err);

/* F65: notifications on|off, the app's Upgrade Notifications switch for N5's daemon (native/daemon/main.m reads
 * the file). off creates <prefix>HELPER_NOTIFY_OFF (an empty file, 0644; its folder made 0755 if missing), on
 * deletes it. Nothing is executed: path is the file, argv the verb and on/off. A symlink or anything but a regular
 * file at the path is refused, never followed. 0, or -1 + *err (main.c exits HELPER_EX_IOERR). */
#define HELPER_NOTIFY_OFF "/var/lib/ifizbox/upgrades.off"
int helper_notify_apply(const struct helper_plan *plan, const char **err);

/* Every package of an install (and every install item of simulate/apply) must be named "Package: <name>" in dpkg's status or one of apt's *_Packages lists;
 * of a remove, hold or unhold (and a "-name" item), in dpkg's status. That keeps apt from reading a name it doesn't know as a regex or a modifier
 * ("foo-" removes, "foo+" installs). Returns the index of the first unknown package, or -1 when all are known. */
int helper_first_unknown(const char *prefix, const struct helper_plan *plan);

/* The defence-in-depth caller check (the kernel's persona-mgmt entitlement check is the real one): real and
 * effective uid are root_uid, and parent_exe is the same file (device + inode) as expected_exe. 0 or -1 + *err. */
int helper_caller_ok(uid_t uid, uid_t euid, uid_t root_uid, const char *parent_exe, const char *expected_exe,
                     const char **err);

#endif
