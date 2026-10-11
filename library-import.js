const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

async function importAudioFiles(sources, libraryDir) {
  await fs.promises.mkdir(libraryDir, { recursive: true });
  const imported = [];
  for (const source of sources) {
    const ext = path.extname(source).slice(1).toLowerCase();
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(source)) hash.update(chunk);
    const id = 'local_' + hash.digest('hex').slice(0, 12);
    const file = `${id}.${ext}`;
    // Existing identical audio is reused; equal names/sizes alone are insufficient.
    if (!fs.existsSync(path.join(libraryDir, file))) await fs.promises.copyFile(source, path.join(libraryDir, file));
    imported.push({ id, file, ext, name: path.basename(source, path.extname(source)) });
  }
  return imported;
}
module.exports = { importAudioFiles };
