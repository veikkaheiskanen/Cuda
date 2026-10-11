const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { importAudioFiles } = require('../library-import');
test('different files with identical names and sizes both import; identical content is reused', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'riff-import-test-'));
  try {
    const sources = ['a', 'b', 'c'].map(dir => { fs.mkdirSync(path.join(root, dir)); return path.join(root, dir, '海 — <Live>.mp3'); });
    fs.writeFileSync(sources[0], 'audio1'); fs.writeFileSync(sources[1], 'audio2'); fs.writeFileSync(sources[2], 'audio1');
    const library = path.join(root, 'library');
    const entries = await importAudioFiles(sources, library);
    assert.notEqual(entries[0].id, entries[1].id);
    assert.equal(entries[0].id, entries[2].id);
    assert.equal(fs.readdirSync(library).length, 2);
    assert.equal(fs.readFileSync(path.join(library, entries[0].file), 'utf8'), 'audio1');
    assert.equal(fs.readFileSync(path.join(library, entries[1].file), 'utf8'), 'audio2');
    assert.equal(entries[0].name, '海 — <Live>');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
