// B415 test app: at its first launch makes 5000 files, a folder and a file it maps; at each launch, after the probe's
// optional sleep (../2026-11-23-r87-ryukgram-settings-protection/probe.m, linked before the group fix), maps the file
// and reads it, as FBSharedFramework does with crash_counter. Locked and Complete: SIGBUS.
#import <UIKit/UIKit.h>
#import <os/log.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>
@interface AppDelegate : UIResponder <UIApplicationDelegate>
@end
@implementation AppDelegate
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
extern volatile int *earlyCounter;
int main(int argc, char **argv) {
    @autoreleasepool {
        NSFileManager *fm = NSFileManager.defaultManager;
        NSString *dir = [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/mapped/deep"];
        NSString *file = [dir stringByAppendingPathComponent:@"counter"];
        if (![fm fileExistsAtPath:dir]) {
            [fm createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
            NSMutableData *d = [NSMutableData dataWithLength:16384];
            [d writeToFile:file atomically:NO];
            for (int i = 0; i < 5000; i++) [[d subdataWithRange:NSMakeRange(0, 64)] writeToFile:[dir stringByAppendingFormat:@"/f%d", i] atomically:NO];
            [fm createSymbolicLinkAtPath:[dir stringByAppendingPathComponent:@"link"] withDestinationPath:@"/var/mobile" error:nil];
        }
        int fd = open(file.fileSystemRepresentation, O_RDWR);
        if (fd < 0) os_log(OS_LOG_DEFAULT, "ryprobe app: counter open errno %d", errno);
        else {
            int *p = mmap(NULL, 16384, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
            os_log(OS_LOG_DEFAULT, "ryprobe app: counter class %d, mapped, reading", fcntl(fd, 63));
            p[0]++;
            os_log(OS_LOG_DEFAULT, "ryprobe app: counter read %d", p[0]);
        }
        if (earlyCounter) {
            os_log(OS_LOG_DEFAULT, "ryprobe app: reading the counter mapped before the sleep");
            os_log(OS_LOG_DEFAULT, "ryprobe app: early counter %d", *earlyCounter);
        }
        return UIApplicationMain(argc, argv, nil, @"AppDelegate");
    }
}
