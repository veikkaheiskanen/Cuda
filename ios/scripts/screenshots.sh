#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/screenshots
PHONE=$(cat build/phone-id)
IPAD=$(python3 -c 'import json; d=json.load(open("build/devices.json")); print(next(x["udid"] for group in d["devices"].values() for x in group if "iPad" in x["name"]))')
APP="$PWD/build/simulator/Build/Products/Debug-iphonesimulator/Cuda.app"
launch_preview() {
  local container
  container=$(xcrun simctl get_app_container "$DEVICE" com.veikkaheiskanen.Cuda data)
  rm -f "$container/Documents/preview-ready"
  SIMCTL_CHILD_CUDA_PREVIEW_SETTINGS="${3:-0}" SIMCTL_CHILD_CUDA_PREVIEW_AUDIO="${2:-0}" SIMCTL_CHILD_CUDA_DEMO=1 SIMCTL_CHILD_CUDA_PREVIEW_PLAYER="${1:-0}" xcrun simctl launch "$DEVICE" com.veikkaheiskanen.Cuda
  for attempt in {1..60}; do
    if [ -f "$container/Documents/preview-ready" ]; then sleep 8; return; fi
    sleep 1
  done
  echo "Cuda did not finish presenting its native preview on $DEVICE" >&2
  exit 1
}
for DEVICE in "$PHONE" "$IPAD"; do
  xcrun simctl boot "$DEVICE" || true
  xcrun simctl bootstatus "$DEVICE" -b
  xcrun simctl install "$DEVICE" "$APP"
  if [ "$DEVICE" = "$PHONE" ]; then CLASS=iphone; else CLASS=ipad; fi
  xcrun simctl status_bar "$DEVICE" override --time '9:41' --batteryState charged --batteryLevel 100
  for THEME in light dark; do
    xcrun simctl terminate "$DEVICE" com.veikkaheiskanen.Cuda || true
    xcrun simctl ui "$DEVICE" appearance "$THEME"
    launch_preview
    xcrun simctl io "$DEVICE" screenshot "build/screenshots/cuda-$CLASS-$THEME.png"
  done
  xcrun simctl ui "$DEVICE" content_size accessibility-large
  sleep 2
  xcrun simctl io "$DEVICE" screenshot "build/screenshots/cuda-$CLASS-large-type.png"
  xcrun simctl ui "$DEVICE" content_size large
  xcrun simctl terminate "$DEVICE" com.veikkaheiskanen.Cuda || true
  launch_preview 1
  xcrun simctl io "$DEVICE" screenshot "build/screenshots/cuda-$CLASS-player.png"
  xcrun simctl terminate "$DEVICE" com.veikkaheiskanen.Cuda || true
  launch_preview 1 1
  xcrun simctl io "$DEVICE" screenshot "build/screenshots/cuda-$CLASS-audio.png"
  xcrun simctl terminate "$DEVICE" com.veikkaheiskanen.Cuda || true
  launch_preview 0 0 1
  xcrun simctl io "$DEVICE" screenshot "build/screenshots/cuda-$CLASS-settings.png"
  xcrun simctl shutdown "$DEVICE"
done
