// R89 test app: does a process that started while the phone was locked, with unreadable preferences, write over them
// once the phone is unlocked? Seeds 300 preference keys at its first launch; at each launch logs (os_log) the key
// counts of the preferences domain (what cfprefsd gives this process) and of the file (read directly), writes one key
// while locked (L1) and one 3 s after the unlock (U1), then keeps logging. Documents/r89.sleep (put there while the phone
// is unlocked) makes the constructor sleep 18 s first, so the phone can be locked before any app code runs.
#import <UIKit/UIKit.h>
#import <os/log.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
static NSString *run;
static BOOL prot;
static NSString *pf(void) { return [NSString stringWithFormat:@"%@/Library/Preferences/%@.plist", NSHomeDirectory(), NSBundle.mainBundle.bundleIdentifier]; }
static long domKeys(void) { CFArrayRef k = CFPreferencesCopyKeyList(kCFPreferencesCurrentApplication, kCFPreferencesCurrentUser, kCFPreferencesAnyHost); long n = k ? CFArrayGetCount(k) : -1; if (k) CFRelease(k); return n; }
static long fileKeys(void) { NSDictionary *d = [NSDictionary dictionaryWithContentsOfFile:pf()]; return d ? (long)d.count : -1; }
static void say(NSString *s) { os_log(OS_LOG_DEFAULT, "r89 %{public}s", s.UTF8String); }
static void tick(NSString *t) {
    NSUserDefaults *u = NSUserDefaults.standardUserDefaults;
    say([NSString stringWithFormat:@"%@: protectedData %d, domain keys %ld, file keys %ld, seed %@, L1 %@, U1 %@, N1 %@", t, prot, domKeys(), fileKeys(), [u objectForKey:@"r89.seed"] ? @"yes" : @"no", [u objectForKey:@"r89.L1"] ? @"yes" : @"no", [u objectForKey:@"r89.U1"] ? @"yes" : @"no", [u objectForKey:@"r89.N1"] ? @"yes" : @"no"]);
}
static int prefClass(void) { int fd = open(pf().fileSystemRepresentation, O_RDONLY); if (fd < 0) return -errno; int c = fcntl(fd, 63); close(fd); return c; }
static NSString *fileVal(NSString *k) { NSDictionary *d = [NSDictionary dictionaryWithContentsOfFile:pf()]; return d ? (d[k] ? [NSString stringWithFormat:@"%@", d[k]] : @"-") : @"?"; }
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
}
@interface AppDelegate : UIResponder <UIApplicationDelegate>
@end
@implementation AppDelegate
- (BOOL)application:(UIApplication *)a didFinishLaunchingWithOptions:(NSDictionary *)o {
    prot = a.protectedDataAvailable; BOOL startedLocked = !prot;
    [NSNotificationCenter.defaultCenter addObserverForName:UIApplicationProtectedDataDidBecomeAvailable object:nil queue:nil usingBlock:^(NSNotification *n) { prot = YES; say(@"protected data became available"); }];
    [NSNotificationCenter.defaultCenter addObserverForName:UIApplicationProtectedDataWillBecomeUnavailable object:nil queue:nil usingBlock:^(NSNotification *n) { prot = NO; say(@"protected data will become unavailable"); }];
    __block UIBackgroundTaskIdentifier bt = [a beginBackgroundTaskWithExpirationHandler:^{ say(@"background task expired"); }];
    NSUserDefaults *u = NSUserDefaults.standardUserDefaults;
    say([NSString stringWithFormat:@"launch: startedLocked %d, domain keys %ld, seed %@", startedLocked, domKeys(), [u objectForKey:@"r89.seed"]]);
    if (![u objectForKey:@"r89.seed"] && !startedLocked) {
        for (int i = 0; i < 300; i++) [u setObject:@(i) forKey:[NSString stringWithFormat:@"seed%d", i]];
        [u setObject:@"1" forKey:@"r89.seed"]; [u synchronize]; say(@"seeded 300 keys");
    }
    dispatch_async(dispatch_get_global_queue(0, 0), ^{
        BOOL doneL = NO, doneU = NO, doneN = NO; int sinceUnlock = -1;
        for (int i = 0; i < 100000; i++) {
            sleep(1);
            if (i % 5 == 0) tick([NSString stringWithFormat:@"t%d", i]);
            NSUserDefaults *u = NSUserDefaults.standardUserDefaults;
            if (!prot && !doneL && i >= 4) { doneL = YES; [u setObject:run forKey:@"r89.L1"]; [u synchronize]; tick(@"after L1 write (locked)"); }
            if (prot && startedLocked && !doneU) { if (sinceUnlock < 0) sinceUnlock = 0; if (++sinceUnlock >= 3) { doneU = YES; [u setObject:run forKey:@"r89.U1"]; [u synchronize]; tick(@"after U1 write"); sleep(2); tick(@"U1 +2 s"); } }
            if (!startedLocked && !doneN && i >= 4) { doneN = YES; [u setObject:@"1" forKey:@"r89.N1"]; [u synchronize]; tick(@"after N1 write"); }
        }
    });
    return YES;
}
@end
@interface SceneDelegate : UIResponder <UIWindowSceneDelegate>
@property(nonatomic) UIWindow *window;
@end
@implementation SceneDelegate
- (void)scene:(UIScene *)s willConnectToSession:(UISceneSession *)x options:(UISceneConnectionOptions *)o {
    self.window = [[UIWindow alloc] initWithWindowScene:(UIWindowScene *)s];
    self.window.rootViewController = [UIViewController new];
    self.window.backgroundColor = UIColor.whiteColor;
    [self.window makeKeyAndVisible];
}
@end
int main(int argc, char **argv) { @autoreleasepool { return UIApplicationMain(argc, argv, nil, @"AppDelegate"); } }
