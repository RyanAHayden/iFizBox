#!/usr/bin/env bash
# One command for a iFizBox release, every step in order (docs/release.md):
#
#   tools/publish.sh X.Y.Z [--notes FILE] [--minimum X.Y.Z] [--dry-run]
#
#   1. checks: on main, no uncommitted changes, up to date with origin, X.Y.Z newer than the last v* tag
#   2. writes native/VERSION, deletes release-notes/*.md (README.md stays; a copy is the default notes), commits
#      "Version X.Y.Z" and pushes it
#   3. builds that commit in a clean temporary worktree and publishes it with tools/release.sh --tag-source:
#      iFizBox.ipa, the .debs and iFizBox's own APT repo, as the repo owner's GitHub account, under tag vX.Y.Z on a
#      commit that adds the updated AltStore source (web/app/source.json, the built-in source) to the built one
#   4. merges that tag into main and pushes it, and deploys https://<domain> from the tag (tools/deploy.sh; the site
#      is deployed on release tags only, never on a push to main)
#   5. waits until https://<domain>/repo/ serves X.Y.Z (tools/release.sh --verify-live; release.sh itself already
#      checked that releases/latest/download/iFizBox.ipa is this release)
#
# Needs SWIFT_TOOLCHAIN and IOS_SDK in the environment (the native build: native/README.md), gh logged in to the
# repo owner's account and wrangler logged in to the site's Cloudflare account (tools/deploy.sh --check-auth).
# --dry-run builds, prints what would be published and deployed, and changes nothing.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
. native/brand.env # F170: BRAND_NAME; F180: the asset name ($BRAND_NAME.ipa) and the repo
die() { echo "publish: $*" >&2; exit 1; }

version="${1:-}"; shift || true
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "usage: tools/publish.sh X.Y.Z [--notes FILE] [--minimum X.Y.Z] [--dry-run]"
pass=() dry=0
while [ $# -gt 0 ]; do
  case "$1" in
    --notes) [ -f "${2:-}" ] || die "--notes needs a file"; pass+=(--notes "$(realpath "$2")"); shift 2 ;;
    --minimum) pass+=(--minimum "${2:-}"); shift 2 ;;
    --dry-run) dry=1; pass+=(--dry-run); shift ;;
    *) die "unknown option $1" ;;
  esac
done
repo="${IFIZBOX_RELEASE_REPO:-$BRAND_GITHUB_REPO}"
owner="${repo%%/*}"

# 1. checks
[ "$(git branch --show-current)" = main ] || die "check out main first"
[ -z "$(git status --porcelain --untracked-files=no)" ] || die "commit or stash your changes first"
[ -n "${SWIFT_TOOLCHAIN:-}" ] && [ -n "${IOS_SDK:-}" ] || die "SWIFT_TOOLCHAIN and IOS_SDK aren't set (an interactive shell's ~/.bashrc sets them)"
git pull -q --ff-only origin main || die "main can't fast-forward to origin/main"
last=$(git tag -l 'v[0-9]*' | sed 's/^v//' | sort -V | tail -n1)
newest=$(printf '%s\n%s\n' "${last:-0.0.0}" "$version" | sort -V | tail -n1)
[ "$version" != "${last:-}" ] && [ "$newest" = "$version" ] || die "$version isn't newer than the last release (${last:-none})"
if [ $dry = 0 ]; then
  # release.sh publishes as the repo's owner (gh auth token --user), whichever gh account is active; its
  # --check-auth makes the same check now, so a missing login stops here before the version commit is pushed.
  tools/release.sh --check-auth || die "gh can't publish to $repo as $owner (see above)"
  tools/deploy.sh --check-auth || die "wrangler can't deploy https://$BRAND_DOMAIN (see above)"
fi

tmp=$(mktemp -d)
trap 'git worktree remove --force "$tmp/w" >/dev/null 2>&1 || true; rm -rf "$tmp"; [ $dry = 1 ] && git checkout -q -- native/VERSION' EXIT

# D27: the release notes waiting in release-notes/*.md (one per task; README.md stays). release.sh reads a copy of
# them as the default notes (when no --notes), and the version commit deletes them, so the next release starts empty.
mkdir "$tmp/release-notes"
notefiles=() # committed ones only: an untracked file is someone's unfinished work, left alone
while IFS= read -r f; do
  if [ "$f" != release-notes/README.md ]; then notefiles+=("$f"); fi
done < <(git ls-files -- 'release-notes/*.md')
[ ${#notefiles[@]} = 0 ] || cp "${notefiles[@]}" "$tmp/release-notes/"
echo "publish: ${#notefiles[@]} release note(s) in release-notes/"

# 2. the version commit (with the release notes deleted)
[ "$(cat native/VERSION)" = "$version" ] || echo "$version" > native/VERSION
if [ $dry = 0 ]; then
  git add native/VERSION
  [ ${#notefiles[@]} = 0 ] || git rm -q -- "${notefiles[@]}"
  if ! git diff --cached --quiet -- native/VERSION release-notes; then
    git commit -q -m "Version $version" -- native/VERSION release-notes
    git push -q origin main
  fi
fi

# 3. build and publish from a clean worktree of exactly that commit (the runner may merge into main meanwhile)
git worktree add -q --detach "$tmp/w" HEAD
[ $dry = 1 ] && echo "$version" > "$tmp/w/native/VERSION"
(cd "$tmp/w" && IFIZBOX_RELEASE_NOTES_DIR="$tmp/release-notes" tools/release.sh "${pass[@]}" --tag-source --out "$tmp/out")
if [ $dry = 1 ]; then
  echo "publish: dry run: a real run would merge v$version into main, push it and deploy https://$BRAND_DOMAIN from it (tools/deploy.sh v$version)"
  echo "publish: dry run done; nothing was committed or published"
  exit 0
fi

# 4. the tag's commit (the build's plus web/app/source.json naming this release) onto main, then the site from the tag.
# A fast-forward when nothing landed on main meanwhile, else a merge commit; either way the tag is in main's history,
# so the next release's notes (git describe) start from it.
git pull -q --ff-only origin main
git merge -q --no-edit -m "Merge $BRAND_NAME $version (v$version): AltStore source" "refs/tags/v$version" ||
  die "v$version is published but won't merge into main: merge it by hand, push, then run tools/deploy.sh v$version"
python3 tools/altsource.py check >/dev/null
git push -q origin main
tools/deploy.sh "v$version" ||
  die "v$version is published but https://$BRAND_DOMAIN wasn't deployed: run tools/deploy.sh v$version, then tools/release.sh --verify-live $version"

# 5. the site: release.sh already checked releases/latest/download after publishing; now wait until
# https://$BRAND_DOMAIN/repo/ serves this release (source.json and Packages)
tools/release.sh --verify-live "$version" ||
  die "v$version is on GitHub but https://$BRAND_DOMAIN/repo/ doesn't serve it yet: check the release is latest (tools/release.sh --verify-release $version), then run tools/release.sh --verify-live $version"
echo "publish: $BRAND_NAME $version is out: https://github.com/$repo/releases/tag/v$version"
