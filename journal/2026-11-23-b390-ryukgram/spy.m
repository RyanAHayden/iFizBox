// B390 spy: logs keychain calls and dumps every store. Loaded as a dependency of CydiaSubstrate (before RyukGram).
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <CommonCrypto/CommonDigest.h>
#include <dlfcn.h>
#include <execinfo.h>
#include <mach/mach.h>
#include <mach-o/dyld.h>
#include <mach-o/loader.h>
#include <mach-o/nlist.h>
#include <string.h>
static OSStatus (*rAdd)(CFDictionaryRef, CFTypeRef *), (*rCopy)(CFDictionaryRef, CFTypeRef *), (*rUpd)(CFDictionaryRef, CFDictionaryRef), (*rDel)(CFDictionaryRef);
static NSString *dir; static NSString *run; static FILE *lgf; static double t0;
static const struct mach_header *fbMH; static void **fbAdd, **fbCopy;
static __thread int busy;
static NSString *hash(NSData *d) { unsigned char h[32]; CC_SHA256(d.bytes,(CC_LONG)d.length,h); return [NSString stringWithFormat:@"%02x%02x%02x%02x/%lu",h[0],h[1],h[2],h[3],(unsigned long)d.length]; }
static const char *base(const char *p){const char *s=p?strrchr(p,'/'):0;return s?s+1:(p?p:"?");}
static void say(NSString *f, ...) { va_list a; va_start(a,f); NSString *s=[[NSString alloc] initWithFormat:f arguments:a]; va_end(a); if(lgf){fprintf(lgf,"%s %.3f %s\n",run.UTF8String,CFAbsoluteTimeGetCurrent()-t0,s.UTF8String);fflush(lgf);} }
static NSString *caller(void){ void *bt[24]; int n=backtrace(bt,24); NSMutableArray *o=[NSMutableArray array]; for(int i=0;i<n;i++){Dl_info d; if(!dladdr(bt[i],&d))continue; NSString *b=@(base(d.dli_fname)); if([b isEqual:@"ryspy.dylib"])continue; if(![o.lastObject isEqual:b])[o addObject:b]; if(o.count>=3)break;} return [o componentsJoinedByString:@"<"]; }
static NSString *desc(CFDictionaryRef q){ NSDictionary *d=(__bridge NSDictionary*)q; if(![d isKindOfClass:NSDictionary.class])return @"?"; id ag=d[(id)kSecAttrAccessGroup]; return [NSString stringWithFormat:@"class=%@ agrp=%@ svce=%@ acct=%@ sync=%@ acc=%@ limit=%@",d[(id)kSecClass],ag?:@"-",d[(id)kSecAttrService]?:@"-",d[(id)kSecAttrAccount]?:@"-",d[(id)kSecAttrSynchronizable]?:@"-",d[(id)kSecAttrAccessible]?:@"-",d[(id)kSecMatchLimit]?:@"-"]; }
static OSStatus sAdd(CFDictionaryRef q, CFTypeRef *r){ OSStatus s=rAdd(q,r); if(!busy){busy=1;say(@"ADD st=%d %@ via %@",(int)s,desc(q),caller());busy=0;} return s; }
static OSStatus sCopy(CFDictionaryRef q, CFTypeRef *r){ OSStatus s=rCopy(q,r); if(!busy){busy=1;say(@"READ st=%d %@ via %@",(int)s,desc(q),caller());busy=0;} return s; }
static OSStatus sUpd(CFDictionaryRef q, CFDictionaryRef a){ OSStatus s=rUpd(q,a); if(!busy){busy=1;say(@"UPD st=%d %@ via %@",(int)s,desc(q),caller());busy=0;} return s; }
static OSStatus sDel(CFDictionaryRef q){ OSStatus s=rDel(q); if(!busy){busy=1;say(@"DEL st=%d %@ via %@",(int)s,desc(q),caller());busy=0;} return s; }
static void *sDlsym(void *h, const char *n){ if(!strcmp(n,"SecItemAdd"))return sAdd; if(!strcmp(n,"SecItemCopyMatching"))return sCopy; if(!strcmp(n,"SecItemUpdate"))return sUpd; if(!strcmp(n,"SecItemDelete"))return sDel; return dlsym(h,n); }
static void img(const struct mach_header *mh, intptr_t slide){
  Dl_info self, d; if(!dladdr((void*)img,&self)||self.dli_fbase==(void*)mh)return; if(mh->flags&0x80000000)return; if(!dladdr(mh,&d))return;
  const char *nm=base(d.dli_fname); BOOL gf=strstr(nm,"groupfix")!=NULL;
  const struct segment_command_64 *le=0; const struct symtab_command *st=0; const struct dysymtab_command *dy=0;
  const struct load_command *lc=(void*)((const struct mach_header_64*)mh+1);
  for(uint32_t i=0;i<mh->ncmds;i++,lc=(void*)((char*)lc+lc->cmdsize)){ if(lc->cmd==LC_SEGMENT_64&&!strcmp(((struct segment_command_64*)lc)->segname,SEG_LINKEDIT))le=(void*)lc; else if(lc->cmd==LC_SYMTAB)st=(void*)lc; else if(lc->cmd==LC_DYSYMTAB)dy=(void*)lc; }
  if(!le||!st||!dy||!dy->nindirectsyms)return; uintptr_t b=(uintptr_t)slide+le->vmaddr-le->fileoff; const struct nlist_64 *sy=(void*)(b+st->symoff); const char *str=(char*)(b+st->stroff); const uint32_t *ind=(void*)(b+dy->indirectsymoff); int n=0;
  lc=(void*)((const struct mach_header_64*)mh+1);
  for(uint32_t i=0;i<mh->ncmds;i++,lc=(void*)((char*)lc+lc->cmdsize)){ if(lc->cmd!=LC_SEGMENT_64)continue; const struct segment_command_64 *sg=(void*)lc; if(strncmp(sg->segname,"__DATA",6))continue; const struct section_64 *se=(void*)(sg+1);
    for(uint32_t j=0;j<sg->nsects;j++){ uint32_t ty=se[j].flags&SECTION_TYPE; if(ty!=S_LAZY_SYMBOL_POINTERS&&ty!=S_NON_LAZY_SYMBOL_POINTERS)continue; void **p=(void**)(slide+se[j].addr); const uint32_t *ix=ind+se[j].reserved1;
      for(size_t k=0;k<se[j].size/8;k++){ uint32_t s=ix[k]; if(s&(INDIRECT_SYMBOL_ABS|INDIRECT_SYMBOL_LOCAL))continue; const char *nn=str+sy[s].n_un.n_strx; void *to=0;
        if(gf){ if(!strcmp(nn,"_dlsym"))to=sDlsym; } else { if(!strcmp(nn,"_SecItemAdd"))to=sAdd; else if(!strcmp(nn,"_SecItemCopyMatching"))to=sCopy; else if(!strcmp(nn,"_SecItemUpdate"))to=sUpd; else if(!strcmp(nn,"_SecItemDelete"))to=sDel; }
        if(!to)continue; n++; if(strstr(nm,"FBSharedFramework")){ if(to==(void*)sAdd)fbAdd=&p[k]; if(to==(void*)sCopy)fbCopy=&p[k]; }
        vm_address_t pg=(vm_address_t)&p[k]&~(vm_address_t)(vm_page_size-1); if(vm_protect(mach_task_self(),pg,vm_page_size,0,VM_PROT_READ|VM_PROT_WRITE|VM_PROT_COPY)==KERN_SUCCESS)p[k]=to; else say(@"PROTECT FAILED %s %s",nm,nn); } } }
  if(n)say(@"image %s: %d pointers",nm,n);
}
static NSArray *kc(void){ NSMutableArray *o=[NSMutableArray array]; for(id c in @[(id)kSecClassGenericPassword,(id)kSecClassInternetPassword,(id)kSecClassKey]){ CFTypeRef out=0; NSDictionary *q=@{(id)kSecClass:c,(id)kSecMatchLimit:(id)kSecMatchLimitAll,(id)kSecReturnAttributes:@YES,(id)kSecReturnData:@YES,(id)kSecAttrSynchronizable:(id)kSecAttrSynchronizableAny}; OSStatus s=rCopy((__bridge CFDictionaryRef)q,&out); if(s){[o addObject:[NSString stringWithFormat:@"%@ st=%d",c,(int)s]];continue;} for(NSDictionary *i in (__bridge_transfer NSArray*)out){ id v=i[(id)kSecValueData]; [o addObject:[NSString stringWithFormat:@"%@ | %@ | svce=%@ acct=%@ | %@ | acc=%@ mdat=%@",c,i[(id)kSecAttrAccessGroup],i[(id)kSecAttrService],i[(id)kSecAttrAccount],[v isKindOfClass:NSData.class]?hash(v):@"nodata",i[(id)kSecAttrAccessible],i[(id)kSecAttrModificationDate]]]; } } return [o sortedArrayUsingSelector:@selector(compare:)]; }
static NSDictionary *flat(NSDictionary *d){ NSMutableDictionary *o=[NSMutableDictionary dictionary]; for(NSString *k in d){ id v=d[k]; NSString *s=[v description]; o[k]=s.length<80?s:hash([s dataUsingEncoding:4]); } return o; }
static NSDictionary *prefs(NSString *home){ NSMutableDictionary *o=[NSMutableDictionary dictionary]; NSString *p=[home stringByAppendingPathComponent:@"Library/Preferences"]; for(NSString *f in [NSFileManager.defaultManager contentsOfDirectoryAtPath:p error:0]){ NSDictionary *d=[NSDictionary dictionaryWithContentsOfFile:[p stringByAppendingPathComponent:f]]; if(d)o[f]=flat(d);} return o; }
static NSArray *tree(NSString *root,NSString *home){ NSMutableArray *o=[NSMutableArray array]; NSDirectoryEnumerator *e=[NSFileManager.defaultManager enumeratorAtPath:root]; for(NSString *f in e){ NSDictionary *a=e.fileAttributes; if([a.fileType isEqual:NSFileTypeDirectory]){ if(e.level>6)[e skipDescendants]; continue;} if([f containsString:@"Caches/"])continue; [o addObject:[NSString stringWithFormat:@"%@ %@",f,a[NSFileSize]]]; if(o.count>600)break; } return o; }
static void snap(NSString *ph){ busy=1; @autoreleasepool{ NSString *h=NSHomeDirectory(); NSMutableDictionary *o=[NSMutableDictionary dictionary]; o[@"home"]=h; o[@"keychain"]=kc(); o[@"prefsFiles"]=prefs(h); CFArrayRef ks=CFPreferencesCopyKeyList(kCFPreferencesCurrentApplication,kCFPreferencesCurrentUser,kCFPreferencesAnyHost); NSDictionary *live=ks?CFBridgingRelease(CFPreferencesCopyMultiple(ks,kCFPreferencesCurrentApplication,kCFPreferencesCurrentUser,kCFPreferencesAnyHost)):@{}; if(ks)CFRelease(ks); o[@"standard"]=flat(live); o[@"appgroups"]=tree([h stringByAppendingPathComponent:@"Library/AppGroups"],h); o[@"appsupport"]=tree([h stringByAppendingPathComponent:@"Library/Application Support"],h); o[@"documents"]=tree([h stringByAppendingPathComponent:@"Documents"],h);
  void *(*mk)(CFAllocatorRef)=dlsym(RTLD_DEFAULT,"SecTaskCreateFromSelf"); CFTypeRef (*get)(void*,CFStringRef,CFErrorRef*)=dlsym(RTLD_DEFAULT,"SecTaskCopyValueForEntitlement"); if(mk&&get){void *t=mk(0); for(NSString *k in @[@"keychain-access-groups",@"application-identifier",@"com.apple.security.application-groups"]){CFTypeRef v=get(t,(__bridge CFStringRef)k,0); if(v)o[k]=(__bridge_transfer id)v;}}
  NSData *j=[NSJSONSerialization dataWithJSONObject:o options:NSJSONWritingPrettyPrinted|NSJSONWritingSortedKeys error:0]; [j writeToFile:[dir stringByAppendingPathComponent:[NSString stringWithFormat:@"%@-%@.json",run,ph]] atomically:YES]; } busy=0; }
typedef OSStatus (*addf)(CFDictionaryRef,CFTypeRef*);
static void markers(void){ // through FBSharedFramework's own pointers, as Instagram itself calls the keychain
  if(!fbAdd||!fbCopy){say(@"MARK no FBSharedFramework pointers");return;}
  NSFileManager *fm=NSFileManager.defaultManager; NSString *pl=[dir stringByAppendingPathComponent:@"planted"]; BOOL first=![fm fileExistsAtPath:pl];
  for(NSString *g in @[@"MH9GU9K5PX.platformFamily",@"MH9GU9K5PX.shared",@""]){ NSMutableDictionary *q=[@{(id)kSecClass:(id)kSecClassGenericPassword,(id)kSecAttrService:@"ryspy.session",(id)kSecAttrAccount:g.length?g:@"none"} mutableCopy]; if(g.length)q[(id)kSecAttrAccessGroup]=g;
    if(first){ q[(id)kSecValueData]=[run dataUsingEncoding:4]; OSStatus s=((addf)*fbAdd)((__bridge CFDictionaryRef)q,0); say(@"MARK plant %@ st=%d",g,(int)s); [q removeObjectForKey:(id)kSecValueData]; }
    q[(id)kSecReturnData]=@YES; q[(id)kSecReturnAttributes]=@YES; CFTypeRef r=0; OSStatus s=((addf)*fbCopy)((__bridge CFDictionaryRef)q,&r); NSDictionary *d=(__bridge_transfer id)r; say(@"MARK keychain %@ -> st=%d agrp=%@ from=%@",g.length?g:@"(none)",(int)s,s?@"":d[(id)kSecAttrAccessGroup],s?@"":[[NSString alloc] initWithData:d[(id)kSecValueData] encoding:4]); }
  for(NSString *g in @[@"group.com.burbn.instagram",@"group.com.facebook.family",@"group.com.burbn.family"]){ NSURL *u=[fm containerURLForSecurityApplicationGroupIdentifier:g]; NSUserDefaults *ud=[[NSUserDefaults alloc] initWithSuiteName:g]; NSURL *f=[u URLByAppendingPathComponent:@"ryspy.txt"]; if(first){[run writeToURL:f atomically:YES encoding:4 error:0];[ud setObject:run forKey:@"ryspy.marker"];}
    say(@"MARK group %@ folder=%@ suite=%@ at %@",g,f?[NSString stringWithContentsOfURL:f encoding:4 error:0]:@"nil",[ud stringForKey:@"ryspy.marker"],u.path); }
  NSUserDefaults *sd=NSUserDefaults.standardUserDefaults; NSDictionary *own=[NSDictionary dictionaryWithContentsOfFile:[NSBundle.mainBundle pathForResource:@"ryspy-set" ofType:@"plist"]]; for(NSString *k in own){ if(first)[sd setObject:own[k] forKey:k]; say(@"MARK pref %@=%@",k,[sd objectForKey:k]); }
  if(first){[sd setObject:run forKey:@"ryspy.marker"];[run writeToFile:pl atomically:YES encoding:4 error:0];} say(@"MARK pref marker=%@ firstrun=%d",[sd objectForKey:@"ryspy.marker"],first);
}
__attribute__((constructor)) static void spyInit(void){ @autoreleasepool{ t0=CFAbsoluteTimeGetCurrent(); dir=[NSHomeDirectory() stringByAppendingPathComponent:@"Documents/ryspy"]; BOOL was=[NSFileManager.defaultManager fileExistsAtPath:dir]; [NSFileManager.defaultManager createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:0 error:0]; run=[NSString stringWithFormat:@"%.0f",[NSDate date].timeIntervalSince1970]; lgf=fopen([dir stringByAppendingPathComponent:@"log.txt"].UTF8String,"a"); rAdd=dlsym(RTLD_DEFAULT,"SecItemAdd"); rCopy=dlsym(RTLD_DEFAULT,"SecItemCopyMatching"); rUpd=dlsym(RTLD_DEFAULT,"SecItemUpdate"); rDel=dlsym(RTLD_DEFAULT,"SecItemDelete"); say(@"START was=%d %@",was,NSHomeDirectory()); snap(@"0start"); _dyld_register_func_for_add_image(img);
  for(NSNumber *n in @[@4,@12,@40]){ dispatch_after(dispatch_time(0,n.intValue*NSEC_PER_SEC),dispatch_get_global_queue(0,0),^{ if(n.intValue==4)markers(); { [NSFileManager.defaultManager removeItemAtPath:[dir stringByAppendingPathComponent:@"gf.log"] error:0]; [NSFileManager.defaultManager copyItemAtPath:[NSHomeDirectory() stringByAppendingPathComponent:@"Library/ifizbox-groupfix.log"] toPath:[dir stringByAppendingPathComponent:@"gf.log"] error:0]; } snap([NSString stringWithFormat:@"t%@",n]); }); } } }
