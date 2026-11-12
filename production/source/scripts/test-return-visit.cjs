const fs=require('fs'),assert=require('node:assert/strict'),ts=require('typescript');
const load=file=>{const m={exports:{}};new Function('module','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(m,m.exports);return m.exports;};
const v=load('lib/new-since-visit.ts'),r=load('lib/recent-videos.ts');
const now=1_700_000_000_000,HOUR=3600_000;
const ids=['2117117404014915944','2117000000000000001','2097567908347936941','999999999999999999'];
// numeric ordering by length then text
assert.ok(v.compareIds('10','9')>0&&v.compareIds('2117117404014915944','2097567908347936941')>0&&v.compareIds('5','5')===0);
// first visit, a short gap and a bad stored value never show a banner
assert.equal(v.newSinceVisit(ids,null,null,now),null);
assert.equal(v.newSinceVisit(ids,'2097567908347936941',now-10*60_000,now),null,'within 30 minutes is the same visit');
assert.equal(v.newSinceVisit(ids,'abc',now-5*HOUR,now),null);
assert.equal(v.newSinceVisit(ids,'2097567908347936941',now+1000,now),null,'future timestamp ignored');
// returning visitor: only ids above the stored newest count, keeping list positions
const n=v.newSinceVisit(ids,'2097567908347936941',now-5*HOUR,now);
assert.deepEqual(n.indexes,[0,1]);assert.equal(n.count,2);assert.equal(n.sinceMs,5*HOUR);
assert.equal(v.newSinceVisit(ids,'2117117404014915944',now-5*HOUR,now),null,'nothing newer');
// newest id helper
assert.equal(v.newestId(ids,null),'2117117404014915944');assert.equal(v.newestId(ids,'3000000000000000000'),'3000000000000000000');assert.equal(v.newestId([],'bad'),null);
// labels
assert.equal(v.sinceLabel(40*60_000),'40分前');assert.equal(v.sinceLabel(5*HOUR),'5時間前');assert.equal(v.sinceLabel(50*HOUR),'2日前');
// recent videos: newest first, de-duplicated, bounded, invalid ignored, storage failure tolerated
const store=()=>{const m=new Map();return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,x)=>m.set(k,x)};};
const s=store();assert.deepEqual(r.readRecent(s),[]);
assert.ok(r.recordRecent(s,'111'));assert.ok(r.recordRecent(s,'222'));assert.ok(r.recordRecent(s,'111'));assert.deepEqual(r.readRecent(s),['111','222']);
assert.equal(r.recordRecent(s,'0abc'),false);assert.equal(r.recordRecent(s,'<x>'),false);
for(let i=0;i<150;i++)r.recordRecent(s,String(1000+i));assert.equal(r.readRecent(s).length,100);assert.equal(r.readRecent(s)[0],'1149');
assert.deepEqual(r.readRecent({getItem:()=>'{broken'}),[]);assert.equal(r.recordRecent({getItem(){throw Error('x')},setItem(){throw Error('x')}},'123'),false);
console.log('PASS RETURN VISIT: new-since-visit counts/positions/30-minute gap/bad input, numeric id ordering, recent list order/dedupe/limit/storage failure.');
// Visit baseline: fixed at the start of a visit and shared by every list opened in that visit.
{
  const b=v.nextBaseline,prev={top:'2097567908347936941',at:now-5*HOUR};
  const first=b(null,prev,now);
  assert.deepEqual(first,{top:'2097567908347936941',at:now-5*HOUR,touched:now},'a new visit starts from the stored previous record');
  // Another list in the same visit keeps that reference even though the stored record was already updated.
  const again=b(first,{top:'2117117404014915944',at:now},now+60_000);
  assert.equal(again.top,'2097567908347936941');assert.equal(again.at,now-5*HOUR);assert.equal(again.touched,now+60_000);
  assert.deepEqual(v.newSinceVisit(ids,again.top,again.at,now+60_000).indexes,[0,1],'the banner repeats on the second list');
  // After 30 idle minutes the tab starts a new visit from the then-stored record.
  const later=b(again,{top:'2117117404014915944',at:now+60_000},now+60_000+31*60_000);
  assert.equal(later.top,'2117117404014915944');
  // Bad session data or no previous record is safe.
  assert.deepEqual(b({top:'x',at:1,touched:now},null,now),{top:null,at:null,touched:now});
  assert.deepEqual(b('garbage',null,now),{top:null,at:null,touched:now});
  assert.equal(v.newSinceVisit(ids,b(null,null,now).top,b(null,null,now).at,now),null,'first-ever visit shows no banner');
}
console.log('PASS RETURN VISIT: shared visit baseline across lists.');
