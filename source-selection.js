'use strict';
const normalize=s=>String(s||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s*-\s*topic$/i,'').replace(/\([^)]*(official|video|audio|lyrics|visualizer)[^)]*\)|\[[^\]]*(official|video|audio|lyrics|visualizer)[^\]]*\]/gi,'').replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
const variants=['live','remix','cover','slowed','reverb','instrumental','sped'];
function score(t,query=''){
  const text=normalize(t.artist+' '+t.title),words=normalize(query).split(' ').filter(Boolean);
  let value=words.reduce((s,w)=>s+(text.includes(w)?12:-8),0)+(t.platform==='local'?90:t.isCached?80:t.platform==='spotify'?60:t.platform==='ytmusic'?45:t.platform==='soundcloud'?25:20);
  if(/official|topic/i.test(t.title+' '+t.artist))value+=8;
  for(const word of variants)if(new RegExp('\\b'+word+'\\b').test(text)&&!new RegExp('\\b'+word+'\\b').test(normalize(query)))value-=35;
  for(const word of variants)if(new RegExp('\\b'+word+'\\b').test(normalize(query))&&!new RegExp('\\b'+word+'\\b').test(text))value-=100;
  if(t.playable===false)value-=1000;
  return value;
}
function titleKey(t){const title=normalize(String(t.title||'').replace(/\s*[([](?:feat\.?|ft\.?)\s[^)\]]*[)\]]/gi,'')),artist=normalize(String(t.artist||'').split(',')[0]);return artist && title.startsWith(artist+' ')?title.slice(artist.length+1):title;}
function sameRecording(a,b){if(a.isrc&&b.isrc)return a.isrc===b.isrc;const at=titleKey(a),bt=titleKey(b);if(!at||at!==bt)return false;if(variants.some(v=>at.includes(v)!==bt.includes(v)))return false;if(a.duration&&b.duration&&Math.abs(a.duration-b.duration)>8)return false;const aa=normalize(String(a.artist||'').split(',')[0]),ba=normalize(String(b.artist||'').split(',')[0]);const unknown=x=>!x||/^unknown(?: artist)?$/.test(x);if(unknown(aa)||unknown(ba))return Boolean(a.duration&&b.duration);return aa===ba||(aa&&ba&&(aa.startsWith(ba+' ')||ba.startsWith(aa+' ')));}
function selectSources(tracks,query='',limit=20){const groups=[];for(const t of tracks.filter(t=>t&&t.id&&t.playable!==false).sort((a,b)=>score(b,query)-score(a,query))){let group=groups.find(g=>sameRecording(g[0],t));if(!group)groups.push(group=[]);if(!group.some(x=>x.platform===t.platform&&x.id===t.id))group.push(t);}return groups.slice(0,limit).map(g=>({...g[0],autoSelected:true,alternatives:g.slice(1).map(t=>{const{alternatives,...rest}=t;return rest;})}));}
module.exports={normalize,score,sameRecording,selectSources};
