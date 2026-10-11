const assert=require('node:assert/strict');
module.exports=async({command,evaluate,delay,fs,path})=>{
 async function until(expression){for(let i=0;i<80;i++){if(await evaluate(expression))return;await delay(100);}throw Error('Shelf check timed out: '+expression);}
 const local={id:'local_001122334455',platform:'local',title:'Saved song',artist:'Cuda',duration:5};
 const spotify={id:'A'.repeat(22),platform:'spotify',uri:'spotify:track:'+'A'.repeat(22),url:'spotify:track:'+'A'.repeat(22),title:'Spotify favourite',artist:'Test'};
 console.log("Shelf check: seed");
 await evaluate(`localStorage.setItem('devsize_favorites',${JSON.stringify(JSON.stringify([spotify,local]))});localStorage.setItem('devsize_playlists',JSON.stringify([{id:'shelf-test',name:'Evening music',description:'A quiet mix',tracks:[${JSON.stringify(local)}]}]));location.reload()`);await until('typeof cudaPlayer === "object"');await command('Page.bringToFront');
 console.log("Shelf check: render");
 await evaluate("document.getElementById('nav-shelf').click()");
 assert.equal(await evaluate("document.querySelectorAll('.sidebar .nav-item').length"),5);
 assert.equal(await evaluate("document.querySelector('#shelf-playlists .shelf-card span').textContent"),'A quiet mix');
 assert.equal(await evaluate("document.querySelectorAll('#shelf-favorites .shelf-card').length"),2);
 assert.equal(await evaluate("document.querySelector('.settings-credits-text').textContent"),'built by veikkaheiskanen');
 assert.equal(await evaluate("document.querySelector('.settings-credits-text').href"),'https://github.com/veikkaheiskanen');
 console.log("Shelf check: edit");
 await evaluate("document.querySelector('#shelf-playlists button').click();document.getElementById('btn-edit-playlist').click();document.getElementById('new-playlist-input').value='Late night';document.getElementById('new-playlist-description').value='After hours';document.getElementById('btn-confirm-new-playlist').click()");await delay(250);
 assert.equal(await evaluate("document.getElementById('playlist-detail-title').textContent"),'Late night');
 assert.equal(await evaluate("document.getElementById('playlist-detail-description').textContent"),'After hours');
 console.log("Shelf check: add");
 await evaluate("document.querySelector('#playlist-tracks-list .btn-row-add-playlist').click();document.querySelector('.playlist-pick-item').click()");await delay(200);
 assert.equal(await evaluate("JSON.parse(localStorage.getItem('devsize_playlists'))[0].tracks.length"),1,'Adding the same song must not duplicate it');
 console.log("Shelf check: create");
 await evaluate("document.getElementById('btn-back-playlists').click();document.getElementById('shelf-create-playlist').click();document.getElementById('new-playlist-input').value='New mix';document.getElementById('btn-confirm-new-playlist').click()");await delay(200);
 assert.equal(await evaluate("document.getElementById('btn-play-playlist').disabled"),true,'Empty playlist has no misleading Play action');
 assert.equal(await evaluate("JSON.parse(localStorage.getItem('devsize_playlists')).length"),2);
 console.log("Shelf check: favourite");
 await evaluate("document.getElementById('nav-favorites').click()"); console.log("Shelf favourite: opened");
 await evaluate("window.spotifyLibrary={...window.spotifyLibrary,connected:true};void 0");console.log("Shelf favourite: connected");
 await evaluate("document.querySelector('#favorites-tracks-list .btn-row-fav').click()");console.log("Shelf favourite: clicked");
 assert.equal(await evaluate("JSON.parse(localStorage.getItem('devsize_favorites')).some(t=>t.platform==='spotify')"),false,'Spotify library failure must not block local favourites');
 await delay(200);assert.equal(await evaluate('cudaPlayer.diagnostics().failed'),false);
 console.log("Shelf check: render");
 await evaluate("document.getElementById('nav-shelf').click()");
 if(process.env.RIFF_GLASS_SCREENSHOTS){const shot=await command('Page.captureScreenshot',{format:'png'});fs.mkdirSync(process.env.RIFF_GLASS_SCREENSHOTS,{recursive:true});fs.writeFileSync(path.join(process.env.RIFF_GLASS_SCREENSHOTS,'cuda-shelf.png'),Buffer.from(shot.data,'base64'));}
 await evaluate('location.reload()');await until('typeof cudaPlayer === "object"');await evaluate("document.getElementById('nav-shelf').click()");
 assert.equal(await evaluate("document.querySelector('#shelf-playlists .shelf-card strong').textContent"),'Late night');
 for(const width of [360,390,680,900,1280]){
  await command('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:false});await delay(100);
  const geometry=await evaluate(`(()=>{const rect=s=>document.querySelector(s).getBoundingClientRect(),mini=rect('#btn-mini-player'),icon=rect('#btn-mini-player svg'),nav=rect('.sidebar'),bar=rect('.playbar');return {overflow:document.documentElement.scrollWidth>innerWidth,gap:bar.left-nav.right,mini:mini.toJSON(),dx:icon.x+icon.width/2-mini.x-mini.width/2,dy:icon.y+icon.height/2-mini.y-mini.height/2};})()`);
  const square=await evaluate("[...document.querySelectorAll('.shelf-card-art')].every(e=>Math.abs(e.getBoundingClientRect().width-e.getBoundingClientRect().height)<1)");assert.equal(square,true,'Square Shelf artwork at '+width);
  assert.equal(geometry.overflow,false,'Shelf overflow '+width);assert.ok(Math.abs(geometry.dx)<1&&Math.abs(geometry.dy)<1,'Mini icon not centered');
  if(width>680)assert.ok(Math.abs(geometry.gap-12)<1,'Sidebar/player gap: '+JSON.stringify(geometry));
  assert.ok(geometry.mini.right<=width&&geometry.mini.top>=0,'Mini corner clipped');
 }
 await command('Emulation.clearDeviceMetricsOverride');
 console.log('Shelf passed: five-tab navigation; playlist create/edit/description/duplicate prevention/persistence; Spotify favourite saved despite failed API sync; regular corner/player spacing at 360/390/680/900/1280.');
};
