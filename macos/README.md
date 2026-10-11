# Cuda Native for Mac

Cuda's Mac interface is a real **SwiftUI and AppKit application**, built for Apple Silicon and **macOS 26 or later**. Floating player controls use Apple's `glassEffect` and native glass button styles; the system manages the sidebar, titlebar, window corners, menus, forms, and accessibility. There is no Electron, Chromium, HTML renderer, or web view in the native app.

## Build and run

Use an Apple Silicon Mac with Apple's macOS 26 SDK (current Command Line Tools or Xcode), Node.js 24, and Rust:

```sh
npm ci --prefix macos --omit=dev
npm test
npm run build:mac
npm start
```

The build downloads a checksum-pinned standalone Node runtime, prepares verified media tools, builds the Rust Spotify player and network audio decoder, compiles SwiftUI, and ad-hoc signs `dist/Cuda.app`. It does not install or package Electron. A full Xcode installation is optional for this command-line build.

The native app uses a small private Node helper for the existing source resolver and account/catalog code. Account commands travel only through the app's private pipe. Loopback API requests require a random per-launch capability; HLS segment requests use scoped stream capabilities. Spotify catalog tokens are authenticated-encrypted with a key stored in the macOS Keychain. No cloud server or subscription is introduced by Cuda.

## Playback

- **Imported audio:** `AVAudioEngine` with real three-band EQ, speed, pitch, reverb, echo, distortion, and volume. A mixer converts different sample rates and mono/stereo formats before the effect chain.
- **Public sources:** matching recordings race through the existing resolver. A bundled, network-enabled FFmpeg decoder feeds bounded PCM buffers into the same Apple audio graph. Decode-ahead is limited to three seconds, including when playback is paused. Seeking restarts the decoder at the requested position.
- **Spotify:** the existing Rust/librespot player and its audio processing run as a native helper. A connected playback session from the Electron build is reusable. Playback requires an eligible Spotify account.

The compact bar shows artwork, song, artist, active service, and transport. Its source menu is available for streaming tracks. Open the bar for the large player, progress, shuffle/repeat, and audio controls. The mini player is a separate native window, sharing the same queue and audio session.

## Your music and accounts

Cuda keeps the existing `~/Library/Application Support/Riff` media folder. On first launch it imports favourites, history, and playlists from a **temporary copy** of the legacy Local Storage database. It never opens or modifies the original database. Native Shelf data is saved separately as `native-shelf.json`; export/import backups are available in Settings.

**Reconnect the Spotify library once in Settings.** The Electron-encrypted catalog token remains untouched; the native app uses its own Keychain-encrypted token file. Existing Spotify playback credentials remain compatible. Select playlists in Settings to bring them into Shelf and recommendations. Home also includes weekly album picks and genre radio; browse albums, play them, or add them to Shelf. Favourites are saved locally first; a Spotify sync error cannot interrupt playback or undo the local favourite.

All artwork is center-cropped inside a fixed square frame, including wide video thumbnails. Empty Search fills the detail pane and keeps the compact player at the bottom.

Buttons, sliders and active playback controls follow the accent color selected in macOS System Settings → Appearance. The player glass stays neutral and follows light/dark window colors. Light, dark, and system appearance, transparency, and a 0–100% glass tint persist. Settings and Audio forms share the window material; the transparency switch updates the native window immediately. macOS Reduce Transparency is respected by native materials. `Command-F` opens search, `Command-O` imports music, `Command-Shift-P` opens the player, and `Command-Shift-M` opens the mini player. Space toggles playback while ordinary text entry retains its spaces.

This first native release ports the central music workflow. The legacy Discord integration, translated/synced lyric view, and updater UI are not included. Updates are available through GitHub releases. Provider availability and resolution times still depend on the network and service.

## Checks and distribution

```sh
mkdir -p macos/build/test-cache
swiftc -module-cache-path macos/build/test-cache -swift-version 5 -parse-as-library \
  -target arm64-apple-macos26.0 macos/Cuda/Sources/LocalAudio.swift \
  macos/Cuda/Sources/StreamAudio.swift macos/Tests/AudioChecks.swift \
  -o macos/build/audio-checks -framework AVFoundation
macos/build/audio-checks macos/Cuda/Resources/preview.wav
```

```sh
swiftc -module-cache-path macos/build/test-cache -swift-version 5 -parse-as-library \
  -target arm64-apple-macos26.0 macos/Cuda/Sources/LocalAudio.swift \
  macos/Cuda/Sources/StreamAudio.swift macos/Tests/StreamChecks.swift \
  -o macos/build/stream-checks -framework AVFoundation
node macos/scripts/check-service.js dist/Cuda.app macos/build/stream-checks
swiftc -parse-as-library macos/Cuda/Sources/Models.swift macos/Tests/ModelChecks.swift -o macos/build/model-checks
macos/build/model-checks
```

Run audio checks outside a restrictive shell sandbox so Apple's audio components can initialize. `StreamChecks.swift` verifies HTTP stream decoding, pause/resume, effects, seek, and decoder shutdown against a local fixture service. Node regression tests cover catalog operations, source selection/failover, HLS proxy headers, ranges, encryption, and Unicode Shelf migration. CI builds the same native arm64 app on macOS 26.

The provided build is ad-hoc signed, not Apple-notarized. A downloaded build may require **Open Anyway** in macOS Privacy & Security. Installing it does not erase the legacy profile; the legacy source remains in the repository, and previous app backups can be retained locally. The Electron GitHub release has been retired.

## Design and credits

Built by [veikkaheiskanen](https://github.com/veikkaheiskanen), with help from ChatGPT.

Powered on [Riff by rootless](https://github.com/rootscripts/riff) and [Deck by jarilehtinen](https://github.com/jarilehtinen/deck). Redistributed runtimes, Rust dependencies, and media tools retain their licenses and corresponding source notices in the app resources.

The native design follows Apple's [Liquid Glass adoption guidance](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass), keeping glass in the control layer and music content readable.
