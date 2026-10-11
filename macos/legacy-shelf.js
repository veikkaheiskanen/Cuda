'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { ClassicLevel } = require('classic-level');
const names = new Set(['devsize_favorites', 'devsize_history', 'devsize_playlists']);
function decode(value) {
  if (value[0] === 0) return value.subarray(1).toString('utf16le');
  if (value[0] === 1) return value.subarray(1).toString('latin1');
  return '';
}
function tracks(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  return values.filter(track => track && (typeof track.id === 'string' || (typeof track.id === 'number' && Number.isFinite(track.id))) && typeof track.title === 'string').map(track => ({ ...track, id: String(track.id), platform: track.platform || 'youtube', artist: track.artist || 'Unknown artist', url: track.url || '' })).filter(track => { const key = track.platform + ':' + track.id; if (seen.has(key)) return false; seen.add(key); return true; });
}
async function migrateShelf(directory) {
  const output = path.join(directory, 'native-shelf.json');
  try { await fs.access(output); return { migrated: false }; } catch {}
  const source = path.join(directory, 'Local Storage', 'leveldb');
  try { await fs.access(path.join(source, 'CURRENT')); } catch { return { migrated: false }; }
  // Open a private copy. Never acquire a lock or write to the Chromium profile.
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'cuda-shelf-migration-'));
  let db;
  try {
    await fs.cp(source, path.join(scratch, 'db'), { recursive: true });
    db = new ClassicLevel(path.join(scratch, 'db'), { keyEncoding: 'buffer', valueEncoding: 'buffer', createIfMissing: false });
    await db.open();
    const saved = {};
    for await (const [key, value] of db.iterator()) {
      if (key[0] !== 95) continue;
      const separator = key.indexOf(0), origin = key.subarray(1, separator).toString('utf8');
      if (separator < 0 || !(origin === 'file://' || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) continue;
      const name = decode(key.subarray(separator + 1));
      if (!names.has(name)) continue;
      try { saved[name] = JSON.parse(decode(value)); } catch {}
    }
    if (!Object.keys(saved).length) return { migrated: false };
    const playlists = (Array.isArray(saved.devsize_playlists) ? saved.devsize_playlists : []).filter(p => p && typeof p.name === 'string').map(p => ({ id: String(p.id || require('node:crypto').randomUUID()), name: p.name, description: p.description || '', tracks: tracks(p.tracks) }));
    const state = { local: [], favourites: tracks(saved.devsize_favorites), history: tracks(saved.devsize_history).slice(0, 200), playlists, selectedSpotify: [] };
    await fs.writeFile(output, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
    return { migrated: true, favourites: state.favourites.length, playlists: state.playlists.length };
  } catch (error) {
    if (error.code === 'EEXIST') return { migrated: false };
    return { migrated: false, retry: true };
  } finally {
    await db?.close().catch(() => {});
    await fs.rm(scratch, { recursive: true, force: true });
  }
}
module.exports = { migrateShelf, decode, tracks };
