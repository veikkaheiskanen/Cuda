/* UI enhancements preserve the player and its data. */
(() => {
  'use strict';
  // Electron sets nativeTheme before this window is created. Match it on first paint.
  document.documentElement.dataset.appearance = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  // A single migration removes decorative opacity settings that made text unreadable.
  if (localStorage.getItem('riff_glass_version') !== '1') {
    for (const [key, value] of Object.entries({ riff_theme_mode: 'light', riff_theme_accent: '#1466bc', riff_ui_alpha: '100', riff_text_alpha: '100', riff_mesh_brightness: '0', riff_wavy_progress: 'false', riff_show_local: 'true', riff_glass_version: '1' })) localStorage.setItem(key, value);
  }
  document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);
    const mini = $('btn-mini-player'), miniHome = mini.parentElement;
    function placeMini() { const home = document.body.classList.contains('mini') ? miniHome : document.querySelector('.top-nav'); if (mini.parentElement !== home) home.append(mini); }
    new MutationObserver(placeMini).observe(document.body,{attributes:true,attributeFilter:['class']});
    placeMini();
    const applyFrame = frame => document.documentElement.style.setProperty('--window-corner',frame.cornerRadius+'px');
    window.electronAPI?.onWindowFrame(applyFrame);
    window.electronAPI?.getWindowFrame().then(applyFrame);
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const transparency = matchMedia('(prefers-reduced-transparency: reduce)');
    const contrast = matchMedia('(prefers-contrast: more)');
    let appearance = { mode: 'system', effectiveMode: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', transparent: true, effectiveTransparency: false, opacity: 78 };
    function applyPreferences() {
      const reduced = transparency.matches || contrast.matches || appearance.systemReduceTransparency || $('glass-reduce-transparency').checked;
      document.body.classList.toggle('reduce-motion', motion.matches || $('glass-reduce-motion').checked);
      document.body.classList.toggle('reduce-transparency', Boolean(reduced));
      document.documentElement.dataset.appearance = appearance.effectiveMode;
      document.body.classList.toggle('window-transparent', appearance.effectiveTransparency && !reduced);
      document.body.classList.toggle('theme-dark', appearance.effectiveMode === 'dark');
      document.body.classList.toggle('theme-light', appearance.effectiveMode !== 'dark');
      document.documentElement.style.setProperty('--window-alpha', appearance.opacity / 100);
      for (const button of document.querySelectorAll('button[data-appearance]')) button.setAttribute('aria-pressed', String(button.dataset.appearance === appearance.mode));
      $('glass-window-transparency').checked = appearance.transparent;
      $('glass-window-transparency').disabled = !appearance.nativeTransparency;
      $('glass-window-opacity').value = appearance.opacity;
      $('glass-window-opacity').disabled = !appearance.effectiveTransparency || reduced;
      $('glass-opacity-value').textContent = appearance.opacity + '%';
      $('glass-appearance-status').textContent = appearance.nativeTransparency ? (reduced ? 'Transparency is reduced for clarity.' : '') : 'Desktop blur is available on macOS.';
      document.dispatchEvent(new Event('riff-appearance'));
    }
    let pending = Promise.resolve();
    function saveAppearance(patch) {
      pending = pending.then(async () => { appearance = await window.electronAPI.setAppearance(patch); applyPreferences(); }).catch(error => {
        $('glass-appearance-status').textContent = 'Could not save appearance. Please try again.';
        console.error('Appearance:', error);
      });
      return pending;
    }
    for (const kind of ['motion', 'transparency']) {
      const input = $('glass-reduce-' + kind);
      input.checked = localStorage.getItem('riff_reduce_' + kind) === 'true';
      input.addEventListener('change', () => {
        localStorage.setItem('riff_reduce_' + kind, String(input.checked)); applyPreferences();
        if (kind === 'transparency') saveAppearance({ reduceTransparency: input.checked });
      });
    }
    for (const button of document.querySelectorAll('button[data-appearance]')) button.addEventListener('click', () => saveAppearance({ mode: button.dataset.appearance }));
    $('glass-window-transparency').addEventListener('change', event => saveAppearance({ transparent: event.target.checked }));
    $('glass-window-opacity').addEventListener('input', event => { $('glass-opacity-value').textContent = event.target.value + '%'; document.documentElement.style.setProperty('--window-alpha', Number(event.target.value) / 100); });
    $('glass-window-opacity').addEventListener('change', event => saveAppearance({ opacity: Number(event.target.value) }));
    window.electronAPI?.onAppearanceChanged(value => { appearance = value; applyPreferences(); });
    window.electronAPI?.getAppearance().then(value => {
      appearance = value; $('glass-reduce-transparency').checked = value.reduceTransparency; applyPreferences();
    });
    for (const media of [motion, transparency, contrast]) media.addEventListener('change', applyPreferences);
    applyPreferences();
    for (const id of ['settings-slider-scale', 'slider-font-scale']) {
      const row = $(id)?.closest('.setting-item');
      if (row) $('glass-scale-settings').appendChild(row);
    }
    $('glass-explore')?.addEventListener('click', () => $('search-input').focus());
    $('glass-library')?.addEventListener('click', () => $('nav-local').click());
    // Every icon-only control has a spoken name, including dynamically created rows.
    function labelControls(root) {
      for (const button of root.querySelectorAll('button[title]:not([aria-label])')) button.setAttribute('aria-label', button.title);
      for (const input of root.querySelectorAll('input[placeholder]:not([aria-label]),textarea[placeholder]:not([aria-label])')) input.setAttribute('aria-label', input.placeholder);
      for (const input of root.querySelectorAll('input[type=range]:not([aria-label])')) {
        const name = input.closest('.setting-item')?.querySelector('.setting-name')?.textContent || (input.id === 'volume-slider' ? 'Volume' : input.id.replace(/-/g, ' '));
        input.setAttribute('aria-label', name.trim());
      }
      for (const badge of document.querySelectorAll('.nav-badge')) badge.classList.toggle('hidden', badge.textContent === '0');
      for (const button of document.querySelectorAll('.nav-item[data-view]')) {
        if (button.classList.contains('active')) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
      }
    }
    labelControls(document);
    let labelsPending = false;
    const observer = new MutationObserver(() => {
      if (labelsPending) return;
      labelsPending = true;
      requestAnimationFrame(() => { labelsPending = false; labelControls(document); });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // Keep native audio's state and accessibility label aligned.
    const audio = $('native-audio');
    for (const event of ['play', 'pause', 'ended']) audio.addEventListener(event, () => $('btn-play-pause').setAttribute('aria-label', audio.paused ? 'Play' : 'Pause'));
    // Dialogs stay usable with a keyboard and restore focus to their trigger.
    let activeDialog = null, previousFocus = null;
    const dialogObserver = new MutationObserver(() => {
      const modal = [...document.querySelectorAll('.modal-backdrop')].find(el => !el.classList.contains('hidden') && el.classList.contains('visible') && getComputedStyle(el).visibility !== 'hidden');
      if (modal === activeDialog) return;
      if (activeDialog) { activeDialog.removeAttribute('aria-modal'); if (!modal && previousFocus?.isConnected) previousFocus.focus(); }
      activeDialog = modal;
      if (!modal) return;
      previousFocus = document.activeElement;
      modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
      const heading = modal.querySelector('h2,h3,.modal-title');
      modal.setAttribute('aria-label', heading?.textContent.trim() || 'Riff dialog');
      const target = modal.querySelector('input:not([type=hidden]),textarea,button:not(:disabled)');
      target?.focus();
    });
    dialogObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    document.addEventListener('keydown', event => {
      if (!activeDialog || event.key !== 'Tab') return;
      const focusable = [...activeDialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select,textarea,a[href],[tabindex="0"]')].filter(el => el.getClientRects().length);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || !activeDialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !activeDialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    });
  });
})();
