'use strict';
const assert = require('node:assert/strict');
const base = process.env.BASE, publicEdge = base === 'https://xcliprank.com';
if (!base || !/^https?:\/\/(?:127\.0\.0\.1:\d+|xcliprank\.com)$/.test(base)) throw Error('INVALID_VERIFY_BASE');
async function request(p, options = {}) { return fetch(base + p, { ...options, redirect: 'manual', signal: AbortSignal.timeout(30000) }); }
async function status(label, p, expected, options = {}, json = false) {
  const r = await request(p, options), allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(r.status)) throw Error(label + ': HTTP=' + r.status + '; EXPECTED=' + allowed.join('|') + '; JSON=' + /application\/json/i.test(r.headers.get('content-type') || ''));
  if (json) {
    assert(/application\/json/i.test(r.headers.get('content-type') || ''), label + ': APPLICATION_JSON_REQUIRED');
    assert(/no-store/.test(r.headers.get('cache-control') || ''), label + ': NO_STORE_REQUIRED');
    assert(/noindex/.test(r.headers.get('x-robots-tag') || ''), label + ': NOINDEX_REQUIRED');
    return r.json();
  }
  return r;
}
(async () => {
  await status('DOWNLOAD_PAGE', '/download', 200);
  const admin = await status('PUBLIC_LABEL_ADMIN_AUTH', '/api/public-label-admin', 401, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, true);
  assert.equal(admin.ok, false, 'ADMIN_UNAUTHENTICATED_MUST_FAIL');
  const foreign = await status('PUBLIC_SAVE_ORIGIN', '/api/public-save-event', 403, { method: 'POST', headers: { origin: 'https://foreign.invalid', 'content-type': 'application/json' }, body: '{}' }, true);
  assert.equal(foreign.ok, false, 'FOREIGN_SAVE_MUST_FAIL');
  // Existing Apache policy can reject an unknown private API before Next's 404.
  await status('PRIVATE_LABEL_PAGE', '/label-publication', 404);
  await status('PRIVATE_LABEL_API', '/api/label-publication', publicEdge ? [403, 404] : 404);
  await status('INVALID_DETAIL_PAGE', '/p/invalid', 404);
  const empty = await status('PUBLIC_VIDEO_READ', '/api/public-video?type=detail&value=invalid', 200, {}, true);
  assert.equal(empty.ok, true); assert.equal(empty.data, null);
  if (publicEdge) {
    const home = await status('HOME_PAGE', '/', 200), html = await home.text();
    const ids = [...html.matchAll(/href="\/p\/([1-9][0-9]{1,24})"/g)].map(m => m[1]);
    if (ids.length) {
      let checked = false;
      for (const id of [...new Set(ids)].slice(0, 3)) {
        const r = await request('/p/' + id); if (r.status === 404) continue;
        assert.equal(r.status, 200, 'CURRENT_DETAIL_HTTP'); const text = await r.text();
        for (const value of ['rel="canonical"', 'https://xcliprank.com/p/' + id, '動画を保存', '同じ投稿者の他動画', '関連動画']) assert(text.includes(value), 'CURRENT_DETAIL_REQUIRED_CONTENT_MISSING');
        assert(/name="robots" content="(?:index|noindex),/.test(text)); checked = true; break;
      }
      assert(checked, 'CURRENT_PUBLIC_DETAIL_NOT_VERIFIED');
    } else console.log('PUBLIC_LIST_EMPTY; verify a real eligible video after collection');
  }
  console.log('PUBLIC_LABELS_PAGES_ENDPOINTS_V2_OK; application JSON guards verified; no publication/save/collection/CDN calls');
})().catch(e => { console.error(e.message); process.exitCode = 1; });
