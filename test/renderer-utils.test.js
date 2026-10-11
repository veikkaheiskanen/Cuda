const test = require('node:test');
const assert = require('node:assert/strict');
const { readStoredJSON, escapeHTML, safeMediaURL, tracks, playlists, object } = require('../renderer-utils');
const storage = raw => ({ getItem: () => raw });
test('malformed or wrong-shaped saved data cannot crash initialization', () => {
  for (const raw of ['{broken', 'null', '{}', '"tracks"', 'true']) assert.deepEqual(readStoredJSON(storage(raw), 'history', [], Array.isArray), []);
  assert.deepEqual(readStoredJSON(storage('[{"id":"abc"}]'), 'history', [], Array.isArray), [{ id: 'abc' }]);
  assert.equal(readStoredJSON(storage('"true"'), 'rpc', true), true);
  assert.equal(readStoredJSON(storage('false'), 'rpc', true), false);
  assert.deepEqual(readStoredJSON(storage('[]'), 'vfx', {}, object), {});
});
test('mixed corrupted collections retain usable music and playlists', () => {
  assert.deepEqual(tracks([null, 3, {}, { id: 'song', title: null, artist: 123 }]), [{ id: 'song', title: 'Untitled', artist: 'Unknown artist' }]);
  assert.deepEqual(playlists([false, { id: 'p', name: null, tracks: 'bad' }]), [{ id: 'p', name: 'Untitled', tracks: [] }]);
});
test('metadata is escaped in both text and quoted HTML attributes', () => {
  assert.equal(escapeHTML('A & B <img src=x onerror="alert(1)"> \'Live\''), 'A &amp; B &lt;img src=x onerror=&quot;alert(1)&quot;&gt; &#39;Live&#39;');
  assert.equal(escapeHTML('Björk — 夏 ♫'), 'Björk — 夏 ♫');
});
test('media URLs reject executable protocols and SVG data', () => {
  for (const input of ['javascript:alert(1)', 'data:text/html,<script>', 'data:image/svg+xml,<svg onload=alert(1)>', 'invalid', null]) assert.equal(safeMediaURL(input), '');
  for (const input of ['https://example.com/art.png', 'http://127.0.0.1:1234/art', 'file:///tmp/art.png', 'data:image/png;base64,AAAA']) assert.equal(safeMediaURL(input), input);
});
test('HLS proxying preserves remote playlist bases and segment/key URLs', () => {
  const { hlsProxyLoader } = require('../renderer-utils');
  let sent;
  class Loader { load(context, config, callbacks) { sent = { context, callbacks }; } }
  const Proxied = hlsProxyLoader({ DefaultConfig: { loader: Loader } }, 'http://127.0.0.1:1234/proxy?url=');
  let completed;
  new Proxied().load({ url: 'https://cdn.example/master/index.m3u8', type: 'manifest' }, {}, {
    onSuccess: (response, stats, context) => { completed = { response, context }; }
  });
  assert.equal(sent.context.url, 'http://127.0.0.1:1234/proxy?url=https%3A%2F%2Fcdn.example%2Fmaster%2Findex.m3u8');
  sent.callbacks.onSuccess({ url: sent.context.url, data: 'segment.ts' }, {}, sent.context, null);
  assert.equal(completed.response.url, 'https://cdn.example/master/index.m3u8');
  assert.equal(new URL('segment.ts', completed.context.url).href, 'https://cdn.example/master/segment.ts');
});
