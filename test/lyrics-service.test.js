'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {LyricsService}=require('../macos/lyrics-service'),{secureStore}=require('../macos/secure-store');
const track={title:'Fixture song',artist:'Cuda Sessions'};
function fixture(t,fetchImpl,fallback){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cuda-lyrics-check-')),store=secureStore(crypto.randomBytes(32));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return{directory,store,service:new LyricsService({directory,store,fetchImpl,fallback})};}
const response=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
test('provider keys stay encrypted, are not returned to the UI, and survive selective saves',t=>{
 const {directory,store,service}=fixture(t);service.configure({musixmatch:'private-mmx-key',genius:'private-genius-key',territory:'fi'});service.configure({musixmatch:'',lyricfindSearch:'private-lf-search',lyricfindDisplay:'private-lf-display'});
 assert.deepEqual(service.status(),{hasKeys:true,musixmatch:true,genius:true,lyricfind:true,territory:'FI'});
 const bytes=fs.readFileSync(path.join(directory,'native-lyrics-providers.enc'));assert.equal(bytes.includes(Buffer.from('private')),false);assert.equal(fs.statSync(service.file).mode&0o777,0o600);assert.equal(JSON.stringify(service.status()).includes('private'),false);
 const reopened=new LyricsService({directory,store});assert.deepEqual(reopened.status(),service.status());assert.throws(()=>service.configure({territory:'invalid'}),/two-letter/);service.configure({clear:true});assert.equal(service.status().musixmatch,false);
});
test('Musixmatch preserves credits and executes its display pixel only once after display',async t=>{
 const requests=[];const {service}=fixture(t,async(url,options)=>{requests.push({url:new URL(url),options});return response({message:{header:{status_code:200},body:{lyrics:{lyrics_body:'Original fixture line\nAnother fixture line',lyrics_copyright:'Fixture copyright',backlink_url:'https://www.musixmatch.com/lyrics/fixture',pixel_tracking_url:'https://tracking.musixmatch.com/pixel'}}}});});
 service.configure({musixmatch:'test-mmx-key'});const value=await service.get({...track,provider:'musixmatch'});assert.match(value.text,/fixture line/);assert.equal(value.copyright,'Fixture copyright');assert.equal(requests[0].url.hostname,'api.musixmatch.com');assert.equal(requests[0].url.searchParams.get('q_artist'),track.artist);assert.equal(requests[0].url.searchParams.get('apikey'),'test-mmx-key');assert.equal(requests.length,1);
 await service.viewed(value.displayToken);await service.viewed(value.displayToken);assert.equal(requests.length,2);assert.equal(requests[1].url.hostname,'tracking.musixmatch.com');
});
test('LyricFind searches the recording, then displays by ISRC with its separate licensed key',async t=>{
 const urls=[];const {service}=fixture(t,async raw=>{const url=new URL(raw);urls.push(url);return url.pathname==='/search.do'?response({response:{code:100},tracks:[{title:'Wrong recording',artist:'Someone',isrc:'USAAA0000001'},{title:track.title,artist:{name:track.artist},isrc:'USAAA0000002'}]}):response({response:{code:101},track:{lyrics:'An original lyric fixture',copyright:'Fixture publisher'}});});
 service.configure({lyricfindSearch:'search-key',lyricfindDisplay:'display-key',territory:'FI'});const value=await service.get({...track,provider:'lyricfind'});assert.equal(value.text,'An original lyric fixture');assert.equal(urls[1].searchParams.get('trackid'),'isrc:USAAA0000002');assert.equal(urls[0].searchParams.get('apikey'),'search-key');assert.equal(urls[1].searchParams.get('apikey'),'display-key');assert.equal(urls[1].searchParams.get('territory'),'FI');
});
test('Genius metadata lookup uses a token and returns an exact song page without scraping lyrics',async t=>{
 const requests=[];const {service}=fixture(t,async(raw,options)=>{requests.push({url:new URL(raw),options});return response({response:{hits:[{result:{title:'Wrong song',primary_artist:{name:'Someone'},url:'https://genius.com/wrong-lyrics'}},{result:{title:track.title,primary_artist:{name:track.artist},url:'https://genius.com/cuda-sessions-fixture-song-lyrics'}}]}});});
 service.configure({genius:'genius-token'});const value=await service.get({...track,provider:'genius'});assert.equal(value.url,'https://genius.com/cuda-sessions-fixture-song-lyrics');assert.equal(value.text,'');assert.equal(requests.length,1);assert.equal(requests[0].options.headers.Authorization,'Bearer genius-token');assert.equal(requests[0].url.hostname,'api.genius.com');
});
test('rejected provider access falls back automatically and manual selection keeps the error clear',async t=>{
 const {service}=fixture(t,async()=>response({message:{header:{status_code:401}}}),async()=> '[00:01.00]Original fixture line');service.configure({musixmatch:'rejected-secret'});
 await assert.rejects(service.get({...track,provider:'musixmatch'}),/Musixmatch access was rejected/);const value=await service.get(track);assert.equal(value.provider,'lrclib');assert.match(value.text,/00:01/);assert.equal(JSON.stringify(value).includes('rejected-secret'),false);
});
test('missing keys offer provider links, territory restrictions and unsafe links are respected',async t=>{
 const {service}=fixture(t,async()=>response({message:{header:{status_code:200},body:{lyrics:{restricted:1,lyrics_body:'Must not display'}}}}));
 for(const provider of ['lyricfind','musixmatch','genius']){const value=await service.get({...track,provider});assert.equal(value.text,'');assert.equal(new URL(value.url).protocol,'https:');}
 service.configure({musixmatch:'key'});const value=await service.get({...track,provider:'musixmatch'});assert.equal(value.text,'');assert.match(value.message,/territory/);await assert.rejects(service.get({...track,provider:'unknown'}),/Unknown/);
});
