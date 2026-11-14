'use strict';
// "unknown" post checks are explained, but the decision itself is unchanged. Fixture only.
const assert = require('node:assert/strict'), fs = require('node:fs'), Module = require('node:module'), ts = require('typescript');
Module._extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const { classifyPostResponse, explainUnknownPost } = require('../lib/post-status.ts');
const post = { x_post_id: '2111000000000000001', author_id: '123', author_username: 'fixture' };
const ok = (over = {}) => ({ code: 200, status: { type: 'status', provider: 'twitter', id: post.x_post_id, text: 't', author: { id: '123', screen_name: 'fixture', protected: false }, media: { videos: [{ type: 'video', url: 'https://video.twimg.com/a.mp4' }] }, ...over } });
const cases = [
  [404, { status: null, thread: null, author: null, code: 404 }, 'not_found_no_message'],            // real provider shape (2026-11-14)
  [404, { code: 404, message: 'GONE', status: null }, 'not_found_other_message'],
  [401, { code: 401 }, 'unauthorized_401'],
  [403, { code: 403 }, 'forbidden_403'],
  [200, ok({ author: { id: '999', screen_name: 'other', protected: false } }), 'author_mismatch'],
  [200, ok({ media: undefined }), 'no_media_list'],
  [200, ok({ id: '5' }), 'id_mismatch'],
  [200, ok({ text: undefined }), 'status_shape'],
  [200, { code: 200, message: 'BAD', status: ok().status }, 'message_not_ok'],
  [200, ok({ type: 'tombstone', provider: 'twitter', reason: 'deleted' }), 'tombstone_deleted'],
  [500, { code: 500 }, 'bad_http_or_body'],
];
for (const [http, body, why] of cases) {
  assert.equal(explainUnknownPost(post, http, body), why, why);
  // Diagnostics must not change decisions: everything explained here besides the deleted tombstone stays "unknown".
  if (why !== 'tombstone_deleted') assert.equal(classifyPostResponse(post, http, body), 'unknown', 'unchanged: ' + why);
}
assert.equal(classifyPostResponse(post, 200, ok()), 'public');
assert.equal(classifyPostResponse(post, 404, { code: 404, message: 'NOT_FOUND', status: null }), 'missing');
assert.equal(explainUnknownPost({ x_post_id: 'x' }, 200, {}), 'bad_post_id');
console.log('PASS UNKNOWN DIAGNOSTICS: reasons for 404-without-message/401/403/author/media/shape; classification unchanged. Fixture only.');
