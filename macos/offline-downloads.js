'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnTool,terminateTool}=require('../tool-processes'),{ytDlpCommand,resolveBinary}=require('../platform');
const {fileHash}=require('./shelf-sync');
class OfflineDownloads {
 constructor({directory,resolve=async t=>t,run=null}){this.directory=directory;this.root=path.join(directory,'offline-playlists');fs.mkdirSync(this.root,{recursive:true,mode:0o700});this.resolve=resolve;this.run=run||this.execute;this.jobs=new Map();}
 validate(t){
  if(!t||typeof t.id!=='string'||t.id.length>160||!['spotify','youtube','ytmusic','soundcloud','audius','local'].includes(t.platform))throw Error('Invalid offline song.');
  if(t.platform==='local')return;
  if(t.platform==='spotify'&&/^spotify:track:[A-Za-z0-9]{22}$/.test(t.url||''))return;
  let u;try{u=new URL(t.url);}catch{throw Error('This song has no public source.');}
  const domains={spotify:['open.spotify.com'],youtube:['youtube.com','youtu.be'],ytmusic:['youtube.com'],soundcloud:['soundcloud.com'],audius:['audius.co']};
  if(u.protocol!=='https:'||u.username||u.password||!domains[t.platform].some(d=>u.hostname===d||u.hostname.endsWith('.'+d)))throw Error('Invalid offline source.');
 }
 execute(bin,args){return new Promise((resolve,reject)=>{const process=spawnTool(bin,args,{windowsHide:true});let error='';process.stdout.resume();process.stderr.on('data',d=>{error=(error+d).slice(-2000);});const timeout=setTimeout(()=>{terminateTool(process);reject(Error('Offline download timed out. Retry this song.'));},120000);process.once('error',e=>{clearTimeout(timeout);reject(e);});process.once('close',code=>{clearTimeout(timeout);code===0?resolve():reject(Error(/sign in|login|bot/i.test(error)?'This source requires authorization on your Mac.':/DRM|protected/i.test(error)?'This source does not allow this download.':'The public source could not be downloaded.'));});});}
 start(track){
  this.validate(track);const id=crypto.createHash('sha256').update(track.platform+':'+track.id).digest('hex');
  const existing=this.jobs.get(id);if(existing?.status==='working'||existing?.status==='ready'&&fs.existsSync(existing.file))return{id,status:existing.status};
  if([...this.jobs.values()].filter(j=>j.status==='working').length>=2)throw Error('Two songs are already downloading. Retry shortly.');
  while(this.jobs.size>=100){const key=[...this.jobs].find(([,j])=>j.status!=='working')?.[0];if(!key)throw Error('Download queue is full.');this.jobs.delete(key);}
  const job={id,status:'working'};this.jobs.set(id,job);
  job.promise=this.download(track,id).then(value=>Object.assign(job,value,{status:'ready'})).catch(error=>Object.assign(job,{status:'failed',error:error.message}));
  return{id,status:job.status};
 }
 status(id){const job=this.jobs.get(id);if(!job)throw Error('Download not found. Retry this song.');const {promise,file,...value}=job;return value;}
 file(id){const job=this.jobs.get(id);if(!job||job.status!=='ready'||!fs.existsSync(job.file))throw Error('Download is not ready.');return job.file;}
 async save(track){const {id}=this.start(track);await this.jobs.get(id).promise;const job=this.jobs.get(id);if(job.status!=='ready')throw Error(job.error);return{...this.status(id),file:job.file};}
 async download(original,id){
  const filename=id+'.m4a',file=path.join(this.root,filename);
  if(!fs.existsSync(file)){
   const temp=path.join(this.root,'.'+id+'-'+crypto.randomUUID()),output=temp+'.m4a';
   try{
    if(original.platform==='local'){
     const index=JSON.parse(fs.readFileSync(path.join(this.directory,'library.json'))),name=index[original.id]?.file;
     if(typeof name!=='string'||path.basename(name)!==name)throw Error('Imported audio not found.');
     const library=await fs.promises.realpath(path.join(this.directory,'library')),input=await fs.promises.realpath(path.join(library,name));if(!input.startsWith(library+path.sep))throw Error('Invalid imported audio.');
     const ffmpeg=resolveBinary('ffmpeg');if(!ffmpeg)throw Error('Install the audio tools first.');await this.run(ffmpeg,['-nostdin','-v','error','-i',input,'-vn','-c:a','aac','-b:a','192k','-y',output]);
    }else{
     // Spotify recordings are resolved to matching PUBLIC sources, never its DRM audio.
     const track=await this.resolve(original);if(track.platform==='spotify'||track.platform==='local')throw Error('No matching downloadable public recording was found.');this.validate(track);
     if(track.platform==='audius'){
      if(!track.downloadable||!track.streamUrl?.startsWith('https://api.audius.co/v1/tracks/'))throw Error('This Audius artist has not enabled downloads.');
      const ffmpeg=resolveBinary('ffmpeg');if(!ffmpeg)throw Error('Install the audio tools first.');await this.run(ffmpeg,['-nostdin','-v','error','-i',track.streamUrl,'-vn','-c:a','aac','-b:a','192k','-y',output]);
     }else {
     const command=ytDlpCommand(['--no-playlist','--no-warnings','-f','bestaudio[format_id!*=preview]/best[format_id!*=preview]','-x','--audio-format','m4a','--audio-quality','0','--add-metadata','-o',temp+'.%(ext)s',track.url]);await this.run(command.bin,command.args);
     }
    }
    const stat=await fs.promises.stat(output);if(!stat.isFile()||stat.size<=0||stat.size>512*1024*1024)throw Error('Offline songs must be under 512 MB.');await fs.promises.rename(output,file);await fs.promises.chmod(file,0o600);
   }finally{for(const name of fs.readdirSync(this.root))if(name.startsWith(path.basename(temp)))fs.rmSync(path.join(this.root,name),{force:true});}
  }
  return{filename,file,hash:await fileHash(file),size:fs.statSync(file).size};
 }
}
module.exports={OfflineDownloads};
