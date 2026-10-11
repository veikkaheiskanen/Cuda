'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {secureStore}=require('../macos/secure-store');
const {migrateShelf}=require('../macos/legacy-shelf');
const {ClassicLevel}=require('../macos/node_modules/classic-level');
test('native account encryption authenticates ciphertext and rejects another Keychain key',()=>{
 const store=secureStore(crypto.randomBytes(32)),value='private token with å and 🎵',bytes=store.encryptString(value);
 assert.equal(store.decryptString(bytes),value);assert.equal(bytes.includes(Buffer.from('private')),false);
 const tampered=Buffer.from(bytes);tampered[14]^=1;assert.throws(()=>store.decryptString(tampered));
 assert.throws(()=>secureStore(crypto.randomBytes(32)).decryptString(bytes));assert.throws(()=>secureStore(Buffer.alloc(16)));
});
test('native Shelf migration preserves Unicode, deduplicates tracks and never modifies the original LevelDB',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cuda-migration-test-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const source=path.join(directory,'Local Storage','leveldb'),db=new ClassicLevel(source,{keyEncoding:'buffer',valueEncoding:'buffer'});
 const encode=value=>Buffer.concat([Buffer.from([0]),Buffer.from(value,'utf16le')]);
 const track={id:'song',title:'Sävel 🎵',artist:'Artist',platform:'soundcloud',url:'https://soundcloud.com/artist/song'};
 await db.put(Buffer.concat([Buffer.from('_file://\0'),encode('devsize_favorites')]),encode(JSON.stringify([track,track])));
 await db.put(Buffer.concat([Buffer.from('_file://\0'),encode('devsize_playlists')]),encode(JSON.stringify([{id:42,name:'Yö',tracks:[track]}])));
 await db.put(Buffer.concat([Buffer.from('_file://\0'),encode('unrelated-secret')]),encode('do not copy this'));
 await db.close();
 const before=fs.readdirSync(source).map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(source,name))).digest('hex')]);
 assert.deepEqual(await migrateShelf(directory),{migrated:true,favourites:1,playlists:1});
 const output=fs.readFileSync(path.join(directory,'native-shelf.json'),'utf8'),state=JSON.parse(output);
 assert.equal(state.favourites[0].title,track.title);assert.equal(state.playlists[0].name,'Yö');assert.equal(state.playlists[0].id,'42');assert.equal(output.includes('secret'),false);
 assert.deepEqual(fs.readdirSync(source).map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(source,name))).digest('hex')]),before);
 assert.deepEqual(await migrateShelf(directory),{migrated:false});
});
