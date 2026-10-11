const path = require('path');
const { signAsync } = require('@electron/osx-sign');

module.exports = async (options) => {
  const optionsForFile = options.optionsForFile;
  return signAsync({
    ...options,
    optionsForFile(file) {
      const defaults = optionsForFile(file);
      // yt-dlp's one-file Python runtime extracts its embedded libraries to a
      // temporary directory. They do not share the application's signing team.
      if (file.endsWith('/bin/yt-dlp')) {
        return { ...defaults, entitlements: path.join(__dirname, '..', 'build', 'entitlements.tools.plist') };
      }
      return defaults;
    }
  });
};
