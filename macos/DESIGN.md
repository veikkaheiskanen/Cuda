# Cuda native macOS

Operate mode. Preserve Cuda’s Apple Music/Finder inspiration, macOS system accent color, SF typography, original icon and Home/Shelf terminology. Replace the Electron interface with real SwiftUI/AppKit, not a web view.

NavigationSplitView owns the sidebar, titlebar and window geometry. Native controls own focus, menus, keyboard behavior, selection and accessibility. Glass is Apple’s macOS 26 rendering material on the floating player and toolbars; content stays legible and quiet. Settings use native grouped forms. No custom corner mask, fake traffic lights, decorative gradients or opaque glass approximation.

Home shows recent songs, recommendations and playlists. Shelf groups favourites and playlists horizontally with square art, titles and descriptions. The bottom player is compact, with a source menu and native controls. The expanded player shows large art, transport, progress, source, volume and audio actions. An independent native mini-player window shares the same playback state.

System/Light/Dark, transparency and 0–100% glass tint persist. Accessibility settings are respected by system materials. Test desktop and narrow sizes in both themes with long text and empty/loaded states. Preserve imported audio/cache and Spotify playlist/account metadata. Spotify library authorization must be reconnected using native Keychain encryption; native Spotify playback credentials remain compatible.

Controls inherit the system accent color, including native prominent buttons, sliders and active playback actions. The player surface stays neutral: glass tint uses the system window background color at the saved 0–100% strength, dark in dark mode and light in light mode. Never fill the player surface with the accent color or override controls with fixed blue.
