'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {profileFor,rankRecommendations,createRecommendations,createGenreLookup}=require('../recommendations');
const {enabledServices}=require('../streaming-services');
const {publicTrack,createAudius}=require('../audius-service');
const track=(id,artist,genres=[],title=id)=>({id,title,artist,genres,platform:'youtube',url:'https://youtube.com/watch?v='+id,duration:180});
test('listened genres are weighted by recency, never guessed from moods or unplayed favourites',()=>{
 const p=profileFor([track('a','Recent',['Finnish hip hop']),track('b','Old',['Rock'])],[track('c','Liked',['Jazz'])]);
 assert.deepEqual(p.genres,['finnish hip hop','rock']);assert.equal(p.artists[0].name,'Recent');assert(!p.genres.includes('jazz'));
});
test('recommendations enforce genres, deduplicate recordings across providers and diversify artists',()=>{
 const history=[track('heard','Rap',['Hip hop'])],p=profileFor(history,[]);
 const a=track('new','Rap',[],'Fresh'); const dup={...a,id:'dup',platform:'soundcloud'};
 const candidates=[history[0],a,dup,track('new2','Rap'),track('new3','Rap'),track('other','New',['Hip hop']),track('rock','Rock',['Rock'])];
 const result=rankRecommendations(candidates,p,history,'hip hop');
 assert.equal(result.length,3);assert(!result.some(t=>['heard','rock','new3','dup'].includes(t.id)));
});
test('genre selection changes query seeds and source opt-outs reach every discovery call',async()=>{
 const history=[track('rap','Rapper',['Hip hop']),track('rock','Rocker',['Rock'])],calls=[];
 const recommend=createRecommendations({lookup:async t=>t,search:async(q,s)=>{calls.push([q,s]);return [track('fresh','Rocker',['Rock'])];}});
 const value=await recommend({history,genre:'rock',enabled:['youtube']});
 assert.equal(value.genre,'rock');assert.deepEqual(calls.map(c=>c[0]),['Rocker','rock music']);assert(calls.every(c=>c[1].join()==='youtube'));assert.equal(value.tracks.length,1);
 calls.length=0;assert.equal((await recommend({history,enabled:[]})).tracks.length,0);assert.equal(calls.length,0);
});
test('provider choices reject unknown services, keep a phone narrower than its host and add Audius only by opt-in',()=>{
 assert(!enabledServices(undefined).includes('audius'));assert.deepEqual(enabledServices([],['youtube']),[]);assert.deepEqual(enabledServices('spotify,youtube,evil',['youtube']),['youtube']);
});
test('genre lookup uses exact recording credits and authoritative genres, with serialized caching',async()=>{
 let calls=0;
 const lookup=createGenreLookup({pause:async()=>{},fetcher:async url=>{calls++;return{ok:true,json:async()=>url.includes('recording?')?{recordings:[{title:'Song','artist-credit':[{artist:{name:'Artist',id:'11111111-1111-1111-1111-111111111111'}}]}]}:{genres:[{name:'Finnish hip hop',count:3}]}};}});
 const t=track('id','Artist',[],'Song');assert.deepEqual((await lookup(t)).genres,['finnish hip hop']);assert.deepEqual((await lookup(t)).genres,['finnish hip hop']);assert.equal(calls,2);
 const missing=await lookup(track('unknown','Someone',[],'Other'));assert.deepEqual(missing.genres,[]);
});
test('Audius rejects gated, unavailable and restricted songs; public streams use its supported endpoint',async()=>{
 const t={id:'Y96Ry',title:'Track',permalink:'/artist/track',duration:180,user:{name:'Artist'},genre:'Tech House',is_available:true,is_streamable:true,is_downloadable:true};
 assert.equal(publicTrack(t).platform,'audius');assert.equal(publicTrack({...t,is_stream_gated:true}),null);assert.equal(publicTrack({...t,allowed_api_keys:['private']}),null);assert.equal(publicTrack({...t,is_available:false}),null);
 const api=createAudius({fetcher:async()=>({ok:true,json:async()=>({data:t})})});const result=await api.stream(t.id);assert.equal(result.streamUrl,'https://api.audius.co/v1/tracks/Y96Ry/stream?app_name=Cuda');assert.equal(result.metadata.downloadable,true);
});
test('fallback genres require an exact song and artist match and normalize catalogue genre labels',async()=>{
 const lookup=createGenreLookup({pause:async()=>{},fetcher:async url=>({ok:true,json:async()=>url.includes('itunes')?{results:[{trackName:'Toivottavasti',artistName:'Ares',primaryGenreName:'Hip-Hop/Rap'}]}:{recordings:[]}})});
 assert.deepEqual((await lookup(track('id','Ares',[],'Toivottavasti'))).genres,['hip hop']);
 assert.deepEqual((await lookup(track('id2','Other Artist',[],'Toivottavasti'))).genres,[]);
});
test('refresh rotation preserves artist caps and suppresses very long mixes for a song listener',()=>{
 const history=[track('heard','A',['Electronic'])],p=profileFor(history,[]);
 const long={...track('mix','DJ',['Electronic']),duration:5000};
 const result=rankRecommendations([track('old','A'),track('new','A'),track('new2','A'),long],p,history,'all',20,['youtube:old']);
 assert.deepEqual(result.map(t=>t.id),['new','new2']);
});
test('regional catalogue fallback finds local releases using the configured device market',async()=>{
 let market;
 const lookup=createGenreLookup({country:'FI',pause:async()=>{},fetcher:async url=>{const u=new URL(url);if(u.hostname==='itunes.apple.com')market=u.searchParams.get('country');return{ok:true,json:async()=>u.hostname==='itunes.apple.com'?{results:[{trackName:'Toivottavasti',artistName:'Ares',primaryGenreName:'Hip-Hop/Rap'}]}:{recordings:[]}};}});
 assert.deepEqual((await lookup(track('region','Ares',[],'Toivottavasti'))).genres,['hip hop']);assert.equal(market,'FI');
});
test('discovery rejects namesake uploaders, comedy interviews and unsolicited altered recordings',()=>{
 const history=[track('played','Artist',['Hip hop'])],profile=profileFor(history,[]);
 const candidates=[track('interview','Artist',[],'Artist stand up haastattelu'),track('namesake','Artist',[],'Other Artist - New song'),track('slowed','Artist',[],'Artist - Song slowed instrumental'),track('unrelated','Unrelated',[],'Random music'),track('good','Artist',[],'Fresh song')];
 assert.deepEqual(rankRecommendations(candidates,profile,history).map(t=>t.id),['good']);
});
test('genre lookup matches collaboration credits in either order and searches the primary performer',async()=>{
 let term;
 const lookup=createGenreLookup({country:'FI',pause:async()=>{},fetcher:async url=>{const u=new URL(url);if(u.hostname==='itunes.apple.com')term=u.searchParams.get('term');return{ok:true,json:async()=>u.hostname==='itunes.apple.com'?{results:[{trackName:'Song',artistName:'Second & First',primaryGenreName:'Hip-Hop/Rap'}]}:{recordings:[]}};}});
 assert.deepEqual((await lookup(track('duet','First, Second',[],'Song'))).genres,['hip hop']);assert.equal(term,'First Song');
});
