'use strict';
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const load = (file, resolve = require) => { const m = { exports: {} };
  new Function('module', 'exports', 'require', ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(m, m.exports, resolve); return m.exports; };
const lib = load('lib/install-prompt.ts', n => n.endsWith('engagement-surface') ? load('lib/engagement-surface.ts') : require(n));
const DAY = 24 * 3600 * 1000, now = Date.UTC(2026, 10, 12, 12);

// Visit days: Japan-time dates, de-duplicated, bounded, bad input ignored.
assert.equal(lib.japanDay(Date.UTC(2026, 10, 12, 16)), '2026-11-13', 'UTC evening is already the next day in Japan');
assert.deepEqual(lib.addVisitDay(null, now), ['2026-11-12']);
assert.deepEqual(lib.addVisitDay(['2026-11-12'], now), ['2026-11-12']);
assert.deepEqual(lib.addVisitDay(['2026-11-10', 'x', 5, '2026-11-12'], now), ['2026-11-10', '2026-11-12']);
let days = []; for (let i = 0; i < 9; i++) days = lib.addVisitDay(days, now + i * DAY); assert.equal(days.length, 5);

// Offer rules: only a returning, age-confirmed, non-installed visitor on a list page who has not declined recently.
const base = { days: ['2026-11-10', '2026-11-12'], dismissedAt: null, installed: false, standalone: false, ageConfirmed: true, path: '/', now };
assert.equal(lib.shouldOfferInstall(base), true);
assert.equal(lib.shouldOfferInstall({ ...base, days: ['2026-11-12'] }), false, 'first-day visitors are never asked');
assert.equal(lib.shouldOfferInstall({ ...base, ageConfirmed: false }), false, 'not over the age gate');
assert.equal(lib.shouldOfferInstall({ ...base, standalone: true }), false);
assert.equal(lib.shouldOfferInstall({ ...base, installed: true }), false);
for (const p of ['/p/2091860611881967725', '/reels', '/terms', '/download']) assert.equal(lib.shouldOfferInstall({ ...base, path: p }), false, p);
for (const p of ['/', '/rising', '/ranking/daily', '/ranking/weekly', '/favorites']) assert.equal(lib.shouldOfferInstall({ ...base, path: p }), true, p);
assert.equal(lib.shouldOfferInstall({ ...base, dismissedAt: now - 3 * DAY }), false, 'declined 3 days ago');
assert.equal(lib.shouldOfferInstall({ ...base, dismissedAt: now - 15 * DAY }), true, 'declined long ago');
assert.equal(lib.shouldOfferInstall({ ...base, dismissedAt: now + DAY }), true, 'a future timestamp is ignored');
assert.equal(lib.shouldOfferInstall({ ...base, dismissedAt: 'bad' }), true);

// Install mode by environment.
const iosSafari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1';
assert.equal(lib.installMode({ canPrompt: true, userAgent: 'x', standalone: false }), 'prompt');
assert.equal(lib.installMode({ canPrompt: true, userAgent: 'x', standalone: true }), null);
assert.equal(lib.installMode({ canPrompt: false, userAgent: iosSafari, standalone: false }), 'ios');
assert.equal(lib.installMode({ canPrompt: false, userAgent: iosSafari + ' Twitter for iPhone', standalone: false }), 'open-in-browser');
assert.equal(lib.installMode({ canPrompt: false, userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120', standalone: false }), null);

// Manifest: installable shape, icons exist with the declared sizes, scope covers start_url.
const manifest = load('app/manifest.ts').default();
assert.equal(manifest.display, 'standalone'); assert.equal(manifest.name, 'twizou'); assert.ok(manifest.start_url.startsWith(manifest.scope));
const png = file => { const b = fs.readFileSync(path.join(root, 'public', file)); assert.equal(b.subarray(1, 4).toString(), 'PNG'); return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`; };
for (const icon of manifest.icons) assert.equal(png(icon.src.slice(1)), icon.sizes, icon.src);
assert.ok(manifest.icons.some(i => i.sizes === '192x192') && manifest.icons.some(i => i.sizes === '512x512') && manifest.icons.some(i => i.purpose === 'maskable'));

// Layout wiring and page-safety: the bar is client-only, renders nothing on the server, and sits after the age gate.
const layout = fs.readFileSync(path.join(root, 'app/layout.tsx'), 'utf8');
assert(layout.includes('<InstallPrompt />') && layout.includes('appleWebApp') && layout.includes('themeColor'));
const component = fs.readFileSync(path.join(root, 'app/components/InstallPrompt.tsx'), 'utf8');
assert(component.startsWith('"use client"') && component.includes('data-age-confirmed') && component.includes('beforeinstallprompt'));
console.log('PASS INSTALL PROMPT: visit days, offer rules, install modes, manifest/icons, layout wiring.');
