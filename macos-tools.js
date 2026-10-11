const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { execFile } = require('child_process');
const manifest = require('./macos-tools-manifest.json');

function get(url, redirects = 6) {
  return new Promise((resolve, reject) => {
    if (new URL(url).protocol !== 'https:') return reject(new Error('Tool downloads require HTTPS.'));
    const req = https.get(url, { headers: { 'User-Agent': 'Riff macOS tool installer' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (!redirects) return reject(new Error('Too many download redirects.'));
        return resolve(get(new URL(res.headers.location, url).toString(), redirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      resolve(res);
    });
    req.setTimeout(30000, () => req.destroy(new Error(`Download timed out: ${url}`)));
    req.on('error', reject);
  });
}

async function downloadVerified(url, dest, sha256, onProgress = () => {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${crypto.randomBytes(6).toString('hex')}.download`;
  const hash = crypto.createHash('sha256');
  try {
    const response = await get(url);
    const total = Number(response.headers['content-length']) || 0;
    let size = 0;
    const progress = new Transform({ transform(chunk, encoding, callback) {
      hash.update(chunk);
      size += chunk.length;
      if (total) onProgress(Math.min(100, Math.round(size / total * 100)));
      callback(null, chunk);
    } });
    await pipeline(response, progress, fs.createWriteStream(tmp, { flags: 'wx' }));
    if (hash.digest('hex') !== sha256) throw new Error(`Checksum mismatch for ${path.basename(dest)}`);
    fs.renameSync(tmp, dest);
    return dest;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function fileHash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${path.basename(file)} failed: ${stderr || error.message}`));
      else resolve(`${stdout}\n${stderr}`);
    });
  });
}

// Checking the Mach-O header before execution avoids silently relying on Rosetta.
function machoArchitectures(file) {
  const fd = fs.openSync(file, 'r');
  const header = Buffer.alloc(4096);
  let size;
  try { size = fs.readSync(fd, header, 0, header.length, 0); } finally { fs.closeSync(fd); }
  if (size < 8) return [];
  const cpuName = (cpu) => cpu === 0x0100000c ? 'arm64' : cpu === 0x01000007 ? 'x64' : null;
  const magic = header.readUInt32BE(0);
  if (magic === 0xcffaedfe) return [cpuName(header.readUInt32LE(4))].filter(Boolean);
  if (magic === 0xfeedfacf) return [cpuName(header.readUInt32BE(4))].filter(Boolean);
  const fat64 = magic === 0xcafebabf || magic === 0xbfbafeca;
  const fat32 = magic === 0xcafebabe || magic === 0xbebafeca;
  if (!fat32 && !fat64) return [];
  const little = magic === 0xbebafeca || magic === 0xbfbafeca;
  const read = (offset) => little ? header.readUInt32LE(offset) : header.readUInt32BE(offset);
  const count = read(4);
  const width = fat64 ? 32 : 20;
  if (count > 32 || 8 + count * width > size) return [];
  return Array.from({ length: count }, (_, i) => cpuName(read(8 + i * width))).filter(Boolean);
}

async function validateMacosTools(dest, arch, execute = true) {
  for (const name of ['ffmpeg', 'ffprobe', 'yt-dlp']) {
    const binary = path.join(dest, 'bin', name);
    fs.accessSync(binary, fs.constants.X_OK);
    if (!machoArchitectures(binary).includes(arch)) throw new Error(`${name} does not contain a native ${arch} executable.`);
  }
  for (const file of fs.readdirSync(path.join(dest, 'lib'))) {
    if (file.endsWith('.dylib') && !machoArchitectures(path.join(dest, 'lib', file)).includes(arch)) {
      throw new Error(`${file} does not contain a native ${arch} library.`);
    }
  }
  if (!execute) return;
  if (process.platform !== 'darwin' || process.arch !== arch) {
    throw new Error(`Native tool validation requires macOS ${arch}; current process is ${process.platform} ${process.arch}.`);
  }
  for (const name of ['ffmpeg', 'ffprobe']) {
    const out = await run(path.join(dest, 'bin', name), ['-version']);
    if (!out.includes(`${name} version ${manifest.ffmpegVersion}`)) throw new Error(`Unexpected ${name} version.`);
    if (/--enable-(?:nonfree|gpl)(?:\s|$)/.test(out)) throw new Error('The FFmpeg bundle must be an LGPL redistributable build.');
  }
  const license = await run(path.join(dest, 'bin', 'ffmpeg'), ['-L']);
  if (!license.includes('GNU Lesser General Public') || /not legally redistributable/.test(license)) {
    throw new Error('The FFmpeg bundle is not an LGPL redistributable build.');
  }
  const ytVersion = await run(path.join(dest, 'bin', 'yt-dlp'), ['--version']);
  if (ytVersion.trim() !== manifest.ytDlp.version) throw new Error('Unexpected yt-dlp version.');
}

function fingerprint() {
  return crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}

function listFiles(dir, prefix = '') {
  const out = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.join(prefix, entry.name);
    if (rel === '.riff-tools.json') continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(out, listFiles(file, rel));
    else if (entry.isSymbolicLink()) out[rel] = `symlink:${fs.readlinkSync(file)}`;
    else out[rel] = fileHash(file);
  }
  return out;
}

function alreadyPrepared(dest, arch) {
  try {
    const record = JSON.parse(fs.readFileSync(path.join(dest, '.riff-tools.json'), 'utf8'));
    return record.arch === arch && record.manifest === fingerprint() &&
      JSON.stringify(record.files) === JSON.stringify(listFiles(dest));
  } catch { return false; }
}

async function prepareMacosTools({ arch = process.arch, dest = path.join(__dirname, 'bin', `darwin-${arch}`),
  onProgress = () => {}, execute = true } = {}) {
  const bundle = manifest.bundles[arch];
  if (!bundle) throw new Error(`No macOS audio-tool bundle for ${arch}.`);
  if (!path.isAbsolute(dest)) throw new Error('The tool destination must be an absolute path.');
  if (alreadyPrepared(dest, arch)) {
    await validateMacosTools(dest, arch, execute);
    return dest;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const temp = fs.mkdtempSync(path.join(path.dirname(dest), '.riff-tools-'));
  try {
    onProgress('ffmpeg', 0);
    const archive = path.join(temp, bundle.name);
    await downloadVerified(`${manifest.ffmpegBase}/${bundle.name}`, archive, bundle.sha256, (p) => onProgress('ffmpeg', p));
    const extracted = path.join(temp, 'extracted');
    fs.mkdirSync(extracted);
    await run('/usr/bin/tar', ['-xf', archive, '-C', extracted]);
    const roots = fs.readdirSync(extracted);
    if (roots.length !== 1) throw new Error('Unexpected FFmpeg archive layout.');
    const stage = path.join(extracted, roots[0]);
    // Runtime headers and pkg-config files are unnecessary; corresponding source
    // archives and exact build scripts are retained for replacing/rebuilding libs.
    fs.rmSync(path.join(stage, 'include'), { recursive: true, force: true });
    fs.rmSync(path.join(stage, 'lib', 'pkgconfig'), { recursive: true, force: true });
    fs.rmSync(path.join(stage, 'share'), { recursive: true, force: true });
    const sources = path.join(stage, 'sources');
    fs.mkdirSync(sources);
    for (const source of manifest.sources) {
      onProgress('sources', 0);
      await downloadVerified(source.url || `${manifest.ffmpegBase}/${source.name}`, path.join(sources, source.name),
        source.sha256, (p) => onProgress('sources', p));
    }
    const ytDlp = path.join(stage, 'bin', 'yt-dlp');
    onProgress('yt-dlp', 0);
    if (manifest.ytDlp.archive) {
      // The onedir distribution avoids unpacking Python on every search/play.
      const archive = path.join(temp, 'yt-dlp_macos.zip');
      await downloadVerified(manifest.ytDlp.archive.url, archive, manifest.ytDlp.archive.sha256, p => onProgress('yt-dlp', p));
      await run('/usr/bin/unzip', ['-q', archive, '-d', path.join(stage, 'bin')]);
      fs.renameSync(path.join(stage, 'bin', 'yt-dlp_macos'), ytDlp);
      // ZIP's flattened framework copies must become standard framework links
      // before macOS can sign this embedded Python runtime consistently.
      const framework = path.join(stage, 'bin', '_internal', 'Python.framework');
      if (fs.existsSync(framework)) {
        const versions = path.join(framework, 'Versions');
        const releases = fs.readdirSync(versions).filter(name => /^\d+\.\d+$/.test(name));
        if (releases.length !== 1) throw new Error('Unexpected Python framework layout.');
        for (const [file, target] of [['Versions/Current', releases[0]], ['Python', 'Versions/Current/Python'], ['Resources', 'Versions/Current/Resources']]) {
          fs.rmSync(path.join(framework, file), { recursive: true, force: true });
          fs.symlinkSync(target, path.join(framework, file));
        }
      }
    } else {
      await downloadVerified(manifest.ytDlp.url, ytDlp, manifest.ytDlp.sha256, p => onProgress('yt-dlp', p));
    }
    fs.chmodSync(ytDlp, 0o755);
    for (const license of manifest.ytDlpLicenses) {
      await downloadVerified(license.url, path.join(stage, 'LICENSES', license.name), license.sha256);
    }
    fs.writeFileSync(path.join(stage, 'RIFF-THIRD-PARTY-NOTICES.txt'), [
      'Riff bundles FFmpeg and FFprobe 9.0.1, LGPL-2.1-or-later, and yt-dlp 2026.08.19.',
      'FFmpeg is run as a separate executable. Its shared libraries can be replaced in lib/.',
      'Corresponding FFmpeg and codec-library source archives and the exact build scripts are in sources/.',
      'The complete license notices and patent grants are in LICENSES/. See BUILDINFO.txt for build flags and provenance.',
      'FFmpeg build: https://github.com/dfloresc/ffmpeg-macos-builds/releases/tag/v9.0.1-1',
      'yt-dlp source: https://github.com/yt-dlp/yt-dlp/tree/2026.08.19',
      'yt-dlp and bundled dependencies retain the licenses listed in LICENSES/yt-dlp-THIRD_PARTY_LICENSES.txt.',
      'FFmpeg processes local media; its network protocols are disabled. yt-dlp handles network downloads.',
      ''
    ].join('\n'));
    await validateMacosTools(stage, arch, execute);
    fs.writeFileSync(path.join(stage, '.riff-tools.json'), JSON.stringify({ arch, manifest: fingerprint(), files: listFiles(stage) }, null, 2));
    // Only replace the existing installation after every download and validation
    // succeeds. Keeping the old directory allows rollback if the rename fails.
    const backup = path.join(temp, 'previous');
    const existed = fs.existsSync(dest);
    if (existed) fs.renameSync(dest, backup);
    try { fs.renameSync(stage, dest); }
    catch (error) { if (existed) fs.renameSync(backup, dest); throw error; }
    return dest;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

module.exports = { prepareMacosTools, validateMacosTools, machoArchitectures, downloadVerified, manifest };
