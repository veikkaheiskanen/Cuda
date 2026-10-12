#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
destination="${1:-$root/macos/build/icon-assets}"
mkdir -p "$destination"
xcrun actool "$root/assets/Cuda.icon" --compile "$destination" \
  --platform macosx --minimum-deployment-target 26.0 --target-device mac \
  --app-icon Cuda --output-partial-info-plist "$destination/IconInfo.plist" \
  --output-format human-readable-text
[[ -s "$destination/Assets.car" ]] || { echo 'The system icon assets did not compile.' >&2; exit 1; }
