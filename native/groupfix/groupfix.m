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
//   - strips kSecAttrAccessGroup from SecItemAdd/CopyMatching/Update/Delete, so keychain items land in the app's
//     default group (its application-identifier, the same on every re-sign with the same team and App ID);
//   - B327 (isolate): keeps the app's passwords (generic and internet) in its own keychain group. Every app signed
//     under one App ID can also reach TEAM.<App ID>, where apps signed before B227 left their items and where a
//     group-less read finds another app's; a group-less delete by any of them (a fresh install clearing its keychain,
//     a logout) wiped every app's items there, which signed them out. The first launch with it copies what the app
//     could see in those shared groups into its own once (an app that ran before only), then every password call
//     names the app's own group. B392: that copy leaves what the own group has, unless the app was signed for the
//     shared groups only until now and the own item is an older one from an earlier install (the keychain outlives
//     a delete).
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
#include <sys/stat.h>
#include <sys/sysctl.h>
#include <unistd.h>

static NSSet<NSString *> *groups;
// The original named keychain groups: strip kSecAttrAccessGroup from every call (passwords are pinned instead once isolated).
static BOOL keychainStrip;
static NSString *target;
// B227: the profile group an older fix mapped these groups to (its first one), whose folder and suite are copied into
// the app's own the first time, so an app signed that way keeps its data; nil for none. Only for an app that ran
// before this fix (appRanBefore at its first launch with it): a fresh install has nothing to
// bring, and must not take in what other apps left in that shared group.
static NSString *legacy;

// B327: the app's own keychain group (TEAM.<its bundle ID>), its passwords' only group once `pinned`; nil for none.
static CFStringRef isolate;
static BOOL pinned;

static NSURL *(*origContainer)(id, SEL, NSString *);
static id (*origSuite)(id, SEL, NSString *);

// Copies what `from` holds into `to`, never over what's there; Library/Caches stays behind.
static void copyMissing(NSURL *from, NSURL *to, NSString *rel) {
    NSFileManager *fm = [NSFileManager defaultManager];
    for (NSURL *item in [fm contentsOfDirectoryAtURL:from includingPropertiesForKeys:@[ NSURLIsDirectoryKey ] options:0 error:NULL]) {
        NSString *name = item.lastPathComponent, *path = rel.length ? [rel stringByAppendingPathComponent:name] : name;
        if ([path isEqualToString:@"Library/Caches"]) continue;
        NSURL *dest = [to URLByAppendingPathComponent:name];
        NSNumber *dir = nil;
        [item getResourceValue:&dir forKey:NSURLIsDirectoryKey error:NULL];
        if (dir.boolValue && [fm fileExistsAtPath:dest.path]) copyMissing(item, dest, path);
        else if (![fm fileExistsAtPath:dest.path]) [fm copyItemAtURL:item toURL:dest error:NULL];
    }
}

// Library/AppGroups/<group>/ in the app's own container, made with the Library folders a group container has.
static NSURL *ownFolder(NSString *group) {
    NSURL *u = [[NSURL fileURLWithPath:NSHomeDirectory() isDirectory:YES]
        URLByAppendingPathComponent:[@"Library/AppGroups" stringByAppendingPathComponent:group] isDirectory:YES];
    NSFileManager *fm = [NSFileManager defaultManager];
    BOOL fresh = ![fm fileExistsAtPath:u.path];
    for (NSString *sub in @[ @"Library/Preferences", @"Library/Caches" ]) {
        [fm createDirectoryAtURL:[u URLByAppendingPathComponent:sub isDirectory:YES] withIntermediateDirectories:YES
                      attributes:nil error:NULL];
    }
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

// ---- B392: an item an earlier install left in the app's own group ----

// Whether a shared item newer than the app's own one takes its place in the first copy (set by groupfixInit: the app
// was signed for the shared groups only until now, so it reads and writes that one).
static BOOL replaceStale;

// When this install's container was made: the oldest of its folders (their birth survives an update; a restore from a
// backup makes new ones). 0 when unknown.
static NSTimeInterval containerBirth(void) {
    NSTimeInterval oldest = 0;
    for (NSString *d in @[ @"", @"Documents", @"Library", @"Library/Preferences", @"Library/Caches", @"tmp" ]) {
        struct stat st;
        if (stat([NSHomeDirectory() stringByAppendingPathComponent:d].fileSystemRepresentation, &st) != 0) continue;
        NSTimeInterval t = st.st_birthtimespec.tv_sec + st.st_birthtimespec.tv_nsec / 1e9;
        if (t > 0 && (!oldest || t < oldest)) oldest = t;
    }
    return oldest;
}

static NSTimeInterval modified(NSDictionary *item) {
    NSDate *d = item[(__bridge id)kSecAttrModificationDate];
    return [d isKindOfClass:[NSDate class]] ? d.timeIntervalSince1970 : 0;
}

// What makes two items of a class the same one, but for their group.
static NSArray *itemKey(NSDictionary *item, BOOL internet) {
    NSMutableArray *key = [NSMutableArray arrayWithObject:[item[(__bridge id)kSecAttrSynchronizable] boolValue] ? @1 : @0];
    NSArray *of = internet ? @[ (__bridge id)kSecAttrAccount, (__bridge id)kSecAttrSecurityDomain, (__bridge id)kSecAttrServer,
                                (__bridge id)kSecAttrProtocol, (__bridge id)kSecAttrAuthenticationType, (__bridge id)kSecAttrPort,
                                (__bridge id)kSecAttrPath ]
                           : @[ (__bridge id)kSecAttrAccount, (__bridge id)kSecAttrService ];
    for (id k in of) {
        id v = item[k] ?: @"";
        if ([v isKindOfClass:[NSNumber class]] && [v integerValue] == 0) v = @"";
        [key addObject:v];
    }
    return key;
}

// Whether the app's own group holds a password written since this install: it was signed for that group then, so what
// is there is its live data. Also YES when that can't be told.
static BOOL ownGroupUsed(void) {
    NSTimeInterval birth = containerBirth();
    if (!birth) return YES;
    for (int k = 0; k < 2; k++) {
        CFTypeRef all = NULL;
        OSStatus st = realCopyMatching((__bridge CFDictionaryRef)@{
            (__bridge id)kSecClass: (__bridge id)(k ? kSecClassInternetPassword : kSecClassGenericPassword),
            (__bridge id)kSecAttrAccessGroup: (__bridge id)isolate, (__bridge id)kSecMatchLimit: (__bridge id)kSecMatchLimitAll,
            (__bridge id)kSecReturnAttributes: @YES, (__bridge id)kSecAttrSynchronizable: (__bridge id)kSecAttrSynchronizableAny }, &all);
        if (st == errSecItemNotFound) continue;
        if (st != errSecSuccess) return YES;
        for (NSDictionary *a in (__bridge_transfer NSArray *)all) if (modified(a) >= birth) return YES;
    }
    return NO;
}

// Whether the container shows an earlier launch with a group fix (ours or SideDrop's: the same folder and marks).
static BOOL groupFixedBefore(void) {
    NSString *home = NSHomeDirectory();
    for (NSString *f in @[ @"Library/AppGroups", @"Library/ifizbox-groupfix.log" ]) {
        if ([[NSFileManager defaultManager] fileExistsAtPath:[home stringByAppendingPathComponent:f]]) return YES;
    }
    for (NSString *f in [[NSFileManager defaultManager] contentsOfDirectoryAtPath:[home stringByAppendingPathComponent:@"Library/Preferences"] error:NULL]) {
        if ([f hasPrefix:@"ifizbox.appgroup."]) return YES;
    }
    NSArray *keys = CFBridgingRelease(CFPreferencesCopyKeyList(kCFPreferencesCurrentApplication, kCFPreferencesCurrentUser, kCFPreferencesAnyHost));
    for (NSString *k in keys) if ([k hasPrefix:@"ifizbox.groupfix."]) return YES;
    return NO;
}

// B327: copies every password the app can see outside its own group (TEAM.<App ID>, app groups) into its own group,
// never over one it has there, except (B392, replaceStale) an older one left by an earlier install. YES when every item was read (none locked away, as before the first unlock).
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
        // the own items as they are before any copy; each is looked at for the first shared item like it only
        NSMutableDictionary<NSArray *, NSDictionary *> *own = [NSMutableDictionary dictionary];
        if (replaceStale) {
            NSMutableDictionary *oq = [base mutableCopy];
            oq[(__bridge id)kSecAttrAccessGroup] = (__bridge id)isolate;
            oq[(__bridge id)kSecReturnPersistentRef] = @YES;
            CFTypeRef mine = NULL;
            st = realCopyMatching((__bridge CFDictionaryRef)oq, &mine);
            if (st != errSecSuccess && st != errSecItemNotFound) { ok = NO; [copyLog appendFormat:@" %@ own %d", what, (int)st]; continue; }
            for (NSDictionary *a in (__bridge_transfer NSArray *)mine) if ([a isKindOfClass:[NSDictionary class]]) own[itemKey(a, k)] = a;
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
        NSCountedSet *added = [NSCountedSet set], *had = [NSCountedSet set], *replaced = [NSCountedSet set]; // by the group they came from, for the log
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
            NSArray *key = itemKey(item, k);
            NSDictionary *old = as == errSecDuplicateItem ? own[key] : nil;
            [own removeObjectForKey:key];
            id ref = old[(__bridge id)kSecValuePersistentRef];
            if (ref && modified(old) < containerBirth() && modified(item) > modified(old)) {
                static const CFStringRef *identity[] = { &kSecClass, &kSecAttrAccessGroup, &kSecAttrService, &kSecAttrAccount, &kSecAttrSynchronizable,
                    &kSecAttrServer, &kSecAttrProtocol, &kSecAttrAuthenticationType, &kSecAttrPort, &kSecAttrPath, &kSecAttrSecurityDomain };
                NSMutableDictionary *set = [add mutableCopy];
                for (size_t i = 0; i < sizeof(identity) / sizeof(identity[0]); i++) [set removeObjectForKey:(__bridge id)*identity[i]];
                OSStatus us = realUpdate((__bridge CFDictionaryRef)@{ (__bridge id)kSecClass: (__bridge id)cls, (__bridge id)kSecValuePersistentRef: ref },
                                         (__bridge CFDictionaryRef)set);
                if (us == errSecSuccess) { [replaced addObject:from]; continue; }
                ok = NO; bad = us;
                continue;
            }
            if (as == errSecSuccess) [added addObject:from];
            else if (as == errSecDuplicateItem) [had addObject:from];
        }
        // an item behind Face ID or a passcode (skipped above) would be out of reach once pinned: stay as before
        if (copied < outside) ok = NO;
        [copyLog appendFormat:@" %@ %lu outside, added from [%@], taken over an earlier install's from [%@], already in the own group and left alone [%@]%@", what, (unsigned long)outside,
                              countList(added), countList(replaced), countList(had), bad ? [NSString stringWithFormat:@", add error %d", (int)bad] : @""];
    }
    return ok;
}

// Whether the app ran before this launch: a file in its container that was last changed before this process started
// (its change time, which a copy can't carry over). Not its preferences: a tweak's initialisers write those, and files,
// before this fix loads (RyukGram does), so a fresh install has some by now. SplashBoard is the system's, at install.
static BOOL appRanBefore(void) {
    struct kinfo_proc p;
    size_t n = sizeof(p);
    int mib[4] = { CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid() };
    if (sysctl(mib, 4, &p, &n, NULL, 0) != 0 || n == 0) return YES; // can't tell: as an app that ran
    struct timeval start = p.kp_proc.p_un.__p_starttime;
    NSString *home = NSHomeDirectory();
    for (NSString *top in @[ @"Library", @"Documents", @"tmp" ]) {
        NSString *root = [home stringByAppendingPathComponent:top];
        NSDirectoryEnumerator *e = [[NSFileManager defaultManager] enumeratorAtPath:root];
        for (NSString *f in e) {
            if ([top isEqualToString:@"Library"] && [f isEqualToString:@"SplashBoard"]) { [e skipDescendants]; continue; }
            struct stat st;
            if (lstat([root stringByAppendingPathComponent:f].fileSystemRepresentation, &st) != 0 || !S_ISREG(st.st_mode)) continue;
            if (st.st_ctimespec.tv_sec < start.tv_sec ||
                (st.st_ctimespec.tv_sec == start.tv_sec && st.st_ctimespec.tv_nsec / 1000 < start.tv_usec)) return YES;
        }
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
        CFArrayRef keys = CFPreferencesCopyKeyList(kCFPreferencesCurrentApplication, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
        NSUInteger keyCount = keys ? (NSUInteger)CFArrayGetCount(keys) : 0; // for the log
        if (keys) CFRelease(keys);
        BOOL ownBefore = appRanBefore(), fixedBefore = groupFixedBefore(); // before anything below writes a file or a mark
        NSUInteger prefs = keyCount;
        NSString *saw = [NSString stringWithFormat:@"passwords %@; internet %@; keys %@", itemCounts(kSecClassGenericPassword),
                                                   itemCounts(kSecClassInternetPassword), itemCounts(kSecClassKey)];
        NSString *isolation = @"none";
        NSString *l = c[@"legacy"];
        if (!target && [l isKindOfClass:[NSString class]] && l.length) {
            // A fresh install is marked at once, so it never copies the shared group in later.
            CFStringRef fresh = CFSTR("ifizbox.groupfix.fresh");
            CFPropertyListRef was = CFPreferencesCopyValue(fresh, kCFPreferencesCurrentApplication, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
            if (was) CFRelease(was);
            else if (ownBefore) legacy = l;
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
            // B392: the app ran under the shared groups only (no group fix here before, nothing of this install in its
            // own group). Marked until the copy is done: the next try sees this one's traces.
            CFStringRef pending = CFSTR("ifizbox.groupfix.takeover");
            CFPropertyListRef was = CFPreferencesCopyValue(pending, kCFPreferencesCurrentApplication, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
            replaceStale = !done && ownBefore && (was || (!fixedBefore && !ownGroupUsed()));
            if (was) CFRelease(was);
            if (replaceStale) {
                CFPreferencesSetValue(pending, kCFBooleanTrue, kCFPreferencesCurrentApplication, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
                CFPreferencesSynchronize(kCFPreferencesCurrentApplication, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
            }
            if (done) { CFRelease(done); pinned = YES; isolation = @"marked earlier"; }
            else if (!ownBefore || copySharedPasswords()) {
                CFPreferencesSetValue(pending, NULL, kCFPreferencesCurrentApplication, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
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
        }
        NSDictionary *info = [NSBundle mainBundle].infoDictionary;
        NSISO8601DateFormatter *iso8601 = [NSISO8601DateFormatter new];
        NSArray *kc = entitlement(@"keychain-access-groups");
        logLaunch([NSString stringWithFormat:@"%@ %@ %@ (%@) container %@; ran before %@, %lu preferences; application-identifier %@, keychain groups %@; saw %@; isolate %@: %@; pinned %@; app groups %lu; group fix before %@; container made %@",
            [iso8601 stringFromDate:[NSDate date]], info[@"CFBundleIdentifier"], info[@"CFBundleShortVersionString"], info[@"CFBundleVersion"],
            NSHomeDirectory().lastPathComponent, ownBefore ? @"yes" : @"no", (unsigned long)prefs, entitlement(@"application-identifier"),
            [kc isKindOfClass:[NSArray class]] ? [kc componentsJoinedByString:@", "] : @"none", saw,
            isolate ? (__bridge NSString *)isolate : @"off", isolation, pinned ? @"yes" : @"no", (unsigned long)groups.count,
            fixedBefore ? @"yes" : @"no", [iso8601 stringFromDate:[NSDate dateWithTimeIntervalSince1970:containerBirth()]]]);
        if (keychainStrip || pinned) _dyld_register_func_for_add_image(rebindImage);
    }
}
