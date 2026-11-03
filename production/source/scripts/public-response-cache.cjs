'use strict';
// Standalone-only adapter. No media or upstream requests are made here.
const http=require('http'),fs=require('fs/promises'),path=require('path'),os=require('os'),crypto=require('crypto'),{AsyncLocalStorage}=require('async_hooks');
const SYMBOL=Symbol.for('twizou.public-response-context.v1');
const context=globalThis[SYMBOL]??=new AsyncLocalStorage();
// A browser may reuse anonymous ranking HTML/RSC for five minutes. The worker
// cache still rechecks publication control files on every request.
const PRIVATE='private, max-age=300, must-revalidate';
function controlFiles(env=process.env,home=os.homedir()){
 const author=env.XCLIP_AUTHOR_STATE_DIR||path.join(home,'.xclip-author-status'),curated=env.XCLIP_FREE_CURATED_STATE_DIR||path.join(home,'.xclip-free-curated'),manual=env.XCLIP_MANUAL_RANKING_DIR||path.join(home,'.xclip-manual-ranking');
 return [[author,'state-v1.json'],[author,'post-state-v1.json'],[curated,'manual-removals-v1.json'],[manual,'placements.json']].map(([root,name])=>path.join(root,name));
}
function publicationControlBytes(file,bytes){
 const name=path.basename(file);if(!['state-v1.json','post-state-v1.json'].includes(name))return null;
 const state=JSON.parse(bytes.toString('utf8')),finite=n=>Number.isFinite(n)&&n>=0,key=k=>typeof k==='string'&&/^(?:id:\d{2,20}|name:[a-z0-9_]{1,15})$/.test(k),id=k=>typeof k==='string'&&/^\d{2,20}$/.test(k);
 if(state?.version!==1||!state.entries||typeof state.entries!=='object'||Array.isArray(state.entries))throw Error('PUBLIC_CACHE_CONTROL_INVALID');
 const entries=Object.entries(state.entries);
 if(name==='state-v1.json'){
  if(bytes.length>2*1024*1024||entries.length>5000||!finite(state.cooldownUntil)||entries.some(([k,v])=>!key(k)||!v||!['public','suspended','unknown'].includes(v.status)||![v.checkedAt,v.confirmedAt,v.nextCheckAt].every(finite)))throw Error('PUBLIC_CACHE_CONTROL_INVALID');
  return Buffer.from('author-blocks:'+JSON.stringify(entries.filter(([,v])=>v.status==='suspended').map(([k])=>k).sort()));
 }
 if(entries.length>50000||(state.cursor!==null&&!id(state.cursor))||![state.cycleStartedAt,state.cycleCompletedAt,state.nextBatchAt,state.cooldownUntil].every(finite)||entries.some(([k,v])=>!id(k)||!v||(v.authorKey!==null&&!key(v.authorKey))||typeof v.blocked!=='boolean'||![v.checkedAt,v.nextCheckAt,v.missingSince,v.lastMissingAt].every(finite)))throw Error('PUBLIC_CACHE_CONTROL_INVALID');
 return Buffer.from('post-blocks:'+JSON.stringify(entries.filter(([,v])=>v.blocked).map(([k,v])=>[k,v.authorKey]).sort(([a],[b])=>a.localeCompare(b))));
}
function createControlSignature(files){
 const prior=new Map();
 return async()=>{
  // Standalone loads .env.production after installing this adapter. Resolve
  // configured durable paths at request time, never during early installation.
  const signatures=await Promise.all((files||controlFiles()).map(async file=>{
   if(!path.isAbsolute(file))throw Error('PUBLIC_CACHE_CONTROL_PATH_INVALID');
   try{
    const root=await fs.lstat(path.dirname(file));if(!root.isDirectory()||root.isSymbolicLink())throw Error('PUBLIC_CACHE_CONTROL_UNSAFE');
    const stat=await fs.lstat(file,{bigint:true});if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16n*1024n*1024n)throw Error('PUBLIC_CACHE_CONTROL_UNSAFE');
    const stamp=[stat.dev,stat.ino,stat.mtimeNs,stat.ctimeNs,stat.size].join(':'),old=prior.get(file);if(old?.stamp===stamp)return old.hash;
    const bytes=await fs.readFile(file),after=await fs.lstat(file,{bigint:true});
    if([after.dev,after.ino,after.mtimeNs,after.ctimeNs,after.size].join(':')!==stamp)throw Error('PUBLIC_CACHE_CONTROL_CHANGED');
    const relevant=publicationControlBytes(file,bytes),hash=(relevant?'':stamp+':')+crypto.createHash('sha256').update(relevant||bytes).digest('hex');prior.set(file,{stamp,hash});return hash;
   }catch(e){prior.delete(file);if(e.code==='ENOENT')return 'missing';throw e;}
  }));return signatures.join('|');
 };
}
function requestKey(req){
 if(req.method!=='GET'||req.headers.authorization||req.headers.cookie||req.headers.range||req.url.length>2200)return null;
 if(/no-cache|no-store/i.test(req.headers['cache-control']||''))return null;
 const host=req.headers.host||'';if(!/^(?:twizou\.net|localhost|127\.0\.0\.1)(?::\d+)?$/.test(host))return null;
 const url=new URL(req.url,'http://'+host);if(!['/','/ranking/daily','/ranking/weekly','/browse'].includes(url.pathname))return null;
 if([...url.searchParams.keys()].some(k=>!['page','edition','_rsc'].includes(k)||url.searchParams.getAll(k).length!==1))return null;
 if(url.pathname==='/browse'&&url.searchParams.has('edition'))return null;
 const edition=url.searchParams.get('edition');
 if(edition&&(!/^\d{13}-[a-f0-9]{12}$/.test(edition)||Date.now()-Number(edition.slice(0,13))>=86400000-30000))return null;
 const headers=['rsc','next-router-state-tree','next-router-prefetch','next-router-segment-prefetch','next-url','accept-encoding','accept'].map(k=>[k,req.headers[k]||'']);
 if(headers.some(([,value])=>String(value).length>8000))return null;
 url.searchParams.delete('_rsc');url.searchParams.sort();
 return JSON.stringify([host,url.pathname,url.search,headers]);
}
function createPublicResponseCache({signature=createControlSignature(),now=()=>performance.now(),ttlMs=15000,maxBytes=8*1024*1024,maxEntries=32}={}){
 const entries=new Map();let bytes=0;
 const remove=key=>{const old=entries.get(key);if(old)bytes-=old.body.length;entries.delete(key);};
 const trim=()=>{for(const[key,value]of entries)if(now()>=value.expires)remove(key);};
 function wrap(handler){return function(req,res){
  const started=now(),key=process.env.XCLIP_HTML_CACHE_DISABLED==='1'?null:requestKey(req);
  const state={freshUntil:started+30000,rankingSeen:/^\/browse(?:\?|$)/.test(req.url)};
  return context.run(state,async()=>{
   if(!key)return handler(req,res);
   let before;try{before=await signature();}catch{res.writeHead(503,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end('Page temporarily unavailable');return;}
   trim();const cached=entries.get(key);
   if(cached&&cached.signature===before){
    entries.delete(key);entries.set(key,cached);
    for(const[name,value]of Object.entries(cached.headers))if(!['connection','keep-alive','transfer-encoding','date','content-length','etag','server-timing','cache-control'].includes(name))res.setHeader(name,value);
    res.setHeader('Cache-Control',PRIVATE);res.setHeader('ETag',cached.etag);res.setHeader('X-Twizou-HTML-Cache','HIT');res.setHeader('Server-Timing',`html-cache;desc="HIT", public-preheaders;dur=${(now()-started).toFixed(1)}`);
    const match=req.headers['if-none-match'];if(match&&String(match).split(',').map(x=>x.trim().replace(/^W\//,'')).includes(cached.etag)){res.statusCode=304;res.end();return;}
    res.statusCode=200;res.setHeader('Content-Length',cached.body.length);res.end(cached.body);return;
   }
   if(cached)remove(key);
   const chunks=[];let size=0,oversize=false,headers;
   const write=res.write,end=res.end,writeHead=res.writeHead;
   res.setHeader('X-Twizou-HTML-Cache','MISS');
   res.writeHead=function(...args){
    const explicit=typeof args[1]==='string'?2:1,provided=args[explicit];
    if(provided&&typeof provided==='object'){
     if(Array.isArray(provided)){const combined=new Map();for(let i=0;i<provided.length;i+=2){const name=String(provided[i]).toLowerCase(),value=provided[i+1];combined.set(name,combined.has(name)?[].concat(combined.get(name),value):value);}for(const[name,value]of combined)res.setHeader(name,value);}
     else for(const[name,value]of Object.entries(provided))res.setHeader(name,value);
     args=args.slice(0,explicit);
    }
    const type=String(res.getHeader('content-type')||'');
    if(args[0]===200&&/text\/(?:html|x-component)/.test(type)&&!res.hasHeader('set-cookie'))res.setHeader('Cache-Control',PRIVATE);
    const timing=res.getHeader('server-timing');res.setHeader('Server-Timing',[timing,`public-preheaders;dur=${(now()-started).toFixed(1)}`].filter(Boolean).join(', '));
    headers={...res.getHeaders()};return writeHead.apply(this,args);
   };
   const capture=(chunk,encoding)=>{if(chunk==null||typeof chunk==='function'||oversize)return;const buf=Buffer.isBuffer(chunk)?Buffer.from(chunk):Buffer.from(chunk,typeof encoding==='string'?encoding:undefined);size+=buf.length;if(size>2*1024*1024){oversize=true;chunks.length=0;}else chunks.push(buf);};
   res.write=function(chunk,encoding,...rest){capture(chunk,encoding);return write.call(this,chunk,encoding,...rest);};
   res.end=function(chunk,encoding,...rest){capture(chunk,encoding);return end.call(this,chunk,encoding,...rest);};
   res.once('finish',()=>{
    const expires=Math.min(started+ttlMs,state.freshUntil);
    if(oversize||res.statusCode!==200||res.hasHeader('set-cookie')||!state.rankingSeen||now()>=expires||!/text\/(?:html|x-component)/.test(String(res.getHeader('content-type')||'')))return;
    void signature().then(after=>{
     if(after!==before||now()>=expires)return;
     const body=Buffer.concat(chunks);while(entries.size&&(entries.size>=maxEntries||bytes+body.length>maxBytes))remove(entries.keys().next().value);
     if(body.length>maxBytes)return;
     remove(key);entries.set(key,{signature:after,expires,headers:headers||res.getHeaders(),body,etag:'"'+crypto.createHash('sha256').update(body).digest('hex')+'"'});bytes+=body.length;
    }).catch(()=>{});
   });
   return handler(req,res);
  });
 };}
 return {wrap};
}
function install(){
 if(process.env.NODE_ENV!=='production'||process.env.XCLIP_HTML_CACHE_DISABLED==='1')return;
 const original=http.createServer,cache=createPublicResponseCache();
 // Intercept the one standalone Next listener, then restore the Node API.
 http.createServer=function(...args){http.createServer=original;const index=args.length-1;if(typeof args[index]!=='function')throw Error('PUBLIC_CACHE_NEXT_LISTENER_NOT_FOUND');args[index]=cache.wrap(args[index]);return original.apply(this,args);};
}
module.exports={createPublicResponseCache,createControlSignature,requestKey,controlFiles,context,install};
