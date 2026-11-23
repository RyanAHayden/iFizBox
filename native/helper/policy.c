/* ifizbox-helper's checks: see policy.h. SPDX-License-Identifier: GPL-3.0-or-later */
#include "policy.h"
#include "ipa.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

int helper_name_ok(const char *s) {
    size_t n = strlen(s);
    if (n < 2 || n > HELPER_NAME_MAX) return 0;
    if (!((s[0] >= 'a' && s[0] <= 'z') || (s[0] >= '0' && s[0] <= '9'))) return 0; /* never an option */
    for (size_t i = 0; i < n; i++) {
        char c = s[i];
        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '+' || c == '-')) return 0;
    }
    return 1;
}

int helper_version_ok(const char *s) {
    size_t n = strlen(s);
    if (n < 1 || n > HELPER_VERSION_MAX || !(s[0] >= '0' && s[0] <= '9')) return 0;
    for (size_t i = 0; i < n; i++) {
        char c = s[i];
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || strchr(".+~:-", c)))
            return 0;
    }
    return 1;
}

static int alnum(char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9'); }

/* 1 if the "/"-separated path s (length n) has a "." or ".." segment ("" segments are fine: "a//b"). */
static int dot_segment(const char *s, size_t n) {
    size_t i = 0;
    while (i <= n) {
        size_t j = i;
        while (j < n && s[j] != '/') j++;
        size_t len = j - i;
        if ((len == 1 && s[i] == '.') || (len == 2 && s[i] == '.' && s[i + 1] == '.')) return 1;
        i = j + 1;
    }
    return 0;
}

int helper_uri_ok(const char *s) {
    size_t n = strlen(s);
    if (n > HELPER_URI_MAX) return 0;
    const char *p;
    if (!strncmp(s, "https://", 8)) p = s + 8;
    else if (!strncmp(s, "http://", 7)) p = s + 7;
    else return 0;
    const char *host = p;
    while (alnum(*p) || *p == '.' || *p == '-') p++;
    if (p == host || *host == '.' || *host == '-') return 0;
    if (*p == ':') {
        const char *port = ++p;
        while (*p >= '0' && *p <= '9') p++;
        if (p == port || p - port > 5) return 0;
    }
    if (*p != '/' || s[n - 1] != '/') return 0;
    for (const char *q = p; *q; q++)
        if (!(alnum(*q) || strchr("._~%+/:=,-", *q))) return 0;
    const char *last = s + n - 1; /* the final "/"; p is the first */
    return last == p || !dot_segment(p + 1, (size_t)(last - (p + 1)));
}

int helper_suite_ok(const char *s) {
    size_t n = strlen(s);
    if (n < 1 || n > HELPER_SUITE_MAX || s[0] == '-' || s[0] == '/') return 0;
    for (size_t i = 0; i < n; i++)
        if (!(alnum(s[i]) || strchr("._+/-", s[i]))) return 0;
    if (!strcmp(s, "./")) return 1; /* the flat repo's own directory */
    return !dot_segment(s, s[n - 1] == '/' ? n - 1 : n);
}

int helper_component_ok(const char *s) {
    size_t n = strlen(s);
    if (n < 1 || n > HELPER_COMPONENT_MAX || !alnum(s[0]) || s[n - 1] == '/') return 0;
    for (size_t i = 0; i < n; i++)
        if (!(alnum(s[i]) || strchr("._+/-", s[i]))) return 0;
    return !dot_segment(s, n);
}

int helper_ipa_path_ok(const char *dir, const char *path) {
    size_t d = strlen(dir);
    if (!d || strncmp(path, dir, d) || path[d] != '/') return 0;
    const char *name = path + d + 1;
    size_t n = strlen(name);
    if (n < 5 || n > HELPER_IPA_NAME_MAX || !alnum(name[0]) || strcmp(name + n - 4, ".ipa")) return 0;
    for (size_t i = 0; i < n; i++)
        if (!(alnum(name[i]) || strchr("._-", name[i]))) return 0;
    return !strstr(name, "..");
}

/* F59: install-ipa <path>: one IPA from the app's download directory. Nothing is executed from here: main.c hands
 * the plan to helper_install_ipa (ipa.c). */
static int ipa_plan(int argc, char *const argv[], struct helper_plan *p, const char **err) {
    if (argc != 2) { *err = "install-ipa takes one path"; return -1; }
    if (!helper_ipa_path_ok(HELPER_IPA_DIR, argv[1])) {
        *err = "bad IPA path (only " HELPER_IPA_DIR "/<name>.ipa)"; return -1;
    }
    if ((size_t)snprintf(p->path, sizeof p->path, "%s", argv[1]) >= sizeof p->path) { *err = "path too long"; return -1; }
    p->argv[0] = argv[0];
    p->argv[1] = argv[1];
    p->argv[2] = NULL;
    p->argc = 2;
    return 0;
}

int helper_paid_path_ok(const char *dir, const char *path) {
    size_t d = strlen(dir);
    if (!d || strncmp(path, dir, d) || path[d] != '/') return 0;
    const char *name = path + d + 1;
    size_t n = strlen(name);
    if (n < 5 || n > HELPER_IPA_NAME_MAX || !alnum(name[0]) || strcmp(name + n - 4, ".deb")) return 0;
    for (size_t i = 0; i < n; i++)
        if (!(alnum(name[i]) || strchr("._-", name[i]))) return 0;
    return !strstr(name, "..");
}

/* F57: install-paid <path> <id> <version>. The plan is apt-get install of p->deb; paid.c (helper_install_paid)
 * copies the caller's file into a root-owned directory, points p->deb at the copy and checks its control first. */
static int paid_plan(int argc, char *const argv[], const char *prefix, int status_fd, struct helper_plan *p,
                     const char **err) {
    static char status_apt[64], keep_fd[64];
    if (argc != 4) { *err = "install-paid takes a .deb path, a package name and a version"; return -1; }
    if (!helper_paid_path_ok(HELPER_PAID_DIR, argv[1])) { *err = "bad .deb path (only " HELPER_PAID_DIR "/<name>.deb)"; return -1; }
    if (!helper_name_ok(argv[2])) { *err = "bad package name (allowed: [a-z0-9][a-z0-9.+-]+)"; return -1; }
    if (!helper_version_ok(argv[3])) { *err = "bad version (a digit, then [A-Za-z0-9.+~:-])"; return -1; }
    snprintf(p->name_buf[0], sizeof p->name_buf[0], "%s", argv[2]);
    snprintf(p->item_buf[0], sizeof p->item_buf[0], "%s", argv[3]);
    if ((size_t)snprintf(p->deb, sizeof p->deb, "%s", argv[1]) >= sizeof p->deb) { *err = "path too long"; return -1; }
    if ((size_t)snprintf(p->path, sizeof p->path, "%s/usr/bin/apt-get", prefix) >= sizeof p->path) {
        *err = "prefix too long"; return -1;
    }
    int k = 0;
    const char **a = p->argv;
    a[k++] = "apt-get";
    a[k++] = "-y";
    a[k++] = "-o"; a[k++] = "Dpkg::Options::=--force-confdef";
    a[k++] = "-o"; a[k++] = "Dpkg::Options::=--force-confold";
    if (status_fd >= 0) {
        snprintf(keep_fd, sizeof keep_fd, "APT::Keep-Fds::=%d", status_fd);
        snprintf(status_apt, sizeof status_apt, "APT::Status-Fd=%d", status_fd);
        a[k++] = "-o"; a[k++] = keep_fd;
        a[k++] = "-o"; a[k++] = status_apt;
    }
    a[k++] = "install";
    a[k++] = p->deb; /* absolute: apt-get reads an argument with a "/" as a file */
    a[k] = NULL;
    p->argc = k;
    return 0;
}

/* N9: simulate-deb <path> | install-deb <path>. The plan is apt-get on p->deb; paid.c (helper_local_deb) copies the
 * caller's file into a root-owned directory and points p->deb at the copy. */
static int local_deb_plan(int argc, char *const argv[], const char *prefix, int status_fd, struct helper_plan *p,
                          const char **err) {
    static char status_apt[64], keep_fd[64];
    int sim = p->verb == HV_SIMULATE_DEB, ask = p->verb == HV_INSTALL_DEB_ASK;
    if (argc != 2) {
        *err = sim ? "simulate-deb takes one .deb path" : ask ? "install-deb-ask takes one .deb path"
                                                            : "install-deb takes one .deb path";
        return -1;
    }
    if (ask && status_fd < 0) { *err = "install-deb-ask needs the status fd (3) to ask on"; return -1; }
    if (!helper_paid_path_ok(HELPER_DEB_DIR, argv[1])) { *err = "bad .deb path (only " HELPER_DEB_DIR "/<name>.deb)"; return -1; }
    if ((size_t)snprintf(p->deb, sizeof p->deb, "%s", argv[1]) >= sizeof p->deb) { *err = "path too long"; return -1; }
    if ((size_t)snprintf(p->path, sizeof p->path, "%s/usr/bin/apt-get", prefix) >= sizeof p->path) {
        *err = "prefix too long"; return -1;
    }
    int k = 0;
    const char **a = p->argv;
    a[k++] = "apt-get";
    if (sim) a[k++] = "-s";
    else if (ask) a[k++] = "-y"; /* F239: dpkg asks about a conffile both sides changed; main.c relays the answer */
    else {
        a[k++] = "-y";
        a[k++] = "-o"; a[k++] = "Dpkg::Options::=--force-confdef";
        a[k++] = "-o"; a[k++] = "Dpkg::Options::=--force-confold";
    }
    a[k++] = "--reinstall";
    a[k++] = "--allow-downgrades";
    if (!sim && status_fd >= 0) {
        snprintf(keep_fd, sizeof keep_fd, "APT::Keep-Fds::=%d", status_fd);
        snprintf(status_apt, sizeof status_apt, "APT::Status-Fd=%d", status_fd);
        a[k++] = "-o"; a[k++] = keep_fd;
        a[k++] = "-o"; a[k++] = status_apt;
    }
    a[k++] = "install";
    a[k++] = p->deb; /* absolute: apt-get reads an argument with a "/" as a file */
    a[k] = NULL;
    p->argc = k;
    return 0;
}

/* addsource <uri> <suite> [component...] | removesource <uri> <suite>: checked here, done by helper_sources_apply. */
static int source_plan(int argc, char *const argv[], const char *prefix, struct helper_plan *p, const char **err) {
    int add = p->verb == HV_ADDSOURCE || p->verb == HV_UPDATE_SOURCE; /* F233a: update-source's words are addsource's */
    if (argc < 3) { *err = "needs a URI and a suite"; return -1; }
    if (!helper_uri_ok(argv[1])) {
        *err = "bad URI (http(s)://host[:port]/path/, ending in /, no user, spaces or . segments)"; return -1;
    }
    if (!helper_suite_ok(argv[2])) { *err = "bad suite"; return -1; }
    int flat = argv[2][strlen(argv[2]) - 1] == '/', ncomp = argc - 3;
    if (!add && ncomp) { *err = "removesource takes a URI and a suite only"; return -1; }
    if (add && flat && ncomp) { *err = "a flat suite (ending in /) takes no components"; return -1; }
    if (add && !flat && !ncomp) { *err = "a suite that isn't flat needs components"; return -1; }
    if (ncomp > HELPER_MAX_COMPONENTS) { *err = "too many components"; return -1; }
    for (int i = 3; i < argc; i++)
        if (!helper_component_ok(argv[i])) { *err = "bad component"; return -1; }
    if ((size_t)snprintf(p->path, sizeof p->path, "%s%s", prefix, HELPER_SOURCES_FILE) >= sizeof p->path) {
        *err = "prefix too long"; return -1;
    }
    for (int i = 0; i < argc; i++) p->argv[i] = argv[i];
    p->argv[argc] = NULL;
    p->argc = argc;
    return 0;
}

/* F233a: update-source <uri> <suite> [component...]: checked as addsource, then apt-get update on a sources file
 * holding only that source (made by helper_update_source_file, run and deleted by main.c). */
static int update_source_plan(int argc, char *const argv[], const char *prefix, int status_fd, struct helper_plan *p,
                              const char **err) {
    static char status_apt[64];
    if (source_plan(argc, argv, prefix, p, err)) return -1;
    if ((size_t)snprintf(p->path, sizeof p->path, "%s/usr/bin/apt-get", prefix) >= sizeof p->path ||
        (size_t)snprintf(p->source_tmp, sizeof p->source_tmp, "%s%s", prefix, HELPER_UPDATE_SOURCE_TMP) >=
            sizeof p->source_tmp) {
        *err = "prefix too long"; return -1;
    }
    snprintf(p->source_opt, sizeof p->source_opt, "Dir::Etc::SourceList=%s", p->source_tmp);
    /* One-line form: the file's name doesn't end in .sources, so apt reads it as a sources.list. Every word was
     * checked above (no spaces, newlines, '[' or '#'), so the line can't carry options or a second entry. */
    size_t n = (size_t)snprintf(p->source_line, sizeof p->source_line, "deb %s %s", argv[1], argv[2]);
    for (int i = 3; i < argc && n < sizeof p->source_line; i++)
        n += (size_t)snprintf(p->source_line + n, sizeof p->source_line - n, " %s", argv[i]);
    if (n + 1 >= sizeof p->source_line) { *err = "source too long"; return -1; }
    p->source_line[n++] = '\n';
    p->source_line[n] = 0;
    int k = 0;
    const char **a = p->argv;
    a[k++] = "apt-get";
    a[k++] = "-o"; a[k++] = "Acquire::AllowInsecureRepositories=true"; /* N6, as update */
    a[k++] = "-o"; a[k++] = p->source_opt;
    a[k++] = "-o"; a[k++] = "Dir::Etc::SourceParts=/dev/null";
    a[k++] = "-o"; a[k++] = "APT::Get::List-Cleanup=0";
    if (status_fd >= 0) {
        snprintf(status_apt, sizeof status_apt, "APT::Status-Fd=%d", status_fd);
        a[k++] = "-o"; a[k++] = status_apt;
    }
    a[k++] = "update";
    a[k] = NULL;
    p->argc = k;
    return 0;
}

int helper_update_source_file(struct helper_plan *p, const char **err) {
    if (p->verb != HV_UPDATE_SOURCE) { *err = "not the update-source verb"; errno = EINVAL; return -1; }
    int fd = mkstemp(p->source_tmp);
    if (fd < 0) { *err = "can't create the temp sources file"; return -1; }
    size_t len = strlen(p->source_line);
    ssize_t w = write(fd, p->source_line, len);
    int e = errno;
    if (close(fd) || w != (ssize_t)len) {
        if (w >= 0 && w != (ssize_t)len) e = EIO;
        unlink(p->source_tmp);
        errno = e;
        *err = "can't write the temp sources file";
        return -1;
    }
    snprintf(p->source_opt, sizeof p->source_opt, "Dir::Etc::SourceList=%s", p->source_tmp);
    return 0;
}

/* F65: notifications on|off: checked here, done by helper_notify_apply. */
static int notify_plan(int argc, char *const argv[], const char *prefix, struct helper_plan *p, const char **err) {
    if (argc != 2 || (strcmp(argv[1], "on") && strcmp(argv[1], "off"))) { *err = "notifications takes on or off"; return -1; }
    if ((size_t)snprintf(p->path, sizeof p->path, "%s%s", prefix, HELPER_NOTIFY_OFF) >= sizeof p->path) {
        *err = "prefix too long"; return -1;
    }
    p->argv[0] = "notifications";
    p->argv[1] = strcmp(argv[1], "on") ? "off" : "on";
    p->argv[2] = NULL;
    p->argc = 2;
    return 0;
}

int helper_notify_apply(const struct helper_plan *p, const char **err) {
    if (p->verb != HV_NOTIFICATIONS) { *err = "not the notifications verb"; return -1; }
    struct stat st;
    if (!strcmp(p->argv[1], "on")) {
        if (lstat(p->path, &st)) return errno == ENOENT ? 0 : (*err = "can't read upgrades.off", -1);
        if (!S_ISREG(st.st_mode)) { *err = "upgrades.off isn't a regular file"; return -1; }
        if (unlink(p->path) && errno != ENOENT) { *err = "can't delete upgrades.off"; return -1; }
        return 0;
    }
    char dir[PATH_MAX];
    snprintf(dir, sizeof dir, "%s", p->path);
    char *slash = strrchr(dir, '/');
    if (!slash) { *err = "bad upgrades.off path"; return -1; }
    *slash = 0;
    if (mkdir(dir, 0755) && errno != EEXIST) { *err = "can't create the ifizbox folder"; return -1; }
    if (lstat(dir, &st) || !S_ISDIR(st.st_mode)) { *err = "the ifizbox folder isn't a folder"; return -1; }
    int fd = open(p->path, O_WRONLY | O_CREAT | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK, 0644);
    if (fd < 0) { *err = "can't create upgrades.off"; return -1; }
    int bad = fstat(fd, &st) || !S_ISREG(st.st_mode);
    close(fd);
    if (bad) { *err = "upgrades.off isn't a regular file"; return -1; }
    return 0;
}

/* N4: simulate|apply <item>...: one apt-get install over the whole queue. simulate is apt-get -s (prints the
 * Inst/Remv/Conf lines the Confirm sheet lists, or apt's refusal); apply runs it, with Cydia's CYDIA fd kept open
 * for maintainer scripts (APT::Keep-Fds, main.c sets CYDIA="3 1") and downgrades allowed, as Downgrade asks for an
 * older version on purpose. --reinstall makes an item naming the installed version (Reinstall) do something. */
static int queue_plan(int argc, char *const argv[], const char *prefix, int status_fd, struct helper_plan *p,
                      const char **err) {
    static char status_apt[64], keep_fd[64];
    int n = argc - 1, apply = p->verb == HV_APPLY || p->verb == HV_APPLY_ASK;
    if (n < 1) { *err = "no packages"; return -1; }
    if (p->verb == HV_APPLY_ASK && status_fd < 0) { *err = "apply-ask needs the status fd (3) to ask on"; return -1; }
    if (n > HELPER_MAX_PACKAGES) { *err = "too many package names"; return -1; }
    for (int i = 0; i < n; i++) {
        const char *w = argv[i + 1];
        int rm = w[0] == '-';
        const char *name = rm ? w + 1 : w;
        const char *eq = rm ? NULL : strchr(name, '=');
        size_t len = eq ? (size_t)(eq - name) : strlen(name);
        if (len > HELPER_NAME_MAX) { *err = "bad package name (allowed: [a-z0-9][a-z0-9.+-]+)"; return -1; }
        memcpy(p->name_buf[i], name, len);
        p->name_buf[i][len] = 0;
        /* An install of a name ending in - or + would read to apt as a removal or an install modifier. */
        if (!helper_name_ok(p->name_buf[i]) || (!rm && (name[len - 1] == '-' || name[len - 1] == '+'))) {
            *err = "bad package name (allowed: [a-z0-9][a-z0-9.+-]+)"; return -1;
        }
        if (eq && !helper_version_ok(eq + 1)) { *err = "bad version (a digit, then [A-Za-z0-9.+~:-])"; return -1; }
        for (int j = 0; j < i; j++)
            if (!strcmp(p->name_buf[j], p->name_buf[i])) { *err = "a package is named twice"; return -1; }
        p->names[i] = p->name_buf[i];
        p->removing[i] = (char)rm;
        if (rm) snprintf(p->item_buf[i], sizeof p->item_buf[i], "%s-", p->name_buf[i]);
        else snprintf(p->item_buf[i], sizeof p->item_buf[i], "%s", name);
    }
    if ((size_t)snprintf(p->path, sizeof p->path, "%s/usr/bin/apt-get", prefix) >= sizeof p->path) {
        *err = "prefix too long"; return -1;
    }
    int k = 0;
    const char **a = p->argv;
    a[k++] = "apt-get";
    if (apply) {
        a[k++] = "-y";
        if (p->verb == HV_APPLY) { /* F63: apply-ask leaves the conffile question to dpkg, answered through main.c */
            a[k++] = "-o"; a[k++] = "Dpkg::Options::=--force-confdef";
            a[k++] = "-o"; a[k++] = "Dpkg::Options::=--force-confold";
        }
    } else {
        a[k++] = "-s";
    }
    a[k++] = "--reinstall";
    a[k++] = "--allow-downgrades";
    a[k++] = "--allow-unauthenticated"; /* N6: packages from unsigned repos (most of them); see update below */
    if (apply && status_fd >= 0) {
        snprintf(keep_fd, sizeof keep_fd, "APT::Keep-Fds::=%d", status_fd);
        snprintf(status_apt, sizeof status_apt, "APT::Status-Fd=%d", status_fd);
        a[k++] = "-o"; a[k++] = keep_fd;
        a[k++] = "-o"; a[k++] = status_apt;
    }
    a[k++] = "install";
    for (int i = 0; i < n; i++) a[k++] = p->item_buf[i];
    a[k] = NULL;
    p->argc = k;
    p->packages = p->names;
    p->npackages = n;
    return 0;
}

/* F63: dpkg's conffile prompt reads a line; only "Y" (install the package's copy) and "N" (keep yours) get through,
 * with an optional trailing \r. */
int helper_answer_ok(const char *line, size_t len) {
    if (len && line[len - 1] == '\r') len--;
    return len == 1 && (line[0] == 'Y' || line[0] == 'N');
}

int helper_cancel_ok(const char *line, size_t len) {
    if (len && line[len - 1] == '\r') len--;
    return len == 1 && line[0] == 'C';
}

/* N4: respring: Restart SpringBoard at the end of a run. sbreload when the jailbreak has it, else killall
 * backboardd (which takes SpringBoard with it), both from the prefix. */
static int respring_plan(int argc, const char *prefix, struct helper_plan *p, const char **err) {
    if (argc != 1) { *err = "this verb takes no arguments"; return -1; }
    if ((size_t)snprintf(p->path, sizeof p->path, "%s/usr/bin/sbreload", prefix) >= sizeof p->path) {
        *err = "prefix too long"; return -1;
    }
    int k = 0;
    if (access(p->path, X_OK) == 0) {
        p->argv[k++] = "sbreload";
    } else {
        snprintf(p->path, sizeof p->path, "%s/usr/bin/killall", prefix);
        p->argv[k++] = "killall";
        p->argv[k++] = "-9";
        p->argv[k++] = "backboardd";
    }
    p->argv[k] = NULL;
    p->argc = k;
    return 0;
}

/* N8: userspace-reboot: the Userspace Reboot intent and Control Center control. launchctl reboot userspace (iOS 15+),
 * from the prefix: the jailbreak ships launchctl there (the system has none). */
static int userspace_reboot_plan(int argc, const char *prefix, struct helper_plan *p, const char **err) {
    if (argc != 1) { *err = "this verb takes no arguments"; return -1; }
    if ((size_t)snprintf(p->path, sizeof p->path, "%s/usr/bin/launchctl", prefix) >= sizeof p->path) {
        *err = "prefix too long"; return -1;
    }
    p->argv[0] = "launchctl";
    p->argv[1] = "reboot";
    p->argv[2] = "userspace";
    p->argv[3] = NULL;
    p->argc = 3;
    return 0;
}

/* F151: uicache: the console's Reload Data after an app was installed. uikittools' uicache -a from the prefix, which
 * rebuilds the home screen's icon cache for every app there. */
static int uicache_plan(int argc, const char *prefix, struct helper_plan *p, const char **err) {
    if (argc != 1) { *err = "this verb takes no arguments"; return -1; }
    if ((size_t)snprintf(p->path, sizeof p->path, "%s/usr/bin/uicache", prefix) >= sizeof p->path) {
        *err = "prefix too long"; return -1;
    }
    p->argv[0] = "uicache";
    p->argv[1] = "-a";
    p->argv[2] = NULL;
    p->argc = 2;
    return 0;
}

/* --- F71: Roll Back to a .deb N7's daemon kept */

#ifndef IFIZBOX_ROOT_UID
#define IFIZBOX_ROOT_UID 0
#endif

int helper_deb_name_version(const char *file, const char *id, char *ver, size_t size) {
    size_t il = strlen(id), fl = strlen(file);
    if (!il || fl < il + 8 || memcmp(file, id, il) || file[il] != '_' || strcmp(file + fl - 4, ".deb")) return 0;
    const char *v = file + il + 1, *end = file + fl - 4, *us = NULL;
    for (const char *q = v; q < end; q++)
        if (*q == '_') { if (us) return 0; us = q; } /* exactly two "_": a version never has one */
    if (!us || us == v || us + 1 == end) return 0;
    for (const char *q = us + 1; q < end; q++)
        if (!((*q >= 'a' && *q <= 'z') || (*q >= '0' && *q <= '9') || *q == '-')) return 0;
    size_t at = 0;
    for (const char *q = v; q < us; q++) {
        char c = *q;
        if (c == '%') {
            if (us - q < 3 || q[1] != '3' || (q[2] != 'a' && q[2] != 'A')) return 0;
            c = ':';
            q += 2;
        }
        if (at + 1 >= size) return 0;
        ver[at++] = c;
    }
    ver[at] = 0;
    return helper_version_ok(ver);
}

/* A real directory (lstat: no link), owned by root_uid, not writable by group or others. */
static int safe_dir(const char *path, uid_t root_uid) {
    struct stat st;
    return !lstat(path, &st) && S_ISDIR(st.st_mode) && st.st_uid == root_uid && !(st.st_mode & 022);
}

static int safe_deb(const char *path, uid_t root_uid) {
    struct stat st;
    return !lstat(path, &st) && S_ISREG(st.st_mode) && st.st_uid == root_uid && !(st.st_mode & 022) && st.st_nlink == 1;
}

/* Open <dir>/<id> after the checks; *missing says the folder simply isn't there (nothing stored). */
static DIR *open_store(const char *dir, const char *id, uid_t root_uid, char *path, size_t size, int *missing,
                       const char **err) {
    struct stat st;
    *missing = 0;
    if (!helper_name_ok(id)) { *err = "bad package name (allowed: [a-z0-9][a-z0-9.+-]+)"; return NULL; }
    if ((size_t)snprintf(path, size, "%s/%s", dir, id) >= size) { *err = "prefix too long"; return NULL; }
    if (lstat(dir, &st) && errno == ENOENT) { *missing = 1; return NULL; }
    if (!safe_dir(dir, root_uid)) { *err = "the rollback folder isn't a root-owned directory only root can write"; return NULL; }
    if (lstat(path, &st) && errno == ENOENT) { *missing = 1; return NULL; }
    if (!safe_dir(path, root_uid)) { *err = "the package's rollback folder isn't a root-owned directory only root can write"; return NULL; }
    DIR *d = opendir(path);
    if (!d) *err = "can't read the rollback folder";
    return d;
}

int helper_rollback_file(const char *dir, const char *id, const char *version, uid_t root_uid, char *out, size_t size,
                         const char **err) {
    char path[PATH_MAX], ver[HELPER_VERSION_MAX + 1], file[PATH_MAX];
    int missing;
    if (!helper_version_ok(version)) { *err = "bad version (a digit, then [A-Za-z0-9.+~:-])"; return -1; }
    DIR *d = open_store(dir, id, root_uid, path, sizeof path, &missing, err);
    if (!d) {
        if (missing) *err = "no stored .deb of that version (Roll Back keeps only what automatic updates replaced)";
        return -1;
    }
    struct dirent *e;
    int found = 0, unsafe = 0;
    while (!found && (e = readdir(d))) {
        if (!helper_deb_name_version(e->d_name, id, ver, sizeof ver) || strcmp(ver, version)) continue;
        if ((size_t)snprintf(file, sizeof file, "%s/%s", path, e->d_name) >= sizeof file) continue;
        if (!safe_deb(file, root_uid)) { unsafe = 1; continue; }
        found = 1;
    }
    closedir(d);
    if (!found) {
        *err = unsafe ? "the stored .deb isn't a plain root-owned file only root can write"
                      : "no stored .deb of that version (Roll Back keeps only what automatic updates replaced)";
        return -1;
    }
    if ((size_t)snprintf(out, size, "%s", file) >= size) { *err = "path too long"; return -1; }
    return 0;
}

int helper_rollback_list(const char *dir, const char *id, uid_t root_uid, char *out, size_t size, const char **err) {
    char path[PATH_MAX], ver[HELPER_VERSION_MAX + 1], file[PATH_MAX];
    int missing, n = 0;
    size_t used = 0;
    if (size) out[0] = 0;
    DIR *d = open_store(dir, id, root_uid, path, sizeof path, &missing, err);
    if (!d) return missing ? 0 : -1;
    struct dirent *e;
    while (n < HELPER_ROLLBACK_MAX && (e = readdir(d))) {
        if (!helper_deb_name_version(e->d_name, id, ver, sizeof ver)) continue;
        if ((size_t)snprintf(file, sizeof file, "%s/%s", path, e->d_name) >= sizeof file || !safe_deb(file, root_uid)) continue;
        int w = snprintf(out + used, size - used, "%s %s\n", ver, e->d_name);
        if (w < 0 || (size_t)w >= size - used) break;
        used += (size_t)w;
        n++;
    }
    closedir(d);
    return n;
}

int helper_control_matches(const char *text, const char *id, const char *version) {
    int pkg = 0, ver = 0;
    const char *l = text;
    while (*l) {
        const char *e = strchr(l, '\n');
        size_t len = e ? (size_t)(e - l) : strlen(l);
        while (len && (l[len - 1] == '\r' || l[len - 1] == ' ' || l[len - 1] == '\t')) len--;
        const char *want = NULL;
        int *hit = NULL;
        size_t skip = 0;
        if (len > 8 && !strncmp(l, "Package:", 8)) { want = id; hit = &pkg; skip = 8; }
        else if (len > 8 && !strncmp(l, "Version:", 8)) { want = version; hit = &ver; skip = 8; }
        if (want) {
            const char *v = l + skip;
            size_t vl = len - skip;
            while (vl && (*v == ' ' || *v == '\t')) { v++; vl--; }
            if (*hit || strlen(want) != vl || memcmp(want, v, vl)) return 0; /* twice, or another value */
            *hit = 1;
        }
        if (!e) break;
        l = e + 1;
    }
    return pkg && ver;
}

int helper_rollback_verify(const char *prefix, const char *deb, const char *id, const char *version, const char **err) {
    char tool[PATH_MAX], path_env[PATH_MAX + 16];
    if ((size_t)snprintf(tool, sizeof tool, "%s/usr/bin/dpkg-deb", prefix) >= sizeof tool) { *err = "prefix too long"; return -1; }
    snprintf(path_env, sizeof path_env, "PATH=%s/usr/bin:/usr/bin:/bin", prefix);
    int fds[2];
    if (pipe(fds)) { *err = "can't read the .deb's control (pipe)"; return -1; }
    pid_t pid = fork();
    if (pid < 0) { close(fds[0]); close(fds[1]); *err = "can't read the .deb's control (fork)"; return -1; }
    if (pid == 0) {
        int null = open("/dev/null", O_RDWR);
        if (null < 0 || dup2(null, 0) < 0 || dup2(null, 2) < 0 || dup2(fds[1], 1) < 0) _exit(126);
        char *const argv[] = {"dpkg-deb", "-f", (char *)deb, "Package", "Version", NULL};
        char *const env[] = {path_env, "LANG=C", NULL};
        execve(tool, argv, env);
        _exit(126);
    }
    close(fds[1]);
    char buf[8192];
    size_t used = 0;
    for (;;) {
        ssize_t r = read(fds[0], buf + used, sizeof buf - 1 - used);
        if (r < 0 && errno == EINTR) continue;
        if (r <= 0) break;
        used += (size_t)r;
        if (used == sizeof buf - 1) break;
    }
    buf[used] = 0;
    close(fds[0]);
    int st;
    while (waitpid(pid, &st, 0) < 0)
        if (errno != EINTR) { *err = "can't read the .deb's control (wait)"; return -1; }
    if (!WIFEXITED(st) || WEXITSTATUS(st)) { *err = "dpkg-deb couldn't read the stored .deb's control"; return -1; }
    if (!helper_control_matches(buf, id, version)) { *err = "the stored .deb's control isn't that package and version"; return -1; }
    return 0;
}

/* rollbacks <id> | rollback <id> <version>. rollbacks runs nothing (main.c prints helper_rollback_list); rollback
 * plans apt-get install of the stored file, as apply does (downgrades allowed, Cydia's CYDIA fd kept). */
static int rollback_plan(int argc, char *const argv[], const char *prefix, int status_fd, struct helper_plan *p,
                         const char **err) {
    static char status_apt[64], keep_fd[64];
    int list = p->verb == HV_ROLLBACKS;
    if (list ? argc != 2 : argc != 3) { *err = list ? "rollbacks takes a package name" : "rollback takes a package name and a version"; return -1; }
    if (!helper_name_ok(argv[1])) { *err = "bad package name (allowed: [a-z0-9][a-z0-9.+-]+)"; return -1; }
    if (!list && !helper_version_ok(argv[2])) { *err = "bad version (a digit, then [A-Za-z0-9.+~:-])"; return -1; }
    char dir[PATH_MAX];
    if ((size_t)snprintf(dir, sizeof dir, "%s%s", prefix, HELPER_ROLLBACK_DIR) >= sizeof dir) { *err = "prefix too long"; return -1; }
    snprintf(p->name_buf[0], sizeof p->name_buf[0], "%s", argv[1]);
    if (list) {
        snprintf(p->path, sizeof p->path, "%s", dir);
        p->argv[0] = argv[0];
        p->argv[1] = p->name_buf[0];
        p->argv[2] = NULL;
        p->argc = 2;
        return 0;
    }
    snprintf(p->item_buf[0], sizeof p->item_buf[0], "%s", argv[2]);
    if (helper_rollback_file(dir, argv[1], argv[2], IFIZBOX_ROOT_UID, p->deb, sizeof p->deb, err)) return -1;
    if ((size_t)snprintf(p->path, sizeof p->path, "%s/usr/bin/apt-get", prefix) >= sizeof p->path) {
        *err = "prefix too long"; return -1;
    }
    int k = 0;
    const char **a = p->argv;
    a[k++] = "apt-get";
    a[k++] = "-y";
    a[k++] = "-o"; a[k++] = "Dpkg::Options::=--force-confdef";
    a[k++] = "-o"; a[k++] = "Dpkg::Options::=--force-confold";
    a[k++] = "--allow-downgrades";
    if (status_fd >= 0) {
        snprintf(keep_fd, sizeof keep_fd, "APT::Keep-Fds::=%d", status_fd);
        snprintf(status_apt, sizeof status_apt, "APT::Status-Fd=%d", status_fd);
        a[k++] = "-o"; a[k++] = keep_fd;
        a[k++] = "-o"; a[k++] = status_apt;
    }
    a[k++] = "install";
    a[k++] = p->deb; /* absolute: apt-get reads an argument with a "/" as a file */
    a[k] = NULL;
    p->argc = k;
    return 0;
}

/* I4: app-versions. Reads installd's containers (main.c prints ipa.c helper_app_versions); nothing is executed. */
static int app_versions_plan(int argc, struct helper_plan *p, const char **err) {
    if (argc != 1) { *err = "app-versions takes no arguments"; return -1; }
    snprintf(p->path, sizeof p->path, "%s", HELPER_APPS_DIR);
    p->argv[0] = "app-versions";
    p->argv[1] = NULL;
    p->argc = 1;
    return 0;
}

/* B46: uninstall-app <bundle id>. Runs nothing from here: main.c hands the id to ipa.c helper_uninstall_app, which
 * only takes an app it finds in installd's containers (HELPER_APPS_DIR). */
static int uninstall_app_plan(int argc, char *const argv[], struct helper_plan *p, const char **err) {
    if (argc != 2) { *err = "uninstall-app takes one bundle id"; return -1; }
    if (!helper_ipa_bundle_id_ok(argv[1])) { *err = "bad bundle id (allowed: [A-Za-z0-9.-])"; return -1; }
    snprintf(p->path, sizeof p->path, "%s", HELPER_APPS_DIR);
    p->argv[0] = argv[0];
    p->argv[1] = argv[1];
    p->argv[2] = NULL;
    p->argc = 2;
    return 0;
}

static int plan_words(int argc, char *const argv[], const char *prefix, int status_fd, struct helper_plan *p,
                      const char **err) {
    static char status_apt[64], status_dpkg[16];
    memset(p, 0, sizeof *p);
    if (argc < 1) { *err = "no verb (" HELPER_VERBS ")"; return -1; }
    const char *verb = argv[0];
    int wants_packages;
    if (!strcmp(verb, "update")) { p->verb = HV_UPDATE; wants_packages = 0; }
    else if (!strcmp(verb, "install")) { p->verb = HV_INSTALL; wants_packages = 1; }
    else if (!strcmp(verb, "remove")) { p->verb = HV_REMOVE; wants_packages = 1; }
    else if (!strcmp(verb, "upgrade")) { p->verb = HV_UPGRADE; wants_packages = 0; }
    else if (!strcmp(verb, "configure")) { p->verb = HV_CONFIGURE; wants_packages = 0; }
    else if (!strcmp(verb, "hold")) { p->verb = HV_HOLD; wants_packages = 1; }
    else if (!strcmp(verb, "unhold")) { p->verb = HV_UNHOLD; wants_packages = 1; }
    else if (!strcmp(verb, "showhold")) { p->verb = HV_SHOWHOLD; wants_packages = 0; }
    else if (!strcmp(verb, "auto")) { p->verb = HV_AUTO; wants_packages = 1; }
    else if (!strcmp(verb, "addsource")) { p->verb = HV_ADDSOURCE; return source_plan(argc, argv, prefix, p, err); }
    else if (!strcmp(verb, "removesource")) { p->verb = HV_REMOVESOURCE; return source_plan(argc, argv, prefix, p, err); }
    else if (!strcmp(verb, "simulate")) { p->verb = HV_SIMULATE; return queue_plan(argc, argv, prefix, status_fd, p, err); }
    else if (!strcmp(verb, "apply")) { p->verb = HV_APPLY; return queue_plan(argc, argv, prefix, status_fd, p, err); }
    else if (!strcmp(verb, "apply-ask")) { p->verb = HV_APPLY_ASK; return queue_plan(argc, argv, prefix, status_fd, p, err); }
    else if (!strcmp(verb, "respring")) { p->verb = HV_RESPRING; return respring_plan(argc, prefix, p, err); }
    else if (!strcmp(verb, "userspace-reboot")) { p->verb = HV_USERSPACE_REBOOT; return userspace_reboot_plan(argc, prefix, p, err); }
    else if (!strcmp(verb, "uicache")) { p->verb = HV_UICACHE; return uicache_plan(argc, prefix, p, err); }
    else if (!strcmp(verb, "install-ipa")) { p->verb = HV_INSTALL_IPA; return ipa_plan(argc, argv, p, err); }
    else if (!strcmp(verb, "rollbacks")) { p->verb = HV_ROLLBACKS; return rollback_plan(argc, argv, prefix, status_fd, p, err); }
    else if (!strcmp(verb, "rollback")) { p->verb = HV_ROLLBACK; return rollback_plan(argc, argv, prefix, status_fd, p, err); }
    else if (!strcmp(verb, "install-paid")) { p->verb = HV_INSTALL_PAID; return paid_plan(argc, argv, prefix, status_fd, p, err); }
    else if (!strcmp(verb, "notifications")) { p->verb = HV_NOTIFICATIONS; return notify_plan(argc, argv, prefix, p, err); }
    else if (!strcmp(verb, "simulate-deb")) { p->verb = HV_SIMULATE_DEB; return local_deb_plan(argc, argv, prefix, status_fd, p, err); }
    else if (!strcmp(verb, "install-deb")) { p->verb = HV_INSTALL_DEB; return local_deb_plan(argc, argv, prefix, status_fd, p, err); }
    else if (!strcmp(verb, "install-deb-ask")) { p->verb = HV_INSTALL_DEB_ASK; return local_deb_plan(argc, argv, prefix, status_fd, p, err); }
    else if (!strcmp(verb, "app-versions")) { p->verb = HV_APP_VERSIONS; return app_versions_plan(argc, p, err); }
    else if (!strcmp(verb, "uninstall-app")) { p->verb = HV_UNINSTALL_APP; return uninstall_app_plan(argc, argv, p, err); }
    else if (!strcmp(verb, "update-source")) { p->verb = HV_UPDATE_SOURCE; return update_source_plan(argc, argv, prefix, status_fd, p, err); }
    else { *err = "unknown verb (" HELPER_VERBS ")"; return -1; }

    int n = argc - 1;
    if (!wants_packages && n) { *err = "this verb takes no arguments"; return -1; }
    if (wants_packages && n < 1) { *err = "no package names"; return -1; }
    if (n > HELPER_MAX_PACKAGES) { *err = "too many package names"; return -1; }
    for (int i = 1; i < argc; i++)
        if (!helper_name_ok(argv[i])) { *err = "bad package name (allowed: [a-z0-9][a-z0-9.+-]+)"; return -1; }

    int mark = p->verb == HV_HOLD || p->verb == HV_UNHOLD || p->verb == HV_SHOWHOLD || p->verb == HV_AUTO;
    const char *tool = p->verb == HV_CONFIGURE ? "dpkg" : mark ? "apt-mark" : "apt-get";
    if ((size_t)snprintf(p->path, sizeof p->path, "%s/usr/bin/%s", prefix, tool) >= sizeof p->path) {
        *err = "prefix too long"; return -1;
    }

    int k = 0;
    const char **a = p->argv;
    a[k++] = tool;
    if (p->verb == HV_CONFIGURE) {
        /* stdin is /dev/null: keep the old conffile unless the package's default says otherwise, never ask. */
        a[k++] = "--force-confdef";
        a[k++] = "--force-confold";
        if (status_fd >= 0) {
            snprintf(status_dpkg, sizeof status_dpkg, "%d", status_fd);
            a[k++] = "--status-fd";
            a[k++] = status_dpkg;
        }
        a[k++] = "--configure";
        a[k++] = "-a";
    } else if (mark) {
        /* apt-mark has no progress to report: no status fd. Only a name dpkg knows gets here (helper_first_unknown),
         * so apt-mark never reads one as a pattern. */
        a[k++] = verb; /* hold, unhold, showhold or auto: the literals checked above */
        p->packages = (const char *const *)&a[k];
        p->npackages = n;
        for (int i = 1; i < argc; i++) a[k++] = argv[i];
    } else {
        if (p->verb != HV_UPDATE) {
            a[k++] = "-y";
            a[k++] = "-o"; a[k++] = "Dpkg::Options::=--force-confdef";
            a[k++] = "-o"; a[k++] = "Dpkg::Options::=--force-confold";
            a[k++] = "--allow-unauthenticated";
        } else {
            /* N6: most jailbreak repos (BigBoss, iFizBox's own, repo.palera.in with its key missing) are unsigned, and
             * apt-get update exits 100 on one. Read them, as Sileo and Zebra do. A repo that was signed still can't
             * go unsigned unnoticed: Acquire::AllowDowngradeToInsecureRepositories stays false. */
            a[k++] = "-o"; a[k++] = "Acquire::AllowInsecureRepositories=true";
        }
        if (status_fd >= 0) {
            snprintf(status_apt, sizeof status_apt, "APT::Status-Fd=%d", status_fd);
            a[k++] = "-o";
            a[k++] = status_apt;
        }
        a[k++] = verb; /* one of the literals checked above */
        p->packages = (const char *const *)&a[k];
        p->npackages = n;
        for (int i = 1; i < argc; i++) a[k++] = argv[i];
    }
    a[k] = NULL;
    p->argc = k;
    return 0;
}

/* B329: every apt-get and apt-mark the helper runs skips Translation files (Acquire::Languages=none). The app reads
 * descriptions from Packages and never uses them, and a repo that answers its Translation URL with a web page (HTTP
 * 200, no hash in its Release to catch it: repo.twickd.com) left a file in apt's lists that apt can't parse, which
 * made every apt command, simulate included, fail with "Encountered a section with no Package: header". With the
 * option apt never reads such a file, and update's list cleanup deletes the one already there. */
static void skip_translations(struct helper_plan *p) {
    if (!p->argv[0] || (strcmp(p->argv[0], "apt-get") && strcmp(p->argv[0], "apt-mark"))) return;
    const char **a = p->argv;
    if ((size_t)p->argc + 3 > sizeof p->argv / sizeof *p->argv) return; /* never: the longest plan leaves room */
    int inside =p->packages >= (const char *const *)a && p->packages < (const char *const *)a + p->argc;
    memmove(a + 3, a + 1, sizeof *a * (size_t)p->argc); /* argv[1..argc], the NULL included */
    a[1] = "-o";
    a[2] = HELPER_APT_NO_TRANSLATIONS;
    p->argc += 2;
    if (inside) p->packages += 2;
}

int helper_plan(int argc, char *const argv[], const char *prefix, int status_fd, struct helper_plan *p,
                const char **err) {
    int r = plan_words(argc, argv, prefix, status_fd, p, err);
    if (!r) skip_translations(p);
    return r;
}

/* Mark in found[] every package named by a "Package: <name>" line of path. A missing file is no error. */
static void scan(const char *path, const struct helper_plan *p, char *found) {
    FILE *f = fopen(path, "r");
    if (!f) return;
    char *line = NULL;
    size_t cap = 0;
    ssize_t len;
    while ((len = getline(&line, &cap, f)) >= 0) {
        if (strncmp(line, "Package:", 8)) continue;
        char *s = line + 8, *e = line + len;
        while (s < e && (*s == ' ' || *s == '\t')) s++;
        while (e > s && (e[-1] == '\n' || e[-1] == '\r' || e[-1] == ' ' || e[-1] == '\t')) e--;
        size_t n = (size_t)(e - s);
        for (int i = 0; i < p->npackages; i++)
            if (!found[i] && strlen(p->packages[i]) == n && !memcmp(p->packages[i], s, n)) found[i] = 1;
    }
    free(line);
    fclose(f);
}

static int first_missing(const struct helper_plan *p, const char *found) {
    for (int i = 0; i < p->npackages; i++)
        if (!found[i]) return i;
    return -1;
}

int helper_first_unknown(const char *prefix, const struct helper_plan *p) {
    int queue = p->verb == HV_SIMULATE || p->verb == HV_APPLY || p->verb == HV_APPLY_ASK;
    if (p->verb != HV_INSTALL && p->verb != HV_REMOVE && p->verb != HV_HOLD && p->verb != HV_UNHOLD && p->verb != HV_AUTO &&
        !queue) return -1;
    char found[HELPER_MAX_PACKAGES] = {0};
    char path[PATH_MAX];
    snprintf(path, sizeof path, "%s/var/lib/dpkg/status", prefix);
    scan(path, p, found);
    if (queue) {
        /* A removal must be installed; only installs may be found in apt's lists. */
        for (int i = 0; i < p->npackages; i++)
            if (p->removing[i] && !found[i]) return i;
    } else if (p->verb != HV_INSTALL || first_missing(p, found) < 0) {
        return first_missing(p, found);
    }
    if (first_missing(p, found) < 0) return -1;

    snprintf(path, sizeof path, "%s/var/lib/apt/lists", prefix);
    DIR *d = opendir(path);
    if (d) {
        struct dirent *de;
        while ((de = readdir(d)) && first_missing(p, found) >= 0) {
            size_t n = strlen(de->d_name);
            if (n < 9 || strcmp(de->d_name + n - 9, "_Packages")) continue;
            char file[PATH_MAX];
            if ((size_t)snprintf(file, sizeof file, "%s/%s", path, de->d_name) >= sizeof file) continue;
            scan(file, p, found);
        }
        closedir(d);
    }
    return first_missing(p, found);
}

int helper_caller_ok(uid_t uid, uid_t euid, uid_t root_uid, const char *parent_exe, const char *expected_exe,
                     const char **err) {
    if (uid != root_uid || euid != root_uid) {
        *err = "not root: the app must spawn the helper with the root persona";
        return -1;
    }
    struct stat a, b;
    if (!parent_exe || stat(parent_exe, &a) || stat(expected_exe, &b)) {
        *err = "can't identify the calling process";
        return -1;
    }
    if (a.st_dev != b.st_dev || a.st_ino != b.st_ino) {
        *err = "the calling process isn't the installed app";
        return -1;
    }
    return 0;
}

/* --- F33: ifizbox.sources */

#define SOURCES_MAX (1 << 20) /* a bigger ifizbox.sources isn't ours: refuse rather than rewrite it */

struct buf { char *s; size_t n, cap; };

static int put(struct buf *b, const char *s, size_t n) {
    if (b->n + n + 1 > b->cap) {
        size_t cap = b->cap ? b->cap : 1024;
        while (b->n + n + 1 > cap) cap *= 2;
        char *t = realloc(b->s, cap);
        if (!t) return -1;
        b->s = t;
        b->cap = cap;
    }
    memcpy(b->s + b->n, s, n);
    b->n += n;
    b->s[b->n] = 0;
    return 0;
}
static int puts_(struct buf *b, const char *s) { return put(b, s, strlen(s)); }

/* The value of field `name` (case-insensitive) in the stanza st[0..n), continuation lines folded in with one space,
 * comment lines skipped, whitespace trimmed, into out (size cap); "" when the field isn't there. */
static void field(const char *st, size_t n, const char *name, char *out, size_t cap) {
    size_t used = 0, nl = strlen(name);
    int in = 0;
    out[0] = 0;
    for (size_t i = 0; i < n;) {
        size_t j = i;
        while (j < n && st[j] != '\n') j++;
        const char *l = st + i, *v;
        size_t len = j - i, vl;
        i = j + 1;
        if (len && l[0] == '#') continue;
        if (len && (l[0] == ' ' || l[0] == '\t')) {
            if (!in) continue;
            v = l; vl = len;
        } else {
            in = len > nl && l[nl] == ':' && !strncasecmp(l, name, nl);
            if (!in) continue;
            v = l + nl + 1; vl = len - nl - 1;
        }
        while (vl && (*v == ' ' || *v == '\t' || *v == '\r')) { v++; vl--; }
        while (vl && (v[vl - 1] == ' ' || v[vl - 1] == '\t' || v[vl - 1] == '\r')) vl--;
        if (!vl) continue;
        if (used && used + 1 < cap) out[used++] = ' ';
        if (used + vl >= cap) vl = cap - 1 - used;
        memcpy(out + used, v, vl);
        used += vl;
        out[used] = 0;
    }
}

/* 1 if the stanza names exactly this one URI and this one suite. A hand-written stanza with more URIs or suites
 * is left as it is. */
static int names(const char *st, size_t n, const char *uri, const char *suite) {
    char u[HELPER_URI_MAX + 64], s[HELPER_SUITE_MAX + 64];
    field(st, n, "URIs", u, sizeof u);
    field(st, n, "Suites", s, sizeof s);
    return !strcmp(u, uri) && !strcmp(s, suite);
}

/* The whole of path into b (b->s is never NULL after a 0 return); a missing file is empty. */
static int read_all(const char *path, struct buf *b, const char **err) {
    if (puts_(b, "")) { *err = "out of memory"; return -1; }
    int fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    if (fd < 0) {
        if (errno == ENOENT) return 0;
        *err = "can't read ifizbox.sources";
        return -1;
    }
    struct stat st;
    if (fstat(fd, &st) || !S_ISREG(st.st_mode) || st.st_size > SOURCES_MAX) {
        close(fd);
        *err = "ifizbox.sources isn't a regular file of at most 1 MiB";
        return -1;
    }
    char chunk[8192];
    ssize_t r;
    while ((r = read(fd, chunk, sizeof chunk)) != 0) {
        if (r < 0 && errno == EINTR) continue;
        if (r < 0 || b->n + (size_t)r > SOURCES_MAX || put(b, chunk, (size_t)r)) {
            close(fd);
            *err = "can't read ifizbox.sources";
            return -1;
        }
    }
    close(fd);
    return 0;
}

static int write_all(int fd, const char *s, size_t n) {
    while (n) {
        ssize_t w = write(fd, s, n);
        if (w < 0 && errno == EINTR) continue;
        if (w <= 0) return -1;
        s += w;
        n -= (size_t)w;
    }
    return 0;
}

/* Write text to path through a temp file beside it and rename(2); empty text removes the file. */
static int replace_file(const char *path, const char *text, size_t n, const char **err) {
    char dir[PATH_MAX], tmp[PATH_MAX];
    snprintf(dir, sizeof dir, "%s", path);
    char *slash = strrchr(dir, '/');
    if (!slash) { *err = "bad sources path"; return -1; }
    *slash = 0;
    if (!n) {
        if (unlink(path) && errno != ENOENT) { *err = "can't remove ifizbox.sources"; return -1; }
        return 0;
    }
    if ((size_t)snprintf(tmp, sizeof tmp, "%s/.ifizbox.sources.XXXXXX", dir) >= sizeof tmp) {
        *err = "prefix too long"; return -1;
    }
    /* The name starts with "." and has no .sources/.list suffix, so apt ignores it if we die before the rename. */
    int fd = mkstemp(tmp);
    if (fd < 0) { *err = "can't create a temp file in sources.list.d"; return -1; }
    if (fchmod(fd, 0644) || write_all(fd, text, n) || fsync(fd)) {
        close(fd);
        unlink(tmp);
        *err = "can't write ifizbox.sources";
        return -1;
    }
    if (close(fd) || rename(tmp, path)) {
        unlink(tmp);
        *err = "can't replace ifizbox.sources";
        return -1;
    }
    return 0;
}

int helper_sources_apply(const struct helper_plan *p, int *changed, const char **err) {
    *changed = 0;
    if (p->verb != HV_ADDSOURCE && p->verb != HV_REMOVESOURCE) { *err = "not a source verb"; return -1; }
    const char *uri = p->argv[1], *suite = p->argv[2];
    struct buf old = {0}, out = {0}, mine = {0};
    int rc = -1, lock = -1;

    /* Two helpers at once (two adds from the app) would each read the old file and one add would be lost: hold
     * an exclusive flock on sources.list.d (made if missing; its parent etc/apt must be there) for the edit. */
    char dir[PATH_MAX];
    snprintf(dir, sizeof dir, "%s", p->path);
    char *slash = strrchr(dir, '/');
    if (!slash) { *err = "bad sources path"; return -1; }
    *slash = 0;
    if (mkdir(dir, 0755) && errno != EEXIST) { *err = "can't create sources.list.d"; return -1; }
    lock = open(dir, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (lock < 0 || flock(lock, LOCK_EX)) {
        if (lock >= 0) close(lock);
        *err = "can't lock sources.list.d";
        return -1;
    }
    if (read_all(p->path, &old, err) || puts_(&out, "")) goto done;

    if (p->verb == HV_ADDSOURCE) {
        int bad = puts_(&mine, "Types: deb\nURIs: ") || puts_(&mine, uri) || puts_(&mine, "\nSuites: ") ||
                  puts_(&mine, suite);
        if (p->argc > 3) {
            bad |= puts_(&mine, "\nComponents:");
            for (int i = 3; i < p->argc; i++) bad |= puts_(&mine, " ") || puts_(&mine, p->argv[i]);
        }
        if (bad) { *err = "out of memory"; goto done; }
    }

    /* Stanzas are separated by blank lines. Each is copied as it is (one blank line between them), except those
     * naming this source: the first becomes ours (addsource), the rest go. Not there: ours goes at the end. */
    int placed = p->verb == HV_REMOVESOURCE;
    size_t i = 0, n = old.n;
    while (i < n) {
        size_t start = i, end = i;
        while (i < n) {
            size_t j = i;
            while (j < n && old.s[j] != '\n') j++;
            int blank = 1;
            for (size_t k = i; k < j; k++)
                if (old.s[k] != ' ' && old.s[k] != '\t' && old.s[k] != '\r') blank = 0;
            i = j < n ? j + 1 : n;
            if (!blank) { end = j; continue; }
            if (end > start) break;
            start = end = i;
        }
        if (end <= start) continue;
        const char *keep = old.s + start;
        size_t keeplen = end - start;
        if (names(keep, keeplen, uri, suite)) {
            if (placed) continue;
            placed = 1;
            keep = mine.s;
            keeplen = mine.n;
        }
        if ((out.n && put(&out, "\n", 1)) || put(&out, keep, keeplen) || put(&out, "\n", 1)) {
            *err = "out of memory"; goto done;
        }
    }
    if (!placed && ((out.n && put(&out, "\n", 1)) || put(&out, mine.s, mine.n) || put(&out, "\n", 1))) {
        *err = "out of memory"; goto done;
    }

    rc = 0;
    if (out.n == old.n && !memcmp(out.s, old.s, out.n)) goto done;
    if (replace_file(p->path, out.s, out.n, err)) { rc = -1; goto done; }
    *changed = 1;
done:
    close(lock);
    free(old.s);
    free(out.s);
    free(mine.s);
    return rc;
}

/* B348: web pages saved as apt lists. */

#define WEB_LIST_URIS 512
static char web_uris[WEB_LIST_URIS][HELPER_URI_MAX + 2];
static int web_nuris;

static void web_add_uri(const char *s, size_t n) {
    if (web_nuris >= WEB_LIST_URIS || !n || n > HELPER_URI_MAX) return;
    if (strncasecmp(s, "http://", 7) && strncasecmp(s, "https://", 8)) return;
    memcpy(web_uris[web_nuris], s, n);
    if (s[n - 1] != '/') web_uris[web_nuris][n++] = '/'; /* apt reads a source URI as a folder */
    web_uris[web_nuris][n] = 0;
    for (int i = 0; i < web_nuris; i++)
        if (!strcmp(web_uris[i], web_uris[web_nuris])) return;
    web_nuris++;
}

/* Every http(s) word in one line of a sources file, one-line (deb <uri> ...) or deb822 (URIs: <uri> ...) alike. */
static void web_read_line(char *line) {
    char *hash = strchr(line, '#');
    if (hash) *hash = 0;
    for (char *s = line; *s;) {
        while (*s == ' ' || *s == '\t' || *s == '\r' || *s == '\n') s++;
        size_t n = strcspn(s, " \t\r\n");
        web_add_uri(s, n);
        s += n;
    }
}

static void web_read_sources(const char *path) {
    FILE *f = fopen(path, "re");
    if (!f) return;
    char line[4096];
    while (fgets(line, sizeof line, f)) web_read_line(line);
    fclose(f);
}

/* apt's URItoFileName: the URI without scheme or user, the bytes apt quotes as %xx, then "/" as "_". */
static int web_list_prefix(const char *uri, char *out, size_t size) {
    const char *s = strstr(uri, "://");
    s = s ? s + 3 : uri;
    const char *at = strchr(s, '@'), *slash = strchr(s, '/');
    if (at && (!slash || at < slash)) s = at + 1;
    size_t n = 0;
    for (; *s; s++) {
        unsigned char c = (unsigned char)*s;
        if (n + 4 >= size) return -1;
        if (c <= 0x20 || c >= 0x7f || strchr("\\|{}[]<>\"^~_=!@#$%&*", c)) n += (size_t)snprintf(out + n, 4, "%%%02x", c);
        else out[n++] = c == '/' ? '_' : (char)c;
    }
    out[n] = 0;
    return 0;
}

/* The file's own URL: the source's URI it starts with (the longest), then the rest of its name, "_" as "/" and %xx
 * undone. 0, or -1 when no source has it. */
static int web_list_url(const char *name, char *url, size_t size) {
    char pre[3 * HELPER_URI_MAX + 8];
    int best = -1;
    size_t bestlen = 0;
    for (int i = 0; i < web_nuris; i++) {
        if (web_list_prefix(web_uris[i], pre, sizeof pre)) continue;
        size_t l = strlen(pre);
        if (l > bestlen && !strncmp(name, pre, l)) { best = i; bestlen = l; }
    }
    if (best < 0) return -1;
    size_t n = (size_t)snprintf(url, size, "%s", web_uris[best]);
    for (const char *s = name + bestlen; *s && n + 1 < size; s++) {
        unsigned h;
        if (*s == '%' && sscanf(s + 1, "%2x", &h) == 1 && s[1] && s[2]) { url[n++] = (char)h; s += 2; }
        else url[n++] = *s == '_' ? '/' : *s;
    }
    url[n] = 0;
    return n + 1 < size ? 0 : -1;
}

/* 1 if the file's first byte that isn't blank (spaces, tabs, line ends, a UTF-8 BOM) is '<': an HTML or XML page.
 * apt's indexes (Packages, Sources, Release, Translation, Contents) are deb822 text or compressed, never that. */
static int web_page_file(int dir, const char *name) {
    int fd = openat(dir, name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
    if (fd < 0) return 0;
    struct stat st;
    int page = 0;
    if (!fstat(fd, &st) && S_ISREG(st.st_mode)) {
        unsigned char buf[512];
        size_t seen = 0;
        ssize_t r;
        int done = 0;
        while (!done && seen < 65536 && (r = read(fd, buf, sizeof buf)) > 0) {
            for (ssize_t i = 0; i < r; i++, seen++) {
                unsigned char c = buf[i];
                if (c == ' ' || c == '\t' || c == '\r' || c == '\n') continue;
                if (seen < 3 && (c == 0xef || c == 0xbb || c == 0xbf)) continue;
                page = c == '<';
                done = 1;
                break;
            }
        }
    }
    close(fd);
    return page;
}

int helper_drop_web_lists(const char *prefix, const char *source_line, FILE *out) {
    char path[PATH_MAX];
    web_nuris = 0;
    if (source_line) {
        static char line[sizeof ((struct helper_plan *)0)->source_line];
        snprintf(line, sizeof line, "%s", source_line);
        web_read_line(line); /* update-source names its own source only; another's page is deleted, not named */
    }
    snprintf(path, sizeof path, "%s/etc/apt/sources.list", prefix);
    if (!source_line) web_read_sources(path);
    snprintf(path, sizeof path, "%s/etc/apt/sources.list.d", prefix);
    DIR *d = source_line ? NULL : opendir(path);
    if (d) {
        struct dirent *e;
        while ((e = readdir(d))) {
            size_t l = strlen(e->d_name);
            if ((l > 5 && !strcmp(e->d_name + l - 5, ".list")) || (l > 8 && !strcmp(e->d_name + l - 8, ".sources"))) {
                char f[PATH_MAX];
                if ((size_t)snprintf(f, sizeof f, "%s/%s", path, e->d_name) < sizeof f) web_read_sources(f);
            }
        }
        closedir(d);
    }
    snprintf(path, sizeof path, "%s/var/lib/apt/lists", prefix);
    d = opendir(path);
    if (!d) return 0;
    int dropped = 0;
    struct dirent *e;
    while ((e = readdir(d))) {
        if (e->d_name[0] == '.' || !strcmp(e->d_name, "lock") || !web_page_file(dirfd(d), e->d_name)) continue;
        int gone = !unlinkat(dirfd(d), e->d_name, 0);
        if (!gone)
            fprintf(out, "W: ifizbox-helper: can't delete %s/%s, a web page in apt's lists: %s\n", path, e->d_name,
                    strerror(errno));
        dropped += gone;
        char url[HELPER_URI_MAX + PATH_MAX];
        if (web_list_url(e->d_name, url, sizeof url)) {
            if (gone) fprintf(out, "W: ifizbox-helper: deleted %s/%s: a web page, not an apt index\n", path, e->d_name);
            continue;
        }
        /* core/aptupdate.js reads this line (as apt's own) and turns the source red, deleted or not. */
        fprintf(out, "E: Failed to fetch %s  the repo answered with a web page, not an apt index\n", url);
    }
    closedir(d);
    fflush(out);
    return dropped;
}
