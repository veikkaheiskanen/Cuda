'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),https=require('node:https');
const {ShelfSyncService,merge,validateRecords,fileHash}=require('../macos/shelf-sync');const {secureStore}=require('../macos/secure-store');
const track={id:'abc',platform:'spotify',title:'Fixture song',artist:'Cuda Sessions',url:'https://open.spotify.com/track/abc'};
const record=(clock,deleted=false)=>({key:'f:spotify:abc',clock,device:'phone',deleted,...(!deleted?{track}:{})});
function request(service,method,route,body,token=service.config.token,headers={}){
 return new Promise((resolve,reject)=>{const req=https.request({hostname:'127.0.0.1',port:service.server.address().port,path:route,method,rejectUnauthorized:false,headers:{Authorization:'Bearer '+token,...headers,...(body?{'Content-Length':body.length}:{})}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({code:res.statusCode,data:Buffer.concat(chunks)}));});req.on('error',reject);if(body)req.write(body);req.end();});
}
async function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cuda-sync-test-'));fs.mkdirSync(path.join(directory,'library'));const key=crypto.randomBytes(32);let index={};const events=[];
 const api=async(route,body)=>{if(route==='/api/library')return Object.values(index).map(i=>({id:i.id,title:i.title,artist:i.artist,platform:'local',url:''}));if(route==='/api/library-add'){for(const i of body.items)index[i.id]={...i,title:'Fixture audio',artist:'Cuda Sessions'};fs.writeFileSync(path.join(directory,'library.json'),JSON.stringify(index));return{success:true};}throw Error('Unexpected API');};
 const service=new ShelfSyncService({directory,store:secureStore(key),api,emit:e=>events.push(e),listenPort:0});t.after(async()=>{await service.close();fs.rmSync(directory,{recursive:true,force:true});});return{service,directory,key,api,events};
}
test('per-favourite revisions merge offline changes and retain removals across restart',()=>{
 const records={};merge(records,validateRecords([record(1)]));merge(records,validateRecords([record(3,true)]));merge(records,validateRecords([record(2)]));assert.equal(records['f:spotify:abc'].deleted,true);
 const a={...record(4),device:'a'},z={...record(4,true),device:'z'};merge(records,[z,a]);assert.equal(records['f:spotify:abc'].device,'z');
 assert.throws(()=>validateRecords([{...record(Date.now()+90000000)}]));assert.throws(()=>validateRecords([{...record(1),key:'f:spotify:other'}]));
});
test('playlist create, edit and delete sync independently with safe metadata',()=>{
 const playlist={id:'rotation',name:'Rotation',description:'Original fixture',tracks:[{...track,thumbnail:'file:///private/secret',localFile:'/private/account'}]};
 const r=validateRecords([{key:'p:rotation',clock:1,device:'mac',deleted:false,playlist}])[0];assert.equal(r.playlist.description,'Original fixture');assert.equal(r.playlist.tracks[0].thumbnail,undefined);assert.equal(r.playlist.tracks[0].localFile,undefined);
 const records={};merge(records,[r,{key:'p:rotation',clock:2,device:'phone',deleted:true}]);assert.equal(records['p:rotation'].deleted,true);
});
test('encrypted TLS pairing starts from Settings, rejects unauthorized access and persists tombstones',async t=>{
 const {service,directory,key,api}=await fixture(t);assert.equal(service.status().enabled,false);await service.configure({enabled:true});assert.equal(service.status().fingerprint.length,64);
 const unauthorized=await request(service,'POST','/sync/exchange',Buffer.from(JSON.stringify({records:[record(10)]})),'wrong');assert.equal(unauthorized.code,401);assert.equal(Object.keys(service.records).length,0);
 const result=await request(service,'POST','/sync/exchange',Buffer.from(JSON.stringify({records:[record(10,true)]})));assert.equal(result.code,200);assert.equal(JSON.parse(result.data).records[0].deleted,true);
 const config=fs.readFileSync(path.join(directory,'native-sync-config.enc'));assert.equal(config.includes(Buffer.from(service.config.token)),false);assert.equal(fs.statSync(path.join(directory,'native-sync-tls.key')).mode&0o777,0o600);
 const oldToken=service.config.token;await service.configure({reset:true});assert.equal((await request(service,'GET','/sync/health',null,oldToken)).code,401);
 await service.close();const restored=new ShelfSyncService({directory,store:secureStore(key),api,listenPort:0});assert.equal(restored.records['f:spotify:abc'].deleted,true);await restored.close();
});
test('verified audio uploads auto-index, download identically, deduplicate and reject corrupt or unsafe files',async t=>{
 const {service,directory}=await fixture(t);await service.configure({enabled:true});const audio=Buffer.from('Original audio fixture bytes');const hash=crypto.createHash('sha256').update(audio).digest('hex');
 const headers={'X-Cuda-Track':Buffer.from(JSON.stringify({...track,platform:'local',id:'local_'+hash.slice(0,12)})).toString('base64')};
 assert.equal((await request(service,'PUT','/sync/files/'+hash+'?ext=wav',audio,undefined,headers)).code,200);
 assert.equal((await request(service,'PUT','/sync/files/'+hash+'?ext=wav',audio,undefined,headers)).code,200);
 const result=await service.exchange([]);assert.equal(result.assets.length,1);assert.equal(result.assets[0].hash,hash);
 assert.deepEqual((await request(service,'GET','/sync/files/'+hash)).data,audio);
 assert.equal((await request(service,'PUT','/sync/files/'+'0'.repeat(64)+'?ext=wav',audio,undefined,headers)).code,400);
 assert.equal((await request(service,'PUT','/sync/files/'+hash+'?ext=js',audio,undefined,headers)).code,400);
 assert.equal((await request(service,'GET','/sync/files/../../native-sync-tls.key')).code,404);
 assert.equal(fs.readdirSync(directory).filter(n=>n.startsWith('sync-upload-')).length,0);
 await service.configure({offline:false});assert.equal((await service.exchange([])).assets.length,0);assert.equal((await request(service,'GET','/sync/files/'+hash)).code,404);
});
test('new offline files are detected, content hashes refresh and outside symlinks are excluded',async t=>{
 const {service,directory,api}=await fixture(t);const audio=path.join(directory,'library/local_123456789abc.wav');fs.writeFileSync(audio,'One');await api('/api/library-add',{items:[{id:'local_123456789abc',file:path.basename(audio),name:'Fixture'}]});await service.scan();const first=[...service.assets.keys()][0];assert.equal(first,await fileHash(audio));fs.writeFileSync(audio,'Second');assert.equal(await service.scan(),true);assert.notEqual([...service.assets.keys()][0],first);
 fs.unlinkSync(audio);fs.symlinkSync(path.join(directory,'native-sync-records.json'),audio);fs.writeFileSync(path.join(directory,'native-sync-records.json'),'private data');await service.scan();assert.equal(service.assets.size,0);
});

test('listening events sync over pinned service without becoming favourites or file assets',async t=>{
 const {service}=await fixture(t);await service.configure({enabled:true,offline:false});
 const health=JSON.parse((await request(service,'GET','/sync/health')).data),h={key:'h:spotify:abc',clock:Date.now(),device:'phone',deleted:false,track:{...track,localFile:'private-download.m4a'}};
 const result=await request(service,'POST','/sync/exchange',Buffer.from(JSON.stringify({records:[h],history:true})));assert.equal(result.code,200);
 const envelope=JSON.parse(result.data);assert.equal(envelope.assets.length,0);assert.deepEqual(envelope.records.map(r=>r.key),['h:spotify:abc']);assert.equal(envelope.records[0].track.localFile,undefined);
 assert.notEqual(JSON.parse((await request(service,'GET','/sync/health')).data).revision,health.revision);
 const legacy=await request(service,'POST','/sync/exchange',Buffer.from(JSON.stringify({records:[]})));assert.equal(JSON.parse(legacy.data).records.length,0,'Old iOS must never see history as favourites');
 const newer={...h,clock:h.clock+1,device:'mac'};await service.exchange([newer]);await service.exchange([h]);assert.equal(service.records[h.key].device,'mac');
 assert.throws(()=>validateRecords([{...h,key:'h:spotify:other'}]));
});
