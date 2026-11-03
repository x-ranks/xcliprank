import { createHash } from "node:crypto";
import { PersonalLabel, PersonalHead, PersonalSample, personalGroup, trainPersonal, trainOrdinalPersonal, personalDecision } from "./tier-personal-core";
import { Seed } from "./tier-personal-store";
import { metrics, splitSamples, VisualSample } from "./tier-visual-comparison";

export const PERSONAL_EVALUATION_SPEC = "high-tier-recall-tuning-v5";
export type EvaluationSample = Seed & PersonalSample;

// X is not an exact quality tier. Only an explicit weak-content reason is
// interpreted as low quality; all other X reasons remain outside this model.
export function rankingTeacherLabel(seed: Seed): PersonalLabel | null {
  if (seed.label !== "X") return seed.label;
  return seed.reviewReason === "weak_content" ? "D" : null;
}
export function normalizedTier(tier: string): PersonalLabel {
  return (["A+", "B+", "D+"].includes(tier) ? tier[0] : tier) as PersonalLabel;
}
export function partitionTeachers(samples: EvaluationSample[]) {
  const input = samples.map(s => ({...s, label: personalGroup(s.label),
    fingerprint: createHash("sha256").update(JSON.stringify(s.features)).digest("hex"), legacy: null})) as VisualSample[];
  const final = splitSamples(input);
  const development = splitSamples(final.train);
  const get = (rows: VisualSample[]) => { const ids = new Set(rows.map(r => r.id)); return samples.filter(s => ids.has(s.id)); };
  return {train: get(development.train), tuning: get(development.test), test: get(final.test), groups: final.groups};
}

export function scoreRanking(rows: {id: string; actual: PersonalLabel; baseline: string; features: number[]}[], head: PersonalHead) {
  const scored = rows.map(row => {
    const predicted=normalizedTier(personalDecision(row.features,head,row.baseline).tier);
    return {...row, baseline: normalizedTier(row.baseline), predicted};
  });
  const before = metrics(scored.map(s => ({actual: personalGroup(s.actual), predicted: personalGroup(s.baseline)})));
  const after = metrics(scored.map(s => ({actual: personalGroup(s.actual), predicted: personalGroup(s.predicted)})));
  const lows = scored.filter(s => !["S", "A"].includes(s.actual));
  const falseHigh = (key: "baseline" | "predicted") => lows.length ? lows.filter(s => ["S", "A"].includes(s[key])).length / lows.length : null;
  const highs=scored.filter(s=>["S","A"].includes(s.actual));
  const highRecall=(key:"baseline"|"predicted")=>highs.length?highs.filter(s=>["S","A"].includes(s[key])).length/highs.length:null;
  const highPredictions=scored.filter(s=>["S","A"].includes(s.predicted));
  const highPrecision=highPredictions.length?highPredictions.filter(s=>["S","A"].includes(s.actual)).length/highPredictions.length:null;
  const exact = scored.filter(s => s.actual !== "OTHER");
  const exactBefore = exact.length ? exact.filter(s => s.actual === s.baseline).length / exact.length : null;
  const exactAfter = exact.length ? exact.filter(s => s.actual === s.predicted).length / exact.length : null;
  const recalls = ["S", "A"].every(label => (after.perClass.find(c => c.label === label)?.recall ?? 0) >= (before.perClass.find(c => c.label === label)?.recall ?? 0));
  const supports = ["S", "A", "OTHER"].every(label => (after.perClass.find(c => c.label === label)?.support ?? 0) >= 10);
  const failures: string[] = [];
  if (scored.length < 50 || !supports || !exact.length || !lows.length) failures.push("検証件数またはS/A/低評価の件数が不足");
  if (!recalls) failures.push("SまたはAの再現率が低下");
  if ((after.accuracy ?? 0) < (before.accuracy ?? 1)) failures.push("分類一致率が低下");
  if ((exactAfter ?? 0) < (exactBefore ?? 1)) failures.push("Tier完全一致率が低下");
  if ((after.macroF1 ?? 0) < (before.macroF1 ?? 1) + 0.02) failures.push("F1改善が2ポイント未満");
  if ((falseHigh("predicted") ?? 1) > (falseHigh("baseline") ?? 0)) failures.push("低評価動画のS/A過大評価が増加");
  return {passed: !failures.length, failures, before, after, exactCount: exact.length, exactBefore, exactAfter,
    highRecallBefore:highRecall("baseline"),highRecallAfter:highRecall("predicted"),highPrecisionAfter:highPrecision,
    falseHighBefore: falseHigh("baseline"), falseHighAfter: falseHigh("predicted"), confidenceThreshold: head.policy?.confidenceMin??0.6, policy:head.policy??null,
    sFalseHigh:lows.length?lows.filter(s=>s.predicted==="S").length/lows.length:null,
    bcExact:exact.filter(s=>["B","C"].includes(s.actual)).length?exact.filter(s=>["B","C"].includes(s.actual)&&s.actual===s.predicted).length/exact.filter(s=>["B","C"].includes(s.actual)).length:null};
}

export type ComparisonRow = {id: string; actual: PersonalLabel; baseline: string; features: number[]};
// Policy/temperature selection uses tuning rows only; final rows never affect a head.
function developmentScore(report:ReturnType<typeof scoreRanking>){return (report.exactAfter??0)*0.35+(report.bcExact??0)*0.25+(report.after.macroF1??0)*0.2-(report.falseHighAfter??1)*0.2-(report.sFalseHigh??1)*0.2;}
export function tunePersonalPolicy(head:PersonalHead,rows:ComparisonRow[]){
  if(rows.length<30)return head;
  const choices:{head:PersonalHead;score:number;report:ReturnType<typeof scoreRanking>}[]=[];
  for(const temperature of [1,1.5,2])for(const confidenceMin of [0.45,0.6])for(const sMin of [0.75,0.85,0.95]){
    const candidate={...head,policy:{temperature,confidenceMin,sMin,sMargin:0.15}};
    const report=scoreRanking(rows,candidate);choices.push({head:candidate,report,score:developmentScore(report)});
  }
  choices.sort((a,b)=>b.score-a.score||(a.report.sFalseHigh??1)-(b.report.sFalseHigh??1)||b.head.policy!.sMin-a.head.policy!.sMin);
  return choices[0].head;
}
// A new policy may recover high tiers only without increasing false-high rates
// against the existing guarded ordinal decision on tuning rows. Final labels are unused.
export function tuneHighTierRecovery(head:PersonalHead,rows:ComparisonRow[]){
  const base=tunePersonalPolicy(head,rows),reference=scoreRanking(rows,base);
  if(rows.length<30||["S","A","OTHER"].some(label=>(reference.after.perClass.find(c=>c.label===label)?.support??0)<5))return base;
  const choices:{head:PersonalHead;score:number;report:ReturnType<typeof scoreRanking>}[]=[];
  for(const highTierMin of [0.55,0.65,0.75,0.85])for(const highTierMargin of [0.05,0.15,0.25]){
    const candidate:PersonalHead={...base,policy:{...base.policy!,highTierMin,highTierMargin}};
    const report=scoreRanking(rows,candidate);
    if((report.falseHighAfter??1)>(reference.falseHighAfter??0)+1e-9 ||
      (report.sFalseHigh??1)>(reference.sFalseHigh??0)+1e-9 ||
      (report.highRecallAfter??0)<(reference.highRecallAfter??0) ||
      (report.exactAfter??0)<(reference.exactAfter??0))continue;
    choices.push({head:candidate,report,score:(report.highRecallAfter??0)*0.6+developmentScore(report)});
  }
  const baseScore=(reference.highRecallAfter??0)*0.6+developmentScore(reference);
  choices.sort((a,b)=>b.score-a.score||(a.report.falseHighAfter??1)-(b.report.falseHighAfter??1)||b.head.policy!.highTierMin!-a.head.policy!.highTierMin!);
  return choices.length&&choices[0].score>baseScore+1e-9?choices[0].head:base;
}
export function compareTeacherSources(train:EvaluationSample[],tuning:ComparisonRow[],test:ComparisonRow[]){
  let manualBase:PersonalHead|null=null,ordinalBase:PersonalHead|null=null;
  const candidates=["manual_only","manual_guarded","manual_ordinal","manual_recall","merged"].map(mode=>{
    const samples=train.filter(s=>mode==="merged"||s.source==="manual_db");
    let reason:string|null=samples.length<100?"学習100件未満":null;
    if(["manual_ordinal","manual_recall"].includes(mode)&&["B","C"].some(tier=>samples.filter(s=>s.label===tier).length<10))reason="B・Cの正確な教師が各10件未満";
    if(reason)return {mode,samples:samples.length,head:null,tuning:null,reason};
    const raw=["manual_ordinal","manual_recall"].includes(mode)?(ordinalBase??=trainOrdinalPersonal(samples)):mode==="merged"?trainPersonal(samples):(manualBase??=trainPersonal(samples));
    const head=mode==="manual_recall"?tuneHighTierRecovery(raw,tuning):["manual_guarded","manual_ordinal"].includes(mode)?tunePersonalPolicy(raw,tuning):raw;
    return {mode,samples:samples.length,head,tuning:scoreRanking(tuning,head),reason:null};
  });
  const eligible=candidates.filter(c=>c.head&&c.tuning&&c.tuning.after.count>=30);
  eligible.sort((a,b)=>Number(b.tuning!.passed)-Number(a.tuning!.passed)||developmentScore(b.tuning!)-developmentScore(a.tuning!)||Number(a.mode==="merged")-Number(b.mode==="merged"));
  const selected=eligible[0]??null,manualSelected=eligible.find(c=>c.mode==="manual_recall"&&c.head?.policy?.highTierMin!==undefined)??eligible.find(c=>["manual_guarded","manual_ordinal"].includes(c.mode))??eligible.find(c=>c.mode==="manual_only")??null;
  const reports=candidates.map(c=>({mode:c.mode,trainingCount:c.samples,policy:c.head?.policy??null,tuning:c.tuning,final:c.head?scoreRanking(test,c.head):null,reason:c.reason}));
  const final=reports.find(c=>c.mode===selected?.mode)?.final??null;
  const tuningSupported=tuning.length>=30&&["S","A","OTHER"].every(label=>(selected?.tuning?.after.perClass.find(c=>c.label===label)?.support??0)>=5);
  const passed=Boolean(selected&&tuningSupported&&final?.passed);
  return {head:selected?.head??null,manualPreviewHead:manualSelected?.head??null,heads:candidates.map(c=>({mode:c.mode,head:c.head})),validation:{
    ...(final??{passed:false}),passed,evaluationSpec:PERSONAL_EVALUATION_SPEC,selectedMode:selected?.mode??null,manualPreviewMode:manualSelected?.mode??null,candidates:reports,
    reason:passed?"調整用で選んだ候補が最終検証を通過":"精度または検証件数の条件を満たさないため保留",
    scope:"投稿者・同一特徴を分離。A/S取りこぼし回復・B/C境界・S抑制を比較。回復条件は調整用だけで選び、過大評価が増える条件は除外。",
    selectionUsesFinalTest:false,refitAfterTest:false,tuningSupported,
    evidence:"既に観測済みの教師群による開発比較。プレビューメモを学習へ自動追加しない。新しい動画の予測非表示評価で追試する。"}};
}

export type CachedFeature = {source_url: string; feature_spec: string; features: number[] | null; retry_after: string | null; error?: string | null};
export function featureFailureCode(message: string | null | undefined) {
  if (!message) return "NO_RECORDED_CAUSE";
  const known = /^(VIDEO_HTTP_\d{3}|VIDEO_UNAVAILABLE|VIDEO_TOO_LARGE|VIDEO_DECODE_TIMEOUT|VIDEO_DECODE_FAILED|VIDEO_FRAME_MISSING|VIDEO_TOOL_OUTPUT_TOO_LARGE|INVALID_VIDEO_DURATION|UNSUPPORTED_VIDEO_URL|VIDEO_WRITE_FAILED|INVALID_VIDEO_FRAMES|INVALID_EMBEDDING|INVALID_FEATURES)$/;
  if (known.test(message)) return message;
  if (/timeout|abort/i.test(message)) return "NETWORK_TIMEOUT";
  if (/fetch failed/i.test(message)) return "NETWORK_FETCH_FAILED";
  if (/FFmpeg|FFprobe/.test(message)) return "VIDEO_TOOLS_MISSING";
  return "OTHER_RECORDED_ERROR"; // Never return raw diagnostic text, URLs or secrets.
}
export function summarizeFeatureHealth(seeds: Seed[], cache: Map<string, CachedFeature>, spec: string) {
  const byTier: Record<string, {total: number; usable: number; failed: number; missing: number}> = {};
  const bySource: Record<string, {total: number; usable: number; failed: number; missing: number}> = {};
  const causes: Record<string, number> = {}, causesByTier: Record<string, Record<string, number>> = {};
  const xReasons: Record<string, number> = {};
  let excludedX = 0, weakXAsD = 0;
  for (const s of seeds) {
    if (s.label === "X") {const reason = s.reviewReason ?? "unspecified"; xReasons[reason] = (xReasons[reason] ?? 0) + 1;
      if (rankingTeacherLabel(s)) weakXAsD++; else excludedX++;}
    const c = cache.get(s.id);
    const compatible = Boolean(c && c.source_url === s.video && c.feature_spec === spec);
    const good = compatible && Array.isArray(c?.features) && c.features.length === 1024 && c.features.every(Number.isFinite);
    const failed = !s.video || compatible && !good && Boolean(c?.error || c?.retry_after);
    const state = good ? "usable" : failed ? "failed" : "missing";
    for (const [table, key] of [[byTier, s.label], [bySource, s.source ?? "unknown"]] as const) {
      const row = table[key] ??= {total: 0, usable: 0, failed: 0, missing: 0}; row.total++; row[state]++;
    }
    if (failed) {const code = !s.video ? "NO_VIDEO_URL" : featureFailureCode(c?.error);
      causes[code] = (causes[code] ?? 0) + 1; const tier = causesByTier[s.label] ??= {}; tier[code] = (tier[code] ?? 0) + 1;}
  }
  return {byTier, bySource, causes, causesByTier, xReasons, excludedX, weakXAsD,
    note: "保存済みエラーの集計。古いVIDEO_UNAVAILABLEはHTTP内訳を記録していないため、原因の特定に限界があります。再取得はしていません。"};
}
