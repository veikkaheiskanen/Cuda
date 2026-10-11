const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { normalizeAppearance, createAppearance } = require('../window-appearance');
function fixture(saved, platform = 'darwin', onApplied) {
  const nativeTheme = Object.assign(new EventEmitter(), { shouldUseDarkColors: false, prefersReducedTransparency: false, shouldUseHighContrastColors: false });
  const store = new Map(saved === undefined ? [] : [['/profile/appearance.json', saved]]);
  const window = { isDestroyed: () => false, setVibrancy(value) { this.vibrancy = value; }, setBackgroundColor(value) { this.background = value; }, webContents: { send() {} } };
  const controller = createAppearance({ app: { getPath: () => '/profile' }, nativeTheme, platform, getWindow: () => window, onApplied, fs: { readFileSync: name => { if (!store.has(name)) throw Error('missing'); return store.get(name); }, mkdirSync() {}, writeFileSync: (name, value) => store.set(name, value) } });
  return { controller, nativeTheme, store, window };
}
test('appearance rejects invalid input and bounds tint without changing unrelated preferences', () => {
  assert.deepEqual(normalizeAppearance({ mode: 'auto', transparent: 'yes', opacity: NaN }), normalizeAppearance(null));
  assert.equal(normalizeAppearance({ opacity: 0 }).opacity, 0);
  assert.equal(normalizeAppearance({ opacity: 100 }).opacity, 95);
  assert.equal(normalizeAppearance({ opacity: 82.4 }).opacity, 82);
});
test('native clipping refresh runs after background and vibrancy on every appearance change', () => {
  const seen=[];
  const f=fixture(undefined,'darwin',window=>seen.push([window.vibrancy,window.background]));
  f.controller.apply();
  f.controller.set({transparent:false});
  f.controller.set({transparent:true});
  f.nativeTheme.shouldUseDarkColors=true;f.nativeTheme.emit('updated');
  assert.deepEqual(seen,[['under-window','#00000000'],[null,'#f4f6f9'],['under-window','#00000000'],['under-window','#00000000']]);
});
test('saved appearance survives startup, corrupt preferences use system defaults', () => {
  const f = fixture('{"mode":"dark","transparent":false,"opacity":90}');
  assert.equal(f.nativeTheme.themeSource, 'dark');
  f.controller.set({ mode: 'light' });
  const restored = fixture(f.store.get('/profile/appearance.json'));
  assert.equal(restored.nativeTheme.themeSource, 'light');
  assert.equal(restored.controller.snapshot().transparent, false);
  assert.equal(restored.controller.snapshot().opacity, 90);
  assert.equal(fixture('{broken').controller.snapshot().mode, 'system');
});
test('system appearance updates native tint and accessibility overrides window vibrancy', () => {
  const f = fixture(); f.controller.apply();
  assert.equal(f.window.vibrancy, 'under-window');
  assert.equal(f.window.background, '#00000000');
  f.nativeTheme.shouldUseDarkColors = true; f.nativeTheme.emit('updated');
  assert.equal(f.controller.snapshot().effectiveMode, 'dark');
  f.nativeTheme.prefersReducedTransparency = true; f.nativeTheme.emit('updated');
  assert.equal(f.window.vibrancy, null);
  assert.equal(f.window.background, '#252422');
  f.nativeTheme.prefersReducedTransparency = false; f.nativeTheme.shouldUseHighContrastColors = true; f.nativeTheme.emit('updated');
  assert.equal(f.controller.snapshot().effectiveTransparency, false);
  f.nativeTheme.shouldUseHighContrastColors = false; f.controller.set({ reduceTransparency: true });
  assert.equal(f.window.vibrancy, null);
  f.controller.set({ reduceTransparency: false });
  assert.equal(f.window.vibrancy, 'under-window');
  f.controller.set({ transparent: false });
  assert.equal(f.window.vibrancy, null);
});
test('other platforms remain opaque and report native blur availability accurately', () => {
  const f = fixture(undefined, 'win32'); f.controller.apply();
  assert.equal(f.controller.snapshot().nativeTransparency, false);
  assert.equal(f.controller.snapshot().effectiveTransparency, false);
  assert.equal(f.window.background, '#f4f6f9');
});
