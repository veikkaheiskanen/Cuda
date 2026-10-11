'use strict';
// Only the native app's private stdin/stdout can invoke account operations.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),readline=require('node:readline');
const root=path.resolve(__dirname,'..');
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
console.log=()=>{};console.warn=()=>{};console.error=()=>{};
let spotify,lyrics,shelfSync,port,closing=false,searchAbort;
const discord = new (require('./discord-presence').DiscordPresence)({emit: value => send({event: 'discord', value})});
const serviceToken=crypto.randomBytes(32).toString('hex');
function privateMedia(value) {
 if(typeof value==='string'&&value.startsWith('http://127.0.0.1:')){const u=new URL(value);if(u.port===String(port)||/^\/(api\/(thumbnail|local-thumbnail|local-track|library-file|audio-proxy)|thumbs?\/)/.test(u.pathname)){u.port=String(port);u.searchParams.set('native_token',serviceToken);return u.href;}}
 if(Array.isArray(value))return value.map(privateMedia);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,privateMedia(item)]));
 return value;
}
const allowed=new Set(['/api/search','/api/playback-source','/api/resolve-source','/api/stream-info','/api/library','/api/library-add','/api/library-update','/api/offline-library','/api/vibe','/api/lyrics','/api/download','/api/tools-status','/api/state','/api/artist']);
const {secureStore}=require('./secure-store');
async function invoke(method,args) {
 if(method==='init') {
  if(port)throw new Error('Already initialized');
  const directory=process.env.RIFF_DATA_DIR;
  const {createSpotify}=require('../spotify-service');
  spotify=createSpotify({directory,safeStorage:secureStore(Buffer.from(args.key,'base64')),tokenName:'spotify-account-native.enc',binary:process.env.RIFF_RIFFSPOTIFYPLAYER,openExternal:url=>send({event:'openURL',url}),emit:value=>send({event:'spotify',value})});
  lyrics=new (require('./lyrics-service').LyricsService)({directory,store:secureStore(Buffer.from(args.key,'base64')),fallback:async(title,artist)=>{const value=await invoke('api',{path:'/api/lyrics?'+new URLSearchParams({title,artist})});return value.lyrics||'';}});
  process.env.CUDA_NATIVE_SERVICE_TOKEN=serviceToken;
  const server=require('../server');server.setSpotifyProvider(spotify);port=await server.startServer(0);
  shelfSync=new (require('./shelf-sync').ShelfSyncService)({directory,store:secureStore(Buffer.from(args.key,'base64')),api:(route,body)=>invoke('api',{path:route,body}),emit:send});
  await shelfSync.configure().catch(()=>{});
  const migration=await require('./legacy-shelf').migrateShelf(directory);
  let shelf;try{shelf=privateMedia(JSON.parse(fs.readFileSync(path.join(directory,'native-shelf.json'),'utf8')));}catch{}
  return {port,status:spotify.status(),migration,shelf};
 }
 if(!port)throw new Error('Audio services are starting.');
 if(method==='syncStatus')return shelfSync.status();
 if(method==='syncConfigure')return shelfSync.configure(args);
 if(method==='syncExchange')return shelfSync.exchange(args.records||[]);
 if(method==='downloadOffline'){const downloaded=await invoke('api',args);return invoke('import',{paths:[downloaded.path]});}
 if(method==='discordConfigure')return discord.configure(args.enabled,args.clientID);
 if(method==='discordUpdate'){discord.update(args);return discord.status;}
 if(method==='lyricsStatus')return lyrics.status();
 if(method==='lyricsConfigure')return lyrics.configure(args);
 if(method==='lyricsGet')return lyrics.get(args);
 if(method==='lyricsViewed'){await lyrics.viewed(args.token);return {};}
 if(method==='spotify')return spotify.invoke(args.operation,args.values||[]);
 if(method==='search') {
  searchAbort?.abort();searchAbort=new AbortController();const controller=searchAbort;
  const query=String(args.query||'').slice(0,250);const token=String(args.token||'');
  const u=new URL('/api/search','http://127.0.0.1:'+port);u.search=new URLSearchParams({q:query,platform:'auto',limit:'30',progressive:'1'}).toString();
  const response=await fetch(u,{headers:{'X-Cuda-Native-Token':serviceToken},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(45000)])});if(!response.ok)throw new Error('Search is unavailable. Try again.');
  let tail='',last={tracks:[]};const decoder=new TextDecoder();
  for await(const chunk of response.body){tail+=decoder.decode(chunk,{stream:true});let index;while((index=tail.indexOf('\n'))>=0){const line=tail.slice(0,index);tail=tail.slice(index+1);try{last=JSON.parse(line);send({event:'search',token,value:privateMedia(last)});}catch{}}}
  if(tail.trim()){try{last=JSON.parse(tail);send({event:'search',token,value:privateMedia(last)});}catch{}}
  return privateMedia(last);
 }
 if(method==='api') {
  const u=new URL(args.path,'http://127.0.0.1:'+port);
  if(u.origin!=='http://127.0.0.1:'+port||!allowed.has(u.pathname))throw new Error('Invalid native request');
  const response=await fetch(u,{method:args.body?'POST':'GET',headers:{'X-Cuda-Native-Token':serviceToken,...(args.body?{'Content-Type':'application/json'}:{})},body:args.body?JSON.stringify(args.body):undefined,signal:AbortSignal.timeout(45000)});
  const value=await response.json();if(!response.ok||value.error)throw new Error(value.error||'Audio request failed');return privateMedia(value);
 }
 if(method==='import') {
  const sources=args.paths;if(!Array.isArray(sources)||sources.some(p=>typeof p!=='string'||!path.isAbsolute(p)))throw new Error('Invalid audio files');
  const {LIBRARY_DIR}=require('../platform');const items=await require('../library-import').importAudioFiles(sources,LIBRARY_DIR);
  await invoke('api',{path:'/api/library-add',body:{items}});return invoke('api',{path:'/api/library'});
 }
 throw new Error('Unknown native operation');
}
const lines=readline.createInterface({input:process.stdin});
lines.on('line',async line=>{let message;try{if(line.length>2_000_000)throw new Error('Request too large');message=JSON.parse(line);const data=await invoke(message.method,message.args||{});send({id:message.id,data});}catch(error){if(message?.id)send({id:message.id,error:error.message});}});
async function stop(){if(closing)return;closing=true;await discord.close();await shelfSync?.close();spotify?.close();await require('../server').stopServer().catch(()=>{});process.exit(0);}
lines.on('close',stop);process.on('SIGTERM',stop);process.on('SIGINT',stop);
module.exports={secureStore};
