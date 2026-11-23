// The app-group and keychain fix (B211) the signers inject into a sideloaded app (web/app/core/groupfix.js plans it,
// web/app/websign-job.js and native/sign/IPASigner.swift put it in). A re-signed app keeps asking for the app groups
// and keychain access groups its original signature had (group.com.burbn.instagram, TEAM.com.burbn.instagram), which
// the user's profile can't give: iOS answers nil and errSecMissingEntitlement, and the app forgets its settings and
// its sign-in. Loaded at launch from Frameworks/, this:
//   - maps -[NSFileManager containerURLForSecurityApplicationGroupIdentifier:] for the original groups to
//     Library/AppGroups/<group>/ in the app's own container (B227: never a profile group, which changed whenever the
//     profile was made again and which every app signed with it shared);
//   - maps -[NSUserDefaults initWithSuiteName:] for them to a suite of the app's own (ifizbox.appgroup.<group>, kept
//     in its own Library/Preferences);
//   - B393: the first time for a group, brings in what an app that ran without this fix kept for it: the folder a
//     tweak's own app group shim (zxPluginsInject) gives for it, and Library/Preferences/<group>.plist;
//   - strips kSecAttrAccessGroup from SecItemAdd/CopyMatching/Update/Delete, so keychain items land in the app's
//     default group (its application-identifier, the same on every re-sign with the same team and App ID);
//   - B327 (isolate): keeps the app's passwords (generic and internet) in its own keychain group. Every app signed
//     under one App ID can also reach TEAM.<App ID>, where apps signed before B227 left their items and where a
//     group-less read finds another app's; a group-less delete by any of them (a fresh install clearing its keychain,
//     a logout) wiped every app's items there, which signed them out. The first launch with it copies what the app
//     could see in those shared groups into its own once (an app that ran before only), then every password call
//     names the app's own group.
// What to map comes from ifizbox-groupfix.plist beside this dylib: { groups: [original IDs], target: "" (or a profile
// group an earlier sign chose), keychain: bool, legacy: the profile group older signs mapped to, copied in once,
// isolate: the app's own keychain group (the first of its keychain-access-groups) }.
// The same folder and suite on every re-sign, under any profile, so the data survives.
// B390: every launch adds a line to Library/ifizbox-groupfix.log in the app's container (and the system log): the
// keychain groups it has and saw items in (counts only, never names or values), what was copied, whether it pinned.
// Built by native/groupfix/build.sh into web/app/vendor/groupfix/.
// SPDX-License-Identifier: GPL-3.0-or-later
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <objc/runtime.h>
#include <dlfcn.h>
#include <mach/mach.h>
#include <mach-o/dyld.h>
#include <mach-o/loader.h>
#include <mach-o/nlist.h>
#include <os/log.h>
#include <string.h>

static NSSet<NSString *> *groups;
// The original named keychain groups: strip kSecAttrAccessGroup from every call (passwords are pinned instead once isolated).
static BOOL keychainStrip;
static NSString *target;
// B227: the profile group an older fix mapped these groups to (its first one), whose folder and suite are copied into
// the app's own the first time, so an app signed that way keeps its data; nil for none. Only for an app that ran
// before this fix (its own preferences weren't empty at its first launch with it): a fresh install has nothing to
// bring, and must not take in what other apps left in that shared group.
static NSString *legacy;

// B327: the app's own keychain group (TEAM.<its bundle ID>), its passwords' only group once `pinned`; nil for none.
static CFStringRef isolate;
static BOOL pinned;

// B393: the app ran before this launch (appRanBefore, as isolate's test).
static BOOL ranBeforeLaunch;

static NSURL *(*origContainer)(id, SEL, NSString *);
static id (*origSuite)(id, SEL, NSString *);

// Copies what `from` holds into `to`, never over what's there; Library/Caches stays behind, and so do the original
// groups' own folders at the top (B393: a shim's, in the profile group). NO when something is to be tried
// again: locked, or no space (anything else would fail at every launch).
static BOOL copyMissing(NSURL *from, NSURL *to, NSString *rel) {
    NSFileManager *fm = [NSFileManager defaultManager];
    BOOL ok = YES;
    NSError *e = nil;
    NSArray *items = [fm contentsOfDirectoryAtURL:from includingPropertiesForKeys:@[ NSURLIsDirectoryKey ] options:0 error:&e];
    if (!items) return e.code != NSFileReadNoPermissionError;
    for (NSURL *item in items) {
        NSString *name = item.lastPathComponent, *path = rel.length ? [rel stringByAppendingPathComponent:name] : name;
        if ([path isEqualToString:@"Library/Caches"] || [groups containsObject:path]) continue;
        NSURL *dest = [to URLByAppendingPathComponent:name];
        NSNumber *dir = nil;
        [item getResourceValue:&dir forKey:NSURLIsDirectoryKey error:NULL];
        if (dir.boolValue && [fm fileExistsAtPath:dest.path]) ok = copyMissing(item, dest, path) && ok;
        else if (![fm fileExistsAtPath:dest.path] && ![fm copyItemAtURL:item toURL:dest error:&e]) {
            ok = ok && e.code != NSFileReadNoPermissionError && e.code != NSFileWriteNoPermissionError && e.code != NSFileWriteOutOfSpaceError;
        }
    }
    return ok;
}

// B393: what the app kept for a group without this fix, for the log ("group folder 3, suite 12").
static NSMutableArray<NSString *> *broughtIn;

// Brings that into the group's own folder `u` and suite, never over what's there: the folder the container call gives
// without this fix (nil without a shim; another group fix gives `u` itself) and the suite the system then kept in
// the app's Library/Preferences/<group>.plist (read as a file: a shim may send its domain elsewhere).
// `emptySuite`: the own suite held nothing, so a setting the app removed under this fix doesn't come back.
// NO when something couldn't be read.
static BOOL bringIn(NSString *group, NSURL *u, BOOL emptySuite) {
    NSFileManager *fm = [NSFileManager defaultManager];
    BOOL ok = YES;
    NSUInteger files = 0, keys = 0;
    NSURL *from = origContainer(fm, @selector(containerURLForSecurityApplicationGroupIdentifier:), group);
    NSString *a = from.path.stringByResolvingSymlinksInPath, *b = u.path.stringByResolvingSymlinksInPath;
    // never itself, a folder it is in (the copy would have no end) or one in it
    if (a && ![[b stringByAppendingString:@"/"] hasPrefix:[a stringByAppendingString:@"/"]] &&
        ![[a stringByAppendingString:@"/"] hasPrefix:[b stringByAppendingString:@"/"]]) {
        NSDirectoryEnumerator *en = [fm enumeratorAtPath:a];
        while ([en nextObject]) if ([en.fileAttributes.fileType isEqual:NSFileTypeRegular]) files++;
        ok = copyMissing(from, u, @"");
    }
    NSString *plist = [NSHomeDirectory() stringByAppendingPathComponent:[NSString stringWithFormat:@"Library/Preferences/%@.plist", group]];
    if (emptySuite && [fm fileExistsAtPath:plist]) {
        NSError *e = nil;
        NSData *d = [NSData dataWithContentsOfFile:plist options:0 error:&e];
        if (!d && e.code == NSFileReadNoPermissionError) ok = NO;
        NSDictionary *old = d ? [NSPropertyListSerialization propertyListWithData:d options:0 format:NULL error:NULL] : nil;
        if ([old isKindOfClass:[NSDictionary class]] && old.count) {
            keys = old.count;
            CFStringRef n = (__bridge CFStringRef)[@"ifizbox.appgroup." stringByAppendingString:group];
            NSDictionary *have = CFBridgingRelease(CFPreferencesCopyMultiple(NULL, n, kCFPreferencesCurrentUser, kCFPreferencesAnyHost));
            NSMutableDictionary *add = [old mutableCopy];
            [add removeObjectsForKeys:have.allKeys ?: @[]];
            CFPreferencesSetMultiple((__bridge CFDictionaryRef)add, NULL, n, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
            if (!CFPreferencesSynchronize(n, kCFPreferencesCurrentUser, kCFPreferencesAnyHost)) ok = NO;
        }
    }
    if (files || keys) {
        [broughtIn addObject:[NSString stringWithFormat:@"%@ folder %lu, suite %lu%@", group, (unsigned long)files, (unsigned long)keys,
                                                        ok ? @"" : @" (not all readable, tried again at the next launch)"]];
    }
    return ok;
}

// Library/AppGroups/<group>/ in the app's own container, made with the Library folders a group container has.
static NSURL *ownFolder(NSString *group) {
    NSURL *u = [[NSURL fileURLWithPath:NSHomeDirectory() isDirectory:YES]
        URLByAppendingPathComponent:[@"Library/AppGroups" stringByAppendingPathComponent:group] isDirectory:YES];
    NSFileManager *fm = [NSFileManager defaultManager];
    BOOL fresh = ![fm fileExistsAtPath:u.path];
    // Beside the folder while its copy isn't done (a launch cut short, or before the first unlock): tried again.
    NSString *pending = [u.URLByDeletingLastPathComponent.path stringByAppendingPathComponent:[NSString stringWithFormat:@".%@.copying", group]];
    BOOL bring = NO;
    if (broughtIn) { // at launch only
        bring = fresh ? ranBeforeLaunch : [fm fileExistsAtPath:pending];
    }
    BOOL emptySuite = NO;
    if (bring && fresh) {
        CFArrayRef keys = CFPreferencesCopyKeyList((__bridge CFStringRef)[@"ifizbox.appgroup." stringByAppendingString:group],
                                                   kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
        emptySuite = !keys || !CFArrayGetCount(keys);
        if (keys) CFRelease(keys);
        [fm createDirectoryAtPath:pending.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:NULL];
        // holds whether the suite was empty, for the next try (this one may fill it in part)
        [fm createFileAtPath:pending contents:emptySuite ? [@"suite" dataUsingEncoding:NSUTF8StringEncoding] : [NSData data]
                  attributes:@{ NSFileProtectionKey: NSFileProtectionNone }];
    } else if (bring) emptySuite = [fm contentsAtPath:pending].length > 0;
    for (NSString *sub in @[ @"Library/Preferences", @"Library/Caches" ]) {
        [fm createDirectoryAtURL:[u URLByAppendingPathComponent:sub isDirectory:YES] withIntermediateDirectories:YES
                      attributes:nil error:NULL];
    }
    if (bring && bringIn(group, u, emptySuite)) [fm removeItemAtPath:pending error:NULL];
    if (fresh && legacy) {
        NSURL *old = origContainer([NSFileManager defaultManager], @selector(containerURLForSecurityApplicationGroupIdentifier:), legacy);
        if (old) copyMissing(old, u, @"");
    }
    return u;
}

// The suite of the app's own for a group, with the older fix's suite (the profile group's) copied in once.
static NSString *ownSuite(NSString *group) {
    NSString *name = [@"ifizbox.appgroup." stringByAppendingString:group];
    if (!legacy) return name;
    CFStringRef n = (__bridge CFStringRef)name, done = CFSTR("ifizbox.groupfix.copied");
    CFPropertyListRef mark = CFPreferencesCopyValue(done, n, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
    if (mark) { CFRelease(mark); return name; }
    NSDictionary *old = CFBridgingRelease(CFPreferencesCopyMultiple(NULL, (__bridge CFStringRef)legacy, kCFPreferencesCurrentUser, kCFPreferencesAnyHost));
    NSDictionary *have = CFBridgingRelease(CFPreferencesCopyMultiple(NULL, n, kCFPreferencesCurrentUser, kCFPreferencesAnyHost));
    NSMutableDictionary *add = [NSMutableDictionary dictionary];
    for (NSString *k in old) if (!have[k]) add[k] = old[k];
    add[(__bridge NSString *)done] = @YES;
    CFPreferencesSetMultiple((__bridge CFDictionaryRef)add, NULL, n, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
    CFPreferencesSynchronize(n, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
    return name;
}
static NSURL *fixContainer(id self, SEL cmd, NSString *group) {
    if (![group isKindOfClass:[NSString class]] || ![groups containsObject:group]) return origContainer(self, cmd, group);
    if (target) {
        NSURL *u = origContainer(self, cmd, target);
        if (u) return u;
    }
    return ownFolder(group);
}

static id fixSuite(id self, SEL cmd, NSString *name) {
    if ([name isKindOfClass:[NSString class]] && [groups containsObject:name]) {
        name = target ?: ownSuite(name);
    }
    return origSuite(self, cmd, name);
}

static void swizzle(Class c, SEL sel, IMP imp, IMP *orig) {
    Method m = class_getInstanceMethod(c, sel);
    if (m) *orig = method_setImplementation(m, imp);
}

// ---- keychain: the query without kSecAttrAccessGroup, or (isolate) a password query in the app's own group ----

// B339: the real SecItem* functions, from Security itself. Every keychain call of this fix goes through these, never
// through its own symbol pointers: another group fix in the same app (SideDrop's sidedrop-groupfix.dylib, in an IPA it
// signed that iFizBox signs again) points every image's SecItem* pointers but its own at its fixes, this dylib's
// included, while this one points that one's at these fixes. Called through the pointers, each fix would call the
// other's and the first keychain call would recurse until the stack ran out. This way the other fix's calls end here
// and this fix's reach the keychain, so this one always runs last (its pinned group is what the keychain sees).
static OSStatus (*realAdd)(CFDictionaryRef, CFTypeRef *) = SecItemAdd;
static OSStatus (*realCopyMatching)(CFDictionaryRef, CFTypeRef *) = SecItemCopyMatching;
static OSStatus (*realUpdate)(CFDictionaryRef, CFDictionaryRef) = SecItemUpdate;
static OSStatus (*realDelete)(CFDictionaryRef) = SecItemDelete;

// Sets the real* pointers from Security's exports, before any image is rebound; each keeps its link-time value
// (the symbol pointer as dyld bound it) when Security can't be found.
static void findRealSecItem(void) {
    void *sec = dlopen("/System/Library/Frameworks/Security.framework/Security", RTLD_NOW | RTLD_NOLOAD);
    if (!sec) return;
    void *p;
    if ((p = dlsym(sec, "SecItemAdd"))) realAdd = p;
    if ((p = dlsym(sec, "SecItemCopyMatching"))) realCopyMatching = p;
    if ((p = dlsym(sec, "SecItemUpdate"))) realUpdate = p;
    if ((p = dlsym(sec, "SecItemDelete"))) realDelete = p;
}

static BOOL isPassword(CFDictionaryRef q) {
    CFTypeRef c = CFDictionaryGetValue(q, kSecClass);
    return c && (CFEqual(c, kSecClassGenericPassword) || CFEqual(c, kSecClassInternetPassword));
}

// The query to pass on (a copy the caller releases), or NULL for q itself. own: pin a password query to the app's group.
static CFDictionaryRef fixed(CFDictionaryRef q, BOOL own) {
    if (!q || CFGetTypeID(q) != CFDictionaryGetTypeID()) return NULL;
    BOOL pin = own && pinned && isPassword(q);
    if (!pin && !CFDictionaryContainsKey(q, kSecAttrAccessGroup)) return NULL;
    if (!pin && !keychainStrip) return NULL;
    CFMutableDictionaryRef m = CFDictionaryCreateMutableCopy(NULL, 0, q);
    if (pin) CFDictionarySetValue(m, kSecAttrAccessGroup, isolate);
    else CFDictionaryRemoveValue(m, kSecAttrAccessGroup);
    return m;
}

static OSStatus fixAdd(CFDictionaryRef a, CFTypeRef *r) {
    CFDictionaryRef s = fixed(a, YES);
    OSStatus st = realAdd(s ? s : a, r);
    if (s) CFRelease(s);
    return st;
}
static OSStatus fixCopyMatching(CFDictionaryRef q, CFTypeRef *r) {
    CFDictionaryRef s = fixed(q, YES);
    OSStatus st = realCopyMatching(s ? s : q, r);
    if (s) CFRelease(s);
    return st;
}
static OSStatus fixUpdate(CFDictionaryRef q, CFDictionaryRef a) {
    // the attributes never move an item to another group: strip theirs whenever the query is fixed
    CFDictionaryRef s = fixed(q, YES), t = NULL;
    if ((s || keychainStrip) && a && CFGetTypeID(a) == CFDictionaryGetTypeID() && CFDictionaryContainsKey(a, kSecAttrAccessGroup)) {
        CFMutableDictionaryRef m = CFDictionaryCreateMutableCopy(NULL, 0, a);
        CFDictionaryRemoveValue(m, kSecAttrAccessGroup);
        t = m;
    }
    OSStatus st = realUpdate(s ? s : q, t ? t : a);
    if (s) CFRelease(s);
    if (t) CFRelease(t);
    return st;
}
static OSStatus fixDelete(CFDictionaryRef q) {
    CFDictionaryRef s = fixed(q, YES);
    OSStatus st = realDelete(s ? s : q);
    if (s) CFRelease(s);
    return st;
}

// "TEAM.a 12, TEAM.b 3", for the log.
static NSString *countList(NSCountedSet *n) {
    NSMutableArray *out = [NSMutableArray array];
    for (NSString *g in n) [out addObject:[NSString stringWithFormat:@"%@ %lu", g, (unsigned long)[n countForObject:g]]];
    return [[out sortedArrayUsingSelector:@selector(compare:)] componentsJoinedByString:@", "];
}

// B327: copies every password the app can see outside its own group (TEAM.<App ID>, app groups) into its own group,
// never over one it has there. YES when every item was read (none locked away, as before the first unlock).
// The log's words for it: per class, the read's status, or how many were outside and how many of them are in the own group now.
static NSMutableString *copyLog;
static BOOL copySharedPasswords(void) {
    copyLog = [NSMutableString string];
    static const CFStringRef *keep[] = { &kSecClass, &kSecAttrService, &kSecAttrAccount, &kSecAttrGeneric, &kSecAttrLabel,
        &kSecAttrDescription, &kSecAttrComment, &kSecAttrCreator, &kSecAttrType, &kSecAttrIsInvisible, &kSecAttrIsNegative,
        &kSecAttrAccessible, &kSecAttrAccessControl, &kSecAttrSynchronizable, &kSecAttrServer, &kSecAttrProtocol,
        &kSecAttrAuthenticationType, &kSecAttrPort, &kSecAttrPath, &kSecAttrSecurityDomain, &kSecValueData };
    BOOL ok = YES;
    for (int k = 0; k < 2; k++) {
        CFStringRef cls = k ? kSecClassInternetPassword : kSecClassGenericPassword;
        NSDictionary *base = @{ (__bridge id)kSecClass: (__bridge id)cls, (__bridge id)kSecMatchLimit: (__bridge id)kSecMatchLimitAll,
                                (__bridge id)kSecReturnAttributes: @YES,
                                (__bridge id)kSecAttrSynchronizable: (__bridge id)kSecAttrSynchronizableAny };
        // how many there are outside the app's group (attributes only: no item asks for Face ID for that)
        CFTypeRef all = NULL;
        OSStatus st = realCopyMatching((__bridge CFDictionaryRef)base, &all);
        NSString *what = k ? @"internet" : @"generic";
        if (st == errSecItemNotFound) continue;
        if (st != errSecSuccess) { ok = NO; [copyLog appendFormat:@" %@ read %d", what, (int)st]; continue; }
        NSUInteger outside = 0;
        for (NSDictionary *a in (__bridge_transfer NSArray *)all) {
            if ([a isKindOfClass:[NSDictionary class]] && ![a[(__bridge id)kSecAttrAccessGroup] isEqual:(__bridge id)isolate]) outside++;
        }
        NSMutableDictionary *q = [base mutableCopy];
        q[(__bridge id)kSecReturnData] = @YES;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
        q[(__bridge id)kSecUseAuthenticationUI] = (__bridge id)kSecUseAuthenticationUISkip;
#pragma clang diagnostic pop
        CFTypeRef out = NULL;
        st = realCopyMatching((__bridge CFDictionaryRef)q, &out);
        if (st != errSecSuccess) { ok = NO; [copyLog appendFormat:@" %@ data %d", what, (int)st]; continue; }
        NSUInteger copied = 0;
        NSCountedSet *added = [NSCountedSet set], *had = [NSCountedSet set]; // by the group they came from, for the log
        OSStatus bad = errSecSuccess;
        // in the order a read that names no group finds them, so the app keeps the one it read until now
        for (NSDictionary *item in (__bridge_transfer NSArray *)out) {
            if (![item isKindOfClass:[NSDictionary class]] || [item[(__bridge id)kSecAttrAccessGroup] isEqual:(__bridge id)isolate]) continue;
            NSMutableDictionary *add = [NSMutableDictionary dictionary];
            for (size_t i = 0; i < sizeof(keep) / sizeof(keep[0]); i++) {
                id v = item[(__bridge id)*keep[i]];
                if (v) add[(__bridge id)*keep[i]] = v;
            }
            add[(__bridge id)kSecClass] = (__bridge id)cls;
            if (add[(__bridge id)kSecAttrAccessControl]) [add removeObjectForKey:(__bridge id)kSecAttrAccessible];
            add[(__bridge id)kSecAttrAccessGroup] = (__bridge id)isolate;
            OSStatus as = realAdd((__bridge CFDictionaryRef)add, NULL);
            if (as == errSecSuccess || as == errSecDuplicateItem) copied++;
            else { ok = NO; bad = as; }
            id from = item[(__bridge id)kSecAttrAccessGroup] ?: @"?";
            if (as == errSecSuccess) [added addObject:from];
            else if (as == errSecDuplicateItem) [had addObject:from];
        }
        // an item behind Face ID or a passcode (skipped above) would be out of reach once pinned: stay as before
        if (copied < outside) ok = NO;
        [copyLog appendFormat:@" %@ %lu outside, added from [%@], already in the own group and left alone [%@]%@", what, (unsigned long)outside,
                              countList(added), countList(had), bad ? [NSString stringWithFormat:@", add error %d", (int)bad] : @""];
    }
    return ok;
}

// Whether the app ran before: anything of its own in its preferences (not this fix's marks), Documents, Application
// Support or the group fix's folders. A fresh install's container has none of these.
static BOOL appRanBefore(void) {
    CFArrayRef keys = CFPreferencesCopyKeyList(kCFPreferencesCurrentApplication, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
    BOOL ran = NO;
    for (NSString *k in (__bridge NSArray *)keys) if (![k hasPrefix:@"ifizbox.groupfix."]) { ran = YES; break; }
    if (keys) CFRelease(keys);
    if (ran) return YES;
    NSFileManager *fm = [NSFileManager defaultManager];
    NSString *home = NSHomeDirectory();
    if ([fm contentsOfDirectoryAtPath:[home stringByAppendingPathComponent:@"Documents"] error:NULL].count) return YES;
    for (NSString *d in @[ @"Library/Application Support", @"Library/AppGroups" ]) {
        if ([fm fileExistsAtPath:[home stringByAppendingPathComponent:d]]) return YES;
    }
    return NO;
}

// ---- B390: what a report of a lost sign-in needs to tell which part lost it ----

// An entitlement of this process, as the system sees it (SecTask has no header on iOS: looked up).
static id entitlement(NSString *key) {
    CFTypeRef (*create)(CFAllocatorRef) = (CFTypeRef (*)(CFAllocatorRef))dlsym(RTLD_DEFAULT, "SecTaskCreateFromSelf");
    CFTypeRef (*get)(CFTypeRef, CFStringRef, CFErrorRef *) =
        (CFTypeRef (*)(CFTypeRef, CFStringRef, CFErrorRef *))dlsym(RTLD_DEFAULT, "SecTaskCopyValueForEntitlement");
    CFTypeRef task = create && get ? create(NULL) : NULL;
    if (!task) return nil;
    id v = CFBridgingRelease(get(task, (__bridge CFStringRef)key, NULL));
    CFRelease(task);
    return v;
}

// How many items of a class there are in each group ("TEAM.a 12, TEAM.b 3"), or why none could be read.
static NSString *itemCounts(CFStringRef cls) {
    CFTypeRef all = NULL;
    OSStatus st = realCopyMatching((__bridge CFDictionaryRef)@{
        (__bridge id)kSecClass: (__bridge id)cls, (__bridge id)kSecMatchLimit: (__bridge id)kSecMatchLimitAll,
        (__bridge id)kSecReturnAttributes: @YES, (__bridge id)kSecAttrSynchronizable: (__bridge id)kSecAttrSynchronizableAny }, &all);
    if (st == errSecItemNotFound) return @"none";
    if (st != errSecSuccess) return [NSString stringWithFormat:@"error %d", (int)st];
    NSCountedSet *n = [NSCountedSet set];
    for (NSDictionary *a in (__bridge_transfer NSArray *)all) {
        if ([a isKindOfClass:[NSDictionary class]]) [n addObject:a[(__bridge id)kSecAttrAccessGroup] ?: @"?"];
    }
    return countList(n);
}

// Adds the launch's line to Library/ifizbox-groupfix.log (its last 200 lines kept), not in the app's preferences, which the app may
// clear: a log that starts anew points to a new container (the app was deleted or is another bundle ID, or it cleared
// its Library); a long one means the container was kept. Readable before the first unlock; it holds no secrets.
static void logLaunch(NSString *line) {
    os_log(OS_LOG_DEFAULT, "group fix: %{public}s", line.UTF8String);
    NSString *path = [NSHomeDirectory() stringByAppendingPathComponent:@"Library/ifizbox-groupfix.log"];
    NSString *old = nil;
    if ([[NSFileManager defaultManager] fileExistsAtPath:path]) {
        old = [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:NULL];
        if (!old) return; // unreadable now: never over what's there
    }
    NSMutableArray *lines = [[old componentsSeparatedByString:@"\n"] mutableCopy] ?: [NSMutableArray array];
    [lines removeObject:@""];
    [lines addObject:line];
    if (lines.count > 200) [lines removeObjectsInRange:NSMakeRange(0, lines.count - 200)];
    NSData *d = [[[lines componentsJoinedByString:@"\n"] stringByAppendingString:@"\n"] dataUsingEncoding:NSUTF8StringEncoding];
    [d writeToFile:path options:NSDataWritingAtomic | NSDataWritingFileProtectionNone error:NULL];
}

static const struct { const char *name; void *to; } hooks[] = {
    { "_SecItemAdd", (void *)fixAdd },
    { "_SecItemCopyMatching", (void *)fixCopyMatching },
    { "_SecItemUpdate", (void *)fixUpdate },
    { "_SecItemDelete", (void *)fixDelete },
};

// Points an image's symbol pointers (__got, __la_symbol_ptr) for SecItem* at the fixes, as fishhook (BSD) does:
// the app's executable and its own frameworks, never the shared cache or this dylib (its calls use the real* pointers).
// Another group fix's image is rebound too, so its calls end in these fixes (B339: findRealSecItem).
static void rebindSection(const struct section_64 *sect, intptr_t slide, const struct nlist_64 *symtab,
                          const char *strtab, const uint32_t *indirect) {
    const uint32_t *idx = indirect + sect->reserved1;
    void **ptrs = (void **)((uintptr_t)slide + sect->addr);
    size_t n = sect->size / sizeof(void *);
    for (size_t i = 0; i < n; i++) {
        uint32_t s = idx[i];
        if (s == INDIRECT_SYMBOL_ABS || s == INDIRECT_SYMBOL_LOCAL || s == (INDIRECT_SYMBOL_LOCAL | INDIRECT_SYMBOL_ABS)) continue;
        const char *name = strtab + symtab[s].n_un.n_strx;
        for (size_t h = 0; h < sizeof(hooks) / sizeof(hooks[0]); h++) {
            if (strcmp(name, hooks[h].name) != 0 || ptrs[i] == hooks[h].to) continue;
            vm_address_t page = (vm_address_t)&ptrs[i] & ~(vm_address_t)(vm_page_size - 1);
            if (vm_protect(mach_task_self(), page, vm_page_size, 0, VM_PROT_READ | VM_PROT_WRITE | VM_PROT_COPY) != KERN_SUCCESS) continue;
            ptrs[i] = hooks[h].to;
        }
    }
}

static void rebindImage(const struct mach_header *mh, intptr_t slide) {
    Dl_info self;
    if (!dladdr((void *)rebindImage, &self) || self.dli_fbase == (void *)mh) return;
    if (mh->magic != MH_MAGIC_64 || (mh->flags & 0x80000000)) return; // MH_DYLIB_IN_CACHE
    const struct segment_command_64 *linkedit = NULL;
    const struct symtab_command *st = NULL;
    const struct dysymtab_command *dy = NULL;
    const struct load_command *lc = (const struct load_command *)((const struct mach_header_64 *)mh + 1);
    for (uint32_t i = 0; i < mh->ncmds; i++, lc = (const void *)((const char *)lc + lc->cmdsize)) {
        if (lc->cmd == LC_SEGMENT_64 && strcmp(((const struct segment_command_64 *)lc)->segname, SEG_LINKEDIT) == 0) linkedit = (const void *)lc;
        else if (lc->cmd == LC_SYMTAB) st = (const void *)lc;
        else if (lc->cmd == LC_DYSYMTAB) dy = (const void *)lc;
    }
    if (!linkedit || !st || !dy || !dy->nindirectsyms) return;
    uintptr_t base = (uintptr_t)slide + linkedit->vmaddr - linkedit->fileoff;
    const struct nlist_64 *symtab = (const void *)(base + st->symoff);
    const char *strtab = (const char *)(base + st->stroff);
    const uint32_t *indirect = (const void *)(base + dy->indirectsymoff);
    lc = (const struct load_command *)((const struct mach_header_64 *)mh + 1);
    for (uint32_t i = 0; i < mh->ncmds; i++, lc = (const void *)((const char *)lc + lc->cmdsize)) {
        if (lc->cmd != LC_SEGMENT_64) continue;
        const struct segment_command_64 *seg = (const void *)lc;
        if (strcmp(seg->segname, "__DATA") != 0 && strcmp(seg->segname, "__DATA_CONST") != 0) continue;
        const struct section_64 *sect = (const void *)(seg + 1);
        for (uint32_t j = 0; j < seg->nsects; j++) {
            uint32_t type = sect[j].flags & SECTION_TYPE;
            if (type == S_LAZY_SYMBOL_POINTERS || type == S_NON_LAZY_SYMBOL_POINTERS) rebindSection(&sect[j], slide, symtab, strtab, indirect);
        }
    }
}

__attribute__((constructor)) static void groupfixInit(void) {
    @autoreleasepool {
        findRealSecItem();
        Dl_info self;
        if (!dladdr((void *)groupfixInit, &self) || !self.dli_fname) return;
        NSString *dir = [[NSString stringWithUTF8String:self.dli_fname] stringByDeletingLastPathComponent];
        NSDictionary *c = [NSDictionary dictionaryWithContentsOfFile:[dir stringByAppendingPathComponent:@"ifizbox-groupfix.plist"]];
        NSArray *g = [c[@"groups"] isKindOfClass:[NSArray class]] ? c[@"groups"] : @[];
        groups = [NSSet setWithArray:g];
        NSString *t = c[@"target"];
        target = [t isKindOfClass:[NSString class]] && t.length ? t : nil;
        // The legacy copy's test (its preferences weren't empty), read before anything below writes one.
        CFArrayRef keys = CFPreferencesCopyKeyList(kCFPreferencesCurrentApplication, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
        NSUInteger keyCount = keys ? (NSUInteger)CFArrayGetCount(keys) : 0;
        BOOL ranBefore = keyCount > 0;
        if (keys) CFRelease(keys);
        BOOL ownBefore = appRanBefore(); // isolate's test, before ownFolder makes Library/AppGroups
        NSUInteger prefs = keyCount;
        NSString *saw = [NSString stringWithFormat:@"passwords %@; internet %@; keys %@", itemCounts(kSecClassGenericPassword),
                                                   itemCounts(kSecClassInternetPassword), itemCounts(kSecClassKey)];
        NSString *isolation = @"none";
        NSString *l = c[@"legacy"];
        if (!target && [l isKindOfClass:[NSString class]] && l.length) {
            // A fresh install (no preferences yet) is marked at once, so it never copies the shared group in later.
            CFStringRef fresh = CFSTR("ifizbox.groupfix.fresh");
            CFPropertyListRef was = CFPreferencesCopyValue(fresh, kCFPreferencesCurrentApplication, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
            if (was) CFRelease(was);
            else if (ranBefore) legacy = l;
            else {
                CFPreferencesSetValue(fresh, kCFBooleanTrue, kCFPreferencesCurrentApplication, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
                CFPreferencesSynchronize(kCFPreferencesCurrentApplication, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
            }
        }
        keychainStrip = [c[@"keychain"] boolValue];
        NSString *iso = c[@"isolate"];
        if ([iso isKindOfClass:[NSString class]] && iso.length) {
            isolate = CFBridgingRetain(iso);
            // Once: an app that ran before brings what it could see in the shared groups; a fresh install brings
            // nothing (what's there is other apps'). Until every item could be read (locked before the first
            // unlock), calls stay as before and the next launch tries again.
            CFStringRef mark = CFSTR("ifizbox.groupfix.isolated");
            CFPropertyListRef done = CFPreferencesCopyValue(mark, kCFPreferencesCurrentApplication, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
            if (done) { CFRelease(done); pinned = YES; isolation = @"marked earlier"; }
            else if (!ownBefore || copySharedPasswords()) {
                CFPreferencesSetValue(mark, kCFBooleanTrue, kCFPreferencesCurrentApplication, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
                CFPreferencesSynchronize(kCFPreferencesCurrentApplication, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
                pinned = YES;
            }
            if (copyLog) isolation = [@"copied in" stringByAppendingString:copyLog.length ? copyLog : @" nothing"];
            else if (!ownBefore) isolation = @"fresh install, nothing copied";
        }
        if (groups.count) {
            swizzle([NSFileManager class], @selector(containerURLForSecurityApplicationGroupIdentifier:), (IMP)fixContainer, (IMP *)&origContainer);
            swizzle([NSUserDefaults class], @selector(initWithSuiteName:), (IMP)fixSuite, (IMP *)&origSuite);
            // B393: at the first launch with a group, whether the app asks for it or not: its folder is there from then
            // on, so a fresh install never brings in what an earlier one left.
            if (!target && origContainer) {
                ranBeforeLaunch = ownBefore;
                broughtIn = [NSMutableArray array];
                for (NSString *group in groups) if ([group isKindOfClass:[NSString class]]) ownFolder(group);
                if (broughtIn.count) {
                    logLaunch([NSString stringWithFormat:@"%@ brought in from before the group fix: %@",
                        [[NSISO8601DateFormatter new] stringFromDate:[NSDate date]], [broughtIn componentsJoinedByString:@"; "]]);
                }
                broughtIn = nil;
            }
        }
        NSDictionary *info = [NSBundle mainBundle].infoDictionary;
        NSISO8601DateFormatter *iso8601 = [NSISO8601DateFormatter new];
        NSArray *kc = entitlement(@"keychain-access-groups");
        logLaunch([NSString stringWithFormat:@"%@ %@ %@ (%@) container %@; ran before %@, %lu preferences; application-identifier %@, keychain groups %@; saw %@; isolate %@: %@; pinned %@; app groups %lu",
            [iso8601 stringFromDate:[NSDate date]], info[@"CFBundleIdentifier"], info[@"CFBundleShortVersionString"], info[@"CFBundleVersion"],
            NSHomeDirectory().lastPathComponent, ownBefore ? @"yes" : @"no", (unsigned long)prefs, entitlement(@"application-identifier"),
            [kc isKindOfClass:[NSArray class]] ? [kc componentsJoinedByString:@", "] : @"none", saw,
            isolate ? (__bridge NSString *)isolate : @"off", isolation, pinned ? @"yes" : @"no", (unsigned long)groups.count]);
        if (keychainStrip || pinned) _dyld_register_func_for_add_image(rebindImage);
    }
}
