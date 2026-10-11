# Cuda for iOS

A native SwiftUI iPhone and iPad companion to Cuda. Home, Shelf, search, favourites, playlists, and the expandable player use system navigation, safe areas, Dynamic Type, SF Symbols, and Light / Dark / System appearance. iOS applies its own window and sheet corners; no desktop frame is copied onto the phone.

## What works

| Feature | iOS implementation |
| --- | --- |
| Imported music | On-device AVPlayer playback; import multiple audio files from Files. Content hashes prevent duplicate imports. |
| Background audio | Audio session, lock-screen transport and seeking, headphone disconnect handling, interruptions, system volume and AirPlay for local and public streams. |
| Spotify | Official Spotify iOS SDK 5.0.1. Spotify must be installed and signed in on the same device; Spotify renders the audio. On-demand playback requires Premium. |
| Spotify playlists | Choose playlists in Settings; fetch paginated contents into Shelf and use them as recommendation taste. |
| YouTube / YouTube Music / SoundCloud | Authenticated Mac companion resolves and proxies playable audio using Cuda's existing extractor and matching-source resolver. Mac must remain awake and reachable. |
| Auto source | Races matching public sources through the companion, then retries failed playback on alternatives. Spotify tracks use the iOS SDK first, falling back to matching public sources when Spotify fails and the Mac is paired. |
| Shelf | Persistent local favourites and editable playlists with descriptions, canonical duplicate prevention, queue actions, and deletion confirmation. |
| Recommendations | Uses favourite, playlist and recent artists, filters recently played tracks, and merges connected catalog results. |

Desktop-only integrations (Discord, desktop window transparency, the Rust Spotify audio engine, native desktop equalizer/pitch DSP, downloader, weekly album discovery and Last.fm) are not included in this first iOS port. Spotify audio belongs to the Spotify app and does not pass through Cuda's audio processing. Mac and iOS Shelves can sync through one-time pairing in Settings. Spotify catalogue imports remain snapshots; refetch from Spotify to refresh upstream changes.

## Install the IPA

The GitHub **iOS** workflow compiles an ARM64 Release application and packages `Cuda-1.1.1-ios-unsigned.ipa`. This is a real device binary, **unsigned**, intended for a tool such as Sideloadly or AltStore that signs apps with your own Apple account. It cannot be installed by opening the file directly, and it is not an App Store / TestFlight build. Follow your signing tool's device trust and Developer Mode instructions. No Apple credentials or signing certificates are included in this repository.

Alternatively, install full Xcode and build the project on your Mac. Set your own development team in Signing & Capabilities, select your connected iPhone, and Run. A paid Apple Developer account and appropriate distribution signing are needed for TestFlight/App Store distribution.

## Spotify setup

1. Install Spotify on your iPhone/iPad and sign in.
2. In the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), register an iOS integration with bundle ID `com.veikkaheiskanen.Cuda` and redirect URI **`cuda-spotify://callback`**. Allow the account under your app's user access if using development mode.
3. In Cuda → Settings, enter your app Client ID and tap **Connect Spotify**. This opens Spotify and returns to Cuda for remote control.
4. Tap **Choose playlists** and **Sync** to fetch the playlists you want to use on Shelf and for recommendations. Spotify may limit which playlists your developer app can access.

The app requests only remote playback and library/playlist access. It never asks for a Client Secret. The Spotify SDK's short-lived access token is kept in memory; after expiry or a cold start, reconnect through Spotify. Local favourites are saved immediately; a library sync failure never stops the audio or removes the local favourite.

## Device sync between Mac and iOS

On the Mac, open **Settings → Device sync** and enable **Sync with iPhone and iPad**. On iOS, scan the Mac’s QR code with Camera and confirm pairing in Cuda, or paste the Mac’s pairing link in **Settings → Device sync**. No command line, server account, iCloud container, or Spotify developer key is needed for Shelf sync.

Keep both devices on the same local network and leave Cuda open on the Mac. Bonjour finds the paired Mac again when its address changes. The connection uses TLS with the exact Mac certificate pinned by the pairing code; a random pairing key authenticates every request. The iOS pairing secret is stored in Keychain. Mac pairing settings are encrypted with the native Keychain key. Reset pairing on the Mac to invalidate old device keys.

- **Favourites:** additions and removals sync both ways, including changes made offline.
- **Playlists:** names, descriptions, songs, edits and deletions sync both ways. Existing Shelves merge on first pairing. Concurrent changes to the same playlist use the most recent revision; edits to separate playlists and favourites merge independently. Spotify selections and account credentials stay on each device.
- **Offline songs:** new imported and Cuda-downloaded audio copies automatically both ways. SHA-256 verifies transfers and prevents duplicate files. Files are streamed to temporary storage before verification and import, with a 512 MB per-song limit. Removing a favourite or playlist never deletes an audio file from the other device. Turning off offline-song sync keeps Shelf sync enabled.

iOS syncs on launch, Shelf changes, network reconnect and periodic checks while open. It also requests background processing; **iOS decides when those checks run**, so an app closed or suspended by the system cannot promise immediate detection. Unfinished transfers retry when reachable; previously downloaded songs play without a Mac connection. The Mac listener is off until enabled and exposes only authenticated Shelf sync and audio transfer, not account or desktop control endpoints.

## Public streaming: automatic setup

With **Cuda Native 1.0.6+** and **Cuda for iOS 1.1.1+**, Device sync pairing also connects YouTube, YouTube Music and SoundCloud. The Mac app starts its streaming companion automatically when Device sync is enabled. Scan the existing Device sync QR code or paste its link once. Existing pairings reconnect automatically after updating both apps; no extra address, key, or companion command is needed.

The phone fetches a separately scoped playback key through the certificate-pinned TLS connection and stores it in Keychain. It refreshes the connection after launch, network changes and before public playback/search, including when the Mac’s address or playback port changes. Reset pairing or disable Device sync on the Mac to revoke both connections. Playback access cannot call desktop account or Shelf mutation endpoints.

Keep Cuda open on an awake Mac on the same **trusted local network**. Shelf/offline sync and playback setup are encrypted with pinned TLS. Audio streaming uses a separate authenticated local HTTP connection for Apple media playback and HLS; it is not encrypted on the LAN. Its read-only playback key is different from the Shelf key and private desktop capability. Local audio and Spotify still play independently of this connection.

In iOS Settings, **YouTube & SoundCloud** shows the automatic connection. **Advanced companion setup** remains available for a standalone or older companion; manually connecting it is an explicit override. Choose **Use Device sync connection** to return to automatic setup.

### Standalone companion (advanced)

1. Install Cuda for Mac so the companion can reuse its bundled extraction tools, or install `yt-dlp`, FFmpeg, and FFprobe yourself. The standalone companion runs its own current resolver; use this only for an older Mac build or a custom setup.
2. In the project root, with Node 22 or later installed, run **`npm run ios:bridge`**.
3. The companion prints a LAN address and a random pairing key. Enter them in Cuda for iOS → Settings → Mac companion → **Pair Mac**. Both devices need to be on the same Wi-Fi. Allow incoming connections if macOS asks.
4. Search and play public sources on your phone. Keep the Mac awake while listening.

The companion binds port **38473** and requires the pairing key for every request and every media segment. It allows only search and playback endpoints; desktop mutation/download/account endpoints are blocked. Keys are generated on first run, stored outside the repository, and remain on your devices. Mobile caches are stored separately from your Mac Shelf. The app stores its pairing key in iOS Keychain. Never publish a pairing key or expose the companion port to the internet. HTTP is allowed in the app only for private network IPs and `.local` hosts; public companion URLs must use HTTPS. A trusted LAN is required because local HTTP is not encrypted. The bridge starts the companion resolver on an automatically assigned loopback port, avoiding conflicts with the desktop app.

## Build and verify

Requires Xcode 26 or later with the iOS SDK, XcodeGen, and access to the official Spotify Swift Package repository. The app runs on iOS 17 or later; iOS 26 uses Apple's native Liquid Glass for the mini player and new system navigation, with system-material fallback on older iOS:

```sh
brew install xcodegen
cd ios
xcodegen generate
xcodebuild -project Cuda.xcodeproj -scheme Cuda \
  -destination 'generic/platform=iOS' -configuration Release \
  -derivedDataPath build/device CODE_SIGNING_ALLOWED=NO build
```

The **iOS** GitHub workflow also runs model/URL validation tests and a Simulator UI test that decodes a bundled local audio fixture, opens the player and Shelf, and toggles a favourite. It captures actual iPhone and iPad Simulator screenshots in Light, Dark, and large Dynamic Type. Preview artwork and the short test tone are original illustrative Cuda Sessions fixtures, enabled only by `CUDA_DEMO=1` in Debug builds. Release builds start with an empty personal Shelf.

Live Spotify authorization and local-network streaming require physical devices and your own account/pairing setup. Simulator checks do not establish real-device battery, background behavior or Spotify account access.

Built by [veikkaheiskanen](https://github.com/veikkaheiskanen). Powered on [Riff by rootless](https://github.com/rootscripts/riff) and [Deck by jarilehtinen](https://github.com/jarilehtinen/deck).
