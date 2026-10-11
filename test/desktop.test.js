const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const settle = () => new Promise((resolve) => setImmediate(resolve));

function desktop({ platform = 'darwin', trayFails = false, serverStart, env = {} } = {}) {
  const windows = [];
  const flags = new Map();
  const errors = [];
  const writes = [];
  const mkdirs = [];
  const shortcuts = [];
  const appPaths = { userData: '/test/user-data' };
  let starts = 0;
  let applicationMenu = null;
  let quitCount = 0;
  const app = new EventEmitter();
  app.commandLine = { appendSwitch: (name, value) => flags.set(name, value) };
  app.whenReady = () => Promise.resolve();
  app.requestSingleInstanceLock = () => true;
  app.getPath = (name) => appPaths[name];
  app.setPath = (name, value) => { appPaths[name] = value; };
  app.quit = () => {
    quitCount++;
    app.emit('before-quit');
    for (const window of windows.filter((w) => !w.isDestroyed())) window.close();
    app.emit('will-quit');
  };
  const ipcMain = new EventEmitter();
  ipcMain.handlers = new Map();
  ipcMain.handle = (name, callback) => ipcMain.handlers.set(name, callback);
  ipcMain.removeHandler = (name) => ipcMain.handlers.delete(name);
  const powerMonitor = new EventEmitter();
  const nativeTheme = Object.assign(new EventEmitter(), { shouldUseDarkColors: false, prefersReducedTransparency: false, shouldUseHighContrastColors: false });

  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.visible = false;
      this.destroyed = false;
      this.minimized = false;
      this.maximized = false;
      this.fullscreen = false;
      this.focusCount = 0;
      this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      this.webContents = new EventEmitter();
      this.webContents.sent = [];
      this.webContents.send = (...args) => this.webContents.sent.push(args);
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.isLoadingMainFrame = () => false;
      windows.push(this);
    }
    static getAllWindows() { return windows.filter((w) => !w.isDestroyed()); }
    loadFile() { queueMicrotask(() => this.emit('ready-to-show')); return Promise.resolve(); }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    isMinimized() { return this.minimized; }
    isMaximized() { return this.maximized; }
    isFullScreen() { return this.fullscreen; }
    show() { this.visible = true; this.emit('show'); }
    hide() { this.visible = false; this.emit('hide'); }
    focus() { this.focusCount++; }
    minimize() { this.minimized = true; this.emit('minimize'); }
    restore() { this.minimized = false; this.emit('restore'); }
    maximize() { this.maximized = true; this.emit('maximize'); }
    unmaximize() { this.maximized = false; this.emit('unmaximize'); }
    setFullScreen(value) { this.fullscreen = value; }
    getBounds() { return this.bounds; }
    getNormalBounds() { return this.bounds; }
    setBounds(bounds) { this.bounds = bounds; }
    setSize(width, height) { this.bounds = { ...this.bounds, width, height }; }
    setMinimumSize(width, height) { this.minimumSize = { width, height }; }
    setAlwaysOnTop() {}
    setWindowButtonVisibility(value) { this.buttonsVisible = value; }
    setWindowButtonPosition(value) { this.buttonPosition=value; }
    setVibrancy(value) { this.vibrancy = value; }
    setBackgroundColor(value) { this.background = value; }
    close() {
      const event = { prevented: false, preventDefault() { this.prevented = true; } };
      this.emit('close', event);
      if (event.prevented) return;
      this.destroyed = true;
      this.visible = false;
      this.emit('closed');
      if (BrowserWindow.getAllWindows().length === 0) app.emit('window-all-closed');
    }
  }

  class Tray extends EventEmitter {
    constructor() { super(); if (trayFails) throw new Error('No tray available'); }
    setToolTip() {}
    setContextMenu(menu) { this.menu = menu; }
  }
  const display = { workArea: { x: 0, y: 0, width: 1512, height: 982 }, scaleFactor: 2 };
  const electron = {
    app, BrowserWindow, ipcMain, powerMonitor, Tray, nativeTheme,
    dialog: { showErrorBox: (...args) => errors.push(args) },
    screen: { getPrimaryDisplay: () => display, getDisplayMatching: () => display },
    shell: { openExternal: () => Promise.resolve() },
    nativeImage: { createFromPath: () => ({ resize() { return this; } }) },
    Menu: {
      buildFromTemplate: (template) => template,
      setApplicationMenu: (menu) => { applicationMenu = menu; }
    },
    globalShortcut: { register: (name) => { shortcuts.push(name); return true; }, unregister() {}, unregisterAll() {} }
  };
  const mocks = {
    electron,
    fs: {
      readFileSync() { throw new Error('Missing saved window state'); },
      mkdirSync: (dir) => mkdirs.push(dir),
      writeFileSync: (...args) => writes.push(args)
    },
    './platform': { LIBRARY_DIR: '/test/library', DATA_DIR: '/test/user-data', resolveBinary: () => null },
    './tool-processes': {stopTools(){}},
    './spotify-service': {createSpotify: () => ({close(){},invoke(){},status(){return {connected:false};}})},
    './window-appearance': require('../window-appearance'),
    './library-import': require('../library-import'),
    './server': { setSpotifyProvider(){}, PORT: 38472, startServer: () => { starts++; return serverStart ? serverStart() : Promise.resolve(38472); } },
    './discord-rpc': { initRPC() {}, destroyRPC() {} },
    './updater': { initUpdater() {} }
  };
  vm.runInNewContext(source, {
    require: (name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    process: { platform, env, argv: ['electron', '.'] },
    __dirname: path.join(__dirname, '..'),
    setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {} }
  }, { filename: 'main.js' });
  return { app, ipcMain, powerMonitor, windows, flags, errors, writes, mkdirs, shortcuts, appPaths,
    get starts() { return starts; }, get menu() { return applicationMenu; }, get quitCount() { return quitCount; } };
}

test('Mac uses native controls and standard menu roles without global media capture', async () => {
  const d = desktop();
  await settle();
  assert.equal(d.windows[0].options.frame, false);
  assert.equal(d.windows[0].buttonsVisible, true);
  assert.equal(d.windows[0].options.titleBarStyle, 'hidden');
  assert.equal(d.windows[0].options.trafficLightPosition.x, 24);
  assert.equal(d.windows[0].buttonPosition.x,24);
  assert.equal(d.windows[0].buttonPosition.y,24);
  assert.equal(d.windows[0].options.vibrancy, 'under-window');
  assert.equal(d.windows[0].background, '#00000000');
  assert.equal(d.windows[0].vibrancy, 'under-window');
  assert.equal(d.menu[0].label, 'Cuda');
  assert.ok(d.menu[0].submenu.some((item) => item.role === 'quit'));
  assert.ok(d.menu.some((item) => item.role === 'editMenu'));
  assert.ok(d.menu.find((item) => item.label === 'File').submenu.some((item) => item.role === 'close'));
  assert.equal(d.flags.has('ignore-gpu-blocklist'), false);
  d.ipcMain.emit('set-media-keys', {}, true);
  d.ipcMain.emit('media-keys-active');
  d.powerMonitor.emit('resume');
  assert.deepEqual(d.shortcuts, []);
  assert.deepEqual(d.errors, []);
});

test('Dock activation shows hidden windows and restores minimized windows', async () => {
  const d = desktop();
  await settle();
  const window = d.windows[0];
  window.hide();
  d.app.emit('activate');
  await settle();
  assert.equal(window.isVisible(), true);
  assert.equal(window.focusCount, 1);
  window.minimize();
  d.app.emit('activate');
  await settle();
  assert.equal(window.isMinimized(), false);
  assert.equal(d.windows.length, 1);
  assert.equal(d.starts, 1);
});

test('closing then concurrently reopening a Mac window reuses the server', async () => {
  const d = desktop();
  await settle();
  d.ipcMain.emit('set-tray-on-close', {}, false);
  d.windows[0].close();
  assert.equal(d.windows[0].isDestroyed(), true);
  assert.equal(d.quitCount, 0);
  d.app.emit('activate');
  d.app.emit('activate');
  d.app.emit('second-instance');
  await settle();
  assert.equal(d.windows.length, 2);
  assert.equal(d.starts, 1);
  assert.equal(d.windows[1].isVisible(), true);
  assert.deepEqual(d.errors, []);
});

test('Mac close keeps playback alive even when tray creation fails, and Quit closes it', async () => {
  const d = desktop({ trayFails: true });
  await settle();
  const window = d.windows[0];
  window.close();
  assert.equal(window.isDestroyed(), false);
  assert.equal(window.isVisible(), false);
  d.app.emit('activate');
  await settle();
  assert.equal(window.isVisible(), true);
  d.app.quit();
  assert.equal(window.isDestroyed(), true);
  assert.equal(d.quitCount, 1);
});

test('native Settings and Import menu commands show a hidden window', async () => {
  const d = desktop();
  await settle();
  const window = d.windows[0];
  window.hide();
  await d.menu[0].submenu.find((item) => item.label === 'Settings…').click();
  assert.equal(window.isVisible(), true);
  assert.deepEqual(window.webContents.sent.at(-1), ['app-command', 'settings']);
  await d.menu.find((item) => item.label === 'File').submenu.find((item) => item.label === 'Import Audio…').click();
  assert.deepEqual(window.webContents.sent.at(-1), ['app-command', 'import-audio']);
});

test('quitting during startup does not create a late window', async () => {
  let resolveServer;
  const d = desktop({ serverStart: () => new Promise((resolve) => { resolveServer = resolve; }) });
  await settle();
  d.app.emit('before-quit');
  resolveServer(38472);
  await settle();
  assert.equal(d.windows.length, 0);
});

test('Windows retains custom controls and media key registration', async () => {
  const d = desktop({ platform: 'win32' });
  await settle();
  assert.equal(d.windows[0].options.frame, false);
  assert.equal(d.windows[0].options.trafficLightPosition, undefined);
  assert.equal(d.menu, null);
  d.ipcMain.emit('media-keys-active');
  assert.equal(d.shortcuts.length, 4);
  d.ipcMain.emit('set-tray-on-close', {}, false);
  d.windows[0].close();
  assert.ok(d.quitCount > 0);
});

test('user data can be isolated before creating a window', async () => {
  const d = desktop({ env: { RIFF_USER_DATA_DIR: '/test/smoke-user-data' } });
  assert.equal(d.appPaths.userData, '/test/smoke-user-data');
  assert.ok(d.mkdirs.includes('/test/smoke-user-data'));
  await settle();
  d.windows[0].close();
  assert.equal(d.writes[0][0], '/test/smoke-user-data/window-state.json');
  assert.throws(() => desktop({ env: { RIFF_USER_DATA_DIR: 'relative-dir' } }), /must be an absolute path/);
});

test('mini player waits for fullscreen exit, coalesces requests, and restores bounds', async () => {
  const d = desktop();
  await settle();
  const window = d.windows[0];
  const initial = { ...window.bounds };
  window.fullscreen = true;
  const toggle = d.ipcMain.handlers.get('toggle-mini-window');
  const first = toggle();
  const duplicate = toggle();
  assert.equal(first, duplicate);
  assert.deepEqual(window.bounds, initial, 'do not resize during native fullscreen transition');
  window.emit('leave-full-screen');
  assert.equal(await first, true);
  assert.deepEqual(window.minimumSize, { width: 320, height: 160 });
  assert.equal(window.bounds.width, 380);
  assert.equal(window.bounds.height, 160);
  assert.equal(await toggle(), false);
  assert.deepEqual({ ...window.bounds }, initial);
});

test('closing during fullscreen transition does not resize a destroyed window', async () => {
  const d = desktop();
  await settle();
  const window = d.windows[0];
  window.fullscreen = true;
  const entering = d.ipcMain.handlers.get('toggle-mini-window')();
  d.ipcMain.emit('set-tray-on-close', {}, false);
  window.close();
  assert.equal(await entering, false);
  assert.equal(window.isDestroyed(), true);
});
