const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

test('local Mac packages do not initialize the signed-app updater', () => {
  const handlers = new Map();
  let loadedUpdater = false;
  const context = {
    module: { exports: {} }, __dirname: '/app',
    process: { platform: 'darwin', resourcesPath: '/resources' },
    require(name) {
      if (name === 'electron') return {
        app: { isPackaged: true, getPath: () => '/profile', setVersion() {}, getVersion: () => '41.0.0' },
        ipcMain: { handle: (key, fn) => handlers.set(key, fn), on() {} }
      };
      if (name === 'fs') return { readFileSync: () => '{"automaticUpdates":false}' };
      if (name === 'path') return path;
      if (name === './package.json') return { version: '41.0.0' };
      if (name === 'electron-updater') loadedUpdater = true;
      throw new Error(`Unexpected module ${name}`);
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'updater.js'), 'utf8'), context);
  context.module.exports.initUpdater(() => null);
  const result = handlers.get('update-check')();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'local-mac-build');
  assert.match(result.message, /local Mac build/);
  assert.equal(loadedUpdater, false);
  assert.equal(handlers.get('get-app-version')(), '41.0.0');
});
