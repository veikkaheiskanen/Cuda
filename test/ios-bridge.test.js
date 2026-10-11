const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createBridge, rewrite, authenticated } = require('../scripts/ios-bridge');
const token = 'a'.repeat(64);
test('mobile media rewrites preserve queries and authenticate nested HLS segments', () => {
  const result = rewrite({ stream: { streamUrl: 'http://127.0.0.1:38472/api/audio-proxy?stream=x&url=https%3A%2F%2Fexample.com%2Fa' }, thumbnail: 'https://example.com/cover.jpg' }, 'http://127.0.0.1:38472', 'http://192.168.1.2:38473', token);
  const url = new URL(result.stream.streamUrl);
  assert.equal(url.host, '192.168.1.2:38473'); assert.equal(url.searchParams.get('pair'), token);
  assert.equal(url.searchParams.get('url'), 'https://example.com/a'); assert.equal(result.thumbnail, 'https://example.com/cover.jpg');
});
test('pairing validation rejects empty and incorrect credentials', () => {
  assert.equal(authenticated({ url: '/health', headers: {} }, token), false);
  assert.equal(authenticated({ url: '/health', headers: { authorization: 'Bearer ' + token } }, token), true);
  assert.equal(authenticated({ url: '/health?pair=' + token, headers: {} }, token), true);
  assert.equal(authenticated({ url: '/health?pair=wrong', headers: {} }, token), false);
});
test('bridge blocks desktop mutations and unknown hosts, forwards ranges and mobile resolver flag', async t => {
  let received;
  const upstream = http.createServer((req, res) => {
    if (req.url.startsWith('/api/local-track')) { assert.equal(req.headers.range, 'bytes=0-3'); res.writeHead(206, { 'content-type': 'audio/aac', 'content-range': 'bytes 0-3/10' }); return res.end('abcd'); }
    const chunks = []; req.on('data', x => chunks.push(x)); req.on('end', () => { received = JSON.parse(Buffer.concat(chunks)); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ track: { id: 'one' }, stream: { streamUrl: `http://127.0.0.1:${upstream.address().port}/api/local-track?id=one` } })); });
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve)); t.after(() => { upstream.closeAllConnections(); upstream.close(); });
  const bridge = createBridge({ token, upstream: `http://127.0.0.1:${upstream.address().port}` });
  await new Promise(resolve => bridge.listen(0, '127.0.0.1', resolve)); t.after(() => { bridge.closeAllConnections(); bridge.close(); });
  const base = `http://127.0.0.1:${bridge.address().port}`, headers = { authorization: 'Bearer ' + token };
  assert.equal((await fetch(base + '/health')).status, 401);
  assert.equal((await fetch(base + '/api/library-remove', { method: 'POST', headers, body: '{}' })).status, 404);
  const blocked = await new Promise(resolve => {
    const request = http.get(base + '/health', { headers: { ...headers, Host: 'attacker.example' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', error => { throw error; });
  });
  assert.equal(blocked, 403);
  const result = await (await fetch(base + '/api/playback-source', { method: 'POST', headers, body: '{"track":{"id":"one"}}' })).json();
  assert.equal(received.mobile, true); assert.equal(new URL(result.stream.streamUrl).searchParams.get('pair'), token);
  const audio = await fetch(base + '/api/local-track?id=one&pair=' + token, { headers: { Range: 'bytes=0-3' } });
  assert.equal(audio.status, 206); assert.equal(await audio.text(), 'abcd'); assert.equal(audio.headers.get('content-range'), 'bytes 0-3/10');
});
