const { app, BrowserWindow, dialog, ipcMain, screen, shell, Tray, Menu, nativeImage, globalShortcut, powerMonitor, nativeTheme, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const crypto = require('crypto');
const { createAppearance } = require('./window-appearance');
const { importAudioFiles } = require('./library-import');
const { LIBRARY_DIR, DATA_DIR } = require('./platform');
const isMacOS = process.platform === 'darwin';

if (!process.env.RIFF_USER_DATA_DIR && isMacOS) {
  fs.mkdirSync(DATA_DIR, {recursive:true});
  app.setPath('userData', DATA_DIR); // Keep existing Riff libraries and preferences after the Cuda rename.
}

if (process.env.RIFF_USER_DATA_DIR) {
  const userDataDir = process.env.RIFF_USER_DATA_DIR;
  if (!path.isAbsolute(userDataDir)) throw new Error('RIFF_USER_DATA_DIR must be an absolute path');
  fs.mkdirSync(userDataDir, { recursive: true });
  app.setPath('userData', userDataDir);
}

const enabledFeatures = [];
if (process.platform === 'linux') {
  enabledFeatures.push('WaylandWindowDecorations', 'UseOzonePlatform', 'WaylandFractionalScaleV1', 'MediaSessionService', 'HardwareMediaKeyHandling');
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  app.commandLine.appendSwitch('disable-features', 'Vulkan');

  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
  if (process.env.RIFF_SKIP_GPU_BUFFER_FLAGS !== '1') {
    app.commandLine.appendSwitch('disable-gpu-memory-buffer-video-frames');
    app.commandLine.appendSwitch('disable-gpu-memory-buffer-compositor-resources');
  }
}

if (process.platform === 'win32') {
  enabledFeatures.push('HardwareMediaKeyHandling');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}

if (isMacOS) {
  // Let Chromium's MediaSession route the Mac keyboard and Control Center controls.
  // Global media shortcuts on macOS would require Accessibility permission.
  enabledFeatures.push('MediaSessionService', 'HardwareMediaKeyHandling');
}

if (enabledFeatures.length > 0) {
  app.commandLine.appendSwitch('enable-features', enabledFeatures.join(','));
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

const extraFlags = (process.env.RIFF_FLAGS || '').split(';').map((s) => s.trim()).filter(Boolean);
for (const flag of extraFlags) {
  const eq = flag.indexOf('=');
  if (eq > 0) app.commandLine.appendSwitch(flag.slice(0, eq), flag.slice(eq + 1));
  else app.commandLine.appendSwitch(flag);
}

if (process.env.RIFF_DEBUG === '1') {
  app.whenReady().then(async () => {
    console.log('[gpu] features', JSON.stringify(app.getGPUFeatureStatus()));
    try {
      console.log('[gpu] info', JSON.stringify(await app.getGPUInfo('basic')));
    } catch (e) {}
    setInterval(() => {
      const rows = app.getAppMetrics().map((m) => `${m.type}:${Math.round(m.cpu.percentCPUUsage)}%`);
      console.log('[cpu]', rows.join('  '));
    }, 5000).unref();
  });
}

if (process.argv.includes('lyrics') || process.argv.includes('--lyrics')) {
  const cliPath = path.join(__dirname, 'cli.js');
  const child = spawn(process.execPath, [cliPath, 'lyrics'], { stdio: 'inherit', env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }) });
  child.on('exit', (code) => process.exit(code || 0));
} else {
  runGUI();
}

function runGUI() {
  const { startServer, PORT, setSpotifyProvider } = require('./server');
  const discordRPC = require('./discord-rpc');

  let mainWindow = null, nativeCornerApplied = false, nativeMaterial = null;
  const appearance = createAppearance({ app, nativeTheme, fs, platform: process.platform, getWindow: () => mainWindow, onApplied: window => window.emit('appearance-applied') });
  ipcMain.handle('get-window-frame', () => mainWindow ? {...mainWindow.getBounds(),fullScreen:mainWindow.isFullScreen(),cornerRadius:mainWindow.isFullScreen()?0:24,nativeCornerApplied,nativeClip:nativeMaterial?.inspect(mainWindow.getNativeWindowHandle())} : {cornerRadius:24});
  ipcMain.handle('get-appearance', () => appearance.snapshot());
  ipcMain.handle('set-appearance', (_event, value) => appearance.set(value));
  const { createSpotify } = require('./spotify-service');
  const { resolveBinary } = require('./platform');
  const spotify = createSpotify({ directory: app.getPath('userData'), safeStorage, openExternal: url => shell.openExternal(url), binary: resolveBinary('riff-spotify-player') || path.join(__dirname,'bin','darwin-arm64','bin','riff-spotify-player'), emit: value => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('spotify-event', value); } });
  setSpotifyProvider(spotify);
  ipcMain.handle('spotify', (event, operation, args) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Unknown caller');
    return spotify.invoke(operation, args);
  });
  app.on('before-quit', () => {spotify.close();require('./tool-processes').stopTools();});
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) { app.quit(); return; }
  app.on('second-instance', () => {
    showMainWindow().catch(handleWindowError);
  });
  let serverPort = PORT;
  let tray = null;
  let isQuitting = false;
  let trayOnClose = process.platform !== 'linux';
  let isMiniWindow = false;
  let preMiniBounds = null;
  let serverReady = null;
  let windowCreation = null;

  const windowStatePath = path.join(app.getPath('userData'), 'window-state.json');

  function readWindowState() {
    try {
      const raw = fs.readFileSync(windowStatePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed;
    } catch (error) {
      return null;
    }
  }

  function clampBoundsToDisplay(bounds) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const primaryWorkArea = primaryDisplay.workArea;
    const scaleFactor = primaryDisplay.scaleFactor;

    const sourceBounds = bounds && Number.isFinite(bounds.width) && Number.isFinite(bounds.height)
    ? { ...bounds }
    : {};

    const minW = 360;
    const minH = 500;

    const width = Math.max(minW, Math.min(sourceBounds.width || 0, primaryWorkArea.width));
    const height = Math.max(minH, Math.min(sourceBounds.height || 0, primaryWorkArea.height));

    const display = screen.getDisplayMatching({
      x: sourceBounds.x ?? primaryWorkArea.x,
      y: sourceBounds.y ?? primaryWorkArea.y,
      width,
      height
    }) || primaryDisplay;

    const workArea = display.workArea;
    const x = Math.min(
      Math.max(sourceBounds.x ?? workArea.x + Math.round((workArea.width - width) / 2), workArea.x),
                       workArea.x + Math.max(0, workArea.width - width)
    );
    const y = Math.min(
      Math.max(sourceBounds.y ?? workArea.y + Math.round((workArea.height - height) / 2), workArea.y),
                       workArea.y + Math.max(0, workArea.height - height)
    );

    return { x, y, width, height };
  }

  function getResponsiveWindowBounds() {
    const { workArea } = screen.getPrimaryDisplay();
    const persisted = readWindowState();
    const responsiveBounds = {
      width: Math.round(workArea.width * 0.82),
      height: Math.round(Math.min(workArea.height * 0.86, workArea.width * 0.82 * 9 / 16)),
      x: workArea.x + Math.round(workArea.width * 0.09),
      y: workArea.y + Math.round(workArea.height * 0.07)
    };
    const merged = {
      ...responsiveBounds,
      ...(persisted && persisted.bounds ? persisted.bounds : {})
    };
    return clampBoundsToDisplay(merged);
  }

  function persistWindowState() {
    if (isMiniWindow) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const isMaximized = mainWindow.isMaximized();
    const isFullScreen = mainWindow.isFullScreen();
    const bounds = isMaximized || isFullScreen ? mainWindow.getNormalBounds() : mainWindow.getBounds();
    try {
      fs.mkdirSync(path.dirname(windowStatePath), { recursive: true });
      fs.writeFileSync(windowStatePath, JSON.stringify({
        bounds,
        isMaximized,
        isFullScreen
      }, null, 2));
    } catch (error) {
      console.warn('Failed to persist window state:', error);
    }
  }

  async function showMainWindow() {
    const window = await createWindow();
    if (!window || window.isDestroyed() || isQuitting) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  function handleWindowError(error) {
    console.error('Failed to open Cuda:', error);
    dialog.showErrorBox('Unable to open Cuda', error.message || String(error));
    app.quit();
  }

  function createWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) return Promise.resolve(mainWindow);
    if (windowCreation) return windowCreation;
    windowCreation = buildWindow().finally(() => { windowCreation = null; });
    return windowCreation;
  }

  async function buildWindow() {
    // Closing and reopening a Mac window must not start the HTTP server again.
    if (!serverReady) {
      serverReady = startServer(PORT).catch((error) => {
        serverReady = null;
        throw error;
      });
    }
    serverPort = await serverReady;
    if (isQuitting) return null;
    const initialBounds = getResponsiveWindowBounds();
    const savedState = readWindowState();

    const window = new BrowserWindow({
      x: initialBounds.x,
      y: initialBounds.y,
      width: initialBounds.width,
      height: initialBounds.height,
      minWidth: 360,
                                   minHeight: 500,
                                   backgroundColor: appearance.background(),
                                   title: 'Cuda',
                                   icon: path.join(__dirname, 'assets', 'icon.png'),
                                   frame: false,
                                   titleBarStyle: 'hidden',
                                   ...(isMacOS ? { trafficLightPosition: { x: 24, y: 24 }, vibrancy: appearance.snapshot().effectiveTransparency ? 'under-window' : undefined, visualEffectState: 'followWindow' } : {}),
                                   show: false,
                                   useContentSize: true,
                                   webPreferences: {
                                     preload: path.join(__dirname, 'preload.js'),
                                   nodeIntegration: false,
                                   contextIsolation: true,
                                   webSecurity: true,
                                   backgroundThrottling: false,
                                   spellcheck: false
                                   }
    });
    mainWindow = window;
    appearance.apply();
    if (isMacOS) {
      window.setWindowButtonVisibility(true);
      window.setWindowButtonPosition({x:24,y:24});
      try {
        const material = nativeMaterial = require(path.join(path.dirname(resolveBinary('riff-spotify-player') || path.join(__dirname,'bin','darwin-arm64','bin','riff-spotify-player')), 'window-material.node'));
        const round = () => {
          if (window.isDestroyed()) return;
          const radius=window.isFullScreen()?0:24;
          if(radius)window.setWindowButtonPosition({x:24,y:24});
          nativeCornerApplied = material.apply(window.getNativeWindowHandle(),radius);
          window.webContents.send('window-frame',{...window.getBounds(),fullScreen:window.isFullScreen(),cornerRadius:radius});
        };
        round(); window.on('appearance-applied', round); window.on('show',round); window.on('resize', round); window.on('enter-full-screen', round); window.on('leave-full-screen', round); window.webContents.on('did-finish-load', round);
      } catch (error) { console.warn('Window material:', error.message); }
    }

    if (savedState?.isMaximized) {
      window.maximize();
    }
    if (savedState?.isFullScreen) {
      window.setFullScreen(true);
    }

    window.once('ready-to-show', () => {
      if (window.isDestroyed() || isQuitting) return;
      window.show();
    });

    window.loadFile(path.join(__dirname, 'index.html')).catch((error) => {
      if (!window.isDestroyed() && !isQuitting) handleWindowError(error);
    });

    window.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });

    mainWindow.on('minimize', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('window-visibility', false);
      }
    });

    mainWindow.on('restore', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('window-visibility', true);
      }
    });

    mainWindow.on('hide', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('window-visibility', false);
      }
    });

    mainWindow.on('show', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('window-visibility', true);
      }
    });
    mainWindow.on('resize', persistWindowState);
    mainWindow.on('move', persistWindowState);
    mainWindow.on('maximize', persistWindowState);
    mainWindow.on('unmaximize', persistWindowState);
    mainWindow.on('enter-full-screen', persistWindowState);
    mainWindow.on('leave-full-screen', persistWindowState);
    window.on('close', (e) => {
      persistWindowState();
      if (trayOnClose && (tray || isMacOS) && !isQuitting) {
        e.preventDefault();
        window.hide();
      }
    });
    window.on('closed', () => {
      if (mainWindow === window) mainWindow = null;
      isMiniWindow = false;
      preMiniBounds = null;
    });

    discordRPC.initRPC();
    return window;
  }

  ipcMain.removeHandler('get-server-port');
  ipcMain.removeHandler('discord-rpc-get-enabled');
  ipcMain.removeHandler('discord-rpc-get-connected');
  ipcMain.removeHandler('pick-media');
  ipcMain.removeHandler('import-audio-files');

  ipcMain.on('window-minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  });

    ipcMain.on('window-maximize', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();
      }
    });

    ipcMain.on('window-close', () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    });

      ipcMain.handle('get-server-port', () => serverPort);
      ipcMain.handle('get-gpu-compositing', () => { try { return String(app.getGPUFeatureStatus().gpu_compositing || ''); } catch (e) { return ''; } });

      ipcMain.on('discord-rpc-update', (event, trackInfo) => {
        discordRPC.updatePresence(trackInfo);
      });

      ipcMain.on('discord-rpc-clear', () => {
        discordRPC.clearPresence();
      });

      ipcMain.on('discord-rpc-set-enabled', (event, enabled) => {
        discordRPC.setEnabled(enabled);
      });

      ipcMain.handle('discord-rpc-get-enabled', () => discordRPC.getEnabled());
      ipcMain.handle('discord-rpc-get-connected', () => discordRPC.getConnected());

      ipcMain.handle('get-cache-size', async () => {
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        const { session } = require('electron');

        let webSize = 0;
        try { webSize = await session.defaultSession.getCacheSize(); } catch(e) {}

        let audioSize = 0;
        const tracksDir = require('./platform').CACHE_DIR;
        try {
          if (fs.existsSync(tracksDir)) {
            const files = fs.readdirSync(tracksDir);
            for (const file of files) {
              if (file.includes('.temp.')) {
                try {
                  audioSize += fs.statSync(path.join(tracksDir, file)).size;
                } catch(e) {}
              }
            }
          }
        } catch(e) {}

        return { audio: audioSize, web: webSize };
      });

      ipcMain.handle('clear-cache', async () => {
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        const { session } = require('electron');
        
        try { await session.defaultSession.clearCache(); } catch(e) {}
        try { await session.defaultSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] }); } catch(e) {}

        const tracksDir = require('./platform').CACHE_DIR;
        try {
          if (fs.existsSync(tracksDir)) {
            const files = fs.readdirSync(tracksDir);
            for (const file of files) {
              if (file.includes('.temp.')) {
                try { fs.unlinkSync(path.join(tracksDir, file)); } catch(e) {}
              }
            }
          }
        } catch(e) {}

        return true;
      });

      ipcMain.handle('pick-media', async () => {
        const r = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Media', extensions: ['png','jpg','jpeg','webp','gif','mp4','webm'] }] });
        return r.canceled ? null : pathToFileURL(r.filePaths[0]).href;
      });

      ipcMain.handle('import-audio-files', async () => {
        const r = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Audio', extensions: ['mp3','wav','flac','opus','ogg','oga','m4a','aac','webm','weba'] }] });
        if (r.canceled) return [];
        return importAudioFiles(r.filePaths, LIBRARY_DIR);
      });

      ipcMain.on('set-tray-on-close', (e, v) => {
        trayOnClose = !!v;
      });

      const MEDIA_KEYS = { MediaPlayPause: 'toggle', MediaNextTrack: 'next', MediaPreviousTrack: 'prev', MediaStop: 'stop' };
      let mediaKeysWanted = true;
      let mediaKeysActive = false;
      const sendMedia = (cmd) => {
        if (process.env.RIFF_DEBUG === '1') console.log('[media] globalShortcut', cmd);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('media-command', cmd);
      };
      function unregisterMediaKeys() {
        for (const k of Object.keys(MEDIA_KEYS)) {
          try { globalShortcut.unregister(k); } catch (e) {}
        }
      }
      function registerMediaKeys() {
        // macOS uses renderer MediaSession, without taking over other apps' keys.
        if (process.platform !== 'win32') return;
        unregisterMediaKeys();
        if (!mediaKeysWanted || !mediaKeysActive) return;
        for (const [k, cmd] of Object.entries(MEDIA_KEYS)) {
          try {
            if (!globalShortcut.register(k, () => sendMedia(cmd))) {
              console.warn('[media] could not register', k);
            }
          } catch (e) {}
        }
      }
      ipcMain.on('set-media-keys', (e, enabled) => { mediaKeysWanted = !!enabled; registerMediaKeys(); });
      ipcMain.on('media-keys-active', () => { if (!mediaKeysActive) { mediaKeysActive = true; registerMediaKeys(); } });
      powerMonitor.on('resume', registerMediaKeys);
      powerMonitor.on('unlock-screen', registerMediaKeys);
      app.on('will-quit', () => globalShortcut.unregisterAll());

      ipcMain.removeHandler('toggle-mini-window');
      let miniWindowTransition = null;
      async function resizeMiniWindow() {
        if (!mainWindow || mainWindow.isDestroyed()) return false;
        const window = mainWindow;
        if (!isMiniWindow) {
          const normalBounds = window.isMaximized() || window.isFullScreen() ? window.getNormalBounds() : window.getBounds();
          if (window.isFullScreen()) {
            // macOS leaves fullscreen asynchronously; resizing before this event
            // leaves the mini player filling the display.
            const didLeave = await new Promise((resolve) => {
              const finish = (left) => {
                clearTimeout(timer);
                window.removeListener('leave-full-screen', onLeave);
                window.removeListener('closed', onClose);
                resolve(left);
              };
              const onLeave = () => finish(true);
              const onClose = () => finish(false);
              const timer = setTimeout(() => finish(false), 5000);
              window.once('leave-full-screen', onLeave);
              window.once('closed', onClose);
              window.setFullScreen(false);
            });
            if (!didLeave || window.isDestroyed() || mainWindow !== window || isQuitting) return false;
          }
          isMiniWindow = true;
          preMiniBounds = normalBounds;
          if (mainWindow.isMaximized()) mainWindow.unmaximize();
          mainWindow.setMinimumSize(320, isMacOS ? 160 : 120);
          mainWindow.setSize(380, 160);
          mainWindow.setAlwaysOnTop(true);
          return true;
        } else {
          isMiniWindow = false;
          mainWindow.setAlwaysOnTop(false);
          mainWindow.setMinimumSize(360, 500);
          if (preMiniBounds) {
            mainWindow.setBounds(clampBoundsToDisplay(preMiniBounds));
          } else {
            mainWindow.setSize(1000, 700);
          }
          return false;
        }
      }
      ipcMain.handle('toggle-mini-window', () => {
        if (!miniWindowTransition) {
          miniWindowTransition = resizeMiniWindow().finally(() => { miniWindowTransition = null; });
        }
        return miniWindowTransition;
      });

      function toggleWindowVisibility() {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized()) {
          mainWindow.hide();
        } else {
          showMainWindow().catch(handleWindowError);
        }
      }

      async function sendAppCommand(command) {
        await showMainWindow();
        const window = mainWindow;
        if (!window || window.isDestroyed()) return;
        if (window.webContents.isLoadingMainFrame()) {
          await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
        }
        if (!window.isDestroyed()) window.webContents.send('app-command', command);
      }

      function setupApplicationMenu() {
        if (!isMacOS) return;
        const appCommand = (command) => () => sendAppCommand(command).catch(handleWindowError);
        Menu.setApplicationMenu(Menu.buildFromTemplate([
          {
            label: 'Cuda',
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { label: 'Settings…', accelerator: 'Command+,', click: appCommand('settings') },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          },
          {
            label: 'File',
            submenu: [
              { label: 'Import Audio…', accelerator: 'Command+O', click: appCommand('import-audio') },
              { type: 'separator' },
              { role: 'close' }
            ]
          },
          { role: 'editMenu' },
          {
            label: 'View',
            submenu: [
              { role: 'reload' },
              { role: 'toggleDevTools' },
              { type: 'separator' },
              { role: 'togglefullscreen' }
            ]
          },
          {
            label: 'Playback',
            submenu: [
              { label: 'Play / Pause', click: () => sendMedia('toggle') },
              { label: 'Next Track', click: () => sendMedia('next') },
              { label: 'Previous Track', click: () => sendMedia('prev') }
            ]
          },
          {
            role: 'windowMenu',
            submenu: [
              { role: 'minimize' },
              { role: 'zoom' },
              { type: 'separator' },
              { label: 'Show Cuda', accelerator: 'Command+1', click: () => showMainWindow().catch(handleWindowError) },
              { role: 'front' }
            ]
          },
          {
            role: 'help',
            submenu: [
              { label: 'Keyboard Shortcuts', click: appCommand('shortcuts') },
              { label: 'Cuda on GitHub', click: () => shell.openExternal('https://github.com/veikkaheiskanen/Cuda') }
            ]
          }
        ]));
      }

      function setupTray() {
        try {
          const iconPath = path.join(__dirname, 'assets', 'icon.png');
          let trayIcon = nativeImage.createFromPath(iconPath);
          trayIcon = trayIcon.resize({ width: 22, height: 22 });
          tray = new Tray(trayIcon);
          tray.setToolTip('Cuda');
          const contextMenu = Menu.buildFromTemplate([
            {
              label: 'Show/Hide',
              click: toggleWindowVisibility
            },
            {
              label: 'Play/Pause',
              click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('media-command', 'toggle');
                }
              }
            },
            { type: 'separator' },
            {
              label: 'Quit',
              click: () => {
                isQuitting = true;
                app.quit();
              }
            }
          ]);
          tray.setContextMenu(contextMenu);
          if (!isMacOS) tray.on('click', toggleWindowVisibility);
        } catch (err) {
          console.warn('Tray creation failed:', err);
          tray = null;
        }
      }

      app.on('before-quit', () => {
        isQuitting = true;
      });

      app.whenReady().then(() => {
        setupApplicationMenu();
        setupTray();
        createWindow().catch(handleWindowError);
        require('./updater').initUpdater(() => mainWindow);
        app.on('activate', () => {
          showMainWindow().catch(handleWindowError);
        });
      }).catch(handleWindowError);

      app.on('window-all-closed', () => {
        discordRPC.destroyRPC();
        if (process.platform !== 'darwin') app.quit();
      });
}
