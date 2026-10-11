const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

function loadTools(available, installer) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'riff-tools-test-'));
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'tools.js'), 'utf8'), {
    module, exports: module.exports, process: { platform: 'darwin', arch: 'arm64' }, setTimeout, clearTimeout,
    require(name) {
      if (name === './platform') return { IS_WIN: false, BIN_DIR: temp, resolveBinary: (n) => available.has(n) ? `/tools/${n}` : null, clearBinaryCache() {} };
      if (name === './macos-tools') return { prepareMacosTools: installer };
      if (name.startsWith('./')) return require(path.join(__dirname, '..', name));
      return require(name);
    }
  });
  return { api: module.exports, temp };
}

test('macOS tool installation repairs missing ffprobe as well as FFmpeg', async (t) => {
  const available = new Set(['yt-dlp', 'ffmpeg']);
  let call;
  const { api, temp } = loadTools(available, async (args) => { call = args; args.onProgress('ffprobe', 40); available.add('ffprobe'); });
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  assert.equal(api.toolsStatus().ffprobe, false);
  const status = await api.ensureTools();
  assert.equal(call.arch, 'arm64');
  assert.equal(call.dest, path.join(temp, 'macos-tools'));
  assert.equal(status.ffprobe, true);
  assert.equal(status.progress.status, 'done');
  assert.equal(status.progress.percent, 100);
});

test('complete bundled tools require no download', async (t) => {
  const { api, temp } = loadTools(new Set(['yt-dlp', 'ffmpeg', 'ffprobe']), async () => { throw new Error('Should not download'); });
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  assert.equal((await api.ensureTools()).progress.status, 'done');
});

test('installation failures expose an actionable status', async (t) => {
  const { api, temp } = loadTools(new Set(), async () => { throw new Error('Checksum mismatch'); });
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const status = await api.ensureTools();
  assert.equal(status.progress.status, 'error');
  assert.equal(status.progress.error, 'Checksum mismatch');
});

test('asset selection and checksum parsing cover macOS arm64 and existing platforms', (t) => {
  const { api, temp } = loadTools(new Set(), async () => {});
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  assert.equal(api.ytDlpAsset('darwin', 'arm64'), 'yt-dlp_macos');
  assert.equal(api.ffmpegAsset('darwin', 'arm64').name, 'ffmpeg-9.0.1-1-lgpl-macos-arm64.tar.xz');
  assert.equal(api.ytDlpAsset('win32', 'arm64'), 'yt-dlp_arm64.exe');
  assert.equal(api.ffmpegAsset('linux', 'arm64').name, 'ffmpeg-master-latest-linuxarm64-gpl.tar.xz');
  assert.equal(api.ffmpegAsset('darwin', 'ia32'), null);
  const hash = 'a'.repeat(64);
  assert.equal(api.expectedHash(`${hash}  *./yt-dlp_macos\n`, 'yt-dlp_macos'), hash);
  assert.equal(api.expectedHash(`${hash}  another-file`, 'yt-dlp_macos'), null);
});
