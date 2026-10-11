'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const http = require('node:http'), https = require('node:https'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const {MobileCompanion} = require('../macos/mobile-companion');
const {ShelfSyncService} = require('../macos/shelf-sync');
const {secureStore} = require('../macos/secure-store');
async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cuda-auto-companion-'));
  const nativeToken = crypto.randomBytes(32).toString('hex'); let received;
  const upstream = http.createServer((req, res) => {
    if (req.headers['x-cuda-native-token'] !== nativeToken) { res.writeHead(401); return res.end(); }
    const base = 'http://127.0.0.1:' + upstream.address().port;
    if (req.url.startsWith('/api/audio-proxy?manifest')) {
      res.writeHead(200, {'content-type': 'application/vnd.apple.mpegurl'});
      return res.end('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="' + base + '/api/audio-proxy?stream=fixture&url=https%3A%2F%2Fexample.com%2Fkey"\n' + base + '/api/audio-proxy?stream=fixture&url=https%3A%2F%2Fexample.com%2Fsegment\n');
    }
    if (req.url.startsWith('/api/local-track')) {
      assert.equal(req.headers.range, 'bytes=0-3');
      res.writeHead(206, {'content-type': 'audio/aac', 'content-range': 'bytes 0-3/10', 'content-length': '4'}); return res.end('tone');
    }
    const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
      received = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
      res.writeHead(200, {'content-type': 'application/json'});
      res.end(JSON.stringify({track: {id: 'fixture', platform: 'youtube'}, stream: {streamUrl: base + '/api/local-track?id=fixture&native_token=' + nativeToken}}));
    });
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const companion = new MobileCompanion({upstream: 'http://127.0.0.1:' + upstream.address().port, serviceToken: nativeToken});
  const sync = new ShelfSyncService({directory, store: secureStore(crypto.randomBytes(32)), api: async () => [], listenPort: 0, companion});
  t.after(async () => { await sync.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); fs.rmSync(directory, {recursive: true, force: true}); });
  function tls(route, token = sync.config.token) {
    return new Promise((resolve, reject) => {
      // Only the isolated generated test certificate is used here.
      const req = https.get({host: '127.0.0.1', port: sync.status().port, path: route, rejectUnauthorized: false, headers: {Authorization: 'Bearer ' + token}}, res => {
        const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({code: res.statusCode, value: JSON.parse(Buffer.concat(chunks))}));
      }); req.on('error', reject);
    });
  }
  return {sync, companion, tls, nativeToken, received: () => received};
}
test('one Shelf pairing starts streaming and securely provides a separate playback capability', async t => {
  const f = await fixture(t); assert.equal(f.companion.status().port, 0);
  await f.sync.configure({enabled: true});
  assert.equal((await f.tls('/sync/companion', 'wrong')).code, 401);
  const setup = (await f.tls('/sync/companion')).value;
  assert.equal(setup.service, 'cuda-ios-companion'); assert.ok(setup.port > 0);
  assert.notEqual(setup.token, f.sync.config.token); assert.notEqual(setup.token, f.nativeToken);
  assert.equal((await f.tls('/sync/exchange', setup.token)).code, 401);
  const origin = 'http://127.0.0.1:' + setup.port, headers = {Authorization: 'Bearer ' + setup.token};
  const result = await (await fetch(origin + '/api/playback-source', {method: 'POST', headers, body: '{"track":{"id":"fixture"}}'})).json();
  assert.equal(f.received().mobile, true);
  const media = new URL(result.stream.streamUrl);
  assert.equal(media.origin, origin); assert.equal(media.searchParams.get('pair'), setup.token); assert.equal(media.searchParams.has('native_token'), false);
  assert.equal(JSON.stringify(result).includes(f.nativeToken), false);
  const audio = await fetch(media, {headers: {Range: 'bytes=0-3'}}); assert.equal(audio.status, 206); assert.equal(await audio.text(), 'tone');
  for (const route of ['/api/library-remove', '/api/download', '/api/spotify/status', '/sync/exchange']) {
    assert.equal((await fetch(origin + route, {headers})).status, 404);
  }
});
test('automatic streaming rewrites HLS media and key URLs and authenticates every request', async t => {
  const f = await fixture(t); await f.sync.configure({enabled: true});
  const setup = (await f.tls('/sync/companion')).value, origin = 'http://127.0.0.1:' + setup.port;
  assert.equal((await fetch(origin + '/api/audio-proxy?manifest')).status, 401);
  const result = await (await fetch(origin + '/api/audio-proxy?manifest&pair=' + setup.token)).text();
  for (const raw of result.match(/http:\/\/[^\s"]+/g)) {
    const u = new URL(raw); assert.equal(u.origin, origin); assert.equal(u.searchParams.get('pair'), setup.token);
    assert.equal((await fetch(raw.replace(setup.token, 'wrong'))).status, 401);
  }
  assert.ok(result.includes('URI="' + origin)); assert.equal(result.includes(f.nativeToken), false);
});
test('reset and disable revoke automatic streaming while reopen provisions fresh credentials', async t => {
  const f = await fixture(t); await f.sync.configure({enabled: true}); const old = f.companion.status();
  await f.sync.configure({reset: true}); const fresh = (await f.tls('/sync/companion')).value;
  assert.notEqual(old.token, fresh.token);
  assert.equal((await fetch('http://127.0.0.1:' + fresh.port + '/health?pair=' + old.token)).status, 401);
  await f.sync.configure({enabled: false}); assert.equal(f.companion.status().port, 0); assert.equal(f.companion.status().token, '');
  await assert.rejects(fetch('http://127.0.0.1:' + fresh.port + '/health?pair=' + fresh.token));
  await f.sync.configure({enabled: true}); const reopened = (await f.tls('/sync/companion')).value; assert.notEqual(reopened.token, fresh.token);
});
