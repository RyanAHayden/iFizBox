// R87 probe: at each launch records (to os_log and to Documents/ryprobe.log once writable) whether the app's
// preferences can be read, the protection class of the container's files, and a keychain read status.
// Loaded as a dependency of CydiaSubstrate (see ../2026-11-23-b390-ryukgram/prep.py), so it runs before the app's own code.
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <UIKit/UIKit.h>
#import <os/log.h>
#include <fcntl.h>
#include <errno.h>
#include <unistd.h>

static NSMutableArray *pending; static NSString *run;
static void say(NSString *s) {
  NSString *l = [NSString stringWithFormat:@"%@ %@ %@", run, [NSDate date], s];
  os_log(OS_LOG_DEFAULT, "ryprobe %{public}s", l.UTF8String);
  @synchronized (pending) { [pending addObject:l]; }
}
static NSString *docs(void) { return [NSHomeDirectory() stringByAppendingPathComponent:@"Documents"]; }
static void flush(void) {
  @synchronized (pending) {
    if (!pending.count) return;
    NSString *p = [docs() stringByAppendingPathComponent:@"ryprobe.log"];
    NSString *text = [[pending componentsJoinedByString:@"\n"] stringByAppendingString:@"\n"];
    NSFileHandle *h = [NSFileHandle fileHandleForWritingAtPath:p];
    if (!h) { if (![text writeToFile:p atomically:NO encoding:NSUTF8StringEncoding error:nil]) return; }
    else { @try { [h seekToEndOfFile]; [h writeData:[text dataUsingEncoding:NSUTF8StringEncoding]]; [h closeFile]; } @catch (id e) { return; } }
    [pending removeAllObjects];
  }
}
static int klass(NSString *p, int *err) { // protection class of an existing file or folder (1 A, 2 B, 3 C, 4 D); -1 on error
  int fd = open(p.fileSystemRepresentation, O_RDONLY | O_DIRECTORY * 0);
  if (fd < 0) { *err = errno; return -1; }
  int c = fcntl(fd, 63 /* F_GETPROTECTIONCLASS */); *err = c < 0 ? errno : 0; close(fd); return c;
}
static NSString *readable(NSString *p) { // can the content of this file be read now?
  int fd = open(p.fileSystemRepresentation, O_RDONLY); if (fd < 0) return [NSString stringWithFormat:@"open errno %d", errno];
  char b[16]; ssize_t n = read(fd, b, sizeof b); int e = errno; close(fd); return n < 0 ? [NSString stringWithFormat:@"read errno %d", e] : [NSString stringWithFormat:@"ok %zd bytes", n];
}
static void tick(NSString *tag) {
  NSString *h = NSHomeDirectory(), *bid = NSBundle.mainBundle.bundleIdentifier;
  __block int st = -1; __block BOOL prot = NO;
  dispatch_sync(dispatch_get_main_queue(), ^{ st = (int)UIApplication.sharedApplication.applicationState; prot = UIApplication.sharedApplication.protectedDataAvailable; });
  NSString *pf = [NSString stringWithFormat:@"%@/Library/Preferences/%@.plist", h, bid];
  CFArrayRef ks = CFPreferencesCopyKeyList(kCFPreferencesCurrentApplication, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
  long n = ks ? CFArrayGetCount(ks) : -1; if (ks) CFRelease(ks);
  int e; int cp = klass(pf, &e);
  NSDictionary *q = @{(id)kSecClass: (id)kSecClassGenericPassword, (id)kSecMatchLimit: (id)kSecMatchLimitAll, (id)kSecReturnAttributes: @YES};
  CFTypeRef out = 0; OSStatus ks1 = SecItemCopyMatching((__bridge CFDictionaryRef)q, &out); long items = ks1 ? -1 : (long)CFArrayGetCount(out); if (out) CFRelease(out);
  NSUserDefaults *sd = NSUserDefaults.standardUserDefaults;
  say([NSString stringWithFormat:@"%@: appState %d protectedDataAvailable %d; prefs keys %ld; prefs file class %d (err %d) %@; marker %@; hide_ads_comments %@; keychain read %d (%ld items)", tag, st, prot, n, cp, e, readable(pf), [sd objectForKey:@"ryprobe.marker"], [sd objectForKey:@"hide_ads_comments"], (int)ks1, items]);
  flush();
}
static void classes(NSString *tag) { // class of every file and folder in the container (counts per class, per top folder)
  NSString *h = NSHomeDirectory(); NSMutableDictionary *cnt = [NSMutableDictionary dictionary]; NSMutableArray *odd = [NSMutableArray array];
  NSDirectoryEnumerator *en = [NSFileManager.defaultManager enumeratorAtPath:h]; NSString *f;
  while ((f = en.nextObject)) {
    if ([f hasPrefix:@"Documents/ryprobe"]) continue;
    int e; int c = klass([h stringByAppendingPathComponent:f], &e); if (c < 0) { c = -e - 100; }
    NSArray *parts = f.pathComponents; NSString *top = parts.count > 1 ? [NSString stringWithFormat:@"%@/%@", parts[0], parts[1]] : parts[0];
    if ([parts[0] isEqual:@"Library"] && parts.count > 2 && ![parts[1] isEqual:@"Preferences"]) top = [NSString stringWithFormat:@"Library/%@", parts[1]];
    else if ([parts[0] isEqual:@"Library"] && parts.count > 1) top = [NSString stringWithFormat:@"Library/%@", parts[1]];
    else top = parts[0];
    NSString *k = [NSString stringWithFormat:@"%@ class %d", top, c]; cnt[k] = @([cnt[k] intValue] + 1);
    if (en.level <= 1 && !([f containsString:@"/"])) [odd addObject:[NSString stringWithFormat:@"%@=%d", f, c]];
  }
  say([NSString stringWithFormat:@"%@: top-level %@", tag, [odd componentsJoinedByString:@" "]]);
  NSMutableArray *rows = [NSMutableArray array]; for (NSString *k in [cnt.allKeys sortedArrayUsingSelector:@selector(compare:)]) [rows addObject:[NSString stringWithFormat:@"%@=%@", k, cnt[k]]];
  say([NSString stringWithFormat:@"%@: classcount %@", tag, [rows componentsJoinedByString:@"; "]]); flush();
}
__attribute__((constructor)) static void probeInit(void) {
  { // delay the whole launch when Documents/ryprobe.sleep exists (read while unlocked): the phone is locked meanwhile
    NSString *sf = [NSHomeDirectory() stringByAppendingPathComponent:@"Documents/ryprobe.sleep"];
    if ([NSFileManager.defaultManager fileExistsAtPath:sf]) { [NSFileManager.defaultManager removeItemAtPath:sf error:nil]; os_log(OS_LOG_DEFAULT, "ryprobe sleeping before app init"); sleep(18); }
  }
  pending = [NSMutableArray array]; run = [NSString stringWithFormat:@"%.0f", [NSDate date].timeIntervalSince1970];
  NSString *bid = NSBundle.mainBundle.bundleIdentifier;
  NSString *pf = [NSString stringWithFormat:@"%@/Library/Preferences/%@.plist", NSHomeDirectory(), bid]; int e; int cp = klass(pf, &e);
  say([NSString stringWithFormat:@"START early: prefs file class %d err %d, %@", cp, e, readable(pf)]); flush();
  for (NSNumber *n in @[@3, @10, @25, @60, @120]) {
    dispatch_after(dispatch_time(0, n.intValue * NSEC_PER_SEC), dispatch_get_global_queue(0, 0), ^{
      @autoreleasepool {
        tick([NSString stringWithFormat:@"t%@", n]);
        if (n.intValue == 10) classes(@"t10");
        NSUserDefaults *sd = NSUserDefaults.standardUserDefaults;
        if (![sd objectForKey:@"hide_ads_comments"] && n.intValue >= 25) { [sd setBool:YES forKey:@"hide_ads_comments"]; [sd setBool:YES forKey:@"hide_meta_ai"]; [sd synchronize]; say(@"planted RyukGram keys hide_ads_comments, hide_meta_ai"); }
        if (![sd objectForKey:@"ryprobe.marker"] && n.intValue >= 25) { [sd setObject:run forKey:@"ryprobe.marker"]; [sd synchronize]; say(@"planted marker"); flush(); }
      } });
  }
}
