# Spotify in Cuda

## Connect

1. Use a Spotify Premium account and create an app at https://developer.spotify.com/dashboard.
2. Add `http://127.0.0.1:8898/callback` as a Redirect URI. Select Web API for catalog/library access. Cuda uses a separate native playback sign-in.
3. In Cuda, open Settings → Integrations. Paste the app’s Client ID and choose Connect Spotify. No client secret is needed.
4. Complete sign-in in your browser. If the app is in development mode, ensure your Spotify account is permitted under Users and Access.
5. Choose **Connect playback** and finish the separate streaming sign-in in your browser. This follows Deck’s native player authentication: the playback token must belong to its supported session identity. The earlier version incorrectly reused the custom library app’s token, causing `INVALID_CREDENTIALS` when loading audio. The library sign-in and selected playlists are preserved.
6. Choose the playlists that should shape recommendations. Cuda fetches their items, stores music metadata locally, and adds them to its taste model. It refreshes the selected playlists on launch, after connection, or when Sync playlists is chosen. Changing selection replaces the imported taste data.

Spotify currently restricts development-mode playlist contents to playlists the account owns or collaborates on. Other playlists appear disabled in the picker. Playback requires Premium. Each development app’s owner must maintain Premium, with Spotify’s current development user limits applying.

## Listening and library

Search displays each provider’s ready results immediately, adds remaining sources as they finish, shares concurrent queries and caches repeated queries for one minute. It chooses among connected Spotify and the other music sources, preserving separate remixes/live recordings and retaining alternatives when matching metadata permits. Cached audio takes priority. Spotify catalog searches use the current 10-result limit. A failed stream refreshes once, then Auto can try a matching alternative without returning to a failed source. The dropdown on the now-playing bar can pin a provider; switching preserves pause and position, and the label names the actual source. Spotify participates in automatic selection after playback is connected.

Spotify’s album shelf appears in Discover after connection. Search for artists or albums, save albums to the shelf, play them, or queue all their tracks immediately after the current track. The shelf sorts by artist. The Favorite heart also adds/removes Spotify Liked Songs through the current URI-based library endpoint.

Enter a genre to start radio. The native engine obtains a station from a Spotify seed and fetches more tracks when the queue reaches its end. Playback supports play/pause, seek, volume, previous/next, early next-track preloading, and reconnection after a stale session. The native player streams Vorbis at 320 kbps via macOS CoreAudio. Spotify audio is not sent to yt-dlp, downloaded, or substituted while presented as Spotify. Spotify’s native output now processes the same sound controls: three-band EQ, gain, echo, reverb, distortion, HQ tonal controls/compression, pitch-preserving Speed and coupled Speed (pitch)/Pitch. Volume and mute apply after effects so tails are silenced immediately. SoundTouch is statically bundled for tempo/rate processing; its license and unmodified source ship with the native tools and source archive. The native reverb uses a separate DSP implementation from the web player.

The last Spotify track and position are restored paused on launch. Press Play or Space to continue. macOS media keys and Control Center use Chromium’s MediaSession with a silent audio session while the native engine owns audible playback.

## Weekly picks

Weekly picks generate up to 20 catalog albums from your selected playlist artists, liked tracks, and shelf. Each album explains its connection to your taste. Results are cached by Monday-based week. Shelf albums, already selected-playlist albums, dismissed albums, prior weekly suggestions, and albums with three or more recorded local plays are excluded. Save or dismiss a pick to shape future selections.

Optional Last.fm username/API-key setup adds your most-played artists and excludes albums recorded at least three times there. A free API key can be created at https://www.last.fm/api/account/create. This integration reads listening history; it does not scrobble or modify your Last.fm account.

This adapts Deck’s album-oriented features. Weekly picks are generated locally from Spotify/Last.fm metadata, without requiring Claude Code or an AI subscription. They do not reproduce Deck’s external Claude curation service or its long-form editorial reasons.

## Account handling

OAuth uses PKCE, a random state parameter, a loopback callback, and bounded network requests. Refresh tokens are encrypted with Electron safeStorage (macOS Keychain) and never exposed through renderer storage or the local music server. Librespot’s reusable native credentials are restricted to a 0700 directory and 0600 file. Disconnect stops playback and removes account credentials and imported Spotify library data. Client ID and catalog metadata are not secrets.

Rate limits and missing permissions are reported in Settings. A failing source can fall back to a matching alternative; the visible source changes with playback. Some recordings cannot be matched across services, and a connected account does not guarantee every catalog recording is available in its market.

## References and verification

- Deck: https://github.com/jarilehtinen/deck (MIT; design and librespot reconnection approach credited in `native/DECK-LICENSE`).
- Spotify PKCE: https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow
- Redirect URI rules: https://developer.spotify.com/documentation/web-api/concepts/redirect_uri
- 2026 API changes: https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide
- Playlist items: https://developer.spotify.com/documentation/web-api/reference/get-playlists-items

Automated tests cover callback state verification, PKCE, encrypted token storage, playlist pagination/selection, current likes endpoints, weekly caching/dismissal, request limits, source ranking/recording separation, UI setup/playlist controls, native engine startup, and standard audio playback. Live tests verify decoded nonzero audio from YouTube, YouTube Music, SoundCloud and local files, including pause/resume and seek. A live legacy Spotify session reproduced `INVALID_CREDENTIALS`; the replacement native streaming sign-in passed live cached-session audio playback after Connect playback was completed. The installed app also played a saved Spotify track, advanced its position, showed the correct provider, and paused correctly. Protected SoundCloud recordings are reported clearly and cannot be decoded by this player.
