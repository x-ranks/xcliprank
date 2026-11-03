import { activePersonalBundle, applyPersonalTier, PersonalBundle } from "./tier-personal-store";
import { randomInt, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, open, unlink } from "node:fs/promises";
import path from "node:path";
import { supabaseAdmin } from "./supabase-admin";
import { loadTierLearningModel, predictLearnedTier, blendRuleAndLearnedTier, TierLearningModel } from "./tier-learning";
import { calculateTier, applyCuratedTierFloor } from "./curated-collector";

type Row = { id: number; x_post_id: string; author_id: string | null; adult_tier: string; effective_adult_score: number | null; preview_image_url: string | null; video_url: string | null; adult_score: number; creator_score: number; possibly_sensitive: boolean | null };
type Entry = { row: Row; next: {tier: string; score: number}; status: "pending" | "writing" | "applied" | "skipped"; restoration?: "writing" | "restored" | "conflict" };
type Job = { id: string; createdAt: string; phase: "scanning" | "ready" | "applying" | "done" | "restoring" | "restored"; cursor: number; model: TierLearningModel; personalModel?: PersonalBundle | null; entries: Entry[]; ignored: number };
const directory = path.join(process.cwd(), ".local-admin", "tier-reevaluation");
const filename = path.join(directory, "latest.json");
const fields = "id,x_post_id,author_id,adult_tier,effective_adult_score,adult_score,creator_score,possibly_sensitive,preview_image_url,video_url";

export function randomSample<T>(items: T[], limit = 50): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(i + 1); [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, limit);
}
async function readJob(): Promise<Job | null> {
  try { return JSON.parse(await readFile(filename, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
async function save(job: Job) {
  const temporary = filename + "." + randomUUID();
  await writeFile(temporary, JSON.stringify(job), { mode: 0o600 });
  await rename(temporary, filename);
}
function eligible(db: ReturnType<typeof supabaseAdmin>) {
  return db.from("posts").select(fields).is("manual_tier", null)
    .eq("content_category", "PASS").eq("moderation_blocked", false)
    .eq("review_required", false).eq("is_visible", true)
    .not("video_url", "is", null).not("adult_tier", "in", "(NONE,X)")
    .not("adult_score", "is", null).not("creator_score", "is", null);
}
export async function runReevaluation(action: string, id?: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let lock;
  try { lock = await open(path.join(directory, "lock"), "wx", 0o600); }
  catch { throw new Error("別の処理が実行中です。しばらく待って再試行してください。再起動後も続く場合は.local-admin/tier-reevaluation/lockを確認してください。"); }
  try {
    let job = await readJob();
    if (action === "start") {
      if (job && !["done","restored"].includes(job.phase)) throw new Error("前の再評価が残っています。先に続行または取り消してください。");
      const model = await loadTierLearningModel(true);
      if (!model) throw new Error("有効な手動評価が100件以上必要です。DBは変更していません。");
      if (job) await writeFile(path.join(directory, job.id + ".json"), JSON.stringify(job), { mode: 0o600 });
      job = { id: randomUUID(), createdAt: new Date().toISOString(), phase: "scanning", cursor: 0, model, personalModel: await activePersonalBundle(true), entries: [], ignored: 0 };
    } else {
      if (!job || job.id !== id) throw new Error("再評価の識別子が一致しません。画面を更新してください。");
      if (action === "cancel") {
        if(job.entries.some(e=>e.status==="applied"||e.status==="writing"))throw Error("保存済みの再評価があります。復元または保存完了を先に行ってください。");
        await writeFile(path.join(directory, job.id + ".json"), JSON.stringify(job), { mode: 0o600 });
        await unlink(filename); return null;
      }
      const db = supabaseAdmin();
      if (action === "scan") {
        if (job.phase !== "scanning") throw new Error("計算済みです。");
        const scanLimit = job.personalModel ? 1 : 200;
        const { data, error } = await eligible(db).gt("id", job.cursor).order("id").limit(scanLimit);
        if (error) throw error;
        const rows = (data ?? []) as Row[];
        const authorIds = [...new Set(rows.map(r => r.author_id).filter((v): v is string => Boolean(v)))];
        const authors = authorIds.length ? await db.from("authors").select("*").in("x_author_id", authorIds) : { data: [], error: null };
        if (authors.error) throw authors.error;
        for (const row of rows) {
          const author = authors.data?.find(a => String(a.x_author_id) === String(row.author_id));
          if (!author || author.review_required || !Number.isFinite(Number(row.adult_score)) || !Number.isFinite(Number(row.creator_score))) { job.ignored++; continue; }
          const rule = calculateTier({ ...row, review_required: false }, author);
          if (rule.tier === "X") { job.ignored++; continue; }
          const base = author.is_curated ? applyCuratedTierFloor(rule, author, "PASS") : rule;
          const prediction = predictLearnedTier(job.model, { authorId: row.author_id, adultScore: Number(row.adult_score), creatorScore: Number(row.creator_score), possiblySensitive: row.possibly_sensitive === true });
          const next = await applyPersonalTier(blendRuleAndLearnedTier(base, prediction), {id: row.x_post_id, video: row.video_url}, job.personalModel ?? null, Boolean(job.personalModel));
          job.entries.push({ row, next, status: "pending" });
        }
        if (rows.length) job.cursor = rows[rows.length - 1].id;
        if (rows.length < scanLimit) job.phase = "ready";
      } else if (action === "apply") {
        if (!["ready", "applying"].includes(job.phase)) throw new Error("変更予定の計算を完了してください。");
        job.phase = "applying";
        await save(job);
        for (const entry of job.entries.filter(e => ["pending","writing"].includes(e.status)).slice(0, 50)) {
          const r = entry.row;
          const resuming = entry.status === "writing";
          entry.status = "writing";await save(job);
          // Durable write-ahead record also covers interruption AFTER a DB write.
          const { data, error } = await guardedUpdate(db, r, r.adult_tier, r.effective_adult_score,
            { adult_tier: entry.next.tier, effective_adult_score: entry.next.score });
          if(error)throw error;
          const already = !data?.length && resuming ? await matchingNext(db, entry) : false;
          entry.status = data?.length || already ? "applied" : "skipped";
          await save(job);
        }
        if (!job.entries.some(e => ["pending","writing"].includes(e.status))) job.phase = "done";
      } else if(action === "restore") {
        if(!["ready","applying","done","restoring"].includes(job.phase))throw Error("復元可能な保存履歴がありません。");
        job.phase="restoring";await save(job);
        for(const entry of job.entries.filter(e=>["applied","writing"].includes(e.status)&&(!e.restoration||e.restoration==="writing")).slice(0,50)) {
          const resuming=entry.restoration==="writing";
          entry.restoration="writing";await save(job);
          const {data,error}=await guardedUpdate(db,entry.row,entry.next.tier,entry.next.score,
            {adult_tier:entry.row.adult_tier,effective_adult_score:entry.row.effective_adult_score});
          if(error)throw error;
          const already=!data?.length&&resuming?await matchingNext(db,{...entry,next:{tier:entry.row.adult_tier,score:entry.row.effective_adult_score}}):false;
          entry.restoration=data?.length||already?"restored":"conflict";await save(job);
        }
        if(!job.entries.some(e=>["applied","writing"].includes(e.status)&&(!e.restoration||e.restoration==="writing")))job.phase="restored";
      } else throw new Error("未対応の操作です。");
    }
    await save(job);
    return summary(job);
  } finally { await lock.close(); await unlink(path.join(directory, "lock")); }
}
function summary(job: Job) {
  const transitions: Record<string, number> = {};
  for (const e of job.entries) { const key = `${e.row.adult_tier} → ${e.next.tier}`; transitions[key] = (transitions[key] ?? 0) + 1; }
  return { id: job.id, phase: job.phase, createdAt: job.createdAt, modelSamples: job.model.samples.length, total: job.entries.length,
    changed: job.entries.filter(e => e.row.adult_tier !== e.next.tier).length,
    applied: job.entries.filter(e => e.status === "applied").length,
    skipped: job.entries.filter(e => e.status === "skipped").length, ignored: job.ignored, restored:job.entries.filter(e=>e.restoration==="restored").length,restoreConflicts:job.entries.filter(e=>e.restoration==="conflict").length,personalModelTrainedAt:job.personalModel?.trainedAt??null, transitions };
}
export async function reevaluationStatus() {
  const job = await readJob();
  if (!job) return { job: null, samples: [] };
  const applied = job.entries.filter(e => e.status === "applied");
  const selected = randomSample(applied.length ? applied : job.entries);
  if (!selected.length) return { job: summary(job), samples: [], sampleScope: "preview" };
  const { data, error } = await supabaseAdmin().from("posts")
    .select("id,x_post_id,author_username,preview_image_url,video_url,adult_tier,manual_tier")
    .in("id", selected.map(e => e.row.id)).eq("content_category", "PASS")
    .eq("moderation_blocked", false).eq("review_required", false).eq("is_visible", true)
    .or("manual_tier.is.null,manual_tier.neq.X");
  if (error) throw error;
  return { job: summary(job), sampleScope: applied.length ? "applied" : "preview", samples: selected.flatMap(e => {
    const post = data?.find(p => p.id === e.row.id);
    return post ? [{ ...post, before: e.row.adult_tier, proposed: e.next.tier, status: e.status }] : [];
  }) };
}

function guarded(db:ReturnType<typeof supabaseAdmin>,r:Row,patch:{adult_tier:string;effective_adult_score:number|null}) {
 let q=db.from("posts").update(patch)
 .eq("id",r.id).is("manual_tier",null).eq("content_category","PASS")
 .eq("moderation_blocked",false).eq("review_required",false).eq("is_visible",true)
 .eq("x_post_id",r.x_post_id).eq("video_url",r.video_url)
 .eq("adult_score",r.adult_score).eq("creator_score",r.creator_score);
 q=r.author_id===null?q.is("author_id",null):q.eq("author_id",r.author_id);
 q=r.possibly_sensitive===null?q.is("possibly_sensitive",null):q.eq("possibly_sensitive",r.possibly_sensitive);
 return q;
}
function guardedUpdate(db:ReturnType<typeof supabaseAdmin>,r:Row,tier:string,score:number|null,patch:{adult_tier:string;effective_adult_score:number|null}) {
 let q=guarded(db,r,patch).eq("adult_tier",tier);
 q=score===null?q.is("effective_adult_score",null):q.eq("effective_adult_score",score);
 return q.select("id");
}
async function matchingNext(db:ReturnType<typeof supabaseAdmin>,e:{row:Row;next:{tier:string;score:number|null}}) {
 // Read only; never overwrite a concurrent manual review or changed source.
 let q=db.from("posts").select(fields+",manual_tier,content_category,moderation_blocked,review_required,is_visible").eq("id",e.row.id);
 const {data,error}=await q;if(error)throw error;
 const r=(data as unknown as (Row & {manual_tier:string|null;content_category:string;moderation_blocked:boolean;review_required:boolean;is_visible:boolean})[]|null)?.[0];return Boolean(r&&r.manual_tier===null&&r.content_category==="PASS"&&!r.moderation_blocked&&!r.review_required&&r.is_visible&&r.x_post_id===e.row.x_post_id&&r.video_url===e.row.video_url&&r.author_id===e.row.author_id&&r.possibly_sensitive===e.row.possibly_sensitive&&r.adult_score===e.row.adult_score&&r.creator_score===e.row.creator_score&&r.adult_tier===e.next.tier&&r.effective_adult_score===e.next.score);
}
