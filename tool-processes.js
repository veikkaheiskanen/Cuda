'use strict';
const {spawn}=require('node:child_process');
const active=new Set();
function spawnTool(binary,args,options={}){
  // The packaged Python launcher, JS runtime and FFmpeg must share one group
  // so a timeout doesn't leave descendants holding pipes or consuming CPU.
  const child=spawn(binary,args,{...options,detached:process.platform!=='win32'});
  active.add(child);
  child.once('close',()=>active.delete(child));child.once('error',()=>active.delete(child));
  return child;
}
function terminateTool(child){
  try{if(process.platform==='win32')child.kill('SIGKILL');else if(child.pid)process.kill(-child.pid,'SIGKILL');}catch{}
}
function stopTools(){for(const child of active)terminateTool(child);active.clear();}
process.once('exit',stopTools);
module.exports={spawnTool,terminateTool,stopTools};
