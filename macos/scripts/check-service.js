'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const app=path.join(path.resolve(process.argv[2]||'dist/Cuda.app'),'Contents/Resources'),check=path.resolve(process.argv[3]||'macos/build/stream-checks'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'cuda-native-service-check-'));
fs.chmodSync(profile,0o700);
const child=spawn(path.join(app,'runtime/node'),[path.join(app,'backend/macos/native-host.js')],{env:{...process.env,RIFF_DATA_DIR:profile,RIFF_YTDLP:path.join(app,'tools/bin/yt-dlp'),RIFF_FFMPEG:path.join(app,'tools/bin/ffmpeg'),RIFF_FFPROBE:path.join(app,'tools/bin/ffprobe'),RIFF_RIFFSPOTIFYPLAYER:path.join(app,'tools/bin/riff-spotify-player')},stdio:['pipe','pipe','pipe']});
let buffer='',id=0;const pending=new Map();child.stdout.on('data',data=>{buffer+=data;let line;while((line=buffer.indexOf('\n'))>=0){const v=JSON.parse(buffer.slice(0,line));buffer=buffer.slice(line+1);const cb=pending.get(v.id);if(cb){pending.delete(v.id);v.error?cb.reject(new Error(v.error)):cb.resolve(v.data);}}});child.stderr.resume();
function rpc(method,args){return new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});child.stdin.write(JSON.stringify({id:key,method,args})+'\n');});}
(async()=>{try{
 const init=await rpc('init',{key:crypto.randomBytes(32).toString('base64')});
 if(!init.port||init.status.connected)throw Error('Invalid isolated init');
 const presence=await rpc('discordConfigure',{enabled:false,clientID:''});if(presence.connected||presence.message!=='Off')throw Error('Discord was not disabled by default');
 await rpc('discordConfigure',{enabled:true,clientID:'invalid'}).then(()=>{throw Error('Invalid Discord application accepted');},error=>{if(!error.message.includes('Application ID'))throw error;});
 await rpc('discordUpdate',{track:{title:'Fixture',artist:'Cuda Sessions',platform:'local',url:'file:///private/fixture.wav'},playing:true,duration:30,position:0});
 await rpc('api',{path:'https://example.com/api/library'}).then(()=>{throw Error('Foreign API URL accepted');},()=>{});
 const tracks=await rpc('import',{paths:[path.resolve('macos/Cuda/Resources/preview.wav')]});
 if(!tracks.length)throw Error('No imported audio');
 if((await fetch(`http://127.0.0.1:${init.port}/api/library`)).status!==401)throw Error('Loopback library has no access control');
 if((await fetch(`http://127.0.0.1:${init.port}/api/library?native_token=${encodeURIComponent('é'.repeat(64))}`)).status!==401)throw Error('Invalid capability was accepted');
 const stream=await rpc('api',{path:'/api/stream-info?id='+tracks[0].id+'&platform=local&url='});const url=stream.streamUrl;
 const result=await new Promise((resolve,reject)=>{const test=spawn(check,[url,path.join(app,'tools/bin/cuda-audio-decoder')],{stdio:['ignore','pipe','pipe']});let out='';test.stdout.on('data',d=>out+=d);test.stderr.on('data',d=>out+=d);test.on('exit',code=>code===0?resolve(out):reject(Error(out)));});
 console.log(result.trim());console.log('PASS: packaged private RPC, Discord configuration, API origin validation, import and loopback audio service');
 }finally{const closed=new Promise(resolve=>child.once('exit',resolve));child.stdin.end();const timer=setTimeout(()=>child.kill('SIGTERM'),2000);await closed;clearTimeout(timer);fs.rmSync(profile,{recursive:true,force:true});}})().catch(error=>{console.error(error.message);process.exitCode=1;});
