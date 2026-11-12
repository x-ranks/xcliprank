const fs=require('fs'),assert=require('node:assert/strict'),ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync('lib/engagement-client.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const store=()=>{const m=new Map();return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};};
let sent=[],now=1_700_000_000_000,broken=false;
const local=store(),realLocal=local;
const setup=(search,referrer,path='/p/1',session=store())=>{
 global.window={localStorage:broken?{getItem(){throw Error('denied')},setItem(){throw Error('denied')}}:realLocal,sessionStorage:session,location:{search,pathname:path,origin:'https://twizou.net'}};
 global.document={referrer};
 Object.defineProperty(global,'navigator',{value:{sendBeacon:(url,blob)=>{sent.push(blob);return true;}},configurable:true,writable:true});
 global.Blob=class{constructor(parts){this.text=parts.join('');}};
};
Date.now=()=>now;
const m={exports:{}};const surfaceModule=(()=>{const x={exports:{}};new Function('module','exports',ts.transpileModule(fs.readFileSync('lib/engagement-surface.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(x,x.exports);return x.exports;})();
new Function('require','module','exports',code)(n=>n.endsWith('engagement-surface')?surfaceModule:require(n),m,m.exports);
const track=()=>{sent=[];m.exports.trackEngagement({eventType:'page_view',path:'/p/1'});return JSON.parse(sent[0].text);};
// 1. first visit from X with UTM keeps the attribution
setup('?utm_source=x&utm_medium=post&utm_campaign=a','https://t.co/abc');
const a=track();
assert.equal(a.metadata.utmSource,'x');assert.equal(a.metadata.referrerHost,'t.co');
// 2. new tab (empty sessionStorage), referrer is our own site -> same visit, X attribution kept
now+=60_000;setup('','https://twizou.net/rising','/p/2');
const b=track();
assert.equal(b.sessionId,a.sessionId,'new tab continues the visit');
assert.equal(b.metadata.utmSource,'x');assert.equal(b.metadata.referrerHost,'t.co');
// 3. 29 minutes after the last event still the same visit; 31 minutes of idle ends it
now+=29*60_000;setup('','https://twizou.net/');assert.equal(track().sessionId,a.sessionId);
now+=31*60_000;setup('','https://www.google.com/');const c=track();
assert.notEqual(c.sessionId,a.sessionId,'idle visit ends');assert.equal(c.metadata.referrerHost,'www.google.com');assert.equal(c.metadata.utmSource,null);
// 4. internal referrer on a fresh visit is not counted as a traffic source
now+=40*60_000;setup('','https://twizou.net/rising');const d=track();
assert.equal(d.metadata.referrerHost,null);
// 5. same anonymous id throughout
assert.equal(a.anonymousId,d.anonymousId);
// 6. localStorage blocked -> falls back to per-tab session without throwing
broken=true;now+=1000;setup('','https://t.co/x');const e=track();assert.ok(e.sessionId);
console.log('PASS ENGAGEMENT SESSION: visit continues across tabs for 30 minutes, UTM/referrer kept for the visit, internal referrers ignored, idle expiry, storage-blocked fallback.');
