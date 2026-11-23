/* ifizbox-upgrades (N5, N7): iFizBox's background upgrade check and automatic updates, a launchd daemon running as root.
 *
 *   ifizbox-upgrades [--force] [--no-update] [--dry-run]
 *
 * launchd starts it every hour and at load (com.ryha.ifizbox.upgrades.plist). What a run does is auto.c's
 * auto_step, tested on Linux (test_auto.py); this file only gathers the facts and does the work:
 *   - the F13 settings, as the app mirrors them into its preferences (com.ryha.ifizbox, user mobile: keys
 *     "ifizbox.checkUpdates" and so on, "ifizbox.autoMarked" and "ifizbox.holds" lists, the
 *     "ifizbox.ignoredVersions" map), flattened to auto.h's text;
 *   - the network (SCNetworkReachability: none, Wi-Fi, cellular), charging (IOKit's power sources: AC Power),
 *     locked (com.apple.springboard.lockstate), when SpringBoard started (sysctl), dpkg's lock;
 *   - apt from <prefix>/usr/bin with a clean environment and time limits: update (10 min), the plan
 *     (-s dist-upgrade, 2 min), the automatic installs' plan and install (install --only-upgrade --no-remove,
 *     30 min, $CYDIA on stdout for the finish protocol), apt-mark showhold; sbreload (or killall backboardd);
 *   - notifications and the badge for com.ryha.ifizbox: N5's "3 Upgrades" (ifizbox-upgrades) and N7's
 *     "2 Packages Updated" / "Update Failed" (ifizbox-autoupdate).
 * State: <prefix>/var/lib/ifizbox/upgrades.state (last check, id=version pairs shown, failed installs, a pending
 * respring); .debs kept for rollback: <prefix>/var/cache/ifizbox/rollback/<id>/.
 *
 * The notification and badge go through UNUserNotificationCenter's private -initWithBundleIdentifier:, which
 * usernotificationsd allows for a process entitled with com.apple.private.usernotifications.bundle-identifiers
 * (entitlements.plist here). iFizBox must have asked for notification permission once, or iOS drops them.
 * SPDX-License-Identifier: GPL-3.0-or-later */
#import <Foundation/Foundation.h>
#import <SystemConfiguration/SystemConfiguration.h>
#import <UserNotifications/UserNotifications.h>

#include "auto.h"
#include "upgrades.h"
#include "quiet.h"

#include <netinet/in.h>
#include <notify.h>
#include <sys/sysctl.h>

#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdarg.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#ifndef IFIZBOX_PREFIX
#define IFIZBOX_PREFIX "/var/jb"
#endif
/* B329: every apt-get and apt-mark run reads no Translation files, as the helper's (native/helper/policy.h
 * HELPER_APT_NO_TRANSLATIONS): a repo's web page saved as one broke every apt command, and an update without this
 * would fetch it again. */
#define NO_TRANSLATIONS "Acquire::Languages=none"
#define BUNDLE_ID @"com.ryha.ifizbox"
#define NOTE_ID @"ifizbox-upgrades" /* one notification, replaced by the next */
#define AUTO_NOTE_ID @"ifizbox-autoupdate" /* N7's: what installed by itself, or failed to */
#define UPDATE_SECONDS 600
#define SIMULATE_SECONDS 120
#define INSTALL_SECONDS 1800
#define OUTPUT_MAX (16 << 20)

extern char **environ;

/* IOKit's power sources (IOPowerSources.h, not in the iOS SDK's headers; the symbols are in IOKit.tbd). */
extern CFTypeRef IOPSCopyPowerSourcesInfo(void);
extern CFStringRef IOPSGetProvidingPowerSourceType(CFTypeRef snapshot);

@interface UNUserNotificationCenter (iFizBoxPrivate)
- (instancetype)initWithBundleIdentifier:(NSString *)bundleIdentifier;
- (void)setBadgeNumber:(NSNumber *)number withCompletionHandler:(void (^)(NSError *))handler; /* before iOS 16 */
@end

static void say(const char *fmt, ...) __attribute__((format(printf, 1, 2)));
static void say(const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    NSString *s = [[NSString alloc] initWithFormat:@(fmt) arguments:ap];
    va_end(ap);
    NSLog(@"ifizbox-upgrades: %@", s); /* the system log, and stderr (launchd's StandardErrorPath) */
}

/* Run argv (argv[0] a full path) with a clean environment (plus `extra`, "NAME=value", when not NULL), stdin
 * /dev/null; stdout into *out (NULL: discarded), stderr discarded. Kills it after `seconds`. Returns the exit
 * status, or -1. */
static int run_env(const char *const argv[], int seconds, NSMutableData *out, char *extra) {
    static char path_env[1024];
    snprintf(path_env, sizeof path_env,
             "PATH=%1$s/usr/bin:%1$s/bin:%1$s/usr/sbin:%1$s/sbin:/usr/bin:/bin:/usr/sbin:/sbin", IFIZBOX_PREFIX);
    char *env[] = {path_env, "HOME=/var/root", "USER=root", "LOGNAME=root", "LANG=C",
                   "DEBIAN_FRONTEND=noninteractive", extra, NULL};
    int pipefd[2] = {-1, -1};
    if (out && pipe(pipefd)) return -1;
    posix_spawn_file_actions_t fa;
    posix_spawn_file_actions_init(&fa);
    posix_spawn_file_actions_addopen(&fa, 0, "/dev/null", O_RDONLY, 0);
    if (out) posix_spawn_file_actions_adddup2(&fa, pipefd[1], 1);
    else posix_spawn_file_actions_addopen(&fa, 1, "/dev/null", O_WRONLY, 0);
    posix_spawn_file_actions_addopen(&fa, 2, "/dev/null", O_WRONLY, 0);
    if (out) { posix_spawn_file_actions_addclose(&fa, pipefd[0]); posix_spawn_file_actions_addclose(&fa, pipefd[1]); }
    pid_t pid;
    int err = posix_spawn(&pid, argv[0], &fa, NULL, (char *const *)argv, env);
    posix_spawn_file_actions_destroy(&fa);
    if (out) close(pipefd[1]);
    if (err) {
        say("%s: %s", argv[0], strerror(err));
        if (out) close(pipefd[0]);
        return -1;
    }
    time_t deadline = time(NULL) + seconds;
    if (out) {
        fcntl(pipefd[0], F_SETFL, O_NONBLOCK);
        char buf[16384];
        for (;;) {
            ssize_t n = read(pipefd[0], buf, sizeof buf);
            if (n > 0) { if (out.length < OUTPUT_MAX) [out appendBytes:buf length:(NSUInteger)n]; continue; }
            if (n == 0) break;
            if (errno != EAGAIN && errno != EINTR) break;
            if (time(NULL) > deadline) break;
            usleep(50000);
        }
        close(pipefd[0]);
    }
    int status = 0;
    for (;;) {
        pid_t r = waitpid(pid, &status, WNOHANG);
        if (r == pid) break;
        if (r < 0 && errno != EINTR) return -1;
        if (time(NULL) > deadline) {
            say("%s took more than %d s, stopped", argv[0], seconds);
            kill(pid, SIGKILL);
            waitpid(pid, &status, 0);
            return -1;
        }
        usleep(100000);
    }
    return WIFEXITED(status) ? WEXITSTATUS(status) : -1;
}

static int run(const char *const argv[], int seconds, NSMutableData *out) { return run_env(argv, seconds, out, NULL); }

/* Wait for a completion handler, 15 s at most. */
static void await(void (^start)(dispatch_block_t done)) {
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    start(^{ dispatch_semaphore_signal(sem); });
    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC));
}

static void setBadge(UNUserNotificationCenter *center, int n) {
    if (@available(iOS 16.0, *)) {
        await(^(dispatch_block_t done) {
            [center setBadgeCount:n withCompletionHandler:^(NSError *e) { if (e) say("badge: %s", e.description.UTF8String); done(); }];
        });
    } else if ([center respondsToSelector:@selector(setBadgeNumber:withCompletionHandler:)]) {
        await(^(dispatch_block_t done) {
            [center setBadgeNumber:@(n) withCompletionHandler:^(NSError *e) { if (e) say("badge: %s", e.description.UTF8String); done(); }];
        });
    }
}

static void post(UNUserNotificationCenter *center, NSString *ident, int n, const char *title, const char *body) {
    UNMutableNotificationContent *c = [UNMutableNotificationContent new];
    c.title = @(title);
    c.body = @(body);
    c.badge = @(n);
    c.sound = UNNotificationSound.defaultSound;
    c.threadIdentifier = ident;
    c.userInfo = @{@"url": @"#/changes"}; /* where the app's Changes tab is, for a tap handler */
    UNNotificationRequest *req = [UNNotificationRequest requestWithIdentifier:ident content:c trigger:nil];
    await(^(dispatch_block_t done) {
        [center addNotificationRequest:req withCompletionHandler:^(NSError *e) {
            if (e) say("notification: %s", e.description.UTF8String);
            done();
        }];
    });
}

/* --- auto_env: the phone's facts and apt's work for auto_step (auto.h) */

struct phone {
    int dry;
    UNUserNotificationCenter *center;
};

/* A value from iFizBox's preferences as the settings text has it: true/false, a number, or a string. */
static NSString *flat(id v) {
    if ([v isKindOfClass:NSNumber.class]) {
        if (CFGetTypeID((__bridge CFTypeRef)v) == CFBooleanGetTypeID()) return [v boolValue] ? @"true" : @"false";
        return [v stringValue];
    }
    return [v isKindOfClass:NSString.class] ? v : nil;
}

/* A list setting: an array of strings, or the JSON text localStorage keeps (ifizbox.holds). */
static NSArray *flatList(id v) {
    if ([v isKindOfClass:NSString.class]) {
        NSData *d = [v dataUsingEncoding:NSUTF8StringEncoding];
        v = d ? [NSJSONSerialization JSONObjectWithData:d options:0 error:nil] : nil;
    }
    return [v isKindOfClass:NSArray.class] ? v : @[];
}

static char *dupString(NSString *s) { return s ? strdup(s.UTF8String) : NULL; }

/* The F13 settings from iFizBox's preferences (user mobile, through cfprefsd, so the app's last write counts), as
 * "key=value" lines; missing preferences: NULL, every setting at its default. */
static char *e_settings(void *ctx) {
    (void)ctx;
    CFDictionaryRef all = CFPreferencesCopyMultiple(NULL, CFSTR("com.ryha.ifizbox"), CFSTR("mobile"), kCFPreferencesAnyHost);
    NSDictionary *prefs = CFBridgingRelease(all);
    if (!prefs.count) prefs = [NSDictionary dictionaryWithContentsOfFile:@"/var/mobile/Library/Preferences/com.ryha.ifizbox.plist"];
    if (!prefs.count) return NULL;
    NSMutableString *text = [NSMutableString string];
    for (NSString *key in @[@"checkUpdates", @"cellular", @"autoInstall", @"autoInstallIdle", @"respring", @"keepVersions"]) {
        NSString *v = flat(prefs[[@"ifizbox." stringByAppendingString:key]]);
        if (v && [v rangeOfString:@"\n"].location == NSNotFound) [text appendFormat:@"%@=%@\n", key, v];
    }
    for (NSArray *pair in @[@[@"ifizbox.autoMarked", @"marked"], @[@"ifizbox.holds", @"hold"]])
        for (id v in flatList(prefs[pair[0]]))
            if ([v isKindOfClass:NSString.class] && [v rangeOfString:@"\n"].location == NSNotFound)
                [text appendFormat:@"%@=%@\n", pair[1], v];
    /* F282: Ignore This Version, {id: version} (a dictionary as prefs.set writes it, or localStorage's JSON text). */
    id iv = prefs[@"ifizbox.ignoredVersions"];
    if ([iv isKindOfClass:NSString.class]) {
        NSData *d = [iv dataUsingEncoding:NSUTF8StringEncoding];
        iv = d ? [NSJSONSerialization JSONObjectWithData:d options:0 error:nil] : nil;
    }
    if ([iv isKindOfClass:NSDictionary.class])
        for (id k in [[iv allKeys] sortedArrayUsingSelector:@selector(compare:)]) {
            id v = iv[k];
            if (![k isKindOfClass:NSString.class] || ![v isKindOfClass:NSString.class] || ![k length] || ![v length]) continue;
            NSCharacterSet *bad = [NSCharacterSet characterSetWithCharactersInString:@"=\r\n"];
            if ([k rangeOfCharacterFromSet:bad].location != NSNotFound || [v rangeOfCharacterFromSet:bad].location != NSNotFound) continue;
            [text appendFormat:@"ignore=%@=%@\n", k, v];
        }
    return dupString(text);
}

static char *e_held(void *ctx) {
    (void)ctx;
    NSMutableData *out = [NSMutableData data];
    const char *argv[] = {IFIZBOX_PREFIX "/usr/bin/apt-mark", "-o", NO_TRANSLATIONS, "showhold", NULL};
    if (run(argv, SIMULATE_SECONDS, out) != 0) return NULL;
    [out appendBytes:"" length:1];
    return strdup(out.bytes);
}

static long e_now(void *ctx) { (void)ctx; return (long)time(NULL); }

static int e_net(void *ctx) {
    (void)ctx;
    struct sockaddr_in zero = {.sin_len = sizeof zero, .sin_family = AF_INET};
    SCNetworkReachabilityRef r = SCNetworkReachabilityCreateWithAddress(NULL, (const struct sockaddr *)&zero);
    if (!r) return AUTO_NET_NONE;
    SCNetworkReachabilityFlags f = 0;
    Boolean ok = SCNetworkReachabilityGetFlags(r, &f);
    CFRelease(r);
    if (!ok || !(f & kSCNetworkReachabilityFlagsReachable)) return AUTO_NET_NONE;
    if (f & kSCNetworkReachabilityFlagsConnectionRequired) return AUTO_NET_NONE;
    return (f & kSCNetworkReachabilityFlagsIsWWAN) ? AUTO_NET_CELL : AUTO_NET_WIFI;
}

static int e_charging(void *ctx) {
    (void)ctx;
    CFTypeRef info = IOPSCopyPowerSourcesInfo();
    if (!info) return 0;
    CFStringRef type = IOPSGetProvidingPowerSourceType(info);
    int ac = type && CFStringCompare(type, CFSTR("AC Power"), 0) == kCFCompareEqualTo;
    CFRelease(info);
    return ac;
}

static int e_locked(void *ctx) {
    (void)ctx;
    static int token = -1;
    if (token < 0 && notify_register_check("com.apple.springboard.lockstate", &token) != NOTIFY_STATUS_OK) {
        token = -1;
        return 0;
    }
    uint64_t state = 0;
    return notify_get_state(token, &state) == NOTIFY_STATUS_OK && state != 0;
}

/* When SpringBoard (the newest one) started, from the process table; 0 if it isn't found. */
static long e_springboard_started(void *ctx) {
    (void)ctx;
    int mib[] = {CTL_KERN, KERN_PROC, KERN_PROC_ALL, 0};
    size_t size = 0;
    if (sysctl(mib, 4, NULL, &size, NULL, 0) || !size) return 0;
    size += size / 4;
    struct kinfo_proc *procs = malloc(size);
    if (!procs) return 0;
    long started = 0;
    if (!sysctl(mib, 4, procs, &size, NULL, 0)) {
        for (size_t i = 0; i < size / sizeof *procs; i++)
            if (!strcmp(procs[i].kp_proc.p_comm, "SpringBoard") && procs[i].kp_proc.p_starttime.tv_sec > started)
                started = procs[i].kp_proc.p_starttime.tv_sec;
    }
    free(procs);
    return started;
}

/* 1 while another apt or dpkg holds dpkg's front-end lock (the app's queue running). */
static int e_busy(void *ctx) {
    (void)ctx;
    int fd = open(IFIZBOX_PREFIX "/var/lib/dpkg/lock-frontend", O_RDWR | O_CLOEXEC);
    if (fd < 0) return 0;
    struct flock fl = {.l_type = F_WRLCK, .l_whence = SEEK_SET};
    int busy = fcntl(fd, F_GETLK, &fl) == 0 && fl.l_type != F_UNLCK;
    close(fd);
    return busy;
}

static int e_update(void *ctx) {
    (void)ctx;
    const char *argv[] = {IFIZBOX_PREFIX "/usr/bin/apt-get", "-q", "-o", NO_TRANSLATIONS, "-o", "Acquire::AllowInsecureRepositories=true",
                          "update", NULL};
    return run(argv, UPDATE_SECONDS, nil);
}

/* apt-get [-s] ... ; ids NULL/0: -s dist-upgrade. */
static int apt(const char *const *ids, int n, int simulate, char **out) {
    const char *argv[UPD_MAX + 16];
    int k = 0;
    argv[k++] = IFIZBOX_PREFIX "/usr/bin/apt-get";
    argv[k++] = "-q";
    argv[k++] = "-o"; argv[k++] = NO_TRANSLATIONS;
    if (simulate) { argv[k++] = "-s"; argv[k++] = "-o"; argv[k++] = "Debug::NoLocking=1"; }
    else {
        argv[k++] = "-y";
        argv[k++] = "-o"; argv[k++] = "Dpkg::Options::=--force-confdef";
        argv[k++] = "-o"; argv[k++] = "Dpkg::Options::=--force-confold";
        argv[k++] = "--allow-unauthenticated"; /* N6: upgrades from unsigned repos, as the helper's install */
    }
    if (n == 0) argv[k++] = "dist-upgrade";
    else {
        argv[k++] = "--only-upgrade";
        argv[k++] = "--no-remove";
        argv[k++] = "install";
        for (int i = 0; i < n; i++) argv[k++] = ids[i];
    }
    argv[k] = NULL;
    NSMutableData *data = [NSMutableData data];
    /* Cydia's finish protocol: maintainer scripts write "finish:restart" and so on to $CYDIA's fd: stdout here. */
    int st = run_env(argv, simulate ? SIMULATE_SECONDS : INSTALL_SECONDS, data, simulate ? NULL : "CYDIA=1 1");
    [data appendBytes:"" length:1];
    *out = strdup(data.bytes);
    return st;
}

static int e_simulate(void *ctx, const char *const *ids, int n, char **out) { (void)ctx; return apt(ids, n, 1, out); }
static int e_install(void *ctx, const char *const *ids, int n, char **out) { (void)ctx; return apt(ids, n, 0, out); }

static void e_respring(void *ctx) {
    (void)ctx;
    const char *sb[] = {IFIZBOX_PREFIX "/usr/bin/sbreload", NULL};
    const char *kill_bb[] = {IFIZBOX_PREFIX "/usr/bin/killall", "-9", "backboardd", NULL};
    run(access(sb[0], X_OK) == 0 ? sb : kill_bb, 60, nil);
}

static void e_notify(void *ctx, int kind, int badge, const char *title, const char *body) {
    struct phone *p = ctx;
    if (p->dry) { printf("%s\n%s\n", title ? title : "", body ? body : ""); return; }
    if (!p->center) return;
    /* F65: Upgrade Notifications off (quiet.h): N5's notification becomes a badge-only update. */
    kind = quiet_kind(kind, access(IFIZBOX_PREFIX QUIET_FILE, F_OK) == 0);
    if (kind == AUTO_NOTE_BADGE) setBadge(p->center, badge);
    else post(p->center, kind == AUTO_NOTE_UPGRADES ? NOTE_ID : AUTO_NOTE_ID, badge, title, body);
}

static void e_say(void *ctx, const char *msg) { (void)ctx; say("%s", msg); }

static struct upd_list before, after;

int main(int argc, char *argv[]) {
    @autoreleasepool {
        int force = 0, update = 1, dry = 0;
        for (int i = 1; i < argc; i++) {
            if (!strcmp(argv[i], "--force")) force = 1;
            else if (!strcmp(argv[i], "--no-update")) update = 0;
            else if (!strcmp(argv[i], "--dry-run")) dry = 1;
            else { fprintf(stderr, "usage: ifizbox-upgrades [--force] [--no-update] [--dry-run]\n"); return 64; }
        }
        umask(022);
        NSString *dir = @IFIZBOX_PREFIX "/var/lib/ifizbox";
        mkdir(dir.fileSystemRepresentation, 0755);
        mkdir(IFIZBOX_PREFIX "/var/cache/ifizbox", 0755);

        /* One run at a time (RunAtLoad and the interval can meet, or a hand-run --force). */
        int lock = open([dir stringByAppendingPathComponent:@"upgrades.lock"].fileSystemRepresentation,
                        O_RDWR | O_CREAT | O_CLOEXEC, 0644);
        /* N6: a run without root (by hand as mobile) can't create the lock; say so rather than "another check". */
        if (lock < 0) { say("can't open %s/upgrades.lock: %s", dir.UTF8String, strerror(errno)); return 1; }
        if (flock(lock, LOCK_EX | LOCK_NB)) { say("another check is running"); return 0; }

        struct phone phone = {.dry = dry};
        if (!dry) {
            phone.center = [[UNUserNotificationCenter alloc] initWithBundleIdentifier:BUNDLE_ID];
            if (!phone.center) say("no notification center for " "com.ryha.ifizbox");
        }
        struct auto_env env = {
            .ctx = &phone,
            .state_path = IFIZBOX_PREFIX "/var/lib/ifizbox/upgrades.state",
            .status_path = IFIZBOX_PREFIX "/var/lib/dpkg/status",
            .info_dir = IFIZBOX_PREFIX "/var/lib/dpkg/info",
            .cache_dir = IFIZBOX_PREFIX "/var/cache/apt/archives",
            .rollback_dir = IFIZBOX_PREFIX "/var/cache/ifizbox/rollback",
            .lists_dir = IFIZBOX_PREFIX "/var/lib/apt/lists",
            .apt_dir = IFIZBOX_PREFIX "/etc/apt", /* B192: http sources aren't installed from automatically */
            .settings = e_settings, .held = e_held, .now = e_now, .net = e_net, .charging = e_charging,
            .locked = e_locked, .springboard_started = e_springboard_started, .busy = e_busy, .update = e_update,
            .simulate = e_simulate, .install = e_install, .respring = e_respring, .notify = e_notify, .say = e_say,
        };
        return auto_step(&env, force, update, dry, &before, &after);
    }
}
