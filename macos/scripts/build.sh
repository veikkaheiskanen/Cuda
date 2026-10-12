#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
build="$root/macos/build"
destination="${1:-$root/dist/Cuda.app}"
stage=$(mktemp -d "${TMPDIR:-/tmp}/cuda-native-build.XXXXXX")
trap 'rm -rf "$stage"' EXIT
app="$stage/Cuda.app"
mode="${CUDA_NATIVE_MODE:-release}"
mkdir -p "$build/module-cache" "$(dirname "$destination")"
[[ $(uname -m) == arm64 ]] || { echo 'Build Cuda on an Apple Silicon Mac.'; exit 1; }
node_version=v24.21.0
node_archive="node-$node_version-darwin-arm64"
node_binary="${CUDA_NATIVE_NODE:-$build/$node_archive/bin/node}"
if [[ ! -f "$node_binary" ]]; then
  curl --fail --location "https://nodejs.org/dist/$node_version/$node_archive.tar.gz" -o "$build/$node_archive.tar.gz"
  printf '%s  %s\n' bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057 "$build/$node_archive.tar.gz" | shasum -a 256 -c -
  tar -xzf "$build/$node_archive.tar.gz" -C "$build"
fi
tools="${CUDA_NATIVE_TOOLS:-$root/bin/darwin-arm64}"
if [[ ! -f "$tools/bin/yt-dlp" ]]; then "$node_binary" "$root/scripts/prepare-macos-tools.js" --arch arm64; fi
if [[ ! -f "$tools/bin/riff-spotify-player" ]]; then "$node_binary" "$root/scripts/build-native.js" --spotify-only; fi
decoder="${CUDA_NATIVE_DECODER:-$root/macos/build/audio-decoder/bin/ffmpeg}"
if [[ ! -f "$decoder" ]]; then CUDA_NATIVE_TOOLS="$tools" "$root/macos/scripts/prepare-decoder.sh"; fi
if [[ ! -d "$root/macos/node_modules" ]]; then npm ci --prefix "$root/macos" --omit=dev; fi
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/runtime" "$app/Contents/Resources/backend/macos" "$app/Contents/Resources/backend/scripts" "$app/Contents/Resources/tools"
flags=(-O)
if [[ "$mode" == debug ]]; then flags=(-Onone -D DEBUG); fi
xcrun swiftc -module-cache-path "$build/module-cache" -swift-version 5 -parse-as-library -target arm64-apple-macos26.0 "${flags[@]}" \
  "$root"/macos/Cuda/Sources/*.swift "$root"/shared/*.swift -o "$app/Contents/MacOS/Cuda" \
  -framework SwiftUI -framework AppKit -framework AVFoundation -framework MediaPlayer -framework Security
cp "$root/macos/Cuda/Info.plist" "$app/Contents/Info.plist"
cp "$root/macos/Cuda/Resources/Cuda.icns" "$app/Contents/Resources/"
icon_assets="${CUDA_NATIVE_ICON_ASSETS:-$build/icon-assets}"
if xcrun --find actool >/dev/null 2>&1; then
  bash "$root/macos/scripts/compile-icons.sh" "$icon_assets"
fi
if [[ ! -f "$icon_assets/Assets.car" && -f "$root/macos/Cuda/Resources/IconAssets/Assets.car" ]]; then
  icon_assets="$root/macos/Cuda/Resources/IconAssets"
fi
if [[ -f "$icon_assets/Assets.car" ]]; then
  cp "$icon_assets/Assets.car" "$app/Contents/Resources/"
  /usr/libexec/PlistBuddy -c 'Add :CFBundleIconName string Cuda' "$app/Contents/Info.plist"
  if [[ -f "$icon_assets/Cuda.icns" ]]; then cp "$icon_assets/Cuda.icns" "$app/Contents/Resources/Cuda.icns"; fi
fi
if [[ "$mode" == debug ]]; then cp "$root"/macos/Cuda/Resources/*.png "$root/macos/Cuda/Resources/preview.wav" "$app/Contents/Resources/"; fi
cp "$node_binary" "$app/Contents/Resources/runtime/node"
node_license="$(dirname "$node_binary")/../LICENSE"
if [[ -f "$node_license" ]]; then cp "$node_license" "$app/Contents/Resources/runtime/NODE-LICENSE"; fi
for file in server.js platform.js tools.js tool-processes.js macos-tools.js macos-tools-manifest.json playback-resolver.js source-selection.js search-broker.js stream-utils.js spotify-service.js audio-settings.js library-import.js; do
  cp "$root/$file" "$app/Contents/Resources/backend/"
done
cp "$root/macos/native-host.js" "$root/macos/legacy-shelf.js" "$root/macos/secure-store.js" "$root/macos/discord-presence.js" "$root/macos/lyrics-service.js" "$root/macos/shelf-sync.js" "$root/macos/mobile-companion.js" "$root/macos/offline-downloads.js" "$app/Contents/Resources/backend/macos/"
cp "$root/scripts/ios-bridge.js" "$app/Contents/Resources/backend/scripts/"
ditto --noextattr --noqtn --norsrc "$root/macos/node_modules" "$app/Contents/Resources/backend/macos/node_modules"
# Keep only this Mac's LevelDB build. Other platform prebuilds are not shipped.
for directory in "$app/Contents/Resources/backend/macos/node_modules/classic-level/prebuilds"/*; do
  [[ $(basename "$directory") == darwin-x64+arm64 ]] || rm -rf "$directory"
done
ditto --noextattr --noqtn --norsrc "$tools" "$app/Contents/Resources/tools"
rm -f "$app/Contents/Resources/tools/bin/window-material.node"
cp "$decoder" "$app/Contents/Resources/tools/bin/cuda-audio-decoder"
cp "$root/macos/scripts/prepare-decoder.sh" "$app/Contents/Resources/tools/sources/cuda-audio-decoder-build.sh"
cp "$root/LICENSE" "$app/Contents/Resources/CUDA-LICENSE"
cp "$root/native/DECK-LICENSE" "$app/Contents/Resources/DECK-LICENSE"
xattr -cr "$app"
codesign --force --sign - "$app/Contents/Resources/runtime/node"
codesign --force --sign - "$app/Contents/Resources/backend/macos/node_modules/classic-level/prebuilds/darwin-x64+arm64/classic-level.node"
codesign --force --sign - "$app/Contents/Resources/tools/bin/cuda-audio-decoder"
codesign --force --sign - "$app"
codesign --verify --deep --strict "$app"
lipo "$app/Contents/MacOS/Cuda" -verify_arch arm64
ditto --noextattr --noqtn --norsrc "$app" "$destination"
echo "Built native Cuda: $destination"
