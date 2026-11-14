'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const root=path.resolve(__dirname,'..'),base='https://twizou.net';
const posts=Array.from({length:231},(_,i)=>({id:String(100000+i)}));
const accounts=Array.from({length:83},(_,i)=>({key:'user'+i}));
const tags=Array.from({length:5},(_,i)=>({id:String(i),name:'ラベル'+i,count:4,index:true,hasImage:true}));
const index={posts,accounts,tags};
const Link=({href,children,prefetch,...rest})=>React.createElement('a',{href,...rest},children);
function load(file,resolve=require){if(resolve)resolve=require("./public-ui-test-loader.cjs").wrap(resolve);const module={exports:{}};const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',code)(resolve,module,module.exports);return module.exports;}
const lists=load('lib/public-list-pages.ts'),core=load('lib/public-video-core.ts',name=>name.endsWith('indexability')?load('lib/indexability.ts'):require(name));
const bridge={readPublicMonths:async()=>[],readPublicPopular:async()=>null,readPublicBrowse:async(page)=>({page,totalPages:lists.browsePageCount(posts.length),totalCount:posts.length,videos:posts.slice((page-1)*100,page*100).map(v=>({...v,handle:'fixture',authorName:'投稿者',text:'動画本文',posterUrl:null}))}),readPublicIndex:async()=>index,readPublicAccountCards:async()=>accounts.map(a=>({key:a.key,name:a.key,count:1,views:0,latest:'',thumbs:[]})),readPublicLabels:async()=>tags};
function resolve(name){if(name==='react')return require('react');if(name.endsWith('initial-ranking'))return{loadRankingPage:async()=>({status:200,pagination:{totalPages:1}})};if(name.endsWith('ranking-pagination'))return load('lib/ranking-pagination.ts');if(name.endsWith('public-return-navigation'))return load('lib/public-return-navigation.ts');if(name.endsWith('share-video'))return load('lib/share-video.ts',resolve);if(/PublicVideoCards|PublicPostLink|PublicListRestore/.test(name))return load('app/components/'+name.split('/').at(-1)+'.tsx',resolve).default;if(name.endsWith("SiteBrand"))return load("app/components/SiteBrand.tsx",resolve).default;if(name==='react/jsx-runtime')return require('react/jsx-runtime');if(name==='next/link')return Link;
 if(name==='next/navigation')return {notFound(){throw Error('NOT_FOUND')},useRouter:()=>({replace(){}})};
 if(name.endsWith('public-video-server'))return bridge;if(name.endsWith('public-list-pages'))return lists;
 if(name.endsWith('public-video-core'))return core;if(name.endsWith('indexability'))return load('lib/indexability.ts');
 if(name.endsWith('/seo'))return {SITE_URL:base};throw Error('UNEXPECTED_IMPORT '+name);}
const browse=load('app/browse/page.tsx',resolve),authors=load('app/accounts/page.tsx',resolve),labels=load('app/tags/page.tsx',resolve),footer=load('app/components/SiteFooter.tsx',resolve);
const sitemap=load('app/sitemap.ts',resolve);
const hrefs=html=>[...html.matchAll(/href="([^"]+)"/g)].map(match=>match[1].replaceAll('&amp;','&'));
(async()=>{
 const xml=await sitemap.default();
 const targets=new Set(xml.map(row=>row.url.slice(base.length)).filter(url=>/^\/p\/|^\/accounts\/|^\/tags\//.test(url)));
 const seen=new Set(['/']),queue=['/'];
 while(queue.length){const url=queue.shift();let html='';
  if(url==='/')html=renderToStaticMarkup(React.createElement(footer.default));
  else if(url.startsWith('/browse'))html=renderToStaticMarkup(await browse.default({searchParams:Promise.resolve({page:new URL(url,base).searchParams.get('page')??undefined})}));
  else if(url==='/accounts'||url.startsWith('/accounts?'))html=renderToStaticMarkup(await authors.default({searchParams:Promise.resolve({page:new URL(url,base).searchParams.get('page')??undefined})}));
  else if(url==='/tags')html=renderToStaticMarkup(await labels.default());
  for(let href of hrefs(html)){if(href.startsWith('/p/'))href=new URL(href,base).pathname;if(href.startsWith('/')&&!seen.has(href)){seen.add(href);queue.push(href);}}
 }
 const missing=[...targets].filter(url=>!seen.has(url));assert.deepEqual(missing,[]);
 assert.equal(targets.size,posts.length+accounts.length+tags.length);
 assert.equal((await browse.generateMetadata({searchParams:Promise.resolve({page:'2'})})).alternates.canonical,base+'/browse?page=2');
 assert.equal((await authors.generateMetadata({searchParams:Promise.resolve({page:'2'})})).alternates.canonical,base+'/accounts?page=2');
 console.log(`PASS SEO REACHABILITY: ${targets.size} sitemap entity URLs reached from rendered footer and hubs; 0 unreachable; paged canonical URLs; mocked index only`);
})().catch(error=>{console.error(error);process.exitCode=1;});

