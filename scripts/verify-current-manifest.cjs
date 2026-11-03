'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
function verify(manifestPath,base){
 const manifest=JSON.parse(fs.readFileSync(path.join(root,manifestPath),'utf8'));
 assert.equal(manifest.version,1);assert(Array.isArray(manifest.files)&&manifest.files.length>0);
 const seen=new Set();for(const row of manifest.files){
  assert(typeof row.path==='string'&&/^(?:[A-Za-z0-9_@.\[\]-]+\/)*[A-Za-z0-9_@.\[\]-]+$/.test(row.path)&&!row.path.split('/').includes('..'));
  assert(/^[a-f0-9]{64}$/.test(row.sha256)&&!seen.has(row.path));seen.add(row.path);
  const file=path.resolve(base,row.path);assert(file.startsWith(path.resolve(base)+path.sep));
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),row.sha256,'SOURCE_MISMATCH '+row.path);
 }
 return manifest.files.length;
}
module.exports={root,verify};
