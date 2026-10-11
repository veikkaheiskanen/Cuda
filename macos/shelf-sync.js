'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),https=require('node:https');
const {pipeline}=require('node:stream/promises');const {Transform}=require('node:stream');const {execFile}=require('node:child_process');const {promisify}=require('node:util');
const hashPattern=/^[a-f0-9]{64}$/,extensions=new Set(['mp3','m4a','aac','wav','flac','aif','aiff','ogg','opus','webm','mp4']);
const MAX_FILE=512*1024*1024;
function cleanTrack(value){
 if(!value||typeof value.id!=='string'||value.id.length>160||typeof value.platform!=='string'||!['local','spotify','youtube','ytmusic','soundcloud'].includes(value.platform))throw Error('Invalid song.');
 const t={id:value.id,title:String(value.title||'Untitled').slice(0,300),artist:String(value.artist||'Unknown artist').slice(0,300),platform:value.platform,url:''};
 for(const key of ['url','thumbnail'])if(typeof value[key]==='string'){try{const u=new URL(value[key]);if(u.protocol==='https:'&&!u.username&&!u.password&&![...u.searchParams.keys()].some(k=>['pair','token','native_token'].includes(k)))t[key]=u.href;}catch{}}
 if(Number.isFinite(value.duration)&&value.duration>=0)t.duration=value.duration;
 return t;
}
function validateRecords(input){
 if(!Array.isArray(input)||input.length>20000)throw Error('Shelf is too large.');
 return input.map(r=>{
  if(!r||typeof r.key!=='string'||r.key.length>220||!/^[fp]:/.test(r.key)||!Number.isSafeInteger(r.clock)||r.clock<0||r.clock>Date.now()+86400000||typeof r.device!=='string'||r.device.length>80||typeof r.deleted!=='boolean')throw Error('Invalid Shelf revision.');
  const value={key:r.key,clock:r.clock,device:r.device,deleted:r.deleted};
  if(!r.deleted){if(r.key.startsWith('f:')){value.track=cleanTrack(r.track);if(r.key!==`f:${value.track.platform}:${value.track.id}`)throw Error('Invalid favourite.');}
  else {const p=r.playlist;if(!p||typeof p.id!=='string'||r.key!=='p:'+p.id||!Array.isArray(p.tracks)||p.tracks.length>10000)throw Error('Invalid playlist.');value.playlist={id:p.id,name:String(p.name||'Playlist').slice(0,80),description:String(p.description||'').slice(0,300),tracks:p.tracks.map(cleanTrack)};if(typeof p.spotifyID==='string'&&/^[A-Za-z0-9]{1,80}$/.test(p.spotifyID))value.playlist.spotifyID=p.spotifyID;}}
  return value;
 });
}
function merge(records,incoming){for(const r of incoming){const old=records[r.key];if(!old||old.clock<r.clock||old.clock===r.clock&&old.device<r.device)records[r.key]=r;}}
async function fileHash(file){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');}
class ShelfSyncService {
 constructor({directory,store,api,emit=()=>{},listenPort=38474,companion=null}){
  this.companion=companion;
  this.directory=directory;this.store=store;this.api=api;this.emit=emit;this.listenPort=listenPort;this.records={};this.assets=new Map();this.cache=new Map();this.queue=Promise.resolve();this.config={enabled:false,offline:true,id:crypto.randomUUID(),token:crypto.randomBytes(32).toString('hex')};
  try{this.config={...this.config,...JSON.parse(store.decryptString(fs.readFileSync(path.join(directory,'native-sync-config.enc'))))};}catch{}
  try{this.records=JSON.parse(fs.readFileSync(path.join(directory,'native-sync-records.json'),'utf8'));}catch{}
 }
 atomic(file,data){const target=path.join(this.directory,file),temp=target+'.'+crypto.randomUUID();fs.writeFileSync(temp,data,{mode:0o600});fs.renameSync(temp,target);}
 serial(fn){const result=this.queue.then(fn);this.queue=result.catch(()=>{});return result;}
 async certificate(){
  const key=path.join(this.directory,'native-sync-tls.key'),cert=path.join(this.directory,'native-sync-tls.pem');
  if(!fs.existsSync(key)||!fs.existsSync(cert)){
   const temp=fs.mkdtempSync(path.join(this.directory,'sync-cert-'));
   try{await promisify(execFile)('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(temp,'key'),'-out',path.join(temp,'cert'),'-days','3650','-subj','/CN=Cuda Device Sync'],{timeout:15000});fs.chmodSync(path.join(temp,'key'),0o600);fs.chmodSync(path.join(temp,'cert'),0o600);fs.renameSync(path.join(temp,'key'),key);fs.renameSync(path.join(temp,'cert'),cert);}finally{fs.rmSync(temp,{recursive:true,force:true});}
  }
  const pem=fs.readFileSync(cert);this.fingerprint=crypto.createHash('sha256').update(new crypto.X509Certificate(pem).raw).digest('hex');return{key:fs.readFileSync(key),cert:pem,minVersion:'TLSv1.2'};
 }
 async configure(values={}){return this.serial(async()=>{
  if(typeof values.enabled==='boolean')this.config.enabled=values.enabled;
  if(typeof values.offline==='boolean')this.config.offline=values.offline;
  if(values.reset){this.config.token=crypto.randomBytes(32).toString('hex');}
  if(!this.config.enabled&&this.server){this.server.closeAllConnections();await new Promise(resolve=>this.server.close(resolve));this.server=null;clearInterval(this.timer);}
  if(this.config.enabled&&!this.server){
   try{this.server=https.createServer(await this.certificate(),(req,res)=>this.handle(req,res));this.server.requestTimeout=120000;this.server.headersTimeout=15000;
    await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(this.listenPort,'0.0.0.0',resolve);});
    await this.scan();this.timer=setInterval(()=>this.serial(async()=>{const changed=await this.scan();if(changed)this.emit({event:'syncChanged'});}).catch(()=>{}),10000);this.timer.unref();
   }catch{this.server?.close();this.server=null;this.config.enabled=false;throw Error('Device sync could not start. Check that port 38474 is free and allow local network access.');}
  }
  await this.companion?.configure(!!this.server,!!values.reset);
  this.atomic('native-sync-config.enc',this.store.encryptString(JSON.stringify(this.config)));return this.status();
 });}
 status(){const port=this.server?.address()?.port||0;const addresses=Object.values(os.networkInterfaces()).flat().filter(i=>i&&i.family==='IPv4'&&!i.internal&&(/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address))).map(i=>'https://'+i.address+':'+port);
  return{enabled:!!this.server,offline:this.config.offline,id:this.config.id,port,addresses,fingerprint:this.fingerprint||'',token:this.server?this.config.token:'',message:this.server?'Ready to pair · encrypted connection':'Off'};
 }
 async scan(){
  if(!this.config.offline){this.assets.clear();return false;}
  const library=path.join(this.directory,'library');fs.mkdirSync(library,{recursive:true});const realRoot=await fs.promises.realpath(library);const tracks=await this.api('/api/library');let index={};try{index=JSON.parse(fs.readFileSync(path.join(this.directory,'library.json'),'utf8'));}catch{}
  const before=[...this.assets.keys()].sort().join();this.assets.clear();
  for(const track of tracks){const filename=index[track.id]?.file;if(typeof filename!=='string'||path.basename(filename)!==filename||!extensions.has(path.extname(filename).slice(1)))continue;
   try{const file=path.join(library,filename),real=await fs.promises.realpath(file);if(!real.startsWith(realRoot+path.sep))continue;const st=await fs.promises.stat(real);if(!st.isFile()||st.size>MAX_FILE)continue;
    const tag=st.size+':'+st.mtimeMs+':'+st.ctimeMs;let saved=this.cache.get(real);if(!saved||saved.tag!==tag){saved={tag,hash:await fileHash(real)};this.cache.set(real,saved);}
    const hash=saved.hash,t=cleanTrack(track);t.id='local_'+hash.slice(0,12);t.platform='local';this.assets.set(hash,{hash,filename:'local_'+hash.slice(0,12)+path.extname(filename),size:st.size,track:t,file:real});
   }catch{}
  }
  return before!==[...this.assets.keys()].sort().join();
 }
 async exchange(input){return this.serial(async()=>{const incoming=validateRecords(input);merge(this.records,incoming);this.atomic('native-sync-records.json',JSON.stringify(this.records));await this.scan();return{records:Object.values(this.records),assets:[...this.assets.values()].map(({file,...a})=>a),offline:this.config.offline};});}
 async handle(req,res){
  const fail=(code,error)=>{if(!res.headersSent)res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});if(!res.writableEnded)res.end(JSON.stringify({error}));};
  try{
   const supplied=Buffer.from(String(req.headers.authorization||'').replace(/^Bearer /,'')),expected=Buffer.from(this.config.token);
   if(!this.config.enabled||supplied.length!==expected.length||!crypto.timingSafeEqual(supplied,expected))return fail(401,'Pair this Mac again in Settings.');
   const u=new URL(req.url,'https://localhost');res.setHeader('Cache-Control','no-store');
   if(u.pathname==='/sync/health'&&req.method==='GET'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({id:this.config.id,version:1,companion:!!this.companion}));}
   if(u.pathname==='/sync/companion'&&req.method==='GET'){
    if(!this.companion)return fail(404,'Update Cuda on your Mac to connect streaming automatically.');
    res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(this.companion.status()));
   }
   if(u.pathname==='/sync/exchange'&&req.method==='POST'){
    const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>8000000)return fail(413,'Shelf is too large.');chunks.push(chunk);}
    const input=JSON.parse(Buffer.concat(chunks));const result=await this.exchange(input.records);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));this.emit({event:'syncChanged'});return;
   }
   const hash=u.pathname.slice('/sync/files/'.length);if(!u.pathname.startsWith('/sync/files/')||!hashPattern.test(hash)||!this.config.offline)return fail(404,'Offline song not found.');
   if(req.method==='GET'){
    const asset=this.assets.get(hash);if(!asset)return fail(404,'Offline song not found.');
    res.setHeader('Content-Length',asset.size);res.setHeader('Content-Type','application/octet-stream');await pipeline(fs.createReadStream(asset.file,{flags:fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW}),res);return;
   }
   if(req.method==='PUT'){
    const ext=u.searchParams.get('ext');if(!extensions.has(ext))return fail(400,'Unsupported audio format.');
    const size=Number(req.headers['content-length']);if(!Number.isSafeInteger(size)||size<=0||size>MAX_FILE)return fail(413,'Audio files must be under 512 MB.');
    const total=[...this.assets.values()].reduce((sum,a)=>sum+a.size,0);if(!this.assets.has(hash)&&total+size>50*1024**3)return fail(507,'Sync storage limit reached.');
    let track;try{track=cleanTrack(JSON.parse(Buffer.from(String(req.headers['x-cuda-track']||''),'base64').toString()));}catch{return fail(400,'Invalid song metadata.');}
    const temp=path.join(this.directory,'sync-upload-'+crypto.randomUUID());let actual=0;const digest=crypto.createHash('sha256');
    try{
     await pipeline(req,new Transform({transform(chunk,encoding,next){actual+=chunk.length;if(actual>size)return next(Error('Size mismatch'));digest.update(chunk);next(null,chunk);}}),fs.createWriteStream(temp,{flags:'wx',mode:0o600}));
     if(actual!==size||digest.digest('hex')!==hash)throw Error('Audio checksum failed. Retry sync.');
     await this.serial(async()=>{const id='local_'+hash.slice(0,12),filename=id+'.'+ext,dest=path.join(this.directory,'library',filename);fs.mkdirSync(path.dirname(dest),{recursive:true});if(!fs.existsSync(dest))fs.renameSync(temp,dest);
      const known=(await this.api('/api/library')).some(t=>t.id===id);if(!known)await this.api('/api/library-add',{items:[{id,file:filename,ext,name:track.artist+' - '+track.title}]});await this.scan();});
     res.setHeader('Content-Type','application/json');res.end('{"ok":true}');this.emit({event:'syncChanged'});
    }finally{fs.rmSync(temp,{force:true});}return;
   }
   fail(405,'Unsupported sync request.');
  }catch{if(!res.destroyed)fail(400,'Sync could not finish. Your local music is unchanged; retry when connected.');}
 }
 async close(){clearInterval(this.timer);await this.companion?.close();if(this.server){this.server.closeAllConnections();await new Promise(resolve=>this.server.close(resolve));this.server=null;}}
}
module.exports={ShelfSyncService,validateRecords,merge,fileHash};
