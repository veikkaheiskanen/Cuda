'use strict';
const ROOT = 'https://api.audius.co/v1';
function publicTrack(t) {
  if (!t || !/^[a-zA-Z0-9]+$/.test(t.id) || !t.is_available || !t.is_streamable || t.is_stream_gated || t.is_unlisted || t.is_delete || t.allowed_api_keys?.length) return null;
  if (!t.permalink?.startsWith('/') || t.permalink.startsWith('//')) return null;
  return { id: t.id, title: t.title, artist: t.user?.name || 'Unknown artist', platform: 'audius', url: 'https://audius.co' + t.permalink,
    duration: t.duration, thumbnail: t.artwork?.['480x480'] || '', genres: t.genre ? [t.genre] : [], downloadable: t.is_downloadable === true && !t.is_download_gated };
}
function createAudius({fetcher = fetch} = {}) {
  async function request(route) {
    const response = await fetcher(ROOT + route, {headers: {'User-Agent': 'Cuda/1.0.9 (https://github.com/veikkaheiskanen/Cuda)'}, signal: AbortSignal.timeout(8000)});
    if (!response.ok) throw new Error('Audius is unavailable. Try another source.');
    return (await response.json()).data;
  }
  return {
    async search(query, limit = 10) { return (await request('/tracks/search?' + new URLSearchParams({query, limit: String(limit), app_name: 'Cuda'})) || []).map(publicTrack).filter(Boolean); },
    async stream(id) {
      if (!/^[a-zA-Z0-9]+$/.test(id)) throw new Error('Invalid Audius song.');
      const t = await request('/tracks/' + id + '?app_name=Cuda');
      const track = publicTrack(t);
      if (!track) throw new Error('This Audius song requires access that Cuda does not have.');
      // Use the supported stream endpoint; never treat a gated preview as a song.
      return {metadata: track, success: true, isLocal: false, isHls: false, streamUrl: ROOT + '/tracks/' + id + '/stream?app_name=Cuda'};
    }
  };
}
module.exports = { createAudius, publicTrack };
