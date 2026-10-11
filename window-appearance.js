// Native appearance is shared by the window and renderer; text never fades.
const path = require('path');
const DEFAULTS = Object.freeze({ mode: 'system', transparent: true, opacity: 78, reduceTransparency: false });
function normalizeAppearance(value, previous = DEFAULTS) {
  const result = { ...previous };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  if (['system', 'light', 'dark'].includes(value.mode)) result.mode = value.mode;
  for (const key of ['transparent', 'reduceTransparency']) if (typeof value[key] === 'boolean') result[key] = value[key];
  if (typeof value.opacity === 'number' && Number.isFinite(value.opacity)) result.opacity = Math.max(0, Math.min(95, Math.round(value.opacity)));
  return result;
}
function createAppearance({ app, nativeTheme, fs, platform, getWindow, onApplied = () => {} }) {
  const file = path.join(app.getPath('userData'), 'appearance.json');
  let preferences = { ...DEFAULTS };
  try { preferences = normalizeAppearance(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch {}
  nativeTheme.themeSource = preferences.mode;
  function snapshot() {
    const reduced = preferences.reduceTransparency || nativeTheme.prefersReducedTransparency || nativeTheme.shouldUseHighContrastColors;
    return { ...preferences, effectiveMode: nativeTheme.shouldUseDarkColors ? 'dark' : 'light', nativeTransparency: platform === 'darwin', effectiveTransparency: platform === 'darwin' && preferences.transparent && !reduced, systemReduceTransparency: Boolean(nativeTheme.prefersReducedTransparency || nativeTheme.shouldUseHighContrastColors) };
  }
  function background() { const s = snapshot(); return s.effectiveTransparency ? '#00000000' : s.effectiveMode === 'dark' ? '#252422' : '#f4f6f9'; }
  function apply() {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    const state = snapshot();
    if (platform === 'darwin') window.setVibrancy(state.effectiveTransparency ? 'under-window' : null);
    window.setBackgroundColor(background());
    // Vibrancy can replace native backing views. Refresh their clipping after
    // every appearance change, including toggles that do not resize the window.
    onApplied(window);
    window.webContents.send('appearance-changed', state);
  }
  nativeTheme.on('updated', apply);
  function set(value) {
    const next = normalizeAppearance(value, preferences);
    // Persist before changing the UI, so a failed write is visible to the caller.
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(next));
    preferences = next;
    nativeTheme.themeSource = preferences.mode;
    apply();
    return snapshot();
  }
  return { snapshot, background, apply, set };
}
module.exports = { DEFAULTS, normalizeAppearance, createAppearance };
