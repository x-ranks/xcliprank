'use strict';
// Only public HTML/JSON GETs. No videos, providers, patrol or analytics endpoints.
const fs=require('fs/promises'),path=require('path'),os=require('os');
async function readPublic(urlPath){
 const response=await fetch('https://twizou.net'+urlPath,{redirect:'error',signal:AbortSignal.timeout(25000),headers:{'User-Agent':'TwizouRankingPrewarm/1.0'}});
 if(!response.ok)throw Error('PREWARM_PUBLIC_REQUEST_FAILED');
 let size=0,chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>2*1024*1024)throw Error('PREWARM_TEXT_LIMIT');chunks.push(chunk);}
 return Buffer.concat(chunks).toString('utf8');
}
async function run({get=readPublic,now=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),stateRoot=path.join(os.homedir(),'.twizou-ranking-prewarm-v1')}={}){
 if(!path.isAbsolute(stateRoot))throw Error('PREWARM_STATE_PATH_INVALID');
 await fs.mkdir(stateRoot,{recursive:true,mode:0o700});if((await fs.lstat(stateRoot)).isSymbolicLink())throw Error('PREWARM_STATE_UNSAFE');
 const bucket=Math.floor(now()/300000)*300000,file=path.join(stateRoot,'prepared.json');
 try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2048)throw Error('PREWARM_STATE_UNSAFE');const prior=JSON.parse(await fs.readFile(file,'utf8'));if(prior.bucket===bucket)return {skipped:true,bucket};}catch(e){if(e.code!=='ENOENT')throw e;}
 let body;
 for(let attempt=0;attempt<6;attempt++){
  body=JSON.parse(await get('/api/rankings?range=trending&page=1'));
  if(body.ok===true&&String(body.edition||'').startsWith(bucket+'-'))break;
  if(attempt===5)throw Error('PREWARM_EDITION_NOT_READY');await sleep(3000);
 }
 for(const range of ['daily','weekly']){const json=JSON.parse(await get('/api/rankings?range='+range));if(json.ok!==true)throw Error('PREWARM_RANKING_FAILED');}
 // Prime the three ordinary public HTML routes once per edition, not every minute.
 for(const urlPath of ['/','/ranking/daily','/ranking/weekly'])await get(urlPath);
 const temp=file+'.'+process.pid+'.tmp';await fs.writeFile(temp,JSON.stringify({version:1,bucket,preparedAt:new Date(now()).toISOString()}),{mode:0o600,flag:'wx'});await fs.rename(temp,file);
 return {skipped:false,bucket,preparedAt:new Date(now()).toISOString()};
}
module.exports={run};
if(require.main===module)run().then(result=>console.log(JSON.stringify({feature:'ranking_prewarm',...result}))).catch(()=>{console.error('RANKING_PREWARM_FAILED; no media or patrol requests');process.exitCode=1;});
