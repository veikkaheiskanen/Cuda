const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

module.exports = async (context) => {
  if (context.electronPlatformName !== 'darwin') return;
  const mac = context.packager.platformSpecificBuildOptions;
  const bundle = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const resources = path.join(bundle, 'Contents', 'Resources');
  fs.writeFileSync(path.join(resources, 'riff-build.json'), JSON.stringify({
    automaticUpdates: context.packager.config.forceCodeSigning === true && mac.identity !== '-' && mac.identity !== null,
    architecture: 'arm64'
  }, null, 2) + '\n');
  // Finder/iCloud metadata inherited by a freshly built bundle can prevent
  // codesign from signing it. Clear only this generated application bundle.
  execFileSync('/usr/bin/xattr', ['-cr', bundle]);
};
