// Independent multilabel classifier. No Tier weights, database or provider access.
export const LABEL_FEATURE_SPEC = "label-four-frames-10-25-50-80-v1";
export const LABEL_DIM = 1024;
export type LabelDefinition = { id: string; name: string; active: boolean };
export type Decisions = Record<string, boolean | null>;
export type LabelSample = { postId: string; hash: string; author: string | null; features: number[]; decisions: Decisions };
export type LabelHead = { id: string; positive: number; negative: number; weights: number[] | null; bias: number };
export type LabelModel = { spec: string; mean: number[]; scale: number[]; heads: LabelHead[]; samples: number };
export type Prediction = { id: string; score: number | null; selected: boolean | null };
export type LabelMetric = { id: string; tp: number; fp: number; fn: number; tn: number; known: number; scored: number; precision: number | null; recall: number | null };
export type LabelReport = { videos: number; labels: LabelMetric[]; scored: number; known: number; agreement: number | null; f1: number | null };
const sigmoid = (x: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));
export function validFeatures(x: unknown): x is number[] { return Array.isArray(x) && x.length === LABEL_DIM && x.every(v => typeof v === "number" && Number.isFinite(v)); }
function features(x: number[], mean: number[], scale: number[]) { return x.map((v, i) => Math.max(-4, Math.min(4, (v - mean[i]) / scale[i]))); }
export function fitLabels(samples: LabelSample[], ids: string[]): LabelModel {
  if (!samples.length || samples.some(s => !validFeatures(s.features))) throw Error("LABEL_INVALID_FEATURES");
  const mean = Array<number>(LABEL_DIM).fill(0), scale = Array<number>(LABEL_DIM).fill(0);
  for (const s of samples) s.features.forEach((v, i) => mean[i] += v / samples.length);
  for (const s of samples) s.features.forEach((v, i) => scale[i] += (v - mean[i]) ** 2 / samples.length);
  for (let i = 0; i < LABEL_DIM; i++) scale[i] = Math.max(0.03, Math.sqrt(scale[i]));
  const xs = samples.map(s => features(s.features, mean, scale));
  const heads = ids.map(id => {
    const known = samples.flatMap((s, i) => typeof s.decisions[id] === "boolean" ? [{ i, y: s.decisions[id] ? 1 : 0 }] : []);
    const positive = known.filter(s => s.y === 1).length, negative = known.length - positive;
    const head: LabelHead = { id, positive, negative, weights: null, bias: 0 };
    if (positive < 2 || negative < 2) return head;
    const w = Array<number>(LABEL_DIM).fill(0); let bias = 0;
    // Scale the input to keep full-batch updates stable with 1,024 correlated features.
    const divisor = Math.sqrt(LABEL_DIM);
    for (let epoch = 0; epoch < 100; epoch++) {
      const grad = Array<number>(LABEL_DIM).fill(0); let gb = 0;
      for (const { i, y } of known) {
        const x = xs[i]; let z = bias;
        for (let j = 0; j < LABEL_DIM; j++) z += w[j] * x[j] / divisor;
        const error = (sigmoid(z) - y) * (y ? known.length / (2 * positive) : known.length / (2 * negative));
        gb += error / known.length;
        for (let j = 0; j < LABEL_DIM; j++) grad[j] += error * x[j] / (known.length * divisor);
      }
      bias -= 0.6 * gb;
      for (let j = 0; j < LABEL_DIM; j++) w[j] -= 0.6 * (grad[j] + 0.02 * w[j]);
    }
    return { ...head, weights: w, bias };
  });
  return { spec: LABEL_FEATURE_SPEC, mean, scale, heads, samples: samples.length };
}
export function predictLabels(model: LabelModel, input: number[]): Prediction[] {
  if (!validFeatures(input) || model.spec !== LABEL_FEATURE_SPEC) throw Error("LABEL_INVALID_FEATURES");
  const x = features(input, model.mean, model.scale), divisor = Math.sqrt(LABEL_DIM);
  return model.heads.map(h => {
    if (!h.weights) return { id: h.id, score: null, selected: null };
    const score = sigmoid(h.weights.reduce((z, w, i) => z + w * x[i] / divisor, h.bias));
    return { id: h.id, score, selected: score >= 0.5 };
  });
}
export function scoreLabels(rows: { sample: LabelSample; predictions: Prediction[] }[], ids: string[]): LabelReport {
  const labels = ids.map(id => {
    let tp = 0, fp = 0, fn = 0, tn = 0, known = 0;
    for (const { sample, predictions } of rows) {
      const truth = sample.decisions[id]; if (typeof truth !== "boolean") continue;
      known++; const p = predictions.find(p => p.id === id)?.selected;
      if (typeof p !== "boolean") continue;
      if (p && truth) tp++; else if (p) fp++; else if (truth) fn++; else tn++;
    }
    return { id, tp, fp, fn, tn, known, scored: tp + fp + fn + tn, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null };
  });
  const total = labels.reduce((a, x) => ({ tp: a.tp + x.tp, fp: a.fp + x.fp, fn: a.fn + x.fn, tn: a.tn + x.tn, known: a.known + x.known }), { tp: 0, fp: 0, fn: 0, tn: 0, known: 0 });
  const scored = total.tp + total.fp + total.fn + total.tn;
  return { videos: rows.length, labels, scored, known: total.known, agreement: scored ? (total.tp + total.tn) / scored : null, f1: 2 * total.tp + total.fp + total.fn ? 2 * total.tp / (2 * total.tp + total.fp + total.fn) : null };
}
// Same author OR identical downloaded video joins a group, including transitive matches.
export function sampleGroups(samples: LabelSample[]) {
  const parent = samples.map((_, i) => i);
  const find = (i: number): number => parent[i] === i ? i : parent[i] = find(parent[i]);
  const keys = new Map<string, number>();
  samples.forEach((s, i) => {
    for (const k of ["hash:" + s.hash, ...(s.author ? ["author:" + s.author.toLowerCase()] : [])]) {
      const old = keys.get(k); if (old !== undefined) parent[find(i)] = find(old); else keys.set(k, i);
    }
  });
  return samples.map((_, i) => find(i));
}
export function crossCheckLabels(samples: LabelSample[], ids: string[]) {
  const groups = sampleGroups(samples), unique = [...new Set(groups)];
  if (unique.length < 2) return { groups: unique.length, folds: 0, report: null };
  const folds = Math.min(5, unique.length), assignment = new Map(unique.map((g, i) => [g, i % folds]));
  const scored: { sample: LabelSample; predictions: Prediction[] }[] = [];
  for (let f = 0; f < folds; f++) {
    const train = samples.filter((_, i) => assignment.get(groups[i]) !== f);
    const test = samples.filter((_, i) => assignment.get(groups[i]) === f);
    const model = fitLabels(train, ids);
    for (const sample of test) scored.push({ sample, predictions: predictLabels(model, sample.features) });
  }
  return { groups: unique.length, folds, report: scoreLabels(scored, ids) };
}
