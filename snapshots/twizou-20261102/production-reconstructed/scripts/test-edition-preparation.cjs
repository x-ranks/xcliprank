'use strict';
const fs=require('fs'),path=require('path'),ts=require('typescript'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'),realNow=Date.now;let snapshot=1793192400000,now=snapshot+10000,created=0,release;
const saved=new Map(),tasks=[],pending=()=>new Promise(r=>release=r),id=t=>t+'-abcdefabcdef';
let gate=pending();saved.set(id(snapshot-300000),{edition:id(snapshot-300000),snapshot:snapshot-300000});
function resolve(n){if(n==='next/server')return {after:fn=>tasks.push(fn)};if(n.endsWith('ranking-editions'))return {editionId:id,validateEditionId(){},readEdition:async key=>saved.get(key)||null,saveEdition:async value=>{saved.set(value.edition,value);return value}};if(n.endsWith('ranking-liquidity'))return {liquidityClock:()=>({snapshot})};if(n.endsWith('post-status-store'))return {unavailableKeys:async()=>new Set()};return {};}
const source=fs.readFileSync(path.join(root,'app/api/rankings/route.ts'),'utf8').replace('async function createRankingEdition(','async function originalCreateRankingEdition(')+'\nconst createRankingEdition=async(snapshot)=>{await globalThis.__twizouPrepareFixture(snapshot);return {edition:snapshot+"-abcdefabcdef",snapshot};};\nexport const __loadEdition=loadRankingEdition;';
const moduleFixture={exports:{}};new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(resolve,moduleFixture,moduleFixture.exports);
(async()=>{Date.now=()=>now;globalThis.__twizouPrepareFixture=async()=>{created++;await gate;};
 try{
  const load=moduleFixture.exports.__loadEdition;
  assert.equal((await load(null)).edition,id(snapshot-300000));assert.equal(created,0,'Old prepared edition returns before new DB work');
  const background=tasks.shift()();await Promise.resolve();await Promise.resolve();assert.equal(created,1);
  assert.equal((await load(null)).edition,id(snapshot-300000),'Browsing does not await the running preparation');
  release();await background;assert.equal((await load(null)).edition,id(snapshot));
  await assert.rejects(load(id(snapshot-900000)),/RANKING_EDITION_EXPIRED/,'Unknown explicit historical order cannot be regenerated');
  snapshot+=300000;now=snapshot+61000;gate=pending();let completed=false;const outsideGrace=load(null).then(value=>{completed=true;return value;});await Promise.resolve();await Promise.resolve();assert(!completed,'No previous-order fallback after the one-minute grace period');release();assert.equal((await outsideGrace).edition,id(snapshot));
  console.log('PASS edition preparation: old order returns without DB wait inside bounded grace, background single flight, ready order selected, explicit missing history rejected, no unbounded stale fallback');
 }finally{Date.now=realNow;delete globalThis.__twizouPrepareFixture;}
})().catch(e=>{console.error(e);process.exitCode=1;});
