#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
build="$root/macos/build/audio-decoder"
tools="${CUDA_NATIVE_TOOLS:-$root/bin/darwin-arm64}"
archive="$tools/sources/ffmpeg-9.0.1.tar.xz"
mkdir -p "$build"
if [[ -x "$build/bin/ffmpeg" ]]; then exit 0; fi
printf '%s  %s\n' cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635 "$archive" | shasum -a 256 -c -
tar -xf "$archive" -C "$build"
cd "$build/ffmpeg-9.0.1"
# LGPL-only standalone decoder. Full corresponding sources and this script
# ship with the app; the application itself does not link FFmpeg libraries.
./configure --prefix="$build" --disable-everything --disable-autodetect --disable-doc --disable-debug \
  --disable-ffprobe --disable-ffplay --enable-ffmpeg --enable-network --enable-securetransport \
  --enable-protocol=file,pipe,http,https,tcp,tls,crypto,data \
  --enable-demuxer=mov,mp3,aac,wav,flac,ogg,hls,mpegts,matroska \
  --enable-decoder=aac,mp3,mp3float,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,flac,vorbis,opus,alac \
  --enable-parser=aac,aac_latm,mpegaudio,opus,flac,vorbis --enable-encoder=pcm_f32le --enable-muxer=pcm_f32le \
  --enable-filter=aresample,aformat,anull --enable-swresample --enable-static --disable-shared
make -j"$(sysctl -n hw.logicalcpu)"
make install
"$build/bin/ffmpeg" -hide_banner -protocols | rg '^  https?$'
