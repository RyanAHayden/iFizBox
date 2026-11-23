/* ifizbox-upgrades' automatic updates (N7): see auto.h. SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef __APPLE__
#define _POSIX_C_SOURCE 200809L /* utimensat, O_NOFOLLOW on Linux's -std=c11; Darwin hides other things with it */
#endif
#include "auto.h"

#include <dirent.h>
#include <errno.h>
#include <stdarg.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

/* The next line of text: *len is its length without "\r\n"/"\n"; returns where the one after starts. */
static const char *line(const char *p, size_t *len) {
    size_t n = strcspn(p, "\n");
    const char *next = p + n + (p[n] ? 1 : 0);
    if (n && p[n - 1] == '\r') n--;
    *len = n;
    return next;
}

/* 1 if text has a line that is exactly a + b + c. */
static int has_line(const char *text, const char *a, const char *b, const char *c) {
    size_t la = strlen(a), lb = strlen(b), lc = strlen(c);
    for (const char *p = text; p && *p; ) {
        size_t n;
        const char *next = line(p, &n);
        if (n == la + lb + lc && !memcmp(p, a, la) && !memcmp(p + la, b, lb) && !memcmp(p + la + lb, c, lc))
            return 1;
        p = next;
    }
    return 0;
}

/* The value of "key=" in text (the last one wins, as a later write would), into val; 0 if missing. */
static int value(const char *text, const char *key, char *val, size_t size) {
    size_t kl = strlen(key);
    int found = 0;
    for (const char *p = text; p && *p; ) {
        size_t n;
        const char *next = line(p, &n);
        if (n > kl && !memcmp(p, key, kl) && p[kl] == '=') {
            size_t vl = n - kl - 1;
            if (vl < size) { memcpy(val, p + kl + 1, vl); val[vl] = 0; found = 1; }
        }
        p = next;
    }
    return found;
}

/* The index of val in the NULL-ended options, or dflt. */
static int pick(const char *text, const char *key, const char *const *options, int dflt) {
    char v[32];
    if (!value(text, key, v, sizeof v)) return dflt;
    for (int i = 0; options[i]; i++)
        if (!strcmp(v, options[i])) return i;
    return dflt;
}

void auto_settings_parse(const char *text, struct auto_settings *s) {
    static const char *const check[] = {"off", "launch", "6h", "daily", NULL};
    static const char *const install[] = {"off", "marked", "all", NULL};
    static const char *const respring[] = {"notify", "locked", NULL};
    static const char *const flag[] = {"false", "true", NULL};
    static const char *const keep[] = {"0", "1", "2", NULL};
    s->check = pick(text, "checkUpdates", check, AUTO_CHECK_DAILY);
    s->cellular = pick(text, "cellular", flag, 1);
    s->install = pick(text, "autoInstall", install, AUTO_INSTALL_OFF);
    s->idle = pick(text, "autoInstallIdle", flag, 1);
    s->respring = pick(text, "respring", respring, AUTO_RESPRING_NOTIFY);
    s->keep = pick(text, "keepVersions", keep, 1);
}

int auto_listed(const char *text, const char *key, const char *id) {
    return id[0] && has_line(text, key, "=", id);
}

long auto_interval(const struct auto_settings *s) {
    if (s->check == AUTO_CHECK_6H) return AUTO_INTERVAL_6H;
    if (s->check == AUTO_CHECK_DAILY) return UPD_INTERVAL;
    return 0;
}

int auto_check(const struct auto_settings *s, long now, long last, int net, int force) {
    long every = auto_interval(s);
    int due = force || (every > 0 && (last <= 0 || last > now || now - last >= every));
    if (!due) return AUTO_NO;
    if (net == AUTO_NET_CELL && !s->cellular) return AUTO_WAIT_WIFI;
    return AUTO_GO;
}

int auto_pick(const struct upd_list *list, const struct auto_settings *s, const char *settings, const char *held,
              const char *state, unsigned char *chosen) {
    int n = 0;
    for (int i = 0; i < list->kept; i++) {
        const struct upd_item *it = &list->items[i];
        int go = s->install == AUTO_INSTALL_ALL || (s->install == AUTO_INSTALL_MARKED && auto_listed(settings, "marked", it->id));
        if (go && (auto_listed(settings, "hold", it->id) || has_line(held, it->id, "", ""))) go = 0;
        if (go && auto_ignored(settings, it->id, it->to)) go = 0; /* F282: Ignore This Version */
        if (go) {
            char key[2 * UPD_FIELD + 2];
            snprintf(key, sizeof key, "%s=%s", it->id, it->to);
            if (has_line(state, "failed ", key, "")) go = 0;
        }
        chosen[i] = (unsigned char)go;
        n += go;
    }
    return n;
}

int auto_may_install(const struct auto_settings *s, int charging, int locked, int net) {
    if (s->idle && !(charging && locked)) return AUTO_WAIT_IDLE;
    if (net == AUTO_NET_NONE || (net == AUTO_NET_CELL && !s->cellular)) return AUTO_WAIT_NET;
    return AUTO_INSTALL_NOW;
}

int auto_plan_removes(const char *plan) {
    for (const char *p = plan; p && *p; ) {
        size_t n;
        const char *next = line(p, &n);
        if (n > 5 && !memcmp(p, "Remv ", 5)) return 1;
        p = next;
    }
    return 0;
}

int auto_finish(const char *output) {
    int need = AUTO_FINISH_NONE;
    for (const char *p = output; p && *p; ) {
        size_t n;
        const char *next = line(p, &n);
        if (n > 7 && !memcmp(p, "finish:", 7)) {
            const char *w = p + 7;
            size_t wl = n - 7;
            while (wl && (w[wl - 1] == ' ' || w[wl - 1] == '\t')) wl--;
            if (wl == 6 && !memcmp(w, "reboot", 6)) need = AUTO_FINISH_REBOOT;
            else if (((wl == 6 && !memcmp(w, "reload", 6)) || (wl == 7 && !memcmp(w, "restart", 7))) && need < AUTO_FINISH_RESPRING)
                need = AUTO_FINISH_RESPRING;
        }
        p = next;
    }
    return need;
}

int auto_list_needs_respring(const char *list) {
    /* Rootless paths, and the rootful ones a list from an older package may hold; the folder itself isn't a file
     * in it. */
    static const char *const dirs[] = {
        "/Library/MobileSubstrate/DynamicLibraries/", "/usr/lib/TweakInject/", "/Library/TweakInject/",
        "/Library/PreferenceLoader/Preferences/", "/Library/PreferenceBundles/", "/Library/Themes/",
        NULL,
    };
    for (const char *p = list; p && *p; ) {
        size_t n;
        const char *next = line(p, &n);
        const char *path = p;
        if (n > 7 && !memcmp(path, "/var/jb", 7)) { path += 7; n -= 7; }
        for (int i = 0; dirs[i]; i++) {
            size_t dl = strlen(dirs[i]);
            if (n > dl && !memcmp(path, dirs[i], dl)) return 1;
        }
        p = next;
    }
    return 0;
}

int auto_respring_action(const struct auto_settings *s, int need, int locked) {
    if (need == AUTO_FINISH_NONE) return AUTO_DO_NOTHING;
    if (need == AUTO_FINISH_REBOOT || s->respring == AUTO_RESPRING_NOTIFY) return AUTO_DO_NOTIFY;
    return locked ? AUTO_DO_RESPRING : AUTO_DO_WAIT;
}

int auto_respring_pending(long since, long sb_started, long now) {
    if (since <= 0) return 0;
    if (sb_started > 0) return sb_started < since;
    return now >= since && now - since <= 86400;
}

int auto_deb_version(const char *file, const char *id, char *ver, size_t size) {
    size_t il = 0, fl = strlen(file);
    if (!*id) return 0;
    for (const char *q = id; *q; q++) { /* apt's archive names write the id's "_" as %5f */
        if (*q == '_' && !strncasecmp(file + il, "%5f", 3)) il += 3;
        else if (file[il] == *q) il++;
        else return 0;
    }
    if (fl < il + 7 || file[il] != '_' || strcmp(file + fl - 4, ".deb")) return 0;
    const char *v = file + il + 1, *end = file + fl - 4;
    const char *us = NULL;
    for (const char *q = v; q < end; q++)
        if (*q == '_') us = q;
    if (!us || us == v || us + 1 == end) return 0;
    for (const char *q = v; q < us; q++)
        if (*q == '_' || *q == '/') return 0;
    size_t at = 0;
    for (const char *q = v; q < us; q++) {
        char c = *q;
        if (c == '%' && us - q >= 3 && q[1] == '3' && (q[2] == 'a' || q[2] == 'A')) { c = ':'; q += 2; }
        if (at + 1 >= size) return 0;
        ver[at++] = c;
    }
    ver[at] = 0;
    return 1;
}

#define PRUNE_MAX 256

static int ver_cmp(const char *a, const char *b); /* dpkg's order, defined with ver_part_cmp below */

int auto_prune(const char *listing, const char *id, const char *installed, int keep, char *out, size_t size) {
    struct { const char *name; size_t len; long mtime; int other; char ver[UPD_FIELD]; } f[PRUNE_MAX];
    int nf = 0;
    if (size) out[0] = 0;
    if (keep < 0) keep = 0;
    for (const char *p = listing; p && *p && nf < PRUNE_MAX; ) {
        size_t n;
        const char *next = line(p, &n);
        const char *sp = NULL;
        for (const char *q = p + n; q > p; q--)
            if (q[-1] == ' ') { sp = q - 1; break; }
        if (sp && sp > p) {
            char name[2 * UPD_FIELD + 16], ver[UPD_FIELD];
            size_t nl = (size_t)(sp - p);
            if (nl < sizeof name) {
                memcpy(name, p, nl);
                name[nl] = 0;
                if (auto_deb_version(name, id, ver, sizeof ver)) {
                    f[nf].name = p;
                    f[nf].len = nl;
                    f[nf].mtime = strtol(sp + 1, NULL, 10);
                    memcpy(f[nf].ver, ver, sizeof ver);
                    f[nf].other = !(keep > 0 && installed && !strcmp(ver, installed));
                    nf++;
                }
            }
        }
        p = next;
    }
    /* The newest `keep` of the others stay: count, for each, how many others are newer. Files stashed in one run
     * share an mtime, so ties go by version (the higher is newer), then by the earlier line. */
    int deleted = 0;
    size_t at = 0;
    for (int i = 0; i < nf; i++) {
        if (!f[i].other) continue;
        int newer = 0;
        for (int j = 0; j < nf; j++)
            if (j != i && f[j].other) {
                int c = f[j].mtime > f[i].mtime ? 1 : f[j].mtime < f[i].mtime ? -1 : ver_cmp(f[j].ver, f[i].ver);
                if (c > 0 || (c == 0 && j < i)) newer++;
            }
        if (newer < keep) continue;
        if (at + f[i].len + 2 <= size) {
            memcpy(out + at, f[i].name, f[i].len);
            at += f[i].len;
            out[at++] = '\n';
            out[at] = 0;
        }
        deleted++;
    }
    return deleted;
}

static const char *shown_name(const struct upd_item *it) { return it->name[0] ? it->name : it->id; }

void auto_title(int n, char *buf, size_t size) {
    if (n == 1) snprintf(buf, size, "1 Package Updated");
    else snprintf(buf, size, "%d Packages Updated", n);
}

#define PUT(...) do { if (at < size) at += (size_t)snprintf(buf + at, size - at, __VA_ARGS__); } while (0)

/* "A", "A and B", "A, B and C", "A, B, C and <k> more" of the chosen items; returns how many were chosen. */
static int names(const struct upd_list *list, const unsigned char *chosen, char *buf, size_t size, size_t *pat) {
    size_t at = *pat;
    int n = 0;
    for (int i = 0; i < list->kept; i++) n += chosen[i] != 0;
    int shown = n < UPD_SHOWN ? n : UPD_SHOWN, rest = n - shown, k = 0;
    for (int i = 0; i < list->kept && k < shown; i++) {
        if (!chosen[i]) continue;
        const char *sep = k == 0 ? "" : (rest == 0 && k == shown - 1) ? " and " : ", ";
        PUT("%s%s", sep, shown_name(&list->items[i]));
        k++;
    }
    if (rest > 0) PUT(" and %d more", rest);
    *pat = at;
    return n;
}

void auto_body(const struct upd_list *list, const unsigned char *chosen, int need, char *buf, size_t size) {
    size_t at = 0;
    if (size) buf[0] = 0;
    int n = 0, one = -1;
    for (int i = 0; i < list->kept; i++)
        if (chosen[i]) { n++; one = i; }
    if (n == 0) return;
    if (n == 1) PUT("%s %s was installed.", shown_name(&list->items[one]), list->items[one].to);
    else {
        names(list, chosen, buf, size, &at);
        PUT(" were installed.");
    }
    if (need == AUTO_FINISH_RESPRING) PUT(" Respring to finish.");
    else if (need == AUTO_FINISH_REBOOT) PUT(" Reboot to finish.");
}

void auto_failed_body(const struct upd_list *list, const unsigned char *chosen, char *buf, size_t size) {
    size_t at = 0;
    if (size) buf[0] = 0;
    int n = 0, one = -1;
    for (int i = 0; i < list->kept; i++)
        if (chosen[i]) { n++; one = i; }
    if (n == 0) return;
    if (n == 1) PUT("%s couldn't be updated automatically.", shown_name(&list->items[one]));
    else PUT("%d packages couldn't be updated automatically.", n);
}

/* snprintf at buf + *at, or only counted once it doesn't fit (upd_state's rule). */
static void append(char *buf, size_t size, size_t *at, const char *fmt, const char *s, long n) {
    int k = s ? snprintf(*at < size ? buf + *at : NULL, *at < size ? size - *at : 0, fmt, s)
              : snprintf(*at < size ? buf + *at : NULL, *at < size ? size - *at : 0, fmt, n);
    if (k > 0) *at += (size_t)k;
}

size_t auto_state(const struct upd_list *list, const unsigned char *chosen, int failed, const char *old_state,
                  long respring_since, char *buf, size_t size) {
    size_t at = 0;
    if (size) buf[0] = 0;
    for (int i = 0; i < list->kept; i++) {
        const struct upd_item *it = &list->items[i];
        char key[2 * UPD_FIELD + 2];
        snprintf(key, sizeof key, "%s=%s", it->id, it->to);
        if ((failed && chosen && chosen[i]) || has_line(old_state, "failed ", key, ""))
            append(buf, size, &at, "failed %s\n", key, 0);
    }
    if (respring_since > 0) append(buf, size, &at, "respring %ld\n", NULL, respring_since);
    return at;
}

#undef PUT

long auto_state_respring(const char *state) {
    for (const char *p = state; p && *p; ) {
        size_t n;
        const char *next = line(p, &n);
        if (n > 9 && !memcmp(p, "respring ", 9)) return strtol(p + 9, NULL, 10);
        p = next;
    }
    return 0;
}

int auto_state_waiting(const char *state) {
    for (const char *p = state; p && *p; ) {
        size_t n;
        const char *next = line(p, &n);
        const char *eq = memchr(p, '=', n);
        if (eq && eq > p && n < 2 * UPD_FIELD && memchr(p, ' ', n) == NULL) {
            char key[2 * UPD_FIELD];
            memcpy(key, p, n);
            key[n] = 0;
            if (!has_line(state, "failed ", key, "")) return 1;
        }
        p = next;
    }
    return 0;
}

/* F282: dpkg's version order (lib/dpkg/version.c verrevcmp), for one part: letters before other characters, '~'
 * before everything (the end included), digit runs compared as numbers. */
static int ver_order(int c) {
    if (c >= '0' && c <= '9') return 0;
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) return c;
    if (c == '~') return -1;
    if (c) return c + 256;
    return 0;
}

static int ver_part_cmp(const char *a, size_t la, const char *b, size_t lb) {
    size_t i = 0, j = 0;
    while (i < la || j < lb) {
        int diff = 0;
        while ((i < la && !(a[i] >= '0' && a[i] <= '9')) || (j < lb && !(b[j] >= '0' && b[j] <= '9'))) {
            int ac = i < la ? ver_order((unsigned char)a[i]) : 0;
            int bc = j < lb ? ver_order((unsigned char)b[j]) : 0;
            if (ac != bc) return ac - bc;
            i++;
            j++;
        }
        while (i < la && a[i] == '0') i++;
        while (j < lb && b[j] == '0') j++;
        while (i < la && j < lb && a[i] >= '0' && a[i] <= '9' && b[j] >= '0' && b[j] <= '9') {
            if (!diff) diff = a[i] - b[j];
            i++;
            j++;
        }
        if (i < la && a[i] >= '0' && a[i] <= '9') return 1;
        if (j < lb && b[j] >= '0' && b[j] <= '9') return -1;
        if (diff) return diff;
    }
    return 0;
}

/* A version's epoch (the digits before ':', 0 without one), upstream part and revision (after the last '-'). */
struct ver_parts { unsigned long epoch; const char *up; size_t lup; const char *rev; size_t lrev; };
static void ver_split(const char *v, size_t len, struct ver_parts *p) {
    const char *colon = memchr(v, ':', len);
    p->epoch = 0;
    if (colon) {
        for (const char *q = v; q < colon; q++) p->epoch = p->epoch * 10 + (unsigned long)(*q >= '0' && *q <= '9' ? *q - '0' : 0);
        len -= (size_t)(colon + 1 - v);
        v = colon + 1;
    }
    const char *dash = NULL;
    for (size_t i = 0; i < len; i++) if (v[i] == '-') dash = v + i;
    p->up = v;
    p->lup = dash ? (size_t)(dash - v) : len;
    p->rev = dash ? dash + 1 : v + len;
    p->lrev = dash ? len - p->lup - 1 : 0;
}

static int same_version_n(const char *a, size_t la, const char *b, size_t lb) {
    struct ver_parts x, y;
    ver_split(a, la, &x);
    ver_split(b, lb, &y);
    return x.epoch == y.epoch && !ver_part_cmp(x.up, x.lup, y.up, y.lup) && !ver_part_cmp(x.rev, x.lrev, y.rev, y.lrev);
}

static int ver_cmp(const char *a, const char *b) {
    struct ver_parts x, y;
    ver_split(a, strlen(a), &x);
    ver_split(b, strlen(b), &y);
    if (x.epoch != y.epoch) return x.epoch > y.epoch ? 1 : -1;
    int c = ver_part_cmp(x.up, x.lup, y.up, y.lup);
    return c ? c : ver_part_cmp(x.rev, x.lrev, y.rev, y.lrev);
}

int auto_same_version(const char *a, const char *b) {
    return a && b && same_version_n(a, strlen(a), b, strlen(b));
}

int auto_ignored(const char *settings, const char *id, const char *version) {
    size_t li = strlen(id);
    if (!li || !version || !version[0]) return 0;
    for (const char *p = settings; p && *p; ) {
        size_t n;
        const char *next = line(p, &n);
        if (n > 7 + li + 1 && !memcmp(p, "ignore=", 7) && !memcmp(p + 7, id, li) && p[7 + li] == '=')
            if (same_version_n(p + 8 + li, n - 8 - li, version, strlen(version))) return 1;
        p = next;
    }
    return 0;
}

int auto_drop_ignored(struct upd_list *list, const char *settings) {
    int k = 0, dropped = 0;
    for (int i = 0; i < list->kept; i++) {
        if (auto_ignored(settings, list->items[i].id, list->items[i].to)) { dropped++; continue; }
        if (k != i) list->items[k] = list->items[i];
        k++;
    }
    list->kept = k;
    list->n -= dropped;
    return dropped;
}

int auto_safe_id(const char *id) {
    size_t n = strlen(id);
    if (n < 1 || n > 255) return 0;
    for (size_t i = 0; i < n; i++) {
        char c = id[i];
        int an = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
        if (!an && (!i || !strchr("._+-", c))) return 0;
    }
    return 1;
}

/* <dir>/<name> into buf; 0 if it doesn't fit. */
static int join(char *buf, size_t size, const char *dir, const char *name) {
    int k = snprintf(buf, size, "%s/%s", dir, name);
    return k > 0 && (size_t)k < size;
}

static void set_mtime(const char *path, long t) {
    struct timespec ts[2] = {{t, 0}, {t, 0}};
    utimensat(AT_FDCWD, path, ts, 0);
}

/* Copy src to dst through a temp file and rename, mode 0644. */
static int copy_file(const char *src, const char *dst) {
    char tmp[4200];
    int k = snprintf(tmp, sizeof tmp, "%s.partial", dst);
    if (k < 0 || (size_t)k >= sizeof tmp) return 0;
    int in = open(src, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (in < 0) return 0;
    int out = open(tmp, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC | O_NOFOLLOW, 0644);
    if (out < 0) { close(in); return 0; }
    char buf[65536];
    ssize_t r;
    int ok = 1;
    while ((r = read(in, buf, sizeof buf)) != 0) {
        if (r < 0) { if (errno == EINTR) continue; ok = 0; break; }
        for (ssize_t off = 0; off < r; ) {
            ssize_t w = write(out, buf + off, (size_t)(r - off));
            if (w < 0) { if (errno == EINTR) continue; ok = 0; break; }
            off += w;
        }
        if (!ok) break;
    }
    close(in);
    if (close(out)) ok = 0;
    if (ok && rename(tmp, dst)) ok = 0;
    if (!ok) unlink(tmp);
    return ok;
}

int auto_stash(const char *cache, const char *rollback, const char *id, const char *version, long now, int touch) {
    if (!auto_safe_id(id)) return 0;
    char dir[4096], src[4096], dst[4096], ver[UPD_FIELD];
    if (!join(dir, sizeof dir, rollback, id)) return 0;
    /* Already stored (any arch)? */
    DIR *d = opendir(dir);
    if (d) {
        struct dirent *e;
        int have = 0;
        while ((e = readdir(d))) {
            if (auto_deb_version(e->d_name, id, ver, sizeof ver) && !strcmp(ver, version)) {
                have = 1;
                if (touch && join(dst, sizeof dst, dir, e->d_name)) set_mtime(dst, now);
            }
        }
        closedir(d);
        if (have) return 1;
    }
    d = opendir(cache);
    if (!d) return 0;
    int done = 0;
    struct dirent *e;
    while (!done && (e = readdir(d))) {
        if (!auto_deb_version(e->d_name, id, ver, sizeof ver) || strcmp(ver, version)) continue;
        if (!join(src, sizeof src, cache, e->d_name) || !join(dst, sizeof dst, dir, e->d_name)) continue;
        struct stat st;
        if (lstat(src, &st) || !S_ISREG(st.st_mode)) continue;
        mkdir(rollback, 0755);
        mkdir(dir, 0755);
        if (copy_file(src, dst)) { set_mtime(dst, now); done = 1; }
    }
    closedir(d);
    return done;
}

int auto_prune_dir(const char *rollback, const char *id, const char *installed, int keep) {
    if (!auto_safe_id(id)) return 0;
    char dir[4096], path[4096];
    if (!join(dir, sizeof dir, rollback, id)) return 0;
    DIR *d = opendir(dir);
    if (!d) return 0;
    size_t cap = 4096, at = 0;
    char *listing = malloc(cap);
    if (!listing) { closedir(d); return 0; }
    listing[0] = 0;
    struct dirent *e;
    while ((e = readdir(d))) {
        struct stat st;
        if (e->d_name[0] == '.' || !join(path, sizeof path, dir, e->d_name) || lstat(path, &st) || !S_ISREG(st.st_mode))
            continue;
        size_t need = strlen(e->d_name) + 32;
        if (at + need >= cap) {
            char *more = realloc(listing, cap = (at + need) * 2);
            if (!more) break;
            listing = more;
        }
        at += (size_t)snprintf(listing + at, cap - at, "%s %ld\n", e->d_name, (long)st.st_mtime);
    }
    closedir(d);
    char *out = malloc(at + 1);
    int n = 0;
    if (out) {
        auto_prune(listing, id, installed, keep, out, at + 1);
        for (char *p = out; *p; ) {
            char *nl = strchr(p, '\n');
            if (!nl) break;
            *nl = 0;
            if (join(path, sizeof path, dir, p) && !unlink(path)) n++;
            p = nl + 1;
        }
        free(out);
    }
    free(listing);
    rmdir(dir); /* only goes when empty */
    return n;
}

int auto_url_filename(const char *f) {
    if (!f || !((*f >= 'a' && *f <= 'z') || (*f >= 'A' && *f <= 'Z'))) return 0;
    const char *p = f + 1;
    while ((*p >= 'a' && *p <= 'z') || (*p >= 'A' && *p <= 'Z') || (*p >= '0' && *p <= '9') || *p == '+' || *p == '-' || *p == '.')
        p++;
    return p[0] == ':' && p[1] == '/' && p[2] == '/';
}

/* One stanza's fields as auto_linked reads them. */
struct stanza { char pkg[UPD_FIELD], ver[UPD_FIELD]; int url; };

static void stanza_end(struct stanza *st, const char *const *ids, const char *const *vers, int n, unsigned char *hit, int *hits) {
    if (st->url && st->pkg[0] && st->ver[0])
        for (int i = 0; i < n; i++)
            if (!hit[i] && !strcasecmp(ids[i], st->pkg) && !strcmp(vers[i], st->ver)) { hit[i] = 1; (*hits)++; }
    st->pkg[0] = st->ver[0] = 0;
    st->url = 0;
}

/* The field's value after "<key>:" and blanks, without the line's end, into val; 0 if the line isn't key's. */
static int field(const char *ln, const char *key, char *val, size_t size) {
    size_t kl = strlen(key);
    if (strncmp(ln, key, kl) || ln[kl] != ':') return 0;
    const char *v = ln + kl + 1;
    while (*v == ' ' || *v == '\t') v++;
    size_t vl = strcspn(v, "\r\n");
    while (vl && (v[vl - 1] == ' ' || v[vl - 1] == '\t')) vl--;
    if (vl >= size) vl = 0; /* longer than any id or version: no match */
    memcpy(val, v, vl);
    val[vl] = 0;
    return 1;
}

int auto_linked(const char *lists, const char *const *ids, const char *const *vers, int n, unsigned char *hit) {
    for (int i = 0; i < n; i++) hit[i] = 0;
    if (!lists || n <= 0) return 0;
    DIR *d = opendir(lists);
    if (!d) return 0;
    int hits = 0;
    struct dirent *e;
    char *buf = NULL;
    size_t cap = 0;
    while (hits < n && (e = readdir(d))) {
        size_t nl = strlen(e->d_name);
        char path[4096];
        if (nl < 9 || strcmp(e->d_name + nl - 9, "_Packages") || !join(path, sizeof path, lists, e->d_name)) continue;
        FILE *f = fopen(path, "r");
        if (!f) continue;
        struct stanza st = {{0}, {0}, 0};
        while (getline(&buf, &cap, f) > 0) {
            if (buf[0] == '\n' || (buf[0] == '\r' && buf[1] == '\n')) stanza_end(&st, ids, vers, n, hit, &hits);
            else if (field(buf, "Package", st.pkg, sizeof st.pkg) || field(buf, "Version", st.ver, sizeof st.ver)) {}
            else if (!strncmp(buf, "Filename:", 9)) {
                const char *v = buf + 9;
                while (*v == ' ' || *v == '\t') v++;
                st.url = auto_url_filename(v);
            }
        }
        stanza_end(&st, ids, vers, n, hit, &hits);
        fclose(f);
    }
    free(buf);
    closedir(d);
    return hits;
}

int auto_plan_installs(const char *plan, char (*ids)[UPD_FIELD], char (*vers)[UPD_FIELD], int max) {
    int k = 0;
    for (const char *p = plan; p && *p && k < max; ) {
        size_t n;
        const char *next = line(p, &n);
        if (n > 5 && !memcmp(p, "Inst ", 5)) {
            const char *a = p + 5, *end = p + n;
            size_t il = 0;
            while (a + il < end && a[il] != ' ' && a[il] != ':') il++;
            const char *o = memchr(a, '(', (size_t)(end - a));
            if (o && il && il < UPD_FIELD) {
                o++;
                size_t vl = 0;
                while (o + vl < end && o[vl] != ' ' && o[vl] != ')') vl++;
                if (vl && vl < UPD_FIELD) {
                    memcpy(ids[k], a, il); ids[k][il] = 0;
                    memcpy(vers[k], o, vl); vers[k][vl] = 0;
                    k++;
                }
            }
        }
        p = next;
    }
    return k;
}

/* B192: automatic installs take packages from https sources only. */
static char *slurp(const char *path);

int auto_list_prefix(const char *uri, char *out, size_t size) {
    if (!uri || !size) return 0;
    const char *p = strstr(uri, "://");
    if (p) p += 3;
    else {
        const char *c = strchr(uri, ':'), *s = strchr(uri, '/');
        p = c && (!s || c < s) ? c + 1 : uri;
    }
    /* user:password@ goes (only in the host part) */
    const char *s = strchr(p, '/');
    const char *host_end = s ? s : p + strlen(p);
    for (const char *a = p; a < host_end; a++)
        if (*a == '@') p = a + 1;
    static const char quoted[] = "\\|{}[]<>\"^~_=!@#$%^&*";
    size_t at = 0;
    for (const unsigned char *c = (const unsigned char *)p; *c; c++) {
        if (*c == '/') {
            if (at + 1 >= size) return 0;
            out[at++] = '_';
        } else if (*c <= 0x20 || *c >= 0x7f || strchr(quoted, *c)) {
            if (at + 3 >= size) return 0;
            snprintf(out + at, 4, "%%%02x", *c);
            at += 3;
        } else {
            if (at + 1 >= size) return 0;
            out[at++] = (char)*c;
        }
    }
    if (!at || out[at - 1] != '_') {
        if (at + 1 >= size) return 0;
        out[at++] = '_';
    }
    out[at] = 0;
    return 1;
}

static int lower(int c) { return c >= 'A' && c <= 'Z' ? c + 32 : c; }

/* 1 if the n bytes at a are word, case aside. */
static int same_word(const char *a, size_t n, const char *word) {
    if (strlen(word) != n) return 0;
    for (size_t i = 0; i < n; i++)
        if (lower((unsigned char)a[i]) != word[i]) return 0;
    return 1;
}

int auto_plain_http(const char *uri) {
    if (!uri) return 0;
    while (*uri == ' ' || *uri == '\t') uri++;
    const char *e = strstr(uri, "://");
    if (!e) return 0;
    size_t n = (size_t)(e - uri);
    if (same_word(uri, n, "http")) return 1;
    return n > 5 && same_word(e - 5, 5, "+http");
}

#define SRC_MAX 512
static struct { char prefix[1024]; int http; } srcs[SRC_MAX];
static int nsrc;

static void add_source(const char *uri, size_t len) {
    char u[1024];
    if (!len || len >= sizeof u || nsrc >= SRC_MAX) return;
    memcpy(u, uri, len);
    u[len] = 0;
    if (!auto_list_prefix(u, srcs[nsrc].prefix, sizeof srcs[nsrc].prefix)) return;
    srcs[nsrc].http = auto_plain_http(u);
    nsrc++;
}

static int blank(int c) { return c == ' ' || c == '\t' || c == '\r'; }

/* One-line style: "deb [options] uri dist [components]" per line, '#' comments. */
static void sources_list(const char *text) {
    for (const char *p = text; p && *p; ) {
        size_t n;
        const char *next = line(p, &n);
        const char *h = memchr(p, '#', n), *end = h ? h : p + n, *a = p;
        while (a < end && blank(*a)) a++;
        const char *w = a;
        while (a < end && !blank(*a)) a++;
        if (same_word(w, (size_t)(a - w), "deb")) {
            while (a < end && blank(*a)) a++;
            if (a < end && *a == '[') {
                const char *c = memchr(a, ']', (size_t)(end - a));
                a = c ? c + 1 : end;
                while (a < end && blank(*a)) a++;
            }
            w = a;
            while (a < end && !blank(*a)) a++;
            add_source(w, (size_t)(a - w));
        }
        p = next;
    }
}

/* deb822 style (*.sources): stanzas of Types:, URIs:, Enabled: (fields case aside, URIs may continue on
 * indented lines). */
static void sources_deb822(const char *text) {
    char uris[4096];
    size_t ul = 0;
    int deb = 0, enabled = 1, in_uris = 0;
    for (const char *p = text; ; ) {
        size_t n = 0;
        const char *next = p && *p ? line(p, &n) : NULL;
        const char *a = p, *end = p ? p + n : p;
        int empty = 1;
        for (const char *c = a; c && c < end; c++)
            if (!blank(*c)) { empty = 0; break; }
        if (!next || empty) {
            if (deb && enabled)
                for (size_t i = 0; i < ul; ) {
                    while (i < ul && blank(uris[i])) i++;
                    size_t j = i;
                    while (j < ul && !blank(uris[j])) j++;
                    add_source(uris + i, j - i);
                    i = j;
                }
            ul = 0;
            deb = in_uris = 0;
            enabled = 1;
            if (!next) break;
            p = next;
            continue;
        }
        if (*a == '#') { p = next; continue; }
        const char *val = NULL;
        if (blank(*a)) val = in_uris ? a : NULL;
        else {
            const char *colon = memchr(a, ':', n);
            in_uris = 0;
            if (colon) {
                size_t kl = (size_t)(colon - a);
                val = colon + 1;
                if (same_word(a, kl, "types")) {
                    for (const char *c = val; c < end; ) {
                        while (c < end && blank(*c)) c++;
                        const char *w = c;
                        while (c < end && !blank(*c)) c++;
                        if (same_word(w, (size_t)(c - w), "deb")) deb = 1;
                    }
                    val = NULL;
                } else if (same_word(a, kl, "enabled")) {
                    while (val < end && blank(*val)) val++;
                    const char *w = val;
                    while (val < end && !blank(*val)) val++;
                    enabled = !same_word(w, (size_t)(val - w), "no");
                    val = NULL;
                } else if (same_word(a, kl, "uris")) in_uris = 1;
                else val = NULL;
            }
        }
        if (val && ul + (size_t)(end - val) + 1 < sizeof uris) {
            uris[ul++] = ' ';
            memcpy(uris + ul, val, (size_t)(end - val));
            ul += (size_t)(end - val);
        }
        p = next;
    }
}

static void load_sources(const char *apt_dir) {
    nsrc = 0;
    char path[4096], dir[4096];
    if (join(path, sizeof path, apt_dir, "sources.list")) {
        char *t = slurp(path);
        if (t) sources_list(t);
        free(t);
    }
    if (!join(dir, sizeof dir, apt_dir, "sources.list.d")) return;
    DIR *d = opendir(dir);
    if (!d) return;
    struct dirent *e;
    while ((e = readdir(d))) {
        size_t nl = strlen(e->d_name);
        int list = nl > 5 && !strcmp(e->d_name + nl - 5, ".list");
        int deb822 = nl > 8 && !strcmp(e->d_name + nl - 8, ".sources");
        if (e->d_name[0] == '.' || !(list || deb822) || !join(path, sizeof path, dir, e->d_name)) continue;
        char *t = slurp(path);
        if (t) { if (list) sources_list(t); else sources_deb822(t); }
        free(t);
    }
    closedir(d);
}

/* Whether a lists file belongs to a plain-http source: the longest matching prefix decides, http on a tie. */
static int list_http(const char *name) {
    size_t best = 0;
    int http = 0;
    for (int i = 0; i < nsrc; i++) {
        size_t pl = strlen(srcs[i].prefix);
        if (pl < best || strncmp(name, srcs[i].prefix, pl)) continue;
        if (pl > best) { best = pl; http = srcs[i].http; }
        else http |= srcs[i].http;
    }
    return http;
}

int auto_insecure(const char *apt_dir, const char *lists, const char *const *ids, const char *const *vers, int n,
                  unsigned char *hit) {
    for (int i = 0; i < n; i++) hit[i] = 0;
    if (!apt_dir || !lists || n <= 0) return 0;
    load_sources(apt_dir);
    if (!nsrc) return 0;
    DIR *d = opendir(lists);
    if (!d) return 0;
    int hits = 0;
    struct dirent *e;
    char *buf = NULL;
    size_t cap = 0;
    while (hits < n && (e = readdir(d))) {
        size_t nl = strlen(e->d_name);
        char path[4096];
        if (nl < 9 || strcmp(e->d_name + nl - 9, "_Packages") || !list_http(e->d_name) ||
            !join(path, sizeof path, lists, e->d_name))
            continue;
        FILE *f = fopen(path, "r");
        if (!f) continue;
        struct stanza st = {{0}, {0}, 1}; /* url: 1, so stanza_end matches on id and version alone */
        while (getline(&buf, &cap, f) > 0) {
            if (buf[0] == '\n' || (buf[0] == '\r' && buf[1] == '\n')) { stanza_end(&st, ids, vers, n, hit, &hits); st.url = 1; }
            else if (field(buf, "Package", st.pkg, sizeof st.pkg) || field(buf, "Version", st.ver, sizeof st.ver)) {}
        }
        stanza_end(&st, ids, vers, n, hit, &hits);
        fclose(f);
    }
    free(buf);
    closedir(d);
    return hits;
}

/* A file's text (at most 16 MiB), malloc'd, or NULL. */
static char *slurp(const char *path) {
    int fd = open(path, O_RDONLY | O_CLOEXEC);
    if (fd < 0) return NULL;
    size_t cap = 65536, at = 0;
    char *b = malloc(cap);
    while (b) {
        if (at + 1 >= cap) {
            if (cap >= (16u << 20)) break;
            char *more = realloc(b, cap *= 2);
            if (!more) { free(b); b = NULL; break; }
            b = more;
        }
        ssize_t r = read(fd, b + at, cap - at - 1);
        if (r < 0 && errno == EINTR) continue;
        if (r <= 0) break;
        at += (size_t)r;
    }
    close(fd);
    if (b) b[at] = 0;
    return b;
}

/* path's text through a temp file and rename. */
static int write_atomic(const char *path, const char *text, size_t len) {
    char tmp[4096];
    int k = snprintf(tmp, sizeof tmp, "%s.new", path);
    if (k < 0 || (size_t)k >= sizeof tmp) return 0;
    int fd = open(tmp, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC | O_NOFOLLOW, 0644);
    if (fd < 0) return 0;
    int ok = write(fd, text, len) == (ssize_t)len;
    if (close(fd)) ok = 0;
    if (ok && rename(tmp, path)) ok = 0;
    if (!ok) unlink(tmp);
    return ok;
}

static void say(const struct auto_env *env, const char *fmt, ...) __attribute__((format(printf, 2, 3)));
static void say(const struct auto_env *env, const char *fmt, ...) {
    char msg[1024];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(msg, sizeof msg, fmt, ap);
    va_end(ap);
    if (env->say) env->say(env->ctx, msg);
}

/* The dpkg file list of an installed package: <info>/<id>.list, or <info>/<id>:<arch>.list. */
static char *file_list(const char *info, const char *id) {
    char path[4096], name[UPD_FIELD + 16];
    snprintf(name, sizeof name, "%s.list", id);
    if (join(path, sizeof path, info, name)) {
        char *t = slurp(path);
        if (t) return t;
    }
    DIR *d = opendir(info);
    if (!d) return NULL;
    size_t il = strlen(id);
    char *t = NULL;
    struct dirent *e;
    while (!t && (e = readdir(d))) {
        size_t n = strlen(e->d_name);
        if (n > il + 6 && !memcmp(e->d_name, id, il) && e->d_name[il] == ':' && !strcmp(e->d_name + n - 5, ".list") &&
            join(path, sizeof path, info, e->d_name))
            t = slurp(path);
    }
    closedir(d);
    return t;
}

/* Simulate dist-upgrade into list (names from dpkg's status). 0 when apt failed. */
/* F282: plan() less the upgrades at a version the user chose Ignore This Version for ("ignore=" settings lines): they
 * neither count (badge, notification, state) nor install by themselves; a newer version does both again. */
static int plan(const struct auto_env *env, struct upd_list *list);
static int plan_kept(const struct auto_env *env, struct upd_list *list, const char *settings) {
    if (!plan(env, list)) return 0;
    int k = auto_drop_ignored(list, settings);
    if (k) say(env, "%d upgrade%s at an ignored version left out", k, k == 1 ? "" : "s");
    return 1;
}

static int plan(const struct auto_env *env, struct upd_list *list) {
    char *out = NULL;
    int st = env->simulate(env->ctx, NULL, 0, &out);
    if (st != 0) {
        say(env, "apt-get -s dist-upgrade failed (%d); trying again later", st);
        free(out);
        return 0;
    }
    upd_parse_simulation(out ? out : "", list);
    free(out);
    char *status = slurp(env->status_path);
    upd_names_from_status(status, list);
    free(status);
    return 1;
}

static unsigned char chosen[UPD_MAX];
static const char *ids[UPD_MAX];
static const char *vers[UPD_MAX];
static unsigned char linked[UPD_MAX];
static char plan_ids[UPD_MAX][UPD_FIELD], plan_vers[UPD_MAX][UPD_FIELD];
static const char *pi[UPD_MAX], *pv[UPD_MAX];

int auto_step(const struct auto_env *env, int force, int update, int dry, struct upd_list *before,
              struct upd_list *after) {
    char *settings = env->settings ? env->settings(env->ctx) : NULL;
    char *state = slurp(env->state_path);
    struct auto_settings s;
    auto_settings_parse(settings, &s);
    long now = env->now(env->ctx);
    long last = upd_state_last(state);
    int net = env->net(env->ctx);
    int rc = 0, changed = 0;

    /* 1. A respring an earlier install left waiting for the lock. */
    long pending = auto_state_respring(state);
    if (pending) {
        if (s.respring != AUTO_RESPRING_LOCKED || !auto_respring_pending(pending, env->springboard_started(env->ctx), now)) {
            pending = 0;
            changed = 1;
        } else if (env->locked(env->ctx)) {
            say(env, "respringing for the update installed at %ld", pending);
            if (!dry) env->respring(env->ctx);
            pending = 0;
            changed = 1;
        }
    }

    /* 2. The check, when it is due. */
    int c = auto_check(&s, now, last, net, force);
    if (c == AUTO_WAIT_WIFI) say(env, "check due, but on cellular data and Use Cellular Data is off: later");
    int checked = c == AUTO_GO;
    /* 3. A plan: after a check, or when installs are on and allowed now and something may be waiting for them. */
    int may = auto_may_install(&s, env->charging(env->ctx), env->locked(env->ctx), net);
    int want = checked || (s.install != AUTO_INSTALL_OFF && may == AUTO_INSTALL_NOW && auto_state_waiting(state));
    if (!want) goto save;
    if (checked && update && env->update(env->ctx) != 0)
        say(env, "apt-get update failed; counting from the lists there are");
    if (!plan_kept(env, before, settings)) goto save;
    struct upd_list *now_list = before;

    /* 4. Automatic installs. */
    int failed = 0, need = AUTO_FINISH_NONE, installed = 0;
    int n = auto_pick(before, &s, settings, NULL, state, chosen);
    if (n > 0) {
        char *held = env->held ? env->held(env->ctx) : NULL;
        n = auto_pick(before, &s, settings, held, state, chosen);
        free(held);
    }
    if (n > 0 && may != AUTO_INSTALL_NOW)
        say(env, "%d to install automatically, waiting for %s", n, may == AUTO_WAIT_IDLE ? "charging and locked" : "a network");
    if (n > 0 && may == AUTO_INSTALL_NOW) {
        int k = 0;
        for (int i = 0; i < before->kept; i++)
            if (chosen[i] && auto_safe_id(before->items[i].id)) ids[k++] = before->items[i].id;
            else chosen[i] = 0;
        n = k;
    }
    /* B16: an upgrade whose .deb is a full-URL Filename 404s through apt: left to the app's queue (F131). */
    if (n > 0 && may == AUTO_INSTALL_NOW && env->lists_dir) {
        int k = 0;
        for (int i = 0; i < before->kept; i++)
            if (chosen[i]) { ids[k] = before->items[i].id; vers[k] = before->items[i].to; k++; }
        if (auto_linked(env->lists_dir, ids, vers, k, linked) > 0) {
            int j = 0, m = 0;
            for (int i = 0; i < before->kept; i++) {
                if (!chosen[i]) continue;
                if (linked[j++]) {
                    say(env, "%s %s downloads from a link apt can't fetch: left for the app's queue", before->items[i].id,
                        before->items[i].to);
                    chosen[i] = 0;
                } else ids[m++] = before->items[i].id;
            }
            n = m;
        }
    }
    /* B192: installs nobody tapped take packages from https sources only; an http one is left for a person. */
    if (n > 0 && may == AUTO_INSTALL_NOW && env->apt_dir && env->lists_dir) {
        int k = 0;
        for (int i = 0; i < before->kept; i++)
            if (chosen[i]) { ids[k] = before->items[i].id; vers[k] = before->items[i].to; k++; }
        if (auto_insecure(env->apt_dir, env->lists_dir, ids, vers, k, linked) > 0) {
            int j = 0, m = 0;
            for (int i = 0; i < before->kept; i++) {
                if (!chosen[i]) continue;
                if (linked[j++]) {
                    say(env, "%s %s comes from an http source: automatic installs take https only, left for you",
                        before->items[i].id, before->items[i].to);
                    chosen[i] = 0;
                } else ids[m++] = before->items[i].id;
            }
            n = m;
        }
    }
    if (n > 0 && may == AUTO_INSTALL_NOW && !dry && env->busy && env->busy(env->ctx)) {
        say(env, "dpkg is busy (another install): the automatic upgrades wait for the next start");
        n = 0;
    }
    if (n > 0 && may == AUTO_INSTALL_NOW) {
        char *out = NULL;
        int st = env->simulate(env->ctx, ids, n, &out);
        if (st != 0 || auto_plan_removes(out)) {
            say(env, st != 0 ? "apt-get -s install refused the automatic upgrades (%d)"
                             : "the automatic upgrades would remove packages (%d): left for you", st);
            failed = 1;
        } else if (env->lists_dir) {
            /* B16: a dependency apt would pull in from a link fails the same way: left for a person too. */
            int k = auto_plan_installs(out, plan_ids, plan_vers, UPD_MAX);
            for (int i = 0; i < k; i++) { pi[i] = plan_ids[i]; pv[i] = plan_vers[i]; }
            if (auto_linked(env->lists_dir, pi, pv, k, linked) > 0) {
                for (int i = 0; i < k; i++)
                    if (linked[i]) { say(env, "the automatic upgrades need %s %s, a link apt can't fetch: left for you", pi[i], pv[i]); break; }
                failed = 1;
            }
            /* B192: and a dependency from an http source. */
            if (!failed && env->apt_dir && auto_insecure(env->apt_dir, env->lists_dir, pi, pv, k, linked) > 0) {
                for (int i = 0; i < k; i++)
                    if (linked[i]) { say(env, "the automatic upgrades need %s %s, from an http source: left for you", pi[i], pv[i]); break; }
                failed = 1;
            }
        }
        free(out);
        if (dry) {
            say(env, "would install %d automatically", n);
        } else if (!failed) {
            for (int i = 0; i < before->kept; i++)
                if (chosen[i] && s.keep > 0) auto_stash(env->cache_dir, env->rollback_dir, before->items[i].id, before->items[i].from, now, 0);
            out = NULL;
            st = env->install(env->ctx, ids, n, &out);
            if (st != 0) {
                say(env, "apt-get install of the automatic upgrades failed (%d)", st);
                failed = 1;
            } else {
                installed = 1;
                need = auto_finish(out);
                for (int i = 0; i < before->kept; i++) {
                    if (!chosen[i]) continue;
                    const struct upd_item *it = &before->items[i];
                    if (need == AUTO_FINISH_NONE) {
                        char *list = file_list(env->info_dir, it->id);
                        if (auto_list_needs_respring(list)) need = AUTO_FINISH_RESPRING;
                        free(list);
                    }
                    if (s.keep > 0) auto_stash(env->cache_dir, env->rollback_dir, it->id, it->to, now, 1);
                    auto_prune_dir(env->rollback_dir, it->id, it->to, s.keep);
                }
            }
            free(out);
        }
        /* What's left to upgrade, for the badge and the state. */
        if (!dry && (installed || failed) && plan_kept(env, after, settings)) now_list = after;
    }

    int action = installed ? auto_respring_action(&s, need, env->locked(env->ctx)) : AUTO_DO_NOTHING;
    char title[UPD_TEXT], body[UPD_TEXT];
    if (installed) {
        auto_title(n, title, sizeof title);
        auto_body(before, chosen, action == AUTO_DO_NOTIFY ? need : AUTO_FINISH_NONE, body, sizeof body);
        say(env, "%s: %s", title, body);
        if (!dry) env->notify(env->ctx, AUTO_NOTE_UPDATED, now_list->n, title, body);
    } else if (failed && !dry) {
        auto_failed_body(before, chosen, body, sizeof body);
        env->notify(env->ctx, AUTO_NOTE_FAILED, now_list->n, "Update Failed", body);
    }
    if (action == AUTO_DO_WAIT) pending = now;

    /* 5. N5: the upgrades left, as a notification when one is new since the last, else the badge. */
    int fresh = checked && upd_fresh(now_list, state);
    upd_title(now_list->n, title, sizeof title);
    upd_body(now_list, body, sizeof body);
    say(env, "%d upgrades%s", now_list->n, fresh ? ", new since the last notification" : "");
    if (!dry) env->notify(env->ctx, fresh ? AUTO_NOTE_UPGRADES : AUTO_NOTE_BADGE, now_list->n, title, body);

    /* 6. The state. */
    if (!dry) {
        size_t a = upd_state(now_list, checked ? now : last, NULL, 0);
        size_t b = auto_state(before, chosen, failed, NULL, 0, NULL, 0);
        size_t c2 = auto_state(now_list, NULL, 0, state, pending, NULL, 0);
        char *text = malloc(a + b + c2 + 1);
        if (text) {
            upd_state(now_list, checked ? now : last, text, a + 1);
            auto_state(before, chosen, failed, NULL, 0, text + a, b + 1);
            auto_state(now_list, NULL, 0, state, pending, text + a + b, c2 + 1);
            if (!write_atomic(env->state_path, text, a + b + c2)) { say(env, "state: couldn't write %s", env->state_path); rc = 1; }
            free(text);
        }
        if (action == AUTO_DO_RESPRING) { say(env, "respringing (the phone is locked)"); env->respring(env->ctx); }
    }
    free(settings);
    free(state);
    return rc;

save:
    /* Nothing planned: only a cleared or new pending respring changes the state. */
    if (changed && !dry && state) {
        size_t len = strlen(state);
        char *text = malloc(len + 64);
        if (text) {
            size_t at = 0;
            for (const char *p = state; *p; ) {
                size_t ln;
                const char *next = line(p, &ln);
                if (!(ln > 9 && !memcmp(p, "respring ", 9))) { memcpy(text + at, p, ln); at += ln; text[at++] = '\n'; }
                p = next;
            }
            if (pending > 0) at += (size_t)snprintf(text + at, 64, "respring %ld\n", pending);
            if (!write_atomic(env->state_path, text, at)) rc = 1;
            free(text);
        }
    }
    free(settings);
    free(state);
    return rc;
}
