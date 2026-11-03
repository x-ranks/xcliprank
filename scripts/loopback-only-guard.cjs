'use strict';
// Only the in-process range-session fixture may reach its local listener.
const net=require('node:net'),tls=require('node:tls'),dns=require('node:dns'),fs=require('node:fs');
const fail=()=>{throw Error('OFFLINE_CHECK_NETWORK_FORBIDDEN');};
const originalFetch=globalThis.fetch,originalConnect=net.Socket.prototype.connect,originalListen=net.Server.prototype.listen,originalLookup=dns.lookup;
globalThis.fetch=(input,init)=>{const u=new URL(typeof input==='string'?input:input.url);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.username||u.password)fail();return originalFetch(input,{...init,redirect:'error'});};
net.Socket.prototype.connect=function(...args){const v=Array.isArray(args[0])?args[0][0]:args[0];if(!v||typeof v!=='object'||v.host!=='127.0.0.1'||!Number.isInteger(Number(v.port)))fail();return originalConnect.apply(this,args);};
net.Server.prototype.listen=function(...args){if(args[0]!==0||args[1]!=='127.0.0.1')fail();return originalListen.apply(this,args);};
tls.connect=fail;for(const name of ['resolve','resolve4','resolve6'])dns[name]=fail;
dns.lookup=function(host,...args){if(host!=='127.0.0.1')fail();return originalLookup.call(this,host,...args);};
const privatePath=p=>typeof p==='string'&&/^c:[/\\]projects[/\\]xcliprank[/\\](?:\.env|\.local-admin|data|artifacts)(?:[/\\.]|$)/i.test(p);
for(const name of ['readFileSync','writeFileSync','appendFileSync','openSync','readdirSync','rmSync']){const original=fs[name];fs[name]=function(p,...args){if(privatePath(p))throw Error('REAL_LOCAL_STATE_FORBIDDEN');return original.call(this,p,...args);};}
for(const name of ['readFile','writeFile','appendFile','open','readdir','rm']){const original=fs.promises[name];fs.promises[name]=async function(p,...args){if(privatePath(p))throw Error('REAL_LOCAL_STATE_FORBIDDEN');return original.call(this,p,...args);};}
