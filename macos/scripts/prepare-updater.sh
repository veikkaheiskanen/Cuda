#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
version=2.10.0
sdk="$root/macos/build/sparkle-$version"
archive="$root/macos/build/Sparkle-$version.tar.xz"
if [[ ! -f "$sdk/Sparkle.framework/Sparkle" ]]; then
  mkdir -p "$sdk"
  curl --fail --location "https://github.com/sparkle-project/Sparkle/releases/download/$version/Sparkle-$version.tar.xz" -o "$archive"
  printf '%s  %s\n' c2bf58aa8387266ac179357b1415d6f2635f044da8be41042af32425dae6da0c "$archive" | shasum -a 256 -c - >&2
  tar -xJf "$archive" -C "$sdk"
fi
# Apple archive metadata must not invalidate the vendor's nested code signatures.
xattr -cr "$sdk/Sparkle.framework"
codesign --verify --deep --strict "$sdk/Sparkle.framework"
printf '%s\n' "$sdk"
