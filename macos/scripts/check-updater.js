'use strict';
// Exercise the real Sparkle installer against disposable toy apps, never Cuda.app.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),http=require('node:http');
const {execFileSync,spawn}=require('node:child_process');
const sdk=path.resolve('macos/build/sparkle-2.10.0'),probe=path.resolve(process.argv[2]||'macos/build/updater-probe');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'cuda-updater-check-'));fs.chmodSync(root,0o700);
const pair=crypto.generateKeyPairSync('ed25519'),seed=pair.privateKey.export({type:'pkcs8',format:'der'}).subarray(-32),pub=pair.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64');
const key=path.join(root,'signing-key');fs.writeFileSync(key,seed.toString('base64'),{mode:0o600});
const run=(bin,args)=>execFileSync(bin,args,{stdio:'pipe'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{let server;try{
 const marker=path.join(root,'installed.marker'),source=path.join(root,'new.swift'),binary=path.join(root,'new-executable');
 fs.writeFileSync(source,'import Foundation\ntry! Data("updated".utf8).write(to: URL(fileURLWithPath: '+JSON.stringify(marker)+'))\n');
 run('xcrun',['swiftc','-module-cache-path',path.join(root,'module-cache'),source,'-o',binary]);
 const bytes=new Map();server=http.createServer((req,res)=>{const value=bytes.get(req.url);if(!value){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Length':value.length,'Content-Type':req.url.endsWith('.xml')?'application/xml':'application/zip','Cache-Control':'no-store'});res.end(value);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 for(const mode of ['bad-feed','bad-archive','valid']){
  const directory=path.join(root,mode);fs.mkdirSync(directory);const old=path.join(directory,'Cuda Update Test.app'),next=path.join(directory,'new','Cuda Update Test.app'),id='com.veikkaheiskanen.Cuda.updater-test.'+crypto.randomUUID();
  const url='http://127.0.0.1:'+server.address().port+'/'+mode;
  function make(app,version,exe,framework){fs.mkdirSync(path.join(app,'Contents/MacOS'),{recursive:true});fs.copyFileSync(exe,path.join(app,'Contents/MacOS/Cuda'));fs.chmodSync(path.join(app,'Contents/MacOS/Cuda'),0o755);
   const info={CFBundleIdentifier:id,CFBundleName:'Cuda Update Test',CFBundleExecutable:'Cuda',CFBundlePackageType:'APPL',CFBundleVersion:String(version),CFBundleShortVersionString:'0.0.'+version,LSMinimumSystemVersion:'26.0',NSPrincipalClass:'NSApplication',NSAppTransportSecurity:{NSAllowsArbitraryLoads:true},SUFeedURL:url+'/feed.xml',SUPublicEDKey:pub,SUEnableAutomaticChecks:false,SURequireSignedFeed:true,SUVerifyUpdateBeforeExtraction:true,SUShowReleaseNotes:false};
   const json=path.join(directory,'info.json');fs.writeFileSync(json,JSON.stringify(info));run('/usr/bin/plutil',['-convert','xml1','-o',path.join(app,'Contents/Info.plist'),json]);
   if(framework){fs.mkdirSync(path.join(app,'Contents/Frameworks'));run('/usr/bin/ditto',['--noextattr','--noqtn','--norsrc',path.join(sdk,'Sparkle.framework'),path.join(app,'Contents/Frameworks/Sparkle.framework')]);}
   run('/usr/bin/xattr',['-cr',app]);run('/usr/bin/codesign',['--force','--sign','-',app]);
  }
  make(old,1,probe,true);make(next,2,binary,false);
  const zip=path.join(directory,'update.zip');run('/usr/bin/ditto',['-c','-k','--keepParent',next,zip]);const archive=fs.readFileSync(zip),signature=crypto.sign(null,archive,pair.privateKey).toString('base64');
  run(path.join(sdk,'bin/sign_update'),['--ed-key-file',key,'--verify',zip,signature]);
  const feed=path.join(directory,'feed.xml');fs.writeFileSync(feed,`<?xml version="1.0"?><rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>Updater fixture</title><item><title>Fixture 2</title><sparkle:version>2</sparkle:version><sparkle:shortVersionString>0.0.2</sparkle:shortVersionString><enclosure url="${url}/update.zip" sparkle:edSignature="${signature}" length="${archive.length}" type="application/octet-stream"/></item></channel></rss>`);
  run(path.join(sdk,'bin/sign_update'),['--ed-key-file',key,feed]);let feedBytes=fs.readFileSync(feed);
  if(mode==='bad-feed')feedBytes=Buffer.from(feedBytes.toString().replace('Fixture 2','Tampered title'));
  let served=archive;if(mode==='bad-archive'){served=Buffer.from(archive);served[20]^=1;}
  bytes.set('/'+mode+'/feed.xml',feedBytes);bytes.set('/'+mode+'/update.zip',served);
  const log=path.join(directory,'events.log'),child=spawn(path.join(old,'Contents/MacOS/Cuda'),[log],{stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b);let done=false;child.on('exit',()=>done=true);
  for(let n=0;n<140;n++){if(mode==='valid'?fs.existsSync(marker):done)break;await sleep(500);}if(!done)child.kill('SIGTERM');
  const events=fs.existsSync(log)?fs.readFileSync(log,'utf8'):'';const installed=run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleVersion',path.join(old,'Contents/Info.plist')]).toString().trim();
  if(mode==='valid'){if(!fs.existsSync(marker)||installed!=='2')throw Error('Signed update failed to install/relaunch: '+events+' '+stderr.slice(-1800));}
  else if(installed!=='1'||!events.includes('error:'))throw Error('Tampered update was not safely rejected: '+events+' '+stderr.slice(-1800));
  console.log('PASS: '+mode+(mode==='valid'?' signed archive downloaded, installed and relaunched':' rejected without replacing the app'));
 }
}finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}fs.rmSync(root,{recursive:true,force:true});}})().catch(error=>{console.error(error.message);process.exit(1);});
