#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
if [[ ! -d "$root/dist/Cuda.app" ]]; then "$root/macos/scripts/build.sh"; fi
open "$root/dist/Cuda.app"
