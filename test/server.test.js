const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

test('local library and cache work on the actual bound server port', { timeout: 15000 }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'riff-server-test-'));
  const previousDataDir = process.env.RIFF_DATA_DIR;
  process.env.RIFF_DATA_DIR = dataDir;
  const platform = require('../platform');
  assert.equal(platform.DATA_DIR, dataDir, 'tests must never use the real music library');
  const tools = require('../tools');
  const updateTools = tools.updateYtDlpIfManaged;
  tools.updateYtDlpIfManaged = async () => false;
  const { startServer, stopServer } = require('../server');
  const blocker = http.createServer();

  t.after(async () => {
    await stopServer();
    await new Promise((resolve) => blocker.close(resolve));
    tools.updateYtDlpIfManaged = updateTools;
    if (previousDataDir === undefined) delete process.env.RIFF_DATA_DIR;
    else process.env.RIFF_DATA_DIR = previousDataDir;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  await new Promise((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(0, '127.0.0.1', () => {
      blocker.removeListener('error', reject);
      resolve();
    });
  });

  const occupiedPort = blocker.address().port;
  const port = await startServer(occupiedPort);
  assert.ok(port > 0);
  assert.notEqual(port, occupiedPort);
  const base = `http://127.0.0.1:${port}`;
  const post = (endpoint, payload) => fetch(base + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const id = 'local_012345abcdef';
  const libraryFile = `${id}.wav`;
  const libraryBytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  fs.writeFileSync(path.join(platform.LIBRARY_DIR, libraryFile), libraryBytes);
  const cachedBytes = Buffer.alloc(65536, 0x42);
  fs.writeFileSync(path.join(platform.CACHE_DIR, 'cached-track.mp3'), cachedBytes);
  fs.writeFileSync(path.join(platform.THUMBNAILS_DIR, 'cached-track.jpg'), Buffer.alloc(1024, 0x24));

  await t.test('audio proxy follows redirects, preserves seeking and permits isolated renderer playback', async () => {
    const origin = http.createServer((req, res) => {
      if (req.url === '/redirect') { res.writeHead(302, { Location: '/audio' }); return res.end(); }
      assert.equal(req.headers.origin, undefined);
      assert.equal(req.headers.cookie, undefined);
      res.writeHead(req.headers.range ? 206 : 200, { 'Content-Type': 'audio/mpeg', 'Access-Control-Allow-Origin': 'https://provider.example', 'Content-Range': 'bytes 0-3/4' });
      res.end('riff');
    });
    await new Promise(resolve => origin.listen(0, '127.0.0.1', resolve));
    try {
      const target = `http://127.0.0.1:${origin.address().port}/redirect`;
      const response = await fetch(base + '/api/audio-proxy?url=' + encodeURIComponent(target), { headers: { Range: 'bytes=0-3', Origin: 'null', Cookie: 'private=1' } });
      assert.equal(response.status, 206);
      assert.equal(response.headers.get('access-control-allow-origin'), '*');
      assert.equal(response.headers.get('content-type'), 'audio/mpeg');
      assert.equal(await response.text(), 'riff');
      assert.equal((await fetch(base + '/api/audio-proxy?url=file%3A%2F%2F%2Ftmp%2Fprivate')).status, 400);
    } finally { await new Promise(resolve => origin.close(resolve)); }
  });

  await t.test('extracted headers survive HLS requests and refresh bypasses a cached stream',async()=>{
    let seen=0;
    const origin=http.createServer((req,res)=>{assert.equal(req.headers.referer,'https://provider.example/track');assert.equal(req.headers['user-agent'],'Provider agent');assert.equal(req.headers.cookie,'provider=1');seen++;res.end('audio');});
    await new Promise(resolve=>origin.listen(0,'127.0.0.1',resolve));
    const target=`http://127.0.0.1:${origin.address().port}/opaque`;
    const binary=path.join(dataDir,'fake-extractor');const count=path.join(dataDir,'extractions');
    fs.writeFileSync(binary,`#!${process.execPath}\nconst fs=require('fs');fs.appendFileSync(${JSON.stringify(count)},'x');if(process.argv.at(-1).includes('protected')){console.error('This video is DRM protected');process.exit(1);}console.log(JSON.stringify({url:${JSON.stringify(target)},protocol:'m3u8_native',http_headers:{Referer:'https://provider.example/track','User-Agent':'Provider agent',Cookie:'provider=1'}}));`);fs.chmodSync(binary,0o755);
    const previous=process.env.RIFF_YTDLP;process.env.RIFF_YTDLP=binary;platform.clearBinaryCache();
    try{
      const params=new URLSearchParams({id:'header-test',platform:'soundcloud',url:'https://provider.example/track'});
      const first=await(await fetch(base+'/api/stream-info?'+params)).json();assert.equal(first.success,true);assert.equal(first.isHls,true);assert.equal(JSON.stringify(first).includes('provider=1'),false);
      assert.equal(await(await fetch(first.proxyUrl)).text(),'audio');assert.equal(await(await fetch(first.proxyBase+encodeURIComponent(target+'/segment'))).text(),'audio');assert.equal(seen,2);
      const cached=await(await fetch(base+'/api/stream-info?'+params)).json();assert.equal(cached.proxyBase,first.proxyBase);assert.equal(fs.readFileSync(count,'utf8'),'x');
      const refreshed=await(await fetch(base+'/api/stream-info?'+params+'&refresh=1')).json();assert.notEqual(refreshed.proxyBase,first.proxyBase);assert.equal(fs.readFileSync(count,'utf8'),'xx');
      // Mobile requests use a separate codec cache and skip unsupported Opus files.
      fs.writeFileSync(path.join(platform.CACHE_DIR,'header-test.opus'),Buffer.alloc(65536));
      const mobile=await(await fetch(base+'/api/stream-info?'+params+'&mobile=1')).json();
      assert.equal(mobile.isLocal,false);assert.notEqual(mobile.proxyBase,refreshed.proxyBase);
      assert.equal(fs.readFileSync(count,'utf8'),'xxx');
      assert.equal((await fetch(base+'/api/audio-proxy?stream=expired&url='+encodeURIComponent(target))).status,410);
      const restricted=await fetch(base+'/api/stream-info?id=protected-test&platform=soundcloud&url=https%3A%2F%2Fprovider.example%2Fprotected');assert.equal(restricted.status,502);assert.match((await restricted.json()).error,/protected by SoundCloud/);
    }finally{if(previous===undefined)delete process.env.RIFF_YTDLP;else process.env.RIFF_YTDLP=previous;platform.clearBinaryCache();await new Promise(resolve=>origin.close(resolve));}
  });

  await t.test('imports filenames and persists duration metadata', async () => {
    const added = await post('/api/library-add', {
      items: [{ id, file: libraryFile, ext: 'wav', name: '01. Björk - Jóga' }]
    });
    assert.deepEqual(await added.json(), { success: true, count: 1 });
    const update = await post('/api/library-update', { id, duration: 241 });
    assert.equal(update.status, 200);
    await update.arrayBuffer();
    const library = await (await fetch(base + '/api/library')).json();
    assert.deepEqual(library.map(({ id, title, artist, duration }) => ({ id, title, artist, duration })), [
      { id, title: 'Jóga', artist: 'Björk', duration: 241 }
    ]);
    assert.equal(JSON.parse(fs.readFileSync(platform.LIBRARY_PATH, 'utf8'))[id].duration, 241);
  });

  for (const [label, endpoint, bytes, mime] of [
    ['imported audio', `/api/library-file?id=${id}`, libraryBytes, 'audio/wav'],
    ['cached audio', '/api/local-track?id=cached-track', cachedBytes, 'audio/mpeg']
  ]) {
    await t.test(`${label} supports full, seek, open-ended, suffix and HEAD requests`, async () => {
      const full = await fetch(base + endpoint);
      assert.equal(full.status, 200);
      assert.equal(full.headers.get('content-type'), mime);
      assert.equal(full.headers.get('accept-ranges'), 'bytes');
      assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);
      const ranges = [
        ['bytes=3-9', 3, 9],
        [`bytes=${bytes.length - 4}-`, bytes.length - 4, bytes.length - 1],
        ['bytes=-5', bytes.length - 5, bytes.length - 1],
        [`bytes=0-${bytes.length + 100}`, 0, bytes.length - 1]
      ];
      for (const [range, start, end] of ranges) {
        const response = await fetch(base + endpoint, { headers: { Range: range } });
        assert.equal(response.status, 206, range);
        assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${bytes.length}`);
        assert.equal(Number(response.headers.get('content-length')), end - start + 1);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(start, end + 1));
      }
      const head = await fetch(base + endpoint, { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(Number(head.headers.get('content-length')), bytes.length);
      assert.equal((await head.arrayBuffer()).byteLength, 0);
    });

    await t.test(`${label} rejects invalid ranges and stays available`, async () => {
      for (const range of ['bytes=-0', 'bytes=9-3', 'bytes=bad', 'bytes=0-1,3-4', `bytes=${bytes.length}-`]) {
        const response = await fetch(base + endpoint, { headers: { Range: range } });
        assert.equal(response.status, 416, range);
        assert.equal(response.headers.get('content-range'), `bytes */${bytes.length}`);
        assert.equal((await response.arrayBuffer()).byteLength, 0);
      }
      const response = await fetch(base + endpoint, { headers: { Range: 'bytes=0-1' } });
      assert.equal(response.status, 206);
      assert.equal((await response.arrayBuffer()).byteLength, 2);
    });
  }

  await t.test('cache and thumbnail URLs use the fallback port', async () => {
    const cached = await (await fetch(base + '/api/check-cache?id=cached-track')).json();
    assert.equal(cached.cached, true);
    assert.equal(cached.streamUrl, base + '/api/local-track?id=cached-track');
    const stream = await (await fetch(base + '/api/stream-info?id=cached-track')).json();
    assert.equal(stream.isLocal, true);
    assert.equal(stream.streamUrl, cached.streamUrl);
    const offline = await (await fetch(base + '/api/offline-library')).json();
    assert.equal(offline.tracks[0].localThumbnail, base + '/api/local-thumbnail?id=cached-track');
  });

  await t.test('analysis and edited Unicode lyrics persist offline', async () => {
    const analysis = { bpm: 120, energy: 0.5 };
    const response = await post('/api/track-analysis', { id: 'cached-track', analysis });
    assert.equal(response.status, 200);
    await response.arrayBuffer();
    const saved = await (await fetch(base + '/api/track-analysis?id=cached-track')).json();
    assert.deepEqual(saved.analysis, analysis);
    assert.deepEqual(JSON.parse(fs.readFileSync(platform.METADATA_PATH, 'utf8'))['cached-track'].analysis, analysis);
    const query = new URLSearchParams({ title: 'Jóga', artist: 'Björk' });
    for (const lyrics of ['[00:01.00]First line', '[00:02.00]Edited líné']) {
      const response = await post(`/api/save-custom-lyrics?${query}`, { lyrics });
      assert.equal(response.status, 200);
      await response.arrayBuffer();
      const readback = await (await fetch(`${base}/api/lyrics?${query}&online=0`)).json();
      assert.equal(readback.lyrics, lyrics);
      assert.equal(readback.isCustom, true);
    }
    const lyricsFiles = fs.readdirSync(platform.CUSTOM_LYRICS_DIR);
    assert.equal(lyricsFiles.length, 1);
    assert.equal(fs.readFileSync(path.join(platform.CUSTOM_LYRICS_DIR, lyricsFiles[0]), 'utf8'), '[00:02.00]Edited líné');
  });

  await t.test('removal updates the library and removes audio', async () => {
    const removed = await post('/api/library-remove', { id });
    assert.equal(removed.status, 200);
    await removed.arrayBuffer();
    assert.deepEqual(await (await fetch(base + '/api/library')).json(), []);
    assert.equal(fs.existsSync(path.join(platform.LIBRARY_DIR, libraryFile)), false);
    for (const endpoint of [`/api/library-file?id=${id}`, '/api/local-track?id=missing']) {
      const response = await fetch(base + endpoint);
      assert.equal(response.status, 404);
      await response.arrayBuffer();
    }
  });

  await t.test('ephemeral startup returns its assigned port', async () => {
    await stopServer();
    const ephemeralPort = await startServer(0);
    assert.ok(ephemeralPort > 0);
    const response = await fetch(`http://127.0.0.1:${ephemeralPort}/api/check-cache?id=cached-track`);
    const cached = await response.json();
    assert.equal(cached.streamUrl, `http://127.0.0.1:${ephemeralPort}/api/local-track?id=cached-track`);
  });
});
