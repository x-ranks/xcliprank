'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),root=path.resolve(__dirname,'..'),sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const b=JSON.parse(fs.readFileSync(path.join(root,'docs/production-source-baseline-20261018.json'))),o=JSON.parse(fs.readFileSync(path.join(root,'docs/features/public-labels-pages-production-v1-20261018-source.json'))),expected=new Map(Object.entries(b.files).map(([n,r])=>[n,r.sha256]));
for(const[n,r]of Object.entries(b.files))assert.equal(sha(path.join(root,'snapshots/production-live-20261018',n)),r.sha256,'DEPLOYED_SNAPSHOT_CHANGED '+n);
for(const[n,c]of Object.entries(o.files)){assert.equal(expected.get(n)??null,c.before??null,'UNKNOWN_PRODUCTION_OVERLAY '+n);expected.set(n,c.after);}
for(const[n,h]of expected)assert.equal(sha(path.join(root,'production/source',n)),h,'PRODUCTION_SOURCE_MISMATCH '+n);
console.log('PRODUCTION_SOURCE_OK; '+b.verified.files+' verified live files; '+expected.size+' candidate files; no private config/state/models; application pending.');
