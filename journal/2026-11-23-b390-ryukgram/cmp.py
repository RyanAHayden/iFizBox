import json,glob,sys,os
S=sys.argv[1]
for a,b in zip(sys.argv[2:],sys.argv[3:]):
    def load(l,first=False):
        fs=sorted(glob.glob(f"{S}/pull-{l}/ryspy/*-t40.json")); return json.load(open(fs[-1]))
    A,B=load(a),load(b); print(f"== {a} -> {b}", "same container" if os.path.basename(A['home'])==os.path.basename(B['home']) else f"container path {A['home'][-36:]} -> {B['home'][-36:]}")
    strip=lambda s:s.split(" mdat=")[0]
    ka,kb={strip(x) for x in A["keychain"]},{strip(x) for x in B["keychain"]}
    for x in sorted(ka-kb): print("  kc LOST/CHANGED",x)
    for x in sorted(kb-ka): print("  kc NEW/CHANGED ",x)
    sa,sb=A["standard"],B["standard"]
    print("  standard lost:",[k for k in sa if k not in sb]); print("  standard changed:",[(k,sa[k][:40],sb[k][:40]) for k in sa if k in sb and sa[k]!=sb[k]][:12]); print("  standard new:",[k for k in sb if k not in sa][:30])
    for f in A["prefsFiles"]:
        if f.startswith("ifizbox"): print("  suite",f,"lost:",[k for k in A["prefsFiles"][f] if k not in B["prefsFiles"].get(f,{})])
    n=lambda l:{x.rsplit(" ",1)[0] for x in l}
    for t in("appgroups","appsupport","documents"): print(f"  {t} lost:",[x for x in sorted(n(A[t])-n(B[t])) if "ryspy" not in x][:15])
