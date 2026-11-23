// B392 test dylib, linked by the probe so it inits before the group fix (as RyukGram's does): writes a preference and a
// file in its initialiser, logs the container's times and the keychain item b392.session before and after the fix.
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#include <sys/stat.h>
#include <sys/sysctl.h>
#include <dlfcn.h>
#include <unistd.h>
static NSMutableString *out;
static NSString *t(struct timespec s) { return [NSString stringWithFormat:@"%ld.%03ld", (long)s.tv_sec, s.tv_nsec / 1000000]; }
static void item(NSString *when, BOOL add) {
    NSDictionary *q = @{ (id)kSecClass: (id)kSecClassGenericPassword, (id)kSecAttrService: @"b392.session", (id)kSecAttrAccount: @"a" };
    NSMutableDictionary *r = [q mutableCopy]; r[(id)kSecReturnData] = @YES; r[(id)kSecReturnAttributes] = @YES;
    CFTypeRef o = NULL; OSStatus st = SecItemCopyMatching((__bridge CFDictionaryRef)r, &o);
    if (st == errSecItemNotFound && add) {
        NSMutableDictionary *a = [q mutableCopy];
        a[(id)kSecValueData] = [[NSString stringWithFormat:@"%@ %.0f", NSBundle.mainBundle.bundleIdentifier, NSDate.date.timeIntervalSince1970] dataUsingEncoding:4];
        [out appendFormat:@"%@ added st=%d\n", when, (int)SecItemAdd((__bridge CFDictionaryRef)a, NULL)];
        st = SecItemCopyMatching((__bridge CFDictionaryRef)r, &o);
    }
    NSDictionary *d = CFBridgingRelease(o);
    [out appendFormat:@"%@ read st=%d %@ in %@ mdat %.0f\n", when, (int)st, st ? @"" : [[NSString alloc] initWithData:d[(id)kSecValueData] encoding:4],
        d[(id)kSecAttrAccessGroup], [d[(id)kSecAttrModificationDate] timeIntervalSince1970]];
}
__attribute__((constructor)) static void early(void) { @autoreleasepool {
    out = [NSMutableString string];
    struct kinfo_proc p; size_t n = sizeof p; int mib[4] = { CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid() };
    int e = sysctl(mib, 4, &p, &n, NULL, 0);
    [out appendFormat:@"\n== now %.3f sysctl %d start %ld.%06d\n", NSDate.date.timeIntervalSince1970, e, (long)p.kp_proc.p_un.__p_starttime.tv_sec, p.kp_proc.p_un.__p_starttime.tv_usec];
    NSString *h = NSHomeDirectory(); NSMutableArray *l = [@[ @"" ] mutableCopy];
    NSDirectoryEnumerator *en = [NSFileManager.defaultManager enumeratorAtPath:h]; for (NSString *f in en) [l addObject:f];
    for (NSString *f in l) { struct stat st; if (lstat([h stringByAppendingPathComponent:f].fileSystemRepresentation, &st)) continue;
        [out appendFormat:@"  %@%@ birth %@ ctime %@ mtime %@\n", f, S_ISDIR(st.st_mode) ? @"/" : @"", t(st.st_birthtimespec), t(st.st_ctimespec), t(st.st_mtimespec)]; }
    [NSUserDefaults.standardUserDefaults setObject:@"1" forKey:@"early"]; [NSUserDefaults.standardUserDefaults synchronize];
    [@"x" writeToFile:[h stringByAppendingPathComponent:@"Library/early.txt"] atomically:YES encoding:4 error:0];
#ifdef CLEAR // the app clears the group fix's mark
    CFPreferencesSetAppValue(CFSTR("ifizbox.groupfix.isolated"), NULL, kCFPreferencesCurrentApplication);
    CFPreferencesAppSynchronize(kCFPreferencesCurrentApplication);
#endif
#ifdef WRITE // the app writes its item anew, in its default group
    CFTypeRef (*mk)(CFAllocatorRef) = (void *)dlsym(RTLD_DEFAULT, "SecTaskCreateFromSelf");
    CFTypeRef (*get)(CFTypeRef, CFStringRef, CFErrorRef *) = (void *)dlsym(RTLD_DEFAULT, "SecTaskCopyValueForEntitlement");
    NSArray *gs = CFBridgingRelease(get(mk(NULL), CFSTR("keychain-access-groups"), NULL));
    NSDictionary *w = @{ (id)kSecClass: (id)kSecClassGenericPassword, (id)kSecAttrService: @"b392.session", (id)kSecAttrAccount: @"a", (id)kSecAttrAccessGroup: gs[0] };
    SecItemDelete((__bridge CFDictionaryRef)w);
    NSMutableDictionary *wa = [w mutableCopy];
    wa[(id)kSecValueData] = [[NSString stringWithFormat:@"%@ W %.0f", NSBundle.mainBundle.bundleIdentifier, NSDate.date.timeIntervalSince1970] dataUsingEncoding:4];
    [out appendFormat:@"fix-less write in %@ st=%d\n", gs[0], (int)SecItemAdd((__bridge CFDictionaryRef)wa, NULL)];
#endif
    item(@"before fix", NO);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        item(@"after fix", YES);
        NSString *log = [NSString stringWithContentsOfFile:[h stringByAppendingPathComponent:@"Library/ifizbox-groupfix.log"] encoding:4 error:0];
        [out appendFormat:@"LOG %@\n", [[log componentsSeparatedByString:@"\n"] filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"length > 0"]].lastObject];
        NSString *f = [h stringByAppendingPathComponent:@"Documents/early.log"];
        NSString *was = [NSString stringWithContentsOfFile:f encoding:4 error:0] ?: @"";
        [[was stringByAppendingString:out] writeToFile:f atomically:YES encoding:4 error:0];
    });
} }
