/* F374: ifizbox-helper user-apps and decrypt-app (decrypt.h).
 *
 * user-apps reads installd's containers as app-versions does (ipa.c), plus each app's name and whether its main
 * executable is still FairPlay-encrypted (LC_ENCRYPTION_INFO(_64) cryptid != 0).
 *
 * decrypt-app decrypts without running the app: each encrypted Mach-O of the .app (the main executable, frameworks,
 * plug-ins, extensions) is mapped privately and the kernel decrypts the mapping in place (mremap_encrypted, the call
 * dyld's loads go through; the approach of the GPL/MIT decrypters flexdecrypt and fouldecrypt, written here from the
 * Mach-O format, no code taken). The decrypted bytes are written into a copy of the file and its cryptid set to 0.
 * Only the decrypted files are written (HELPER_DECRYPT_DIR/<id>/<path in the .app>): the app reads the rest of the
 * bundle itself (bundles are readable by mobile) and zips both into the IPA.
 *
 * Root writes in a folder its caller owns, so every step there is relative to a directory fd the helper opened
 * without following links, each new folder and file is made with O_EXCL / mkdirat and opened O_NOFOLLOW, and what
 * it made is given to the folder's owner (fchown) only once written.
 * SPDX-License-Identifier: GPL-3.0-or-later */
#include "decrypt.h"
#include "ipa.h"
#include "policy.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#ifdef __APPLE__
#include <mach/mach.h>
#include <signal.h>
#include <spawn.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#endif

#define CMDS_MAX (8u << 20)         /* load commands of one slice */
#define PLIST_MAX (4 << 20)
#define WALK_DEPTH 24
#define FAT_MAX 16

#define LC_ENC 0x21
#define LC_ENC64 0x2C

static uint32_t be32(const unsigned char *p) { return (uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 8 | p[3]; }
static uint64_t be64(const unsigned char *p) { return (uint64_t)be32(p) << 32 | be32(p + 4); }
static uint32_t rd32(const unsigned char *p, int swap) {
    return swap ? be32(p) : (uint32_t)p[3] << 24 | (uint32_t)p[2] << 16 | (uint32_t)p[1] << 8 | p[0];
}

static int pread_all(int fd, void *buf, size_t n, uint64_t off) {
    size_t got = 0;
    while (got < n) {
        ssize_t r = pread(fd, (char *)buf + got, n - got, (off_t)(off + got));
        if (r < 0 && errno == EINTR) continue;
        if (r <= 0) return -1;
        got += (size_t)r;
    }
    return 0;
}

/* One thin slice at off (size bytes): its encryption command into *c. 1 found, 0 none, -1 not a Mach-O. */
static int slice_crypt(int fd, uint64_t off, uint64_t size, struct helper_crypt *c) {
    unsigned char h[32];
    if (size < 28 || pread_all(fd, h, 28, off)) return -1;
    uint32_t magic = rd32(h, 0);
    int is64, swap;
    if (magic == 0xfeedfacf) { is64 = 1; swap = 0; }
    else if (magic == 0xfeedface) { is64 = 0; swap = 0; }
    else if (magic == 0xcffaedfe) { is64 = 1; swap = 1; }
    else if (magic == 0xcefaedfe) { is64 = 0; swap = 1; }
    else return -1;
    uint32_t hsize = is64 ? 32 : 28, ncmds = rd32(h + 16, swap), sizeofcmds = rd32(h + 20, swap);
    if (sizeofcmds > CMDS_MAX || hsize + (uint64_t)sizeofcmds > size) return -1;
    unsigned char *cmds = malloc(sizeofcmds ? sizeofcmds : 1);
    if (!cmds) return -1;
    if (pread_all(fd, cmds, sizeofcmds, off + hsize)) { free(cmds); return -1; }
    int found = 0, bad = 0;
    uint32_t at = 0;
    for (uint32_t i = 0; i < ncmds && !bad; i++) {
        if (sizeofcmds - at < 8) { bad = 1; break; }
        uint32_t cmd = rd32(cmds + at, swap), cmdsize = rd32(cmds + at + 4, swap);
        if (cmdsize < 8 || cmdsize > sizeofcmds - at) { bad = 1; break; }
        if ((cmd == LC_ENC || cmd == LC_ENC64) && !found) {
            if (cmdsize < 20) { bad = 1; break; }
            c->slice_off = off;
            c->slice_size = size;
            c->cputype = rd32(h + 4, swap);
            c->cpusubtype = rd32(h + 8, swap);
            c->cryptoff = rd32(cmds + at + 8, swap);
            c->cryptsize = rd32(cmds + at + 12, swap);
            c->cryptid = rd32(cmds + at + 16, swap);
            c->cryptid_at = off + hsize + at + 16;
            if ((uint64_t)c->cryptoff + c->cryptsize > size) { bad = 1; break; }
            found = 1;
        }
        at += cmdsize;
    }
    free(cmds);
    return bad ? -1 : found;
}

int helper_macho_crypt(int fd, uint64_t size, struct helper_crypt *out, int max) {
    unsigned char h[8];
    if (size < 8 || pread_all(fd, h, 8, 0)) return -1;
    uint32_t magic = be32(h);
    if (magic != 0xcafebabe && magic != 0xcafebabf) {
        struct helper_crypt c;
        int r = slice_crypt(fd, 0, size, &c);
        if (r > 0 && max > 0) out[0] = c;
        return r < 0 ? -1 : r > 0 && max > 0;
    }
    int fat64 = magic == 0xcafebabf;
    uint32_t n = be32(h + 4);
    if (n == 0 || n > FAT_MAX) return -1;
    size_t asize = fat64 ? 32 : 20;
    unsigned char a[FAT_MAX * 32];
    if (8 + n * asize > size || pread_all(fd, a, n * asize, 8)) return -1;
    int count = 0;
    for (uint32_t i = 0; i < n; i++) {
        const unsigned char *p = a + i * asize;
        uint64_t off = fat64 ? be64(p + 8) : be32(p + 8), len = fat64 ? be64(p + 16) : be32(p + 12);
        if (off > size || len > size - off) return -1;
        struct helper_crypt c;
        int r = slice_crypt(fd, off, len, &c);
        if (r < 0) return -1;
        if (r > 0 && count < max) out[count++] = c;
    }
    return count;
}

int helper_crypt_encrypted(const struct helper_crypt *c, int n) {
    for (int i = 0; i < n; i++)
        if (c[i].cryptid) return 1;
    return 0;
}

/* ---- the decryption ------------------------------------------------------------------------------------------- */

#ifdef __APPLE__
/* mremap_encrypted(addr, len, cryptid, cputype, cpusubtype): libSystem doesn't export it and syscall(2) is
 * deprecated (and variadic, which arm64 passes on the stack), so the trap itself: x16 the number, the carry flag set
 * on failure with errno in x0. */
static int mremap_encrypted_(void *addr, size_t len, uint32_t id, uint32_t cpu, uint32_t sub) {
    register uintptr_t x0 __asm__("x0") = (uintptr_t)addr;
    register uintptr_t x1 __asm__("x1") = len;
    register uintptr_t x2 __asm__("x2") = id;
    register uintptr_t x3 __asm__("x3") = cpu;
    register uintptr_t x4 __asm__("x4") = sub;
    register uintptr_t x16 __asm__("x16") = SYS_mremap_encrypted;
    uintptr_t failed;
    __asm__ volatile("svc #0x80\n\tcset %[f], cs"
                     : "+r"(x0), "+r"(x1), [f] "=r"(failed)
                     : "r"(x2), "r"(x3), "r"(x4), "r"(x16)
                     : "memory", "cc");
    if (failed) { errno = (int)x0; return -1; }
    return 0;
}

/* The suspended process's image of this binary (the MH_EXECUTE header of the slice's CPU among its regions), its
 * encrypted range read through the task port (the kernel decrypts each page for the read) and written over the same
 * range of outfd. 0, or -1 with errno. */
static int read_task(pid_t pid, const struct helper_crypt *c, int outfd) {
    mach_port_t task = MACH_PORT_NULL;
    if (task_for_pid(mach_task_self(), pid, &task) != KERN_SUCCESS) { errno = EPERM; return -1; }
    vm_address_t addr = 0, image = 0;
    for (int i = 0; i < 4096 && !image; i++) {
        vm_size_t size = 0;
        vm_region_basic_info_data_64_t info;
        mach_msg_type_number_t count = VM_REGION_BASIC_INFO_COUNT_64;
        mach_port_t object = MACH_PORT_NULL;
        if (vm_region_64(task, &addr, &size, VM_REGION_BASIC_INFO_64, (vm_region_info_t)&info, &count, &object)) break;
        uint32_t h[4] = {0, 0, 0, 0};
        vm_size_t got = sizeof h;
        if ((info.protection & VM_PROT_READ) && !vm_read_overwrite(task, addr, sizeof h, (vm_address_t)h, &got) &&
            got == sizeof h && (h[0] == 0xfeedfacf || h[0] == 0xfeedface) && h[1] == c->cputype && h[3] == 2 /* MH_EXECUTE */)
            image = addr;
        addr += size;
    }
    int rc = image ? 0 : -1, e = ENOEXEC;
    static unsigned char buf[1 << 20];
    for (uint64_t done = 0; !rc && done < c->cryptsize;) {
        vm_size_t n = c->cryptsize - done < sizeof buf ? (vm_size_t)(c->cryptsize - done) : sizeof buf, got = n;
        if (vm_read_overwrite(task, image + c->cryptoff + done, n, (vm_address_t)buf, &got) != KERN_SUCCESS || got != n) {
            rc = -1;
            e = EFAULT;
        } else if (pwrite(outfd, buf, n, (off_t)(c->slice_off + c->cryptoff + done)) != (ssize_t)n) {
            rc = -1;
            e = errno;
        }
        done += n;
    }
    mach_port_deallocate(mach_task_self(), task);
    if (rc) errno = e;
    return rc;
}

/* FairPlay refuses a binary this phone has never run (an extension iOS never started: mmap with PROT_EXEC is EPERM,
 * its code signature not yet registered). Started suspended, nothing of it runs: its decrypted range is read from
 * its memory (read_task, as TrollDecrypt and bfdecrypt read a running app's) and it is killed. 0, or -1 + errno. */
static int decrypt_suspended(int fd, const struct helper_crypt *c, int outfd) {
    char path[PATH_MAX];
    if (fcntl(fd, F_GETPATH, path)) return -1;
    posix_spawnattr_t attr;
    if ((errno = posix_spawnattr_init(&attr))) return -1;
    posix_spawnattr_setflags(&attr, POSIX_SPAWN_START_SUSPENDED);
    char *argv[] = {path, NULL}, *envp[] = {NULL};
    pid_t pid;
    int rc = -1, e = posix_spawn(&pid, path, NULL, &attr, argv, envp);
    posix_spawnattr_destroy(&attr);
    if (!e) {
        rc = read_task(pid, c, outfd);
        e = errno;
        kill(pid, SIGKILL);
        while (waitpid(pid, NULL, 0) < 0 && errno == EINTR) {}
    }
    errno = e;
    return rc;
}

/* mremap_encrypted over a private mapping of the range, written to outfd. 0, or -1 + errno. */
static int decrypt_mapped(int fd, const struct helper_crypt *c, int outfd) {
    uint64_t start = c->slice_off + c->cryptoff, pg = (uint64_t)getpagesize();
    uint64_t base = start & ~(pg - 1), delta = start - base;
    size_t len = (size_t)(delta + c->cryptsize);
    void *m = mmap(NULL, len, PROT_READ | PROT_EXEC, MAP_PRIVATE, fd, (off_t)base);
    if (m == MAP_FAILED) return -1;
    int rc = mremap_encrypted_((char *)m + delta, (size_t)c->cryptsize, c->cryptid, c->cputype, c->cpusubtype);
    const unsigned char *src = (const unsigned char *)m + delta;
    for (size_t done = 0; !rc && done < c->cryptsize;) {
        ssize_t w = pwrite(outfd, src + done, c->cryptsize - done, (off_t)(start + done));
        if (w < 0 && errno == EINTR) continue;
        if (w <= 0) { if (!w) errno = EIO; rc = -1; break; }
        done += (size_t)w;
    }
    int e = errno;
    munmap(m, len);
    errno = e;
    return rc;
}
#endif

int helper_decrypt_range(int fd, const struct helper_crypt *c, int outfd) {
    uint64_t start = c->slice_off + c->cryptoff;
    if (!c->cryptsize) return 0;
#ifdef __APPLE__
    (void)start;
    if (!decrypt_mapped(fd, c, outfd)) return 0;
    int e = errno;
    if (!decrypt_suspended(fd, c, outfd)) return 0;
    errno = e; /* the first reason: the fallback's is usually only its own */
    return -1;
#else
    if (c->cryptid == 99) { errno = EPERM; return -1; }
    unsigned char buf[65536];
    for (uint64_t done = 0; done < c->cryptsize;) {
        size_t n = c->cryptsize - done < sizeof buf ? (size_t)(c->cryptsize - done) : sizeof buf;
        if (pread_all(fd, buf, n, start + done)) { errno = errno ? errno : EIO; return -1; }
        for (size_t i = 0; i < n; i++) buf[i] = (unsigned char)~buf[i];
        if (pwrite(outfd, buf, n, (off_t)(start + done)) != (ssize_t)n) return -1;
        done += n;
    }
    return 0;
#endif
}

/* ---- user-apps ------------------------------------------------------------------------------------------------ */

/* A regular file of 1..PLIST_MAX bytes at dirfd/name (not a link), read whole into a malloc'd *buf; 0 or -1. */
static int read_at(int dirfd, const char *name, char **buf, size_t *len) {
    int fd = openat(dirfd, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK);
    if (fd < 0) return -1;
    struct stat st;
    int rc = -1;
    *buf = NULL;
    if (!fstat(fd, &st) && S_ISREG(st.st_mode) && st.st_size > 0 && st.st_size <= PLIST_MAX &&
        (*buf = malloc((size_t)st.st_size)) && !pread_all(fd, *buf, (size_t)st.st_size, 0)) {
        *len = (size_t)st.st_size;
        rc = 0;
    } else {
        free(*buf);
        *buf = NULL;
    }
    close(fd);
    return rc;
}

static void value(const char *data, size_t len, const char *key, char *out, size_t size) {
    if (!data || helper_plist_string(data, len, key, out, size) || !helper_app_value_ok(out)) out[0] = 0;
}

/* The one real .app folder in box (a container) into app (its name into name); 0 or -1. */
static int box_app(const char *box, char *app, size_t size, char *name, size_t nsize) {
    DIR *d = opendir(box);
    if (!d) return -1;
    int found = 0;
    struct dirent *de;
    while ((de = readdir(d))) {
        size_t n = strlen(de->d_name);
        if (n < 5 || strcmp(de->d_name + n - 4, ".app")) continue;
        char p[PATH_MAX];
        struct stat st;
        if ((size_t)snprintf(p, sizeof p, "%s/%s", box, de->d_name) >= sizeof p) continue;
        if (lstat(p, &st) || !S_ISDIR(st.st_mode)) continue;
        if (found++) break;
        snprintf(app, size, "%s", p);
        snprintf(name, nsize, "%.*s", (int)(n - 4), de->d_name);
    }
    closedir(d);
    return found == 1 ? 0 : -1;
}

/* "1", "0" or "" for the executable exe (a plain name) in the .app folder app. */
static const char *exe_encrypted(const char *app, const char *exe) {
    if (!*exe || strchr(exe, '/') || !strcmp(exe, ".") || !strcmp(exe, "..")) return "";
    int dir = open(app, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (dir < 0) return "";
    int fd = openat(dir, exe, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    close(dir);
    if (fd < 0) return "";
    struct stat st;
    struct helper_crypt c[HELPER_CRYPT_MAX];
    int n = fstat(fd, &st) || !S_ISREG(st.st_mode) ? -1 : helper_macho_crypt(fd, (uint64_t)st.st_size, c, HELPER_CRYPT_MAX);
    close(fd);
    return n < 0 ? "" : helper_crypt_encrypted(c, n) ? "1" : "0";
}

int helper_user_apps(const char *dir, FILE *out, const char **err) {
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
        char box[PATH_MAX], app[PATH_MAX], folder[NAME_MAX + 1];
        struct stat st;
        if ((size_t)snprintf(box, sizeof box, "%s/%s", dir, de->d_name) >= sizeof box) continue;
        if (lstat(box, &st) || !S_ISDIR(st.st_mode)) continue;
        if (box_app(box, app, sizeof app, folder, sizeof folder)) continue;
        int appfd = open(app, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
        if (appfd < 0) continue;
        char *info = NULL;
        size_t ilen = 0;
        int got = read_at(appfd, "Info.plist", &info, &ilen);
        close(appfd);
        if (got) continue;
        char id[HELPER_NAME_MAX + 1], name[256], shortv[256], build[256], exe[256];
        if (helper_plist_string(info, ilen, "CFBundleIdentifier", id, sizeof id) || !helper_ipa_bundle_id_ok(id)) {
            free(info);
            continue;
        }
        value(info, ilen, "CFBundleDisplayName", name, sizeof name);
        if (!*name) value(info, ilen, "CFBundleName", name, sizeof name);
        if (!*name) { snprintf(name, sizeof name, "%s", folder); if (!helper_app_value_ok(name)) name[0] = 0; }
        value(info, ilen, "CFBundleShortVersionString", shortv, sizeof shortv);
        value(info, ilen, "CFBundleVersion", build, sizeof build);
        value(info, ilen, "CFBundleExecutable", exe, sizeof exe);
        free(info);
        char meta[PATH_MAX];
        int store = (size_t)snprintf(meta, sizeof meta, "%s/iTunesMetadata.plist", box) < sizeof meta &&
                    !lstat(meta, &st) && S_ISREG(st.st_mode);
        if (!helper_app_value_ok(app)) continue;
        fprintf(out, "%s\t%s\t%s\t%s\t%s\t%s\t%s\n", id, name, shortv, build, app, exe_encrypted(app, exe), store ? "1" : "0");
        count++;
    }
    closedir(d);
    return count;
}

/* ---- decrypt-app ---------------------------------------------------------------------------------------------- */

struct walk {
    int fd3, files, macho, decrypted, left;
    uid_t uid;
    gid_t gid;
    const char *id;
    FILE *out;
    char exe[256]; /* the main executable (CFBundleExecutable): the one file that must decrypt */
    char failed[PATH_MAX];
};

static void status(struct walk *w, int pct, const char *text) {
    if (w->fd3 >= 0) dprintf(w->fd3, "pmstatus:%s:%d:%s\n", w->id, pct, text);
}

/* The folder `name` under parent (made when missing, never a link), opened; -1 + errno. */
static int sub_dir(int parent, const char *name, uid_t uid, gid_t gid) {
    if (mkdirat(parent, name, 0755) && errno != EEXIST) return -1;
    int fd = openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (fd >= 0 && fchown(fd, uid, gid)) { close(fd); return -1; }
    return fd;
}

/* The output folder for rel (a path under the .app, "" for its top) under top, made as needed; -1 + errno. */
static int out_dir(int top, const char *rel, uid_t uid, gid_t gid) {
    int fd = dup(top);
    char part[PATH_MAX];
    const char *p = rel;
    while (fd >= 0 && *p) {
        const char *slash = strchr(p, '/');
        size_t n = slash ? (size_t)(slash - p) : strlen(p);
        if (!n || n >= sizeof part) { close(fd); errno = EINVAL; return -1; }
        memcpy(part, p, n);
        part[n] = 0;
        int next = sub_dir(fd, part, uid, gid);
        close(fd);
        fd = next;
        p += n + (slash ? 1 : 0);
    }
    return fd;
}

static int copy_fd(int in, int out, uint64_t size) {
    unsigned char buf[1 << 16];
    for (uint64_t off = 0; off < size;) {
        size_t n = size - off < sizeof buf ? (size_t)(size - off) : sizeof buf;
        if (pread_all(in, buf, n, off)) return -1;
        if (pwrite(out, buf, n, (off_t)off) != (ssize_t)n) return -1;
        off += n;
    }
    return 0;
}

/* One file of the .app (fd, at rel/name): written decrypted under top when it is an encrypted Mach-O. 0 skipped or
 * done, 1 decryption failed (w->failed, errno), -1 the copy couldn't be written. */
static int one_file(struct walk *w, int fd, const struct stat *st, int top, const char *rel, const char *name) {
    struct helper_crypt c[HELPER_CRYPT_MAX];
    int n = helper_macho_crypt(fd, (uint64_t)st->st_size, c, HELPER_CRYPT_MAX);
    if (n < 0) return 0;
    w->macho++;
    if (!helper_crypt_encrypted(c, n)) return 0;
    char path[PATH_MAX];
    snprintf(path, sizeof path, "%s%s%s", rel, *rel ? "/" : "", name);
    char msg[PATH_MAX + 32];
    snprintf(msg, sizeof msg, "Decrypting %s", path);
    status(w, 10 + (w->decrypted * 80 / (w->decrypted + 8)), msg);
    int dir = out_dir(top, rel, w->uid, w->gid);
    if (dir < 0) return -1;
    int o = openat(dir, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0755);
    if (o < 0) { close(dir); return -1; }
    int rc = copy_fd(fd, o, (uint64_t)st->st_size) ? -1 : 0;
    for (int i = 0; i < n && !rc; i++) {
        if (!c[i].cryptid) continue;
        if (helper_decrypt_range(fd, &c[i], o)) {
            rc = 1;
            break;
        }
        static const unsigned char zero[4];
        if (pwrite(o, zero, 4, (off_t)c[i].cryptid_at) != 4) rc = -1;
    }
    int e = errno;
    if (!rc && (fchown(o, w->uid, w->gid) || fsync(o))) { rc = -1; e = errno; }
    close(o);
    if (rc) unlinkat(dir, name, 0); /* no half-decrypted copy: the original stays in the IPA */
    close(dir);
    errno = e;
    if (rc > 0) {
        /* FairPlay refuses some binaries (seen: an extension never run on this phone). Only the main executable
         * stops the run; any other file stays encrypted, said here, and the app decides what to do with it. */
        if (!*rel && !strcmp(name, w->exe)) {
            snprintf(w->failed, sizeof w->failed, "%s", path);
            return 1;
        }
        w->left++;
        fprintf(w->out, "Still encrypted %s: %s\n", path, strerror(e));
        fflush(w->out);
        return 0;
    }
    if (rc) return rc;
    w->decrypted++;
    fprintf(w->out, "Decrypted %s (%lld KB)\n", path, (long long)((st->st_size + 1023) / 1024));
    fflush(w->out);
    return 0;
}

/* Every file under the folder dirfd (rel: its path in the .app), links never followed. 0, 1 or -1 as one_file. */
static int walk_dir(struct walk *w, int dirfd, int top, const char *rel, int depth) {
    if (depth > WALK_DEPTH) return 0;
    DIR *d = fdopendir(dirfd);
    if (!d) { close(dirfd); return -1; }
    struct dirent *de;
    int rc = 0;
    while (!rc && (de = readdir(d))) {
        if (!strcmp(de->d_name, ".") || !strcmp(de->d_name, "..")) continue;
        struct stat st;
        if (fstatat(dirfd, de->d_name, &st, AT_SYMLINK_NOFOLLOW)) continue;
        char sub[PATH_MAX];
        if ((size_t)snprintf(sub, sizeof sub, "%s%s%s", rel, *rel ? "/" : "", de->d_name) >= sizeof sub) continue;
        if (S_ISDIR(st.st_mode)) {
            int fd = openat(dirfd, de->d_name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
            if (fd >= 0) rc = walk_dir(w, fd, top, sub, depth + 1);
        } else if (S_ISREG(st.st_mode)) {
            w->files++;
            int fd = openat(dirfd, de->d_name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
            if (fd < 0) continue;
            rc = one_file(w, fd, &st, top, rel, de->d_name);
            int e = errno;
            close(fd);
            errno = e;
        }
    }
    int e = errno;
    closedir(d);
    errno = e;
    return rc;
}

int helper_decrypt_app(const char *apps, const char *drop, const char *id, int fd3, FILE *out, const char **err) {
    static char why[PATH_MAX + 128];
    if (!helper_ipa_bundle_id_ok(id)) { *err = "not a bundle identifier"; return HELPER_EX_USAGE; }
    char box[PATH_MAX], app[PATH_MAX], folder[NAME_MAX + 1];
    int f = helper_app_find(apps, id, box, sizeof box, err);
    if (f < 0) return HELPER_EX_IOERR;
    if (f > 0 || box_app(box, app, sizeof app, folder, sizeof folder)) {
        *err = "no installed app has that bundle ID";
        return HELPER_EX_USAGE;
    }
    int dropfd = open(drop, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    struct stat dst;
    if (dropfd < 0 || fstat(dropfd, &dst) || dst.st_uid == 0) {
        if (dropfd >= 0) close(dropfd);
        *err = "the decrypt folder is missing, a link or root's";
        return HELPER_EX_IOERR;
    }
    if (mkdirat(dropfd, id, 0755)) {
        int e = errno;
        close(dropfd);
        *err = e == EEXIST ? "an earlier decrypt of this app is still in the decrypt folder" : "can't make the app's decrypt folder";
        return HELPER_EX_IOERR;
    }
    int top = openat(dropfd, id, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    close(dropfd);
    if (top < 0 || fchown(top, dst.st_uid, dst.st_gid)) {
        if (top >= 0) close(top);
        *err = "can't open the app's decrypt folder";
        return HELPER_EX_IOERR;
    }
    int appfd = open(app, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (appfd < 0) { close(top); *err = "can't open the app"; return HELPER_EX_IOERR; }
    struct walk w = {.fd3 = fd3, .uid = dst.st_uid, .gid = dst.st_gid, .id = id, .out = out};
    char *info = NULL;
    size_t ilen = 0;
    if (!read_at(appfd, "Info.plist", &info, &ilen)) value(info, ilen, "CFBundleExecutable", w.exe, sizeof w.exe);
    free(info);
    fprintf(out, "App: %s\n", app);
    fflush(out);
    status(&w, 5, "Looking for encrypted files");
    int rc = walk_dir(&w, appfd, top, "", 0);
    int e = errno;
    close(top);
    if (rc > 0) {
        snprintf(why, sizeof why, "can't decrypt %s: %s", w.failed, strerror(e));
        *err = why;
        return 1;
    }
    if (rc < 0) {
        snprintf(why, sizeof why, "can't write the decrypted files: %s", strerror(e));
        *err = why;
        return HELPER_EX_IOERR;
    }
    status(&w, 100, "Decrypted");
    fprintf(out, "Decrypted %d of %d Mach-O files", w.decrypted, w.macho);
    if (w.left) fprintf(out, ", %d still encrypted", w.left);
    fputc('\n', out);
    fflush(out);
    return 0;
}
