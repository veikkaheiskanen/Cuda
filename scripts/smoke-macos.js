#!/usr/bin/env node
// Exercise the packaged app with isolated data and Finder's minimal PATH.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

async function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Run this smoke test on Apple Silicon macOS.');
  const bundle = path.resolve(process.argv[2] || 'dist/mac-arm64/Cuda.app');
  const executable = path.join(bundle, 'Contents', 'MacOS', 'Cuda');
  const bin = path.join(bundle, 'Contents', 'Resources', 'bin', 'bin');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'riff-macos-smoke-'));
  let child, ws, audioOrigin, log = '';
  try {
    const data = path.join(scratch, 'data');
    const library = path.join(data, 'library');
    fs.mkdirSync(library, { recursive: true });
    const id = 'local_001122334455';
    const file = `${id}.m4a`;
    const generated = spawnSync(path.join(bin, 'ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '5', '-c:a', 'aac', path.join(library, file)], { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr || 'Native FFmpeg failed');
    const native = spawnSync(path.join(bin,'riff-spotify-player'),[],{input:JSON.stringify({id:1,command:'status'})+'\n',encoding:'utf8',timeout:10000});
    assert.equal(native.status,0,native.stderr);
    const messages=native.stdout.trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(messages.find(m=>m.id===1)?.data.native,true);
    assert.equal(messages.find(m=>m.id===1)?.data.connected,false);
    const probed = spawnSync(path.join(bin, 'ffprobe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', path.join(library, file)], { encoding: 'utf8' });
    assert.equal(probed.status, 0, probed.stderr || 'Native FFprobe failed');
    assert.ok(Number(JSON.parse(probed.stdout).format.duration) >= 5);
    const downloader = spawnSync(path.join(bin, 'yt-dlp'), ['--version'], { encoding: 'utf8', timeout: 45000 });
    assert.equal(downloader.status, 0, downloader.stderr || downloader.error?.message || 'Packaged yt-dlp failed');
    assert.equal(downloader.stdout.trim(), require('../macos-tools-manifest.json').ytDlp.version);
    fs.writeFileSync(path.join(data, 'library.json'), JSON.stringify({ [id]: { id, file, ext: 'm4a', title: 'Apple Silicon playback test', artist: 'Riff', duration: 5, addedAt: Date.now() } }));

    const listener = net.createServer();
    await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
    const debugPort = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
    const env = { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', RIFF_DATA_DIR: data, RIFF_USER_DATA_DIR: path.join(scratch, 'profile') };
    if(process.env.RIFF_SPOTIFY_QA_SOURCE) {
      const privateCache=path.join(env.RIFF_USER_DATA_DIR,'spotify-playback-v2');fs.mkdirSync(privateCache,{recursive:true,mode:0o700});
      fs.copyFileSync(path.join(process.env.RIFF_SPOTIFY_QA_SOURCE,'spotify-playback-v2','credentials.json'),path.join(privateCache,'credentials.json'));fs.chmodSync(path.join(privateCache,'credentials.json'),0o600);
      fs.copyFileSync(path.join(process.env.RIFF_SPOTIFY_QA_SOURCE,'spotify-library.json'),path.join(env.RIFF_USER_DATA_DIR,'spotify-library.json'));
    }
    for (const key of ['ELECTRON_RUN_AS_NODE', 'RIFF_YTDLP', 'RIFF_FFMPEG', 'RIFF_FFPROBE']) delete env[key];
    if (process.env.RIFF_GLASS_QA) {
      fs.mkdirSync(env.RIFF_USER_DATA_DIR, { recursive: true });
      fs.writeFileSync(path.join(env.RIFF_USER_DATA_DIR, 'window-state.json'), JSON.stringify({ bounds: { x: 80, y: 80, width: 1280, height: 720 } }));
    }
    child = spawn(executable, [`--remote-debugging-port=${debugPort}`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => { log += chunk; });
    child.stderr.on('data', (chunk) => { log += chunk; });
    child.on('error', (error) => { log += error.message; });
    let page;
    for (let tries = 0; tries < 100; tries++) {
      if (child.exitCode !== null) throw new Error(`App exited during startup: ${log}`);
      try {
        page = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find((target) => target.type === 'page' && target.url.includes('index.html'));
        if (page) break;
      } catch (error) {}
      await delay(100);
    }
    assert.ok(page, `Renderer did not load: ${log}`);
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
    let sequence = 0;
    const waiting = new Map(), exceptions = [];
    ws.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === 'Runtime.exceptionThrown') { exceptions.push(message.params.exceptionDetails); console.error('Renderer exception:', JSON.stringify(message.params.exceptionDetails)); }
      if (message.id && waiting.has(message.id)) {
        const { resolve, reject, timer } = waiting.get(message.id);
        clearTimeout(timer); waiting.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      }
    });
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
      waiting.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const response = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
      return response.result.value;
    };
    await command('Runtime.enable');
    await command('Emulation.setFocusEmulationEnabled',{enabled:true});
    for (let tries = 0; tries < 100; tries++) {
      if (await evaluate('document.readyState === "complete" && !!window.electronAPI && document.body.classList.contains("is-macos")')) break;
      await delay(100);
    }
    const platform = await evaluate('({mac:electronAPI.isMacOS, controls:getComputedStyle(document.getElementById("btn-close")).display, media:!!navigator.mediaSession})');
    assert.equal(platform.mac, true); assert.equal(platform.controls, 'none'); assert.equal(platform.media, true);
    const port = await evaluate('electronAPI.getServerPort()');
    const status = await (await fetch(`http://127.0.0.1:${port}/api/tools-status`)).json();
    assert.equal(status.ytDlp, true); assert.equal(status.ffmpeg, true);
    assert.equal((await evaluate('electronAPI.checkForUpdates()')).reason, 'local-mac-build');
    if(process.env.RIFF_AUDIO_QA)await require('./audio-qa')({command,evaluate,delay,fs,path});
    if(process.env.RIFF_MAC_LAYOUT_QA)await require('./macos-layout-qa')({command,evaluate,delay,fs,path});
    if (process.env.RIFF_GLASS_QA) {
      const hlsDir = path.join(scratch, 'hls'); fs.mkdirSync(hlsDir);
      const hls = spawnSync(path.join(bin, 'ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-i', path.join(library, file), '-c:a', 'copy', '-hls_time', '1', '-hls_list_size', '0', path.join(hlsDir, 'index.m3u8')], { encoding: 'utf8' });
      assert.equal(hls.status, 0, hls.stderr);
      audioOrigin = http.createServer((req, res) => {
        if (req.url === '/redirect') { res.writeHead(302, { Location: '/audio.m4a' }); return res.end(); }
        const name = path.basename(req.url.split('?')[0]);
        const media = name === 'audio.m4a' ? path.join(library, file) : path.join(hlsDir, name);
        if (!fs.existsSync(media)) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : name.endsWith('.ts') ? 'video/mp2t' : 'audio/mp4', 'Access-Control-Allow-Origin': 'https://provider.example' });
        fs.createReadStream(media).pipe(res);
      });
      await new Promise(resolve => audioOrigin.listen(0, '127.0.0.1', resolve));
      await require('./glass-qa')({ command, evaluate, delay, fs, path, audioOrigin: `http://127.0.0.1:${audioOrigin.address().port}`, port });
    }
    await evaluate('document.getElementById("nav-local").click()');
    for (let tries = 0; tries < 100; tries++) {
      if (await evaluate('!!document.querySelector("#local-tracks-list .track-row")')) break;
      await delay(100);
    }
    assert.equal(await evaluate('document.querySelector("#local-tracks-list .track-row-title")?.textContent'), 'Apple Silicon playback test');
    await evaluate('document.querySelector("#local-tracks-list .track-row").click()');
    let playback;
    for (let tries = 0; tries < 100; tries++) {
      playback = await evaluate('(()=>{const a=document.getElementById("native-audio");return {time:a.currentTime,paused:a.paused,duration:a.duration,error:a.error?.code || null};})()');
      if (playback.time > 0.2) break;
      await delay(100);
    }
    assert.equal(playback.error, null); assert.equal(playback.paused, false); assert.ok(playback.time > 0.2, JSON.stringify(playback));
    assert.ok((await evaluate('window.cudaPlayer.diagnostics()')).peak > 0.001, 'Local audio must decode to a nonzero signal');
    await evaluate('document.getElementById("native-audio").currentTime = 2');
    await delay(250);
    assert.ok(await evaluate('document.getElementById("native-audio").currentTime >= 2'));
    await evaluate('document.getElementById("native-audio").pause()');
    if (process.env.RIFF_SHELF_QA) await require('./shelf-qa')({command,evaluate,delay,fs,path});
    if (process.env.RIFF_HOME_QA) await require('./home-player-qa')({command,evaluate,delay,fs,path});
    console.log('Mini transition baseline:',JSON.stringify(await evaluate('(async()=>({frame:await electronAPI.getWindowFrame(),mini:document.body.classList.contains("mini")}))()')));
    assert.equal(await evaluate('electronAPI.toggleMiniWindow()'), true);
    await delay(250);
    const miniFrame=await evaluate('electronAPI.getWindowFrame()');
    assert.equal(miniFrame.nativeClip.frameRadius,24);
    assert.equal(miniFrame.nativeClip.maskWidth,miniFrame.nativeClip.width);
    assert.equal(miniFrame.nativeClip.maskHeight,miniFrame.nativeClip.height);
    assert.equal(await evaluate('electronAPI.toggleMiniWindow()'), false);
    await delay(250);
    const restoredFrame=await evaluate('electronAPI.getWindowFrame()');
    assert.equal(restoredFrame.nativeClip.opaque,0);
    assert.equal(restoredFrame.nativeClip.backgroundAlpha,0);
    assert.equal(restoredFrame.nativeClip.maskWidth,restoredFrame.nativeClip.width);
    assert.equal(restoredFrame.nativeClip.maskHeight,restoredFrame.nativeClip.height);
    if (process.env.RIFF_SMOKE_SCREENSHOT) {
      await delay(500);
      const shot = await command('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.resolve(process.env.RIFF_SMOKE_SCREENSHOT), Buffer.from(shot.data, 'base64'));
    }
    if(process.env.RIFF_LIVE_PLAYBACK)await require('./live-playback-qa')({command,evaluate,delay,port});
    if(process.env.RIFF_PROMO_QA)await require('./promo-qa')({command,evaluate,delay,fs,path});
    assert.deepEqual(exceptions, [], `Renderer errors: ${JSON.stringify(exceptions)}`);
    console.log('Packaged arm64 app passed: native AAC tools, yt-dlp execution, Finder tool discovery, preload, Mac controls, local playback/seek, mini player, local update behavior.');
  } catch (error) {
    if (log) console.error(log.slice(-6000));
    throw error;
  } finally {
    if (audioOrigin) { audioOrigin.closeAllConnections(); await new Promise(resolve => audioOrigin.close(resolve)); }
    if (ws) ws.close();
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(5000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
