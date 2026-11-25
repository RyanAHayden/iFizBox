cd ~/.local/share/ifizbox-rig; ios --udid=00008130-0018450C3661001C apps 2>/dev/null | python3 -c 'import json,sys
for l in sys.stdin:
  try: d=json.loads(l)
  except Exception: continue
  for a in (d if isinstance(d,list) else []):
    if a.get("CFBundleIdentifier")=="com.ryha.ifizbox": print(a["CFBundleShortVersionString"])'
