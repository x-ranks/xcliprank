'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
const root = process.env.XCLIP_V2_INSTALLER || __dirname;
const { amend, run } = require(path.join(root, 'htaccess.cjs'));
let passed = 0; function test(name, fn) { fn(); passed++; }
const methods = 'engagement|contact-requests|removal-requests|collect-curated-author|video-resolve|free-curated-sync';
const apis = 'rankings|reels|video|engagement|engagement-stats|video-download|video-resolve|video-playback-url|free-curated-sync|custom-existing';
const legacy = '# Fixture only; no real server settings\nPassengerAppRoot "/home/example/runtime"\nRewriteEngine On\nRewriteCond %{REQUEST_METHOD} !^(GET|HEAD)$ [NC]\nRewriteCond %{REQUEST_URI} !^/api/(' + methods + ')(/|$) [NC]\nRewriteRule ^ - [F,L]\nRewriteCond %{REQUEST_URI} ^/api/ [NC]\nRewriteCond %{REQUEST_URI} !^/api/(' + apis + ')(/|$) [NC]\nRewriteRule ^ - [F,L]\n# Preserve all unrelated rules verbatim\nRewriteRule ^secret - [F,L]\n';
function denied(config, method, url) {
  const rules = [...config.matchAll(/RewriteCond %{REQUEST_URI} !\^\/api\/\(([^)]+)\)\(\/\|\$\) \[NC\]/g)].map(m => new RegExp('^/api/(' + m[1] + ')(/|$)', 'i'));
  assert.equal(rules.length, 2);
  const p = new URL(url, 'https://fixture.invalid').pathname;
  return (!['GET', 'HEAD'].includes(method) && !rules[0].test(p)) || (/^\/api\//i.test(p) && !rules[1].test(p));
}
test('reproduce old production 403 before application auth', () => assert(denied(legacy, 'POST', '/api/public-label-admin')));
const after = amend(legacy);
test('only append exact five entries across two guards', () => {
  const expected = legacy.replace(methods + ')(/|$)', methods + '|public-label-admin|public-save-event)(/|$)').replace(apis + ')(/|$)', apis + '|public-video|public-label-admin|public-save-event)(/|$)');
  assert.equal(after, expected); assert.equal(amend(after), after);
});
test('preserve CRLF configuration bytes', () => assert.equal(amend(legacy.replaceAll('\n', '\r\n')), after.replaceAll('\n', '\r\n')));
test('required new paths pass, private and wrong method stay blocked', () => {
  for (const p of ['/api/public-label-admin', '/api/public-save-event']) assert(!denied(after, 'POST', p));
  assert(!denied(after, 'GET', '/api/public-video?type=detail&value=invalid'));
  for (const p of ['/api/label-publication', '/api/label-learning', '/api/unknown', '/api/public-label-admin-other']) assert(denied(after, 'POST', p));
  assert(denied(after, 'POST', '/api/public-video')); assert(!denied(after, 'GET', '/api/custom-existing'));
});
test('unknown, missing, duplicate and altered guards refused', () => {
  for (const text of [legacy.replace('engagement|contact', 'other|contact'), legacy.replace('RewriteRule ^ - [F,L]', 'RewriteRule ^ - [L]'), legacy.replace('!^(GET|HEAD)$', '!^(GET)$'), legacy + legacy, '', legacy.replace(apis, apis + '|rankings')]) assert.throws(() => amend(text));
});
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xclip-deploy-v2-test-'));
try {
  if (typeof process.getuid === 'function') {
    const target = path.join(tmp, '.htaccess'), stage = path.join(tmp, 'stage'); fs.mkdirSync(stage); fs.writeFileSync(target, legacy, { mode: 0o644 });
    test('real filesystem prepare leaves live unchanged and private backups', () => {
      run('prepare', target, stage); assert.equal(fs.readFileSync(target, 'utf8'), legacy);
      assert.equal(fs.statSync(path.join(stage, 'htaccess.before')).mode & 0o777, 0o600);
    });
    test('real apply verify restore and reapply preserve bytes and mode', () => {
      run('apply', target, stage); run('verify', target, stage); run('check-installed', target, stage);
      assert.equal(fs.readFileSync(target, 'utf8'), after); assert.equal(fs.statSync(target).mode & 0o777, 0o644);
      run('restore', target, stage); run('restore', target, stage); assert.equal(fs.readFileSync(target, 'utf8'), legacy);
      run('apply', target, stage); run('restore', target, stage);
    });
    test('concurrent change never overwritten on apply or restore', () => {
      fs.writeFileSync(target, legacy + '# external\n'); assert.throws(() => run('apply', target, stage)); assert.throws(() => run('restore', target, stage));
      assert.equal(fs.readFileSync(target, 'utf8'), legacy + '# external\n'); fs.writeFileSync(target, legacy);
    });
    test('symlink and writable mode refused', () => {
      const link = path.join(tmp, 'symlink'); fs.symlinkSync(target, link); assert.throws(() => run('check-installed', link, stage));
      fs.chmodSync(target, 0o666); assert.throws(() => run('check-installed', target, stage)); fs.chmodSync(target, 0o644);
    });
    test('failure after switch restores runtime and web settings', () => {
      const live = path.join(tmp, 'runtime'), backup = path.join(tmp, 'previous'), next = path.join(tmp, 'next');
      fs.mkdirSync(live); fs.writeFileSync(path.join(live, 'build'), 'old'); fs.mkdirSync(next); fs.writeFileSync(path.join(next, 'build'), 'new');
      fs.renameSync(live, backup); fs.renameSync(next, live); run('apply', target, stage);
      try { assert.fail('simulated public check failure'); } catch { fs.renameSync(live, next); fs.renameSync(backup, live); run('restore', target, stage); }
      assert.equal(fs.readFileSync(path.join(live, 'build'), 'utf8'), 'old'); assert.equal(fs.readFileSync(target, 'utf8'), legacy);
    });
  }
  const verifier = path.join(root, 'verify-endpoints.cjs');
  function verify(scenario) {
    const preload = path.join(tmp, 'fetch-fixture.cjs');
    fs.writeFileSync(preload, `global.fetch=async(url,options={})=>{const p=new URL(url).pathname;let status=200,body={ok:false},headers={'content-type':'application/json','cache-control':'no-store','x-robots-tag':'noindex'};
      if(p==='/api/public-label-admin')status=${scenario === 'edge403' ? 403 : 401};
      else if(p==='/api/public-save-event'){status=403;${scenario === 'fake403' ? "headers['content-type']='text/html';body='blocked upstream';" : ''}}
      else if(p==='/api/public-video')body={ok:true,data:null};
      else if(p==='/label-publication'||p==='/p/invalid')status=404;
      else if(p==='/api/label-publication')status=403;
      else if(p==='/') {headers['content-type']='text/html';body='<a href="/p/12345">fixture</a>';}
      else if(p==='/p/12345') {headers['content-type']='text/html';body='<link rel="canonical" href="https://xcliprank.com/p/12345"><meta name="robots" content="index,follow">動画を保存 同じ投稿者の他動画 関連動画';}
      return new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers});};`);
    return cp.spawnSync(process.execPath, ['--require', preload, verifier], { env: { ...process.env, BASE: 'https://xcliprank.com' }, encoding: 'utf8', windowsHide: true });
  }
  test('public verifier accepts application JSON and existing private edge denial', () => { const r = verify('ok'); assert.equal(r.status, 0, r.stderr); });
  test('public verifier never accepts edge403 instead of application401', () => { const r = verify('edge403'); assert.equal(r.status, 1); assert(r.stderr.includes('PUBLIC_LABEL_ADMIN_AUTH: HTTP=403')); });
  test('public verifier rejects HTML403 masquerading as application origin guard', () => { const r = verify('fake403'); assert.equal(r.status, 1); assert(r.stderr.includes('APPLICATION_JSON_REQUIRED')); });
  console.log(JSON.stringify({ deploymentChecksPassed: passed, linuxFilesystemChecks: typeof process.getuid === 'function', realApacheTested: false, networkRequests: 0, realStateChanges: false }));
} finally {
  assert.equal(path.dirname(path.resolve(tmp)), path.resolve(os.tmpdir())); assert(path.basename(tmp).startsWith('xclip-deploy-v2-test-')); fs.rmSync(tmp, { recursive: true, force: true });
}
module.exports = { legacy, after, denied };
