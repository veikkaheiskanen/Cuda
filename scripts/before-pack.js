const { spawnSync } = require('child_process');
const path = require('path');
const { Arch } = require('builder-util');
const fs = require('fs');

module.exports = async (context) => {
  if (context.electronPlatformName !== 'darwin') return;
  const arch = Arch[context.arch];
  if (arch !== 'arm64') throw new Error('The macOS port currently targets native Apple Silicon arm64.');
  const result = spawnSync(process.execPath, [path.join(__dirname, 'prepare-macos-tools.js'), '--arch', arch], {
    cwd: context.packager.projectDir,
    stdio: 'inherit',
    env: process.env
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Preparing native macOS audio tools failed.');
  const native = spawnSync(process.execPath,[path.join(__dirname,'build-native.js')],{cwd:context.packager.projectDir,stdio:'inherit',env:process.env});
  if (native.error) throw native.error;
  if (native.status !== 0) throw new Error('Building native Spotify playback and window material failed.');
};
