// R95: a probe that loads before RyukGram's Instagram (prep.py of B390 adds it as a dependency of CydiaSubstrate). It reports what a
// process with this app's entitlements sees: the same keychain groups and app groups the notification extension has (the signer gives
// the extension the app's entitlements). Counts and paths only, never values. Report: Library/r95-<time>.txt in the container.
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <os/log.h>
#include <dlfcn.h>
#include <ftw.h>
typedef OSStatus (*CopyFn)(CFDictionaryRef, CFTypeRef *);
static NSMutableString *out;
static void say(NSString *fmt, ...) NS_FORMAT_FUNCTION(1, 2);
static void say(NSString *fmt, ...) { va_list a; va_start(a, fmt); NSString *s = [[NSString alloc] initWithFormat:fmt arguments:a]; va_end(a); [out appendFormat:@"%@\n", s]; os_log(OS_LOG_DEFAULT, "r95 %{public}s", s.UTF8String); }
static CopyFn realCopy(void) { static CopyFn f; if (!f) f = (CopyFn)dlsym(RTLD_DEFAULT, "SecItemCopyMatching"); return f; }
// attributes of generic passwords (optionally one group, optionally the zx entry only); nil group = no kSecAttrAccessGroup
static NSArray *items(NSString *group, BOOL zxOnly, BOOL one) {
    NSMutableDictionary *q = [@{ (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword, (__bridge id)kSecReturnAttributes: @YES,
        (__bridge id)kSecMatchLimit: one ? (__bridge id)kSecMatchLimitOne : (__bridge id)kSecMatchLimitAll } mutableCopy];
    if (group) q[(__bridge id)kSecAttrAccessGroup] = group;
    if (zxOnly) { q[(__bridge id)kSecAttrAccount] = @"zxPluginsInjectGenericEntry"; q[(__bridge id)kSecAttrService] = @""; }
    CFTypeRef r = NULL; OSStatus s = realCopy()((__bridge CFDictionaryRef)q, &r);
    if (s != errSecSuccess || !r) return s == errSecItemNotFound ? @[] : nil;
    id o = CFBridgingRelease(r); return [o isKindOfClass:NSArray.class] ? o : @[ o ];
}
static NSString *fmtDate(id d) { return [d isKindOfClass:NSDate.class] ? [NSISO8601DateFormatter stringFromDate:d timeZone:[NSTimeZone timeZoneForSecondsFromGMT:0] formatOptions:NSISO8601DateFormatWithInternetDateTime] : @"-"; }
// Which of two groups a group-less read (limit one) returns when both hold a match: the older item, or the first group of the
// entitlements? Writes two test items (account r95order, no value), reads, deletes them. Run once per order.
typedef OSStatus (*AddFn)(CFDictionaryRef, CFTypeRef *);
typedef OSStatus (*DelFn)(CFDictionaryRef);
static void orderTest(void) {
    AddFn add = (AddFn)dlsym(RTLD_DEFAULT, "SecItemAdd"); DelFn del = (DelFn)dlsym(RTLD_DEFAULT, "SecItemDelete");
    NSString *a = @"S8NFX3A2LT.com.burbn.instagram", *b = @"S8NFX3A2LT.com.ryha.sideload";
    for (int round = 0; round < 2; round++) {
        NSString *first = round ? a : b, *second = round ? b : a; // the one added first is the older
        for (NSString *g in @[ first, second ]) {
            NSDictionary *q = @{ (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword, (__bridge id)kSecAttrAccount: @"r95order", (__bridge id)kSecAttrService: @"r95", (__bridge id)kSecAttrAccessGroup: g,
                                 (__bridge id)kSecValueData: [NSData dataWithBytes:"x" length:1], (__bridge id)kSecAttrAccessible: (__bridge id)kSecAttrAccessibleAfterFirstUnlock };
            OSStatus s = add((__bridge CFDictionaryRef)q, NULL); if (s) say(@"order test: add in %@ failed %d", g, (int)s);
            usleep(1100000);
        }
        NSDictionary *r = items(nil, NO, YES) ? nil : nil; (void)r;
        NSDictionary *q = @{ (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword, (__bridge id)kSecAttrAccount: @"r95order", (__bridge id)kSecAttrService: @"r95", (__bridge id)kSecReturnAttributes: @YES, (__bridge id)kSecMatchLimit: (__bridge id)kSecMatchLimitOne };
        CFTypeRef out1 = NULL; realCopy()((__bridge CFDictionaryRef)q, &out1);
        say(@"order test round %d: older item in %@, newer in %@; a group-less read returns %@", round, first, second, out1 ? ((__bridge NSDictionary *)out1)[(__bridge id)kSecAttrAccessGroup] : @"nothing"); if (out1) CFRelease(out1);
        for (NSString *g in @[ a, b ]) del((__bridge CFDictionaryRef)@{ (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword, (__bridge id)kSecAttrAccount: @"r95order", (__bridge id)kSecAttrService: @"r95", (__bridge id)kSecAttrAccessGroup: g });
    }
}
static void keychain(void) {
    NSString *T = @"S8NFX3A2LT.";
    for (NSString *g in @[ @"com.burbn.instagram", @"com.ryha.sideload" ]) {
        NSArray *all = items([T stringByAppendingString:g], NO, NO), *zx = items([T stringByAppendingString:g], YES, NO);
        say(@"keychain %@%@: generic passwords %@, zxPluginsInjectGenericEntry %@", T, g, all ? @(all.count) : @"error", zx ? @(zx.count) : @"error");
        for (NSDictionary *d in zx) say(@"  zx entry created %@ modified %@ accessible %@", fmtDate(d[(__bridge id)kSecAttrCreationDate]), fmtDate(d[(__bridge id)kSecAttrModificationDate]), d[(__bridge id)kSecAttrAccessible]);
    }
    // what the extension's decryption reads (strings in the extension: services com.instagram.notifications.hpke / .encryption)
    for (NSString *g in @[ @"com.burbn.instagram", @"com.ryha.sideload" ]) {
        for (NSDictionary *d in items([T stringByAppendingString:g], NO, NO)) {
            NSString *sv = d[(__bridge id)kSecAttrService] ?: @"";
            if ([sv rangeOfString:@"notification" options:NSCaseInsensitiveSearch].location != NSNotFound || [sv rangeOfString:@"hpke" options:NSCaseInsensitiveSearch].location != NSNotFound || [sv rangeOfString:@"push" options:NSCaseInsensitiveSearch].location != NSNotFound)
                say(@"  %@%@ service %@: accessible %@, created %@, modified %@", T, g, sv, d[(__bridge id)kSecAttrAccessible], fmtDate(d[(__bridge id)kSecAttrCreationDate]), fmtDate(d[(__bridge id)kSecAttrModificationDate]));
        }
        for (id cls in @[ (__bridge id)kSecClassKey, (__bridge id)kSecClassInternetPassword, (__bridge id)kSecClassCertificate, (__bridge id)kSecClassIdentity ]) {
            NSDictionary *q = @{ (__bridge id)kSecClass: cls, (__bridge id)kSecAttrAccessGroup: [T stringByAppendingString:g], (__bridge id)kSecReturnAttributes: @YES, (__bridge id)kSecMatchLimit: (__bridge id)kSecMatchLimitAll };
            CFTypeRef r = NULL; OSStatus s = realCopy()((__bridge CFDictionaryRef)q, &r);
            say(@"  %@%@ class %@: %@", T, g, cls, s == errSecSuccess ? @(((__bridge NSArray *)r).count) : s == errSecItemNotFound ? @0 : @(s)); if (r) CFRelease(r);
        }
    }
    for (NSString *g in @[ @"MH9GU9K5PX.shared", @"MH9GU9K5PX.platformFamily", @"MH9GU9K5PX.com.burbn.instagram" ]) {
        NSArray *all = items(g, NO, NO); say(@"keychain %@ (the original group, not in the entitlements): %@", g, all ? @(all.count) : @"refused");
    }
    NSArray *none = items(nil, YES, YES);
    say(@"group-less read of the zx entry (what zxPluginsInject's start-up does): %@", none.count ? none[0][(__bridge id)kSecAttrAccessGroup] : @"none found");
    NSArray *allNone = items(nil, YES, NO);
    NSMutableDictionary *by = [NSMutableDictionary dictionary]; for (NSDictionary *d in allNone) by[d[(__bridge id)kSecAttrAccessGroup]] = @([by[d[(__bridge id)kSecAttrAccessGroup]] intValue] + 1);
    say(@"group-less read, all matches by group: %@", by);
}
static long fcount, fbytes;
static int visit(const char *p, const struct stat *st, int t, struct FTW *f) { if (t == FTW_F) { fcount++; fbytes += st->st_size; } return 0; }
static void tree(NSString *label, NSString *path) {
    fcount = fbytes = 0; if (!path) { say(@"%@: none", label); return; }
    nftw(path.fileSystemRepresentation, visit, 16, FTW_PHYS);
    NSArray *top = [NSFileManager.defaultManager contentsOfDirectoryAtPath:path error:nil];
    say(@"%@: %@ — %ld files, %ld bytes; top level %@", label, path.lastPathComponent, fcount, fbytes, top);
}
static NSString *real(NSString *group) { NSURL *u = [NSFileManager.defaultManager containerURLForSecurityApplicationGroupIdentifier:group]; return u.path; }
static void prefsIn(NSString *label, NSString *dir) {
    for (NSString *n in [NSFileManager.defaultManager contentsOfDirectoryAtPath:dir error:nil]) {
        if (![n hasSuffix:@".plist"]) continue;
        NSDictionary *d = [NSDictionary dictionaryWithContentsOfFile:[dir stringByAppendingPathComponent:n]];
        say(@"  %@ %@: %lu keys", label, n, (unsigned long)d.count);
    }
}
// What an extension (zxPluginsInject only) reads for the suite group.com.burbn.instagram: the shim plist in the profile group's
// folder (this phone's group.com.ryha.sideload.1, a fixed UUID), against what the app (group fix) writes: its own suite.
// Only counts, whether values are equal, and times; never a value.
static void shimCompare(NSString *orig) {
    NSString *shim = [NSString stringWithFormat:@"/private/var/mobile/Containers/Shared/AppGroup/531F199D-DE93-4F08-8581-803876CFE1CC/%@/Library/Preferences/%@.plist", orig, orig];
    NSDictionary *a = [NSDictionary dictionaryWithContentsOfFile:shim];
    NSDictionary *at = [NSFileManager.defaultManager attributesOfItemAtPath:shim error:nil];
    CFArrayRef k = CFPreferencesCopyKeyList((__bridge CFStringRef)[@"ifizbox.appgroup." stringByAppendingString:orig], kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
    NSMutableDictionary *b = [NSMutableDictionary dictionary];
    for (NSString *n in (__bridge NSArray *)k) { id v = CFBridgingRelease(CFPreferencesCopyValue((__bridge CFStringRef)n, (__bridge CFStringRef)[@"ifizbox.appgroup." stringByAppendingString:orig], kCFPreferencesCurrentUser, kCFPreferencesAnyHost)); if (v) b[n] = v; }
    if (k) CFRelease(k);
    int same = 0, differ = 0, missing = 0;
    NSMutableArray *diff = [NSMutableArray array], *miss = [NSMutableArray array];
    for (NSString *n in a) { id o = b[n]; if (!o) { missing++; [miss addObject:n]; } else if ([[NSString stringWithFormat:@"%@", o] isEqualToString:[NSString stringWithFormat:@"%@", a[n]]]) same++; else { differ++; [diff addObject:n]; } }
    say(@"shim plist for %@ (what the extension reads): %lu keys, modified %@; app's own suite: %lu keys. Of the shim's keys: %d equal, %d differ %@, %d not in the app's suite %@", orig, (unsigned long)a.count, fmtDate(at[NSFileModificationDate]), (unsigned long)b.count, same, differ, diff, missing, miss);
}
static void files(void) {
    shimCompare(@"group.com.burbn.instagram"); shimCompare(@"group.com.facebook.family");
    NSString *home = NSHomeDirectory();
    say(@"app's own Library/AppGroups (the group fix's place):"); tree(@"  AppGroups", [home stringByAppendingPathComponent:@"Library/AppGroups"]);
    for (NSString *g in @[ @"group.com.burbn.instagram", @"group.com.facebook.family", @"group.com.burbn.family" ]) {
        NSString *p = real(g); say(@"containerURL for %@ as the app gets it: %@", g, p ? p : @"nil");
        if (p) { tree(@"  tree", p); prefsIn(@"  Library/Preferences", [p stringByAppendingPathComponent:@"Library/Preferences"]); }
    }
    say(@"profile groups (what an extension without the group fix reaches through zxPluginsInject):");
    for (int i = 1; i <= 5; i++) {
        NSString *g = [NSString stringWithFormat:@"group.com.ryha.sideload.%d", i], *p = real(g);
        tree([@"  " stringByAppendingString:g], p);
        if (!p) continue;
        for (NSString *o in @[ @"group.com.burbn.instagram", @"group.com.facebook.family", @"group.com.burbn.family" ]) {
            NSString *s = [p stringByAppendingPathComponent:o];
            if ([NSFileManager.defaultManager fileExistsAtPath:s]) { tree([@"    shim " stringByAppendingString:o], s); prefsIn(@"    shim prefs", [s stringByAppendingPathComponent:@"Library/Preferences"]); }
        }
        prefsIn(@"    group prefs", [p stringByAppendingPathComponent:@"Library/Preferences"]);
    }
    for (NSString *d in @[ @"group.com.burbn.instagram", @"ifizbox.appgroup.group.com.burbn.instagram", @"group.com.facebook.family", @"ifizbox.appgroup.group.com.facebook.family" ]) {
        CFArrayRef k = CFPreferencesCopyKeyList((__bridge CFStringRef)d, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
        say(@"suite domain %@: %ld keys", d, k ? CFArrayGetCount(k) : -1L);
        if (k) { // key names only (never values): all of a small suite, the push/user/key-looking ones of a big one
            NSArray *names = [(__bridge NSArray *)k sortedArrayUsingSelector:@selector(compare:)];
            NSRegularExpression *re = [NSRegularExpression regularExpressionWithPattern:@"push|notif|hpke|token|account|user|login|logged|key|ig_|mailbox|dedup" options:NSRegularExpressionCaseInsensitive error:nil];
            NSMutableArray *show = [NSMutableArray array];
            for (NSString *n in names) if (names.count <= 20 || [re firstMatchInString:n options:0 range:NSMakeRange(0, n.length)]) [show addObject:n.length > 60 ? [n substringToIndex:60] : n];
            say(@"  names%@: %@", names.count <= 20 ? @"" : [NSString stringWithFormat:@" matching push/user/key (%lu of %lu)", (unsigned long)show.count, (unsigned long)names.count], [show componentsJoinedByString:@", "]);
            CFRelease(k);
        }
    }
    for (NSString *o in @[ @"group.com.burbn.instagram", @"group.com.facebook.family" ]) {
        NSUserDefaults *u = [[NSUserDefaults alloc] initWithSuiteName:o]; say(@"initWithSuiteName:%@ dictionary count %lu", o, (unsigned long)u.dictionaryRepresentation.count);
    }
}
static void snap(NSString *label) {
    out = [NSMutableString string];
    say(@"r95 %@ at %@ (%@ %@)", label, fmtDate(NSDate.date), NSBundle.mainBundle.bundleIdentifier, NSBundle.mainBundle.infoDictionary[@"CFBundleShortVersionString"]);
    keychain(); files();
    if ([label isEqualToString:@"t80"]) orderTest();
    NSString *f = [NSHomeDirectory() stringByAppendingPathComponent:[NSString stringWithFormat:@"Library/r95-%@.txt", label]];
    [out writeToFile:f atomically:YES encoding:NSUTF8StringEncoding error:nil];
}
__attribute__((constructor)) static void early(void) {
    for (NSNumber *s in @[ @25, @80 ]) dispatch_after(dispatch_time(DISPATCH_TIME_NOW, s.intValue * NSEC_PER_SEC), dispatch_get_global_queue(0, 0), ^{ snap([NSString stringWithFormat:@"t%@", s]); });
}
