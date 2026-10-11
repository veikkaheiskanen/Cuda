'use strict';

// Share provider requests, publish ready results immediately, and retain only
// a bounded, short-lived cache. A slow provider never delays the first update.
function createSearchBroker({ttl=60000,timeout=14000,maxEntries=64,now=Date.now}={}) {
  const cache=new Map(),pending=new Map();
  return async function search(key,providers,rank,onUpdate=()=>{}) {
    const cached=cache.get(key);
    if(cached && cached.expires>now()) {onUpdate(cached.result);return cached.result;}
    cache.delete(key);
    let job=pending.get(key);
    if(!job) {
      job={listeners:new Set(),latest:null};pending.set(key,job);
      job.promise=(async()=>{
        const batches=new Array(providers.length).fill(null);let completed=0;
        await Promise.all(providers.map(async(provider,index)=>{
          let timer;
          try {batches[index]=await Promise.race([Promise.resolve().then(provider),new Promise(resolve=>{timer=setTimeout(()=>resolve([]),timeout);})]);}
          catch {batches[index]=[];} finally {clearTimeout(timer);}
          const tracks=rank(batches.flatMap(items=>Array.isArray(items)?items:[]));
          job.latest={success:tracks.length>0,tracks,complete:++completed===providers.length};
          for(const listener of job.listeners)listener(job.latest);
        }));
        if(!job.latest)job.latest={success:false,tracks:[],complete:true};
        if(job.latest.success) {
          while(cache.size>=maxEntries)cache.delete(cache.keys().next().value);
          cache.set(key,{expires:now()+ttl,result:job.latest});
        }
        return job.latest;
      })().finally(()=>pending.delete(key));
    }
    job.listeners.add(onUpdate);if(job.latest)onUpdate(job.latest);
    try{return await job.promise;}finally{job.listeners.delete(onUpdate);}
  };
}
module.exports={createSearchBroker};
