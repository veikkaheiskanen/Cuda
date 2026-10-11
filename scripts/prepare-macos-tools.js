#!/usr/bin/env node
const path = require('path');
const { prepareMacosTools } = require('../macos-tools');

async function main(args = process.argv.slice(2)) {
  let arch = process.arch;
  let dest;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--arch' && args[i + 1]) arch = args[++i];
    else if (args[i] === '--dest' && args[i + 1]) dest = path.resolve(args[++i]);
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  let previous = '';
  const result = await prepareMacosTools({ arch, dest, onProgress(tool, percent) {
    if (tool !== previous) { console.log(`Preparing ${tool}…`); previous = tool; }
  } });
  console.log(`Verified macOS ${arch} audio tools: ${result}`);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { main, prepareMacosTools };
