'use strict';
const AUDIO_FORMAT = 'bestaudio[protocol=https]/bestaudio[protocol=http]/bestaudio/best';
function streamFromInfo(info) {
  if (!info || typeof info !== 'object') throw new Error('The source did not return an audio stream.');
  const item = info.entries ? info.entries.find(Boolean) : info;
  const selected = item?.requested_downloads?.[0] || item?.requested_formats?.find(f => f.vcodec === 'none') || item;
  if (!selected?.url || !/^https?:\/\//i.test(selected.url)) throw new Error('The source did not return an audio stream.');
  const headers = {};
  for (const [key, value] of Object.entries({ ...item.http_headers, ...selected.http_headers })) {
    if (['user-agent','accept','accept-language','referer','origin','authorization','cookie'].includes(key.toLowerCase()) && typeof value === 'string' && !/[\r\n]/.test(value)) headers[key.toLowerCase()] = value;
  }
  return { url: selected.url, isHls: /m3u8/.test(selected.protocol || '') || /\.m3u8(?:[?#]|$)/i.test(selected.url), headers };
}
function streamExpiry(url, now = Date.now()) {
  let expires = now + 10 * 60000;
  try { const value = Number(new URL(url).searchParams.get('expire') || new URL(url).searchParams.get('expires')); if (value > 0) expires = Math.min(expires, value * 1000 - 60000); } catch {}
  return expires;
}
module.exports = { AUDIO_FORMAT, streamFromInfo, streamExpiry };
