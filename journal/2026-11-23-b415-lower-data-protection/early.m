// B415 test: maps the app's counter file before the probe's sleep (the phone is still unlocked then) and reads it after,
// from app.m: locked and Complete, the page can't be read in and the process dies of SIGBUS.
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/mman.h>
volatile int *earlyCounter;
__attribute__((constructor)) static void mapEarly(void) {
    char p[1024];
    snprintf(p, sizeof p, "%s/Library/Application Support/mapped/deep/counter", getenv("HOME"));
    int fd = open(p, O_RDWR);
    if (fd < 0) return;
    void *m = mmap(NULL, 16384, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    if (m != MAP_FAILED) earlyCounter = m;
}
