# Cuda — iPhone and iPad

Mode: Operate. This surface extends the Mac app's quiet music-first identity using iOS conventions rather than copying its custom desktop window.

The system owns the screen's outer corners, safe areas, navigation and sheet presentation. Phone uses four native tabs: Home, Search, Shelf and Settings. Regular-width iPad uses a sidebar with the same destinations and an independent detail navigation stack. All layouts follow size class, including iPad multitasking. Landscape player lays out artwork and controls side by side when there is space.

Content uses semantic system backgrounds and primary/secondary labels. Glass is restricted to the compact player and native bars/sheets; its material respects system accessibility settings. One blue tint identifies controls. Typography uses San Francisco's Dynamic Type styles. Interactive icon targets are at least 44 points. Artwork stays square, with a 12-point continuous corner; the compact player's 20-point corner belongs to an independent floating control surface, not a second phone bezel.

Home has recent tracks, artist-based recommendations and playlists. Shelf has horizontally scrolling square artwork for favourites and playlists, followed by on-device files. Empty states explain how to get music into the app without inventing sample user data. Debug-only Simulator fixtures are explicitly illustrative.

Compact now playing contains song/artist and playback/skip controls; opening it presents a native medium/large sheet. The expanded sheet places artwork above metadata and transport on phone, side by side at wide widths. Seeking, source selection, queue, system volume and AirPlay stay available by scrolling in a short sheet or with large text. No controls are hidden under the notch, home indicator or keyboard. Playlists use native editing sheets, contextual actions and destructive confirmation.

Light, Dark and System are native color-scheme choices. The app honors Dynamic Type, Reduce Motion and system material accessibility automatically through SwiftUI. It intentionally has no iOS window-tint slider: iOS owns the window surface and its corners.

Verification uses actual iPhone/iPad Simulator screenshots in Light, Dark and accessibility Dynamic Type. Device tests remain necessary for real Spotify sign-in, LAN pairing, battery use and background playback.

Audio is available from Settings and the expanded player. A native Form groups the five-band EQ and presets separately from speed, app/device volume and sleep timer. Values use monospaced digits and sliders have named accessibility labels. EQ activates only after AVPlayer supplies supported PCM; unsupported formats and Spotify App Remote audio explain the limitation. The interface uses the incumbent semantic colors, Dynamic Type and native sheets.
