// Runs inside smoke-macos with a disposable profile and bundled tools.
const assert = require('node:assert/strict');
module.exports = async function ({ command, evaluate, delay, fs, path, audioOrigin, port }) {
  const shots = process.env.RIFF_GLASS_SCREENSHOTS;
  async function until(expression) {
    for (let tries = 0; tries < 60; tries++) { if (await evaluate(expression)) return; await delay(100); }
    throw Error('UI did not settle: '+expression+'; '+JSON.stringify(await evaluate('({ready:document.readyState,player:typeof window.cudaPlayer,active:[...document.querySelectorAll(".content-view.active")].map(e=>e.id),nav:[...document.querySelectorAll(".nav-item.active")].map(e=>e.id),body:document.body.className})'))); 
  }
  async function screenshot(name) {
    if (!shots) return;
    await delay(300);
    fs.mkdirSync(shots, { recursive: true });
    const shot = await command('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(shots, name + '.png'), Buffer.from(shot.data, 'base64'));
  }
  await delay(700);
  await evaluate("electronAPI.setAppearance({mode:'light'})");
  await until('getComputedStyle(document.body).color === "rgb(23, 43, 66)"');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".right-panel")).display'), 'none');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".nav-label")).display !== "none"'), true);
  assert.equal(await evaluate('getComputedStyle(document.body).color'), 'rgb(23, 43, 66)');
  assert.equal(await evaluate('document.querySelector(".glass-hero") || document.querySelector(".platform-switch-container")'), null);
  assert.equal(await evaluate('document.title'), 'Cuda');
  assert.equal((await evaluate('electronAPI.getWindowFrame()')).nativeCornerApplied,true);
  async function assertNativeCorners() {
    const frame = await evaluate('electronAPI.getWindowFrame()');
    assert.equal(frame.nativeClip.opaque,0,'The Mac background must not fill the clipped corners');
    assert.equal(frame.nativeClip.backgroundAlpha,0,'The system bezel must not add a second corner');
    assert.equal(frame.nativeClip.frameRadius,frame.cornerRadius);
    assert.equal(frame.nativeClip.contentRadius,frame.cornerRadius);
    assert.equal(frame.nativeClip.maskWidth,frame.nativeClip.width);
    assert.equal(frame.nativeClip.maskHeight,frame.nativeClip.height);
  }
  await assertNativeCorners();
  const hit = await evaluate('(()=>{const b=document.getElementById("search-input").getBoundingClientRect();return document.elementFromPoint(b.left+b.width/2,b.top+4)?.id;})()');
  if(hit!=='search-input') {console.log(await evaluate('(()=>{const b=document.getElementById("search-input").getBoundingClientRect();const hit=document.elementFromPoint(b.left+b.width/2,b.top+4);return {input:b.toJSON(),hit:hit?.outerHTML.slice(0,400),html:document.documentElement.getBoundingClientRect().toJSON(),body:document.body.getBoundingClientRect().toJSON(),clip:getComputedStyle(document.documentElement).clipPath};})()'));await screenshot('cuda-hit-debug');}
  assert.equal(hit,'search-input');
  await screenshot('cuda-light');
  // Exercise real renderer initialization with corrupt persisted data.
  await evaluate(`localStorage.setItem('devsize_favorites', '{broken'); localStorage.setItem('devsize_history', 'null'); localStorage.setItem('devsize_playlists', '[null,{"id":"p","name":"Test","tracks":"bad"}]'); localStorage.setItem('devsize_custom_presets', '[{},null]'); localStorage.setItem('devsize_vfx','null'); localStorage.setItem('devsize_discord_rpc','"true"'); localStorage.setItem('devsize_ui_scale','invalid'); location.reload()`);
  await delay(1500);
  await command('Page.bringToFront');
  await until('typeof window.cudaPlayer === "object" && typeof window.showSettingsCategory === "function"');
  assert.equal(await evaluate('document.getElementById("settings-slider-scale").value'), '100');
  await evaluate('document.getElementById("nav-favorites").click()'); await delay(500);
  await until('document.getElementById("view-favorites").classList.contains("active")');
  // Malicious remote metadata stays inert. Two searches resolve in reverse order.
  await evaluate(`window.__realFetch=window.fetch;window.fetch=(url,...args)=>String(url).includes('/api/search?')?new Promise(resolve=>{const slow=String(url).includes('First');setTimeout(()=>resolve({json:async()=>({success:true,tracks:[{id:slow?'first':'second',title:slow?'Stale result':'<img src=x onerror="window.__xss=1"> & calm',artist:'Ocean \\" air',thumbnail:'https://example.com/\\" onerror=\\"window.__xss=2',duration:120}]})}),slow?300:50)}):window.__realFetch(url,...args);document.getElementById('search-input').value='First';document.getElementById('search-icon-btn').click();document.getElementById('search-input').value='Second';document.getElementById('search-icon-btn').click()`);
  await delay(650);
  assert.equal(await evaluate('document.querySelector("#search-tracks-list .track-row")?.dataset.trackId'), 'second');
  assert.equal(await evaluate('document.querySelector("#search-tracks-list .track-row-title").textContent'), '<img src=x onerror="window.__xss=1"> & calm');
  assert.equal(await evaluate('window.__xss || null'), null);
  await evaluate(`document.getElementById('search-input').value='First';document.getElementById('search-icon-btn').click();document.querySelector('.chip-btn[data-home]').click()`);
  await delay(500);
  assert.equal(await evaluate('document.getElementById("search-input").value'), '');
  assert.equal(await evaluate('document.getElementById("search-results-container").classList.contains("hidden")'), true);
  await evaluate('window.fetch=window.__realFetch;document.getElementById("nav-settings").click()'); await delay(500);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".glass-appearance")).display !== "none"'), true);
  await evaluate("document.querySelector('button[data-appearance=dark]').click()"); await delay(250);
  await until('document.documentElement.dataset.appearance === "dark"');
  await until('getComputedStyle(document.body).color === "rgb(245, 246, 248)"');
  await evaluate("document.getElementById('nav-discover').click()"); await until('document.getElementById("view-discover").classList.contains("active")');
  await screenshot('riff-dark-mode');
  await evaluate("document.getElementById('nav-settings').click()"); await delay(250);
  await evaluate("document.getElementById('glass-window-opacity').value='65';document.getElementById('glass-window-opacity').dispatchEvent(new Event('change'))"); await delay(250);
  await until('(async () => (await electronAPI.getAppearance()).opacity === 65)()');
  await evaluate('location.reload()'); await delay(900);
  await until('document.documentElement.dataset.appearance === "dark"');
  await until('document.getElementById("glass-window-opacity").value === "65"');
  await evaluate('document.getElementById("nav-settings").click()'); await delay(250);
  await screenshot('riff-dark-appearance');
  await evaluate('document.getElementById("glass-window-transparency").click()'); await delay(250);
  await until('(async () => !(await electronAPI.getAppearance()).transparent)()');
  await until('!document.body.classList.contains("window-transparent")');
  await assertNativeCorners();
  await evaluate('document.getElementById("glass-window-transparency").click()'); await delay(250);
  await until('(async () => (await electronAPI.getAppearance()).transparent)()');
  await assertNativeCorners();
  const nativeAppearance = await evaluate('electronAPI.getAppearance()');
  assert.equal(nativeAppearance.nativeTransparency, true);
  assert.equal(await evaluate('document.body.classList.contains("window-transparent")'), nativeAppearance.effectiveTransparency);
  await evaluate("document.querySelector('button[data-appearance=system]').click()"); await delay(250);
  await until('(async () => (await electronAPI.getAppearance()).mode === "system")()');
  const systemAppearance = await evaluate('electronAPI.getAppearance()');
  assert.equal(systemAppearance.mode, 'system');
  assert.equal(await evaluate('document.documentElement.dataset.appearance'), systemAppearance.effectiveMode);
  await evaluate("document.querySelector('button[data-appearance=light]').click()");
  await until('(async () => (await electronAPI.getAppearance()).mode === \"light\")()');
  await until('document.documentElement.dataset.appearance === \"light\"');
  await evaluate("document.getElementById('glass-window-opacity').value=0;document.getElementById('glass-window-opacity').dispatchEvent(new Event('input'));document.getElementById('glass-window-opacity').dispatchEvent(new Event('change'))");
  await until('(async () => (await electronAPI.getAppearance()).opacity === 0)()');
  assert.equal(await evaluate('getComputedStyle(document.documentElement).getPropertyValue("--window-alpha").trim()'),'0');
  await evaluate("electronAPI.setAppearance({opacity:78})"); await delay(250);
  await evaluate('document.getElementById("glass-reduce-transparency").click();document.getElementById("glass-reduce-motion").click()');
  await delay(200);
  assert.equal(await evaluate('document.body.classList.contains("reduce-transparency") && document.body.classList.contains("reduce-motion")'), true);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".sidebar")).backdropFilter'), 'none');
  await screenshot('riff-appearance');
  await assertNativeCorners();
  await evaluate('showSettingsCategory("about")');
  await screenshot('cuda-about');
  await evaluate('showSettingsCategory("appearance")');
  await evaluate('document.getElementById("glass-reduce-transparency").click();document.getElementById("glass-reduce-motion").click();document.getElementById("nav-discover").click()');
  await command('Emulation.setDeviceMetricsOverride', { width: 500, height: 850, deviceScaleFactor: 1, mobile: false }); await delay(600);
  assert.equal(await evaluate('document.body.classList.contains("mini")'), false);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".main-content")).display !== "none"'), true);
  const layout = await evaluate('({width:innerWidth,main:document.querySelector(".main-content").getBoundingClientRect().right,nav:document.querySelector(".sidebar").getBoundingClientRect().right})');
  assert.ok(layout.main <= layout.width && layout.nav <= layout.width, JSON.stringify(layout));
  await screenshot('riff-mobile-layout');
  await evaluate("electronAPI.setAppearance({mode:'dark'})"); await delay(200);
  await until('getComputedStyle(document.body).color === "rgb(245, 246, 248)"');
  await evaluate("document.getElementById('settings-slider-scale').value=140;document.getElementById('settings-slider-scale').dispatchEvent(new Event('input'))");
  await delay(300);
  assert.equal(await evaluate('electronAPI.getZoomFactor()'),1);
  for (const width of [360,390,500,680]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:false});await delay(250);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true,'Overflow at '+width);
    assert.equal(await evaluate('document.getElementById("btn-toggle-playlists-drawer")?.getBoundingClientRect().width || 0'),0);
  }
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:850,deviceScaleFactor:1,mobile:false});await delay(250);
  await evaluate(`document.getElementById('home-quick-play-row').innerHTML='<button class="quick-play-pill"><img class="quick-play-pill-img" src="assets/artwork-placeholder.svg" alt=""><span class="quick-play-pill-text"><span class="quick-play-pill-title">A very long song title that must fit in a narrow music card</span><span class="quick-play-pill-artist">A very long artist name with featured collaborators</span></span></button><button class="quick-play-pill"><span class="quick-play-pill-text"><span class="quick-play-pill-title">Another long song title for the second column</span></span></button>'`);
  const quick=await evaluate('(()=>{const b=document.querySelector(".quick-play-pill"),t=b.querySelector(".quick-play-pill-text");return {scroll:b.scrollWidth,width:b.clientWidth,box:b.getBoundingClientRect().width,text:t.getBoundingClientRect().width,min:getComputedStyle(t).minWidth,flex:getComputedStyle(t).flex,img:b.querySelector("img").getBoundingClientRect().width};})()');
  assert.ok(quick.scroll <= quick.width+1,JSON.stringify(quick));
  await screenshot('cuda-dark-mobile');
  await evaluate("document.getElementById('settings-slider-scale').value=100;document.getElementById('settings-slider-scale').dispatchEvent(new Event('input'))");
  await evaluate("electronAPI.setAppearance({mode:'light'})"); await delay(200);
  await command('Emulation.clearDeviceMetricsOverride'); await delay(400);
  // Spotify setup is visible without credentials. Render its library controls with a test-only API substitute.
  await evaluate("document.getElementById('nav-settings').click();document.querySelector('[data-cat-target=integrations]')?.click()");
  await evaluate("[...document.querySelectorAll('.settings-nav-btn')].find(b=>b.textContent.trim()==='Integrations')?.click()");
  await delay(250);
  assert.equal(await evaluate('!!document.getElementById("spotify-client-id")'),true);
  await screenshot('cuda-spotify-settings');
  const spotifyUI = fs.readFileSync(path.join(__dirname,'..','spotify-ui.js'),'utf8').replaceAll('window.electronAPI','window.__spotifyQA').replace("document.addEventListener('DOMContentLoaded',async()=>{",'(async()=>{').replace('  });\n  async function choosePlaylists','  })();\n  async function choosePlaylists');
  const mockTrack={id:'A'.repeat(22),title:'QA song',artist:'QA artist',duration:180,platform:'spotify',uri:'spotify:track:'+'A'.repeat(22)};
  const mockAlbum={id:'B'.repeat(22),name:'QA album',artists:[{name:'QA artist'}],images:[],tracks:[mockTrack]};
  const mockLibrary={connected:true,clientId:'a'.repeat(32),profile:{display_name:'Test listener'},selected:[],tracks:[],shelf:[mockAlbum],lastfm:{},weekly:null};
  await evaluate(`document.getElementById('spotify-discover').remove();window.__spotifyCalls=[];window.__spotifyMock=${JSON.stringify(mockLibrary)};window.__spotifyQA={onSpotifyEvent(){},spotify:async(operation,...args)=>{window.__spotifyCalls.push([operation,...args]);if(operation==='status')return window.__spotifyMock;if(operation==='albumTracks')return [${JSON.stringify(mockTrack)}];if(operation==='playlists')return [{id:'${mockTrack.id}',name:'Selected music',accessible:true}];if(operation==='sync'){window.__spotifyMock.tracks=[${JSON.stringify(mockTrack)}];window.__spotifyMock.selected=args[0];return window.__spotifyMock;}return {};}};${spotifyUI}`);
  await delay(300);
  assert.equal(await evaluate('document.querySelector(".spotify-album h4").textContent'),'QA album');
  await evaluate("document.getElementById('nav-discover').click();[...document.querySelectorAll('.spotify-album button')].find(b=>b.textContent==='Queue').click()");
  await delay(150);
  assert.equal(await evaluate('Number(document.getElementById("queue-count").textContent) > 0'),true);
  await evaluate("document.getElementById('nav-settings').click();[...document.querySelectorAll('.spotify-settings button')].find(b=>b.textContent==='Choose playlists').click()");await delay(150);
  assert.equal(await evaluate('!!document.querySelector(".spotify-playlist-dialog input[type=checkbox]")'),true);
  await evaluate("document.querySelector('.spotify-playlist-dialog input').click();[...document.querySelectorAll('.spotify-playlist-dialog button')].find(b=>b.textContent==='Use selected playlists').click()");await delay(150);
  assert.equal(await evaluate('window.spotifyLibrary.tracks.length'),1);
  assert.equal(await evaluate('!!document.querySelector(".spotify-playlist-dialog")'),false);
  await evaluate("localStorage.setItem('devsize_ui_scale','100');location.reload()");await delay(1000);await command('Page.bringToFront');await until('typeof window.showSettingsCategory === "function"');
  // Drawer controls and modal keyboard focus must work on the desktop.
  await evaluate('document.getElementById("btn-toggle-presets-drawer").click()'); await delay(500);
  assert.equal(await evaluate('getComputedStyle(document.getElementById("rail-drawer")).display'), 'flex');
  await evaluate('document.getElementById("btn-close-rail-drawer").click();document.getElementById("nav-shelf").click();document.getElementById("shelf-create-playlist").focus()');
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }); await delay(500);
  await until('document.getElementById("create-playlist-modal").getAttribute("aria-modal") === "true"');
  assert.equal(await evaluate('document.getElementById("create-playlist-modal").contains(document.activeElement)'), true);
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await delay(500);
  assert.equal(await evaluate('document.getElementById("create-playlist-modal").classList.contains("hidden")'), true);
  await evaluate('document.getElementById("btn-close-rail-drawer").click()'); await delay(400);
  // A virtualized list keeps the selected absolute index when advancing the queue.
  await evaluate(`window.__realFetch=window.fetch;window.fetch=(url,...args)=>String(url).includes('/api/search?')?Promise.resolve({json:async()=>({success:true,tracks:Array.from({length:220},(_,index)=>({id:'local_001122334455',platform:'local',title:'Queue item '+index,artist:'Riff',duration:5}))})}):window.__realFetch(url,...args);document.getElementById('search-input').value='Long list';document.getElementById('search-icon-btn').click()`);
  await delay(600);
  await evaluate('document.querySelector(".main-content").scrollTop=8000'); await delay(400);
  assert.equal(await evaluate(`!!document.querySelector('#search-tracks-list .track-row[data-track-index="120"]')`), true);
  await evaluate(`document.querySelector('#search-tracks-list .track-row[data-track-index="120"]').focus()`);
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }); await delay(300);
  assert.equal(await evaluate('document.getElementById("playbar-title").textContent'), 'Queue item 120');
  await evaluate('document.getElementById("btn-next").click()'); await delay(300);
  assert.equal(await evaluate('document.getElementById("playbar-title").textContent'), 'Queue item 121');
  await evaluate('document.getElementById("native-audio").pause();window.fetch=window.__realFetch;document.querySelector(".main-content").scrollTop=0');
  // Real remote-format AAC and HLS flow through the local proxy with CORS enabled.
  for (const hls of [false, true]) {
    const source = audioOrigin + (hls ? '/index.m3u8' : '/redirect');
    const info = { success: true, isHls: hls, streamUrl: source, proxyUrl: `http://127.0.0.1:${port}/api/audio-proxy?url=${encodeURIComponent(source)}` };
    const track = { id: hls ? 'hls-qa' : 'proxy-qa', platform: 'youtube', autoSelected:true, sourceContext:'public', title: hls ? 'HLS playback' : 'AAC proxy playback', artist: 'Riff', duration: 5, url: 'https://provider.example/audio' };
    await evaluate(`window.fetch=(url,...args)=>String(url).includes('/api/search?')?Promise.resolve({json:async()=>({success:true,tracks:[${JSON.stringify(track)}]})}):String(url).endsWith('/api/playback-source')?Promise.resolve({json:async()=>({success:true,track:${JSON.stringify(track)},stream:${JSON.stringify(info)}})}):String(url).includes('/api/stream-info?')?Promise.resolve({json:async()=>(${JSON.stringify(info)})}):window.__realFetch(url,...args);document.getElementById('search-input').value='Proxy test';document.getElementById('search-icon-btn').click()`);
    await delay(500);
    await evaluate('document.querySelector("#search-tracks-list .track-row").click()');
    let playing = false;
    for (let tries = 0; tries < 80; tries++) {
      playing = await evaluate('document.getElementById("native-audio").currentTime > .2 && !document.getElementById("native-audio").paused');
      if (playing) break;
      await delay(100);
    }
    assert.equal(playing, true, (hls ? 'HLS' : 'AAC') + ' proxy playback failed');
    await evaluate('document.getElementById("native-audio").pause()');
  }
  await evaluate('window.fetch=window.__realFetch');
  console.log('Glass UI passed: Light/Dark/System, saved appearance, native transparency and tint, damaged settings recovery, safe metadata, latest-search wins, All reset, transparency/motion, responsive layouts, keyboard dialogs and long virtualized queues.');
};
