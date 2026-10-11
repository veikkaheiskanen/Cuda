const test=require('node:test'),assert=require('node:assert/strict');
const {choosePlaybackSource}=require('../playback-resolver');
const original={id:'one',platform:'youtube',url:'https://youtube.com/watch?v=one',title:'Song',artist:'Artist',duration:180};
const alternative={...original,id:'two',platform:'soundcloud'};
test('slow extractor never holds up a ready matching alternative',async()=>{
 const start=Date.now();const result=await choosePlaybackSource({original,candidates:[alternative],hedge:10,timeout:200,resolve:t=>t===original?new Promise(()=>{}):Promise.resolve({streamUrl:'ready'})});
 assert.equal(result.track.id,'two');assert.ok(Date.now()-start<150);
});
test('discovery publishes matches before its slowest provider completes',async()=>{
 const result=await choosePlaybackSource({original,hedge:1,timeout:100,resolve:t=>t===original?new Promise(()=>{}):Promise.resolve({streamUrl:'ready'}),discover:add=>{add([alternative]);return new Promise(()=>{});}});assert.equal(result.track.id,'two');
});
test('a different recording or extracted metadata cannot replace the requested song',async()=>{
 await assert.rejects(choosePlaybackSource({original,candidates:[{...alternative,artist:'Unknown artist',duration:0}],hedge:1,timeout:100,resolve:t=>t===original?Promise.reject(new Error('unavailable')):Promise.resolve({metadata:{artist:'Different Artist',duration:180}})}),/different recording/);
});
test('cancelled playback ignores late extraction and cannot overwrite a newer song',async()=>{
 const cancellation=new AbortController();const result=choosePlaybackSource({original,resolve:()=>new Promise(()=>{}),signal:cancellation.signal,timeout:100});cancellation.abort();await assert.rejects(result,{name:'AbortError'});
});
test('failed sources are excluded and matching extraction concurrency stays bounded',async()=>{
 let active=0,max=0,started=[];const result=await choosePlaybackSource({original,candidates:[alternative,{...alternative,id:'three'},{...alternative,id:'four'}],excluded:['soundcloud:two'],hedge:1,timeout:200,resolve:async t=>{started.push(t.id);active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,t.id==='one'?30:5));active--;if(t.id==='one')throw new Error('unavailable');return {streamUrl:'ready'};}});assert.equal(result.track.id,'three');assert.ok(max<=2);assert.ok(!started.includes('two'));
});
