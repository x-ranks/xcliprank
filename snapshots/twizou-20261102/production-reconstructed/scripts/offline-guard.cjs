'use strict';
// Loaded only by isolated checks. Application code and credentials are not changed.
const fail=()=>{throw Error('OFFLINE_CHECK_NETWORK_FORBIDDEN');};
globalThis.fetch=fail;
const net=require('node:net'),tls=require('node:tls'),dns=require('node:dns');
net.Socket.prototype.connect=fail;net.connect=fail;net.createConnection=fail;tls.connect=fail;
for(const name of ['lookup','resolve','resolve4','resolve6'])dns[name]=fail;
const fs=require('node:fs');
const privatePath=p=>typeof p==='string'&&/^c:[/\\]projects[/\\]xcliprank[/\\](?:\.env|\.local-admin|data|artifacts)(?:[/\\.]|$)/i.test(p);
for(const name of ['readFileSync','writeFileSync','appendFileSync','openSync','readdirSync','rmSync']){
 const original=fs[name];fs[name]=function(p,...args){if(privatePath(p))throw Error('REAL_LOCAL_STATE_FORBIDDEN');return original.call(this,p,...args);};
}
for(const name of ['readFile','writeFile','appendFile','open','readdir','rm']){
 const original=fs.promises[name];fs.promises[name]=async function(p,...args){if(privatePath(p))throw Error('REAL_LOCAL_STATE_FORBIDDEN');return original.call(this,p,...args);};
}
