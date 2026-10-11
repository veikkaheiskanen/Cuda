'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const net = require('node:net'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { DiscordPresence, activityFor, frame } = require('../macos/discord-presence');
const id = '123456789012345678';
const song = { track: { title: 'Blue hour', artist: 'Cuda Sessions', platform: 'spotify', url: 'https://open.spotify.com/track/abc', thumbnail: 'https://i.scdn.co/image/cover' }, playing: true, duration: 120, position: 30, speed: 1 };
async function waitFor(condition) {
  const deadline = Date.now() + 2500;
  while (!condition()) { if (Date.now() > deadline) throw new Error('RPC test timed out'); await new Promise(resolve => setTimeout(resolve, 10)); }
}
async function mockDiscord(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cuda-discord-test-'));
  const location = path.join(directory, 'discord-ipc-4');
  const received = [], sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    let buffer = Buffer.alloc(0);
    socket.on('data', data => {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= 8 && buffer.length >= buffer.readUInt32LE(4) + 8) {
        const op = buffer.readUInt32LE(0), size = buffer.readUInt32LE(4), value = JSON.parse(buffer.subarray(8, size + 8).toString()); buffer = buffer.subarray(size + 8);
        received.push({ op, value });
        if (op === 0) {
          const ready = frame(1, { cmd: 'DISPATCH', evt: 'READY', data: {} });
          // A real socket can deliver a header and payload in different reads.
          socket.write(ready.subarray(0, 5)); setTimeout(() => { if (!socket.destroyed) socket.write(Buffer.concat([ready.subarray(5), frame(3, { ping: 42 })])); }, 5);
        } else if (op === 1 && !options.noAck) socket.write(frame(1, { cmd: value.cmd, nonce: value.nonce, evt: options.reject ? 'ERROR' : null, data: {} }));
      }
    });
  });
  await new Promise(resolve => server.listen(location, resolve));
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
  return { location, received, sockets };
}
test('presence describes actual playback, pause, seek and changed speed', () => {
  const playing = activityFor(song, 1_000_000);
  assert.deepEqual(playing.timestamps, { start: 970, end: 1090 });
  assert.equal(playing.type, 2); assert.equal(playing.details, 'Blue hour');
  assert.equal(playing.buttons[0].label, 'Listen on Spotify');
  assert.deepEqual(activityFor({ ...song, speed: 2, position: 60 }, 1_000_000).timestamps, { start: 970, end: 1030 });
  const paused = activityFor({ ...song, playing: false });
  assert.equal(paused.state, 'Paused · Cuda Sessions'); assert.equal(paused.timestamps, undefined);
  assert.equal(activityFor({ ...song, loading: true }), null); assert.equal(activityFor({}), null);
});
test('presence never shares local artwork paths, loopback credentials or untrusted listen buttons', () => {
  for (const thumbnail of ['/Users/test/private.png', 'file:///Users/test/private.png', 'http://127.0.0.1:8000/art?native_token=secret', 'https://192.168.1.2/art', 'https://example.com/art?access_token=secret']) {
    const value = activityFor({ ...song, track: { ...song.track, platform: 'local', url: 'file:///Users/test/private.wav', thumbnail } });
    assert.equal(value.assets, undefined); assert.equal(value.buttons, undefined); assert.equal(JSON.stringify(value).includes('secret'), false);
  }
  assert.equal(activityFor({ ...song, track: { ...song.track, url: 'https://evil.example/song' } }).buttons, undefined);
  assert.equal(Array.from(activityFor({ ...song, track: { title: '🎵'.repeat(200), artist: 'x'.repeat(200) } }).details).length, 128);
});
test('IPC handshake, partial frames, ping/pong, coalescing, pause and disable clearing', async t => {
  const mock = await mockDiscord(t), statuses = [];
  const rpc = new DiscordPresence({ paths: [path.join(path.dirname(mock.location), 'missing'), mock.location], emit: value => statuses.push(value), intervalMs: 80, pid: 1234 });
  t.after(() => rpc.close()); rpc.update(song); rpc.configure(true, id);
  await waitFor(() => mock.received.some(item => item.value.cmd === 'SET_ACTIVITY' && item.value.args.activity?.details === 'Blue hour'));
  assert.deepEqual(mock.received.find(item => item.op === 0).value, { v: 1, client_id: id });
  await waitFor(() => mock.received.some(item => item.op === 4));
  assert.equal(statuses.some(value => value.connected), true);
  assert.equal(mock.received.find(item => item.value.cmd === 'SET_ACTIVITY').value.args.pid, 1234);
  const before = mock.received.filter(item => item.value.cmd === 'SET_ACTIVITY').length;
  for (let i = 0; i < 20; i++) rpc.update(song);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(mock.received.filter(item => item.value.cmd === 'SET_ACTIVITY').length, before);
  rpc.update({ ...song, track: { ...song.track, title: 'old pending song' } });
  rpc.update({ ...song, track: { ...song.track, title: 'latest song' }, playing: false });
  await waitFor(() => mock.received.some(item => item.value.args?.activity?.details === 'latest song'));
  const paused = mock.received.find(item => item.value.args?.activity?.details === 'latest song').value.args.activity;
  assert.equal(paused.timestamps, undefined); assert.match(paused.state, /^Paused/);
  rpc.configure(false, id);
  await waitFor(() => mock.received.some(item => item.value.cmd === 'SET_ACTIVITY' && item.value.args.activity === null));
  assert.equal(rpc.status.message, 'Off'); assert.equal(rpc.socket, null);
});
test('opening Discord later and reopening it reconnect with the latest song', async t => {
  const mock = await mockDiscord(t), rpc = new DiscordPresence({ paths: [], retryMs: 30, intervalMs: 20 });
  t.after(() => rpc.close()); rpc.configure(true, id); rpc.update(song);
  await waitFor(() => rpc.status.message.includes('Open the Discord'));
  rpc.paths = [mock.location]; await waitFor(() => rpc.status.connected);
  for (const socket of mock.sockets) socket.destroy();
  rpc.update({ ...song, track: { ...song.track, title: 'After hours' } });
  await waitFor(() => mock.received.filter(item => item.op === 0).length >= 2 && mock.received.some(item => item.value.args?.activity?.details === 'After hours'));
  rpc.close(); const attempts = mock.received.filter(item => item.op === 0).length;
  await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(mock.received.filter(item => item.op === 0).length, attempts);
});
test('Discord rejections and malformed frames fail safely; invalid IDs never connect', async t => {
  const mock = await mockDiscord(t, { reject: true }), rpc = new DiscordPresence({ paths: [mock.location], intervalMs: 100 });
  t.after(() => rpc.close()); assert.throws(() => rpc.configure(true, 'not-a-token'), /Application ID/);
  assert.equal(mock.received.length, 0);
  rpc.update(song); rpc.configure(true, id); await waitFor(() => rpc.status.message.includes('could not show'));
  const header = Buffer.alloc(8); header.writeUInt32LE(1); header.writeUInt32LE(1000000, 4);
  for (const socket of mock.sockets) socket.write(header);
  await waitFor(() => rpc.status.message.includes('Invalid Discord response'));
  assert.equal(rpc.socket, null);
});
