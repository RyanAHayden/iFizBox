/* ifizbox-helper: the one place iFizBox's root work goes through (docs/native.md, "3. Root").
 *
 *   ifizbox-helper update | upgrade | configure | install <pkg>... | remove <pkg>...
 *   ifizbox-helper hold <pkg>... | unhold <pkg>... | showhold | auto <pkg>...   (F234: apt-mark auto)
 *   ifizbox-helper addsource <uri> <suite> [component...] | removesource <uri> <suite>
 *   ifizbox-helper update-source <uri> <suite> [component...]   (F233a: apt-get update for that one source, from a
 *                                                               temp sources file; the other lists stay; update_source)
 *   ifizbox-helper simulate <item>... | apply <item>... | respring      (N4: the install queue; item: name,
 *                                                                        name=version or -name)
 *   ifizbox-helper apply-ask <item>...        (F63: apply, but dpkg asks about changed conffiles; answers "Y"/"N"
 *                                             lines on stdin, relayed to apt-get by ask_relay below; F64: a "C"
 *                                             line is Cancel, SIGINT to apt-get)
 *   ifizbox-helper install-ipa <path>            (F59: an IPA the app downloaded, installed through installd as
 *                                                AppSync's appinst does; ipa.c. Exit 69: can't install ad hoc)
 *   ifizbox-helper simulate-deb | install-deb <path.deb>   (N9: a .deb shared with iFizBox; apt-get -s / install on a
 *                                                           root-owned copy, dependencies from the sources; paid.c)
 *   ifizbox-helper install-deb-ask <path.deb>   (F239: install-deb, but dpkg asks about changed conffiles, answered
 *                                               on stdin as apply-ask's; the queue run's shell-fetched .debs)
 *   ifizbox-helper install-paid <path.deb> <pkg> <version>  (F57: a paid package's .deb the app downloaded from the
 *                                                           vendor; copied, its control checked, apt-get install; paid.c)
 *   ifizbox-helper rollbacks <pkg> | rollback <pkg> <version>  (F71: the .debs N7's daemon kept, and apt-get install
 *                                                              of one, after dpkg-deb shows its control matches)
 *   ifizbox-helper app-versions   (I4: every installed app's id and real versions, from installd's containers;
 *                                 runs nothing; ipa.c)
 *   ifizbox-helper uninstall-app <bundle id>   (B46: Installed's Delete; an app in installd's containers only,
 *                                              uninstalled through installd; ipa.c)
 *   ifizbox-helper remove-malware <path>...   (F232: Installed's Malware Found > Delete; known-malware dylibs no dpkg
 *                                             package owns, in the tweak folders only, then respring; remove_malware)
 *   ifizbox-helper udid                       (F236: this iPhone's UDID from MobileGestalt, one line; runs nothing)
 *   ifizbox-helper launch-theme <key>         (B203: the launch screen in that theme: copies the app's
 *                                             LaunchThemes/<key>/ over its own launch files; runs nothing; launch.h)
 *   ifizbox-helper notifications on|off  (F65: Settings' Upgrade Notifications; off creates
 *                                         <prefix>/var/lib/ifizbox/upgrades.off, which N5's daemon reads; runs nothing)
 *
 * No setuid bit: iFizBox spawns it as root with the persona spawn attributes (spawn.c), which the kernel allows
 * only because iFizBox is signed with com.apple.private.persona-mgmt. Run by anything else it is plain mobile and
 * refuses. It runs exactly one of apt-get update|install|remove|upgrade, apt-mark hold|unhold|showhold or
 * dpkg --configure -a from the rootless
 * prefix, with fixed options; the caller only picks the verb and package names ([a-z0-9][a-z0-9.+-]+, known to
 * dpkg or apt). If fd 3 is open, apt's/dpkg's status lines go there (pmstatus:pkg:percent:text); stdout and stderr
 * are apt's own. addsource/removesource (F33) run nothing: they edit <prefix>/etc/apt/sources.list.d/ifizbox.sources
 * (temp file + rename) and print what they did. Exit: 64 refused arguments, 77 refused caller, 74 ifizbox.sources
 * couldn't be written, 126 exec failed, else apt's/dpkg's status.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later */
#include "ipa.h"
#include "paid.h"
#include "policy.h"
#include "launch.h"
#include "ownicon.h" /* F329 */
#include "decrypt.h" /* F374 */

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <poll.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>
#ifdef __APPLE__
/* <libproc.h> ships in the macOS SDK but not the iOS one; proc_pidpath is in libSystem on iOS too, so declare it
 * ourselves (as Sileo and Zebra do). */
#include <stdint.h>
#include <dlfcn.h>
#include <CoreFoundation/CoreFoundation.h>
int proc_pidpath(int pid, void *buffer, uint32_t buffersize);
#endif

#ifndef IFIZBOX_PREFIX
#define IFIZBOX_PREFIX "/var/jb"
#endif
/* Only test builds change this (test_helper.py runs the chain as a normal user); the iOS build keeps 0. */
#ifndef IFIZBOX_ROOT_UID
#define IFIZBOX_ROOT_UID 0
#endif

static int parent_exe(char *buf, size_t size) {
#ifdef __APPLE__
    return proc_pidpath(getppid(), buf, (uint32_t)size) > 0 ? 0 : -1;
#else
    char link[64];
    snprintf(link, sizeof link, "/proc/%d/exe", (int)getppid());
    ssize_t n = readlink(link, buf, size - 1);
    if (n < 0) return -1;
    buf[n] = 0;
    return 0;
#endif
}

/* F63: apply-ask. apt-get runs as a child with a pipe on its stdin (dpkg, under apt, reads its conffile answer
 * there); the caller's answers come on `answers` (the helper's own stdin) and only lines helper_answer_ok takes
 * ("Y" or "N") are copied over, so dpkg's D and Z (a root shell) can't be reached. Once the caller closes its end,
 * apt's stdin is closed too (a later prompt then fails as dpkg does at end of file). Ends when apt-get does, even
 * with the caller's end still open. Returns apt-get's exit status (128 + signal), or HELPER_EX_EXEC. */
static int ask_relay(const struct helper_plan *plan, char *const env[], int answers) {
    int in[2];
    if (pipe(in)) { perror("ifizbox-helper: pipe"); return HELPER_EX_EXEC; }
    fcntl(in[1], F_SETFD, FD_CLOEXEC);
    fcntl(answers, F_SETFD, FD_CLOEXEC);
    pid_t pid = fork();
    if (pid < 0) { perror("ifizbox-helper: fork"); return HELPER_EX_EXEC; }
    if (pid == 0) {
        if (dup2(in[0], 0) < 0) _exit(HELPER_EX_EXEC);
        close(in[0]);
        execve(plan->path, (char *const *)plan->argv, env);
        fprintf(stderr, "ifizbox-helper: %s: %s\n", plan->path, strerror(errno));
        _exit(HELPER_EX_EXEC);
    }
    close(in[0]);
    signal(SIGPIPE, SIG_IGN); /* dpkg gone: a late answer is dropped, not fatal (the child has SIG_DFL) */
    char line[256];
    size_t used = 0;
    int skipping = 0, st = 0;
    for (;;) {
        pid_t w = waitpid(pid, &st, answers >= 0 ? WNOHANG : 0);
        if (w == pid) break;
        if (w < 0 && errno != EINTR) { perror("ifizbox-helper: waitpid"); return HELPER_EX_EXEC; }
        if (answers < 0) continue;
        struct pollfd pf = {answers, POLLIN, 0};
        if (poll(&pf, 1, 200) <= 0) continue;
        char buf[256];
        ssize_t n = read(answers, buf, sizeof buf);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) { close(answers); answers = -1; close(in[1]); in[1] = -1; continue; }
        for (ssize_t i = 0; i < n; i++) {
            if (buf[i] != '\n') {
                if (used < sizeof line) line[used++] = buf[i];
                else skipping = 1; /* too long to be an answer */
                continue;
            }
            if (!skipping && helper_cancel_ok(line, used)) {
                /* F64: Cancel. SIGINT, as Ctrl-C would: while apt downloads it stops there (nothing is unpacked; the
                 * partial files stay for next time); once dpkg runs, apt lets the current dpkg call finish and stops
                 * after it. The app only sends it before apt's first pmstatus line. */
                fprintf(stderr, "ifizbox-helper: cancelled: stopping apt-get\n");
                kill(pid, SIGINT);
            } else if (!skipping && helper_answer_ok(line, used)) {
                char out[2] = {line[0], '\n'};
                if (write(in[1], out, 2) != 2) { /* dpkg stopped reading: nothing to tell it */ }
            } else {
                fprintf(stderr, "ifizbox-helper: ignored an answer that isn't Y or N\n");
            }
            used = 0;
            skipping = 0;
        }
    }
    if (in[1] >= 0) close(in[1]);
    if (answers >= 0) close(answers);
    return WIFEXITED(st) ? WEXITSTATUS(st) : 128 + WTERMSIG(st);
}

/* F236: udid. This iPhone's UDID (MobileGestalt's UniqueDeviceID, a protected key: entitlements.plist allows it),
 * one line on stdout, for Settings > Signing's "This iPhone is in the profile" check (native/Sources/PhoneID.swift).
 * Runs nothing. Off iOS there is no MobileGestalt: exit 74 and say so. */
static int print_udid(void) {
#ifdef __APPLE__
    void *mg = dlopen("/usr/lib/libMobileGestalt.dylib", RTLD_LAZY);
    CFTypeRef (*copy)(CFStringRef) = mg ? (CFTypeRef (*)(CFStringRef))dlsym(mg, "MGCopyAnswer") : NULL;
    if (!copy) {
        fprintf(stderr, "ifizbox-helper: udid: libMobileGestalt has no MGCopyAnswer\n");
        return HELPER_EX_IOERR;
    }
    CFTypeRef v = copy(CFSTR("UniqueDeviceID"));
    char buf[128];
    int ok = v && CFGetTypeID(v) == CFStringGetTypeID() &&
             CFStringGetCString((CFStringRef)v, buf, sizeof buf, kCFStringEncodingUTF8) && buf[0];
    if (v) CFRelease(v);
    if (!ok) {
        fprintf(stderr, "ifizbox-helper: udid: MobileGestalt didn't answer UniqueDeviceID\n");
        return HELPER_EX_IOERR;
    }
    printf("%s\n", buf);
    return fflush(stdout) ? HELPER_EX_IOERR : 0;
#else
    fprintf(stderr, "ifizbox-helper: udid: MobileGestalt is only on iOS\n");
    return HELPER_EX_IOERR;
#endif
}

/* F232: remove-malware <path>... Installed's Malware Found alert deletes known-malware tweak dylibs no package owns
 * (F228's scan lists them as orphans; apt can't remove what dpkg doesn't know). Only these names (the copy of
 * web/app/core/known-malware.js MALWARE_FILES; test_remove_malware.py keeps the two the same), only in the two folders
 * tweaks load from, with or without the prefix (the same places Apt.swift's malware.scan looks). */
static const char *const malware_files[] = {
    "MainRepoEGG.dylib", "MobileSafeMode.dylib", "RocketBootstrapUI.dylib", "SnowBoardSB.dylib", "LicGenerator.dylib",
};
static const char *const malware_dirs[] = {"/Library/MobileSubstrate/DynamicLibraries", "/usr/lib/TweakInject"};
#define MALWARE_NFILES (sizeof malware_files / sizeof *malware_files)
#define MALWARE_NDIRS (sizeof malware_dirs / sizeof *malware_dirs)
#define MALWARE_MAX_PATHS 16

struct malware_target {
    char dir[PATH_MAX]; /* the folder as given (prefixed or not) */
    const char *name;   /* one of malware_files */
    const char *path;   /* the caller's word */
};

/* Which listed file in which tweak folder path names, exactly as spelled (no normalising: "..", "//" or a trailing
 * "/" match nothing). 0, or -1 + *err. */
static int malware_target(const char *prefix, const char *path, struct malware_target *t, const char **err) {
    for (size_t d = 0; d < MALWARE_NDIRS; d++) {
        for (int pre = 0; pre < 2; pre++) {
            char dir[PATH_MAX];
            if ((size_t)snprintf(dir, sizeof dir, "%s%s", pre ? prefix : "", malware_dirs[d]) >= sizeof dir) continue;
            size_t n = strlen(dir);
            if (strncmp(path, dir, n) || path[n] != '/') continue;
            for (size_t f = 0; f < MALWARE_NFILES; f++) {
                if (strcmp(path + n + 1, malware_files[f])) continue;
                memcpy(t->dir, dir, n + 1);
                t->name = malware_files[f];
                t->path = path;
                return 0;
            }
        }
    }
    *err = "not a known-malware file in the Substrate or TweakInject folder";
    return -1;
}

/* The dpkg package whose info/<pkg>.list names a file called `name` in any tweak folder (prefixed or not; a folder
 * may be a link to the other one, so the name anywhere there counts) into owner. 1 owned, 0 not, -1 unreadable. */
static int malware_owner(const char *prefix, const char *name, char *owner, size_t size) {
    char info[PATH_MAX], want[MALWARE_NDIRS * 2][PATH_MAX];
    size_t nwant = 0;
    for (size_t d = 0; d < MALWARE_NDIRS; d++) {
        snprintf(want[nwant++], PATH_MAX, "%s%s/%s", prefix, malware_dirs[d], name);
        snprintf(want[nwant++], PATH_MAX, "%s/%s", malware_dirs[d], name);
    }
    snprintf(info, sizeof info, "%s/var/lib/dpkg/info", prefix);
    DIR *dir = opendir(info);
    if (!dir) return -1;
    struct dirent *e;
    int found = 0;
    char *line = NULL;
    size_t cap = 0;
    while (!found && (e = readdir(dir))) {
        size_t len = strlen(e->d_name);
        if (len <= 5 || strcmp(e->d_name + len - 5, ".list")) continue;
        char file[PATH_MAX];
        if ((size_t)snprintf(file, sizeof file, "%s/%s", info, e->d_name) >= sizeof file) continue;
        int fd = open(file, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
        FILE *fp = fd >= 0 ? fdopen(fd, "r") : NULL;
        if (!fp) { if (fd >= 0) close(fd); continue; }
        ssize_t n;
        while (!found && (n = getline(&line, &cap, fp)) > 0) {
            if (line[n - 1] == '\n') line[--n] = 0;
            for (size_t w = 0; w < nwant && !found; w++) {
                if (strcmp(line, want[w])) continue;
                found = 1;
                size_t k = len - 5 < size - 1 ? len - 5 : size - 1;
                memcpy(owner, e->d_name, k);
                owner[k] = 0;
                char *colon = strchr(owner, ':'); /* <pkg>:<arch>.list */
                if (colon) *colon = 0;
            }
        }
        fclose(fp);
    }
    free(line);
    closedir(dir);
    return found;
}

/* Checks every path first (listed, not owned by a package, a regular file or a link: never followed), then deletes
 * them all with unlinkat on the opened folder and restarts SpringBoard (the respring verb's command; a deleted tweak
 * is still loaded until then). Exit: 64 refused (nothing deleted), 74 couldn't read dpkg's lists or delete anything,
 * else the respring command's. */
static int remove_malware(int argc, char *const argv[], const char *prefix, char *const env[]) {
    static struct malware_target t[MALWARE_MAX_PATHS];
    const char *err = NULL;
    if (argc < 1 || argc > MALWARE_MAX_PATHS) {
        fprintf(stderr, "ifizbox-helper: remove-malware takes 1 to %d paths\n", MALWARE_MAX_PATHS);
        return HELPER_EX_USAGE;
    }
    int dirfd[MALWARE_MAX_PATHS];
    for (int i = 0; i < argc; i++) {
        if (malware_target(prefix, argv[i], &t[i], &err)) {
            fprintf(stderr, "ifizbox-helper: %s: %s\n", argv[i], err);
            return HELPER_EX_USAGE;
        }
        for (int j = 0; j < i; j++)
            if (!strcmp(argv[i], argv[j])) { fprintf(stderr, "ifizbox-helper: %s: given twice\n", argv[i]); return HELPER_EX_USAGE; }
        char owner[HELPER_NAME_MAX + 1];
        int o = malware_owner(prefix, t[i].name, owner, sizeof owner);
        if (o < 0) { fprintf(stderr, "ifizbox-helper: can't read dpkg's file lists: %s\n", strerror(errno)); return HELPER_EX_IOERR; }
        if (o > 0) {
            fprintf(stderr, "ifizbox-helper: %s belongs to the package %s: remove that package instead\n", argv[i], owner);
            return HELPER_EX_USAGE;
        }
    }
    for (int i = 0; i < argc; i++) {
        struct stat st;
        dirfd[i] = open(t[i].dir, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
        if (dirfd[i] < 0 || fstatat(dirfd[i], t[i].name, &st, AT_SYMLINK_NOFOLLOW)) {
            int e = errno;
            fprintf(stderr, "ifizbox-helper: %s: %s\n", t[i].path, strerror(e));
            return e == ENOENT ? HELPER_EX_USAGE : HELPER_EX_IOERR;
        }
        if (!S_ISREG(st.st_mode) && !S_ISLNK(st.st_mode)) {
            fprintf(stderr, "ifizbox-helper: %s: not a file or a link\n", t[i].path);
            return HELPER_EX_USAGE;
        }
    }
    int deleted = 0;
    for (int i = 0; i < argc; i++) {
        if (unlinkat(dirfd[i], t[i].name, 0)) fprintf(stderr, "ifizbox-helper: %s: %s\n", t[i].path, strerror(errno));
        else { printf("Deleted %s\n", t[i].path); deleted++; }
        close(dirfd[i]);
    }
    fflush(stdout);
    if (!deleted) return HELPER_EX_IOERR;
    struct helper_plan *plan = malloc(sizeof *plan);
    char *words[] = {"respring", NULL};
    if (!plan || helper_plan(1, words, prefix, -1, plan, &err)) {
        fprintf(stderr, "ifizbox-helper: respring: %s\n", plan ? err : "out of memory");
        return HELPER_EX_EXEC;
    }
    execve(plan->path, (char *const *)plan->argv, env);
    fprintf(stderr, "ifizbox-helper: %s: %s\n", plan->path, strerror(errno));
    return HELPER_EX_EXEC;
}

/* F233a: update-source. The temp sources file holding the one source, apt-get update on it as a child, then the
 * file deleted whatever apt did. Exit: 74 the file couldn't be made, 126 apt-get couldn't be run, else apt's
 * status (128 + signal).
 * B348: update runs here too (as a child, no temp file), and after either one helper_drop_web_lists deletes the
 * web pages apt saved as lists and names their sources on stderr; apt's 0 then becomes 100, as for a failed fetch. */
static int update_source(struct helper_plan *plan, char *const env[], const char *prefix) {
    const char *err = NULL;
    errno = 0;
    int one = plan->verb == HV_UPDATE_SOURCE;
    if (one && helper_update_source_file(plan, &err)) {
        fprintf(stderr, "ifizbox-helper: %s%s%s\n", err, errno ? ": " : "", errno ? strerror(errno) : "");
        return HELPER_EX_IOERR;
    }
    fflush(stdout);
    pid_t pid = fork();
    if (pid < 0) {
        perror("ifizbox-helper: fork");
        if (one) unlink(plan->source_tmp);
        return HELPER_EX_EXEC;
    }
    if (pid == 0) {
        execve(plan->path, (char *const *)plan->argv, env);
        fprintf(stderr, "ifizbox-helper: %s: %s\n", plan->path, strerror(errno));
        _exit(HELPER_EX_EXEC);
    }
    int st = 0;
    pid_t w;
    while ((w = waitpid(pid, &st, 0)) < 0 && errno == EINTR) {}
    if (one && unlink(plan->source_tmp))
        fprintf(stderr, "ifizbox-helper: can't delete %s: %s\n", plan->source_tmp, strerror(errno));
    int named = helper_drop_web_lists(prefix, one ? plan->source_line : NULL, stderr);
    if (w < 0) { perror("ifizbox-helper: waitpid"); return HELPER_EX_EXEC; }
    int rc = WIFEXITED(st) ? WEXITSTATUS(st) : 128 + WTERMSIG(st);
    return rc == 0 && named ? 100 : rc;
}

/* B84: the verbs that may run dpkg (install, configure or remove packages, iFizBox's own one among them). */
static int runs_dpkg(enum helper_verb v) {
    return v == HV_INSTALL || v == HV_REMOVE || v == HV_UPGRADE || v == HV_CONFIGURE || v == HV_APPLY ||
           v == HV_APPLY_ASK || v == HV_ROLLBACK || v == HV_INSTALL_PAID || v == HV_INSTALL_DEB ||
           v == HV_INSTALL_DEB_ASK;
}

/* B84: installing iFizBox over itself closes the running app halfway (its Replaced watcher once the new Info.plist
 * is on disk, or iOS when the postinst's uicache registers the new copy). apt-get, dpkg and the postinst used to
 * write straight into the app's pipes, so the first line after that was SIGPIPE: dpkg died in the postinst and left
 * the package half-configured, with every later apt-get refusing ("dpkg was interrupted").
 * So for runs_dpkg verbs the helper leaves the app's session (setsid: nothing sent to the app's process group reaches
 * it) and forks: the child returns and does the verb with pipes of the helper's on fds 1, 2 (and 3); this process
 * copies them to the app's fds, ignores SIGPIPE and SIGHUP, stops copying to an fd the app has closed (the rest is
 * read and dropped) and exits with the child's status once it ends, as the app expects of the helper. Lines a
 * grandchild left behind (a postinst's background job holding an fd) don't keep it waiting. `keep` is closed here
 * (the answers fd belongs to the child). Returns 0 in the child; -1 (nothing forked) if the pipes or fork failed. */
static int outlive_caller(int status_fd, int keep) {
    int nfd = status_fd >= 0 ? 3 : 2, p[3][2];
    for (int i = 0; i < nfd; i++) {
        if (pipe(p[i])) {
            perror("ifizbox-helper: pipe");
            for (int j = 0; j < i; j++) { close(p[j][0]); close(p[j][1]); }
            return -1;
        }
    }
    setsid(); /* fails only if already a group leader, which a spawned helper isn't; either way, go on */
    fflush(stdout);
    fflush(stderr);
    pid_t pid = fork();
    if (pid < 0) {
        perror("ifizbox-helper: fork");
        for (int i = 0; i < nfd; i++) { close(p[i][0]); close(p[i][1]); }
        return -1;
    }
    if (pid == 0) {
        for (int i = 0; i < nfd; i++) {
            if (dup2(p[i][1], i + 1) < 0) _exit(HELPER_EX_EXEC);
            close(p[i][0]);
            if (p[i][1] != i + 1) close(p[i][1]);
        }
        return 0;
    }
    if (keep >= 0) close(keep);
    signal(SIGPIPE, SIG_IGN);
    signal(SIGHUP, SIG_IGN);
    int in[3], dead[3] = {0, 0, 0};
    for (int i = 0; i < nfd; i++) {
        close(p[i][1]);
        in[i] = p[i][0];
        fcntl(in[i], F_SETFL, fcntl(in[i], F_GETFL) | O_NONBLOCK);
    }
    int st = 0, ended = 0;
    for (;;) {
        if (!ended) {
            pid_t w = waitpid(pid, &st, WNOHANG);
            if (w == pid || (w < 0 && errno != EINTR)) ended = 1;
        }
        struct pollfd pf[3];
        int open_fds = 0;
        for (int i = 0; i < nfd; i++) {
            pf[i].fd = in[i];
            pf[i].events = POLLIN;
            pf[i].revents = 0;
            if (in[i] >= 0) open_fds++;
        }
        if (!open_fds && ended) break;
        /* Once the child ended, read what is already there and stop (a grandchild may hold a pipe open). */
        int r = poll(pf, (nfds_t)nfd, ended ? 0 : 200);
        if (r < 0 && errno != EINTR) break;
        int got = 0;
        for (int i = 0; i < nfd; i++) {
            if (in[i] < 0 || !(pf[i].revents & (POLLIN | POLLHUP | POLLERR))) continue;
            char buf[16384];
            ssize_t n = read(in[i], buf, sizeof buf);
            if (n < 0 && (errno == EINTR || errno == EAGAIN)) continue;
            if (n <= 0) { close(in[i]); in[i] = -1; continue; }
            got = 1;
            for (ssize_t off = 0; off < n && !dead[i];) {
                ssize_t m = write(i + 1, buf + off, (size_t)(n - off));
                if (m < 0 && errno == EINTR) continue;
                if (m <= 0) { dead[i] = 1; break; } /* the app is gone: keep apt running, drop its output */
                off += m;
            }
        }
        if (ended && !got) break;
    }
    _exit(WIFEXITED(st) ? WEXITSTATUS(st) : 128 + WTERMSIG(st));
}

/* B84: dpkg was stopped halfway (a run killed in a maintainer script): its journal in <prefix>/var/lib/dpkg/updates
 * holds files named only by digits, which is what makes apt-get refuse with "dpkg was interrupted". */
static int dpkg_interrupted(const char *prefix) {
    char dir[PATH_MAX];
    snprintf(dir, sizeof dir, "%s/var/lib/dpkg/updates", prefix);
    DIR *d = opendir(dir);
    if (!d) return 0;
    int found = 0;
    struct dirent *e;
    while (!found && (e = readdir(d))) {
        const char *s = e->d_name;
        if (!*s) continue;
        while (*s >= '0' && *s <= '9') s++;
        found = !*s;
    }
    closedir(d);
    return found;
}

/* B84: before a run that installs or removes, finish an interrupted dpkg with the configure verb's command (dpkg
 * --configure -a, status lines on fd 3 when it is open), as the console's own "configure" would, so the run isn't
 * refused. Its exit status is reported but the run goes on either way (apt then says what is still wrong). */
static void repair_dpkg(const char *prefix, int status_fd, char *const env[]) {
    if (!dpkg_interrupted(prefix)) return;
    static struct helper_plan fix;
    char *words[] = {"configure", NULL};
    const char *err = NULL;
    if (helper_plan(1, words, prefix, status_fd, &fix, &err)) {
        fprintf(stderr, "ifizbox-helper: configure: %s\n", err);
        return;
    }
    fprintf(stderr, "ifizbox-helper: dpkg was interrupted: running dpkg --configure -a first\n");
    fflush(stdout);
    fflush(stderr);
    pid_t pid = fork();
    if (pid < 0) { perror("ifizbox-helper: fork"); return; }
    if (pid == 0) {
        execve(fix.path, (char *const *)fix.argv, env);
        fprintf(stderr, "ifizbox-helper: %s: %s\n", fix.path, strerror(errno));
        _exit(HELPER_EX_EXEC);
    }
    int st = 0;
    pid_t w;
    while ((w = waitpid(pid, &st, 0)) < 0 && errno == EINTR) {}
    int rc = w < 0 ? HELPER_EX_EXEC : WIFEXITED(st) ? WEXITSTATUS(st) : 128 + WTERMSIG(st);
    if (rc) fprintf(stderr, "ifizbox-helper: dpkg --configure -a exited %d\n", rc);
}

int main(int argc, char *argv[]) {
    const char *prefix = IFIZBOX_PREFIX, *err = NULL;
    char parent[PATH_MAX], expected[PATH_MAX];

    snprintf(expected, sizeof expected, "%s/Applications/iFizBox.app/iFizBox", prefix);
    if (helper_caller_ok(getuid(), geteuid(), IFIZBOX_ROOT_UID, parent_exe(parent, sizeof parent) ? NULL : parent,
                         expected, &err)) {
        fprintf(stderr, "ifizbox-helper: %s\n", err);
        return HELPER_EX_NOPERM;
    }

    /* F236: udid reads one value and runs nothing: no plan, no clean-up for a child. */
    if (argc >= 2 && !strcmp(argv[1], "udid")) {
        if (argc != 2) { fprintf(stderr, "ifizbox-helper: udid takes no arguments\n"); return HELPER_EX_USAGE; }
        return print_udid();
    }
    /* B203: launch-theme copies files inside the app's own bundle and runs nothing (launch.h). */
    if (argc >= 2 && !strcmp(argv[1], "launch-theme")) {
        if (argc != 3 || !helper_launch_key_ok(argv[2])) {
            fprintf(stderr, "ifizbox-helper: launch-theme takes one theme ([a-z0-9], 1-32)\n");
            return HELPER_EX_USAGE;
        }
        char app[PATH_MAX];
        snprintf(app, sizeof app, "%s", expected);
        char *slash = strrchr(app, '/');
        if (slash) *slash = 0; /* <prefix>/Applications/<name>.app */
        umask(022);
        errno = 0;
        if (helper_launch_theme(app, argv[2], &err)) {
            fprintf(stderr, "ifizbox-helper: launch-theme: %s%s%s\n", err, errno ? ": " : "", errno ? strerror(errno) : "");
            return HELPER_EX_IOERR;
        }
        printf("Launch screen: %s\n", argv[2]);
        return 0;
    }

    /* F329: own-icon copies your picture into the app's own icon set and runs nothing (ownicon.h). */
    if (argc >= 2 && !strcmp(argv[1], "own-icon")) {
        if (argc != 4 || !helper_own_slot_ok(argv[2]) || !helper_own_dir_ok(argv[3])) {
            fprintf(stderr, "ifizbox-helper: own-icon takes a slot (a or b) and the picture's folder (absolute)\n");
            return HELPER_EX_USAGE;
        }
        char app[PATH_MAX];
        snprintf(app, sizeof app, "%s", expected);
        char *slash = strrchr(app, '/');
        if (slash) *slash = 0;
        umask(022);
        errno = 0;
        if (helper_own_icon(app, argv[2], argv[3], &err)) {
            fprintf(stderr, "ifizbox-helper: own-icon: %s%s%s\n", err, errno ? ": " : "", errno ? strerror(errno) : "");
            return HELPER_EX_IOERR;
        }
        printf("App icon: own %s\n", argv[2]);
        return 0;
    }
    if (argc >= 2 && !strcmp(argv[1], "own-icon-refresh")) {
        if (argc != 2) { fprintf(stderr, "ifizbox-helper: own-icon-refresh takes no arguments\n"); return HELPER_EX_USAGE; }
        char app[PATH_MAX];
        snprintf(app, sizeof app, "%s", expected);
        char *slash = strrchr(app, '/');
        if (slash) *slash = 0;
        if (helper_own_refresh(prefix, app, &err)) {
            fprintf(stderr, "ifizbox-helper: own-icon-refresh: %s\n", err);
            return HELPER_EX_EXEC;
        }
        printf("Refreshing the Home Screen icon\n");
        return 0;
    }

    /* F374: Installed Apps. user-apps reads installd's containers, decrypt-app writes the app's decrypted Mach-O
     * files into the app's own decrypt folder (decrypt.h); neither runs anything. */
    if (argc >= 2 && !strcmp(argv[1], "user-apps")) {
        if (argc != 2) { fprintf(stderr, "ifizbox-helper: user-apps takes no arguments\n"); return HELPER_EX_USAGE; }
        if (helper_user_apps(HELPER_APPS_DIR, stdout, &err) < 0) {
            fprintf(stderr, "ifizbox-helper: %s: %s\n", err, strerror(errno));
            return HELPER_EX_IOERR;
        }
        return fflush(stdout) ? HELPER_EX_IOERR : 0;
    }
    if (argc >= 2 && !strcmp(argv[1], "decrypt-app")) {
        if (argc != 3) { fprintf(stderr, "ifizbox-helper: decrypt-app takes one bundle ID\n"); return HELPER_EX_USAGE; }
        umask(022);
        int rc = helper_decrypt_app(HELPER_APPS_DIR, HELPER_DECRYPT_DIR, argv[2], fcntl(3, F_GETFD) != -1 ? 3 : -1, stdout, &err);
        if (rc) fprintf(stderr, "ifizbox-helper: %s\n", err);
        return rc;
    }

    int status_fd = fcntl(3, F_GETFD) != -1 ? 3 : -1;
    struct helper_plan plan;
    /* F232: remove-malware isn't one of policy.c's plans; it is checked and done by remove_malware, after the clean-up
     * below (plan stays zeroed: HV_UPDATE, so none of the verb-specific steps on the way run). */
    int malware = argc >= 2 && !strcmp(argv[1], "remove-malware");
    if (malware) memset(&plan, 0, sizeof plan);
    else if (helper_plan(argc - 1, argv + 1, prefix, status_fd, &plan, &err)) {
        fprintf(stderr, "ifizbox-helper: %s\n", err);
        return HELPER_EX_USAGE;
    }
    int unknown = malware ? -1 : helper_first_unknown(prefix, &plan);
    if (unknown >= 0) {
        fprintf(stderr, "ifizbox-helper: unknown package: %s\n", plan.packages[unknown]);
        return HELPER_EX_USAGE;
    }

    /* A clean process for apt: no fds but 0-2 (and 3), stdin from /dev/null, cwd /, default signals, umask 022,
     * and an environment of our own (the caller's could carry APT_CONFIG, LD_ or DYLD_ variables and so on). */
    long maxfd = sysconf(_SC_OPEN_MAX);
    if (maxfd < 0 || maxfd > 65536) maxfd = 65536;
    for (int fd = status_fd >= 0 ? 4 : 3; fd < maxfd; fd++) close(fd);
    /* F63: apply-ask keeps the caller's stdin (its answers) on a high fd; apt itself still never reads it.
     * F239: install-deb-ask too. */
    int asking = plan.verb == HV_APPLY_ASK || plan.verb == HV_INSTALL_DEB_ASK;
    int answers = asking ? fcntl(0, F_DUPFD_CLOEXEC, 4) : -1;
    if (asking && answers < 0) { perror("ifizbox-helper: stdin"); return HELPER_EX_EXEC; }
    int null = open("/dev/null", O_RDONLY);
    if (null < 0 || dup2(null, 0) < 0) { perror("ifizbox-helper: /dev/null"); return HELPER_EX_EXEC; }
    if (null != 0) close(null);
    for (int s = 1; s < NSIG; s++) signal(s, SIG_DFL);
    sigset_t none;
    sigemptyset(&none);
    sigprocmask(SIG_SETMASK, &none, NULL);
    umask(022);
    if (chdir("/")) { perror("ifizbox-helper: chdir"); return HELPER_EX_EXEC; }

    if (plan.verb == HV_ADDSOURCE || plan.verb == HV_REMOVESOURCE) {
        int changed;
        errno = 0;
        if (helper_sources_apply(&plan, &changed, &err)) {
            fprintf(stderr, "ifizbox-helper: %s%s%s\n", err, errno ? ": " : "", errno ? strerror(errno) : "");
            return HELPER_EX_IOERR;
        }
        printf("%s %s %s: %s\n", plan.verb == HV_ADDSOURCE ? "Added" : "Removed", plan.argv[1], plan.argv[2],
               changed ? "ifizbox.sources updated" : "nothing to change");
        return 0;
    }

    if (plan.verb == HV_NOTIFICATIONS) {
        errno = 0;
        if (helper_notify_apply(&plan, &err)) {
            fprintf(stderr, "ifizbox-helper: %s%s%s\n", err, errno ? ": " : "", errno ? strerror(errno) : "");
            return HELPER_EX_IOERR;
        }
        printf("Upgrade notifications %s\n", plan.argv[1]);
        return 0;
    }

    if (plan.verb == HV_APP_VERSIONS) {
        if (helper_app_versions(plan.path, stdout, &err) < 0) {
            fprintf(stderr, "ifizbox-helper: %s: %s\n", err, strerror(errno));
            return HELPER_EX_IOERR;
        }
        return fflush(stdout) ? HELPER_EX_IOERR : 0;
    }

    if (plan.verb == HV_UNINSTALL_APP) { /* B46 */
        int rc = helper_uninstall_app(plan.path, plan.argv[1], status_fd, &err);
        if (rc) fprintf(stderr, "ifizbox-helper: %s\n", err);
        return fflush(stdout) && !rc ? HELPER_EX_IOERR : rc;
    }

    if (plan.verb == HV_ROLLBACKS) {
        static char list[HELPER_ROLLBACK_MAX * (HELPER_NAME_MAX + 2 * HELPER_VERSION_MAX + 64)];
        if (helper_rollback_list(plan.path, plan.argv[1], IFIZBOX_ROOT_UID, list, sizeof list, &err) < 0) {
            fprintf(stderr, "ifizbox-helper: %s\n", err);
            return HELPER_EX_USAGE;
        }
        fputs(list, stdout);
        return 0;
    }
    if (plan.verb == HV_ROLLBACK && helper_rollback_verify(prefix, plan.deb, plan.name_buf[0], plan.item_buf[0], &err)) {
        fprintf(stderr, "ifizbox-helper: %s\n", err);
        return HELPER_EX_USAGE;
    }

    static char path_env[PATH_MAX * 2];
    snprintf(path_env, sizeof path_env,
             "PATH=%1$s/usr/bin:%1$s/bin:%1$s/usr/sbin:%1$s/sbin:/usr/bin:/bin:/usr/sbin:/sbin", prefix);
    /* N4: Cydia's finish protocol. Maintainer scripts write "finish:restart" (and so on) to the fd named in CYDIA;
     * apply keeps fd 3 open through apt (APT::Keep-Fds) so those lines reach the console beside apt's status. */
    char *cydia_env = (plan.verb == HV_APPLY || plan.verb == HV_APPLY_ASK || plan.verb == HV_ROLLBACK ||
                       plan.verb == HV_INSTALL_PAID || plan.verb == HV_INSTALL_DEB || plan.verb == HV_INSTALL_DEB_ASK) &&
                      status_fd >= 0 ? "CYDIA=3 1" : NULL;
    /* B84: runs_dpkg verbs tell maintainer scripts the pid the app waits on (this one, which outlive_caller keeps
     * until the run ends): iFizBox's postinst holds its uicache, which closes the running app, until it is gone. */
    static char pid_env[64];
    snprintf(pid_env, sizeof pid_env, "IFIZBOX_HELPER_PID=%d", (int)getpid());
    int dpkg_verb = !malware && runs_dpkg(plan.verb);
    char *env[] = {path_env, "HOME=/var/root", "USER=root", "LOGNAME=root", "LANG=C", "DEBIAN_FRONTEND=noninteractive",
                   dpkg_verb ? pid_env : cydia_env, dpkg_verb ? cydia_env : NULL, NULL};
    if (dpkg_verb) {
        if (outlive_caller(status_fd, answers)) return HELPER_EX_EXEC;
        if (plan.verb != HV_CONFIGURE) repair_dpkg(prefix, status_fd, env);
    }
    if (malware) return remove_malware(argc - 2, argv + 2, prefix, env);
    if (plan.verb == HV_UPDATE_SOURCE || plan.verb == HV_UPDATE) return update_source(&plan, env, prefix); /* B348 */
    if (plan.verb == HV_INSTALL_IPA) {
        int rc = helper_install_ipa(prefix, plan.path, status_fd, env, &err);
        if (rc) fprintf(stderr, "ifizbox-helper: %s\n", err);
        return rc;
    }
    if (plan.verb == HV_INSTALL_PAID) {
        int rc = helper_install_paid(prefix, &plan, env, &err);
        if (err) fprintf(stderr, "ifizbox-helper: %s\n", err);
        return rc;
    }
    if (plan.verb == HV_SIMULATE_DEB || plan.verb == HV_INSTALL_DEB) {
        int rc = helper_local_deb(prefix, &plan, env, &err);
        if (err) fprintf(stderr, "ifizbox-helper: %s\n", err);
        return rc;
    }
    if (plan.verb == HV_INSTALL_DEB_ASK) { /* F239 */
        int rc = helper_local_deb_ask(prefix, &plan, env, ask_relay, answers, &err);
        if (err) fprintf(stderr, "ifizbox-helper: %s\n", err);
        return rc;
    }
    if (plan.verb == HV_APPLY_ASK) return ask_relay(&plan, env, answers);
    execve(plan.path, (char *const *)plan.argv, env);
    fprintf(stderr, "ifizbox-helper: %s: %s\n", plan.path, strerror(errno));
    return HELPER_EX_EXEC;
}
