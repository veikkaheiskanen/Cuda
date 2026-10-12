#!/bin/bash
# Called by the tag workflow, or locally after building and testing the app.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
app="${1:-$root/dist/Cuda.app}"
out="${2:-$root/dist}"
version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist")
tag="mac-native-v$version"
if [[ -n "${GITHUB_REF_NAME:-}" && "$GITHUB_REF_NAME" != "$tag" ]]; then echo 'Release tag must match the bundled app version.' >&2; exit 1; fi
mkdir -p "$out"
zip="$out/Cuda-$version-native-mac-arm64.zip"
codesign --verify --deep --strict "$app"
ditto --noextattr --noqtn --norsrc -c -k --keepParent "$app" "$zip"
node "$root/macos/scripts/appcast.js" "$zip" "$app" "$out/appcast.xml"
(cd "$out" && shasum -a 256 "$(basename "$zip")" appcast.xml > UPDATE-SHA256SUMS.txt)
if ! gh release view "$tag" --repo veikkaheiskanen/Cuda >/dev/null 2>&1; then
  gh release create "$tag" --repo veikkaheiskanen/Cuda --draft --verify-tag --title "Cuda $version for Mac" --generate-notes
fi
gh release upload "$tag" "$zip" "$out/appcast.xml" "$out/UPDATE-SHA256SUMS.txt" --repo veikkaheiskanen/Cuda --clobber
# Publish only when the archive, signed feed and checksums are in place.
gh release edit "$tag" --repo veikkaheiskanen/Cuda --draft=false --latest
