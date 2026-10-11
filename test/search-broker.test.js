const test=require('node:test'),assert=require('node:assert/strict');
const {createSearchBroker}=require('../search-broker');
test('ready search results arrive before slow providers, and concurrent/repeated queries share work',async()=>{
  const search=createSearchBroker();let release,calls=0;const updates=[];
  const providers=[async()=>{calls++;return [{id:'fast'}];},()=>new Promise(r=>release=r)];
  const rank=t=>t;const first=search('query',providers,rank,v=>updates.push(v));
  await new Promise(setImmediate);
  assert.equal(updates[0].tracks[0].id,'fast');assert.equal(updates[0].complete,false);
  const second=search('query',providers,rank);release([{id:'slow'}]);
  assert.deepEqual((await first).tracks,[{id:'fast'},{id:'slow'}]);await second;
  assert.equal((await search('query',providers,rank)).complete,true);assert.equal(calls,1);
});
test('failed and stalled providers cannot suppress ready results or permanently poison the cache',async()=>{
  let time=0;const search=createSearchBroker({timeout:15,ttl:10,now:()=>time});
  const result=await search('q',[()=>Promise.reject(Error('offline')),()=>new Promise(()=>{}),()=>[{id:'ok'}]],t=>t);
  assert.equal(result.tracks[0].id,'ok');assert.equal(result.complete,true);
  time=11;assert.equal((await search('q',[()=>[{id:'new'}]],t=>t)).tracks[0].id,'new');
  await search('empty',[()=>[]],t=>t);
  assert.equal((await search('empty',[()=>[{id:'recovered'}]],t=>t)).success,true);
});
