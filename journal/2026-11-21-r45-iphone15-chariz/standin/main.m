// R45 stand-in app: shows (and os_logs) every image dyld loaded from the app's own bundle, so a screenshot proves an
// injected tweak loaded. Scene life cycle, as iOS 27 requires for apps built with its SDK.
#import <UIKit/UIKit.h>
#import <mach-o/dyld.h>
#import <os/log.h>

static NSString *Loaded(void) {
  NSMutableString *s = [NSMutableString stringWithString:@"R45 stand-in\nloaded from the bundle:\n"];
  NSString *bundle = [[NSBundle mainBundle] bundlePath];
  uint32_t n = _dyld_image_count();
  for (uint32_t i = 0; i < n; i++) {
    NSString *p = [NSString stringWithUTF8String:_dyld_get_image_name(i)];
    NSRange r = [p rangeOfString:@".app/"];
    if ([p hasPrefix:bundle] && r.location != NSNotFound) [s appendFormat:@"%@\n", [p substringFromIndex:r.location + 5]];
  }
  [s appendFormat:@"images: %u\n", n];
  return s;
}

@interface S : UIResponder <UIWindowSceneDelegate>
@property (nonatomic, strong) UIWindow *window;
@end
@implementation S
- (void)scene:(UIScene *)scene willConnectToSession:(UISceneSession *)session options:(UISceneConnectionOptions *)o {
  NSString *s = Loaded();
  os_log(OS_LOG_DEFAULT, "R45STANDIN %{public}@", s);
  self.window = [[UIWindow alloc] initWithWindowScene:(UIWindowScene *)scene];
  UIViewController *vc = [UIViewController new];
  vc.view.backgroundColor = UIColor.whiteColor;
  UILabel *l = [[UILabel alloc] initWithFrame:CGRectInset(self.window.bounds, 20, 120)];
  l.numberOfLines = 0;
  l.font = [UIFont systemFontOfSize:20];
  l.textColor = UIColor.blackColor;
  l.text = s;
  [vc.view addSubview:l];
  self.window.rootViewController = vc;
  [self.window makeKeyAndVisible];
}
@end

@interface D : UIResponder <UIApplicationDelegate>
@end
@implementation D
- (UISceneConfiguration *)application:(UIApplication *)a configurationForConnectingSceneSession:(UISceneSession *)s
                              options:(UISceneConnectionOptions *)o {
  UISceneConfiguration *c = [[UISceneConfiguration alloc] initWithName:@"Default" sessionRole:s.role];
  c.delegateClass = [S class];
  return c;
}
@end

int main(int argc, char **argv) {
  @autoreleasepool { return UIApplicationMain(argc, argv, nil, NSStringFromClass([D class])); }
}
