'use strict';
function normalizeAudioSettings(value={}) {
  if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('Invalid audio settings.');
  const number=(v,defaultValue,min,max)=>{if(v===undefined)return defaultValue;if(typeof v!=='number'||!Number.isFinite(v))throw new Error('Invalid audio settings.');return Math.max(min,Math.min(max,v));};
  const band=(v={})=>({low:number(v.low,0,-12,12),mid:number(v.mid,0,-12,12),high:number(v.high,0,-12,12)});
  const hq=value.hq||{};
  return {speed:number(value.speed,1,0.5,2),speedPitch:number(value.speedPitch,1,0.5,2),pitch:number(value.pitch,0,-12,12),volume:number(value.volume,1,0,2),reverb:number(value.reverb,0,0,100),echo:number(value.echo,0,0,100),distortion:number(value.distortion,0,0,100),eq:band(value.eq),hq:{enabled:hq.enabled===true,engine:['hqmusic-3','glyphs-7B','fyro1.1'].includes(hq.engine)?hq.engine:'hqmusic-3',bass:number(hq.bass,0,-50,50),vocal:number(hq.vocal,0,-50,50),air:number(hq.air,0,-50,50)}};
}
module.exports={normalizeAudioSettings};
