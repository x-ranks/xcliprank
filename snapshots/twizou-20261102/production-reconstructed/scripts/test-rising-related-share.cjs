"use strict";
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict"),ts=require("typescript"),Module=require("node:module");
Module._extensions[".ts"]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {rankRising}=require("../lib/rising-score.ts");
const {shareVideoHref}=require("../lib/share-video.ts");
const {createPublicCatalog}=require("../lib/public-catalog-store.ts");
const {createPublicVideoService}=require("../lib/public-video-service.ts");
const {safePublicReturn}=require("../lib/public-return-navigation.ts");
function loadRisingWith(mocks) {
  const source=fs.readFileSync(path.join(__dirname,"../lib/rising-ranking.ts"),"utf8");
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const mod={exports:{}};
  const resolve=name=>name==="server-only"?{}:name==="./supabase-admin"?{supabaseAdmin:()=>mocks.db}:
    name==="./public-video-production"?{productionPublicBackend:()=>{throw Error("COLLECTION_MUST_NOT_INSPECT_SNAPSHOT")}}:name==="./initial-ranking"?{loadRankingPage:mocks.rankings}:
    name==="./public-catalog-store"?{createPublicCatalog:()=>({read:async()=>mocks.catalog})}:
    name==="./public-save-secret"?{publicCatalogDirectory:()=>"/synthetic/catalog"}:
    name==="./rising-snapshot"?{fourHourSnapshot:()=>{throw Error("UNEXPECTED_SNAPSHOT_ACCESS")}}:
    name==="./public-video-core"?require("../lib/public-video-core.ts"):
    name==="./rising-score"?{rankRising}:require(name);
  new Function("require","module","exports",output)(resolve,mod,mod.exports);
  return mod.exports.collectRisingRanking;
}
async function main(){
  assert.deepEqual(rankRising([{id:"1",opens:0,saves:99},{id:"2",opens:2,saves:2},{id:"3",opens:5,saves:0}],2).map(v=>v.id),["2","3"]);
  assert.equal(rankRising(Array.from({length:60},(_,i)=>({id:String(i+1),opens:i+1,saves:0}))).length,50);
  assert(shareVideoHref("123").includes(encodeURIComponent("https://twizou.net/p/123")));
  assert.equal(shareVideoHref("../", "javascript:alert(1)"),null);
  assert.equal(safePublicReturn("/rising"),"/rising");
  const rankedCalls=[];
  const post=id=>({x_post_id:id,author_name:"fixture",preview_image_url:null,manual_id:null});
  const rankings=async(range,page,edition)=>{
    rankedCalls.push([range,page??1,edition??null]);
    if(range==="trending"&&page===2)return {status:200,posts:[post("103")]};
    if(range==="trending")return {status:200,posts:[post("101"),post("102")],edition:"fixed",pagination:{totalPages:2}};
    return {status:200,posts:range==="daily"?[post("104")]:[post("102")]};
  };
  const eventRows=[{x_post_id:"101"},{x_post_id:"101"},{x_post_id:"102"},{x_post_id:"104"}];
  const db={from:()=>({select(){return this},eq(){return this},gte(){return this},in(_field,ids){this.ids=ids;return this},range:async function(offset,end){return {data:eventRows.filter(v=>this.ids.includes(v.x_post_id)).slice(offset,end+1),error:null}}})};
  const load=loadRisingWith({rankings,db,catalog:{records:{"101":{saves:0},"102":{saves:2},"103":{saves:100},"104":{saves:0}}}});
  const result=await load();
  assert.deepEqual(result.posts.map(v=>v.x_post_id),["102","101","104"]);
  assert.deepEqual(result.posts.map(v=>v.risingScore),[5,2,1]);
  assert(rankedCalls.some(v=>v[0]==="trending"&&v[1]===2&&v[2]==="fixed"));
  await assert.rejects(loadRisingWith({rankings:async()=>({status:503}),db,catalog:{records:{}}})(),/RISING_RANKING_UNAVAILABLE/);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"twizou-related-"));
  try {
    const video=(id,tier,views)=>({id,adultTier:tier,views,likes:0,authorId:id,handle:"author"+id,authorName:"Author",text:"",posterUrl:null,videoUrl:"https://video.twimg.com/"+id+".mp4",createdAt:null,sourceHash:"a".repeat(64),eligible:true});
    const rows=[video("101","S",1),video("102","A",1000),video("103","S",10),video("104","S",20)];
    const service=createPublicVideoService({catalog:createPublicCatalog(path.join(root,"catalog")),posts:async ids=>rows.filter(v=>ids.includes(v.id)),authorVideos:async()=>[],candidates:async skip=>rows.filter(v=>!skip.includes(v.id)),secret:async()=>""});
    const detail=await service.detail("101");
    assert.deepEqual(detail.related,[]);
    assert.deepEqual(detail.recommended.map(v=>v.id),["104","103","102"]);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
  console.log("PASS rising candidate aggregation, score, zero-open exclusion, share link and same-tier popular fallback");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
