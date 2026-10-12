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

**Reconnect the Spotify library once in Settings.** The Electron-encrypted catalog token remains untouched; the native app uses its own Keychain-encrypted token file. Existing Spotify playback credentials remain compatible. Choose **Shelf → Add playlist → Import from Spotify**, or **Settings → Spotify → Import Spotify playlists**. Choose playlists or paste a Spotify playlist link/URI to import them into Shelf and recommendations. Re-importing updates existing entries and keeps other Shelf playlists. Spotify permits playlist contents for playlists you own or collaborate on. Home also includes weekly album picks and genre radio; browse albums, play them, or add them to Shelf. Favourites are saved locally first; a Spotify sync error cannot interrupt playback or undo the local favourite.

All artwork is center-cropped inside a fixed square frame, including wide video thumbnails. Empty Search fills the detail pane and keeps the compact player at the bottom.

Buttons, sliders and active playback controls follow the accent color selected in macOS System Settings → Appearance. The player glass stays neutral and follows light/dark window colors. Light, dark, and system appearance, transparency, and a 0–100% glass tint persist. Settings and Audio forms share the window material; the transparency switch updates the native window immediately. macOS Reduce Transparency is respected by native materials. `Command-F` opens search, `Command-O` imports music, `Command-Shift-P` opens the player, and `Command-Shift-M` opens the mini player. Space toggles playback while ordinary text entry retains its spaces.

This first native release ports the central music workflow. The translated lyric view and updater UI are not included. Updates are available through GitHub releases. Provider availability and resolution times still depend on the network and service.

## Discord Rich Presence

Open **Settings → Discord**. Create an application named **Cuda** at the [Discord Developer Portal](https://discord.com/developers/applications), copy its **Application ID** from General Information, paste it into Cuda, and choose **Save Application ID**. Enable **Share listening activity**. No bot, account token, client secret, or additional library is needed.

Keep the Discord **desktop app** open and enable activity sharing in Discord's Activity Privacy settings. Cuda connects through Discord's local IPC socket and reconnects when Discord reopens. The name shown by Discord comes from the application you created. Status in Cuda tells you whether the connection succeeded.

Rich Presence includes the current song and artist, public cover artwork when available, playback timing, and a service link for Spotify, YouTube, YouTube Music or SoundCloud. Pausing removes the running timer and shows **Paused**; seeking and playback speed changes update the timing. Loading or failed playback clears the activity. Turning sharing off or quitting Cuda clears it. Local file paths, loopback URLs and account tokens are never shared. Sharing is off by default and has no effect on audio when Discord is unavailable.

The [Discord IPC integration guide](https://github.com/discord/discord-rpc/blob/master/documentation/hard-mode.md) describes the framed socket transport and `SET_ACTIVITY` command used here. Tests exercise that transport with a local mock, without publishing to a Discord account.

## Lyrics in Now Playing

Open the player and choose **Lyrics**. The source menu offers **Auto**, **LyricFind**, **Musixmatch**, and **Genius**. Auto tries configured licensed providers, then the existing LRCLIB lookup, then a Genius song-page link. The panel follows song changes, preserves copyright notices, and highlights synced LRC lines when returned. Click a timed line to seek.

Open **Settings → Lyrics** to configure providers. Keys are stored in an authenticated-encrypted file using the native Keychain key; they are not stored in plain preferences or exposed by the local HTTP API. Empty key fields preserve existing keys. Use **Remove provider keys** to clear them.

- **LyricFind:** needs licensed Search and Display keys and a licensed territory. The connector uses the HTTPS Search/Display APIs and an ISRC from the matched recording. The older AMG/ELID identifiers are no longer accepted by the current API. Provider-account response compatibility and catalogue coverage require verification with your licensed credentials. [Request access](https://www.lyricfind.com/contact).
- **Musixmatch:** add an API key with lyrics access. Text and copyright are displayed as supplied, territory restrictions are respected, and a returned display pixel is requested when the text is shown. Full lyrics or previews depend on your access. [API documentation](https://github.com/musixmatch/musixmatch-sdk/blob/master/swagger/swagger.json).
- **Genius:** an optional access token enables exact song lookup through its supported search API. Full lyrics and annotations open on Genius; they are not scraped into Cuda. Without a token, the button opens a search for the song and artist. [Create an API client](https://genius.com/api-clients), [API reference](https://docs.genius.com/).

Provider integrations are tested with original lyric fixtures and mock API responses. No real licensed keys have been supplied for live full-lyrics verification. Lyrics errors remain in the panel and never stop audio.

## Device sync between Mac and iOS

On the Mac, open **Settings → Device sync** and enable **Sync with iPhone and iPad**. On iOS, scan the Mac’s QR code with Camera and confirm pairing in Cuda, or paste the Mac’s pairing link in **Settings → Device sync**. No command line, server account, iCloud container, or Spotify developer key is needed for Shelf sync.

Keep both devices on the same local network and leave Cuda open on the Mac. Bonjour finds the paired Mac again when its address changes. The connection uses TLS with the exact Mac certificate pinned by the pairing code; a random pairing key authenticates every request. The iOS pairing secret is stored in Keychain. Mac pairing settings are encrypted with the native Keychain key. Reset pairing on the Mac to invalidate old device keys.

- **Favourites:** additions and removals sync both ways, including changes made offline.
- **Playlists:** names, descriptions, songs, edits and deletions sync both ways. Existing Shelves merge on first pairing. Concurrent changes to the same playlist use the most recent revision; edits to separate playlists and favourites merge independently. Spotify selections and account credentials stay on each device.
- **Offline songs:** new imported and Cuda-downloaded audio copies automatically both ways. SHA-256 verifies transfers and prevents duplicate files. Files are streamed to temporary storage before verification and import, with a 512 MB per-song limit. Removing a favourite or playlist never deletes an audio file from the other device. Turning off offline-song sync keeps Shelf sync enabled.

iOS syncs on launch, Shelf changes, network reconnect and periodic checks while open. It also requests background processing; **iOS decides when those checks run**, so an app closed or suspended by the system cannot promise immediate detection. Unfinished transfers retry when reachable; previously downloaded songs play without a Mac connection. The Mac listener is off until enabled and exposes only authenticated Shelf sync and audio transfer, not account or desktop control endpoints.

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

## Automatic iPhone streaming

In Cuda Native 1.0.6+, enabling **Settings → Device sync** also starts the mobile streaming companion inside the app. Cuda for iOS 1.1.1+ uses that same pairing to set up YouTube, YouTube Music and SoundCloud automatically. Existing pairings reconnect after updating; no separate command, address or pairing key is required.

The playback key is handed over through the pinned TLS Shelf connection, stored in iOS Keychain and refreshed after reconnect or Mac restart. It is independent of the Shelf bearer key and private desktop token, and permits only mobile search/resolution/media routes. Reset pairing rotates it; disabling Device sync or quitting Cuda closes both listeners. The streaming port is assigned automatically to avoid conflicts with a standalone companion.

Shelf/offline sync and connection setup use pinned TLS. Streaming audio and HLS use authenticated local HTTP for Apple media compatibility, so use the same trusted local network and keep your Mac awake with Cuda open. The separate standalone companion remains an advanced option.


### Automatic account and provider setup

Cuda Native **1.0.7+** and Cuda for iOS **1.1.2+** share configured Spotify Client ID/library authorization, Musixmatch, LyricFind, Genius keys and Last.fm setup when Device sync pairs the devices. Existing pairings pick up setup automatically. The snapshot travels only through authenticated, certificate-pinned HTTPS and is kept in iOS Keychain, separately from Shelf records and backups. Mac refresh/native playback credentials never transfer. Short-lived Spotify library authorization refreshes through the paired Mac while it is reachable. Provider fields describe setup; sharing keys does not add an unsupported iOS provider feature.

In iOS Settings → Connected services, turn off **Use accounts and keys from Mac** to remove the imported Keychain snapshot. Disconnecting or switching Macs clears the shared setup. Manual Spotify Client IDs take priority, and an independently authorized iPhone Spotify session is preserved. Spotify playback still needs Spotify installed and signed in on the phone; a shared token with `app-remote-control` permission is tried first, with official device authorization as fallback. Existing Mac authorizations without that permission can share the library immediately but may need the one-tap iPhone playback authorization.

Public music availability is provider-dependent. The Ares track reported in testing was refused by YouTube's bot/sign-in check from this network; SoundCloud returned only a 30-second preview. A source refusal is now reported instead of parsing yt-dlp's `null` output as an audio stream. Alternate recordings are still checked for artist/title/duration; they must not silently replace a full track with a preview or a different recording. Browser/account authorization for YouTube is not manufactured by copying Spotify credentials.


### Playlist covers and device-only offline downloads

Open a playlist and choose **Change cover** from its more menu. Mac uses the system file picker; iPhone/iPad uses Photos. Cuda crops the chosen image square and syncs the small cover with playlist metadata.

Choose **Download on this Mac/device** in the playlist. Downloads are kept in a separate private cache and catalogue, outside the synced audio library. Playlist metadata and covers still sync, but downloaded playlist audio is **never automatically transferred to another device**. Download explicitly on each device that needs offline listening. Existing imported-file syncing remains available separately in Device sync Settings. **Remove downloads** removes private cache copies without deleting the playlist or imported music.

Public-source downloads are supported when the provider allows them. Spotify playlist tracks are matched to public recordings using title, artist and duration; Cuda never exports Spotify DRM audio. A playlist may download partially when a public recording is unavailable. Progress and the available-offline count show what actually succeeded. iOS needs its paired Mac online while resolving/downloading, then cached songs play independently with Auto selected.

The native builds compile `assets/Cuda.icon` with Apple's asset compiler for system icon appearances, alongside the six supplied PNG exports archived in `assets/IconExports`. Mac builds can reuse a compiled `Assets.car` through `CUDA_NATIVE_ICON_ASSETS` on a machine that only has Command Line Tools. The dedicated Native app icons workflow produces those assets.
