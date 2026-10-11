#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/screenshots
PHONE=$(cat build/phone-id)
IPAD=$(python3 -c 'import json; d=json.load(open("build/devices.json")); print(next(x["udid"] for group in d["devices"].values() for x in group if "iPad" in x["name"]))')
APP="$PWD/build/simulator/Build/Products/Debug-iphonesimulator/Cuda.app"
for DEVICE in "$PHONE" "$IPAD"; do
  xcrun simctl boot "$DEVICE" || true
  xcrun simctl bootstatus "$DEVICE" -b
  xcrun simctl install "$DEVICE" "$APP"
  if [ "$DEVICE" = "$PHONE" ]; then CLASS=iphone; else CLASS=ipad; fi
  xcrun simctl status_bar "$DEVICE" override --time '9:41' --batteryState charged --batteryLevel 100
  for THEME in light dark; do
    xcrun simctl terminate "$DEVICE" com.veikkaheiskanen.Cuda || true
    xcrun simctl ui "$DEVICE" appearance "$THEME"
    SIMCTL_CHILD_CUDA_DEMO=1 xcrun simctl launch "$DEVICE" com.veikkaheiskanen.Cuda
    sleep 5
    xcrun simctl io "$DEVICE" screenshot "build/screenshots/cuda-$CLASS-$THEME.png"
  done
  xcrun simctl ui "$DEVICE" content_size accessibility-large
  sleep 2
  xcrun simctl io "$DEVICE" screenshot "build/screenshots/cuda-$CLASS-large-type.png"
  xcrun simctl ui "$DEVICE" content_size large
  xcrun simctl shutdown "$DEVICE"
done
