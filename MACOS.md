# Apple Silicon macOS port

This port builds Cuda as a native **arm64** application for Apple Silicon, including M5. It requires macOS 12 or newer. Electron, FFmpeg, FFprobe, and yt-dlp include native arm64 code; Rosetta and Homebrew are unnecessary for the packaged app.

## Install

Quit any previous Riff app before opening Cuda, since the renamed app shares its saved library. Open `cuda-41.0.7-mac-arm64.dmg` and drag **Cuda** to **Applications**, or extract the corresponding ZIP. Launch Cuda and use **Shelf** or **File → Import Audio…** (Command-O) to add local tracks.

Local builds use an ad-hoc signature. They are not notarized by Apple. A downloaded copy may need approval in **System Settings → Privacy & Security → Open Anyway**. A Developer ID signature and notarization are required for normal public distribution. Automatic updates are disabled in local builds.

## Build

Use native arm64 Node.js 22 or newer, Rust, and Apple’s Command Line Tools on an Apple Silicon Mac. The build prepares FFmpeg/yt-dlp, compiles the locked librespot player, and compiles the window material addon:

```sh
npm ci
npm test
npm run build:mac
```

`build:mac` creates `dist/mac-arm64/Cuda.app` and arm64 DMG/ZIP installers. A build hook automatically downloads and verifies the pinned audio tools and their source/license archives. The first build needs network access; subsequent builds reuse verified tools. Run `npm run prepare:mac` separately to prepare them in advance.

To validate the packaged application:

```sh
npm run test:mac
```

This launches a temporary, isolated app profile and verifies native AAC conversion, tool discovery with Finder's limited PATH, local playback and seeking, Mac window controls, mini player, and local update behavior. The generated media is a short test tone. Your music library and preferences are not used. The test requires a logged-in desktop session.

For the Liquid Glass-inspired interface and redesign validation, see [DESIGN.md](DESIGN.md). `npm run test:ui` runs the expanded interface and audio proxy checks.

## Mac behavior

- Native traffic lights, menu bar, Command shortcuts, fullscreen, and Dock reopening.
- Close hides the window while playback continues by default. Quit with Command-Q. The existing close-to-tray preference can instead close the window.
- MediaSession integrates playback metadata and controls with macOS. No global media-key capture or Accessibility permission is requested.
- Persistent library, downloaded tracks, lyrics, thumbnails, and tools live in `~/Library/Application Support/Riff`. Electron preferences use the same standard application directory.
- Tool discovery supports bundled tools, `RIFF_YTDLP` / `RIFF_FFMPEG` / `RIFF_FFPROBE` overrides, PATH, `/opt/homebrew/bin`, and `/usr/local/bin`.
- `RIFF_DATA_DIR` and `RIFF_USER_DATA_DIR` accept absolute paths for isolated development/testing.

## Signed releases

Provide a Developer ID Application certificate through `CSC_LINK` / `CSC_KEY_PASSWORD`, or the signing identity through `CSC_NAME`. For notarization provide `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`, or electron-builder's supported API-key/keychain credentials. Then run:

```sh
npm run build:mac:signed
```

This requires signing and enables the Mac updater. The updater uses the repository's configured GitHub release feed, so published Mac ZIP files and `latest-mac.yml` must exist there and use the same signing identity. Point `build.publish` at your own repository before distributing a fork with automatic updates.

The release workflow adds a native arm64 Mac job. With `MAC_CSC_LINK` and `MAC_CSC_KEY_PASSWORD` secrets it builds signed releases; Apple credential secrets enable notarization. Without a certificate it creates explicitly ad-hoc artifacts with updates disabled. The separate Apple Silicon workflow checks tests, builds, signatures, native architecture, and packaged playback without publishing releases.

Electron receives the JIT entitlement. The bundled yt-dlp executable receives a separate library-validation exception for its embedded Python runtime. Signed release/notarization and online service integrations require credentials or live accounts and are separate from the local smoke test.

## Bundled audio tools

Tools and downloads are pinned by SHA-256 in `macos-tools-manifest.json`:

- FFmpeg / FFprobe **9.0.1**, using [dfloresc's LGPL macOS build](https://github.com/dfloresc/ffmpeg-macos-builds/releases/tag/v9.0.1-1). Native arm64 shared libraries support MP3, AAC, Opus, FLAC, and other local media. FFmpeg networking is disabled; yt-dlp handles remote downloads.
- yt-dlp **2026.08.19**, using its [official universal macOS executable](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19) with an arm64 slice.

`Cuda.app/Contents/Resources/bin` retains the tool bundle's `bin`, `lib`, `LICENSES`, `sources`, `BUILDINFO.txt`, and `RIFF-THIRD-PARTY-NOTICES.txt`. Corresponding FFmpeg/codec sources and exact build scripts are included. The shared libraries can be replaced without rebuilding Riff. Retain these files when redistributing the application.

The Mac port preserves Riff's Electron/Web Audio interface and audio engine. It adds platform support, rather than rewriting the player in Swift or adding M5-specific audio processing.

References: [electron-builder macOS options](https://www.electron.build/v26/docs/mac/), [GitHub Mac runner architectures](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [PyInstaller macOS signing](https://pyinstaller.org/en/stable/feature-notes.html#macos-binary-code-signing).

If macOS repeatedly attaches Finder metadata to builds in a synced Documents folder, build outside it: `npm run build:mac -- -c.directories.output=/private/tmp/riff-macos-dist`. Only the generated app bundle is cleaned before signing.

If you previously ran upstream Riff on a Mac, its older files remain in `~/.cache/devsize`. Set `RIFF_DATA_DIR` to that absolute path to use them, or copy them into the new Application Support directory while Riff is closed.

## Appearance and window transparency

In Settings → Appearance, choose Light, Dark or System. System follows your Mac's appearance. Enable Window transparency for native desktop blur and adjust Window tint without fading text. Reduce transparency, or the matching macOS accessibility setting, restores solid surfaces. Settings are saved between launches. The controls follow Apple Liquid Glass guidance through Electron/CSS, with native macOS vibrancy for the window.


The native Spotify binary links only to system frameworks; the packaged app does not require Rust or Homebrew. Rust dependencies are locked, including Deck’s compatible vergen pin. Third-party notices ship beside the audio tools. The original Icon Composer document is in `assets/Cuda.icon`; `native/render-icon.swift` produces the compatible PNG used by Electron’s macOS icon packaging.

Window tint accepts 0–95%. This controls the tint over the native frosted window, not the blur strength. Reduced transparency and increased contrast keep the app opaque for readability.

The Cuda name preserves the existing Riff app identity and Application Support data folder so that libraries and saved preferences survive the rename.

Version 41.0.6 adds a native Spotify DSP output stage. SoundTouch is statically bundled; the native binary still needs only system libraries at runtime. Its corresponding source and LGPL license are in the bundled native notices and `native/vendor`. Rebuild the replaceable native helper with the locked Cargo manifest and the provided scripts.

The stream extractor uses the verified onedir yt-dlp distribution so Python is not unpacked on each request. Its standard framework symlinks are restored before Mac signing. Auto starts the original source immediately and hedges matching alternatives after 450 ms; cached local audio and connected native Spotify can start directly.
