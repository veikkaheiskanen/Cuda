'use strict';
const fs = require('node:fs'), path = require('node:path');
const {normalize, sameRecording} = require('./source-selection');
const artistKey = t => normalize(String(t.artist || '').split(/,| & /)[0]);
function genreName(value) { const name=value.trim().toLowerCase(); return ({'hip-hop/rap':'hip hop','hip-hop':'hip hop','hip-hop/rap music':'hip hop','r&b/soul':'r&b','rnb':'r&b'})[name] || name; }
const genresOf = t => [...new Set((Array.isArray(t.genres) ? t.genres : []).filter(g => typeof g === 'string' && g.length <= 64).map(genreName).filter(Boolean))];
function profileFor(history, favourites, playlists = []) {
  const artists = new Map(), genres = new Map(), listened = new Map();
  function add(t, weight, played) {
    const key = artistKey(t);
    if (key && !/^unknown/.test(key)) {
      const entry = artists.get(key) || {name: t.artist, weight: 0, genres: new Set()};
      entry.weight += weight; genresOf(t).forEach(g => entry.genres.add(g)); artists.set(key, entry);
    }
    for (const g of genresOf(t)) { genres.set(g, (genres.get(g) || 0) + weight); if (played) listened.set(g, (listened.get(g) || 0) + weight); }
  }
  history.slice(0, 100).forEach((t, i) => add(t, 4 * Math.exp(-i / 24), true));
  favourites.slice(0, 100).forEach(t => add(t, 1.5, false));
  playlists.slice(0, 100).forEach(t => add(t, .4, false));
  return {artists: [...artists.values()].map(a => ({...a, genres: [...a.genres]})).sort((a,b) => b.weight-a.weight),
    genres: [...listened].sort((a,b) => b[1]-a[1]).slice(0, 10).map(([name]) => name), weights: Object.fromEntries(genres)};
}
function rankRecommendations(candidates, profile, history, genre = 'all', limit = 20, seen = []) {
  const artistWeights = new Map(profile.artists.map(a => [normalize(a.name.split(/,| & /)[0]), a]));
  const recent = history.slice(0, 12), ranked = [];
  for (const t of candidates) {
    if (!t?.id || !t.url || t.playable === false || recent.some(r => sameRecording(r,t))) continue;
    const durations=history.map(r=>r.duration).filter(d=>d>0).sort((a,b)=>a-b);
    if(durations.length && t.duration>Math.max(900,4*durations[Math.floor(durations.length/2)]))continue;
    const artist = artistWeights.get(artistKey(t)), tags = genresOf(t);
    const relevant = tags.includes(genre) || artist?.genres.includes(genre);
    if (genre !== 'all' && !relevant) continue;
    let score = Math.min(8, artist?.weight || 0) + tags.reduce((s,g) => s + Math.min(4, profile.weights[g] || 0), 0);
    if (!history.some(r => sameRecording(r,t))) score += 3;
    if (seen.includes(t.platform+':'+t.id)) score -= 3;
    if (/official|topic/i.test(t.title+' '+t.artist)) score += 1;
    if (/\b(cover|slowed|sped up|reverb)\b/i.test(t.title) && !history.some(r => /\b(cover|slowed|sped up|reverb)\b/i.test(r.title))) score -= 4;
    ranked.push({track:t, score});
  }
  ranked.sort((a,b) => b.score-a.score);
  const selected = [], counts = new Map();
  for (const {track} of ranked) {
    const key = artistKey(track);
    if ((counts.get(key) || 0) >= 2 || selected.some(t => sameRecording(t,track))) continue;
    selected.push(track); counts.set(key, (counts.get(key) || 0) + 1);
    if (selected.length >= limit) break;
  }
  return selected;
}
// Public genre metadata, exact recording credits to avoid same-name artists.
// One serialized request per second and a bounded persistent cache.
function createGenreLookup({directory, fetcher = fetch, now = Date.now, pause = ms => new Promise(r => setTimeout(r,ms))} = {}) {
  const file = directory && path.join(directory, 'listened-genres.json');
  let cache = {}, tail = Promise.resolve(), last = 0, catalogTail = Promise.resolve(), catalogLast = 0;
  try { cache = JSON.parse(fs.readFileSync(file)); } catch {}
  function persist() { if (!file) return; try { fs.writeFileSync(file+'.tmp', JSON.stringify(cache), {mode:0o600}); fs.renameSync(file+'.tmp',file); } catch {} }
  function request(route) {
    const job = tail.then(async () => {
      await pause(Math.max(0, 1100 - (now()-last))); last = now();
      const response = await fetcher('https://musicbrainz.org/ws/2/'+route, {headers:{'User-Agent':'Cuda/1.0.9 (https://github.com/veikkaheiskanen/Cuda)', Accept:'application/json'}, signal:AbortSignal.timeout(5000)});
      if (!response.ok) throw Error('Genre lookup unavailable'); return response.json();
    }); tail = job.catch(()=>{}); return job;
  }
  function catalogGenre(track) {
    const job = catalogTail.then(async () => {
      await pause(Math.max(0, 3100 - (now()-catalogLast))); catalogLast=now();
      const response = await fetcher('https://itunes.apple.com/search?'+new URLSearchParams({term:track.artist+' '+track.title,entity:'song',limit:'5'}), {signal:AbortSignal.timeout(5000)});
      if (!response.ok) return [];
      const result = await response.json();
      const title = normalize(track.title).replace(artistKey(track)+' ','');
      const match = (result.results || []).find(t => normalize(t.trackName) === title && normalize(t.artistName.split(/,| & /)[0]) === artistKey(track));
      return match?.primaryGenreName ? [genreName(match.primaryGenreName)] : [];
    }); catalogTail=job.catch(()=>{}); return job;
  }
  return async function enrich(track) {
    if (genresOf(track).length || !artistKey(track) || /^unknown/.test(artistKey(track))) return track;
    const key = normalize(track.artist)+'|'+normalize(track.title);
    const saved = cache[key];
    if (saved && saved.expires > now()) return {...track, genres:saved.genres};
    try {
      const title = normalize(track.title).replace(new RegExp('^'+artistKey(track).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+' '),'');
      const query = 'recording:"'+title.replace(/"/g,'')+'" AND artist:"'+artistKey(track).replace(/"/g,'')+'"';
      const result = await request('recording?'+new URLSearchParams({query,fmt:'json',limit:'5'}));
      const match = (result.recordings || []).find(r => normalize(r.title) === title && (r['artist-credit'] || []).some(a => normalize(a.artist?.name) === artistKey(track)));
      const credit = match?.['artist-credit']?.find(a => normalize(a.artist?.name) === artistKey(track));
      let genres = [];
      if (credit?.artist?.id && /^[a-f0-9-]{36}$/.test(credit.artist.id)) {
        const artist = await request('artist/'+credit.artist.id+'?inc=genres&fmt=json');
        genres = (artist.genres || []).filter(g => g.count > 0).sort((a,b)=>b.count-a.count).slice(0,3).map(g=>genreName(g.name));
      }
      if (!genres.length) genres = await catalogGenre(track);
      cache[key] = {genres, expires:now()+(genres.length?30:1)*86400000};
      const keys = Object.keys(cache); for (const k of keys.slice(0,Math.max(0,keys.length-500))) delete cache[k]; persist();
      return {...track, genres};
    } catch {
      try { const genres=await catalogGenre(track); cache[key]={genres,expires:now()+86400000}; persist(); return {...track,genres}; } catch { return track; }
    } // Never invent genres when metadata is missing.
  };
}
function createRecommendations({lookup, search}) {
  return async function recommend({history = [], favourites = [], playlists = [], genre = 'all', limit = 20, enabled = [], seen = []}) {
    let timer;
    const learned = enabled.length ? await Promise.race([Promise.all(history.slice(0,3).map(lookup)),new Promise(resolve=>{timer=setTimeout(()=>resolve(history.slice(0,3)),10000);})]).finally(()=>clearTimeout(timer)) : [];
    const enriched = learned.concat(history.slice(3));
    const profile = profileFor(enriched, favourites, playlists);
    if (genre !== 'all' && !profile.genres.includes(genre)) genre = 'all';
    const artists = profile.artists.filter(a => genre === 'all' || a.genres.includes(genre)).slice(0,3);
    const queries = [...artists.map(a => ({text:a.name})), ...(genre === 'all' ? profile.genres.slice(0,2) : [genre]).map(g => ({text:g+' music',genre:g}))].slice(0,4);
    // No generic moods or cold-start assumptions about a person's taste.
    if (!queries.length || !enabled.length) return {tracks:[], genres:profile.genres, genre, learned};
    const batches = await Promise.all(queries.map((query,i) => search(query.text,enabled,i,query.genre)));
    const candidates = batches.flat();
    const tracks = rankRecommendations(candidates,profile,enriched,genre,limit,seen);
    return {tracks:tracks.slice(0,limit), genres:profile.genres, genre, learned};
  };
}
module.exports = { genresOf, profileFor, rankRecommendations, createGenreLookup, createRecommendations };
