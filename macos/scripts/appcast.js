'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const repo='https://github.com/veikkaheiskanen/Cuda';
function escape(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));}
function render({version,build,signature,length,published=new Date().toUTCString()}){
 if(!/^\d+\.\d+\.\d+$/.test(version)||!/^\d+$/.test(String(build))||!Number.isSafeInteger(length)||length<=0||!signature||Buffer.from(signature,'base64').length!==64)throw Error('Invalid signed update metadata.');
 const tag='mac-native-v'+version,name='Cuda-'+version+'-native-mac-arm64.zip';
 return `<?xml version="1.0" encoding="utf-8"?>\n<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel>
<title>Cuda for Mac</title><link>${repo}/releases</link><description>Signed native Apple Silicon updates</description><language>en</language>
<item><title>Cuda ${escape(version)}</title><link>${repo}/releases/tag/${tag}</link><pubDate>${escape(published)}</pubDate>
<sparkle:version>${escape(build)}</sparkle:version><sparkle:shortVersionString>${escape(version)}</sparkle:shortVersionString>
<sparkle:minimumSystemVersion>26.0.0</sparkle:minimumSystemVersion><sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements>
<enclosure url="${repo}/releases/download/${tag}/${name}" sparkle:edSignature="${escape(signature)}" length="${length}" type="application/octet-stream"/>
</item></channel></rss>\n`;
}
if(require.main===module){
 const [archive,app,output]=process.argv.slice(2);if(!archive||!app||!output)throw Error('Usage: node appcast.js update.zip Cuda.app appcast.xml');
 const sdk=path.resolve(__dirname,'../build/sparkle-2.10.0/bin'),key=process.env.CUDA_SPARKLE_KEY_FILE;
 const args=key?['--ed-key-file',key]:['--account','com.veikkaheiskanen.Cuda.updates'];
 const read=k=>execFileSync('/usr/libexec/PlistBuddy',['-c','Print :'+k,path.join(app,'Contents/Info.plist')],{encoding:'utf8'}).trim();
 const version=read('CFBundleShortVersionString'),build=read('CFBundleVersion');
 if(path.basename(archive)!=='Cuda-'+version+'-native-mac-arm64.zip')throw Error('Update archive name must match the native version.');
 const signature=execFileSync(path.join(sdk,'sign_update'),[...args,'-p',archive],{encoding:'utf8'}).trim();
 execFileSync(path.join(sdk,'sign_update'),[...args,'--verify',archive,signature],{stdio:'ignore'});
 const raw=Buffer.from(read('SUPublicEDKey'),'base64');if(raw.length!==32)throw Error('The app has an invalid update verification key.');
 const publicKey=crypto.createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),raw]),type:'spki',format:'der'});
 if(!crypto.verify(null,fs.readFileSync(archive),publicKey,Buffer.from(signature,'base64')))throw Error('Signing key does not match the verification key inside Cuda.');
 fs.writeFileSync(output,render({version,build,signature,length:fs.statSync(archive).size}));
 // Sign the feed itself too; SURequireSignedFeed enforces this before parsing it.
 execFileSync(path.join(sdk,'sign_update'),[...args,output],{stdio:'ignore'});
 execFileSync(path.join(sdk,'sign_update'),[...args,'--verify',output],{stdio:'ignore'});
 console.log('Signed archive and feed verified for Cuda '+version+'.');
}
module.exports={render};
