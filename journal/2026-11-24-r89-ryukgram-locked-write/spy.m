// R89: the same checks as app.m, as a dylib that RyukGram's IPA loads before its own code (see ../2026-11-23-b390-ryukgram/prep.py,
// which adds it as a dependency of CydiaSubstrate). Documents/r89.sleep makes the constructor sleep 18 s, so the phone can be locked
// before the app starts. Logs through os_log; writes one key while locked (r89.L1) and one 3 s after the unlock (r89.U1).
#import <UIKit/UIKit.h>
#import <os/log.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
static NSString *run;
static BOOL prot, startedLocked;
static NSString *pf(void) { return [NSString stringWithFormat:@"%@/Library/Preferences/%@.plist", NSHomeDirectory(), NSBundle.mainBundle.bundleIdentifier]; }
static long domKeys(void) { CFArrayRef k = CFPreferencesCopyKeyList(kCFPreferencesCurrentApplication, kCFPreferencesCurrentUser, kCFPreferencesAnyHost); long n = k ? CFArrayGetCount(k) : -1; if (k) CFRelease(k); return n; }
static long fileKeys(void) { NSDictionary *d = [NSDictionary dictionaryWithContentsOfFile:pf()]; return d ? (long)d.count : -1; }
static NSString *fileVal(NSString *k) { NSDictionary *d = [NSDictionary dictionaryWithContentsOfFile:pf()]; return d ? (d[k] ? [NSString stringWithFormat:@"%@", d[k]] : @"-") : @"?"; }
static void say(NSString *s) { os_log(OS_LOG_DEFAULT, "r89 %{public}s", s.UTF8String); }
static void tick(NSString *t) {
    NSUserDefaults *u = NSUserDefaults.standardUserDefaults;
    say([NSString stringWithFormat:@"%@: protectedData %d, domain keys %ld, file keys %ld, file L1 %@ U1 %@, run %@, L1 %@, U1 %@", t, prot, domKeys(), fileKeys(), fileVal(@"r89.L1"), fileVal(@"r89.U1"), run, [u objectForKey:@"r89.L1"] ? @"yes" : @"no", [u objectForKey:@"r89.U1"] ? @"yes" : @"no"]);
}
static int prefClass(void) { int fd = open(pf().fileSystemRepresentation, O_RDONLY); if (fd < 0) return -errno; int c = fcntl(fd, 63); close(fd); return c; }
static void setClassA(void) { // Documents/r89.classA: make the preferences file Complete (class 1), as a container made under Complete has it
    NSString *cf = [NSHomeDirectory() stringByAppendingPathComponent:@"Documents/r89.classA"];
    if (![NSFileManager.defaultManager fileExistsAtPath:cf]) return;
    [NSFileManager.defaultManager removeItemAtPath:cf error:nil];
    int fd = open(pf().fileSystemRepresentation, O_RDONLY); int r = fd < 0 ? -1 : fcntl(fd, 64 /* F_SETPROTECTIONCLASS */, 1); int e = errno; int c = fd < 0 ? -1 : fcntl(fd, 63); if (fd >= 0) close(fd);
    say([NSString stringWithFormat:@"set preferences file to class A: result %d (errno %d), class now %d", r, e, c]);
}
__attribute__((constructor)) static void early(void) {
    run = [NSString stringWithFormat:@"%.0f", [NSDate date].timeIntervalSince1970];
    setClassA();
    say([NSString stringWithFormat:@"start (unlocked, before any sleep): preferences file class %d", prefClass()]);
    NSString *sf = [NSHomeDirectory() stringByAppendingPathComponent:@"Documents/r89.sleep"];
    if ([NSFileManager.defaultManager fileExistsAtPath:sf]) { [NSFileManager.defaultManager removeItemAtPath:sf error:nil]; say(@"sleeping 18 s before anything"); sleep(18); }
    say([NSString stringWithFormat:@"constructor: file keys %ld (read directly)", fileKeys()]);
    [NSNotificationCenter.defaultCenter addObserverForName:UIApplicationDidFinishLaunchingNotification object:nil queue:nil usingBlock:^(NSNotification *n) {
        UIApplication *a = n.object; prot = a.protectedDataAvailable; startedLocked = !prot;
        if ([NSFileManager.defaultManager fileExistsAtPath:[NSHomeDirectory() stringByAppendingPathComponent:@"Documents/r89.crash"]]) { // Documents/r89.crash (kept): crash 2 s after launch, to count as a launch crash
            say(@"crash on purpose in 2 s"); dispatch_after(dispatch_time(0, 2 * NSEC_PER_SEC), dispatch_get_global_queue(0, 0), ^{ abort(); });
        }
        [NSNotificationCenter.defaultCenter addObserverForName:UIApplicationProtectedDataDidBecomeAvailable object:nil queue:nil usingBlock:^(NSNotification *n2) { prot = YES; say(@"protected data became available"); }];
        [NSNotificationCenter.defaultCenter addObserverForName:UIApplicationProtectedDataWillBecomeUnavailable object:nil queue:nil usingBlock:^(NSNotification *n2) { prot = NO; say(@"protected data will become unavailable"); }];
        say([NSString stringWithFormat:@"launch: startedLocked %d, domain keys %ld", startedLocked, domKeys()]);
        dispatch_async(dispatch_get_global_queue(0, 0), ^{
            BOOL doneL = NO, doneU = NO; int sinceUnlock = -1;
            for (int i = 0; i < 100000; i++) {
                sleep(1);
                if (i % 5 == 0) tick([NSString stringWithFormat:@"t%d", i]);
                NSUserDefaults *u = NSUserDefaults.standardUserDefaults;
                if (!prot && !doneL && i >= 4) { doneL = YES; [u setObject:run forKey:@"r89.L1"]; [u synchronize]; tick(@"after L1 write (locked)"); }
                if (prot && startedLocked && !doneU) { if (sinceUnlock < 0) sinceUnlock = 0; if (++sinceUnlock >= 3) { doneU = YES; [u setObject:run forKey:@"r89.U1"]; [u synchronize]; tick(@"after U1 write"); sleep(2); tick(@"U1 +2 s"); } }
            }
        });
    }];
}
