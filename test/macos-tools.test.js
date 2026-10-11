const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { execFileSync } = require('node:child_process');

const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
function macho(arch = 'arm64') {
  const buf = Buffer.alloc(32);
  buf.writeUInt32LE(0xfeedfacf, 0);
  buf.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4);
  return buf;
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'riff-macos-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function loadMacTools(responses, customManifest) {
  const requests = [];
  const module = { exports: {} };
  const https = { get(url, options, callback) {
    requests.push(url);
    const req = new EventEmitter();
    req.setTimeout = () => req;
    queueMicrotask(() => {
      const response = responses.get(url) || { status: 404, body: Buffer.alloc(0) };
      const stream = response.error ? Readable.from((async function* () { yield Buffer.from('partial'); throw new Error('Connection lost'); })())
        : Readable.from([response.body || Buffer.alloc(0)]);
      stream.statusCode = response.status || 200;
      stream.headers = { 'content-length': response.body?.length || 0, ...response.headers };
      callback(stream);
    });
    return req;
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'macos-tools.js'), 'utf8'), {
    module, exports: module.exports, __dirname: path.join(__dirname, '..'), process, Buffer, URL, console,
    require(name) {
      if (name === 'https') return https;
      if (name === './macos-tools-manifest.json') return customManifest || require('../macos-tools-manifest.json');
      return require(name);
    }
  });
  return { api: module.exports, requests };
}

test('native architecture validation distinguishes arm64, x64 and universal binaries', (t) => {
  const root = fixture(t);
  const { api } = loadMacTools(new Map());
  for (const arch of ['arm64', 'x64']) {
    const file = path.join(root, arch);
    fs.writeFileSync(file, macho(arch));
    assert.deepEqual(Array.from(api.machoArchitectures(file)), [arch]);
  }
  const universal = Buffer.alloc(48);
  universal.writeUInt32BE(0xcafebabe, 0);
  universal.writeUInt32BE(2, 4);
  universal.writeUInt32BE(0x01000007, 8);
  universal.writeUInt32BE(0x0100000c, 28);
  fs.writeFileSync(path.join(root, 'universal'), universal);
  assert.deepEqual(Array.from(api.machoArchitectures(path.join(root, 'universal'))), ['x64', 'arm64']);
  fs.writeFileSync(path.join(root, 'script'), '#!/bin/sh\n');
  assert.deepEqual(Array.from(api.machoArchitectures(path.join(root, 'script'))), []);
});

test('verified downloads enforce checksum and preserve installed files on failure', async (t) => {
  const root = fixture(t);
  const body = Buffer.from('verified content');
  const url = 'https://example.test/tool';
  const { api } = loadMacTools(new Map([[url, { body }]]));
  const target = path.join(root, 'tool');
  const progress = [];
  await api.downloadVerified(url, target, sha(body), (p) => progress.push(p));
  assert.equal(fs.readFileSync(target, 'utf8'), body.toString());
  assert.equal(progress.at(-1), 100);
  await assert.rejects(api.downloadVerified(url, target, '0'.repeat(64)), /Checksum mismatch/);
  assert.equal(fs.readFileSync(target, 'utf8'), body.toString());
  assert.deepEqual(fs.readdirSync(root), ['tool']);
});

test('failed streams and insecure redirects leave no partial tool files', async (t) => {
  const root = fixture(t);
  const url = 'https://example.test/tool';
  const { api } = loadMacTools(new Map([[url, { error: true }]]));
  await assert.rejects(api.downloadVerified(url, path.join(root, 'tool'), '0'.repeat(64)), /Connection lost/);
  assert.deepEqual(fs.readdirSync(root), []);
  const redirect = loadMacTools(new Map([[url, { status: 302, headers: { location: 'http://example.test/tool' } }]]));
  await assert.rejects(redirect.api.downloadVerified(url, path.join(root, 'tool'), '0'.repeat(64)), /require HTTPS/);
  assert.deepEqual(fs.readdirSync(root), []);
});

function provisionFixture(root) {
  const packageRoot = path.join(root, 'package');
  const bundle = path.join(packageRoot, 'bundle');
  for (const dir of ['bin', 'lib', 'LICENSES']) fs.mkdirSync(path.join(bundle, dir), { recursive: true });
  for (const name of ['ffmpeg', 'ffprobe']) fs.writeFileSync(path.join(bundle, 'bin', name), macho(), { mode: 0o755 });
  fs.writeFileSync(path.join(bundle, 'lib', 'libavcodec.dylib'), macho());
  fs.writeFileSync(path.join(bundle, 'BUILDINFO.txt'), 'LGPL build provenance');
  const archive = path.join(root, 'bundle.tar');
  execFileSync('/usr/bin/tar', ['-cf', archive, '-C', packageRoot, 'bundle']);
  const payload = fs.readFileSync(archive);
  const source = Buffer.from('corresponding source archive');
  const yt = macho();
  const license = Buffer.from('third-party notices');
  const manifest = {
    ffmpegVersion: '9.0.1', ffmpegBase: 'https://example.test',
    bundles: { arm64: { name: 'bundle.tar', sha256: sha(payload) } },
    sources: [{ name: 'source.tar.xz', sha256: sha(source) }],
    ytDlp: { url: 'https://example.test/yt-dlp', version: '2026.08.19', sha256: sha(yt) },
    ytDlpLicenses: [{ name: 'yt-dlp-LICENSE.txt', url: 'https://example.test/license', sha256: sha(license) }]
  };
  const responses = new Map([
    ['https://example.test/bundle.tar', { body: payload }],
    ['https://example.test/source.tar.xz', { body: source }],
    ['https://example.test/yt-dlp', { body: yt }],
    ['https://example.test/license', { body: license }]
  ]);
  return { manifest, responses };
}

test('provisioning includes pair, libraries, sources and notices; verified cache is offline', async (t) => {
  const root = fixture(t);
  const { manifest, responses } = provisionFixture(root);
  const { api, requests } = loadMacTools(responses, manifest);
  const dest = path.join(root, 'installed');
  await api.prepareMacosTools({ arch: 'arm64', dest, execute: false });
  assert.equal(fs.existsSync(path.join(dest, 'bin', 'ffprobe')), true);
  assert.equal(fs.existsSync(path.join(dest, 'lib', 'libavcodec.dylib')), true);
  assert.equal(fs.existsSync(path.join(dest, 'sources', 'source.tar.xz')), true);
  assert.equal(fs.existsSync(path.join(dest, 'LICENSES', 'yt-dlp-LICENSE.txt')), true);
  assert.match(fs.readFileSync(path.join(dest, 'RIFF-THIRD-PARTY-NOTICES.txt'), 'utf8'), /Corresponding.*source archives/);
  assert.equal(requests.length, 4);
  responses.clear();
  await api.prepareMacosTools({ arch: 'arm64', dest, execute: false });
  assert.equal(requests.length, 4, 'cached binaries, sources and licenses should not need network access');
  assert.equal(fs.readdirSync(root).some((file) => file.startsWith('.riff-tools-')), false);
});

test('failed provisioning preserves the old installation and removes staged downloads', async (t) => {
  const root = fixture(t);
  const { manifest, responses } = provisionFixture(root);
  responses.delete('https://example.test/source.tar.xz');
  const { api } = loadMacTools(responses, manifest);
  const dest = path.join(root, 'installed');
  fs.mkdirSync(dest);
  fs.writeFileSync(path.join(dest, 'keep'), 'previous installation');
  await assert.rejects(api.prepareMacosTools({ arch: 'arm64', dest, execute: false }), /HTTP 404/);
  assert.deepEqual(fs.readdirSync(dest), ['keep']);
  assert.equal(fs.readdirSync(root).some((file) => file.startsWith('.riff-tools-')), false);
});

test('provisioning rejects an Intel-only binary for Apple Silicon', async (t) => {
  const root = fixture(t);
  const { manifest, responses } = provisionFixture(root);
  const intel = macho('x64');
  responses.set(manifest.ytDlp.url, { body: intel });
  manifest.ytDlp.sha256 = sha(intel);
  const { api } = loadMacTools(responses, manifest);
  const dest = path.join(root, 'installed');
  await assert.rejects(api.prepareMacosTools({ arch: 'arm64', dest, execute: false }), /native arm64/);
  assert.equal(fs.existsSync(dest), false);
});

test('unpacked stream runtime retains Python libraries beside executable and verifies archive before installing', async (t) => {
  const root=fixture(t), {manifest,responses}=provisionFixture(root);
  const expanded=path.join(root,'expanded');fs.mkdirSync(path.join(expanded,'_internal'),{recursive:true});
  fs.writeFileSync(path.join(expanded,'yt-dlp_macos'),macho(),{mode:0o755});
  fs.writeFileSync(path.join(expanded,'_internal','Python'),macho());
  const framework=path.join(expanded,'_internal','Python.framework');fs.mkdirSync(path.join(framework,'Versions','3.14','Resources'),{recursive:true});fs.mkdirSync(path.join(framework,'Versions','Current'),{recursive:true});fs.writeFileSync(path.join(framework,'Python'),macho());fs.mkdirSync(path.join(framework,'Resources'));fs.writeFileSync(path.join(framework,'Versions','3.14','Python'),macho());
  const archive=path.join(root,'ytdlp.zip');execFileSync('/usr/bin/zip',['-qr',archive,'.'],{cwd:expanded});
  const body=fs.readFileSync(archive);manifest.ytDlp.archive={url:'https://example.test/ytdlp.zip',sha256:sha(body)};
  responses.set(manifest.ytDlp.archive.url,{body});
  const {api,requests}=loadMacTools(responses,manifest),dest=path.join(root,'tools');
  await api.prepareMacosTools({arch:'arm64',dest,execute:false});
  assert.equal(fs.existsSync(path.join(dest,'bin','_internal','Python')),true);
  assert.equal(fs.existsSync(path.join(dest,'bin','yt-dlp')),true);
  assert.equal(requests.includes(manifest.ytDlp.url),false);
  assert.equal(fs.readlinkSync(path.join(dest,'bin','_internal','Python.framework','Versions','Current')),'3.14');
  assert.equal(fs.readlinkSync(path.join(dest,'bin','_internal','Python.framework','Python')),'Versions/Current/Python');
  manifest.ytDlp.archive.sha256='0'.repeat(64);
  await assert.rejects(api.prepareMacosTools({arch:'arm64',dest,execute:false}),/Checksum mismatch/);
  assert.equal(fs.existsSync(path.join(dest,'bin','_internal','Python')),true);
});
