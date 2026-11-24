// B425: a probe in RyukGram's Instagram and in its notification extension. Counts, key names and paths only, never values.
// App (through CydiaSubstrate, B390's prep.py): starts the notification extension through PlugInKit, reports the copy the group fix put out.
// Extension (prep-ext.mjs adds the load command): what its own calls get for the groups' suites, folders and passwords.
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#include <dlfcn.h>
#include <objc/message.h>
static NSMutableString *out;
static void say(NSString *fmt, ...) { va_list a; va_start(a, fmt); [out appendFormat:@"%@\n", [[NSString alloc] initWithFormat:fmt arguments:a]]; va_end(a); }
static NSUInteger count(NSString *p) { NSUInteger n = 0; for (NSString *f in [NSFileManager.defaultManager enumeratorAtPath:p]) { BOOL d = NO; [NSFileManager.defaultManager fileExistsAtPath:[p stringByAppendingPathComponent:f] isDirectory:&d]; n += !d; } return n; }
static NSString *const G[] = { @"group.com.burbn.instagram", @"group.com.facebook.family", @"group.com.burbn.family" };
static NSString *rootPath(void) { return [[NSFileManager.defaultManager containerURLForSecurityApplicationGroupIdentifier:@"group.com.ryha.sideload.1"].path stringByAppendingPathComponent:@"ifizbox.shared/com.burbn.instagram"]; }
static void suites(BOOL ext) {
    for (int i = 0; i < 3; i++) {
        NSString *own = [@"ifizbox.appgroup." stringByAppendingString:G[i]];
        NSDictionary *mine = CFBridgingRelease(CFPreferencesCopyMultiple(NULL, (__bridge CFStringRef)own, kCFPreferencesCurrentUser, kCFPreferencesAnyHost));
        NSDictionary *copy = [NSDictionary dictionaryWithContentsOfFile:[rootPath() stringByAppendingPathComponent:[NSString stringWithFormat:@"suites/%@.plist", G[i]]]];
        NSUserDefaults *u = [[NSUserDefaults alloc] initWithSuiteName:G[i]];
        NSUInteger equal = 0, viaDefaults = 0;
        NSMutableArray *differ = [NSMutableArray array];
        for (NSString *k in copy) { if ([mine[k] isEqual:copy[k]]) equal++; else [differ addObject:k]; if ([[u objectForKey:k] isEqual:copy[k]]) viaDefaults++; }
        say(@"%@: the copy %lu keys; own suite %lu, %lu of the copy's equal; initWithSuiteName reads %lu equal; differ %@", G[i], (unsigned long)copy.count, (unsigned long)mine.count, (unsigned long)equal, (unsigned long)viaDefaults, [differ componentsJoinedByString:@" "]);
        NSString *c = [NSFileManager.defaultManager containerURLForSecurityApplicationGroupIdentifier:G[i]].path;
        say(@"  container %@: %lu files; the copy %lu files", c, (unsigned long)count(c), (unsigned long)count([rootPath() stringByAppendingPathComponent:[@"files/" stringByAppendingString:G[i]]]));
        if (ext) for (NSString *k in @[ @"instagram.app.auth.device.storage", @"com.burbn.instagram.IGdeviceID", @"com.instagram.app-install-date" ]) say(@"  %@ key %@: %@", G[i], k, [u objectForKey:k] ? @"there" : @"missing");
    }
    for (NSString *g in @[ @"MH9GU9K5PX.platformFamily", @"MH9GU9K5PX.shared", @"" ]) {
        NSMutableDictionary *q = [@{ (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword, (__bridge id)kSecReturnAttributes: @YES, (__bridge id)kSecMatchLimit: (__bridge id)kSecMatchLimitAll } mutableCopy];
        if (g.length) q[(__bridge id)kSecAttrAccessGroup] = g;
        CFTypeRef r = NULL; OSStatus s = SecItemCopyMatching((__bridge CFDictionaryRef)q, &r);
        NSCountedSet *n = [NSCountedSet set]; NSUInteger hpke = 0;
        for (NSDictionary *d in (__bridge NSArray *)r) { [n addObject:d[(__bridge id)kSecAttrAccessGroup]]; if ([d[(__bridge id)kSecAttrService] isEqual:@"com.instagram.notifications.hpke"]) hpke++; }
        NSMutableString *by = [NSMutableString string]; for (id k in n) [by appendFormat:@"%@ %lu ", k, (unsigned long)[n countForObject:k]];
        say(@"passwords asked for in '%@': status %d, %@, hpke %lu", g, (int)s, by, (unsigned long)hpke);
        if (r) CFRelease(r);
    }
}
__attribute__((constructor)) static void go(void) {
    BOOL ext = [NSBundle.mainBundle.bundlePath hasSuffix:@".appex"];
    if (ext && ![NSBundle.mainBundle.bundleIdentifier isEqual:@"com.burbn.instagram.notificationextension"]) return;
    dispatch_queue_t q = dispatch_get_global_queue(0, 0);
    if (ext) {
        dispatch_after(dispatch_time(0, 2 * NSEC_PER_SEC), q, ^{ out = [NSMutableString stringWithFormat:@"extension %@ at %@, home %@\n", NSBundle.mainBundle.bundleIdentifier, NSDate.date, NSHomeDirectory()]; suites(YES);
            [out writeToFile:[rootPath() stringByAppendingPathComponent:@"spy.txt"] atomically:YES encoding:NSUTF8StringEncoding error:NULL]; });
        return;
    }
    dispatch_after(dispatch_time(0, 40 * NSEC_PER_SEC), q, ^{
        NSError *e = nil; __block NSString *begun = @"no answer";
        [NSFileManager.defaultManager removeItemAtPath:[rootPath() stringByAppendingPathComponent:@"spy.txt"] error:NULL];
        id x = ((id (*)(id, SEL, id, NSError **))objc_msgSend)(NSClassFromString(@"NSExtension"), NSSelectorFromString(@"extensionWithIdentifier:error:"), @"com.burbn.instagram.notificationextension", &e);
        if (x) ((void (*)(id, SEL, id, id))objc_msgSend)(x, NSSelectorFromString(@"beginExtensionRequestWithInputItems:completion:"), @[], ^(NSUUID *r) { begun = r ? r.UUIDString : @"nil request"; });
        sleep(15);
        out = [NSMutableString stringWithFormat:@"app at %@; extension object %@ (%@), request %@\n", NSDate.date, x ? @"found" : @"none", e, begun];
        suites(NO);
        say(@"root %@: %@", rootPath(), [NSFileManager.defaultManager contentsOfDirectoryAtPath:rootPath() error:NULL]);
        say(@"extension.log: %@", [NSString stringWithContentsOfFile:[rootPath() stringByAppendingPathComponent:@"extension.log"] encoding:NSUTF8StringEncoding error:NULL]);
        say(@"spy.txt: %@", [NSString stringWithContentsOfFile:[rootPath() stringByAppendingPathComponent:@"spy.txt"] encoding:NSUTF8StringEncoding error:NULL]);
        [out writeToFile:[NSHomeDirectory() stringByAppendingPathComponent:@"Library/b425.txt"] atomically:YES encoding:NSUTF8StringEncoding error:NULL];
    });
}
