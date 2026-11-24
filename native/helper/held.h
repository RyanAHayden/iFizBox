/* B414: ifizbox-helper hold-self on|off, the app held open through a run that installs iFizBox itself.
 *
 * "on" (the run's start, the app's binary still in place) records the calling app, "<pid> <start time>", in
 * <prefix>/var/lib/ifizbox/held (root's, 0644); "off" (the run needs no tap, or its page closed) deletes it.
 * While it is there and that process lives:
 *   - iFizBox's postinst (deb/postinst) holds its uicache, which would close the app, also after the run has ended;
 *   - the helper still takes the app's calls once dpkg has replaced its binary, when proc_pidpath no longer gives a
 *     path that exists (else Restart SpringBoard would be refused): pid and start time must both match. A caller
 *     whose path does resolve is checked as always, and only a caller that passed that check gets recorded;
 *   - userspace-reboot registers the new copy first: the reboot ends the postinst's waiting job.
 * Header only, so main.c's builds need no new source file. SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef IFIZBOX_HELPER_HELD_H
#define IFIZBOX_HELPER_HELD_H

#include "launch.h"

#include <sys/types.h>
#ifdef __APPLE__
#include <sys/sysctl.h>
#endif

#define HELPER_HELD_DIR "/var/lib/ifizbox"
#define HELPER_HELD_FILE HELPER_HELD_DIR "/held"

/* When pid started, in units only compared for equality; 0 if it can't be read. */
static unsigned long long helper_start_time(pid_t pid) {
#ifdef __APPLE__
    int mib[4] = {CTL_KERN, KERN_PROC, KERN_PROC_PID, pid};
    struct kinfo_proc k;
    size_t n = sizeof k;
    if (sysctl(mib, 4, &k, &n, NULL, 0) || n < sizeof k || k.kp_proc.p_pid != pid) return 0;
    return (unsigned long long)k.kp_proc.p_starttime.tv_sec * 1000000ULL +
           (unsigned long long)k.kp_proc.p_starttime.tv_usec;
#else
    char path[64], buf[1024];
    snprintf(path, sizeof path, "/proc/%d/stat", (int)pid);
    FILE *f = fopen(path, "r");
    if (!f) return 0;
    size_t n = fread(buf, 1, sizeof buf - 1, f);
    fclose(f);
    buf[n] = 0;
    char *s = strrchr(buf, ')'); /* field 2; the start time is field 22 */
    for (int i = 2; s && i < 22; i++) s = strchr(s + 1, ' ');
    return s ? strtoull(s + 1, NULL, 10) : 0;
#endif
}

/* 1 if the record names pid, and this very process of that number. */
static int helper_held_by(const char *prefix, pid_t pid) {
    char path[PATH_MAX], buf[64];
    if (pid <= 1 || (size_t)snprintf(path, sizeof path, "%s" HELPER_HELD_FILE, prefix) >= sizeof path) return 0;
    int fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    if (fd < 0) return 0;
    ssize_t n = read(fd, buf, sizeof buf - 1);
    close(fd);
    if (n <= 0) return 0;
    buf[n] = 0;
    long held;
    unsigned long long start, now = helper_start_time(pid);
    return now && sscanf(buf, "%ld %llu", &held, &start) == 2 && held == (long)pid && start == now;
}

/* Deletes a record that isn't pid's (its app is gone); pid's own with `own` too. */
static void helper_held_clear(const char *prefix, pid_t pid, int own) {
    char path[PATH_MAX];
    if ((size_t)snprintf(path, sizeof path, "%s" HELPER_HELD_FILE, prefix) >= sizeof path) return;
    if (own || !helper_held_by(prefix, pid)) unlink(path);
}

static int helper_held_set(const char *prefix, pid_t pid, const char **err) {
    char path[PATH_MAX], buf[64];
    unsigned long long start = helper_start_time(pid);
    if (pid <= 1 || !start) { *err = "can't tell when the app started"; return -1; }
    if ((size_t)snprintf(path, sizeof path, "%s" HELPER_HELD_DIR, prefix) >= sizeof path) { *err = "path too long"; return -1; }
    umask(022);
    if (mkdir(path, 0755) && errno != EEXIST) { *err = "can't make the state folder"; return -1; }
    snprintf(path, sizeof path, "%s" HELPER_HELD_FILE, prefix);
    int n = snprintf(buf, sizeof buf, "%ld %llu\n", (long)pid, start);
    return helper_launch_write(path, (const unsigned char *)buf, (size_t)n, err);
}

#endif
