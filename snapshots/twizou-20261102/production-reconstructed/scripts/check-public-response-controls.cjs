'use strict';
// Match Next's private env loading before checking durable control directories.
// No values, hashes, paths or content are printed. No network or writes.
const path=require('path'),Module=require('module');
(async()=>{
 if(!process.argv[2]||!path.isAbsolute(process.argv[2]))throw Error('SOURCE_ROOT_REQUIRED');
 const root=process.argv[2],req=Module.createRequire(path.join(root,'package.json'));
 process.env.NODE_ENV='production';req('@next/env').loadEnvConfig(root,false,{info(){},error(){}});
 if(process.env.XCLIP_HTML_CACHE_DISABLED==='1')throw Error('HTML_CACHE_DISABLED');
 await require('./public-response-cache.cjs').createControlSignature()();
 console.log('PUBLIC_HTML_CONTROL_PATHS_READ_OK; no writes or network');
})().catch(()=>{console.error('PUBLIC_HTML_CONTROL_PREFLIGHT_FAILED; no changes');process.exitCode=1;});
