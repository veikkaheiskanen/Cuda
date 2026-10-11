const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function platformFixture({ platform = 'darwin', arch = 'arm64', env = {}, resourcesPath = '/Application/Riff.app/Contents/Resources' } = {}) {
  const executables = new Set();
  const module = { exports: {} };
  const fakeFs = {
    constants: { X_OK: 1 },
    accessSync(file) { if (!executables.has(file)) throw new Error('Not executable'); },
    statSync() { return { isFile: () => true }; }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'platform.js'), 'utf8'), {
    module, exports: module.exports, __dirname: '/source',
    process: { platform, arch, env, resourcesPath, versions: {node: '24.15.0'}, execPath: '/Application/Cuda.app/Contents/MacOS/Cuda' },
    require(name) { return name === 'fs' ? fakeFs : name === 'os' ? { homedir: () => '/Users/listener' } : require(name); }
  });
  return { api: module.exports, executables, env };
}

test('macOS keeps persistent data in Application Support and supports isolated absolute paths', () => {
  const { api } = platformFixture();
  assert.equal(api.DATA_DIR, '/Users/listener/Library/Application Support/Riff');
  assert.equal(api.CACHE_DIR, path.join(api.DATA_DIR, 'tracks'));
  assert.equal(api.dataDirectory('darwin', { RIFF_DATA_DIR: '/scratch/riff' }, '/Users/listener'), '/scratch/riff');
  assert.throws(() => api.dataDirectory('darwin', { RIFF_DATA_DIR: 'relative' }), /absolute path/);
  assert.equal(api.dataDirectory('linux', {}, '/Users/listener'), '/Users/listener/.cache/devsize');
  assert.equal(api.dataDirectory('win32', { LOCALAPPDATA: '/Local' }), '/Local/Riff');
});

test('Finder locates Homebrew binaries without a configured PATH', () => {
  const { api, executables } = platformFixture({ env: { PATH: '/usr/bin:/bin' } });
  executables.add('/opt/homebrew/bin/ffmpeg');
  executables.add('/usr/local/bin/ffprobe');
  assert.equal(api.findInPath('ffmpeg'), '/opt/homebrew/bin/ffmpeg');
  assert.equal(api.findInPath('ffprobe'), '/usr/local/bin/ffprobe');
  assert.equal(api.findInPath('ffmpeg', {}, 'linux'), null);
});

test('explicit, managed, packaged, source and PATH binaries follow priority', () => {
  const { api, executables, env } = platformFixture({ env: { RIFF_FFMPEG: '/custom/ffmpeg', PATH: '/shell' } });
  const choices = [
    '/custom/ffmpeg', path.join(api.BIN_DIR, 'ffmpeg'),
    '/Application/Riff.app/Contents/Resources/bin/bin/ffmpeg',
    '/source/bin/darwin-arm64/bin/ffmpeg', '/shell/ffmpeg', '/opt/homebrew/bin/ffmpeg'
  ];
  choices.forEach((file) => executables.add(file));
  for (const choice of choices) {
    api.clearBinaryCache();
    assert.equal(api.resolveBinary('ffmpeg'), choice);
    executables.delete(choice);
  }
  delete env.RIFF_FFMPEG;
  api.clearBinaryCache();
  assert.equal(api.resolveBinary('ffmpeg'), null);
});

test('downloaded macOS shared tool layout is discovered', () => {
  const { api, executables } = platformFixture();
  const binary = path.join(api.BIN_DIR, 'macos-tools', 'bin', 'ffprobe');
  executables.add(binary);
  assert.equal(api.resolveBinary('ffprobe'), binary);
});

test('yt-dlp uses the selected FFmpeg even when PATH has another copy', () => {
  const { api, executables } = platformFixture({ env: { RIFF_FFMPEG: '/chosen/ffmpeg', RIFF_YTDLP: '/chosen/yt-dlp', PATH: '/shell' } });
  ['/chosen/ffmpeg', '/chosen/yt-dlp', '/shell/ffmpeg'].forEach((file) => executables.add(file));
  const command = api.ytDlpCommand(['--extract-audio', 'https://example.test/track']);
  assert.equal(command.bin, '/chosen/yt-dlp');
  assert.equal(command.env.ELECTRON_RUN_AS_NODE, '1');
  assert.deepEqual(Array.from(command.args), ['--ignore-config','--socket-timeout','10','--retries','1','--ffmpeg-location', '/chosen/ffmpeg','--js-runtimes','node:/Application/Cuda.app/Contents/MacOS/Cuda', '--extract-audio', 'https://example.test/track']);
});

test('Windows PATH resolves executable extensions without macOS fallbacks', () => {
  const { api, executables } = platformFixture({ platform: 'win32', env: { Path: 'C:\\Tools;C:\\Other' } });
  executables.add(path.join('C:\\Other', 'ffmpeg.exe'));
  executables.add('/opt/homebrew/bin/ffprobe');
  assert.equal(api.findInPath('ffmpeg'), path.join('C:\\Other', 'ffmpeg.exe'));
  assert.equal(api.findInPath('ffprobe'), null);
});

test('missing binary cache is invalidated after installing tools', () => {
  const { api, executables } = platformFixture();
  assert.equal(api.resolveBinary('ffmpeg'), null);
  executables.add(path.join(api.BIN_DIR, 'ffmpeg'));
  assert.equal(api.resolveBinary('ffmpeg'), null);
  api.clearBinaryCache();
  assert.equal(api.resolveBinary('ffmpeg'), path.join(api.BIN_DIR, 'ffmpeg'));
});
