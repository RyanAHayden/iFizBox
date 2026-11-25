import zipfile,plistlib,sys
a=zipfile.ZipFile(sys.argv[1]);b=zipfile.ZipFile(sys.argv[2],'w',zipfile.ZIP_DEFLATED)
for i in a.infolist():
    d=a.read(i)
    if i.filename=='Payload/iFizBox.app/Info.plist':
        p=plistlib.loads(d);print(p['CFBundleShortVersionString'],p['CFBundleIdentifier']);p['CFBundleShortVersionString']='0.99.0';d=plistlib.dumps(p,fmt=plistlib.FMT_BINARY)
    b.writestr(i,d)
b.close()
