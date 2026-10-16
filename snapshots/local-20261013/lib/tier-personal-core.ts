// Supervised, regularized softmax head over frozen image embeddings.
// OTHER is a partial label (B/C/D), never an invented exact B label.
export const PERSONAL_CLASSES = ["S", "A", "B", "C", "D", "X"] as const;
export type PersonalLabel = typeof PERSONAL_CLASSES[number] | "OTHER";
export type PersonalSample = { id: string; author: string; label: PersonalLabel; features: number[] };
export type PersonalHead = { mean: number[]; scale: number[]; weights: number[][]; bias: number[]; samples: number; ordinal?: {weights:number[];thresholds:number[]}; policy?: {temperature:number;confidenceMin:number;sMin:number;sMargin:number;highTierMin?:number;highTierMargin?:number} };
export const PERSONAL_FEATURE_SPEC = "nsfwjs-mobilenetv2-flatten-four-frames-10-25-50-80-v2";
export const PERSONAL_FRAME_POSITIONS = [0.10, 0.25, 0.50, 0.80] as const;
export const PERSONAL_FEATURE_DIMENSION = 1024;
export function combinePersonalFrames(frames:number[][]) {
  if(frames.length!==4||frames.some(f=>f.length!==256||!f.every(Number.isFinite)))throw Error("INVALID_VIDEO_FRAMES");
  // Concatenate in time order: the model learns different weights for each point.
  return frames.flat();
}
const allowed = (label: PersonalLabel) => label === "OTHER" ? [2, 3, 4] : [PERSONAL_CLASSES.indexOf(label)];
export function projectEmbedding(values: number[]) {
  if (!values.length || !values.every(Number.isFinite)) throw Error("INVALID_EMBEDDING");
  const out = Array(256).fill(0) as number[];
  values.forEach((v, i) => { const h = Math.imul(i + 1, 2654435761) >>> 0; out[h % 256] += (h & 256 ? -1 : 1) * v; });
  const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0)) || 1;
  return out.map(v => v / norm);
}
function probabilities(logits: number[]) { const max = Math.max(...logits); const e = logits.map(v => Math.exp(v - max)); const sum = e.reduce((a,b)=>a+b,0); return e.map(v=>v/sum); }
function vector(features: number[], head: PersonalHead) {
  if (features.length !== head.mean.length || !features.every(Number.isFinite)) throw Error("INVALID_FEATURES");
  return features.map((v,i)=>Math.max(-6,Math.min(6,(v-head.mean[i])/head.scale[i])));
}
export function predictPersonal(features: number[], head: PersonalHead) {
  const x=vector(features,head);
  const temperature=head.policy?.temperature??1;
  let p:number[];
  if(head.ordinal){
    const z=head.ordinal.weights.reduce((sum,w,i)=>sum+w*x[i],0);
    const cumulative=head.ordinal.thresholds.map(t=>1/(1+Math.exp(Math.max(-40,Math.min(40,(t-z)/temperature)))));
    p=[cumulative[3],cumulative[2]-cumulative[3],cumulative[1]-cumulative[2],cumulative[0]-cumulative[1],1-cumulative[0],0];
  }else p=probabilities(head.weights.map((w,k)=>w.reduce((s,v,i)=>s+v*x[i],head.bias[k])/temperature));
  const index=p.indexOf(Math.max(...p));
  return {label:PERSONAL_CLASSES[index],confidence:p[index],probabilities:p};
}
export function trainPersonal(samples: PersonalSample[], epochs=45): PersonalHead {
  if(samples.length<20)throw Error("INSUFFICIENT_TRAINING_SAMPLES");
  const d=samples[0].features.length;
  if(d!==PERSONAL_FEATURE_DIMENSION||samples.some(s=>s.features.length!==d||!s.features.every(Number.isFinite)||!allowed(s.label).every(k=>k>=0)))throw Error("INVALID_TRAINING_DATA");
  const mean=Array(d).fill(0) as number[], scale=Array(d).fill(0) as number[];
  samples.forEach(s=>s.features.forEach((v,i)=>{mean[i]+=v/samples.length;}));
  samples.forEach(s=>s.features.forEach((v,i)=>{scale[i]+=(v-mean[i])**2/samples.length;}));
  const head:PersonalHead={mean,scale:scale.map(v=>Math.sqrt(v+0.0001)),weights:PERSONAL_CLASSES.map(()=>Array(d).fill(0)),bias:PERSONAL_CLASSES.map(()=>0),samples:samples.length};
  const inputs=samples.map(s=>vector(s.features,head));
  const counts=new Map<PersonalLabel,number>();samples.forEach(s=>counts.set(s.label,(counts.get(s.label)??0)+1));
  // Deterministic online SGD; regularization and step size are fixed, not tuned on holdout.
  for(let epoch=0;epoch<epochs;epoch++)for(let j=0;j<samples.length;j++){
    const i=(j*1+epoch*37)%samples.length,x=inputs[i],sample=samples[i];
    const p=probabilities(head.weights.map((w,k)=>w.reduce((sum,v,f)=>sum+v*x[f],head.bias[k])));
    const target=allowed(sample.label),mass=target.reduce((s,k)=>s+p[k],0);
    const weight=Math.min(3,Math.sqrt(samples.length/(counts.size*counts.get(sample.label)!)));
    const rate=0.025/(1+epoch*0.08);
    for(let k=0;k<6;k++){
      const gradient=weight*(p[k]-(target.includes(k)?p[k]/Math.max(1e-9,mass):0));
      head.bias[k]-=rate*gradient;
      for(let f=0;f<d;f++)head.weights[k][f]-=rate*(gradient*x[f]+0.015*head.weights[k][f]);
    }
  }
  return head;
}
export function personalGroup(label: PersonalLabel): "S"|"A"|"OTHER"|"X" { return label==="S"||label==="A"||label==="X"?label:"OTHER"; }
export function safeAutomaticTier(label: typeof PERSONAL_CLASSES[number]) { return label==="X"?"D":label; }
export function validPersonalHead(v: unknown): v is PersonalHead {
  const h=v as PersonalHead;
  return !!h && h.mean?.length===PERSONAL_FEATURE_DIMENSION && h.scale?.length===PERSONAL_FEATURE_DIMENSION && h.weights?.length===6 && h.bias?.length===6 &&
    [...h.mean,...h.scale,...h.bias,...h.weights.flat()].every(Number.isFinite) && h.scale.every(s=>s>0) && h.weights.every(w=>w.length===PERSONAL_FEATURE_DIMENSION) && h.samples>=20 &&
    (!h.ordinal||(h.ordinal.weights?.length===PERSONAL_FEATURE_DIMENSION&&h.ordinal.thresholds?.length===4&&[...h.ordinal.weights,...h.ordinal.thresholds].every(Number.isFinite)&&h.ordinal.thresholds.every((v,i)=>i===0||v>h.ordinal!.thresholds[i-1])))&&
    (!h.policy||[h.policy.temperature,h.policy.confidenceMin,h.policy.sMin,h.policy.sMargin].every(Number.isFinite)&&h.policy.temperature>=1&&h.policy.temperature<=3&&h.policy.confidenceMin>=0.4&&h.policy.confidenceMin<=0.9&&h.policy.sMin>=h.policy.confidenceMin&&h.policy.sMin<=1&&h.policy.sMargin>=0&&h.policy.sMargin<=1 &&
      ((h.policy.highTierMin===undefined&&h.policy.highTierMargin===undefined)||
        (Number.isFinite(h.policy.highTierMin)&&Number.isFinite(h.policy.highTierMargin)&&h.policy.highTierMin!>=0.5&&h.policy.highTierMin!<=0.95&&h.policy.highTierMargin!>=0&&h.policy.highTierMargin!<=0.5)));
}

// Share the same decision rule in preview, validation and the optional runtime.
export function personalDecision(features:number[],head:PersonalHead,baseline:string){
  const p=predictPersonal(features,head),minimum=head.policy?.confidenceMin??0.6;
  const margin=p.probabilities[0]-Math.max(...p.probabilities.slice(1));
  const sGuard=p.label==="S"&&head.policy!==undefined&&(p.confidence<head.policy.sMin||margin<head.policy.sMargin);
  const highTierMass=p.probabilities[0]+p.probabilities[1];
  const lowTierMass=p.probabilities.slice(2).reduce((sum,v)=>sum+v,0);
  // A is a ranking eligibility decision, not permission to bypass the S guard.
  const recoverHigh=head.policy?.highTierMin!==undefined&&head.policy.highTierMargin!==undefined&&
    highTierMass>=head.policy.highTierMin&&highTierMass-lowTierMass>=head.policy.highTierMargin;
  if(recoverHigh){
    const allowS=p.label==="S"&&p.confidence>=minimum&&!sGuard;
    return {...p,applied:true,tier:allowS?"S":"A",reason:allowS?"visual":"high_tier_recovery",highTierMass};
  }
  const applied=p.confidence>=minimum&&!sGuard;
  return {...p,applied,tier:applied?safeAutomaticTier(p.label):baseline,reason:sGuard?"s_guard":applied?"visual":"confidence",highTierMass};
}

// Cumulative ordinal logistic head: learn D<C<B<A<S, with four ordered boundaries.
// Partial OTHER labels inform only the A/S boundaries, never an invented B or C.
export function trainOrdinalPersonal(samples:PersonalSample[],epochs=60):PersonalHead{
  if(samples.length<100)throw Error("INSUFFICIENT_ORDINAL_SAMPLES");
  const ranks:Record<string,number>={D:0,C:1,B:2,A:3,S:4};
  if(samples.some(s=>s.features.length!==PERSONAL_FEATURE_DIMENSION||!s.features.every(Number.isFinite)||(!(s.label in ranks)&&s.label!=="OTHER")))throw Error("INVALID_ORDINAL_DATA");
  const d=PERSONAL_FEATURE_DIMENSION,mean=Array(d).fill(0),variance=Array(d).fill(0);
  for(const sample of samples)for(let i=0;i<d;i++)mean[i]+=sample.features[i]/samples.length;
  for(const sample of samples)for(let i=0;i<d;i++)variance[i]+=(sample.features[i]-mean[i])**2/samples.length;
  const head:PersonalHead={mean,scale:variance.map(v=>Math.sqrt(v+0.0001)),weights:PERSONAL_CLASSES.map(()=>Array(d).fill(0)),bias:Array(6).fill(0),samples:samples.length,ordinal:{weights:Array(d).fill(0),thresholds:[-1.5,-0.5,0.5,1.5]}};
  const inputs=samples.map(s=>vector(s.features,head)),counts=new Map<string,number>();for(const s of samples)counts.set(s.label,(counts.get(s.label)??0)+1);
  for(let epoch=0;epoch<epochs;epoch++)for(let j=0;j<samples.length;j++){
    const i=(j+epoch*37)%samples.length,sample=samples[i],x=inputs[i],o=head.ordinal!,z=o.weights.reduce((sum,w,f)=>sum+w*x[f],0);
    let gradient=0,known=0;const rate=0.003/(1+epoch*0.08),classWeight=Math.min(2,Math.sqrt(samples.length/(counts.size*counts.get(sample.label)!)));
    for(let k=1;k<=4;k++){
      if(sample.label==="OTHER"&&k<=2)continue;
      const actual=sample.label==="OTHER"?0:Number(ranks[sample.label]>=k),p=1/(1+Math.exp(Math.max(-40,Math.min(40,o.thresholds[k-1]-z))));
      const lossWeight=classWeight*(k===4&&actual===0&&sample.label!=="OTHER"&&ranks[sample.label]<=2?1.5:1);
      const g=lossWeight*(p-actual);gradient+=g;known++;o.thresholds[k-1]+=rate*g;
    }
    for(let f=0;f<d;f++)o.weights[f]-=rate*(gradient/Math.max(1,known)*x[f]+0.08*o.weights[f]);
    for(let k=1;k<4;k++)o.thresholds[k]=Math.max(o.thresholds[k],o.thresholds[k-1]+0.05);
  }
  if(!validPersonalHead(head))throw Error("INVALID_ORDINAL_MODEL");return head;
}
