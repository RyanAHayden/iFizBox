#import <UIKit/UIKit.h>
#import <Security/Security.h>

static NSString *Read(NSString *account) {
    NSDictionary *q = @{(id)kSecClass: (id)kSecClassGenericPassword, (id)kSecAttrService: @"f463c",
                        (id)kSecAttrAccount: account, (id)kSecReturnData: @YES};
    CFTypeRef out = NULL;
    OSStatus s = SecItemCopyMatching((CFDictionaryRef)q, &out);
    if (s != errSecSuccess) return [NSString stringWithFormat:@"none (%d)", (int)s];
    return [[NSString alloc] initWithData:(__bridge_transfer NSData *)out encoding:NSUTF8StringEncoding];
}

static void Put(NSString *account, NSString *value) {
    NSDictionary *q = @{(id)kSecClass: (id)kSecClassGenericPassword, (id)kSecAttrService: @"f463c", (id)kSecAttrAccount: account};
    SecItemDelete((CFDictionaryRef)q);
    NSMutableDictionary *a = [q mutableCopy];
    a[(id)kSecValueData] = [value dataUsingEncoding:NSUTF8StringEncoding];
    SecItemAdd((CFDictionaryRef)a, NULL);
}

@interface Main : UIViewController
@property UILabel *label;
@end
@implementation Main
- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor = UIColor.whiteColor;
    Put(@"app", @"written-by-app");
    self.label = [[UILabel alloc] initWithFrame:CGRectMake(20, 120, 350, 240)];
    self.label.numberOfLines = 0;
    self.label.textColor = UIColor.blackColor;
    [self.view addSubview:self.label];
    UIButton *b = [UIButton buttonWithType:UIButtonTypeSystem];
    b.frame = CGRectMake(20, 400, 350, 60);
    [b setTitle:@"SHARE" forState:UIControlStateNormal];
    [b addTarget:self action:@selector(share) forControlEvents:UIControlEventTouchUpInside];
    [self.view addSubview:b];
    [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(show)
                                               name:UIApplicationDidBecomeActiveNotification object:nil];
    [self show];
}
- (void)show {
    self.label.text = [NSString stringWithFormat:@"APP %@\nfrom extension: %@", NSBundle.mainBundle.bundleIdentifier, Read(@"ext")];
}
- (void)share {
    UIActivityViewController *a = [[UIActivityViewController alloc] initWithActivityItems:@[@"hello"] applicationActivities:nil];
    a.completionWithItemsHandler = ^(UIActivityType t, BOOL done, NSArray *items, NSError *e) { [self show]; };
    [self presentViewController:a animated:YES completion:nil];
}
@end

@interface Scene : UIResponder <UIWindowSceneDelegate>
@property (strong) UIWindow *window;
@end
@implementation Scene
- (void)scene:(UIScene *)scene willConnectToSession:(UISceneSession *)s options:(UISceneConnectionOptions *)o {
    self.window = [[UIWindow alloc] initWithWindowScene:(UIWindowScene *)scene];
    self.window.rootViewController = [Main new];
    [self.window makeKeyAndVisible];
}
@end

@interface Delegate : UIResponder <UIApplicationDelegate>
@end
@implementation Delegate
@end

#ifdef EXTENSION
@interface ShareVC : UIViewController
@end
@implementation ShareVC
- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor = UIColor.yellowColor;
    NSString *got = Read(@"app");
    Put(@"ext", @"written-by-extension");
    UILabel *l = [[UILabel alloc] initWithFrame:CGRectMake(20, 40, 350, 260)];
    l.numberOfLines = 0;
    l.textColor = UIColor.blackColor;
    l.text = [NSString stringWithFormat:@"EXTENSION RUNS\n%@\nfrom app: %@", NSBundle.mainBundle.bundleIdentifier, got];
    [self.view addSubview:l];
    UIButton *b = [UIButton buttonWithType:UIButtonTypeSystem];
    b.frame = CGRectMake(20, 310, 350, 60);
    [b setTitle:@"DONE" forState:UIControlStateNormal];
    [b addTarget:self action:@selector(finish) forControlEvents:UIControlEventTouchUpInside];
    [self.view addSubview:b];
}
- (void)finish { [self.extensionContext completeRequestReturningItems:@[] completionHandler:nil]; }
@end
#else
int main(int argc, char **argv) {
    @autoreleasepool { return UIApplicationMain(argc, argv, nil, @"Delegate"); }
}
#endif
