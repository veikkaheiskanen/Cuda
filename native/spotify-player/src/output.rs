//! A short CoreAudio queue keeps pause/seek and live DSP adjustments responsive.
use std::{thread,time::Duration};
use librespot_playback::{audio_backend::{Sink,SinkResult,SinkError},convert::Converter,decoder::AudioPacket};
use crate::effects::{self,Shared,Processor,RATE};
struct Output {sink:rodio::Sink,_stream:rodio::OutputStream,control:Shared,processor:Processor,settings:effects::Settings,reset:u64}
struct Unavailable(String);
impl Sink for Unavailable {fn write(&mut self,_:AudioPacket,_:&mut Converter)->SinkResult<()>{Err(SinkError::ConnectionRefused(self.0.clone()))}}
pub fn open(control:Shared)->Box<dyn Sink>{
 match rodio::OutputStreamBuilder::open_default_stream(){Ok(mut stream)=>{stream.log_on_drop(false);let sink=rodio::Sink::connect_new(stream.mixer());let(settings,reset)={let c=control.lock().unwrap();(c.settings.clone(),c.reset)};let mut processor=Processor::new();processor.configure(&settings);Box::new(Output{sink,_stream:stream,control,processor,settings,reset})},Err(e)=>Box::new(Unavailable(format!("Audio output unavailable: {e}")))}
}
impl Sink for Output {
 fn start(&mut self)->SinkResult<()>{self.sink.play();Ok(())}
 fn stop(&mut self)->SinkResult<()>{
  let(drain,master)={let mut c=self.control.lock().unwrap();let drain=c.drain;c.drain=false;(drain,c.master as f32)};
  if drain {let mut tail=self.processor.flush();for sample in &mut tail{*sample=(*sample*master).clamp(-1.,1.);}if !tail.is_empty(){self.sink.append(rodio::buffer::SamplesBuffer::new(2,RATE,tail));}self.sink.sleep_until_end();}
  self.sink.stop();self.sink.pause();self.processor.clear();Ok(())
 }
 fn write(&mut self,packet:AudioPacket,_:&mut Converter)->SinkResult<()>{
  let input=packet.samples().map_err(|e|SinkError::OnWrite(e.to_string()))?;
  let(settings,reset)={let c=self.control.lock().unwrap();(c.settings.clone(),c.reset)};
  if reset!=self.reset {self.sink.stop();self.sink.play();self.processor.clear();self.reset=reset;}
  if settings!=self.settings {self.processor.configure(&settings);self.settings=settings;}
  let mut samples=self.processor.process(input);
  let master=self.control.lock().unwrap().master as f32;for sample in &mut samples{*sample=(*sample*master).clamp(-1.,1.);}
  if samples.is_empty(){return Ok(());}
  {let mut c=self.control.lock().unwrap();c.frames+=(samples.len()/2)as u64;c.peak=samples.iter().map(|x|(*x as f64).abs()).fold(0.,f64::max);c.rms=(samples.iter().map(|x|(*x as f64).powi(2)).sum::<f64>()/samples.len()as f64).sqrt();}
  self.sink.append(rodio::buffer::SamplesBuffer::new(2,RATE,samples));
  // Four decoded packets rather than the backend's 26-packet (~500ms) queue.
  while self.sink.len()>4 {thread::sleep(Duration::from_millis(3));}
  Ok(())
 }
}
