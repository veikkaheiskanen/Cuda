
document.addEventListener('DOMContentLoaded', async () => {
  const { escapeHTML, safeMediaURL, readStoredJSON, tracks: storedTracks, playlists: storedPlaylists, object: isStoredObject, hlsProxyLoader } = window.RiffUtils;
  const readJSON = (key, fallback, validate) => readStoredJSON(localStorage, key, fallback, validate);
  try { localStorage.removeItem('riff_stats'); } catch (e) {}
  const isMacOS = !!window.electronAPI?.isMacOS;
  document.body.classList.toggle('is-macos', isMacOS);
  if (isMacOS) {
    document.querySelectorAll('[data-shortcut-modifier]').forEach((keycap) => {
      keycap.textContent = '⌘';
      keycap.setAttribute('aria-label', 'Command');
    });
    const closeLabel = document.getElementById('setting-tray-on-close-name');
    const closeHint = document.getElementById('setting-tray-on-close-hint');
    if (closeLabel) closeLabel.textContent = 'Keep playing when window closes';
    if (closeHint) closeHint.textContent = 'Reopen from the Dock; use Cuda → Quit to exit';
  }

  const LiquidMotion = {
    setAnchor(element, triggerEl, axis = 'x') {
      if (!element) return;
      if (triggerEl) {
        const rect = triggerEl.getBoundingClientRect();
        const parentRect = element.parentElement ? element.parentElement.getBoundingClientRect() : { top: 0, left: 0 };
        if (axis === 'x') {
          const anchorY = (rect.top + rect.height / 2) - parentRect.top;
          element.style.setProperty('--liquid-anchor-y', `${anchorY}px`);
          element.style.setProperty('--liquid-anchor-x', '0px');
          element.style.transformOrigin = `0px ${anchorY}px`;
        } else {
          const anchorX = (rect.left + rect.width / 2) - parentRect.left;
          element.style.setProperty('--liquid-anchor-x', `${anchorX}px`);
          element.style.setProperty('--liquid-anchor-y', '0px');
          element.style.transformOrigin = `${anchorX}px 0px`;
        }
      } else {
        if (axis === 'x') {
          element.style.setProperty('--liquid-anchor-y', '50%');
          element.style.setProperty('--liquid-anchor-x', '0px');
          element.style.transformOrigin = '0px 50%';
        } else {
          element.style.setProperty('--liquid-anchor-x', '50%');
          element.style.setProperty('--liquid-anchor-y', '0px');
          element.style.transformOrigin = '50% 0px';
        }
      }
    },
    open(element, triggerEl, axis = 'x', onDone) {
      if (!element) return;
      this.setAnchor(element, triggerEl, axis);
      element.classList.remove('liquid-closing');
      element.classList.add('liquid-surface', `liquid-${axis}`, 'liquid-open');
      if (onDone) setTimeout(onDone, 480);
    },
    close(element, onDone) {
      if (!element) return;
      element.classList.add('liquid-closing');
      element.classList.remove('liquid-open');
      setTimeout(() => {
        element.classList.remove('liquid-closing', 'liquid-open');
        if (onDone) onDone();
      }, 300);
    }
  };
  window.LiquidMotion = LiquidMotion;


  function injectM3Shapes() {
    const defs = document.getElementById('m3-dynamic-defs');
    if (!defs) return;

    const formulas = {
      'm3-cookie-4': (a) => 40 + 6 * Math.cos(4 * a),
                          'm3-diamond-puffy': (a) => 36 + 10 * Math.cos(4 * a),
                          'm3-flower': (a) => 28 + 18 * Math.abs(Math.cos(4 * a)),
                          'm3-poly-6': (a) => {
                            let t = a % (2 * Math.PI / 6);
                            if (t < 0) t += 2 * Math.PI / 6;
                            return 36 / Math.cos(t - Math.PI / 6);
                          },
                          'm3-leaf-4': (a) => 40 + 6 * Math.cos(4 * a)
    };

    let html = '';
    for (const [id, formula] of Object.entries(formulas)) {
      let path = '';
      const res = 120;
      for (let i = 0; i <= res; i++) {
        const angle = (i / res) * 2 * Math.PI;
        const r = formula(angle);
        const x = 0.5 + (r * Math.cos(angle)) / 100;
        const y = 0.5 + (r * Math.sin(angle)) / 100;
        path += `${i === 0 ? 'M' : 'L'} ${x.toFixed(4)},${y.toFixed(4)} `;
      }
      path += 'Z';
      html += `<clipPath id="${id}" clipPathUnits="objectBoundingBox"><path d="${path}" /></clipPath>`;
    }
    defs.insertAdjacentHTML('beforeend', html);
  }
  injectM3Shapes();

  const toastQueue = [];
  let isToastActive = false;

  function showToast(message, type = 'info') {
    if (!message) return;
    toastQueue.push({ message, type });
    if (!isToastActive) {
      processToastQueue();
    }
  }

  function processToastQueue() {
    if (toastQueue.length === 0) {
      isToastActive = false;
      return;
    }
    isToastActive = true;
    const { message, type } = toastQueue.shift();
    const container = document.getElementById('toast-container');
    if (!container) {
      isToastActive = false;
      return;
    }

    const toast = document.createElement('div');
    toast.className = `riff-toast ${type} liquid-content-stagger`;

    let iconSvg = '';
    if (type === 'error') {
      iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    } else if (type === 'success') {
      iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
    } else if (type === 'warning') {
      iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
    } else {
      iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
    }

    const cleanMessage = String(message).charAt(0).toUpperCase() + String(message).slice(1);

    toast.innerHTML = `
      <span class="toast-icon">${iconSvg}</span>
      <span class="toast-text">${escapeHTML(cleanMessage)}</span>
    `;

    container.appendChild(toast);
    LiquidMotion.open(toast, null, 'y');

    let dismissed = false;
    let timer = null;
    let remaining = 3500;
    let startTimestamp = Date.now();

    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      if (timer) clearTimeout(timer);
      LiquidMotion.close(toast, () => {
        toast.remove();
        processToastQueue();
      });
    };

    const startTimer = (dur) => {
      startTimestamp = Date.now();
      timer = setTimeout(dismiss, dur);
    };

    toast.addEventListener('mouseenter', () => {
      if (timer) clearTimeout(timer);
      remaining -= (Date.now() - startTimestamp);
      if (remaining < 500) remaining = 500;
    });

    toast.addEventListener('mouseleave', () => {
      if (!dismissed) {
        startTimer(remaining);
      }
    });

    toast.addEventListener('click', dismiss);

    startTimer(remaining);
  }

  let requestedScale = 100;
  const savedScale = Math.max(90, Math.min(140, parseFloat(localStorage.getItem('devsize_ui_scale')) || 100));
  applyScale(savedScale);

  function applyScale(scalePercent) {
    requestedScale = scalePercent;
    const physicalWidth = window.innerWidth * (window.electronAPI?.getZoomFactor?.() || 1);
    const factor = physicalWidth <= 680 ? Math.min(1, scalePercent / 100) : scalePercent / 100;
    document.documentElement.style.setProperty('--app-scale', factor.toString());
    if (window.electronAPI && window.electronAPI.setZoomFactor) {
      window.electronAPI.setZoomFactor(factor);
    } else {
      document.body.style.zoom = factor;
    }
  }

  window.addEventListener('resize', () => applyScale(requestedScale));

  window.addEventListener('scroll', () => {
    if (window.scrollY !== 0 || window.scrollX !== 0) {
      window.scrollTo(0, 0);
    }
  }, { passive: true });

  function openModal(elModal) {
    if (!elModal) return;
    elModal.classList.remove('hidden');
    void elModal.offsetWidth;
    elModal.classList.add('visible');
  }

  function closeModal(elModal) {
    if (!elModal) return;
    elModal.classList.remove('visible');
    setTimeout(() => {
      elModal.classList.add('hidden');
    }, 200);
  }

  const defaultPresets = [
    { id: 'p_default', name: 'default', settings: { speed: 1.0, speedPitch: 1.0, pitch: 0, reverb: 0, distortion: 0, volume: 1.0, echo: 0, eq: { low: 0, mid: 0, high: 0 } } },
    { id: 'p_speedup', name: 'speed up (orig pitch)', settings: { speed: 1.35, speedPitch: 1.0, pitch: 0, reverb: 0, distortion: 0, volume: 1.0, echo: 0, eq: { low: 0, mid: 0, high: 0 } } },
                          { id: 'p_speedup_pitch', name: 'speed up (tape pitch)', settings: { speed: 1.0, speedPitch: 1.30, pitch: 0, reverb: 0, distortion: 0, volume: 1.0, echo: 0, eq: { low: 0, mid: 0, high: 0 } } },
                          { id: 'p_slowed', name: 'slowed + reverb', settings: { speed: 1.0, speedPitch: 0.82, pitch: 0, reverb: 65, distortion: 0, volume: 1.0, echo: 15, eq: { low: 0, mid: 0, high: 0 } } },
                          { id: 'p_nightcore', name: 'nightcore', settings: { speed: 1.0, speedPitch: 1.25, pitch: 0, reverb: 20, distortion: 0, volume: 1.0, echo: 0, eq: { low: 0, mid: 0, high: 0 } } },
                          { id: 'p_distortion', name: 'distortion hard', settings: { speed: 1.0, speedPitch: 1.0, pitch: 0, reverb: 0, distortion: 75, volume: 1.25, echo: 0, eq: { low: 0, mid: 0, high: 0 } } }
  ];

  const defaultVfx = {
    ambientGlow: true,
    bassPulse: false,
    vinylSpin: false,
    soundwaveRings: false,
    borderGlow: false,
    particles: false,
    backdropBlur: false,
    crt: false,
    grain: false,
    lyricsSpotlight: false
  };

  function normalizePreset(p) {
    if (!isStoredObject(p) || typeof p.id !== 'string') return null;
    const s = p.settings || p.values || {};
    const eq = s.eq || {};
    return {
      id: p.id,
      name: p.name || 'preset',
      settings: {
        speed: typeof s.speed === 'number' ? s.speed : 1.0,
        speedPitch: typeof s.speedPitch === 'number' ? s.speedPitch : 1.0,
        pitch: typeof s.pitch === 'number' ? s.pitch : (typeof s.pitchSemitones === 'number' ? s.pitchSemitones : 0),
                          reverb: typeof s.reverb === 'number' ? s.reverb : 0,
                          distortion: typeof s.distortion === 'number' ? s.distortion : 0,
                          volume: typeof s.volume === 'number' ? s.volume : (typeof s.gain === 'number' ? s.gain : 1.0),
                          echo: typeof s.echo === 'number' ? s.echo : 0,
                          eq: {
                            low: typeof eq.low === 'number' ? eq.low : 0,
                            mid: typeof eq.mid === 'number' ? eq.mid : 0,
                            high: typeof eq.high === 'number' ? eq.high : 0
                          }
      }
    };
  }

  const rawCustomPresets = readJSON('devsize_custom_presets', [], Array.isArray);
  const normalizedCustomPresets = rawCustomPresets.map(normalizePreset).filter(Boolean);

  const state = {
    platform: 'auto',
    currentView: 'discover',
    previousView: 'discover',
    currentPlaylistId: null,
    currentArtistData: null,
    searchQuery: '',
    searchResults: [],
    queue: [],
    queueIndex: -1,
    currentTrack: null,
    currentTrackContext: null,
    currentTrackIndexInContext: -1,
    isPlaying: false,
    isMuted: false,
    volume: 0.85,
    isRepeat: localStorage.getItem('riff_repeat') === '1',
    isShuffle: localStorage.getItem('riff_shuffle') === '1',
    isAutoRemix: false,
    myWaveActive: false,
    isRightPanelOpen: false,
    lyricsMode: 'line',
    uiScale: savedScale,
    activePresetId: 'p_default',
    themeMode: 'light',
    paletteStyle: localStorage.getItem('riff_palette_style') || 'classic',
    meshBrightness: parseInt(localStorage.getItem('riff_mesh_brightness') || '100', 10),
    themeAccent: '#1466bc',
    themeIntensity: parseInt(localStorage.getItem('riff_theme_intensity') || '0'),
    themeBrightness: parseInt(localStorage.getItem('riff_theme_brightness') || '50'),
    trEnabled: localStorage.getItem('riff_tr_enabled') === 'true',
    trLang: localStorage.getItem('riff_tr_lang') || 'en',
    trAuto: localStorage.getItem('riff_tr_auto') === 'true',
    trActive: false,
    currentTranslations: null,
    isTvKaraokeOpen: false,
                          audioSettings: {
                            speed: 1.0,
                          speedPitch: 1.0,
                          pitch: 0,
                          reverb: 0,
                          distortion: 0,
                          volume: 1.0,
                          echo: 0,
                          eq: { low: 0, mid: 0, high: 0 }
                          },
                          hqEnabled: false,
                          hqSettings: {
                            engine: 'hqmusic-3',
                          preset: 'studio',
                          vocal: 0,
                          air: 0,
                          bass: 0
                          },
                          vfx: { ...defaultVfx, ...readJSON('devsize_vfx', {}, isStoredObject), bassPulse: false, particles: false, soundwaveRings: false, borderGlow: false, backdropBlur: false, crt: false, grain: false, lyricsSpotlight: false },
                          favorites: storedTracks(readJSON('devsize_favorites', [], Array.isArray)),
                          history: storedTracks(readJSON('devsize_history', [], Array.isArray)),
                          playlists: storedPlaylists(readJSON('devsize_playlists', [], Array.isArray)),
                          customPresets: normalizedCustomPresets,
                          localTracks: [],
                          syncedLyrics: [],
                          glitchTimes: [],
                          lastGlitchedIndex: -1,
                          isGlitching: false,
                          isWindowVisible: true,
                          loadToken: 0,
                          currentAbortController: null,
                          presetToRenameId: null,
                          serverPort: 38472,
                          discordRpcEnabled: readJSON('devsize_discord_rpc', false),
                          lastBroadcastStateKey: null,
                          syncTimeout: null,
                          scrubberDragTargetTime: undefined
  };

  if (window.electronAPI && window.electronAPI.getServerPort) {
    try {
      state.serverPort = await window.electronAPI.getServerPort();
    } catch (e) {
      console.warn('Failed to get server port:', e);
    }
  }

  checkToolsStatus(true);

  if (window.electronAPI && window.electronAPI.discordRpcSetEnabled) {
    window.electronAPI.discordRpcSetEnabled(state.discordRpcEnabled);
  }

  function sendDiscordRpcUpdate(track, isPlaying) {
    if (!window.electronAPI || !window.electronAPI.discordRpcUpdate) return;
    if (!track || !isPlaying) {
      if (window.electronAPI.discordRpcClear) window.electronAPI.discordRpcClear();
      return;
    }
    const origThumb = (track.thumbnail && !track.thumbnail.startsWith('file://')) ? track.thumbnail : '';
    window.electronAPI.discordRpcUpdate({
      title: track.title || 'Unknown Track',
      artist: track.artist || 'Unknown Artist',
      duration: track.duration || 0,
      thumbnail: origThumb,
      url: track.url || '',
      platform: track.platform || state.platform,
      startTimestamp: Math.floor(Date.now() / 1000)
    });
  }

  function sendStateToServer(currentWordText = '', wordIndex = -1, lineIndex = -1) {
    if (!state.currentTrack) return;
    fetch(`http://127.0.0.1:${state.serverPort}/api/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: state.currentTrack.title,
        artist: state.currentTrack.artist,
        isPlaying: state.isPlaying,
        word: currentWordText,
        wordIndex: wordIndex,
        lineIndex: lineIndex
      })
    }).catch(() => {});
  }

  function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    if (state.currentTrack) {
      const thumb = (typeof getTrackThumbUrl === 'function' ? getTrackThumbUrl(state.currentTrack) : '') || state.currentTrack.thumbnail || '';
      navigator.mediaSession.metadata = new MediaMetadata({
        title: state.currentTrack.title || 'Untitled',
        artist: state.currentTrack.artist || 'Unknown Artist',
        album: state.currentTrack.album || '',
        artwork: thumb ? [{ src: thumb, sizes: '512x512' }] : []
      });
    } else {
      navigator.mediaSession.metadata = null;
    }
    navigator.mediaSession.playbackState = state.isPlaying ? 'playing' : 'paused';
    if (spotifyActive() && navigator.mediaSession.setPositionState && playbackDuration()>0) {try{navigator.mediaSession.setPositionState({duration:playbackDuration(),position:Math.min(playbackDuration(),Math.max(0,playbackTime())),playbackRate:(state.audioSettings.speedPitch!==1 || state.audioSettings.pitch!==0)?state.audioSettings.speedPitch*Math.pow(2,state.audioSettings.pitch/12):state.audioSettings.speed});}catch{}}
    else if (!spotifyActive() && navigator.mediaSession.setPositionState) {try{navigator.mediaSession.setPositionState();}catch{}}
  }

  const MEDIA_GROUP = { toggle: 'pp', play: 'pp', pause: 'pp', next: 'next', prev: 'prev', stop: 'stop' };
  let lastMedia = { g: '', t: 0 };
  let hasNotifiedMediaKeysActive = false;
  function handleMediaCommand(cmd, src) {
    const g = MEDIA_GROUP[cmd];
    if (!g) return;
    const now = performance.now();
    if (lastMedia.cmd === cmd && lastMedia.src !== src && now - lastMedia.t < 350) return;
    lastMedia = { cmd, src, t: now };
    if (cmd === 'toggle') togglePlayPause();
    else if (cmd === 'play') { if (playbackPaused()) togglePlayPause(); }
    else if (cmd === 'pause') { if (!playbackPaused()) togglePlayPause(); }
    else if (cmd === 'next') playNext();
    else if (cmd === 'prev') playPrev();
    else if (cmd === 'stop') { if (!playbackPaused()) togglePlayPause(); }
  }

  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', () => handleMediaCommand('play', 'session'));
      navigator.mediaSession.setActionHandler('pause', () => handleMediaCommand('pause', 'session'));
      navigator.mediaSession.setActionHandler('previoustrack', () => handleMediaCommand('prev', 'session'));
      navigator.mediaSession.setActionHandler('nexttrack', () => handleMediaCommand('next', 'session'));
      navigator.mediaSession.setActionHandler('stop', () => handleMediaCommand('stop', 'session'));
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime !== undefined && details.seekTime !== null && el.nativeAudio) {
          seekPlayback(details.seekTime);
          if (typeof updateSyncedLyricsHighlight === 'function') {
            updateSyncedLyricsHighlight(details.seekTime);
          }
        }
      });
    } catch (e) {
      console.warn('mediaSession action handler error:', e);
    }
  }

  function hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const num = parseInt(hex, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
  }

  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1); };
    return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
  }

  function getAdv(name, defaultVal = true) {
    const val = localStorage.getItem(`riff_adv_${name}`);
    if (val === null) return defaultVal;
    return val === 'true';
  }

  function setAdv(name, boolVal) {
    localStorage.setItem(`riff_adv_${name}`, boolVal ? 'true' : 'false');
  }

  function applyReducedMotionSetting() {
    document.documentElement.classList.remove('force-reduced-motion');
  }

  const PALETTE_STYLES = {
    classic: {
      label: 'Classic',
      secHueShift: 0,
      tertHueShift: 0,
      priSatScale: 1.0,
      surfSatScale: 1.0,
      contSatScale: 1.0
    },
    'tonal-spot': {
      label: 'Tonal spot',
      secHueShift: 0,
      tertHueShift: 60,
      priSatScale: 1.0,
      surfSatScale: 0.8,
      contSatScale: 0.9
    },
    expressive: {
      label: 'Expressive',
      secHueShift: 60,
      tertHueShift: 120,
      priSatScale: 1.25,
      surfSatScale: 1.5,
      contSatScale: 1.3
    },
    vibrant: {
      label: 'Vibrant',
      secHueShift: 0,
      tertHueShift: 60,
      priSatScale: 1.4,
      surfSatScale: 1.2,
      contSatScale: 1.4
    },
    neutral: {
      label: 'Neutral',
      secHueShift: 0,
      tertHueShift: 0,
      priSatScale: 0.35,
      surfSatScale: 0.2,
      contSatScale: 0.25
    }
  };

  const tint = (hex, v) => `color-mix(in srgb, ${hex} var(${v}), transparent)`;
  const SURFACE_TOKENS = new Set([
    '--md-sys-color-background',
    '--md-sys-color-surface',
    '--md-sys-color-surface-dim',
    '--md-sys-color-surface-bright',
    '--md-sys-color-surface-container-lowest',
    '--md-sys-color-surface-container-low',
    '--md-sys-color-surface-container',
    '--md-sys-color-surface-container-high',
    '--md-sys-color-surface-container-highest'
  ]);
  const TEXT_TOKENS = new Set([
    '--md-sys-color-on-surface',
    '--md-sys-color-on-surface-variant'
  ]);

  function generateM3Palette(hexColor, mode, intensity, brightness) {
    if (!hexColor) hexColor = '#6750A4';
    const rgb = hexToRgb(hexColor);
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    const h = hsl.h;
    const intensityFactor = (typeof intensity === 'number' ? intensity : 100) / 100;
    const root = document.documentElement;

    const setToken = (prop, val) => {
      if (SURFACE_TOKENS.has(prop)) {
        root.style.setProperty(prop, tint(val, '--ui-alpha'));
        root.style.setProperty(`${prop}-solid`, val);
      } else if (TEXT_TOKENS.has(prop)) {
        root.style.setProperty(prop, tint(val, '--text-alpha'));
        root.style.setProperty(`${prop}-solid`, val);
      } else {
        root.style.setProperty(prop, val);
      }
    };

    const styleKey = state.paletteStyle || 'classic';
    const style = PALETTE_STYLES[styleKey] || PALETTE_STYLES.classic;

    const hSec = (h + style.secHueShift) % 360;
    const hTert = (h + style.tertHueShift) % 360;

    const isMonochrome = intensityFactor < 0.08 || (styleKey === 'neutral' && intensityFactor < 0.05);
    const br = (typeof brightness === 'number' ? brightness : 50) / 100;

    if (mode === 'light') {
      const LB = (v) => Math.max(0, Math.min(100, Math.round(v + (br - 0.5) * 24)));
      if (isMonochrome) {
        setToken('--md-sys-color-primary', '#1C1B1F');
        setToken('--md-sys-color-on-primary', '#FFFFFF');
        setToken('--md-sys-color-primary-container', hslToHex(0, 0, LB(90)));
        setToken('--md-sys-color-on-primary-container', '#1C1B1F');
        setToken('--md-sys-color-secondary', '#49454F');
        setToken('--md-sys-color-secondary-container', hslToHex(0, 0, LB(90)));
        setToken('--md-sys-color-on-secondary-container', '#1C1B1F');
        setToken('--md-sys-color-tertiary', '#49454F');
        setToken('--md-sys-color-tertiary-container', hslToHex(0, 0, LB(90)));
        setToken('--md-sys-color-background', hslToHex(0, 0, LB(99)));
        setToken('--md-sys-color-surface', hslToHex(0, 0, LB(98)));
        setToken('--md-sys-color-surface-dim', hslToHex(0, 0, LB(87)));
        setToken('--md-sys-color-surface-bright', hslToHex(0, 0, LB(98)));
        setToken('--md-sys-color-surface-container-lowest', hslToHex(0, 0, LB(100)));
        setToken('--md-sys-color-surface-container-low', hslToHex(0, 0, LB(96)));
        setToken('--md-sys-color-surface-container', hslToHex(0, 0, LB(94)));
        setToken('--md-sys-color-surface-container-high', hslToHex(0, 0, LB(92)));
        setToken('--md-sys-color-surface-container-highest', hslToHex(0, 0, LB(90)));
        setToken('--md-sys-color-on-surface', '#1C1B1F');
        setToken('--md-sys-color-on-surface-variant', '#49454F');
        setToken('--md-sys-color-outline', '#79747E');
        setToken('--md-sys-color-outline-variant', '#CAC4D0');
      } else {
        const sat = Math.min(100, Math.round(48 * intensityFactor * style.priSatScale));
        const satHi = Math.min(100, Math.round(80 * intensityFactor * style.contSatScale));
        const satMed = Math.min(100, Math.round(55 * intensityFactor * style.priSatScale));
        const satLow = Math.min(100, Math.round(30 * intensityFactor * style.contSatScale));
        const satLow2 = Math.min(100, Math.round(20 * intensityFactor * style.contSatScale));
        const surfFactor = intensityFactor * style.surfSatScale;

        setToken('--md-sys-color-primary', hslToHex(h, sat, 40));
        setToken('--md-sys-color-on-primary', '#FEFBFF');
        setToken('--md-sys-color-primary-container', hslToHex(h, satHi, LB(90)));
        setToken('--md-sys-color-on-primary-container', hslToHex(h, satMed, 18));
        setToken('--md-sys-color-secondary', hslToHex(hSec, satLow, 45));
        setToken('--md-sys-color-secondary-container', hslToHex(hSec, satLow, LB(90)));
        setToken('--md-sys-color-on-secondary-container', hslToHex(hSec, satLow2, 15));
        setToken('--md-sys-color-tertiary', hslToHex(hTert, satLow, 45));
        setToken('--md-sys-color-tertiary-container', hslToHex(hTert, satLow, LB(90)));
        setToken('--md-sys-color-background', hslToHex(h, Math.round(5 * surfFactor), LB(99)));
        setToken('--md-sys-color-surface', hslToHex(h, Math.round(6 * surfFactor), LB(98)));
        setToken('--md-sys-color-surface-dim', hslToHex(h, Math.round(5 * surfFactor), LB(87)));
        setToken('--md-sys-color-surface-bright', hslToHex(h, Math.round(6 * surfFactor), LB(98)));
        setToken('--md-sys-color-surface-container-lowest', hslToHex(h, Math.round(4 * surfFactor), LB(100)));
        setToken('--md-sys-color-surface-container-low', hslToHex(h, Math.round(5 * surfFactor), LB(96)));
        setToken('--md-sys-color-surface-container', hslToHex(h, Math.round(6 * surfFactor), LB(94)));
        setToken('--md-sys-color-surface-container-high', hslToHex(h, Math.round(5 * surfFactor), LB(92)));
        setToken('--md-sys-color-surface-container-highest', hslToHex(h, Math.round(5 * surfFactor), LB(90)));
        setToken('--md-sys-color-on-surface', '#1C1B1F');
        setToken('--md-sys-color-on-surface-variant', '#49454F');
        setToken('--md-sys-color-outline', '#79747E');
        setToken('--md-sys-color-outline-variant', '#CAC4D0');
      }
    } else {
      if (isMonochrome) {
        setToken('--md-sys-color-primary', '#E2E2E9');
        setToken('--md-sys-color-on-primary', '#1C1B1F');
        setToken('--md-sys-color-primary-container', '#49454F');
        setToken('--md-sys-color-on-primary-container', '#E2E2E9');
        setToken('--md-sys-color-secondary', '#C4C6D0');
        setToken('--md-sys-color-secondary-container', '#2B2930');
        setToken('--md-sys-color-on-secondary-container', '#E2E2E9');
        setToken('--md-sys-color-tertiary', '#C4C6D0');
        setToken('--md-sys-color-tertiary-container', '#2B2930');
        const B = (v) => Math.max(0, Math.min(100, Math.round(v * (br * 2))));
        setToken('--md-sys-color-background', hslToHex(0, 0, B(7)));
        setToken('--md-sys-color-surface', hslToHex(0, 0, B(7)));
        setToken('--md-sys-color-surface-dim', hslToHex(0, 0, B(7)));
        setToken('--md-sys-color-surface-bright', hslToHex(0, 0, B(19)));
        setToken('--md-sys-color-surface-container-lowest', hslToHex(0, 0, B(5)));
        setToken('--md-sys-color-surface-container-low', hslToHex(0, 0, B(10)));
        setToken('--md-sys-color-surface-container', hslToHex(0, 0, B(13)));
        setToken('--md-sys-color-surface-container-high', hslToHex(0, 0, B(16)));
        setToken('--md-sys-color-surface-container-highest', hslToHex(0, 0, B(20)));
        setToken('--md-sys-color-on-surface', '#E2E2E9');
        setToken('--md-sys-color-on-surface-variant', '#C4C6D0');
        setToken('--md-sys-color-outline', '#8E9099');
        setToken('--md-sys-color-outline-variant', '#44474E');
      } else {
        const sat = Math.min(100, Math.round(60 * intensityFactor * style.priSatScale));
        const satHi = Math.min(100, Math.round(60 * intensityFactor * style.contSatScale));
        const satMed = Math.min(100, Math.round(50 * intensityFactor * style.priSatScale));
        const satLow = Math.min(100, Math.round(15 * intensityFactor * style.contSatScale));
        const satLow2 = Math.min(100, Math.round(30 * intensityFactor * style.contSatScale));
        const surfFactor = intensityFactor * style.surfSatScale;
        const priHex = hslToHex(h, sat, 75);
        const priRgb = hexToRgb(priHex);
        setToken('--md-sys-color-primary', priHex);
        setToken('--md-sys-color-on-primary', hslToHex(h, satMed, 20));
        setToken('--md-sys-color-primary-container', `rgba(${priRgb.r}, ${priRgb.g}, ${priRgb.b}, 0.18)`);
        setToken('--md-sys-color-on-primary-container', priHex);
        setToken('--md-sys-color-secondary', hslToHex(hSec, satLow2, 75));
        setToken('--md-sys-color-secondary-container', hslToHex(hSec, satLow, 22));
        setToken('--md-sys-color-on-secondary-container', hslToHex(hSec, satLow2, 85));
        setToken('--md-sys-color-tertiary', hslToHex(hTert, satLow2, 75));
        setToken('--md-sys-color-tertiary-container', hslToHex(hTert, satLow, 22));
        const B = (v) => Math.max(0, Math.min(100, Math.round(v * (br * 2))));
        setToken('--md-sys-color-background', hslToHex(h, Math.round(5 * surfFactor), B(7)));
        setToken('--md-sys-color-surface', hslToHex(h, Math.round(6 * surfFactor), B(8)));
        setToken('--md-sys-color-surface-dim', hslToHex(h, Math.round(5 * surfFactor), B(7)));
        setToken('--md-sys-color-surface-bright', hslToHex(h, Math.round(4 * surfFactor), B(24)));
        setToken('--md-sys-color-surface-container-lowest', hslToHex(h, Math.round(5 * surfFactor), B(5)));
        setToken('--md-sys-color-surface-container-low', hslToHex(h, Math.round(5 * surfFactor), B(10)));
        setToken('--md-sys-color-surface-container', hslToHex(h, Math.round(6 * surfFactor), B(13)));
        setToken('--md-sys-color-surface-container-high', hslToHex(h, Math.round(5 * surfFactor), B(16)));
        setToken('--md-sys-color-surface-container-highest', hslToHex(h, Math.round(5 * surfFactor), B(20)));
        setToken('--md-sys-color-on-surface', '#e2e2e9');
        setToken('--md-sys-color-on-surface-variant', '#c4c6d0');
        setToken('--md-sys-color-outline', '#8e9099');
        setToken('--md-sys-color-outline-variant', '#282a33');
      }
    }
  }

  function extractDominantColor(imgSrc) {
    return new Promise((resolve) => {
      if (!imgSrc) return resolve('#6750A4');
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 10;
        canvas.height = 10;
        ctx.drawImage(img, 0, 0, 10, 10);
        const data = ctx.getImageData(0, 0, 10, 10).data;
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i]; g += data[i+1]; b += data[i+2];
        }
        const count = data.length / 4;
        r = Math.floor(r / count);
        g = Math.floor(g / count);
        b = Math.floor(b / count);
        const hex = '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
        resolve(hex);
      };
      img.onerror = () => resolve('#6750A4');
      img.src = imgSrc;
    });
  }

  let cachedPrimaryColor = '';
  let cachedDimColor = '';
  function refreshCachedThemeColors() {
    const rootStyle = getComputedStyle(document.documentElement);
    cachedPrimaryColor = rootStyle.getPropertyValue('--md-sys-color-primary').trim() || '#6750A4';
    cachedDimColor = rootStyle.getPropertyValue('--md-sys-color-surface-container-highest-solid').trim() || '#E6E0E9';
  }

  const coverAnalysisCache = new Map();

  function analyzeCover(imgSrc) {
    return new Promise((resolve) => {
      if (!imgSrc) {
        return resolve({ accent: '#6750A4', accent2: '#9A82DB', luminance: 0.2, saturation: 0.5 });
      }
      if (coverAnalysisCache.has(imgSrc)) {
        const cached = coverAnalysisCache.get(imgSrc);
        coverAnalysisCache.delete(imgSrc);
        coverAnalysisCache.set(imgSrc, cached);
        return resolve(cached);
      }

      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 48;
          canvas.height = 48;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, 48, 48);
          const data = ctx.getImageData(0, 0, 48, 48).data;

          let totalLuminance = 0;
          let nonGraySatSum = 0;
          let nonGraySatCount = 0;

          const bins = Array.from({ length: 24 }, (_, i) => ({
            idx: i,
            centerHue: (i + 0.5) * 15,
            weight: 0,
            rSum: 0,
            gSum: 0,
            bSum: 0,
            count: 0
          }));

          let fallbackR = 0, fallbackG = 0, fallbackB = 0;
          const totalPixels = data.length / 4;

          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            fallbackR += r;
            fallbackG += g;
            fallbackB += b;

            const rN = r / 255;
            const gN = g / 255;
            const bN = b / 255;

            const lum = 0.2126 * rN + 0.7152 * gN + 0.0722 * bN;
            totalLuminance += lum;

            const max = Math.max(rN, gN, bN);
            const min = Math.min(rN, gN, bN);
            const d = max - min;
            const l = (max + min) / 2;
            const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

            if (s >= 0.15) {
              nonGraySatSum += s;
              nonGraySatCount++;

              if (l >= 0.10 && l <= 0.90) {
                let hDeg = 0;
                if (d > 0) {
                  if (max === rN) {
                    hDeg = ((gN - bN) / d + (gN < bN ? 6 : 0)) * 60;
                  } else if (max === gN) {
                    hDeg = ((bN - rN) / d + 2) * 60;
                  } else {
                    hDeg = ((rN - gN) / d + 4) * 60;
                  }
                }
                const binIdx = Math.min(23, Math.max(0, Math.floor(hDeg / 15)));
                const bin = bins[binIdx];
                bin.weight += s;
                bin.rSum += r;
                bin.gSum += g;
                bin.bSum += b;
                bin.count++;
              }
            }
          }

          const meanLuminance = totalLuminance / totalPixels;
          const meanSaturation = nonGraySatCount > 0 ? (nonGraySatSum / nonGraySatCount) : 0;

          let bestBin = null;
          for (let i = 0; i < 24; i++) {
            if (bins[i].count > 0) {
              if (!bestBin || bins[i].weight > bestBin.weight) {
                bestBin = bins[i];
              }
            }
          }

          let accentHex = '';
          let accentR = 0, accentG = 0, accentB = 0;

          if (bestBin && bestBin.count > 0) {
            accentR = Math.round(bestBin.rSum / bestBin.count);
            accentG = Math.round(bestBin.gSum / bestBin.count);
            accentB = Math.round(bestBin.bSum / bestBin.count);
            accentHex = '#' + [accentR, accentG, accentB].map(x => x.toString(16).padStart(2, '0')).join('');
          } else {
            accentR = Math.round(fallbackR / totalPixels);
            accentG = Math.round(fallbackG / totalPixels);
            accentB = Math.round(fallbackB / totalPixels);
            accentHex = '#' + [accentR, accentG, accentB].map(x => x.toString(16).padStart(2, '0')).join('');
          }

          let bestBin2 = null;
          if (bestBin) {
            for (let i = 0; i < 24; i++) {
              if (bins[i].count > 0 && i !== bestBin.idx) {
                const diff = Math.abs(bins[i].centerHue - bestBin.centerHue);
                const dist = Math.min(diff, 360 - diff);
                if (dist >= 60) {
                  if (!bestBin2 || bins[i].weight > bestBin2.weight) {
                    bestBin2 = bins[i];
                  }
                }
              }
            }
          }

          let accent2Hex = '';
          if (bestBin2 && bestBin2.count > 0) {
            const r2 = Math.round(bestBin2.rSum / bestBin2.count);
            const g2 = Math.round(bestBin2.gSum / bestBin2.count);
            const b2 = Math.round(bestBin2.bSum / bestBin2.count);
            accent2Hex = '#' + [r2, g2, b2].map(x => x.toString(16).padStart(2, '0')).join('');
          } else {
            const hslAcc = rgbToHsl(accentR, accentG, accentB);
            const h2 = (hslAcc.h + 40) % 360;
            accent2Hex = hslToHex(h2, hslAcc.s, hslAcc.l);
          }

          const result = {
            accent: accentHex,
            accent2: accent2Hex,
            luminance: meanLuminance,
            saturation: meanSaturation
          };

          if (coverAnalysisCache.size >= 50) {
            const oldestKey = coverAnalysisCache.keys().next().value;
            coverAnalysisCache.delete(oldestKey);
          }
          coverAnalysisCache.set(imgSrc, result);
          resolve(result);
        } catch (err) {
          resolve({ accent: '#6750A4', accent2: '#9A82DB', luminance: 0.2, saturation: 0.5 });
        }
      };
      img.onerror = () => {
        resolve({ accent: '#6750A4', accent2: '#9A82DB', luminance: 0.2, saturation: 0.5 });
      };
      img.src = imgSrc;
    });
  }

  let activeMeshLayer = 'a';
  let lastMeshKey = '';

  function updateMeshGradient(accentHex, accent2Hex, mode) {
    const meshA = document.getElementById('bg-mesh-a');
    const meshB = document.getElementById('bg-mesh-b');
    if (!meshA || !meshB) return;

    const isEnabled = getAdv('mesh_gradient', true) && (state.meshBrightness > 0);
    if (!isEnabled) {
      meshA.style.opacity = '0';
      meshB.style.opacity = '0';
      lastMeshKey = '';
      return;
    }

    const meshKey = `${accentHex}_${accent2Hex}_${mode}_${state.meshBrightness}`;
    if (meshKey === lastMeshKey) return;
    lastMeshKey = meshKey;

    const rgb1 = hexToRgb(accentHex);
    const rgb2 = hexToRgb(accent2Hex);

    const brightnessScale = Math.max(0, Math.min(100, state.meshBrightness)) / 100;
    const a1 = (mode === 'light' ? 0.22 : 0.55) * brightnessScale;
    const a2 = (mode === 'light' ? 0.18 : 0.45) * brightnessScale;

    const accentRgba = `rgba(${rgb1.r}, ${rgb1.g}, ${rgb1.b}, ${a1})`;
    const accent2Rgba = `rgba(${rgb2.r}, ${rgb2.g}, ${rgb2.b}, ${a2})`;

    const gradient = `linear-gradient(to bottom, transparent 35%, var(--md-sys-color-background) 85%), ` +
      `radial-gradient(ellipse at var(--mesh-p1x, 20%) var(--mesh-p1y, 0%), ${accentRgba} 0%, transparent 70%), ` +
      `radial-gradient(ellipse at var(--mesh-p2x, 85%) var(--mesh-p2y, 5%), ${accent2Rgba} 0%, transparent 65%), ` +
      `var(--md-sys-color-background)`;

    const target = activeMeshLayer === 'a' ? meshB : meshA;
    const current = activeMeshLayer === 'a' ? meshA : meshB;

    target.style.background = gradient;
    target.style.opacity = '1';
    current.style.opacity = '0';

    const previewBg = document.getElementById('mesh-preview-bg');
    if (previewBg) {
      previewBg.style.background = gradient;
    }

    activeMeshLayer = activeMeshLayer === 'a' ? 'b' : 'a';
  }

  let currentEffectiveMode = state.themeMode === 'auto' ? 'dark' : state.themeMode;

  document.addEventListener('riff-appearance', () => applyTheme('#1466bc', document.documentElement.dataset.appearance));

  function applyTheme(hexColor, mode, intensity = state.themeIntensity, brightness = state.themeBrightness, accent2 = null, isAuto = false) {
    mode = document.documentElement.dataset.appearance || 'light';
    hexColor = mode === 'dark' ? '#83baff' : '#1466bc';
    currentEffectiveMode = mode;
    generateM3Palette(hexColor, mode, intensity, brightness);
    document.body.classList.toggle('theme-light', mode === 'light');
    document.body.classList.toggle('theme-dark', mode === 'dark');
    document.body.classList.toggle('intensity-zero', state.themeIntensity < 8);
    if (el.themeSwatches) {
      el.themeSwatches.forEach(sw => sw.classList.toggle('active', sw.dataset.color && sw.dataset.color.toLowerCase() === hexColor.toLowerCase()));
    }
    if (el.customColorInput) el.customColorInput.value = hexColor;

    const rgb = hexToRgb(hexColor);
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    if (el.sliderHue) el.sliderHue.value = hsl.h;
    if (el.valHue) el.valHue.textContent = hsl.h + '°';

    if (el.sliderIntensity) {
      el.sliderIntensity.disabled = isAuto;
      el.sliderIntensity.value = intensity;
      const parent = el.sliderIntensity.closest('.setting-item');
      if (parent) parent.classList.toggle('is-disabled', isAuto);
    }
    if (el.valIntensity) el.valIntensity.textContent = intensity + '%';

    if (el.sliderBrightness) {
      el.sliderBrightness.disabled = isAuto;
      el.sliderBrightness.value = brightness;
      const parent = el.sliderBrightness.closest('.setting-item');
      if (parent) parent.classList.toggle('is-disabled', isAuto);
    }
    if (el.valBrightness) el.valBrightness.textContent = brightness + '%';

    let resolvedAccent2 = accent2;
    if (!resolvedAccent2) {
      const h2 = (hsl.h + 40) % 360;
      resolvedAccent2 = hslToHex(h2, hsl.s, hsl.l);
    }

    updateMeshGradient(hexColor, resolvedAccent2, mode);
    refreshCachedThemeColors();
  }

  function updateThemeFromState() {
    if (state.themeMode === 'auto') {
      const coverThumb = (state.currentTrack && (typeof getTrackThumbUrl === 'function' ? getTrackThumbUrl(state.currentTrack) : state.currentTrack.thumbnail)) || '';
      if (coverThumb) {
        analyzeCover(coverThumb).then(analysis => {
          if (state.themeMode !== 'auto') return;

          const derivedMode = analysis.luminance > 0.58 ? 'light' : 'dark';
          const derivedIntensity = Math.min(85, Math.max(20, Math.round(analysis.saturation * 100 * 0.9)));
          let derivedBrightness;
          if (derivedMode === 'dark') {
            derivedBrightness = Math.min(60, Math.max(40, Math.round(40 + (Math.min(0.58, analysis.luminance) / 0.58) * 20)));
          } else {
            const normLum = Math.max(0, Math.min(1, (analysis.luminance - 0.58) / (1 - 0.58)));
            derivedBrightness = Math.min(75, Math.max(55, Math.round(55 + normLum * 20)));
          }

          applyTheme(analysis.accent, derivedMode, derivedIntensity, derivedBrightness, analysis.accent2, true);
        });
      } else {
        applyTheme(state.themeAccent, 'dark', state.themeIntensity, state.themeBrightness, null, true);
      }
    } else {
      applyTheme(state.themeAccent, state.themeMode, state.themeIntensity, state.themeBrightness, null, false);
    }

    if (el.themeModeBtns) {
      el.themeModeBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.themeMode === state.themeMode));
    }
  }

  const el = {
    btnMinimize: document.getElementById('btn-minimize'),
                          btnMaximize: document.getElementById('btn-maximize'),
                          btnClose: document.getElementById('btn-close'),

                          searchInput: document.getElementById('search-input'),
                          searchClearBtn: document.getElementById('search-clear-btn'),
                          searchIconBtn: document.getElementById('search-icon-btn'),
                          platformYt: document.getElementById('platform-yt'),
                          platformYtm: document.getElementById('platform-ytm'),
                          platformSc: document.getElementById('platform-sc'),

                          navActiveIndicator: document.getElementById('nav-active-indicator'),
                          navDiscover: document.getElementById('nav-discover'),
                          navFavorites: document.getElementById('nav-favorites'),
                          navLocal: document.getElementById('nav-local'),
                          navHistory: document.getElementById('nav-history'),
                          navQueue: document.getElementById('nav-queue'),
                          navSettings: document.getElementById('nav-settings'),
                          favoritesCount: document.getElementById('favorites-count'),
                          localCount: document.getElementById('local-count'),
                          queueCount: document.getElementById('queue-count'),

                          presetsContainer: document.getElementById('presets-container'),
                          btnSavePresetDialog: document.getElementById('btn-save-preset-dialog'),
                          savePresetModal: document.getElementById('save-preset-modal'),
                          newPresetName: document.getElementById('new-preset-name'),
                          btnCancelPreset: document.getElementById('btn-cancel-preset'),
                          btnConfirmSavePreset: document.getElementById('btn-confirm-save-preset'),

                          renamePresetModal: document.getElementById('rename-preset-modal'),
                          renamePresetName: document.getElementById('rename-preset-name'),
                          btnCancelRenamePreset: document.getElementById('btn-cancel-rename-preset'),
                          btnConfirmRenamePreset: document.getElementById('btn-confirm-rename-preset'),

                          playlistsList: document.getElementById('playlists-list'),
                          btnNewPlaylist: document.getElementById('btn-new-playlist'),

                          viewDiscover: document.getElementById('view-discover'),
                          viewFavorites: document.getElementById('view-favorites'),
                          viewLocal: document.getElementById('view-local'),
                          viewHistory: document.getElementById('view-history'),
                          viewQueue: document.getElementById('view-queue'),
                          viewPlaylistDetail: document.getElementById('view-playlist-detail'),
                          viewArtist: document.getElementById('view-artist'),
                          viewSettings: document.getElementById('view-settings'),

                          artistHeroBackdrop: document.getElementById('artist-hero-backdrop'),
                          btnBackArtist: document.getElementById('btn-back-artist'),
                          artistAvatarImg: document.getElementById('artist-avatar-img'),
                          artistAvatarFallback: document.getElementById('artist-avatar-fallback'),
                          artistVerifiedBadge: document.getElementById('artist-verified-badge'),
                          artistProfileName: document.getElementById('artist-profile-name'),
                          artistProfileBio: document.getElementById('artist-profile-bio'),
                          btnPlayArtistTracks: document.getElementById('btn-play-artist-tracks'),
                          artistTracksCount: document.getElementById('artist-tracks-count'),
                          artistTracksList: document.getElementById('artist-tracks-list'),

                          discoverEmpty: document.getElementById('discover-empty'),
                          searchResultsContainer: document.getElementById('search-results-container'),
                          resultsTitle: document.getElementById('results-title'),
                          resultsPlatformBadge: document.getElementById('results-platform-badge'),
                          resultsCount: document.getElementById('results-count'),
                          searchTracksList: document.getElementById('search-tracks-list'),
                          suggestionChips: document.getElementById('suggestion-chips'),

                          favoritesTracksList: document.getElementById('favorites-tracks-list'),
                          favoritesSearchInput: document.getElementById('favorites-search-input'),
                          playlistSearchInput: document.getElementById('playlist-search-input'),
                          favoritesSubtitle: document.getElementById('favorites-subtitle'),
                          localTracksList: document.getElementById('local-tracks-list'),
                          localSearchInput: document.getElementById('local-search-input'),
                          localSubtitle: document.getElementById('local-subtitle'),
                          btnAddLocalFiles: document.getElementById('btn-add-local-files'),
                          btnAddLocalFilesEmpty: document.getElementById('btn-add-local-files-empty'),
                          historyTracksList: document.getElementById('history-tracks-list'),
                          btnClearHistory: document.getElementById('btn-clear-history'),
                          queueTracksList: document.getElementById('queue-tracks-list'),
                          btnClearQueue: document.getElementById('btn-clear-queue'),
                          playlistTracksList: document.getElementById('playlist-tracks-list'),
                          playlistDetailTitle: document.getElementById('playlist-detail-title'),
                          playlistDetailCount: document.getElementById('playlist-detail-count'),
                          btnBackPlaylists: document.getElementById('btn-back-playlists'),
                          btnPlayPlaylist: document.getElementById('btn-play-playlist'),
                          btnDeletePlaylist: document.getElementById('btn-delete-playlist'),

                          rightPanel: document.getElementById('right-panel'),
                          btnCloseRightPanel: document.getElementById('btn-close-right-panel'),
                          btnToggleLyricsPanel: document.getElementById('btn-toggle-lyrics-panel'),
                          btnLyricsMode: document.getElementById('btn-lyrics-mode'),
                          coverContainer: document.getElementById('cover-container'),
                          rightPanelArtworkBox: document.getElementById('right-panel-artwork-box'),
                          rightPanelCover: document.getElementById('right-panel-cover'),
                          rightPanelFallback: document.getElementById('right-panel-fallback'),
                          rightPanelTitle: document.getElementById('right-panel-title'),
                          rightPanelArtist: document.getElementById('right-panel-artist'),
                          lyricsStatus: document.getElementById('lyrics-status'),
                          lyricsContainer: document.getElementById('lyrics-container'),
                          lyricsHint: document.getElementById('lyrics-hint'),
                          btnTranslateLyrics: document.getElementById('btn-translate-lyrics'),
                          btnTrEnabled: document.getElementById('btn-tr-enabled'),
                          selectTrLang: document.getElementById('select-tr-lang'),
                          btnTrAuto: document.getElementById('btn-tr-auto'),
                          btnTvKaraoke: document.getElementById('btn-tv-karaoke'),
                          tvKaraoke: document.getElementById('tv-karaoke'),
                          tvBg: document.getElementById('tv-bg'),
                          tvCover: document.getElementById('tv-cover'),
                          tvKaraokeContent: document.getElementById('tv-karaoke-content'),
                          tvKaraokeClose: document.getElementById('btn-close-tv-karaoke'),
                          tvKaraokeTitle: document.getElementById('tv-karaoke-title'),
                          tvKaraokeArtist: document.getElementById('tv-karaoke-artist'),

                          playbar: document.getElementById('playbar'),
                          playbarArtwork: document.getElementById('playbar-artwork'),
                          artworkFallback: document.getElementById('artwork-fallback'),
                          playbarTitle: document.getElementById('playbar-title'),
                          playbarArtist: document.getElementById('playbar-artist'),
                          btnToggleFav: document.getElementById('btn-toggle-fav'),
                          favIcon: document.getElementById('fav-icon'),
                          btnShuffle: document.getElementById('btn-shuffle'),
                          btnPrev: document.getElementById('btn-prev'),
                          btnPlayPause: document.getElementById('btn-play-pause'),
                          playIcon: document.getElementById('play-icon'),
                          pauseIcon: document.getElementById('pause-icon'),
                          playbarSpinner: document.getElementById('playbar-spinner'),
                          btnNext: document.getElementById('btn-next'),
                          btnRepeat: document.getElementById('btn-repeat'),

                          timeCurrent: document.getElementById('time-current'),
                          timeDuration: document.getElementById('time-duration'),
                          scrubberTrack: document.getElementById('scrubber-track'),

                          visualizerCanvas: document.getElementById('visualizer-canvas'),
                          btnOpenSettings: document.getElementById('btn-open-settings'),
                          btnOpenVisualSettings: document.getElementById('btn-open-visual-settings'),
                          settingsModifiedDot: document.getElementById('settings-modified-dot'),
                          btnVolumeMute: document.getElementById('btn-volume-mute'),
                          volumeIcon: document.getElementById('volume-icon'),
                          volumeMutedIcon: document.getElementById('volume-muted-icon'),
                          volumeSlider: document.getElementById('volume-slider'),

                          downloadModal: document.getElementById('download-modal'),
                          btnCloseDownloadModal: document.getElementById('btn-close-download-modal'),
                          btnCancelDownload: document.getElementById('btn-cancel-download'),
                          btnConfirmDownload: document.getElementById('btn-confirm-download'),
                          downloadBtnText: document.getElementById('download-btn-text'),
                          downloadPreviewThumb: document.getElementById('download-preview-thumb'),
                          downloadPreviewFallback: document.getElementById('download-preview-fallback'),
                          downloadPreviewTitle: document.getElementById('download-preview-title'),
                          downloadPreviewArtist: document.getElementById('download-preview-artist'),
                          btnPlaybarMore: document.getElementById('btn-playbar-more'),

                          audioSettingsModal: document.getElementById('audio-settings-modal'),
                          btnCloseSettings: document.getElementById('btn-close-settings'),

                          btnToggleHqAudio: document.getElementById('toggle-hq-audio'),
                          hqPanelWrapper: document.getElementById('hq-panel-wrapper'),
                          hqEngineSelect: document.getElementById('hq-engine-select'),
                          sliderHqVocal: document.getElementById('slider-hq-vocal'),
                          valHqVocal: document.getElementById('val-hq-vocal'),
                          sliderHqAir: document.getElementById('slider-hq-air'),
                          valHqAir: document.getElementById('val-hq-air'),
                          sliderHqBass: document.getElementById('slider-hq-bass'),
                          valHqBass: document.getElementById('val-hq-bass'),
                          hqPresetChips: document.querySelectorAll('.hq-preset-chip'),

                          sliderSpeed: document.getElementById('slider-speed'),
                          valSpeed: document.getElementById('val-speed'),
                          sliderSpeedPitch: document.getElementById('slider-speed-pitch'),
                          valSpeedPitch: document.getElementById('val-speed-pitch'),
                          sliderPitch: document.getElementById('slider-pitch'),
                          valPitch: document.getElementById('val-pitch'),
                          sliderReverb: document.getElementById('slider-reverb'),
                          valReverb: document.getElementById('val-reverb'),
                          sliderDistortion: document.getElementById('slider-distortion'),
                          valDistortion: document.getElementById('val-distortion'),
                          sliderGain: document.getElementById('slider-gain'),
                          valGain: document.getElementById('val-gain'),
                          sliderEcho: document.getElementById('slider-echo'),
                          valEcho: document.getElementById('val-echo'),
                          sliderEqLow: document.getElementById('slider-eq-low'),
                          valEqLow: document.getElementById('val-eq-low'),
                          sliderEqMid: document.getElementById('slider-eq-mid'),
                          valEqMid: document.getElementById('val-eq-mid'),
                          sliderEqHigh: document.getElementById('slider-eq-high'),
                          valEqHigh: document.getElementById('val-eq-high'),

                          sliderScale: document.getElementById('settings-slider-scale') || document.getElementById('slider-scale'),
                          valScale: document.getElementById('settings-val-scale') || document.getElementById('val-scale'),
                          sliderFontScale: document.getElementById('slider-font-scale'),
                          valFontScale: document.getElementById('val-font-scale'),
                          sliderCornerRadius: document.getElementById('slider-corner-radius'),
                          valCornerRadius: document.getElementById('val-corner-radius'),
                          sliderUiAlpha: document.getElementById('slider-ui-alpha'),
                          valUiAlpha: document.getElementById('val-ui-alpha'),
                          btnResetUiAlpha: document.getElementById('btn-reset-ui-alpha'),
                          sliderTextAlpha: document.getElementById('slider-text-alpha'),
                          valTextAlpha: document.getElementById('val-text-alpha'),
                          btnResetTextAlpha: document.getElementById('btn-reset-text-alpha'),
                          themeModeBtns: document.querySelectorAll('.theme-mode-btn'),
                          themeSwatches: document.querySelectorAll('.theme-swatch'),
                          customColorInput: document.getElementById('settings-custom-color-input'),
                          sliderHue: document.getElementById('slider-theme-hue'),
                          valHue: document.getElementById('val-theme-hue'),
                          sliderIntensity: document.getElementById('slider-theme-intensity'),
                          valIntensity: document.getElementById('val-theme-intensity'),
                          sliderBrightness: document.getElementById('slider-theme-brightness'),
                          valBrightness: document.getElementById('val-theme-brightness'),

                          visualSettingsModal: document.getElementById('visual-settings-modal'),
                          btnCloseVisualSettings: document.getElementById('btn-close-visual-settings'),
                          btnResetVfx: document.getElementById('btn-reset-vfx'),

                          createPlaylistModal: document.getElementById('create-playlist-modal'),
                          newPlaylistInput: document.getElementById('new-playlist-input'),
                          btnCancelNewPlaylist: document.getElementById('btn-cancel-new-playlist'),
                          btnConfirmNewPlaylist: document.getElementById('btn-confirm-new-playlist'),

                          addToPlaylistModal: document.getElementById('add-to-playlist-modal'),
                          playlistPickList: document.getElementById('playlist-pick-list'),
                          btnCancelAddPlaylist: document.getElementById('btn-cancel-add-playlist'),

                          nativeAudio: document.getElementById('native-audio'),
                          trackLoadingOverlay: document.getElementById('track-loading-overlay'),
                          trackLoadingTitle: document.getElementById('track-loading-title'),
                          trackLoadingSub: document.getElementById('track-loading-sub'),

                          btnAddCustomLyrics: document.getElementById('btn-add-custom-lyrics'),
                          btnSyncLyrics: document.getElementById('btn-sync-lyrics'),
                          customLyricsModal: document.getElementById('custom-lyrics-modal'),
                          customLyricsTextarea: document.getElementById('custom-lyrics-textarea'),
                          customLyricsTrackTitle: document.getElementById('custom-lyrics-track-title'),
                          customLyricsTrackArtist: document.getElementById('custom-lyrics-track-artist'),
                          btnCloseCustomLyrics: document.getElementById('btn-close-custom-lyrics'),
                          btnCancelCustomLyrics: document.getElementById('btn-cancel-custom-lyrics'),
                          btnSaveCustomLyrics: document.getElementById('btn-save-custom-lyrics'),
                          syncModeOverlay: document.getElementById('sync-mode-overlay'),
                          syncModeLyrics: document.getElementById('sync-mode-lyrics'),
                          syncProgressText: document.getElementById('sync-progress-text'),
                          btnRestartSync: document.getElementById('btn-restart-sync'),
                          btnSaveSync: document.getElementById('btn-save-sync'),
                          btnCancelSync: document.getElementById('btn-cancel-sync'),

                          btnEditCurrentTrack: document.getElementById('btn-edit-current-track'),
                          renameTrackModal: document.getElementById('rename-track-modal'),
                          inputRenameTitle: document.getElementById('rename-track-title'),
                          inputRenameArtist: document.getElementById('rename-track-artist'),
                          btnCancelRenameTrack: document.getElementById('btn-cancel-rename-track'),
                          btnConfirmRenameTrack: document.getElementById('btn-confirm-rename-track'),

                          btnRefreshVibe: document.getElementById('btn-refresh-vibe')
  };

  ['Vocal', 'Air', 'Bass'].forEach(type => {
    const slider = el[`sliderHq${type}`];
    if (slider) {
      slider.min = -50;
      slider.max = 50;
      slider.value = state.hqSettings[type.toLowerCase()];
    }
  });

  if (el.sliderScale) el.sliderScale.value = state.uiScale;
  if (el.valScale) el.valScale.textContent = `${state.uiScale}%`;

  const savedFontScale = Math.max(80, Math.min(130, parseInt(localStorage.getItem('riff_font_scale'), 10) || 100));
  if (el.sliderFontScale) el.sliderFontScale.value = savedFontScale;
  if (el.valFontScale) el.valFontScale.textContent = savedFontScale + '%';
  document.documentElement.style.setProperty('--font-scale', (parseInt(savedFontScale) / 100));

  const savedRadius = localStorage.getItem('riff_corner_radius') || '16';
  if (el.sliderCornerRadius) el.sliderCornerRadius.value = savedRadius;
  if (el.valCornerRadius) el.valCornerRadius.textContent = savedRadius === '16' ? 'Default' : `${savedRadius}px`;
  document.documentElement.style.setProperty('--md-shape-corner-l', `${savedRadius}px`);
  document.documentElement.style.setProperty('--md-shape-corner-m', `${Math.max(0, parseInt(savedRadius) - 4)}px`);

  applyReducedMotionSetting();

  const savedBannerBlur = parseInt(localStorage.getItem('riff_banner_blur') || '3', 10);
  const savedBannerOpacity = parseInt(localStorage.getItem('riff_banner_opacity') || '100', 10);
  const savedBannerFade = parseInt(localStorage.getItem('riff_banner_fade') || '38', 10);
  const savedBannerFit = localStorage.getItem('riff_banner_fit') || 'zoom';

  document.documentElement.style.setProperty('--banner-blur', `${savedBannerBlur}px`);
  document.documentElement.style.setProperty('--banner-opacity', `${savedBannerOpacity / 100}`);
  document.documentElement.style.setProperty('--banner-fade-base', `${savedBannerFade}%`);
  applyBannerFit(savedBannerFit);

  function applyUiOpacity() {
    const rawUi = parseInt(localStorage.getItem('riff_ui_alpha') || '100', 10);
    const rawText = parseInt(localStorage.getItem('riff_text_alpha') || '100', 10);
    const uiAlpha = Math.max(20, Math.min(100, isNaN(rawUi) ? 100 : rawUi));
    const textAlpha = Math.max(1, Math.min(100, isNaN(rawText) ? 100 : rawText));

    document.documentElement.style.setProperty('--ui-alpha', `${uiAlpha}%`);
    document.documentElement.style.setProperty('--text-alpha', `${textAlpha}%`);

    if (el.sliderUiAlpha) el.sliderUiAlpha.value = uiAlpha;
    if (el.valUiAlpha) el.valUiAlpha.textContent = `${uiAlpha}%`;
    if (el.sliderTextAlpha) el.sliderTextAlpha.value = textAlpha;
    if (el.valTextAlpha) el.valTextAlpha.textContent = `${textAlpha}%`;
  }

  applyUiOpacity();

  updateThemeFromState();

  if (state.themeMode !== 'auto') {
    if (el.sliderIntensity) el.sliderIntensity.value = state.themeIntensity;
    if (el.valIntensity) el.valIntensity.textContent = state.themeIntensity + '%';
    if (el.sliderBrightness) el.sliderBrightness.value = state.themeBrightness;
    if (el.valBrightness) el.valBrightness.textContent = state.themeBrightness + '%';
  }

  const railDrawer = document.getElementById('rail-drawer');
  const sidebarEl = document.querySelector('.sidebar');
  const btnTogglePresets = document.getElementById('btn-toggle-presets-drawer');
  const btnTogglePlaylists = document.getElementById('btn-toggle-playlists-drawer');
  const btnCloseDrawer = document.getElementById('btn-close-rail-drawer');
  const sectionPresets = document.getElementById('drawer-section-presets');
  const sectionPlaylists = document.getElementById('drawer-section-playlists');
  const drawerTitle = document.getElementById('rail-drawer-title');

  let openDrawerState = null;
  let activeDrawerMode = null;

  function applyDrawerState(triggerBtn) {
    if (!railDrawer) return;

    if (!openDrawerState) {
      if (activeDrawerMode !== null) {
        if (sidebarEl) sidebarEl.classList.remove('has-drawer-open');
        if (btnTogglePresets) btnTogglePresets.classList.remove('active');
        if (btnTogglePlaylists) btnTogglePlaylists.classList.remove('active');
        activeDrawerMode = null;
        LiquidMotion.close(railDrawer, () => {
          railDrawer.classList.add('hidden');
        });
      }
    } else {
      const isPresets = openDrawerState === 'presets';
      const trigger = triggerBtn || (isPresets ? btnTogglePresets : btnTogglePlaylists);

      if (btnTogglePresets) btnTogglePresets.classList.toggle('active', isPresets);
      if (btnTogglePlaylists) btnTogglePlaylists.classList.toggle('active', !isPresets);
      railDrawer.classList.toggle('drawer-presets-mode', isPresets);

      if (activeDrawerMode === null) {
        activeDrawerMode = openDrawerState;
        railDrawer.classList.remove('hidden');
        if (sectionPresets) sectionPresets.style.display = isPresets ? 'flex' : 'none';
        if (sectionPlaylists) sectionPlaylists.style.display = isPresets ? 'none' : 'flex';
        if (drawerTitle) drawerTitle.textContent = isPresets ? 'Presets' : 'Playlists';
        if (el.btnSavePresetDialog) el.btnSavePresetDialog.style.display = isPresets ? 'inline-flex' : 'none';
        if (el.btnNewPlaylist) el.btnNewPlaylist.style.display = isPresets ? 'none' : 'inline-flex';
        if (sidebarEl) sidebarEl.classList.add('has-drawer-open');
        LiquidMotion.open(railDrawer, trigger, 'x');
      } else if (activeDrawerMode !== openDrawerState) {
        activeDrawerMode = openDrawerState;
        const outgoing = isPresets ? sectionPlaylists : sectionPresets;
        const incoming = isPresets ? sectionPresets : sectionPlaylists;

        if (outgoing) outgoing.classList.add('section-switching-out');
        setTimeout(() => {
          if (outgoing) {
            outgoing.style.display = 'none';
            outgoing.classList.remove('section-switching-out');
          }
          if (drawerTitle) drawerTitle.textContent = isPresets ? 'Presets' : 'Playlists';
          railDrawer.classList.toggle('drawer-presets-mode', isPresets);
          if (el.btnSavePresetDialog) el.btnSavePresetDialog.style.display = isPresets ? 'inline-flex' : 'none';
          if (el.btnNewPlaylist) el.btnNewPlaylist.style.display = isPresets ? 'none' : 'inline-flex';
          if (incoming) {
            incoming.style.display = 'flex';
            incoming.classList.add('section-switching-in');
            setTimeout(() => incoming.classList.remove('section-switching-in'), 200);
          }
        }, 120);
      }
    }
  }

  function openDrawer(mode, triggerBtn) {
    openDrawerState = mode;
    applyDrawerState(triggerBtn);
  }

  function closeDrawer() {
    openDrawerState = null;
    applyDrawerState();
  }

  if (btnTogglePresets) {
    btnTogglePresets.addEventListener('click', (e) => {
      e.stopPropagation();
      openDrawerState = openDrawerState === 'presets' ? null : 'presets';
      applyDrawerState(btnTogglePresets);
    });
  }

  if (btnTogglePlaylists) {
    btnTogglePlaylists.addEventListener('click', (e) => {
      e.stopPropagation();
      openDrawerState = openDrawerState === 'playlists' ? null : 'playlists';
      applyDrawerState(btnTogglePlaylists);
    });
  }

  if (btnCloseDrawer) {
    btnCloseDrawer.addEventListener('click', () => closeDrawer());
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openDrawerState) closeDrawer();
  });

  const resumeAudioOnce = () => {
    initAudioContext();
    document.removeEventListener('click', resumeAudioOnce);
    document.removeEventListener('keydown', resumeAudioOnce);
  };
  document.addEventListener('click', resumeAudioOnce);
  document.addEventListener('keydown', resumeAudioOnce);

  document.addEventListener('click', (e) => {
    if (openDrawerState && railDrawer) {
      if (!railDrawer.contains(e.target) &&
        (!btnTogglePresets || !btnTogglePresets.contains(e.target)) &&
        (!btnTogglePlaylists || !btnTogglePlaylists.contains(e.target))) {
        closeDrawer();
      }
    }
  });

  const PRESS_MIN = 180;
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('button, .chip-btn, .mix-card, .track-row, .nav-item, .rail-icon-btn, .preset-chip');
    if (!el) return;
    el.classList.add('pressed');
    const t0 = performance.now();
    const release = () => {
      document.removeEventListener('pointerup', release, true);
      document.removeEventListener('pointercancel', release, true);
      setTimeout(() => el.classList.remove('pressed'), Math.max(0, PRESS_MIN - (performance.now() - t0)));
    };
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
  }, true);

  const RIPPLE_SEL = '.btn-pill-primary, .btn-outline-pill, .btn-icon-pill, .chip-btn, .control-btn, .rail-icon-btn, .preset-chip, .theme-mode-btn, .nav-item, .settings-nav-btn, .titlebar-btn, .mix-card, .track-row';
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || document.body.classList.contains('perf')) return;
    const el = e.target.closest(RIPPLE_SEL);
    if (!el || el.disabled) return;
    let host = el.querySelector(':scope > .ripple-host');
    if (!host) {
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      host = document.createElement('span'); host.className = 'ripple-host'; el.appendChild(host);
    }
    const r = el.getBoundingClientRect();
    const size = Math.hypot(Math.max(e.clientX - r.left, r.right - e.clientX), Math.max(e.clientY - r.top, r.bottom - e.clientY)) * 2;
    const d = document.createElement('span'); d.className = 'ripple';
    d.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
    host.appendChild(d);
    d.addEventListener('animationend', () => d.remove());
  }, true);

  function openTrackRenameDialog() {
    const currentTitle = state.currentTrack?.title || '';
    const currentArtist = state.currentTrack?.artist || '';

    if (el.inputRenameTitle) el.inputRenameTitle.value = currentTitle;
    if (el.inputRenameArtist) el.inputRenameArtist.value = currentArtist;
    if (el.renameTrackModal) openModal(el.renameTrackModal);
    if (el.inputRenameTitle) el.inputRenameTitle.focus();
  }

  if (el.btnEditCurrentTrack) el.btnEditCurrentTrack.addEventListener('click', openTrackRenameDialog);
  if (el.btnCancelRenameTrack) el.btnCancelRenameTrack.addEventListener('click', () => closeModal(el.renameTrackModal));

  if (el.btnConfirmRenameTrack) {
    el.btnConfirmRenameTrack.addEventListener('click', () => {
      const newTitle = el.inputRenameTitle ? el.inputRenameTitle.value.trim() || 'Untitled track' : 'Untitled track';
      const newArtist = el.inputRenameArtist ? el.inputRenameArtist.value.trim() || 'Unknown artist' : 'Unknown artist';

      if (state.currentTrack) {
        state.currentTrack.title = newTitle;
        state.currentTrack.artist = newArtist;
      }

      updateNowPlayingUI(state.currentTrack);

      const updateArr = (arr) => {
        let updated = false;
        arr.forEach(t => {
          if (t.id === state.currentTrack?.id) {
            t.title = newTitle;
            t.artist = newArtist;
            updated = true;
          }
        });
        return updated;
      };

      if (updateArr(state.history)) localStorage.setItem('devsize_history', JSON.stringify(state.history));
      if (updateArr(state.favorites)) localStorage.setItem('devsize_favorites', JSON.stringify(state.favorites));
      if (updateArr(state.queue)) renderQueueView();

      sendStateToServer();
      sendDiscordRpcUpdate(state.currentTrack, state.isPlaying);
      updateMediaSession();

      if (el.renameTrackModal) closeModal(el.renameTrackModal);
      showToast('Track info updated', 'info');
    });
  }

  const audioEngine = new window.RiffAudioEngine();
  let hlsInstance = null;
  let animationFrameId = null;

  function initAudioContext() {
    audioEngine.init(el.nativeAudio);
    
    if (audioEngine.ctx && audioEngine.ctx.state !== 'running' && audioEngine.ctx.state !== 'closed') {
      audioEngine.ctx.resume().catch(() => {});
    }
    
    audioEngine.setHqEnabled(state.hqEnabled);
    audioEngine.setHqSettings(state.hqSettings);
    audioEngine.setAudioSettings(state.audioSettings);
    audioEngine.setVolume(state.volume, state.isMuted);
    
    startVisualizers();
  }

  function spotifyEffects() {return {...state.audioSettings,hq:{...state.hqSettings,enabled:state.hqEnabled}};}
  let spotifyEffectsTimer;
  function syncSpotifyEffects() {
    clearTimeout(spotifyEffectsTimer);
    if(spotifyActive())spotifyEffectsTimer=setTimeout(()=>window.electronAPI.spotify('playback','effects',{effects:spotifyEffects(),volume:state.isMuted?0:state.volume}).catch(error=>showToast(error.message,'error')),25);
  }
  function updateHqRouting() {
    audioEngine.setHqEnabled(state.hqEnabled);
    if (el.btnToggleHqAudio) el.btnToggleHqAudio.classList.toggle('active', !!state.hqEnabled);
    if (el.hqPanelWrapper) el.hqPanelWrapper.classList.toggle('expanded', !!state.hqEnabled);
    syncSpotifyEffects();
  }

  function applyHqSettings() {
    updateHqRouting();
    audioEngine.setHqSettings(state.hqSettings);
    syncSpotifyEffects();
  }
  
  function applyAudioSettings() {
    audioEngine.setAudioSettings(state.audioSettings);
    audioEngine.setVolume(state.volume, state.isMuted);
    audioEngine.applySettings(el.nativeAudio);
    syncSpotifyEffects();
    
    if (el.settingsModifiedDot) {
      if (audioEngine.isModified()) {
        el.settingsModifiedDot.classList.remove('hidden');
      } else {
        el.settingsModifiedDot.classList.add('hidden');
      }
    }
  }


  let cachedTrackWidth = 0;
  let cachedTrackHeight = 40;
  let hasDrawnPausedFrame = false;

  function resizeCanvases() {
    const dpr = window.devicePixelRatio || 1;
    if (el.scrubberTrack) {
      let scrubberCanvas = document.getElementById('squiggly-canvas');
      if (!scrubberCanvas) {
        scrubberCanvas = document.createElement('canvas');
        scrubberCanvas.id = 'squiggly-canvas';
        scrubberCanvas.className = 'squiggly-canvas';
        el.scrubberTrack.appendChild(scrubberCanvas);
      }
      const rect = el.scrubberTrack.getBoundingClientRect();
      cachedTrackWidth = rect.width;
      cachedTrackHeight = Math.max(1, rect.height);
      hasDrawnPausedFrame = false;
      scrubberCanvas.width = rect.width * dpr;
      scrubberCanvas.height = Math.max(1, rect.height) * dpr;
      scrubberCanvas.style.width = `${rect.width}px`;
      scrubberCanvas.style.height = `${Math.max(1, rect.height)}px`;
      const ctx = scrubberCanvas.getContext('2d');
      ctx.resetTransform();
      ctx.scale(dpr, dpr);
    }
    if (el.visualizerCanvas) {
      el.visualizerCanvas.width = 60 * dpr;
      el.visualizerCanvas.height = 24 * dpr;
      el.visualizerCanvas.style.width = '60px';
      el.visualizerCanvas.style.height = '24px';
      const ctx = el.visualizerCanvas.getContext('2d');
      ctx.resetTransform();
      ctx.scale(dpr, dpr);
    }
  }
  window.addEventListener('resize', resizeCanvases);
  setTimeout(resizeCanvases, 100);

  let smoothAmplitude = 0;
  let smoothPhase = 0;
  let scrubPhase = 0;
  let scrubProgress = 0;
  let scrubPrevKnobX = null;
  let scrubKnobAnim = 0;
  let scrubLastTime = 0;

  let lastFrameTime = 0;
  function startVisualizers() {
    const analyserNode = audioEngine.getAnalyserNode();
    if (!analyserNode || !state.isWindowVisible) return;
    if (animationFrameId) cancelAnimationFrame(animationFrameId);

    const miniCanvas = el.visualizerCanvas;
    const miniCtx = miniCanvas ? miniCanvas.getContext('2d') : null;

    const bufferLength = analyserNode.frequencyBinCount;
    const freqData = new Uint8Array(bufferLength);
    const timeData = new Uint8Array(bufferLength);

    function renderLoop(timestamp) {
      if (!state.isWindowVisible) return;
      animationFrameId = requestAnimationFrame(renderLoop);

      if (document.body.classList.contains('perf') && timestamp - lastFrameTime < 33) return;
      if (timestamp - lastFrameTime < 28) return;
      lastFrameTime = timestamp;

      if (!state.isPlaying && !isDraggingScrubber) {
        if (hasDrawnPausedFrame) return;
        hasDrawnPausedFrame = true;
      } else {
        hasDrawnPausedFrame = false;
      }

      if (!document.body.classList.contains('perf')) {
        audioEngine.getFrequencyData(freqData);
        audioEngine.getTimeDomainData(timeData);

        let bassEnergy = (freqData[0] + freqData[1] + freqData[2] + freqData[3]) / (4 * 255);

        if (state.vfx.bassPulse) {
          const scaleMul = 1.0 + (bassEnergy * 0.035);
          const targetTransform = `scale(${scaleMul.toFixed(3)})`;
          if (el.coverContainer && el.coverContainer.style.transform !== targetTransform) {
            el.coverContainer.style.transform = targetTransform;
          }
        } else {
          if (el.coverContainer && el.coverContainer.style.transform) el.coverContainer.style.transform = '';
        }

        if (miniCtx && miniCanvas) {
          miniCtx.clearRect(0, 0, 60, 24);
          if (state.isPlaying) {
            const barCount = 12;
            const barWidth = 3;
            const gap = 2;
            const startX = (60 - (barCount * (barWidth + gap))) / 2;

            for (let i = 0; i < barCount; i++) {
              const val = freqData[i * 2] || 0;
              let barHeight = (val / 255) * (24 - 4);
              if (barHeight < 2) barHeight = 2;

              const x = startX + i * (barWidth + gap);
              const y = 24 - barHeight;

              miniCtx.fillStyle = '#ffffff';
              miniCtx.beginPath();
              miniCtx.roundRect(x, y, barWidth, barHeight, 2);
              miniCtx.fill();
            }
          }
        }
      } else {
        if (el.coverContainer && el.coverContainer.style.transform) el.coverContainer.style.transform = '';
        if (miniCtx && miniCanvas) miniCtx.clearRect(0, 0, 60, 24);
      }

      let scrubberCanvas = document.getElementById('squiggly-canvas');
      if (scrubberCanvas && el.scrubberTrack) {
        const sCtx = scrubberCanvas.getContext('2d');
        const sw = cachedTrackWidth || (el.scrubberTrack ? el.scrubberTrack.clientWidth : 0);
        const sh = cachedTrackHeight || 40;
        sCtx.clearRect(0, 0, sw, sh);

        const dt = scrubLastTime === 0 ? 0.016 : Math.min((timestamp - scrubLastTime) / 1000, 0.1);
        scrubLastTime = timestamp;

        const dur = playbackDuration();
        let cur = playbackTime();

        if (isDraggingScrubber && state.scrubberDragTargetTime !== undefined) {
          cur = state.scrubberDragTargetTime;
        }

        const targetProgress = dur > 0 ? Math.max(0, Math.min(1, cur / dur)) : 0;
        const followSpeed = isDraggingScrubber ? 32 : 45;
        scrubProgress += (targetProgress - scrubProgress) * Math.min(1, dt * followSpeed);

        if (!cachedPrimaryColor) refreshCachedThemeColors();
        const pad = 6, x = pad + targetProgress * Math.max(0, sw - pad * 2), y = sh / 2;
        sCtx.lineCap = 'round';
        sCtx.lineWidth = 4;
        sCtx.strokeStyle = currentEffectiveMode === 'dark' ? '#60656c' : '#cbd9e7';
        sCtx.beginPath(); sCtx.moveTo(pad, y); sCtx.lineTo(sw - pad, y); sCtx.stroke();
        sCtx.strokeStyle = currentEffectiveMode === 'dark' ? '#91c1ff' : '#1466bc';
        sCtx.beginPath(); sCtx.moveTo(pad, y); sCtx.lineTo(x, y); sCtx.stroke();
        sCtx.fillStyle = '#fff'; sCtx.strokeStyle = currentEffectiveMode === 'dark' ? '#91c1ff' : '#1466bc'; sCtx.lineWidth = 1.5;
        sCtx.beginPath(); sCtx.arc(x, y, isDraggingScrubber ? 6 : 5, 0, Math.PI * 2); sCtx.fill(); sCtx.stroke();
        el.scrubberTrack.setAttribute('aria-valuemax', String(Number.isFinite(dur) ? Math.round(dur) : 0));
        el.scrubberTrack.setAttribute('aria-valuenow', String(Math.round(cur) || 0));
        el.scrubberTrack.setAttribute('aria-valuetext', formatDuration(cur) + ' of ' + formatDuration(dur));
      }
    }
    renderLoop(0);
  }

  function handleVisibilityChange(visible) {
    state.isWindowVisible = visible;
    const bgVid = document.querySelector('#custom-bg video');
    if (bgVid) {
      if (!visible) bgVid.pause();
      else if (!document.body.classList.contains('perf')) bgVid.play().catch(() => {});
    }
    if (!visible) {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      document.body.classList.add('app-paused');
      document.body.classList.add('hidden-window');
    } else {
      document.body.classList.remove('app-paused');
      document.body.classList.remove('hidden-window');
      resizeCanvases();
      startVisualizers();
    }
  }

  document.addEventListener('visibilitychange', () => {
    handleVisibilityChange(!document.hidden);
  });

  if (window.electronAPI && window.electronAPI.onWindowVisibility) {
    window.electronAPI.onWindowVisibility(visible => handleVisibilityChange(visible));
  }

  function applyVisualEffects() {
    const v = state.vfx;

    if (el.coverContainer) {
      el.coverContainer.classList.toggle('vinyl-mode', !!v.vinylSpin);
      el.coverContainer.classList.toggle('spinning', !!v.vinylSpin && state.isPlaying);
    }
    document.body.classList.toggle('vfx-spotlight-on', !!v.lyricsSpotlight);
    syncVisualSettingsUI();
  }

  function syncVisualSettingsUI() {
    const v = state.vfx;
    const vfxList = [
      { id: 'vfx-pulse', key: 'bassPulse' },
      { id: 'vfx-vinyl', key: 'vinylSpin' },
      { id: 'vfx-spotlight', key: 'lyricsSpotlight' }
    ];

    vfxList.forEach(item => {
      const card = document.getElementById(`card-${item.id}`);
      const badge = document.getElementById(`badge-${item.id}`);
      const btn = document.getElementById(`toggle-${item.id}`);
      const isEnabled = v[item.key];

      if (card) card.classList.toggle('enabled', !!isEnabled);
      if (badge) badge.textContent = isEnabled ? 'on' : 'off';
      if (btn) {
        btn.classList.toggle('active', !!isEnabled);
        
      }
    });
  }


  function syncSettingsSlidersToState() {
    const s = state.audioSettings;
    if (el.sliderSpeed) el.sliderSpeed.value = s.speed;
    if (el.valSpeed) el.valSpeed.textContent = `${s.speed.toFixed(2)}x`;

    if (el.sliderSpeedPitch) el.sliderSpeedPitch.value = s.speedPitch;
    if (el.valSpeedPitch) el.valSpeedPitch.textContent = `${s.speedPitch.toFixed(2)}x`;

    if (el.sliderPitch) el.sliderPitch.value = s.pitch;
    if (el.valPitch) el.valPitch.textContent = `${s.pitch > 0 ? '+' : ''}${s.pitch} st`;

    if (el.sliderReverb) el.sliderReverb.value = s.reverb;
    if (el.valReverb) el.valReverb.textContent = `${s.reverb}%`;

    if (el.sliderDistortion) el.sliderDistortion.value = s.distortion;
    if (el.valDistortion) el.valDistortion.textContent = `${s.distortion}%`;

    if (el.sliderGain) el.sliderGain.value = Math.round(s.volume * 100);
    if (el.valGain) el.valGain.textContent = `${Math.round(s.volume * 100)}%`;

    if (el.sliderEcho) el.sliderEcho.value = s.echo;
    if (el.valEcho) el.valEcho.textContent = `${s.echo}%`;

    const eq = s.eq || { low: 0, mid: 0, high: 0 };
    if (el.sliderEqLow) el.sliderEqLow.value = eq.low;
    if (el.valEqLow) el.valEqLow.textContent = `${eq.low > 0 ? '+' : ''}${eq.low} dB`;
    if (el.sliderEqMid) el.sliderEqMid.value = eq.mid;
    if (el.valEqMid) el.valEqMid.textContent = `${eq.mid > 0 ? '+' : ''}${eq.mid} dB`;
    if (el.sliderEqHigh) el.sliderEqHigh.value = eq.high;
    if (el.valEqHigh) el.valEqHigh.textContent = `${eq.high > 0 ? '+' : ''}${eq.high} dB`;

    if (state.hqSettings) {
      if (el.sliderHqVocal) { el.sliderHqVocal.value = state.hqSettings.vocal; if (el.valHqVocal) el.valHqVocal.textContent = `${state.hqSettings.vocal > 0 ? '+' : ''}${state.hqSettings.vocal}%`; }
      if (el.sliderHqAir) { el.sliderHqAir.value = state.hqSettings.air; if (el.valHqAir) el.valHqAir.textContent = `${state.hqSettings.air > 0 ? '+' : ''}${state.hqSettings.air}%`; }
      if (el.sliderHqBass) { el.sliderHqBass.value = state.hqSettings.bass; if (el.valHqBass) el.valHqBass.textContent = `${state.hqSettings.bass > 0 ? '+' : ''}${state.hqSettings.bass}%`; }
      if (el.hqPresetChips) el.hqPresetChips.forEach(c => c.classList.toggle('active', c.dataset.preset === state.hqSettings.preset));
    }
  }

  // The expanded player uses the existing controls, so every audio engine shares one state.
  let playerSheetOpen = false;
  const playerSheet = document.getElementById('now-playing-sheet');
  const playerSummary = document.getElementById('player-summary');
  const playerControlHomes = [];
  for (const node of [document.querySelector('.playback-controls'), document.querySelector('.scrubber-bar-wrapper'), document.querySelector('.playbar-source-row'), document.getElementById('playbar-error'), document.getElementById('btn-toggle-fav'), document.querySelector('.playbar-right')]) {
    const placeholder = document.createComment('player control home');
    node.before(placeholder); playerControlHomes.push({node, placeholder});
  }
  function syncPlayerSheet(track = state.currentTrack) {
    document.getElementById('player-sheet-title').textContent = track?.title || 'No track playing';
    document.getElementById('player-sheet-artist').textContent = track?.artist || 'Select a track to listen';
    const cover = document.getElementById('player-sheet-cover');
    const thumb = track ? safeMediaURL(getTrackThumbUrl(track)) : '';
    cover.hidden = !thumb; document.getElementById('player-sheet-fallback').hidden = !!thumb;
    if (thumb) cover.src = thumb; else cover.removeAttribute('src');
    cover.onerror = () => {cover.hidden = true; document.getElementById('player-sheet-fallback').hidden = false;};
  }
  function openNowPlaying() {
    if (playerSheetOpen || document.body.classList.contains('mini')) return;
    playerSheetOpen = true; syncPlayerSheet();
    for (const {node} of playerControlHomes) (node.id === 'btn-toggle-fav' ? document.getElementById('player-sheet-favorite') : document.getElementById('player-sheet-controls')).append(node);
    playerSheet.hidden = false; document.body.classList.add('player-expanded');
    playerSummary.setAttribute('aria-expanded','true');
    document.getElementById('close-now-playing').focus(); requestAnimationFrame(resizeCanvases);
  }
  function closeNowPlaying() {
    if (!playerSheetOpen) return;
    playerSheetOpen = false;
    for (const {node,placeholder} of playerControlHomes) placeholder.after(node);
    playerSheet.hidden = true; document.body.classList.remove('player-expanded');
    playerSummary.setAttribute('aria-expanded','false'); playerSummary.focus(); requestAnimationFrame(resizeCanvases);
  }
  playerSummary.addEventListener('click', event => {if (!event.target.closest('button,select,input')) openNowPlaying();});
  playerSummary.addEventListener('keydown', event => {if (event.target === playerSummary && ['Enter',' '].includes(event.key)) {event.preventDefault();event.stopPropagation();openNowPlaying();}});
  document.getElementById('close-now-playing').addEventListener('click',closeNowPlaying);
  document.addEventListener('keydown', event => {
    if (!playerSheetOpen) return;
    if (event.key === 'Escape') {event.preventDefault();event.stopImmediatePropagation();closeNowPlaying();}
    if (event.key === 'Tab') {
      const buttons = [...playerSheet.querySelectorAll('button,select,input,[tabindex="0"]')].filter(node => node.getClientRects().length && !node.disabled);
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) {event.preventDefault();last.focus();}
      else if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first.focus();}
    }
  },true);
  new MutationObserver(() => {if (document.body.classList.contains('mini')) closeNowPlaying();}).observe(document.body,{attributes:true,attributeFilter:['class']});
  function goHome() {
    el.searchClearBtn?.click(); switchView('discover'); loadHomePage();
  }
  document.querySelectorAll('.cuda-home-title').forEach(button => button.addEventListener('click',goHome));
  document.getElementById('home-show-history').addEventListener('click', () => switchView('history'));
  document.getElementById('home-create-playlist').addEventListener('click', () => openPlaylistForm());
  function renderHomePlaylists() {
    const grid = document.getElementById('home-playlists'); grid.replaceChildren();
    if (!state.playlists.length) {const empty=document.createElement('p');empty.className='home-empty-card';empty.textContent='Create a playlist to keep your music together.';grid.append(empty);return;}
    for (const playlist of state.playlists) {
      const button=document.createElement('button');button.type='button';button.className='home-playlist-card';
      const cover=document.createElement('div');cover.className='home-playlist-cover';renderPlaylistCover(cover,playlist,64);
      const name=document.createElement('strong');name.textContent=playlist.name || 'Untitled';
      const count=document.createElement('span');const length=(playlist.tracks || []).length;count.textContent=length+' track'+(length===1?'':'s');
      button.append(cover,name,count);button.addEventListener('click',()=>openPlaylistDetail(playlist.id));grid.append(button);
    }
  }

  function updateNowPlayingUI(track) {
    const source = document.getElementById('playbar-source');
    if (source) source.textContent = ({spotify:'Spotify',youtube:'YouTube',ytmusic:'YouTube Music',soundcloud:'SoundCloud',local:'Your library'})[track?.platform] || '';
    const download = document.getElementById('btn-playbar-more'); if (download) download.hidden = track?.platform === 'spotify';
    if (el.playbarTitle) el.playbarTitle.textContent = track.title || 'Untitled';
    if (el.playbarTitle) el.playbarTitle.dataset.origTitle = track.title || '';
    if (el.playbarArtist) el.playbarArtist.textContent = track.artist || 'Unknown artist';

    syncPlayerSheet(track);
    const thumb = getTrackThumbUrl(track);
    if (thumb) {
      if (el.playbarArtwork) {
        el.playbarArtwork.src = thumb;
        el.playbarArtwork.style.display = 'block';
        el.playbarArtwork.onerror = () => {
          if (state.currentTrack && getTrackArt(state.currentTrack).cover) {
            setTrackArt(state.currentTrack, { cover: undefined });
            const defThumb = state.currentTrack.thumbnail || '';
            el.playbarArtwork.src = defThumb;
            if (el.rightPanelCover) el.rightPanelCover.src = defThumb;
            updateRightPanelBanner(defThumb);
            updateThemeFromState();
            return;
          }
          el.playbarArtwork.style.display = 'none';
          if (el.artworkFallback) el.artworkFallback.style.display = 'flex';
        };
      }
      if (el.artworkFallback) el.artworkFallback.style.display = 'none';
      if (el.rightPanelCover) {
        el.rightPanelCover.src = thumb;
        el.rightPanelCover.style.display = 'block';
        el.rightPanelCover.onerror = () => {
          if (state.currentTrack && getTrackArt(state.currentTrack).cover) {
            setTrackArt(state.currentTrack, { cover: undefined });
            const defThumb = state.currentTrack.thumbnail || '';
            el.rightPanelCover.src = defThumb;
            if (el.playbarArtwork) el.playbarArtwork.src = defThumb;
            updateRightPanelBanner(defThumb);
            updateThemeFromState();
            return;
          }
          el.rightPanelCover.style.display = 'none';
          if (el.rightPanelFallback) el.rightPanelFallback.style.display = 'flex';
        };
      }
      if (el.rightPanelFallback) el.rightPanelFallback.style.display = 'none';
    } else {
      if (el.playbarArtwork) el.playbarArtwork.style.display = 'none';
      if (el.artworkFallback) el.artworkFallback.style.display = 'flex';
      if (el.rightPanelCover) el.rightPanelCover.style.display = 'none';
      if (el.rightPanelFallback) el.rightPanelFallback.style.display = 'flex';
    }

    if (el.rightPanelTitle) el.rightPanelTitle.textContent = track.title || 'Untitled';
    if (el.rightPanelArtist) el.rightPanelArtist.textContent = track.artist || 'Unknown artist';

    if (el.btnPlaybarMore) el.btnPlaybarMore.style.display = track.platform === 'local' ? 'none' : '';

    updateRightPanelBanner(thumb);
    updateFavoriteIcon();
    applyVisualEffects();
    highlightPlayingRow();
    updateThemeFromState();
    updateMediaSession();
    if (state.isTvKaraokeOpen) updateTvKaraokeMeta();
  }

  function updateRightPanelBanner(thumbUrl) {
    const banner = document.getElementById('right-panel-banner');
    if (!banner) return;
    if (!getAdv('banners', true)) {
      banner.style.display = 'none';
      if (state.isTvKaraokeOpen) syncTvBanner();
      return;
    }
    banner.style.display = '';
    const bannerImg = banner.querySelector('.banner-image') || banner;
    const trackArt = state.currentTrack ? getTrackArt(state.currentTrack) : {};
    const trackBanner = trackArt.banner || null;
    const globalMedia = localStorage.getItem('riff_banner_media');
    const mediaToUse = trackBanner || globalMedia || thumbUrl;

    if (!mediaToUse) {
      banner.classList.add('fading-out');
      setTimeout(() => {
        bannerImg.style.backgroundImage = 'none';
        const vid = banner.querySelector('video.banner-video');
        if (vid) vid.remove();
        banner.style.opacity = '0';
        banner.classList.remove('fading-out');
        if (state.isTvKaraokeOpen) syncTvBanner();
      }, 300);
      if (state.isTvKaraokeOpen) syncTvBanner();
      return;
    }

    const isVideo = /\.(mp4|webm)($|\?)/i.test(mediaToUse);
    if (isVideo) {
      bannerImg.style.backgroundImage = 'none';
      let vid = banner.querySelector('video.banner-video');
      if (!vid) {
        vid = document.createElement('video');
        vid.className = 'banner-video';
        vid.autoplay = true;
        vid.loop = true;
        vid.muted = true;
        vid.playsInline = true;
        banner.appendChild(vid);
      }
      vid.onerror = () => {
        if (trackBanner && state.currentTrack) {
          setTrackArt(state.currentTrack, { banner: undefined });
          updateRightPanelBanner(thumbUrl);
        } else {
          banner.style.opacity = '0';
          if (state.isTvKaraokeOpen) syncTvBanner();
        }
      };
      if (vid.src !== mediaToUse) {
        vid.src = mediaToUse;
        vid.play().catch(() => {});
      }
      banner.style.opacity = '1';
      if (state.isTvKaraokeOpen) syncTvBanner();
      return;
    }

    const vid = banner.querySelector('video.banner-video');
    if (vid) vid.remove();

    const img = new Image();
    img.src = mediaToUse;
    img.onload = () => {
      banner.classList.add('fading-out');
      setTimeout(() => {
        bannerImg.style.backgroundImage = `url("${mediaToUse}")`;
        banner.classList.remove('fading-out');
        banner.style.opacity = '1';
        if (state.isTvKaraokeOpen) syncTvBanner();
      }, 150);
    };
    img.onerror = () => {
      if (trackBanner && state.currentTrack) {
        setTrackArt(state.currentTrack, { banner: undefined });
        updateRightPanelBanner(thumbUrl);
      } else {
        banner.style.opacity = '0';
        if (state.isTvKaraokeOpen) syncTvBanner();
      }
    };
    if (state.isTvKaraokeOpen) syncTvBanner();
  }

  function updatePlaylistDetailBanner(thumbUrl) {
    const banner = document.getElementById('playlist-header-banner');
    if (!banner) return;
    if (!getAdv('banners', true)) {
      banner.style.display = 'none';
      return;
    }
    banner.style.display = '';
    const bannerImg = banner.querySelector('.banner-image') || banner;
    const globalMedia = localStorage.getItem('riff_banner_media');
    const mediaToUse = globalMedia || thumbUrl;

    if (!mediaToUse) {
      banner.style.opacity = '0';
      bannerImg.style.backgroundImage = 'none';
      const vid = banner.querySelector('video.banner-video');
      if (vid) vid.remove();
      return;
    }

    const isVideo = /\.(mp4|webm)($|\?)/i.test(mediaToUse);
    if (isVideo) {
      bannerImg.style.backgroundImage = 'none';
      let vid = banner.querySelector('video.banner-video');
      if (!vid) {
        vid = document.createElement('video');
        vid.className = 'banner-video';
        vid.autoplay = true;
        vid.loop = true;
        vid.muted = true;
        vid.playsInline = true;
        banner.appendChild(vid);
      }
      if (vid.src !== mediaToUse) {
        vid.src = mediaToUse;
        vid.play().catch(() => {});
      }
      banner.style.opacity = '1';
      return;
    }

    const vid = banner.querySelector('video.banner-video');
    if (vid) vid.remove();

    const img = new Image();
    img.src = mediaToUse;
    img.onload = () => {
      bannerImg.style.backgroundImage = `url("${mediaToUse}")`;
      banner.style.opacity = '1';
    };
    img.onerror = () => {
      banner.style.opacity = '0';
    };
  }

  function getTrackCanonicalId(track) {
    if (!track) return '';
    const platform = track.platform || state.platform || 'yt';
    if (track.id) return `${platform}:${track.id}`;
    if (track.url || track.videoId) return `${platform}:${track.url || track.videoId}`;
    const t = (track.title || '').trim().toLowerCase();
    const a = (track.artist || '').trim().toLowerCase();
    const d = Math.round(Number(track.duration) || 0);
    return `${platform}:${t}|${a}|${d}`;
  }

  function isSameTrack(a, b) {
    if (!a || !b) return false;
    return getTrackCanonicalId(a) === getTrackCanonicalId(b);
  }

  function getTrackArt(t) {
    try {
      return readJSON('riff_track_art', {}, isStoredObject)[getTrackCanonicalId(t)] || {};
    } catch (e) {
      return {};
    }
  }

  function setTrackArt(t, patch) {
    let all = {};
    try {
      all = readJSON('riff_track_art', {}, isStoredObject);
    } catch (e) {}
    const id = getTrackCanonicalId(t);
    if (!id) return;
    const cur = { ...(all[id] || {}), ...patch };
    for (const k in cur) if (!cur[k]) delete cur[k];
    if (Object.keys(cur).length) all[id] = cur; else delete all[id];
    localStorage.setItem('riff_track_art', JSON.stringify(all));
  }

  let crossfadeTriggered = false;
  let crossfadeFadeInPending = false;

  let spotifyPosition = 0, spotifyRadioGenre = null, spotifyRecordedToken = -1;
  const audioSources = ['auto','spotify','youtube','ytmusic','soundcloud'];
  let audioSource = audioSources.includes(localStorage.getItem('cuda_audio_source')) ? localStorage.getItem('cuda_audio_source') : 'auto';
  let playbackAttempt = null, playbackFailed = false, playbackLoadTimer = null, sourceChangeToken = 0;
  const sourceKey = track => `${track.platform || 'youtube'}:${track.id}`;
  const sourceSelect = document.getElementById('playbar-audio-source');
  if (sourceSelect) sourceSelect.value = audioSource;
  function playbackError(message = '') {
    const error = document.getElementById('playbar-error');
    if (error) {error.textContent = message; error.title = message; error.hidden = !message;}
  }
  function playbackReady() { clearTimeout(playbackLoadTimer); playbackFailed = false; playbackError(); }
  function watchPlayback(token) {
    clearTimeout(playbackLoadTimer);
    playbackLoadTimer = setTimeout(() => { if (token === state.loadToken) recoverPlayback(new Error('The source did not start audio. Retry or choose another source.'), token); }, audioSource==='auto'?12000:20000);
  }
  async function resolveTrackSource(track, preference = audioSource, excluded = []) {
    const params = new URLSearchParams({id:track.id,title:track.title||'',artist:track.artist||'',platform:track.platform||'youtube',url:track.url||'',duration:track.duration||0,source:preference,exclude:excluded.join(',')});
    const response = await fetch(`http://127.0.0.1:${state.serverPort}/api/resolve-source?${params}`, {signal:state.currentAbortController?.signal});
    const result = await response.json();
    if (!result.success || !result.track) throw new Error(result.error || 'No matching source is available.');
    return result.track;
  }
  if (sourceSelect) sourceSelect.addEventListener('change', async () => {
    const preference = sourceSelect.value;
    const previous = audioSource;
    const change = ++sourceChangeToken;
    const token = state.loadToken;
    const original = state.currentTrack;
    if (preference === 'spotify' && !window.spotifyLibrary?.playbackConnected) {sourceSelect.value=previous;showToast('Connect Spotify playback in Settings → Integrations first.');return;}
    if (!original || original.platform === 'local') {audioSource=preference;localStorage.setItem('cuda_audio_source',preference);return;}
    sourceSelect.disabled=true;
    try {
      const known=[original,...(original.alternatives||[])].find(t=>preference!=='auto'&&t.platform===preference);
      const replacement=known || await resolveTrackSource(original,preference);
      if (change!==sourceChangeToken || token!==state.loadToken) return;
      const position=playbackTime(), paused=playbackPaused();
      audioSource=preference;localStorage.setItem('cuda_audio_source',preference);
      if(state.queueIndex>=0)state.queue[state.queueIndex]=replacement;
      const {alternatives,...previousTrack}=original;
      const retained=[...(replacement.alternatives||[]),previousTrack,...(alternatives||[])].filter(t=>sourceKey(t)!==sourceKey(replacement));
      await playTrack({...replacement,alternatives:retained,autoSelected:true},null,-1,state.currentTrackContext,{position,paused});
    } catch(error) { if(change===sourceChangeToken){sourceSelect.value=previous;showToast(error.message || 'Could not change source.');} }
    finally {if(change===sourceChangeToken){sourceSelect.disabled=false;sourceSelect.value=audioSource;}}
  });
  async function recoverPlayback(error, token = state.loadToken) {
    if (token !== state.loadToken || !playbackAttempt || playbackAttempt.recovering) return;
    const attempt = playbackAttempt;
    attempt.recovering = true;
    clearTimeout(playbackLoadTimer);
    const track = state.currentTrack;
    const position=playbackTime();
    el.nativeAudio.pause();
    state.isPlaying=false; document.body.classList.remove('is-playing');
    if (track?.platform==='spotify') await window.electronAPI.spotify('playback','stop').catch(()=>{});
    if (token!==state.loadToken) return;
    // An expired transport is retried once, then excluded from this attempt.
    if (audioSource!=='auto' && error.retryable!==false && track && !['spotify','local'].includes(track.platform) && !attempt.refreshed.has(sourceKey(track))) {
      attempt.refreshed.add(sourceKey(track));
      return playTrack(track,null,-1,state.currentTrackContext,{attempt,refresh:true,position});
    }
    let replacement=(track?.alternatives||[]).find(t=>!attempt.tried.has(sourceKey(t))&&t.playable!==false&&(audioSource==='auto'||t.platform===audioSource));
    if (!replacement && audioSource==='auto' && track?.platform!=='local' && !attempt.discovered) {
      attempt.discovered=true;
      playbackError('Looking for another source…');
      try {replacement=await resolveTrackSource(attempt.original,'auto',[...attempt.tried]);} catch {}
    }
    if(token!==state.loadToken)return;
    if(replacement && !attempt.tried.has(sourceKey(replacement))) {
      replacement={...replacement,autoSelected:true,sourceContext:window.spotifyLibrary?.connected?'spotify':'public',alternatives:[...(replacement.alternatives||[]),...(track?.alternatives||[])].filter(t=>!attempt.tried.has(sourceKey(t)))};
      if(state.queueIndex>=0)state.queue[state.queueIndex]=replacement;
      return playTrack(replacement,null,-1,state.currentTrackContext,{attempt,position});
    }
    playbackFailed=true;
    attempt.recovering=false;
    updatePlayPauseButton(false,false); el.trackLoadingOverlay?.classList.add('hidden');
    const message=error?.message || 'Audio could not play. Choose another source.';
    playbackError(message);showToast(message,'error');sendStateToServer();updateMediaSession();
  }
  function spotifyActive() {return state.currentTrack?.platform === 'spotify';}
  const playbackTime = () => spotifyActive() ? spotifyPosition : (el.nativeAudio?.currentTime || 0);
  const playbackDuration = () => spotifyActive() ? (state.currentTrack?.duration || 0) : (el.nativeAudio?.duration || state.currentTrack?.duration || 0);
  const playbackPaused = () => spotifyActive() ? !state.isPlaying : el.nativeAudio?.paused;
  function seekPlayback(seconds) { if (!Number.isFinite(seconds)) return; if (spotifyActive()) {spotifyPosition = seconds; window.electronAPI.spotify('playback','seek',{positionMs:Math.round(seconds*1000)}).catch(error=>showToast(error.message));} else if (el.nativeAudio) el.nativeAudio.currentTime = seconds; }
  window.cudaPlayer = {
    play(tracks) {if(tracks?.length){spotifyRadioGenre=null;playTrack(tracks[0],tracks,0);}},
    queue(tracks) {state.queue.splice(Math.max(0,state.queueIndex+1),0,...tracks);updateQueueBadge();if(state.currentView==='queue')renderQueueView();},
    startRadio(tracks,genre) {spotifyRadioGenre=genre;playTrack(tracks[0],tracks,0);},
    diagnostics() {
      let peak=0;
      if(audioEngine.analyserNode){const samples=new Float32Array(audioEngine.analyserNode.fftSize);audioEngine.analyserNode.getFloatTimeDomainData(samples);for(const sample of samples)peak=Math.max(peak,Math.abs(sample));}
      return {platform:state.currentTrack?.platform,playing:state.isPlaying,failed:playbackFailed,context:audioEngine.ctx?.state,peak,time:playbackTime(),attempts:playbackAttempt?.tried.size||0,error:document.getElementById('playbar-error')?.textContent};
    }
  };
  document.addEventListener('cuda-notice', event => showToast(event.detail));
  document.addEventListener('cuda-spotify-library', () => { if(window.spotifyLibrary?.playbackConnected)window.electronAPI.spotify('playback','status').catch(()=>{}); if (!window.spotifyLibrary?.connected) localStorage.removeItem('cuda_spotify_resume'); });
  window.electronAPI?.onSpotifyEvent(event => {
    if (!spotifyActive() || (event.requestedUri||event.uri) && (event.requestedUri||event.uri) !== state.currentTrack.uri && (event.requestedUri||event.uri) !== state.currentTrack.url) return;
    if(event.event==='metadata'){Object.assign(state.currentTrack,{title:event.title,artist:event.artist,album:event.album,duration:event.duration,thumbnail:event.thumbnail||state.currentTrack.thumbnail});updateNowPlayingUI(state.currentTrack);}
    if (Number.isFinite(event.positionMs)) spotifyPosition=event.positionMs/1000;
    if (event.event==='playing' || event.event==='paused') {
      if(event.event==='playing'){delete state.currentTrack.resumePosition;playbackReady();const next=state.queue[state.queueIndex+1];if(next?.platform==='spotify')window.electronAPI.spotify('playback','preload',{uri:next.uri||next.url}).catch(()=>{});}
      if (event.event==='playing' && spotifyRecordedToken!==state.loadToken) {spotifyRecordedToken=state.loadToken;window.electronAPI.spotify('played',state.currentTrack).catch(()=>{});}
      state.isPlaying=event.event==='playing'; if(!state.isPlaying)el.nativeAudio.pause();else if(el.nativeAudio.src&&el.nativeAudio.paused)el.nativeAudio.play().catch(()=>{}); document.body.classList.toggle('is-playing',state.isPlaying);updatePlayPauseButton(state.isPlaying,false);
      document.getElementById('btn-play-pause')?.setAttribute('aria-label',state.isPlaying?'Pause':'Play');
      if (el.trackLoadingOverlay) el.trackLoadingOverlay.classList.add('hidden');
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState=state.isPlaying?'playing':'paused';
      updateMediaSession();sendStateToServer();sendDiscordRpcUpdate(state.currentTrack,state.isPlaying);
    }
    if (event.event==='position' || event.event==='playing' || event.event==='paused') {
      if (el.timeCurrent) el.timeCurrent.textContent=formatDuration(spotifyPosition);
      if (el.timeDuration) el.timeDuration.textContent=formatDuration(playbackDuration());
      updateSyncedLyricsHighlight(spotifyPosition);hasDrawnPausedFrame=false;updateMediaSession();
      localStorage.setItem('cuda_spotify_resume',JSON.stringify({track:state.currentTrack,position:spotifyPosition}));
    }
    if(event.event==='ended') {if(state.isRepeat)playTrack(state.currentTrack);else playNext();}
    if(event.event==='preload') {const next=state.queue[state.queueIndex+1];if(next?.platform==='spotify')window.electronAPI.spotify('playback','preload',{uri:next.uri||next.url}).catch(()=>{});}
    if(event.event==='error') {recoverPlayback(new Error(event.error || 'Spotify playback failed.'));}
  });

  async function playTrack(track, queueList = null, startIndex = -1, context = null, options = {}) {
    if (!track || !el.nativeAudio) return;
    clearTimeout(spotifyEffectsTimer);
    state.loadToken++;
    const currentToken = state.loadToken;
    clearTimeout(playbackLoadTimer);playbackFailed=false;playbackError();
    playbackAttempt=options.attempt || {original:track,tried:new Set(),refreshed:new Set(),discovered:false,recovering:false};
    playbackAttempt.recovering=false;
    if (spotifyActive() && (track.platform!=='spotify' || (audioSource!=='auto' && audioSource!=='spotify') || !window.spotifyLibrary?.playbackConnected)) await window.electronAPI.spotify('playback','stop').catch(() => {});
    if (currentToken !== state.loadToken) return;
    el.nativeAudio.loop = false;
    spotifyPosition = 0;
    crossfadeTriggered = false;
    initAudioContext();

    try {
      el.nativeAudio.pause();
      el.nativeAudio.removeAttribute('src');
      el.nativeAudio.load();
    } catch (e) {}

    if (hlsInstance) {
      try { hlsInstance.destroy(); } catch (e) {}
      hlsInstance = null;
    }

    state.isPlaying = false;
    updatePlayPauseButton(false, true);
    sendStateToServer();

    if (el.timeCurrent) el.timeCurrent.textContent = '0:00';
    scrubPrevKnobX = null;
    scrubProgress = 0;

    if (el.trackLoadingOverlay) {
      if (el.trackLoadingTitle) el.trackLoadingTitle.textContent = track.title || 'loading track...';
      if (el.trackLoadingSub) el.trackLoadingSub.textContent = track.artist ? `${track.artist} • buffering stream` : 'buffering audio stream';
      el.trackLoadingOverlay.classList.remove('hidden');
    }

    if (state.currentAbortController) {
      state.currentAbortController.abort();
    }
    state.currentAbortController = new AbortController();
    const signal = state.currentAbortController.signal;

    state.currentTrack = track;
    playbackAttempt.tried.add(sourceKey(track));
    state.currentTrackContext = context;
    state.currentTrackIndexInContext = startIndex;

    if (queueList) {
      state.queue = [...queueList];
      if (startIndex >= 0 && startIndex < state.queue.length && isSameTrack(state.queue[startIndex], track)) {
        state.queueIndex = startIndex;
      } else {
        state.queueIndex = state.queue.findIndex(t => isSameTrack(t, track));
      }
      if (state.queueIndex === -1) {
        state.queue.unshift(track);
        state.queueIndex = 0;
      }
    } else if (!state.queue.some(t => isSameTrack(t, track))) {
      state.queue.push(track);
      state.queueIndex = state.queue.length - 1;
    }
    updateQueueBadge();

    state.history = state.history.filter(t => !isSameTrack(t, track));
    state.history.unshift(track);
    if (state.history.length > 100) state.history.pop();
    localStorage.setItem('devsize_history', JSON.stringify(state.history));
    if (state.currentView === 'history') renderHistoryView();

    updateNowPlayingUI(track);
    updatePlayPauseButton(false, true);

    loadSyncedLyrics(track.title, track.artist, currentToken);

    try {
      let preparedStream=null;
      if(track.platform!=='local'&&audioSource==='auto'&&!(track.platform==='spotify'&&window.spotifyLibrary?.playbackConnected)){
        const original=track;
        const excluded=[...playbackAttempt.tried].filter(key=>key!==sourceKey(track));
        const response=await fetch(`http://127.0.0.1:${state.serverPort}/api/playback-source`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({track,exclude:excluded,refresh:!!options.refresh}),signal});
        const result=await response.json();if(currentToken!==state.loadToken)return;
        if(!result.success){for(const key of result.attempted||[])playbackAttempt.tried.add(key);playbackAttempt.discovered=true;throw Object.assign(new Error(result.error||'No audio source is available.'),{retryable:false});}
        track={...result.track,alternatives:result.track.alternatives||original.alternatives||[]};preparedStream=result.stream;
        state.currentTrack=track;if(state.queueIndex>=0)state.queue[state.queueIndex]=track;
        state.history=state.history.map(t=>isSameTrack(t,original)?track:t);localStorage.setItem('devsize_history',JSON.stringify(state.history));updateNowPlayingUI(track);
      }
      if (track.platform !== 'local' && ((audioSource !== 'auto' && track.platform !== audioSource) || (track.platform === 'spotify' && !window.spotifyLibrary?.playbackConnected))) {
        const original=track;
        track=await resolveTrackSource(track,audioSource);
        if(currentToken!==state.loadToken)return;
        state.currentTrack=track;
        if(state.queueIndex>=0)state.queue[state.queueIndex]=track;
        state.history=state.history.map(t=>isSameTrack(t,original)?track:t);
        localStorage.setItem('devsize_history',JSON.stringify(state.history));
        updateNowPlayingUI(track);
      }
      playbackAttempt.tried.add(sourceKey(track));
      const position=Number.isFinite(options.position)?Math.max(0,options.position):Math.max(0,Number(track.resumePosition)||0);
      const seekWhenReady=()=>{
        if(currentToken!==state.loadToken)return;
        if(position>0){try{el.nativeAudio.currentTime=Number.isFinite(el.nativeAudio.duration)?Math.min(position,Math.max(0,el.nativeAudio.duration-0.1)):position;}catch{}}
      };
      if(position>0)el.nativeAudio.addEventListener('loadedmetadata',seekWhenReady,{once:true});
      const startAudio=async()=>{
        if(currentToken!==state.loadToken)return;
        applyAudioSettings();
        if(options.paused){updatePlayPauseButton(false,false);el.trackLoadingOverlay?.classList.add('hidden');return;}
        if(audioEngine.ctx && audioEngine.ctx.state!=='running')await audioEngine.ctx.resume();
        if(currentToken!==state.loadToken)return;
        watchPlayback(currentToken);
        await el.nativeAudio.play();
      };
      if (track.platform === 'spotify') {
        await window.electronAPI.spotify('playback','load',{uri:track.uri||track.url,play:!options.paused,positionMs:Math.round(position*1000),volume:state.isMuted?0:state.volume,effects:spotifyEffects()});
        if (currentToken !== state.loadToken) return;
        // A silent local audio session gives macOS media keys/Control Center the same lifecycle as streamed audio.
        el.nativeAudio.src = 'assets/spotify-session.wav';
        el.nativeAudio.loop = true;
        spotifyPosition=position;
        if(!options.paused){if(!state.isPlaying)watchPlayback(currentToken);el.nativeAudio.play().catch(()=>{});}
        else {updatePlayPauseButton(false,false);el.trackLoadingOverlay?.classList.add('hidden');}
        return;
      }
      if (track.platform === 'local') {
        const streamUrl = `http://127.0.0.1:${state.serverPort}/api/library-file?id=${encodeURIComponent(track.id)}`;
        const response=await fetch(streamUrl,{method:'HEAD',signal});
        if(!response.ok)throw new Error('The audio file is missing from your library.');
        if(currentToken!==state.loadToken)return;
        el.nativeAudio.src=streamUrl;
        el.nativeAudio.load();
        await startAudio();
        return;
      }

      let resolvedUrl = track.url;
      let resolvedId = track.id;
      let data = preparedStream;

      const initialId = track.id || (track.url && track.url.includes('v=') ? track.url.split('v=')[1].split('&')[0] : null);
      if (!data && initialId) {
        try {
          const cacheRes = await fetch(`http://127.0.0.1:${state.serverPort}/api/check-cache?id=${encodeURIComponent(initialId)}`, { signal });
          const cacheData = await cacheRes.json();
          if (cacheData.cached && cacheData.streamUrl) {
            data = { success: true, isLocal: true, streamUrl: cacheData.streamUrl };
          }
        } catch (e) {}
      }

      if (!data && !navigator.onLine) {
        showToast('Offline: this track is not available in local cache');
        throw new Error('Offline: track not cached locally');
      }

      if (!data && track.searchQuery) {
        try {
          const searchRes = await fetch(`http://127.0.0.1:${state.serverPort}/api/search?q=${encodeURIComponent(track.searchQuery)}&platform=youtube&limit=1`, { signal });
          const sData = await searchRes.json();
          if (sData.success && sData.tracks && sData.tracks[0]) {
            resolvedUrl = sData.tracks[0].url;
            resolvedId = sData.tracks[0].id;
            state.currentTrack.id = resolvedId;
            state.currentTrack.url = resolvedUrl;

            try {
              const cacheRes = await fetch(`http://127.0.0.1:${state.serverPort}/api/check-cache?id=${encodeURIComponent(resolvedId)}`, { signal });
              const cacheData = await cacheRes.json();
              if (cacheData.cached && cacheData.streamUrl) {
                data = { success: true, isLocal: true, streamUrl: cacheData.streamUrl };
              }
            } catch (e) {}
          }
        } catch (e) {}
      }

      if (!data) {
        const streamInfoUrl = `http://127.0.0.1:${state.serverPort}/api/stream-info?url=${encodeURIComponent(resolvedUrl || '')}&id=${encodeURIComponent(resolvedId || '')}&platform=${track.platform || state.platform}&title=${encodeURIComponent(track.title || '')}&artist=${encodeURIComponent(track.artist || '')}&duration=${encodeURIComponent(track.duration || 0)}&thumbnail=${encodeURIComponent(track.thumbnail || '')}&refresh=${options.refresh?'1':'0'}`;
        const res = await fetch(streamInfoUrl, { signal });
        data = await res.json();
      }

      if (currentToken !== state.loadToken) return;

      if (!data.success || !data.streamUrl){const error=new Error(data.error || 'Failed to extract audio stream');error.retryable=false;throw error;}

      if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
      }

      if (data.isHls && window.Hls && Hls.isSupported()) {
        hlsInstance = new Hls({ loader: hlsProxyLoader(Hls, data.proxyBase || `http://127.0.0.1:${state.serverPort}/api/audio-proxy?url=`), enableWorker: true, lowLatencyMode: true, maxBufferLength: 30, maxMaxBufferLength: 60, maxBufferSize: 30 * 1000 * 1000 });
        hlsInstance.on(Hls.Events.ERROR, (_event, failure) => {
          if(currentToken===state.loadToken && failure.fatal)recoverPlayback(new Error(`Audio stream failed (${failure.details || failure.type}).`),currentToken);
        });
        if(!options.paused)watchPlayback(currentToken);
        hlsInstance.loadSource(data.streamUrl);
        hlsInstance.attachMedia(el.nativeAudio);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
          if (currentToken === state.loadToken) {
            startAudio().catch(error=>recoverPlayback(error,currentToken));
          }
        });
      } else {
        el.nativeAudio.src = data.proxyUrl || data.streamUrl;
        el.nativeAudio.load();
        await startAudio();
      }

      applyAudioSettings();
    } catch (err) {
      if(currentToken!==state.loadToken)return;
      if(err.name==='AbortError' && signal.aborted)return;
      await recoverPlayback(err,currentToken);
    }
  }

  function flipAnimate(elements, mutateFn, duration = 380) {
    const validElements = (elements || []).filter(item => item && item.getBoundingClientRect);
    const firstRects = new Map();
    validElements.forEach(item => {
      firstRects.set(item, item.getBoundingClientRect());
    });

    validElements.forEach(item => {
      item.style.transition = 'none';
      item.style.transform = 'none';
    });

    if (typeof mutateFn === 'function') {
      mutateFn();
    }

    const animatingElements = [];
    validElements.forEach(item => {
      const first = firstRects.get(item);
      const last = item.getBoundingClientRect();
      if (!first || !last) return;
      if ((first.width === 0 && first.height === 0) || (last.width === 0 && last.height === 0)) return;

      const dx = first.left - last.left;
      const dy = first.top - last.top;

      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        item.style.transform = `translate(${dx}px, ${dy}px)`;
        animatingElements.push(item);
      } else {
        item.style.transform = '';
        item.style.transition = '';
      }
    });

    if (animatingElements.length === 0) return;

    animatingElements.forEach(item => item.offsetHeight);

    requestAnimationFrame(() => {
      animatingElements.forEach(item => {
        item.style.transition = `transform ${duration}ms cubic-bezier(0.2, 0, 0, 1)`;
        item.style.transform = '';

        let cleaned = false;
        const cleanUp = () => {
          if (cleaned) return;
          cleaned = true;
          item.removeEventListener('transitionend', onEnd);
          item.style.transition = '';
          item.style.transform = '';
        };
        const onEnd = (e) => {
          if (e.target !== item || e.propertyName !== 'transform') return;
          cleanUp();
        };
        item.addEventListener('transitionend', onEnd);
        setTimeout(cleanUp, duration + 50);
      });
    });
  }

  function setLyricsEmpty(isEmpty) {
    const panel = el.rightPanel || document.getElementById('right-panel');
    if (!panel) return;
    const currentlyEmpty = panel.classList.contains('lyrics-empty');
    if (currentlyEmpty === !!isEmpty) {
      syncTvLayout();
      return;
    }

    const hero = el.rightPanelArtworkBox || document.getElementById('right-panel-artwork-box');

    flipAnimate([hero], () => {
      panel.classList.toggle('lyrics-empty', !!isEmpty);
      syncTvLayout();
    }, 380);
    syncTvLayout(!!isEmpty);
  }

  async function loadSyncedLyrics(title, artist, token) {
    if (el.lyricsContainer) {
      el.lyricsContainer.style.transition = 'opacity 200ms cubic-bezier(0.2, 0, 0, 1)';
      el.lyricsContainer.style.opacity = '0';
    }
    state.syncedLyrics = [];
    state.isCustomLyrics = false;

    try {
      const onlineParam = getAdv('online_lyrics', true) ? '1' : '0';
      const res = await fetch(`http://127.0.0.1:${state.serverPort}/api/lyrics?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}&online=${onlineParam}`);
      const data = await res.json();

      if (token !== state.loadToken || (state.currentTrack && (state.currentTrack.title || '') !== title)) return;

      if (!data.success || !data.lyrics) {
        if (el.lyricsStatus) el.lyricsStatus.textContent = '';
        if (el.lyricsContainer) {
          el.lyricsContainer.innerHTML = '';
          el.lyricsContainer.style.opacity = '1';
        }
        setLyricsEmpty(true);
        return;
      }

      state.isCustomLyrics = !!data.isCustom;

      const raw = data.lyrics;
      const lines = raw.split('\n');
      const parsed = [];
      const lrcRegex = /\[(\d+):(\d+(\.\d+)?)\](.*)/;

      for (const line of lines) {
        const match = lrcRegex.exec(line);
        if (match) {
          const min = parseInt(match[1], 10);
          const sec = parseFloat(match[2]);
          const text = match[4].trim();
          if (text) {
            parsed.push({ time: min * 60 + sec, text: text });
          }
        } else if (line.trim()) {
          parsed.push({ time: -1, text: line.trim() });
        }
      }

      if (parsed.length === 0) {
        if (el.lyricsStatus) el.lyricsStatus.textContent = '';
        if (el.lyricsContainer) {
          el.lyricsContainer.innerHTML = '';
          el.lyricsContainer.style.opacity = '1';
        }
        setLyricsEmpty(true);
        return;
      }

      state.syncedLyrics = parsed;
      const hasSyncTimes = parsed.some(p => p.time >= 0);
      if (el.lyricsStatus) el.lyricsStatus.textContent = data.isCustom ? (hasSyncTimes ? 'Custom synced' : 'Custom') : (hasSyncTimes ? 'Synced' : 'Plain');
      if (state.trEnabled && state.trAuto) {
        state.trActive = true;
        fetchAndApplyTranslation();
      } else {
        state.trActive = false;
        state.currentTranslations = null;
      }
      updateLyricsTranslationUI();
      renderLyricsView();
      setLyricsEmpty(false);
      if (el.lyricsContainer) {
        el.lyricsContainer.style.opacity = '0';
        requestAnimationFrame(() => {
          el.lyricsContainer.style.transition = 'opacity 250ms cubic-bezier(0.2, 0, 0, 1)';
          el.lyricsContainer.style.opacity = '1';
        });
      }
    } catch (e) {
      if (token === state.loadToken) {
        if (el.lyricsStatus) el.lyricsStatus.textContent = '';
        if (el.lyricsContainer) {
          el.lyricsContainer.innerHTML = '';
          el.lyricsContainer.style.opacity = '1';
        }
        setLyricsEmpty(true);
      }
    }
  }

  function renderLyricsView() {
    if (!el.lyricsContainer) return;
    if (state.syncedLyrics.length === 0) return;
    el.lyricsContainer.innerHTML = '';

    state.syncedLyrics.forEach((line, index) => {
      const div = document.createElement('div');
      div.className = 'lyric-line';
      div.id = `lyric-line-${index}`;

      if (getAdv('karaoke_words', true) && state.lyricsMode === 'word') {
        const cleanText = line.text.replace(/<[^>]+>/g, '').trim();
        const words = cleanText.split(/\s+/).filter(Boolean);
        div.innerHTML = words.map((w, wIdx) => {
          const safeText = w.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          return `<span class="lyric-word" data-word-idx="${wIdx}">${safeText}</span>`;
        }).join(' ');
      } else {
        div.textContent = line.text;
      }

      if (state.trActive && state.currentTranslations && state.currentTranslations[index]) {
        const trDiv = document.createElement('div');
        trDiv.className = 'lyric-translation';
        trDiv.textContent = state.currentTranslations[index];
        div.appendChild(trDiv);
      }

      if (line.time >= 0) {
        div.addEventListener('click', () => {
          const seekTime = getLineStartTime(index);
          if (el.nativeAudio && seekTime >= 0) seekPlayback(seekTime);
        });
      }
      el.lyricsContainer.appendChild(div);
    });
  }

  const lyricsTranslationCache = new Map();

  async function fetchAndApplyTranslation() {
    if (!state.currentTrack || !state.syncedLyrics || state.syncedLyrics.length === 0) return;
    const track = state.currentTrack;
    const lang = state.trLang || 'en';
    const cacheKey = `${track.title || ''}|${track.artist || ''}|${lang}`.toLowerCase();

    if (lyricsTranslationCache.has(cacheKey)) {
      state.currentTranslations = lyricsTranslationCache.get(cacheKey);
      renderLyricsView();
      if (el.nativeAudio) updateSyncedLyricsHighlight(playbackTime());
      return;
    }

    const texts = state.syncedLyrics.map(l => l.text);
    try {
      const res = await fetch(`http://127.0.0.1:${state.serverPort}/api/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts, targetLang: lang })
      });
      const data = await res.json();
      if (data && data.success && Array.isArray(data.translations)) {
        lyricsTranslationCache.set(cacheKey, data.translations);
        const curKey = `${(state.currentTrack && state.currentTrack.title) || ''}|${(state.currentTrack && state.currentTrack.artist) || ''}|${state.trLang || 'en'}`.toLowerCase();
        if (curKey === cacheKey && state.trActive) {
          state.currentTranslations = data.translations;
          renderLyricsView();
          if (el.nativeAudio) updateSyncedLyricsHighlight(playbackTime());
        }
      }
    } catch (e) {
      console.error('Translation error:', e);
    }
  }

  function updateLyricsTranslationUI() {
    if (el.btnTrEnabled) el.btnTrEnabled.classList.toggle('active', !!state.trEnabled);
    if (el.selectTrLang) el.selectTrLang.value = state.trLang || 'en';
    if (el.btnTrAuto) el.btnTrAuto.classList.toggle('active', !!state.trAuto);
    if (el.btnTranslateLyrics) {
      el.btnTranslateLyrics.classList.toggle('hidden', !state.trEnabled);
      el.btnTranslateLyrics.classList.toggle('active', !!state.trActive);
    }
  }

  const CUSTOM_SHIFT_LEAD_SECONDS = 4.0;

  function getLineStartTime(idx) {
    const lines = state.syncedLyrics;
    if (idx < 0 || idx >= lines.length) return -1;
    const raw = lines[idx].time;
    if (raw < 0) return -1;
    if (!state.isCustomLyrics) return raw;
    for (let j = idx - 1; j >= 0; j--) {
      if (lines[j].time >= 0) return lines[j].time;
    }
    return Math.max(0, raw - CUSTOM_SHIFT_LEAD_SECONDS);
  }

  function getLineEndTime(idx) {
    const start = getLineStartTime(idx);
    const lines = state.syncedLyrics;
    for (let j = idx + 1; j < lines.length; j++) {
      const t = getLineStartTime(j);
      if (t >= 0) return t;
    }
    return start + 4.0;
  }

  function updateSyncedLyricsHighlight(currentTime) {
    if (state.syncedLyrics.length === 0 || !state.isWindowVisible) return;
    let activeIndex = -1;

    const validLines = [];
    for (let i = 0; i < state.syncedLyrics.length; i++) {
      const startTime = getLineStartTime(i);
      if (startTime >= 0) {
        validLines.push({ time: startTime, index: i });
      }
    }

    const lookAhead = state.isCustomLyrics ? 0.25 : 0.0;
    const matchTime = currentTime + lookAhead;

    for (let i = 0; i < validLines.length; i++) {
      const current = validLines[i];
      const next = validLines[i + 1];
      const nextTime = next ? next.time : Infinity;
      if (matchTime >= current.time && matchTime < nextTime) {
        activeIndex = current.index;
        break;
      }
    }

    if (activeIndex >= 0 && state.isPlaying) {
      const currentLineTime = getLineStartTime(activeIndex);
      const nextLineTime = getLineEndTime(activeIndex);
      const lineDur = Math.max(0.5, nextLineTime - currentLineTime);
      const progress = Math.min(Math.max((matchTime - currentLineTime) / lineDur, 0), 0.999);

      const cleanText = state.syncedLyrics[activeIndex].text.replace(/<[^>]+>/g, '').trim();
      const words = cleanText.split(/\s+/).filter(Boolean);
      const totalWords = words.length;
      const currentWordIndex = totalWords > 0 ? Math.floor(progress * totalWords) : 0;
      const activeWordText = totalWords > 0 ? words[currentWordIndex] : '';

      const stateKey = `${activeIndex}-${currentWordIndex}`;
      if (state.lastBroadcastStateKey !== stateKey) {
        state.lastBroadcastStateKey = stateKey;
        sendStateToServer(activeWordText, currentWordIndex, activeIndex);
      }
    }

    document.querySelectorAll('.lyric-line').forEach((lineEl, idx) => {
      lineEl.style.setProperty('--dist', activeIndex >= 0 ? Math.abs(idx - activeIndex) : 0);
      if (idx === activeIndex) {
        if (!lineEl.classList.contains('active')) {
          lineEl.classList.add('active');
          const parent = el.lyricsContainer;
          if (parent && getAdv('lyrics_autoscroll', true)) {
            const parentRect = parent.getBoundingClientRect();
            const lineRect = lineEl.getBoundingClientRect();
            const targetY = parent.scrollTop + (lineRect.top - parentRect.top) - (parentRect.height / 2) + (lineRect.height / 2);
            parent.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
          }
        }

        if (getAdv('karaoke_words', true) && state.lyricsMode === 'word') {
          const currentLineTime = getLineStartTime(idx);
          const nextLineTime = getLineEndTime(idx);
          const lineDur = Math.max(0.5, nextLineTime - currentLineTime);
          const progress = Math.min(Math.max((matchTime - currentLineTime) / lineDur, 0), 0.999);

          const wordSpans = lineEl.querySelectorAll('.lyric-word');
          const totalWords = wordSpans.length;
          const currentWordIndex = Math.floor(progress * totalWords);

          wordSpans.forEach((wSpan, wIdx) => {
            if (wIdx < currentWordIndex) {
              wSpan.className = 'lyric-word past-word';
            } else if (wIdx === currentWordIndex) {
              wSpan.className = 'lyric-word active-word';
            } else {
              wSpan.className = 'lyric-word';
            }
          });
        }
      } else {
        lineEl.classList.remove('active');
        if (getAdv('karaoke_words', true) && state.lyricsMode === 'word') {
          lineEl.querySelectorAll('.lyric-word').forEach(wSpan => {
            wSpan.className = idx < activeIndex ? 'lyric-word past-word' : 'lyric-word';
          });
        }
      }
    });
  }

  function updateLyricsModeButton() {
    if (!el.btnLyricsMode) return;
    const isWordEnabled = getAdv('karaoke_words', true);
    if (!isWordEnabled && state.lyricsMode === 'word') {
      state.lyricsMode = 'line';
    }
    const label = state.lyricsMode === 'word' ? 'Word' : 'Line';
    el.btnLyricsMode.querySelector('span').textContent = label;
  }

  if (el.btnLyricsMode) {
    updateLyricsModeButton();
    el.btnLyricsMode.addEventListener('click', () => {
      if (!getAdv('karaoke_words', true)) {
        state.lyricsMode = 'line';
        updateLyricsModeButton();
        return;
      }
      state.lyricsMode = state.lyricsMode === 'line' ? 'word' : 'line';
      updateLyricsModeButton();
      renderLyricsView();
      if (el.nativeAudio) updateSyncedLyricsHighlight(playbackTime());
    });
  }

  if (el.btnTranslateLyrics) {
    el.btnTranslateLyrics.addEventListener('click', () => {
      state.trActive = !state.trActive;
      updateLyricsTranslationUI();
      if (state.trActive) {
        fetchAndApplyTranslation();
      } else {
        state.currentTranslations = null;
        renderLyricsView();
        if (el.nativeAudio) updateSyncedLyricsHighlight(playbackTime());
      }
    });
  }

  let lyricsContainerParent = null;
  let lyricsContainerSibling = null;
  let tvIdleTimer = null;

  function resetTvIdleTimer() {
    if (!state.isTvKaraokeOpen || !el.tvKaraoke) return;
    el.tvKaraoke.classList.remove('tv-idle');
    clearTimeout(tvIdleTimer);
    tvIdleTimer = setTimeout(() => {
      if (state.isTvKaraokeOpen && el.tvKaraoke) {
        el.tvKaraoke.classList.add('tv-idle');
      }
    }, 3000);
  }

  function syncTvBanner() {
    const tvBg = el.tvBg || document.getElementById('tv-bg');
    if (!tvBg) return;
    const banner = document.getElementById('right-panel-banner');
    tvBg.innerHTML = '';
    tvBg.style.backgroundImage = '';
    tvBg.classList.remove('fallback');

    let hasBanner = false;
    if (banner && banner.style.display !== 'none' && banner.style.opacity !== '0') {
      const bannerImg = banner.querySelector('.banner-image');
      const video = banner.querySelector('video');
      const img = banner.querySelector('img');
      if (video) {
        const clonedVideo = video.cloneNode(true);
        clonedVideo.muted = true;
        clonedVideo.play().catch(() => {});
        tvBg.appendChild(clonedVideo);
        hasBanner = true;
      } else if (img && img.src) {
        const clonedImg = img.cloneNode(true);
        tvBg.appendChild(clonedImg);
        hasBanner = true;
      } else if (bannerImg && bannerImg.style.backgroundImage && bannerImg.style.backgroundImage !== 'none') {
        tvBg.style.backgroundImage = bannerImg.style.backgroundImage;
        hasBanner = true;
      } else if (banner.style.backgroundImage && banner.style.backgroundImage !== 'none') {
        tvBg.style.backgroundImage = banner.style.backgroundImage;
        hasBanner = true;
      }
    }

    if (!hasBanner) {
      const thumb = getTrackThumbUrl(state.currentTrack);
      if (thumb) {
        tvBg.classList.add('fallback');
        tvBg.style.backgroundImage = `url("${thumb}")`;
      }
    }
  }

  function syncTvLayout(forcedNoLyrics) {
    const tv = el.tvKaraoke || document.getElementById('tv-karaoke');
    if (!tv) return;
    const panel = el.rightPanel || document.getElementById('right-panel');
    const noLyrics = typeof forcedNoLyrics === 'boolean'
      ? forcedNoLyrics
      : (panel ? panel.classList.contains('lyrics-empty') : (!state.syncedLyrics || state.syncedLyrics.length === 0));
    tv.classList.toggle('tv-nolyrics', !!noLyrics);
  }

  function updateTvProgress(cur, dur) {
    const curEl = document.querySelector('.tv-cur');
    const durEl = document.querySelector('.tv-dur');
    const barFill = document.querySelector('.tv-bar i');
    if (curEl) curEl.textContent = formatDuration(cur);
    if (durEl) durEl.textContent = formatDuration(dur);
    if (barFill) {
      const pct = dur > 0 ? Math.min(100, Math.max(0, (cur / dur) * 100)) : 0;
      barFill.style.width = pct + '%';
    }
  }

  function updateTvKaraokeMeta() {
    if (el.tvKaraokeTitle) {
      el.tvKaraokeTitle.textContent = (state.currentTrack && state.currentTrack.title) || 'No track';
    }
    if (el.tvKaraokeArtist) {
      el.tvKaraokeArtist.textContent = (state.currentTrack && state.currentTrack.artist) || '';
    }
    const coverEl = el.tvCover || document.getElementById('tv-cover');
    if (coverEl) {
      const thumb = getTrackThumbUrl(state.currentTrack);
      coverEl.src = thumb || '';
      coverEl.style.display = thumb ? 'block' : 'none';
    }
    syncTvBanner();
    syncTvLayout();
  }

  function openTvKaraoke() {
    if (!el.tvKaraoke || !el.lyricsContainer) return;
    if (state.isTvKaraokeOpen) return;
    state.isTvKaraokeOpen = true;

    lyricsContainerParent = el.lyricsContainer.parentElement;
    lyricsContainerSibling = el.lyricsContainer.nextSibling;

    if (el.tvKaraokeContent) {
      el.tvKaraokeContent.appendChild(el.lyricsContainer);
    }
    updateTvKaraokeMeta();
    syncTvBanner();
    syncTvLayout();
    el.tvKaraoke.classList.remove('hidden');
    resetTvIdleTimer();

    if (el.nativeAudio) {
      const cur = playbackTime();
      const dur = playbackDuration();
      updateSyncedLyricsHighlight(cur);
      updateTvProgress(cur, dur);
    }
    const tvPlayIcon = document.getElementById('tv-play-icon');
    const tvPauseIcon = document.getElementById('tv-pause-icon');
    if (tvPlayIcon && tvPauseIcon) {
      const isPlaying = state.isPlaying && !playbackPaused();
      tvPlayIcon.classList.toggle('hidden', isPlaying);
      tvPauseIcon.classList.toggle('hidden', !isPlaying);
    }
  }

  function closeTvKaraoke() {
    if (!state.isTvKaraokeOpen || !el.tvKaraoke) return;
    state.isTvKaraokeOpen = false;
    clearTimeout(tvIdleTimer);
    el.tvKaraoke.classList.remove('tv-idle');
    el.tvKaraoke.classList.add('hidden');

    if (lyricsContainerParent && el.lyricsContainer) {
      if (lyricsContainerSibling) {
        lyricsContainerParent.insertBefore(el.lyricsContainer, lyricsContainerSibling);
      } else {
        lyricsContainerParent.appendChild(el.lyricsContainer);
      }
    }

    if (el.nativeAudio) {
      updateSyncedLyricsHighlight(playbackTime());
    }
  }

  window.openTvKaraoke = openTvKaraoke;
  window.closeTvKaraoke = closeTvKaraoke;

  if (el.btnTvKaraoke) {
    el.btnTvKaraoke.addEventListener('click', openTvKaraoke);
  }
  if (el.tvKaraokeClose) {
    el.tvKaraokeClose.addEventListener('click', closeTvKaraoke);
  }
  if (el.tvKaraoke) {
    el.tvKaraoke.addEventListener('mousemove', resetTvIdleTimer);
  }

  const btnTvPrev = document.getElementById('btn-tv-prev');
  const btnTvPlay = document.getElementById('btn-tv-play');
  const btnTvNext = document.getElementById('btn-tv-next');
  if (btnTvPrev) btnTvPrev.addEventListener('click', () => playPrev());
  if (btnTvNext) btnTvNext.addEventListener('click', () => playNext());
  if (btnTvPlay) btnTvPlay.addEventListener('click', () => togglePlayPause());

  const tvBar = document.querySelector('.tv-bar');
  if (tvBar) {
    tvBar.addEventListener('click', (e) => {
      if (!el.nativeAudio) return;
      const rect = tvBar.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const dur = playbackDuration();
      if (dur > 0) {
        seekPlayback(ratio * dur);
      }
    });
  }

  function openCustomLyricsEditor() {
    if (!state.currentTrack) {
      showToast('Play a track first to add lyrics', 'info');
      return;
    }
    if (el.customLyricsTrackTitle) el.customLyricsTrackTitle.textContent = (state.currentTrack.title || 'untitled');
    if (el.customLyricsTrackArtist) el.customLyricsTrackArtist.textContent = (state.currentTrack.artist || '');

    if (state.syncedLyrics.length > 0) {
      if (el.customLyricsTextarea) el.customLyricsTextarea.value = state.syncedLyrics.map(l => l.text).join('\n');
    } else {
      if (el.customLyricsTextarea) el.customLyricsTextarea.value = '';
    }
    if (el.customLyricsModal) {
      openModal(el.customLyricsModal);
      if (el.customLyricsTextarea) setTimeout(() => el.customLyricsTextarea.focus(), 100);
    }
  }

  function closeCustomLyricsEditor() {
    if (el.customLyricsModal) closeModal(el.customLyricsModal);
  }

  async function saveCustomLyrics() {
    if (!state.currentTrack || !el.customLyricsTextarea) return;
    const text = el.customLyricsTextarea.value.trim();

    const title = state.currentTrack.title || '';
    const artist = state.currentTrack.artist || '';

    try {
      const res = await fetch(
        `http://127.0.0.1:${state.serverPort}/api/save-custom-lyrics?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`,
                              {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ lyrics: text })
                              }
      );
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Save failed');

      showToast(text ? 'Lyrics saved successfully' : 'Lyrics removed', 'info');
      closeCustomLyricsEditor();
      loadSyncedLyrics(title, artist, state.loadToken);
    } catch (e) {
      showToast('Failed to save lyrics: ' + e.message, 'error');
    }
  }

  if (el.btnAddCustomLyrics) el.btnAddCustomLyrics.addEventListener('click', openCustomLyricsEditor);
  if (el.btnCloseCustomLyrics) el.btnCloseCustomLyrics.addEventListener('click', closeCustomLyricsEditor);
  if (el.btnCancelCustomLyrics) el.btnCancelCustomLyrics.addEventListener('click', closeCustomLyricsEditor);
  if (el.btnSaveCustomLyrics) el.btnSaveCustomLyrics.addEventListener('click', saveCustomLyrics);

  if (el.customLyricsModal) {
    el.customLyricsModal.addEventListener('click', (e) => {
      if (e.target === el.customLyricsModal) closeCustomLyricsEditor();
    });
  }

  let syncState = {
    active: false,
    lines: [],
    currentIndex: 0
  };

  function openSyncMode() {
    if (!state.currentTrack) {
      showToast('Play a track first to sync lyrics', 'info');
      return;
    }

    if (state.syncedLyrics.length === 0) {
      showToast('Add lyrics first using the edit button, then sync them', 'info');
      return;
    }

    syncState.active = true;
    syncState.lines = state.syncedLyrics.map(l => ({ text: l.text, time: null }));
    syncState.currentIndex = 0;

    renderSyncLines();
    if (el.syncModeOverlay) openModal(el.syncModeOverlay);

    if (playbackPaused() && state.currentTrack) {
      togglePlayPause();
    }

    showToast('Press play, then click or tap each line when you hear it', 'info');
  }

  function updateSyncProgress() {
    const synced = syncState.lines.filter(l => l.time !== null).length;
    const total = syncState.lines.length;
    if (el.syncProgressText) el.syncProgressText.textContent = `${synced} / ${total} lines synced`;
  }

  function renderSyncLines() {
    if (!el.syncModeLyrics) return;
    const prevTop = el.syncModeLyrics.scrollTop;
    el.syncModeLyrics.innerHTML = '';
    syncState.lines.forEach((line, idx) => {
      const div = document.createElement('div');
      div.className = 'sync-line';
      div.textContent = line.text;

      if (line.time !== null) {
        div.classList.add('synced');
        const min = Math.floor(line.time / 60);
        const sec = (line.time % 60).toFixed(2);
        div.setAttribute('data-time', `[${min}:${sec.padStart(5, '0')}]`);
      }

      if (idx === syncState.currentIndex && line.time === null) {
        div.classList.add('next-line');
      }

      div.addEventListener('click', () => handleSyncLineClick(idx));
      el.syncModeLyrics.appendChild(div);
    });

    el.syncModeLyrics.scrollTop = prevTop;
    updateSyncProgress();

    const nextEl = el.syncModeLyrics.querySelector('.next-line');
    if (nextEl) {
      const c = el.syncModeLyrics;
      const cr = c.getBoundingClientRect(), nr = nextEl.getBoundingClientRect();
      c.scrollTo({ top: c.scrollTop + (nr.top - cr.top) - c.clientHeight / 2 + nr.height / 2, behavior: 'smooth' });
    }
  }

  function handleSyncLineClick(idx) {
    if (!syncState.active || !el.nativeAudio) return;

    const currentTime = playbackTime();
    syncState.lines[idx].time = currentTime;

    let next = -1;
    for (let i = idx + 1; i < syncState.lines.length; i++) {
      if (syncState.lines[i].time === null) {
        next = i;
        break;
      }
    }
    syncState.currentIndex = next >= 0 ? next : syncState.lines.length;

    renderSyncLines();
  }

  function restartSync() {
    syncState.lines.forEach(l => l.time = null);
    syncState.currentIndex = 0;
    if (el.nativeAudio) el.nativeAudio.currentTime = 0;
    renderSyncLines();
    showToast('Sync restarted', 'info');
  }

  async function saveSyncAndExit() {
    if (!state.currentTrack) return;

    const lrcLines = syncState.lines.map(line => {
      if (line.time !== null) {
        const min = Math.floor(line.time / 60);
        const sec = (line.time % 60).toFixed(2);
        return `[${min}:${sec.padStart(5, '0')}]${line.text}`;
      }
      return line.text;
    });
    const lrcContent = lrcLines.join('\n');

    const title = state.currentTrack.title || '';
    const artist = state.currentTrack.artist || '';

    try {
      const res = await fetch(
        `http://127.0.0.1:${state.serverPort}/api/save-custom-lyrics?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`,
                              {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ lyrics: lrcContent })
                              }
      );
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Save failed');

      showToast('Synced lyrics saved', 'info');
      closeSyncMode();
      loadSyncedLyrics(title, artist, state.loadToken);
    } catch (e) {
      showToast('Failed to save synced lyrics: ' + e.message, 'error');
    }
  }

  function closeSyncMode() {
    syncState.active = false;
    if (el.syncModeOverlay) closeModal(el.syncModeOverlay);
  }

  if (el.btnSyncLyrics) el.btnSyncLyrics.addEventListener('click', openSyncMode);
  if (el.btnRestartSync) el.btnRestartSync.addEventListener('click', restartSync);
  if (el.btnSaveSync) el.btnSaveSync.addEventListener('click', saveSyncAndExit);
  if (el.btnCancelSync) el.btnCancelSync.addEventListener('click', closeSyncMode);

  if (el.syncModeOverlay) {
    el.syncModeOverlay.addEventListener('click', (e) => {
      if (e.target === el.syncModeOverlay) closeSyncMode();
    });
  }

  function togglePlayPause() {
    if(playbackFailed && state.currentTrack){playTrack(state.currentTrack,null,-1,state.currentTrackContext,{position:playbackTime()});return;}
    if (spotifyActive()) { if (state.currentTrack.resumePosition != null) { const t=state.currentTrack;playTrack({...t,resumePosition:spotifyPosition});return; } if(!state.isPlaying)watchPlayback(state.loadToken);window.electronAPI.spotify('playback',state.isPlaying?'pause':'resume').catch(error=>recoverPlayback(error)); return; }
    if (!state.currentTrack) {
      if (state.queue.length > 0) playTrack(state.queue[0]);
      return;
    }

    if (playbackPaused()) {
      initAudioContext();
      if (audioEngine) audioEngine._applyMasterVolume();
      watchPlayback(state.loadToken);
      el.nativeAudio.play().catch(error=>recoverPlayback(error));
    } else if (el.nativeAudio) {
      el.nativeAudio.pause();
    }
  }

  function playNext() {
    if (state.queue.length === 0) return;
    if (state.isShuffle) {
      const nextIdx = Math.floor(Math.random() * state.queue.length);
      state.queueIndex = nextIdx;
      playTrack(state.queue[nextIdx]);
      return;
    }

    let nextIdx = state.queueIndex + 1;
    if (nextIdx >= state.queue.length && spotifyRadioGenre) {
      window.electronAPI.spotify('radio',spotifyRadioGenre).then(tracks => { if(tracks.length) {state.queue.push(...tracks);updateQueueBadge();playNext();} }).catch(error=>showToast(error.message));return;
    }
    if (nextIdx >= state.queue.length) {
      if (state.myWaveActive && typeof extendMyWaveQueue === 'function') {
        extendMyWaveQueue().then(added => {
          if (added && state.queueIndex + 1 < state.queue.length) {
            playNext();
          }
        });
        return;
      }
      nextIdx = 0;
    }
    state.queueIndex = nextIdx;
    playTrack(state.queue[nextIdx]);

    if (state.myWaveActive && state.queueIndex >= state.queue.length - 3 && typeof extendMyWaveQueue === 'function') {
      extendMyWaveQueue();
    }
  }

  function playPrev() {
    if (playbackTime() > 3) {
      seekPlayback(0);
      return;
    }
    if (state.queue.length === 0) return;
    let prevIdx = state.queueIndex - 1;
    if (prevIdx < 0) prevIdx = state.queue.length - 1;
    state.queueIndex = prevIdx;
    playTrack(state.queue[prevIdx]);
  }

  if (el.nativeAudio) {
    el.nativeAudio.addEventListener('error', () => {
      if(spotifyActive() || !el.nativeAudio.getAttribute('src') || !playbackAttempt?.tried.size)return;
      const code=el.nativeAudio.error?.code;
      if(code===1)return;
      recoverPlayback(new Error(({2:'The audio stream connection failed.',3:'The audio stream could not be decoded.',4:'The source returned unsupported audio.'})[code]||'The audio source failed.'));
    });

    el.nativeAudio.addEventListener('waiting', () => {
      if (spotifyActive()) return;
      updatePlayPauseButton(state.isPlaying, true);
    });

    el.nativeAudio.addEventListener('playing', () => {
      if (spotifyActive()) return;
      playbackReady();
      initAudioContext();
      el.trackLoadingOverlay?.classList.add('hidden');
      updatePlayPauseButton(state.isPlaying, false);
    });

    el.nativeAudio.addEventListener('canplay', () => {
      if (spotifyActive()) return;
      updatePlayPauseButton(state.isPlaying, false);
    });

    el.nativeAudio.addEventListener('play', () => {
      if (spotifyActive()) return;
      if (!hasNotifiedMediaKeysActive) {
        hasNotifiedMediaKeysActive = true;
        if (window.electronAPI && window.electronAPI.mediaKeysActive) {
          window.electronAPI.mediaKeysActive();
        }
      }
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }
      if (el.trackLoadingOverlay) el.trackLoadingOverlay.classList.add('hidden');
      state.isPlaying = true;
      document.body.classList.add('is-playing');
      updatePlayPauseButton(true, false);
      if (el.coverContainer && state.vfx.vinylSpin) el.coverContainer.classList.add('spinning');
      if (audioEngine) audioEngine._applyMasterVolume();
      if (crossfadeFadeInPending) {
        crossfadeFadeInPending = false;
        const X = parseInt(localStorage.getItem('riff_crossfade') || '0', 10);
        if (X > 0 && audioEngine) audioEngine.fadeIn(X / 2);
      }
      sendDiscordRpcUpdate(state.currentTrack, true);
      sendStateToServer();
      updateMediaSession();
    });

    el.nativeAudio.addEventListener('pause', () => {
      if (spotifyActive()) return;
      clearTimeout(playbackLoadTimer);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
      }
      state.isPlaying = false;
      document.body.classList.remove('is-playing');
      updatePlayPauseButton(false, false);
      if (el.coverContainer) el.coverContainer.classList.remove('spinning');
      sendDiscordRpcUpdate(null, false);
      sendStateToServer();
      updateMediaSession();
    });

    el.nativeAudio.addEventListener('ended', () => {
      if (spotifyActive()) return;
      if (state.isRepeat) {
        el.nativeAudio.currentTime = 0;
        el.nativeAudio.play().catch(error=>recoverPlayback(error));
      } else {
        setTimeout(() => playNext(), 100);
      }
    });

    el.nativeAudio.addEventListener('timeupdate', () => {
      if (spotifyActive()) return;
      const cur = playbackTime();
      const dur = playbackDuration();

      const X = parseInt(localStorage.getItem('riff_crossfade') || '0', 10);
      if (X > 0 && !crossfadeTriggered && !state.isRepeat && dur > X && cur >= dur - X && (!audioEngine || !audioEngine.isLiveStream(el.nativeAudio))) {
        crossfadeTriggered = true;
        crossfadeFadeInPending = true;
        if (audioEngine) audioEngine.fadeOut(X / 2);
        playNext();
      }

      updateSyncedLyricsHighlight(cur);

      if (state.isTvKaraokeOpen) {
        updateTvProgress(cur, dur);
      }

      if (isDraggingScrubber) return;
      if (!state.isPlaying) hasDrawnPausedFrame = false;
      if (el.timeCurrent) el.timeCurrent.textContent = formatDuration(cur);
      if (el.timeDuration) el.timeDuration.textContent = formatDuration(dur);
    });
  }

  let isDraggingScrubber = false;

  function updateScrubberPositionFromEvent(e) {
    if (!el.scrubberTrack) return 0;
    const rect = el.scrubberTrack.getBoundingClientRect();
    const padLeft = 5.5;
    const trackWidth = rect.width - 2 * padLeft;
    let pos = trackWidth > 0 ? (e.clientX - rect.left - padLeft) / trackWidth : 0;
    pos = Math.max(0, Math.min(1, pos));
    const dur = playbackDuration();
    const targetTime = Number.isFinite(dur) && dur > 0 ? pos * dur : 0;

    state.scrubberDragTargetTime = targetTime;
    if (el.timeCurrent) el.timeCurrent.textContent = formatDuration(targetTime);
    return targetTime;
  }

  if (el.scrubberTrack) {
    el.scrubberTrack.addEventListener('keydown', (e) => {
      const audio = el.nativeAudio;
      if (!audio || !Number.isFinite(playbackDuration()) || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      seekPlayback(e.key === 'Home' ? 0 : e.key === 'End' ? playbackDuration() : Math.max(0, Math.min(playbackDuration(), playbackTime() + (e.key === 'ArrowRight' ? 5 : -5))));
    });
    el.scrubberTrack.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      isDraggingScrubber = true;
      el.scrubberTrack.classList.add('dragging');
      updateScrubberPositionFromEvent(e);
    });
  }

  window.addEventListener('mousemove', (e) => {
    if (!isDraggingScrubber) return;
    updateScrubberPositionFromEvent(e);
  });

  window.addEventListener('mouseup', (e) => {
    if (!isDraggingScrubber) return;
    isDraggingScrubber = false;
    if (el.scrubberTrack) el.scrubberTrack.classList.remove('dragging');
    const targetTime = updateScrubberPositionFromEvent(e);
    if (Number.isFinite(targetTime)) {
      seekPlayback(targetTime);
    }
    state.scrubberDragTargetTime = undefined;
  });

  function getAllPresets() {
    return [...defaultPresets, ...state.customPresets];
  }

  function renderPresets() {
    if (!el.presetsContainer) return;
    el.presetsContainer.innerHTML = '';
    const all = getAllPresets();
    all.forEach(p => {
      const chip = document.createElement('div');
      chip.className = 'preset-chip';
      if (state.activePresetId === p.id) chip.classList.add('active');

      const isCustom = p.id.startsWith('custom_');
      chip.dataset.isCustom = isCustom ? 'true' : 'false';
      chip.dataset.presetId = p.id;

      chip.innerHTML = `
      <span class="preset-name-label">${escapeHTML(p.name)}</span>
      ${isCustom ? `
        <div class="preset-actions">
          <button type="button" class="preset-btn-action btn-rename-p" title="Rename" aria-label="Rename preset">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
          </button>
          <button type="button" class="preset-btn-action btn-delete-p" title="Delete" aria-label="Delete preset">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>` : ''}
        `;

        if (isCustom) {
          const btnRename = chip.querySelector('.btn-rename-p');
          const btnDelete = chip.querySelector('.btn-delete-p');
          if (btnRename) {
            btnRename.addEventListener('click', (e) => {
              e.stopPropagation();
              openRenamePresetModal(p);
            });
          }
          if (btnDelete) {
            btnDelete.addEventListener('click', (e) => {
              e.stopPropagation();
              openDeletePresetConfirm(p);
            });
          }
        }

        chip.addEventListener('click', (e) => {
          if (e.target.closest('.btn-delete-p') || e.target.closest('.btn-rename-p')) return;
          applyPreset(p);
        });

        el.presetsContainer.appendChild(chip);
    });
  }

  let activeTweenRaf = null;
  function tweenSettings(from, to, ms, apply) {
    if (activeTweenRaf) cancelAnimationFrame(activeTweenRaf);
    const t0 = performance.now();
    (function step(t) {
      const k = Math.min(1, (t - t0) / ms), e = k * k * (3 - 2 * k);
      const cur = {};
      for (const key in to) {
        if (typeof to[key] === 'number') cur[key] = from[key] + (to[key] - from[key]) * e;
        else if (typeof to[key] === 'object' && to[key] !== null) {
          cur[key] = { ...from[key] };
          for (const subKey in to[key]) cur[key][subKey] = (from[key]?.[subKey] ?? 0) + (to[key][subKey] - (from[key]?.[subKey] ?? 0)) * e;
        } else cur[key] = to[key];
      }
      apply(cur);
      if (k < 1) activeTweenRaf = requestAnimationFrame(step);
      else activeTweenRaf = null;
    })(t0);
  }

  function applyPreset(preset) {
    const normalized = normalizePreset(preset);
    if (!normalized) return;
    state.activePresetId = normalized.id;
    initAudioContext();
    renderPresets();
    if (activeTweenRaf) { cancelAnimationFrame(activeTweenRaf); activeTweenRaf = null; }
    if (localStorage.getItem('riff_smooth_presets') === 'false') {
      state.audioSettings = { ...normalized.settings };
      syncSettingsSlidersToState();
      applyAudioSettings();
      return;
    }
    const fromAudio = JSON.parse(JSON.stringify(state.audioSettings));
    const toAudio = JSON.parse(JSON.stringify(normalized.settings));
    tweenSettings(fromAudio, toAudio, 400, (cur) => {
      state.audioSettings = { ...state.audioSettings, ...cur };
      syncSettingsSlidersToState();
      applyAudioSettings();
    });
  }

  function saveCustomPreset(name) {
    if (!name || !name.trim()) return;
    const newPreset = {
      id: 'custom_' + Date.now(),
                          name: name.trim(),
                          settings: { ...state.audioSettings }
    };
    state.customPresets.push(newPreset);
    state.activePresetId = newPreset.id;
    localStorage.setItem('devsize_custom_presets', JSON.stringify(state.customPresets));
    renderPresets();
  }

  function openRenamePresetModal(preset) {
    state.presetToRenameId = preset.id;
    if (el.renamePresetName) el.renamePresetName.value = preset.name;
    if (el.renamePresetModal) openModal(el.renamePresetModal);
    if (el.renamePresetName) el.renamePresetName.focus();
  }

  function renameCustomPreset(id, newName) {
    if (!newName || !newName.trim()) return;
    const p = state.customPresets.find(x => x.id === id);
    if (p) {
      p.name = newName.trim();
      localStorage.setItem('devsize_custom_presets', JSON.stringify(state.customPresets));
      renderPresets();
    }
  }

  function deleteCustomPreset(id) {
    state.customPresets = state.customPresets.filter(p => p.id !== id);
    if (state.activePresetId === id) state.activePresetId = 'p_default';
    localStorage.setItem('devsize_custom_presets', JSON.stringify(state.customPresets));
    renderPresets();
  }

  function openDeletePresetConfirm(preset) {
    state.presetToDeleteId = preset.id;
    const msg = document.getElementById('delete-preset-msg');
    if (msg) msg.textContent = `Delete preset "${preset.name}"?`;
    const modal = document.getElementById('delete-preset-modal');
    if (modal) openModal(modal);
  }

  let searchRequestId = 0;
  let searchAbortController = null;
  async function performSearch(query) {
    if (!query || !query.trim()) return;

    searchAbortController?.abort();
    searchAbortController=new AbortController();
    const requestId = ++searchRequestId;
    state.searchResults = [];
    state.searchQuery = query.trim();
    const platform = state.platform;
    switchView('discover');

    if (el.discoverEmpty) el.discoverEmpty.classList.add('hidden');
    if (el.searchResultsContainer) el.searchResultsContainer.classList.remove('hidden');
    if (el.resultsTitle) el.resultsTitle.textContent = `Results for "${state.searchQuery}"`;
    if (el.resultsPlatformBadge) el.resultsPlatformBadge.textContent = state.platform;
    if (el.resultsCount) el.resultsCount.textContent = 'Searching...';

    if (el.searchTracksList) {
      el.searchTracksList.innerHTML = `<div class="m3-loader-container" style="display: flex; justify-content: center; align-items: center; padding: 64px 0; width: 100%;">
        <svg class="g-spinner" viewBox="0 0 48 48"><circle cx="24" cy="24" r="20"/></svg>
      </div>`;
    }

    try {
      if (!navigator.onLine) {
        if (el.searchTracksList) el.searchTracksList.innerHTML = `<div class="empty-hint">Offline: connect to the internet to search new tracks</div>`;
        if (el.resultsCount) el.resultsCount.textContent = 'offline';
        return;
      }
      const searchUrl = `http://127.0.0.1:${state.serverPort}/api/search?q=${encodeURIComponent(state.searchQuery)}&platform=${platform}&limit=20&progressive=1`;
      const res = await fetch(searchUrl,{signal:searchAbortController.signal});
      const publish=data=>{
        if(requestId!==searchRequestId)return;
        if(!Array.isArray(data.tracks))throw new Error(data.error||'Failed to load search results');
        if(!data.tracks.length && !data.complete)return;
        if(!data.success && data.complete!==false)throw new Error(data.error||'No sources are available. Try again.');
        state.searchResults=data.tracks;
        // Resolve only the first two likely choices, without blocking results.
        for(const track of data.tracks.slice(0,2)) {
          if(track.platform==='spotify')window.electronAPI.spotify('playback','preload',{uri:track.uri||track.url}).catch(()=>{});
          else if(track.url && track.platform!=='local')fetch(`http://127.0.0.1:${state.serverPort}/api/prefetch?url=${encodeURIComponent(track.url)}&id=${encodeURIComponent(track.id)}&platform=${track.platform}`).catch(()=>{});
        }
        if(el.resultsCount)el.resultsCount.textContent=`${data.tracks.length} tracks${data.complete===false?' · checking more sources':' found'}`;
        requestAnimationFrame(()=>{if(requestId===searchRequestId && el.searchTracksList)renderTracks(el.searchTracksList,data.tracks,'search');});
      };
      if(res.headers?.get('content-type')?.includes('application/x-ndjson') && res.body?.getReader) {
        const reader=res.body.getReader(),decoder=new TextDecoder();let pending='';
        while(true) {
          const {value,done}=await reader.read();pending+=decoder.decode(value||new Uint8Array(),{stream:!done});
          const lines=pending.split('\n');pending=lines.pop();
          for(const line of lines)if(line.trim())publish(JSON.parse(line));
          if(done){if(pending.trim())publish(JSON.parse(pending));break;}
        }
      } else publish(await res.json());
    } catch (err) {
      if (requestId !== searchRequestId) return;
      console.error('Search error:', err);
      const isOff = !navigator.onLine;
      if (el.searchTracksList) el.searchTracksList.innerHTML = `<div class="empty-hint">${escapeHTML(isOff ? 'Offline: connect to the internet to search new tracks' : 'Error fetching results: ' + err.message)}</div>`;
      if (el.resultsCount) el.resultsCount.textContent = isOff ? 'offline' : 'error';
    }
  }


  function createTrackRow(track, idx, currentCanonicalId, context, tracks, container) {
      const row = document.createElement('div');
      row.className = 'track-row';
      row.tabIndex = 0;
      const canonicalId = getTrackCanonicalId(track);
      row.dataset.canonicalId = canonicalId;
      row.dataset.trackIndex = String(idx);
      row.dataset.trackId = track.id || '';
      row.dataset.trackTitle = track.title || '';
      row.dataset.trackArtist = track.artist || '';

      row.addEventListener('keydown', (e) => {
        if (e.target !== row) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          row.click();
        }
      });

      const isMatch = currentCanonicalId && canonicalId === currentCanonicalId;
      if (isMatch) {
        if (state.currentTrackContext === context && state.currentTrackIndexInContext >= 0) {
          if (state.currentTrackIndexInContext === idx) {
            row.classList.add('playing');
          }
        } else {
          row.classList.add('playing');
        }
      }

      const isFav = state.favorites.some(f => isSameTrack(f, track));
      const rowThumb = getTrackThumbUrl(track);

      row.innerHTML = `
      <span class="track-row-index">${idx + 1}</span>
      <img class="track-row-thumb" src="${escapeHTML(safeMediaURL(rowThumb || ''))}" alt="" onerror="this.style.visibility='hidden'">
      <div class="track-row-info">
      <span class="track-row-title">${escapeHTML((track.title || 'untitled'))}</span>
      <span class="track-row-artist" title="view artist profile">${escapeHTML((track.artist || 'unknown artist'))}</span>
      </div>
      <span class="track-row-duration">${formatDuration(track.duration)}</span>
      <div class="track-row-actions">
      <button class="btn-icon-pill btn-row-fav" title="favorite">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path></svg>
      </button>
      <button class="btn-icon-pill btn-row-art" title="Customize cover & banner">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
      </button>
      <button class="btn-icon-pill btn-row-add-playlist" title="add to playlist">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
      </button>
      ${track.platform === 'local' ? `
      <button class="btn-icon-pill btn-row-remove-local delete-btn" title="Remove from library">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
      </button>` : `
      <button class="btn-icon-pill btn-row-more" title="download & options">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="2"></circle><circle cx="19" cy="12" r="2"></circle><circle cx="5" cy="12" r="2"></circle></svg>
      </button>`}
      ${context === 'playlist' ? `
        <button class="btn-icon-pill btn-row-remove-playlist delete-btn" title="remove from playlist">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>` : ''}
        </div>
        `;

        row.addEventListener('mouseenter', () => {
          if(track.platform==='spotify'){window.electronAPI.spotify('playback','preload',{uri:track.uri||track.url}).catch(()=>{});}
          else if (track.url && track.platform !== 'local') {
            fetch(`http://127.0.0.1:${state.serverPort}/api/prefetch?url=${encodeURIComponent(track.url)}&id=${encodeURIComponent(track.id)}&platform=${track.platform || state.platform}`).catch(() => {});
          }
        });

        row.addEventListener('click', (e) => {
          if (e.target.closest('.track-row-actions')) return;
          if (e.target.classList.contains('track-row-artist')) {
            e.stopPropagation();
            openArtistProfile(track.artist);
            return;
          }
          let clickIndex = idx;
          let currentList = tracks;
          if (context === 'favorites') {
            currentList = state.favorites;
            clickIndex = state.favorites.findIndex(t => isSameTrack(t, track));
          } else if (context === 'playlist') {
            const pl = state.playlists.find(p => p.id === state.currentPlaylistId);
            if (pl && pl.tracks) {
              currentList = pl.tracks;
              clickIndex = pl.tracks.findIndex(t => isSameTrack(t, track));
            }
          }
          playTrack(track, currentList, clickIndex >= 0 ? clickIndex : idx, context);
        });

        const btnFav = row.querySelector('.btn-row-fav');
        if (btnFav) {
          btnFav.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFavoriteTrack(track);
            const isFavNow = state.favorites.some(f => isSameTrack(f, track));
            const svg = btnFav.querySelector('svg');
            if (svg) svg.setAttribute('fill', isFavNow ? 'currentColor' : 'none');
          });
        }

        const btnArt = row.querySelector('.btn-row-art');
        if (btnArt) {
          btnArt.addEventListener('click', (e) => {
            e.stopPropagation();
            openTrackArtModal(track, btnArt);
          });
        }

        const btnMore = row.querySelector('.btn-row-more');
        if (btnMore) {
          btnMore.addEventListener('click', (e) => {
            e.stopPropagation();
            openDownloadModal(track);
          });
        }

        const btnAddPl = row.querySelector('.btn-row-add-playlist');
        if (btnAddPl) {
          btnAddPl.addEventListener('click', (e) => {
            e.stopPropagation();
            openAddToPlaylistModal(track);
          });
        }

        const btnRemPl = row.querySelector('.btn-row-remove-playlist');
        if (btnRemPl) {
          btnRemPl.addEventListener('click', (e) => {
            e.stopPropagation();
            removeTrackFromCurrentPlaylist(track);
          });
        }

        const btnRemLocal = row.querySelector('.btn-row-remove-local');
        if (btnRemLocal) {
          btnRemLocal.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
              await fetch(`http://127.0.0.1:${state.serverPort}/api/library-remove`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: track.id })
              });
              if (Array.isArray(state.localTracks)) {
                state.localTracks = state.localTracks.filter(t => t.id !== track.id);
              }
              if (Array.isArray(tracks)) {
                const tIdx = tracks.findIndex(t => isSameTrack(t, track));
                if (tIdx !== -1) tracks.splice(tIdx, 1);
              }
              updateLocalBadge();
              row.remove();
              if (state.currentView === 'local') {
                if (!state.localTracks || state.localTracks.length === 0) {
                  renderLocalView();
                } else if (el.localSubtitle) {
                  const query = el.localSearchInput ? el.localSearchInput.value.trim().toLowerCase() : '';
                  el.localSubtitle.textContent = query
                    ? `${tracks.length} of ${state.localTracks.length} tracks`
                    : `${state.localTracks.length} tracks in library`;
                }
              }
              showToast('Removed from library');
            } catch (err) {
              console.warn('Remove local track error:', err);
            }
          });
        }
        
      return row;
  }

  function renderTracks(container, tracks, context = 'search') {
    if (!container) return;
    
    const scrollParent = document.querySelector('.main-content');
    if (container._vScrollHandler && scrollParent) {
      scrollParent.removeEventListener('scroll', container._vScrollHandler);
    }
    
    container.innerHTML = '';
    
    if (!tracks || tracks.length === 0) {
      container.style.paddingTop = '0px';
      container.style.paddingBottom = '0px';
      container.innerHTML = '<div class="empty-hint">no tracks found.</div>';
      return;
    }

    const itemHeight = 68;
    const overscan = 15;
    
    function renderChunk() {
      if (!scrollParent || container._isDraggingReorder) return;
      const parentRect = scrollParent.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const relativeTop = containerRect.top - parentRect.top + scrollParent.scrollTop;
      
      const visibleTop = Math.max(0, scrollParent.scrollTop - relativeTop);
      let startIndex = Math.floor(visibleTop / itemHeight) - overscan;
      let endIndex = Math.ceil((visibleTop + scrollParent.clientHeight) / itemHeight) + overscan;
      
      startIndex = Math.floor(startIndex / 5) * 5;
      endIndex = Math.ceil(endIndex / 5) * 5;
      
      startIndex = Math.max(0, startIndex);
      endIndex = Math.min(tracks.length, endIndex);
      
      if (container._lastStartIndex === startIndex && container._lastEndIndex === endIndex) return;
      container._lastStartIndex = startIndex;
      container._lastEndIndex = endIndex;
      
      const currentCanonicalId = state.currentTrack ? getTrackCanonicalId(state.currentTrack) : '';
      const fragment = document.createDocumentFragment();
      for (let idx = startIndex; idx < endIndex; idx++) {
         const track = tracks[idx];
         const row = createTrackRow(track, idx, currentCanonicalId, context, tracks, container);
         if (container._hasInitialRendered) row.style.animation = 'none';
         fragment.appendChild(row);
      }
      
      container.innerHTML = '';
      container.style.paddingTop = `${startIndex * itemHeight}px`;
      container.style.paddingBottom = `${(tracks.length - endIndex) * itemHeight}px`;
      container.appendChild(fragment);
      container._hasInitialRendered = true;
      highlightPlayingRow();
    }
    
    container._vScrollHandler = () => {
      if (!container._ticking) {
        window.requestAnimationFrame(() => {
          renderChunk();
          container._ticking = false;
        });
        container._ticking = true;
      }
    };
    
    if (scrollParent) {
       scrollParent.addEventListener('scroll', container._vScrollHandler, { passive: true });
    }
    
    container._hasInitialRendered = false;
    container._lastStartIndex = -1;
    container._lastEndIndex = -1;
    renderChunk();
  }

  function highlightPlayingRow() {
    const currentCanonicalId = state.currentTrack ? getTrackCanonicalId(state.currentTrack) : '';
    const rows = document.querySelectorAll('.track-row');

    if (!currentCanonicalId) {
      rows.forEach(r => r.classList.remove('playing'));
      return;
    }

    const containers = new Set();
    rows.forEach(r => {
      r.classList.remove('playing');
      if (r.parentElement) containers.add(r.parentElement);
    });

    containers.forEach(container => {
      const matches = Array.from(container.querySelectorAll('.track-row')).filter(r => r.dataset.canonicalId === currentCanonicalId);
      if (matches.length === 1) {
        matches[0].classList.add('playing');
      } else if (matches.length > 1) {
        const targetIdx = String(state.currentTrackIndexInContext);
        const exact = matches.find(r => r.dataset.trackIndex === targetIdx);
        if (exact) {
          exact.classList.add('playing');
        } else {
          matches[0].classList.add('playing');
        }
      }
    });
  }

  async function openArtistProfile(artistName) {
    if (!artistName || !artistName.trim()) return;
    const cleanName = artistName.replace(/ - Topic|VEVO|Official|Records/gi, '').trim().toLowerCase();

    state.previousView = state.currentView;
    switchView('artist');

    if (el.artistProfileName) el.artistProfileName.textContent = cleanName;
    if (el.artistProfileBio) el.artistProfileBio.textContent = 'Fetching artist discography and biography...';
    if (el.artistTracksCount) el.artistTracksCount.textContent = 'Searching...';
    if (el.artistAvatarImg) el.artistAvatarImg.style.display = 'none';
    const wrap = document.getElementById('artist-avatar-wrap');
    if (wrap) wrap.classList.add('loading');
    if (el.artistAvatarFallback) el.artistAvatarFallback.style.display = 'flex';
    if (el.artistVerifiedBadge) el.artistVerifiedBadge.classList.add('hidden');
    if (el.artistTracksList) el.artistTracksList.innerHTML = '<div class="empty-hint">fetching official releases...</div>';

    try {
      const res = await fetch(`http://127.0.0.1:${state.serverPort}/api/artist?name=${encodeURIComponent(cleanName)}`);
      const data = await res.json();

      if (!data.success || !data.artist) throw new Error('Artist not found');

      state.currentArtistData = data.artist;
      if (el.artistProfileName) el.artistProfileName.textContent = data.artist.name;
      if (el.artistProfileBio) el.artistProfileBio.textContent = data.artist.bio;

      if (el.artistVerifiedBadge) el.artistVerifiedBadge.classList.toggle('hidden', !data.artist.isVerified);

      if (data.artist.avatar) {
        if (el.artistAvatarImg) {
          el.artistAvatarImg.src = data.artist.avatar;
          el.artistAvatarImg.style.display = 'block';
        }
        if (el.artistAvatarFallback) el.artistAvatarFallback.style.display = 'none';
        if (el.artistHeroBackdrop) {
          el.artistHeroBackdrop.style.backgroundImage = `url("${data.artist.avatar}")`;
        }
      }

      if (el.artistTracksCount) el.artistTracksCount.textContent = `${data.artist.tracks.length} tracks`;

      requestAnimationFrame(() => {
        if (el.artistTracksList) renderTracks(el.artistTracksList, data.artist.tracks, 'artist');
      });
    } catch (e) {
      console.warn('Artist load error:', e);
      if (el.artistProfileBio) el.artistProfileBio.textContent = 'Could not load artist profile information.';
      if (el.artistTracksList) el.artistTracksList.innerHTML = '<div class="empty-hint">no tracks found for this artist.</div>';
    }
  }

  if (el.btnPlayArtistTracks) {
    el.btnPlayArtistTracks.addEventListener('click', () => {
      if (state.currentArtistData && state.currentArtistData.tracks.length > 0) {
        playTrack(state.currentArtistData.tracks[0], state.currentArtistData.tracks);
      }
    });
  }

  if (el.btnBackArtist) {
    el.btnBackArtist.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const target = (state.previousView && state.previousView !== 'artist') ? state.previousView : 'discover';
      switchView(target);
    };
  }

  if (el.playbarArtist) {
    el.playbarArtist.addEventListener('click', () => openNowPlaying());
  }

  if (el.rightPanelArtist) {
    el.rightPanelArtist.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.currentTrack && state.currentTrack.artist) {
        openArtistProfile(state.currentTrack.artist);
      }
    });
  }

  function toggleFavoriteTrack(track) {
    if (!track) return;
    const exists = state.favorites.some(f => isSameTrack(f, track));
    state.favorites = exists ? state.favorites.filter(f => !isSameTrack(f, track)) : [track, ...state.favorites];
    localStorage.setItem('devsize_favorites', JSON.stringify(state.favorites));
    updateFavoritesBadge(); updateFavoriteIcon(); renderShelf();
    if (state.currentView === 'favorites') renderFavoritesView();
    // Cuda favourites are local. Catalog/library sign-in is independent of playback.
    if (track.platform === 'spotify' && window.spotifyLibrary?.connected) {
      const key = getTrackCanonicalId(track), uri = track.uri || track.url;
      const previous = favoriteSync.get(key) || Promise.resolve();
      const task = previous.catch(() => {}).then(() => window.electronAPI.spotify('like', uri, !exists));
      favoriteSync.set(key, task);
      task.catch(() => showToast('Favourite updated in Cuda. Spotify library sync is unavailable; reconnect the account in Settings.'))
        .finally(() => { if (favoriteSync.get(key) === task) favoriteSync.delete(key); });
    }
  }
  const favoriteSync = new Map();

  function renderShelf() {
    const favorites = document.getElementById('shelf-favorites'), playlists = document.getElementById('shelf-playlists');
    if (!favorites || !playlists) return;
    favorites.replaceChildren(); playlists.replaceChildren();
    const card = (title, description, activate) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'shelf-card';
      const cover = document.createElement('div'); cover.className = 'shelf-card-art';
      const name = document.createElement('strong'); name.textContent = title;
      const detail = document.createElement('span'); detail.textContent = description;
      button.append(cover, name, detail); button.addEventListener('click', activate); return {button, cover};
    };
    for (const [index, track] of state.favorites.entries()) {
      const {button, cover} = card(track.title, track.artist, () => playTrack(track, state.favorites, index, 'favorites'));
      renderPlaylistCover(cover, {tracks:[track]}, 100); favorites.append(button);
    }
    for (const playlist of state.playlists) {
      const {button, cover} = card(playlist.name, playlist.description || `${playlist.tracks.length} song${playlist.tracks.length === 1 ? '' : 's'}`, () => { if(el.playlistSearchInput)el.playlistSearchInput.value='';openPlaylistDetail(playlist.id); });
      renderPlaylistCover(cover, playlist, 100); playlists.append(button);
    }
    for (const [row, message] of [[favorites,'Heart a song to keep it here.'],[playlists,'Create a playlist for a mood, a moment, or a favourite mix.']]) {
      if (!row.children.length) { const empty=document.createElement('p');empty.className='shelf-empty';empty.textContent=message;row.append(empty); }
    }
  }

  function updateFavoriteIcon() {
    if (!el.favIcon) return;
    if (!state.currentTrack) {
      el.favIcon.setAttribute('fill', 'none');
      return;
    }
    const isFav = state.favorites.some(f => isSameTrack(f, state.currentTrack));
    el.favIcon.setAttribute('fill', isFav ? 'currentColor' : 'none');
  }

  function updateFavoritesBadge() {
    if (el.favoritesCount) el.favoritesCount.textContent = state.favorites.length;
  }

  function renderFavoritesView() {
    const query = el.favoritesSearchInput ? el.favoritesSearchInput.value.trim().toLowerCase() : '';
    let filtered = state.favorites;
    if (query) {
      filtered = state.favorites.filter(t =>
      (t.title && t.title.toLowerCase().includes(query)) ||
      (t.artist && t.artist.toLowerCase().includes(query))
      );
    }
    if (el.favoritesSubtitle) el.favoritesSubtitle.textContent = query ? `${filtered.length} of ${state.favorites.length} tracks` : `${state.favorites.length} tracks saved`;
    if (el.favoritesTracksList) renderTracks(el.favoritesTracksList, filtered, 'favorites');
  }

  if (el.favoritesSearchInput) {
    el.favoritesSearchInput.addEventListener('input', () => renderFavoritesView());
  }

  function renderHistoryView() {
    if (el.historyTracksList) renderTracks(el.historyTracksList, state.history, 'history');
  }

  function updateQueueBadge() {
    if (el.queueCount) el.queueCount.textContent = state.queue.length;
  }

  function renderQueueView() {
    if (el.queueTracksList) renderTracks(el.queueTracksList, state.queue, 'queue');
  }

  function updateLocalBadge() {
    if (el.localCount) el.localCount.textContent = (state.localTracks && state.localTracks.length) || 0;
  }

  async function renderLocalView(forceFetch = true) {
    if (forceFetch || !state.localTracks) {
      try {
        const res = await fetch(`http://127.0.0.1:${state.serverPort}/api/library`);
        state.localTracks = await res.json();
      } catch (e) {
        if (!Array.isArray(state.localTracks)) state.localTracks = [];
      }
    }
    updateLocalBadge();
    const query = el.localSearchInput ? el.localSearchInput.value.trim().toLowerCase() : '';
    let filtered = state.localTracks || [];
    if (query) {
      filtered = filtered.filter(t =>
        (t.title && t.title.toLowerCase().includes(query)) ||
        (t.artist && t.artist.toLowerCase().includes(query))
      );
    }
    if (el.localSubtitle) {
      el.localSubtitle.textContent = query
        ? `${filtered.length} of ${state.localTracks.length} tracks`
        : `${state.localTracks.length} tracks in library`;
    }
    if (el.localTracksList) {
      if (!state.localTracks || state.localTracks.length === 0) {
        el.localTracksList.style.paddingTop = '0px';
        el.localTracksList.style.paddingBottom = '0px';
        el.localTracksList.innerHTML = `
          <div class="empty-hint" style="display:flex;flex-direction:column;align-items:center;gap:12px;">
            <span>No local tracks in library yet.</span>
            <button class="btn-outline-pill" id="btn-add-local-files-empty">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              Add files
            </button>
          </div>`;
        const emptyBtn = el.localTracksList.querySelector('#btn-add-local-files-empty');
        if (emptyBtn) emptyBtn.addEventListener('click', importLocalFiles);
      } else {
        renderTracks(el.localTracksList, filtered, 'local');
      }
    }
  }

  if (el.localSearchInput) {
    el.localSearchInput.addEventListener('input', () => renderLocalView(false));
  }

  async function importLocalFiles() {
    if (!window.electronAPI || !window.electronAPI.importAudioFiles) return;
    try {
      const items = await window.electronAPI.importAudioFiles();
      if (!items || items.length === 0) return;

      await fetch(`http://127.0.0.1:${state.serverPort}/api/library-add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      });

      if (state.currentView === 'local') renderLocalView(true);

      let idx = 0;
      async function worker() {
        while (idx < items.length) {
          const item = items[idx++];
          if (!item || !item.id) continue;
          await new Promise(resolve => {
            const url = `http://127.0.0.1:${state.serverPort}/api/library-file?id=${encodeURIComponent(item.id)}`;
            const a = new Audio(url);
            a.preload = 'metadata';
            let done = false;
            const finish = () => {
              if (done) return;
              done = true;
              a.src = '';
              resolve();
            };
            a.onloadedmetadata = async () => {
              const dur = Math.round(a.duration || 0);
              if (dur > 0) {
                try {
                  await fetch(`http://127.0.0.1:${state.serverPort}/api/library-update`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: item.id, duration: dur })
                  });
                } catch (e) {}
              }
              finish();
            };
            a.onerror = () => finish();
            setTimeout(finish, 5000);
          });
        }
      }
      await Promise.all([worker(), worker()]);

      await renderLocalView(true);
      showToast(`Added ${items.length} tracks`);
    } catch (e) {
      console.warn('Import audio files error:', e);
    }
  }

  function getTrackThumbUrl(track) {
    if (!track) return '';
    const o = getTrackArt(track).cover;
    if (o) return o;
    if (track.localThumbnail) return track.localThumbnail;
    if (track.id && state.serverPort) {
      const cleanId = String(track.id).replace(/[^a-zA-Z0-9_-]/g, '_');
    }
    return track.thumbnail || '';
  }

  function renderPlaylistCover(container, playlist, size = 64) {
    if (!container) return;
    container.innerHTML = '';
    container.classList.remove('cover-single','cover-empty');
    container.classList.add('playlist-cover-art');

    const tracks = (playlist && playlist.tracks) ? playlist.tracks : [];
    let firstThumb = null;
    for (const t of tracks) {
      const src = getTrackThumbUrl(t);
      if (src) {
        firstThumb = src;
        break;
      }
    }

    if (firstThumb) {
      container.classList.add('cover-single');
      const img = document.createElement('img');
      img.className = 'cover-single-img';
      img.src = firstThumb;
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = () => {
        container.classList.remove('cover-single');
        container.classList.add('cover-empty');
        container.innerHTML = `<svg width="${Math.round(size * 0.45)}" height="${Math.round(size * 0.45)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`;
      };
      container.appendChild(img);
    } else {
      container.classList.add('cover-empty');
      container.innerHTML = `
        <svg width="${Math.round(size * 0.45)}" height="${Math.round(size * 0.45)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 18V5l12-2v13"></path>
          <circle cx="6" cy="18" r="3"></circle>
          <circle cx="18" cy="16" r="3"></circle>
        </svg>
      `;
    }
  }

  function renderPlaylistsList() {
    renderHomePlaylists();
    renderShelf();
    if (!el.playlistsList) return;
    el.playlistsList.innerHTML = '';
    state.playlists.forEach(pl => {
      const item = document.createElement('div');
      item.className = 'playlist-item';
      item.dataset.playlistId = pl.id;
      if (state.currentView === 'playlist-detail' && state.currentPlaylistId === pl.id) {
        item.classList.add('active');
      }

      const thumbEl = document.createElement('div');
      thumbEl.className = 'playlist-item-thumb';
      renderPlaylistCover(thumbEl, pl, 44);

      const infoEl = document.createElement('div');
      infoEl.className = 'playlist-item-info';
      const trackCount = (pl.tracks || []).length;
      infoEl.innerHTML = `
        <span class="playlist-item-name">${escapeHTML((pl.name || 'untitled'))}</span>
        <span class="playlist-item-count">${trackCount} track${trackCount === 1 ? '' : 's'}</span>
      `;

      item.appendChild(thumbEl);
      item.appendChild(infoEl);

      item.addEventListener('click', () => {
        openPlaylistDetail(pl.id);
      });
      el.playlistsList.appendChild(item);
    });
  }

  function initListReordering({ container, itemSelector, setOrder, canDragItem, isFilterActive }) {
    if (!container) return;

    let draggedItem = null;
    let startX = 0;
    let startY = 0;
    let activePointerId = null;
    let isDragging = false;
    let pressTimer = null;
    let autoScrollTimer = null;
    let suppressClick = false;
    let startIndex = -1;
    let targetIndex = -1;
    let itemMetrics = [];
    let items = [];
    let draggedHeight = 0;
    let draggedStartTop = 0;

    const scrollParent = container.closest('.main-content, .rail-drawer') || container;

    window.addEventListener('click', (e) => {
      if (suppressClick) {
        e.stopImmediatePropagation();
        e.preventDefault();
        suppressClick = false;
      }
    }, true);

    const startDrag = () => {
      if (!draggedItem || isDragging) return;
      isDragging = true;
      suppressClick = true;
      container._isDraggingReorder = true;
      try {
        if (activePointerId !== null && draggedItem.setPointerCapture) {
          draggedItem.setPointerCapture(activePointerId);
        }
      } catch (e) {}

      container.style.userSelect = 'none';
      draggedItem.classList.add('is-dragging');

      items = Array.from(container.querySelectorAll(itemSelector)).filter(el => !canDragItem || canDragItem(el));
      startIndex = items.indexOf(draggedItem);
      targetIndex = startIndex;
      draggedHeight = draggedItem.offsetHeight;
      draggedStartTop = draggedItem.offsetTop;

      itemMetrics = items.map((el, i) => ({
        el,
        index: i,
        top: el.offsetTop,
        height: el.offsetHeight
      }));
    };

    const onPointerDown = (e) => {
      if (e.button !== 0) return;
      if (isFilterActive && isFilterActive()) return;

      const item = e.target.closest(itemSelector);
      if (!item || item.parentElement !== container) return;
      if (canDragItem && !canDragItem(item)) return;

      if (e.target.closest('button, input, select, textarea, .btn-icon-pill, .track-fav, .track-download-btn, .btn-rename-p, .btn-delete-p')) return;

      draggedItem = item;
      startX = e.clientX;
      startY = e.clientY;
      activePointerId = e.pointerId;
      isDragging = false;

      pressTimer = setTimeout(() => {
        startDrag();
      }, 250);

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    };

    const onPointerMove = (e) => {
      if (!draggedItem) return;

      if (!isDragging) {
        const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
        if (dist > 7) {
          clearTimeout(pressTimer);
          startDrag();
        } else {
          return;
        }
      }

      const dy = e.clientY - startY;

      if (scrollParent) {
        const scRect = scrollParent.getBoundingClientRect();
        clearInterval(autoScrollTimer);
        if (e.clientY < scRect.top + 40) {
          autoScrollTimer = setInterval(() => { scrollParent.scrollTop -= 8; }, 16);
        } else if (e.clientY > scRect.bottom - 40) {
          autoScrollTimer = setInterval(() => { scrollParent.scrollTop += 8; }, 16);
        }
      }

      draggedItem.style.transform = `translate3d(0, ${dy}px, 0) scale(1.02)`;

      if (itemMetrics.length <= 1) return;

      const currentCenter = draggedStartTop + (draggedHeight / 2) + dy;
      let newTarget = 0;
      for (let i = 0; i < itemMetrics.length; i++) {
        const m = itemMetrics[i];
        const mid = m.top + (m.height / 2);
        if (currentCenter > mid) {
          newTarget = i;
        }
      }
      newTarget = Math.max(0, Math.min(newTarget, itemMetrics.length - 1));

      if (newTarget !== targetIndex) {
        targetIndex = newTarget;
        const shiftDistance = (itemMetrics.length > 1 && Math.abs(itemMetrics[1].top - itemMetrics[0].top) > 0)
          ? Math.abs(itemMetrics[1].top - itemMetrics[0].top)
          : draggedHeight;

        itemMetrics.forEach(metric => {
          if (metric.el === draggedItem) return;
          if (startIndex < targetIndex) {
            if (metric.index > startIndex && metric.index <= targetIndex) {
              metric.el.style.transform = `translate3d(0, -${shiftDistance}px, 0)`;
              metric.el.style.transition = 'transform 180ms cubic-bezier(0.2, 0, 0, 1)';
            } else {
              metric.el.style.transform = '';
              metric.el.style.transition = 'transform 180ms cubic-bezier(0.2, 0, 0, 1)';
            }
          } else if (startIndex > targetIndex) {
            if (metric.index >= targetIndex && metric.index < startIndex) {
              metric.el.style.transform = `translate3d(0, ${shiftDistance}px, 0)`;
              metric.el.style.transition = 'transform 180ms cubic-bezier(0.2, 0, 0, 1)';
            } else {
              metric.el.style.transform = '';
              metric.el.style.transition = 'transform 180ms cubic-bezier(0.2, 0, 0, 1)';
            }
          } else {
            metric.el.style.transform = '';
            metric.el.style.transition = 'transform 180ms cubic-bezier(0.2, 0, 0, 1)';
          }
        });
      }
    };

    const onPointerUp = () => {
      clearTimeout(pressTimer);
      clearInterval(autoScrollTimer);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);

      if (!draggedItem) return;

      const item = draggedItem;
      const currentActiveId = activePointerId;
      draggedItem = null;
      activePointerId = null;

      try {
        if (currentActiveId !== null && item.hasPointerCapture && item.hasPointerCapture(currentActiveId)) {
          item.releasePointerCapture(currentActiveId);
        }
      } catch (e) {}

      if (isDragging) {
        let targetSlotDy = 0;
        if (targetIndex >= 0 && targetIndex < itemMetrics.length && targetIndex !== startIndex) {
          targetSlotDy = itemMetrics[targetIndex].top - draggedStartTop;
        }

        item.style.transition = 'transform 160ms cubic-bezier(0.2, 0, 0, 1)';
        item.style.transform = `translate3d(0, ${targetSlotDy}px, 0) scale(1)`;

        setTimeout(() => {
          if (targetIndex !== startIndex && targetIndex >= 0 && targetIndex < items.length) {
            const targetItem = items[targetIndex];
            if (targetIndex > startIndex) {
              targetItem.after(item);
            } else {
              targetItem.before(item);
            }
          }

          item.classList.remove('is-dragging');
          item.style.transform = '';
          item.style.transition = '';
          item.style.willChange = '';

          items.forEach(el => {
            el.style.transform = '';
            el.style.transition = '';
          });

          container.style.userSelect = '';
          container.classList.add('no-enter-anim');

          container.querySelectorAll('.track-row').forEach((r, i) => {
            r.dataset.trackIndex = String(i);
            const num = r.querySelector('.track-row-index');
            if (num) num.textContent = String(i + 1);
          });

          if (startIndex !== -1 && targetIndex !== -1 && startIndex !== targetIndex) {
            setOrder(startIndex, targetIndex);
          }

          container._isDraggingReorder = false;
          setTimeout(() => { suppressClick = false; }, 80);
        }, 160);
      } else {
        suppressClick = false;
      }
    };

    container.addEventListener('pointerdown', onPointerDown);
  }

  initListReordering({
    container: el.playlistsList,
    itemSelector: '.playlist-item',
    setOrder: (fromIdx, toIdx) => {
      const [moved] = state.playlists.splice(fromIdx, 1);
      state.playlists.splice(toIdx, 0, moved);
      localStorage.setItem('devsize_playlists', JSON.stringify(state.playlists));
    }
  });

  initListReordering({
    container: el.presetsContainer,
    itemSelector: '.preset-chip',
    canDragItem: (chip) => chip.dataset.isCustom === 'true',
    setOrder: (fromIdx, toIdx) => {
      const [moved] = state.customPresets.splice(fromIdx, 1);
      state.customPresets.splice(toIdx, 0, moved);
      localStorage.setItem('devsize_custom_presets', JSON.stringify(state.customPresets));
    }
  });

  initListReordering({
    container: el.favoritesTracksList,
    itemSelector: '.track-row',
    isFilterActive: () => Boolean(el.favoritesSearchInput && el.favoritesSearchInput.value.trim()),
    setOrder: (fromIdx, toIdx) => {
      const [moved] = state.favorites.splice(fromIdx, 1);
      state.favorites.splice(toIdx, 0, moved);
      localStorage.setItem('devsize_favorites', JSON.stringify(state.favorites));
      if (el.favoritesSubtitle) {
        el.favoritesSubtitle.textContent = `${state.favorites.length} tracks saved`;
      }
    }
  });

  initListReordering({
    container: el.playlistTracksList,
    itemSelector: '.track-row',
    isFilterActive: () => Boolean(el.playlistSearchInput && el.playlistSearchInput.value.trim()),
    setOrder: (fromIdx, toIdx) => {
      const pl = state.playlists.find(p => p.id === state.currentPlaylistId);
      if (!pl || !pl.tracks) return;
      const [moved] = pl.tracks.splice(fromIdx, 1);
      pl.tracks.splice(toIdx, 0, moved);
      localStorage.setItem('devsize_playlists', JSON.stringify(state.playlists));
    }
  });

  function createPlaylist(name, initialTracks = [], description = '') {
    if (!name || !name.trim()) return;
    const newPl = { id: 'pl_' + crypto.randomUUID(), name: name.trim().slice(0,80), description: description.trim().slice(0,300), tracks: Array.isArray(initialTracks) ? initialTracks.filter((t,i,a)=>a.findIndex(x=>isSameTrack(x,t))===i) : [] };
    state.playlists.push(newPl);
    localStorage.setItem('devsize_playlists', JSON.stringify(state.playlists));
    renderPlaylistsList();
    openPlaylistDetail(newPl.id);
  }

  function openPlaylistDetail(playlistId) {
    const pl = state.playlists.find(p => p.id === playlistId);
    if (!pl) return;
    state.currentPlaylistId = playlistId;
    if (el.playlistDetailTitle) el.playlistDetailTitle.textContent = pl.name;
    document.getElementById('playlist-detail-description').textContent = typeof pl.description === 'string' ? pl.description : '';
    if(el.btnPlayPlaylist)el.btnPlayPlaylist.disabled=!pl.tracks.length;
    const query = el.playlistSearchInput ? el.playlistSearchInput.value.trim().toLowerCase() : '';
    let filtered = pl.tracks;
    if (query) {
      filtered = pl.tracks.filter(t =>
      (t.title && t.title.toLowerCase().includes(query)) ||
      (t.artist && t.artist.toLowerCase().includes(query))
      );
    }
    if (el.playlistDetailCount) el.playlistDetailCount.textContent = query ? `${filtered.length} of ${pl.tracks.length} tracks` : `${pl.tracks.length} tracks`;
    const detailCover = document.getElementById('playlist-detail-cover');
    if (detailCover) renderPlaylistCover(detailCover, pl, 140);
    const firstThumb = (pl.tracks && pl.tracks[0]) ? getTrackThumbUrl(pl.tracks[0]) : '';
    updatePlaylistDetailBanner(firstThumb);
    if (el.playlistTracksList) renderTracks(el.playlistTracksList, filtered, 'playlist');
    switchView('playlist-detail');
    renderPlaylistsList();
  }

  function removeTrackFromCurrentPlaylist(track) {
    const pl = state.playlists.find(p => p.id === state.currentPlaylistId);
    if (!pl) return;
    pl.tracks = pl.tracks.filter(t => !isSameTrack(t, track));
    localStorage.setItem('devsize_playlists', JSON.stringify(state.playlists));
    openPlaylistDetail(state.currentPlaylistId);
  }

  function deleteCurrentPlaylist() {
    if (!state.currentPlaylistId) return;
    state.playlists = state.playlists.filter(p => p.id !== state.currentPlaylistId);
    localStorage.setItem('devsize_playlists', JSON.stringify(state.playlists));
    state.currentPlaylistId = null;
    renderPlaylistsList();
    switchView('shelf');
  }

  let trackToAddToPlaylist = null;
  function openAddToPlaylistModal(track) {
    trackToAddToPlaylist = track;
    if (!el.playlistPickList) return;
    el.playlistPickList.innerHTML = '';
    if (state.playlists.length === 0) {
      el.playlistPickList.innerHTML = '<div class="empty-hint">no playlists yet. create one first.</div>';
    } else {
      state.playlists.forEach(pl => {
        const item = document.createElement('button'); item.type='button';
        item.className = 'playlist-pick-item';
        item.textContent = pl.name;
        item.addEventListener('click', () => {
          if (!pl.tracks.some(t => isSameTrack(t, track))) {
            pl.tracks.push(track);
            localStorage.setItem('devsize_playlists', JSON.stringify(state.playlists));
            renderPlaylistsList();
          }
          showToast('Song is in '+pl.name);
          if(state.currentView==='playlist-detail'&&state.currentPlaylistId===pl.id)openPlaylistDetail(pl.id);
          if (el.addToPlaylistModal) closeModal(el.addToPlaylistModal);
        });
          el.playlistPickList.appendChild(item);
      });
    }
    const create=document.createElement('button');create.type='button';create.className='btn-outline-pill';create.textContent='New playlist with this song';create.addEventListener('click',()=>{closeModal(el.addToPlaylistModal);openPlaylistForm(null,[track]);});el.playlistPickList.append(create);
    if (el.addToPlaylistModal) openModal(el.addToPlaylistModal);
  }

  function switchView(viewName) {
    state.currentView = viewName;
    document.getElementById('view-shelf').classList.toggle('active',viewName==='shelf');
    document.getElementById('nav-shelf').classList.toggle('active',['shelf','favorites','local','playlist-detail'].includes(viewName));
    if(viewName==='shelf')renderShelf();

      document.querySelectorAll('.no-enter-anim').forEach(c => c.classList.remove('no-enter-anim'));
      [el.viewDiscover, el.viewFavorites, el.viewLocal, el.viewHistory, el.viewQueue, el.viewPlaylistDetail, el.viewArtist, el.viewSettings].forEach(v => {
        if (v) v.classList.remove('active');
      });

        [el.navDiscover, el.navFavorites, el.navLocal, el.navHistory, el.navQueue, el.navSettings].forEach(n => {
          if (n) n.classList.remove('active');
        });

          if (viewName === 'discover') {
            if (el.viewDiscover) el.viewDiscover.classList.add('active');
            if (el.navDiscover) el.navDiscover.classList.add('active');
          } else if (viewName === 'favorites') {
            if (el.viewFavorites) el.viewFavorites.classList.add('active');
            if (el.navFavorites) el.navFavorites.classList.add('active');
            renderFavoritesView();
          } else if (viewName === 'local') {
            if (el.viewLocal) el.viewLocal.classList.add('active');
            if (el.navLocal) el.navLocal.classList.add('active');
            renderLocalView();
          } else if (viewName === 'history') {
            if (el.viewHistory) el.viewHistory.classList.add('active');
            if (el.navHistory) el.navHistory.classList.add('active');
            renderHistoryView();
          } else if (viewName === 'queue') {
            if (el.viewQueue) el.viewQueue.classList.add('active');
            if (el.navQueue) el.navQueue.classList.add('active');
            renderQueueView();
          } else if (viewName === 'playlist-detail') {
            if (el.viewPlaylistDetail) el.viewPlaylistDetail.classList.add('active');
          } else if (viewName === 'artist') {
            if (el.viewArtist) el.viewArtist.classList.add('active');
          } else if (viewName === 'settings') {
            if (el.viewSettings) el.viewSettings.classList.add('active');
            if (el.navSettings) el.navSettings.classList.add('active');
            showSettingsCategory(localStorage.getItem('riff_settings_cat') || 'appearance');
            updateOfflineStorageUI();
            checkToolsStatus(false);
          }

          updateNavIndicator();

          highlightPlayingRow();
  }

  function updateNavIndicator() {
    if (!el.navActiveIndicator) return;
    const activeNav = document.querySelector('.nav-item.active');
    const navBox = activeNav && activeNav.closest('.sidebar-nav');
    if (navBox) {
      const navRect = navBox.getBoundingClientRect();
      const targetRect = activeNav.getBoundingClientRect();
      const targetY = targetRect.top - navRect.top;

      const currentTransform = el.navActiveIndicator.style.transform;
      const currentY = currentTransform ? parseFloat(currentTransform.match(/translateY\((.*?)px\)/)?.[1] || 0) : 0;
      const distance = Math.abs(targetY - currentY);

      if (distance > 0) {
        el.navActiveIndicator.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), height 0.15s ease-in';
        el.navActiveIndicator.style.height = `${48 + distance * 0.4}px`;

        if (targetY < currentY) {
          el.navActiveIndicator.style.transform = `translateY(${targetY}px)`;
        }

        setTimeout(() => {
          el.navActiveIndicator.style.transition = 'transform 0.3s cubic-bezier(0.2, 0, 0, 1), height 0.3s cubic-bezier(0.2, 0, 0, 1)';
          el.navActiveIndicator.style.height = `48px`;
          el.navActiveIndicator.style.transform = `translateY(${targetY}px)`;
        }, 150);
      } else {
        el.navActiveIndicator.style.transform = `translateY(${targetY}px)`;
      }
    }
  }

  function updatePlayPauseButton(isPlaying, isBuffering = false) {
    const tvPlayIcon = document.getElementById('tv-play-icon');
    const tvPauseIcon = document.getElementById('tv-pause-icon');
    if (tvPlayIcon && tvPauseIcon) {
      if (isPlaying && !isBuffering) {
        tvPlayIcon.classList.add('hidden');
        tvPauseIcon.classList.remove('hidden');
      } else {
        tvPlayIcon.classList.remove('hidden');
        tvPauseIcon.classList.add('hidden');
      }
    }
    if (isBuffering) {
      if (el.playIcon) el.playIcon.classList.add('hidden');
      if (el.pauseIcon) el.pauseIcon.classList.add('hidden');
      if (el.playbarSpinner) el.playbarSpinner.classList.remove('hidden');
      if (el.btnPlayPause) el.btnPlayPause.classList.add('playing');
    } else {
      if (el.playbarSpinner) el.playbarSpinner.classList.add('hidden');
      if (isPlaying) {
        if (el.playIcon) el.playIcon.classList.add('hidden');
        if (el.pauseIcon) el.pauseIcon.classList.remove('hidden');
        if (el.btnPlayPause) el.btnPlayPause.classList.add('playing');
      } else {
        if (el.playIcon) el.playIcon.classList.remove('hidden');
        if (el.pauseIcon) el.pauseIcon.classList.add('hidden');
        if (el.btnPlayPause) el.btnPlayPause.classList.remove('playing');
      }
    }
  }

  function formatDuration(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  if (el.btnResetVfx) {
    el.btnResetVfx.addEventListener('click', () => {
      state.vfx = { ...defaultVfx };
      localStorage.setItem('devsize_vfx', JSON.stringify(state.vfx));
      applyVisualEffects();
    });
  }

  if (window.electronAPI) {
    if (el.btnMinimize) el.btnMinimize.addEventListener('click', () => window.electronAPI.minimizeWindow());
    if (el.btnMaximize) el.btnMaximize.addEventListener('click', () => window.electronAPI.maximizeWindow());
    if (el.btnClose) el.btnClose.addEventListener('click', () => window.electronAPI.closeWindow());
  }

  if (el.navDiscover) el.navDiscover.addEventListener('click', goHome);
  document.getElementById('nav-shelf').addEventListener('click',()=>switchView('shelf'));
  document.getElementById('shelf-add-files').addEventListener('click',()=>el.btnAddLocalFiles?.click());
  if (el.navFavorites) el.navFavorites.addEventListener('click', () => switchView('favorites'));
  if (el.navLocal) el.navLocal.addEventListener('click', () => switchView('local'));
  if (el.navHistory) el.navHistory.addEventListener('click', () => switchView('history'));
  if (el.navQueue) el.navQueue.addEventListener('click', () => switchView('queue'));
  if (el.navSettings) el.navSettings.addEventListener('click', () => switchView('settings'));

  if (window.electronAPI?.onAppCommand) {
    window.electronAPI.onAppCommand((command) => {
      if (command === 'settings') switchView('settings');
      else if (command === 'import-audio') {
        switchView('local');
        importLocalFiles();
      } else if (command === 'shortcuts') openModal(document.getElementById('shortcuts-modal'));
    });
  }

  if (el.btnAddLocalFiles) el.btnAddLocalFiles.addEventListener('click', () => importLocalFiles());
  if (el.btnAddLocalFilesEmpty) el.btnAddLocalFilesEmpty.addEventListener('click', () => importLocalFiles());

  if (el.btnAutoRemix) {
    el.btnAutoRemix.addEventListener('click', () => {
      state.isAutoRemix = !state.isAutoRemix;
      el.btnAutoRemix.classList.toggle('active', state.isAutoRemix);
    });
  }

  if (el.btnSavePresetDialog) {
    el.btnSavePresetDialog.addEventListener('click', () => {
      if (el.newPresetName) el.newPresetName.value = '';
      if (el.savePresetModal) openModal(el.savePresetModal);
      if (el.newPresetName) el.newPresetName.focus();
    });
  }

  if (el.btnCancelPreset) {
    el.btnCancelPreset.addEventListener('click', () => {
      if (el.savePresetModal) closeModal(el.savePresetModal);
    });
  }

  if (el.btnConfirmSavePreset) {
    el.btnConfirmSavePreset.addEventListener('click', () => {
      const name = el.newPresetName ? el.newPresetName.value : '';
      if (name.trim()) {
        saveCustomPreset(name);
        if (el.savePresetModal) closeModal(el.savePresetModal);
      }
    });
  }

  if (el.newPresetName) {
    el.newPresetName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && el.btnConfirmSavePreset) el.btnConfirmSavePreset.click();
      if (e.key === 'Escape' && el.btnCancelPreset) el.btnCancelPreset.click();
    });
  }

  if (el.btnCancelRenamePreset) {
    el.btnCancelRenamePreset.addEventListener('click', () => {
      if (el.renamePresetModal) closeModal(el.renamePresetModal);
    });
  }

  if (el.btnConfirmRenamePreset) {
    el.btnConfirmRenamePreset.addEventListener('click', () => {
      const name = el.renamePresetName ? el.renamePresetName.value : '';
      if (name.trim() && state.presetToRenameId) {
        renameCustomPreset(state.presetToRenameId, name);
        if (el.renamePresetModal) closeModal(el.renamePresetModal);
      }
    });
  }

  if (el.renamePresetName) {
    el.renamePresetName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && el.btnConfirmRenamePreset) el.btnConfirmRenamePreset.click();
      if (e.key === 'Escape' && el.btnCancelRenamePreset) el.btnCancelRenamePreset.click();
    });
  }

  const deletePresetModal = document.getElementById('delete-preset-modal');
  const btnCancelDeletePreset = document.getElementById('btn-cancel-delete-preset');
  const btnConfirmDeletePreset = document.getElementById('btn-confirm-delete-preset');

  if (btnCancelDeletePreset) {
    btnCancelDeletePreset.addEventListener('click', () => {
      if (deletePresetModal) closeModal(deletePresetModal);
    });
  }

  if (btnConfirmDeletePreset) {
    btnConfirmDeletePreset.addEventListener('click', () => {
      if (state.presetToDeleteId) {
        deleteCustomPreset(state.presetToDeleteId);
        state.presetToDeleteId = null;
      }
      if (deletePresetModal) closeModal(deletePresetModal);
    });
  }

  if (el.btnToggleLyricsPanel) {
    el.btnToggleLyricsPanel.addEventListener('click', () => {
      state.isRightPanelOpen = !state.isRightPanelOpen;
      if (el.rightPanel) el.rightPanel.classList.toggle('hidden', !state.isRightPanelOpen);
      el.btnToggleLyricsPanel.classList.toggle('active', state.isRightPanelOpen);
      setTimeout(resizeCanvases, 150);
    });
  }

  if (el.btnCloseRightPanel) {
    el.btnCloseRightPanel.addEventListener('click', () => {
      state.isRightPanelOpen = false;
      if (el.rightPanel) el.rightPanel.classList.add('hidden');
      if (el.btnToggleLyricsPanel) el.btnToggleLyricsPanel.classList.remove('active');
      setTimeout(resizeCanvases, 150);
    });
  }

  if (el.searchInput) {
    el.searchInput.addEventListener('input', (e) => {
      const val = e.target.value;
      if (val && el.searchClearBtn) {
        el.searchClearBtn.classList.remove('hidden');
      } else if (el.searchClearBtn) {
        el.searchClearBtn.classList.add('hidden');
      }
    });

    el.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = el.searchInput.value.trim();
        if (val) performSearch(val);
      }
    });
  }

  if (el.searchIconBtn) {
    el.searchIconBtn.addEventListener('click', () => {
      const val = el.searchInput ? el.searchInput.value.trim() : '';
      if (val) performSearch(val);
    });
  }

  if (el.searchClearBtn) {
    el.searchClearBtn.addEventListener('click', () => {
      searchRequestId++;
      searchAbortController?.abort();
      state.searchQuery = '';
      state.searchResults = [];
      if (el.searchInput) el.searchInput.value = '';
      el.searchClearBtn.classList.add('hidden');
      if (el.discoverEmpty) el.discoverEmpty.classList.remove('hidden');
      if (el.searchResultsContainer) el.searchResultsContainer.classList.add('hidden');
    });
  }

  if (el.suggestionChips) {
    el.suggestionChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip-btn');
      if (!chip) return;
      if (chip.dataset.home) {
        el.searchClearBtn?.click();
        el.suggestionChips.querySelectorAll('.chip-btn').forEach(button => button.classList.toggle('active', button === chip));
        return;
      }
      el.suggestionChips.querySelectorAll('.chip-btn').forEach(button => button.classList.toggle('active', button === chip));
      const query = chip.dataset.query;
      if (el.searchInput) el.searchInput.value = query;
      if (el.searchClearBtn) el.searchClearBtn.classList.remove('hidden');
      performSearch(query);
    });
  }

  if (el.platformYt) {
    el.platformYt.addEventListener('click', () => {
      if (state.platform === 'youtube') return;
      state.platform = 'youtube';
      el.platformYt.classList.add('active');
      if (el.platformYtm) el.platformYtm.classList.remove('active');
      if (el.platformSc) el.platformSc.classList.remove('active');
      if (el.searchInput && el.searchInput.value.trim()) performSearch(el.searchInput.value);
    });
  }

  if (el.platformYtm) {
    el.platformYtm.addEventListener('click', () => {
      if (state.platform === 'ytmusic') return;
      state.platform = 'ytmusic';
      el.platformYtm.classList.add('active');
      if (el.platformYt) el.platformYt.classList.remove('active');
      if (el.platformSc) el.platformSc.classList.remove('active');
      if (el.searchInput && el.searchInput.value.trim()) performSearch(el.searchInput.value);
    });
  }

  if (el.platformSc) {
    el.platformSc.addEventListener('click', () => {
      if (state.platform === 'soundcloud') return;
      state.platform = 'soundcloud';
      el.platformSc.classList.add('active');
      if (el.platformYt) el.platformYt.classList.remove('active');
      if (el.platformYtm) el.platformYtm.classList.remove('active');
      if (el.searchInput && el.searchInput.value.trim()) performSearch(el.searchInput.value);
    });
  }

  if (el.btnPlayPause) el.btnPlayPause.addEventListener('click', togglePlayPause);
  if (el.btnNext) el.btnNext.addEventListener('click', playNext);
  if (el.btnPrev) el.btnPrev.addEventListener('click', playPrev);

  if (el.btnShuffle) {
    el.btnShuffle.classList.toggle('active', state.isShuffle);
    el.btnShuffle.addEventListener('click', () => {
      state.isShuffle = !state.isShuffle;
      localStorage.setItem('riff_shuffle', state.isShuffle ? '1' : '0');
      el.btnShuffle.classList.toggle('active', state.isShuffle);
    });
  }

  if (el.btnRepeat) {
    el.btnRepeat.classList.toggle('active', state.isRepeat);
    el.btnRepeat.addEventListener('click', () => {
      state.isRepeat = !state.isRepeat;
      localStorage.setItem('riff_repeat', state.isRepeat ? '1' : '0');
      el.btnRepeat.classList.toggle('active', state.isRepeat);
    });
  }

  window.toggleShuffle = () => el.btnShuffle && el.btnShuffle.click();
  window.toggleRepeat = () => el.btnRepeat && el.btnRepeat.click();

  if (el.volumeSlider) {
    el.volumeSlider.addEventListener('input', (e) => {
      state.volume = parseFloat(e.target.value);
      state.isMuted = false;
      if (el.volumeIcon) el.volumeIcon.classList.remove('hidden');
      if (el.volumeMutedIcon) el.volumeMutedIcon.classList.add('hidden');
      applyAudioSettings();
    });
  }

  if (el.btnVolumeMute) {
    el.btnVolumeMute.addEventListener('click', () => {
      state.isMuted = !state.isMuted;
      if (state.isMuted) {
        if (el.volumeIcon) el.volumeIcon.classList.add('hidden');
        if (el.volumeMutedIcon) el.volumeMutedIcon.classList.remove('hidden');
      } else {
        if (el.volumeIcon) el.volumeIcon.classList.remove('hidden');
        if (el.volumeMutedIcon) el.volumeMutedIcon.classList.add('hidden');
      }
      applyAudioSettings();
    });
  }

  if (el.btnToggleFav) {
    el.btnToggleFav.addEventListener('click', () => {
      if (state.currentTrack) toggleFavoriteTrack(state.currentTrack);
    });
  }

  if (el.btnClearHistory) {
    el.btnClearHistory.addEventListener('click', () => {
      state.history = [];
      localStorage.setItem('devsize_history', '[]');
      renderHistoryView();
    });
  }

  if (el.btnClearQueue) {
    el.btnClearQueue.addEventListener('click', () => {
      state.queue = [];
      state.queueIndex = -1;
      updateQueueBadge();
      renderQueueView();
    });
  }

  if (el.playlistSearchInput) {
    el.playlistSearchInput.addEventListener('input', () => {
      if (state.currentPlaylistId) openPlaylistDetail(state.currentPlaylistId);
    });
  }
  if (el.btnBackPlaylists) el.btnBackPlaylists.addEventListener('click', () => switchView('shelf'));

  const deletePlaylistModal = document.getElementById('delete-playlist-modal');
  const deletePlaylistMsg = document.getElementById('delete-playlist-msg');
  const btnCancelDeletePlaylist = document.getElementById('btn-cancel-delete-playlist');
  const btnConfirmDeletePlaylist = document.getElementById('btn-confirm-delete-playlist');

  if (el.btnDeletePlaylist) {
    el.btnDeletePlaylist.addEventListener('click', () => {
      const pl = state.playlists.find(p => p.id === state.currentPlaylistId);
      if (!pl) return;
      if (deletePlaylistMsg) deletePlaylistMsg.textContent = `Delete playlist "${pl.name}"? This action cannot be undone.`;
      if (deletePlaylistModal) openModal(deletePlaylistModal);
    });
  }

  if (btnCancelDeletePlaylist && deletePlaylistModal) {
    btnCancelDeletePlaylist.addEventListener('click', () => {
      closeModal(deletePlaylistModal);
    });
  }

  if (btnConfirmDeletePlaylist && deletePlaylistModal) {
    btnConfirmDeletePlaylist.addEventListener('click', () => {
      deleteCurrentPlaylist();
      closeModal(deletePlaylistModal);
      showToast('Playlist deleted');
    });
  }

  if (el.btnPlayPlaylist) {
    el.btnPlayPlaylist.addEventListener('click', () => {
      const pl = state.playlists.find(p => p.id === state.currentPlaylistId);
      if (pl && pl.tracks.length > 0) playTrack(pl.tracks[0], pl.tracks, 0, 'playlist');
    });
  }

  let editingPlaylistId = null, playlistInitialTracks = [];
  function openPlaylistForm(playlist = null, initialTracks = []) {
    editingPlaylistId = playlist?.id || null; playlistInitialTracks=initialTracks;
    document.getElementById('playlist-form-title').textContent=playlist?'Edit playlist':'Create playlist';
    el.btnConfirmNewPlaylist.textContent=playlist?'Save':'Create';
    el.newPlaylistInput.value=playlist?.name || '';
    document.getElementById('new-playlist-description').value=typeof playlist?.description==='string'?playlist.description:'';
    openModal(el.createPlaylistModal); el.newPlaylistInput.focus();
  }
  el.btnNewPlaylist?.addEventListener('click',()=>openPlaylistForm());
  document.getElementById('shelf-create-playlist').addEventListener('click',()=>openPlaylistForm());
  document.getElementById('btn-edit-playlist').addEventListener('click',()=>openPlaylistForm(state.playlists.find(p=>p.id===state.currentPlaylistId)));
  if (el.btnCancelNewPlaylist) {
    el.btnCancelNewPlaylist.addEventListener('click', () => {
      if (el.createPlaylistModal) closeModal(el.createPlaylistModal);
    });
  }

  if (el.btnConfirmNewPlaylist) {
    el.btnConfirmNewPlaylist.addEventListener('click', () => {
      const name = el.newPlaylistInput ? el.newPlaylistInput.value : '';
      if (name.trim()) {
        const description=document.getElementById('new-playlist-description').value;
        if(editingPlaylistId){const playlist=state.playlists.find(p=>p.id===editingPlaylistId);if(playlist){playlist.name=name.trim().slice(0,80);playlist.description=description.trim().slice(0,300);localStorage.setItem('devsize_playlists',JSON.stringify(state.playlists));renderPlaylistsList();openPlaylistDetail(playlist.id);}}else createPlaylist(name,playlistInitialTracks,description);
        if (el.createPlaylistModal) closeModal(el.createPlaylistModal);
      }
    });
  }

  if (el.newPlaylistInput) {
    el.newPlaylistInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && el.btnConfirmNewPlaylist) el.btnConfirmNewPlaylist.click();
      if (e.key === 'Escape' && el.btnCancelNewPlaylist) el.btnCancelNewPlaylist.click();
    });
  }

  if (el.btnCancelAddPlaylist) {
    el.btnCancelAddPlaylist.addEventListener('click', () => {
      if (el.addToPlaylistModal) closeModal(el.addToPlaylistModal);
    });
  }

  if (el.btnOpenSettings) {
    el.btnOpenSettings.addEventListener('click', () => {
      if (el.audioSettingsModal) openModal(el.audioSettingsModal);
    });
  }

  if (el.btnCloseSettings) {
    el.btnCloseSettings.addEventListener('click', () => {
      if (el.audioSettingsModal) closeModal(el.audioSettingsModal);
    });
  }

  if (el.audioSettingsModal) {
    el.audioSettingsModal.addEventListener('click', (e) => {
      if (e.target === el.audioSettingsModal) closeModal(el.audioSettingsModal);
    });
  }

  if (el.btnOpenVisualSettings) {
    el.btnOpenVisualSettings.addEventListener('click', () => {
      if (el.visualSettingsModal) openModal(el.visualSettingsModal);
    });
  }

  if (el.btnCloseVisualSettings) {
    el.btnCloseVisualSettings.addEventListener('click', () => {
      if (el.visualSettingsModal) closeModal(el.visualSettingsModal);
    });
  }

  if (el.visualSettingsModal) {
    el.visualSettingsModal.addEventListener('click', (e) => {
      if (e.target === el.visualSettingsModal) closeModal(el.visualSettingsModal);
    });
  }

  if (el.btnToggleHqAudio) {
    el.btnToggleHqAudio.addEventListener('click', () => {
      state.hqEnabled = !state.hqEnabled;
      el.btnToggleHqAudio.classList.toggle('active', state.hqEnabled);
      
      if (el.hqPanelWrapper) {
        el.hqPanelWrapper.classList.toggle('expanded', state.hqEnabled);
      }
      initAudioContext();
      updateHqRouting();
    });
  }

  if (el.hqPresetChips) {
    el.hqPresetChips.forEach(chip => {
      chip.addEventListener('click', () => {
        el.hqPresetChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.hqSettings.preset = chip.dataset.preset;

        let v = 0, a = 0, b = 0;
        if (state.hqSettings.preset === 'studio') { v = 0; a = 0; b = 0; }
        else if (state.hqSettings.preset === 'vinyl') { v = 15; a = -15; b = 25; }
        else if (state.hqSettings.preset === 'concert') { v = -10; a = 30; b = 15; }

        if (el.sliderHqVocal) { el.sliderHqVocal.value = v; el.valHqVocal.textContent = (v > 0 ? '+' : '') + v + '%'; state.hqSettings.vocal = v; }
        if (el.sliderHqAir) { el.sliderHqAir.value = a; el.valHqAir.textContent = (a > 0 ? '+' : '') + a + '%'; state.hqSettings.air = a; }
        if (el.sliderHqBass) { el.sliderHqBass.value = b; el.valHqBass.textContent = (b > 0 ? '+' : '') + b + '%'; state.hqSettings.bass = b; }

        applyHqSettings();
      });
    });
  }

  ['Vocal', 'Air', 'Bass'].forEach(type => {
    const slider = el[`sliderHq${type}`];
    const valDisplay = el[`valHq${type}`];
    if (slider) {
      slider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        if (valDisplay) valDisplay.textContent = (val > 0 ? '+' : '') + val + '%';
        state.hqSettings[type.toLowerCase()] = val;
        if (el.hqPresetChips) el.hqPresetChips.forEach(c => c.classList.remove('active'));
        applyHqSettings();
      });
    }
  });

  if (el.hqEngineSelect) {
    el.hqEngineSelect.addEventListener('change', (e) => {
      state.hqSettings.engine = e.target.value;
      applyHqSettings();
    });
  }

  const hqDropdown = document.getElementById('hq-engine-dropdown');
  const hqTrigger = document.getElementById('hq-engine-trigger');
  const hqLabel = document.getElementById('hq-engine-label');
  const hqMenu = document.getElementById('hq-engine-menu');

  if (hqTrigger && hqDropdown && hqMenu) {
    hqTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      hqDropdown.classList.toggle('open');
    });

    hqMenu.querySelectorAll('.m3-dropdown-option').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = opt.dataset.value;
        if (hqLabel) hqLabel.textContent = opt.textContent;
        hqMenu.querySelectorAll('.m3-dropdown-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        if (el.hqEngineSelect) {
          el.hqEngineSelect.value = val;
          el.hqEngineSelect.dispatchEvent(new Event('change'));
        }
        hqDropdown.classList.remove('open');
      });
    });

    document.addEventListener('click', () => {
      hqDropdown.classList.remove('open');
    });
  }

  if (el.sliderSpeed) {
    el.sliderSpeed.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      state.audioSettings.speed = val;
      state.audioSettings.speedPitch = 1.0;
      if (el.sliderSpeedPitch) el.sliderSpeedPitch.value = 1.0;
      if (el.valSpeedPitch) el.valSpeedPitch.textContent = '1.00x';
      if (el.valSpeed) el.valSpeed.textContent = `${val.toFixed(2)}x`;
      state.activePresetId = null;
      applyAudioSettings();
      renderPresets();
    });
  }

  if (el.sliderSpeedPitch) {
    el.sliderSpeedPitch.addEventListener('input', (e) => {
      initAudioContext();
      const val = parseFloat(e.target.value);
      state.audioSettings.speedPitch = val;
      state.audioSettings.speed = 1.0;
      if (el.sliderSpeed) el.sliderSpeed.value = 1.0;
      if (el.valSpeed) el.valSpeed.textContent = '1.00x';
      if (el.valSpeedPitch) el.valSpeedPitch.textContent = `${val.toFixed(2)}x`;
      state.activePresetId = null;
      applyAudioSettings();
      renderPresets();
    });
  }

  if (el.sliderPitch) {
    el.sliderPitch.addEventListener('input', (e) => {
      initAudioContext();
      const val = parseInt(e.target.value, 10);
      state.audioSettings.pitch = val;
      if (el.valPitch) el.valPitch.textContent = `${val > 0 ? '+' : ''}${val} st`;
      state.activePresetId = null;
      applyAudioSettings();
      renderPresets();
    });
  }

  if (el.sliderReverb) {
    el.sliderReverb.addEventListener('input', (e) => {
      initAudioContext();
      const val = parseInt(e.target.value, 10);
      state.audioSettings.reverb = val;
      if (el.valReverb) el.valReverb.textContent = `${val}%`;
      state.activePresetId = null;
      applyAudioSettings();
      renderPresets();
    });
  }

  if (el.sliderDistortion) {
    el.sliderDistortion.addEventListener('input', (e) => {
      initAudioContext();
      const val = parseInt(e.target.value, 10);
      state.audioSettings.distortion = val;
      if (el.valDistortion) el.valDistortion.textContent = `${val}%`;
      state.activePresetId = null;
      applyAudioSettings();
      renderPresets();
    });
  }

  if (el.sliderGain) {
    el.sliderGain.addEventListener('input', (e) => {
      initAudioContext();
      const val = parseInt(e.target.value, 10);
      state.audioSettings.volume = val / 100;
      if (el.valGain) el.valGain.textContent = `${val}%`;
      state.activePresetId = null;
      applyAudioSettings();
      renderPresets();
    });
  }

  if (el.sliderEcho) {
    el.sliderEcho.addEventListener('input', (e) => {
      initAudioContext();
      const val = parseInt(e.target.value, 10);
      state.audioSettings.echo = val;
      if (el.valEcho) el.valEcho.textContent = `${val}%`;
      state.activePresetId = null;
      applyAudioSettings();
      renderPresets();
    });
  }

  ['low', 'mid', 'high'].forEach(band => {
    const cap = band.charAt(0).toUpperCase() + band.slice(1);
    const slider = el[`sliderEq${cap}`];
    const valEl = el[`valEq${cap}`];
    if (slider) {
      slider.addEventListener('input', (e) => {
        initAudioContext();
        const val = parseInt(e.target.value, 10);
        if (!state.audioSettings.eq) state.audioSettings.eq = { low: 0, mid: 0, high: 0 };
        state.audioSettings.eq[band] = val;
        if (valEl) valEl.textContent = `${val > 0 ? '+' : ''}${val} dB`;
        state.activePresetId = null;
        applyAudioSettings();
        renderPresets();
      });
      slider.addEventListener('dblclick', () => {
        initAudioContext();
        slider.value = 0;
        if (!state.audioSettings.eq) state.audioSettings.eq = { low: 0, mid: 0, high: 0 };
        state.audioSettings.eq[band] = 0;
        if (valEl) valEl.textContent = '0 dB';
        state.activePresetId = null;
        applyAudioSettings();
        renderPresets();
      });
    }
  });

  if (el.themeModeBtns) {
    el.themeModeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        state.themeMode = btn.dataset.themeMode;
        localStorage.setItem('riff_theme_mode', state.themeMode);
        updateThemeFromState();
      });
    });
  }

  if (el.themeSwatches) {
    el.themeSwatches.forEach(sw => {
      sw.addEventListener('click', () => {
        state.themeAccent = sw.dataset.color;
        localStorage.setItem('riff_theme_accent', state.themeAccent);
        if (state.themeMode === 'auto') {
          const targetMode = currentEffectiveMode || 'dark';
          state.themeMode = targetMode;
          localStorage.setItem('riff_theme_mode', targetMode);
        }
        updateThemeFromState();
      });
    });
  }

  if (el.customColorInput) {
    el.customColorInput.addEventListener('input', (e) => {
      state.themeAccent = e.target.value;
      localStorage.setItem('riff_theme_accent', state.themeAccent);
      if (state.themeMode === 'auto') {
        const targetMode = currentEffectiveMode || 'dark';
        state.themeMode = targetMode;
        localStorage.setItem('riff_theme_mode', targetMode);
      }
      updateThemeFromState();
    });
  }

  if (el.sliderHue) {
    el.sliderHue.addEventListener('input', (e) => {
      const h = parseInt(e.target.value, 10);
      state.themeAccent = hslToHex(h, 55, 50);
      localStorage.setItem('riff_theme_accent', state.themeAccent);
      if (state.themeMode === 'auto') {
        const targetMode = currentEffectiveMode || 'dark';
        state.themeMode = targetMode;
        localStorage.setItem('riff_theme_mode', targetMode);
      }
      updateThemeFromState();
    });
  }

  if (el.sliderIntensity) {
    el.sliderIntensity.addEventListener('input', (e) => {
      if (state.themeMode === 'auto') return;
      const val = parseInt(e.target.value, 10);
      state.themeIntensity = val;
      document.body.classList.toggle('intensity-zero', state.themeIntensity < 8);
      if (el.valIntensity) el.valIntensity.textContent = val + '%';
      localStorage.setItem('riff_theme_intensity', val.toString());
      updateThemeFromState();
    });
  }
  if (el.sliderBrightness) {
    el.sliderBrightness.addEventListener('input', (e) => {
      if (state.themeMode === 'auto') return;
      const val = parseInt(e.target.value, 10);
      state.themeBrightness = val;
      if (el.valBrightness) el.valBrightness.textContent = val + '%';
      localStorage.setItem('riff_theme_brightness', val.toString());
      updateThemeFromState();
    });
  }

  if (el.sliderScale) {
    el.sliderScale.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      state.uiScale = val;
      if (el.valScale) el.valScale.textContent = `${val}%`;
    });
    el.sliderScale.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      state.uiScale = val;
      if (el.valScale) el.valScale.textContent = `${val}%`;
      localStorage.setItem('devsize_ui_scale', val.toString());
      requestAnimationFrame(() => {
        applyScale(val);
        requestAnimationFrame(resizeCanvases);
      });
    });
  }

  if (el.sliderFontScale) {
    el.sliderFontScale.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      if (el.valFontScale) el.valFontScale.textContent = `${val}%`;
      document.documentElement.style.setProperty('--font-scale', (val / 100).toString());
      localStorage.setItem('riff_font_scale', val.toString());
    });
  }

  if (el.sliderCornerRadius) {
    el.sliderCornerRadius.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      if (el.valCornerRadius) el.valCornerRadius.textContent = val === 16 ? 'Default' : `${val}px`;
      document.documentElement.style.setProperty('--md-shape-corner-l', `${val}px`);
      document.documentElement.style.setProperty('--md-shape-corner-m', `${Math.max(0, val - 4)}px`);
      localStorage.setItem('riff_corner_radius', val.toString());
    });
  }

  if (el.sliderUiAlpha) {
    el.sliderUiAlpha.addEventListener('input', (e) => {
      const val = Math.max(20, Math.min(100, parseInt(e.target.value, 10) || 100));
      if (el.valUiAlpha) el.valUiAlpha.textContent = `${val}%`;
      document.documentElement.style.setProperty('--ui-alpha', `${val}%`);
      localStorage.setItem('riff_ui_alpha', val.toString());
    });
  }

  if (el.btnResetUiAlpha) {
    el.btnResetUiAlpha.addEventListener('click', () => {
      const val = 100;
      if (el.sliderUiAlpha) el.sliderUiAlpha.value = val;
      if (el.valUiAlpha) el.valUiAlpha.textContent = `${val}%`;
      document.documentElement.style.setProperty('--ui-alpha', `${val}%`);
      localStorage.setItem('riff_ui_alpha', val.toString());
    });
  }

  if (el.sliderTextAlpha) {
    el.sliderTextAlpha.addEventListener('input', (e) => {
      const val = Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 100));
      if (el.valTextAlpha) el.valTextAlpha.textContent = `${val}%`;
      document.documentElement.style.setProperty('--text-alpha', `${val}%`);
      localStorage.setItem('riff_text_alpha', val.toString());
    });
  }

  if (el.btnResetTextAlpha) {
    el.btnResetTextAlpha.addEventListener('click', () => {
      const val = 100;
      if (el.sliderTextAlpha) el.sliderTextAlpha.value = val;
      if (el.valTextAlpha) el.valTextAlpha.textContent = `${val}%`;
      document.documentElement.style.setProperty('--text-alpha', `${val}%`);
      localStorage.setItem('riff_text_alpha', val.toString());
    });
  }

  const btnChooseBannerMedia = document.getElementById('btn-choose-banner-media');
  const btnResetBannerMedia = document.getElementById('btn-reset-banner-media');

  if (btnChooseBannerMedia) {
    btnChooseBannerMedia.addEventListener('click', async () => {
      if (window.electronAPI && window.electronAPI.pickMedia) {
        const url = await window.electronAPI.pickMedia();
        if (url) {
          localStorage.setItem('riff_banner_media', url);
          const thumb = getTrackThumbUrl(state.currentTrack);
          updateRightPanelBanner(thumb);
          updatePlaylistDetailBanner(thumb);
        }
      }
    });
  }

  if (btnResetBannerMedia) {
    btnResetBannerMedia.addEventListener('click', () => {
      localStorage.removeItem('riff_banner_media');
      const thumb = getTrackThumbUrl(state.currentTrack);
      updateRightPanelBanner(thumb);
      updatePlaylistDetailBanner(thumb);
    });
  }

  const sliderBannerBlur = document.getElementById('slider-banner-blur');
  const valBannerBlur = document.getElementById('val-banner-blur');
  if (sliderBannerBlur) {
    sliderBannerBlur.value = savedBannerBlur;
    if (valBannerBlur) valBannerBlur.textContent = `${savedBannerBlur}px`;
    sliderBannerBlur.addEventListener('input', (e) => {
      const v = parseInt(e.target.value, 10);
      document.documentElement.style.setProperty('--banner-blur', `${v}px`);
      if (valBannerBlur) valBannerBlur.textContent = `${v}px`;
      localStorage.setItem('riff_banner_blur', v.toString());
    });
  }

  const sliderBannerOpacity = document.getElementById('slider-banner-opacity');
  const valBannerOpacity = document.getElementById('val-banner-opacity');
  if (sliderBannerOpacity) {
    sliderBannerOpacity.value = savedBannerOpacity;
    if (valBannerOpacity) valBannerOpacity.textContent = `${savedBannerOpacity}%`;
    sliderBannerOpacity.addEventListener('input', (e) => {
      const v = parseInt(e.target.value, 10);
      document.documentElement.style.setProperty('--banner-opacity', `${v / 100}`);
      if (valBannerOpacity) valBannerOpacity.textContent = `${v}%`;
      localStorage.setItem('riff_banner_opacity', v.toString());
    });
  }

  const sliderBannerFade = document.getElementById('slider-banner-fade');
  const valBannerFade = document.getElementById('val-banner-fade');
  if (sliderBannerFade) {
    sliderBannerFade.value = savedBannerFade;
    if (valBannerFade) valBannerFade.textContent = `${savedBannerFade}%`;
    sliderBannerFade.addEventListener('input', (e) => {
      const v = parseInt(e.target.value, 10);
      document.documentElement.style.setProperty('--banner-fade-base', `${v}%`);
      if (valBannerFade) valBannerFade.textContent = `${v}%`;
      localStorage.setItem('riff_banner_fade', v.toString());
    });
  }

  function applyBannerFit(fit) {
    const root = document.documentElement;
    const val = fit || 'zoom';
    if (val === 'fit') {
      root.style.setProperty('--banner-fit', 'contain');
      root.style.setProperty('--banner-object-fit', 'contain');
      root.style.setProperty('--banner-scale', 'none');
    } else if (val === 'stretch') {
      root.style.setProperty('--banner-fit', '100% 100%');
      root.style.setProperty('--banner-object-fit', 'fill');
      root.style.setProperty('--banner-scale', 'none');
    } else {
      root.style.setProperty('--banner-fit', 'cover');
      root.style.setProperty('--banner-object-fit', 'cover');
      root.style.setProperty('--banner-scale', 'scale(1.06)');
    }
  }

  const selectBannerFit = document.getElementById('select-banner-fit');
  if (selectBannerFit) {
    selectBannerFit.value = savedBannerFit;
    selectBannerFit.addEventListener('change', (e) => {
      const val = e.target.value;
      localStorage.setItem('riff_banner_fit', val);
      applyBannerFit(val);
    });
  }

  const btnChooseCustomBg = document.getElementById('btn-choose-custom-bg');
  const btnRemoveCustomBg = document.getElementById('btn-remove-custom-bg');
  const sliderBgOpacity = document.getElementById('slider-bg-opacity');
  const valBgOpacity = document.getElementById('val-bg-opacity');
  const sliderBgBlur = document.getElementById('slider-bg-blur');
  const valBgBlur = document.getElementById('val-bg-blur');

  function updateCustomBg() {
    const bgUrl = localStorage.getItem('riff_bg_url') || '';
    const opacityVal = parseInt(localStorage.getItem('riff_bg_opacity') ?? '100', 10);
    const blurVal = parseInt(localStorage.getItem('riff_bg_blur') ?? '0', 10);

    if (sliderBgOpacity) sliderBgOpacity.value = opacityVal;
    if (valBgOpacity) valBgOpacity.textContent = `${opacityVal}%`;
    if (sliderBgBlur) sliderBgBlur.value = blurVal;
    if (valBgBlur) valBgBlur.textContent = `${blurVal}px`;

    const customBg = document.getElementById('custom-bg');
    if (!customBg) return;

    if (!bgUrl) {
      customBg.innerHTML = '';
      customBg.style.display = 'none';
      if (btnRemoveCustomBg) btnRemoveCustomBg.disabled = true;
      return;
    }

    if (btnRemoveCustomBg) btnRemoveCustomBg.disabled = false;
    customBg.style.display = 'block';
    customBg.style.opacity = (opacityVal / 100).toString();
    customBg.style.filter = blurVal > 0 ? `blur(${blurVal}px)` : 'none';

    const currentMedia = customBg.firstElementChild;
    const isVideo = /\.(mp4|webm)($|\?)/i.test(bgUrl);
    const tag = isVideo ? 'VIDEO' : 'IMG';

    if (!currentMedia || currentMedia.tagName !== tag || currentMedia.src !== bgUrl) {
      customBg.innerHTML = '';
      if (isVideo) {
        const vid = document.createElement('video');
        vid.src = bgUrl;
        vid.autoplay = true;
        vid.loop = true;
        vid.muted = true;
        vid.playsInline = true;
        vid.play().catch(() => {});
        customBg.appendChild(vid);
      } else {
        const img = document.createElement('img');
        img.src = bgUrl;
        customBg.appendChild(img);
      }
    }
  }

  if (btnChooseCustomBg) {
    btnChooseCustomBg.addEventListener('click', async () => {
      if (window.electronAPI && window.electronAPI.pickMedia) {
        const url = await window.electronAPI.pickMedia();
        if (url) {
          localStorage.setItem('riff_bg_url', url);
          updateCustomBg();
        }
      }
    });
  }

  if (btnRemoveCustomBg) {
    btnRemoveCustomBg.addEventListener('click', () => {
      localStorage.removeItem('riff_bg_url');
      updateCustomBg();
    });
  }

  if (sliderBgOpacity) {
    sliderBgOpacity.addEventListener('input', (e) => {
      const v = parseInt(e.target.value, 10);
      if (valBgOpacity) valBgOpacity.textContent = `${v}%`;
      localStorage.setItem('riff_bg_opacity', String(v));
      const customBg = document.getElementById('custom-bg');
      if (customBg) customBg.style.opacity = (v / 100).toString();
    });
  }

  if (sliderBgBlur) {
    sliderBgBlur.addEventListener('input', (e) => {
      const v = parseInt(e.target.value, 10);
      if (valBgBlur) valBgBlur.textContent = `${v}px`;
      localStorage.setItem('riff_bg_blur', String(v));
      const customBg = document.getElementById('custom-bg');
      if (customBg) customBg.style.filter = v > 0 ? `blur(${v}px)` : 'none';
    });
  }

  updateCustomBg();

  const sliderMeshBrightness = document.getElementById('slider-mesh-brightness');
  const valMeshBrightness = document.getElementById('val-mesh-brightness');
  if (sliderMeshBrightness) {
    sliderMeshBrightness.value = state.meshBrightness;
    if (valMeshBrightness) valMeshBrightness.textContent = `${state.meshBrightness}%`;
    sliderMeshBrightness.addEventListener('input', (e) => {
      const v = parseInt(e.target.value, 10);
      state.meshBrightness = v;
      if (valMeshBrightness) valMeshBrightness.textContent = `${v}%`;
      localStorage.setItem('riff_mesh_brightness', v.toString());
      updateThemeFromState();
    });
  }

  const DEFAULT_MESH_CFG = {
    p1: { x: 20, y: 0 },
    p2: { x: 85, y: 5 },
    speed: 0,
    blur: 0
  };

  let meshCfg = { ...DEFAULT_MESH_CFG };
  try {
    const raw = localStorage.getItem('riff_mesh_cfg');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.p1 && parsed.p2) {
        meshCfg = {
          p1: { x: Math.max(0, Math.min(100, Number(parsed.p1.x) ?? 20)), y: Math.max(0, Math.min(100, Number(parsed.p1.y) ?? 0)) },
          p2: { x: Math.max(0, Math.min(100, Number(parsed.p2.x) ?? 85)), y: Math.max(0, Math.min(100, Number(parsed.p2.y) ?? 5)) },
          speed: Math.max(0, Math.min(100, Number(parsed.speed) || 0)),
          blur: Math.max(0, Math.min(60, Number(parsed.blur) || 0))
        };
      }
    }
  } catch (_) {}

  function applyMeshCfg(cfg, save = true) {
    meshCfg = cfg;
    const root = document.documentElement;
    root.style.setProperty('--mesh-p1x', `${cfg.p1.x}%`);
    root.style.setProperty('--mesh-p1y', `${cfg.p1.y}%`);
    root.style.setProperty('--mesh-p2x', `${cfg.p2.x}%`);
    root.style.setProperty('--mesh-p2y', `${cfg.p2.y}%`);
    const speedDur = cfg.speed > 0 ? `${(120 / (cfg.speed * 0.2 + 1)).toFixed(1)}s` : '0s';
    root.style.setProperty('--mesh-speed', speedDur);
    root.style.setProperty('--mesh-blur', `${cfg.blur}px`);

    const d1 = document.getElementById('mesh-dot-1');
    const d2 = document.getElementById('mesh-dot-2');
    if (d1) {
      d1.style.left = `${cfg.p1.x}%`;
      d1.style.top = `${cfg.p1.y}%`;
    }
    if (d2) {
      d2.style.left = `${cfg.p2.x}%`;
      d2.style.top = `${cfg.p2.y}%`;
    }

    const slSpeed = document.getElementById('slider-mesh-speed');
    const vlSpeed = document.getElementById('val-mesh-speed');
    if (slSpeed) slSpeed.value = cfg.speed;
    if (vlSpeed) vlSpeed.textContent = cfg.speed === 0 ? '0 (static)' : `${cfg.speed}`;

    const slBlur = document.getElementById('slider-mesh-blur');
    const vlBlur = document.getElementById('val-mesh-blur');
    if (slBlur) slBlur.value = cfg.blur;
    if (vlBlur) vlBlur.textContent = `${cfg.blur}px`;

    if (save) {
      localStorage.setItem('riff_mesh_cfg', JSON.stringify(cfg));
    }
  }

  applyMeshCfg(meshCfg, false);

  const btnConfigureMesh = document.getElementById('btn-configure-mesh');
  const meshModal = document.getElementById('mesh-customizer-modal');
  const btnCloseMeshModal = document.getElementById('btn-close-mesh-modal');
  const btnResetMesh = document.getElementById('btn-reset-mesh');
  const sliderMeshSpeed = document.getElementById('slider-mesh-speed');
  const sliderMeshBlur = document.getElementById('slider-mesh-blur');

  function openMeshModal() {
    if (!meshModal) return;
    const card = meshModal.querySelector('.settings-card') || meshModal;
    const previewBg = document.getElementById('mesh-preview-bg');
    const meshA = document.getElementById('bg-mesh-a');
    const meshB = document.getElementById('bg-mesh-b');
    const curBg = (activeMeshLayer === 'a' ? meshB : meshA)?.style.background || meshA?.style.background;
    if (previewBg && curBg) previewBg.style.background = curBg;

    applyMeshCfg(meshCfg, false);
    meshModal.classList.remove('hidden');
    requestAnimationFrame(() => {
      meshModal.classList.add('visible');
      if (window.LiquidMotion) {
        LiquidMotion.open(card, btnConfigureMesh, 'y');
      }
    });
  }

  function closeMeshModal() {
    if (!meshModal) return;
    const card = meshModal.querySelector('.settings-card') || meshModal;
    if (window.LiquidMotion) {
      LiquidMotion.close(card, () => {
        meshModal.classList.remove('visible');
        meshModal.classList.add('hidden');
      });
    } else {
      closeModal(meshModal);
    }
  }

  if (btnConfigureMesh) btnConfigureMesh.addEventListener('click', openMeshModal);
  if (btnCloseMeshModal) btnCloseMeshModal.addEventListener('click', closeMeshModal);
  if (meshModal) {
    meshModal.addEventListener('click', (e) => {
      if (e.target === meshModal) closeMeshModal();
    });
  }

  if (sliderMeshSpeed) {
    sliderMeshSpeed.addEventListener('input', (e) => {
      meshCfg.speed = parseInt(e.target.value, 10);
      applyMeshCfg(meshCfg, true);
    });
  }

  if (sliderMeshBlur) {
    sliderMeshBlur.addEventListener('input', (e) => {
      meshCfg.blur = parseInt(e.target.value, 10);
      applyMeshCfg(meshCfg, true);
    });
  }

  if (btnResetMesh) {
    btnResetMesh.addEventListener('click', () => {
      applyMeshCfg({
        p1: { x: 20, y: 0 },
        p2: { x: 85, y: 5 },
        speed: 0,
        blur: 0
      }, true);
    });
  }

  const previewBox = document.getElementById('mesh-preview-box');
  const dot1 = document.getElementById('mesh-dot-1');
  const dot2 = document.getElementById('mesh-dot-2');

  function attachDotDrag(dotEl, key) {
    if (!dotEl || !previewBox) return;
    let isDragging = false;

    dotEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      isDragging = true;
      dotEl.setPointerCapture(e.pointerId);
      dotEl.style.cursor = 'grabbing';
      dotEl.focus();
    });

    dotEl.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const rect = previewBox.getBoundingClientRect();
      const x = Math.max(0, Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
      const y = Math.max(0, Math.min(100, Math.round(((e.clientY - rect.top) / rect.height) * 100)));
      meshCfg[key] = { x, y };
      applyMeshCfg(meshCfg, true);
    });

    const endDrag = (e) => {
      if (isDragging) {
        isDragging = false;
        try { dotEl.releasePointerCapture(e.pointerId); } catch (_) {}
        dotEl.style.cursor = 'grab';
      }
    };
    dotEl.addEventListener('pointerup', endDrag);
    dotEl.addEventListener('pointercancel', endDrag);

    dotEl.addEventListener('keydown', (e) => {
      let dx = 0, dy = 0;
      if (e.key === 'ArrowLeft') dx = -1;
      else if (e.key === 'ArrowRight') dx = 1;
      else if (e.key === 'ArrowUp') dy = -1;
      else if (e.key === 'ArrowDown') dy = 1;
      else return;
      e.preventDefault();
      const cur = meshCfg[key];
      const x = Math.max(0, Math.min(100, cur.x + dx));
      const y = Math.max(0, Math.min(100, cur.y + dy));
      meshCfg[key] = { x, y };
      applyMeshCfg(meshCfg, true);
    });
  }

  attachDotDrag(dot1, 'p1');
  attachDotDrag(dot2, 'p2');

  const paletteDropdown = document.getElementById('palette-style-dropdown');
  const paletteTrigger = document.getElementById('palette-style-trigger');
  const paletteLabel = document.getElementById('palette-style-trigger-label');
  const paletteMenu = document.getElementById('palette-style-menu');
  if (paletteDropdown && paletteTrigger && paletteMenu) {
    const currentStyle = state.paletteStyle || 'classic';
    const styleObj = PALETTE_STYLES[currentStyle] || PALETTE_STYLES.classic;
    if (paletteLabel) paletteLabel.textContent = styleObj.label;
    paletteMenu.querySelectorAll('.m3-dropdown-option').forEach(opt => {
      opt.classList.toggle('selected', opt.dataset.value === currentStyle);
    });

    paletteTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      paletteDropdown.classList.toggle('open');
    });

    paletteMenu.querySelectorAll('.m3-dropdown-option').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = opt.dataset.value;
        state.paletteStyle = val;
        localStorage.setItem('riff_palette_style', state.paletteStyle);
        if (paletteLabel) paletteLabel.textContent = opt.textContent;
        paletteMenu.querySelectorAll('.m3-dropdown-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        paletteDropdown.classList.remove('open');
        updateThemeFromState();
      });
    });

    document.addEventListener('click', () => {
      paletteDropdown.classList.remove('open');
    });
  }

  const btnToggleAdv = document.getElementById('btn-toggle-adv-section');
  const advWrapper = document.getElementById('adv-collapsible-wrapper');
  if (btnToggleAdv && advWrapper) {
    const isAdvOpen = localStorage.getItem('riff_adv_open') === 'true';
    if (isAdvOpen) {
      btnToggleAdv.classList.add('is-open');
      advWrapper.classList.add('is-open');
    }
    btnToggleAdv.addEventListener('click', () => {
      const nowOpen = advWrapper.classList.toggle('is-open');
      btnToggleAdv.classList.toggle('is-open', nowOpen);
      localStorage.setItem('riff_adv_open', nowOpen ? 'true' : 'false');
    });
  }

  const advButtons = document.querySelectorAll('.effect-switch-btn[data-adv]');
  advButtons.forEach(btn => {
    const key = btn.dataset.adv;
    const defaultVal = key === 'reduce_motion' ? false : true;
    const currentVal = getAdv(key, defaultVal);
    btn.classList.toggle('active', currentVal);

    btn.addEventListener('click', () => {
      const newVal = !btn.classList.contains('active');
      btn.classList.toggle('active', newVal);
      setAdv(key, newVal);

      if (key === 'reduce_motion') {
        applyReducedMotionSetting();
      } else if (key === 'mesh_gradient') {
        updateThemeFromState();
      } else if (key === 'my_wave') {
        const waveSection = document.getElementById('section-my-wave');
        if (waveSection) waveSection.style.display = newVal ? '' : 'none';
        if (newVal) loadHomePage();
      } else if (key === 'my_wave_ambient') {
        const ambientEl = document.getElementById('my-wave-ambient-light');
        if (ambientEl) ambientEl.style.display = newVal ? '' : 'none';
      } else if (key === 'banners') {
        const bannerR = document.getElementById('right-panel-banner');
        const bannerP = document.getElementById('playlist-header-banner');
        if (bannerR) bannerR.style.display = newVal ? '' : 'none';
        if (bannerP) bannerP.style.display = newVal ? '' : 'none';
        if (newVal && state.currentTrack) {
          updateRightPanelBanner(getTrackThumbUrl(state.currentTrack));
        }
      } else if (key === 'karaoke_words') {
        renderLyricsView();
      }
    });
  });

  const btnSmooth = document.getElementById('btn-smooth-presets');
  if (btnSmooth) {
    btnSmooth.classList.toggle('active', localStorage.getItem('riff_smooth_presets') !== 'false');
    btnSmooth.addEventListener('click', () => {
      const v = !btnSmooth.classList.contains('active');
      btnSmooth.classList.toggle('active', v);
      localStorage.setItem('riff_smooth_presets', String(v));
    });
  }
  if (sidebarEl) {
    sidebarEl.classList.add('no-nav-anim');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        sidebarEl.classList.remove('no-nav-anim');
      });
    });
  }

  const btnShowLocal = document.getElementById('btn-show-local');
  function updateShowLocalUI(animate = false) {
    const show = localStorage.getItem('riff_show_local') !== 'false';
    if (el.navLocal) el.navLocal.classList.toggle('nav-collapsed', !show);
    if (btnShowLocal) btnShowLocal.classList.toggle('active', show);
    if (!show && state.currentView === 'local') {
      switchView('discover');
    }
    if (animate) {
      const t0 = performance.now();
      (function f() {
        updateNavIndicator();
        if (performance.now() - t0 < 350) requestAnimationFrame(f);
      })();
    } else {
      updateNavIndicator();
    }
  }
  if (btnShowLocal) {
    btnShowLocal.addEventListener('click', () => {
      const show = localStorage.getItem('riff_show_local') !== 'false';
      localStorage.setItem('riff_show_local', (!show) ? 'true' : 'false');
      updateShowLocalUI(true);
    });
  }
  updateShowLocalUI(false);

  function applyNoHandCursor(on) {
    document.body.classList.toggle('no-hand-cursor', !!on);
  }
  const btnNoHandCursor = document.getElementById('btn-no-hand-cursor');
  const initialNoHand = localStorage.getItem('riff_no_hand_cursor') === 'true';
  applyNoHandCursor(initialNoHand);
  if (btnNoHandCursor) {
    btnNoHandCursor.classList.toggle('active', initialNoHand);
    btnNoHandCursor.addEventListener('click', () => {
      const next = !btnNoHandCursor.classList.contains('active');
      btnNoHandCursor.classList.toggle('active', next);
      localStorage.setItem('riff_no_hand_cursor', next ? 'true' : 'false');
      applyNoHandCursor(next);
    });
  }

  const btnWavyProgress = document.getElementById('btn-wavy-progress');
  function updateWavyProgressUI() {
    const isWavy = localStorage.getItem('riff_wavy_progress') !== 'false';
    const isPerf = localStorage.getItem('riff_perf_mode') === '1' || localStorage.getItem('riff_perf_mode') === 'true';
    document.body.classList.toggle('no-wavy', isPerf ? true : !isWavy);
    if (btnWavyProgress) {
      btnWavyProgress.classList.toggle('active', isWavy);
    }
  }

  function applyPerfMode(on) {
    document.body.classList.toggle('perf', !!on);
    const isWavy = localStorage.getItem('riff_wavy_progress') !== 'false';
    document.body.classList.toggle('no-wavy', on ? true : !isWavy);
    const bgVid = document.querySelector('#custom-bg video');
    if (bgVid) {
      if (on) {
        bgVid.pause();
      } else if (state.isWindowVisible) {
        bgVid.play().catch(() => {});
      }
    }
  }
  const btnPerfMode = document.getElementById('btn-perf-mode');
  const initialPerfMode = localStorage.getItem('riff_perf_mode') === '1' || localStorage.getItem('riff_perf_mode') === 'true';
  applyPerfMode(initialPerfMode);
  if (btnPerfMode) {
    btnPerfMode.classList.toggle('active', initialPerfMode);
    btnPerfMode.addEventListener('click', () => {
      const next = !btnPerfMode.classList.contains('active');
      btnPerfMode.classList.toggle('active', next);
      localStorage.setItem('riff_perf_mode', next ? '1' : '0');
      applyPerfMode(next);
    });
  }

  if (btnWavyProgress) {
    btnWavyProgress.addEventListener('click', () => {
      const isWavy = localStorage.getItem('riff_wavy_progress') !== 'false';
      const next = !isWavy;
      localStorage.setItem('riff_wavy_progress', next ? 'true' : 'false');
      updateWavyProgressUI();
      hasDrawnPausedFrame = false;
    });
  }

  updateWavyProgressUI();

  const btnTrayOnClose = document.getElementById('btn-tray-on-close');
  const storedTrayOnClose = localStorage.getItem('riff_tray_on_close');
  const savedTrayOnClose = storedTrayOnClose !== null
    ? storedTrayOnClose === 'true'
    : /Windows|Mac/.test(navigator.userAgent);
  if (btnTrayOnClose) {
    btnTrayOnClose.classList.toggle('active', savedTrayOnClose);
    btnTrayOnClose.addEventListener('click', () => {
      const next = !btnTrayOnClose.classList.contains('active');
      btnTrayOnClose.classList.toggle('active', next);
      localStorage.setItem('riff_tray_on_close', next ? 'true' : 'false');
      if (window.electronAPI && window.electronAPI.setTrayOnClose) {
        window.electronAPI.setTrayOnClose(next);
      }
    });
  }
  if (window.electronAPI && window.electronAPI.setTrayOnClose) {
    window.electronAPI.setTrayOnClose(savedTrayOnClose);
  }

  function showSettingsCategory(cat) {
    document.querySelectorAll('#view-settings .settings-section').forEach(s => s.classList.toggle('cat-hidden', s.dataset.cat !== cat));
    document.querySelectorAll('#settings-nav .settings-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
    const pane = document.querySelector('#view-settings .settings-pane'); if (pane) pane.scrollTop = 0;
    try { localStorage.setItem('riff_settings_cat', cat); } catch (e) {}
  }
  window.showSettingsCategory = showSettingsCategory;

  const settingsNav = document.getElementById('settings-nav');
  if (settingsNav) {
    settingsNav.addEventListener('click', (e) => {
      const btn = e.target.closest('.settings-nav-btn');
      if (btn && btn.dataset.cat) {
        showSettingsCategory(btn.dataset.cat);
      }
    });
  }

  function addSliderTicks(input) {
    const hints = input.parentElement.querySelector('.setting-hints');
    const spans = hints ? [...hints.querySelectorAll('span')].map(s => s.textContent) : [];
    const min = +input.min, max = +input.max, step = +input.step || 1;
    const def = +input.getAttribute('value');
    const labels = {};
    if (spans.length === 3) { labels[min] = spans[0]; labels[def] = spans[1]; labels[max] = spans[2]; }
    else if (spans.length === 2) { labels[min] = spans[0]; labels[max] = spans[1]; }
    const wrap = document.createElement('div'); wrap.className = 'slider-ticks';
    for (let v = min; v <= max; v += step) {
      const t = document.createElement('i'); t.style.setProperty('--p', (v - min) / (max - min));
      if (labels[v] != null) { t.className = 'major'; const s = document.createElement('span'); s.textContent = labels[v]; t.appendChild(s); }
      wrap.appendChild(t);
    }
    input.insertAdjacentElement('afterend', wrap);
    if (hints) hints.remove();
  }

  const scaleInput = document.getElementById('settings-slider-scale');
  if (scaleInput) addSliderTicks(scaleInput);
  document.querySelectorAll('#view-settings .pill-range').forEach(input => {
    if (input === scaleInput) return;
    const hints = input.parentElement ? input.parentElement.querySelector('.setting-hints') : null;
    if (!hints) return;
    const min = +input.min, max = +input.max, step = +input.step || 1;
    if ((max - min) / step <= 20) {
      addSliderTicks(input);
    }
  });

  function decorateSwitches() {
    document.querySelectorAll('.effect-switch-btn .thumb:not(.has-icon)').forEach((t) => {
      t.classList.add('has-icon');
      t.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="sw-icon"/></svg>';
    });
  }
  let swRaf = 0;
  new MutationObserver(() => { if (swRaf) return; swRaf = requestAnimationFrame(() => { swRaf = 0; decorateSwitches(); }); }).observe(document.body, { childList: true, subtree: true });
  decorateSwitches();

  const settingWinMediaKeys = document.getElementById('setting-win-media-keys');
  const btnWinMediaKeys = document.getElementById('btn-win-media-keys');
  const isWindows = (window.electronAPI && typeof window.electronAPI.isWindows === 'boolean')
    ? window.electronAPI.isWindows
    : (navigator.userAgent.includes('Windows') || (navigator.platform && navigator.platform.includes('Win')));

  if (settingWinMediaKeys) {
    settingWinMediaKeys.style.display = isWindows ? '' : 'none';
  }

  const savedWinMediaKeys = localStorage.getItem('riff_global_media_keys') !== 'false';
  if (btnWinMediaKeys) {
    btnWinMediaKeys.classList.toggle('active', savedWinMediaKeys);
    btnWinMediaKeys.addEventListener('click', () => {
      const next = !btnWinMediaKeys.classList.contains('active');
      btnWinMediaKeys.classList.toggle('active', next);
      localStorage.setItem('riff_global_media_keys', next ? 'true' : 'false');
      if (window.electronAPI && window.electronAPI.setMediaKeys) {
        window.electronAPI.setMediaKeys(next);
      }
    });
  }
  if (window.electronAPI && window.electronAPI.setMediaKeys) {
    window.electronAPI.setMediaKeys(savedWinMediaKeys);
  }

  if (window.electronAPI && window.electronAPI.onMediaCommand) {
    window.electronAPI.onMediaCommand((cmd) => handleMediaCommand(cmd, 'ipc'));
  }

  function checkCompactLayout() {
    const isMini = window.innerWidth <= 520 && window.innerHeight <= 220;
    document.body.classList.toggle('mini', isMini);
  }
  window.addEventListener('resize', checkCompactLayout);
  checkCompactLayout();

  async function toggleMiniWindow() {
    if (window.electronAPI && window.electronAPI.toggleMiniWindow) {
      await window.electronAPI.toggleMiniWindow();
    }
  }
  window.toggleMiniWindow = toggleMiniWindow;

  const btnMiniPlayer = document.getElementById('btn-mini-player');
  if (btnMiniPlayer) {
    btnMiniPlayer.addEventListener('click', () => {
      toggleMiniWindow();
    });
  }

  const sliderCrossfade = document.getElementById('slider-crossfade');
  const valCrossfade = document.getElementById('val-crossfade');
  if (sliderCrossfade) {
    const cf = parseInt(localStorage.getItem('riff_crossfade') || '0', 10);
    sliderCrossfade.value = cf;
    if (valCrossfade) valCrossfade.textContent = cf > 0 ? `${cf}s` : 'Off';
    sliderCrossfade.addEventListener('input', (e) => {
      const v = parseInt(e.target.value, 10);
      if (valCrossfade) valCrossfade.textContent = v > 0 ? `${v}s` : 'Off';
      localStorage.setItem('riff_crossfade', String(v));
    });
  }

  if (el.btnTrEnabled) {
    el.btnTrEnabled.addEventListener('click', () => {
      state.trEnabled = !state.trEnabled;
      localStorage.setItem('riff_tr_enabled', String(state.trEnabled));
      updateLyricsTranslationUI();
      if (!state.trEnabled) {
        state.trActive = false;
        state.currentTranslations = null;
        renderLyricsView();
        if (el.nativeAudio) updateSyncedLyricsHighlight(playbackTime());
      } else if (state.trAuto) {
        state.trActive = true;
        updateLyricsTranslationUI();
        fetchAndApplyTranslation();
      }
    });
  }

  if (el.selectTrLang) {
    el.selectTrLang.addEventListener('change', () => {
      state.trLang = el.selectTrLang.value;
      localStorage.setItem('riff_tr_lang', state.trLang);
      if (state.trActive) {
        fetchAndApplyTranslation();
      }
    });
  }

  if (el.btnTrAuto) {
    el.btnTrAuto.addEventListener('click', () => {
      state.trAuto = !state.trAuto;
      localStorage.setItem('riff_tr_auto', String(state.trAuto));
      updateLyricsTranslationUI();
      if (state.trEnabled && state.trAuto && !state.trActive) {
        state.trActive = true;
        updateLyricsTranslationUI();
        fetchAndApplyTranslation();
      }
    });
  }

  if (el.btnResetAudio) {
    el.btnResetAudio.addEventListener('click', () => {
      state.activePresetId = 'p_default';
      state.audioSettings = { speed: 1.0, speedPitch: 1.0, pitch: 0, reverb: 0, distortion: 0, volume: 1.0, echo: 0, eq: { low: 0, mid: 0, high: 0 } };
      state.hqSettings = { engine: 'hqmusic-3', preset: 'studio', vocal: 0, air: 0, bass: 0 };
      state.hqEnabled = false;
      syncSettingsSlidersToState();
      applyAudioSettings();
      applyHqSettings();
      renderPresets();
    });
  }

  (function initUpdateUI() {
    const api = window.electronAPI;
    if (!api || !api.checkForUpdates) return;
    const $ = (id) => document.getElementById(id);
    const modal = $('update-modal'), title = $('update-title'), text = $('update-text'), bar = $('update-progress');
    const nowB = $('btn-update-now'), laterB = $('btn-update-later'), ignoreB = $('btn-update-ignore');
    api.getAppVersion().then((v) => {
      const a = $('about-version'); if (a) a.textContent = 'Version ' + v;
      const t = document.querySelector('.settings-version-tag'); if (t) t.textContent = 'v' + v;
    }).catch(() => {});
    const btn = $('btn-check-updates');
    if (btn) btn.addEventListener('click', async () => {
      const r = await api.checkForUpdates();
      showToast(r && r.ok === false ? (r.message || 'Updates are checked only in the installed app') : 'Checking for updates...', 'info');
    });
    api.onUpdateAvailable((d) => {
      title.textContent = 'Riff ' + d.version + ' is available';
      bar.classList.add('hidden'); bar.firstElementChild.style.width = '0';
      nowB.disabled = laterB.disabled = false;
      nowB.classList.toggle('hidden', !d.canInstall); laterB.classList.toggle('hidden', !d.canInstall);
      text.textContent = d.canInstall ? 'A new version is ready to download.' : 'Download the new version from the release page.';
      if (!d.canInstall && /^https?:\/\//i.test(d.url)) { const link = document.createElement('a'); link.href = d.url; link.target = '_blank'; link.rel = 'noopener'; link.textContent = ' Open release page'; text.appendChild(link); }
      openModal(modal);
    });
    api.onUpdateProgress((d) => { bar.classList.remove('hidden'); bar.firstElementChild.style.width = d.percent + '%'; text.textContent = 'Downloading... ' + d.percent + '%'; });
    api.onUpdateReady(() => { text.textContent = 'Update downloaded. It will be installed when you close Cuda.'; nowB.classList.add('hidden'); laterB.classList.add('hidden'); });
    api.onUpdateError((d) => showToast('Update error: ' + d.message, 'error'));
    api.onUpdateNotAvailable((d) => showToast('You are on the latest version (' + d.version + ')', 'info'));
    nowB.addEventListener('click', () => { api.updateAction('now'); nowB.disabled = laterB.disabled = true; text.textContent = 'Downloading...'; });
    laterB.addEventListener('click', () => { api.updateAction('later'); closeModal(modal); showToast('The update will be installed when you close Riff', 'info'); });
    ignoreB.addEventListener('click', () => { api.updateAction('ignore'); closeModal(modal); });
    $('btn-close-update').addEventListener('click', () => closeModal(modal));
  })();

  function isTextInput(target) {
    if (!target) return false;
    const tag = (target.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target.isContentEditable;
  }

  function adjustVolume(delta) {
    state.volume = Math.max(0, Math.min(1, Math.round((state.volume + delta) * 100) / 100));
    state.isMuted = false;
    if (el.volumeSlider) el.volumeSlider.value = state.volume;
    if (el.volumeIcon) el.volumeIcon.classList.remove('hidden');
    if (el.volumeMutedIcon) el.volumeMutedIcon.classList.add('hidden');
    applyAudioSettings();
  }

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && !isTextInput(e.target) && !e.target.closest?.('button,[role=button],a[href],input,select')) {
      e.preventDefault();
    }
  }, true);

  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    const inInput = isTextInput(e.target);

    if (e.code === 'Escape' || e.key === 'Escape') {
      const openModals = Array.from(document.querySelectorAll('.modal-backdrop:not(.hidden)'));
      if (openModals.length > 0) {
        e.preventDefault();
        closeModal(openModals[openModals.length - 1]);
        return;
      }
      if (state.isTvKaraokeOpen && typeof closeTvKaraoke === 'function') {
        e.preventDefault();
        closeTvKaraoke();
        return;
      }
      if (inInput) {
        e.preventDefault();
        e.target.blur();
        return;
      }
      return;
    }

    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.target.closest?.('button,[role=button],a[href],input[type=range],input[type=checkbox],select')) return;

    if (inInput) {
      if ((e.code.startsWith('Arrow') || e.key.startsWith('Arrow')) && (e.ctrlKey || e.metaKey || e.shiftKey)) {
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        return;
      }
    }

    if (e.code === 'Space') {
      e.preventDefault();
      if (syncState && syncState.active && syncState.currentIndex < syncState.lines.length) {
        handleSyncLineClick(syncState.currentIndex);
      } else {
        togglePlayPause();
      }
      return;
    }

    if ((e.code === 'KeyK' && (e.ctrlKey || e.metaKey)) || (!inInput && (e.code === 'Slash' || e.key === '/'))) {
      e.preventDefault();
      if (el.searchInput) {
        el.searchInput.focus();
        el.searchInput.select();
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
      if (e.code === 'ArrowRight' || e.key === 'ArrowRight') {
        e.preventDefault();
        playNext();
        return;
      }
      if (e.code === 'ArrowLeft' || e.key === 'ArrowLeft') {
        e.preventDefault();
        playPrev();
        return;
      }
      if (e.code === 'ArrowUp' || e.key === 'ArrowUp') {
        e.preventDefault();
        adjustVolume(0.05);
        return;
      }
      if (e.code === 'ArrowDown' || e.key === 'ArrowDown') {
        e.preventDefault();
        adjustVolume(-0.05);
        return;
      }
    }

    if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.code === 'ArrowRight' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (el.nativeAudio) seekPlayback(Math.min(playbackDuration(), playbackTime() + 5));
        return;
      }
      if (e.code === 'ArrowLeft' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (el.nativeAudio) seekPlayback(Math.max(0, playbackTime() - 5));
        return;
      }
    }

    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      if (e.code === 'KeyM') {
        e.preventDefault();
        if (el.btnVolumeMute) el.btnVolumeMute.click();
        return;
      }
      if (e.code === 'KeyH') {
        e.preventDefault();
        if (typeof window.toggleShuffle === 'function') window.toggleShuffle();
        return;
      }
      if (e.code === 'KeyR') {
        e.preventDefault();
        if (typeof window.toggleRepeat === 'function') window.toggleRepeat();
        return;
      }
      if (e.code === 'KeyL') {
        e.preventDefault();
        if (el.btnToggleLyricsPanel) el.btnToggleLyricsPanel.click();
        return;
      }
      if (e.code === 'KeyF') {
        e.preventDefault();
        if (typeof openTvKaraoke === 'function') openTvKaraoke();
        return;
      }
      if (e.code === 'KeyP') {
        e.preventDefault();
        if (typeof toggleMiniWindow === 'function') toggleMiniWindow();
        return;
      }
    }
  }, true);

  const btnDiscordRpc = document.getElementById('btn-discord-rpc');
  const badgeDiscordRpc = document.getElementById('badge-discord-rpc');

  function syncDiscordRpcUI() {
    if (btnDiscordRpc) {
      btnDiscordRpc.classList.toggle('active', state.discordRpcEnabled);
      
    }
    if (badgeDiscordRpc) {
      badgeDiscordRpc.textContent = state.discordRpcEnabled ? 'on' : 'off';
    }
    const card = document.getElementById('card-discord-rpc');
    if (card) card.classList.toggle('enabled', state.discordRpcEnabled);
  }

  if (btnDiscordRpc) {
    btnDiscordRpc.addEventListener('click', () => {
      state.discordRpcEnabled = !state.discordRpcEnabled;
      localStorage.setItem('devsize_discord_rpc', JSON.stringify(state.discordRpcEnabled));
      if (window.electronAPI && window.electronAPI.discordRpcSetEnabled) {
        window.electronAPI.discordRpcSetEnabled(state.discordRpcEnabled);
      }
      if (state.discordRpcEnabled && state.isPlaying && state.currentTrack) {
        sendDiscordRpcUpdate(state.currentTrack, true);
      }
      syncDiscordRpcUI();
    });
  }

  syncDiscordRpcUI();

  function createWavyProgress(container) {
    const W = 240, H = 12, WL = 16; let d = `M0 ${H/2}`;
    for (let x = 0; x < W; x += WL) d += ` q ${WL/4} ${-H/2} ${WL/2} 0 t ${WL/2} 0`;
    container.innerHTML = `<svg class="wavy" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path class="wavy-track" pathLength="100" d="${d}"/><path class="wavy-fill" pathLength="100" d="${d}"/></svg>`;
    const fill = container.querySelector('.wavy-fill'); fill.style.strokeDasharray = '100'; fill.style.strokeDashoffset = '100';
    return { set(p) { fill.style.strokeDashoffset = String(100 - Math.max(0, Math.min(100, p))); } };
  }
  window.createWavyProgress = createWavyProgress;

  async function pool(items, n, fn) {
    const results = new Array(items.length);
    let idx = 0;
    async function worker() {
      while (idx < items.length) {
        const cur = idx++;
        results[cur] = await fn(items[cur], cur);
      }
    }
    const workers = Array.from({ length: Math.min(n, items.length) }, () => worker());
    await Promise.all(workers);
    return results;
  }

  const spotifyModal = document.getElementById('spotify-import-modal');
  const btnOpenSpotifyImport = document.getElementById('btn-open-spotify-import');
  const btnCancelSpotifyImport = document.getElementById('btn-cancel-spotify-import');
  const btnConfirmSpotifyImport = document.getElementById('btn-confirm-spotify-import');
  const spotifyImportUrl = document.getElementById('spotify-import-url');
  const spotifyImportTarget = document.getElementById('spotify-import-target');
  const spotifyProgressWrap = document.getElementById('spotify-import-progress-wrap');
  const spotifyWavyContainer = document.getElementById('spotify-import-wavy-container');
  const spotifyProgressLabel = document.getElementById('spotify-import-progress-label');
  const spotifyStatus = document.getElementById('spotify-import-status');
  const spotifyBtnIcon = document.getElementById('spotify-import-btn-icon');
  const spotifyBtnText = document.getElementById('spotify-import-btn-text');

  function openSpotifyImportModal() {
    if (!spotifyModal) return;
    if (spotifyImportUrl) {
      spotifyImportUrl.value = '';
      spotifyImportUrl.disabled = false;
    }
    if (spotifyImportTarget) {
      spotifyImportTarget.disabled = false;
      spotifyImportTarget.innerHTML = '<option value="new">New playlist (Spotify name)</option>';
      state.playlists.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        spotifyImportTarget.appendChild(opt);
      });
    }
    if (spotifyProgressWrap) spotifyProgressWrap.classList.add('hidden');
    if (spotifyWavyContainer) spotifyWavyContainer.innerHTML = '';
    if (spotifyStatus) {
      spotifyStatus.classList.add('hidden');
      spotifyStatus.textContent = '';
      spotifyStatus.style.color = '';
    }
    if (btnConfirmSpotifyImport) {
      btnConfirmSpotifyImport.disabled = false;
      if (spotifyBtnIcon) spotifyBtnIcon.classList.remove('hidden');
      if (spotifyBtnText) spotifyBtnText.textContent = 'Import from Spotify';
      btnConfirmSpotifyImport.dataset.action = 'import';
    }
    if (btnCancelSpotifyImport) btnCancelSpotifyImport.disabled = false;
    openModal(spotifyModal);
    if (spotifyImportUrl) spotifyImportUrl.focus();
  }

  function closeSpotifyImportModal() {
    if (spotifyModal) closeModal(spotifyModal);
  }

  async function handleSpotifyImportAction() {
    if (btnConfirmSpotifyImport && btnConfirmSpotifyImport.dataset.action === 'done') {
      closeSpotifyImportModal();
      return;
    }

    const url = spotifyImportUrl ? spotifyImportUrl.value.trim() : '';
    if (!url) {
      if (spotifyStatus) {
        spotifyStatus.textContent = 'Please enter a Spotify playlist URL';
        spotifyStatus.style.color = 'var(--md-sys-color-error, #ba1a1a)';
        spotifyStatus.classList.remove('hidden');
      }
      return;
    }

    if (spotifyStatus) spotifyStatus.classList.add('hidden');
    if (spotifyImportUrl) spotifyImportUrl.disabled = true;
    if (spotifyImportTarget) spotifyImportTarget.disabled = true;
    if (btnConfirmSpotifyImport) btnConfirmSpotifyImport.disabled = true;
    if (btnCancelSpotifyImport) btnCancelSpotifyImport.disabled = true;

    if (spotifyProgressWrap) spotifyProgressWrap.classList.remove('hidden');
    if (spotifyProgressLabel) spotifyProgressLabel.textContent = '0 / 0';
    const wavy = spotifyWavyContainer ? createWavyProgress(spotifyWavyContainer) : { set() {} };
    wavy.set(0);

    try {
      const res = await fetch(`http://127.0.0.1:${state.serverPort}/api/spotify-import?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      if (!data.success || !Array.isArray(data.tracks) || data.tracks.length === 0) {
        throw new Error(data.error || 'No tracks found in playlist');
      }

      const tracks = data.tracks;
      const total = tracks.length;
      let completed = 0;
      if (spotifyProgressLabel) spotifyProgressLabel.textContent = `0 / ${total}`;

      const results = await pool(tracks, 6, async (t) => {
        const query = `${t.artist} ${t.title}`.trim();
        let resTrack = null;
        try {
          const sRes = await fetch(`http://127.0.0.1:${state.serverPort}/api/search?q=${encodeURIComponent(query)}&platform=youtube&limit=1`);
          const sData = await sRes.json();
          if (sData.success && sData.tracks && sData.tracks[0]) {
            resTrack = sData.tracks[0];
          }
        } catch (e) {}
        completed++;
        wavy.set(Math.round((completed / total) * 100));
        if (spotifyProgressLabel) spotifyProgressLabel.textContent = `${completed} / ${total}`;
        return resTrack;
      });

      const foundTracks = results.filter(Boolean);
      const notFound = total - foundTracks.length;

      const targetVal = spotifyImportTarget ? spotifyImportTarget.value : 'new';
      if (targetVal === 'new') {
        createPlaylist(data.name || 'Spotify Playlist', foundTracks);
      } else {
        const pl = state.playlists.find(p => p.id === targetVal);
        if (pl) {
          const existingIds = new Set(pl.tracks.map(t => t.id));
          const newTracks = foundTracks.filter(t => !existingIds.has(t.id));
          pl.tracks.push(...newTracks);
          localStorage.setItem('devsize_playlists', JSON.stringify(state.playlists));
          renderPlaylistsList();
        }
      }

      if (spotifyProgressWrap) spotifyProgressWrap.classList.add('hidden');
      if (spotifyStatus) {
        spotifyStatus.textContent = notFound > 0
          ? `Imported ${foundTracks.length} of ${total} (${notFound} not found)`
          : `Imported ${foundTracks.length} of ${total}`;
        spotifyStatus.style.color = 'var(--md-sys-color-primary, #6750A4)';
        spotifyStatus.classList.remove('hidden');
      }

      if (btnConfirmSpotifyImport) {
        btnConfirmSpotifyImport.disabled = false;
        if (spotifyBtnIcon) spotifyBtnIcon.classList.add('hidden');
        if (spotifyBtnText) spotifyBtnText.textContent = 'Done';
        btnConfirmSpotifyImport.dataset.action = 'done';
      }
      if (btnCancelSpotifyImport) btnCancelSpotifyImport.disabled = false;
    } catch (err) {
      if (spotifyProgressWrap) spotifyProgressWrap.classList.add('hidden');
      if (spotifyStatus) {
        spotifyStatus.textContent = err.message || 'Failed to import playlist';
        spotifyStatus.style.color = 'var(--md-sys-color-error, #ba1a1a)';
        spotifyStatus.classList.remove('hidden');
      }
      if (spotifyImportUrl) spotifyImportUrl.disabled = false;
      if (spotifyImportTarget) spotifyImportTarget.disabled = false;
      if (btnConfirmSpotifyImport) btnConfirmSpotifyImport.disabled = false;
      if (btnCancelSpotifyImport) btnCancelSpotifyImport.disabled = false;
    }
  }

  if (btnOpenSpotifyImport) btnOpenSpotifyImport.addEventListener('click', openSpotifyImportModal);
  if (btnCancelSpotifyImport) btnCancelSpotifyImport.addEventListener('click', closeSpotifyImportModal);
  if (btnConfirmSpotifyImport) btnConfirmSpotifyImport.addEventListener('click', handleSpotifyImportAction);
  if (spotifyImportUrl) {
    spotifyImportUrl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSpotifyImportAction();
      }
    });
  }

  let trackToDownload = null;
  let selectedFormat = 'mp3';
  let selectedQuality = '0';

  function updateDownloadBtnLabel() {
    if (el.downloadBtnText) {
      el.downloadBtnText.textContent = `Download ${selectedFormat.toUpperCase()}`;
    }
  }

  function updateLosslessQualityState() {
    const isLossless = selectedFormat === 'flac' || selectedFormat === 'wav';
    const qualityGrid = document.getElementById('quality-chips-grid');
    if (qualityGrid) {
      qualityGrid.classList.toggle('disabled', isLossless);
    }
  }

  function openDownloadModal(track) {
    if (!track || !el.downloadModal || ['local','spotify'].includes(track.platform)) return;
    trackToDownload = track;
    if (el.downloadPreviewTitle) el.downloadPreviewTitle.textContent = track.title || 'untitled';
    if (el.downloadPreviewArtist) el.downloadPreviewArtist.textContent = track.artist || 'unknown artist';

    if (track.thumbnail) {
      if (el.downloadPreviewThumb) {
        el.downloadPreviewThumb.src = track.thumbnail;
        el.downloadPreviewThumb.style.display = 'block';
      }
      if (el.downloadPreviewFallback) el.downloadPreviewFallback.style.display = 'none';
    } else {
      if (el.downloadPreviewThumb) el.downloadPreviewThumb.style.display = 'none';
      if (el.downloadPreviewFallback) el.downloadPreviewFallback.style.display = 'flex';
    }

    updateDownloadBtnLabel();
    updateLosslessQualityState();

    const btnDeleteOfflineTrack = document.getElementById('btn-delete-offline-track');
    if (btnDeleteOfflineTrack) {
      btnDeleteOfflineTrack.classList.add('hidden');
      if (track && track.id) {
        fetch(`http://127.0.0.1:${state.serverPort}/api/check-cache?id=${encodeURIComponent(track.id)}`)
          .then(r => r.json())
          .then(res => {
            if (res.cached) {
              btnDeleteOfflineTrack.classList.remove('hidden');
            }
          })
          .catch(() => {});
      }
    }

    openModal(el.downloadModal);
  }

  document.querySelectorAll('.format-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.format-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      selectedFormat = chip.dataset.format;
      updateDownloadBtnLabel();
      updateLosslessQualityState();
    });
  });

  document.querySelectorAll('.quality-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.quality-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      selectedQuality = chip.dataset.quality;
    });
  });

  if (el.btnCloseDownloadModal) {
    el.btnCloseDownloadModal.addEventListener('click', () => {
      if (el.downloadModal) closeModal(el.downloadModal);
    });
  }

  if (el.btnCancelDownload) {
    el.btnCancelDownload.addEventListener('click', () => {
      if (el.downloadModal) closeModal(el.downloadModal);
    });
  }

  if (el.btnPlaybarMore) {
    el.btnPlaybarMore.addEventListener('click', () => {
      if (state.currentTrack && state.currentTrack.platform !== 'local') {
        openDownloadModal(state.currentTrack);
      } else if (!state.currentTrack) {
        showToast('No track currently playing', 'info');
      }
    });
  }

  if (el.btnConfirmDownload) {
    el.btnConfirmDownload.addEventListener('click', async () => {
      if (!trackToDownload) return;
      const t = trackToDownload;

      if (el.downloadBtnText) el.downloadBtnText.textContent = 'Downloading & converting...';
      el.btnConfirmDownload.disabled = true;

      showToast(`Download started: ${t.title} (.${selectedFormat})`, 'info');

      try {
        const downloadUrl = `http://127.0.0.1:${state.serverPort}/api/download?url=${encodeURIComponent(t.url || '')}&title=${encodeURIComponent(t.title || '')}&artist=${encodeURIComponent(t.artist || '')}&format=${selectedFormat}&quality=${selectedQuality}`;
        const res = await fetch(downloadUrl);
        const text = await res.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          throw new Error(text || 'server error');
        }

        if (!data.success) throw new Error(data.error || 'Failed to download');

        showToast(`Download complete: saved to ~/Downloads/${data.filename}`, 'info');
        if (el.downloadModal) closeModal(el.downloadModal);
      } catch (err) {
        console.error('Download error:', err);
        showToast(`Download failed: ${err.message}`, 'error');
      } finally {
        el.btnConfirmDownload.disabled = false;
        updateDownloadBtnLabel();
      }
    });
  }

  updateFavoritesBadge();
  fetch(`http://127.0.0.1:${state.serverPort}/api/library`).then(r => r.json()).then(data => {
    state.localTracks = data;
    updateLocalBadge();
  }).catch(() => {});
  renderPlaylistsList();
  renderPresets();
  syncSettingsSlidersToState();
  applyVisualEffects();

  const analysisCache = new Map();
  let myWaveCurrentTracks = [];
  let isExtendingMyWave = false;

  function getCachedTrackAnalysis(trackId) {
    if (!trackId) return null;
    const cleanId = String(trackId).replace(/[^a-zA-Z0-9_-]/g, '_');
    if (analysisCache.has(cleanId)) return analysisCache.get(cleanId);
    try {
      const stored = localStorage.getItem(`riff_audio_analysis_${cleanId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        analysisCache.set(cleanId, parsed);
        return parsed;
      }
    } catch (e) {}
    return null;
  }

  function setCachedTrackAnalysis(trackId, analysis) {
    if (!trackId || !analysis) return;
    const cleanId = String(trackId).replace(/[^a-zA-Z0-9_-]/g, '_');
    analysisCache.set(cleanId, analysis);
    try {
      localStorage.setItem(`riff_audio_analysis_${cleanId}`, JSON.stringify(analysis));
      fetch(`http://127.0.0.1:${state.serverPort}/api/track-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: cleanId, analysis })
      }).catch(() => {});
    } catch (e) {}
  }

  async function computeTasteProfile() {
    const candidates = [...(state.favorites || []), ...(window.spotifyLibrary?.tracks || []), ...(window.spotifyLibrary?.shelf || []).flatMap(a => a.tracks || []), ...state.history.slice(0,30)];
    const seeds = [...new Map(candidates.map(track => [getTrackCanonicalId(track), track])).values()].slice(0,500);
    const artistCounts = {};
    let cyrillicCount = 0;
    const durations = [];

    seeds.forEach(track => {
      if (track.artist && track.artist.trim()) {
        const a = track.artist.trim();
        artistCounts[a] = (artistCounts[a] || 0) + 1;
      }
      if (track.title && /[\u0400-\u04FF]/.test(track.title)) {
        cyrillicCount++;
      }
      if (track.duration > 0) {
        durations.push(track.duration);
      }
    });

    const sortedArtists = Object.entries(artistCounts)
      .sort((a, b) => b[1] - a[1])
      .map(e => e[0]);

    const dominantScript = cyrillicCount > seeds.length * 0.35 ? 'Cyrillic' : 'Latin';
    const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

    return {
      trackCount: seeds.length,
      topArtists: sortedArtists.slice(0, 5),
      dominantScript,
      avgDuration,
      bpmLabel: null,
      energyLabel: null
    };
  }

  function renderMyWaveChips(profile) {
    const chipsContainer = document.getElementById('my-wave-chips');
    if (chipsContainer) chipsContainer.innerHTML = '';
  }

  function getTrackNormalizedKey(artist, title) {
    let a = String(artist || '').toLowerCase();
    let t = String(title || '').toLowerCase();
    t = t.replace(/\s*\([^)]*official[^)]*\)/gi, '')
         .replace(/\s*\[[^\]]*\]/gi, '')
         .replace(/\s*\([^)]*(video|audio|remaster(ed)?|lyrics?|visualizer)[^)]*\)/gi, '');
    t = t.replace(/\s*(feat\.?|ft\.?)\s+[^(\[-]+/gi, '')
         .replace(/\s*\((feat\.?|ft\.?)[^)]*\)/gi, '');
    a = a.replace(/\s*(feat\.?|ft\.?)\s+.*$/gi, '');
    a = a.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    t = t.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    return `${a}::${t}`;
  }

  let currentWaveFocusedIndex = 0;

  async function extendMyWaveQueue() {
    if (!state.myWaveActive || isExtendingMyWave) return false;
    isExtendingMyWave = true;
    try {
      const profile = await computeTasteProfile();
      const res = await fetch(`http://127.0.0.1:${state.serverPort}/api/vibe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          history: state.history.slice(0, 30),
          favorites: state.favorites.slice(0, 25),
          platform: 'soundcloud',
          limit: 8,
          clientProfile: profile
        })
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.tracks) && data.tracks.length > 0) {
        const existingIds = new Set(state.queue.map(t => getTrackCanonicalId(t)));
        const existingKeys = new Set(state.queue.map(t => getTrackNormalizedKey(t.artist, t.title)));
        const newTracks = data.tracks.filter(t => {
          const cid = getTrackCanonicalId(t);
          const nkey = getTrackNormalizedKey(t.artist, t.title);
          return !existingIds.has(cid) && !existingKeys.has(nkey);
        });
        if (newTracks.length > 0) {
          state.queue.push(...newTracks);
          updateQueueBadge();
          renderQueueView();
          return true;
        }
      }
      return false;
    } catch (e) {
      return false;
    } finally {
      isExtendingMyWave = false;
    }
  }

  const btnPlayMyWave = document.getElementById('btn-play-my-wave');
  if (btnPlayMyWave) {
    btnPlayMyWave.addEventListener('click', async () => {
      if (!myWaveCurrentTracks || myWaveCurrentTracks.length === 0) {
        const profile = await computeTasteProfile();
        if (profile.trackCount < 5) {
          showToast('Play or save 5 tracks to personalize recommendations');
          return;
        }
        await loadHomePage();
      }
      if (myWaveCurrentTracks && myWaveCurrentTracks.length > 0) {
        state.myWaveActive = true;
        const startIdx = (currentWaveFocusedIndex >= 0 && currentWaveFocusedIndex < myWaveCurrentTracks.length) ? currentWaveFocusedIndex : 0;
        playTrack(myWaveCurrentTracks[startIdx], [...myWaveCurrentTracks], startIdx);
        showToast('Playing My Wave');
      }
    });
  }

  if (el.btnRefreshVibe) {
    el.btnRefreshVibe.addEventListener('click', loadHomePage);
  }

  let homeRequestSequence = 0;
  async function loadHomePage() {
    const request = ++homeRequestSequence;
    renderHomePlaylists();
    const quickRow = document.getElementById('home-quick-play-row');
    const seen = new Set();
    const recent = state.history.filter(track => {
      const id = getTrackCanonicalId(track);
      if (seen.has(id)) return false;
      seen.add(id); return true;
    }).slice(0, 6);
    const artwork = track => safeMediaURL(getTrackThumbUrl(track)) || 'assets/artwork-placeholder.svg';
    function makeTrackButton(track, className, queue, index) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = className;
      button.title = (track.title || 'Untitled') + ' — ' + (track.artist || 'Unknown artist');
      const image = document.createElement('img');
      image.className = 'home-track-art'; image.alt = ''; image.src = artwork(track); image.loading = 'lazy';
      image.addEventListener('error', () => {image.src = 'assets/artwork-placeholder.svg';}, {once:true});
      const text = document.createElement('span'); text.className = 'home-track-text';
      const title = document.createElement('span'); title.className = 'home-track-title'; title.textContent = track.title || 'Untitled';
      const artist = document.createElement('span'); artist.className = 'home-track-artist'; artist.textContent = track.artist || 'Unknown artist';
      text.append(title,artist); button.append(image,text);
      button.addEventListener('click', () => {
        state.myWaveActive = className === 'my-wave-track-card';
        if (state.myWaveActive) currentWaveFocusedIndex = index;
        playTrack(track, queue, index);
      });
      button.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault(); event.stopPropagation();
        if (!event.repeat) button.click();
      });
      return button;
    }
    if (quickRow) {
      quickRow.replaceChildren();
      if (!recent.length) {
        const empty = document.createElement('p'); empty.className = 'home-empty-card';
        empty.textContent = 'Play a song to find it here next time.'; quickRow.append(empty);
      } else recent.forEach((track,index) => quickRow.append(makeTrackButton(track,'quick-play-pill',recent,index)));
    }
    const section = document.getElementById('section-my-wave');
    section.hidden = !getAdv('my_wave',true);
    if (section.hidden) return;
    const grid = document.getElementById('home-vibe-grid');
    const play = document.getElementById('btn-play-my-wave');
    play.disabled = true; myWaveCurrentTracks = [];
    grid.setAttribute('aria-busy','true'); grid.replaceChildren();
    for (let index=0;index<4;index++) {
      const skeleton = document.createElement('div'); skeleton.className = 'home-track-skeleton skeleton-shimmer'; skeleton.setAttribute('aria-hidden','true'); grid.append(skeleton);
    }
    function empty(message) {
      const hint = document.createElement('p'); hint.className = 'vibe-empty-hint'; hint.setAttribute('role','status'); hint.textContent = message;
      grid.replaceChildren(hint);
    }
    try {
      const profile = await computeTasteProfile();
      if (request !== homeRequestSequence) return;
      if (profile.trackCount < 5) {empty('Play or save 5 tracks to personalize your recommendations.'); return;}
      const response = await fetch(`http://127.0.0.1:${state.serverPort}/api/vibe`, {
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({history:state.history.slice(0,30),favorites:state.favorites.slice(0,25),platform:'soundcloud',limit:10,clientProfile:profile})
      });
      const data = await response.json();
      if (request !== homeRequestSequence) return;
      if (!data.success || !Array.isArray(data.tracks) || !data.tracks.length) {empty('No recommendations yet. Try refreshing or play a few more songs.'); return;}
      const ids = new Set();
      myWaveCurrentTracks = data.tracks.filter(track => {const id=getTrackCanonicalId(track);if(ids.has(id))return false;ids.add(id);return true;});
      currentWaveFocusedIndex = 0;
      grid.replaceChildren();
      myWaveCurrentTracks.forEach((track,index) => grid.append(makeTrackButton(track,'my-wave-track-card',[...myWaveCurrentTracks],index)));
      play.disabled = !myWaveCurrentTracks.length;
    } catch (error) {
      if (request === homeRequestSequence) empty('Recommendations are unavailable. Use Refresh to try again.');
    } finally {
      if (request === homeRequestSequence) grid.setAttribute('aria-busy','false');
    }
  }

  const cacheModal = document.getElementById('cache-modal');
  const cacheModalCard = document.querySelector('.cache-modal-card');
  const btnCancelCache = document.getElementById('btn-cancel-cache');
  const btnConfirmClearCache = document.getElementById('btn-confirm-clear-cache');
  const cacheAudioSize = document.getElementById('cache-audio-size');
  const cacheWebSize = document.getElementById('cache-web-size');

  const CACHE_BAR_MAX_BYTES = 4 * 1024 * 1024 * 1024;
  const CACHE_BAR_SAFE_STOP = 0.25;
  const CACHE_BAR_DANGER_STOP = 0.75;
  const CACHE_BAR_MIN_VISIBLE_PX = 4;

  const cacheBars = {
    audio: { canvas: document.getElementById('cache-audio-bar'), current: 0, from: 0, to: 0, t0: 0, dur: 0 },
    web: { canvas: document.getElementById('cache-web-bar'), current: 0, from: 0, to: 0, t0: 0, dur: 0 }
  };
  let cacheRafId = 0;
  let cachePhase = 0;
  let cacheSpeed = 0.06;
  let cacheTargetSpeed = 0.06;
  let cacheBusy = false;
  let cacheColors = { primary: '#6750A4', dim: '#E6E0E9', warn: '#F9A825', error: '#B3261E' };

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function animateValue(obj, start, end, duration) {
    let startTimestamp = null;
    const step = (timestamp) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      obj.textContent = formatBytes(Math.floor(progress * (end - start) + start));
      if (progress < 1) {
        window.requestAnimationFrame(step);
      }
    };
    window.requestAnimationFrame(step);
  }

  const cacheWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function readCacheColors() {
    const rootStyle = getComputedStyle(document.documentElement);
    return {
      primary: rootStyle.getPropertyValue('--md-sys-color-primary').trim() || '#6750A4',
      dim: rootStyle.getPropertyValue('--md-sys-color-surface-container-highest-solid').trim() || '#E6E0E9',
      warn: '#F9A825',
      error: rootStyle.getPropertyValue('--md-sys-color-error').trim() || '#B3261E'
    };
  }

  function setCacheBarTarget(bar, bytes, duration) {
    bar.from = bar.current;
    bar.to = bytes;
    bar.t0 = performance.now();
    bar.dur = duration;
  }

  function drawCacheBar(canvas, bytes, phase) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const lineW = 6;
    const pad = lineW / 2;
    const centerY = h / 2;
    const usable = Math.max(1, w - lineW);

    ctx.lineWidth = lineW;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(pad, centerY);
    ctx.lineTo(w - pad, centerY);
    ctx.strokeStyle = cacheColors.dim;
    ctx.stroke();

    if (bytes <= 0) return;
    const frac = Math.min(1, Math.max(0, bytes / CACHE_BAR_MAX_BYTES));
    const fillW = Math.max(frac * usable, CACHE_BAR_MIN_VISIBLE_PX);
    const endX = pad + fillW;

    const grad = ctx.createLinearGradient(pad, 0, w - pad, 0);
    grad.addColorStop(0, cacheColors.primary);
    grad.addColorStop(CACHE_BAR_SAFE_STOP, cacheColors.primary);
    grad.addColorStop((CACHE_BAR_SAFE_STOP + CACHE_BAR_DANGER_STOP) / 2, cacheColors.warn);
    grad.addColorStop(CACHE_BAR_DANGER_STOP, cacheColors.error);
    grad.addColorStop(1, cacheColors.error);

    const amplitude = 4;
    const freq = 0.12;
    ctx.beginPath();
    for (let x = pad; x <= endX; x++) {
      const distFromEnd = endX - x;
      const damping = Math.min(1, distFromEnd / 14);
      const distFromStart = x - pad;
      const startDamping = Math.min(1, distFromStart / 14);
      const snakeWave = Math.sin(x * freq - phase) + 0.4 * Math.sin(x * freq * 0.5 - phase * 1.5);
      const y = centerY + snakeWave * (amplitude * damping * startDamping);
      if (x === pad) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = grad;
    ctx.stroke();
  }

  function cacheFrame(now) {
    cacheSpeed += (cacheTargetSpeed - cacheSpeed) * 0.08;
    cachePhase += cacheSpeed;
    Object.keys(cacheBars).forEach((key) => {
      const bar = cacheBars[key];
      if (bar.dur > 0) {
        const p = Math.min(1, (now - bar.t0) / bar.dur);
        const ease = 1 - Math.pow(1 - p, 3);
        bar.current = bar.from + (bar.to - bar.from) * ease;
        if (p >= 1) bar.dur = 0;
      }
      drawCacheBar(bar.canvas, bar.current, cachePhase);
    });
    cacheRafId = requestAnimationFrame(cacheFrame);
  }

  function closeCacheModal() {
    if (!cacheModal) return;
    cacheModal.classList.remove('visible');
    setTimeout(() => {
      if (cacheModal.classList.contains('visible')) return;
      cacheModal.classList.add('hidden');
      if (cacheRafId) {
        cancelAnimationFrame(cacheRafId);
        cacheRafId = 0;
      }
      if (cacheModalCard) cacheModalCard.classList.remove('cleaning', 'finishing', 'done');
      if (btnConfirmClearCache) btnConfirmClearCache.disabled = false;
      if (btnCancelCache) btnCancelCache.disabled = false;
    }, 200);
  }

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('#btn-open-clear-cache');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    if (!cacheModal || cacheBusy) return;

    cacheColors = readCacheColors();
    cacheSpeed = 0.06;
    cacheTargetSpeed = 0.06;
    Object.keys(cacheBars).forEach((key) => {
      const bar = cacheBars[key];
      bar.current = 0;
      bar.from = 0;
      bar.to = 0;
      bar.dur = 0;
    });
    if (cacheAudioSize) { cacheAudioSize.textContent = 'calculating...'; cacheAudioSize.dataset.val = '0'; }
    if (cacheWebSize) { cacheWebSize.textContent = 'calculating...'; cacheWebSize.dataset.val = '0'; }

    cacheModal.classList.remove('hidden');
    requestAnimationFrame(() => cacheModal.classList.add('visible'));
    if (!cacheRafId) cacheRafId = requestAnimationFrame(cacheFrame);

    let sizes = { audio: 0, web: 0 };
    try {
      if (window.electronAPI && window.electronAPI.getCacheSize) {
        sizes = await window.electronAPI.getCacheSize();
      }
    } catch (err) {
      console.warn('getCacheSize failed', err);
    }
    if (cacheAudioSize) { cacheAudioSize.textContent = formatBytes(sizes.audio); cacheAudioSize.dataset.val = String(sizes.audio); }
    if (cacheWebSize) { cacheWebSize.textContent = formatBytes(sizes.web); cacheWebSize.dataset.val = String(sizes.web); }
    setCacheBarTarget(cacheBars.audio, sizes.audio, 900);
    setCacheBarTarget(cacheBars.web, sizes.web, 900);
  });

  if (btnCancelCache) {
    btnCancelCache.addEventListener('click', () => {
      if (cacheBusy) return;
      closeCacheModal();
    });
  }

  if (btnConfirmClearCache) {
    btnConfirmClearCache.addEventListener('click', async () => {
      if (cacheBusy) return;
      cacheBusy = true;
      btnConfirmClearCache.disabled = true;
      if (btnCancelCache) btnCancelCache.disabled = true;

      cacheModalCard.classList.add('cleaning');
      cacheTargetSpeed = 0.2;

      const startAudio = parseInt(cacheAudioSize.dataset.val || '0', 10);
      const startWeb = parseInt(cacheWebSize.dataset.val || '0', 10);
      animateValue(cacheAudioSize, startAudio, 0, 1500);
      animateValue(cacheWebSize, startWeb, 0, 1500);
      setCacheBarTarget(cacheBars.audio, 0, 1500);
      setCacheBarTarget(cacheBars.web, 0, 1500);

      const startedAt = Date.now();
      try {
        await window.electronAPI.clearCache();
      } catch (err) {
        console.warn('clearCache failed', err);
      }
      await cacheWait(Math.max(0, 1500 - (Date.now() - startedAt)));

      cacheModalCard.classList.add('finishing');
      cacheTargetSpeed = 0;
      await cacheWait(350);

      cacheModalCard.classList.remove('cleaning', 'finishing');
      cacheModalCard.classList.add('done');
      cacheAudioSize.dataset.val = '0';
      cacheWebSize.dataset.val = '0';
      await cacheWait(1200);

      cacheBusy = false;
      closeCacheModal();
    });
  }

  async function updateOfflineStorageUI() {
    const elSize = document.getElementById('offline-library-size');
    if (!elSize) return;
    try {
      const res = await fetch(`http://127.0.0.1:${state.serverPort}/api/offline-library`);
      const data = await res.json();
      if (data && data.success) {
        elSize.textContent = `${data.count} track${data.count === 1 ? '' : 's'} (${formatBytes(data.totalBytes)})`;
      } else {
        elSize.textContent = '0 tracks (0 B)';
      }
    } catch (e) {
      elSize.textContent = 'Unavailable';
    }
  }

  const btnDeleteOfflineTrack = document.getElementById('btn-delete-offline-track');
  if (btnDeleteOfflineTrack) {
    btnDeleteOfflineTrack.addEventListener('click', async () => {
      if (!trackToDownload || !trackToDownload.id) return;
      try {
        await fetch(`http://127.0.0.1:${state.serverPort}/api/offline-delete?id=${encodeURIComponent(trackToDownload.id)}`, { method: 'POST' });
        showToast('Track removed from offline cache');
        updateOfflineStorageUI();
        if (el.downloadModal) closeModal(el.downloadModal);
      } catch (e) {
        showToast('Failed to delete offline track');
      }
    });
  }

  const btnClearOffline = document.getElementById('btn-clear-offline');
  const clearOfflineModal = document.getElementById('clear-offline-modal');
  const btnCancelClearOffline = document.getElementById('btn-cancel-clear-offline');
  const btnConfirmClearOffline = document.getElementById('btn-confirm-clear-offline');

  if (btnClearOffline && clearOfflineModal) {
    btnClearOffline.addEventListener('click', () => {
      openModal(clearOfflineModal);
    });
  }
  if (btnCancelClearOffline && clearOfflineModal) {
    btnCancelClearOffline.addEventListener('click', () => {
      closeModal(clearOfflineModal);
    });
  }
  if (btnConfirmClearOffline && clearOfflineModal) {
    btnConfirmClearOffline.addEventListener('click', async () => {
      try {
        await fetch(`http://127.0.0.1:${state.serverPort}/api/clear-offline-library`, { method: 'POST' });
        showToast('Offline library cleared');
        updateOfflineStorageUI();
      } catch (e) {
        showToast('Failed to clear offline library');
      }
      closeModal(clearOfflineModal);
    });
  }

  let toolsPollInterval = null;
  let toolsWavyYt = null;
  let toolsWavyFf = null;

  const STATUS_ICONS = {
    pending: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--md-sys-color-outline);"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    downloading: '<svg class="g-spinner" style="width: 18px; height: 18px;" viewBox="0 0 48 48"><circle cx="24" cy="24" r="20"/></svg>',
    done: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color: #4cd964;"><polyline points="20 6 9 17 4 12"/></svg>',
    error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--md-sys-color-error, #ff5449);"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
  };

  function updateToolsUI(data) {
    // FFmpeg and FFprobe are installed together and both are needed by yt-dlp.
    data = { ...data, ffmpeg: data.ffmpeg && data.ffprobe !== false };
    const statusText = document.getElementById('tools-status-text');
    const btnInstall = document.getElementById('btn-install-tools');
    if (!data) return;

    const prog = data.progress || {};
    const status = prog.status || 'idle';
    const tool = prog.tool || '';
    const pct = typeof prog.percent === 'number' ? prog.percent : 0;
    const errorMsg = prog.error || '';

    let ytdlpStatus = 'pending';
    let ffmpegStatus = 'pending';
    let activeTool = null;
    let activePercent = 0;

    if (status === 'done' || (data.ytDlp && data.ffmpeg)) {
      ytdlpStatus = 'done';
      ffmpegStatus = 'done';
    } else if (status === 'error') {
      if (tool === 'yt-dlp') {
        ytdlpStatus = 'error';
        ffmpegStatus = 'pending';
      } else if (tool === 'ffmpeg') {
        ytdlpStatus = 'done';
        ffmpegStatus = 'error';
      } else {
        ytdlpStatus = data.ytDlp ? 'done' : 'error';
        ffmpegStatus = data.ffmpeg ? 'done' : 'error';
      }
    } else if (status === 'downloading') {
      if (tool === 'yt-dlp') {
        ytdlpStatus = 'downloading';
        ffmpegStatus = 'pending';
        activeTool = 'yt-dlp';
        activePercent = pct;
      } else if (tool === 'ffmpeg') {
        ytdlpStatus = 'done';
        ffmpegStatus = 'downloading';
        activeTool = 'ffmpeg';
        activePercent = pct;
      }
    } else {
      ytdlpStatus = data.ytDlp ? 'done' : 'pending';
      ffmpegStatus = data.ffmpeg ? 'done' : 'pending';
    }

    const iconYt = document.getElementById('tools-icon-ytdlp');
    const iconFf = document.getElementById('tools-icon-ffmpeg');
    if (iconYt) iconYt.innerHTML = STATUS_ICONS[ytdlpStatus] || STATUS_ICONS.pending;
    if (iconFf) iconFf.innerHTML = STATUS_ICONS[ffmpegStatus] || STATUS_ICONS.pending;

    const pctYt = document.getElementById('tools-pct-ytdlp');
    const pctFf = document.getElementById('tools-pct-ffmpeg');
    if (pctYt) {
      pctYt.textContent = ytdlpStatus === 'downloading' ? `${activePercent}%` : (ytdlpStatus === 'done' ? 'Ready' : (ytdlpStatus === 'error' ? 'Failed' : ''));
    }
    if (pctFf) {
      pctFf.textContent = ffmpegStatus === 'downloading' ? `${activePercent}%` : (ffmpegStatus === 'done' ? 'Ready' : (ffmpegStatus === 'error' ? 'Failed' : ''));
    }

    const wrapYt = document.getElementById('tools-wavy-ytdlp');
    const wrapFf = document.getElementById('tools-wavy-ffmpeg');
    if (activeTool === 'yt-dlp') {
      if (wrapYt) {
        wrapYt.style.display = 'block';
        wrapYt.style.setProperty('--tools-progress', activePercent.toString());
        if (!toolsWavyYt && typeof createWavyProgress === 'function') toolsWavyYt = createWavyProgress(wrapYt);
        if (toolsWavyYt) toolsWavyYt.set(activePercent);
      }
      if (wrapFf) wrapFf.style.display = 'none';
    } else if (activeTool === 'ffmpeg') {
      if (wrapYt) wrapYt.style.display = 'none';
      if (wrapFf) {
        wrapFf.style.display = 'block';
        wrapFf.style.setProperty('--tools-progress', activePercent.toString());
        if (!toolsWavyFf && typeof createWavyProgress === 'function') toolsWavyFf = createWavyProgress(wrapFf);
        if (toolsWavyFf) toolsWavyFf.set(activePercent);
      }
    } else {
      if (wrapYt) wrapYt.style.display = 'none';
      if (wrapFf) wrapFf.style.display = 'none';
    }

    const errEl = document.getElementById('tools-error-msg');
    const btnDownload = document.getElementById('btn-confirm-install-tools');
    const btnRetry = document.getElementById('btn-retry-tools');
    const btnDismiss = document.getElementById('btn-dismiss-tools-modal');

    if (errEl) {
      if (status === 'error' && errorMsg) {
        errEl.textContent = errorMsg;
        errEl.style.display = 'block';
      } else {
        errEl.style.display = 'none';
      }
    }

    if (status === 'error') {
      if (btnRetry) btnRetry.style.display = 'inline-flex';
      if (btnDownload) btnDownload.style.display = 'none';
      if (btnDismiss) btnDismiss.textContent = 'Close';
    } else if (status === 'downloading') {
      if (btnRetry) btnRetry.style.display = 'none';
      if (btnDownload) {
        btnDownload.style.display = 'inline-flex';
        btnDownload.disabled = true;
        btnDownload.textContent = 'Downloading...';
      }
      if (btnDismiss) btnDismiss.textContent = 'Not now';
    } else if (status === 'done' || (data.ytDlp && data.ffmpeg)) {
      if (btnRetry) btnRetry.style.display = 'none';
      if (btnDownload) btnDownload.style.display = 'none';
      if (btnDismiss) btnDismiss.textContent = 'Close';
    } else {
      if (btnRetry) btnRetry.style.display = 'none';
      if (btnDownload) {
        btnDownload.style.display = 'inline-flex';
        btnDownload.disabled = false;
        btnDownload.textContent = 'Download';
      }
      if (btnDismiss) btnDismiss.textContent = 'Not now';
    }

    if (statusText) {
      if (status === 'downloading') {
        statusText.textContent = `Downloading ${tool || 'tools'} ${pct}%`;
        if (btnInstall) {
          btnInstall.classList.remove('hidden');
          btnInstall.disabled = true;
        }
      } else if (data.ytDlp && data.ffmpeg) {
        statusText.textContent = 'Installed';
        if (btnInstall) {
          btnInstall.classList.add('hidden');
          btnInstall.disabled = false;
        }
      } else {
        const missing = [];
        if (!data.ytDlp) missing.push('yt-dlp');
        if (!data.ffmpeg) missing.push('ffmpeg');
        statusText.textContent = `Missing: ${missing.join(', ')}`;
        if (btnInstall) {
          btnInstall.classList.remove('hidden');
          btnInstall.disabled = false;
        }
      }
    }
  }

  function pollToolsStatus() {
    if (toolsPollInterval) return;
    toolsPollInterval = setInterval(async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${state.serverPort}/api/tools-status`);
        const data = await res.json();
        updateToolsUI(data);
        if (data.progress && (data.progress.status === 'done' || data.progress.status === 'error')) {
          clearInterval(toolsPollInterval);
          toolsPollInterval = null;
        }
      } catch (e) {}
    }, 500);
  }

  function startToolsInstall() {
    const btnInstall = document.getElementById('btn-install-tools');
    if (btnInstall) btnInstall.disabled = true;

    const modal = document.getElementById('tools-install-modal');
    if (modal) openModal(modal);

    const errEl = document.getElementById('tools-error-msg');
    if (errEl) errEl.style.display = 'none';
    const btnRetry = document.getElementById('btn-retry-tools');
    if (btnRetry) btnRetry.style.display = 'none';
    const btnDownload = document.getElementById('btn-confirm-install-tools');
    if (btnDownload) {
      btnDownload.style.display = 'inline-flex';
      btnDownload.disabled = true;
      btnDownload.textContent = 'Downloading...';
    }

    fetch(`http://127.0.0.1:${state.serverPort}/api/tools-install`, { method: 'POST' }).catch(() => {});
    pollToolsStatus();
  }

  async function checkToolsStatus(promptUser = false) {
    if (!state.serverPort) return;
    try {
      const res = await fetch(`http://127.0.0.1:${state.serverPort}/api/tools-status`);
      const data = await res.json();
      updateToolsUI(data);

      if (data.progress && data.progress.status === 'downloading') {
        pollToolsStatus();
      } else if (promptUser && (!data.ytDlp || !data.ffmpeg || data.ffprobe === false)) {
        if (!sessionStorage.getItem('riff_tools_prompt_dismissed')) {
          const modal = document.getElementById('tools-install-modal');
          if (modal) openModal(modal);
        }
      }
    } catch (e) {}
  }

  const btnInstallTools = document.getElementById('btn-install-tools');
  if (btnInstallTools) {
    btnInstallTools.addEventListener('click', () => {
      startToolsInstall();
    });
  }

  const toolsModal = document.getElementById('tools-install-modal');
  const btnConfirmInstallTools = document.getElementById('btn-confirm-install-tools');
  const btnDismissToolsModal = document.getElementById('btn-dismiss-tools-modal');
  const btnCloseToolsModal = document.getElementById('btn-close-tools-modal');
  const btnRetryTools = document.getElementById('btn-retry-tools');

  if (btnConfirmInstallTools) {
    btnConfirmInstallTools.addEventListener('click', () => {
      startToolsInstall();
    });
  }

  if (btnRetryTools) {
    btnRetryTools.addEventListener('click', () => {
      startToolsInstall();
    });
  }

  if (btnDismissToolsModal && toolsModal) {
    btnDismissToolsModal.addEventListener('click', () => {
      sessionStorage.setItem('riff_tools_prompt_dismissed', '1');
      closeModal(toolsModal);
    });
  }

  if (btnCloseToolsModal && toolsModal) {
    btnCloseToolsModal.addEventListener('click', () => {
      sessionStorage.setItem('riff_tools_prompt_dismissed', '1');
      closeModal(toolsModal);
    });
  }



  const btnOpenShortcuts = document.getElementById('btn-open-shortcuts');
  const shortcutsModal = document.getElementById('shortcuts-modal');
  const btnCloseShortcutsModal = document.getElementById('btn-close-shortcuts-modal');
  if (btnOpenShortcuts && shortcutsModal) btnOpenShortcuts.addEventListener('click', () => openModal(shortcutsModal));
  if (btnCloseShortcutsModal && shortcutsModal) btnCloseShortcutsModal.addEventListener('click', () => closeModal(shortcutsModal));

  let trackArtCurrentTrack = null;

  function onTrackArtUpdated(track) {
    if (!track) return;

    const currentCover = getTrackThumbUrl(track);
    if (currentCover) coverAnalysisCache.delete(currentCover);
    if (track.thumbnail) coverAnalysisCache.delete(track.thumbnail);
    const art = getTrackArt(track);
    if (art.cover) coverAnalysisCache.delete(art.cover);

    if (track.id) {
      const cleanId = String(track.id).replace(/[^a-zA-Z0-9_-]/g, '_');
      if (typeof analysisCache !== 'undefined' && analysisCache.delete) {
        analysisCache.delete(cleanId);
      }
    }

    if (state.currentTrack && isSameTrack(state.currentTrack, track)) {
      const thumb = getTrackThumbUrl(state.currentTrack);
      if (thumb) {
        if (el.playbarArtwork) {
          el.playbarArtwork.src = thumb;
          el.playbarArtwork.style.display = 'block';
        }
        if (el.artworkFallback) el.artworkFallback.style.display = 'none';
        if (el.rightPanelCover) {
          el.rightPanelCover.src = thumb;
          el.rightPanelCover.style.display = 'block';
        }
        if (el.rightPanelFallback) el.rightPanelFallback.style.display = 'none';
      }
      updateRightPanelBanner(thumb);
      updateMediaSession();
      updateThemeFromState();
    }

    const canonical = getTrackCanonicalId(track);
    document.querySelectorAll('.track-row').forEach(row => {
      if (row.dataset && row.dataset.canonicalId === canonical) {
        const img = row.querySelector('.track-row-thumb');
        if (img) img.src = getTrackThumbUrl(track);
      }
    });
  }

  function renderTrackArtModal() {
    if (!trackArtCurrentTrack) return;
    const t = trackArtCurrentTrack;
    const titleEl = document.getElementById('track-art-modal-title');
    if (titleEl) titleEl.textContent = `Art: ${t.title || 'Untitled'}`;

    const art = getTrackArt(t);

    const coverImg = document.getElementById('track-art-cover-img');
    const coverPh = document.getElementById('track-art-cover-placeholder');
    const coverStatus = document.getElementById('track-art-cover-status');
    const activeCover = art.cover || t.thumbnail || '';
    if (activeCover) {
      if (coverImg) {
        coverImg.src = activeCover;
        coverImg.style.display = 'block';
      }
      if (coverPh) coverPh.style.display = 'none';
    } else {
      if (coverImg) coverImg.style.display = 'none';
      if (coverPh) coverPh.style.display = 'block';
    }
    if (coverStatus) coverStatus.textContent = art.cover ? 'Custom cover' : 'Default art';

    const bannerImg = document.getElementById('track-art-banner-img');
    const bannerVid = document.getElementById('track-art-banner-vid');
    const bannerPh = document.getElementById('track-art-banner-placeholder');
    const bannerStatus = document.getElementById('track-art-banner-status');
    const activeBanner = art.banner || localStorage.getItem('riff_banner_media') || activeCover;
    const isVideo = activeBanner && /\.(mp4|webm)($|\?)/i.test(activeBanner);

    if (activeBanner) {
      if (isVideo) {
        if (bannerImg) bannerImg.style.display = 'none';
        if (bannerVid) {
          bannerVid.src = activeBanner;
          bannerVid.style.display = 'block';
        }
      } else {
        if (bannerVid) bannerVid.style.display = 'none';
        if (bannerImg) {
          bannerImg.src = activeBanner;
          bannerImg.style.display = 'block';
        }
      }
      if (bannerPh) bannerPh.style.display = 'none';
    } else {
      if (bannerImg) bannerImg.style.display = 'none';
      if (bannerVid) bannerVid.style.display = 'none';
      if (bannerPh) bannerPh.style.display = 'block';
    }
    if (bannerStatus) bannerStatus.textContent = art.banner ? 'Custom banner' : (localStorage.getItem('riff_banner_media') ? 'Global banner' : 'Default art');
  }

  function openTrackArtModal(track, triggerEl = null) {
    if (!track) return;
    trackArtCurrentTrack = track;
    const modal = document.getElementById('track-art-modal');
    if (!modal) return;
    renderTrackArtModal();
    const card = modal.querySelector('.dialog-card') || modal;
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
      modal.classList.add('visible');
      if (window.LiquidMotion) {
        LiquidMotion.open(card, triggerEl, 'y');
      }
    });
  }
  window.openTrackArtModal = openTrackArtModal;

  function closeTrackArtModal() {
    const modal = document.getElementById('track-art-modal');
    if (!modal) return;
    const card = modal.querySelector('.dialog-card') || modal;
    if (window.LiquidMotion) {
      LiquidMotion.close(card, () => {
        modal.classList.remove('visible');
        modal.classList.add('hidden');
      });
    } else {
      closeModal(modal);
    }
  }

  const trackArtModal = document.getElementById('track-art-modal');
  const btnCloseTrackArtModal = document.getElementById('btn-close-track-art-modal');
  const btnChooseTrackCover = document.getElementById('btn-choose-track-cover');
  const btnResetTrackCover = document.getElementById('btn-reset-track-cover');
  const btnChooseTrackBanner = document.getElementById('btn-choose-track-banner');
  const btnResetTrackBanner = document.getElementById('btn-reset-track-banner');
  const btnRightPanelArt = document.getElementById('btn-right-panel-art');

  if (btnRightPanelArt) {
    btnRightPanelArt.addEventListener('click', () => {
      if (state.currentTrack) {
        openTrackArtModal(state.currentTrack, btnRightPanelArt);
      }
    });
  }

  if (btnCloseTrackArtModal) {
    btnCloseTrackArtModal.addEventListener('click', closeTrackArtModal);
  }

  if (trackArtModal) {
    trackArtModal.addEventListener('click', (e) => {
      if (e.target === trackArtModal) closeTrackArtModal();
    });
  }

  const isImageFile = (u) => /\.(png|jpe?g|webp|gif)($|\?)/i.test(u);
  const isMediaFile = (u) => /\.(png|jpe?g|webp|gif|mp4|webm)($|\?)/i.test(u);

  if (btnChooseTrackCover) {
    btnChooseTrackCover.addEventListener('click', async () => {
      if (!trackArtCurrentTrack) return;
      if (window.electronAPI && window.electronAPI.pickMedia) {
        const url = await window.electronAPI.pickMedia();
        if (url) {
          if (!isImageFile(url)) {
            showToast('Cover must be an image (PNG, JPG, WebP, GIF)');
            return;
          }
          setTrackArt(trackArtCurrentTrack, { cover: url });
          onTrackArtUpdated(trackArtCurrentTrack);
          renderTrackArtModal();
        }
      }
    });
  }

  if (btnResetTrackCover) {
    btnResetTrackCover.addEventListener('click', () => {
      if (!trackArtCurrentTrack) return;
      setTrackArt(trackArtCurrentTrack, { cover: undefined });
      onTrackArtUpdated(trackArtCurrentTrack);
      renderTrackArtModal();
    });
  }

  if (btnChooseTrackBanner) {
    btnChooseTrackBanner.addEventListener('click', async () => {
      if (!trackArtCurrentTrack) return;
      if (window.electronAPI && window.electronAPI.pickMedia) {
        const url = await window.electronAPI.pickMedia();
        if (url) {
          if (!isMediaFile(url)) {
            showToast('Banner must be image or video (PNG, JPG, WebP, GIF, MP4, WebM)');
            return;
          }
          setTrackArt(trackArtCurrentTrack, { banner: url });
          onTrackArtUpdated(trackArtCurrentTrack);
          renderTrackArtModal();
        }
      }
    });
  }

  if (btnResetTrackBanner) {
    btnResetTrackBanner.addEventListener('click', () => {
      if (!trackArtCurrentTrack) return;
      setTrackArt(trackArtCurrentTrack, { banner: undefined });
      onTrackArtUpdated(trackArtCurrentTrack);
      renderTrackArtModal();
    });
  }

  try {
    const resume = readJSON('cuda_spotify_resume',null);
    if (resume?.track?.platform==='spotify' && /^spotify:track:[a-zA-Z0-9]{22}$/.test(resume.track.uri||resume.track.url||'')) {
      state.currentTrack={...resume.track,resumePosition:Math.max(0,Number(resume.position)||0)};
      spotifyPosition=state.currentTrack.resumePosition;updateNowPlayingUI(state.currentTrack);
      state.queue=[state.currentTrack];state.queueIndex=0;updateQueueBadge();
    }
  } catch {}
  loadHomePage();
  resizeCanvases();
  updateOfflineStorageUI();
  checkToolsStatus(false);
  setLyricsEmpty(true);
  updateLyricsTranslationUI();
  showSettingsCategory(localStorage.getItem('riff_settings_cat') || 'appearance');

  if (localStorage.getItem('riff_perf_mode') === null && window.electronAPI && window.electronAPI.getGpuCompositing) {
    window.electronAPI.getGpuCompositing().then((status) => {
      if (status && !status.startsWith('enabled')) {
        localStorage.setItem('riff_perf_mode', '1');
        applyPerfMode(true);
        if (btnPerfMode) btnPerfMode.classList.add('active');
        showToast('Performance mode enabled: no GPU acceleration detected. You can turn it off in Settings');
      }
    }).catch(() => {});
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const btnCollapseRightPanel = document.getElementById('btn-collapse-right-panel');
  const rightPanel = document.getElementById('right-panel');
  if (btnCollapseRightPanel && rightPanel) {
    btnCollapseRightPanel.addEventListener('click', () => {
      rightPanel.classList.toggle('is-collapsed');
    });
  }
});


