"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const providers={lyricfind:'LyricFind',musixmatch:'Musixmatch',genius:'Genius',lrclib:'LRCLIB'};
const normalize=text=>String(text||'').toLowerCase().normalize('NFKD').replace(/\p{M}/gu,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function matches(title,artist,candidateTitle,candidateArtist){
 const a=normalize(title),b=normalize(candidateTitle),c=normalize(artist),d=normalize(candidateArtist);
 return !!a&&!!c&&(a===b||b.startsWith(a+' ')||a.startsWith(b+' '))&&(c===d||c.includes(d)&&d.length>2||d.includes(c)&&c.length>2);
}
function lyricsResult(provider,text='',extra={}){return{provider,label:providers[provider],text,...extra};}
function safeLink(raw,domain){try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&(u.hostname===domain||u.hostname.endsWith('.'+domain))?u.href:undefined;}catch{return undefined;}}
class LyricsService{
 constructor({directory,store,fetchImpl=fetch,fallback=async()=>''}){
  this.store=store;this.fetch=fetchImpl;this.fallback=fallback;this.file=path.join(directory,'native-lyrics-providers.enc');this.keys={};this.revision=0;this.tracking=new Map();
  try{this.keys=JSON.parse(store.decryptString(fs.readFileSync(this.file)));}catch{}
 }
 status(){return{hasKeys:['musixmatch','lyricfindSearch','lyricfindDisplay','genius'].some(key=>!!this.keys[key]),musixmatch:!!this.keys.musixmatch,lyricfind:!!this.keys.lyricfindSearch&&!!this.keys.lyricfindDisplay,genius:!!this.keys.genius,territory:this.keys.territory||'US'};}
 configure(values){
  const next={...this.keys};
  if(values.clear){this.keys={};this.persist();return this.status();}
  for(const key of ['musixmatch','lyricfindSearch','lyricfindDisplay','genius'])if(typeof values[key]==='string'&&values[key].trim()){if(values[key].length>1024)throw Error('Provider key is too long.');next[key]=values[key].trim();}
  if(values.territory!==undefined){const territory=String(values.territory).toUpperCase().trim();if(!/^[A-Z]{2}$/.test(territory))throw Error('Use a two-letter lyrics territory code.');next.territory=territory;}
  this.keys=next;this.persist();return this.status();
 }
 persist(){this.revision++;this.tracking.clear();const temporary=this.file+'.'+crypto.randomUUID();fs.writeFileSync(temporary,this.store.encryptString(JSON.stringify(this.keys)),{mode:0o600});fs.renameSync(temporary,this.file);}
 async json(url,headers={}){
  let response;try{response=await this.fetch(url,{headers:{'User-Agent':'Cuda/1.0.4',...headers},signal:AbortSignal.timeout(8000),redirect:'error'});}catch{throw Error('Lyrics provider is unavailable. Try another source.');}
  if(!response.ok)throw Error(response.status===401||response.status===403?'Provider access was rejected. Check the key and subscription in Settings.':'Lyrics provider is unavailable. Try another source.');
  const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>2000000)throw Error('Lyrics response was too large.');chunks.push(Buffer.from(chunk));}
  try{return JSON.parse(Buffer.concat(chunks).toString());}catch{throw Error('Lyrics provider returned an invalid response.');}
 }
 async musixmatch(track){
  if(!this.keys.musixmatch)return lyricsResult('musixmatch','',{message:'Add your Musixmatch API key in Settings → Lyrics.',url:'https://www.musixmatch.com/'});
  const url=new URL('https://api.musixmatch.com/ws/1.1/matcher.lyrics.get');url.search=new URLSearchParams({apikey:this.keys.musixmatch,q_track:track.title,q_artist:track.artist,format:'json'}).toString();
  const data=await this.json(url),status=data.message?.header?.status_code,lyrics=data.message?.body?.lyrics;
  if(status===401||status===402||status===403)throw Error('Musixmatch access was rejected. Check your key and lyrics access in Settings.');
  if(status!==200||!lyrics||lyrics.restricted)return lyricsResult('musixmatch','',{message:'Musixmatch has no lyrics available for this song in your territory.',url:'https://www.musixmatch.com/'});
  const result=lyricsResult('musixmatch',String(lyrics.lyrics_body||''),{copyright:String(lyrics.lyrics_copyright||''),instrumental:lyrics.instrumental===1,url:safeLink(lyrics.backlink_url,'musixmatch.com')||'https://www.musixmatch.com/'});
  const pixel=safeLink(lyrics.pixel_tracking_url,'musixmatch.com');if(pixel){const token=crypto.randomUUID();this.tracking.set(token,pixel);result.displayToken=token;if(this.tracking.size>50)this.tracking.delete(this.tracking.keys().next().value);}
  return result;
 }
 async lyricfind(track){
  if(!this.keys.lyricfindSearch||!this.keys.lyricfindDisplay)return lyricsResult('lyricfind','',{message:'Add licensed LyricFind Search and Display keys in Settings → Lyrics.',url:'https://lyrics.lyricfind.com/'});
  const search=new URL('https://api.lyricfind.com/search.do');search.search=new URLSearchParams({apikey:this.keys.lyricfindSearch,reqtype:'default',searchtype:'track',artist:track.artist,track:track.title,output:'json',territory:this.keys.territory||'US'}).toString();
  const data=await this.json(search);if(data.response?.code!==100)throw Error('LyricFind search was rejected. Check your licensed Search key and territory.');
  const candidates=Array.isArray(data.tracks)?data.tracks:data.tracks?.track||[];
  const found=candidates.find(item=>matches(track.title,track.artist,item.title||item.track,item.artist?.name||item.artist));
  if(!found)return lyricsResult('lyricfind','',{message:'No matching lyrics found on LyricFind.',url:'https://lyrics.lyricfind.com/'});
  const isrc=String(Array.isArray(found.isrc)?found.isrc[0]:found.isrc||'').toUpperCase();const trackID=/^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/.test(isrc)?'isrc:'+isrc:null;if(!trackID)throw Error('LyricFind did not return a supported ISRC for this song.');
  const display=new URL('https://api.lyricfind.com/lyric.do');display.search=new URLSearchParams({apikey:this.keys.lyricfindDisplay,reqtype:'default',trackid:trackID,output:'json',territory:this.keys.territory||'US'}).toString();
  const body=await this.json(display);if(body.response?.code!==101)throw Error('LyricFind display was rejected. Check your Display key and licensed territory.');
  const value=body.track||body;return lyricsResult('lyricfind',typeof value.lyrics==='string'?value.lyrics:'',{copyright:String(value.copyright||value.lyrics_copyright||''),instrumental:value.instrumental===true||value.instrumental===1,url:safeLink(value.url,'lyricfind.com')||'https://lyrics.lyricfind.com/'});
 }
 async genius(track){
  const searchURL='https://genius.com/search?q='+encodeURIComponent(track.artist+' '+track.title);
  if(!this.keys.genius)return lyricsResult('genius','',{message:'Read the lyrics and annotations on Genius. Add a Genius access token in Settings for direct song lookup.',url:searchURL});
  const url=new URL('https://api.genius.com/search');url.searchParams.set('q',track.artist+' '+track.title);
  const data=await this.json(url,{Authorization:'Bearer '+this.keys.genius});
  const found=(data.response?.hits||[]).map(hit=>hit.result).find(item=>matches(track.title,track.artist,item.title,item.primary_artist?.name));
  return lyricsResult('genius','',{message:found?'Read the full lyrics and annotations on Genius.':'No exact Genius match found. Search Genius for this song.',url:safeLink(found?.url,'genius.com')||searchURL});
 }
 async get(args){
  const title=String(args.title||'').trim().slice(0,250),artist=String(args.artist||'').trim().slice(0,250),provider=String(args.provider||'auto');
  if(!title||!artist)throw Error('Choose a song to see its lyrics.');
  const track={title,artist};if(['lyricfind','musixmatch','genius'].includes(provider))return this[provider](track);
  if(provider!=='auto')throw Error('Unknown lyrics provider.');
  const errors=[];
  for(const name of ['lyricfind','musixmatch'])if(this.status()[name]){try{const result=await this[name](track);if(result.text||result.instrumental)return result;}catch(error){errors.push(error.message);}}
  try{const text=await this.fallback(title,artist);if(text)return lyricsResult('lrclib',text,{url:'https://lrclib.net/'});}catch{}
  let result;try{result=await this.genius(track);}catch(error){errors.push(error.message);result=lyricsResult('genius','',{message:'Search for lyrics on Genius.',url:'https://genius.com/search?q='+encodeURIComponent(artist+' '+title)});}if(errors.length)result.message=errors.join(' ')+' '+result.message;return result;
 }
 async viewed(token){const url=this.tracking.get(token);if(!url)return;this.tracking.delete(token);try{const response=await this.fetch(url,{signal:AbortSignal.timeout(5000),redirect:'error'});await response.body?.cancel();}catch{}}
}
module.exports={LyricsService,matches};
