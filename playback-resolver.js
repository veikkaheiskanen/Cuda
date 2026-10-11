'use strict';
const {sameRecording,normalize}=require('./source-selection');
const key=t=>`${t.platform}:${t.id}`;
function potentialMatch(original,candidate){
  if(sameRecording(original,candidate))return true;
  // Flat search entries need extractor metadata before they can win.
  if(candidate.duration && candidate.artist && !/unknown/i.test(candidate.artist))return false;
  const title=normalize(original.title),other=normalize(candidate.title),artist=normalize(original.artist);
  return title.length>2 && (other===title || other===`${artist} ${title}`);
}
function choosePlaybackSource({original,candidates=[],resolve,discover,signal,timeout=30000,hedge=450,excluded=[]}) {
  return new Promise((accept,reject)=>{
    const seen=new Set(excluded),started=new Set(),queue=[],timers=new Set();let active=0,finished=false,discovered=false,lastError;
    const schedule=(fn,ms)=>{const timer=setTimeout(()=>{timers.delete(timer);fn();},ms);timers.add(timer);return timer;};
    const cleanup=()=>{finished=true;for(const timer of timers)clearTimeout(timer);signal?.removeEventListener('abort',abort);};
    const abort=()=>{cleanup();reject(Object.assign(new Error('Playback cancelled'),{name:'AbortError'}));};
    const fail=()=>{cleanup();const error=lastError || new Error('No matching audio source started. Try another source.');error.attempted=[...started];reject(error);};
    const add=items=>{
      if(finished)return;
      for(const track of items || []) {
        if(!track?.id||track.playable===false||seen.has(key(track)))continue;
        if(key(track)!==key(original)&&!potentialMatch(original,track))continue;
        seen.add(key(track));queue.push(track);
      }
      pump();
    };
    const pump=()=>{
      if(finished)return;
      while(queue.length && (active<2 || queue.some(t=>t.platform==='spotify'))){
        const index=active<2?0:queue.findIndex(t=>t.platform==='spotify');
        const track=queue.splice(index,1)[0],cost=track.platform==='spotify'?0:1;active+=cost;started.add(key(track));
        Promise.resolve().then(()=>resolve(track)).then(stream=>{
          if(finished)return;
          const metadata=Object.fromEntries(Object.entries(stream.metadata||{}).filter(([k,v])=>v && !(k==='artist'&&/unknown/i.test(v))));
          const selected={...track,...metadata};
          if(key(track)!==key(original)&&!sameRecording(original,selected))throw new Error('The alternative is a different recording.');
          cleanup();accept({track:selected,stream,alternatives:candidates.filter(t=>key(t)!==key(track)&&sameRecording(selected,t))});
        }).catch(error=>{if(!finished)lastError=error;}).finally(()=>{active-=cost;if(!finished){pump();if(discovered&&!active&&!queue.length)fail();}});
      }
    };
    if(signal?.aborted)return abort();
    signal?.addEventListener('abort',abort,{once:true});
    schedule(fail,timeout);
    // Start the requested recording immediately. Hedge against slow extractors.
    add([original]);
    schedule(()=>add(candidates),hedge);
    schedule(()=>{
      if(!discover){discovered=true;if(!active&&!queue.length)fail();return;}
      Promise.resolve().then(()=>discover(add)).catch(error=>{lastError=error;}).finally(()=>{discovered=true;if(!finished&&!active&&!queue.length)fail();});
    },candidates.length?hedge*2:hedge);
  });
}
module.exports={choosePlaybackSource,potentialMatch};
