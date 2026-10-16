const assert=require('assert/strict'),fs=require('fs'),path=require('path'),ts=require('typescript');
let draws=[],sleeps=[];
const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/availability-policy.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const m={exports:{}};new Function('require','module','exports','setTimeout',code)(n=>n==='node:crypto'?{randomInt:(min,max)=>{draws.push([min,max]);return draws.length%2?min:max-1}}:require(n),m,m.exports,(f,ms)=>{sleeps.push(ms);f()});
(async()=>{await m.exports.pauseMonitorRequest();await m.exports.pauseMonitorRequest();assert.deepEqual(draws,[[8000,20001],[8000,20001]]);assert.deepEqual(sleeps,[8000,20000]);
console.log('PASS MONITOR JITTER: 8-20 second sequential wait bounds, no real waits or HTTP requests.');})().catch(e=>{console.error(e);process.exitCode=1});
