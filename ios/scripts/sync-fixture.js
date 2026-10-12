'use strict';
// Isolated original audio fixtures only. No user profile or account is opened.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),http=require('node:http');
const {ShelfSyncService,fileHash}=require('../../macos/shelf-sync'),{secureStore}=require('../../macos/secure-store');
(async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cuda-ios-sync-fixture-'));fs.mkdirSync(path.join(directory,'library'));
 const source=path.resolve('ios/Cuda/Resources/preview.wav'),hash=await fileHash(source),id='local_'+hash.slice(0,12),filename=id+'.wav';fs.copyFileSync(source,path.join(directory,'library',filename));
 const track={id,platform:'local',title:'Mac sync fixture',artist:'Cuda Sessions',url:'',duration:30};const index={[id]:{id,file:filename,...track}};
 fs.writeFileSync(path.join(directory,'library.json'),JSON.stringify(index));
 const api=async(route,body)=>{if(route==='/api/library')return Object.values(index);if(route==='/api/library-add'){for(const value of body.items)index[value.id]={...value,platform:'local',title:value.name,artist:'Cuda Sessions'};fs.writeFileSync(path.join(directory,'library.json'),JSON.stringify(index));return{success:true};}throw Error('Unexpected fixture API');};
 const nativeToken=crypto.randomBytes(32).toString('hex'),audio=fs.readFileSync(source);
 const publicTrack={...track,id:'public-fixture',platform:'youtube',title:'Paired streaming fixture',url:'https://example.com/original-fixture'};
 const upstream=http.createServer((req,res)=>{
  if(req.headers['x-cuda-native-token']!==nativeToken){res.writeHead(401);return res.end();}
  if(req.url.startsWith('/api/local-track')){
   const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');let start=0,end=audio.length-1;
   if(range){start=Number(range[1]);end=Math.min(end,range[2]?Number(range[2]):end);if(start>end){res.writeHead(416,{'Content-Range':'bytes */'+audio.length});return res.end();}}
   res.writeHead(range?206:200,{'Content-Type':'audio/wav','Accept-Ranges':'bytes','Content-Length':end-start+1,...(range?{'Content-Range':`bytes ${start}-${end}/${audio.length}`}:{})});return res.end(audio.subarray(start,end+1));
  }
  req.resume();req.on('end',()=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(req.url.startsWith('/api/search')?{tracks:[publicTrack]}:{track:publicTrack,stream:{streamUrl:'http://127.0.0.1:'+upstream.address().port+'/api/local-track?id='+id}}));});
 });
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 const companion=new (require('../../macos/mobile-companion').MobileCompanion)({upstream:'http://127.0.0.1:'+upstream.address().port,serviceToken:nativeToken});
 const service=new ShelfSyncService({directory,api,store:secureStore(crypto.randomBytes(32)),listenPort:38474,companion,integrations:async()=>({spotify:{clientID:'a'.repeat(32),connected:true,accessToken:'isolated-fixture-only',expiresAt:Date.now()+3600000,scope:'playlist-read-private',account:'Test listener'},lyrics:{musixmatch:'isolated-key',territory:'US'},lastfm:{username:'test-listener',apiKey:'isolated-lastfm-key'}})});const status=await service.configure({enabled:true});
 await service.exchange([{key:'p:sync-fixture',clock:1,device:'mac-fixture',deleted:false,playlist:{id:'sync-fixture',name:'Mac sync fixture',description:'Original test music',tracks:[track]}}]);
 const link=new URL('cuda-sync://pair');for(const [key,value] of Object.entries({address:'https://127.0.0.1:'+status.port,key:status.token,cert:status.fingerprint,id:status.id}))link.searchParams.set(key,value);
 fs.writeFileSync('ios/CudaTests/SyncFixture.json',JSON.stringify({link:link.href}));console.log('Isolated TLS sync fixture ready.');
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await service.close();upstream.closeAllConnections();upstream.close();fs.rmSync(directory,{recursive:true,force:true});process.exit(0);});
})().catch(error=>{console.error(error.message);process.exit(1);});
