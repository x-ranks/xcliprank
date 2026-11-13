'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {resolveRobots}=require('next/dist/build/webpack/loaders/metadata/resolve-route-data');
const {NextRequest}=require('next/server');
const root=path.resolve(__dirname,'..');
function load(file,resolve=require){const original=resolve,wrapped=require("./public-ui-test-loader.cjs").wrap(original);resolve=n=>n.endsWith("AgeGate")?original(n):wrapped(n);const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText)(resolve,m,m.exports);return m.exports;}
const robots=load('app/robots.ts',n=>n.endsWith('/seo')?{SITE_URL:'https://twizou.net'}:require(n)).default();
const text=resolveRobots(robots);
for(const line of ['Allow: /api/video-playback-url$','Allow: /api/video-playback-url?','Disallow: /api/','Sitemap: https://twizou.net/sitemap.xml'])assert(text.includes(line),line);
// Check concrete request paths against the serialized framework output, using longest matching rule.
const rules=text.split(/\r?\n/).map(s=>s.match(/^(Allow|Disallow): (.+)$/)).filter(Boolean).map(m=>({allow:m[1]==='Allow',path:m[2]}));
function permitted(url){const matches=rules.filter(r=>{const end=r.path.endsWith('$'),raw=end?r.path.slice(0,-1):r.path;return end?url===raw:url.startsWith(raw);}).sort((a,b)=>b.path.replace(/\$$/,'').length-a.path.replace(/\$$/,'').length||Number(b.allow)-Number(a.allow));return matches.length?matches[0].allow:true;}
for(const url of ['/','/rising','/p/2061469959365280142','/api/video-playback-url','/api/video-playback-url?postId=2061469959365280142','/api/video-playback-url?postId=22&extra=1'])assert(permitted(url),url);
for(const url of ['/api/video-playback-url-admin','/api/video-playback-url/private','/api/video?url=x','/api/engagement','/api/public-label-admin','/api/removal-requests','/api/video-download','/review','/ranking-admin'])assert(!permitted(url),url);
const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';
try{const response=load('middleware.ts').middleware(new NextRequest('https://twizou.net/api/video-playback-url?postId=22'));assert.equal(response.status,200);assert.equal(response.headers.get('X-Robots-Tag'),'noindex, nofollow, noarchive');}finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
const layout=load('app/layout.tsx',n=>{
 if(n==='./globals.css')return{};
 if(n.endsWith('PublicDetailViewer'))return{__esModule:true,default:()=>null};
 if(n.endsWith('/seo'))return{SITE_NAME:'twizou',SITE_URL:'https://twizou.net'};
 if(n.endsWith('AgeGate'))return{__esModule:true,default:()=>React.createElement('aside',{'data-age-gate':'retained'},'18歳以上ですか？')};
 if(n.endsWith('InstallPrompt')||n.endsWith('BottomTabs'))return{__esModule:true,default:()=>null};
 if(n.endsWith('EngagementVisitTracker'))return{__esModule:true,default:()=>React.createElement('span',{'data-site-tracker':'retained'})};
 if(n.includes('@vercel/analytics'))throw Error('VERCEL_SCRIPT_MUST_NOT_LOAD');
 return require(n);
});
const html=renderToStaticMarkup(React.createElement(layout.default,{children:React.createElement('main',null,'公開本文')}));
assert(html.includes('公開本文'));assert(html.includes('18歳以上ですか？'));assert(html.includes('data-site-tracker="retained"'));assert(!html.includes('/_vercel/'));assert(!html.includes('insights/script.js'));assert.equal(layout.metadata.metadataBase.href,'https://twizou.net/');
console.log('PASS CRAWL PLAYBACK: actual Next robots serialization, exact public JSON route allowed with query, other APIs/admin denied, middleware noindex retained; actual layout SSR retains age gate/site tracker/content without Vercel analytics. No network or DB.');
