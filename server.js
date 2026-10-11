const {choosePlaybackSource}=require('./playback-resolver');
const { selectSources, sameRecording } = require('./source-selection');
const { AUDIO_FORMAT, streamFromInfo, streamExpiry } = require('./stream-utils');
let spotifyProvider = null;
function setSpotifyProvider(provider) { spotifyProvider = provider; }
const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require("child_process");
const {spawnTool,terminateTool,stopTools}=require("./tool-processes");
const { StringDecoder } = require("string_decoder");

const PORT = 38472;
let serverPort = PORT;
const { CACHE_DIR, CUSTOM_LYRICS_DIR, LYRICS_DIR, THUMBNAILS_DIR, METADATA_PATH, LIBRARY_DIR, LIBRARY_PATH, ytDlpCommand } = require('./platform');

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(CUSTOM_LYRICS_DIR)) fs.mkdirSync(CUSTOM_LYRICS_DIR, { recursive: true });
if (!fs.existsSync(LYRICS_DIR)) fs.mkdirSync(LYRICS_DIR, { recursive: true });
if (!fs.existsSync(THUMBNAILS_DIR)) fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
if (!fs.existsSync(LIBRARY_DIR)) fs.mkdirSync(LIBRARY_DIR, { recursive: true });

let trackMetadataIndex = {};
try {
  if (fs.existsSync(METADATA_PATH)) {
    trackMetadataIndex = JSON.parse(fs.readFileSync(METADATA_PATH, 'utf-8'));
  }
} catch (e) {
  trackMetadataIndex = {};
}

function saveTrackMetadata(cleanId, meta) {
  if (!cleanId) return;
  trackMetadataIndex[cleanId] = {
    ...(trackMetadataIndex[cleanId] || {}),
    ...meta,
    lastPlayed: Date.now()
  };
  try {
    fs.writeFileSync(METADATA_PATH, JSON.stringify(trackMetadataIndex, null, 2), 'utf-8');
  } catch (e) {}
}

let libraryIndex = {};
try {
  if (fs.existsSync(LIBRARY_PATH)) {
    libraryIndex = JSON.parse(fs.readFileSync(LIBRARY_PATH, 'utf-8'));
  }
} catch (e) {
  libraryIndex = {};
}

function saveLibraryIndex() {
  try {
    fs.writeFileSync(LIBRARY_PATH, JSON.stringify(libraryIndex, null, 2), 'utf-8');
  } catch (e) {}
}

const searchCache = new Map();
const progressiveSearch=require('./search-broker').createSearchBroker();
const streamUrlCache = new Map();
const streamContexts = new Map();
const resolvingStreams = new Map();
const lyricsCache = new Map();
const artistCache = new Map();
const vibeCache = new Map();
const ytArtistCache = new Map();
const downloadingSet = new Set();
const prefetchingSet = new Set();

let currentAppState = {};
const sseClients = new Set();

function broadcastSSE(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(msg);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

function cleanTrackId(id) {
  return (id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function findCachedFile(trackId) {
  const cleanId = cleanTrackId(trackId);
  const extensions = ['.opus', '.webm', '.m4a', '.mp3'];
  for (const ext of extensions) {
    const filePath = path.join(CACHE_DIR, `${cleanId}${ext}`);
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.size > 60000) {
        const now = new Date();
        try {
          await fs.promises.utimes(filePath, now, now);
        } catch (e) {}
        return filePath;
      }
    } catch (e) {}
  }
  return null;
}

async function pruneDiskCache() {
  try {
    const files = await fs.promises.readdir(CACHE_DIR);
    const now = Date.now();
    for (const file of files) {
      const fullPath = path.join(CACHE_DIR, file);
      try {
        const stat = await fs.promises.stat(fullPath);
        if (file.includes('.temp.')) {
          if (now - stat.mtimeMs > 10 * 60 * 1000) {
            await fs.promises.unlink(fullPath);
          }
          continue;
        }
        if (stat.size < 1000) {
          await fs.promises.unlink(fullPath);
          continue;
        }
      } catch (e) {}
    }
  } catch (e) {
    console.warn('Prune cache error:', e);
  }
}

pruneDiskCache();

function parseDurationSeconds(str) {
  if (!str) return 0;
  const parts = str.split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function isSpamOrUnofficial(title, duration, channelName = '') {
  if (duration && (duration < 90 || duration > 420)) return true;

  const t = (title || '').toLowerCase();
  const c = (channelName || '').toLowerCase();
  const combined = `${t} ${c}`;

  const nonMusicWordPatterns = [
    /\blecture\b/i,
    /\btalk\b/i,
    /\bconversation\b/i,
    /\bin conversation\b/i,
    /\bacademy\b/i,
    /\bmasterclass\b/i,
    /\bdocumentary\b/i,
    /\bbehind the scenes\b/i,
    /\bmaking of\b/i,
    /\bexplained\b/i,
    /\bhistory of\b/i,
    /\bhow to\b/i,
    /\bnews\b/i,
    /\blive stream\b/i,
    /\blivestream\b/i,
    /\bfull concert\b/i,
    /\bfull set\b/i,
    /\blive at\b/i,
    /\bofficial video essay\b/i
  ];
  if (nonMusicWordPatterns.some(pat => pat.test(combined))) return true;

  const nonMusicPatterns = [
    /\bepisode\s*\d+/i,
    /\bseason\s*\d+/i,
    /\bs\d+e\d+\b/i,
    /\bep\s*\.?\s*\d+\b/i,
    /\bseries\b/i,
    /\btrailer\b/i,
    /\bteaser\b/i,
    /\bfull movie\b/i,
    /\bshort film\b/i,
    /\bpodcast\b/i,
    /\bgameplay\b/i,
    /\bwalkthrough\b/i,
    /\bplaythrough\b/i,
    /\breview\b/i,
    /\breaction\b/i,
    /\binterview\b/i,
    /\baudiobook\b/i,
    /\bvlog\b/i,
    /\bunboxing\b/i,
    /\btutorial\b/i,
    /\bparody\b/i
  ];
  if (nonMusicPatterns.some(pat => pat.test(combined))) return true;

  const badKeywords = [
    '1 hour', '2 hours', '10 hours', 'hour loop', 'hours loop',
    'full album', 'discography', 'ost compilation', 'soundtrack compilation',
    'playlist mix', 'dj set', 'type beat', 'slowed + reverb', 'slowed down',
    'sped up', 'bass boosted', 'nightcore', 'reaction to', 'reacting to'
  ];
  if (badKeywords.some(bad => combined.includes(bad))) return true;

  return false;
}

function safeJsonParse(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch (error) {
    return fallback;
  }
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

function normalizeTrack(track) {
  if (!track || typeof track !== 'object') return null;
  const title = String(track.title || '').trim();
  const artist = String(track.artist || '').trim();
  const id = String(track.id || track.url || `${artist.toLowerCase()}:${title.toLowerCase()}`).trim();
  if (!id && !title) return null;
  return {
    id,
    title: title || 'untitled',
    artist: artist || 'unknown artist',
    duration: Number(track.duration) || 0,
    thumbnail: track.thumbnail || '',
    url: track.url || '',
    platform: track.platform || 'soundcloud',
    searchQuery: track.searchQuery || ''
  };
}

function normalizeArtistName(name) {
  return String(name || '')
    .replace(/\b(official|vevo|records|topic)\b/gi, '')
    .replace(/[^\w\s&-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function trackFingerprint(track) {
  const clean = normalizeTrack(track);
  if (!clean) return '';
  return getTrackNormalizedKey(clean.artist, clean.title);
}

const recentlyRecommendedTrackIds = new Set();
const recentlyRecommendedKeys = new Set();

async function searchSoundcloud(query, limit = 14) {
  const cacheKey = `sc:${limit}:${String(query || '').trim().toLowerCase()}`;
  if (searchCache.has(cacheKey)) {
    return searchCache.get(cacheKey);
  }

  const args = [
    `scsearch${limit}:${query}`,
    '--dump-single-json',
    '--flat-playlist',
    '--skip-download',
    '--no-warnings',
    '--no-check-certificates'
  ];
  try {
    const raw = await executeYtDlp(args, 18000);
    const data = JSON.parse(raw);
    const entries = (data.entries || []).map((item) => {
      let thumbnail = '';
      if (item.thumbnails && item.thumbnails.length > 0) {
        thumbnail = item.thumbnails[item.thumbnails.length - 1].url;
      } else if (item.thumbnail) {
        thumbnail = item.thumbnail;
      }

      const cleanTitle = (item.title || 'untitled');
      const cleanArtist = (item.uploader || item.channel || item.artist || 'unknown artist');
      const trackUrl = item.webpage_url || item.url || '';

      return {
        id: String(item.id || Math.random().toString(36).substring(2)),
        title: cleanTitle,
        artist: cleanArtist,
        duration: item.duration || 0,
        thumbnail: thumbnail,
        url: trackUrl,
        platform: 'soundcloud'
      };
    });

    if (entries.length > 0) {
      searchCache.set(cacheKey, entries);
      setTimeout(() => { searchCache.delete(cacheKey); }, 300000);
    }
    return entries;
  } catch (err) {
    return [];
  }
}

function buildDiscoveryQueries(profile) {
  const artists = (profile.topArtists || []).map(a => typeof a === 'string' ? a : a.name).filter(Boolean);
  const shuffled = [...artists].sort(() => Math.random() - 0.5);
  const queries = [];

  if (shuffled.length > 0) {
    queries.push(shuffled[0]);
    if (shuffled.length > 1) {
      queries.push(shuffled[1]);
    }
  }

  if (profile.dominantScript === 'Cyrillic' && shuffled.length > 0) {
    queries.push(`${shuffled[0]} похожие песни`);
  }

  if (queries.length === 0) {
    queries.push('synthwave chill', 'indie electronic');
  }

  return queries;
}

function scoreDiscoveryCandidate(track, profile, heardKeys, heardIds) {
  const normalized = normalizeTrack(track);
  if (!normalized) return null;
  const key = getTrackNormalizedKey(normalized.artist, normalized.title);
  if (!normalized.url || !normalized.id) return null;

  if (heardIds.has(normalized.id) || (key && heardKeys.has(key))) return null;
  if (recentlyRecommendedTrackIds.has(normalized.id) || (key && recentlyRecommendedKeys.has(key))) return null;
  if (isSpamOrUnofficial(normalized.title, normalized.duration, normalized.artist)) return null;

  let score = 1.0;

  if (/-\s*topic$/i.test(normalized.artist || '')) {
    score += 1.5;
  }

  if (/^.+?\s+-\s+.+$/.test(normalized.title || '')) {
    score += 1.0;
  }

  const candArtist = normalizeArtistName(normalized.artist);
  const artistNames = (profile.topArtists || []).map(a => typeof a === 'string' ? a : a.name);
  if (artistNames.some(a => candArtist.includes(a) || a.includes(candArtist))) {
    score += 3.0;
  }

  const isCyrillic = /[\u0400-\u04FF]/.test(normalized.title);
  if (profile.dominantScript === 'Cyrillic' && isCyrillic) {
    score += 2.0;
  } else if (profile.dominantScript !== 'Cyrillic' && !isCyrillic) {
    score += 1.0;
  }

  if (normalized.duration > 0 && profile.typicalDuration > 0) {
    const delta = Math.abs(normalized.duration - profile.typicalDuration);
    score += Math.max(0, 2.0 - (delta / 60));
  }

  score += Math.random() * 1.5;

  return {
    ...normalized,
    score
  };
}

async function recommendVibeTracks(historyTracks, favoriteTracks, platform = 'soundcloud', limit = 10, clientProfile = null) {
  const normalizedHistory = historyTracks.map(normalizeTrack).filter(Boolean);
  const normalizedFavorites = favoriteTracks.map(normalizeTrack).filter(Boolean);

  const heardIds = new Set();
  const heardKeys = new Set();
  [...normalizedHistory, ...normalizedFavorites].forEach(track => {
    heardIds.add(track.id);
    const key = getTrackNormalizedKey(track.artist, track.title);
    if (key) heardKeys.add(key);
  });

  const artistCounts = {};
  let cyrillicCount = 0;
  const durations = [];

  [...normalizedFavorites, ...normalizedHistory].forEach(t => {
    if (t.artist && t.artist.trim()) {
      const a = normalizeArtistName(t.artist);
      artistCounts[a] = (artistCounts[a] || 0) + 1;
    }
    if (t.title && /[\u0400-\u04FF]/.test(t.title)) cyrillicCount++;
    if (t.duration > 0) durations.push(t.duration);
  });

  const sortedArtists = Object.entries(artistCounts)
    .sort((a, b) => b[1] - a[1])
    .map(e => e[0]);

  const profile = {
    topArtists: clientProfile?.topArtists || sortedArtists.slice(0, 5),
    dominantScript: clientProfile?.dominantScript || (cyrillicCount > (normalizedFavorites.length + normalizedHistory.length) * 0.35 ? 'Cyrillic' : 'Latin'),
    typicalDuration: clientProfile?.avgDuration || (durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 210),
    trackCount: normalizedFavorites.length + normalizedHistory.length
  };

  if (profile.trackCount < 5 && (!clientProfile || clientProfile.trackCount < 5)) {
    return { profile, tracks: [] };
  }

  const queries = buildDiscoveryQueries(profile);
  const candidateMap = new Map();

  for (const query of queries) {
    try {
      const results = await searchSoundcloud(query, 14);
      for (const track of results) {
        const scored = scoreDiscoveryCandidate(track, profile, heardKeys, heardIds);
        if (scored) {
          if (!candidateMap.has(scored.id) || candidateMap.get(scored.id).score < scored.score) {
            candidateMap.set(scored.id, scored);
          }
        }
      }
      if (candidateMap.size >= limit * 2) {
        break;
      }
    } catch (e) {}
  }

  let ranked = Array.from(candidateMap.values()).sort((a, b) => b.score - a.score);

  const unshown = ranked.filter(t => !recentlyRecommendedTrackIds.has(t.id));
  if (unshown.length >= limit) {
    ranked = unshown;
  }

  const artistTrackCount = {};
  const finalTracks = [];
  for (const track of ranked) {
    const a = normalizeArtistName(track.artist);
    if ((artistTrackCount[a] || 0) < 2) {
      artistTrackCount[a] = (artistTrackCount[a] || 0) + 1;
      finalTracks.push(track);
      recentlyRecommendedTrackIds.add(track.id);
      const nKey = getTrackNormalizedKey(track.artist, track.title);
      if (nKey) recentlyRecommendedKeys.add(nKey);
      if (recentlyRecommendedTrackIds.size > 100) {
        const first = recentlyRecommendedTrackIds.values().next().value;
        recentlyRecommendedTrackIds.delete(first);
      }
      if (recentlyRecommendedKeys.size > 100) {
        const firstK = recentlyRecommendedKeys.values().next().value;
        recentlyRecommendedKeys.delete(firstK);
      }
      if (finalTracks.length >= limit) break;
    }
  }

  return {
    profile,
    tracks: finalTracks
  };
}

function directYoutubeSearch(query, filterSpam = false) {
  return new Promise((resolve) => {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const req = https.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                          'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 7000
    }, (res) => {
      let html = '';
      const dec = new StringDecoder('utf8');
      res.on('data', chunk => { html += dec.write(chunk); });
      res.on('end', async () => {
        try {
          const match = html.match(/var ytInitialData = ({.*?});<\/script>/);
          if (!match) return resolve([]);

          const json = JSON.parse(match[1]);
          const contents = json.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
          const tracks = [];

          for (const section of contents) {
            const items = section.itemSectionRenderer?.contents || [];
            for (const item of items) {
              const v = item.videoRenderer;
              if (v && v.videoId) {
                const vidId = v.videoId;
                const title = (v.title?.runs?.[0]?.text || 'untitled');
                const artist = (v.ownerText?.runs?.[0]?.text || 'unknown artist');
                const durStr = v.lengthText?.simpleText || '0:00';
                const durSec = parseDurationSeconds(durStr);
                const thumbs = v.thumbnail?.thumbnails || [];
                const thumbnail = thumbs.length > 0 ? thumbs[thumbs.length - 1].url : '';

                if (filterSpam && isSpamOrUnofficial(title, durSec, artist)) {
                  continue;
                }

                const isCached = await findCachedFile(vidId);

                tracks.push({
                  id: vidId,
                  title: title,
                  artist: artist,
                  duration: durSec,
                  thumbnail: thumbnail,
                  url: `https://www.youtube.com/watch?v=${vidId}`,
                  platform: 'youtube',
                  isCached: !!isCached
                });
              }
            }
          }
          resolve(tracks);
        } catch (e) {
          resolve([]);
        }
      });
    });

    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

function executeYtDlp(args, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const cmd = ytDlpCommand(args);
    const proc = spawnTool(cmd.bin, cmd.args, { windowsHide: true, env: cmd.env });
    let stdout = '';
    let stderr = '';
    const outDecoder = new StringDecoder('utf8');
    const errDecoder = new StringDecoder('utf8');
    let timer = null;

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        terminateTool(proc);
        reject(new Error(`yt-dlp timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    proc.stdout.on('data', (d) => { stdout += outDecoder.write(d); });
    proc.stderr.on('data', (d) => { stderr += errDecoder.write(d); });

    proc.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0 || stdout.trim().length > 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `yt-dlp exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}

async function cacheThumbnailToDisk(cleanId, thumbnailUrl) {
  if (!cleanId || !thumbnailUrl || !thumbnailUrl.startsWith('http')) return null;
  const destPath = path.join(THUMBNAILS_DIR, `${cleanId}.jpg`);
  if (fs.existsSync(destPath)) return destPath;
  try {
    const res = await fetch(thumbnailUrl);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > 500) {
      await fs.promises.writeFile(destPath, buffer);
      return destPath;
    }
  } catch (e) {}
  return null;
}

async function downloadTrackToDisk(trackUrl, trackId, platform, meta = {}) {
  const cleanId = cleanTrackId(trackId);
  if (downloadingSet.has(cleanId) || await findCachedFile(cleanId)) return;
  downloadingSet.add(cleanId);

  const outputPath = path.join(CACHE_DIR, `${cleanId}.opus`);
  const tempPath = path.join(CACHE_DIR, `${cleanId}.temp.opus`);

  const args = [
    '--no-playlist',
    '--no-check-certificates',
    '--no-warnings',
    '-x',
    '--audio-format', 'opus',
    '--audio-quality', '128K',
    '-o', tempPath
  ];


  args.push(trackUrl);

  if (meta.thumbnail) {
    cacheThumbnailToDisk(cleanId, meta.thumbnail).catch(() => {});
  }

  let cmd;
  try { cmd = ytDlpCommand(args); } catch (e) { downloadingSet.delete(cleanId); console.error(e.message); return; }
  const proc = spawnTool(cmd.bin, cmd.args, { windowsHide: true, env: cmd.env, stdio: 'ignore' });
  proc.on('close', async (code) => {
    downloadingSet.delete(cleanId);
    if (code === 0 && fs.existsSync(tempPath)) {
      try {
        const stat = await fs.promises.stat(tempPath);
        if (stat.size > 60000) {
          await fs.promises.rename(tempPath, outputPath);
          saveTrackMetadata(cleanId, {
            id: trackId,
            title: meta.title || '',
            artist: meta.artist || '',
            duration: meta.duration || 0,
            thumbnail: meta.thumbnail || '',
            platform: platform || 'youtube',
            fileSize: stat.size
          });
        } else {
          try { await fs.promises.unlink(tempPath); } catch (e) {}
        }
      } catch (e) {}
    } else {
      if (fs.existsSync(tempPath)) {
        try { await fs.promises.unlink(tempPath); } catch (e) {}
      }
    }
  });

  proc.on('error', () => {
    downloadingSet.delete(cleanId);
  });
}

const IOS_AUDIO_FORMAT = "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio[acodec^=aac]/bestaudio[protocol*=m3u8]/best[ext=mp4]";
function mobileCachedFile(file, mobile) { return file && (!mobile || /\.(m4a|mp3|aac|wav|mp4|aif|aiff|caf)$/i.test(file)); }
async function resolveAudioStream(trackUrl, trackId, platform, refresh = false, mobile = false) {
  if (platform === 'spotify') throw new Error('Spotify plays through the native player.');
  if (!trackUrl) throw new Error('This track has no playable source URL.');
  const key = `${platform}:${cleanTrackId(trackId)}:${trackUrl}:${mobile ? "ios" : "desktop"}`;
  const cached = streamUrlCache.get(key);
  if (!refresh && cached?.expiresAt > Date.now()) return cached.data;
  if (resolvingStreams.has(key)) return resolvingStreams.get(key);
  const task = (async () => {
    const raw = await executeYtDlp(['--dump-single-json', '--skip-download', '--no-playlist', '-f', mobile ? IOS_AUDIO_FORMAT : AUDIO_FORMAT, trackUrl], 30000);
    const info=JSON.parse(raw);
    const stream = streamFromInfo(info);
    const token = crypto.randomBytes(18).toString('hex');
    const expiresAt = streamExpiry(stream.url);
    // Header values remain in the main process. HLS manifests, keys and segments
    // all reuse this context instead of losing the extractor's required headers.
    for (const [id, context] of streamContexts) if (context.expiresAt <= Date.now()) streamContexts.delete(id);
    while (streamContexts.size >= 256) streamContexts.delete(streamContexts.keys().next().value);
    streamContexts.set(token, { headers: stream.headers, host: new URL(stream.url).hostname, expiresAt: Date.now() + 6 * 3600000 });
    const proxyBase = `http://127.0.0.1:${serverPort}/api/audio-proxy?stream=${token}&url=`;
    const data = { metadata:{title:info.track||info.title,artist:(info.artist||info.artists?.join(', ')||info.channel||info.uploader||'Unknown artist').replace(/\s*-\s*Topic$/i,''),duration:info.duration||0,thumbnail:info.thumbnail||''}, success: true, isLocal: false, streamUrl: stream.url, isHls: stream.isHls, proxyBase, proxyUrl: proxyBase + encodeURIComponent(stream.url) };
    while (streamUrlCache.size >= 256) streamUrlCache.delete(streamUrlCache.keys().next().value);
    streamUrlCache.set(key, { expiresAt, data });
    return data;
  })().finally(() => resolvingStreams.delete(key));
  resolvingStreams.set(key, task);
  return task;
}

async function prefetchTrack(trackUrl, trackId, platform) {
  if (platform === 'spotify' || platform === 'local' || !trackUrl || prefetchingSet.size >= 2 || prefetchingSet.has(trackUrl)) return;
  prefetchingSet.add(trackUrl);
  try { if (!await findCachedFile(trackId)) await resolveAudioStream(trackUrl, trackId, platform); }
  catch {} finally { prefetchingSet.delete(trackUrl); }
}

async function handleSearch(req, res, query, platform = 'auto', limit = 20, quiet = false, progressive = false) {
  limit = Math.max(1,Math.min(50,Number(limit)||20)); query = String(query).slice(0,250);
  if (platform === 'auto') {
    const collect = source => new Promise(resolve => {
      const sink = {writeHead() {}, end(body) {try {resolve(JSON.parse(body).tracks || []);} catch {resolve([]);}}};
      handleSearch(req, sink, query, source, Math.min(limit, 10), true).catch(() => resolve([]));
    });
    const connected=Boolean(spotifyProvider?.status().playbackConnected);
    const sourceContext=connected?'spotify':'public';
    const providers=['youtube','ytmusic','soundcloud'].map(source=>()=>collect(source));
    if(connected)providers.push(()=>spotifyProvider.search(query));
    if(progressive)res.writeHead(200,{'Content-Type':'application/x-ndjson','Cache-Control':'no-store'});
    const result=await progressiveSearch(`${sourceContext}:${query.trim().toLowerCase()}:${limit}`,providers,
      batches=>selectSources(batches,query,limit).map(track=>({...track,sourceContext})),
      update=>{if(progressive && !res.destroyed)res.write(JSON.stringify(update)+'\n');});
    if(progressive){if(!res.destroyed)res.end();return;}
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({...result,...(!result.success?{error:'No sources are available. Try again.'}:{})}));
  }
  const cacheKey = `${platform}:${query}:${limit}`;
  if (searchCache.has(cacheKey)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(searchCache.get(cacheKey)));
  }

  if (platform === 'youtube') {
    try {
      const directTracks = await directYoutubeSearch(query);
      if (directTracks && directTracks.length > 0) {
        const result = { success: true, tracks: directTracks.slice(0, limit) };
        searchCache.set(cacheKey, result);

        if (!quiet) setTimeout(() => {
          for (let i = 0; i < Math.min(4, directTracks.length); i++) {
            prefetchTrack(directTracks[i].url, directTracks[i].id, 'youtube').catch(() => {});
          }
        }, 50);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(result));
      }
    } catch (e) {}
  }

  if (platform === 'ytmusic') {
    try {
      const args = ['--flat-playlist', '--playlist-end', String(limit), '-J', `https://music.youtube.com/search?q=${encodeURIComponent(query)}#songs`];
      const raw = await executeYtDlp(args, 25000);
      const data = JSON.parse(raw);
      const rawEntries = (data.entries || []).slice(0, limit);

      function extractArtist(item) {
        let a = '';
        if (Array.isArray(item.artists) && item.artists.length > 0) a = item.artists.join(', ');
        else if (item.artist) a = item.artist;
        else if (item.creator) a = item.creator;
        else if (item.channel) a = item.channel;
        else if (item.uploader) a = item.uploader;
        return a ? a.replace(/\s*-\s*Topic$/i, '').trim() : '';
      }

      const toFetch = [];
      for (let i = 0; i < Math.min(10, rawEntries.length); i++) {
        const item = rawEntries[i];
        const flatA = extractArtist(item);
        if (flatA) {
          item._artist = flatA;
        } else if (ytArtistCache.has(item.id)) {
          item._artist = ytArtistCache.get(item.id);
        } else {
          toFetch.push(item);
        }
      }

      if (toFetch.length > 0) {
        let fIdx = 0;
        const fetchWorker = async () => {
          while (fIdx < toFetch.length) {
            const item = toFetch[fIdx++];
            try {
              const out = await executeYtDlp([
                '--skip-download',
                '--no-playlist',
                '--print',
                '%(artist,artists.0,channel,uploader)s',
                `https://www.youtube.com/watch?v=${item.id}`
              ], 10000);
              const lines = (out || '').split('\n').map(s => s.trim()).filter(s => s && s !== 'NA');
              if (lines.length > 0) {
                const val = lines[0].replace(/\s*-\s*Topic$/i, '').trim();
                if (val) {
                  item._artist = val;
                  ytArtistCache.set(item.id, val);
                }
              }
            } catch (e) {}
          }
        };
        const workers = Array.from({ length: Math.min(5, toFetch.length) }, () => fetchWorker());
        await Promise.all(workers);
      }

      const entries = await Promise.all(rawEntries.map(async (item) => {
        let thumbnail = `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`;
        if (item.thumbnails && item.thumbnails.length > 0) {
          thumbnail = item.thumbnails[item.thumbnails.length - 1].url;
        } else if (item.thumbnail) {
          thumbnail = item.thumbnail;
        }
        const artistVal = item._artist || ytArtistCache.get(item.id) || extractArtist(item) || 'Unknown Artist';
        const isCached = await findCachedFile(item.id);
        return {
          id: String(item.id),
          title: item.title || 'untitled',
          artist: artistVal,
          duration: item.duration || 0,
          thumbnail: thumbnail,
          url: `https://www.youtube.com/watch?v=${item.id}`,
          platform: 'ytmusic',
          isCached: !!isCached
        };
      }));
      const result = { success: true, tracks: entries };
      searchCache.set(cacheKey, result);
      if (!quiet) setTimeout(() => {
        if (entries[0] && entries[0].url) prefetchTrack(entries[0].url, entries[0].id, 'youtube').catch(() => {});
      }, 60);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, tracks: [], error: 'YouTube Music is unavailable' }));
    }
  }

  const prefix = platform === 'soundcloud' ? `scsearch${limit}:` : `ytsearch${limit}:`;
  const args = [
    `${prefix}${query}`,
    '--dump-single-json',
    '--flat-playlist',
    '--skip-download',
    '--no-warnings',
    '--no-check-certificates'
  ];


  try {
    const raw = await executeYtDlp(args, 25000);
    const data = JSON.parse(raw);
    const entries = await Promise.all((data.entries || []).map(async (item) => {
      let thumbnail = '';
      if (item.thumbnails && item.thumbnails.length > 0) {
        thumbnail = item.thumbnails[item.thumbnails.length - 1].url;
      } else if (item.thumbnail) {
        thumbnail = item.thumbnail;
      }

      const cleanTitle = (item.title || 'untitled');
      const cleanArtist = (item.uploader || item.channel || item.artist || 'unknown artist');

      let trackUrl = item.webpage_url || item.url;
      if (platform === 'youtube' && !trackUrl) {
        trackUrl = `https://www.youtube.com/watch?v=${item.id}`;
      }

      const isCached = await findCachedFile(item.id);

      return {
        id: String(item.id || Math.random().toString(36).substring(2)),
                                                               title: cleanTitle,
                                                               artist: cleanArtist,
                                                               duration: item.duration || 0,
                                                               thumbnail: thumbnail,
                                                               url: trackUrl,
                                                               platform: platform,
                                                               isCached: !!isCached
      };
    }));

    const result = { success: true, tracks: entries };
    searchCache.set(cacheKey, result);

    if (!quiet) setTimeout(() => {
      if (entries[0] && entries[0].url) prefetchTrack(entries[0].url, entries[0].id, platform).catch(() => {});
    }, 60);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

async function handleVibeRecommendations(req, res, payload) {
  const historyTracks = Array.isArray(payload?.history) ? payload.history : [];
  const favoriteTracks = [...(Array.isArray(payload?.favorites) ? payload.favorites : []), ...(spotifyProvider?.status().tracks || []), ...(spotifyProvider?.status().shelf || []).flatMap(a => a.tracks || [])];
  const platform = 'soundcloud';
  const limit = Math.max(4, Math.min(parseInt(payload?.limit || '10', 10) || 10, 16));
  const clientProfile = payload?.clientProfile || null;

  try {
    const result = await recommendVibeTracks(historyTracks, favoriteTracks, platform, limit, clientProfile);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, ...result }));
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: error.message }));
  }
}

async function handleStreamInfo(req, res, trackUrl, trackId, platform = 'youtube', title = '', artist = '', duration = 0, thumbnail = '') {
  const mobile = url.parse(req.url, true).query.mobile === '1';
  const cleanId = cleanTrackId(trackId);
  const cachedFile = await findCachedFile(cleanId);
  if (mobileCachedFile(cachedFile, mobile)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, isLocal: true, streamUrl: `http://127.0.0.1:${serverPort}/api/local-track?id=${encodeURIComponent(cleanId)}` }));
  }
  try {
    const data = await resolveAudioStream(trackUrl, cleanId, platform, parsedRefresh(req), mobile);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  } catch (error) {
    // Never play an unrelated SoundCloud search result while naming it as the
    // requested recording/source. The renderer can try matching alternatives.
    const raw = String(error.message || 'Audio extraction failed');
    const message = /DRM protected/i.test(raw) ? `This recording is protected by ${platform === 'soundcloud' ? 'SoundCloud' : 'the source'}. Choose another audio source.` : /Sign in|login|private|unavailable|not available/i.test(raw) ? 'This recording is unavailable from the selected source. Choose another audio source.' : /timed out/i.test(raw) ? 'The audio source timed out. Retry or choose another source.' : raw.replace(/https?:\/\/\S+/g, '[source]').slice(-600);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: message }));
  }
}
function parsedRefresh(req) { return url.parse(req.url, true).query.refresh === '1'; }

async function fetchArtistInfo(artistName) {
  const cleanName = (artistName || '').replace(/ - Topic|VEVO|Official|Records/gi, '').trim();
  const cacheKey = cleanName.toLowerCase();
  if (artistCache.has(cacheKey)) return artistCache.get(cacheKey);

  let bio = '';
  let avatar = '';
  let isVerified = false;
  let tracks = [];

  try {
    const dzUrl = `https://api.deezer.com/search/artist?q=${encodeURIComponent(cleanName)}`;
    const dzData = await new Promise((resolve) => {
      https.get(dzUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 4000 }, (dRes) => {
        let d = '';
        dRes.on('data', c => d += c);
        dRes.on('end', () => {
          try { resolve(JSON.parse(d)); } catch (e) { resolve(null); }
        });
      }).on('error', () => resolve(null));
    });

    if (dzData && dzData.data && dzData.data.length > 0) {
      const topArtist = dzData.data[0];
      avatar = topArtist.picture_xl || topArtist.picture_big || topArtist.picture_medium || '';
      isVerified = (topArtist.nb_fan || 0) > 30000;

      if (topArtist.tracklist) {
        const tlistData = await new Promise((resolve) => {
          https.get(topArtist.tracklist, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 4000 }, (tRes) => {
            let td = '';
            tRes.on('data', c => td += c);
            tRes.on('end', () => {
              try { resolve(JSON.parse(td)); } catch (e) { resolve(null); }
            });
          }).on('error', () => resolve(null));
        });

        if (tlistData && Array.isArray(tlistData.data)) {
          for (const item of tlistData.data) {
            const dur = item.duration || 180;
            if (dur >= 50 && dur <= 450 && !isSpamOrUnofficial(item.title, dur)) {
              tracks.push({
                id: `dz_${item.id}`,
                title: (item.title || 'untitled'),
                          artist: (item.artist?.name || cleanName),
                          duration: dur,
                          thumbnail: item.album?.cover_medium || item.album?.cover_big || avatar,
                          url: `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanName + ' - ' + item.title + ' official audio')}`,
                          searchQuery: `${cleanName} - ${item.title} official audio`,
                          platform: 'youtube',
                          isCached: false
              });
            }
          }
        }
      }
    }
  } catch (e) {}

  try {
    const wikiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cleanName)}`;
    const wikiData = await new Promise((resolve) => {
      https.get(wikiUrl, { headers: { 'User-Agent': 'devsize/2.0' }, timeout: 3500 }, (wRes) => {
        let d = '';
        wRes.on('data', c => d += c);
        wRes.on('end', () => {
          try { resolve(JSON.parse(d)); } catch (e) { resolve(null); }
        });
      }).on('error', () => resolve(null));
    });

    if (wikiData && wikiData.extract) {
      bio = wikiData.extract;
      if (!avatar && wikiData.originalimage?.source) {
        avatar = wikiData.originalimage.source;
      }
    }
  } catch (e) {}

  if (tracks.length === 0) {
    try {
      const ytOfficialTracks = await directYoutubeSearch(`${cleanName} official audio`, true);
      tracks = (ytOfficialTracks || []).filter(t => !isSpamOrUnofficial(t.title, t.duration)).slice(0, 25);
    } catch (e) {}
  }

  const result = {
    name: cleanName,
    bio: bio || 'artist biography available across streaming networks.',
    avatar: avatar || (tracks[0] ? tracks[0].thumbnail : ''),
    isVerified: isVerified,
    tracks: tracks.slice(0, 35)
  };

  artistCache.set(cacheKey, result);
  return result;
}

function parseAudioRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header);
  if (!match || (!match[1] && !match[2]) || size === 0) return null;

  let start;
  let end = size - 1;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
  } else {
    start = Number(match[1]);
    if (!Number.isSafeInteger(start) || start >= size) return null;
    if (match[2]) {
      end = Number(match[2]);
      if (!Number.isSafeInteger(end) || end < start) return null;
      end = Math.min(end, size - 1);
    }
  }
  return { start, end };
}

async function serveLocalAudio(req, res, filePath, contentType, missingStatus = 404) {
  try {
    const stat = await fs.promises.stat(filePath);
    const fileSize = stat.size;
    const headers = { 'Content-Type': contentType, 'Accept-Ranges': 'bytes' };
    let range = null;
    if (req.headers.range) {
      range = parseAudioRange(req.headers.range, fileSize);
      if (!range) {
        res.writeHead(416, { ...headers, 'Content-Range': `bytes */${fileSize}`, 'Content-Length': 0 });
        return res.end();
      }
      headers['Content-Range'] = `bytes ${range.start}-${range.end}/${fileSize}`;
      headers['Content-Length'] = range.end - range.start + 1;
    } else {
      headers['Content-Length'] = fileSize;
    }
    res.writeHead(range ? 206 : 200, headers);
    if (req.method === 'HEAD') return res.end();

    const file = fs.createReadStream(filePath, range || undefined);
    file.on('error', () => res.destroy());
    res.on('close', () => file.destroy());
    file.pipe(res);
  } catch (e) {
    res.writeHead(missingStatus);
    res.end('Error reading local file');
  }
}

async function handleLocalTrack(req, res, trackId) {
  const cleanId = cleanTrackId(trackId);
  const filePath = await findCachedFile(cleanId);

  if (!filePath) {
    res.writeHead(404);
    return res.end('File not found in local cache');
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.opus': 'audio/ogg; codecs=opus',
    '.webm': 'audio/webm',
    '.m4a': 'audio/mp4',
    '.mp3': 'audio/mpeg'
  };
  return serveLocalAudio(req, res, filePath, mimeTypes[ext] || 'audio/mpeg', 500);
}

const LIBRARY_MIME_TYPES = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.opus': 'audio/ogg; codecs=opus',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.webm': 'audio/webm',
  '.weba': 'audio/webm'
};

async function handleLibraryFile(req, res, trackId) {
  const item = libraryIndex[trackId];
  if (!item || !item.file) {
    res.writeHead(404);
    return res.end('File not found in library');
  }

  const filePath = path.join(LIBRARY_DIR, item.file);
  const ext = path.extname(filePath).toLowerCase();
  return serveLocalAudio(req, res, filePath, LIBRARY_MIME_TYPES[ext] || 'audio/mpeg');
}

function handleAudioProxy(req, res, targetUrl, streamToken) {
  const context = streamToken && streamContexts.get(streamToken);
  if (streamToken && (!context || context.expiresAt <= Date.now())) { res.writeHead(410); return res.end('Audio session expired. Retry playback.'); }
  let upstream;
  const fail = (status, message) => {
    if (!res.headersSent) res.writeHead(status);
    if (!res.writableEnded) res.end(message);
  };
  const request = (url, redirects = 0) => {
    let parsed;
    try { parsed = new URL(url); } catch { return fail(400, 'Invalid audio URL'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) return fail(400, 'Unsupported audio URL');
    const client = parsed.protocol === 'https:' ? https : http;
    const headers = { 'user-agent': req.headers['user-agent'] || 'Cuda', accept: '*/*', ...context?.headers, 'accept-encoding': 'identity' };
    if(context && parsed.hostname !== context.host){delete headers.authorization;delete headers.cookie;}
    if (req.headers.range) headers.range = req.headers.range;
    upstream = client.request(parsed, { method: req.method, headers }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        if (redirects >= 5) return fail(502, 'Too many audio redirects');
        try { request(new URL(response.headers.location, parsed).href, redirects + 1); } catch { fail(502, 'Invalid audio redirect'); }
        return;
      }
      const responseHeaders = { ...response.headers, 'access-control-allow-origin': '*' };
      delete responseHeaders['access-control-allow-credentials'];
      delete responseHeaders['set-cookie'];
      for (const key of ['connection','keep-alive','transfer-encoding','proxy-authenticate','proxy-authorization','te','trailer','upgrade']) delete responseHeaders[key];
      res.writeHead(response.statusCode, responseHeaders);
      response.on('error', () => res.destroy());
      response.pipe(res);
    });
    upstream.setTimeout(30000, () => { upstream.destroy(); fail(504, 'Audio request timed out'); });
    upstream.on('error', () => fail(502, 'Could not reach audio source'));
    upstream.end();
  };
  if (!targetUrl) return fail(400, 'Missing audio URL');
  res.on('close', () => upstream?.destroy());
  request(targetUrl);
}

let DOWNLOADS_DIR;
try { DOWNLOADS_DIR = require('electron').app.getPath('downloads'); } catch (e) { DOWNLOADS_DIR = path.join(os.homedir(), 'Downloads'); }
if (!fs.existsSync(DOWNLOADS_DIR)) {
  try { fs.mkdirSync(DOWNLOADS_DIR, { recursive: true }); } catch (e) {}
}

function sanitizeFilename(str) {
  return (str || 'track')
  .replace(/[<>:"/\\|?*]/g, '')
  .replace(/\s+/g, ' ')
  .trim();
}

async function handleDownload(req, res, trackUrl, title, artist, format = 'mp3', quality = '0') {
  if (!trackUrl && (!title || !artist)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: false, error: 'missing track information' }));
  }

  const cleanTitle = sanitizeFilename(title || 'untitled');
  const cleanArtist = sanitizeFilename(artist || 'unknown artist');
  const validFormats = ['mp3', 'm4a', 'flac', 'opus', 'wav'];
  const ext = validFormats.includes(format.toLowerCase()) ? format.toLowerCase() : 'mp3';
  const outFilename = `${cleanArtist} - ${cleanTitle}.${ext}`;
  const outPath = path.join(DOWNLOADS_DIR, outFilename);
  const tempTemplate = path.join(DOWNLOADS_DIR, `${cleanArtist} - ${cleanTitle}.%(ext)s`);

  let targetUrl = trackUrl;
  if (!targetUrl || targetUrl.includes('deezer.com')) {
    targetUrl = `ytsearch1:${cleanArtist} ${cleanTitle} official audio`;
  }

  const args = [
    '--no-playlist',
    '--no-check-certificates',
    '--no-warnings',
    '-x',
    '--audio-format', ext,
    '--audio-quality', quality.toString(),
    '--embed-thumbnail',
    '--add-metadata',
    '-o', tempTemplate,
    targetUrl
  ];

  try {
    await executeYtDlp(args, 60000);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      filename: outFilename,
      path: outPath,
      directory: DOWNLOADS_DIR
    }));
  } catch (err) {
    try {
      const fallbackArgs = [
        '--no-playlist',
        '--no-check-certificates',
        '--no-warnings',
        '-x',
        '--audio-format', ext,
        '--audio-quality', quality.toString(),
        '-o', tempTemplate,
        targetUrl
      ];
      await executeYtDlp(fallbackArgs, 60000);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        filename: outFilename,
        path: outPath,
        directory: DOWNLOADS_DIR
      }));
    } catch (e2) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: e2.message || err.message }));
    }
  }
}

function sanitizeForLyrics(title, artist) {
  let cleanTitle = (title || '')
  .replace(/\[.*?\]|\(.*?\)/g, '')
  .replace(/official\s*(music)?\s*video|official\s*audio|lyrics|hd|4k|remastered|visualizer|clip\s*officiel|video\s*clip/gi, '')
  .replace(/ft\.?|feat\.?/gi, '')
  .replace(/[^\w\s\u0400-\u04FF]/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

  let cleanArtist = (artist || '')
  .replace(/\[.*?\]|\(.*?\)/g, '')
  .replace(/- topic|vevo|records|official/gi, '')
  .replace(/[^\w\s\u0400-\u04FF]/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

  return { cleanTitle, cleanArtist };
}

function fetchLyricsDirect(title, artist) {
  return new Promise((resolve) => {
    const { cleanTitle, cleanArtist } = sanitizeForLyrics(title, artist);
    const apiUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`;

    https.get(apiUrl, { headers: { 'User-Agent': 'devsize/2.0' }, timeout: 4000 }, (res) => {
      let data = '';
      const dec = new StringDecoder('utf8');
      res.on('data', c => data += dec.write(c));
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            const parsed = JSON.parse(data);
            if (parsed.syncedLyrics || parsed.plainLyrics) {
              return resolve(parsed.syncedLyrics || parsed.plainLyrics);
            }
          }
        } catch (e) {}

        const query = `${cleanArtist} ${cleanTitle}`.trim();
        const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
        https.get(searchUrl, { headers: { 'User-Agent': 'devsize/2.0' }, timeout: 4000 }, (res2) => {
          let data2 = '';
          res2.on('data', c => data2 += c);
          res2.on('end', () => {
            try {
              const list = JSON.parse(data2);
              if (Array.isArray(list) && list.length > 0) {
                const withSynced = list.find(item => item.syncedLyrics);
                if (withSynced) return resolve(withSynced.syncedLyrics);
                return resolve(list[0].syncedLyrics || list[0].plainLyrics || null);
              }
            } catch (e) {}
            resolve(null);
          });
        }).on('error', () => resolve(null));
      });
    }).on('error', () => resolve(null));
  });
}

const crypto = require('crypto');

function legacyCustomLyricsPath(title, artist) {
  const safeName = `${(artist || 'unknown').replace(/[^\w\s-]/g, '_')}_${(title || 'untitled').replace(/[^\w\s-]/g, '_')}.lrc`.toLowerCase().replace(/\s+/g, '_');
  return path.join(CUSTOM_LYRICS_DIR, safeName);
}

function legacyFetchedLyricsPath(title, artist) {
  const cleanTitle = (title || '').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  const cleanArtist = (artist || '').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  return path.join(LYRICS_DIR, `${cleanArtist}___${cleanTitle}.lrc`);
}

function lyricsKey(title, artist) {
  return crypto.createHash('sha1').update(`${(artist || '').trim().toLowerCase()}\u0000${(title || '').trim().toLowerCase()}`).digest('hex').slice(0, 16);
}

function getCustomLyricsPath(title, artist) {
  return path.join(CUSTOM_LYRICS_DIR, lyricsKey(title, artist) + '.lrc');
}

function getFetchedLyricsPath(title, artist) {
  return path.join(LYRICS_DIR, lyricsKey(title, artist) + '.lrc');
}

async function handleLyrics(req, res, title, artist, allowOnline = true) {
  const cacheKey = `${artist}:${title}`;
  if (lyricsCache.has(cacheKey)) {
    const cached = lyricsCache.get(cacheKey);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, lyrics: cached.text, isCustom: cached.isCustom || false }));
  }

  let customPath = getCustomLyricsPath(title, artist);
  if (!fs.existsSync(customPath) && /^[\x00-\x7F]*$/.test((title || '') + (artist || ''))) {
    const legacyPath = legacyCustomLyricsPath(title, artist);
    if (fs.existsSync(legacyPath)) {
      customPath = legacyPath;
    }
  }

  if (fs.existsSync(customPath)) {
    try {
      const customLyrics = await fs.promises.readFile(customPath, 'utf-8');
      lyricsCache.set(cacheKey, { text: customLyrics, isCustom: true });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, lyrics: customLyrics, isCustom: true }));
    } catch (e) {}
  }

  let fetchedLyricsPath = getFetchedLyricsPath(title, artist);
  if (!fs.existsSync(fetchedLyricsPath) && /^[\x00-\x7F]*$/.test((title || '') + (artist || ''))) {
    const legacyFetched = legacyFetchedLyricsPath(title, artist);
    if (fs.existsSync(legacyFetched)) {
      fetchedLyricsPath = legacyFetched;
    }
  }

  if (fs.existsSync(fetchedLyricsPath)) {
    try {
      const diskLyrics = await fs.promises.readFile(fetchedLyricsPath, 'utf-8');
      lyricsCache.set(cacheKey, { text: diskLyrics, isCustom: false });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, lyrics: diskLyrics, isCustom: false }));
    } catch (e) {}
  }

  if (!allowOnline) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, lyrics: '' }));
  }

  try {
    const rawLyrics = await fetchLyricsDirect(title, artist);
    if (rawLyrics && rawLyrics.trim().length > 0) {
      try {
        await fs.promises.writeFile(fetchedLyricsPath, rawLyrics, 'utf-8');
      } catch (e) {}
    }
    lyricsCache.set(cacheKey, { text: rawLyrics, isCustom: false });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, lyrics: rawLyrics }));
  } catch (err) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, lyrics: '' }));
  }
}

async function handleSaveCustomLyrics(req, res, title, artist) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const { lyrics } = JSON.parse(body);
      if (typeof lyrics !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'No lyrics provided' }));
      }

      const customPath = getCustomLyricsPath(title, artist);
      await fs.promises.writeFile(customPath, lyrics, 'utf-8');

      const cacheKey = `${artist}:${title}`;
      lyricsCache.delete(cacheKey);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: e.message }));
    }
  });
}

function handleSpotifyImport(req, res, inputUrl) {
  const m = (inputUrl || '').match(/playlist[/:]([a-zA-Z0-9]+)/);
  if (!m) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: false, error: 'Invalid Spotify playlist URL' }));
  }
  const playlistId = m[1];
  const embedUrl = `https://open.spotify.com/embed/playlist/${playlistId}`;
  const options = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    timeout: 10000
  };

  const getReq = https.get(embedUrl, options, (getRes) => {
    let body = '';
    getRes.on('data', chunk => body += chunk);
    getRes.on('end', () => {
      try {
        const nextDataMatch = body.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        if (!nextDataMatch) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'No __NEXT_DATA__ found' }));
        }
        const data = JSON.parse(nextDataMatch[1]);
        const entity = data?.props?.pageProps?.state?.data?.entity;
        if (!entity) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Spotify entity not found' }));
        }
        const name = entity.name || 'Spotify Playlist';
        const rawTracks = Array.isArray(entity.trackList) ? entity.trackList : [];
        const tracks = rawTracks.slice(0, 100).map(t => ({
          title: t.title || '',
          artist: t.subtitle || ''
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, name, tracks }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
  });

  getReq.on('error', (err) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  });
  getReq.on('timeout', () => {
    getReq.destroy();
    res.writeHead(504, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Spotify request timed out' }));
  });
}

function callTranslate(text, to) {
  return new Promise((resolve) => {
    const clients = ['dict-chrome-ex', 'gtx'];
    let idx = 0;
    function tryNext() {
      if (idx >= clients.length) return resolve(null);
      const c = clients[idx++];
      const u = `https://translate.googleapis.com/translate_a/single?client=${c}&sl=auto&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(text)}`;
      const req = https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 }, (res) => {
        let b = '';
        res.on('data', chunk => b += chunk);
        res.on('end', () => {
          if (res.statusCode !== 200) return tryNext();
          try {
            const data = JSON.parse(b);
            if (data && Array.isArray(data[0])) {
              const joined = data[0].map(s => s[0]).join('').split('\n');
              return resolve(joined);
            }
          } catch (e) {}
          tryNext();
        });
      });
      req.on('error', tryNext);
      req.on('timeout', () => { req.destroy(); tryNext(); });
    }
    tryNext();
  });
}

async function handleTranslate(req, res, lines, to = 'en') {
  if (!Array.isArray(lines) || lines.length === 0) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, translations: [] }));
  }

  const chunks = [];
  let curChunk = [];
  let curLen = 0;
  for (const line of lines) {
    if (curChunk.length > 0 && curLen + line.length + 1 > 1800) {
      chunks.push(curChunk);
      curChunk = [];
      curLen = 0;
    }
    curChunk.push(line);
    curLen += line.length + 1;
  }
  if (curChunk.length > 0) chunks.push(curChunk);

  const allTranslations = [];
  for (const chunk of chunks) {
    const joined = chunk.join('\n');
    let chunkTrans = await callTranslate(joined, to);
    if (!chunkTrans || chunkTrans.length !== chunk.length) {
      chunkTrans = [];
      for (const line of chunk) {
        if (!line.trim()) {
          chunkTrans.push('');
          continue;
        }
        const single = await callTranslate(line, to);
        chunkTrans.push((single && single[0]) ? single[0] : line);
      }
    }
    allTranslations.push(...chunkTrans);
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: true, translations: allTranslations }));
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsedUrl = url.parse(req.url, true);

  if (parsedUrl.pathname === '/api/translate' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const payload = safeJsonParse(body, {});
      const texts = payload.texts || payload.lines || [];
      const targetLang = payload.targetLang || payload.to || 'en';
      handleTranslate(req, res, texts, targetLang);
    });
    return;
  }

  if (parsedUrl.pathname === '/api/state' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const state = JSON.parse(body);
        currentAppState = state;
        broadcastSSE(state);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400); res.end();
      }
    });
    return;
  }

  if (parsedUrl.pathname === '/api/lyrics-stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    sseClients.add(res);
    res.write(`data: ${JSON.stringify(currentAppState)}\n\n`);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (parsedUrl.pathname === '/api/download') {
    const trackUrl = parsedUrl.query.url || '';
    const title = parsedUrl.query.title || '';
    const artist = parsedUrl.query.artist || '';
    const format = parsedUrl.query.format || 'mp3';
    const quality = parsedUrl.query.quality || '0';
    return handleDownload(req, res, trackUrl, title, artist, format, quality);
  }

  if (parsedUrl.pathname === '/api/spotify-import') {
    const spotifyUrl = parsedUrl.query.url || '';
    return handleSpotifyImport(req, res, spotifyUrl);
  }

  if (parsedUrl.pathname === '/api/search') {
    const q = parsedUrl.query.q || '';
    const platform = parsedUrl.query.platform || 'auto';
    const limit = parseInt(parsedUrl.query.limit || '20', 10);
    return handleSearch(req, res, q, platform, limit, false, parsedUrl.query.progressive==='1' && platform==='auto');
  }

  if (parsedUrl.pathname === '/api/playback-source' && req.method === 'POST') {
    let body='',tooLarge=false;
    req.on('data',chunk=>{if(tooLarge)return;body+=chunk;if(body.length>100000){tooLarge=true;res.writeHead(413);res.end();}});
    req.on('end',async()=>{
      if(tooLarge)return;
      const cancellation=new AbortController();res.on('close',()=>cancellation.abort());
      try {
        const payload=JSON.parse(body),original=payload.track;
        if(!original?.id || typeof original.url!=='string')throw new Error('This song has no source URL.');
        const status=spotifyProvider?.status() || {};
        const known=[...(original.alternatives||[]),...(status.tracks||[]),...(status.likedTracks||[])].filter(t=>sameRecording(original,t));
        const excluded=new Set(Array.isArray(payload.exclude)?payload.exclude:[]);
        const usable=t=>t.platform!=='spotify'||(!payload.mobile && status.playbackConnected);
        const cached=await findCachedFile(original.id);
        if(mobileCachedFile(cached, payload.mobile) && !payload.refresh){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({success:true,track:original,stream:{success:true,isLocal:true,streamUrl:`http://127.0.0.1:${serverPort}/api/local-track?id=${encodeURIComponent(cleanTrackId(original.id))}`}}));}
        const native=[original,...known].find(t=>t.playable!==false&&t.platform==='spotify'&&usable(t)&&!excluded.has(t.platform+':'+t.id));
        if(native){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({success:true,track:{...native,alternatives:[original,...known].filter(t=>t!==native)}}));}
        const resolve=async t=>{
          if(t.platform==='spotify'){if(payload.mobile)throw new Error('Spotify plays through the iOS SDK.');if(!status.playbackConnected)throw new Error('Connect Spotify playback first.');return {native:true};}
          if(!['youtube','ytmusic','soundcloud'].includes(t.platform))throw new Error('Unsupported audio source.');
          if(!/^https?:\/\//.test(t.url))throw new Error('Invalid source URL.');
          const file=await findCachedFile(t.id);
          if(mobileCachedFile(file, payload.mobile)&&!payload.refresh)return {success:true,isLocal:true,streamUrl:`http://127.0.0.1:${serverPort}/api/local-track?id=${encodeURIComponent(cleanTrackId(t.id))}`};
          return resolveAudioStream(t.url,t.id,t.platform,Boolean(payload.refresh),Boolean(payload.mobile));
        };
        const discover=async add=>{
          const sink={destroyed:false,writeHead(){},write(batch){try{const result=JSON.parse(batch);add(result.tracks.flatMap(t=>[t,...(t.alternatives||[])]).filter(usable));}catch{}},end(){}};
          await handleSearch(req,sink,original.artist+' '+original.title,'auto',10,true,true);
        };
        const result=await choosePlaybackSource({original,candidates:known.filter(usable),resolve,discover,excluded:[...excluded],signal:cancellation.signal});
        if(res.destroyed)return;
        res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({success:true,track:{...result.track,alternatives:result.alternatives,autoSelected:true},stream:result.stream.native?undefined:result.stream}));
      }catch(error){if(res.destroyed)return;res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({success:false,attempted:error.attempted||[],error:/timed out/i.test(error.message)?'Audio sources timed out. Try again.':/DRM protected/i.test(error.message)?'This recording is protected. Choose another source.':String(error.message).replace(/https?:\/\/\S+/g,'[source]').slice(-400)}));}
    });return;
  }

  if (parsedUrl.pathname === '/api/resolve-source') {
    const title = String(parsedUrl.query.title || '').slice(0,250), artist = String(parsedUrl.query.artist || '').slice(0,150);
    const original = {id:String(parsedUrl.query.id || ''),title,artist,duration:Number(parsedUrl.query.duration)||0,platform:String(parsedUrl.query.platform||'youtube'),url:String(parsedUrl.query.url||'')};
    const requested = ['youtube','ytmusic','soundcloud','spotify'].includes(parsedUrl.query.source) ? parsedUrl.query.source : 'auto';
    const excluded = new Set(String(parsedUrl.query.exclude||'').split(','));
    const sink = {writeHead(){},async end(body){
      let tracks=[];try{tracks=JSON.parse(body).tracks||[];}catch{}
      let candidates=tracks.flatMap(t=>[t,...(t.alternatives||[])]);
      // Flat YouTube results omit artist/duration. Resolve a few likely title
      // matches before deciding whether they are the same recording.
      const {normalize}=require('./source-selection');
      const likely=candidates.filter(t=>['youtube','ytmusic'].includes(t.platform)&&(!t.duration||/unknown/i.test(t.artist))&&normalize(t.title).includes(normalize(title).split(' feat ')[0])).slice(0,3);
      await Promise.all(likely.map(async t=>{try{const info=JSON.parse(await executeYtDlp(['--dump-single-json','--skip-download','--no-playlist',t.url],20000));t.duration=info.duration||t.duration;t.artist=(info.artist||info.artists?.join(', ')||info.channel||info.uploader||t.artist).replace(/\s*-\s*Topic$/i,'');}catch{}}));
      const matches=candidates.filter(t=>sameRecording(original,t));
      if(original.platform==='spotify'&&!spotifyProvider?.status().playbackConnected)original.playable=false;
      const available=[original,...matches].filter(t=>!excluded.has(t.platform+':'+t.id)&&(requested==='auto'||t.platform===requested));
      const best=selectSources(available,artist+' '+title,1)[0];
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(best?{success:true,track:{...best,sourceContext:spotifyProvider?.status().connected?'spotify':'public'}}:{success:false,error:'No matching recording is available from '+(requested==='auto'?'another source':requested)+'.'}));
    }};
    if(requested==='spotify') {
      try {sink.end(JSON.stringify({tracks:spotifyProvider?.status().connected?await spotifyProvider.search(artist+' '+title):[]}));}catch{sink.end('{}');}
      return;
    }
    return handleSearch(req,sink,artist+' '+title,requested,10,true);
  }

  if (parsedUrl.pathname === '/api/vibe'  && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const payload = safeJsonParse(body, {});
      handleVibeRecommendations(req, res, payload);
    });
    return;
  }

  if (parsedUrl.pathname === '/api/artist') {
    const name = parsedUrl.query.name || '';
    if (!name) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Missing artist name' }));
    }
    const info = await fetchArtistInfo(name);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, artist: info }));
  }

  if (parsedUrl.pathname === '/api/prefetch') {
    const trackUrl = parsedUrl.query.url || '';
    const trackId = parsedUrl.query.id || '';
    const platform = parsedUrl.query.platform || 'youtube';
    prefetchTrack(trackUrl, trackId, platform);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true }));
  }

  if (parsedUrl.pathname === '/api/check-cache') {
    const trackId = parsedUrl.query.id || '';
    const cleanId = cleanTrackId(trackId);
    const cachedFile = await findCachedFile(cleanId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ 
      cached: !!cachedFile, 
      streamUrl: cachedFile ? `http://127.0.0.1:${serverPort}/api/local-track?id=${encodeURIComponent(cleanId)}` : null
    }));
  }

  if (parsedUrl.pathname === '/api/tools-status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(require('./tools').toolsStatus()));
  }

  if (parsedUrl.pathname === '/api/tools-install') {
    require('./tools').ensureTools().catch(() => {});
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ started: true }));
  }

  if (parsedUrl.pathname === '/api/stream-info') {
    const trackUrl = parsedUrl.query.url || '';
    const trackId = parsedUrl.query.id || '';
    const platform = parsedUrl.query.platform || 'youtube';
    const title = parsedUrl.query.title || '';
    const artist = parsedUrl.query.artist || '';
    const duration = parsedUrl.query.duration || 0;
    const thumbnail = parsedUrl.query.thumbnail || '';
    return handleStreamInfo(req, res, trackUrl, trackId, platform, title, artist, duration, thumbnail);
  }

  if (parsedUrl.pathname === '/api/local-track') {
    const trackId = parsedUrl.query.id || '';
    return handleLocalTrack(req, res, trackId);
  }

  if (parsedUrl.pathname === '/api/library-add' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const items = Array.isArray(payload.items) ? payload.items : [];
        const fileRegex = /^local_[a-f0-9]{12}\.[a-z0-9]+$/;
        let addedCount = 0;
        for (const item of items) {
          if (!item || !item.id || !item.file) continue;
          if (!fileRegex.test(item.file)) continue;
          const fullPath = path.join(LIBRARY_DIR, item.file);
          if (!fs.existsSync(fullPath)) continue;

          let rawName = (item.name || '').trim();
          let cleanName = rawName.replace(/^\d+(?:[.\s-]+)\s*/, '').trim() || rawName || 'Untitled';

          const dashIdx = cleanName.indexOf(' - ');
          let artist = 'Unknown artist';
          let title = cleanName;
          if (dashIdx !== -1) {
            artist = cleanName.slice(0, dashIdx).trim() || 'Unknown artist';
            title = cleanName.slice(dashIdx + 3).trim() || cleanName;
          }

          libraryIndex[item.id] = {
            id: item.id,
            file: item.file,
            ext: item.ext || path.extname(item.file).slice(1).toLowerCase(),
            title: title,
            artist: artist,
            duration: 0,
            addedAt: Date.now()
          };
          addedCount++;
        }
        saveLibraryIndex();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, count: addedCount }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  if (parsedUrl.pathname === '/api/library-update' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const { id, duration } = payload;
        if (id && libraryIndex[id] && typeof duration === 'number' && !isNaN(duration)) {
          libraryIndex[id].duration = duration;
          saveLibraryIndex();
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  if (parsedUrl.pathname === '/api/library') {
    const list = Object.values(libraryIndex)
      .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
      .map(item => ({
        id: item.id,
        platform: 'local',
        title: item.title,
        artist: item.artist,
        duration: Number(item.duration) || 0,
        thumbnail: ''
      }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(list));
  }

  if (parsedUrl.pathname === '/api/library-file') {
    const trackId = parsedUrl.query.id || '';
    return handleLibraryFile(req, res, trackId);
  }

  if (parsedUrl.pathname === '/api/library-remove' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const id = payload.id || parsedUrl.query.id || '';
        if (id && libraryIndex[id]) {
          const item = libraryIndex[id];
          if (item.file) {
            const fullPath = path.join(LIBRARY_DIR, item.file);
            try {
              if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
            } catch (e) {}
          }
          delete libraryIndex[id];
          saveLibraryIndex();
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  if (parsedUrl.pathname === '/api/local-thumbnail') {
    const trackId = parsedUrl.query.id || '';
    const cleanId = cleanTrackId(trackId);
    const thumbPath = path.join(THUMBNAILS_DIR, `${cleanId}.jpg`);
    if (fs.existsSync(thumbPath)) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000' });
      return fs.createReadStream(thumbPath).pipe(res);
    }
    res.writeHead(404);
    return res.end('Thumbnail not cached');
  }

  if (parsedUrl.pathname === '/api/offline-library') {
    const tracks = [];
    let totalBytes = 0;
    try {
      const files = await fs.promises.readdir(CACHE_DIR);
      const audioExtRegex = /\.(opus|webm|m4a|mp3)$/i;
      for (const file of files) {
        if (audioExtRegex.test(file) && !file.includes('.temp.')) {
          const cleanId = file.replace(audioExtRegex, '');
          const stat = await fs.promises.stat(path.join(CACHE_DIR, file));
          totalBytes += stat.size;
          const meta = trackMetadataIndex[cleanId] || {};
          tracks.push({
            id: meta.id || cleanId,
            cleanId: cleanId,
            title: meta.title || cleanId,
            artist: meta.artist || 'Unknown artist',
            duration: meta.duration || 0,
            thumbnail: meta.thumbnail || '',
            localThumbnail: fs.existsSync(path.join(THUMBNAILS_DIR, `${cleanId}.jpg`)) ? `http://127.0.0.1:${serverPort}/api/local-thumbnail?id=${cleanId}` : (meta.thumbnail || ''),
            platform: meta.platform || 'youtube',
            fileSize: stat.size,
            lastPlayed: meta.lastPlayed || stat.mtimeMs,
            analysis: meta.analysis || null
          });
        }
      }
    } catch (e) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, count: tracks.length, totalBytes, tracks }));
  }

  if (parsedUrl.pathname === '/api/track-analysis') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const cleanId = cleanTrackId(payload.id || '');
          if (cleanId && payload.analysis) {
            saveTrackMetadata(cleanId, { analysis: payload.analysis });
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
    const cleanId = cleanTrackId(parsedUrl.query.id || '');
    const meta = trackMetadataIndex[cleanId] || {};
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, analysis: meta.analysis || null }));
  }

  if (parsedUrl.pathname === '/api/offline-delete' && req.method === 'POST') {
    const trackId = parsedUrl.query.id || '';
    const cleanId = cleanTrackId(trackId);
    const audioPath = await findCachedFile(cleanId);
    const thumbPath = path.join(THUMBNAILS_DIR, `${cleanId}.jpg`);
    try { if (audioPath && fs.existsSync(audioPath)) await fs.promises.unlink(audioPath); } catch (e) {}
    try { if (fs.existsSync(thumbPath)) await fs.promises.unlink(thumbPath); } catch (e) {}
    delete trackMetadataIndex[cleanId];
    try { fs.writeFileSync(METADATA_PATH, JSON.stringify(trackMetadataIndex, null, 2), 'utf-8'); } catch (e) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true }));
  }

  if (parsedUrl.pathname === '/api/clear-offline-library' && req.method === 'POST') {
    try {
      const files = await fs.promises.readdir(CACHE_DIR);
      const audioExtRegex = /\.(opus|webm|m4a|mp3)$/i;
      for (const file of files) {
        if (audioExtRegex.test(file)) {
          try { await fs.promises.unlink(path.join(CACHE_DIR, file)); } catch (e) {}
        }
      }
      const thumbFiles = await fs.promises.readdir(THUMBNAILS_DIR);
      for (const file of thumbFiles) {
        try { await fs.promises.unlink(path.join(THUMBNAILS_DIR, file)); } catch (e) {}
      }
      trackMetadataIndex = {};
      try { fs.writeFileSync(METADATA_PATH, '{}', 'utf-8'); } catch (e) {}
    } catch (e) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true }));
  }

  if (parsedUrl.pathname === '/api/audio-proxy') {
    const targetUrl = parsedUrl.query.url || '';
    return handleAudioProxy(req, res, targetUrl, parsedUrl.query.stream);
  }

  if (parsedUrl.pathname === '/api/save-custom-lyrics' && req.method === 'POST') {
    const title = parsedUrl.query.title || '';
    const artist = parsedUrl.query.artist || '';
    return handleSaveCustomLyrics(req, res, title, artist);
  }

  if (parsedUrl.pathname === '/api/lyrics') {
    const title = parsedUrl.query.title || '';
    const artist = parsedUrl.query.artist || '';
    const allowOnline = parsedUrl.query.online !== '0';
    return handleLyrics(req, res, title, artist, allowOnline);
  }

  res.writeHead(404);
  res.end('Not found');
});

function startServer(port = PORT) {
  return new Promise((resolve, reject) => {
    const onListening = () => {
      server.removeListener('error', onError);
      serverPort = server.address().port;
      console.log(`Riff internal server running on http://127.0.0.1:${serverPort}`);
      require('./tools').updateYtDlpIfManaged().catch(() => {});
      resolve(serverPort);
    };
    const onError = (err) => {
      if (err.code === 'EADDRINUSE' && port !== 0) {
        port = 0;
        server.once('error', onError);
        server.listen(0, '127.0.0.1');
      } else {
        server.removeListener('listening', onListening);
        reject(err);
      }
    };
    server.once('listening', onListening);
    server.once('error', onError);
    server.listen(port, '127.0.0.1');
  });
}

function stopServer() {
  stopTools();
  for (const client of sseClients) client.end();
  sseClients.clear();
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err && err.code !== 'ERR_SERVER_NOT_RUNNING') reject(err);
      else resolve();
    });
    server.closeIdleConnections?.();
  });
}

module.exports = { startServer, stopServer, PORT, setSpotifyProvider };

if (require.main === module) {
  startServer();
}
