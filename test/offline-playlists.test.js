'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {OfflineDownloads}=require('../macos/offline-downloads');const {ShelfSyncService,validateRecords}=require('../macos/shelf-sync');
const track={id:'offline-fixture',platform:'youtube',url:'https://www.youtube.com/watch?v=fixture',title:'Original',artist:'Cuda Sessions'};
function fixture(t,extra={}){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cuda-playlist-offline-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));let calls=0;const downloads=new OfflineDownloads({directory,run:async(bin,args)=>{calls++;const output=args[args.indexOf('-o')+1].replace('%(ext)s','m4a');fs.writeFileSync(output,'original-test-audio');},...extra});return{directory,downloads,calls:()=>calls};}
// Tool execution is replaced in these isolated tests; no provider/account is opened.
process.env.RIFF_YTDLP=process.execPath;require('../platform').clearBinaryCache();
test('playlist downloads live outside sync library and are reused without exporting audio',async t=>{
 const f=fixture(t);const one=await f.downloads.save(track);const two=await f.downloads.save(track);assert.equal(one.filename,two.filename);assert.equal(f.calls(),1);assert.equal(one.hash,crypto.createHash('sha256').update('original-test-audio').digest('hex'));
 const service=new ShelfSyncService({directory:f.directory,store:{decryptString(){throw Error('empty');}},api:async()=>[],offlineDownloads:f.downloads});await service.scan();assert.equal(service.assets.size,0);await service.close();
 assert.equal(fs.existsSync(path.join(f.directory,'library',one.filename)),false);assert.equal(fs.statSync(one.file).mode&0o777,0o600);
 fs.unlinkSync(one.file);await f.downloads.save(track);assert.equal(f.calls(),2,'removed downloads must be recreated');
});
test('Spotify playlist offline uses matching public recordings, never Spotify audio',async t=>{
 let received;const f=fixture(t,{resolve:async value=>{received=value;return track;}});
 const original={...track,platform:'spotify',id:'A'.repeat(22),url:'spotify:track:'+'A'.repeat(22)};const value=await f.downloads.save(original);assert.equal(received.platform,'spotify');assert.equal(value.status,'ready');
 const blocked=fixture(t,{resolve:async value=>value});await assert.rejects(blocked.downloads.save(original),/matching downloadable public/);
});
test('offline jobs reject arbitrary origins and never expose disk paths to paired phones',async t=>{
 const f=fixture(t);for(const url of ['file:///etc/passwd','https://example.com/file','http://youtube.com/watch?v=1','https://user:secret@youtube.com/file'])assert.throws(()=>f.downloads.start({...track,url}),/source/);
 const value=await f.downloads.save(track);assert.equal(f.downloads.status(value.id).file,undefined);assert.equal(f.downloads.file(value.id),value.file);assert.throws(()=>f.downloads.file('0'.repeat(64)),/not ready/);
});
test('playlist covers survive metadata sync while unsafe or oversized image data is omitted',()=>{
 const base={key:'p:fixture',clock:1,device:'mac',deleted:false,playlist:{id:'fixture',name:'Fixture',tracks:[],artwork:'data:image/jpeg;base64,'+Buffer.from('fixture').toString('base64')}};
 assert.equal(validateRecords([base])[0].playlist.artwork,base.playlist.artwork);
 for(const artwork of ['file:///private/image','data:text/html;base64,YQ==','data:image/jpeg;base64,'+'A'.repeat(180001)])assert.equal(validateRecords([{...base,playlist:{...base.playlist,artwork}}])[0].playlist.artwork,undefined);
});
