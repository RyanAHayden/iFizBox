/* F374: test_decrypt.py's driver for decrypt.c (built on the host; on the phone, the same file built for iOS checks
 * a real App Store app by hand: see the F374 journal).
 *   decrypt_driver crypt <file>                         every slice's encryption info, one line each, then "count: n"
 *   decrypt_driver userapps <dir>                       helper_user_apps' lines, then "count: n"
 *   decrypt_driver decrypt <apps> <drop> <id>           helper_decrypt_app's lines, then "exit: n" (and "error: ...")
 * SPDX-License-Identifier: GPL-3.0-or-later */
#include "decrypt.h"

#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

int main(int argc, char *argv[]) {
    const char *err = "";
    if (argc == 3 && !strcmp(argv[1], "crypt")) {
        int fd = open(argv[2], O_RDONLY);
        struct stat st;
        if (fd < 0 || fstat(fd, &st)) { perror(argv[2]); return 2; }
        struct helper_crypt c[HELPER_CRYPT_MAX];
        int n = helper_macho_crypt(fd, (unsigned long long)st.st_size, c, HELPER_CRYPT_MAX);
        for (int i = 0; i < n; i++)
            printf("slice %llu cpu %u/%u off %u size %u id %u at %llu\n", (unsigned long long)c[i].slice_off, c[i].cputype,
                   c[i].cpusubtype, c[i].cryptoff, c[i].cryptsize, c[i].cryptid, (unsigned long long)c[i].cryptid_at);
        printf("count: %d\n", n);
        if (n > 0) printf("encrypted: %d\n", helper_crypt_encrypted(c, n));
        return 0;
    }
    if (argc == 3 && !strcmp(argv[1], "userapps")) {
        int n = helper_user_apps(argv[2], stdout, &err);
        if (n < 0) printf("error: %s\n", err);
        printf("count: %d\n", n);
        return 0;
    }
    if (argc == 5 && !strcmp(argv[1], "decrypt")) {
        int rc = helper_decrypt_app(argv[2], argv[3], argv[4], -1, stdout, &err);
        if (rc) printf("error: %s\n", err);
        printf("exit: %d\n", rc);
        return 0;
    }
    fprintf(stderr, "usage: decrypt_driver crypt <file> | userapps <dir> | decrypt <apps> <drop> <id>\n");
    return 2;
}
