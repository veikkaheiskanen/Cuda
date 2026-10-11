const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { IS_WIN, BIN_DIR, resolveBinary, clearBinaryCache } = require('./platform');

const state = { status: 'idle', tool: '', percent: 0, error: '' };
const STAMP = path.join(BIN_DIR, '.ytdlp-update-stamp');

function ytDlpAsset(platform = process.platform, a = process.arch) {
  if (platform === 'win32') return a === 'arm64' ? 'yt-dlp_arm64.exe' : a === 'ia32' ? 'yt-dlp_x86.exe' : 'yt-dlp.exe';
  if (platform === 'darwin') return 'yt-dlp_macos';
  return a === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
}

function ffmpegAsset(platform = process.platform, arch = process.arch) {
  const a = arch === 'arm64' ? 'arm64' : '64';
  if (platform === 'win32') return { name: `ffmpeg-master-latest-win${a}-gpl.zip` };
  if (platform === 'linux') return { name: `ffmpeg-master-latest-linux${a}-gpl.tar.xz` };
  if (platform === 'darwin') return require('./macos-tools-manifest.json').bundles[arch] || null;
  return null;
}

function get(url, redirects = 6) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Riff' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).toString(), redirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      resolve(res);
    }).on('error', reject);
  });
}

async function getText(url) {
  const res = await get(url);
  let out = '';
  res.setEncoding('utf8');
  for await (const chunk of res) out += chunk;
  return out;
}

async function downloadFile(url, dest) {
  const res = await get(url);
  const total = Number(res.headers['content-length']) || 0;
  let done = 0;
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    res.on('data', (c) => {
      hash.update(c);
      done += c.length;
      if (total) state.percent = Math.round((done / total) * 100);
    });
    res.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
    res.pipe(out);
  });
  return hash.digest('hex');
}

function expectedHash(sums, fileName) {
  for (const line of sums.split(/\r?\n/)) {
    const m = line.trim().match(/^([a-f0-9]{64})\s+\*?(?:\.\/)?(.+)$/i);
    if (m && m[2].trim() === fileName) return m[1].toLowerCase();
  }
  return null;
}

function run(cmd, args, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let err = '';
    const t = setTimeout(() => { p.kill(); reject(new Error(`${cmd} timed out`)); }, timeoutMs);
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); code === 0 ? resolve() : reject(new Error(err || `${cmd} exited with ${code}`)); });
  });
}

function findFile(dir, fileName) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(full, fileName);
      if (hit) return hit;
    } else if (entry.name === fileName) return full;
  }
  return null;
}

async function installYtDlp() {
  const asset = ytDlpAsset();
  const base = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';
  const sums = await getText(`${base}/SHA2-256SUMS`);
  const want = expectedHash(sums, asset);
  if (!want) throw new Error(`No checksum published for ${asset}`);
  const target = path.join(BIN_DIR, IS_WIN ? 'yt-dlp.exe' : 'yt-dlp');
  const tmp = `${target}.download`;
  const got = await downloadFile(`${base}/${asset}`, tmp);
  if (got !== want) { fs.rmSync(tmp, { force: true }); throw new Error('yt-dlp checksum mismatch'); }
  if (!IS_WIN) fs.chmodSync(tmp, 0o755);
  fs.renameSync(tmp, target);
}

async function installFfmpeg() {
  const asset = ffmpegAsset();
  if (!asset) throw new Error('No ffmpeg build for this system. Install ffmpeg with your package manager.');
  const base = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download';
  const sums = await getText(`${base}/checksums.sha256`);
  const want = expectedHash(sums, asset.name);
  if (!want) throw new Error(`No checksum published for ${asset.name}`);
  const archive = path.join(os.tmpdir(), `riff-${asset.name}`);
  const got = await downloadFile(`${base}/${asset.name}`, archive);
  if (got !== want) { fs.rmSync(archive, { force: true }); throw new Error('ffmpeg checksum mismatch'); }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'riff-ffmpeg-'));
  try {
    await run('tar', ['-xf', archive, '-C', work]);
    for (const name of ['ffmpeg', 'ffprobe']) {
      const exe = IS_WIN ? `${name}.exe` : name;
      const src = findFile(work, exe);
      if (!src) throw new Error(`${exe} not found inside the archive`);
      const dest = path.join(BIN_DIR, exe);
      fs.copyFileSync(src, dest);
      if (!IS_WIN) fs.chmodSync(dest, 0o755);
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
    fs.rmSync(archive, { force: true });
  }
}

function toolsStatus() {
  return {
    ytDlp: !!resolveBinary('yt-dlp'),
    ffmpeg: !!resolveBinary('ffmpeg'),
    ffprobe: !!resolveBinary('ffprobe'),
    progress: Object.assign({}, state)
  };
}

async function ensureTools() {
  if (state.status === 'downloading') return toolsStatus();
  fs.mkdirSync(BIN_DIR, { recursive: true });
  state.status = 'downloading';
  state.error = '';
  try {
    if (process.platform === 'darwin') {
      if (!resolveBinary('yt-dlp') || !resolveBinary('ffmpeg') || !resolveBinary('ffprobe')) {
        await require('./macos-tools').prepareMacosTools({
          arch: process.arch,
          dest: path.join(BIN_DIR, 'macos-tools'),
          onProgress(tool, percent) { state.tool = tool; state.percent = percent; }
        });
        clearBinaryCache();
      }
    } else {
      if (!resolveBinary('yt-dlp')) { state.tool = 'yt-dlp'; state.percent = 0; await installYtDlp(); clearBinaryCache(); }
      if (!resolveBinary('ffmpeg') || !resolveBinary('ffprobe')) { state.tool = 'ffmpeg'; state.percent = 0; await installFfmpeg(); clearBinaryCache(); }
    }
    state.status = 'done';
    state.percent = 100;
  } catch (e) {
    state.status = 'error';
    state.error = e.message;
  }
  return toolsStatus();
}

async function updateYtDlpIfManaged() {
  const bin = resolveBinary('yt-dlp');
  const managedDirs = [BIN_DIR, path.join(BIN_DIR, 'bin'), path.join(BIN_DIR, 'macos-tools', 'bin')];
  if (!bin || !managedDirs.includes(path.dirname(bin))) return false;
  try {
    const last = Number(fs.readFileSync(STAMP, 'utf8')) || 0;
    if (Date.now() - last < 24 * 3600 * 1000) return false;
  } catch (e) {}
  try {
    await run(bin, ['-U'], 120000);
    fs.writeFileSync(STAMP, String(Date.now()));
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { ensureTools, toolsStatus, updateYtDlpIfManaged, expectedHash, ytDlpAsset, ffmpegAsset };
