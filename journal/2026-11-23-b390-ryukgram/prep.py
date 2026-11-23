import plistlib, struct, sys, shutil, os
app=sys.argv[1]; spy=sys.argv[2]
p=app+"/Info.plist"; d=plistlib.load(open(p,"rb")); d["UIFileSharingEnabled"]=True; plistlib.dump(d,open(p,"wb"),fmt=plistlib.FMT_BINARY)
shutil.copy(spy,app+"/Frameworks/ryspy.dylib")
plistlib.dump({"hide_ads_comments":True,"hide_meta_ai":True,"no_suggested_post":True,"hide_live_feed":True},open(app+"/ryspy-set.plist","wb"))
f=app+"/Frameworks/CydiaSubstrate.framework/CydiaSubstrate"; b=bytearray(open(f,"rb").read())
def patch(off):
    assert struct.unpack_from("<I",b,off)[0]==0xfeedfacf
    if b"ryspy.dylib" in b[off:off+8192]: return
    n,sz=struct.unpack_from("<II",b,off+16); name=b"@rpath/ryspy.dylib\0"; cs=(24+len(name)+7)&~7
    cmd=struct.pack("<IIIIII",0xc,cs,24,2,0,0)+name; cmd+=b"\0"*(cs-len(cmd))
    e=off+32+sz; assert not any(b[e:e+cs]), "no room"
    b[e:e+cs]=cmd; struct.pack_into("<II",b,off+16,n+1,sz+cs)
m=struct.unpack_from(">I",b,0)[0]
if m==0xcafebabe:
    for i in range(struct.unpack_from(">I",b,4)[0]): patch(struct.unpack_from(">5I",b,8+20*i)[2])
else: patch(0)
open(f,"wb").write(b); print("ok",app)
