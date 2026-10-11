//! JSON-line native audio bridge. Playback and reconnection follow Deck's librespot design.
use std::{sync::Arc, time::Duration, path::PathBuf, os::unix::fs::PermissionsExt};
use librespot_core::{Session, SessionConfig, SpotifyUri, authentication::Credentials, cache::Cache};
use librespot_playback::{config::{ PlayerConfig, Bitrate}, mixer::{Mixer, MixerConfig, softmixer::SoftMixer}, player::{Player, PlayerEvent}};
use serde_json::{Value, json};
use librespot_metadata::audio::UniqueFields;
use tokio::io::{AsyncBufReadExt, BufReader};
mod effects;
mod output;
fn emit(v: Value) { println!("{}", v); }
struct PlaybackLog;
impl log::Log for PlaybackLog {
    fn enabled(&self, meta: &log::Metadata) -> bool { meta.level() <= log::Level::Error && meta.target().starts_with("librespot_playback") }
    fn log(&self, record: &log::Record) {
        if !self.enabled(record.metadata()) { return; }
        let text = record.args().to_string();
        if !text.contains("Unable to load audio") && !text.contains("Unable to read audio") { return; }
        let reason = if text.contains("INVALID_CREDENTIALS") || text.contains("BAD_REQUEST") {
            "Spotify rejected the playback session. Reconnect Spotify playback in Settings."
        } else if text.contains("403") || text.contains("audio key") {
            "Spotify refused audio access. Check Premium and reconnect Spotify playback in Settings."
        } else if text.contains("Unable to read audio") {
            "Spotify returned an unreadable audio stream. Try another source."
        } else { "Spotify could not load audio. Try another source or reconnect playback in Settings." };
        emit(json!({"event":"diagnostic","error":reason}));
        
    }
    fn flush(&self) {}
}
static PLAYBACK_LOG: PlaybackLog = PlaybackLog;

fn make_player(session: Session, mixer: &SoftMixer, control: effects::Shared) -> Arc<Player> {
    Player::new(PlayerConfig { bitrate: Bitrate::Bitrate320, position_update_interval: Some(Duration::from_millis(500)), ..Default::default() }, session, mixer.get_soft_volume(), move || output::open(control.clone()))
}
async fn connect(dir: &PathBuf, _client_id: &str, token: Option<&str>) -> Result<Session, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    let cache = Cache::new(Some(dir), None, None, None).map_err(|e|e.to_string())?;
    let credentials = if let Some(t) = token { Credentials::with_access_token(t.to_owned()) } else { cache.credentials().ok_or("Connect Spotify in Settings first")? };
    // The user's OAuth app identifies Web API requests. Librespot's desktop
    // login5/client-token protocol needs its own supported session identity,
    // exactly as in Deck; substituting the Web API Client ID breaks audio loads.
    let config = SessionConfig::default();
    let session = Session::new(config, Some(cache));
    tokio::time::timeout(Duration::from_secs(25), session.connect(credentials, true)).await.map_err(|_|"Spotify connection timed out")?.map_err(|e| e.to_string())?;
    let _ = std::fs::set_permissions(dir.join("credentials.json"), std::fs::Permissions::from_mode(0o600));
    session.login5().auth_token().await.map_err(|_|"Spotify playback sign-in is invalid. Connect playback in Settings again.")?;
    Ok(session)
}
#[tokio::main]
async fn main() {
    let _ = log::set_logger(&PLAYBACK_LOG);log::set_max_level(log::LevelFilter::Error);
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    let mixer = SoftMixer::open(MixerConfig::default()).expect("soft mixer");
    let control=Arc::new(std::sync::Mutex::new(effects::Control::default()));
    mixer.set_volume(u16::MAX);
    let mut session: Option<Session> = None;
    let mut player: Option<Arc<Player>> = None;
    let mut events: Option<librespot_playback::player::PlayerEventChannel> = None;
    let mut dir = PathBuf::new();
    let mut client = String::new();
    let mut current_uri = String::new();
    let mut position = 0u32;
    let mut retried = false;
    let mut finishing=false;
    let mut active_request: Option<u64> = None;
    emit(json!({"event":"ready"}));
    loop {
        tokio::select! {
            line = lines.next_line() => {
                let Ok(Some(line)) = line else { break; };
                let Ok(v) = serde_json::from_str::<Value>(&line) else { continue; };
                let id = v["id"].clone();
                let cmd = v["command"].as_str().unwrap_or("");
                let result: Result<Value, String> = async {
                    if cmd=="effects" {if let Some(volume)=v["volume"].as_f64(){effects::volume(&control,volume);}effects::update(&control,&v["effects"]);return Ok(effects::status(&control));}
                    if cmd == "login" {
                        dir = PathBuf::from(v["cacheDir"].as_str().ok_or("Missing private cache path")?);
                        client = v["clientId"].as_str().ok_or("Missing Client ID")?.to_owned();
                        if let Some(p) = &player { p.stop(); }
                        let s = connect(&dir, &client, v["token"].as_str()).await?;
                        let p = make_player(s.clone(), &mixer,control.clone());
                        events = Some(p.get_player_event_channel()); player = Some(p); session = Some(s);
                    } else if cmd == "status" { return Ok(json!({"native":true,"clientId":SessionConfig::default().client_id,"connected":session.as_ref().is_some_and(|s|!s.is_invalid()),"effects":effects::status(&control)}));
                    } else {
                        if session.as_ref().is_some_and(|s|s.is_invalid()) && matches!(cmd,"load"|"resume"|"radio") {
                            let s = connect(&dir,&client,None).await?;
                            let p = make_player(s.clone(),&mixer,control.clone());
                            events = Some(p.get_player_event_channel()); player=Some(p); session=Some(s);
                            if cmd == "resume" && !current_uri.is_empty() { active_request=None; player.as_ref().unwrap().load(SpotifyUri::from_uri(&current_uri).map_err(|e|e.to_string())?, true, position); return Ok(json!({})); }
                        }
                        let p = player.as_ref().ok_or("Connect Spotify in Settings first")?;
                        match cmd {
                            "load" => { if v["effects"].is_object(){effects::update(&control,&v["effects"]);}if let Some(volume)=v["volume"].as_f64(){effects::volume(&control,volume);}effects::reset(&control);finishing=false;active_request=None; retried=false; current_uri = v["uri"].as_str().ok_or("Missing track URI")?.to_owned(); let uri = SpotifyUri::from_uri(&current_uri).map_err(|e|e.to_string())?; if !current_uri.starts_with("spotify:track:") {return Err("Only Spotify tracks are playable".into());} position = v["positionMs"].as_u64().unwrap_or(0).min(u32::MAX as u64) as u32; p.load(uri, v["play"].as_bool().unwrap_or(true), position); },
                            "pause" => p.pause(), "resume" => p.play(), "stop" => { effects::reset(&control);finishing=false;active_request=None; p.stop(); },
                            "seek" => { effects::reset(&control);finishing=false;position=v["positionMs"].as_u64().unwrap_or(0).min(u32::MAX as u64) as u32; p.seek(position); },
                            "volume" => effects::volume(&control,v["volume"].as_f64().unwrap_or(0.85)),
                            "preload" => p.preload(SpotifyUri::from_uri(v["uri"].as_str().ok_or("Missing URI")?).map_err(|e|e.to_string())?),
                            "radio" => { let s=session.as_ref().ok_or("Not connected")?; let uri=v["uri"].as_str().ok_or("Missing radio seed")?; let bytes=s.spclient().get_apollo_station("stations",uri,Some(50), vec![], true).await.map_err(|e|e.to_string())?; return serde_json::from_slice(&bytes).map_err(|e|e.to_string()); },
                            _ => return Err("Unknown command".into())
                        }
                    }
                    Ok(json!({}))
                }.await;
                match result { Ok(data)=>emit(json!({"id":id,"success":true,"data":data})),Err(error)=>emit(json!({"id":id,"success":false,"error":error})) }
            },
            event = async { match &mut events { Some(rx)=>rx.recv().await, None=>std::future::pending().await } } => {
                if let Some(event)=event {
                    if let PlayerEvent::Loading{track_id,play_request_id,..}=&event {
                        if track_id.to_uri().unwrap_or_default()==current_uri {active_request=Some(*play_request_id);}
                        continue;
                    }
                    let request=match &event {PlayerEvent::PositionChanged{play_request_id,..}=>Some(*play_request_id),_=>event.get_play_request_id()};
                    if request.is_some() && request!=active_request {continue;}
                    if matches!(event,PlayerEvent::TrackChanged{..}) && active_request.is_none() {continue;}
                    if matches!(event,PlayerEvent::Unavailable{..}) && !retried {
                        retried=true;
                        if let Ok(s)=connect(&dir,&client,None).await {
                            if let Some(old)=&player {old.stop();}
                            let p=make_player(s.clone(),&mixer,control.clone());
                            events=Some(p.get_player_event_channel());active_request=None;
                            if let Ok(uri)=SpotifyUri::from_uri(&current_uri){p.load(uri,true,position);}
                            player=Some(p);session=Some(s);continue;
                        }
                    }
                    if matches!(event,PlayerEvent::EndOfTrack{..}) {finishing=true;effects::finish(&control);if let Some(p)=&player{p.stop();}continue;}
                    let mut value=match event {
                        PlayerEvent::TrackChanged{audio_item}=>{
                            let (artist,album)=match &audio_item.unique_fields { UniqueFields::Track{artists,album,..}=>(artists.iter().map(|a|a.name.as_str()).collect::<Vec<_>>().join(", "),album.clone()),_=>(String::new(),String::new()) };
                            json!({"event":"metadata","uri":audio_item.track_id.to_uri().unwrap_or_default(),"title":audio_item.name,"artist":artist,"album":album,"duration":audio_item.duration_ms as f64/1000.,"thumbnail":audio_item.covers.iter().rfind(|c|c.width>=300).or(audio_item.covers.first()).map(|c|&c.url)})
                        },
                        PlayerEvent::Playing{track_id,position_ms,..}=>{position=position_ms;json!({"event":"playing","uri":track_id.to_uri().unwrap_or_default(),"positionMs":position})},
                        PlayerEvent::Paused{track_id,position_ms,..}=>{position=position_ms;json!({"event":"paused","uri":track_id.to_uri().unwrap_or_default(),"positionMs":position})},
                        PlayerEvent::PositionChanged{track_id,position_ms,..}|PlayerEvent::PositionCorrection{track_id,position_ms,..}|PlayerEvent::Seeked{track_id,position_ms,..}=>{position=position_ms;json!({"event":"position","uri":track_id.to_uri().unwrap_or_default(),"positionMs":position})},
                        PlayerEvent::EndOfTrack{track_id,..}=>json!({"event":"ended","uri":track_id.to_uri().unwrap_or_default()}),
                        PlayerEvent::Unavailable{track_id,..}=>json!({"event":"error","uri":track_id.to_uri().unwrap_or_default(),"error":"Spotify could not play this track. Check Premium and reconnect in Settings."}),
                        PlayerEvent::TimeToPreloadNextTrack{track_id,..}=>json!({"event":"preload","uri":track_id.to_uri().unwrap_or_default()}),
                        PlayerEvent::Stopped{track_id,..} if finishing=>{finishing=false;json!({"event":"ended","uri":track_id.to_uri().unwrap_or_default()})},
                        PlayerEvent::Stopped{track_id,..}=>json!({"event":"paused","uri":track_id.to_uri().unwrap_or_default(),"positionMs":position}),
                        _=>continue
                    }; value["requestedUri"]=json!(current_uri);emit(value);
                } else { events=None; }
            }
        }
    }
    if let Some(p)=player {p.stop();}
}
