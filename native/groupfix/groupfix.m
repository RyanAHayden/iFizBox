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
//     names the app's own group. B392: that copy leaves what the own group has, unless the app was signed for the
//     shared groups only until now and the own item is an older one from an earlier install (the keychain outlives
//     a delete).
//   - B415: lowers the container's files and folders from Complete data protection (an earlier signature's default, which
//     iOS leaves on them) to CompleteUntilFirstUserAuthentication, unless this signature asks for Complete.
//   - B425: runs in the app's notification extensions too, and gives them what the app keeps for its groups: the app puts
//     a copy of its groups' suites and small files in the profile's group, which the extension brings into its own
//     container (the app's place stays as it is; "for its notification extensions" below). An extension's password
//     calls name the app's own keychain group once the app's do.
// What to map comes from ifizbox-groupfix.plist beside this dylib: { groups: [original IDs], target: "" (or a profile
// group an earlier sign chose), keychain: bool, legacy: the profile group older signs mapped to, copied in once,
// isolate: the app's own keychain group (the first of its keychain-access-groups),
// shared: the profile's group the copy for the notification extensions goes through }.
// The same folder and suite on every re-sign, under any profile, so the data survives.
// B390: every launch adds a line to Library/ifizbox-groupfix.log in the app's container (and the system log): the
// keychain groups it has and saw items in (counts only, never names or values), what was copied, whether it pinned.
// Built by native/groupfix/build.sh into web/app/vendor/groupfix/.
// SPDX-License-Identifier: GPL-3.0-or-later
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <objc/runtime.h>
#include <dlfcn.h>
#include <errno.h>
#include <fts.h>
#include <mach/mach.h>
#include <mach-o/dyld.h>
#include <mach-o/loader.h>
#include <mach-o/nlist.h>
#include <math.h>
#include <notify.h>
#include <os/log.h>
#include <stdatomic.h>
#include <string.h>
#include <sys/attr.h>
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

// B393: the app ran before this launch (appRanBefore, as isolate's test).
static BOOL ranBeforeLaunch;

// B425: in the profile's group, the copies for the apps' notification extensions; never taken in by the legacy copy.
static NSString *const SHARED_FOLDER = @"ifizbox.shared";

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
        if ([path isEqualToString:@"Library/Caches"] || [path isEqualToString:SHARED_FOLDER] || [groups containsObject:path]) continue;
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
// B425 (below)
static BOOL inExtension;
static BOOL extensionReady; // the app has put a copy out at least once
static NSString *extensionFolder(NSString *group);

static NSURL *fixContainer(id self, SEL cmd, NSString *group) {
    if (![group isKindOfClass:[NSString class]] || ![groups containsObject:group]) return origContainer(self, cmd, group);
    if (target) {
        NSURL *u = origContainer(self, cmd, target);
        if (u) return u;
    }
    if (inExtension) { // B425: until the app has put its copy out, as without this fix
        return extensionReady && !target ? [NSURL fileURLWithPath:extensionFolder(group) isDirectory:YES] : origContainer(self, cmd, group);
    }
    return ownFolder(group);
}

static id fixSuite(id self, SEL cmd, NSString *name) {
    if ([name isKindOfClass:[NSString class]] && [groups containsObject:name]) {
        if (inExtension) name = target ?: (extensionReady ? [@"ifizbox.appgroup." stringByAppendingString:name] : name); // B425
        else name = target ?: ownSuite(name);
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
                              countList(added), countList(replaced), countList(had), bad ? [NSString stringWithFormat:@", copy error %d", (int)bad] : @""];
    }
    return ok;
}

// Whether the app ran before this launch: a file in its container last changed (or a system-made folder there made) before this process started
// (its change time, which a copy can't carry over). Not its preferences: a tweak's initialisers write those, and files,
// before this fix loads (RyukGram does), so a fresh install has some by now. SplashBoard is the system's, at install.
static BOOL appRanBefore(void) {
    struct kinfo_proc p;
    size_t n = sizeof(p);
    int mib[4] = { CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid() };
    if (sysctl(mib, 4, &p, &n, NULL, 0) != 0 || n == 0) return YES; // can't tell: as an app that ran
    struct timeval start = p.kp_proc.p_un.__p_starttime;
    NSString *home = NSHomeDirectory();
    // Folders the system makes in a process of the app, not at install: an earlier launch's, even when every file in
    // the container was written anew by now.
    for (NSString *d in @[ @"Library/Caches/com.apple.dyld", @"Library/Saved Application State" ]) {
        struct stat st;
        if (lstat([home stringByAppendingPathComponent:d].fileSystemRepresentation, &st) == 0 && st.st_birthtimespec.tv_sec > 0 &&
            (st.st_birthtimespec.tv_sec < start.tv_sec ||
             (st.st_birthtimespec.tv_sec == start.tv_sec && st.st_birthtimespec.tv_nsec / 1000 < start.tv_usec))) return YES;
    }
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

// ---- B415: files an earlier signature's default data protection left unreadable while the phone is locked ----

// The container's files and folders from Complete to CompleteUntilFirstUserAuthentication, unless this signature has
// Complete as its default (or can't be read). A file's change needs the phone unlocked; a folder's does not. At every
// launch: an update signed with Complete puts it on the files again, and what couldn't be changed is tried again.
// The log's words for it. After appRanBefore: it moves the change times that one looks at.
static NSString *lowerProtection(void) {
    if (!entitlement(@"application-identifier")) return @"left alone (no entitlements read)";
    if ([entitlement(@"com.apple.developer.default-data-protection") isEqual:@"NSFileProtectionComplete"]) return @"left alone (signed for Complete)";
    NSTimeInterval began = [NSProcessInfo processInfo].systemUptime;
    NSDictionary *lower = @{ NSFileProtectionKey: NSFileProtectionCompleteUntilFirstUserAuthentication };
    struct attrlist want = { .bitmapcount = ATTR_BIT_MAP_COUNT, .commonattr = ATTR_CMN_DATA_PROTECT_FLAGS };
    NSUInteger looked = 0, files = 0, folders = 0, failed = 0;
    NSInteger why = 0;
    char *roots[] = { strdup(NSHomeDirectory().fileSystemRepresentation), NULL };
    FTS *walk = fts_open(roots, FTS_PHYSICAL | FTS_NOCHDIR | FTS_NOSTAT | FTS_XDEV, NULL);
    FTSENT *f;
    while (walk && (f = fts_read(walk))) {
        // each folder before what is in it; not the container itself, which the app may not change; links never followed
        if (f->fts_level < 1 || f->fts_info == FTS_DP || f->fts_info == FTS_DNR || f->fts_info == FTS_ERR || f->fts_info == FTS_SL) continue;
        struct { uint32_t size, protection; } has;
        if (getattrlist(f->fts_path, &want, &has, sizeof(has), FSOPT_NOFOLLOW) != 0 || has.size < sizeof(has)) continue;
        looked++;
        if (has.protection != 1) continue; // PROTECTION_CLASS_A, Complete
        @autoreleasepool {
            NSError *e = nil;
            NSString *path = [[NSFileManager defaultManager] stringWithFileSystemRepresentation:f->fts_path length:f->fts_pathlen];
            if ([[NSFileManager defaultManager] setAttributes:lower ofItemAtPath:path error:&e]) {
                if (f->fts_info == FTS_D) folders++;
                else files++;
            } else {
                NSError *posix = e.userInfo[NSUnderlyingErrorKey];
                NSInteger code = posix ? posix.code : e.code;
                if (code == ENOENT) continue; // gone by now
                failed++;
                why = code;
            }
        }
    }
    if (walk) fts_close(walk);
    free(roots[0]);
    return [NSString stringWithFormat:@"%lu files and %lu folders lowered from Complete%@, of %lu in %.0f ms%@", (unsigned long)files, (unsigned long)folders,
        failed ? [NSString stringWithFormat:@", %lu not (error %ld)", (unsigned long)failed, (long)why] : @"", (unsigned long)looked,
        ([NSProcessInfo processInfo].systemUptime - began) * 1000, walk ? @"" : @" (container not read)"];
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

// ---- B425: what the app keeps for its groups, for its notification extensions ----
//
// An extension can't reach the app's container, where its groups' data is, only the profile's group, which every app
// signed with that profile reaches too. So the app stays the only writer of its own place, and puts a copy of what a
// notification extension can use (the groups' suites, small files; no databases) under ifizbox.shared/<its bundle ID>/
// in the profile's first group. The extension brings that into a folder and suites in its own container, never over
// what it wrote there later. The copy holds nothing of its own: a fresh install removes one an earlier install left,
// and under another profile's groups it is made anew.

#define SHARED_MAX_FILE (512 * 1024)
#define SHARED_MAX_TOTAL (8 * 1024 * 1024)
#define SHARED_MAX_ITEMS 5000

static NSString *sharedGroup; // the profile's group the copy goes through; nil: the profile has none
static NSString *appID;       // the app's bundle ID, in the app and in its extensions

static NSURL *sharedRoot(void) {
    if (!sharedGroup || !appID.length) return nil;
    NSFileManager *fm = [NSFileManager defaultManager];
    NSURL *u = origContainer ? origContainer(fm, @selector(containerURLForSecurityApplicationGroupIdentifier:), sharedGroup)
                             : [fm containerURLForSecurityApplicationGroupIdentifier:sharedGroup];
    return [u URLByAppendingPathComponent:[SHARED_FOLDER stringByAppendingPathComponent:appID] isDirectory:YES];
}

static NSString *sharedNotice(void) { return [@"ifizbox.groupfix." stringByAppendingString:appID]; }

// A plist file's dictionary; *unreadable when there's a file that can't be read now (locked).
static NSDictionary *readPlist(NSString *path, BOOL *unreadable) {
    NSData *d = [NSData dataWithContentsOfFile:path];
    if (!d) {
        if (unreadable && [[NSFileManager defaultManager] fileExistsAtPath:path]) *unreadable = YES;
        return nil;
    }
    id v = [NSPropertyListSerialization propertyListWithData:d options:0 format:NULL error:NULL];
    return [v isKindOfClass:[NSDictionary class]] ? v : nil;
}
// Readable while the phone is locked, after its first unlock (before: only with `always`, for a file with no secrets).
static BOOL writePlist(NSDictionary *v, NSString *path, BOOL always) {
    NSData *d = [NSPropertyListSerialization dataWithPropertyList:v format:NSPropertyListBinaryFormat_v1_0 options:0 error:NULL];
    return [d writeToFile:path options:NSDataWritingAtomic | (always ? NSDataWritingFileProtectionNone : NSDataWritingFileProtectionCompleteUntilFirstUserAuthentication) error:NULL];
}

static double changed(const struct stat *st) { return st->st_mtimespec.tv_sec + st->st_mtimespec.tv_nsec / 1e9; }

static BOOL isDatabase(NSString *path) {
    for (NSString *end in @[ @"-wal", @"-shm", @"-journal" ]) if ([path hasSuffix:end]) return YES;
    char head[16] = "";
    FILE *f = fopen(path.fileSystemRepresentation, "rb");
    size_t n = f ? fread(head, 1, sizeof(head), f) : 0;
    if (f) fclose(f);
    return n == sizeof(head) && memcmp(head, "SQLite format 3", 16) == 0;
}

// Brings `to` up to date with `from` (small files; never a database, which another process may have open). `had`:
// what it brought before, path -> its change time. A file that changed or went away in `to` since is left as it is
// there, until `from` has a newer one. Returns how many files changed.
static NSUInteger updateFiles(NSString *from, NSString *to, NSMutableDictionary<NSString *, NSNumber *> *had) {
    NSFileManager *fm = [NSFileManager defaultManager];
    if (![fm contentsOfDirectoryAtPath:from error:NULL]) return 0;
    NSUInteger items = 0, done = 0;
    off_t total = 0;
    BOOL whole = YES;
    NSMutableSet *seen = [NSMutableSet set];
    NSDirectoryEnumerator *e = [fm enumeratorAtPath:from];
    for (NSString *rel in e) {
        @autoreleasepool {
            NSString *src = [from stringByAppendingPathComponent:rel], *dest = [to stringByAppendingPathComponent:rel];
            struct stat st, dst;
            if (++items > SHARED_MAX_ITEMS) { whole = NO; break; }
            if (lstat(src.fileSystemRepresentation, &st) != 0) continue;
            if (S_ISDIR(st.st_mode)) {
                if ([rel isEqualToString:@"Library/Caches"]) [e skipDescendants];
                continue;
            }
            if (!S_ISREG(st.st_mode) || st.st_size > SHARED_MAX_FILE || [rel.lastPathComponent hasPrefix:@".ifizbox"]) continue;
            if (total + st.st_size > SHARED_MAX_TOTAL) { whole = NO; continue; }
            total += st.st_size;
            NSNumber *was = had[rel];
            if (was && fabs(was.doubleValue - changed(&st)) < 0.001) { [seen addObject:rel]; continue; }
            if (isDatabase(src)) continue;
            [seen addObject:rel];
            if (lstat(dest.fileSystemRepresentation, &dst) == 0 && changed(&dst) > changed(&st)) continue;
            NSString *tmp = [dest.stringByDeletingLastPathComponent stringByAppendingPathComponent:@".ifizbox-copy"];
            [fm createDirectoryAtPath:dest.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:NULL];
            [fm removeItemAtPath:tmp error:NULL];
            if (![fm copyItemAtPath:src toPath:tmp error:NULL]) continue; // locked now: the next time
            [fm setAttributes:@{ NSFileProtectionKey: NSFileProtectionCompleteUntilFirstUserAuthentication } ofItemAtPath:tmp error:NULL];
            if (rename(tmp.fileSystemRepresentation, dest.fileSystemRepresentation) != 0) { [fm removeItemAtPath:tmp error:NULL]; continue; }
            had[rel] = @(changed(&st));
            done++;
        }
    }
    if (!whole) return done;
    for (NSString *rel in had.allKeys) { // gone from `from`
        if ([seen containsObject:rel]) continue;
        NSString *dest = [to stringByAppendingPathComponent:rel];
        struct stat dst;
        if (lstat(dest.fileSystemRepresentation, &dst) == 0 && fabs(changed(&dst) - had[rel].doubleValue) < 0.001) {
            [fm removeItemAtPath:dest error:NULL];
            done++;
        }
        [had removeObjectForKey:rel];
    }
    return done;
}

static NSMutableDictionary *editable(NSDictionary *d) { return [d isKindOfClass:[NSDictionary class]] ? [d mutableCopy] : [NSMutableDictionary dictionary]; }

static NSString *suiteCopy(NSURL *root, NSString *group) {
    return [root URLByAppendingPathComponent:[@"suites" stringByAppendingPathComponent:[group stringByAppendingString:@".plist"]]].path;
}
static NSString *filesCopy(NSURL *root, NSString *group) {
    return [root URLByAppendingPathComponent:[@"files" stringByAppendingPathComponent:group]].path;
}
static BOOL plainName(id group) {
    return [group isKindOfClass:[NSString class]] && [group length] && ![group containsString:@"/"] && ![group hasPrefix:@"."];
}

// The app: puts the copy out (on shareQueue).
static void shareOut(void) {
    NSURL *root = sharedRoot();
    if (!root) return;
    NSFileManager *fm = [NSFileManager defaultManager];
    NSString *statePath = [root URLByAppendingPathComponent:@"state.plist"].path;
    NSString *recordPath = [NSHomeDirectory() stringByAppendingPathComponent:@"Library/ifizbox-groupfix-shared.plist"];
    BOOL unreadable = NO;
    NSDictionary *was = readPlist(recordPath, &unreadable);
    if (unreadable) return;
    NSMutableDictionary *record = editable(was);
    // this install's first copy, or the first through this group: what is there isn't this install's. `seed`: the
    // extension may bring in once what it kept without this fix (an app that ran before only).
    if (!was || ![record[@"group"] isEqual:sharedGroup]) [fm removeItemAtPath:root.path error:NULL];
    if (!was) record[@"seed"] = @(ranBeforeLaunch);
    if (![fm fileExistsAtPath:statePath]) [record removeObjectForKey:@"files"];
    record[@"group"] = sharedGroup;
    [fm createDirectoryAtURL:[root URLByAppendingPathComponent:@"suites"] withIntermediateDirectories:YES attributes:nil error:NULL];
    if (!writePlist(record, recordPath, YES)) return;
    NSUInteger news = 0;
    NSMutableDictionary *files = editable(record[@"files"]);
    for (NSString *group in groups) {
        if (target || !plainName(group)) continue;
        CFStringRef n = (__bridge CFStringRef)[@"ifizbox.appgroup." stringByAppendingString:group];
        NSMutableDictionary *now = editable(CFBridgingRelease(CFPreferencesCopyMultiple(NULL, n, kCFPreferencesCurrentUser, kCFPreferencesAnyHost)));
        [now removeObjectForKey:@"ifizbox.groupfix.copied"];
        // an empty one may be one that can't be read yet (before the first unlock): the copy stays as it is
        if (now.count && ![readPlist(suiteCopy(root, group), NULL) isEqual:now] && writePlist(now, suiteCopy(root, group), NO)) news++;
        NSMutableDictionary *had = editable(files[group]);
        news += updateFiles([NSHomeDirectory() stringByAppendingPathComponent:[@"Library/AppGroups" stringByAppendingPathComponent:group]],
                            filesCopy(root, group), had);
        files[group] = had;
    }
    if (![record[@"files"] isEqual:files]) {
        record[@"files"] = files;
        writePlist(record, recordPath, YES);
    }
    NSDictionary *state = @{ @"pinned": @(pinned), @"seed": record[@"seed"] ?: @NO };
    if (![readPlist(statePath, NULL) isEqual:state] && writePlist(state, statePath, YES)) news++;
    if (news) notify_post(sharedNotice().UTF8String);
}

static dispatch_queue_t shareQueue;

// Soon, once for a burst of changes; `now`: the app goes to the background, and gets the time to finish.
static void shareSoon(BOOL now) {
    static atomic_bool waiting;
    if (now) {
        [[NSProcessInfo processInfo] performExpiringActivityWithReason:@"ifizbox.groupfix" usingBlock:^(BOOL expired) {
            if (!expired) dispatch_sync(shareQueue, ^{ @autoreleasepool { shareOut(); } });
        }];
        return;
    }
    if (atomic_exchange(&waiting, true)) return;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC), shareQueue, ^{
        @autoreleasepool { atomic_store(&waiting, false); shareOut(); }
    });
}

static void shareInit(void) {
    if (!sharedGroup) return;
    shareQueue = dispatch_queue_create("ifizbox.groupfix.share", dispatch_queue_attr_make_with_qos_class(DISPATCH_QUEUE_SERIAL, QOS_CLASS_UTILITY, 0));
    NSNotificationCenter *c = [NSNotificationCenter defaultCenter];
    [c addObserverForName:NSUserDefaultsDidChangeNotification object:nil queue:nil usingBlock:^(NSNotification *n) { (void)n; shareSoon(NO); }];
    [c addObserverForName:@"UIApplicationDidEnterBackgroundNotification" object:nil queue:nil usingBlock:^(NSNotification *n) { (void)n; shareSoon(YES); }];
    shareSoon(NO);
}

static NSString *extensionFolder(NSString *group) {
    return [NSHomeDirectory() stringByAppendingPathComponent:[@"Library/AppGroups" stringByAppendingPathComponent:group]];
}

// The extension: brings the copy into its own container. The log's words for it.
static NSString *shareIn(void) {
    NSFileManager *fm = [NSFileManager defaultManager];
    NSString *recordPath = [NSHomeDirectory() stringByAppendingPathComponent:@"Library/ifizbox-groupfix-shared.plist"];
    BOOL unreadable = NO;
    NSDictionary *was = readPlist(recordPath, &unreadable);
    if (was || unreadable) extensionReady = YES;
    if (unreadable) return @"own record not readable now";
    NSURL *root = sharedRoot();
    NSDictionary *state = root ? readPlist([root URLByAppendingPathComponent:@"state.plist"].path, NULL) : nil;
    if (!state) return root ? @"the app has put nothing out" : @"no profile group";
    extensionReady = YES;
    if (isolate && [state[@"pinned"] isEqual:@YES]) pinned = YES;
    [fm createDirectoryAtPath:recordPath.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:NULL];
    NSMutableDictionary *record = editable(was), *suites = editable(record[@"suites"]), *files = editable(record[@"files"]);
    NSMutableArray *words = [NSMutableArray array];
    for (NSString *group in groups) {
        if (target || !plainName(group)) continue;
        NSString *name = [@"ifizbox.appgroup." stringByAppendingString:group], *own = extensionFolder(group);
        CFStringRef n = (__bridge CFStringRef)name;
        [fm createDirectoryAtPath:[own stringByAppendingPathComponent:@"Library/Preferences"] withIntermediateDirectories:YES attributes:nil error:NULL];
        NSDictionary *app = readPlist(suiteCopy(root, group), NULL), *last = editable(suites[group]);
        NSUInteger set = 0, gone = 0;
        if (app) {
            NSMutableDictionary *add = [NSMutableDictionary dictionary];
            for (NSString *k in app) if (![last[k] isEqual:app[k]]) add[k] = app[k];
            NSMutableArray *drop = [NSMutableArray array];
            for (NSString *k in last) if (!app[k]) [drop addObject:k];
            set = add.count;
            gone = drop.count;
            if (set || gone) {
                CFPreferencesSetMultiple((__bridge CFDictionaryRef)add, (__bridge CFArrayRef)drop, n, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
                if (CFPreferencesSynchronize(n, kCFPreferencesCurrentUser, kCFPreferencesAnyHost)) suites[group] = app;
            }
        }
        NSMutableDictionary *had = editable(files[group]);
        NSUInteger changedFiles = updateFiles(filesCopy(root, group), own, had);
        files[group] = had;
        // once: what the extension kept for the group without this fix (a tweak's own shim), after the app's, never over it
        NSURL *shim = !was && [state[@"seed"] isEqual:@YES] && origContainer
            ? origContainer(fm, @selector(containerURLForSecurityApplicationGroupIdentifier:), group) : nil;
        if (shim) {
            copyMissing(shim, [NSURL fileURLWithPath:own isDirectory:YES], @"");
            NSDictionary *old = readPlist([shim URLByAppendingPathComponent:[NSString stringWithFormat:@"Library/Preferences/%@.plist", group]].path, NULL);
            NSDictionary *have = CFBridgingRelease(CFPreferencesCopyMultiple(NULL, n, kCFPreferencesCurrentUser, kCFPreferencesAnyHost));
            NSMutableDictionary *add = editable(old);
            [add removeObjectsForKeys:have.allKeys ?: @[]];
            [add removeObjectsForKeys:app.allKeys ?: @[]];
            if (add.count) CFPreferencesSetMultiple((__bridge CFDictionaryRef)add, NULL, n, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
            CFPreferencesSynchronize(n, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
        }
        [words addObject:[NSString stringWithFormat:@"%@ suite %lu of the app's, %lu new, %lu removed; %lu files, %lu changed%@", group, (unsigned long)app.count,
            (unsigned long)set, (unsigned long)gone, (unsigned long)had.count, (unsigned long)changedFiles, shim ? @"; its earlier data brought in" : @""]];
    }
    record[@"suites"] = suites;
    record[@"files"] = files;
    if (![record isEqual:was]) writePlist(record, recordPath, NO);
    return words.count ? [words componentsJoinedByString:@"; "] : @"no groups";
}

static void extensionInit(void) {
    inExtension = YES;
    // a password query names the app's group only where this process has it
    NSArray *kc = entitlement(@"keychain-access-groups");
    if (isolate && !([kc isKindOfClass:[NSArray class]] && [kc containsObject:(__bridge id)isolate])) isolate = NULL;
    if (groups.count) {
        swizzle([NSFileManager class], @selector(containerURLForSecurityApplicationGroupIdentifier:), (IMP)fixContainer, (IMP *)&origContainer);
        swizzle([NSUserDefaults class], @selector(initWithSuiteName:), (IMP)fixSuite, (IMP *)&origSuite);
    }
    NSString *in = shareIn();
    if (keychainStrip || isolate) _dyld_register_func_for_add_image(rebindImage);
    if (appID.length) {
        int token;
        notify_register_dispatch(sharedNotice().UTF8String, &token, dispatch_queue_create("ifizbox.groupfix.share", DISPATCH_QUEUE_SERIAL), ^(int t) {
            (void)t;
            @autoreleasepool { shareIn(); }
        });
    }
    NSString *line = [NSString stringWithFormat:@"%@ extension %@ of %@; %@; keychain groups %@; passwords %@; pinned %@",
        [[NSISO8601DateFormatter new] stringFromDate:[NSDate date]], [NSBundle mainBundle].bundleIdentifier, appID, in,
        [kc isKindOfClass:[NSArray class]] ? [kc componentsJoinedByString:@", "] : @"none", itemCounts(kSecClassGenericPassword), pinned ? @"yes" : @"no"];
    logLaunch(line);
    // the app's container can't be reached: the last start, beside the copy
    NSURL *root = extensionReady ? sharedRoot() : nil;
    if (root) [[line dataUsingEncoding:NSUTF8StringEncoding] writeToURL:[root URLByAppendingPathComponent:@"extension.log"]
                  options:NSDataWritingAtomic | NSDataWritingFileProtectionNone error:NULL];
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
        // B425
        NSString *sh = c[@"shared"];
        sharedGroup = [sh isKindOfClass:[NSString class]] && sh.length ? sh : nil;
        appID = [[NSDictionary dictionaryWithContentsOfFile:[dir.stringByDeletingLastPathComponent stringByAppendingPathComponent:@"Info.plist"]][@"CFBundleIdentifier"] copy];
        if ([[NSBundle mainBundle].bundlePath hasSuffix:@".appex"]) {
            NSString *iso = c[@"isolate"];
            keychainStrip = [c[@"keychain"] boolValue];
            if ([iso isKindOfClass:[NSString class]] && iso.length) isolate = CFBridgingRetain(iso);
            extensionInit();
            return;
        }
        BOOL ownBefore = appRanBefore(); // before anything below writes or changes a file
        NSString *protection = lowerProtection();
        CFArrayRef keys = CFPreferencesCopyKeyList(kCFPreferencesCurrentApplication, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
        NSUInteger keyCount = keys ? (NSUInteger)CFArrayGetCount(keys) : 0; // for the log
        if (keys) CFRelease(keys);
        BOOL fixedBefore = groupFixedBefore(); // before anything below writes a file or a mark
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
        ranBeforeLaunch = ownBefore;
        shareInit(); // B425
        NSDictionary *info = [NSBundle mainBundle].infoDictionary;
        NSISO8601DateFormatter *iso8601 = [NSISO8601DateFormatter new];
        NSArray *kc = entitlement(@"keychain-access-groups");
        logLaunch([NSString stringWithFormat:@"%@ %@ %@ (%@) container %@; ran before %@, %lu preferences; application-identifier %@, keychain groups %@; saw %@; isolate %@: %@; pinned %@; app groups %lu; group fix before %@; container made %@; protection %@",
            [iso8601 stringFromDate:[NSDate date]], info[@"CFBundleIdentifier"], info[@"CFBundleShortVersionString"], info[@"CFBundleVersion"],
            NSHomeDirectory().lastPathComponent, ownBefore ? @"yes" : @"no", (unsigned long)prefs, entitlement(@"application-identifier"),
            [kc isKindOfClass:[NSArray class]] ? [kc componentsJoinedByString:@", "] : @"none", saw,
            isolate ? (__bridge NSString *)isolate : @"off", isolation, pinned ? @"yes" : @"no", (unsigned long)groups.count,
            fixedBefore ? @"yes" : @"no", containerBirth() ? [iso8601 stringFromDate:[NSDate dateWithTimeIntervalSince1970:containerBirth()]] : @"unknown", protection]);
        if (keychainStrip || pinned) _dyld_register_func_for_add_image(rebindImage);
    }
}
