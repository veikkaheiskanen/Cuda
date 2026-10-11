#!/usr/bin/env node
'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const routes = new Map([
  ['/api/search', 'GET'], ['/api/playback-source', 'POST'], ['/api/resolve-source', 'GET'],
  ['/api/stream-info', 'GET'], ['/api/audio-proxy', 'GET'], ['/api/local-track', 'GET'], ['/api/library-file', 'GET'], ['/api/local-thumbnail', 'GET'],
]);
function authenticated(req, token) {
  const url = new URL(req.url, 'http://localhost');
  const supplied = req.headers.authorization?.replace(/^Bearer /, '') || url.searchParams.get('pair') || '';
  const a = Buffer.from(supplied), b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function rewrite(value, upstream, origin, token) {
  if (typeof value === 'string') {
    // Stream and HLS segment URLs stay behind the same authenticated bridge.
    if (value.startsWith(upstream + '/api/')) {
      const u = new URL(value); if (!routes.has(u.pathname)) return value;
      u.searchParams.delete('native_token');
      u.searchParams.set('pair', token); return origin + u.pathname + u.search;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(item => rewrite(item, upstream, origin, token));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item, upstream, origin, token)]));
  return value;
}
function createBridge({ token, upstream = 'http://127.0.0.1:38472', allowedHosts = new Set(['localhost', '127.0.0.1']), upstreamHeaders = {} }) {
  const target = new URL(upstream);
  if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:') throw new Error('Upstream must be the local Cuda server.');
  if (typeof token !== 'string' || token.length < 32) throw new Error('Use a pairing key of at least 32 characters.');
  return http.createServer((req, res) => {
    const fail = (code, error) => { if (!res.headersSent) res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error })); };
    let incoming;
    try { incoming = new URL(req.url, 'http://' + req.headers.host); } catch { return fail(400, 'Invalid request.'); }
    if (!(typeof allowedHosts === 'function' ? allowedHosts(incoming.hostname) : allowedHosts.has(incoming.hostname))) return fail(403, 'Unrecognized companion address.');
    if (!authenticated(req, token)) return fail(401, 'Pairing key is missing or incorrect.');
    if (incoming.pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ service: 'cuda-ios-companion', version: 1 }));
    }
    if (routes.get(incoming.pathname) !== req.method) return fail(404, 'This endpoint is unavailable on mobile.');
    incoming.searchParams.delete('pair');
    if (incoming.pathname === '/api/stream-info') incoming.searchParams.set('mobile', '1');
    const origin = incoming.origin;
    const headers = { ...upstreamHeaders, accept: req.headers.accept || '*/*' };
    if (req.headers.range) headers.range = req.headers.range;
    if (req.method === 'POST') headers['content-type'] = 'application/json';
    const forward = () => {
      const upstreamReq = http.request(new URL(incoming.pathname + incoming.search, upstream), { method: req.method, headers }, upstreamRes => {
        const mime = upstreamRes.headers['content-type'] || 'application/octet-stream';
        const buffered = mime.includes('json') || /mpegurl/i.test(mime);
        const outputHeaders = { 'Content-Type': mime, 'Cache-Control': 'no-store' };
        for (const name of ['accept-ranges', 'content-range']) if (upstreamRes.headers[name]) outputHeaders[name] = upstreamRes.headers[name];
        if (!buffered) {
          if (upstreamRes.headers['content-length']) outputHeaders['content-length'] = upstreamRes.headers['content-length'];
          res.writeHead(upstreamRes.statusCode, outputHeaders); upstreamRes.pipe(res); return;
        }
        const chunks = []; let size = 0;
        upstreamRes.on('data', data => { size += data.length; if (size > 5_000_000) { upstreamRes.destroy(); fail(502, 'Companion response is too large.'); } else chunks.push(data); });
        upstreamRes.on('end', () => {
          if (res.writableEnded) return;
          try {
            let body = Buffer.concat(chunks).toString('utf8');
            if (mime.includes('json')) body = JSON.stringify(rewrite(JSON.parse(body), upstream, origin, token));
            else body = body.replace(/http:\/\/127\.0\.0\.1:\d+\/api\/[^\s"<>]+/g, url => rewrite(url, upstream, origin, token));
            res.writeHead(upstreamRes.statusCode, outputHeaders); res.end(body);
          } catch { fail(502, 'Could not read the Cuda response.'); }
        });
        upstreamRes.on('error', () => fail(502, 'Cuda disconnected. Reopen Cuda on your Mac.'));
      });
      upstreamReq.setTimeout(45_000, () => upstreamReq.destroy(new Error('Timeout')));
      upstreamReq.on('error', () => fail(502, 'Open Cuda on your Mac, then try again.'));
      res.on('close', () => upstreamReq.destroy());
      if (body) upstreamReq.end(body); else upstreamReq.end();
    };
    let body;
    if (req.method !== 'POST') return forward();
    const chunks = []; let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > 100_000) { fail(413, 'Request too large.'); } else chunks.push(chunk); });
    req.on('end', () => {
      if (res.writableEnded) return;
      try { const value = JSON.parse(Buffer.concat(chunks)); value.mobile = true; body = JSON.stringify(value); forward(); }
      catch { fail(400, 'Invalid request body.'); }
    });
  });
}
async function main() {
  // Pairing keys are local secrets and are never included in source or build artifacts.
  const dir = process.env.CUDA_PAIRING_DIR || path.join(os.homedir(), 'Library', 'Application Support', 'Cuda iOS Companion');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const keyFile = path.join(dir, 'pairing-key');
  let token;
  if (fs.existsSync(keyFile)) token = fs.readFileSync(keyFile, 'utf8').trim();
  else { token = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(keyFile, token, { mode: 0o600 }); }
  const interfaces = Object.values(os.networkInterfaces()).flat().filter(item => item && item.family === 'IPv4' && !item.internal);
  const allowedHosts = new Set(['localhost', '127.0.0.1', ...interfaces.map(item => item.address)]);
  const port = Number(process.env.CUDA_IOS_PORT) || 38473;
  // Run the current resolver independently of the installed desktop version.
  // Keep mobile cache/state separate, and reuse verified tools from Cuda.app.
  process.env.RIFF_DATA_DIR ||= path.join(dir, 'Media');
  for (const name of ['yt-dlp', 'ffmpeg', 'ffprobe']) {
    const key = 'RIFF_' + name.replace(/[^a-z0-9]/gi, '').toUpperCase();
    const candidates = ['tools/bin', 'bin/bin'].map(folder => path.join('/Applications/Cuda.app/Contents/Resources', folder, name));
    const bundled = candidates.find(file => fs.existsSync(file));
    if (!process.env[key] && bundled) process.env[key] = bundled;
  }
  const { startServer, stopServer } = require('../server');
  const upstreamPort = await startServer(0);
  const server = createBridge({ token, allowedHosts, upstream: 'http://127.0.0.1:' + upstreamPort });
  server.listen(port, '0.0.0.0', () => {
    console.log('Cuda iOS companion is ready. Keep this companion running and your Mac awake.');
    for (const item of interfaces) console.log('Address: http://' + item.address + ':' + port);
    console.log('Pairing key: ' + token);
    console.log('Enter this address and key in Cuda for iOS → Settings → Mac companion.');
  });
  server.on('error', async error => { console.error('Companion could not start: ' + error.message); await stopServer(); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { server.closeAllConnections(); server.close(); await stopServer(); process.exit(0); });
}
if (require.main === module) main().catch(error => { console.error('Companion could not start: ' + error.message); process.exitCode = 1; });
module.exports = { createBridge, authenticated, rewrite };
