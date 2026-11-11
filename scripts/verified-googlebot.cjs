'use strict';
// Passenger's !~ headers cannot be supplied by HTTP clients. Never use
// X-Forwarded-For or the user agent alone to grant the age-gate exception.
const dns=require('node:dns').promises;
const net=require('node:net');
const MARKER='x-twizou-verified-googlebot';
const ADDRESS='!~passenger-client-address';
const CACHE_MS=10*60*1000;

function normalizedIp(value){
  if(typeof value!=='string'||value.length>64||value!==value.trim())return null;
  const ip=value.toLowerCase().replace(/^::ffff:/,'');
  return net.isIP(ip)?ip:null;
}
function crawlerKind(ua){
  if(typeof ua!=='string'||ua.length>1024)return null;
  if(/Googlebot(?:-Image|-Video)?(?:\/|\b)/.test(ua))return 'googlebot';
  if(/Google-InspectionTool(?:\/|\b)/.test(ua))return 'inspection';
  return null;
}
function trustedName(name,kind){
  if(typeof name!=='string'||name.length>253)return false;
  const host=name.replace(/\.$/,'').toLowerCase();
  if(!/^[a-z0-9.-]+$/.test(host))return false;
  return kind==='googlebot'
    ?(host.endsWith('.googlebot.com')||host.endsWith('.geo.googlebot.com'))
    :(host.endsWith('.googlebot.com')||host.endsWith('.google.com'));
}
function createVerifier({reverse=dns.reverse,lookup=dns.lookup,now=Date.now,timeoutMs=1500}={}){
  const cache=new Map();
  let active=0;
  async function check(ip,kind){
    const pending=(async()=>{
      const hosts=await reverse(ip);
      for(const host of hosts.slice(0,8)){
        if(!trustedName(host,kind))continue;
        const answers=await lookup(host,{all:true,verbatim:true});
        if(answers.some(a=>normalizedIp(a.address)===ip))return true;
      }
      return false;
    })();
    // DNS can fail or stall. A failure leaves the normal age gate in place.
    let timer;
    try{return await Promise.race([pending,new Promise(resolve=>{timer=setTimeout(()=>resolve(false),timeoutMs);})]);}
    catch{return false;}
    finally{clearTimeout(timer);}
  }
  return async function verify(req){
    const kind=crawlerKind(req.headers['user-agent']);
    const ip=normalizedIp(req.headers[ADDRESS]);
    if(!kind||!ip)return false;
    const key=kind+':'+ip,previous=cache.get(key),time=now();
    if(previous&&previous.expires>time)return previous.value;
    if(active>=8)return false;
    active++;
    try{
      const value=await check(ip,kind);
      cache.set(key,{value,expires:now()+(value?CACHE_MS:60000)});
      if(cache.size>256)cache.delete(cache.keys().next().value);
      return value;
    }finally{active--;}
  };
}
function wrapVerifiedGooglebot(handler,{verify=createVerifier()}={}){
  return function(req,res){
    // Strip a client-provided marker even if Passenger or another proxy passes it.
    delete req.headers[MARKER];
    if(req.method!=='GET'||!/^\/p\/[1-9][0-9]{1,24}(?:[/?]|$)/.test(req.url||''))return handler(req,res);
    if(!crawlerKind(req.headers['user-agent']))return handler(req,res);
    Promise.resolve().then(()=>verify(req)).catch(()=>false).then(verified=>{
      if(verified)req.headers[MARKER]='1';
      handler(req,res);
    });
  };
}
module.exports={ADDRESS,MARKER,normalizedIp,crawlerKind,trustedName,createVerifier,wrapVerifiedGooglebot};
