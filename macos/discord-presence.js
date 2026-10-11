'use strict';
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function frame(op, value) {
  const body = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(8);
  header.writeUInt32LE(op, 0); header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}
function publicURL(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.') || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[|.*\.local$)/i.test(u.hostname)) return undefined;
    if ([...u.searchParams.keys()].some(key => /token|secret|signature|password|auth/i.test(key))) return undefined;
    return u.href.length <= 256 ? u.href : undefined;
  } catch { return undefined; }
}
function activityFor(value, now = Date.now()) {
  if (!value?.track || value.loading) return null;
  const track = value.track;
  const text = (value, fallback) => Array.from(String(value || fallback)).slice(0, 128).join('');
  const activity = { type: 2, details: text(track.title, 'Untitled'), state: text((value.playing ? '' : 'Paused · ') + (track.artist || 'Unknown artist'), 'Unknown artist'), instance: false };
  const duration = Number(value.duration), position = Number.isFinite(Number(value.position)) ? Math.max(0, Number(value.position)) : 0;
  const speed = Math.min(2, Math.max(0.5, Number(value.speed) || 1));
  if (value.playing) {
    const start = Math.floor(now / 1000 - position / speed);
    activity.timestamps = { start };
    if (Number.isFinite(duration) && duration > position) activity.timestamps.end = Math.floor(now / 1000 + (duration - position) / speed);
  }
  const artwork = publicURL(track.thumbnail);
  if (artwork) activity.assets = { large_image: artwork, large_text: text(track.album || track.title, 'Cuda') };
  const url = publicURL(track.url);
  const labels = { spotify: 'Listen on Spotify', youtube: 'Listen on YouTube', ytmusic: 'Listen on YouTube Music', soundcloud: 'Listen on SoundCloud' };
  const hosts = { spotify: ['open.spotify.com'], youtube: ['www.youtube.com', 'youtube.com', 'youtu.be'], ytmusic: ['music.youtube.com', 'www.youtube.com'], soundcloud: ['soundcloud.com', 'www.soundcloud.com'] };
  if (url && hosts[track.platform]?.includes(new URL(url).hostname)) activity.buttons = [{ label: labels[track.platform], url }];
  return activity;
}
function socketPaths() {
  const directories = [...new Set([process.env.XDG_RUNTIME_DIR, os.tmpdir(), process.env.TMPDIR, process.env.TMP, process.env.TEMP, '/tmp'].filter(Boolean))];
  return directories.flatMap(directory => Array.from({ length: 10 }, (_, i) => path.join(directory, `discord-ipc-${i}`)));
}

class DiscordPresence {
  constructor({ emit = () => {}, paths = socketPaths(), retryMs = 15000, intervalMs = 5000, pid = process.ppid } = {}) {
    this.emit = emit; this.paths = paths; this.retryMs = retryMs; this.intervalMs = intervalMs; this.pid = pid;
    this.enabled = false; this.clientID = ''; this.generation = 0; this.wanted = null; this.sent = undefined; this.lastSent = 0;
    this.status = { connected: false, message: 'Off' };
  }
  report(connected, message) {
    this.status = { connected, message }; this.emit(this.status);
  }
  configure(enabled, clientID) {
    clientID = String(clientID || '').trim();
    if (enabled && !/^\d{17,20}$/.test(clientID)) throw new Error('Enter the Application ID from Discord Developer Portal.');
    this.disconnect(true); this.enabled = Boolean(enabled); this.clientID = clientID;
    if (this.enabled) { this.report(false, 'Connecting to Discord…'); this.connect(); }
    else this.report(false, 'Off');
    return this.status;
  }
  update(value) {
    const next = activityFor(value);
    // Ignore normal timer drift, but keep seek and speed changes accurate.
    if (next?.timestamps && this.wanted?.timestamps) {
      const a = { ...next, timestamps: undefined }, b = { ...this.wanted, timestamps: undefined };
      if (JSON.stringify(a) === JSON.stringify(b) && Math.abs(next.timestamps.start - this.wanted.timestamps.start) <= 2 && Math.abs((next.timestamps.end || 0) - (this.wanted.timestamps.end || 0)) <= 2) next.timestamps = this.wanted.timestamps;
    }
    this.wanted = next; this.flush();
  }
  async connect() {
    if (!this.enabled) return;
    const generation = this.generation;
    for (const location of this.paths) {
      if (generation !== this.generation || !this.enabled) return;
      const socket = net.createConnection(location);
      socket.on('error', () => {});
      this.candidate = socket;
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => { socket.destroy(); reject(new Error('timeout')); }, 1000);
          const connected = () => { clearTimeout(timeout); socket.off('error', failed); socket.off('close', failed); resolve(); };
          const failed = () => { clearTimeout(timeout); socket.off('connect', connected); socket.off('close', failed); socket.off('error', failed); reject(new Error('unavailable')); };
          socket.once('connect', connected); socket.once('error', failed); socket.once('close', failed);
        });
      } catch { socket.destroy(); continue; }
      if (generation !== this.generation || !this.enabled) { socket.destroy(); return; }
      this.candidate = null; this.socket = socket; this.buffer = Buffer.alloc(0); this.ready = false;
      socket.on('data', data => { if (this.socket === socket) this.consume(data); });
      socket.on('close', () => { if (this.socket === socket) this.lost('Discord is closed. Waiting to reconnect…'); });
      this.handshakeTimer = setTimeout(() => this.lost('Discord did not accept the Application ID. Check Settings.'), 5000);
      this.write(0, { v: 1, client_id: this.clientID });
      return;
    }
    if (generation === this.generation && this.enabled) { this.candidate = null; this.report(false, 'Open the Discord desktop app. Cuda will reconnect automatically.'); this.retry(); }
  }
  consume(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    if (this.buffer.length > 1048576) { this.lost('Invalid Discord response. Retrying…'); return; }
    while (this.buffer.length >= 8) {
      const op = this.buffer.readUInt32LE(0), size = this.buffer.readUInt32LE(4);
      if (size > 65536) { this.lost('Invalid Discord response. Retrying…'); return; }
      if (this.buffer.length < size + 8) return;
      const body = this.buffer.subarray(8, size + 8); this.buffer = this.buffer.subarray(size + 8);
      let value; try { value = JSON.parse(body.toString()); } catch { this.lost('Invalid Discord response. Retrying…'); return; }
      if (op === 3) { this.write(4, value); continue; }
      if (op === 2) { this.lost('Discord rejected the connection. Check the Application ID.'); return; }
      if (op !== 1) continue;
      if (value.evt === 'READY') {
        clearTimeout(this.handshakeTimer); this.ready = true; this.sent = undefined; this.lastSent = 0;
        this.report(true, 'Connected to Discord'); this.flush();
      } else if (value.nonce === this.inFlight) {
        clearTimeout(this.ackTimer); this.inFlight = null;
        if (value.evt === 'ERROR') { this.sent = undefined; this.report(false, 'Discord could not show the activity. Check the Application ID and activity privacy settings.'); }
        else this.report(true, 'Connected to Discord');
        this.flush();
      }
    }
  }
  write(op, value) { if (this.socket && !this.socket.destroyed) this.socket.write(frame(op, value)); }
  flush() {
    if (!this.enabled || !this.ready || this.inFlight || JSON.stringify(this.sent) === JSON.stringify(this.wanted)) return;
    clearTimeout(this.flushTimer);
    const wait = this.wanted === null ? 0 : this.lastSent + this.intervalMs - Date.now();
    if (wait > 0) { this.flushTimer = setTimeout(() => this.flush(), wait); return; }
    this.inFlight = randomUUID(); this.sent = this.wanted; this.lastSent = Date.now();
    this.write(1, { cmd: 'SET_ACTIVITY', args: { pid: this.pid, activity: this.wanted }, nonce: this.inFlight });
    this.ackTimer = setTimeout(() => this.lost('Discord stopped responding. Reconnecting…'), 10000);
  }
  retry() { clearTimeout(this.retryTimer); this.retryTimer = setTimeout(() => this.connect(), this.retryMs); this.retryTimer.unref(); }
  lost(message) { this.disconnect(false); if (this.enabled) { this.report(false, message); this.retry(); } }
  disconnect(clear) {
    this.generation++;
    for (const timer of ['retryTimer', 'flushTimer', 'handshakeTimer', 'ackTimer']) clearTimeout(this[timer]);
    this.candidate?.destroy(); this.candidate = null;
    const socket = this.socket; this.socket = null;
    let drained = Promise.resolve();
    if (socket) {
      if (clear && this.ready && !socket.destroyed) {
        drained = new Promise(resolve => {
          const timer = setTimeout(() => { socket.destroy(); resolve(); }, 300);
          socket.end(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: this.pid, activity: null }, nonce: randomUUID() }), () => { clearTimeout(timer); socket.destroy(); resolve(); });
        });
      } else socket.destroy();
    }
    this.ready = false; this.inFlight = null; this.sent = undefined; this.lastSent = 0;
    return drained;
  }
  close() { this.enabled = false; this.wanted = null; return this.disconnect(true); }
}
module.exports = { DiscordPresence, activityFor, frame, socketPaths };
