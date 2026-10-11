'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { spawn } = require('child_process');
const readline = require('readline');
const {normalizeAudioSettings}=require('./audio-settings');
const API = 'https://api.spotify.com/v1/';
const REDIRECT = 'http://127.0.0.1:8898/callback';
const PLAYBACK_REDIRECT = 'http://127.0.0.1:8898/login';
const SCOPES = 'user-read-private playlist-read-private playlist-read-collaborative user-library-read user-library-modify';
const idOK = value => typeof value === 'string' && /^[a-zA-Z0-9]{22}$/.test(value);
function track(item) {
  if (!item || item.type && item.type !== 'track' || !idOK(item.id)) return null;
  return {id:item.id,title:item.name || 'Untitled',artist:(item.artists || []).map(a=>a.name).join(', '),artistIds:(item.artists || []).map(a=>a.id).filter(idOK),duration:(item.duration_ms || 0)/1000,thumbnail:item.album?.images?.[0]?.url || '',url:'spotify:track:'+item.id,uri:'spotify:track:'+item.id,platform:'spotify',albumId:item.album?.id,album:item.album?.name,isrc:item.external_ids?.isrc,playable:item.is_playable!==false};
}
class NativePlayer {
  constructor(binary, emit) { this.binary=binary;this.emit=emit;this.pending=new Map();this.serial=0; }
  start() {
    if(this.child) return;
    if(!fs.existsSync(this.binary)) throw new Error('Native Spotify playback is available in the Apple Silicon build.');
    const child=this.child=spawn(this.binary,[],{stdio:['pipe','pipe','pipe']});
    // Playback diagnostics never contain credentials and are kept out of renderer logs.
    child.stderr.on('data',()=>{});
    readline.createInterface({input:child.stdout}).on('line',line=>{
      let value;try{value=JSON.parse(line);}catch{return;}
      if(value.id) {const p=this.pending.get(value.id);if(p){clearTimeout(p.timer);this.pending.delete(value.id);value.success?p.resolve(value.data):p.reject(new Error(value.error));}}
      else {if(value.event==='diagnostic')this.lastError=value.error;else if(value.event==='error'&&this.lastError)value.error=this.lastError;else if(value.event==='playing')this.lastError=null;this.emit(value);}
    });
    const closed=()=>{if(this.child!==child)return;this.child=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Spotify player stopped. Reconnect in Settings.'));}this.pending.clear();this.emit({event:'error',error:'Spotify player stopped. Reconnect in Settings.'});};
    child.on('error',closed);child.on('exit',closed);child.stdin.on('error',()=>{});
  }
  command(command,args={}) {
    this.start();const id=++this.serial;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Spotify player timed out. Reconnect in Settings.'));},35000);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({...args,id,command})+'\n');});
  }
  close(){const child=this.child;this.child=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Spotify playback stopped.'));}this.pending.clear();if(child)child.kill();}
}
function createSpotify({directory,safeStorage,openExternal,emit=()=>{},fetchImpl=fetch,binary,now=Date.now}) {
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const stateFile=path.join(directory,'spotify-library.json'),tokenFile=path.join(directory,'spotify-account.enc'),cacheDir=path.join(directory,'spotify-playback-v2'),legacyCacheDir=path.join(directory,'spotify-player');
  let state={clientId:'',profile:null,selected:[],tracks:[],shelf:[],dismissed:[],weekly:null,previousWeekly:[],plays:{},likedTracks:[],lastfm:{username:'',apiKey:''}};
  try{const raw=JSON.parse(fs.readFileSync(stateFile,'utf8'));for(const key of Object.keys(state))if(raw[key]!==undefined)state[key]=raw[key];}catch{}
  for(const key of ['selected','tracks','shelf','dismissed'])if(!Array.isArray(state[key]))state[key]=[];
  if(!/^[a-f0-9]{32}$/i.test(state.clientId))state.clientId='';
  let token=null,refreshing=null,login=null,connectedPlayer=false, connecting=null;
  const native=new NativePlayer(binary,value=>{if(value.event==='error')connectedPlayer=false;emit(value);});
  const save=(notify=true)=>{fs.writeFileSync(stateFile,JSON.stringify(state),{mode:0o600});if(notify)emit({event:'library',...status()});};
  function status(){if(!token && fs.existsSync(tokenFile) && safeStorage?.isEncryptionAvailable()){try{const saved=JSON.parse(safeStorage.decryptString(fs.readFileSync(tokenFile)));if(typeof saved.access_token==='string'&&typeof saved.refresh_token==='string')token=saved;}catch{}}return {clientId:state.clientId,connected:Boolean(token?.access_token),playbackConnected:fs.existsSync(path.join(cacheDir,'credentials.json')),profile:state.profile,selected:state.selected,tracks:state.tracks,shelf:state.shelf,weekly:state.weekly,lastfm:state.lastfm,likedTracks:state.likedTracks,redirect:REDIRECT,nativeAvailable:fs.existsSync(binary)};}
  function storeToken(value){if(!safeStorage.isEncryptionAvailable())throw new Error('macOS Keychain encryption is unavailable. Unlock your keychain and try again.');token={...value,expiresAt:now()+(value.expires_in||3600)*1000};fs.writeFileSync(tokenFile,safeStorage.encryptString(JSON.stringify(token)),{mode:0o600});}
  async function tokenRequest(body){const response=await fetchImpl('https://accounts.spotify.com/api/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body).toString(),signal:AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok)throw new Error(data.error_description||'Spotify sign-in expired. Reconnect in Settings.');return data;}
  async function accessToken(){
    if(!token){try{if(!safeStorage.isEncryptionAvailable())throw new Error();token=JSON.parse(safeStorage.decryptString(fs.readFileSync(tokenFile)));}catch{throw new Error('Connect Spotify in Settings first.');}}
    if(token.expiresAt>now()+60000)return token.access_token;
    if(!refreshing)refreshing=tokenRequest({grant_type:'refresh_token',refresh_token:token.refresh_token,client_id:state.clientId}).then(value=>{storeToken({...value,refresh_token:value.refresh_token||token.refresh_token});return token.access_token;}).finally(()=>refreshing=null);
    return refreshing;
  }
  async function api(endpoint,{method='GET',body,retry=true}={}){
    if(typeof endpoint!=='string'||endpoint.startsWith('/')||endpoint.includes('://'))throw new Error('Invalid Spotify endpoint');
    const response=await fetchImpl(API+endpoint,{method,headers:{Authorization:'Bearer '+await accessToken(),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
    if(response.status===401&&retry){token.expiresAt=0;await accessToken();return api(endpoint,{method,body,retry:false});}
    if(response.status===429)throw new Error('Spotify is limiting requests. Try again in '+(response.headers.get('retry-after')||'a few')+' seconds.');
    if(!response.ok){let data={};try{data=await response.json();}catch{}throw new Error(response.status===403?'Spotify denied access. Check Premium and add your account to the app’s allowed users.':data.error?.message||'Spotify request failed ('+response.status+').');}
    if(response.status===204)return {};
    // Library mutations may return 200 with no response body.
    if(method!=='GET') {if(typeof response.text==='function'){const text=await response.text();return text.trim()?JSON.parse(text):{};}try{return await response.json();}catch(error){if(error instanceof SyntaxError)return {};throw error;}}
    return response.json();
  }
  async function pages(endpoint){let result=[],offset=0;for(let page=0;page<200;page++){const data=await api(endpoint+(endpoint.includes('?')?'&':'?')+'limit=50&offset='+offset);result.push(...(data.items||[]));if(!data.next||!data.items?.length)break;offset+=data.items.length;}return result;}
  async function connect(clientId){
    if(login)throw new Error('Spotify sign-in is already open in your browser.');
    if(!/^[a-f0-9]{32}$/i.test(clientId||''))throw new Error('Paste the 32-character Client ID from your Spotify app.');
    if(state.clientId&&clientId!==state.clientId)await disconnect();
    state.clientId=clientId;save();
    const value=await authorize(clientId,REDIRECT,SCOPES);
    storeToken(value);
    state.profile=await api('me');save();if(state.selected.length)await sync();return status();
  }
  async function authorize(clientId,redirect,scopes){
    if(login)throw new Error('Spotify sign-in is already open in your browser.');
    const verifier=crypto.randomBytes(48).toString('base64url'),nonce=crypto.randomBytes(32).toString('base64url'),challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
    const code=await new Promise((resolve,reject)=>{
      let settled=false;
      const server=http.createServer((req,res)=>{
        res.setHeader('Connection','close');
        const url=new URL(req.url,redirect);
        if(url.pathname!==new URL(redirect).pathname){res.writeHead(404);res.end();return;}
        if(url.searchParams.get('state')!==nonce){res.writeHead(400);res.end('Invalid sign-in state. Return to Cuda and try again.');return;}
        if(url.searchParams.get('error')){res.end('Sign-in cancelled. You can close this tab.');finish(new Error('Spotify sign-in cancelled.'));return;}
        const code=url.searchParams.get('code');if(!code){res.writeHead(400);res.end('Missing code.');return;}
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"});res.end('<!doctype html><title>Cuda</title><h1>Sign-in complete</h1><p>You can close this tab and return to the app.</p>');finish(null,code);
      });
      function finish(error,code){if(settled)return;settled=true;clearTimeout(timer);server.close();login=null;error?reject(error):resolve(code);}
      const timer=setTimeout(()=>finish(new Error('Sign-in timed out. Try connecting again.')),180000);login=()=>finish(new Error('Sign-in cancelled.'));
      server.on('error',()=>finish(new Error('Sign-in port 8898 is busy. Close other Spotify sign-in windows and try again.')));
      server.listen(8898,'127.0.0.1',()=>{const url=new URL('https://accounts.spotify.com/authorize');url.search=new URLSearchParams({client_id:clientId,response_type:'code',redirect_uri:redirect,scope:scopes,state:nonce,code_challenge_method:'S256',code_challenge:challenge}).toString();Promise.resolve(openExternal(url.href)).catch(()=>finish(new Error('Could not open Spotify sign-in.')));});
    });
    return tokenRequest({grant_type:'authorization_code',code,redirect_uri:redirect,client_id:clientId,code_verifier:verifier});
  }
  async function connectPlayback(){
    if(!status().connected)throw new Error('Connect your Spotify library first.');
    const config=await native.command('status');
    if(!/^[a-f0-9]{32}$/i.test(config.clientId||''))throw new Error('Update Cuda to enable Spotify playback sign-in.');
    const value=await authorize(config.clientId,PLAYBACK_REDIRECT,'streaming');
    // This token belongs only to the native playback session. It never replaces
    // the user's Web API app token or enters the renderer/local music server.
    native.close();connectedPlayer=false;connecting=null;
    await native.command('login',{clientId:config.clientId,token:value.access_token,cacheDir});
    connectedPlayer=true;save();return status();
  }
  async function disconnect(){login?.();native.close();connectedPlayer=false;token=null;fs.rmSync(tokenFile,{force:true});fs.rmSync(cacheDir,{recursive:true,force:true});fs.rmSync(legacyCacheDir,{recursive:true,force:true});state.profile=null;state.tracks=[];state.selected=[];state.shelf=[];state.dismissed=[];state.weekly=null;state.likedTracks=[];state.plays={};save();return status();}
  async function playlists(){const items=await pages('me/playlists');return items.filter(p=>idOK(p.id)).map(p=>({id:p.id,name:p.name,owner:p.owner?.display_name,accessible:p.owner?.id===state.profile?.id||p.collaborative===true,selected:state.selected.includes(p.id)}));}
  function invalidateWeekly(){if(state.weekly)state.previousWeekly=[...new Set([...(state.previousWeekly||[]),...state.weekly.items.map(a=>a.id)])].slice(-500);state.weekly=null;}
  async function sync(ids=state.selected){
    if(!Array.isArray(ids)||ids.length>100||ids.some(id=>!idOK(id)))throw new Error('Invalid playlist selection.');
    const available=await playlists();const allowed=new Set(available.filter(p=>p.accessible).map(p=>p.id));if(ids.some(id=>!allowed.has(id)))throw new Error('Select playlists you own or collaborate on.');
    const collected=[];for(const id of ids){const items=await pages('playlists/'+id+'/items');for(const item of items){const t=track(item.item||item.track);if(t&&t.playable)collected.push(t);}}
    const tracks=[...new Map(collected.map(t=>[t.id,t])).values()];if(JSON.stringify(tracks.map(t=>t.id))!==JSON.stringify(state.tracks.map(t=>t.id))||JSON.stringify(ids)!==JSON.stringify(state.selected))invalidateWeekly();state.tracks=tracks;state.selected=[...ids];state.syncedAt=now();save();return status();
  }
  async function search(query,type='track'){if(!['track','album','artist'].includes(type))throw new Error('Invalid search type.');const data=await api('search?q='+encodeURIComponent(String(query).slice(0,250))+'&type='+type+'&limit=10');return type==='track'?(data.tracks?.items||[]).map(track).filter(t=>t?.playable):(data[type+'s']?.items||[]);}
  async function albumTracks(id){if(!idOK(id))throw new Error('Invalid album.');const album=await api('albums/'+id);const items=await pages('albums/'+id+'/tracks');return items.map(item=>track({...item,album})).filter(Boolean);}
  async function shelf(id,remove=false){if(!idOK(id))throw new Error('Invalid album.');if(remove)state.shelf=state.shelf.filter(a=>a.id!==id);else if(!state.shelf.some(a=>a.id===id)){const album=await api('albums/'+id);state.shelf.push({id:album.id,name:album.name,artists:album.artists,images:album.images,tracks:await albumTracks(id)});state.dismissed=state.dismissed.filter(x=>x!==id);}invalidateWeekly();save();return status();}
  async function like(uri,liked){if(typeof uri!=='string'||!/^spotify:(track|album):[a-zA-Z0-9]{22}$/.test(uri))throw new Error('Invalid Spotify item.');await api('me/library?uris='+encodeURIComponent(uri),{method:liked?'PUT':'DELETE'});if(uri.startsWith('spotify:track:')) {const id=uri.split(':').at(-1);state.likedTracks=state.likedTracks.filter(t=>t.id!==id);if(liked){let item=state.tracks.find(t=>t.id===id)||state.shelf.flatMap(a=>a.tracks||[]).find(t=>t.id===id);if(!item){try{item=track(await api('tracks/'+id));}catch{}}if(item)state.likedTracks.push(item);}invalidateWeekly();save();}return {liked};}
  async function ensurePlayer(){if(connectedPlayer)return;if(!status().playbackConnected)throw new Error('Connect Spotify playback in Settings → Integrations. Your library sign-in is already saved.');if(!connecting)connecting=(async()=>{await native.command('login',{clientId:state.clientId,cacheDir});connectedPlayer=true;})().finally(()=>connecting=null);await connecting;}
  async function playback(command,args={}){
    if(!['load','pause','resume','stop','seek','volume','preload','radio','status','effects'].includes(command))throw new Error('Invalid playback command.');
    if(command==='stop'&&!connectedPlayer)return {};
    if(['load','preload','radio'].includes(command)&&!/^spotify:(track|artist):[a-zA-Z0-9]{22}$/.test(args.uri||''))throw new Error('Invalid Spotify URI.');
    if(command==='seek'&&(!Number.isFinite(args.positionMs)||args.positionMs<0))throw new Error('Invalid seek position.');
    if(args.volume!==undefined&&(!Number.isFinite(args.volume)||args.volume<0||args.volume>1))throw new Error('Invalid volume.');
    const effects=args.effects===undefined?undefined:normalizeAudioSettings(args.effects);
    if(command==='effects')return native.command(command,{effects:effects||normalizeAudioSettings(),volume:args.volume});
    await ensurePlayer();const cleanArgs={uri:args.uri,positionMs:args.positionMs,volume:args.volume,play:args.play,effects};return native.command(command,cleanArgs);
  }
  function played(item){if(!item || !idOK(item.id))throw new Error('Invalid played track');if(item.albumId&&idOK(item.albumId))state.plays[item.albumId]=(state.plays[item.albumId]||0)+1;save(false);return {};}
  function lastfm(username,apiKey){if(typeof username!=='string'||typeof apiKey!=='string'||username.length>100||apiKey.length>100)throw new Error('Invalid Last.fm settings.');if(Boolean(username.trim())!==Boolean(apiKey.trim()))throw new Error('Enter both the Last.fm username and API key, or leave both empty.');state.lastfm={username:username.trim(),apiKey:apiKey.trim()};invalidateWeekly();save();return status();}
  async function lastfmData(method,period='overall'){const {username,apiKey}=state.lastfm;if(!username||!apiKey)return [];const url=new URL('https://ws.audioscrobbler.com/2.0/');url.search=new URLSearchParams({method,user:username,api_key:apiKey,format:'json',period,limit:'50'}).toString();const response=await fetchImpl(url.href,{signal:AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok||data.error)throw new Error(data.message||'Last.fm history is unavailable.');return data.topartists?.artist||data.topalbums?.album||[];}
  async function weekly(){
    const week=Math.floor((now()+3*86400000)/(7*86400000));if(state.weekly?.week===week)return state.weekly;
    const seeds=[...state.tracks,...state.likedTracks,...state.shelf.flatMap(a=>a.tracks||[])];const history=await lastfmData('user.gettopartists');const known=await lastfmData('user.gettopalbums');const artists=[...new Set([...history.map(a=>a.name),...seeds.map(t=>t.artist.split(', ')[0])].filter(Boolean))].slice(0,12);
    const excluded=new Set([...state.shelf.map(a=>a.id),...state.dismissed,...(state.previousWeekly||[]),...(state.weekly?.items||[]).map(a=>a.id)]);const candidates=[];
    for(const artist of artists){const albums=await search('artist:'+artist,'album');for(const a of albums)if(!excluded.has(a.id)&&!seeds.some(t=>t.albumId===a.id)&&!(state.plays[a.id]>=3)&&!known.some(k=>Number(k.playcount)>=3&&k.name.toLowerCase()===a.name.toLowerCase())){excluded.add(a.id);candidates.push({...a,reason:'Because you listen to '+artist+'.'});}}
    const items=candidates.slice(0,20);state.previousWeekly=[...new Set([...(state.previousWeekly||[]),...(state.weekly?.items||[]).map(a=>a.id)])].slice(-500);state.weekly={week,items};save();return state.weekly;
  }
  async function dismiss(id){if(!idOK(id))throw new Error('Invalid album.');if(!state.dismissed.includes(id))state.dismissed.push(id);if(state.weekly)state.weekly.items=state.weekly.items.filter(a=>a.id!==id);save();return status();}
  async function radio(genre){const seeds=await search('genre:'+String(genre).replace(/[^\p{L}\p{N} -]/gu,'').slice(0,60));if(!seeds.length)throw new Error('No Spotify tracks found for this genre.');const response=await playback('radio',{uri:seeds[0].uri});return (response.tracks||[]).map(t=>{const id=(t.uri||'').split(':').at(-1);return idOK(id)?{id,uri:t.uri,url:t.uri,platform:'spotify',title:t.metadata?.title||'Untitled',artist:t.metadata?.artist_name||'',albumId:t.album_uri?.split(':').at(-1),album:t.metadata?.album_title||'',duration:0,thumbnail:''}:null;}).filter(Boolean);}
  const operations={status,connect,connectPlayback,disconnect,playlists,sync,search,albumTracks,shelf,like,weekly,dismiss,radio,playback,played,lastfm};
  return {...operations,async invoke(operation,args=[]){if(!Object.hasOwn(operations,operation)||!Array.isArray(args))throw new Error('Unknown Spotify operation.');return operations[operation](...args);},close(){login?.();native.close();}};
}
module.exports={createSpotify,NativePlayer,track,REDIRECT,PLAYBACK_REDIRECT,SCOPES};
