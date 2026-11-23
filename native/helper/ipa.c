/* F59: ifizbox-helper install-ipa <path>: install an IPA the app downloaded, as AppSync's appinst does
 * (docs/sideload.md, "How jailbreak installers do it"): [[LSApplicationWorkspace defaultWorkspace]
 * installApplication:withOptions:error:] with appinst's entitlements on the helper (helper/entitlements.plist).
 *
 *   1. Open the IPA without following links: a regular file, one link, owned by the user who owns its directory
 *      (mobile), never root. Copied into a fresh root-owned directory under HELPER_IPA_WORK, so nothing the caller
 *      does afterwards changes what gets installed.
 *   2. unzip runs as that user (not root) into pkg/ beside the copy, so a hostile zip (symlinks, "../") can only
 *      write where the user already can. CFBundleIdentifier comes from Payload/<one>.app/Info.plist, read with
 *      O_NOFOLLOW. An app whose MinimumOSVersion is above this iPhone's iOS stops here, saying both (B72).
 *   3. With AppSync Unified (installd takes any signature): install the unpacked .app (PackageType Developer), which
 *      installd moves into place instead of unpacking the IPA a second time (B400: about half the time on the
 *      iPhone 7). The root-owned copy goes to installd as it is, as appinst does, when unzip may unpack it other than
 *      installd would (a warning from unzip, a zip not made on Unix: names and modes) or it has an App Store
 *      iTunesMetadata.plist, which only an IPA install keeps. installd still wants an application-identifier
 *      entitlement (B59), so a binary without one (the main one or an extension's, B72) is fakesigned with `ldid -M
 *      -S` and the .app sealed with `ldid -s` (as the user). installd's refusal ends the last stderr line, in its own words.
 *      Without it: ad hoc sign the .app with ldid (as TrollStore Lite does: `ldid -s`, keeping the entitlements, run
 *      as the user too) and install the unpacked .app (PackageType Developer). No ldid, or installd refuses the ad
 *      hoc app: exit HELPER_EX_ADHOC with a line saying the jailbreak can't install ad hoc apps without AppSync.
 *
 * Progress goes to fd 3 (when open) as pmstatus:<bundle id or "ipa">:<percent>:<text>, like apt's. B400: the percent
 * never goes back and moves within the copy, unzip and installd's own percents, which end the text ("Installing 40%").
 * Off iOS (the tests) the last step only prints what it would install; the rest runs as on the phone.
 * SPDX-License-Identifier: GPL-3.0-or-later */
#include "ipa.h"
#include "policy.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#ifdef __APPLE__
#include <CoreFoundation/CoreFoundation.h>
#include <dlfcn.h>
#include <objc/message.h>
#include <objc/runtime.h>
void *objc_autoreleasePoolPush(void);
void objc_autoreleasePoolPop(void *pool);
#endif

#define IPA_MAX_SIZE (8LL << 30)     /* bigger than any App Store app */
#define IPA_PLIST_MAX (4 << 20)

static int status_fd = -1;

/* B400: one line per new percent or text, never back; installd's block may call this from another thread. A percent
 * already passed is sent as the highest one when its text is new. */
static int shown_pct = -1;
static char shown_text[HELPER_NAME_MAX + 64];
static pthread_mutex_t shown_lock = PTHREAD_MUTEX_INITIALIZER;

static void progress(const char *id, int pct, const char *text) {
    if (status_fd < 0) return;
    pthread_mutex_lock(&shown_lock);
    if (pct > shown_pct || strcmp(text, shown_text)) {
        if (pct > shown_pct) shown_pct = pct;
        snprintf(shown_text, sizeof shown_text, "%s", text);
        dprintf(status_fd, "pmstatus:%s:%d:%s\n", id && *id ? id : "ipa", shown_pct, text);
    }
    pthread_mutex_unlock(&shown_lock);
}

/* B400: `done` of `of` bytes into a step that takes the bar from `from` to `to`. */
static void part(long long done, long long of, int from, int to, const char *text) {
    if (of <= 0 || done < 0) return;
    if (done > of) done = of;
    progress(NULL, from + (int)((to - from) * done / of), text);
}

static int fail(const char **err, const char *msg) { *err = msg; return HELPER_EX_IOERR; }

/* B400: the bytes of the plain files under path (lstat: no link is followed). */
static long long tree_size(const char *path) {
    struct stat st;
    if (lstat(path, &st)) return 0;
    if (S_ISREG(st.st_mode)) return st.st_size;
    if (!S_ISDIR(st.st_mode)) return 0;
    long long sum = 0;
    DIR *d = opendir(path);
    if (!d) return 0;
    struct dirent *de;
    while ((de = readdir(d))) {
        if (!strcmp(de->d_name, ".") || !strcmp(de->d_name, "..")) continue;
        char p[PATH_MAX];
        if ((size_t)snprintf(p, sizeof p, "%s/%s", path, de->d_name) < sizeof p) sum += tree_size(p);
    }
    closedir(d);
    return sum;
}

/* B400: what run_as shows while its child (unzip) fills a directory: the bar from `from` to `to`. */
struct grows { const char *dir; long long total; int from, to; const char *text; };

static double now(void) {
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return (double)t.tv_sec + (double)t.tv_nsec / 1e9;
}

/* Run argv[0] (an absolute path) as uid/gid with the helper's clean environment; its stdout/stderr are the
 * console. Returns its exit status, or -1 when it couldn't start. `g` (or NULL): see above. */
static int run_as(uid_t uid, gid_t gid, const char *cwd, char *const env[], const char *const argv[], const struct grows *g) {
    pid_t pid = fork();
    if (pid < 0) return -1;
    if (pid == 0) {
        if (geteuid() == 0 && uid != 0) {
            if (setgroups(0, NULL) || setgid(gid) || setuid(uid)) _exit(126);
        }
        if (getuid() == 0 && uid != 0) _exit(126); /* never extract or sign as root */
        if (chdir(cwd)) _exit(126);
        execve(argv[0], (char *const *)argv, env);
        fprintf(stderr, "ifizbox-helper: %s: %s\n", argv[0], strerror(errno));
        _exit(126);
    }
    int st;
    double look = now() + 0.3; /* the directory is measured about twice a second, less often when that takes long */
    for (;;) {
        pid_t got = waitpid(pid, &st, g && g->total > 0 ? WNOHANG : 0);
        if (got == pid) break;
        if (got < 0 && errno != EINTR) return -1;
        if (got != 0) continue;
        double t = now();
        if (t >= look) {
            part(tree_size(g->dir), g->total, g->from, g->to, g->text);
            double took = now() - t;
            look = now() + (took > 0.05 ? took * 10 : 0.5);
        }
        struct timespec nap = {0, 50 * 1000 * 1000};
        nanosleep(&nap, NULL);
    }
    return WIFEXITED(st) ? WEXITSTATUS(st) : 128 + WTERMSIG(st);
}

int helper_ipa_bundle_id_ok(const char *s) {
    size_t n = strlen(s);
    if (n < 1 || n > 255 || s[0] == '.' || s[0] == '-') return 0;
    for (size_t i = 0; i < n; i++) {
        char c = s[i];
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '-'))
            return 0;
    }
    return 1;
}

/* CFBundleIdentifier of an Info.plist's bytes into out (size HELPER_NAME_MAX + 1); 0, or -1 when missing or bad.
 * On iOS any plist format (CFPropertyList); elsewhere the XML form only, enough for the tests' fixtures. */
int helper_ipa_plist_id(const char *data, size_t len, char *out, size_t size) {
    out[0] = 0;
#ifdef __APPLE__
    CFDataRef d = CFDataCreateWithBytesNoCopy(NULL, (const UInt8 *)data, (CFIndex)len, kCFAllocatorNull);
    CFPropertyListRef pl = d ? CFPropertyListCreateWithData(NULL, d, kCFPropertyListImmutable, NULL, NULL) : NULL;
    if (d) CFRelease(d);
    int ok = -1;
    if (pl && CFGetTypeID(pl) == CFDictionaryGetTypeID()) {
        CFTypeRef v = CFDictionaryGetValue((CFDictionaryRef)pl, CFSTR("CFBundleIdentifier"));
        if (v && CFGetTypeID(v) == CFStringGetTypeID() &&
            CFStringGetCString((CFStringRef)v, out, (CFIndex)size, kCFStringEncodingUTF8))
            ok = 0;
    }
    if (pl) CFRelease(pl);
    if (ok) return -1;
#else
    static const char key[] = "<key>CFBundleIdentifier</key>";
    const char *end = data + len, *k = NULL;
    for (const char *p = data; p + sizeof key - 1 <= end; p++)
        if (!memcmp(p, key, sizeof key - 1)) { k = p + sizeof key - 1; break; }
    if (!k) return -1;
    while (k < end && (*k == ' ' || *k == '\t' || *k == '\n' || *k == '\r')) k++;
    if (end - k < 8 || memcmp(k, "<string>", 8)) return -1;
    k += 8;
    const char *e = k;
    while (e < end && *e != '<') e++;
    if (e == end || (size_t)(e - k) >= size) return -1;
    memcpy(out, k, (size_t)(e - k));
    out[e - k] = 0;
#endif
    return helper_ipa_bundle_id_ok(out) ? 0 : -1;
}

/* pkg/Payload/<the one .app> (a real directory, not a link) into app; 0 or -1. */
static int find_app(const char *payload, char *app, size_t size) {
    DIR *d = opendir(payload);
    if (!d) return -1;
    int found = 0;
    struct dirent *de;
    while ((de = readdir(d))) {
        size_t n = strlen(de->d_name);
        if (n < 5 || strcmp(de->d_name + n - 4, ".app")) continue;
        char p[PATH_MAX];
        struct stat st;
        if ((size_t)snprintf(p, sizeof p, "%s/%s", payload, de->d_name) >= sizeof p) continue;
        if (lstat(p, &st) || !S_ISDIR(st.st_mode)) continue;
        if (found++) break;
        snprintf(app, size, "%s", p);
    }
    closedir(d);
    return found == 1 ? 0 : -1;
}

static int read_plist(const char *app, char *id, size_t size) {
    char p[PATH_MAX];
    if ((size_t)snprintf(p, sizeof p, "%s/Info.plist", app) >= sizeof p) return -1;
    int fd = open(p, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    if (fd < 0) return -1;
    struct stat st;
    char *buf = NULL;
    int rc = -1;
    if (!fstat(fd, &st) && S_ISREG(st.st_mode) && st.st_size > 0 && st.st_size <= IPA_PLIST_MAX &&
        (buf = malloc((size_t)st.st_size))) {
        size_t got = 0;
        ssize_t n;
        while (got < (size_t)st.st_size && (n = read(fd, buf + got, (size_t)st.st_size - got)) > 0) got += (size_t)n;
        if (got == (size_t)st.st_size) rc = helper_ipa_plist_id(buf, got, id, size);
    }
    free(buf);
    close(fd);
    return rc;
}

static int exists(const char *prefix, const char *path) {
    char p[PATH_MAX];
    if ((size_t)snprintf(p, sizeof p, "%s%s", prefix, path) >= sizeof p) return 0;
    return access(p, F_OK) == 0;
}

int helper_ipa_appsync(const char *prefix) {
    return exists(prefix, "/Library/MobileSubstrate/DynamicLibraries/AppSyncUnified-installd.dylib") ||
           exists(prefix, "/usr/lib/TweakInject/AppSyncUnified-installd.dylib");
}

#ifdef __APPLE__
/* B400: the percent in one of installd's status dictionaries ({"PercentComplete": 40, "Status": ...}), or -1. */
static int installd_percent(id info) {
    if (!info || CFGetTypeID((CFTypeRef)info) != CFDictionaryGetTypeID()) return -1;
    CFTypeRef v = CFDictionaryGetValue((CFDictionaryRef)info, CFSTR("PercentComplete"));
    int pct = -1;
    if (v && CFGetTypeID(v) == CFNumberGetTypeID() && !CFNumberGetValue((CFNumberRef)v, kCFNumberIntType, &pct)) pct = -1;
    return pct;
}
#endif

/* The last step: installd. 0, or -1 with the reason in why. Its own percents go on from `base`. */
static int install(const char *path, const char *bundle, int developer, int base, char *why, size_t size) {
#ifdef __APPLE__
    void *pool = objc_autoreleasePoolPush();
    int rc = -1;
    dlopen("/System/Library/Frameworks/MobileCoreServices.framework/MobileCoreServices", RTLD_NOW);
    Class ws = objc_getClass("LSApplicationWorkspace");
    if (!ws) {
        snprintf(why, size, "LSApplicationWorkspace isn't there");
    } else {
        id w = ((id(*)(Class, SEL))objc_msgSend)(ws, sel_registerName("defaultWorkspace"));
        CFURLRef url = CFURLCreateFromFileSystemRepresentation(NULL, (const UInt8 *)path, (CFIndex)strlen(path), developer);
        CFStringRef cid = CFStringCreateWithCString(NULL, bundle, kCFStringEncodingUTF8);
        const void *keys[2] = {CFSTR("CFBundleIdentifier"), CFSTR("PackageType")};
        const void *vals[2] = {cid, CFSTR("Developer")};
        CFDictionaryRef opts = CFDictionaryCreate(NULL, keys, vals, developer ? 2 : 1, &kCFTypeDictionaryKeyCallBacks,
                                                  &kCFTypeDictionaryValueCallBacks);
        id error = nil;
        BOOL ok;
        SEL with_block = sel_registerName("installApplication:withOptions:error:usingBlock:");
        if (((BOOL(*)(id, SEL, SEL))objc_msgSend)(w, sel_registerName("respondsToSelector:"), with_block)) {
            /* B400: installd's own percents; its block is called while the call below waits. */
            char name[HELPER_NAME_MAX + 1];
            snprintf(name, sizeof name, "%s", bundle);
            const char *named = name;
            void (^said)(id) = ^(id info) {
                int pct = installd_percent(info);
                char text[32];
                if (pct < 0 || pct > 100) return;
                snprintf(text, sizeof text, "Installing %d%%", pct);
                progress(named, base + (99 - base) * pct / 100, text);
            };
            ok = ((BOOL(*)(id, SEL, id, id, id *, void (^)(id)))objc_msgSend)(w, with_block, (id)url, (id)opts, &error, said);
        } else {
            ok = ((BOOL(*)(id, SEL, id, id, id *))objc_msgSend)(
                w, sel_registerName("installApplication:withOptions:error:"), (id)url, (id)opts, &error);
        }
        if (ok) rc = 0;
        else if (error) {
            CFStringRef s = (CFStringRef)((id(*)(id, SEL))objc_msgSend)(error, sel_registerName("localizedDescription"));
            if (!s || !CFStringGetCString(s, why, (CFIndex)size, kCFStringEncodingUTF8)) snprintf(why, size, "installd said no");
        } else {
            snprintf(why, size, "installd said no");
        }
        CFRelease(opts);
        CFRelease(cid);
        CFRelease(url);
    }
    objc_autoreleasePoolPop(pool);
    return rc;
#else
    /* The tests' stand-in for installd: says what it would install; a bundle id ending in ".refused" fails. */
    printf("install %s %s%s\n", developer ? "app" : "ipa", bundle, developer ? " (PackageType Developer)" : "");
    (void)path;
    for (int pct = 20; pct <= 60; pct += 40) {
        char text[32];
        snprintf(text, sizeof text, "Installing %d%%", pct);
        progress(bundle, base + (99 - base) * pct / 100, text);
    }
    size_t n = strlen(bundle);
    if (n >= 8 && !strcmp(bundle + n - 8, ".refused")) { snprintf(why, size, "test installd refused it"); return -1; }
    return 0;
#endif
}

static void remove_tree(const char *path) {
    struct stat st;
    if (lstat(path, &st)) return;
    if (S_ISDIR(st.st_mode)) {
        DIR *d = opendir(path);
        if (d) {
            struct dirent *de;
            while ((de = readdir(d))) {
                if (!strcmp(de->d_name, ".") || !strcmp(de->d_name, "..")) continue;
                char p[PATH_MAX];
                if ((size_t)snprintf(p, sizeof p, "%s/%s", path, de->d_name) < sizeof p) remove_tree(p);
            }
            closedir(d);
        }
        rmdir(path);
    } else {
        unlink(path);
    }
}

/* B59: run_as with argv's stdout captured into a malloc'd, NUL-terminated *out (at most max bytes; more fails).
 * Returns the exit status, or -1 when it couldn't start or said too much. */
static int run_as_capture(uid_t uid, gid_t gid, const char *cwd, char *const env[], const char *const argv[],
                          size_t max, char **out, size_t *len) {
    *out = NULL;
    *len = 0;
    int fds[2];
    if (pipe(fds)) return -1;
    fflush(stdout);
    pid_t pid = fork();
    if (pid < 0) { close(fds[0]); close(fds[1]); return -1; }
    if (pid == 0) {
        close(fds[0]);
        if (dup2(fds[1], 1) < 0) _exit(126);
        if (fds[1] != 1) close(fds[1]);
        int null = open("/dev/null", O_WRONLY);
        if (null >= 0) { dup2(null, 2); if (null != 2) close(null); } /* a probe: its complaints aren't the user's */
        if (geteuid() == 0 && uid != 0) {
            if (setgroups(0, NULL) || setgid(gid) || setuid(uid)) _exit(126);
        }
        if (getuid() == 0 && uid != 0) _exit(126);
        if (chdir(cwd)) _exit(126);
        execve(argv[0], (char *const *)argv, env);
        fprintf(stderr, "ifizbox-helper: %s: %s\n", argv[0], strerror(errno));
        _exit(126);
    }
    close(fds[1]);
    char *buf = malloc(max + 1);
    size_t got = 0;
    int over = !buf;
    char tmp[4096];
    ssize_t n;
    while ((n = read(fds[0], tmp, sizeof tmp)) != 0) {
        if (n < 0) { if (errno == EINTR) continue; over = 1; break; }
        if (over || got + (size_t)n > max) { over = 1; continue; } /* drain so the child can finish */
        memcpy(buf + got, tmp, (size_t)n);
        got += (size_t)n;
    }
    close(fds[0]);
    int st;
    while (waitpid(pid, &st, 0) < 0)
        if (errno != EINTR) { free(buf); return -1; }
    if (over) { free(buf); return -1; }
    buf[got] = 0;
    *out = buf;
    *len = got;
    return WIFEXITED(st) ? WEXITSTATUS(st) : 128 + WTERMSIG(st);
}

/* B59: the team id a fakesigned app gets when it has none of its own (installd wants any 10 characters). */
#define IPA_FAKE_TEAM "FAKESIGNED"

int helper_ipa_team_ok(const char *s) {
    if (strlen(s) != 10) return 0;
    for (const char *p = s; *p; p++)
        if (!((*p >= 'A' && *p <= 'Z') || (*p >= '0' && *p <= '9'))) return 0;
    return 1;
}

int helper_ipa_exe_ok(const char *s) {
    if (!helper_app_value_ok(s) || !strcmp(s, ".") || !strcmp(s, "..")) return 0;
    return strchr(s, '/') == NULL;
}

static int read_small(const char *path, char **buf, size_t *len);
static void plist_value(const char *data, size_t len, const char *key, char *out, size_t size);

/* B72: a code bundle's (the .app's, an .appex's) executable path from its Info.plist's CFBundleExecutable, and its
 * CFBundleIdentifier when id isn't NULL. 0, or -1 with *err. */
static int bundle_exe(const char *dir, char *bin, size_t bsize, char *id, const char **err) {
    char p[PATH_MAX], exe[HELPER_NAME_MAX + 1];
    char *info = NULL;
    size_t ilen = 0;
    if ((size_t)snprintf(p, sizeof p, "%s/Info.plist", dir) >= sizeof p || read_small(p, &info, &ilen)) {
        *err = "can't read the app's Info.plist";
        return -1;
    }
    int bad = helper_plist_string(info, ilen, "CFBundleExecutable", exe, sizeof exe) || !helper_ipa_exe_ok(exe);
    if (!bad && id) bad = helper_ipa_plist_id(info, ilen, id, HELPER_NAME_MAX + 1) ? 2 : 0;
    free(info);
    if (bad == 2) { *err = "no usable CFBundleIdentifier in the Info.plist"; return -1; }
    if (bad) { *err = "no usable CFBundleExecutable in the app's Info.plist"; return -1; }
    struct stat st;
    if ((size_t)snprintf(bin, bsize, "%s/%s", dir, exe) >= bsize || lstat(bin, &st) || !S_ISREG(st.st_mode)) {
        *err = "the app's CFBundleExecutable isn't a plain file in the app";
        return -1;
    }
    return 0;
}

/* B59: a binary's application-identifier and usable team id (helper_ipa_team_ok, else the application-identifier's
 * prefix when that is one) from `ldid -e` (as the user); both "" when it has none (an unsigned binary makes ldid -e
 * fail: no entitlements at all). */
static void binary_ents(const char *ldid, uid_t uid, gid_t gid, const char *pkg, char *const env[], const char *bin,
                        char *appid, size_t asize, char *team, size_t tsize) {
    char *have = NULL;
    size_t hlen = 0;
    appid[0] = team[0] = 0;
    const char *show[] = {ldid, "-e", bin, NULL};
    int rc = run_as_capture(uid, gid, pkg, env, show, IPA_PLIST_MAX, &have, &hlen);
    if (rc == 0 && have && hlen) {
        if (helper_plist_string(have, hlen, "application-identifier", appid, asize)) appid[0] = 0;
        if (helper_plist_string(have, hlen, "com.apple.developer.team-identifier", team, tsize) || !helper_ipa_team_ok(team))
            team[0] = 0;
    }
    free(have);
    if (!team[0] && strlen(appid) > 11 && appid[10] == '.' && tsize > 10) {
        memcpy(team, appid, 10);
        team[10] = 0;
        if (!helper_ipa_team_ok(team)) team[0] = 0;
    }
}

/* B59/B72: `ldid -M -S<work>/ent<n>.xml <bin>`: keeps the binary's own entitlements and adds application-identifier
 * <team>.<id> and com.apple.developer.team-identifier <team>. 0, or an exit code with *err. */
static int sign_binary(const char *ldid, uid_t uid, gid_t gid, const char *pkg, const char *work, int n, const char *bin,
                       const char *team, const char *id, char *const env[], const char **err) {
    char ent[PATH_MAX];
    if ((size_t)snprintf(ent, sizeof ent, "%s/ent%d.xml", work, n) >= sizeof ent) return fail(err, "work path too long");
    FILE *f = NULL;
    int fd = open(ent, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0644);
    if (fd >= 0 && !(f = fdopen(fd, "w"))) close(fd);
    if (!f) return fail(err, "can't write the entitlements file");
    /* id passed helper_ipa_bundle_id_ok and team helper_ipa_team_ok: nothing in them needs escaping. */
    fprintf(f, "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
               "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n"
               "<plist version=\"1.0\">\n<dict>\n"
               "\t<key>application-identifier</key>\n\t<string>%s.%s</string>\n"
               "\t<key>com.apple.developer.team-identifier</key>\n\t<string>%s</string>\n"
               "</dict>\n</plist>\n", team, id, team);
    if (fclose(f)) return fail(err, "can't write the entitlements file");
    char sopt[PATH_MAX + 3];
    snprintf(sopt, sizeof sopt, "-S%s", ent);
    const char *sign[] = {ldid, "-M", sopt, bin, NULL};
    fflush(stdout);
    if (run_as(uid, gid, pkg, env, sign, NULL)) {
        *err = "ldid couldn't add the application-identifier entitlement";
        return HELPER_EX_ADHOC;
    }
    return 0;
}

#define IPA_APPEX_MAX 64

/* B59: installd refuses an app whose main binary has no application-identifier entitlement, AppSync Unified or
 * not ("Application is missing the application-identifier entitlement"). B72: and the app's extensions
 * (PlugIns/ and Extensions/ *.appex) each get their own <team>.<their id>: ldid on the whole .app would give every
 * nested bundle the main app's entitlements (checked on the 7). So each binary without application-identifier is
 * signed alone (sign_binary; the team is the main binary's own when it has a usable one, else FAKESIGNED), then, if
 * any was, `ldid -s <app>` seals the bundle: _CodeSignature/CodeResources in the .app and each nested bundle, every
 * binary keeping the entitlements it now has (checked on the 7; SpringBoard won't launch an app whose bundle has no
 * CodeResources: "No code signature found"). Frameworks and dylibs are ad hoc signed by that seal and need no
 * application-identifier. An extension whose Info.plist can't be read is left for installd to judge.
 * Returns 0 when nothing needed it, 1 when the .app was fakesigned, or an exit code with *err. */
static int fakesign(const char *ldid, uid_t uid, gid_t gid, const char *pkg, const char *work, const char *app,
                    const char *id, char *const env[], const char **err) {
    char bin[PATH_MAX], appid[512], team[HELPER_NAME_MAX + 1];
    if (bundle_exe(app, bin, sizeof bin, NULL, err)) return HELPER_EX_USAGE;
    binary_ents(ldid, uid, gid, pkg, env, bin, appid, sizeof appid, team, sizeof team);
    if (!team[0]) snprintf(team, sizeof team, "%s", IPA_FAKE_TEAM);
    int signed_any = 0, n = 0, rc;
    if (!appid[0]) {
        progress(id, 45, "Adding the application-identifier entitlement (ldid)");
        if ((rc = sign_binary(ldid, uid, gid, pkg, work, n++, bin, team, id, env, err))) return rc;
        signed_any = 1;
    }

    static const char *const dirs[] = {"PlugIns", "Extensions"};
    for (size_t k = 0; k < sizeof dirs / sizeof *dirs; k++) {
        char dpath[PATH_MAX];
        struct stat st;
        if ((size_t)snprintf(dpath, sizeof dpath, "%s/%s", app, dirs[k]) >= sizeof dpath) continue;
        if (lstat(dpath, &st) || !S_ISDIR(st.st_mode)) continue;
        DIR *d = opendir(dpath);
        if (!d) continue;
        struct dirent *de;
        while ((de = readdir(d)) && n <= IPA_APPEX_MAX) {
            size_t len = strlen(de->d_name);
            if (len < 7 || de->d_name[0] == '.' || strcmp(de->d_name + len - 6, ".appex")) continue;
            char ext[PATH_MAX], xbin[PATH_MAX], xid[HELPER_NAME_MAX + 1], xappid[512], xteam[HELPER_NAME_MAX + 1];
            const char *ignored = NULL;
            if ((size_t)snprintf(ext, sizeof ext, "%s/%s", dpath, de->d_name) >= sizeof ext) continue;
            if (lstat(ext, &st) || !S_ISDIR(st.st_mode)) continue;
            if (bundle_exe(ext, xbin, sizeof xbin, xid, &ignored)) continue;
            binary_ents(ldid, uid, gid, pkg, env, xbin, xappid, sizeof xappid, xteam, sizeof xteam);
            if (xappid[0]) continue;
            char msg[HELPER_NAME_MAX + 64];
            snprintf(msg, sizeof msg, "Adding the application-identifier entitlement to %s (ldid)", de->d_name);
            progress(id, 46, msg);
            if ((rc = sign_binary(ldid, uid, gid, pkg, work, n++, xbin, team, xid, env, err))) { closedir(d); return rc; }
            signed_any = 1;
        }
        closedir(d);
    }
    if (!signed_any) return 0;

    progress(id, 48, "Sealing the app (ldid)");
    const char *seal[] = {ldid, "-s", app, NULL};
    fflush(stdout);
    if (run_as(uid, gid, pkg, env, seal, NULL)) { *err = "ldid couldn't seal the fakesigned app"; return HELPER_EX_ADHOC; }
    return 1;
}

int helper_ipa_os_cmp(const char *a, const char *b) {
    long va[3] = {0, 0, 0}, vb[3] = {0, 0, 0};
    const char *s[2] = {a, b};
    long *v[2] = {va, vb};
    for (int k = 0; k < 2; k++) {
        const char *p = s[k];
        for (int i = 0; i < 3; i++) {
            if (*p < '0' || *p > '9') return 2;
            char *end;
            v[k][i] = strtol(p, &end, 10);
            if (end - p > 4) return 2;
            p = end;
            if (!*p) break;
            if (*p != '.' || i == 2) return 2;
            p++;
        }
        if (*p) return 2;
    }
    for (int i = 0; i < 3; i++)
        if (va[i] != vb[i]) return va[i] < vb[i] ? -1 : 1;
    return 0;
}

void helper_ipa_why_clean(char *s) {
    for (char *p = s; *p; p++)
        if (*p == '\n' || *p == '\r' || *p == '\t') *p = ' ';
    static const char stage[] = "com.apple.mobile.installd.staging/";
    static const char tail[] = "/extracted/";
    char *m;
    while ((m = strstr(s, stage))) {
        char *start = m;
        while (start > s && start[-1] != ' ') start--;
        char *e = strstr(m, tail);
        char *rest = e ? e + sizeof tail - 1 : m + sizeof stage - 1;
        memmove(start, rest, strlen(rest) + 1);
    }
}

/* B72: refuse an app whose MinimumOSVersion is above this iPhone's iOS (SystemVersion.plist's ProductVersion; off iOS
 * the tests' <prefix>/System/Library/CoreServices/SystemVersion.plist), before installd turns it down with a staging
 * path in its words ("Have 15.8.8; need 17.0", YouMod on the 7). Either value missing or odd: installd judges.
 * 0, or 1 with *err. */
static int os_check(const char *prefix, const char *app, const char **err) {
    static char msg[1024];
    char p[PATH_MAX], min[64], have[64], name[256], version[256], exe[256];
    char *info = NULL, *sys = NULL;
    size_t ilen = 0, slen = 0;
#ifdef __APPLE__
    (void)prefix;
    const char *sv = "/System/Library/CoreServices/SystemVersion.plist";
#else
    char svp[PATH_MAX];
    if ((size_t)snprintf(svp, sizeof svp, "%s/System/Library/CoreServices/SystemVersion.plist", prefix) >= sizeof svp)
        return 0;
    const char *sv = svp;
#endif
    if (read_small(sv, &sys, &slen)) return 0;
    int got = !helper_plist_string(sys, slen, "ProductVersion", have, sizeof have);
    free(sys);
    if (!got) return 0;
    if ((size_t)snprintf(p, sizeof p, "%s/Info.plist", app) >= sizeof p || read_small(p, &info, &ilen)) return 0;
    got = !helper_plist_string(info, ilen, "MinimumOSVersion", min, sizeof min);
    if (got && helper_ipa_os_cmp(have, min) == -1) {
        plist_value(info, ilen, "CFBundleDisplayName", name, sizeof name);
        if (!name[0]) plist_value(info, ilen, "CFBundleName", name, sizeof name);
        if (!name[0]) {
            plist_value(info, ilen, "CFBundleExecutable", exe, sizeof exe);
            snprintf(name, sizeof name, "%s", exe[0] ? exe : "The app");
        }
        plist_value(info, ilen, "CFBundleShortVersionString", version, sizeof version);
        snprintf(msg, sizeof msg, "%s%s%s needs iOS %s or later (its MinimumOSVersion); this iPhone has iOS %s", name,
                 version[0] ? " " : "", version, min, have);
        *err = msg;
        free(info);
        return 1;
    }
    free(info);
    return 0;
}

/* B400: a zip's central directory, read from fd: 0 with the size of everything in it unpacked (*total) and whether
 * each entry was made on Unix or macOS (*on_unix: unzip then takes names and modes as they are, as installd does), or
 * -1 when it isn't one that can be read (installd and unzip judge the IPA; only the bar and the short way need this). */
static unsigned long le(const unsigned char *p, int n) {
    unsigned long v = 0;
    while (n--) v = v << 8 | p[n];
    return v;
}

int helper_ipa_zip(int fd, long long *total, int *on_unix) {
    enum { EOCD = 22, ENTRY = 46, TAIL = 65535 + EOCD, CD_MAX = 64 << 20 };
    *total = 0;
    *on_unix = 1;
    struct stat st;
    if (fstat(fd, &st) || st.st_size < EOCD) return -1;
    size_t tail = st.st_size < TAIL ? (size_t)st.st_size : TAIL;
    unsigned char *buf = malloc(tail), *cd = NULL;
    int rc = -1;
    if (!buf || pread(fd, buf, tail, st.st_size - (off_t)tail) != (ssize_t)tail) goto out;
    size_t at = tail - EOCD;
    while (memcmp(buf + at, "PK\5\6", 4))
        if (at-- == 0) goto out;
    unsigned long count = le(buf + at + 10, 2), size = le(buf + at + 12, 4), off = le(buf + at + 16, 4);
    /* zip64 (0xffff...) too: rare in an IPA, and installd unpacks it as it did */
    if (count == 0xffff || off == 0xffffffff || size > CD_MAX || size < ENTRY || (off_t)(off + size) > st.st_size) goto out;
    if (!(cd = malloc(size)) || pread(fd, cd, size, (off_t)off) != (ssize_t)size) goto out;
    size_t p = 0;
    for (; count; count--) {
        if (size - p < ENTRY || memcmp(cd + p, "PK\1\2", 4)) goto out;
        unsigned long plain = le(cd + p + 24, 4);
        size_t len = ENTRY + le(cd + p + 28, 2) + le(cd + p + 30, 2) + le(cd + p + 32, 2);
        if (plain == 0xffffffff || len > size - p) goto out;
        if (cd[p + 5] != 3 && cd[p + 5] != 19) *on_unix = 0; /* made by: 3 Unix, 19 macOS */
        *total += (long long)plain;
        p += len;
    }
    rc = 0;
out:
    free(buf);
    free(cd);
    if (rc) { *total = 0; *on_unix = 0; }
    return rc;
}

static int do_install(const char *prefix, const char *ipa, char *const env[], const char *work, const char **err) {
    /* 1. The caller's IPA: its directory is the real one (iOS's /var -> /private/var aside, no link on the way), the
     * file a plain one of the user who owns that directory. */
    char real[PATH_MAX];
    if (!realpath(HELPER_IPA_DIR, real) ||
        (strcmp(real, HELPER_IPA_DIR) && strcmp(real, "/private" HELPER_IPA_DIR)))
        return fail(err, "the IPA directory is missing or a link");
    int dir = open(real, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (dir < 0) return fail(err, "can't open the IPA directory");
    struct stat dst, st;
    int in = fstat(dir, &dst) ? -1 : openat(dir, strrchr(ipa, '/') + 1, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    close(dir);
    if (in < 0) { *err = "can't open the IPA (missing, or a link)"; return HELPER_EX_USAGE; }
    if (fstat(in, &st) || !S_ISREG(st.st_mode) || st.st_nlink != 1 || st.st_uid == 0 || st.st_uid != dst.st_uid ||
        st.st_size <= 0 || st.st_size > IPA_MAX_SIZE) {
        close(in);
        *err = "the IPA isn't a plain file of the app's own (one link, not root's, at most 8 GiB)";
        return HELPER_EX_USAGE;
    }
    uid_t uid = st.st_uid;
    gid_t gid = st.st_gid;

    progress(NULL, 0, "Copying the IPA");
    char copy[PATH_MAX], pkg[PATH_MAX];
    if ((size_t)snprintf(copy, sizeof copy, "%s/app.ipa", work) >= sizeof copy ||
        (size_t)snprintf(pkg, sizeof pkg, "%s/pkg", work) >= sizeof pkg)
        return fail(err, "work path too long");
    int out = open(copy, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0644);
    if (out < 0) { close(in); return fail(err, "can't create the IPA's copy"); }
    char buf[65536];
    ssize_t n;
    long long total = 0;
    while ((n = read(in, buf, sizeof buf)) > 0) {
        total += n;
        if (total > IPA_MAX_SIZE || write(out, buf, (size_t)n) != n) { n = -1; break; }
        part(total, st.st_size, 0, 5, "Copying the IPA");
    }
    close(in);
    /* no fsync (B400): the copy is read back through the same cache and deleted, never after a restart */
    if (close(out) || n < 0) return fail(err, "can't copy the IPA");
    long long plain = 0;
    int on_unix = 0, zip = open(copy, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    if (zip >= 0) { helper_ipa_zip(zip, &plain, &on_unix); close(zip); }

    /* 2. Unpacked by the user, not root. */
    progress(NULL, 5, "Unpacking");
    if (mkdir(pkg, 0755) || chown(pkg, uid, gid)) return fail(err, "can't make the unpack directory");
    char unzip[PATH_MAX];
    if ((size_t)snprintf(unzip, sizeof unzip, "%s/usr/bin/unzip", prefix) >= sizeof unzip) return fail(err, "prefix too long");
    const char *uz[] = {unzip, "-qq", "-o", copy, "-d", pkg, NULL};
    const struct grows filling = {pkg, plain, 5, 40, "Unpacking"};
    int rc = run_as(uid, gid, pkg, env, uz, &filling);
    if (rc < 0 || rc == 126) return fail(err, "can't run unzip (the jailbreak's unzip package)");
    if (rc != 0 && rc != 1) { *err = "unzip couldn't unpack the IPA"; return HELPER_EX_USAGE; }
    char payload[PATH_MAX], app[PATH_MAX], id[HELPER_NAME_MAX + 1];
    if ((size_t)snprintf(payload, sizeof payload, "%s/Payload", pkg) >= sizeof payload) return fail(err, "work path too long");
    if (find_app(payload, app, sizeof app)) { *err = "not an IPA: no single Payload/<name>.app"; return HELPER_EX_USAGE; }
    if (read_plist(app, id, sizeof id)) { *err = "no usable CFBundleIdentifier in the app's Info.plist"; return HELPER_EX_USAGE; }
    if (os_check(prefix, app, err)) return 1; /* B72 */
    char meta[PATH_MAX];
    struct stat mst;
    /* B400: installd may take the unpacked .app: unpacked without a warning, a zip made on Unix, no App Store metadata */
    int as_unpacked = rc == 0 && on_unix && (size_t)snprintf(meta, sizeof meta, "%s/iTunesMetadata.plist", pkg) < sizeof meta &&
                      lstat(meta, &mst) != 0;

    /* 3. installd. */
    static char why[512], refused[640];
    why[0] = 0;
    char ldid[PATH_MAX];
    if ((size_t)snprintf(ldid, sizeof ldid, "%s/usr/bin/ldid", prefix) >= sizeof ldid) return fail(err, "prefix too long");
    if (helper_ipa_appsync(prefix)) {
        /* B59: AppSync takes any signature but installd still wants application-identifier: fakesign the binary
         * when it lacks one and install the unpacked .app (there's no zip to pack it back). B400: without
         * that too, unless installd should unpack the IPA itself (as_unpacked). */
        int signed_app = 0;
        if (!access(ldid, X_OK)) {
            rc = fakesign(ldid, uid, gid, pkg, work, app, id, env, err);
            if (rc > 1) return rc;
            signed_app = rc == 1;
        }
        progress(id, 50, "Installing (AppSync Unified)");
        if (install(signed_app || as_unpacked ? app : copy, id, signed_app || as_unpacked, 50, why, sizeof why)) {
            /* B72: installd's own words on the last line, the one the app's alert shows */
            helper_ipa_why_clean(why);
            snprintf(refused, sizeof refused, "installd refused the app: %s", why);
            *err = refused;
            return 1;
        }
    } else {
        if (access(ldid, X_OK)) {
            *err = "AppSync Unified isn't installed and there's no ldid to sign the app ad hoc: install AppSync "
                   "Unified or ldid, or sign the IPA for this iPhone first";
            return HELPER_EX_ADHOC;
        }
        progress(id, 40, "Signing ad hoc (ldid)");
        const char *ld[] = {ldid, "-s", app, NULL};
        rc = run_as(uid, gid, pkg, env, ld, NULL);
        if (rc) { *err = "ldid couldn't sign the app ad hoc"; return HELPER_EX_ADHOC; }
        rc = fakesign(ldid, uid, gid, pkg, work, app, id, env, err); /* B59 */
        if (rc > 1) return rc;
        progress(id, 60, "Installing (ad hoc signed)");
        if (install(app, id, 1, 60, why, sizeof why)) {
            helper_ipa_why_clean(why);
            fprintf(stderr, "ifizbox-helper: installd: %s\n", why);
            *err = "installd refused the ad hoc signed app: this jailbreak can't install ad hoc apps without AppSync "
                   "Unified. Install AppSync Unified, or sign the IPA for this iPhone first";
            return HELPER_EX_ADHOC;
        }
    }
    progress(id, 100, "Installed");
    printf("Installed %s\n", id);
    return 0;
}

int helper_install_ipa(const char *prefix, const char *ipa, int fd3, char *const env[], const char **err) {
    status_fd = fd3;
    shown_pct = -1;
    char work[PATH_MAX];
    if ((size_t)snprintf(work, sizeof work, "%s/ifizbox-ipa.XXXXXX", HELPER_IPA_WORK) >= sizeof work)
        return fail(err, "work path too long");
    if (!mkdtemp(work)) return fail(err, "can't make a work directory");
    chmod(work, 0755); /* installd reads the copy; nobody else may write here */
    int rc = do_install(prefix, ipa, env, work, err);
    remove_tree(work);
    return rc;
}

/* ---- I4: app-versions (ipa.h). Runs nothing; reads installd's containers so the app can show the real versions. */

#ifndef HELPER_PLIST_MAX
#define HELPER_PLIST_MAX IPA_PLIST_MAX
#endif

int helper_app_value_ok(const char *s) {
    size_t n = strlen(s);
    if (n < 1 || n > 255) return 0;
    for (const unsigned char *p = (const unsigned char *)s; *p; p++)
        if (*p < 0x20 || *p == 0x7f) return 0;
    return 1;
}

int helper_plist_string(const char *data, size_t len, const char *key, char *out, size_t size) {
    out[0] = 0;
#ifdef __APPLE__
    CFDataRef d = CFDataCreateWithBytesNoCopy(NULL, (const UInt8 *)data, (CFIndex)len, kCFAllocatorNull);
    CFPropertyListRef pl = d ? CFPropertyListCreateWithData(NULL, d, kCFPropertyListImmutable, NULL, NULL) : NULL;
    if (d) CFRelease(d);
    CFStringRef k = CFStringCreateWithCString(NULL, key, kCFStringEncodingUTF8);
    int ok = -1;
    if (pl && k && CFGetTypeID(pl) == CFDictionaryGetTypeID()) {
        CFTypeRef v = CFDictionaryGetValue((CFDictionaryRef)pl, k);
        if (v && CFGetTypeID(v) == CFStringGetTypeID() &&
            CFStringGetCString((CFStringRef)v, out, (CFIndex)size, kCFStringEncodingUTF8))
            ok = 0;
    }
    if (k) CFRelease(k);
    if (pl) CFRelease(pl);
    if (ok) { out[0] = 0; return -1; }
    return 0;
#else
    char pat[300];
    int pn = snprintf(pat, sizeof pat, "<key>%s</key>", key);
    if (pn < 0 || (size_t)pn >= sizeof pat) return -1;
    const char *end = data + len, *k = NULL;
    for (const char *p = data; p + pn <= end; p++)
        if (!memcmp(p, pat, (size_t)pn)) { k = p + pn; break; }
    if (!k) return -1;
    while (k < end && (*k == ' ' || *k == '\t' || *k == '\n' || *k == '\r')) k++;
    if (end - k < 8 || memcmp(k, "<string>", 8)) return -1;
    k += 8;
    const char *e = k;
    while (e < end && *e != '<') e++;
    if (e == end || (size_t)(e - k) >= size) return -1;
    memcpy(out, k, (size_t)(e - k));
    out[e - k] = 0;
    return 0;
#endif
}

/* A regular file (not a link) of 1..HELPER_PLIST_MAX bytes, read whole into a malloc'd *buf; 0 or -1. */
static int read_small(const char *path, char **buf, size_t *len) {
    int fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK);
    if (fd < 0) return -1;
    struct stat st;
    int rc = -1;
    *buf = NULL;
    if (!fstat(fd, &st) && S_ISREG(st.st_mode) && st.st_size > 0 && st.st_size <= HELPER_PLIST_MAX &&
        (*buf = malloc((size_t)st.st_size))) {
        size_t got = 0;
        ssize_t n;
        while (got < (size_t)st.st_size && (n = read(fd, *buf + got, (size_t)st.st_size - got)) > 0) got += (size_t)n;
        if (got == (size_t)st.st_size) { *len = got; rc = 0; }
        else { free(*buf); *buf = NULL; }
    }
    close(fd);
    return rc;
}

/* key's value from a plist's bytes into out, or "" when it's missing or not helper_app_value_ok. */
static void plist_value(const char *data, size_t len, const char *key, char *out, size_t size) {
    if (!data || helper_plist_string(data, len, key, out, size) || !helper_app_value_ok(out)) out[0] = 0;
}

int helper_app_versions(const char *dir, FILE *out, const char **err) {
    DIR *d = opendir(dir);
    if (!d) {
        if (errno == ENOENT) return 0;
        *err = "can't read the app containers folder";
        return -1;
    }
    int count = 0;
    struct dirent *de;
    while ((de = readdir(d)) && count < HELPER_APPS_MAX) {
        if (de->d_name[0] == '.') continue;
        char box[PATH_MAX], app[PATH_MAX], p[PATH_MAX];
        struct stat st;
        if ((size_t)snprintf(box, sizeof box, "%s/%s", dir, de->d_name) >= sizeof box) continue;
        if (lstat(box, &st) || !S_ISDIR(st.st_mode)) continue;
        if (find_app(box, app, sizeof app)) continue;
        if ((size_t)snprintf(p, sizeof p, "%s/Info.plist", app) >= sizeof p) continue;
        char *info = NULL, *meta = NULL;
        size_t ilen = 0, mlen = 0;
        if (read_small(p, &info, &ilen)) continue;
        char id[HELPER_NAME_MAX + 1], shortv[256], build[256], store[256];
        if (helper_plist_string(info, ilen, "CFBundleIdentifier", id, sizeof id) || !helper_ipa_bundle_id_ok(id)) {
            free(info);
            continue;
        }
        plist_value(info, ilen, "CFBundleShortVersionString", shortv, sizeof shortv);
        plist_value(info, ilen, "CFBundleVersion", build, sizeof build);
        free(info);
        store[0] = 0;
        if ((size_t)snprintf(p, sizeof p, "%s/iTunesMetadata.plist", box) < sizeof p && !read_small(p, &meta, &mlen)) {
            plist_value(meta, mlen, "bundleShortVersionString", store, sizeof store);
            free(meta);
        }
        fprintf(out, "%s\t%s\t%s\t%s\n", id, shortv, build, store);
        count++;
    }
    closedir(d);
    return count;
}

/* ---- B46: uninstall-app (ipa.h). Installed: Delete in the jailbreak app takes the app off the phone. */

int helper_app_find(const char *dir, const char *id, char *box, size_t size, const char **err) {
    DIR *d = opendir(dir);
    if (!d) {
        if (errno == ENOENT) return 1;
        *err = "can't read the app containers folder";
        return -1;
    }
    int seen = 0, rc = 1;
    struct dirent *de;
    while (rc && (de = readdir(d)) && seen < HELPER_APPS_MAX) {
        if (de->d_name[0] == '.') continue;
        char b[PATH_MAX], app[PATH_MAX], p[PATH_MAX];
        struct stat st;
        if ((size_t)snprintf(b, sizeof b, "%s/%s", dir, de->d_name) >= sizeof b) continue;
        if (lstat(b, &st) || !S_ISDIR(st.st_mode)) continue;
        if (find_app(b, app, sizeof app)) continue;
        seen++;
        if ((size_t)snprintf(p, sizeof p, "%s/Info.plist", app) >= sizeof p) continue;
        char *info = NULL;
        size_t ilen = 0;
        if (read_small(p, &info, &ilen)) continue;
        char got[HELPER_NAME_MAX + 1];
        if (!helper_plist_string(info, ilen, "CFBundleIdentifier", got, sizeof got) && !strcmp(got, id) &&
            (size_t)snprintf(box, size, "%s", b) < size)
            rc = 0;
        free(info);
    }
    closedir(d);
    return rc;
}

/* installd's uninstall. 0, or -1 with the reason in why. */
static int uninstall(const char *bundle, char *why, size_t size) {
#ifdef __APPLE__
    void *pool = objc_autoreleasePoolPush();
    int rc = -1;
    dlopen("/System/Library/Frameworks/MobileCoreServices.framework/MobileCoreServices", RTLD_NOW);
    Class ws = objc_getClass("LSApplicationWorkspace");
    if (!ws) {
        snprintf(why, size, "LSApplicationWorkspace isn't there");
    } else {
        id w = ((id(*)(Class, SEL))objc_msgSend)(ws, sel_registerName("defaultWorkspace"));
        CFStringRef cid = CFStringCreateWithCString(NULL, bundle, kCFStringEncodingUTF8);
        BOOL ok = ((BOOL(*)(id, SEL, id, id))objc_msgSend)(w, sel_registerName("uninstallApplication:withOptions:"),
                                                           (id)cid, nil);
        if (ok) rc = 0;
        else snprintf(why, size, "installd didn't uninstall %s", bundle);
        CFRelease(cid);
    }
    objc_autoreleasePoolPop(pool);
    return rc;
#else
    /* The tests' stand-in for installd, as install()'s. */
    printf("uninstall %s\n", bundle);
    size_t n = strlen(bundle);
    if (n >= 8 && !strcmp(bundle + n - 8, ".refused")) { snprintf(why, size, "test installd refused it"); return -1; }
    return 0;
#endif
}

int helper_uninstall_app(const char *dir, const char *id, int fd3, const char **err) {
    static char why[512];
    status_fd = fd3;
    if (!helper_ipa_bundle_id_ok(id)) { *err = "bad bundle id"; return HELPER_EX_USAGE; }
    char box[PATH_MAX];
    int found = helper_app_find(dir, id, box, sizeof box, err);
    if (found < 0) return HELPER_EX_IOERR;
    if (found) { *err = "not an app installed in the app containers (system and jailbreak apps aren't removed here)"; return HELPER_EX_USAGE; }
    progress(id, 10, "Removing");
    fflush(stdout);
    if (uninstall(id, why, sizeof why)) { *err = why; return 1; }
    progress(id, 100, "Removed");
    printf("Uninstalled %s\n", id);
    return 0;
}
