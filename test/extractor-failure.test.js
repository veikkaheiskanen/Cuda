'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
test('mobile extraction surfaces provider refusal instead of parsing null output',{timeout:15000},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cuda-extractor-failure-'));
 const saved={...process.env};process.env.RIFF_DATA_DIR=root;process.env.RIFF_DISABLE_TOOL_UPDATE='1';
 const executable=path.join(root,'extractor');fs.writeFileSync(executable,`#!${process.execPath}\nprocess.stdout.write('null\\n');process.stderr.write('YouTube sign in required for this recording');process.exit(1);`);fs.chmodSync(executable,0o700);process.env.RIFF_YTDLP=executable;
 const server=require('../server');t.after(async()=>{await server.stopServer();process.env=saved;fs.rmSync(root,{recursive:true,force:true});});
 const port=await server.startServer(0);
 const response=await fetch('http://127.0.0.1:'+port+'/api/stream-info?mobile=1&platform=youtube&id=fixture&url='+encodeURIComponent('https://www.youtube.com/watch?v=fixture'));
 const result=await response.json();assert.equal(result.success,false);assert.match(result.error,/requires account authorization on your Mac/);assert.doesNotMatch(result.error,/did not return an audio/);
});
