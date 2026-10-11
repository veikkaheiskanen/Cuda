const test=require('node:test'),assert=require('node:assert/strict');
const {streamFromInfo,streamExpiry}=require('../stream-utils');
test('HLS detection uses protocol even without a playlist extension',()=>{
 const value=streamFromInfo({url:'https://cdn.example/opaque-stream',protocol:'m3u8_native',http_headers:{Referer:'https://provider.example/track','User-Agent':'Provider agent',Cookie:'session=private',Host:'wrong','X-Evil':'bad',Origin:'bad\r\ninjected:true'}});
 assert.equal(value.isHls,true);assert.deepEqual(value.headers,{'referer':'https://provider.example/track','user-agent':'Provider agent',cookie:'session=private'});
});
test('chosen audio format retains both provider and format headers',()=>{
 const value=streamFromInfo({http_headers:{Referer:'https://provider.example'},requested_formats:[{url:'https://cdn.example/video',vcodec:'vp9'},{url:'https://cdn.example/audio',vcodec:'none',http_headers:{'User-Agent':'Audio'}}]});
 assert.equal(value.url,'https://cdn.example/audio');assert.equal(value.isHls,false);assert.equal(value.headers.referer,'https://provider.example');assert.equal(value.headers['user-agent'],'Audio');
});
test('stream extraction rejects absent and non-HTTP media',()=>{for(const value of [null,{},{url:'file:///private/a'},{entries:[]}])assert.throws(()=>streamFromInfo(value),/audio stream/);});
test('signed stream URLs expire before their provider deadline',()=>{const now=1000000;assert.equal(streamExpiry('https://cdn.example/audio?expire=1100',now),1040000);assert.equal(streamExpiry('https://cdn.example/audio?expires=999',now),939000);assert.equal(streamExpiry('https://cdn.example/audio',now),now+600000);});
