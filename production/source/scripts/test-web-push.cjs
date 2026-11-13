'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), Module = require('node:module'), ts = require('typescript'), crypto = require('node:crypto'), { execFileSync } = require('node:child_process');
Module._extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const wp = require('../lib/web-push.ts'), svc = require('../lib/push-service.ts');
const read = f => fs.readFileSync(f, 'utf8');

(async () => {
  // RFC 8291 section 5 worked example: byte-for-byte.
  const rfc = wp.encryptWebPush(Buffer.from('When I grow up, I want to be a watermelon'), { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
    { senderPrivate: Buffer.from('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', 'base64url'), salt: Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url') });
  assert.equal(rfc.toString('base64url'), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');

  // A browser-side decrypt of a random message returns the original text (receiver derivation, RFC 8291 section 3.4).
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys(); const authSecret = crypto.randomBytes(16);
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: ua.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') };
  const decrypt = body => {
    const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen), data = body.subarray(21 + idlen);
    assert.equal(rs, 4096); assert.equal(idlen, 65);
    const shared = ua.computeSecret(asPublic);
    const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]), 32));
    const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)), nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
    const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(data.subarray(data.length - 16));
    const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]); assert.equal(plain[plain.length - 1], 2); return plain.subarray(0, plain.length - 1).toString();
  };
  assert.equal(decrypt(wp.encryptWebPush(Buffer.from('こんにちは twizou'), sub)), 'こんにちは twizou');
  assert.throws(() => wp.encryptWebPush(Buffer.alloc(2001), sub), /TOO_LARGE/);

  // Endpoint and key validation (the server must never be pointed at arbitrary hosts).
  for (const ok of ['https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/Qx', 'https://wns2-par02p.notify.windows.com/w/?token=x']) assert(wp.allowedPushEndpoint(ok), ok);
  for (const bad of ['http://fcm.googleapis.com/x', 'https://evil.example/x', 'https://fcm.googleapis.com.evil.example/x', 'https://127.0.0.1/x', 'https://user:pw@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://notify.windows.com.evil.io/x', 'javascript:alert(1)', '', 5, null, 'https://fcm.googleapis.com/' + 'a'.repeat(700)]) assert(!wp.allowedPushEndpoint(bad), String(bad).slice(0, 40));
  assert(wp.validSubscriptionKeys(sub.p256dh, sub.auth)); assert(!wp.validSubscriptionKeys('AAAA', sub.auth)); assert(!wp.validSubscriptionKeys(sub.p256dh, 'AAAA')); assert(!wp.validSubscriptionKeys(5, null));

  // VAPID: the JWT verifies with the public key and names the push service as audience.
  const vapid = { ...wp.generateVapidKeys(), subject: 'https://twizou.net' };
  const header = wp.vapidAuthorization(sub.endpoint, vapid, 1000000);
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header); assert(m); assert.equal(m[4], vapid.publicKey);
  const claims = JSON.parse(Buffer.from(m[2], 'base64url')); assert.deepEqual(claims, { aud: 'https://fcm.googleapis.com', exp: 1000000 + 43200, sub: 'https://twizou.net' });
  const pub = Buffer.from(vapid.publicKey, 'base64url'), jwk = { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') };
  assert(crypto.verify('sha256', Buffer.from(m[1] + '.' + m[2]), { key: crypto.createPublicKey({ format: 'jwk', key: jwk }), dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url')), 'ES256 signature verifies');
  assert.throws(() => wp.vapidAuthorization(sub.endpoint, { ...vapid, privateKey: 'AAAA' }), /VAPID_KEY_INVALID/);
  assert.equal(wp.readVapidConfig({}), null); assert.equal(wp.readVapidConfig({ PUSH_VAPID_PUBLIC_KEY: 'x', PUSH_VAPID_PRIVATE_KEY: 'y' }), null);
  assert.equal(wp.readVapidConfig({ PUSH_VAPID_PUBLIC_KEY: vapid.publicKey, PUSH_VAPID_PRIVATE_KEY: vapid.privateKey }).subject, 'https://twizou.net');

  // sendWebPush: headers, encrypted body, and refusal of bad endpoints without any request.
  let seen; const fakeFetch = async (url, init) => { seen = { url, init }; return { status: 201 }; };
  assert.equal(await wp.sendWebPush(sub, svc.PUSH_MESSAGE, vapid, fakeFetch), 201);
  assert.equal(seen.url, sub.endpoint); assert.equal(seen.init.headers['Content-Encoding'], 'aes128gcm'); assert.equal(seen.init.headers.Urgency, 'low'); assert.equal(seen.init.redirect, 'error');
  assert.deepEqual(JSON.parse(decrypt(Buffer.from(seen.init.body))), svc.PUSH_MESSAGE);
  seen = null; assert.equal(await wp.sendWebPush({ ...sub, endpoint: 'https://evil.example/x' }, svc.PUSH_MESSAGE, vapid, fakeFetch), 0); assert.equal(seen, null);
  assert.equal(await wp.sendWebPush(sub, svc.PUSH_MESSAGE, vapid, async () => { throw Error('net'); }), 0);
  // The notification text is generic: no author, video or tag content.
  assert.equal(svc.PUSH_MESSAGE.title, 'twizou'); assert(!/[#@]/.test(svc.PUSH_MESSAGE.body));

  // Subscription parsing.
  const good = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth }, follows: ['abc', 'abc', 'id-12'] };
  assert.deepEqual(svc.parseSubscription(good), { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, follows: ['abc', 'id-12'] });
  for (const bad of [null, {}, { ...good, follows: 'x' }, { ...good, follows: ['Bad Key'] }, { ...good, follows: Array.from({ length: 31 }, (_, i) => 'u' + i) }, { ...good, endpoint: 'https://evil.example/x' }, { ...good, keys: { p256dh: 'x', auth: 'y' } }]) assert.equal(svc.parseSubscription(bad), null);
  const rows = new Map(); let idSeq = 0;
  const store = {
    count: async () => rows.size, upsert: async r => { const old = rows.get(r.endpoint); rows.set(r.endpoint, { id: old?.id ?? ++idSeq, ...r, notifiedThrough: old?.notifiedThrough ?? '2026-11-13T00:00:00.000Z' }); }, remove: async e => { rows.delete(e); },
    removeIds: async ids => { for (const [k, r] of rows) if (ids.includes(r.id)) rows.delete(k); },
    page: async (after, limit) => [...rows.values()].filter(r => r.id > after).sort((a, b) => a.id - b.id).slice(0, limit),
    markChecked: async (ids, t) => { for (const r of rows.values()) if (ids.includes(r.id)) r.notifiedThrough = t; },
    markSent: async (ids, t) => { for (const r of rows.values()) if (ids.includes(r.id)) { r.notifiedThrough = t; r.sent = t; } },
    markFailed: async ids => { for (const r of rows.values()) if (ids.includes(r.id)) r.failed = (r.failed || 0) + 1; },
  };
  assert.equal(await svc.subscribe(store, good), 'ok'); assert.equal(await svc.subscribe(store, { ...good, follows: ['abc'] }), 'ok'); assert.equal(rows.size, 1, 'same endpoint updates in place');
  assert.deepEqual([...rows.values()][0].follows, ['abc']); assert.equal(await svc.subscribe(store, { endpoint: 'x' }), 'invalid');

  // Digest.
  rows.clear(); idSeq = 0;
  const ep = n => 'https://fcm.googleapis.com/fcm/send/' + n, mk = (n, follows) => store.upsert({ endpoint: ep(n), p256dh: sub.p256dh, auth: sub.auth, follows });
  await mk('news', ['a']); await mk('quiet', ['b']); await mk('none', []); await mk('gone', ['a']); await mk('flaky', ['a']); await mk('broken-feed', ['bad']);
  const now = Date.parse('2026-11-13T11:00:00Z');
  const videosFor = { a: [{ createdAt: '2026-11-13T05:00:00Z' }], b: [{ createdAt: '2026-11-12T05:00:00Z' }] };
  const feed = async keys => { if (keys.includes('bad')) return { videos: [], failedKeys: ['bad'] }; return { videos: keys.flatMap(k => videosFor[k] || []) }; };
  const sent = [], send = async (s, message, v) => { sent.push([s.endpoint, message]); return s.endpoint.endsWith('gone') ? 410 : s.endpoint.endsWith('flaky') ? 503 : 201; };
  const out = await svc.runDigest({ store, feed, send, vapid, now: () => now });
  assert.deepEqual(out, { checked: 6, sent: 1, removed: 1, failed: 2, quiet: 2 });
  assert.deepEqual(sent.map(s => s[0]), [ep('news'), ep('gone'), ep('flaky')]); assert.deepEqual(sent[0][1], svc.PUSH_MESSAGE);
  const by = n => rows.get(ep(n));
  assert.equal(by('news').notifiedThrough, '2026-11-13T11:00:00.000Z'); assert.equal(by('news').sent, '2026-11-13T11:00:00.000Z');
  assert.equal(by('quiet').notifiedThrough, '2026-11-13T11:00:00.000Z'); assert.equal(by('quiet').sent, undefined, 'nothing new: nothing sent');
  assert.equal(rows.has(ep('gone')), false, '410 removes the subscription');
  assert.equal(by('flaky').notifiedThrough, '2026-11-13T00:00:00.000Z', 'failed send is retried next run'); assert.equal(by('flaky').failed, 1);
  assert.equal(by('broken-feed').notifiedThrough, '2026-11-13T00:00:00.000Z', 'unreadable author is not "nothing new"');
  // A second run right after sends nothing (no duplicate notifications).
  sent.length = 0; assert.equal((await svc.runDigest({ store, feed, send, vapid, now: () => now + 60000 })).sent, 0); assert.deepEqual(sent.map(s => s[0]), [ep('flaky')], 'only the previously failed one is tried again; already-notified ones are not');
  // Posts after the run started are left for the next run.
  rows.clear(); idSeq = 0; await mk('late', ['a']);
  assert.equal((await svc.runDigest({ store, feed: async () => ({ videos: [{ createdAt: '2026-11-13T11:30:00Z' }] }), send, vapid, now: () => now })).sent, 0);
  // Table cap.
  assert.equal(await svc.subscribe({ ...store, count: async () => svc.PUSH_MAX_SUBSCRIPTIONS }, good), 'full');

  // The key generator script prints usable settings.
  const lines = Object.fromEntries(execFileSync(process.execPath, ['scripts/generate-vapid.cjs'], { encoding: 'utf8' }).trim().split('\n').map(l => l.split(/=(.*)/s).slice(0, 2)));
  assert(wp.readVapidConfig(lines)); assert(lines.PUSH_SEND_SECRET.length >= 24);

  // Wiring and safety.
  // New routes are denied by middleware unless listed (this was missed once): every push route must be public there.
  const middleware = read('middleware.ts');
  for (const route of ['/api/push', '/api/push/send']) assert(middleware.includes(`"${route}",`), route + ' is in PUBLIC_EXACT_PATHS');
  for (const dir of ['app/api/push/route.ts', 'app/api/push/send/route.ts', 'app/sw.js/route.ts']) assert(fs.existsSync(dir), dir);
  assert(read('app/following/page.tsx').includes('<PushToggle />'));
  const toggle = read('app/components/PushToggle.tsx'), client = read('lib/push-client.ts');
  assert(!/requestPermission/.test(toggle) && /requestPermission/.test(client), 'permission is asked only from the button handler path, never on load');
  assert(/const turnOn = async/.test(toggle) && toggle.includes('onClick={on ? turnOff : turnOn}'));
  assert(read('app/components/FollowButton.tsx').includes('syncPushFollows(readFollows(window.localStorage))'));
  for (const f of ['app/components/PushToggle.tsx', 'lib/push-client.ts']) assert(!/PRIVATE_KEY|SEND_SECRET|supabase/i.test(read(f)), f + ' holds no secrets');
  const sw = read('app/sw.js/route.ts'); assert(sw.includes('Service-Worker-Allowed') && sw.includes('showNotification') && sw.includes('notificationclick') && !sw.includes('addEventListener("fetch"'));
  assert(sw.includes('startsWith("/") && !data.url.startsWith("//")'), 'notification links stay on this site');
  const sendRoute = read('app/api/push/send/route.ts'); assert(sendRoute.includes('timingSafeEqual') && sendRoute.includes('PUSH_SEND_SECRET') && sendRoute.includes('status: 401'));
  assert(read('app/api/push/route.ts').includes('export async function DELETE') && read('lib/push-request.ts').includes('MAX_BYTES'));
  assert(read('app/privacy/page.tsx').includes('新着通知を希望した場合のみ'));
  assert(read('supabase/push-subscriptions.sql').includes('enable row level security') && !/create policy/i.test(read('supabase/push-subscriptions.sql')));
  console.log('PASS WEB PUSH: RFC 8291 vector, decrypt round trip, endpoint allow-list, VAPID signature, digest rules (no duplicates, retry, 410 cleanup, quiet days), caps, scripts, wiring, no secrets in browser code.');
})().catch(e => { console.error(e); process.exit(1); });
