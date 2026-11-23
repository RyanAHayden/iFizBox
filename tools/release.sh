#!/usr/bin/env bash
# Publish a iFizBox release on GitHub (T6), the one F61's self-update reads (web/app/core/selfupdate.js): tag
# v<native/VERSION> on RyanAHayden/iFizBox, with these assets:
#   iFizBox.ipa                       the sideload build (parseRelease's `ipa`)
#   iFizBox.deb                       the rootless jailbreak build (debFor's fallback, iphoneos-arm64 only)
#   <pkg>_<ver>_<arch>.deb           the same .deb under Debian's name (debFor's exact-arch match), e.g.
#                                    com.ryha.ifizbox_0.2.0-412_iphoneos-arm64.deb
#   <pkg>_<ver>_<arch>.deb           any other arch build found in --dist under that name (roothide, rootful)
#   Packages, Packages.gz, Release   iFizBox's own flat APT repo over those .debs (F72, tools/selfrepo.py): the
#                                    jailbreak app's built-in source, https://$BRAND_DOMAIN/repo/ (the Worker
#                                    serves releases/latest/download/ of RyanAHayden/iFizBox without the redirect);
#                                    B73: Packages also keeps the older releases' .debs, each as <tag>/<asset>
#   source.json                      F178: the updated AltStore source below, what
#                                    https://$BRAND_DOMAIN/repo/source.json serves (the Worker)
# Then it points iFizBox's AltStore source (web/app/source.json, tools/altsource.py; I7) at the new iFizBox.ipa, the
# sideload app's and the site's built-in source (F72), versions[] newest first: commit web/app/source.json afterwards.
# Run it only when a person asks for a release. How to cut one: docs/release.md.
#
#   tools/release.sh [--dry-run] [--notes FILE] [--dist DIR] [--draft] [--minimum X.Y.Z] [--out DIR] [--sync-piracy]
#                    [--tag-source]
#     --dry-run   build (or read --dist), check and print what would be published; publish nothing, no network
#     --notes F   the release notes (Markdown; the first 4 lines show in the app's update alert). Default: one
#                 bullet per release-notes/*.md (README.md left out), else "Smaller fixes and improvements."; then
#                 the standard footer about the two files. IFIZBOX_RELEASE_NOTES_DIR reads another folder
#     --dist DIR  publish DIR/iFizBox.deb and DIR/iFizBox.ipa as they are instead of running `make -C native package`
#     --draft     create the release as a draft (the app ignores drafts until it is published on GitHub)
#     --minimum V the oldest iFizBox that may keep running without upgrading first (F72): X-iFizBox-Minimum-Version in
#                 the Release and iFizBox's stanza, "minimumVersion" in the AltStore source. Recorded only: since
#                 F183 the app never blocks or pops up on it. Default: none
#     --out DIR   also leave the repo files, the notes and the updated AltStore source (source.json) in DIR; a dry
#                 run writes the source there only, never into web/app/source.json
#     --sync-piracy  a dry run too fetches Canister's newest piracy list and warns when web/app/core/piracy-list.js
#                 is older (a real run always refreshes it first and stops when it changed: commit it, run again)
#     --tag-source  commit the updated web/app/source.json on top of HEAD and tag that commit (pushed as the tag only;
#                 merge the tag into main afterwards), so the tagged commit, which tools/deploy.sh deploys, already
#                 lists this release. tools/publish.sh passes it. Without it GitHub tags HEAD
#   tools/release.sh --check-auth             which account a real run would publish as, and stop
#   tools/release.sh --verify-release X.Y.Z   the checks a real run makes after publishing, on their own: the release
#                 lists iFizBox.ipa/.deb, Packages(.gz), Release and source.json, and (not a draft)
#                 releases/latest/download/iFizBox.ipa redirects to vX.Y.Z's asset and answers
#   tools/release.sh --verify-live X.Y.Z      after the release is published: poll
#                 https://$BRAND_DOMAIN/repo/source.json and /repo/Packages until both list X.Y.Z (15 min), else fail
#   Publishing is done as the owner of the repo (gh auth token --user <owner>) unless GH_TOKEN is set.
#   IFIZBOX_RELEASE_REPO  owner/name to publish on (default RyanAHayden/iFizBox)
#   IFIZBOX_RELEASE_HISTORY  DIR/<tag>/ with the older releases' Packages (or .debs) instead of reading them from GitHub
set -euo pipefail
cd "$(dirname "$0")/.."
. native/brand.env # F170: BRAND_NAME for the release title and notes; F180: the asset names ($BRAND_NAME.ipa, .deb)

repo=${IFIZBOX_RELEASE_REPO:-$BRAND_GITHUB_REPO}
dry=0 notes= dist= draft=() minimum= out= sync_piracy=0 mode= mode_version= tag_source=0
while [ $# -gt 0 ]; do
  case $1 in
    --dry-run) dry=1 ;;
    --notes) notes=${2:?--notes needs a file}; shift ;;
    --dist) dist=${2:?--dist needs a directory}; shift ;;
    --draft) draft=(--draft) ;;
    --minimum) minimum=${2:?--minimum needs a version}; shift ;;
    --out) out=${2:?--out needs a directory}; shift ;;
    --sync-piracy) sync_piracy=1 ;;
    --tag-source) tag_source=1 ;;
    --check-auth) mode=auth ;;
    --verify-release) mode=release; mode_version=${2:?--verify-release needs a version}; shift ;;
    --verify-live) mode=live; mode_version=${2:?--verify-live needs a version}; shift ;;
    -h|--help) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "release: unknown argument $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done
die() { echo "release: $*" >&2; exit 1; }

# The release goes up as the repo's owner (RyanAHayden for RyanAHayden/iFizBox), whichever gh account is active: the
# machine's active account may be one with pull rights only, and gh answers its `release create` with HTTP 404.
# A GH_TOKEN already in the environment wins (tools/publish.sh sets one the same way; an organisation's repo needs one).
owner=${repo%%/*}
gh_auth() {
  command -v gh >/dev/null || die "needs the gh CLI, logged in as $owner (gh auth login)"
  if [ -n "${GH_TOKEN:-}" ]; then
    echo "release: publishing with the GH_TOKEN from the environment"
    return
  fi
  GH_TOKEN=$(gh auth token --user "$owner" 2>/dev/null) || GH_TOKEN=
  [ -n "$GH_TOKEN" ] || die "gh has no login for $owner, who owns $repo: run 'gh auth login' and sign in as $owner" \
    "(gh keeps the other accounts; the active one needn't change), or set GH_TOKEN to a token with push rights on $repo"
  export GH_TOKEN
  local login
  login=$(gh api user -q .login 2>/dev/null) || die "gh's token for $owner doesn't work (gh api user failed): gh auth login as $owner again"
  [ "$login" = "$owner" ] || die "gh's token for $owner belongs to $login"
  echo "release: publishing as $owner (gh auth token --user $owner)"
}

# After `gh release create`: the release lists the assets the apps and the Worker read, and (unless it is a draft,
# which is never "latest") releases/latest/download/<NAME>.ipa redirects to this tag's asset and that answers.
# GitHub can take a moment to show a new release as latest: retried for IFIZBOX_RELEASE_VERIFY_TIMEOUT seconds (120).
# IFIZBOX_RELEASE_WEB: the site the download URL is on (https://github.com; tests point it at a local server).
verify_release() {
  local t=$1 view draftflag names n missing=() web=${IFIZBOX_RELEASE_WEB:-https://github.com}
  view=$(gh release view "$t" --repo "$repo" --json isDraft,assets -q '(.isDraft|tostring), .assets[].name') ||
    die "gh release view $t --repo $repo failed: the release isn't there"
  draftflag=$(head -n1 <<<"$view")
  names=$(tail -n +2 <<<"$view")
  for n in "$BRAND_NAME.ipa" "$BRAND_NAME.deb" Packages Packages.gz Release source.json; do
    grep -qxF -- "$n" <<<"$names" || missing+=("$n")
  done
  [ ${#missing[@]} = 0 ] || die "release $t on $repo lacks ${missing[*]} (it has: $(tr '\n' ' ' <<<"$names"))"
  echo "release: $t lists $(tr '\n' ' ' <<<"$names")"
  if [ "$draftflag" = true ]; then
    echo "release: $t is a draft: releases/latest doesn't point at it until it is published on GitHub (then run --verify-release $t)"
    return
  fi
  local url=$web/$repo/releases/latest/download/$BRAND_NAME.ipa hop code loc got=
  local deadline=$((SECONDS + ${IFIZBOX_RELEASE_VERIFY_TIMEOUT:-120}))
  while :; do
    hop=$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 30 "$url" 2>/dev/null) || hop="000 "
    code=${hop%% *} loc=${hop#* }
    if [[ $code == 30? ]] && [[ $loc == */releases/download/$t/$BRAND_NAME.ipa ]]; then
      got=$(curl -sSL -r 0-3 -o /dev/null -w '%{http_code}' --max-time 60 "$loc" 2>/dev/null) || got=000
      if [ "$got" = 200 ] || [ "$got" = 206 ]; then
        echo "release: $url -> $loc ($got)"
        return
      fi
    fi
    [ $SECONDS -lt $deadline ] || die "$url doesn't resolve to $t's $BRAND_NAME.ipa: it answers $code${loc:+ -> $loc}${got:+, which answers $got}"
    sleep "${IFIZBOX_RELEASE_VERIFY_INTERVAL:-5}"
  done
}

# --verify-live VERSION: after the release is published (the Worker's /repo/ files read the latest release's assets),
# wait until https://$BRAND_DOMAIN/repo/source.json lists VERSION for $BRAND_BUNDLE_ID and /repo/Packages has a
# $BRAND_PACKAGE stanza of VERSION, and fail loudly with what each one says when that doesn't happen in time.
# IFIZBOX_LIVE_BASE (https://$BRAND_DOMAIN), IFIZBOX_LIVE_TIMEOUT (900 s), IFIZBOX_LIVE_INTERVAL (15 s).
verify_live() {
  python3 - "${IFIZBOX_LIVE_BASE:-https://$BRAND_DOMAIN}" "$1" "$BRAND_BUNDLE_ID" "$BRAND_PACKAGE" \
    "${IFIZBOX_LIVE_TIMEOUT:-900}" "${IFIZBOX_LIVE_INTERVAL:-15}" <<'PY'
import json, sys, time, urllib.request
base, version, bundle, pkg, timeout, interval = sys.argv[1:]
deadline = time.monotonic() + float(timeout)

def get(path):
    # Cloudflare answers Python's default User-Agent (Python-urllib) with 403.
    req = urllib.request.Request(base.rstrip("/") + path + "?t=%d" % time.time(),
                                 headers={"Cache-Control": "no-cache", "User-Agent": "release-check/1"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")

def source():
    apps = [a for a in json.loads(get("/repo/source.json")).get("apps", []) if a.get("bundleIdentifier") == bundle]
    if not apps:
        return False, "no app " + bundle
    vs = [v.get("version") for v in apps[0].get("versions", [])] or [apps[0].get("version")]
    return version in vs, "versions " + " ".join(str(v) for v in vs[:5])

def packages():
    vs, cur = [], None
    for line in get("/repo/Packages").splitlines() + [""]:
        if line.startswith("Package:"):
            cur = line.split(":", 1)[1].strip()
        elif line.startswith("Version:") and cur == pkg:
            vs.append(line.split(":", 1)[1].strip())
        elif not line.strip():
            cur = None
    return any(v.split("-")[0] == version for v in vs), pkg + " " + (" ".join(vs[:5]) or "not listed")

while True:
    said = []
    ok = True
    for name, check in (("source.json", source), ("Packages", packages)):
        try:
            good, what = check()
        except Exception as e:  # noqa: BLE001 - a deploy in progress can answer anything
            good, what = False, "%s: %s" % (type(e).__name__, e)
        ok = ok and good
        said.append("%s/repo/%s: %s%s" % (base.rstrip("/"), name, what, "" if good else " (no " + version + ")"))
    if ok:
        for s in said:
            print("release: live: " + s)
        print("release: live: %s is up" % version)
        sys.exit(0)
    if time.monotonic() >= deadline:
        for s in said:
            print("release: live: " + s, file=sys.stderr)
        print("release: live: %s is NOT up after %ss: check that the release is published and marked latest "
              "(tools/release.sh --verify-release), and the site's deploy (tools/deploy.sh v%s)" % (version, timeout, version), file=sys.stderr)
        sys.exit(1)
    print("release: live: waiting: " + "; ".join(said), file=sys.stderr)
    time.sleep(float(interval))
PY
}

case ${mode:-} in
  auth) gh_auth; exit 0 ;;
  release) [[ $mode_version =~ ^v?[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "--verify-release takes X.Y.Z, not '$mode_version'"
    gh_auth; verify_release "v${mode_version#v}"; echo "release: v${mode_version#v} is up on GitHub"; exit 0 ;;
  live) [[ $mode_version =~ ^v?[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "--verify-live takes X.Y.Z, not '$mode_version'"
    verify_live "${mode_version#v}"; exit $? ;;
esac

# T47: both builds bundle web/app/ as it is on disk, so an untracked or ignored file there (a leftover .ipa) would
# ship: refuse it, dry runs too. IFIZBOX_STRAY_ROOT: the checkout to look in instead of this one (tests).
tools/stray-check.sh "${IFIZBOX_STRAY_ROOT:-$PWD}" || die "web/app/ has files git doesn't track (above); not releasing"

version=$(tr -d '[:space:]' < native/VERSION)
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "native/VERSION is '$version', not X.Y.Z"
tag=v$version
if [ -n "$minimum" ]; then
  [[ $minimum =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "--minimum is '$minimum', not X.Y.Z"
  python3 - "$minimum" "$version" <<'PY' || die "--minimum $minimum is newer than this release ($version): nobody could satisfy it"
import sys
a, b = (tuple(int(x) for x in v.split(".")) for v in sys.argv[1:])
sys.exit(0 if a <= b else 1)
PY
fi
sha=$(git rev-parse HEAD)

# A real release comes from a clean, pushed commit, under a tag that doesn't exist yet.
if [ $dry = 0 ]; then
  gh_auth
  [ -z "$(git status --porcelain --untracked-files=no)" ] || die "the work tree has uncommitted changes"
  git fetch -q origin
  [ -n "$(git branch -r --contains "$sha")" ] || die "HEAD ($sha) is not on origin; push it first"
  if git rev-parse -q --verify "refs/tags/$tag" >/dev/null || git ls-remote --exit-code --tags origin "$tag" >/dev/null 2>&1; then
    die "tag $tag already exists: bump native/VERSION (and commit and push it) first"
  fi
  if gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then die "$repo already has a release $tag"; fi
fi

# T11: the malware check's copy of Canister's piracy list (web/app/core/piracy-list.js, F228) ships inside both builds,
# so a real run refreshes it from cnstr/manifests first (tools/sync-piracy-list.py). When Canister has moved on, or
# the script now writes something else, the file changes: that stops the run, because the release must be a clean,
# pushed commit and the builds would carry the old list. Commit the refreshed file, push, and run again.
# A dry run stays off the network: it only says which Canister commit the committed copy is from, unless
# --sync-piracy asks it to compare with Canister's newest (into a temporary file; the repo's copy is left alone).
# IFIZBOX_PIRACY_SYNC_ARGS: extra arguments for the sync script (tests feed it saved API answers: --tree F --commits F).
piracy=web/app/core/piracy-list.js
piracy_src() { sed -n 's/^export const PIRACY_LIST_SOURCE = .*commit: "\([0-9a-f]\{40\}\)", date: "\([0-9-]*\)".*/\1 \2/p' "$1"; }
read -r pl_sha pl_date <<<"$(piracy_src "$piracy")" || true
[ -n "${pl_sha:-}" ] || die "$piracy names no Canister commit (PIRACY_LIST_SOURCE): run tools/sync-piracy-list.py"
# shellcheck disable=SC2206
pl_args=(${IFIZBOX_PIRACY_SYNC_ARGS:-})
if [ $dry = 1 ] && [ $sync_piracy = 0 ]; then
  echo "release: piracy list: Canister ${pl_sha:0:12} ($pl_date), not checked against Canister (dry run; --sync-piracy checks)"
else
  pl_out=$piracy
  if [ $dry = 1 ]; then pl_tmp=$(mktemp -d); pl_out=$pl_tmp/piracy-list.js; fi
  python3 tools/sync-piracy-list.py "${pl_args[@]}" --out "$pl_out" >&2 ||
    die "couldn't refresh $piracy from Canister (tools/sync-piracy-list.py above)"
  read -r new_sha new_date <<<"$(piracy_src "$pl_out")" || true
  if [ "$new_sha" != "$pl_sha" ]; then
    echo "release: warning: $piracy is from Canister ${pl_sha:0:12} ($pl_date), older than its newest piracy-list commit ${new_sha:0:12} ($new_date)" >&2
  fi
  if [ $dry = 1 ]; then
    if cmp -s "$pl_out" "$piracy"; then echo "release: piracy list: Canister ${pl_sha:0:12} ($pl_date), current"
    else echo "release: (dry run: a real run would refresh $piracy and stop for it to be committed)" >&2; fi
    rm -rf "$pl_tmp"
  elif [ -n "$(git status --porcelain -- "$piracy")" ]; then
    die "refreshed $piracy from Canister ${new_sha:0:12} ($new_date): commit and push it, then run again"
  else
    echo "release: piracy list: Canister ${pl_sha:0:12} ($pl_date), current"
  fi
fi

if [ -z "$dist" ]; then
  make -s -C native package
  dist=native/build
fi
deb=$dist/$BRAND_NAME.deb ipa=$dist/$BRAND_NAME.ipa
[ -f "$deb" ] || die "no $deb"
[ -f "$ipa" ] || die "no $ipa"

# The .deb's Package/Version/Architecture (Debian's file name) and the checks both files must pass; VERSION must be
# what the app reports (CFBundleShortVersionString), or the update offer would loop.
info=$(python3 - "$deb" "$ipa" "$version" <<'PY'
import os, sys, tarfile, io, lzma, zipfile, plistlib
sys.path.insert(0, "native")
import mkdeb, mkipa
from brand import NAME
deb, ipa, version = sys.argv[1:]
with open(deb, "rb") as f:
    members = dict(mkdeb.read_ar(f.read()))
ctl = members.get("control.tar.xz") or members.get("control.tar.gz")
with tarfile.open(fileobj=io.BytesIO(ctl)) as t:
    m = next(x for x in t.getmembers() if x.name.lstrip("./") == "control")
    fields = mkdeb.control_fields(t.extractfile(m).read().decode())
problems = []
problems += [NAME + ".deb: " + p for p in mkdeb.check(deb)[0]]
problems += [NAME + ".ipa: " + p for p in mkipa.check(ipa)[0]]
if fields.get("Version", "").split("-")[0] != version:
    problems.append("%s.deb Version %r is not native/VERSION %s" % (NAME, fields.get("Version"), version))
try:
    z = zipfile.ZipFile(ipa)
    plist = next(n for n in z.namelist() if n.endswith(".app/Info.plist") and n.count("/") == 2)
    short = plistlib.loads(z.read(plist)).get("CFBundleShortVersionString")
except (StopIteration, zipfile.BadZipFile, plistlib.InvalidFileException):
    short = None
if short != version:
    problems.append("%s.ipa CFBundleShortVersionString %r is not native/VERSION %s" % (NAME, short, version))
print("%s_%s_%s.deb" % (fields.get("Package"), fields.get("Version"), fields.get("Architecture")))
for p in problems:
    print("problem: " + p)
PY
)
debname=$(head -n1 <<<"$info")
problems=$(grep '^problem: ' <<<"$info" | sed 's/^problem: //' || true)
[[ $debname =~ ^[a-z0-9][a-z0-9.+-]*_[0-9][A-Za-z0-9.+~-]*_[a-z0-9-]+\.deb$ ]] || die "bad .deb name '$debname'"
if [ -n "$problems" ]; then
  sed 's/^/release: /' <<<"$problems" >&2
  [ $dry = 1 ] || die "the build doesn't pass its checks; not publishing"
  echo "release: (dry run: a real run would stop here)" >&2
fi

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cp "$ipa" "$stage/$BRAND_NAME.ipa"
cp "$deb" "$stage/$BRAND_NAME.deb"
cp "$deb" "$stage/$debname"
# Other arch builds named like Debian's files (com.ryha.ifizbox_<ver>_iphoneos-arm64e.deb) ride along.
extra=()
pkg=${debname%%_*}
for f in "$dist/${pkg}"_*_*.deb; do
  [ -f "$f" ] || continue
  b=$(basename "$f")
  [ "$b" = "$debname" ] && continue
  cp "$f" "$stage/$b"
  extra+=("$b")
done
# F72: iFizBox's own APT repo over the Debian-named .debs. B73: Packages keeps the older releases too (the newest 20
# in all), so Downgrade and Version History list them; every Filename: is <tag>/<asset>, which the Worker's
# /repo/<tag>/<file>.deb fetches from that release. A real run reads the older releases' Packages assets (or their
# Debian-named .debs) from GitHub with gh; a dry run stays offline and lists this release only.
# IFIZBOX_RELEASE_HISTORY=DIR: read the older releases from DIR/<tag>/ instead (tests; tools/selfrepo.py fetch fills one).
repodebs=("$stage/$debname")
for b in "${extra[@]}"; do repodebs+=("$stage/$b"); done
history=${IFIZBOX_RELEASE_HISTORY:-}
if [ -z "$history" ] && [ $dry = 0 ]; then
  history=$stage/.history
  python3 tools/selfrepo.py fetch "$repo" "$history" --skip "$tag" >&2 ||
    die "couldn't read the older releases' repo files from $repo (Packages would list this release only)"
fi
[ -z "$history" ] || [ -d "$history" ] || die "no older-releases directory $history"
python3 tools/selfrepo.py "$stage" "${repodebs[@]}" --tag "$tag" ${history:+--history "$history"} \
  ${minimum:+--minimum "$minimum"} >/dev/null || die "couldn't write the APT repo files"
repoversions=$(sed -n 's/^Version: //p' "$stage/Packages" | tr '\n' ' ')
repofiles=(Packages Packages.gz Release)

notesdir=${IFIZBOX_RELEASE_NOTES_DIR:-release-notes}
notefiles=()
if [ -d "$notesdir" ]; then
  for f in "$notesdir"/*.md; do
    if [ -f "$f" ] && [ "$(basename "$f")" != README.md ]; then notefiles+=("$f"); fi
  done
fi
if [ -n "$notes" ]; then
  [ -f "$notes" ] || die "no notes file $notes"
  cp "$notes" "$stage/notes.md"
elif [ ${#notefiles[@]} -gt 0 ]; then
  # D27: one release note per task (release-notes/<ID>.md, one sentence each), a bullet each, then the footer
  {
    for f in "${notefiles[@]}"; do
      line=$(tr '\n' ' ' < "$f" | sed 's/  */ /g; s/^ //; s/ $//; s/^- //')
      if [ -n "$line" ]; then echo "- $line"; fi
    done
    echo
    echo "$BRAND_NAME.ipa is unsigned: sign it with your own certificate (Feather, AltStore, SideStore, or $BRAND_NAME's own"
    echo "Settings > Signing). $BRAND_NAME.deb ($debname) is the rootless jailbreak build."
  } > "$stage/notes.md"
else
  # no notes written: a plain line, never the commit subjects (internal, long)
  {
    echo "Smaller fixes and improvements."
    echo
    echo "$BRAND_NAME.ipa is unsigned: sign it with your own certificate (Feather, AltStore, SideStore, or $BRAND_NAME's own"
    echo "Settings > Signing). $BRAND_NAME.deb ($debname) is the rootless jailbreak build."
  } > "$stage/notes.md"
fi

altargs=(--notes "$stage/notes.md" ${minimum:+--minimum "$minimum"})
# F178: the updated AltStore source is an asset too: https://$BRAND_DOMAIN/repo/source.json (the Worker) serves the
# latest release's source.json, and the deployed web/app/source.json only when GitHub fails.
cp web/app/source.json "$stage/source.json"
python3 tools/altsource.py update "$version" "$ipa" "${altargs[@]}" --source "$stage/source.json" >/dev/null ||
  die "couldn't write the AltStore source"

echo "release: $repo $tag at $sha"
echo "release: assets: $BRAND_NAME.ipa $BRAND_NAME.deb $debname ${extra[*]:+${extra[*]} }${repofiles[*]} source.json"
if [ "$repo" = "$BRAND_GITHUB_REPO" ]; then aptrepo=https://$BRAND_DOMAIN/repo/; else aptrepo="https://github.com/$repo/releases/latest/download/ (a Worker with IFIZBOX_REPO=$repo serves it at /repo/)"; fi
echo "release: apt repo: $aptrepo, from https://github.com/$repo/releases/latest/download/${minimum:+ (minimum $minimum)}"
if [ -n "$history" ]; then echo "release: apt repo versions: ${repoversions% }"
else echo "release: apt repo versions: ${repoversions% } (dry run: older releases not read)"; fi
echo "release: AltStore source: https://$BRAND_DOMAIN/repo/source.json (the sideload app's; the jailbreak app uses the apt repo only)"
echo "release: notes:"
sed 's/^/  /' "$stage/notes.md"
if [ -n "$out" ]; then
  mkdir -p "$out"
  cp "$stage/notes.md" "$out/notes.md"
  for f in "${repofiles[@]}"; do cp "$stage/$f" "$out/$f"; done
fi
if [ $dry = 1 ]; then
  if [ -n "$out" ]; then
    cp "$stage/source.json" "$out/source.json"
    echo "release: dry run: the AltStore source it would write is $out/source.json"
  fi
  [ $tag_source = 0 ] || echo "release: dry run: a real run would commit web/app/source.json on top of ${sha:0:12} and tag that commit $tag"
  echo "release: dry run, nothing published"
  exit 0
fi

assets=("$stage/$BRAND_NAME.ipa" "$stage/$BRAND_NAME.deb" "$stage/$debname")
for b in "${extra[@]}"; do assets+=("$stage/$b"); done
for f in "${repofiles[@]}"; do assets+=("$stage/$f"); done
assets+=("$stage/source.json")
# --tag-source: the tag goes on a commit that adds the new web/app/source.json to the built one (nothing else changes),
# pushed as the tag alone; publish.sh merges it into main. The site deployed from the tag then lists this release.
if [ $tag_source = 1 ]; then
  cp "$stage/source.json" web/app/source.json
  python3 tools/altsource.py check >/dev/null
  git commit -q -m "$BRAND_NAME's AltStore source: $version" web/app/source.json
  sha=$(git rev-parse HEAD)
  git tag "$tag" "$sha"
  git push -q origin "refs/tags/$tag" || die "couldn't push tag $tag ($sha) to origin"
  echo "release: tagged $tag at $sha (the build's commit plus web/app/source.json)"
fi
if ! gh release create "$tag" --repo "$repo" --target "$sha" --title "$BRAND_NAME $version" --notes-file "$stage/notes.md" \
  "${draft[@]}" "${assets[@]}"; then
  [ $tag_source = 0 ] && die "gh release create $tag failed"
  git push -q origin ":refs/tags/$tag" || true
  git tag -d "$tag" >/dev/null || true
  die "gh release create $tag failed (tag $tag removed again)"
fi
git fetch -q origin "refs/tags/$tag:refs/tags/$tag" || true
echo "release: published https://github.com/$repo/releases/tag/$tag"
verify_release "$tag"
cp "$stage/source.json" web/app/source.json
python3 tools/altsource.py check
[ -z "$out" ] || cp web/app/source.json "$out/source.json"
if [ $tag_source = 1 ]; then
  echo "release: $tag ($sha) has web/app/source.json naming its $BRAND_NAME.ipa: merge $tag into main, deploy it" \
    "(tools/deploy.sh $tag), then run tools/release.sh --verify-live $version"
else
  echo "release: web/app/source.json now names $tag's $BRAND_NAME.ipa: commit it, push it, then run" \
    "tools/release.sh --verify-live $version (waits until https://$BRAND_DOMAIN/repo/ serves it)"
fi
