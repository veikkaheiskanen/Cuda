'use strict';
const assert=require('node:assert/strict');
module.exports=async({command,evaluate,delay,port})=>{
  async function until(expression,timeout=70000){const end=Date.now()+timeout;let value;while(Date.now()<end){value=await evaluate(expression);if(value)return value;await delay(250);}throw new Error('Playback did not settle: '+expression+'; '+JSON.stringify(await evaluate('cudaPlayer.diagnostics()')));}
  async function choose(source){await evaluate(`document.getElementById('playbar-audio-source').value=${JSON.stringify(source)};document.getElementById('playbar-audio-source').dispatchEvent(new Event('change'))`);await until("!document.getElementById('playbar-audio-source').disabled");}
  const youtube={id:'dQw4w9WgXcQ',title:'Never Gonna Give You Up',artist:'Rick Astley',duration:213,url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ',platform:'youtube'};
  const music={...youtube,platform:'ytmusic',url:'https://music.youtube.com/watch?v=dQw4w9WgXcQ'};
  const soundcloud={id:'300585048',title:'Elektronomia - Sky High [NCS Release]',artist:'NCS',duration:238,url:'https://soundcloud.com/elektronomia/elektronomia-sky-high',platform:'soundcloud'};
  // Provider requests and decoded samples are real. A progress timer alone cannot pass.
  for(const track of [youtube,music,soundcloud]){
    await evaluate(`document.getElementById('native-audio').pause();localStorage.setItem('cuda_audio_source',${JSON.stringify(track.platform)});location.reload()`);await delay(1200);await until('typeof window.cudaPlayer === "object"');
    const started=Date.now();
    await evaluate(`document.getElementById('volume-slider').value=.08;document.getElementById('volume-slider').dispatchEvent(new Event('input'));cudaPlayer.play([${JSON.stringify(track)}])`);
    await until(`(()=>{const d=cudaPlayer.diagnostics();return d.platform===${JSON.stringify(track.platform)} && d.time>1 && d.context==='running' && d.peak>.0001 && !d.failed})()`);
    const before=await evaluate('cudaPlayer.diagnostics()');assert.equal(before.attempts,1);assert.equal(before.error,'');
    await evaluate("document.getElementById('btn-play-pause').click()");await delay(500);const paused=await evaluate('cudaPlayer.diagnostics()');assert.equal(paused.playing,false);
    await evaluate("document.getElementById('btn-play-pause').click()");await until('cudaPlayer.diagnostics().playing && cudaPlayer.diagnostics().peak > .0001');
    await evaluate("document.getElementById('native-audio').currentTime=15");await until('cudaPlayer.diagnostics().time>=15 && cudaPlayer.diagnostics().peak>.0001');
    console.log(track.platform+' start/transport check '+(Date.now()-started)+' ms; passed: actual extracted stream, decoded audio, pause/resume and seek');
  }
  if(process.env.RIFF_LIVE_TRANSPORT_ONLY){
    await evaluate("document.getElementById('native-audio').pause();localStorage.setItem('cuda_audio_source','auto');location.reload()");await delay(1200);await until('typeof window.cudaPlayer === "object"');
    const broken={...youtube,id:'unavailable-original',url:'https://www.youtube.com/watch?v=unavailable',alternatives:[music]};
    await evaluate(`cudaPlayer.play([${JSON.stringify(broken)}])`);
    await until("cudaPlayer.diagnostics().attempts>=2 && cudaPlayer.diagnostics().playing && cudaPlayer.diagnostics().time>1 && cudaPlayer.diagnostics().peak>.0001 && !cudaPlayer.diagnostics().failed");
    console.log('Auto passed: unavailable original switched to a matching ready source and decoded audio.');return;
  }
  // Both manual YouTube sources are known alternatives. Switching preserves position and pause.
  await choose('auto');
  await evaluate(`cudaPlayer.play([${JSON.stringify({...youtube,alternatives:[music]})}])`);await until("cudaPlayer.diagnostics().platform==='youtube' && cudaPlayer.diagnostics().time>1");
  await evaluate("document.getElementById('native-audio').currentTime=20;document.getElementById('btn-play-pause').click()");await choose('ytmusic');
  await until("cudaPlayer.diagnostics().platform==='ytmusic' && cudaPlayer.diagnostics().time>=19");assert.equal((await evaluate('cudaPlayer.diagnostics()')).playing,false);
  await evaluate("document.getElementById('btn-play-pause').click()");await until('cudaPlayer.diagnostics().time>20 && cudaPlayer.diagnostics().peak>.0001');
  assert.equal(await evaluate("document.getElementById('playbar-source').textContent"),'YouTube Music');
  for(const width of [360,390]){await command('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:false});await delay(200);assert.equal(await evaluate("(()=>{const a=document.getElementById('playbar-audio-source').getBoundingClientRect();return a.left>=0&&a.right<=innerWidth&&document.documentElement.scrollWidth<=innerWidth})()"),true,'Source selector overflow at '+width);}
  if(process.env.RIFF_GLASS_SCREENSHOTS){const shot=await command('Page.captureScreenshot',{format:'png'});require('fs').writeFileSync(require('path').join(process.env.RIFF_GLASS_SCREENSHOTS,'cuda-source-mobile.png'),Buffer.from(shot.data,'base64'));}
  await command('Emulation.clearDeviceMetricsOverride');
  // Automatic fallback never reselects a failed Spotify source. The failure is simulated;
  // the replacement audio and extraction use the real YouTube transport.
  await choose('auto');
  await evaluate(`window.__fetchLive=fetch;window.fetch=(url,...args)=>String(url).includes('/api/resolve-source?')?Promise.resolve({json:async()=>({success:true,track:${JSON.stringify({...youtube,alternatives:[]})}})}):window.__fetchLive(url,...args);window.spotifyLibrary={connected:true,playbackConnected:true};cudaPlayer.play([{id:'A'.repeat(22),uri:'spotify:track:'+'A'.repeat(22),url:'spotify:track:'+'A'.repeat(22),platform:'spotify',title:'Never Gonna Give You Up',artist:'Rick Astley',duration:213,alternatives:[${JSON.stringify(youtube)}]}])`);
  await until("cudaPlayer.diagnostics().platform==='youtube' && cudaPlayer.diagnostics().time>1 && cudaPlayer.diagnostics().peak>.0001");assert.equal((await evaluate('cudaPlayer.diagnostics()')).attempts,2);
  await evaluate('window.fetch=window.__fetchLive;window.spotifyLibrary={connected:false}');
  // Protected SoundCloud audio must show its real reason and stop; never substitute an unrelated song.
  await evaluate("document.getElementById('native-audio').pause();localStorage.setItem('cuda_audio_source','soundcloud');location.reload()");await delay(1200);await until('typeof window.cudaPlayer === "object"');
  await evaluate(`window.__protectedFetch=fetch;window.__extractionCount=0;window.fetch=(url,...args)=>String(url).includes('/api/stream-info?')?(window.__extractionCount++,Promise.resolve({json:async()=>({success:false,error:'This recording is protected by SoundCloud. Choose another audio source.'})})):window.__protectedFetch(url,...args);cudaPlayer.play([{id:'protected-fixture',platform:'soundcloud',title:'Protected track',artist:'Test',url:'https://provider.example/protected'}])`);
  await until('cudaPlayer.diagnostics().failed',5000);assert.equal(await evaluate('window.__extractionCount'),1);assert.match((await evaluate('cudaPlayer.diagnostics()')).error,/protected/);await evaluate('window.fetch=window.__protectedFetch');
  const protectedTrack={id:'2402763543',title:'Vaikutuksii',artist:'Balenciagi',duration:180,url:'https://soundcloud.com/balenciagi-music/vaikutuksii',platform:'soundcloud'};
  await evaluate(`cudaPlayer.play([${JSON.stringify(protectedTrack)}])`);
  await until('cudaPlayer.diagnostics().failed');const failure=await evaluate('cudaPlayer.diagnostics()');assert.match(failure.error,/protected|restricted|timed out|unavailable/i);assert.equal(failure.platform,'soundcloud');assert.equal(failure.attempts,1);assert.equal(failure.playing,false);
  await delay(1000);assert.equal((await evaluate('cudaPlayer.diagnostics()')).failed,true);
  console.log('Source dropdown passed: preserved pause/position, mobile fit, failed Spotify fallback without loops, protected-source error');
};
