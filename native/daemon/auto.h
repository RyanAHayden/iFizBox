/* ifizbox-upgrades' automatic updates (N7), following the F13 settings: when to check, what installs and when,
 * what a respring needs, and which cached .debs are kept for rollback. Plain C beside upgrades.c, so the decisions
 * build and are tested on Linux (test_auto.py through auto_driver.c, with a fake clock and fake phone state); main.m
 * only gathers the facts (settings, time, network, charging, lock, apt's output) and acts on the answers.
 * SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef IFIZBOX_AUTO_H
#define IFIZBOX_AUTO_H

#include <stddef.h>

#include "upgrades.h"

/* Check for Updates (F13 checkUpdates). OFF and LAUNCH: the daemon checks nothing on its own (LAUNCH is the app's
 * check when it opens); 6H and DAILY: launchd starts us every hour and a check runs when the last is old enough. */
enum { AUTO_CHECK_OFF, AUTO_CHECK_LAUNCH, AUTO_CHECK_6H, AUTO_CHECK_DAILY };
/* Install Updates Automatically (autoInstall). */
enum { AUTO_INSTALL_OFF, AUTO_INSTALL_MARKED, AUTO_INSTALL_ALL };
/* After a Respring Update (respring). */
enum { AUTO_RESPRING_NOTIFY, AUTO_RESPRING_LOCKED };
/* The network now. */
enum { AUTO_NET_NONE, AUTO_NET_WIFI, AUTO_NET_CELL };

#define AUTO_INTERVAL_6H (5 * 3600) /* as UPD_INTERVAL: an hourly start, so at most 6 hours apart */
#define AUTO_KEEP_MAX 2

struct auto_settings {
    int check;    /* AUTO_CHECK_*; DAILY when the setting is missing (N5's daily check, before the app mirrors it) */
    int cellular; /* Use Cellular Data: 1 (F13's default) */
    int install;  /* AUTO_INSTALL_*: OFF */
    int idle;     /* Only When Charging and Locked: 1 */
    int respring; /* AUTO_RESPRING_*: NOTIFY */
    int keep;     /* Keep Previous Versions: 0-2, 1 */
};

/* Settings text: one "key=value" per line, the F13 keys without "ifizbox." (checkUpdates=off|launch|6h|daily,
 * cellular=true|false, autoInstall=off|marked|all, autoInstallIdle=true|false, respring=notify|locked,
 * keepVersions=0|1|2), plus any number of "marked=<id>" (Only Packages I Mark), "hold=<id>" (Ignored Upgrades)
 * and "ignore=<id>=<version>" (Ignore This Version, F282) lines. A missing key, or a value that isn't one of its options, reads as the default (settings.js does the same).
 * text NULL: all defaults. */
void auto_settings_parse(const char *text, struct auto_settings *s);

/* 1 if text has the line "<key>=<id>" (marked=, hold=). */
int auto_listed(const char *text, const char *key, const char *id);

/* F282: Ignore This Version (the app's ifizbox.ignoredVersions, {id: version}), as "ignore=<id>=<version>" settings
 * lines. auto_ignored: 1 if settings ignores id at version, the versions equal by dpkg's order (epoch 0 = none,
 * "01" = "1", no revision = "-0"), as core/appupdates.js splitIgnoredVersions compares them. auto_drop_ignored takes
 * those upgrades out of list (n and kept both), so they neither count for N5 nor install for N7; returns how many. */
int auto_same_version(const char *a, const char *b);
int auto_ignored(const char *settings, const char *id, const char *version);
int auto_drop_ignored(struct upd_list *list, const char *settings);

/* Seconds between checks for the setting, 0 when the daemon doesn't check by itself. */
long auto_interval(const struct auto_settings *s);

/* Whether to check now. */
enum { AUTO_NO, AUTO_GO, AUTO_WAIT_WIFI };
/* AUTO_NO (not due, or checks are off/on launch), AUTO_GO, or AUTO_WAIT_WIFI: due, but the phone is on cellular and
 * Use Cellular Data is off (try at the next start, the last check's time stays). force: the check is due whatever
 * the schedule says (--force), the cellular rule still holds. No network at all is AUTO_GO: apt-get update fails and
 * the count comes from the lists there are (N5). */
int auto_check(const struct auto_settings *s, long now, long last, int net, int force);

/* Which upgrades install by themselves: chosen[i] = 1 for list->items[i] when autoInstall is ALL, or MARKED and the
 * id is marked; never a hold (a settings "hold=" line, or a line of held, `apt-mark showhold`'s output), nor an
 * id=version that failed before (a "failed <id>=<to>" line in state). Returns how many were chosen. */
int auto_pick(const struct upd_list *list, const struct auto_settings *s, const char *settings, const char *held,
              const char *state, unsigned char *chosen);

/* Whether installs may run now. */
enum { AUTO_INSTALL_NOW, AUTO_WAIT_IDLE, AUTO_WAIT_NET };
/* AUTO_INSTALL_NOW, AUTO_WAIT_IDLE (Only When Charging and Locked, and it isn't both), or AUTO_WAIT_NET (no network,
 * or cellular when it isn't allowed: the .debs need downloading). */
int auto_may_install(const struct auto_settings *s, int charging, int locked, int net);

/* 1 if `apt-get -s` output would remove a package (a "Remv " line): an upgrade that takes something away waits
 * for a person. */
int auto_plan_removes(const char *plan);

/* What the install asks for afterwards. */
enum { AUTO_FINISH_NONE, AUTO_FINISH_RESPRING, AUTO_FINISH_REBOOT };
/* From Cydia's finish protocol in apt's output (maintainer scripts print "finish:<what>" to $CYDIA's fd; the daemon
 * points it at stdout): reload/restart → RESPRING, reboot → REBOOT; the strongest one wins. */
int auto_finish(const char *output);

/* 1 if a dpkg file list (<prefix>/var/lib/dpkg/info/<id>.list) puts a file where SpringBoard loads tweaks, themes
 * or preference bundles from: those take effect only after a respring, whether or not the package says so. */
int auto_list_needs_respring(const char *list);

/* What to do about a respring an install needs. */
enum { AUTO_DO_NOTHING, AUTO_DO_NOTIFY, AUTO_DO_RESPRING, AUTO_DO_WAIT };
/* need: AUTO_FINISH_*. A reboot is never done for the user: NOTIFY. A respring: NOTIFY with Just Notify Me;
 * with Respring When Locked, RESPRING when the phone is locked now, else WAIT (kept pending for a later start). */
int auto_respring_action(const struct auto_settings *s, int need, int locked);

/* A pending respring from `since`: 1 if it is still needed, 0 when SpringBoard has started since (the user
 * resprung or rebooted) or sb_started is unknown (0) and the pending one is more than a day old. */
int auto_respring_pending(long since, long sb_started, long now);

/* The version in a .deb file name as apt's cache writes it, "<id>_<version>_<arch>.deb" with the epoch's ':' as
 * "%3a". Returns 1 and fills ver, or 0 when the name isn't one for id. */
int auto_deb_version(const char *file, const char *id, char *ver, size_t size);

/* Which cached .debs of one package to delete. listing: one "<file> <mtime>" line per file in its rollback folder.
 * Kept: the installed version's .deb (it is what an upgrade rolls back to) and the `keep` newest of the others, by
 * mtime (the daemon touches a file when it stores it), equal mtimes by Debian version; keep 0 deletes them all.
 * Names that aren't this package's .debs are left alone. Writes the files to delete into out, one per line;
 * returns how many. */
int auto_prune(const char *listing, const char *id, const char *installed, int keep, char *out, size_t size);

/* The notification after automatic installs: "1 Package Updated" / "<n> Packages Updated", and "<name> <to> was
 * installed." / "A and B were installed." / "A, B, C and <k> more were installed.", then " Respring to finish." or
 * " Reboot to finish." for need. Names as upd_body: dpkg's Name:, else the id. Only chosen items count. */
void auto_title(int n, char *buf, size_t size);
void auto_body(const struct upd_list *list, const unsigned char *chosen, int need, char *buf, size_t size);

/* When the install failed: "Update Failed", "<name> couldn't be updated automatically." / "<n> packages couldn't
 * be updated automatically." */
void auto_failed_body(const struct upd_list *list, const unsigned char *chosen, char *buf, size_t size);

/* The state lines N7 adds after upd_state's: "failed <id>=<to>" for each chosen item when failed is set, plus any
 * earlier failed line whose id=to is still an upgrade in list (a new version clears it); then "respring <since>"
 * when respring_since > 0. Returns the length written (snprintf's rule). */
size_t auto_state(const struct upd_list *list, const unsigned char *chosen, int failed, const char *old_state,
                  long respring_since, char *buf, size_t size);

/* The "respring <since>" time in a state, or 0. */
long auto_state_respring(const char *state);

/* 1 if state lists an upgrade ("<id>=<to>") that hasn't failed: something may be waiting to install. */
int auto_state_waiting(const char *state);

/* 1 if id is safe as a folder name (the helper's package-name rule: [A-Za-z0-9][A-Za-z0-9._+-]*, at most 255 bytes). */
int auto_safe_id(const char *id);

/* Copy <cache>/<id>_<version>_<arch>.deb (apt's archive cache) into <rollback>/<id>/, mtime now. An existing copy
 * is left alone unless touch is set (then its mtime becomes now). Returns 1 if the package's .deb is in the store
 * afterwards. */
int auto_stash(const char *cache, const char *rollback, const char *id, const char *version, long now, int touch);

/* Delete <rollback>/<id>/'s .debs that auto_prune says go (the folder too once it's empty). Returns how many. */
int auto_prune_dir(const char *rollback, const char *id, const char *installed, int keep);

/* B16: 1 if a Packages "Filename:" value is a full URL ("<scheme>://...", ios.jjolano.me's GitHub links). apt joins
 * it to the repo's URL and 404s; the app downloads it itself (F131), the daemon leaves such packages to the app. */
int auto_url_filename(const char *filename);

/* B16: which of the n id=version pairs some list in lists (apt's <prefix>/var/lib/apt/lists, its *_Packages files)
 * offers with a full-URL Filename: hit[i] = 1 for those. Returns how many. lists NULL or unreadable: none. */
int auto_linked(const char *lists, const char *const *ids, const char *const *vers, int n, unsigned char *hit);

/* B192: apt's lists file prefix for a source URI (apt's URItoFileName: scheme and user:password dropped, some
 * characters %-quoted, '/' -> '_', always ending in '_'), into out. Returns 1 when it fit. */
int auto_list_prefix(const char *uri, char *out, size_t size);

/* B192: 1 if a source URI is plain http ("http://", or a "<x>+http://" transport such as tor+http), case aside. */
int auto_plain_http(const char *uri);

/* B192: which of the n id=version pairs some list in lists offers from a plain-http source: hit[i] = 1 for those.
 * Each *_Packages file belongs to the source in apt_dir (<prefix>/etc/apt: sources.list, and sources.list.d's
 * .list and .sources files) with the longest matching auto_list_prefix; equal ones count as http if any is. A list no source
 * claims counts as not http. Returns how many. apt_dir or lists NULL or unreadable: none. */
int auto_insecure(const char *apt_dir, const char *lists, const char *const *ids, const char *const *vers, int n,
                  unsigned char *hit);

/* B16: the packages an `apt-get -s` plan installs ("Inst <id>[:arch] [<from>] (<to> ..."), new ones too, into
 * ids/vers (each up to UPD_FIELD bytes, room for max). Returns how many. */
int auto_plan_installs(const char *plan, char (*ids)[UPD_FIELD], char (*vers)[UPD_FIELD], int max);

/* What the daemon is given: where things are, the facts of the moment and the work apt does. main.m fills it with
 * the phone's; auto_driver.c with a fake clock, phone and helper. Strings returned are malloc'd (or NULL). */
enum { AUTO_NOTE_UPGRADES, AUTO_NOTE_UPDATED, AUTO_NOTE_FAILED, AUTO_NOTE_BADGE };
struct auto_env {
    void *ctx;
    const char *state_path;   /* <prefix>/var/lib/ifizbox/upgrades.state */
    const char *status_path;  /* <prefix>/var/lib/dpkg/status */
    const char *info_dir;     /* <prefix>/var/lib/dpkg/info (the <id>.list files) */
    const char *cache_dir;    /* <prefix>/var/cache/apt/archives */
    const char *rollback_dir; /* <prefix>/var/cache/ifizbox/rollback */
    const char *lists_dir;    /* <prefix>/var/lib/apt/lists (B16: full-URL Filenames), NULL: not looked at */
    char *(*settings)(void *ctx);           /* the settings text (auto_settings_parse) */
    char *(*held)(void *ctx);               /* `apt-mark showhold` */
    long (*now)(void *ctx);
    int (*net)(void *ctx);                  /* AUTO_NET_* */
    int (*charging)(void *ctx);
    int (*locked)(void *ctx);
    long (*springboard_started)(void *ctx); /* when SpringBoard last started, 0 unknown */
    int (*busy)(void *ctx);                 /* 1 while something holds dpkg's lock (the app installing): wait */
    int (*update)(void *ctx);               /* apt-get update; its exit status */
    /* apt-get -s: dist-upgrade when n is 0, else install --only-upgrade <ids>. Exit status; *out its stdout. */
    int (*simulate)(void *ctx, const char *const *ids, int n, char **out);
    /* apt-get -y install --only-upgrade <ids>, $CYDIA on stdout. Exit status; *out its stdout. */
    int (*install)(void *ctx, const char *const *ids, int n, char **out);
    void (*respring)(void *ctx);
    /* A notification (title, body) or, for AUTO_NOTE_BADGE, only the badge. badge: the upgrades left. */
    void (*notify)(void *ctx, int kind, int badge, const char *title, const char *body);
    void (*say)(void *ctx, const char *msg);
    const char *apt_dir;      /* B192: <prefix>/etc/apt (which sources are http), NULL: not looked at */
};

/* One run (launchd starts it hourly): a pending respring, the check if due (Check for Updates, Use Cellular Data),
 * the automatic installs it allows (auto_pick, auto_may_install, a plan that removes nothing), the .debs kept for
 * rollback, the respring an install needs, N5's upgrade notification and badge, and the state. before/after: room
 * for two lists (they're large: keep them static). force: check now; update: 0 skips apt-get update; dry: decide
 * and say, but install, respring, notify and write nothing. Returns 0, or 1 when the state couldn't be written. */
int auto_step(const struct auto_env *env, int force, int update, int dry, struct upd_list *before,
              struct upd_list *after);

#endif
