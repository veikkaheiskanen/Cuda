const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {setTimeout:delay}=require('node:timers/promises');
const {spawnTool,terminateTool,stopTools}=require('../tool-processes');
test('timing out an extractor stops descendants holding its pipes', {skip:process.platform==='win32',timeout:5000},async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cuda-process-test-'));t.after(()=>{stopTools();fs.rmSync(directory,{recursive:true,force:true});});
 const pulse=path.join(directory,'pulse');const childCode=`const fs=require('fs');setInterval(()=>fs.appendFileSync(${JSON.stringify(pulse)},'x'),20)`;
 const parent=spawnTool(process.execPath,['-e',`require('child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'inherit'});setInterval(()=>{},1000)`],{stdio:['ignore','pipe','pipe']});
 const closed=new Promise(resolve=>parent.once('close',resolve));
 for(let i=0;i<80&&!fs.existsSync(pulse);i++)await delay(20);
 assert.equal(fs.existsSync(pulse),true);terminateTool(parent);await closed;
 const size=fs.statSync(pulse).size;await delay(100);assert.equal(fs.statSync(pulse).size,size,'descendant must not survive parent timeout');
});
