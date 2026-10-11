# Native artwork and window regression checks

Verified for Cuda Native 1.0.1 on macOS 26 with an isolated profile, separate QA bundle identifiers, and the shipped SwiftUI views. Production library/account data was not used.

## Artwork

In a debug bundle, resize demo-1.png to 512 × 128 and demo-2.png to 128 × 512 before signing. Keep the source artwork in the repository unchanged. Launch with CUDA_NATIVE_DEMO=1, CUDA_NATIVE_CAPTURE=1, and CUDA_NATIVE_PAGE=shelf.

Check the two favourites, playlist covers, history rows, compact player, and expanded artwork. Both landscape and portrait artwork must remain inside the caller's square frame; titles and neighbouring cards must not move or overlap. Check a live search (Daft Punk was used) to cover AsyncImage-loaded YouTube and YouTube Music thumbnails as well as bundled NSImage artwork. Missing artwork must occupy the same square.

## Search and window size

Check empty Search and loaded results at 1120 × 780 and approximately 647 × 562. The Search heading must start below the toolbar, the empty state must fill the remaining detail area, and the player must stay at the window bottom. Results should scroll behind the floating player without image overflow. Clearing the query must restore the full-height empty state. Shelf rows must scroll horizontally and the page must scroll vertically at the narrow size.

## Appearance

In Settings, switch transparency off and on in light and dark appearance. The form and heading must share one background; no opaque form rectangle or partial-height material band may remain. The toggle must change the window immediately and persist. With transparency enabled, DEBUG capture's native-ready.json reports opaque=false. The native mini and standalone Settings windows use the same preference. Reduce Transparency forces an opaque system background.

The initial scan found the intrinsic-image clipping issue and short detail pane. The confirmation round passed square bundled fixtures, live remote search thumbnails, empty/loaded Search, narrow Shelf, and light/dark transparency toggles. Audio and account code was unchanged by this patch.

## System accent follow-up (1.0.2)

The fixed blue root tint was removed. Verified against the Mac’s green system accent: Audio sliders, native selection, play/pause and volume all use green. The player glass surface uses the neutral system window color, including at 50% tint. Native inactive-window styling remains managed by macOS. Artwork colors remain the original artwork. No system preference was changed for this check.
