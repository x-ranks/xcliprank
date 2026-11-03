"use strict";
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict"),ts=require("typescript"),Module=require("node:module");
Module._extensions[".ts"]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {risingBucket,RISING_REFRESH_MS,fourHourSnapshot}=require("../lib/rising-snapshot.ts");
async function main(){
  assert.equal(RISING_REFRESH_MS,4*60*60*1000);
  assert.equal(risingBucket(RISING_REFRESH_MS-1)+1,risingBucket(RISING_REFRESH_MS));
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"twizou-rising-refresh-"));
  try {
    let now=RISING_REFRESH_MS*100+300000,calls=0;
    const valid=v=>v&&typeof v==="object"&&Number.isSafeInteger(v.count);
    const collect=async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,15));return {count:calls};};
    const run=()=>fourHourSnapshot(root,"ranking",collect,valid,()=>now);
    const [first,parallel]=await Promise.all([run(),run()]);
    assert.equal(calls,1);assert.deepEqual(first,parallel);
    assert.equal((await run()).value.count,1);assert.equal(calls,1);
    now+=RISING_REFRESH_MS;
    assert.equal((await run()).value.count,2);assert.equal(calls,2);
    assert(!fs.existsSync(path.join(root,"ranking.lock")));
    fs.writeFileSync(path.join(root,"ranking.json"),"bad json");
    now+=RISING_REFRESH_MS;
    assert.equal((await run()).value.count,3);assert.equal(calls,3);
    now+=RISING_REFRESH_MS;
    let scheduled,finish,markStarted,slowCalls=0;
    const started=new Promise(resolve=>{markStarted=resolve;});
    const slow=async()=>{slowCalls++;markStarted();await new Promise(resolve=>finish=resolve);return {count:4};};
    const stale=await fourHourSnapshot(root,"ranking",slow,valid,()=>now,{deferRefresh:fn=>scheduled=fn});
    assert.equal(stale.value.count,3);assert.equal(slowCalls,0,"stale response does not run aggregation before render");
    // Simulate slow filesystem scheduling; wait for the collector signal rather than a wall-clock guess.
    const originalOpen=fs.promises.open;
    fs.promises.open=async(...args)=>{await new Promise(resolve=>setTimeout(resolve,100));return originalOpen.apply(fs.promises,args);};
    let background;
    try {
      background=scheduled();
      await Promise.race([started,background.then(()=>{throw Error("BACKGROUND_ENDED_BEFORE_COLLECTION");})]);
    } finally {fs.promises.open=originalOpen;}
    assert.equal(slowCalls,1);
    let second;
    const during=await fourHourSnapshot(root,"ranking",slow,valid,()=>now,{deferRefresh:fn=>second=fn});
    assert.equal(during.value.count,3,"a running refresh never blocks a visitor with a usable snapshot");
    finish();await Promise.all([background,second()]);
    assert.equal((await run()).value.count,4);assert.equal(slowCalls,1,"shared in-process collection");
    let freshScheduled=false;
    await fourHourSnapshot(root,"ranking",collect,valid,()=>now,{deferRefresh:()=>freshScheduled=true});assert.equal(freshScheduled,false);
    now+=RISING_REFRESH_MS*2;
    await assert.rejects(fourHourSnapshot(root,"ranking",async()=>{throw Error("fixture outage");},valid,()=>now,{deferRefresh(){throw Error("must not serve an eight-hour-old snapshot");}}),/fixture outage/);
    await assert.rejects(fourHourSnapshot(root,"../escape",collect,valid),/NAME_INVALID/);
    const page=fs.readFileSync(path.join(__dirname,"../app/rising/page.tsx"),"utf8");
    assert(page.includes("twizou内で人気の動画をまとめました！"));
    for(const tab of ["/rising","/","/ranking/daily","/ranking/weekly","/reels","/download"])
      assert(page.includes(`href="${tab}"`),tab);
    assert(page.indexOf('href="/rising"')<page.indexOf('href="/">新着'));
    assert(page.includes("<VideoDurationBadge postId={post.x_post_id}"));
    console.log("PASS rising 4h snapshot, concurrent deduplication, corrupt snapshot recovery, all tabs, duration and concise copy");
  } finally {fs.rmSync(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
