/* Shared by the isolated renderer and the Node regression tests. */
(function (root) {
  'use strict';
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  function readStoredJSON(storage, key, fallback, validate = value => typeof value === typeof fallback) {
    try {
      const raw = storage.getItem(key);
      if (raw === null) return fallback;
      const value = JSON.parse(raw);
      return validate(value) ? value : fallback;
    } catch { return fallback; }
  }
  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }
  function safeMediaURL(value) {
    if (typeof value !== 'string') return '';
    try {
      const url = new URL(value);
      return ['https:', 'http:', 'file:', 'blob:'].includes(url.protocol) || /^data:image\/(png|jpeg|webp|gif);base64,/i.test(value) ? value : '';
    } catch { return ''; }
  }
  function tracks(value) {
    return Array.isArray(value) ? value.filter(track => object(track) && typeof track.id === 'string').map(track => ({ ...track, title: typeof track.title === 'string' ? track.title : 'Untitled', artist: typeof track.artist === 'string' ? track.artist : 'Unknown artist' })) : [];
  }
  function playlists(value) {
    return Array.isArray(value) ? value.filter(item => object(item) && typeof item.id === 'string').map(item => ({ ...item, name: typeof item.name === 'string' ? item.name : 'Untitled', tracks: tracks(item.tracks) })) : [];
  }
  function hlsProxyLoader(Hls, proxyBase) {
    return class extends Hls.DefaultConfig.loader {
      load(context, config, callbacks) {
        const url = context.url;
        super.load({ ...context, url: proxyBase + encodeURIComponent(url) }, config, {
          ...callbacks,
          onSuccess: (response, stats, loadedContext, network) => callbacks.onSuccess({ ...response, url }, stats, { ...loadedContext, url }, network),
          onError: (error, loadedContext, network, stats) => callbacks.onError(error, { ...loadedContext, url }, network, stats),
          onTimeout: (stats, loadedContext, network) => callbacks.onTimeout(stats, { ...loadedContext, url }, network)
        });
      }
    };
  }
  const api = { readStoredJSON, escapeHTML, safeMediaURL, tracks, playlists, object, hlsProxyLoader };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RiffUtils = api;
})(typeof window === 'object' ? window : globalThis);
