//! Stateful stereo DSP for Spotify's decoded PCM, before CoreAudio output.
use std::{f64::consts::PI, sync::{Arc, Mutex}};
use serde_json::{Value,json};
use soundtouch::{SoundTouch,Setting};
pub const RATE:u32=44100;
#[derive(Clone,Debug,PartialEq)]
pub struct Settings {pub eq:[f64;3],pub speed:f64,pub rate:f64,pub volume:f64,pub echo:f64,pub reverb:f64,pub distortion:f64,pub hq:bool,pub tone:[f64;3],pub engine:String}
impl Default for Settings {fn default()->Self{Self{eq:[0.;3],speed:1.,rate:1.,volume:1.,echo:0.,reverb:0.,distortion:0.,hq:false,tone:[0.;3],engine:"hqmusic-3".into()}}}
impl Settings {
 pub fn parse(v:&Value)->Self {
  fn n(v:&Value,d:f64,lo:f64,hi:f64)->f64{v.as_f64().filter(|x|x.is_finite()).unwrap_or(d).clamp(lo,hi)}
  let speed_pitch=n(&v["speedPitch"],1.,0.5,2.);let pitch=n(&v["pitch"],0.,-12.,12.);
  let shifted=speed_pitch!=1. || pitch!=0.;
  Self{eq:[n(&v["eq"]["low"],0.,-12.,12.),n(&v["eq"]["mid"],0.,-12.,12.),n(&v["eq"]["high"],0.,-12.,12.)],speed:if shifted{1.}else{n(&v["speed"],1.,0.5,2.)},rate:if shifted{speed_pitch*2f64.powf(pitch/12.)}else{1.},volume:n(&v["volume"],1.,0.,2.),echo:n(&v["echo"],0.,0.,100.)/100.,reverb:n(&v["reverb"],0.,0.,100.)/100.,distortion:n(&v["distortion"],0.,0.,100.),hq:v["hq"]["enabled"].as_bool().unwrap_or(false),tone:[n(&v["hq"]["bass"],0.,-50.,50.),n(&v["hq"]["vocal"],0.,-50.,50.),n(&v["hq"]["air"],0.,-50.,50.)],engine:v["hq"]["engine"].as_str().unwrap_or("hqmusic-3").into()}
 }
}
pub struct Control {pub settings:Settings,pub revision:u64,pub reset:u64,pub frames:u64,pub peak:f64,pub rms:f64,pub master:f64,pub drain:bool}
impl Default for Control{fn default()->Self{Self{settings:Settings::default(),revision:0,reset:0,frames:0,peak:0.,rms:0.,master:0.85,drain:false}}}
pub fn volume(shared:&Shared,value:f64){shared.lock().unwrap().master=if value.is_finite(){value.clamp(0.,1.)}else{0.85};}
pub type Shared=Arc<Mutex<Control>>;
pub fn update(shared:&Shared,v:&Value){let mut c=shared.lock().unwrap();c.settings=Settings::parse(v);c.revision+=1;}
pub fn reset(shared:&Shared){let mut c=shared.lock().unwrap();c.reset+=1;c.drain=false;}
pub fn finish(shared:&Shared){shared.lock().unwrap().drain=true;}
pub fn status(shared:&Shared)->Value{let c=shared.lock().unwrap();json!({"revision":c.revision,"frames":c.frames,"peak":c.peak,"rms":c.rms,"eq":c.settings.eq,"speed":c.settings.speed,"rate":c.settings.rate,"volume":c.settings.volume,"masterVolume":c.master,"hq":c.settings.hq,"echo":c.settings.echo,"reverb":c.settings.reverb})}
#[derive(Clone)]
struct Filter {b:[f64;3],a:[f64;2],z:[[f64;2];2]}
impl Default for Filter{fn default()->Self{Self{b:[1.,0.,0.],a:[0.;2],z:[[0.;2];2]}}}
impl Filter {
 fn configure(&mut self,kind:u8,freq:f64,q:f64,gain:f64){
  let a=10f64.powf(gain/40.);let w=2.*PI*freq/RATE as f64;let c=w.cos();let s=w.sin();let alpha=if kind==1{s/(2.*q)}else{s/2.*2f64.sqrt()};let beta=2.*a.sqrt()*alpha;
  let (b0,b1,b2,a0,a1,a2)=match kind {
   0=>(a*((a+1.)-(a-1.)*c+beta),2.*a*((a-1.)-(a+1.)*c),a*((a+1.)-(a-1.)*c-beta),(a+1.)+(a-1.)*c+beta,-2.*((a-1.)+(a+1.)*c),(a+1.)+(a-1.)*c-beta),
   2=>(a*((a+1.)+(a-1.)*c+beta),-2.*a*((a-1.)+(a+1.)*c),a*((a+1.)+(a-1.)*c-beta),(a+1.)-(a-1.)*c+beta,2.*((a-1.)-(a+1.)*c),(a+1.)-(a-1.)*c-beta),
   _=>(1.+alpha*a,-2.*c,1.-alpha*a,1.+alpha/a,-2.*c,1.-alpha/a)
  };self.b=[b0/a0,b1/a0,b2/a0];self.a=[a1/a0,a2/a0];
 }
 fn sample(&mut self,x:f64,ch:usize)->f64{let y=self.b[0]*x+self.z[ch][0];self.z[ch][0]=self.b[1]*x-self.a[0]*y+self.z[ch][1];self.z[ch][1]=self.b[2]*x-self.a[1]*y;y}
 fn clear(&mut self){self.z=[[0.;2];2];}
}
pub struct Processor {settings:Settings,filters:[Filter;6],echo:Vec<[f64;2]>,reverb:Vec<[f64;2]>,cursor:usize,envelope:f64,stretch:SoundTouch}
impl Processor {
 pub fn new()->Self{let mut stretch=SoundTouch::new();stretch.set_channels(2).set_sample_rate(RATE).set_setting(Setting::UseQuickseek,1);Self{settings:Settings::default(),filters:std::array::from_fn(|_|Filter::default()),echo:vec![[0.;2];RATE as usize*3/10],reverb:vec![[0.;2];RATE as usize/2],cursor:0,envelope:0.,stretch}}
 pub fn configure(&mut self,s:&Settings){
  if self.settings.speed!=s.speed || self.settings.rate!=s.rate {self.stretch.clear();self.stretch.set_tempo(s.speed).set_rate(s.rate);}
  for(i,(kind,freq,q))in [(0,200.,1.),(1,1000.,0.9),(2,4000.,1.)].into_iter().enumerate(){self.filters[i].configure(kind,freq,q,s.eq[i]);}
  let base=[if s.engine=="fyro1.1"{3.}else{0.},0.,if s.engine=="glyphs-7B"{2.5}else{0.}];
  for(i,(kind,freq,q))in [(0,80.,1.),(1,2500.,1.2),(2,9000.,1.)].into_iter().enumerate(){self.filters[i+3].configure(kind,freq,q,if s.hq{(base[i]+s.tone[i]*0.08).clamp(-4.,4.)}else{0.});}
  if s.echo==0. && self.settings.echo!=0. {self.echo.fill([0.;2]);}
  if s.reverb==0. && self.settings.reverb!=0. {self.reverb.fill([0.;2]);}
  self.settings=s.clone();
 }
 pub fn clear(&mut self){for f in &mut self.filters{f.clear();}self.echo.fill([0.;2]);self.reverb.fill([0.;2]);self.cursor=0;self.envelope=0.;self.stretch.clear();}
 fn drain(&mut self)->Vec<f32>{let mut out=Vec::new();let mut buf=[0.;8192];loop{let frames=self.stretch.receive_samples(&mut buf,4096);if frames==0{break;}out.extend_from_slice(&buf[..frames*2]);}out}
 pub fn flush(&mut self)->Vec<f32>{if self.settings.speed==1. && self.settings.rate==1.{return Vec::new();}self.stretch.flush();self.drain()}
 pub fn process(&mut self,input:&[f64])->Vec<f32>{
  let s=self.settings.clone();let mut out=Vec::with_capacity(input.len());
  for frame in input.chunks_exact(2){
   let peak=frame[0].abs().max(frame[1].abs());let coefficient=if peak>self.envelope{(-1./(RATE as f64*0.01)).exp()}else{(-1./(RATE as f64*0.1)).exp()};self.envelope=coefficient*self.envelope+(1.-coefficient)*peak;
   let compression=if s.hq && self.envelope>0.251{let ratio=if s.engine=="fyro1.1"{2.}else{1.5};(0.251/self.envelope).powf(1.-1./ratio)}else{1.};
   for(ch,&sample)in frame.iter().enumerate(){let mut x=if sample.is_finite(){sample}else{0.};
    if s.hq {x*=compression;for f in &mut self.filters[3..]{x=f.sample(x,ch);}x-=if s.engine=="hqmusic-3"{0.01}else{0.004}*x.powi(3);x=x.clamp(-1.,1.);}
    for f in &mut self.filters[..3]{x=f.sample(x,ch);}
    let e=self.cursor%self.echo.len();let echo=self.echo[e][ch];self.echo[e][ch]=x+echo*0.35;
    let r=self.cursor%self.reverb.len();let mut reverb=0.;for(tap,gain)in [(0.037,0.5),(0.071,0.3),(0.113,0.2)]{let delay=(tap*RATE as f64)as usize;reverb+=self.reverb[(r+self.reverb.len()-delay)%self.reverb.len()][ch]*gain;}
    self.reverb[r][ch]=x+reverb*0.6;
    let dist=if s.distortion>0.{let k=s.distortion*2.5;let wet=(3.+k)*x*20.*(PI/180.)/(PI+k*x.abs());x*(1.-s.distortion/100.*0.4)+wet*s.distortion/100.*0.75}else{x};
    out.push(((dist+echo*s.echo+reverb*s.reverb)*s.volume)as f32);
   }self.cursor=self.cursor.wrapping_add(1);
  }
  if s.speed==1. && s.rate==1. {out}else{self.stretch.put_samples(&out,out.len()/2);self.drain()}
 }
}
#[cfg(test)]mod tests {
 use super::*;
 fn tone(hz:f64,seconds:f64)->Vec<f64>{(0..(RATE as f64*seconds)as usize).flat_map(|i|{let x=(2.*PI*hz*i as f64/RATE as f64).sin()*0.1;[x,x]}).collect()}
 fn rms(a:&[f32])->f64{(a.iter().map(|x|(*x as f64).powi(2)).sum::<f64>()/a.len()as f64).sqrt()}
 #[test]fn flat_is_transparent_and_eq_changes_decoded_audio(){let input=tone(60.,1.);let mut p=Processor::new();let flat=p.process(&input);assert!((rms(&flat)-0.07071).abs()<0.0001);let mut s=Settings::default();s.eq[0]=12.;p.configure(&s);p.clear();let boosted=p.process(&input);assert!(rms(&boosted[4000..])/rms(&flat[4000..])>3.8);s.eq[0]=-12.;p.configure(&s);p.clear();assert!(rms(&p.process(&input)[4000..])/rms(&flat[4000..])<0.27);}
 #[test]fn gain_effect_tails_and_reset_are_real(){let mut p=Processor::new();let mut s=Settings::default();s.volume=0.5;p.configure(&s);assert!((rms(&p.process(&tone(1000.,1.)))-0.035355).abs()<0.0001);s.echo=1.;s.reverb=1.;s.volume=1.;p.configure(&s);p.clear();let mut impulse=vec![0.;RATE as usize];impulse[0]=0.2;impulse[1]=0.2;let a=p.process(&impulse);assert!(a[(RATE as usize*3/10)*2].abs()>0.19);assert!(a[(RATE as f64*0.037)as usize*2].abs()>0.09);p.clear();assert!(p.process(&vec![0.;4000]).iter().all(|x|*x==0.));}
 #[test]fn tempo_preserves_pitch_and_coupled_rate_changes_both(){let mut p=Processor::new();let mut s=Settings::default();s.speed=1.5;p.configure(&s);let mut a=p.process(&tone(440.,2.));a.extend(p.flush());assert!((a.len()as f64/(RATE as f64*4.)-1./1.5).abs()<0.03);let frequency=|a:&[f32]|{let v=a.chunks_exact(2).map(|x|x[0]).collect::<Vec<_>>();v.windows(2).filter(|x|x[0]<=0. && x[1]>0.).count()as f64/(v.len()as f64/RATE as f64)};assert!((frequency(&a)-440.).abs()<12.);s.speed=1.;s.rate=2.;p.configure(&s);p.clear();let mut a=p.process(&tone(440.,2.));a.extend(p.flush());assert!((frequency(&a)-880.).abs()<20.);assert!((a.len()as f64/(RATE as f64*4.)-0.5).abs()<0.03);}
 #[test]fn eq_headroom_is_preserved_until_master_output(){let mut p=Processor::new();let mut s=Settings::default();s.eq[0]=12.;p.configure(&s);let input=tone(60.,1.).into_iter().map(|x|x*4.).collect::<Vec<_>>();let output=p.process(&input);assert!(output.iter().any(|x|x.abs()>1.4));let quiet=output.iter().map(|x|(x*0.1).clamp(-1.,1.)).collect::<Vec<_>>();assert!(rms(&quiet[4000..])>0.108);}
 #[test]fn distortion_and_hq_change_audio_without_nonfinite_output(){let input=tone(440.,1.);let mut p=Processor::new();let flat=p.process(&input);let mut s=Settings::default();s.distortion=60.;p.configure(&s);let altered=p.process(&input);assert!(altered.iter().zip(&flat).any(|(a,b)|(a-b).abs()>0.01));s.hq=true;s.tone=[50.;3];p.configure(&s);assert!(p.process(&input).iter().all(|x|x.is_finite() && x.abs()<=1.));}
}
