import { createHash } from "node:crypto";
export type Group = "S" | "A" | "OTHER" | "X";
export type VisualSample = { id: string; author: string; label: Group; features: number[]; fingerprint: string; legacy: { authorId: string | null; adultScore: number; creatorScore: number; possiblySensitive: boolean } | null };
export const GROUPS: Group[] = ["S", "A", "OTHER", "X"];
export function tierGroup(tier: unknown): Group | null {
  if (tier === "S" || tier === "X") return tier;
  if (tier === "A" || tier === "A+") return "A";
  if (["B", "B+", "C", "D", "D+", "OTHER"].includes(String(tier))) return "OTHER";
  return null;
}
export function decodeVisualFeatures(encoded: string, dimension: number) {
  const bytes = Buffer.from(encoded, "base64");
  if (!Number.isInteger(dimension) || dimension < 100 || dimension > 10000 || bytes.length !== dimension * 4) throw new Error("視覚特徴の次元が不正です。");
  const features = Array.from({length: dimension}, (_, i) => bytes.readFloatLE(i * 4));
  if (!features.every(Number.isFinite)) throw new Error("視覚特徴に非数値が含まれます。");
  return { features, fingerprint: createHash("sha256").update(bytes).digest("hex") };
}
// Author and identical-feature groups remain together to avoid cross-split leakage.
export function splitSamples(samples: VisualSample[]) {
  const parent = samples.map((_, i) => i);
  function find(i: number): number { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
  const authors = new Map<string, number>(), fingerprints = new Map<string, number>();
  samples.forEach((s, i) => {
    for (const [map, key] of [[authors, s.author], [fingerprints, s.fingerprint]] as const) {
      const previous = map.get(key); if (previous !== undefined) parent[find(i)] = find(previous); else map.set(key, i);
    }
  });
  const components = new Map<number, VisualSample[]>();
  samples.forEach((s, i) => { const key = find(i); const group = components.get(key) ?? []; group.push(s); components.set(key, group); });
  const groups = [...components.values()].sort((a,b) => {
    const key = (g: VisualSample[]) => createHash("sha256").update(g.map(s=>s.id).sort().join(",")).digest("hex");
    return key(a).localeCompare(key(b));
  });
  if (groups.length < 3) return { train: samples, test: [] as VisualSample[], groups: groups.length };
  const testCount = Math.max(1, Math.floor(groups.length * 0.2));
  return { train: groups.slice(testCount).flat(), test: groups.slice(0, testCount).flat(), groups: groups.length };
}
export function trainVisualCentroids(samples: VisualSample[]) {
  if (!samples.length) throw new Error("学習用視覚特徴がありません。");
  const dimension = samples[0].features.length;
  if (!samples.every(s => s.features.length === dimension)) throw new Error("異なる特徴形式が混在しています。");
  const mean = Array(dimension).fill(0) as number[], variance = [...mean];
  samples.forEach(s=>s.features.forEach((v,i)=>{mean[i]+=v;}));
  mean.forEach((_,i)=>{mean[i]/=samples.length;});
  samples.forEach(s=>s.features.forEach((v,i)=>{variance[i]+=(v-mean[i])**2;}));
  const positiveVariances = variance.map(v=>v/samples.length).filter(v=>v>1e-12).sort((a,b)=>a-b);
  const floor = Math.max(1e-6, (positiveVariances[Math.floor(positiveVariances.length/2)] ?? 1) * 0.1);
  const scale = variance.map(v=>Math.sqrt(v/samples.length + floor));
  const centroids = GROUPS.flatMap(label=>{
    const members=samples.filter(s=>s.label===label);if(!members.length)return[];
    const center=Array(dimension).fill(0) as number[];
    members.forEach(s=>s.features.forEach((v,i)=>{center[i]+=(v-mean[i])/scale[i];}));
    center.forEach((_,i)=>{center[i]/=members.length;});return [{label,center,count:members.length}];
  });
  return {mean,scale,centroids};
}
export function predictVisualGroup(features: number[], model: ReturnType<typeof trainVisualCentroids>): Group {
  if(features.length!==model.mean.length)throw new Error("視覚特徴が一致しません。");
  const distances=model.centroids.map(c=>({label:c.label,distance:c.center.reduce((sum,v,i)=>sum+((features[i]-model.mean[i])/model.scale[i]-v)**2,0)}));
  distances.sort((a,b)=>a.distance-b.distance);return distances[0].label;
}
export function metrics(items: {actual: Group; predicted: Group}[]) {
  const perClass=GROUPS.map(label=>{
    const tp=items.filter(i=>i.actual===label&&i.predicted===label).length;
    const support=items.filter(i=>i.actual===label).length,predicted=items.filter(i=>i.predicted===label).length;
    return {label,support,predicted,precision:predicted?tp/predicted:null,recall:support?tp/support:null,f1:support?2*tp/(support+predicted):null};
  });
  const supported=perClass.filter(c=>c.support>0);
  return {count:items.length,accuracy:items.length?items.filter(i=>i.actual===i.predicted).length/items.length:null,
    macroF1:supported.length?supported.reduce((sum,c)=>sum+(c.f1??0),0)/supported.length:null,perClass};
}
