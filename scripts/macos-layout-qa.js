// Verify corner geometry in the packaged renderer, not just token names.
const assert = require('node:assert/strict');
module.exports = async ({command,evaluate,delay,fs,path}) => {
  const shots=process.env.RIFF_GLASS_SCREENSHOTS;
  await command('Page.bringToFront');
  await evaluate("electronAPI.setAppearance({mode:'dark',transparent:true,opacity:35})");
  const native=await evaluate('electronAPI.getWindowFrame()');
  assert.ok(native.nativeClip.closeLeft>=20,'Native traffic lights hug the left corner');
  assert.ok(native.nativeClip.closeTop>=18,'Native traffic lights hug the top corner');
  assert.ok(native.nativeClip.controlsBottom<=52,'Native traffic lights leave their reserved header');
  console.log('Native control bounds:',JSON.stringify({left:native.nativeClip.closeLeft,top:native.nativeClip.closeTop,bottom:native.nativeClip.controlsBottom}));
  for (const width of [1280,900,680,532,390,360]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:false});
    await delay(200);
    assert.equal(await evaluate("document.getElementById('main-content').parentElement.className"),'app-layout','Content must stay inside the app layout');
    const geometry=await evaluate(`(()=>{
      const zoom=electronAPI.getZoomFactor(),rect=s=>document.querySelector(s).getBoundingClientRect();
      const nav=rect('.sidebar'),bar=rect('.playbar'),root=getComputedStyle(document.documentElement);
      const title=rect('.titlebar .cuda-home-title');
      const radius=s=>parseFloat(getComputedStyle(document.querySelector(s)).borderBottomRightRadius)*zoom;
      return {zoom,outer:parseFloat(root.getPropertyValue('--window-corner')),navRadius:radius('.sidebar'),barRadius:radius('.playbar'),navLeft:nav.left*zoom,navBottom:(innerHeight-nav.bottom)*zoom,barRight:(innerWidth-bar.right)*zoom,navTop:nav.top*zoom,navHeight:nav.height*zoom,titleOffset:(title.left+title.width/2-innerWidth/2)*zoom,overflow:document.documentElement.scrollWidth>innerWidth};
    })()`);
    assert.equal(geometry.overflow,false,'Horizontal overflow at '+width);
    assert.ok(Math.abs(geometry.navRadius+geometry.navLeft-geometry.outer)<1,'Inset navigation curve does not share the window corner center at '+width+': '+JSON.stringify(geometry));
    assert.ok(Math.abs(geometry.navRadius+geometry.navBottom-geometry.outer)<1,'Uneven bottom corner gap at '+width);
    assert.ok(Math.abs(geometry.barRadius+geometry.barRight-geometry.outer)<1,'Inset player curve does not share the window corner center at '+width);
    if(width>680)assert.ok(geometry.navTop>=60,'Sidebar runs behind native window controls');
    if(width<=680) {
      assert.ok(geometry.navHeight>=56,'Narrow navigation loses its hit areas');
      assert.ok(Math.abs(geometry.titleOffset)<1,'Cuda title is off-center at '+width);
    }
    if(shots && [1280,532,390].includes(width)) {
      fs.mkdirSync(shots,{recursive:true});
      const shot=await command('Page.captureScreenshot',{format:'png'});
      fs.writeFileSync(path.join(shots,'cuda-macos-'+width+'.png'),Buffer.from(shot.data,'base64'));
    }
  }
  await command('Emulation.clearDeviceMetricsOverride');
  for(const scale of [70,140,100]) {
    await evaluate(`document.getElementById('settings-slider-scale').value=${scale};document.getElementById('settings-slider-scale').dispatchEvent(new Event('input'))`);
    await delay(150);
    const curve=await evaluate(`(()=>{const z=electronAPI.getZoomFactor(),s=document.querySelector('.sidebar'),b=s.getBoundingClientRect();return {zoom:z,radius:parseFloat(getComputedStyle(s).borderBottomLeftRadius)*z,left:b.left*z,bottom:(innerHeight-b.bottom)*z,outer:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--window-corner'))};})()`);
    assert.ok(Math.abs(curve.radius+curve.left-curve.outer)<1,'Corner drift at '+scale+'%: '+JSON.stringify(curve));
    assert.ok(Math.abs(curve.radius+curve.bottom-curve.outer)<1,'Bottom inset drift at '+scale+'%');
  }
  await evaluate("electronAPI.setAppearance({mode:'light',opacity:78})");
  console.log('Mac layout passed: concentric inset corners, even edge gaps, separate traffic-light area and narrow hit areas at 360/390/532/680/900/1280px.');
};
