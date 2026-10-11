'use strict';
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..'),bin=path.join(root,'bin','darwin-arm64','bin');
if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('Build native components on an Apple Silicon Mac.');
fs.mkdirSync(bin,{recursive:true});
function run(command,args){const result=spawnSync(command,args,{cwd:root,stdio:'inherit',env:process.env});if(result.error)throw result.error;if(result.status!==0)throw new Error(command+' failed');}
run('clang',['-shared','-fobjc-arc','-undefined','dynamic_lookup','-I'+path.join(root,'native','include'),'-framework','AppKit','-framework','QuartzCore','-mmacosx-version-min=12.0','native/window-material.m','-o',path.join(bin,'window-material.node')]);
run(process.env.CARGO || 'cargo',['build','--release','--locked','--manifest-path','native/spotify-player/Cargo.toml']);
fs.copyFileSync(path.join(process.env.CARGO_TARGET_DIR || path.join(root,'native/spotify-player/target'),'release/riff-spotify-player'),path.join(bin,'riff-spotify-player'));fs.chmodSync(path.join(bin,'riff-spotify-player'),0o755);

// Include attribution from the exact downloaded dependency sources.
const registry=path.join(process.env.CARGO_HOME || path.join(require('os').homedir(),'.cargo'),'registry','src');
const notices=path.join(root,'bin','darwin-arm64','LICENSES','native');fs.mkdirSync(notices,{recursive:true});
if(fs.existsSync(registry))for(const index of fs.readdirSync(registry))for(const name of fs.readdirSync(path.join(registry,index))){const dir=path.join(registry,index,name);if(!fs.statSync(dir).isDirectory())continue;for(const file of ['LICENSE','LICENSE.md','LICENSE-MIT','LICENSE-APACHE','COPYING'])if(fs.existsSync(path.join(dir,file))){const dest=path.join(notices,name);fs.mkdirSync(dest,{recursive:true});fs.copyFileSync(path.join(dir,file),path.join(dest,file));}}
for(const [source,name] of [['native/DECK-LICENSE','DECK-LICENSE'],['native/include/NODE-LICENSE','NODE-LICENSE']])fs.copyFileSync(path.join(root,source),path.join(notices,name));

// Ship the bundled SoundTouch license and corresponding unmodified source.
const soundtouch=path.join(root,'native/vendor/soundtouch-ffi-0.4.1');
fs.copyFileSync(path.join(soundtouch,'soundtouch-2_3_2/COPYING.TXT'),path.join(notices,'SOUNDTOUCH-COPYING.TXT'));
run('/usr/bin/ditto',['-c','-k','--keepParent',soundtouch,path.join(notices,'soundtouch-ffi-0.4.1-source.zip')]);
