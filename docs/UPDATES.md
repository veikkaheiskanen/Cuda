# GitHub updates

Cuda for Mac uses Sparkle 2.10.0 to check GitHub for signed native Apple Silicon releases. Settings → Updates controls automatic checks and downloads; Check for Updates is also in the Cuda menu. A downloaded update installs on quit, preserving the music profile and pairing. Install 1.0.9 manually once to receive future updates; older releases did not contain this updater.

The updater verifies both the appcast and archive with the Ed25519 public key embedded in Cuda. Release tags `mac-native-v<version>` build and verify the native app, then publish its versioned zip, signed appcast and checksums. The signing key lives in the repository's encrypted `CUDA_SPARKLE_PRIVATE_KEY` Actions secret. It is available only to the tag publishing job. Keep Mac marked as the latest GitHub release because the stable feed URL uses `/releases/latest/download/appcast.xml`. Publish iOS with `--latest=false`. Never replace an archive without signing and uploading its matching appcast.

On iOS, automatic checks find stable `ios-v` releases and offer the corresponding unsigned IPA. Sideloadly must still sign and install the download; iOS cannot let Cuda replace its own binary. Checks run when Cuda becomes active, at most once every six hours. Settings → Updates can check immediately or turn checks off. Mac, Electron and prerelease artifacts are ignored.
