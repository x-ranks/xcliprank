import { readFile } from "node:fs/promises";
import path from "node:path";
import { supabaseAdmin } from "./supabase-admin";
import { predictLearnedTier } from "./tier-learning";
import { GROUPS, Group, VisualSample, tierGroup, decodeVisualFeatures, splitSamples, trainVisualCentroids, predictVisualGroup, metrics } from "./tier-visual-comparison";
type Post = { x_post_id: string; author_id: string | null; author_username: string | null; manual_tier: string | null; adult_tier: string; adult_score: number | null; creator_score: number | null; possibly_sensitive: boolean | null; moderation_blocked: boolean; review_required: boolean; content_category: string; manual_reviewed_at: string | null; id: number };
type TeacherStore = { authors: { username: string; posts: { xPostId: string; safetyReasons: string[]; review: {tier: string; reason: string | null; reviewedAt: string} | null }[] }[] };
const columns="id,x_post_id,author_id,author_username,manual_tier,adult_tier,adult_score,creator_score,possibly_sensitive,moderation_blocked,review_required,content_category,manual_reviewed_at";
async function optionalJSON<T>(file: string): Promise<T | null> {
  try {return JSON.parse(await readFile(file,"utf8"));}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return null;throw e;}
}
export async function analyzeTeachers() {
  const db=supabaseAdmin();const posts: Post[]=[];let cursor=0,truncated=false;
  while(posts.length<20000){
    const r=await db.from("posts").select(columns).not("manual_tier","is",null).gt("id",cursor).order("id").limit(500);
    if(r.error)throw r.error;const batch=(r.data??[]) as Post[];posts.push(...batch);
    if(batch.length<500)break;cursor=batch[batch.length-1].id;
    if(posts.length>=20000)truncated=true;
  }
  const store=await optionalJSON<TeacherStore>(path.join(process.cwd(),"data","teacher-authors.json"));
  const storedModel=await optionalJSON<{trainedAt: string; evaluation?:{pairAccuracy?:number|null};training?:{extracted?:number};trainingItems?:{xPostId:string;label:string}[]}>(path.join(process.cwd(),"data","visual-preference-model.json"));
  const local=store?.authors.flatMap(a=>a.posts.filter(p=>p.review).map(p=>({...p,author:a.username})))??[];
  const postMap=new Map(posts.map(p=>[p.x_post_id,p]));
  const localIds=local.map(p=>p.xPostId).filter(id=>!postMap.has(id));
  for(let i=0;i<localIds.length;i+=200){const r=await db.from("posts").select(columns).in("x_post_id",localIds.slice(i,i+200));if(r.error)throw r.error;for(const p of (r.data??[]) as Post[])postMap.set(p.x_post_id,p);}
  const labels=new Map<string,{label:Group;author:string;source:string;post:Post|null}>();let excluded=0,conflicts=0;
  const safe=(p:Post)=>!p.moderation_blocked&&!p.review_required&&p.content_category==="PASS";
  for(const p of local){
    const record=postMap.get(p.xPostId);const group=tierGroup(p.review?.tier);
    if(!group||p.safetyReasons?.length||p.review?.reason==="policy_violation"||(record&&(!safe(record)||record.manual_tier==="NONE"))){excluded++;continue;}
    labels.set(p.xPostId,{label:group,author:record?.author_id??p.author.toLowerCase(),source:"local_teacher",post:record??null});
  }
  for(const p of posts){const group=tierGroup(p.manual_tier);if(!group||!safe(p)){labels.delete(p.x_post_id);excluded++;continue;}
    if(labels.has(p.x_post_id)&&labels.get(p.x_post_id)!.label!==group)conflicts++;
    labels.set(p.x_post_id,{label:group,author:p.author_id??p.author_username?.toLowerCase()??"unknown",source:"manual_db",post:p});
  }
  const counts=Object.fromEntries(GROUPS.map(g=>[g,[...labels.values()].filter(v=>v.label===g).length]));
  const samples:VisualSample[]=[];let missing=0,invalid=0;const dimensionCounts=new Map<number,number>();
  const ids=[...labels.keys()];
  for(let i=0;i<ids.length;i+=20){await Promise.all(ids.slice(i,i+20).map(async id=>{
    if(!/^\d{1,30}$/.test(id)){invalid++;return;}
    try{
      const c=await optionalJSON<{kind:string;version:number;featureSpec:string;featuresBase64?:string;dimension?:number}>(path.join(process.cwd(),"data","visual-preference-feature-cache",id+".json"));
      if(!c||c.kind!=="success"){missing++;return;}
      if(c.version!==1||c.featureSpec!=="nsfwjs-flatten_1-four-frames-v1")throw Error("feature spec");
      const decoded=decodeVisualFeatures(c.featuresBase64??"",c.dimension??0);const entry=labels.get(id)!;const p=entry.post;
      const legacy=p&&p.adult_score!==null&&p.creator_score!==null&&Number.isFinite(Number(p.adult_score))&&Number.isFinite(Number(p.creator_score))?{authorId:p.author_id,adultScore:Number(p.adult_score),creatorScore:Number(p.creator_score),possiblySensitive:p.possibly_sensitive===true}:null;
      samples.push({id,author:entry.author,label:entry.label,...decoded,legacy});dimensionCounts.set(decoded.features.length,(dimensionCounts.get(decoded.features.length)??0)+1);
    }catch{invalid++;}
  }));}
  samples.sort((a,b)=>a.id.localeCompare(b.id));
  const dimension=[...dimensionCounts].sort((a,b)=>b[1]-a[1])[0]?.[0];
  const usable=samples.filter(s=>s.features.length===dimension);const split=splitSamples(usable);
  const splitSet=new Set(split.test.map(s=>s.id));
  const legacyRows=[...labels.entries()].filter(([id,v])=>!splitSet.has(id)&&!split.test.some(t=>t.author===v.author)&&v.source==="manual_db"&&v.post&&["S","A","B","C","D"].includes(v.post.manual_tier??""))
    .map(([,v])=>v.post!).filter(p=>p.adult_score!==null&&p.creator_score!==null)
    .sort((a,b)=>(b.manual_reviewed_at??"").localeCompare(a.manual_reviewed_at??"")).slice(0,1000);
  const tierValues:Record<string,number>={S:5,A:4,B:3,C:2,D:1};
  const legacyModel=legacyRows.length>=100?{trainedAt:"holdout",samples:legacyRows.map(p=>({authorId:p.author_id,adultScore:Number(p.adult_score),creatorScore:Number(p.creator_score),possiblySensitive:p.possibly_sensitive===true,tier:p.manual_tier as "S"|"A"|"B"|"C"|"D",value:tierValues[p.manual_tier!]}))}:null;
  const predictions:{id:string;actual:Group;visual:Group;legacy:Group|null}[]=[];
  if(split.train.length>=20&&split.test.length>=10&&new Set(split.train.map(s=>s.label)).size>=2){
    const model=trainVisualCentroids(split.train);
    for(const s of split.test){const old=s.legacy?predictLearnedTier(legacyModel,s.legacy):null;predictions.push({id:s.id,actual:s.label,visual:predictVisualGroup(s.features,model),legacy:old?tierGroup(old.tier):null});}
  }
  const common=predictions.filter(p=>p.legacy!==null);
  const changedSinceModel=storedModel?.trainingItems?.filter(t=>labels.has(t.xPostId)&&tierGroup(t.label)!==labels.get(t.xPostId)!.label).length??0;
  return {readOnly:true,dbManualCount:posts.length,truncated,localTeacherCount:local.length,mergedCount:labels.size,conflicts,excluded,labelCounts:counts,
    features:{usable:usable.length,missing,invalid,mixedDimensionExcluded:samples.length-usable.length,dimension:dimension??null},
    existingVisualModel:{found:Boolean(storedModel),trainedAt:storedModel?.trainedAt??null,extracted:storedModel?.training?.extracted??null,pairAccuracy:storedModel?.evaluation?.pairAccuracy??null,labelsChanged:changedSinceModel},
    comparison:{method:"作者と同一特徴を分離した約20%の検証用データ",groupCount:split.groups,trainCount:split.train.length,testCount:split.test.length,legacyTrainingCount:legacyRows.length,
      performed:predictions.length>0,commonCount:common.length,
      visual:metrics(predictions.map(p=>({actual:p.actual,predicted:p.visual}))),
      commonVisual:metrics(common.map(p=>({actual:p.actual,predicted:p.visual}))),legacy:metrics(common.map(p=>({actual:p.actual,predicted:p.legacy!}))),
      examples:predictions.filter(p=>p.actual!==p.visual||p.legacy!==p.visual).slice(0,50)},
    notes:["教師データのS/Aは統合し、B/C/DとOTHERは検証上OTHERとして扱います。Xは安全上の除外を除く低評価のみです。", "視覚候補は分散を正則化したクラス代表特徴との距離を使います。現行より優れているかは実データの検証結果で判断します。", "現行欄は収集時のメタデータ学習部のみの比較です。ルール混合後の最終Tier精度ではありません。", "表示だけではDB・収集・本番アルゴリズムを変更しません。特徴が不足する場合は既存の視覚学習画面で抽出できます。", "既存モデルのペア順位精度と本画面の分類一致率は異なる指標です。検証データは手動でモデル選択に使うと最終確認用ではなくなります。"]};
}
