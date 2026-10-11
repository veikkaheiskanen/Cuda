# Cuda — Liquid Glass redesign

Cuda uses an inset sidebar and grouped capsule controls inspired by macOS Music and Finder. The broad content area stays simple and readable; a floating playback capsule sits over the content column. Light uses cool neutral tones and blue accents, Dark uses warm charcoal and clear white text, and System follows macOS live. Narrow windows retain an adaptive bottom navigation layout.

The Mac window uses Electron's native `under-window` vibrancy to blur the desktop behind it. Appearance offers a transparency switch and 0–95% tint strength; text remains fully opaque. Preferences are persisted in `appearance.json` in the app's user-data directory and applied before creating the window. Reduced transparency or increased contrast disables native vibrancy and makes surfaces opaque.

The controls are a custom Electron/CSS interpretation of Apple's guidance, not Apple's native Liquid Glass rendering framework. Native Mac menus and traffic lights remain in place.

## Design references

- [Apple: Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/liquid-glass) — a distinct navigation/control layer above content.
- [Apple: Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass) — grouped toolbar actions, light/dark contrast, arbitrary window sizes, and accessibility preferences.

- [Apple Human Interface Guidelines: Materials](https://developer.apple.com/design/human-interface-guidelines/materials) — glass is limited to navigation and controls; content stays distinct and legible.
- [Apple Human Interface Guidelines: Layout](https://developer.apple.com/design/human-interface-guidelines/layout) — spacing and grouping simplify the hierarchy.
- [Apple Human Interface Guidelines: Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) — keyboard focus, readable contrast and reduced motion/transparency.
- [WWDC25: Get to know the new design system](https://developer.apple.com/videos/play/wwdc2025/356/) — typography, control geometry and visual hierarchy.

## Accessibility

Appearance offers Reduce transparency and Reduce motion plus interface/text scaling. CSS media queries and live preference listeners respect reduced motion, reduced transparency and increased contrast where Chromium reports them. Text opacity stays at 100%; both palettes remain stable as tracks change. Icon controls have spoken labels, navigation exposes the current page, the seek bar supports arrow/Home/End keys, and dialogs receive keyboard focus, trap Tab and restore focus when closed.

Existing music collections remain available. An earlier one-time migration clears old decorative effects; explicit Light/Dark/System and native transparency preferences are now saved separately. unsupported/corrupt saved data falls back to safe defaults, retaining valid collection items.

## Bugs corrected in this redesign

- Malformed saved favorites/history/playlists/presets/effects and invalid scale values could stop or disrupt startup.
- Track, playlist, preset and notification text could be interpreted as HTML. Text/attributes are escaped and image URLs are validated.
- Concurrent searches could display older results; clearing search and the All chip now invalidate pending searches and restore Discover.
- Virtualized track rows could use their visible position instead of their actual queue index.
- Keyboard actions on nested row buttons could also start playback, and global shortcuts intercepted native button activation.
- A narrow full-height window was incorrectly treated as the mini player.
- Audio imports used filenames and lengths for identity, causing different equal-size files with the same name to collide. Content hashes now determine identity.
- A hidden lyrics pane occupied layout space. Sidebar controls clipped on shorter desktop windows; provider names disappeared at narrow widths.
- The seek canvas assumed a 40px height, drawing outside the redesigned bar. It now follows its measured height and exposes accessible position text.
- Media-command filtering could drop pause immediately after play.
- Electron browser security was disabled. It is enabled; AAC and HLS audio use the local proxy, with redirects, CORS, segment-base preservation and request cleanup.
- Discord listening activity was enabled for a new profile. It now starts disabled unless the saved preference explicitly enables it.

## Validation

Run `npm test` for Node regression checks. Build with `npm run build:mac`. On a logged-in Apple Silicon Mac, run `npm run test:ui` after building, or:

```sh
RIFF_GLASS_QA=1 node scripts/smoke-macos.js /absolute/path/to/Riff.app
```

The UI suite uses an isolated profile and silent audio fixtures. It covers corrupted saved preferences, inert hostile metadata, reverse-order searches, the All chip, Light/Dark/System, saved appearance after reload, native transparency and tint controls, appearance accessibility toggles, desktop/narrow layouts, keyboard dialogs and long virtualized queues. It also exercises real AAC and HLS playback from a local test origin that deliberately disallows direct browser access, through the packaged application's audio proxy. The standard smoke test covers tool execution, native local playback, seeking, Mac controls, mini-player transitions and disabled automatic updates for local builds.

No finite audit establishes that all bugs are gone. Online provider availability, account-specific access and signed/notarized distribution remain separate from these deterministic tests. The local installer is ad-hoc signed and not notarized.


The Home page uses a quiet content layer with left-aligned recent songs, a horizontally scrollable artwork shelf of recommendations, and playlists. History tiles deduplicate track identities without changing stored history. Recommendations are single-click, keyboard-accessible buttons; the older coverflow, wheel capture, duplicated focused-song text, and animated ambient layer have been removed. Refresh handles loading, empty, and unavailable states, and older requests cannot replace a newer result. The Home “View all” action opens listening history.

Glass is limited to the sidebar, search, floating player, and expanded player. Text uses readable 12–14-point supporting and body sizes. Standalone surfaces retain a shared 24-point corner; window-inset navigation and players derive their radius from the outer corner minus their physical inset. Circular transport controls remain circular. The narrow navigation has six equal hit areas, the compact player has transport controls and track metadata, and the half-height player centers larger artwork above the shared controls. The root and native frame share the same corner mask, including interface scaling and fullscreen.

Impeccable refinement (41.0.3): removed redundant headings and heavy content borders, tightened header/body spacing, increased supporting text sizes, and replaced empty artwork URLs with a real fallback asset. The detector's index.html clipping warning is scoped out because clipping is required for the native window mask; no detector rules or whole files are disabled. Legacy hidden effects are overridden by the quiet Liquid Glass theme.

41.0.4 corner repair: the frameless Mac window retains native traffic lights and resizing. The native backing window is nonopaque with a clear background so AppKit does not paint a second bezel or an exposed wedge outside the shared 24-point curve. Appearance changes reapply the live native masks after vibrancy/background updates. Packaged QA inspects actual frame/content radii, mask dimensions and window background after transparency and accessibility toggles. Settings credits read “built by veikka heiskanen”; About credits Riff by rootless and Deck by jarilehtinen with project links.

41.0.5 macOS layout repair: frame-adjacent surfaces use a 12-point physical inset and a derived inner radius (24 minus 12), so the bottom and side curves share a center at every interface zoom. The desktop sidebar starts below a dedicated 64-point minimum window-control header; native traffic lights are positioned at 24,24 and reapplied when showing, resizing, or restoring the window. Narrow navigation has a 12-point bottom gap, eight-point selection corners and separate count badges. Small album covers use eight-point corners rather than turning into circles. Panel shadows are removed in favor of the existing restrained glass stroke. The expanded player preserves its shared controls and narrow half-height behavior. The narrow header title is centered independently of the native-control reserve and remains a Home button.
