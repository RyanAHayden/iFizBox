/* Test-only front end to policy.c and spawn.c for test_helper.py; not shipped.
 *   test_driver name <s>...                    print "ok" or "bad" per name
 *   test_driver plan <prefix> <status_fd> <verb> [args]...   print the exec path and argv, one per line, or "error: ..."
 *   test_driver known <prefix> <verb> <pkg>... print the first unknown package or "all known"
 *   test_driver apply <prefix> <verb> [args]...  F33: addsource/removesource on the prefix; "changed",
 *                                              "unchanged" or "error: ..."
 *   test_driver uri|suite|component <s>...     print "ok" or "bad" per string <uid> <euid> <root_uid> <parent_exe> <expected>   print "ok" or "error: ..."
 *   test_driver ipapath <dir> <path>...        F59: print "ok" or "bad" per path (helper_ipa_path_ok)
 *   test_driver paidpath <dir> <path>...       F57: print "ok" or "bad" per path (helper_paid_path_ok)
 *   test_driver plistid <file>                 F59: the Info.plist's CFBundleIdentifier, or "bad"
 *   test_driver appsync <prefix>               F59: "yes" or "no"
 *   test_driver oscmp <a> <b> [<a> <b>]...     B72: helper_ipa_os_cmp per pair (-1, 0, 1, or 2: not versions)
 *   test_driver whyclean <text>                B72: helper_ipa_why_clean's line
 *   test_driver appversions <dir>              I4: helper_app_versions' lines (tabs as " | "), then "count: <n>"
 *   test_driver debname <id> <file>...         F71: the version in each stored .deb name, or "bad"
 *   test_driver rbfile <dir> <id> <version> <root_uid>   F71: the stored .deb's path, or "error: ..."
 *   test_driver rblist <dir> <id> <root_uid>   F71: helper_rollback_list's lines, then "count: <n>" (or "error: ...")
 *   test_driver control <id> <version> <text>  F71: "ok" or "bad" (helper_control_matches; \n in text is a newline)
 *   test_driver rbverify <prefix> <deb> <id> <version>   F71: "ok" or "error: ..." (runs <prefix>/usr/bin/dpkg-deb)
 *   test_driver spawn <helper> [args]...       spawn helper, print its streams as "1: ...", "2: ...", "3: ..."
 *   test_driver spawn-ask keep|close <helper> [args]...   the same with a stdin pipe carrying $TEST_ANSWERS (F63)
 *                                              lines, then "exit: <code>"
 *   test_driver spawn-replaced hold|keep <helper> [args]...  B414: hold-self on first (hold), then <own path>.new renamed
 *                                              over the own binary, as dpkg does, then spawn helper
 *   test_driver spawn-quit <helper> [args]...  B84: spawn helper, read its stdout until a line holding "QUIT", then
 *                                              exit at once without waiting (the app closed mid-run); prints "quit"
 * SPDX-License-Identifier: GPL-3.0-or-later */
#include "ipa.h"
#include "policy.h"
#include "spawn.h"

#include <errno.h>
#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <limits.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

/* ask: NULL for spawn; "keep" or "close" for spawn-ask, which writes $TEST_ANSWERS (lines split at ',') to the
 * helper's stdin, then closes it ("close") or holds it open until the helper is done ("keep"). */
static int spawn(int argc, char **argv, const char *ask) {
    pid_t pid;
    int fds[3], in = -1;
    int rc = ask ? ifizbox_helper_spawn_in(argv[0], (const char *const *)argv + 1, &pid, &in, &fds[0], &fds[1], &fds[2])
                 : ifizbox_helper_spawn(argv[0], (const char *const *)argv + 1, &pid, &fds[0], &fds[1], &fds[2]);
    if (rc) { printf("spawn error: %s\n", strerror(rc)); return 1; }
    (void)argc;
    if (ask) {
        const char *a = getenv("TEST_ANSWERS");
        for (const char *p = a ? a : ""; *p; p++)
            if (write(in, *p == ',' ? "\n" : p, 1) != 1) break;
        if (a && *a && write(in, "\n", 1) != 1) { /* the helper is gone */ }
        if (!strcmp(ask, "close")) close(in), in = -1;
    }
    /* Read the three pipes as they come, like the app's console will; lines tagged by fd. The run ends when the
     * helper's ends of all three close, never on a clock: a silent helper on a loaded machine (the gate beside other
     * slots, swapping) is slow, not hung. A real hang is the caller's subprocess timeout to catch (T22). */
    char buf[3][8192];
    size_t used[3] = {0, 0, 0};
    struct pollfd pf[3];
    for (int i = 0; i < 3; i++) pf[i] = (struct pollfd){fds[i], POLLIN, 0};
    int open_fds = 3;
    while (open_fds) {
        int ready = poll(pf, 3, -1);
        if (ready < 0 && errno == EINTR) continue;
        if (ready <= 0) { printf("poll error: %s\n", strerror(errno)); return 1; }
        for (int i = 0; i < 3; i++) {
            if (pf[i].fd < 0 || !pf[i].revents) continue;
            ssize_t n = read(pf[i].fd, buf[i] + used[i], sizeof buf[i] - 1 - used[i]);
            if (n <= 0) {
                if (used[i]) printf("%d: %.*s\n", i + 1, (int)used[i], buf[i]);
                close(pf[i].fd);
                pf[i].fd = -1;
                open_fds--;
                continue;
            }
            used[i] += (size_t)n;
            char *nl;
            while ((nl = memchr(buf[i], '\n', used[i]))) {
                size_t len = (size_t)(nl - buf[i]);
                printf("%d: %.*s\n", i + 1, (int)len, buf[i]);
                memmove(buf[i], nl + 1, used[i] - len - 1);
                used[i] -= len + 1;
            }
        }
    }
    int st;
    waitpid(pid, &st, 0);
    if (in >= 0) close(in);
    printf("exit: %d\n", WIFEXITED(st) ? WEXITSTATUS(st) : 128 + WTERMSIG(st));
    return 0;
}

/* B84: the app closing in the middle of a run: its ends of the pipes close and the helper is left running. */
static int spawn_quit(char **argv) {
    pid_t pid;
    int fds[3];
    int rc = ifizbox_helper_spawn(argv[0], (const char *const *)argv + 1, &pid, &fds[0], &fds[1], &fds[2]);
    if (rc) { printf("spawn error: %s\n", strerror(rc)); return 1; }
    char buf[8192];
    size_t used = 0;
    for (;;) {
        struct pollfd pf = {fds[0], POLLIN, 0};
        if (poll(&pf, 1, 10000) <= 0) { printf("timeout\n"); return 1; }
        ssize_t n = read(fds[0], buf + used, sizeof buf - 1 - used);
        if (n <= 0) { printf("eof before QUIT\n"); return 1; }
        used += (size_t)n;
        buf[used] = 0;
        if (strstr(buf, "QUIT")) break;
        if (used > sizeof buf / 2) used = 0;
    }
    printf("quit\n");
    fflush(stdout);
    _exit(0);
}

int main(int argc, char **argv) {
    if (argc < 2) return 2;
    const char *cmd = argv[1], *err = NULL;
    if (!strcmp(cmd, "name")) {
        for (int i = 2; i < argc; i++) printf("%s\n", helper_name_ok(argv[i]) ? "ok" : "bad");
    } else if (!strcmp(cmd, "plan") && argc >= 4) {
        struct helper_plan p;
        if (helper_plan(argc - 4, argv + 4, argv[2], atoi(argv[3]), &p, &err)) printf("error: %s\n", err);
        else {
            printf("%s\n", p.path);
            for (int i = 0; p.argv[i]; i++) printf("%s\n", p.argv[i]);
        }
    } else if (!strcmp(cmd, "known") && argc >= 4) {
        struct helper_plan p;
        if (helper_plan(argc - 3, argv + 3, argv[2], -1, &p, &err)) { printf("error: %s\n", err); return 0; }
        int i = helper_first_unknown(argv[2], &p);
        printf("%s\n", i < 0 ? "all known" : p.packages[i]);
    } else if (!strcmp(cmd, "uri") || !strcmp(cmd, "suite") || !strcmp(cmd, "component")) {
        int (*ok)(const char *) = cmd[0] == 'u' ? helper_uri_ok : cmd[0] == 's' ? helper_suite_ok : helper_component_ok;
        for (int i = 2; i < argc; i++) printf("%s\n", ok(argv[i]) ? "ok" : "bad");
    } else if (!strcmp(cmd, "apply") && argc >= 4) {
        struct helper_plan p;
        int changed;
        if (helper_plan(argc - 3, argv + 3, argv[2], -1, &p, &err) || helper_sources_apply(&p, &changed, &err))
            printf("error: %s\n", err);
        else printf("%s\n", changed ? "changed" : "unchanged");
    } else if (!strcmp(cmd, "caller") && argc == 7) {
        if (helper_caller_ok((uid_t)atol(argv[2]), (uid_t)atol(argv[3]), (uid_t)atol(argv[4]), argv[5], argv[6], &err))
            printf("error: %s\n", err);
        else printf("ok\n");
    } else if (!strcmp(cmd, "ipapath") && argc >= 3) {
        for (int i = 3; i < argc; i++) printf("%s\n", helper_ipa_path_ok(argv[2], argv[i]) ? "ok" : "bad");
    } else if (!strcmp(cmd, "paidpath") && argc >= 3) {
        for (int i = 3; i < argc; i++) printf("%s\n", helper_paid_path_ok(argv[2], argv[i]) ? "ok" : "bad");
    } else if (!strcmp(cmd, "plistid") && argc == 3) {
        static char buf[1 << 20];
        char id[HELPER_NAME_MAX + 1];
        FILE *f = fopen(argv[2], "rb");
        size_t n = f ? fread(buf, 1, sizeof buf, f) : 0;
        if (f) fclose(f);
        printf("%s\n", helper_ipa_plist_id(buf, n, id, sizeof id) ? "bad" : id);
    } else if (!strcmp(cmd, "appversions") && argc == 3) {
        char *text = NULL;
        size_t size = 0;
        FILE *mem = open_memstream(&text, &size);
        const char *err = NULL;
        int n = mem ? helper_app_versions(argv[2], mem, &err) : -1;
        if (mem) fclose(mem);
        for (char *p = text; p && *p; p++) {
            if (*p == '\t') fputs(" | ", stdout);
            else putchar(*p);
        }
        free(text);
        if (n < 0) printf("error: %s\n", err ? err : "no memory");
        else printf("count: %d\n", n);
    } else if (!strcmp(cmd, "appsync") && argc == 3) {
        printf("%s\n", helper_ipa_appsync(argv[2]) ? "yes" : "no");
    } else if (!strcmp(cmd, "oscmp") && argc >= 3 && argc % 2 == 0) {
        for (int i = 2; i + 1 < argc; i += 2) printf("%d\n", helper_ipa_os_cmp(argv[i], argv[i + 1]));
    } else if (!strcmp(cmd, "whyclean") && argc == 3) {
        char buf[2048];
        snprintf(buf, sizeof buf, "%s", argv[2]);
        helper_ipa_why_clean(buf);
        printf("%s\n", buf);
    } else if (!strcmp(cmd, "debname") && argc >= 3) {
        char ver[HELPER_VERSION_MAX + 1];
        for (int i = 3; i < argc; i++) printf("%s\n", helper_deb_name_version(argv[i], argv[2], ver, sizeof ver) ? ver : "bad");
    } else if (!strcmp(cmd, "rbfile") && argc == 6) {
        char out[PATH_MAX];
        if (helper_rollback_file(argv[2], argv[3], argv[4], (uid_t)atol(argv[5]), out, sizeof out, &err)) printf("error: %s\n", err);
        else printf("%s\n", out);
    } else if (!strcmp(cmd, "rblist") && argc == 5) {
        static char out[1 << 16];
        int n = helper_rollback_list(argv[2], argv[3], (uid_t)atol(argv[4]), out, sizeof out, &err);
        if (n < 0) printf("error: %s\n", err);
        else printf("%scount: %d\n", out, n);
    } else if (!strcmp(cmd, "control") && argc == 5) {
        static char text[1 << 16];
        size_t j = 0;
        for (const char *q = argv[4]; *q && j + 1 < sizeof text; q++) {
            if (q[0] == '\\' && q[1] == 'n') { text[j++] = '\n'; q++; } else text[j++] = *q;
        }
        text[j] = 0;
        printf("%s\n", helper_control_matches(text, argv[2], argv[3]) ? "ok" : "bad");
    } else if (!strcmp(cmd, "rbverify") && argc == 6) {
        if (helper_rollback_verify(argv[2], argv[3], argv[4], argv[5], &err)) printf("error: %s\n", err);
        else printf("ok\n");
    } else if (!strcmp(cmd, "spawn") && argc >= 3) {
        return spawn(argc - 2, argv + 2, NULL);
    } else if (!strcmp(cmd, "spawn-replaced") && argc >= 5) {
        if (strcmp(argv[2], "keep")) {
            char *hold[] = {argv[3], "hold-self", "on"};
            char *args[] = {hold[0], hold[1], hold[2], NULL};
            if (spawn(3, args, NULL)) return 1;
        }
        char next[4096];
        snprintf(next, sizeof next, "%s.new", argv[0]);
        if (rename(next, argv[0])) { perror("rename"); return 1; }
        return spawn(argc - 3, argv + 3, NULL);
    } else if (!strcmp(cmd, "spawn-quit") && argc >= 3) {
        return spawn_quit(argv + 2);
    } else if (!strcmp(cmd, "spawn-ask") && argc >= 4) {
        return spawn(argc - 3, argv + 3, argv[2]);
    } else return 2;
    return 0;
}
