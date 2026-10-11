// Capture the actual packaged UI with an illustrative, self-authored demo library.
const {pathToFileURL}=require('node:url');
module.exports=async({command,evaluate,delay,fs,path})=>{
 const directory=process.env.RIFF_GLASS_SCREENSHOTS;if(!directory)return;
 const names=['After hours','Blue hour','Slow morning','Open road'];
 const tracks=names.map((title,i)=>({id:i?'promo-'+i:'local_001122334455',platform:'local',title,artist:'Cuda Sessions',duration:5,thumbnail:pathToFileURL(path.resolve(__dirname,'../docs/demo/cover-'+i+'.svg')).href}));
 const playlists=names.slice(0,3).map((name,i)=>({id:'promo-list-'+i,name,description:['A little less rush. A little more music.','Cool tones for a quiet afternoon.','Ease into the day.'][i],tracks:[tracks[i],tracks[(i+1)%4]]}));
 await evaluate(`localStorage.setItem('devsize_playlists',${JSON.stringify(JSON.stringify(playlists))});localStorage.setItem('devsize_favorites',${JSON.stringify(JSON.stringify(tracks))});localStorage.setItem('devsize_history',${JSON.stringify(JSON.stringify(tracks))});location.reload()`);await delay(1000);await command('Page.bringToFront');
 await evaluate(`window.__promoFetch=window.fetch;window.fetch=(url,...args)=>String(url).endsWith('/api/vibe')?Promise.resolve({json:async()=>({success:true,tracks:${JSON.stringify(tracks)}})}):window.__promoFetch(url,...args)`);
 await command('Emulation.setDeviceMetricsOverride',{width:1280,height:850,deviceScaleFactor:1,mobile:false});
 await evaluate("electronAPI.setAppearance({mode:'light',tint:65})");
 await evaluate("document.querySelector('.sidebar-brand').click();document.querySelector('#home-quick-play-row button').click()");await delay(700);await evaluate("document.getElementById('native-audio').pause()");
 async function capture(name){await delay(350);await evaluate('document.fonts.ready.then(()=>void 0)');const shot=await command('Page.captureScreenshot',{format:'png'});fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,name+'.png'),Buffer.from(shot.data,'base64'));}
 await capture('cuda-home-light');
 await evaluate("document.getElementById('nav-shelf').click()");await capture('cuda-shelf-light');
 await evaluate("electronAPI.setAppearance({mode:'dark'})");await capture('cuda-shelf-dark');
 await evaluate("document.getElementById('player-summary').click()");await capture('cuda-player-dark');
 await evaluate("document.getElementById('close-now-playing').click()");
 await command('Emulation.setDeviceMetricsOverride',{width:390,height:850,deviceScaleFactor:1,mobile:false});await capture('cuda-shelf-narrow');
 await evaluate("document.getElementById('player-summary').click()");await capture('cuda-player-narrow');
 await evaluate("document.getElementById('close-now-playing').click()");await command('Emulation.clearDeviceMetricsOverride');
 console.log('Promo captures saved from the packaged app; songs and artwork are illustrative Cuda Sessions fixtures.');
};
