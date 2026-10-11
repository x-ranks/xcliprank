const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict'), ts = require('typescript');
const root = path.resolve(__dirname, '..'), cache = new Map();
let databaseCalls = 0;
const existingAuthor = { x_author_id: '783214', is_curated: true, curated_status: 'active', manual_tier: 'S' };
const existingPosts = [{ x_post_id: '12345', video_url: 'https://video.twimg.com/old.mp4', media_key: 'old', is_visible: false, manual_tier: 'NONE', moderation_blocked: true }];
const db = { from(table) {
  databaseCalls++; let kind = 'read', rows, filters = [];
  const q = { select() { return q; }, eq(k,v) { filters.push([k,[v]]); return q; }, in(k,v) { filters.push([k,v]); return q; },
    maybeSingle() { return Promise.resolve({data: existingAuthor,error:null}); },
    upsert(values,options) { assert.equal(options.ignoreDuplicates,true); kind = 'write'; rows = Array.isArray(values) ? values : [values]; return q; },
    then(resolve,reject) {
      let data;
      if (kind === 'read') data = existingPosts.filter(row=>filters.every(([k,v])=>v.includes(row[k])));
      else if(table === 'authors') { assert.equal(rows[0].is_curated,false); assert.equal(rows[0].curated_status,undefined); data=[]; }
      else { data=[]; for(const row of rows) { assert.equal(row.is_visible,false); assert.equal(row.manual_tier,undefined);
        if(!existingPosts.some(p=>p.x_post_id===row.x_post_id)){existingPosts.push(row);data.push({x_post_id:row.x_post_id});} } }
      return Promise.resolve({data,error:null}).then(resolve,reject);
    } }; return q;
} };
const substitutions = {
  'lib/supabase-admin': { supabaseAdmin: () => db },
  'lib/tier-learning': { loadTierLearningModel:async()=>null, predictLearnedTier:()=>null, blendRuleAndLearnedTier:r=>r },
};
function load(id) {
  if (substitutions[id]) return substitutions[id];
  if (/^(lib\/x|lib\/curated-collector|lib\/x-api-usage)$/.test(id)) throw Error('Paid runtime imported: '+id);
  if(cache.has(id))return cache.get(id).exports;
  const m={exports:{}};cache.set(id,m);
  const code=ts.transpileModule(fs.readFileSync(path.join(root,id+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  new Function('require','module','exports',code)(n=>n.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(id),n))):require(n),m,m.exports);return m.exports;
}
const author = {id:'783214',username:'X',name:'X',expectedTier:'S'};
const video = (url='https://video.twimg.com/native.mp4') => ({type:'video',id:'v123',format:'video/mp4',url,duration:24,
  thumbnail_url:'https://pbs.twimg.com/thumb.jpg',formats:[{container:'mp4',url,bitrate:100},{container:'mp4',url:'https://video.twimg.com/high.mp4',bitrate:200}]});
const post = (id='23456') => ({type:'status',provider:'twitter',id,text:'public video test',author:{type:'profile',id:'783214',protected:false},
  created_timestamp:Date.now()/1000-100,possibly_sensitive:false,reposted_by:null,replying_to:null,media:{videos:[video()]},likes:3,reposts:2,views:20});
const response = (data,status=200) => new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
(async()=>{
  const free=load('lib/fxtwitter-curated'), store=load('lib/fxtwitter-curated-store'), save=load('lib/fxtwitter-curated-save');
  assert.equal(free.normalizeFreeUsername('https://x.com/SpaceX?lang=en'),'SpaceX');assert.equal(free.normalizeFreeUsername('@SpaceX'),'SpaceX');
  for(const input of ['https://evil.test/SpaceX','https://x.com.evil/SpaceX','https://x.com/SpaceX/status/123','../../config','https://user:pw@x.com/SpaceX','https://x.com:4430/SpaceX'])assert.throws(()=>free.normalizeFreeUsername(input));
  const p=post(), page=free.parseFreeMediaPage({code:200,results:[p],cursor:{bottom:'next'}},author);
  assert.equal(page.posts.length,1);assert.equal(page.posts[0].video_url,'https://video.twimg.com/high.mp4');assert.equal(page.posts[0].durationSeconds,24);
  for(const invalid of [{...p,provider:'bluesky'},{...p,author:{...p.author,id:'99999'}},{...p,author:{...p.author,protected:true}},
    {...p,reposted_by:{id:'222'}},{...p,replying_to:'someone'},{...p,media:{external:{url:'https://evil/video'},videos:[]}},
    {...p,media:{videos:[{type:'gif',url:'https://video.twimg.com/a.mp4'}]}},{...p,media:{videos:[{type:'video',format:'video/mp4',url:'https://evil.test/a.mp4'}]}}]) {
    assert.equal(free.parseFreeMediaPage({code:200,results:[invalid]},author).posts.length,0);
  }
  let calls=0;const guard=async(url,init)=>{calls++;const u=new URL(url);assert.equal(u.origin,'https://api.fxtwitter.com');assert(!/authorization|cookie/i.test(JSON.stringify(init.headers)));
    assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');return response({code:200,user:{type:'profile',id:'783214',screen_name:'X',protected:false}});};
  assert.equal((await free.fetchFreeProfile('X','S',guard)).id,'783214');assert.equal(calls,1);
  await assert.rejects(free.fetchFreeProfile('SpaceX','S',guard),/同一投稿者/);
  calls=0;await assert.rejects(free.fetchFreeMediaPage(author,20,null,async()=>{calls++;return response({code:429},429);}),e=>e.status===429);assert.equal(calls,1);
  await assert.rejects(free.fetchFreeMediaPage(author,20,null,async()=>new Response('not JSON',{headers:{'Content-Type':'text/html'}})));
  await assert.rejects(free.fetchFreeMediaPage(author,20,null,async()=>new Response('x',{headers:{'Content-Type':'application/json','Content-Length':String(5*1024*1024)}})));
  const tmp=await fsp.mkdtemp(path.join(os.tmpdir(),'xclip-free-test-'));const cwd=process.cwd();process.chdir(tmp);
  const {NextRequest}=require('next/server'), route=load('app/api/fxtwitter-authors/route');
  const previousNodeEnv=process.env.NODE_ENV;process.env.NODE_ENV='development';
  const access=load('lib/fxtwitter-local-access');
  assert(access.allowFreeLocalRequest(new NextRequest('http://localhost:3004/api/fxtwitter-authors',{method:'POST',headers:{host:'127.0.0.1:3004',origin:'http://127.0.0.1:3004','content-type':'application/json'}}),true));
  assert(!access.allowFreeLocalRequest(new NextRequest('http://localhost:3004/api/fxtwitter-authors',{method:'POST',headers:{host:'127.0.0.1:3004',origin:'http://127.0.0.1:3005','content-type':'application/json'}}),true));
  const request=(body,origin='http://localhost:3004')=>new NextRequest('http://localhost:3004/api/fxtwitter-authors',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
  const originalFetch=global.fetch;global.fetch=async(url,init)=>{
    assert.equal(new URL(url).origin,'https://api.fxtwitter.com');assert(!/authorization|cookie/i.test(JSON.stringify(init.headers)));
    return String(url).includes('/statuses?')?response({code:200,results:[post('12345'),post('23456')],cursor:{bottom:'older'}}):response({code:200,user:{type:'profile',id:'783214',screen_name:'X',protected:false}});
  };
  try {
    assert.equal((await route.POST(request({action:'add',username:'X'},'https://evil.test'))).status,403);
    process.env.NODE_ENV='production';assert.equal((await route.GET(new NextRequest('http://localhost:3004/api/fxtwitter-authors'))).status,404);process.env.NODE_ENV='development';
    assert.equal((await route.POST(request({action:'add',username:'X',expectedTier:'S'}))).status,200);assert.equal(databaseCalls,0);
    assert.equal((await route.POST(request({action:'preview',id:author.id,count:20,mode:'latest'}))).status,200);assert.equal(databaseCalls,0);
    let state=await store.readFreeRegistry();assert.equal(state.authors[0].candidates.length,2);assert.equal(state.authors[0].nextCursor,'xclip-statuses-v1:older');
    const preserved=JSON.stringify(existingPosts[0]);
    const saved=await (await route.POST(request({action:'save',id:author.id,confirmHiddenSave:true}))).json();
    assert.equal(saved.ok,true);assert.equal(saved.saved.saved,1);assert.equal(saved.saved.duplicates,1);assert.equal(JSON.stringify(existingPosts[0]),preserved);
    assert.equal(existingAuthor.is_curated,true);assert.equal(existingAuthor.curated_status,'active');
    assert.equal((await save.saveFreeCandidates((await store.readFreeRegistry()).authors[0],db)).saved,0);
    await assert.rejects(save.saveFreeCandidates({...state.authors[0],checkedAt:new Date(Date.now()-11*60000).toISOString()},db),e=>e.status===409);
    await route.POST(request({action:'pause',id:author.id}));assert.equal((await route.POST(request({action:'preview',id:author.id,count:20,mode:'latest'}))).status,409);
    await route.POST(request({action:'resume',id:author.id}));
    global.fetch=async()=>response({code:429},429);assert.equal((await route.POST(request({action:'preview',id:author.id,count:20,mode:'latest'}))).status,429);
    assert((await store.readFreeRegistry()).cooldownUntil>Date.now());assert.equal((await store.readFreeRegistry()).authors[0].candidates.length,2);
    const directory=store.registryDirectory();await fsp.mkdir(path.join(directory,'operation.lock'));await assert.rejects(store.withFreeRegistry(async()=>{}),e=>e.status===409);await fsp.rmdir(path.join(directory,'operation.lock'));
    await fsp.writeFile(path.join(directory,'state.json'),'broken');await assert.rejects(store.readFreeRegistry(),e=>e.status===503);assert.equal(await fsp.readFile(path.join(directory,'state.json'),'utf8'),'broken');
  } finally {global.fetch=originalFetch;process.chdir(cwd);if(previousNodeEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previousNodeEnv;await fsp.rm(tmp,{recursive:true,force:true});}
  console.log('PASS FREE CURATED: profile/media; fixed provider/no credentials/no paid runtime; pagination; native media and identity; local-only and same-origin; preview has zero DB calls; hidden inserts; duplicate/manual/removal settings preserved; paid registration unchanged; cooldown; durable registry; locks and corrupt state. Network/DB mocked.');
})().catch(error=>{console.error(error);process.exitCode=1;});
