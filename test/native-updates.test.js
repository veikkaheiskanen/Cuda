'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {render}=require('../macos/scripts/appcast');
test('Mac feed targets only the signed native Apple Silicon archive and the internal build',()=>{
 const feed=render({version:'1.0.9',build:'11',signature:Buffer.alloc(64).toString('base64'),length:1234,published:'Mon, 12 Oct 2026 00:00:00 GMT'});
 assert.match(feed,/mac-native-v1\.0\.9\/Cuda-1\.0\.9-native-mac-arm64\.zip/);assert.match(feed,/<sparkle:version>11<\//);assert.match(feed,/<sparkle:hardwareRequirements>arm64<\//);assert.match(feed,/26\.0\.0/);
 for(const options of [{version:'41.0.7-beta'},{build:'bad'},{signature:'bad'},{length:0}])assert.throws(()=>render({version:'1.0.9',build:'11',signature:Buffer.alloc(64).toString('base64'),length:1234,...options}));
});
