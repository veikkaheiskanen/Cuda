const fs = require('fs');
const os = require('os');
const path = require('path');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

function dataDirectory(platform = process.platform, env = process.env, home = os.homedir()) {
  if (env.RIFF_DATA_DIR) {
    if (!path.isAbsolute(env.RIFF_DATA_DIR)) throw new Error('RIFF_DATA_DIR must be an absolute path.');
    return env.RIFF_DATA_DIR;
  }
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Riff');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Riff');
  return path.join(home, '.cache', 'devsize');
}

const DATA_DIR = dataDirectory();

const CACHE_DIR = path.join(DATA_DIR, 'tracks');
const CUSTOM_LYRICS_DIR = path.join(DATA_DIR, 'custom-lyrics');
const LYRICS_DIR = path.join(DATA_DIR, 'lyrics');
const THUMBNAILS_DIR = path.join(DATA_DIR, 'thumbnails');
const METADATA_PATH = path.join(DATA_DIR, 'metadata.json');
const LIBRARY_DIR = path.join(DATA_DIR, 'library');
const LIBRARY_PATH = path.join(DATA_DIR, 'library.json');
const BIN_DIR = path.join(DATA_DIR, 'bin');

function isExecutableFile(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch (e) {
    return false;
  }
}

function findInPath(name, env = process.env, platform = process.platform) {
  const win = platform === 'win32';
  const dirs = (env.PATH || env.Path || '').split(win ? ';' : ':').filter(Boolean);
  // Finder does not inherit interactive shell setup or Homebrew's shellenv.
  if (platform === 'darwin') dirs.push('/opt/homebrew/bin', '/usr/local/bin');
  const exts = win ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of new Set(dirs)) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}

const binaryCache = {};

function resolveBinary(name) {
  if (name in binaryCache) return binaryCache[name];
  const exe = IS_WIN ? `${name}.exe` : name;
  const envKey = `RIFF_${name.replace(/[^a-z0-9]/gi, '').toUpperCase()}`;
  const candidates = [
    process.env[envKey],
    path.join(BIN_DIR, exe),
    path.join(BIN_DIR, 'bin', exe),
    path.join(BIN_DIR, 'macos-tools', 'bin', exe),
    process.resourcesPath && path.join(process.resourcesPath, 'bin', 'bin', exe),
    process.resourcesPath && path.join(process.resourcesPath, 'bin', exe),
    path.join(__dirname, 'bin', `${process.platform}-${process.arch}`, 'bin', exe),
    path.join(__dirname, 'bin', `${process.platform}-${process.arch}`, exe),
    path.join(__dirname, 'bin', exe)
  ].filter(Boolean);
  let found = candidates.find(isExecutableFile) || findInPath(name);
  if (!found && !IS_WIN) {
    const local = path.join(os.homedir(), '.local', 'bin', exe);
    if (isExecutableFile(local)) found = local;
  }
  binaryCache[name] = found || null;
  return binaryCache[name];
}

function ytDlpCommand(args) {
  const bin = resolveBinary('yt-dlp');
  if (!bin) {
    throw new Error('yt-dlp not found. Install the audio tools in Settings, put them into the app bin folder, or add them to PATH.');
  }
  const ffmpeg = resolveBinary('ffmpeg');
  // Always pass the resolved path: a different PATH entry must not override a
  // bundled binary or an explicit RIFF_FFMPEG choice.
  const extra = ['--ignore-config', '--socket-timeout', '10', '--retries', '1'];
  if (ffmpeg) extra.push('--ffmpeg-location', ffmpeg);
  // Electron already bundles a supported Node runtime. Finder's PATH usually
  // has no Node/Deno, and yt-dlp cannot solve current YouTube challenges without it.
  if (Number(process.versions.node.split('.')[0]) >= 22) extra.push('--js-runtimes', `node:${process.execPath}`);
  return { bin, args: extra.concat(args), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } };
}

function clearBinaryCache() {
  Object.keys(binaryCache).forEach((k) => delete binaryCache[k]);
}

module.exports = {
  clearBinaryCache,
  IS_WIN, IS_MAC, DATA_DIR, BIN_DIR, CACHE_DIR, CUSTOM_LYRICS_DIR, LYRICS_DIR, THUMBNAILS_DIR, METADATA_PATH,
  LIBRARY_DIR, LIBRARY_PATH,
  dataDirectory, findInPath, resolveBinary, ytDlpCommand
};
