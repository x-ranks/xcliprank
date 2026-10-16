const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),deps=process.env.XCLIP_TEST_DEPENDENCY_ROOT||root;
const ts=require(deps+'/node_modules/typescript'),{NextRequest,NextResponse}=require(deps+'/node_modules/next/server');
const compile=(file,resolve)=>{const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(root+'/'+file,'utf8'),{compilerOptions:{esModuleInterop:true,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(resolve,m,m.exports);return m.exports;};
const pagination=compile('lib/ranking-pagination.ts',require);
const route=compile('app/api/rankings/route.ts',n=>n==='next/server'?{NextRequest,NextResponse}:n.endsWith('ranking-pagination')?pagination:(()=>{throw Error('Unexpected dependency '+n);})());
let calls=0;delete process.env.RANKINGS_SOURCE_URL;
global.fetch=async(url,options)=>{calls++;assert.equal(url.origin,'https://xcliprank.com');assert.equal(url.pathname,'/api/rankings');assert.equal(url.searchParams.get('page'),'2');assert.equal(url.searchParams.get('edition'),'fixture');assert.equal(options.headers,undefined);assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');return NextResponse.json({ok:true,edition:'fixture',data:[{x_post_id:'123'}],pagination:{page:2,totalPages:10}});};
(async()=>{
 const request=new NextRequest('http://localhost:3004/api/rankings?range=trending&page=2&edition=fixture');
 const response=await route.GET(request);assert.equal(response.status,200);assert.equal((await response.json()).pagination.page,2);assert.equal(calls,1);
 assert.equal((await route.GET(new NextRequest('http://localhost:3004/api/rankings?range=trending&page=11'))).status,400);assert.equal(calls,1);
 process.env.RANKINGS_SOURCE_URL='https://foreign.invalid/api/rankings';assert.equal((await route.GET(request)).status,503);assert.equal(calls,1);
 process.env.RANKINGS_SOURCE_URL='https://user:private@xcliprank.com/api/rankings';assert.equal((await route.GET(request)).status,503);assert.equal(calls,1);
 delete process.env.RANKINGS_SOURCE_URL;global.fetch=async()=>{calls++;throw Error('PRIVATE_ERROR');};const failed=await route.GET(request);assert.equal(failed.status,503);assert(!(await failed.text()).includes('PRIVATE_ERROR'));
 console.log('PASS LOCAL NEWEST500: fixed production public preview, page/edition forwarded, no credentials/DB/provider modules, invalid/foreign/credentialed source refused, network failure503; all HTTP mocked.');
})().catch(e=>{console.error(e);process.exitCode=1;});
