<p align="center">
  <img src="docs/images/cuda-promo.png" alt="Cuda for Mac — a calm home for your music" width="100%">
</p>

# Cuda

**Your music. A little more calm.**

Cuda is a music player for Apple Silicon, built by [veikkaheiskanen](https://github.com/veikkaheiskanen). A clean, Liquid Glass-inspired interface brings Spotify, YouTube, YouTube Music, SoundCloud, and your own audio files into one place.

[Download for Mac](https://github.com/veikkaheiskanen/Cuda/releases/latest) · [Explore the app](#a-place-for-every-song) · [Build for Mac](#build-for-mac) · [Spotify setup](SPOTIFY.md) · [Report an issue](https://github.com/veikkaheiskanen/Cuda/issues)

## A place for every song

- **Home, made personal.** Recommendations, recently played music, and playlists are always close by. Connected Spotify playlists help shape what appears next.
- **Your Shelf.** Favourites and playlists live together in two easy-to-browse artwork rows. Create a mix, edit its name and description, and add songs without duplicates.
- **Listen your way.** Auto races matching sources and uses the first ready stream. Prefer a particular service? Choose it from the player's source menu.
- **A quieter player.** The compact bar keeps the song and essential controls in view. Open it for large artwork, seeking, shuffle, repeat, volume, and audio settings.
- **Sound with room to adjust.** Equalizer, presets, and sound controls work with local and public audio, plus Cuda's native Spotify player.
- **Comfortable on your Mac.** Light, dark, and system appearance; adjustable window transparency; native traffic lights; keyboard shortcuts; and an adaptive layout for narrow windows.

<p align="center">
  <img src="docs/images/cuda-shelf-light.png" alt="Cuda Shelf in light appearance with favourites and playlists" width="100%">
</p>

<table>
  <tr>
    <td width="68%"><img src="docs/images/cuda-player-dark.png" alt="Cuda's expanded player in dark appearance"></td>
    <td width="32%"><img src="docs/images/cuda-player-narrow.png" alt="Cuda's adaptive player in a narrow window"></td>
  </tr>
</table>

*Screenshots show the actual Mac app with an illustrative Cuda Sessions library and original demo artwork. The narrow layout is a resized desktop window.*

## Build for Mac

Cuda targets native **arm64**, including Apple M5. Use an Apple Silicon Mac running macOS 12 or later, Node.js 22+, Rust, and Apple's Command Line Tools.

```sh
git clone https://github.com/veikkaheiskanen/Cuda.git
cd Cuda
npm ci
npm test
npm run build:mac
```

The build prepares checksum-verified FFmpeg and yt-dlp tools, compiles the native Spotify player and window material module, and creates the app, DMG, and ZIP in `dist/`. No Homebrew audio tools or Rosetta are required.

Open the DMG and drag **Cuda** into **Applications**. Local builds are ad-hoc signed and are not Apple-notarized; downloaded copies may need **Open Anyway** in macOS Privacy & Security. See [MACOS.md](MACOS.md) for signed builds, distribution, and packaged-app checks.

## Connect Spotify

Open **Settings → Integrations**. Connect your library with a registered Spotify app Client ID, select the playlists you want to use for recommendations, then choose **Connect playback** for the native player. Spotify playback requires Premium. Your Cuda favourites remain saved locally even if Spotify library sync is unavailable.

Read [SPOTIFY.md](SPOTIFY.md) for setup, account requirements, radio, album browsing, and weekly picks. Service availability and streaming start times depend on the provider and network.

## Development

```sh
npm start                 # Run the desktop app
npm test                  # Regression tests
npm run test:mac           # Test a packaged Apple Silicon build
npm run test:ui            # Interface and audio proxy checks
```

The packaged checks use an isolated profile and generated audio fixtures. Source preparation and UI capture helpers are in `scripts/`; native playback lives in `native/spotify-player/`.

The glass treatment combines Electron's native macOS vibrancy with custom interface styling. It is inspired by Apple's design guidance; it does not use Apple's native Liquid Glass rendering framework.

## Powered on

- [**Riff by rootless**](https://github.com/rootscripts/riff) — the foundation of Cuda.
- [**Deck by jarilehtinen**](https://github.com/jarilehtinen/deck) — inspiration and credited source for Spotify features.

Cuda also uses Electron, librespot, FFmpeg, yt-dlp, HLS.js, and Tone.js. Native vendor code and redistributed tools retain their own license notices. See [LICENSE](LICENSE), [native/DECK-LICENSE](native/DECK-LICENSE), and the bundled third-party notices.

## Cuda for iOS

The native iPhone and iPad port lives in [ios/](ios/README.md). It supports local audio, Spotify through the official iOS SDK, and public streams through a paired Mac companion. The iOS workflow builds an unsigned IPA for signing and sideloading with your own Apple account. See the iOS guide for source requirements and features.
