/* B203: ifizbox-helper launch-theme <key>, the launch screen in the current theme (docs/native.md, "Launch screen").
 *
 * iOS draws the jailbreak app's launch screen from the bundle's own files at every launch (LaunchScreen.storyboardc
 * and the loose Launch*.png it names; the iPhone 7 keeps no SplashBoard snapshot for an app in the jailbreak's
 * /Applications). native/launch/make.py ships each theme's set in <app>/LaunchThemes/<key>/; this copies that set
 * over the bundle's own, so the next launch opens on that theme's empty frame. The bundle is root's, so only the
 * helper can. Only the files named below, only from LaunchThemes/<key>/ (key [a-z0-9], 1-32), regular files of at
 * most HELPER_LAUNCH_MAX bytes, never through a symlink; each lands by temp file + rename, so a launch meanwhile
 * sees the old file or the new one, never half of one. Runs nothing.
 *
 * Header only (static functions), so main.c and test_launch_theme.py's driver share it without a new source file in
 * the build lists. SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef IFIZBOX_HELPER_LAUNCH_H
#define IFIZBOX_HELPER_LAUNCH_H

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#define HELPER_LAUNCH_MAX (1024 * 1024)
#define HELPER_LAUNCH_THEMES "LaunchThemes"
#define HELPER_LAUNCH_STORYBOARD "LaunchScreen.storyboardc"
/* launch_check.IMAGES at @2x and @3x, then the storyboard's view nib (the one make.py gives each theme's colours);
 * test_launch_theme.py checks this list against both. */
static const char *const helper_launch_files[] = {
    "LaunchStripes@2x.png", "LaunchStripes@3x.png", "LaunchNavTop@2x.png", "LaunchNavTop@3x.png",
    "LaunchNavBottom@2x.png", "LaunchNavBottom@3x.png", "LaunchTabGloss@2x.png", "LaunchTabGloss@3x.png",
    "LaunchNavShadow@2x.png", "LaunchNavShadow@3x.png", "LaunchTabShadow@2x.png", "LaunchTabShadow@3x.png",
    "LaunchStatusStrip@2x.png", "LaunchStatusStrip@3x.png",
    HELPER_LAUNCH_STORYBOARD "/Lvc-00-000-view-Lrt-00-000.nib", NULL};

static int helper_launch_key_ok(const char *key) {
    size_t n = strlen(key);
    if (n < 1 || n > 32) return 0;
    for (size_t i = 0; i < n; i++)
        if (!((key[i] >= 'a' && key[i] <= 'z') || (key[i] >= '0' && key[i] <= '9'))) return 0;
    return 1;
}

/* Reads src (a regular file, not a symlink, at most HELPER_LAUNCH_MAX bytes) into a new buffer. */
static unsigned char *helper_launch_read(const char *src, size_t *len, const char **err) {
    int fd = open(src, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK);
    if (fd < 0) { *err = "can't open the theme's file"; return NULL; }
    struct stat st;
    if (fstat(fd, &st) || !S_ISREG(st.st_mode) || st.st_size <= 0 || st.st_size > HELPER_LAUNCH_MAX) {
        close(fd);
        *err = "the theme's file isn't a small regular file";
        return NULL;
    }
    unsigned char *buf = malloc((size_t)st.st_size);
    size_t got = 0;
    while (buf && got < (size_t)st.st_size) {
        ssize_t r = read(fd, buf + got, (size_t)st.st_size - got);
        if (r < 0 && errno == EINTR) continue;
        if (r <= 0) break;
        got += (size_t)r;
    }
    close(fd);
    if (!buf || got != (size_t)st.st_size) { free(buf); *err = "can't read the theme's file"; return NULL; }
    *len = got;
    return buf;
}

/* Writes buf to dst by a temp file beside it and a rename (0644). */
static int helper_launch_write(const char *dst, const unsigned char *buf, size_t len, const char **err) {
    char tmp[PATH_MAX];
    if ((size_t)snprintf(tmp, sizeof tmp, "%s.launch-theme", dst) >= sizeof tmp) { *err = "path too long"; return -1; }
    unlink(tmp);
    int fd = open(tmp, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0644);
    if (fd < 0) { *err = "can't create a temp file in the app"; return -1; }
    size_t put = 0;
    while (put < len) {
        ssize_t w = write(fd, buf + put, len - put);
        if (w < 0 && errno == EINTR) continue;
        if (w <= 0) break;
        put += (size_t)w;
    }
    int bad = put != len || fchmod(fd, 0644);
    if (close(fd)) bad = 1;
    if (bad || rename(tmp, dst)) {
        int e = errno;
        unlink(tmp);
        errno = e;
        *err = "can't write the app's launch file";
        return -1;
    }
    return 0;
}

/* Copies LaunchThemes/<key>/<file> over <app>/<file> for every file in helper_launch_files. All are read before any
 * is written, so a theme missing a file changes nothing. */
static int helper_launch_theme(const char *app, const char *key, const char **err) {
    if (!helper_launch_key_ok(key)) { *err = "bad theme (allowed: [a-z0-9], 1-32)"; return -1; }
    enum { N = sizeof helper_launch_files / sizeof *helper_launch_files - 1 };
    unsigned char *bufs[N] = {0};
    size_t lens[N] = {0};
    char path[PATH_MAX];
    int rc = 0;
    for (int i = 0; i < N && !rc; i++) {
        if ((size_t)snprintf(path, sizeof path, "%s/%s/%s/%s", app, HELPER_LAUNCH_THEMES, key, helper_launch_files[i]) >=
            sizeof path) { *err = "path too long"; rc = -1; break; }
        if (!(bufs[i] = helper_launch_read(path, &lens[i], err))) rc = -1;
    }
    for (int i = 0; i < N && !rc; i++) {
        if ((size_t)snprintf(path, sizeof path, "%s/%s", app, helper_launch_files[i]) >= sizeof path) {
            *err = "path too long"; rc = -1; break;
        }
        struct stat st;
        if (lstat(path, &st) == 0 && !S_ISREG(st.st_mode)) { *err = "the app's launch file isn't a regular file"; rc = -1; break; }
        if (helper_launch_write(path, bufs[i], lens[i], err)) rc = -1;
    }
    for (int i = 0; i < N; i++) free(bufs[i]);
    return rc;
}

#endif
