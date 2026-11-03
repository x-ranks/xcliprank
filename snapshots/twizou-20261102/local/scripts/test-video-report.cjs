'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('typescript'),React=require('react');
const root=path.resolve(__dirname,'..');
function load(file,resolve=require){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText)(resolve,m,m.exports);return m.exports;}
function mount(search,initial=''){
 const input={value:initial},effects=[],states=[],ref={current:input};let index=0;
 const hooks={...React,useRef:()=>ref,useEffect:fn=>effects.push(fn),useState:initial=>{const i=index++;states[i]=initial;return[states[i],v=>{states[i]=v;}];}};
 const page=load('app/removal-request/page.tsx',n=>n==='react'?hooks:n==='next/link'?{__esModule:true,default:props=>React.createElement('a',props)}:require(n)).default;
 global.window={location:{search}};
 const tree=page();effects.forEach(fn=>fn());
 function find(node,predicate){if(!node||typeof node!=='object')return null;if(predicate(node))return node;for(const child of React.Children.toArray(node.props?.children)){const found=find(child,predicate);if(found)return found;}return null;}
 return {input,states,form:find(tree,n=>n.type==='form'),url:find(tree,n=>n.type==='input'&&n.props.name==='reportedUrl')};
}
async function main(){
 const id='2106800501283234041',url='https://x.com/i/status/'+id;
 const valid=mount('?post='+id);assert.equal(valid.input.value,url);assert.equal(valid.url.props.ref.current,valid.input);assert.equal(valid.url.props.required,true);
 for(const query of ['', '?post=', '?post=0', '?post=01','?post=1','?post=-22','?post=12x','?post='+('1'.repeat(26)),'?post=https%3A%2F%2Fevil.invalid','?post=12&post=34','?post=%3Cscript%3E'])assert.equal(mount(query).input.value,'',query);
 assert.equal(mount('?post='+id,'https://x.com/already/status/22').input.value,'https://x.com/already/status/22');
 // Exercise the actual form submission and actual API handler against an in-memory DB double.
 let inserted=null,dbCalls=0,requests=0,resets=0;
 const api=load('app/api/removal-requests/route.ts',n=>n.endsWith('supabase-admin')?{supabaseAdmin:()=>({from:table=>{assert.equal(table,'removal_requests');dbCalls++;return{insert:async row=>{inserted=row;return{error:null};}};}})}:n.endsWith('cron-auth')?{isCronAuthorized:()=>false}:require(n));
 const body={reportedUrl:url,reason:'copyright',details:'権利者本人による掲載内容の確認と削除の依頼です。',contactEmail:'reporter@example.invalid',confirmed:'yes',website:''};
 const RealFormData=global.FormData,realFetch=global.fetch;
 const page=mount('?post='+id);
 global.FormData=class{constructor(form){assert.equal(form,fixtureForm);}entries(){return Object.entries({...body,reportedUrl:page.input.value});}};
 global.fetch=async(endpoint,options)=>{requests++;assert.equal(endpoint,'/api/removal-requests');assert.equal(options.method,'POST');return api.POST({json:async()=>JSON.parse(options.body),headers:new Headers({'x-forwarded-for':'192.0.2.21'})});};
 const fixtureForm={reset:()=>{resets++;page.input.value='';}};
 try{await page.form.props.onSubmit({preventDefault(){},currentTarget:fixtureForm});assert.equal(requests,1);assert.equal(resets,1);assert.equal(inserted.reported_url,url);assert.equal(inserted.x_post_id,id);assert.equal(inserted.status,'pending');assert.equal(inserted.contact_email,body.contactEmail);assert.equal(page.states[1].tone,'success');
  const before=dbCalls;const response=await api.POST({json:async()=>({...body,reportedUrl:'https://evil.invalid/i/status/'+id}),headers:new Headers()});assert.equal(response.status,400);assert.equal(dbCalls,before);
  const failed=mount('?post='+id);global.fetch=async()=>({ok:false,json:async()=>({success:false,error:'送信できませんでした。'})});await failed.form.props.onSubmit({preventDefault(){},currentTarget:fixtureForm});assert.equal(failed.states[1].tone,'error');assert.equal(resets,1);
 }finally{global.FormData=RealFormData;global.fetch=realFetch;delete global.window;}
 assert(!fs.readFileSync(path.join(root,'app/removal-request/page.tsx'),'utf8').includes('gmail.com'));
 console.log('PASS VIDEO REPORT: per-video URL prefill, malformed/duplicate parameters rejected, typed input preserved, existing form/API stores correct post ID with confirmation, success/error handling; in-memory DB only, no network/mail.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
