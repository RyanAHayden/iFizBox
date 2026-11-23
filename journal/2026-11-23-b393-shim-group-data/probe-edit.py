import sys
p=sys.argv[1]; s=open(p).read()
def r(a,b):
    global s
    assert s.count(a)==1,a; s=s.replace(a,b)
r('@"probe-marker.txt"]','[NSString stringWithFormat:@"zx-%@.txt", store]]')
r('    NSString *v = [self stamp];\n    BOOL ok','    NSString *v = [NSString stringWithFormat:@"%@ %@", store, [self stamp]];\n    BOOL ok')
r('    NSData *json =','    r[@"log"] = [NSString stringWithContentsOfFile:[NSHomeDirectory() stringByAppendingPathComponent:@"Library/ifizbox-groupfix.log"] encoding:4 error:NULL] ?: @"";\n    r[@"old"] = [NSFileManager.defaultManager contentsOfDirectoryAtPath:[NSHomeDirectory() stringByAppendingPathComponent:@"Library/AppGroups"] error:NULL] ?: @[];\n    NSData *json =')
open(p,"w").write(s)
