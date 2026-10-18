const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),deps=process.env.XCLIP_TEST_DEPENDENCY_ROOT||root,ts=require(deps+'/node_modules/typescript'),React=require(deps+'/node_modules/react'),{renderToStaticMarkup}=require(deps+'/node_modules/react-dom/server');
function load(file,resolve=require){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText)(resolve,m,m.exports);return m.exports;}
const Link=({href,children,...props})=>React.createElement('a',{href,...props},children);
const timing=load('lib/ranking-update.ts');
assert.deepEqual(timing.readRankingUpdate({}),{updatedAt:null,snapshotAt:null,precise:false});
assert.equal(timing.readRankingUpdate({rankingUpdatedAt:'2026-99-99T00:00:00Z'}).updatedAt,null);
assert.equal(timing.readRankingUpdate({edition:'1791894900000-aaaaaaaaaaaa'}).precise,false);
assert.equal(timing.formatRankingTime('2026-10-14T15:00:00Z'),'2026/10/15 00:00');
assert.equal(timing.latestRankingHref('trending'),'/');assert.equal(timing.latestRankingHref('daily'),'/ranking/daily');assert.equal(timing.latestRankingHref('weekly'),'/ranking/weekly');
function harness(seed=[]){const slots=[...seed],effects=[],refs=[],memos=[];let si=0,ei=0,ri=0,mi=0;const pending=[];return {slots,reset(){si=ei=ri=mi=0;},async flush(){for(const run of pending.splice(0))run();for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));},hooks:{useState(initial){const i=si++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},useRef(initial){const i=ri++;return refs[i]??(refs[i]={current:initial});},useMemo(run,deps){const i=mi++,old=memos[i];if(!old||deps.some((v,n)=>v!==old.deps[n]))memos[i]={value:run(),deps};return memos[i].value;},useEffect(run,deps){const i=ei++,old=effects[i];if(!old||deps.some((v,n)=>v!==old.deps[n])){pending.push(()=>{old?.cleanup?.();effects[i]={deps,cleanup:run()};});}}}};}
let blocked=[];let requests=0;const h=harness(),originalFetch=global.fetch;
const Client=load('app/components/RankingClient.tsx',n=>{
 if(n==='react')return h.hooks;if(n==='react/jsx-runtime')return require(deps+'/node_modules/react/jsx-runtime');
 if(n.endsWith('ranking-update'))return timing;if(n.endsWith('useSuspendedAuthors'))return ()=>blocked;
 if(n.endsWith('post-status'))return {isUnavailablePost:()=>false};if(n.endsWith('browser-direct-playback'))return {directPlaybackUrl:x=>x};
 if(n.endsWith('engagement-client'))return {trackEngagement:()=>{throw Error('UNEXPECTED_EFFECT')}};
 if(/DirectPlaybackVideo|VideoDownloadButton|VideoDurationBadge/.test(n))return ()=>null;if(n==='next/link')return Link;throw Error('Unexpected import '+n);
}).default;
function render(props){h.reset();return renderToStaticMarkup(Client(props));}
(async()=>{try{
 global.fetch=async()=>{requests++;return {ok:true,json:async()=>({ok:true,data:[],rankingUpdatedAt:'2026-10-14T09:35:00Z',rankingSnapshotAt:'2026-10-14T09:30:00Z'})};};
 let html=render({range:'trending',fixedRange:true});assert(html.includes('一覧の更新日時：未確認'));await h.flush();html=render({range:'trending',fixedRange:true});assert.equal(requests,1);assert(html.includes('一覧更新：'));assert(html.includes('2026/10/14 18:35'));
 // Execute the actual component's response-failure branch; retain the last successful list time.
 blocked=['id:fixture'];global.fetch=async()=>{requests++;throw Error('PRIVATE_FAILURE')};render({range:'daily',fixedRange:true});await h.flush();html=render({range:'daily',fixedRange:true});assert(html.includes('2026/10/14 18:35'));assert(html.includes('最新の確認に失敗しました'));assert(!html.includes('PRIVATE_FAILURE'));
 // SSR receives the same metadata used by successful client loading, without another fetch.
 const ssr=harness();const ServerClient=load('app/components/RankingClient.tsx',n=>{if(n==='react')return ssr.hooks;if(n==='react/jsx-runtime')return require(deps+'/node_modules/react/jsx-runtime');if(n.endsWith('ranking-update'))return timing;if(n.endsWith('useSuspendedAuthors'))return ()=>[];if(n.endsWith('post-status'))return {isUnavailablePost:()=>false};if(n.endsWith('browser-direct-playback'))return {directPlaybackUrl:x=>x};if(n.endsWith('engagement-client'))return {trackEngagement:()=>{}};if(/DirectPlaybackVideo|VideoDownloadButton|VideoDurationBadge/.test(n))return ()=>null;if(n==='next/link')return Link;throw Error('Unexpected import '+n);}).default;
 const htmlSSR=renderToStaticMarkup(ServerClient({range:'weekly',fixedRange:true,initialUpdate:timing.readRankingUpdate({rankingUpdatedAt:'2026-10-14T09:35:00Z'}),initialPosts:[]}));assert(htmlSSR.includes('2026/10/14 18:35'));assert(htmlSSR.includes('href="/ranking/weekly"'));assert.equal(requests,2);
 console.log('PASS PUBLIC UPDATE UI: actual successful/failed fetch branches; stable saved timestamps/JST rollover; SSR same data; legacy/invalid metadata; latest link strips old edition; mocked HTTP only');
 }finally{global.fetch=originalFetch;}})().catch(e=>{console.error(e);process.exitCode=1});
